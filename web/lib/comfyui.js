'use strict';
// Клиент локального ComfyUI (spec doc/design/comfyui): доступность, список моделей,
// автозапуск, профили генерации (портреты / локации), workflow txt2img, генерация → PNG-буфер,
// очистка старых кандидатов.
// Протокол — как у tools/generate_library_art.js, но картинка забирается через /view,
// а не из COMFY_DIR/output: так работает и portable, и не-локальный ComfyUI.

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { llmRoot } = require('./llamacpp/paths');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8188';
// Модель по умолчанию, если не выбрана в профиле (profiles-spec §4.3). Портреты: Juggernaut XL
// понимает описания обычным языком (так пишет генератор промтов), Illustrious — чекпоинт CLI-скриптов.
// Локации: RealVisXL чище держит архитектуру и прямые линии.
const PREFERRED_CKPTS = {
  character: [/juggernaut/i, /illustriousRealism/i],
  location: [/realvis/i, /juggernaut/i],
};
const KIND_LIST = ['character', 'location'];
const MAX_LORAS = 4;
const NAME_MAX = 260;
// Параметры сэмплера и добавка в негатив по виду сущности (profiles-spec §4.3).
const KIND_PARAMS = {
  character: { steps: 32, cfg: 6.5, sampler: 'dpmpp_2m', scheduler: 'karras', negative: [] },
  // Негатив локаций усилен словами (location-upscale FR8): SD 1.5-эмбеддинги вроде easynegative
  // ([8, 768]) под SDXL не работают — у него два энкодера, 768 и 1280.
  location: { steps: 30, cfg: 5.5, sampler: 'dpmpp_2m', scheduler: 'karras',
    negative: ['text', 'watermark', 'signature', 'close-up portrait',
      'blurry', 'low resolution', 'jpeg artifacts', 'oversaturated', 'deformed architecture'] },
};
// «Детализация» локаций: второй проход — латент ×1.5 и досэмплирование (profiles-spec FR7).
const DETAIL = { scale: 1.5, steps: 14, denoise: 0.5 };
// Финальный апскейл локаций и районов (spec doc/design/location-upscale-2026-11-17 FR1): картинка
// после VAE идёт через апскейл-модель (ESRGAN — не досочиняет содержимое и держит прямые линии) и
// уменьшается lanczos'ом до ×2 кадра первого прохода, одинаково с «Детализацией» и без неё.
const IMG_UPSCALE = { targetScale: 2, method: 'lanczos' };
// Модели, обученные на тегах Danbooru: пол понимают по 1boy/1girl, а не по словам в описании.
const TAG_MODEL_RE = /illustrious|pony|noob/i;
const DEFAULT_LORA_STRENGTH = 0.4;
const CANDIDATES_DIR = '_candidates';
const CANDIDATE_RE = /^candidate_\d+\.png$/;
const READY_WAIT_MS = 90_000;
const GENERATE_WAIT_MS = 10 * 60_000;   // первая генерация грузит SDXL в VRAM — минуты
const POLL_MS = Number(process.env.COMFYUI_POLL_MS) || 1500;
// Таймаут одного запроса к ComfyUI внутри generate (Б25). Сам ComfyUI отвечает на /prompt и /history
// сразу — считает он в отдельном потоке; молчание дольше таймаута значит, что он завис или упал.
const REQUEST_TIMEOUT_MS = Number(process.env.COMFYUI_REQUEST_TIMEOUT_MS) || 15_000;
const MAX_SILENT_POLLS = 4;                        // опросов /history подряд без ответа → ошибка задания
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const noop = () => {};

// Процесс ComfyUI, поднятый автозапуском этого приложения. Только его закрываем после генерации
// (spec FR9): ComfyUI, запущенный пользователем, не трогаем.
let launched = null;   // { pid, baseUrl }

