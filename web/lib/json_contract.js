'use strict';
// JSON-контракт режима D («Вариант D — JSON-контракт»).
// Спека: doc/specs/archive/generation-mode-d/spec.md
//
// Чистые функции без зависимостей (ноль новых пакетов): извлечение JSON из
// ответа модели, ручная валидация по схеме, детерминированный рендер
// JSON→markdown. Покрыты юнитами в web/tests/all.test.js.

const SCENARIO_MIN_SCENES = 1;
const SCENARIO_MAX_SCENES = 8;
const SCENARIO_TEXT_MAX   = 8000;   // потолок одного текстового поля
const SCENARIO_JSON_MAX   = 100000; // потолок всего ответа модели
const BIO_TEXT_MIN = 100;
const BIO_TEXT_MAX = 4000;
const REGEN_TEXT_MAX = 12000;   // потолок тела раздела/блока
const PERSONALITY_MIN = 20;
const PERSONALITY_MAX = 2000;
const VOICE_MIN = 10;
const VOICE_MAX = 1000;
const PROSE_TEXT_MAX = 30000;   // потолок одного файла прозы
const LOCNPC_NAME_MAX = 200;
const LOCNPC_CONTENT_MIN = 20;
const LOCNPC_CONTENT_MAX = 20000;
const LOCNPC_MAX = 50;          // потолок записей локаций/НПС за один fill

// ── Извлечение ───────────────────────────────────────────────────────────────

// Достаёт JSON из ответа модели: сначала ```json-ограждение, иначе первое
// `{…}` в тексте. Возвращает { ok, value } или { ok:false, error }.
function extractJson(raw) {
  const text = String(raw || '');
  if (!text.trim()) return { ok: false, error: 'пустой ответ' };
  if (text.length > SCENARIO_JSON_MAX + 20000)
    return { ok: false, error: 'ответ слишком длинный' };
  let candidate = null;
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  if (fence) {
    candidate = fence[1].trim();
  } else {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return { ok: false, error: 'в ответе нет JSON-объекта' };
    candidate = text.slice(start, end + 1);
  }
  try {
    const value = JSON.parse(candidate);
    return { ok: true, value };
  } catch {
    return { ok: false, error: 'ответ не разбирается как JSON' };
  }
}

function _isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Тот же механизм, но для контрактов-массивов (карточки локаций/НПС, v2):
// fence ```json, иначе первые `[` … последние `]`. Возвращает { ok, value }
// (value обязан быть массивом) или { ok:false, error }.
function extractJsonArray(raw) {
  const text = String(raw || '');
  if (!text.trim()) return { ok: false, error: 'пустой ответ' };
  if (text.length > SCENARIO_JSON_MAX + 20000)
    return { ok: false, error: 'ответ слишком длинный' };
  let candidate = null;
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  if (fence) {
    candidate = fence[1].trim();
  } else {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end <= start) return { ok: false, error: 'в ответе нет JSON-массива' };
    candidate = text.slice(start, end + 1);
  }
  let value;
  try {
    value = JSON.parse(candidate);
  } catch {
    return { ok: false, error: 'ответ не разбирается как JSON' };
  }
  if (!Array.isArray(value)) return { ok: false, error: 'корень: нужен JSON-массив' };
  return { ok: true, value };
}

