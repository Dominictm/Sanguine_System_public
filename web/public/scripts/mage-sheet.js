// ═══════════════════════════════════════════════════════════════════════════
// Лист персонажа мага (линейка mages) — отдельный от V20 лист.
//
// Раскладка и подписи — бланк «Маги: Восхождение» (1 страница); правила создания —
// книга «Маги: Восхождение. Классические правила», стр. 258–261. Хранится в
// <slug>-sheet.json (schema: 'mage-1'), GET/PUT /api/characters/:slug/sheet-data без
// новых роутов. Спека — doc/design/2026-10-11-mage-sheet-spec.md, скилл mage-sheet.
//
// Устройство повторяет лист оборотня (werewolf-sheet.js): своё состояние (_mgModel/_mgCtx),
// презентационные куски V20 (_v20DotsHtml/_v20BoxesHtml/_v20Field/_v20Get/_v20Set/…) и
// CSS .v20-*/.chg-budget/.ww-health-* переиспользуются, V20-глобалы не пишутся.
// ═══════════════════════════════════════════════════════════════════════════

const MG_SCHEMA = 'mage-1';
const MG_MAX = 5;            // атрибуты / способности / Сферы / факты биографии
const MG_MAX_TRAIT = 10;     // Воля, Арете
const MG_RING = 20;          // кольцо Квинтэссенция/Парадокс
const MG_ABIL_CAP = 3;       // способность выше 3 при создании — предупреждение

const MG_ATTRS = {
  physical: ['strength', 'dexterity', 'stamina'],
  social:   ['charisma', 'manipulation', 'appearance'],
  mental:   ['perception', 'intelligence', 'wits'],
};
// Порядок — как на бланке.
const MG_ABILITIES = {
  talents:    ['athletics', 'alertness', 'brawl', 'intimidation', 'art', 'expression', 'leadership', 'streetwise', 'subterfuge', 'awareness', 'empathy'],
  skills:     ['martialArts', 'drive', 'survival', 'research', 'meditation', 'crafts', 'stealth', 'firearms', 'melee', 'technology', 'etiquette'],
  knowledges: ['academics', 'science', 'enigmas', 'law', 'computer', 'cosmology', 'medicine', 'occult', 'politics', 'investigation', 'esoterica'],
};
const MG_CUSTOM_ROWS = 3;
// Сферы — три колонки бланка.
const MG_SPHERE_COLS = [['time', 'spirit', 'life'], ['matter', 'prime', 'mind'], ['correspondence', 'forces', 'entropy']];
const MG_SPHERES = MG_SPHERE_COLS.flat();
const MG_HEALTH = ['bruised', 'hurt', 'injured', 'wounded', 'mauled', 'crippled', 'incapacitated'];
const MG_HEALTH_PEN = { bruised: '', hurt: '−1', injured: '−1', wounded: '−2', mauled: '−2', crippled: '−5', incapacitated: '' };
const MG_DAMAGE = ['', 'bashing', 'lethal', 'aggravated'];
const MG_DAMAGE_MARK = { '': '', bashing: '/', lethal: 'X', aggravated: '✱' };
const MG_BASE = { backgrounds: 6, meritsFlaws: 8, psychoses: 4 };
const _MG_HEADER_KEYS = ['name', 'essence', 'nature', 'demeanor', 'faction', 'tradition'];
const MG_ESSENCES = ['dynamic', 'primordial', 'questing', 'pattern'];

// Фракции и принадлежности (книга стр. 258–260) — подсказки datalist и Родственные Сферы.
const MG_FACTIONS = {
  traditions: {
    'Адепты Виртуальности': ['correspondence', 'forces'], 'Акашийское Братство': ['life', 'mind'],
    'Вербена': ['life', 'forces'], 'Говорящие с Грёзой': ['spirit', 'life', 'matter', 'forces'],
    'Культ Экстаза': ['time', 'life', 'mind'], 'Небесный Хор': ['spirit', 'prime', 'forces'],
    'Сыны Эфира': ['matter', 'prime', 'forces'], 'Орден Гермеса': ['forces'],
    'Эвтанаты': ['spirit', 'life', 'entropy'],
  },
  technocracy: {
    'Инженеры Пустоты': ['spirit', 'correspondence', 'forces'], 'Итерация Икс': ['time', 'matter', 'forces'],
    'Новый Мировой Порядок': ['correspondence', 'mind'], 'Родоначальники': ['life', 'prime'],
    'Синдикат': ['prime', 'mind', 'entropy'],
  },
  disparates: {
    'Аль-и-Батин': ['correspondence', 'mind'], 'Бата’а': ['spirit', 'life'],
    'Дети Знания': ['matter', 'prime', 'forces', 'entropy'], 'Копа Лоэй': MG_SPHERES,
    'Нгома': ['spirit', 'life', 'prime', 'mind'], 'Пустые': MG_SPHERES,
    'Рыцари-Тамплиеры': ['life', 'prime', 'mind', 'forces'], 'Сёстры Ипполиты': ['life', 'mind'],
    'Сироты': MG_SPHERES, 'Тафтани': ['spirit', 'matter', 'prime', 'forces'],
    'У-Лун': ['spirit', 'life', 'matter', 'forces'],
  },
};