// Связь с ComfyUI — из .env; чем рисовать (модель, LoRA) — профили в LLM/comfyui.json.
function config() {
  return {
    baseUrl: String(process.env.COMFYUI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    dir: String(process.env.COMFYUI_DIR || '').trim(),
  };
}

function loraStrengthOf(v) {
  const n = Number(String(v ?? '').trim().replace(',', '.'));
  return String(v ?? '').trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 2 ? n : DEFAULT_LORA_STRENGTH;
}

class ComfyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ── Профили генерации (profiles-spec §4.1): { character: {ckpt, loras[]}, location: {ckpt, loras[], detail} } ──
// Файл рядом с настройками llama.cpp — вне git, релиза и бэкапа. Читается при каждом обращении:
// сохранённое применяется без перезапуска.
const profilesPath = () => process.env.COMFYUI_CONFIG || path.join(llmRoot(), 'comfyui.json');
const emptyProfile = kind => kind === 'location' ? { ckpt: '', loras: [], detail: false } : { ckpt: '', loras: [] };
const _isName = v => typeof v === 'string' && v.length <= NAME_MAX && !/[\r\n]/.test(v);

// Мягкое чтение: негодное значение в файле заменяется дефолтом, а не роняет генерацию.
function _readProfile(raw, kind) {
  const p = emptyProfile(kind);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return p;
  if (_isName(raw.ckpt)) p.ckpt = raw.ckpt.trim();
  const seen = new Set();
  for (const l of Array.isArray(raw.loras) ? raw.loras : []) {
    if (!l || !_isName(l.name) || !l.name.trim() || seen.has(l.name.trim()) || p.loras.length >= MAX_LORAS) continue;
    seen.add(l.name.trim());
    p.loras.push({ name: l.name.trim(), strength: loraStrengthOf(l.strength), trigger: _isName(l.trigger) ? l.trigger.trim() : '' });
  }
  if (kind === 'location') p.detail = raw.detail === true;
  return p;
}

// Профили до появления файла — из старых настроек .env (profiles-spec FR8): модель — в оба профиля,
// LoRA — только портретам (она подбиралась под персонажей).
function _legacyProfiles() {
  const ckpt = String(process.env.COMFYUI_CKPT || '').trim();
  const lora = String(process.env.COMFYUI_LORA || '').trim();
  return {
    character: { ckpt, loras: lora ? [{ name: lora, strength: loraStrengthOf(process.env.COMFYUI_LORA_STRENGTH),
      trigger: String(process.env.COMFYUI_LORA_TRIGGER || '').trim() }] : [] },
    location: { ckpt, loras: [], detail: false },
  };
}

async function loadProfiles() {
  let raw;
  try { raw = await fs.readFile(profilesPath(), 'utf8'); }
  catch { return _legacyProfiles(); }
  try {
    const j = JSON.parse(raw);
    const src = j && typeof j.profiles === 'object' && j.profiles ? j.profiles : {};
    return { character: _readProfile(src.character, 'character'), location: _readProfile(src.location, 'location') };
  } catch (e) {
    console.warn(`[comfyui] ${profilesPath()} повреждён (${e.message}) — используются настройки по умолчанию`);
    return { character: emptyProfile('character'), location: emptyProfile('location') };
  }
}

// Строгая проверка профиля из запроса: ошибка — ComfyError 400 с текстом для человека.
// Модель и LoRA, которых сейчас нет в списках, допустимы: ComfyUI может быть выключен.
function validateProfile(raw, kind) {
  const label = kind === 'location' ? 'Изображения локаций' : 'Портреты персонажей';
  const bad = msg => new ComfyError(400, `${label}: ${msg}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('ожидается объект профиля.');
  const ckpt = raw.ckpt == null ? '' : raw.ckpt;
  if (!_isName(ckpt)) throw bad(`модель — строка до ${NAME_MAX} символов без переводов строки.`);
  const loras = raw.loras == null ? [] : raw.loras;
  if (!Array.isArray(loras)) throw bad('loras — ожидается список.');
  if (loras.length > MAX_LORAS) throw bad(`не больше ${MAX_LORAS} LoRA.`);
  const out = { ckpt: ckpt.trim(), loras: [] };
  const seen = new Set();
  loras.forEach((l, i) => {
    const n = i + 1;
    if (!l || typeof l !== 'object' || !_isName(l.name) || !l.name.trim()) throw bad(`LoRA ${n}: выбери файл.`);
    const name = l.name.trim();
    if (seen.has(name)) throw bad(`LoRA «${name}» добавлена дважды.`);
    seen.add(name);
    const blank = typeof l.strength === 'string' && !l.strength.trim();
    const strength = typeof l.strength === 'string' ? Number(l.strength.trim().replace(',', '.')) : l.strength;
    if (blank || typeof strength !== 'number' || !Number.isFinite(strength) || strength < 0 || strength > 2)
      throw bad(`LoRA ${n}: сила — число от 0 до 2 (например 0.4).`);
    const trigger = l.trigger == null ? '' : l.trigger;
    if (!_isName(trigger)) throw bad(`LoRA ${n}: слова-триггеры — строка до ${NAME_MAX} символов без переводов строки.`);
    out.loras.push({ name, strength, trigger: trigger.trim() });
  });
  if (kind === 'location') {
    if (raw.detail != null && typeof raw.detail !== 'boolean') throw bad('«Детализация» — true или false.');
    out.detail = raw.detail === true;
  } else if (raw.detail != null) throw bad('«Детализация» есть только у локаций.');
  return out;
}

// patch — { character?, location? }, каждый профиль целиком. Запись сериализована, tmp + rename.
let _saveChain = Promise.resolve();
function saveProfiles(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new ComfyError(400, 'Ожидается { character?, location? }.');
  const extra = Object.keys(patch).find(k => !KIND_LIST.includes(k));
  if (extra) throw new ComfyError(400, `Неизвестный профиль «${extra}».`);
  const next = {};
  for (const kind of KIND_LIST) if (patch[kind] !== undefined) next[kind] = validateProfile(patch[kind], kind);
  const run = _saveChain.then(async () => {
    const profiles = { ...await loadProfiles(), ...next };
    const file = profilesPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file + '.tmp', JSON.stringify({ profiles }, null, 2), 'utf8');
    await fs.rename(file + '.tmp', file);
    return profiles;
  });
  _saveChain = run.catch(noop);
  return run;
}

async function isUp(baseUrl = config().baseUrl) {
  try {
    const r = await fetch(baseUrl + '/system_stats', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

// Список файлов из описания узла ComfyUI (`/object_info/<Node>` → input.required.<field>[0]).
async function _nodeOptions(baseUrl, node, field, what) {
  const r = await fetch(baseUrl + '/object_info/' + node, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new ComfyError(502, `ComfyUI не отдал список ${what} (HTTP ${r.status})`);
  const d = await r.json();
  const names = d?.[node]?.input?.required?.[field]?.[0];
  return Array.isArray(names) ? names.filter(n => typeof n === 'string') : [];
}
const listCheckpoints = (baseUrl = config().baseUrl) => _nodeOptions(baseUrl, 'CheckpointLoaderSimple', 'ckpt_name', 'моделей');
// Старый/урезанный ComfyUI без LoraLoader — просто пустой список, не ошибка.
const listLoras = (baseUrl = config().baseUrl) => _nodeOptions(baseUrl, 'LoraLoader', 'lora_name', 'LoRA').catch(() => []);
// Апскейл-модели (models/upscale_models). Нет узла или список пуст — генерация идёт без финального
// апскейла (location-upscale FR3), а не падает.
const listUpscalers = (baseUrl = config().baseUrl) =>
  _nodeOptions(baseUrl, 'UpscaleModelLoader', 'model_name', 'апскейл-моделей').catch(() => []);

// Список моделей с диска, когда ComfyUI не запущен (он закрывается после генерации — spec FR9):
// <dir>/models/<sub> (git) или <dir>/ComfyUI/models/<sub> (portable). Пути — как у ComfyUI:
// относительно папки, разделитель ОС. extra_model_paths.yaml не учитывается.
const MODEL_EXT_RE = /\.(safetensors|ckpt|pt|pth|bin|gguf)$/i;
function _modelsRoot(dir, sub) {
  if (!dir) return null;
  return [path.join(dir, 'models', sub), path.join(dir, 'ComfyUI', 'models', sub)].find(r => fsSync.existsSync(r)) || null;
}

async function listLocalModels(dir, sub) {
  const root = _modelsRoot(dir, sub);
  if (!root) return [];
  const out = [];
  async function walk(d, depth) {
    if (depth > 6) return;
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (MODEL_EXT_RE.test(e.name)) out.push(path.relative(root, p));
    }
  }
  await walk(root, 0);
  return out.sort((a, b) => a.localeCompare(b));
}

function pickCheckpoint(list, configured, kind = 'character') {
  if (configured && list.includes(configured)) return configured;
  for (const re of PREFERRED_CKPTS[kind] || PREFERRED_CKPTS.character) { const hit = list.find(n => re.test(n)); if (hit) return hit; }
  // Локациям тег-модель (Illustrious/Pony) — в последнюю очередь: описания мест она понимает плохо.
  if (kind === 'location') { const plain = list.find(n => !TAG_MODEL_RE.test(n)); if (plain) return plain; }
  return list[0] || '';
}

// Апскейл-модель для финального прохода (location-upscale FR2): UltraSharp → любая 4x → первая.
// Имя файла жёстко не прошито — у другого пользователя набор моделей свой.
function pickUpscaler(list) {
  for (const re of [/ultrasharp/i, /^4x/i]) { const hit = list.find(n => re.test(n)); if (hit) return hit; }
  // Фолбэк «первая попавшаяся» мог взять модель с огромным НАТИВНЫМ множителем (8x/16x):
  // апскейл идёт до уменьшения до цели, и промежуточный кадр раздувается в разы (8x поверх
  // «Детализации» — около 149 МП, гарантированная нехватка VRAM). Сначала — та, что такого
  // множителя не заявляет; имя папки не считаем (ESRGAN\8x_foo — смотрим только имя файла).
  const modest = list.find(n => !/(^|[^\d])(8|16|32)x/i.test(String(n).split(/[\\/]/).pop()));
  return modest || list[0] || '';
}

// ── Архитектура чекпоинта и LoRA (spec FR12): LoRA другой архитектуры ComfyUI молча игнорирует ──
// Чекпоинты нашего workflow — SDXL-семейство (SDXL, Illustrious, Pony); SD 1.5 — по имени/папке.
const ckptArch = name => /sd[ _-]?1\.?5|sd15|\bsd1\b/i.test(name || '') ? 'sd15' : 'sdxl';

// По заголовку safetensors: метаданные kohya/modelspec, затем имена весов. null — не определить.
function loraArchFromHeader(header) {
  const meta = header.__metadata__ || {};
  const tag = String(meta.ss_base_model_version || meta['modelspec.architecture'] || '').toLowerCase();
  if (tag) {
    if (tag.includes('sdxl') || tag.includes('stable-diffusion-xl')) return 'sdxl';
    if (tag.startsWith('sd_v1') || tag.startsWith('sd_v2') || tag.includes('stable-diffusion-v1')) return 'sd15';
    if (tag.includes('flux')) return 'flux';
    return 'other';
  }
  const keys = Object.keys(header).filter(k => k !== '__metadata__');
  const any = re => keys.some(k => re.test(k));
  if (any(/double_blocks|single_blocks|single_transformer_blocks/)) return 'flux';
  if (any(/^diffusion_model\.blocks\.|^transformer\.(text_fusion|layers)\./)) return 'other';
  if (any(/lora_te2_|text_encoder_2|input_blocks_\d+_1_transformer_blocks_[1-9]/)) return 'sdxl';
  if (any(/lora_te_text_model|down_blocks_\d+_attentions/)) return 'sd15';
  if (any(/lora_unet_input_blocks_[4578]_1/)) return 'sdxl';
  return null;
}

// Заголовок читается один раз на файл: кэш по пути, размеру и времени изменения (настройки
// спрашивают архитектуру всех LoRA при каждом открытии).
const _loraArchCache = new Map();   // file → { key: 'size:mtimeMs', arch }
async function loraArch(dir, name) {
  const root = _modelsRoot(dir, 'loras');
  if (!root || !name) return null;
  const file = path.resolve(root, name);
  if (!file.startsWith(path.resolve(root) + path.sep)) return null;
  const st = await fs.stat(file).catch(() => null);
  if (!st) { _loraArchCache.delete(file); return null; }
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = _loraArchCache.get(file);
  if (hit && hit.key === key) return hit.arch;
  const arch = await _readLoraArch(file);
  _loraArchCache.set(file, { key, arch });
  return arch;
}
async function _readLoraArch(file) {
  let fh;
  try {
    fh = await fs.open(file, 'r');
    const lenBuf = Buffer.alloc(8);
    await fh.read(lenBuf, 0, 8, 0);
    const len = Number(lenBuf.readBigUInt64LE(0));
    if (!(len > 0 && len < 64 * 1024 * 1024)) return null;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 8);
    return loraArchFromHeader(JSON.parse(buf.toString('utf8')));
  } catch { return null; } finally { await fh?.close().catch(noop); }
}
const loraCompatible = (arch, ckpt) => arch == null || arch === ckptArch(ckpt);
// Сведения о чекпоинте для интерфейса — чтобы клиент не дублировал правила по имени файла.
const ckptInfo = name => ({ arch: ckptArch(name), tags: TAG_MODEL_RE.test(name || '') });
const ARCH_LABEL = { sdxl: 'SDXL', sd15: 'SD 1.5', flux: 'Flux', other: 'другой архитектуры (видео / Krea / Z-Image)' };

// ── Размер кадра (spec FR14): SDXL рисует без дублей около 1 Мп — набор проверенных размеров ──
const SIZE_PRESETS = [
  { id: 'portrait', width: 832, height: 1216 },
  { id: 'tall', width: 768, height: 1344 },
  { id: 'portrait45', width: 896, height: 1152 },
  { id: 'square', width: 1024, height: 1024 },
  { id: 'landscape54', width: 1152, height: 896 },
  { id: 'landscape', width: 1216, height: 832 },
  { id: 'wide', width: 1344, height: 768 },
];
const SIZE_IN_PROMPT_RE = /(?:,\s*)?\b(\d{3,4})\s*[x×х]\s*(\d{3,4})\b(?:\s*px)?/gi;

// «1023x1537» из промта (генератор промтов пишет размер текстом) → { width, height } или null.
function promptSize(text) {
  const m = [...String(text || '').matchAll(SIZE_IN_PROMPT_RE)].pop();
  if (!m) return null;
  const width = Number(m[1]), height = Number(m[2]);
  return width >= 256 && height >= 256 && width <= 4096 && height <= 4096 ? { width, height } : null;
}
// Ближайший пресет по пропорции.
function fitPreset({ width, height }) {
  const r = Math.log(width / height);
  return SIZE_PRESETS.reduce((best, p) => Math.abs(Math.log(p.width / p.height) - r) < Math.abs(Math.log(best.width / best.height) - r) ? p : best);
}
const stripSizeText = text => String(text || '').replace(SIZE_IN_PROMPT_RE, '').replace(/[ \t]+\n/g, '\n').trim();

// ── Пол персонажа (spec FR13): тег-моделям (Illustrious/Pony) — теги Danbooru, остальным — словами ──
function genderHints(ckpt, gender) {
  const g = String(gender || '').toLowerCase();
  const sex = g.startsWith('мужск') || g.startsWith('male') ? 'm'
    : g.startsWith('женск') || g.startsWith('female') ? 'f'
    : g.startsWith('неизвест') || g.startsWith('unknown') ? 'x' : null;
  if (!sex) return null;
  const style = TAG_MODEL_RE.test(ckpt || '') ? 'tags' : 'words';
  return { style, ...GENDER_HINTS[style][sex] };
}
const GENDER_HINTS = {
  tags: {
    m: { positive: '1boy, solo, male focus', negative: '1girl, woman, female' },
    f: { positive: '1girl, solo', negative: '1boy, man, male, beard' },
    x: { positive: 'solo, androgynous', negative: 'lipstick, makeup, cleavage, breasts, beard' },
  },
  words: {
    m: { positive: 'a man, masculine face', negative: 'woman, female, feminine, makeup, lipstick' },
    f: { positive: 'a woman', negative: 'man, male, beard, mustache' },
    x: { positive: 'androgynous person, gender-neutral face, ambiguous features', negative: 'lipstick, makeup, cleavage, breasts, beard, mustache' },
  },
};

// Итоговые промты для ComfyUI: триггеры применённых LoRA (в порядке списка) и подсказки пола —
// в начало, размер-текст убран; локациям в негатив — добавка вида (то, чего ещё нет в негативе карточки).
// Текст карточки не меняется.
function composePrompts({ positive, negative, gender, kind }, ckpt, loras = []) {
  const hints = kind === 'character' ? genderHints(ckpt, gender) : null;
  const join = (...parts) => parts.map(s => String(s || '').trim()).filter(Boolean).join(', ');
  // Целым словом: «texture» или «context» в негативе карточки — ещё не «text».
  const has = String(negative || '').toLowerCase();
  const extra = (KIND_PARAMS[kind] || KIND_PARAMS.character).negative.filter(w => !new RegExp(`\\b${w}\\b`).test(has));
  return {
    positive: join(...loras.map(l => l.trigger), hints && hints.positive, stripSizeText(positive)),
    negative: join(hints && hints.negative, negative, extra.join(', ')),
    gender: hints ? hints.style : null,
  };
}

// Команда запуска по раскладке папки: git-установка (venv) или portable-сборка.
function launchCommand(dir) {
  const git = { py: path.join(dir, 'venv', 'Scripts', 'python.exe'), main: path.join(dir, 'main.py'), cwd: dir };
  const portable = { py: path.join(dir, 'python_embeded', 'python.exe'), main: path.join(dir, 'ComfyUI', 'main.py'), cwd: path.join(dir, 'ComfyUI') };
  for (const c of [git, portable]) if (fsSync.existsSync(c.py) && fsSync.existsSync(c.main)) return c;
  return null;
}

function isLocalUrl(baseUrl) {
  try { return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(baseUrl).hostname); }
  catch { return false; }
}

// Почему недоступный ComfyUI нельзя поднять автозапуском ('' — можно). Проверяется до создания
// задания, чтобы заведомый отказ пришёл сразу ответом 503, а не ошибкой задания.
function autostartProblem(cfg = config()) {
  if (!cfg.dir) return `ComfyUI недоступен на ${cfg.baseUrl}. Запусти его или укажи папку ComfyUI для автозапуска во вкладке «Подключение AI».`;
  if (!isLocalUrl(cfg.baseUrl)) return `ComfyUI недоступен на ${cfg.baseUrl}. Автозапуск работает только для локального адреса (127.0.0.1 / localhost).`;
  if (!launchCommand(cfg.dir)) return `Не найден запуск ComfyUI в папке «${cfg.dir}»: нужен venv\\Scripts\\python.exe с main.py или portable python_embeded\\python.exe с ComfyUI\\main.py.`;
  return '';
}

// true — ComfyUI поднят сейчас автозапуском, false — уже работал.
async function ensureRunning(cfg = config(), { waitMs = READY_WAIT_MS, isCancelled = () => false } = {}) {
  if (await isUp(cfg.baseUrl)) return false;
  const problem = autostartProblem(cfg);
  if (problem) throw new ComfyError(503, problem);
  const cmd = launchCommand(cfg.dir);
  const port = new URL(cfg.baseUrl).port || '8188';
  const proc = spawn(cmd.py, [cmd.main, '--listen', '127.0.0.1', '--port', port],
    { cwd: cmd.cwd, detached: true, stdio: 'ignore', windowsHide: true });
  proc.on('error', noop);
  proc.unref();
  if (proc.pid) launched = { pid: proc.pid, baseUrl: cfg.baseUrl };
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await sleep(2000);
    if (isCancelled()) { await stopLaunched(); throw new ComfyError(499, 'Генерация отменена'); }
    if (await isUp(cfg.baseUrl)) return true;
  }
  await stopLaunched();
  throw new ComfyError(503, `ComfyUI запущен из «${cfg.dir}», но не ответил за ${Math.round(waitMs / 1000)} с. Проверь его окно или журнал.`);
}

// Закрыть ComfyUI, поднятый автозапуском, вместе с дочерними процессами — освобождает VRAM (spec FR9).
// false — закрывать нечего: не запускали или ComfyUI запущен пользователем.
async function stopLaunched() {
  if (!launched) return false;
  const { pid } = launched;
  launched = null;
  await new Promise(resolve => {
    if (process.platform === 'win32') {
      const p = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      p.on('exit', resolve); p.on('error', resolve);
    } else {
      try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* уже вышел */ } }
      resolve();
    }
  });
  return true;
}
// То же синхронно — для process.on('exit') и перезапуска сервера: там асинхронный taskkill не успеет (Б25).
// Точка подмены для тестов — _hooks.spawnSync.
const _hooks = { spawnSync, setLaunched: v => { launched = v; } };
function stopLaunchedSync() {
  if (!launched) return false;
  const { pid } = launched;
  launched = null;
  if (process.platform === 'win32') _hooks.spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else { try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* уже вышел */ } } }
  return true;
}
const launchedByApp = () => !!launched;

// Узлы: 4 чекпоинт → 10…13 цепочка LoraLoader (loras — [{ name, strength }], до MAX_LORAS) → 3 сэмплер
// и оба CLIPTextEncode. detail ({ scale, steps, denoise }) — второй проход: 20 LatentUpscaleBy → 21 KSampler,
// декодируется его латент. Только штатные узлы ComfyUI (profiles-spec §4.2).
const LORA_NODE_BASE = 10, UPSCALE_NODE = '20', REFINE_NODE = '21';
// Финальный апскейл изображения (location-upscale §7.1): загрузчик модели, апскейл, уменьшение до цели.
const UPSCALER_NODE = '30', IMG_UPSCALE_NODE = '31', IMG_SCALE_NODE = '32', IMG_PRE_SCALE_NODE = '33';
// upscale — { model, width, height, method } либо null: узлы 30–32 добавляются только при нём (FR3/FR6).
function buildWorkflow({ positive, negative, width, height, ckpt, loras = [], params = KIND_PARAMS.character, detail = null, upscale = null, prefix = 'sanguine_card' }) {
  const wf = { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } } };
  let model = ['4', 0], clip = ['4', 1];
  loras.slice(0, MAX_LORAS).forEach((l, i) => {
    const id = String(LORA_NODE_BASE + i);
    wf[id] = { class_type: 'LoraLoader', inputs: { model, clip, lora_name: l.name, strength_model: l.strength, strength_clip: l.strength } };
    model = [id, 0]; clip = [id, 1];
  });
  const sampler = { seed: Math.floor(Math.random() * 1e9), cfg: params.cfg, sampler_name: params.sampler, scheduler: params.scheduler,
    model, positive: ['6', 0], negative: ['7', 0] };
  Object.assign(wf, {
    '3': { class_type: 'KSampler', inputs: { ...sampler, steps: params.steps, denoise: 1.0, latent_image: ['5', 0] } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: positive, clip } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: negative || '', clip } },
    '8': { class_type: 'VAEDecode', inputs: { samples: [detail ? REFINE_NODE : '3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: prefix, images: [upscale ? IMG_SCALE_NODE : '8', 0] } },
  });
  if (detail) {
    wf[UPSCALE_NODE] = { class_type: 'LatentUpscaleBy', inputs: { samples: ['3', 0], upscale_method: 'bislerp', scale_by: detail.scale } };
    wf[REFINE_NODE] = { class_type: 'KSampler', inputs: { ...sampler, steps: detail.steps, denoise: detail.denoise, latent_image: [UPSCALE_NODE, 0] } };
  }
  // Вход апскейла — картинка из VAEDecode, но при «Детализации» её сначала возвращают к размеру
  // первого прохода (upscale.pre). Апскейл-модель работает в СВОЁМ нативном множителе, а не до цели:
  // без этого промежуточный кадр раздувался бы ещё и в detail.scale² по площади (4x поверх ×1.5 —
  // около 37 МП вместо 16 МП). Детали второго прохода при уменьшении не теряются — это суперсэмплинг,
  // а итоговый размер и так считается от кадра первого прохода.
  if (upscale) {
    wf[UPSCALER_NODE] = { class_type: 'UpscaleModelLoader', inputs: { model_name: upscale.model } };
    let upscaleSrc = ['8', 0];
    if (upscale.pre) {
      wf[IMG_PRE_SCALE_NODE] = { class_type: 'ImageScale',
        inputs: { image: ['8', 0], upscale_method: upscale.method, width: upscale.pre.width, height: upscale.pre.height, crop: 'disabled' } };
      upscaleSrc = [IMG_PRE_SCALE_NODE, 0];
    }
    wf[IMG_UPSCALE_NODE] = { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: [UPSCALER_NODE, 0], image: upscaleSrc } };
    wf[IMG_SCALE_NODE] = { class_type: 'ImageScale',
      inputs: { image: [IMG_UPSCALE_NODE, 0], upscale_method: upscale.method, width: upscale.width, height: upscale.height, crop: 'disabled' } };
  }
  return wf;
}

// Прогресс по шагам ComfyUI отдаёт только через WebSocket; нет его (старый ComfyUI, фейк в тестах) —
// генерация всё равно завершится по опросу /history, просто без шагов.
function _openProgressSocket(baseUrl, clientId, onMessage) {
  if (typeof WebSocket !== 'function') return null;
  try {
    const ws = new WebSocket(baseUrl.replace(/^http/i, 'ws') + '/ws?clientId=' + encodeURIComponent(clientId));
    ws.onmessage = ev => {
      if (typeof ev.data !== 'string') return;   // бинарные кадры — превью, не нужны
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      try { onMessage(m); } catch { /* хук не должен ронять генерацию */ }
    };
    ws.onerror = noop;
    return ws;
  } catch { return null; }
}

// Узел workflow (buildWorkflow) → фаза для модалки.
const NODE_PHASE = { '4': 'loading', '5': 'loading', '6': 'loading', '7': 'loading', '10': 'loading', '11': 'loading', '12': 'loading', '13': 'loading',
  '3': 'generating', [UPSCALE_NODE]: 'refining', [REFINE_NODE]: 'refining', '8': 'decoding',
  [UPSCALER_NODE]: 'upscaling', [IMG_UPSCALE_NODE]: 'upscaling', [IMG_SCALE_NODE]: 'upscaling', [IMG_PRE_SCALE_NODE]: 'upscaling' };
// Узел 9 (SaveImage) фазу не меняет: при апскейле он идёт после узлов 30–32, и прежнее
// отображение '9' → decoding откатывало этап модалки назад. Фазу «Сохранение» ставит роутер.
const PHASE_LOG = { loading: 'Загрузка модели и промта', generating: 'Генерация (KSampler)', refining: 'Детализация: второй проход (KSampler)',
  decoding: 'Декодирование изображения (VAE)', upscaling: 'Финальный апскейл изображения' };
const OOM_RE = /out of memory|allocation on device|\boom\b/i;

async function _cancelPrompt(baseUrl, promptId) {
  const post = (url, body) => fetch(baseUrl + url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000) }).catch(noop);
  await post('/queue', { delete: [promptId] });
  await post('/interrupt', { prompt_id: promptId });
}

// hooks: onPhase(phase), onLog(text), onProgress({ step, steps }), onInfo({ ckpt, autostarted, loras, detail, … }), isCancelled().
// Фазы: starting (автозапуск) → queued → loading → generating → refining (детализация) → decoding.
// kind выбирает профиль (модель, LoRA, детализация) и параметры сэмплера; gender — подсказки пола персонажу.
// cfg.profile — профиль вида; не передан — читается из настроек.
async function generate({ positive, negative, width, height, gender = '', kind = '' }, cfg = config(), hooks = {}) {
  const onPhase = hooks.onPhase || noop, onLog = hooks.onLog || noop, onProgress = hooks.onProgress || noop;
  const isCancelled = hooks.isCancelled || (() => false);
  const cancelled = () => new ComfyError(499, 'Генерация отменена');
  // cfg.requestTimeoutMs / cfg.pollMs — только для тестов зависшего ComfyUI.
  const reqTimeout = cfg.requestTimeoutMs || REQUEST_TIMEOUT_MS, pollMs = cfg.pollMs || POLL_MS;

  let autostarted = false;
  if (!await isUp(cfg.baseUrl)) {
    onPhase('starting');
    onLog(`ComfyUI не запущен — автозапуск из «${cfg.dir}»`);
    const t0 = Date.now();
    autostarted = await ensureRunning(cfg, { isCancelled });
    onLog(`ComfyUI запущен за ${Math.round((Date.now() - t0) / 1000)} с`);
  } else onLog(`ComfyUI доступен: ${cfg.baseUrl}`);
  if (isCancelled()) throw cancelled();

  const profKind = KIND_LIST.includes(kind) ? kind : 'character';
  const profile = cfg.profile || (await loadProfiles())[profKind];
  const params = KIND_PARAMS[profKind];
  const detail = profKind === 'location' && profile.detail ? DETAIL : null;

  const ckpt = pickCheckpoint(await listCheckpoints(cfg.baseUrl), profile.ckpt, profKind);
  if (!ckpt) throw new ComfyError(502, 'В ComfyUI нет ни одной модели (checkpoints) — положи модель в models/checkpoints и обнови список.');
  if (profile.ckpt && profile.ckpt !== ckpt) onLog(`Модель «${profile.ckpt}» не найдена в ComfyUI — взята «${ckpt}»`);
  onLog(`Модель: ${ckpt} · ${width}×${height} · ${params.sampler} ${params.scheduler}, ${params.steps} шагов, CFG ${params.cfg}`);
  // При детализации латент увеличивается, картинка после VAE выходит больше кадра первого прохода.
  const refinedW = detail ? Math.round(width * detail.scale) : width, refinedH = detail ? Math.round(height * detail.scale) : height;
  if (detail) onLog(`Детализация: второй проход ×${detail.scale} → ${refinedW}×${refinedH}, ${detail.steps} шагов`);

  // Финальный апскейл — только локации и районы (location-upscale FR1, FR6). Цель считается от кадра
  // первого прохода, а не от размера после детализации: итог одинаков с «Детализацией» и без неё.
  let upscale = null;
  if (profKind === 'location') {
    const model = pickUpscaler(await listUpscalers(cfg.baseUrl));
    if (!model) onLog('Апскейл-модели нет (models/upscale_models) — изображение без финального апскейла');
    else {
      upscale = { model, method: IMG_UPSCALE.method,
        width: Math.round(width * IMG_UPSCALE.targetScale), height: Math.round(height * IMG_UPSCALE.targetScale),
        // «Детализация» отдаёт кадр больше первого прохода — апскейл-модели он не нужен (см. buildWorkflow).
        ...(detail ? { pre: { width, height } } : {}) };
      onLog(`Финальный апскейл: ${model} → ${upscale.width}×${upscale.height}`
        + (upscale.pre ? ` (вход — кадр первого прохода ${width}×${height})` : ''));
    }
  }
  // Итоговый размер файла: после уменьшения апскейла, иначе — после детализации.
  const outWidth = upscale ? upscale.width : refinedW, outHeight = upscale ? upscale.height : refinedH;

  // LoRA профиля: нет такой у ComfyUI или другая архитектура — пропускается с записью, остальные применяются.
  const loras = [];
  if (profile.loras && profile.loras.length) {
    const known = await listLoras(cfg.baseUrl);
    for (const l of profile.loras.slice(0, MAX_LORAS)) {
      const arch = await loraArch(cfg.dir, l.name);
      if (!known.includes(l.name)) onLog(`LoRA «${l.name}» не найдена в ComfyUI — генерация без неё`);
      else if (!loraCompatible(arch, ckpt))
        onLog(`LoRA «${l.name}» — для ${ARCH_LABEL[arch] || arch}, а модель ${ARCH_LABEL[ckptArch(ckpt)]}: не подходит, генерация без неё`);
      else {
        loras.push({ name: l.name, strength: l.strength, trigger: l.trigger || '' });
        onLog(`LoRA: ${l.name} · сила ${l.strength}${l.trigger ? ` · триггер «${l.trigger}»` : ''}`);
      }
    }
  }
  const prompts = composePrompts({ positive, negative, gender, kind: profKind }, ckpt, loras);
  if (prompts.gender === 'tags') onLog('Пол из карточки — тегами (модель на тегах Illustrious/Pony)');
  else if (prompts.gender === 'words') onLog('Пол из карточки — подсказкой в начале промта');
  positive = prompts.positive; negative = prompts.negative;
  if (hooks.onInfo) hooks.onInfo({ ckpt, autostarted, loras, detail: !!detail, upscale: upscale ? upscale.model : null,
    positive, negative, width: outWidth, height: outHeight });

  const clientId = 'sanguine-' + crypto.randomUUID();
  let promptId = null, started = false, lastPhase = '', curNode = '';
  const phase = p => {
    if (p === lastPhase) return;
    lastPhase = p;
    if (PHASE_LOG[p]) onLog(PHASE_LOG[p]);
    onPhase(p);
  };
  const ws = _openProgressSocket(cfg.baseUrl, clientId, m => {
    const d = m.data || {};
    if (d.prompt_id && promptId && d.prompt_id !== promptId) return;   // чужое задание в очереди
    if (m.type === 'status') {
      const left = d.status && d.status.exec_info ? d.status.exec_info.queue_remaining : 0;
      if (promptId && !started && left > 1) phase('queued');
    } else if (m.type === 'execution_start') { started = true; phase('loading'); }
    else if (m.type === 'execution_cached' && d.nodes && d.nodes.length) onLog(`Из кэша ComfyUI: узлы ${d.nodes.join(', ')}`);
    else if (m.type === 'executing' && d.node != null) {
      started = true;
      curNode = String(d.node);
      const p = NODE_PHASE[curNode];
      if (p) phase(p);
    } else if (m.type === 'progress' && Number(d.max) > 0) {
      started = true;
      // Апскейлер шлёт свой прогресс по плиткам (tiled_scale) — это не шаги сэмплера:
      // счётчик не трогаем, иначе «шаг 44 из 44» сменился бы на «шаг 3 из 6» (location-upscale FR4).
      if (NODE_PHASE[String(d.node ?? curNode)] === 'upscaling') { phase('upscaling'); return; }
      // Шаги двух проходов — одним счётчиком: «шаг 37 из 44».
      const refining = !!detail && String(d.node ?? curNode) === REFINE_NODE;
      phase(refining ? 'refining' : 'generating');
      const value = Number(d.value) || 0, max = Number(d.max);
      onProgress(refining ? { step: params.steps + value, steps: params.steps + max }
        : { step: value, steps: max + (detail ? detail.steps : 0) });
    }
  });

  try {
    phase('loading');
    const res = await fetch(cfg.baseUrl + '/prompt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: buildWorkflow({ positive, negative, width, height, ckpt, loras, params, detail, upscale }), client_id: clientId }),
      signal: AbortSignal.timeout(reqTimeout),
    }).catch(e => { throw new ComfyError(504, 'ComfyUI не принял задание: ' + _fetchReason(e)); });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error || !data.prompt_id)
      throw new ComfyError(502, 'ComfyUI отклонил задание: ' + JSON.stringify(data.error || data.node_errors || res.status).slice(0, 300));
    promptId = data.prompt_id;
    onLog(`Задание принято ComfyUI (${promptId})`);
    const deadline = Date.now() + GENERATE_WAIT_MS;
    let silent = 0;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      if (isCancelled()) { await _cancelPrompt(cfg.baseUrl, promptId); throw cancelled(); }
      const h = await fetch(cfg.baseUrl + '/history/' + encodeURIComponent(promptId), { signal: AbortSignal.timeout(reqTimeout) })
        .then(r => r.json()).catch(() => null);
      if (!h) {
        if (++silent < MAX_SILENT_POLLS) continue;
        await _cancelPrompt(cfg.baseUrl, promptId);
        throw new ComfyError(504, 'ComfyUI перестал отвечать во время генерации. Проверь его окно или журнал.');
      }
      silent = 0;
      const entry = h[promptId];
      if (entry && entry.status && entry.status.status_str === 'error') {
        const text = JSON.stringify(entry.status.messages || entry.status);
        throw new ComfyError(502, 'Ошибка генерации в ComfyUI: ' + text.slice(0, 300)
          + (detail && OOM_RE.test(text) ? ' Не хватило видеопамяти — выключи «Детализацию» в «Назначении генераций».' : ''));
      }
      if (entry && entry.status && entry.status.completed) {
        const img = entry.outputs && entry.outputs['9'] && entry.outputs['9'].images && entry.outputs['9'].images[0];
        if (!img) throw new ComfyError(502, 'ComfyUI завершил задание без изображения');
        const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
        // Картинке — вчетверо больше времени (локация с детализацией — мегабайты); сигнал прерывает и чтение тела.
        const got = await fetch(cfg.baseUrl + '/view?' + q, { signal: AbortSignal.timeout(reqTimeout * 4) })
          .then(async v => ({ ok: v.ok, buf: Buffer.from(await v.arrayBuffer()) }))
          .catch(e => { throw new ComfyError(504, 'ComfyUI не отдал изображение: ' + _fetchReason(e)); });
        const v = got, buf = got.buf;
        if (!v.ok || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new ComfyError(502, 'ComfyUI вернул не PNG-изображение');
        onLog(`Изображение получено (${Math.round(buf.length / 1024)} КБ)`);
        return buf;
      }
    }
    await _cancelPrompt(cfg.baseUrl, promptId);
    throw new ComfyError(504, `ComfyUI не закончил генерацию за ${GENERATE_WAIT_MS / 60000} мин`);
  } finally {
    try { if (ws) ws.close(); } catch { /* уже закрыт */ }
  }
}

const _fetchReason = e => (e && (e.name === 'TimeoutError' || e.name === 'AbortError'))
  ? 'не ответил за отведённое время' : 'соединение разорвано';

// Кандидаты старше maxAgeMs удаляются (spec Р4). Обход: cities/<город>/{characters,locations}/**/art/_candidates.
async function purgeOldCandidates(citiesDir, maxAgeMs = 7 * 24 * 3600_000, now = Date.now()) {
  let removed = 0;
  async function walk(dir, depth) {
    if (depth > 6) return;
    let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === '_deleted') continue;
      const p = path.join(dir, e.name);
      if (e.name === CANDIDATES_DIR && path.basename(dir) === 'art') {
        for (const f of await fs.readdir(p).catch(() => [])) {
          if (!CANDIDATE_RE.test(f)) continue;
          const st = await fs.stat(path.join(p, f)).catch(() => null);
          if (st && now - st.mtimeMs > maxAgeMs) { await fs.unlink(path.join(p, f)).catch(() => {}); removed++; }
        }
        continue;
      }
      await walk(p, depth + 1);
    }
  }
  let cities; try { cities = await fs.readdir(citiesDir, { withFileTypes: true }); } catch { return 0; }
  for (const c of cities) {
    if (!c.isDirectory() || c.name.startsWith('_') || c.name.startsWith('.')) continue;
    for (const sub of ['characters', 'locations']) await walk(path.join(citiesDir, c.name, sub), 0);
  }
  return removed;
}

module.exports = {
  DEFAULT_BASE_URL, CANDIDATES_DIR, CANDIDATE_RE, PNG_SIGNATURE, ComfyError,
  DEFAULT_LORA_STRENGTH, MAX_LORAS, KIND_PARAMS, DETAIL, IMG_UPSCALE, config, profilesPath, loadProfiles, saveProfiles, validateProfile,
  isUp, listCheckpoints, listLoras, listUpscalers, listLocalModels, pickCheckpoint, pickUpscaler, genderHints, composePrompts,
  ckptArch, ckptInfo, loraArch, loraArchFromHeader, loraCompatible, SIZE_PRESETS, promptSize, fitPreset, stripSizeText, launchCommand, autostartProblem, ensureRunning, stopLaunched, stopLaunchedSync, launchedByApp, _hooks,
  buildWorkflow, generate, purgeOldCandidates,
};