// Текстовые поля сценария/биографии не должны содержать конструкций,
// ломающих markdown-структуру файла: заголовки, ограждения кода, HTML-комменты
// (meta-строки `<!-- meta:… -->` собираются сервером и обязаны быть единственными).
function _forbiddenChunks(s) {
  const bad = [];
  if (/(^|\n)#{1,6}\s/.test(s)) bad.push('markdown-заголовок внутри текста');
  if (/```/.test(s)) bad.push('```-ограждение внутри текста');
  if (/<!--|--->?/.test(s)) bad.push('HTML-комментарий внутри текста');
  return bad;
}

function _checkText(s, path, errors, { max = SCENARIO_TEXT_MAX } = {}) {
  if (typeof s !== 'string' || !s.trim()) {
    errors.push(`${path}: ${typeof s !== 'string' ? 'нужна строка' : 'пустая строка'}`);
    return null;
  }
  const t = s.trim();
  if (t.length > max) { errors.push(`${path}: слишком длинный текст (${t.length} символов)`); return null; }
  for (const b of _forbiddenChunks(t)) errors.push(`${path}: ${b}`);
  return t;
}

function _checkStringArray(arr, path, errors, { min = 0 } = {}) {
  if (!Array.isArray(arr)) { errors.push(`${path}: нужен массив строк`); return null; }
  const out = [];
  arr.forEach((v, i) => {
    if (typeof v !== 'string' || !v.trim()) { errors.push(`${path}[${i}]: пустая строка`); return; }
    if (v.trim().length > SCENARIO_TEXT_MAX) { errors.push(`${path}[${i}]: слишком длинный текст`); return; }
    for (const b of _forbiddenChunks(v.trim())) errors.push(`${path}[${i}]: ${b}`);
    out.push(v.trim());
  });
  if (out.length < min) errors.push(`${path}: нужно минимум ${min} (есть ${out.length})`);
  return out;
}

function _unknownKeys(obj, allowed, path, errors) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) errors.push(`${path}: лишний ключ «${k}»`);
  }
}

// ── Сценарий: валидация ──────────────────────────────────────────────────────

// Возвращает { ok, errors[] }. Сообщения — человекочитаемые, уходят в 502-ответ
// дословно (см. префикс [схема] в UI).
function validateScenarioJson(obj) {
  const errors = [];
  if (!_isObj(obj)) return { ok: false, errors: ['корень: нужен JSON-объект'] };
  _unknownKeys(obj, ['prologue', 'scenes', 'finale', 'meta'], 'корень', errors);

  for (const block of ['prologue', 'finale']) {
    const label = block === 'prologue' ? 'пролог' : 'финал';
    const b = obj[block];
    if (!_isObj(b)) { errors.push(`${label}: нужен объект`); continue; }
    _unknownKeys(b, ['title', 'playerDesc', 'gmHints'], label, errors);
    _checkText(b.title, `${label}.title`, errors);
    _checkText(b.playerDesc, `${label}.playerDesc`, errors);
    _checkText(b.gmHints, `${label}.gmHints`, errors);
  }

  if (!Array.isArray(obj.scenes)) {
    errors.push('сцены: нужен массив');
  } else {
    if (obj.scenes.length < SCENARIO_MIN_SCENES || obj.scenes.length > SCENARIO_MAX_SCENES)
      errors.push(`сцены: нужно ${SCENARIO_MIN_SCENES}–${SCENARIO_MAX_SCENES} (есть ${obj.scenes.length})`);
    obj.scenes.forEach((sc, i) => {
      const p = `сцены[${i + 1}]`;
      if (!_isObj(sc)) { errors.push(`${p}: нужен объект`); return; }
      _unknownKeys(sc, ['title', 'place', 'playerDesc', 'colorit', 'gmHints', 'rolls'], p, errors);
      _checkText(sc.title, `${p}.title`, errors);
      if (sc.place !== undefined) _checkText(sc.place, `${p}.place`, errors);
      _checkText(sc.playerDesc, `${p}.playerDesc`, errors);
      _checkStringArray(sc.colorit, `${p}.colorit`, errors, { min: 1 });
      if (sc.gmHints !== undefined) _checkText(sc.gmHints, `${p}.gmHints`, errors);
      if (sc.rolls !== undefined) {
        if (!Array.isArray(sc.rolls)) { errors.push(`${p}.rolls: нужен массив`); }
        else sc.rolls.forEach((r, j) => {
          const rp = `${p}.rolls[${j + 1}]`;
          if (!_isObj(r)) { errors.push(`${rp}: нужен объект`); return; }
          _unknownKeys(r, ['name', 'text'], rp, errors);
          _checkText(r.name, `${rp}.name`, errors);
          _checkText(r.text, `${rp}.text`, errors);
        });
      }
    });
  }

  const meta = obj.meta;
  if (!_isObj(meta)) {
    errors.push('meta: нужен объект {npcs[], locations[]}');
  } else {
    _unknownKeys(meta, ['npcs', 'locations'], 'meta', errors);
    _checkStringArray(meta.npcs, 'meta.npcs', errors);
    _checkStringArray(meta.locations, 'meta.locations', errors);
  }

  return { ok: errors.length === 0, errors };
}