// ── Таблица имён: бланк «Восхождение» · прежний бланк M20 A4 · EN ──────────────
const _MG_NAMES = [
  ['attr', 'physical', 'strength',     ['Сила', 'Strength']],
  ['attr', 'physical', 'dexterity',    ['Ловкость', 'Dexterity']],
  ['attr', 'physical', 'stamina',      ['Выносливость', 'Stamina']],
  ['attr', 'social',   'charisma',     ['Обаяние', 'Харизма', 'Charisma']],
  ['attr', 'social',   'manipulation', ['Манипуляция', 'Манипулирование', 'Manipulation']],
  ['attr', 'social',   'appearance',   ['Привлекательность', 'Внешность', 'Appearance']],
  ['attr', 'mental',   'perception',   ['Восприятие', 'Perception']],
  ['attr', 'mental',   'intelligence', ['Интеллект', 'Intelligence']],
  ['attr', 'mental',   'wits',         ['Смекалка', 'Сообразительность', 'Wits']],

  ['abil', 'talents', 'athletics',    ['Атлетика', 'Атлетизм', 'Athletics']],
  ['abil', 'talents', 'alertness',    ['Бдительность', 'Alertness']],
  ['abil', 'talents', 'brawl',        ['Драка', 'Рукопашный бой', 'Brawl']],
  ['abil', 'talents', 'intimidation', ['Запугивание', 'Устрашение', 'Intimidation']],
  ['abil', 'talents', 'art',          ['Искусство', 'Творчество', 'Art']],
  ['abil', 'talents', 'expression',   ['Красноречие', 'Экспрессия', 'Expression']],
  ['abil', 'talents', 'leadership',   ['Лидерство', 'Leadership']],
  ['abil', 'talents', 'streetwise',   ['Уличное чутьё', 'Знание улиц', 'Streetwise']],
  ['abil', 'talents', 'subterfuge',   ['Хитрость', 'Subterfuge']],
  ['abil', 'talents', 'awareness',    ['Шестое чувство', 'Осведомлённость', 'Awareness']],
  ['abil', 'talents', 'empathy',      ['Эмпатия', 'Empathy']],

  ['abil', 'skills', 'martialArts', ['Боевые искусства', 'Martial Arts']],
  ['abil', 'skills', 'drive',       ['Вождение', 'Drive']],
  ['abil', 'skills', 'survival',    ['Выживание', 'Survival']],
  ['abil', 'skills', 'research',    ['Исследование', 'Research']],
  ['abil', 'skills', 'meditation',  ['Медитация', 'Meditation']],
  ['abil', 'skills', 'crafts',      ['Ремесло', 'Ремёсла', 'Ремесла', 'Crafts']],
  ['abil', 'skills', 'stealth',     ['Скрытность', 'Незаметность', 'Stealth']],
  ['abil', 'skills', 'firearms',    ['Стрельба', 'Огнестрельное оружие', 'Firearms']],
  ['abil', 'skills', 'melee',       ['Фехтование', 'Холодное оружие', 'Melee']],
  ['abil', 'skills', 'technology',  ['Электроника', 'Техника', 'Technology']],
  ['abil', 'skills', 'etiquette',   ['Этикет', 'Etiquette']],

  ['abil', 'knowledges', 'academics',     ['Гуманитарные науки', 'Академические', 'Academics']],
  ['abil', 'knowledges', 'science',       ['Естественные науки', 'Наука', 'Science']],
  ['abil', 'knowledges', 'enigmas',       ['Загадки', 'Enigmas']],
  ['abil', 'knowledges', 'law',           ['Законы', 'Юриспруденция', 'Закон', 'Law']],
  ['abil', 'knowledges', 'computer',      ['Информатика', 'Компьютеры', 'Computer']],
  ['abil', 'knowledges', 'cosmology',     ['Космология', 'Параллельные миры', 'Космология / параллельные миры', 'Cosmology']],
  ['abil', 'knowledges', 'medicine',      ['Медицина', 'Medicine']],
  ['abil', 'knowledges', 'occult',        ['Оккультизм', 'Occult']],
  ['abil', 'knowledges', 'politics',      ['Политика', 'Politics']],
  ['abil', 'knowledges', 'investigation', ['Расследование', 'Investigation']],
  ['abil', 'knowledges', 'esoterica',     ['Эзотерика', 'Esoterica']],

  ['sphere', '', 'time',           ['Время', 'Time']],
  ['sphere', '', 'spirit',         ['Дух', 'Пространственная наука', 'Spirit', 'Dimensional Science']],
  ['sphere', '', 'life',           ['Жизнь', 'Life']],
  ['sphere', '', 'matter',         ['Материя', 'Matter']],
  ['sphere', '', 'prime',          ['Первооснова', 'Основы', 'Первопричина', 'Первичная польза', 'Prime', 'Primal Utility']],
  ['sphere', '', 'mind',           ['Разум', 'Mind']],
  ['sphere', '', 'correspondence', ['Связи', 'Пространство', 'Данные', 'Correspondence', 'Data']],
  // «Сила» здесь нет: это атрибут. В разделе Сфер «Сила» = Силы — см. _mgSphereAlias.
  ['sphere', '', 'forces',         ['Силы', 'Forces']],
  ['sphere', '', 'entropy',        ['Энтропия', 'Entropy']],
];

function _mgNorm(s) {
  return String(s == null ? '' : s).replace(/\*\*/g, '').replace(/\(.*?\)/g, ' ').toLowerCase()
    .replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const _MG_ALIAS = new Map();
for (const [kind, group, key, names] of _MG_NAMES) for (const n of names) _MG_ALIAS.set(_mgNorm(n), { kind, group, key });
function _mgAlias(name) { return _MG_ALIAS.get(_mgNorm(name)) || null; }
// Имя Сферы (в разделе Сфер или в поле «Родственная Сфера»): старый перевод «Сила» = Силы.
function _mgSphereAlias(name) {
  const n = _mgNorm(name);
  if (n === 'сила') return 'forces';
  const a = _MG_ALIAS.get(n);
  return a && a.kind === 'sphere' ? a.key : '';
}

// ── Модель ────────────────────────────────────────────────────────────────────
const _mgStr = v => (v == null ? '' : String(v));
const _mgInt = (v, max) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0; };
const _mgFlags = (a, n) => Array.from({ length: n }, (_, i) => !!(Array.isArray(a) && a[i]));
const _mgRated = () => ({ name: '', val: 0 });

function _mgRatedList(arr, n) {
  const out = Array.isArray(arr) ? arr.map(x => ({ name: _mgStr(x && x.name), val: _mgInt(x && x.val, MG_MAX) })) : [];
  while (out.length < n) out.push(_mgRated());
  return out;
}
function _mgMeritList(arr, n) {
  const out = Array.isArray(arr) ? arr.map(x => ({ name: _mgStr(x && x.name), points: _mgStr(x && x.points) })) : [];
  while (out.length < n) out.push({ name: '', points: '' });
  return out;
}
function _mgStrList(arr, n) {
  const out = Array.isArray(arr) ? arr.map(_mgStr) : [];
  while (out.length < n) out.push('');
  return out;
}

function _mgEmpty(headerSeed) {
  const h = {};
  for (const k of _MG_HEADER_KEYS) h[k] = _mgStr(headerSeed && headerSeed[k]);
  const attrs = {};
  for (const [g, keys] of Object.entries(MG_ATTRS)) { attrs[g] = {}; for (const k of keys) attrs[g][k] = 1; }
  const abil = g => MG_ABILITIES[g].map(key => ({ key, val: 0 })).concat(Array.from({ length: MG_CUSTOM_ROWS }, _mgRated));
  const spheres = {};
  for (const k of MG_SPHERES) spheres[k] = 0;
  const health = {};
  for (const k of MG_HEALTH) health[k] = '';
  return {
    lineage: 'mages', schema: MG_SCHEMA, header: h, attributes: attrs,
    abilities: { talents: abil('talents'), skills: abil('skills'), knowledges: abil('knowledges') },
    spheres, affinity: '',
    meritsFlaws: _mgMeritList(null, MG_BASE.meritsFlaws),
    backgrounds: _mgRatedList(null, MG_BASE.backgrounds),
    willpower: { permanent: 5, temp: _mgFlags(null, MG_MAX_TRAIT) },
    arete: 1, quintessence: 0, paradox: 0,
    psychoses: _mgStrList(null, MG_BASE.psychoses),
    health,
    experience: { total: 0, spent: 0 },
  };
}

// Любой вход → полная модель. Sidecar без schema (сид при создании, старый V20) пересевается
// пустой моделью: переносится только шапка-идентичность.
function _mgNormalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const e = _mgEmpty(src.header);
  if (src.schema !== MG_SCHEMA) return e;
  for (const [g, keys] of Object.entries(MG_ATTRS)) {
    for (const k of keys) e.attributes[g][k] = Math.max(1, _mgInt(src.attributes && src.attributes[g] && src.attributes[g][k], MG_MAX));
  }
  for (const g of Object.keys(MG_ABILITIES)) {
    const list = Array.isArray(src.abilities && src.abilities[g]) ? src.abilities[g] : [];
    const byKey = new Map(list.filter(x => x && x.key).map(x => [x.key, x]));
    const fixed = MG_ABILITIES[g].map(key => ({ key, val: _mgInt(byKey.get(key) && byKey.get(key).val, MG_MAX) }));
    const custom = list.filter(x => x && !x.key).map(x => ({ name: _mgStr(x.name), val: _mgInt(x.val, MG_MAX) }));
    while (custom.length < MG_CUSTOM_ROWS) custom.push(_mgRated());
    e.abilities[g] = fixed.concat(custom);
  }
  for (const k of MG_SPHERES) e.spheres[k] = _mgInt(src.spheres && src.spheres[k], MG_MAX);
  e.affinity = MG_SPHERES.includes(src.affinity) ? src.affinity : '';
  e.meritsFlaws = _mgMeritList(src.meritsFlaws, MG_BASE.meritsFlaws);
  e.backgrounds = _mgRatedList(src.backgrounds, MG_BASE.backgrounds);
  const wp = src.willpower || {};
  e.willpower = { permanent: _mgInt(wp.permanent, MG_MAX_TRAIT), temp: _mgFlags(wp.temp, MG_MAX_TRAIT) };
  e.arete = _mgInt(src.arete, MG_MAX_TRAIT);
  e.quintessence = _mgInt(src.quintessence, MG_RING);
  e.paradox = Math.min(_mgInt(src.paradox, MG_RING), MG_RING - e.quintessence);   // общее кольцо из 20
  e.psychoses = _mgStrList(src.psychoses, MG_BASE.psychoses);
  for (const k of MG_HEALTH) { const v = src.health && src.health[k]; e.health[k] = MG_DAMAGE.includes(v) ? v : ''; }
  const xp = src.experience || {};
  e.experience = { total: _mgInt(xp.total, 99999), spent: _mgInt(xp.spent, 99999) };
  return e;
}

function _mgSeedHeader(card, oldHeader) {
  const h = Object.assign({}, oldHeader || {});
  if (card) {
    for (const k of ['name', 'tradition', 'nature', 'demeanor']) {
      const v = _mgStr(card[k]).trim();
      if (v && !v.includes('⚠️') && !h[k]) h[k] = v;
    }
    if (!h.faction && h.tradition) h.faction = _mgFactionOf(h.tradition);
  }
  return h;
}

// Принадлежность → ключ фракции (по таблице книги) и подпись фракции.
function _mgFactionKey(tradition) {
  const n = _mgNorm(tradition);
  if (!n) return '';
  for (const [fk, list] of Object.entries(MG_FACTIONS)) {
    if (Object.keys(list).some(name => { const k = _mgNorm(name); return n === k || ` ${n} `.includes(` ${k} `); })) return fk;
  }
  return '';
}
function _mgFactionOf(tradition) { const fk = _mgFactionKey(tradition); return fk ? t('mg.faction.' + fk) : ''; }
function _mgAffinities(tradition) {
  const n = _mgNorm(tradition);
  if (!n) return null;
  for (const list of Object.values(MG_FACTIONS)) {
    for (const [name, spheres] of Object.entries(list)) {
      const k = _mgNorm(name);
      if (n === k || ` ${n} `.includes(` ${k} `)) return spheres;
    }
  }
  return null;
}

// ── Разбор markdown-листа ИИ ─────────────────────────────────────────────────
function _mgRatingFromCells(cells) {
  let dots = null, num = null, m;
  for (const c of cells.slice(1)) {
    if (/^[●○]+$/.test(c)) dots = (c.match(/●/g) || []).length;
    else if ((m = c.match(/^[●○]+\s*(\d+)$/))) num = parseInt(m[1], 10);
    else if (/^\d+$/.test(c)) num = parseInt(c, 10);
  }
  return num !== null ? num : dots;
}
const _mgCell = c => { const v = String(c || '').replace(/\*\*/g, '').trim(); return (!v || v === '—' || v === '-' || v.includes('⚠️')) ? '' : v; };
function _mgFillRated(list, name, val) {
  const empty = list.find(r => !r.key && !r.name && !r.val);
  if (empty) { empty.name = name; empty.val = val; return; }
  list.push({ name, val });
}