// ── Сценарий: рендер ─────────────────────────────────────────────────────────
// Детерминированный markdown строго по system/rules/scenario_template.md.
// Порядок блоков фиксирован, шапка (`# Сценарий`, ссылки, meta-комменты,
// `meta:genmode`) собирается вызывающим кодом (fill.js), не моделью.

function _bullets(items) {
  return items.map(x => `- ${x}`).join('\n');
}

function renderScenarioJson(obj) {
  // Meta-строки — в самом начале, ДО первого `##` (как требует шаблон):
  // их читают _extractMetaList(), checkScenarioCanonical и генератор карточек.
  const metaLine = (key, arr) => `<!-- meta:${key}: ${arr.map(String).map(s => s.trim()).join('; ')} -->`;
  const meta = [
    metaLine('npcs', obj.meta.npcs),
    metaLine('locations', obj.meta.locations),
  ].join('\n');

  const scenes = obj.scenes.map((sc, i) => {
    const head = [`## Сцена ${i + 1} — ${sc.title.trim()}${sc.place && sc.place.trim() ? ` (${sc.place.trim()})` : ''}`, '',
      '### Описание для игрока', '', sc.playerDesc.trim(), ''];
    if (Array.isArray(sc.rolls)) {
      for (const r of sc.rolls) {
        head.push(`### Бросок — ${r.name.trim()}`, '', r.text.trim(), '');
      }
    }
    head.push('### Колорит', '', _bullets(sc.colorit.map(String).map(s => s.trim())), '');
    if (sc.gmHints && sc.gmHints.trim()) head.push('### GM-подсказки', '', sc.gmHints.trim(), '');
    return head.join('\n').trimEnd();
  }).join('\n\n---\n\n');

  const prologue = [
    `## Пролог — ${obj.prologue.title.trim()}`, '',
    '### Описание для игрока', '', obj.prologue.playerDesc.trim(), '',
    '### GM-подсказки', '', obj.prologue.gmHints.trim(), '',
  ].join('\n');

  const finale = [
    `## Финал — ${obj.finale.title.trim()}`, '',
    '### Описание для игрока', '', obj.finale.playerDesc.trim(), '',
    '### GM-подсказки', '', obj.finale.gmHints.trim(), '',
  ].join('\n');

  const body = [prologue, scenes, finale].join('\n\n---\n\n');
  return `${meta}\n\n${body}`;
}

// ── Биография: валидация ─────────────────────────────────────────────────────

function countSentences(text) {
  return String(text || '').split(/[.!?…]+/).map(s => s.trim()).filter(s => s.length > 0).length;
}

// Жёстко: обязательное строковое поле в границах длины, без конструкций,
// ломающих карточку. Мягко (не блочит): число предложений 4–8 —
// вызывается отдельно, результат уходит в warnings как [схема].
function validateBiographyJson(obj) {
  const errors = [];
  if (!_isObj(obj)) return { ok: false, errors: ['корень: нужен JSON-объект'], text: '' };
  _unknownKeys(obj, ['biography', 'mentions'], 'корень', errors);
  const text = _checkText(obj.biography, 'biography', errors, { max: BIO_TEXT_MAX });
  if (typeof obj.biography === 'string' && obj.biography.trim()) {
    const len = obj.biography.trim().length;
    if (len < BIO_TEXT_MIN) errors.push(`biography: слишком коротко (${len} символов, нужно от ${BIO_TEXT_MIN})`);
  }
  if (obj.mentions !== undefined) {
    if (!Array.isArray(obj.mentions)) { errors.push('mentions: нужен массив строк'); }
    else obj.mentions.forEach((m, i) => {
      if (typeof m !== 'string' || !m.trim() || m.trim().length > 200)
        errors.push(`mentions[${i + 1}]: нужна непустая строка`);
    });
  }
  return { ok: errors.length === 0, errors, text: errors.length === 0 ? text : '' };
}