function _mgParseMd(md, headerSeed) {
  const m = _mgEmpty(headerSeed);
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let sec = '', sub = '', cm;
  const HEAD = [
    [/^имя(?: |$)/, 'name'], [/^(?:сущность|essence)(?: |$)/, 'essence'],
    [/^натура(?: |$)/, 'nature'], [/^маска(?: |$)/, 'demeanor'],
    [/^фракция(?: |$)/, 'faction'], [/^(?:принадлежность|традиция|affiliation)(?: |$)/, 'tradition'],
  ];
  for (const ln of lines) {
    if ((cm = ln.match(/^##\s+(.+)$/)))  { sec = _mgNorm(cm[1]); sub = ''; continue; }
    if ((cm = ln.match(/^###\s+(.+)$/))) { sub = _mgNorm(cm[1]); continue; }
    if (!/^\s*\|/.test(ln) || /\|\s*:?-{3,}/.test(ln)) continue;
    const cells = ln.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 2) continue;
    const rawName = cells[0].replace(/\*\*/g, '').trim();
    const name = _mgNorm(rawName);
    if (!name || /^(поле|характеристика|способность|сфера|значение|название|черта|факт биографии|достоинство|недостаток|очки|психоз)$/.test(name)) continue;
    const ctx = `${sec} ${sub}`;

    if (/шапк|концепц|амплуа/.test(sec)) {
      const v = _mgCell(cells[1]);
      if (/^(родственная сфера|affinity)/.test(name)) { m.affinity = _mgSphereAlias(v); continue; }
      const hit = HEAD.find(([re]) => re.test(name));
      if (hit && v) m.header[hit[1]] = v;
      continue;
    }
    if (/достоинств|недостат|merit|flaw/.test(ctx)) {
      const empty = m.meritsFlaws.find(r => !r.name);
      const row = { name: rawName, points: _mgCell(cells[1]) };
      if (empty) Object.assign(empty, row); else m.meritsFlaws.push(row);
      continue;
    }
    if (/психоз|quiet/.test(ctx)) {
      const i = m.psychoses.findIndex(x => !x);
      if (i >= 0) m.psychoses[i] = rawName; else m.psychoses.push(rawName);
      continue;
    }
    if (/опыт|experience/.test(sec)) {
      const n = _mgRatingFromCells(cells);
      if (n === null) continue;
      if (/^(всего|полный|total)/.test(name)) m.experience.total = _mgInt(n, 99999);
      else if (/^(потрачено|spent)/.test(name)) m.experience.spent = _mgInt(n, 99999);
      continue;
    }
    const val = _mgRatingFromCells(cells);
    if (/^(квинтэссенция|квинтессенция|quintessence)$/.test(name)) { if (val !== null) m.quintessence = _mgInt(val, MG_RING); continue; }
    if (/^(парадокс|paradox)$/.test(name)) { if (val !== null) m.paradox = _mgInt(val, MG_RING); continue; }
    if (/^(арете|arete)$/.test(name)) { if (val !== null) m.arete = _mgInt(val, MG_MAX_TRAIT); continue; }
    if (/^(воля|сила воли|willpower)$/.test(name)) { if (val !== null) m.willpower.permanent = _mgInt(val, MG_MAX_TRAIT); continue; }
    if (/^(родственная сфера|affinity)/.test(name)) { m.affinity = _mgSphereAlias(_mgCell(cells[1])); continue; }
    if (val === null) continue;

    if (/факт|биограф|background|предыстор/.test(ctx)) { _mgFillRated(m.backgrounds, rawName, _mgInt(val, MG_MAX)); continue; }
    if (/сфер|sphere/.test(ctx)) { const sk = _mgSphereAlias(rawName); if (sk) { m.spheres[sk] = _mgInt(val, MG_MAX); continue; } }
    const a = _mgAlias(rawName);
    if (a && a.kind === 'attr') { m.attributes[a.group][a.key] = Math.max(1, _mgInt(val, MG_MAX)); continue; }
    if (a && a.kind === 'abil') { const row = m.abilities[a.group].find(x => x.key === a.key); if (row) row.val = _mgInt(val, MG_MAX); continue; }
    if (a && a.kind === 'sphere') { m.spheres[a.key] = _mgInt(val, MG_MAX); continue; }
    for (const [g, re] of [['talents', /талант/], ['skills', /навык/], ['knowledges', /знани|познан/]]) {
      if (re.test(sub) || (!sub && re.test(sec))) { _mgFillRated(m.abilities[g], rawName, _mgInt(val, MG_MAX)); break; }
    }
  }
  if (m.quintessence + m.paradox > MG_RING) m.paradox = MG_RING - m.quintessence;
  if (!m.header.faction && m.header.tradition) m.header.faction = _mgFactionOf(m.header.tradition);
  return m;
}

// ── Бросок кубов (dice.js) ───────────────────────────────────────────────────
function _mgDiceLists(m) {
  const attrs = [], abils = [];
  for (const [g, keys] of Object.entries(MG_ATTRS)) {
    for (const k of keys) { const val = (m.attributes[g] || {})[k] || 0; if (val > 0) attrs.push({ label: t('mg.attr.' + k), val }); }
  }
  for (const g of Object.keys(MG_ABILITIES)) {
    for (const slot of (m.abilities[g] || [])) {
      const val = slot.val || 0;
      const label = slot.key ? t('mg.ab.' + slot.key) : slot.name;
      if (label && val > 0) abils.push({ label, val });
    }
  }
  return { attrs, abils };
}
// Самостоятельные пулы вместо добродетелей V20: Воля (постоянная) и Арете.
function _mgDiceTraits(m) {
  return [[t('mg.willpower'), (m.willpower || {}).permanent || 0], [t('mg.arete'), m.arete || 0]];
}

// ── Подсказка бюджета создания (книга стр. 258–261; не блокирует ввод) ───────
const MG_RULES = { attrs: [7, 5, 3], abilities: [13, 9, 5], backgrounds: 7, spheres: 6, arete: 1, areteMax: 3, willpower: 5, freebies: 15, flawsMax: 7,
  cost: { attribute: 5, ability: 2, background: 1, sphere: 7, arete: 4, willpower: 1, quintessence: 4 } };

function _mgAvatar(m) {
  const row = m.backgrounds.find(b => /^(аватара|аватар|гений|avatar|genius)/.test(_mgNorm(b.name)));
  return row ? row.val : 0;
}
function _mgBudget(m) {
  const R = MG_RULES;
  const desc = a => a.slice().sort((x, y) => y - x);
  const attrs = desc(Object.values(m.attributes).map(g => Object.values(g).reduce((s, v) => s + Math.max(0, v - 1), 0)));
  const abils = desc(Object.values(m.abilities).map(g => g.reduce((s, x) => s + (x.val || 0), 0)));
  const bg = m.backgrounds.reduce((s, x) => s + (x.val || 0), 0);
  const spheres = MG_SPHERES.reduce((s, k) => s + (m.spheres[k] || 0), 0);
  const avatar = _mgAvatar(m);
  const over = (u, l) => Math.max(0, u - l);
  const pts = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
  const merits = m.meritsFlaws.reduce((s, r) => s + Math.max(0, pts(r.points)), 0);
  const flaws = Math.min(R.flawsMax, m.meritsFlaws.reduce((s, r) => s + Math.max(0, -pts(r.points)), 0));
  const freebies =
    attrs.reduce((s, u, i) => s + over(u, desc(R.attrs)[i]), 0) * R.cost.attribute +
    abils.reduce((s, u, i) => s + over(u, desc(R.abilities)[i]), 0) * R.cost.ability +
    over(bg, R.backgrounds) * R.cost.background +
    over(spheres, R.spheres) * R.cost.sphere +
    over(m.arete, R.arete) * R.cost.arete +
    over(m.willpower.permanent, R.willpower) * R.cost.willpower +
    Math.ceil(over(m.quintessence, avatar) / R.cost.quintessence) +
    merits - flaws;
  const above = Object.values(m.abilities).reduce((s, g) => s + g.filter(x => x.val > MG_ABIL_CAP).length, 0);
  const sphereOverArete = MG_SPHERES.filter(k => m.spheres[k] > m.arete);
  return { attrs, abils, bg, spheres, avatar, freebies, above, sphereOverArete };
}

function _mgBudgetHtml(m) {
  const R = MG_RULES, b = _mgBudget(m);
  const part = (label, used, lim) => `<span class="chg-budget-part${used > lim ? ' chg-over' : ''}">${escHtml(label)} ${used}/${lim}</span>`;
  const tiers = (label, used, lims) => `<span class="chg-budget-part${used.some((u, i) => u > lims[i]) ? ' chg-over' : ''}">${escHtml(label)} ${used.map((u, i) => `${u}/${lims[i]}`).join(' · ')}</span>`;
  const parts = [
    tiers(t('mg.band.attrs'), b.attrs, R.attrs),
    tiers(t('mg.band.abilities'), b.abils, R.abilities),
    part(t('mg.col.backgrounds'), b.bg, R.backgrounds),
    part(t('mg.band.spheres'), b.spheres, R.spheres),
    part(t('mg.budget.freebies'), b.freebies, R.freebies),
  ];
  const aff = _mgAffinities(m.header.tradition);
  const options = (aff || MG_SPHERES).map(k => `<option value="${k}"${m.affinity === k ? ' selected' : ''}>${escHtml(t('mg.sphere.' + k))}</option>`).join('');
  const affinity = `<label class="chg-budget-note mg-affinity">${escHtml(t('mg.affinity'))}:
    <select data-mg-affinity aria-label="${escAttr(t('mg.affinity'))}"><option value="">—</option>${options}</select></label>`;
  const notes = [t('mg.budget.start', { arete: R.arete, wp: R.willpower, q: b.avatar })];
  const warn = [];
  if (b.above) warn.push(t('mg.budget.above3', { count: b.above }));
  if (m.arete > R.areteMax) warn.push(t('mg.budget.areteMax', { n: R.areteMax }));
  if (b.sphereOverArete.length) warn.push(t('mg.budget.sphereOverArete', { list: b.sphereOverArete.map(k => t('mg.sphere.' + k)).join(', ') }));
  if (m.affinity && !m.spheres[m.affinity]) warn.push(t('mg.budget.affinityEmpty', { name: t('mg.sphere.' + m.affinity) }));
  return `<div class="chg-budget-title">${escHtml(t('mg.budget.title'))}</div>
    <div class="chg-budget-parts">${parts.join('')}${affinity}</div>
    <div class="chg-budget-parts">${notes.map(n => `<span class="chg-budget-note">${escHtml(n)}</span>`).join('')}</div>
    ${warn.length ? `<div class="chg-budget-parts">${warn.map(n => `<span class="chg-budget-part chg-over">${escHtml(n)}</span>`).join('')}</div>` : ''}`;
}

// ── Рендер ────────────────────────────────────────────────────────────────────
let _mgModel = null, _mgCtx = null, _mgDirty = false, _mgRev = 0;

function _mgDots(dpath, val, max, warnAbove) {
  let html = _v20DotsHtml(dpath, val, max);
  if (warnAbove && val > warnAbove) html = html.replace('class="v20-dots"', 'class="v20-dots chg-over"');
  return html;
}
function _mgDotRow(label, dpath, val, max, warnAbove) {
  return `<div class="v20-row"><span class="v20-row-name">${escHtml(label)}</span>${_mgDots(dpath, val, max, warnAbove)}</div>`;
}
function _mgRm(path, idx, base) {
  return idx >= base
    ? `<button type="button" class="v20-row-remove-btn" data-mg-remove="${escAttr(path)}" data-mg-idx="${idx}" title="${escAttr(t('v20.removeRowTip'))}" aria-label="${escAttr(t('v20.removeRowTip'))}">×</button>` : '';
}
function _mgAddBtn(path) {
  return `<button type="button" class="v20-mini-action v20-add-row-btn" data-mg-add="${escAttr(path)}" title="${escAttr(t('v20.addRowTip'))}" aria-label="${escAttr(t('v20.addRowTip'))}">+</button>`;
}
function _mgHealthCell(k, v) {
  const label = `${t('mg.hl.' + k)} — ${t(v ? 'mg.dmg.' + v : 'mg.dmg.none')}`;
  return `<button type="button" class="ww-health-cell${v ? ' on ww-dmg-' + v : ''}" data-mg-health="${k}" aria-label="${escAttr(label)}" title="${escAttr(label)}">${MG_DAMAGE_MARK[v] || ''}</button>`;
}
// Кольцо: клетки 0..q-1 — Квинтэссенция, последние p — Парадокс.
function _mgRingHtml(q, p) {
  const cells = Array.from({ length: MG_RING }, (_, i) => {
    const kind = i < q ? 'q' : (i >= MG_RING - p ? 'p' : '');
    const label = t('mg.ring.cell', { n: i + 1 });
    return `<button type="button" class="mg-ring-cell${kind ? ' mg-ring-' + kind : ''}" data-mg-ring="${i}" aria-label="${escAttr(label)}" title="${escAttr(label)}"></button>`;
  }).join('');
  return `<div class="mg-ring" role="group" aria-label="${escAttr(t('mg.ring.aria'))}">${cells}</div>
    <div class="mg-ring-legend"><span class="mg-ring-q-label">${escHtml(t('mg.quintessence'))}: <b id="mg-q">${q}</b></span><span class="mg-ring-p-label">${escHtml(t('mg.paradox'))}: <b id="mg-p">${p}</b></span></div>
    <div class="mg-ring-hint">${escHtml(t('mg.ring.hint'))}</div>`;
}
function _mgDatalists() {
  const factions = Object.keys(MG_FACTIONS).map(fk => `<option value="${escAttr(t('mg.faction.' + fk))}">`).join('');
  const trads = Object.values(MG_FACTIONS).flatMap(l => Object.keys(l)).map(n => `<option value="${escAttr(n)}">`).join('');
  const ess = MG_ESSENCES.map(k => `<option value="${escAttr(t('mg.essence.' + k))}">`).join('');
  return `<datalist id="mg-faction-list">${factions}</datalist><datalist id="mg-tradition-list">${trads}</datalist><datalist id="mg-essence-list">${ess}</datalist>`;
}

function _mgSheetHtml(m) {
  const hf = (k, list) => _v20Field(t('mg.h.' + k), 'header.' + k, m.header[k], list ? ` list="${list}"${k === 'tradition' ? ' data-mg-ref' : ''}` : '');
  const header = `<div class="mg-head">
      <div class="v20-header mg-header">
        ${hf('name')}${hf('nature')}${hf('faction', 'mg-faction-list')}
        ${hf('essence', 'mg-essence-list')}${hf('demeanor')}${hf('tradition', 'mg-tradition-list')}
      </div>
      <div class="mg-xp">
        <div class="v20-col-title">${escHtml(t('mg.xp'))}</div>
        ${_v20Field(t('mg.xp.total'), 'experience.total', m.experience.total, ' inputmode="numeric" data-mg-exp')}
        ${_v20Field(t('mg.xp.spent'), 'experience.spent', m.experience.spent, ' inputmode="numeric" data-mg-exp')}
        <div class="v20-field"><span class="v20-field-lbl">${escHtml(t('mg.xp.remain'))}</span><span class="v20-field-input" id="mg-xp-remain">${m.experience.total - m.experience.spent}</span></div>
      </div>
      ${_mgDatalists()}
    </div>`;
  const attrCol = (g) => `<div class="v20-col"><div class="v20-col-title">${escHtml(t('mg.col.' + g))}</div>${
    MG_ATTRS[g].map(k => _mgDotRow(t('mg.attr.' + k), `attributes.${g}.${k}`, m.attributes[g][k], MG_MAX)).join('')}</div>`;
  const abCol = (g) => {
    const base = MG_ABILITIES[g].length + MG_CUSTOM_ROWS;
    const rows = m.abilities[g].map((r, i) => r.key
      ? _mgDotRow(t('mg.ab.' + r.key), `abilities.${g}.${i}.val`, r.val, MG_MAX, MG_ABIL_CAP)
      : `<div class="v20-row v20-named">${_mgRm('abilities.' + g, i, base)}<input class="v20-line-input" data-tpath="abilities.${g}.${i}.name" value="${escAttr(r.name)}" placeholder="…" aria-label="${escAttr(t('mg.ph.ability'))}">${_mgDots(`abilities.${g}.${i}.val`, r.val, MG_MAX, MG_ABIL_CAP)}</div>`).join('');
    return `<div class="v20-col"><div class="v20-col-title">${escHtml(t('mg.col.' + g))}${_mgAddBtn('abilities.' + g)}</div>${rows}</div>`;
  };
  const sphereCol = keys => `<div class="v20-col">${keys.map(k =>
    _mgDotRow(t('mg.sphere.' + k) + (m.affinity === k ? ' ★' : ''), `spheres.${k}`, m.spheres[k], MG_MAX, m.arete)).join('')}</div>`;
  const merits = m.meritsFlaws.map((r, i) => `<div class="v20-pair-row">${_mgRm('meritsFlaws', i, MG_BASE.meritsFlaws)}<input class="v20-line-input" data-tpath="meritsFlaws.${i}.name" value="${escAttr(r.name)}" placeholder="…" aria-label="${escAttr(t('mg.ph.merit'))}"><input class="v20-line-input v20-ritual-lvl" data-tpath="meritsFlaws.${i}.points" value="${escAttr(r.points)}" placeholder="±" inputmode="numeric" aria-label="${escAttr(t('mg.ph.points'))}"></div>`).join('');
  const bgs = m.backgrounds.map((r, i) => `<div class="v20-row v20-named">${_mgRm('backgrounds', i, MG_BASE.backgrounds)}<input class="v20-line-input" data-tpath="backgrounds.${i}.name" value="${escAttr(r.name)}" placeholder="…" aria-label="${escAttr(t('mg.ph.background'))}">${_mgDots(`backgrounds.${i}.val`, r.val, MG_MAX)}</div>`).join('');
  const psych = m.psychoses.map((v, i) => `<div class="v20-pair-row">${_mgRm('psychoses', i, MG_BASE.psychoses)}<input class="v20-line-input" data-tpath="psychoses.${i}" value="${escAttr(v)}" aria-label="${escAttr(t('mg.col.psychoses'))}"></div>`).join('');
  const health = MG_HEALTH.map(k => `<div class="v20-health-row ww-health-row"><span class="v20-health-name">${escHtml(t('mg.hl.' + k))}</span><span class="v20-health-pen">${MG_HEALTH_PEN[k]}</span>${_mgHealthCell(k, m.health[k])}</div>`).join('');
  const legend = `<div class="ww-health-legend">${MG_DAMAGE.slice(1).map(d => `<span>${MG_DAMAGE_MARK[d]} ${escHtml(t('mg.dmg.' + d))}</span>`).join('')}</div>`;

  return `
    ${header}
    <div class="v20-band">${escHtml(t('mg.band.attrs'))}</div>
    <div class="v20-grid3">${attrCol('physical')}${attrCol('social')}${attrCol('mental')}</div>
    <div class="v20-band">${escHtml(t('mg.band.abilities'))}</div>
    <div class="v20-grid3">${abCol('talents')}${abCol('skills')}${abCol('knowledges')}</div>
    <div class="v20-band">${escHtml(t('mg.band.spheres'))}</div>
    <div class="v20-grid3">${MG_SPHERE_COLS.map(sphereCol).join('')}</div>
    <div class="v20-band">${escHtml(t('mg.band.advantages'))}</div>
    <div class="v20-grid3 v20-bottom">
      <div class="v20-col">
        <div class="v20-col-title">${escHtml(t('mg.col.meritsFlaws'))}${_mgAddBtn('meritsFlaws')}</div>${merits}
        <div class="v20-col-title ww-gap">${escHtml(t('mg.col.backgrounds'))}${_mgAddBtn('backgrounds')}</div>${bgs}
      </div>
      <div class="v20-col">
        <div class="v20-stat-block v20-stat-block--centered">
          <div class="v20-stat-title">${escHtml(t('mg.willpower'))}</div>
          ${_v20DotsHtml('willpower.permanent', m.willpower.permanent, MG_MAX_TRAIT)}
          ${_v20BoxesHtml('willpower.temp', m.willpower.temp)}
        </div>
        <div class="v20-stat-block v20-stat-block--centered">
          <div class="v20-stat-title">${escHtml(t('mg.arete'))}</div>
          ${_v20DotsHtml('arete', m.arete, MG_MAX_TRAIT)}
        </div>
        <div class="v20-stat-block v20-stat-block--centered">
          <div class="v20-stat-title">${escHtml(t('mg.quintessence'))} / ${escHtml(t('mg.paradox'))}</div>
          ${_mgRingHtml(m.quintessence, m.paradox)}
        </div>
      </div>
      <div class="v20-col">
        <div class="v20-col-title">${escHtml(t('mg.col.psychoses'))}${_mgAddBtn('psychoses')}</div>${psych}
        <div class="v20-col-title ww-gap">${escHtml(t('mg.col.health'))}</div>
        <div class="v20-health">${health}</div>${legend}
      </div>
    </div>`;
}

function _mgRenderSheet(panel) {
  const m = _mgModel;
  panel.innerHTML = `
    <div class="cdet-sheet-toolbar">
      <button class="cdet-sheet-btn primary" id="mg-save" disabled title="${escAttr(t('v20.saveTip'))}">${t('v20.savedSheet')}</button>
      <button class="cdet-sheet-btn" id="mg-regen" title="${escAttr(t('v20.regenTip'))}">${t('v20.regenBtn')}</button>
      <span class="v20-status" id="mg-status"></span>
    </div>
    <div class="chg-budget mg-budget" id="mg-budget">${_mgBudgetHtml(m)}</div>
    <div class="v20-sheet mg-sheet">${_mgSheetHtml(m)}</div>
    <div class="v20-foot">${escHtml(t('mg.foot'))}</div>`;
  document.getElementById('mg-save').addEventListener('click', _mgSave);
  document.getElementById('mg-regen').addEventListener('click', e => _mgRegen(e.currentTarget));
  _mgBind(panel);
  if (_mgDirty) _mgMarkDirty();
}

// ── Взаимодействие ───────────────────────────────────────────────────────────
function _mgRefresh() {
  const b = document.getElementById('mg-budget');
  if (b) b.innerHTML = _mgBudgetHtml(_mgModel);
}
function _mgMarkDirty() {
  _mgDirty = true;
  _mgRev++;
  const btn = document.getElementById('mg-save'), st = document.getElementById('mg-status');
  if (btn) { btn.disabled = false; btn.textContent = t('v20.btnSaveSheet'); }
  if (st) { st.textContent = t('v20.unsaved'); st.className = 'v20-status dirty'; }
}
function _mgRerender() {
  _mgDirty = true;
  _mgRenderSheet(document.getElementById('cdet-sheet-panel'));
}
function _mgAddRow(path) {
  const arr = _v20Get(_mgModel, path);
  if (!Array.isArray(arr)) return;
  if (path === 'meritsFlaws') arr.push({ name: '', points: '' });
  else if (path === 'psychoses') arr.push('');
  else arr.push(_mgRated());
  _mgRerender();
}
function _mgRemoveRow(path, idx) {
  const arr = _v20Get(_mgModel, path);
  if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return;
  arr.splice(idx, 1);
  _mgRerender();
}
// Клик по клетке кольца (Квинтэссенция растёт слева, Парадокс — справа, сумма ≤ 20):
// клетка внутри заполненной стороны — эта сторона обрезается до клетки (крайняя — снимается);
// пустая клетка — продлевает ту сторону, к краю которой она ближе.
function _mgRingClick(m, i) {
  const pStart = MG_RING - m.paradox;          // первая клетка Парадокса
  let side;
  if (i < m.quintessence) side = 'q';
  else if (i >= pStart) side = 'p';
  else side = (i - m.quintessence) <= (pStart - 1 - i) ? 'q' : 'p';
  if (side === 'q') {
    const nv = (m.quintessence === i + 1) ? i : i + 1;
    if (nv + m.paradox > MG_RING) return false;
    m.quintessence = nv;
  } else {
    const fromRight = MG_RING - i;
    const nv = (m.paradox === fromRight) ? fromRight - 1 : fromRight;
    if (m.quintessence + nv > MG_RING) return false;
    m.paradox = nv;
  }
  return true;
}

function _mgBind(panel) {
  if (panel._mgBound) return;
  panel._mgBound = true;
  const isMage = () => _mgModel && document.querySelector('#cdet-sheet-panel .mg-sheet');

  const onDot = dot => {
    const span = dot.closest('.v20-dots'); if (!span) return;
    const dpath = span.dataset.dpath, d = +dot.dataset.d;
    const cur = _v20Get(_mgModel, dpath) || 0;
    const min = dpath.startsWith('attributes.') ? 1 : 0;
    const nv = Math.max(min, (cur === d) ? d - 1 : d);
    _v20Set(_mgModel, dpath, nv);
    if (dpath === 'arete' || dpath.startsWith('spheres.')) { _mgRerender(); _mgMarkDirty(); return; }
    _v20RebuildDots(span, nv);
    span.classList.toggle('chg-over', dpath.startsWith('abilities.') && nv > MG_ABIL_CAP);
    _mgRefresh();
    _mgMarkDirty();
  };
  const onBox = box => {
    const wrap = box.closest('.v20-boxes'); if (!wrap) return;
    const bpath = box.dataset.bpath, i = +box.dataset.i;
    const arr = _v20Get(_mgModel, bpath) || [];
    const cur = arr.filter(Boolean).length, d = i + 1;
    const nvArr = _mgFlags(null, arr.length).map((_, k) => k < ((cur === d) ? d - 1 : d));
    _v20Set(_mgModel, bpath, nvArr);
    _v20RebuildBoxes(wrap, nvArr);
    _mgMarkDirty();
  };
  const onHealth = cell => {
    const k = cell.dataset.mgHealth;
    const nv = MG_DAMAGE[(MG_DAMAGE.indexOf(_mgModel.health[k] || '') + 1) % MG_DAMAGE.length];
    _mgModel.health[k] = nv;
    cell.outerHTML = _mgHealthCell(k, nv);
    panel.querySelector(`[data-mg-health="${k}"]`)?.focus();
    _mgMarkDirty();
  };
  const onRing = cell => {
    const i = +cell.dataset.mgRing;
    if (!_mgRingClick(_mgModel, i)) return;
    const ring = cell.closest('.mg-ring');
    ring.querySelectorAll('[data-mg-ring]').forEach(c => {
      const k = +c.dataset.mgRing;
      c.classList.toggle('mg-ring-q', k < _mgModel.quintessence);
      c.classList.toggle('mg-ring-p', k >= MG_RING - _mgModel.paradox);
    });
    const q = document.getElementById('mg-q'), p = document.getElementById('mg-p');
    if (q) q.textContent = _mgModel.quintessence;
    if (p) p.textContent = _mgModel.paradox;
    _mgRefresh();
    _mgMarkDirty();
  };

  panel.addEventListener('click', e => {
    if (!isMage()) return;
    const hc = e.target.closest('[data-mg-health]'); if (hc) { onHealth(hc); return; }
    const rc = e.target.closest('[data-mg-ring]'); if (rc) { onRing(rc); return; }
    const dot = e.target.closest('.v20-dot'); if (dot) { onDot(dot); return; }
    const box = e.target.closest('.v20-box'); if (box && box.dataset.i !== undefined) { onBox(box); return; }
    const add = e.target.closest('[data-mg-add]'); if (add) { _mgAddRow(add.dataset.mgAdd); return; }
    const rm = e.target.closest('[data-mg-remove]'); if (rm) { _mgRemoveRow(rm.dataset.mgRemove, +rm.dataset.mgIdx); return; }
  });
  panel.addEventListener('keydown', e => {
    if (!isMage() || (e.key !== 'Enter' && e.key !== ' ')) return;
    const dot = e.target.closest('.v20-dot');
    if (dot) { e.preventDefault(); onDot(dot); return; }
    const box = e.target.closest('.v20-box');
    if (box && box.dataset.i !== undefined) { e.preventDefault(); onBox(box); }
  });
  panel.addEventListener('change', e => {
    if (!isMage()) return;
    const sel = e.target.closest('[data-mg-affinity]');
    if (sel) { _mgModel.affinity = sel.value; _mgRerender(); _mgMarkDirty(); }
  });
  panel.addEventListener('input', e => {
    if (!isMage()) return;
    const f = e.target.closest('[data-tpath]'); if (!f) return;
    let val = f.value;
    if (f.hasAttribute('data-mg-exp')) {
      val = _mgInt(val, 99999);
      const xp = _mgModel.experience;
      const total = f.dataset.tpath === 'experience.total' ? val : xp.total;
      const spent = f.dataset.tpath === 'experience.spent' ? val : xp.spent;
      const rem = document.getElementById('mg-xp-remain');
      if (rem) rem.textContent = total - spent;
    }
    _v20Set(_mgModel, f.dataset.tpath, val);
    if (f.hasAttribute('data-mg-ref') || f.dataset.tpath.startsWith('backgrounds.') || f.dataset.tpath.startsWith('meritsFlaws.')) _mgRefresh();
    _mgMarkDirty();
  });
}

async function _mgSave() {
  const btn = document.getElementById('mg-save'), st = document.getElementById('mg-status');
  btn.disabled = true; const old = btn.textContent; btn.textContent = t('v20.saving');
  const rev = _mgRev, ctx = _mgCtx, body = JSON.stringify({ data: _mgModel });
  try {
    const r = await fetch(`/api/characters/${encodeURIComponent(ctx.slug)}/sheet-data${location.search}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }).then(r => r.json());
    if (!r.ok) throw new Error(r.error || t('v20.errGeneric'));
    if (_mgCtx !== ctx) return;
    if (rev !== _mgRev) { _mgMarkDirty(); return; }
    _mgDirty = false;
    btn.textContent = t('v20.savedSheet'); btn.disabled = true;
    if (st) { st.textContent = t('v20.savedStatus'); st.className = 'v20-status ok'; }
  } catch (e) {
    btn.disabled = false; btn.textContent = old;
    if (st) { st.textContent = '✗ ' + e.message; st.className = 'v20-status err'; }
  }
}

async function _mgRegen(btn) {
  const msg = _mgDirty ? t('v20.regenDirty') : t('v20.regenClean');
  if (!await showConfirm(msg, { danger: _mgDirty, confirmText: t('v20.regenBtnConfirm') })) return;
  const ctx = _mgCtx;
  const stale = () => _mgCtx !== ctx;
  const old = btn.textContent; btn.disabled = true; btn.textContent = t('v20.regenLoading');
  try {
    const ok = await _generateSheet({ scope: 'character', name: ctx.name, slug: ctx.slug }, null);
    if (!ok) throw new Error(t('v20.genFailed'));
    const q = location.search ? location.search + '&fromMd=1' : '?fromMd=1';
    const d = await fetch(`/api/characters/${encodeURIComponent(ctx.slug)}/sheet-data${q}`).then(r => r.json());
    if (stale()) return;
    _mgModel = _mgParseMd(d.md || '', _mgSeedHeader(ctx.card, _mgModel && _mgModel.header));
    _mgDirty = true;
    _mgRenderSheet(document.getElementById('cdet-sheet-panel'));
    await _mgSave();
  } catch (e) {
    showToast(t('v20.errPrefix', { msg: e.message }), 'error');
    if (!stale()) { btn.disabled = false; btn.textContent = old; }
  }
}

// ── Точки входа ──────────────────────────────────────────────────────────────
// Для _loadCharSheet (v20-sheet.js) и dice.js: d — ответ GET sheet-data.
async function _mgResolveModel(charSlug, card, d) {
  if (d && d.source === 'json' && d.data && d.data.schema === MG_SCHEMA) return _mgNormalize(d.data);
  let md = d && d.source === 'md' ? d.md : '';
  if (d && d.source === 'json') {
    try {
      const q = location.search ? location.search + '&fromMd=1' : '?fromMd=1';
      const r = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/sheet-data${q}`).then(x => x.json());
      if (r && r.source === 'md') md = r.md || '';
    } catch { /* нет md — пустая модель */ }
  }
  const seed = _mgSeedHeader(card, d && d.data && d.data.header);
  return md ? _mgParseMd(md, seed) : _mgNormalize({ header: seed });
}

async function _loadMageSheet(panel, charSlug, card, d) {
  if (_mgDirty && _mgCtx && _mgCtx.slug === charSlug && _mgModel) { _mgRenderSheet(panel); return; }
  const ctx = { slug: charSlug, name: (card && card.name) || charSlug, card: card || null };
  const model = await _mgResolveModel(charSlug, card, d);
  _mgCtx = ctx;
  _mgModel = model;
  _mgDirty = false;
  _mgRenderSheet(panel);
}