// ── Перегенерация раздела/блока: валидация ───────────────────────────────────
// Раздел — только содержимое (без заголовков вовсе: serialize подставит строку
// заголовка сам). Блок — содержимое начиная с первого «###», минимум один
// подраздел (иначе splitH3Body тихо потеряет детей), без «##».
// Возвращает { ok, errors[], body }.
function validateRegenJson(obj, kind, opts = {}) {
  const errors = [];
  if (!_isObj(obj)) return { ok: false, errors: ['корень: нужен JSON-объект'], body: '' };
  _unknownKeys(obj, ['body'], 'корень', errors);
  const raw = obj.body;
  if (typeof raw !== 'string' || !raw.trim()) {
    errors.push('body: пустая строка');
    return { ok: false, errors, body: '' };
  }
  const body = raw.trim();
  if (body.length > REGEN_TEXT_MAX)
    errors.push(`body: слишком длинный текст (${body.length} символов)`);
  if (/```/.test(body)) errors.push('body: ```-ограждение внутри текста');
  if (/<!--|--->?/.test(body)) errors.push('body: HTML-комментарий внутри текста');
  if (/(^|\n)##\s/.test(body))
    errors.push('body: заголовок «##» внутри текста (верни только содержимое, без заголовков)');
  if (kind === 'section') {
    if (/(^|\n)#{1,6}\s/.test(body))
      errors.push('body: markdown-заголовок внутри текста раздела');
  } else {
    if (!/(^|\n)###\s/.test(body))
      errors.push('body: нет ни одного подраздела «###» — блок потеряет структуру');
    else if (opts.requireColorit && !/(^|\n)###\s*Колорит/.test(body))
      errors.push('body: у сцены нет подраздела «### Колорит»');
  }
  return { ok: errors.length === 0, errors, body: errors.length === 0 ? body : '' };
}

// ── Характер/голос: валидация ────────────────────────────────────────────────
// Возвращает { ok, errors[], personality, voice }.
function validatePersonalityJson(obj) {
  const errors = [];
  if (!_isObj(obj)) return { ok: false, errors: ['корень: нужен JSON-объект'], personality: '', voice: '' };
  _unknownKeys(obj, ['personality', 'voice'], 'корень', errors);
  const checkBounded = (v, p, min, max) => {
    if (typeof v !== 'string' || !v.trim()) { errors.push(`${p}: пустая строка`); return ''; }
    const t = v.trim();
    if (t.length < min) errors.push(`${p}: слишком коротко (${t.length} символов, нужно от ${min})`);
    if (t.length > max) errors.push(`${p}: слишком длинный текст (${t.length} символов)`);
    for (const b of _forbiddenChunks(t)) errors.push(`${p}: ${b}`);
    return t;
  };
  const personality = checkBounded(obj.personality, 'personality', PERSONALITY_MIN, PERSONALITY_MAX);
  const voice = checkBounded(obj.voice, 'voice', VOICE_MIN, VOICE_MAX);
  return { ok: errors.length === 0, errors,
    personality: errors.length === 0 ? personality : '',
    voice: errors.length === 0 ? voice : '' };
}

// ── Проза (набор файлов): валидация ──────────────────────────────────────────
// expectedRels — точный список относительных путей запрошенных стабов.
// Множество path обязано совпасть 1:1 (без дублей, пропусков и лишних).
// Возвращает { ok, errors[], files: [{ path, content }] }.
function validateProseJson(obj, expectedRels) {
  const errors = [];
  const expected = (expectedRels || []).map(String);
  if (!_isObj(obj)) return { ok: false, errors: ['корень: нужен JSON-объект'], files: [] };
  _unknownKeys(obj, ['files'], 'корень', errors);
  const files = [];
  if (!Array.isArray(obj.files)) {
    errors.push('files: нужен массив');
  } else {
    const seen = new Set();
    obj.files.forEach((f, i) => {
      const p = `files[${i + 1}]`;
      if (!_isObj(f)) { errors.push(`${p}: нужен объект {path, content}`); return; }
      _unknownKeys(f, ['path', 'content'], p, errors);
      const rel = typeof f.path === 'string' ? f.path.trim() : '';
      if (!rel) { errors.push(`${p}.path: пустая строка`); return; }
      if (seen.has(rel)) { errors.push(`${p}.path: дубль «${rel}»`); return; }
      seen.add(rel);
      if (typeof f.content !== 'string' || !f.content.trim()) { errors.push(`${p}.content: пустая строка`); return; }
      const content = f.content.trim();
      if (content.length > PROSE_TEXT_MAX)
        errors.push(`${p}.content: слишком длинный текст (${content.length} символов)`);
      if (/ОЖИДАЕТ ГЕНЕРАЦИИ/.test(content))
        errors.push(`${p}.content: остался маркер «ОЖИДАЕТ ГЕНЕРАЦИИ» — файл не дописан`);
      files.push({ path: rel, content });
    });
    for (const rel of seen) {
      if (!expected.includes(rel)) errors.push('files: лишний файл «' + rel + '»');
    }
    for (const rel of expected) {
      if (!seen.has(rel)) errors.push(`files: нет файла «${rel}»`);
    }
  }
  return { ok: errors.length === 0, errors, files: errors.length === 0 ? files : [] };
}

// ── Локации/НПС (fill): валидация массива карточек ───────────────────────────
// Возвращает { ok, errors[], items: [{ name, content }] }.
function validateLocNpcJson(arr, what) {
  const errors = [];
  const label = what === 'нпс' ? 'нпс' : 'локации';
  if (!Array.isArray(arr)) return { ok: false, errors: [`${label}: нужен JSON-массив`], items: [] };
  if (arr.length > LOCNPC_MAX)
    errors.push(`${label}: слишком много записей (${arr.length})`);
  const items = [];
  arr.forEach((e, i) => {
    const p = `${label}[${i + 1}]`;
    if (!_isObj(e)) { errors.push(`${p}: нужен объект {name, content}`); return; }
    _unknownKeys(e, ['name', 'content'], p, errors);
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    const content = typeof e.content === 'string' ? e.content.trim() : '';
    if (!name || name.length > LOCNPC_NAME_MAX)
      errors.push(`${p}.name: ${!name ? 'пустое имя' : 'слишком длинное имя'}`);
    if (content.length < LOCNPC_CONTENT_MIN || content.length > LOCNPC_CONTENT_MAX)
      errors.push(`${p}.content: ${content.length < LOCNPC_CONTENT_MIN ? 'пустая/слишком короткая карточка' : 'слишком длинная карточка'}`);
    if (name && content.length >= LOCNPC_CONTENT_MIN && content.length <= LOCNPC_CONTENT_MAX)
      items.push({ name, content });
  });
  return { ok: errors.length === 0, errors, items: errors.length === 0 ? items : [] };
}

// ── Тексты контракта для промтов ─────────────────────────────────────────────

function scenarioContractText() {
  return `# СТРОГИЙ JSON-КОНТРАКТ — СЦЕНАРИЙ (режим D)
Верни ТОЛЬКО валидный JSON (допустимо \`\`\`json-ограждение), без прозы до и после. Схема (ровно эти ключи, лишних нет):
{
  "prologue": { "title": "название (без слова «Пролог»)", "playerDesc": "текст для игрока", "gmHints": "подсказки мастеру" },
  "scenes": [ { "title": "название", "place": "место/район (необязательно)", "playerDesc": "текст", "colorit": ["деталь 1", "деталь 2"], "gmHints": "подсказки (необязательно)", "rolls": [{ "name": "название броска", "text": "характеристика + способность (сложность N)" }] } ],
  "finale": { "title": "название", "playerDesc": "текст", "gmHints": "подсказки" },
  "meta": { "npcs": ["Имя1", "Имя2"], "locations": ["Место1"] }
}
Требования: сцены — от 1 до 8; «colorit» — минимум 1 деталь (лучше 2–3 про место/район/время); тексты — без \`#\`-заголовков, без \`\`\` и без \`<!--\`; meta — ВСЕ имена НПС и названия локаций из сценария (единственный способ создать карточки).`;
}

function biographyContractText() {
  return `# СТРОГИЙ JSON-КОНТРАКТ — БИОГРАФИЯ (режим D)
Верни ТОЛЬКО валидный JSON (допустимо \`\`\`json-ограждение), без прозы до и после:
{ "biography": "текст биографии, 4–8 предложений", "mentions": ["Имя1", "Имя2"] }
Требования: «biography» — только текст (без заголовков, без кавычек-обёртки, без \`\`\` и \`<!--\`); «mentions» — имена связанных персонажей, упомянутых в тексте (массив строк, можно пустой). Лишних ключей нет.`;
}

function regenContractText(kind) {
  if (kind === 'block') {
    return `# СТРОГИЙ JSON-КОНТРАКТ — БЛОК СЦЕНАРИЯ (режим D)
Верни ТОЛЬКО валидный JSON (допустимо \`\`\`json-ограждение), без прозы до и после:
{ "body": "новый текст блока начиная СРАЗУ с первого «### »" }
Требования: минимум один подраздел «###» (иначе блок потеряет структуру); у сцены обязателен «### Колорит»; без строки заголовка «## …», без других «##», без \`\`\` и \`<!--\`. Лишних ключей нет.`;
  }
  return `# СТРОГИЙ JSON-КОНТРАКТ — РАЗДЕЛ СЦЕНАРИЯ (режим D)
Верни ТОЛЬКО валидный JSON (допустимо \`\`\`json-ограждение), без прозы до и после:
{ "body": "новый текст раздела (без строки заголовка)" }
Требования: только содержимое раздела — без markdown-заголовков вовсе, без \`\`\` и \`<!--\`, без обрамляющих «---». Лишних ключей нет.`;
}

function personalityContractText() {
  return `# СТРОГИЙ JSON-КОНТРАКТ — ХАРАКТЕР (режим D)
Верни ТОЛЬКО валидный JSON (допустимо \`\`\`json-ограждение), без прозы до и после:
{ "personality": "характер, 2–4 предложения", "voice": "голос, 1–2 предложения" }
Требования: «personality» — от 20 символов, «voice» — от 10; оба — только текст (без заголовков, без \`\`\` и \`<!--\`). Лишних ключей нет.`;
}

function proseContractText(rels) {
  const list = (rels || []).map(String);
  return `# СТРОГИЙ JSON-КОНТРАКТ — ПРОЗА (режим D)
Верни ТОЛЬКО валидный JSON (допустимо \`\`\`json-ограждение), без прозы до и после:
{ "files": [{ "path": "<точный путь из списка ниже>", "content": "<ПОЛНОЕ содержимое файла>" }] }
Файлы (каждый ровно один раз, path — дословно):
${list.map(r => `- ${r}`).join('\n')}
Требования: «content» — полный текст файла БЕЗ маркера «ОЖИДАЕТ ГЕНЕРАЦИИ» и служебных комментариев; лишних файлов и ключей нет.`;
}

function locNpcContractText(what) {
  return `# СТРОГИЙ JSON-КОНТРАКТ — КАРТОЧКИ ${what === 'нпс' ? 'НПС' : 'ЛОКАЦИЙ'} (режим D)
Верни СТРОГО JSON-массив без прозы до и после: [{ "name": "<имя>", "content": "<полная карточка markdown>" }, ...]
Требования: у каждой записи непустые «name» и «content» (карточка короче 20 символов — брак); карточки — строго по шаблону из промта; лишних ключей нет. Пустой массив при непустом списке выше — брак (все позиции обязательны).`;
}

// Блок корректирующего ретрая (решение В3): дословные пункты валидатора
// подставляются в повторный запрос. Маркер «ОШИБКИ ПРЕДЫДУЩЕГО ОТВЕТА»
// используется и тестовым мок-провайдером для детерминированного ретрая.
function retryAddition(errors) {
  return `# ОШИБКИ ПРЕДЫДУЩЕГО ОТВЕТА (режим D, попытка 2 из 2)
Предыдущий ответ не прошёл проверку схемы:
${errors.map(e => `- ${e}`).join('\n')}
Верни исправленный ПОЛНЫЙ JSON заново (целиком, не фрагмент), с учётом всех требований контракта выше.`;
}

module.exports = {
  SCENARIO_MIN_SCENES, SCENARIO_MAX_SCENES, SCENARIO_TEXT_MAX, SCENARIO_JSON_MAX,
  BIO_TEXT_MIN, BIO_TEXT_MAX,
  REGEN_TEXT_MAX, PERSONALITY_MIN, PERSONALITY_MAX, VOICE_MIN, VOICE_MAX,
  PROSE_TEXT_MAX, LOCNPC_NAME_MAX, LOCNPC_CONTENT_MIN, LOCNPC_CONTENT_MAX, LOCNPC_MAX,
  extractJson, extractJsonArray, validateScenarioJson, renderScenarioJson,
  validateBiographyJson, countSentences,
  validateRegenJson, validatePersonalityJson, validateProseJson, validateLocNpcJson,
  scenarioContractText, biographyContractText, retryAddition,
  regenContractText, personalityContractText, proseContractText, locNpcContractText,
};
