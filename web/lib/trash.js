'use strict';
// Слой корзин («📁 Удалённые») — единый владелец soft-delete движения:
// - раскладка корзин (Город/Персонаж/Локация/Район/Хроника/Модуль/Библиотека MD),
// - реестр происхождения `_registry.json` (lineage/хроника/модуль/дисциплина и т.п. —
//   то, что из имени корзины детерминированно не выводится),
// - сканер корзин (GET /api/trash),
// - целевые пути для restore с проверкой конфликтов (409),
// - purge (окончательное удаление).
// Точки мягкого удаления (web/routes/{characters,locations,cities,chronicles}.js,
// modules/lifecycle.js, library.js) вызывают moveToTrash() вместо ручного rename +
// ручной записи в реестр — логика не дублируется.
// Спека: doc/design/2026-09-13-trash-tab-techspec.md.

const path = require('path');
const fs   = require('fs').promises;
const {
  ROOT, CITIES_DIR, cityDir, charsDir, locsDir, chroniclesDir,
  writeFileAtomic,
} = require('./db');

const KIND = {
  CITY:      'city',
  CHARACTER: 'character',
  LOCATION:  'location',
  DISTRICT:  'district',
  CHRONICLE: 'chronicle',
  MODULE:    'module',
  LIB_MD:    'library-md',
  LIB_JSON:  'library-json',
  PROPERTY_ITEM:     'property-item',
  PROPERTY_CATEGORY: 'property-category',
};
const KINDS = new Set(Object.values(KIND));

// Каталоги MD-категорий Библиотеки (system/library/<dir>/_deleted/) и JSON-треков
// (system/library/<dir>/_deleted.json). Белые списки — пути строятся из этих имён.
const LIB_MD_DIRS  = ['disciplines', 'psychics', 'clans', 'sects', 'titles', 'rituals',
  'mortal-government', 'mortal-religious', 'mortal-crime', 'mortal-civic', 'mortal-positions',
  'ghouls', 'revenant-families', 'sabbat-rites', 'vampire-paths',
  'mage-traditions', 'mage-conventions', 'werewolf-tribes', 'werewolf-auspices', 'werewolf-breeds',
  'fairy-kiths', 'fairy-courts', 'fairy-seemings', 'fairy-houses',
  'fairy-arts', 'fairy-realms',
  'werewolf-gifts', 'werewolf-rites', 'mage-spheres', 'mage-techniques', 'mage-tarot',
  'mage-rotes', 'mage-factions', 'mage-chantries', 'mage-wonders', 'mage-worlds'];
const LIB_JSON_DIRS = ['merits', 'flaws', 'backgrounds', 'archetypes', 'essences', 'specializations'];

const REGISTRY = '_registry.json';
const LIB_MD_DIR_RE = new RegExp(`^(${LIB_MD_DIRS.join('|')})__`);

// ── Раскладка корзин ──────────────────────────────────────────────────────────

// Корзина (каталог) для kind. Для library-* возвращает корзину БЕЗ учёта dir —
// библиотека делится на под-корзины по категории (см. libBinDir).
function binDir(kind, city) {
  switch (kind) {
    case KIND.CITY:      return path.join(CITIES_DIR, '_deleted');
    case KIND.CHARACTER: return path.join(charsDir(city), '_deleted');
    case KIND.LOCATION:
    case KIND.DISTRICT:  return path.join(locsDir(city), '_deleted');
    case KIND.CHRONICLE:
    case KIND.MODULE:    return path.join(chroniclesDir(city), '_deleted');
    case KIND.LIB_MD:    return path.join(ROOT, 'system', 'library');
    case KIND.PROPERTY_ITEM: return path.join(cityDir(city), 'property', '_deleted');
    default:             throw new Error(`binDir: неизвестный kind ${kind}`);
  }
}

// Общегородские категории имущества — JSON-трек (как LIB_JSON, но единый файл):
// system/property/_deleted.json — массив удалённых категорий.
const PROPERTY_CATEGORY_BIN = path.join(ROOT, 'system', 'property', '_deleted.json');
const PROPERTY_CATEGORIES_FILE = path.join(ROOT, 'system', 'property', 'categories.json');
function propertyCategoryBinFile() { return PROPERTY_CATEGORY_BIN; }

// `system/library/mortal-crime/_deleted/` (MD) — путь к корзине конкретной категории.
function libBinDir(dir) {
  return path.join(ROOT, 'system', 'library', dir, '_deleted');
}

// `system/library/merits/_deleted.json` (JSON-трек).
function libJsonBinFile(dir) {
  return path.join(ROOT, 'system', 'library', dir, '_deleted.json');
}

// Есть ли смысл в каталоге-корзине вообще (registry вообще мог не создаться, а корзина
// пуста — каталога на диске может не быть).
function _validated(city, kind, dir) {
  if (!KINDS.has(kind)) throw Object.assign(new Error(`Неизвестный kind: ${kind}`), { status: 400 });
  if (kind === KIND.LIB_MD) {
    if (!LIB_MD_DIRS.includes(dir)) throw Object.assign(new Error(`Неизвестная категория библиотеки: ${dir}`), { status: 400 });
  }
  if (kind === KIND.LIB_JSON) {
    if (!LIB_JSON_DIRS.includes(dir)) throw Object.assign(new Error(`Неизвестная категория библиотеки: ${dir}`), { status: 400 });
  }
  if (city != null && !/^[a-z0-9_]+$/.test(city)) throw Object.assign(new Error('Недопустимый город'), { status: 400 });
  return { city, kind, dir };
}

// ── Реестр происхождения `_registry.json` ────────────────────────────────────

async function readRegistry(dir) {
  let raw;
  try { raw = await fs.readFile(path.join(dir, REGISTRY), 'utf-8'); } catch { return []; }
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(r => r && typeof r.storedName === 'string') : [];
  } catch {
    // Повреждённый реестр (= удалённые до фичи) — ключ «Негативный» N8: сканер
    // не падает, работает по имени/карточке; реестр пересоздаётся при следующей
    // записи. Сохранить битую версию нет смысла — миграция не нужна (корзины пусты).
    return [];
  }
}

async function writeRegistry(dir, records) {
  await fs.mkdir(dir, { recursive: true });
  await writeFileAtomic(path.join(dir, REGISTRY), JSON.stringify(records, null, 2) + '\n', 'utf-8');
}

// Дописать одну запись в реестр корзины (точки удаления, которые сами делают
// rename с собственным именованием storedName — персонажи/локации/города/районы).
async function appendRegistry(dir, record) {
  const records = await readRegistry(dir);
  records.push(record);
  await writeRegistry(dir, records);
}

// Каталог удаления: собственно папка/файл внутри корзины для storedName.
// Безопасность: storedName из URL/тела не может содержать разделителей пути.
function _safeStoredName(storedName) {
  if (typeof storedName !== 'string' || !storedName || storedName.includes('/') || storedName.includes('\\') || storedName.includes('..'))
    throw Object.assign(new Error('Недопустимый storedName'), { status: 400 });
  return storedName;
}

// Полный путь к записи внутри корзины по kind + dir.
async function binEntryPath({ city, kind, dir, storedName }) {
  storedName = _safeStoredName(storedName);
  if (kind === KIND.LIB_JSON) return libJsonBinFile(dir || '');
  if (kind === KIND.LIB_MD)   return path.join(libBinDir(dir), storedName);
  return path.join(binDir(kind, city), storedName);
}

// ── Мягкое удаление (вызывается точками удаления) ────────────────────────────

// Перемещает src в корзину и записывает запись реестра.
//   src         — абсолютный путь удаляемого (папка/файл)
//   kind        — KIND.*
//   city        — город (для городских сущностей)
//   slug        — «живой» слаг сущности до удаления
//   extra       — { lineage?, districtSlug?, chr?, mod?, dir?, category?, display? }
//   storedName  — необязательно; по умолчанию basename(src)
// Возвращает { storedName, record } (подтверждение для ответа DELETE-роута).
async function moveToTrash({ src, kind, city, slug, extra = {}, storedName = undefined }) {
  _validated(city, kind, extra.dir);
  const eName = storedName
    || (kind === KIND.LIB_JSON
      ? `${extra.dir}__${_safeStoredName(slug)}__${_safeStoredName(extra.category)}`
      : path.basename(src));
  _safeStoredName(eName);

  const recCity = kind === KIND.CITY ? null : city;
  const record  = {
    storedName: eName,
    kind,
    slug,
    ...(recCity ? { city: recCity } : {}),
    deletedAt: new Date().toISOString(),
    ...(extra.lineage    ? { lineage: extra.lineage }    : {}),
    ...(extra.districtSlug ? { districtSlug: extra.districtSlug } : {}),
    ...(extra.chr  ? { chr: extra.chr }  : {}),
    ...(extra.mod  ? { mod: extra.mod }  : {}),
    ...(extra.dir  ? { dir: extra.dir }  : {}),
    ...(extra.category ? { category: extra.category } : {}),
    ...(extra.display ? { display: extra.display } : {}),
  };

  let registryDir, records, dest;
  if (kind === KIND.PROPERTY_CATEGORY) {
    // Категория имущества живёт не файлом, а записью в categories.json → её
    // «корзина» — массив в system/property/_deleted.json.
    const file = propertyCategoryBinFile();
    const list = await readPropertyCategoryBin();
    const catRecord = {
      storedName: eName, kind,
      id: extra.id || eName, slug: extra.id || eName,
      name: extra.name || '', order: extra.order ?? 0,
      deletedAt: new Date().toISOString(),
    };
    list.push(catRecord);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, JSON.stringify(list, null, 2) + '\n', 'utf-8');
    return { storedName: eName, record: catRecord };
  }
  if (kind === KIND.LIB_JSON) {
    // JSON-трек: «корзина» — массив в _deleted.json, запись добавляется целиком.
    const file = libJsonBinFile(extra.dir);
    const list = await readJsonBin(extra.dir);
    list.push(record);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, JSON.stringify(list, null, 2) + '\n', 'utf-8');
    return { storedName: eName, record };
  }
  if (kind === KIND.LIB_MD) {
    registryDir = libBinDir(extra.dir);
  } else {
    registryDir = binDir(kind, city);
  }

  await fs.mkdir(registryDir, { recursive: true });
  dest = path.join(registryDir, eName);
  await fs.rename(src, dest);
  records = await readRegistry(registryDir);
  const idx = records.findIndex(r => r.storedName === eName);
  if (idx !== -1) records.splice(idx, 1);
  records.push(record);
  await writeRegistry(registryDir, records);
  return { storedName: eName, record };
}

// Читает `_deleted.json` категории (JSON-трек) — массив записей-кандидатов.
async function readJsonBin(dir) {
  try { return JSON.parse(await fs.readFile(libJsonBinFile(dir), 'utf-8')); } catch { return []; }
}

// Читает system/property/_deleted.json — удалённые категории имущества.
async function readPropertyCategoryBin() {
  try {
    const arr = JSON.parse(await fs.readFile(propertyCategoryBinFile(), 'utf-8'));
    return Array.isArray(arr) ? arr.filter(r => r && (r.storedName || r.id)) : [];
  } catch { return []; }
}

// ── Сканер корзин: [{storedName, kind, slug, display, detail, deletedAt, ...}] ─
// Возвращает ROW-формат для GET /api/trash (без папок реестра/мусора).

async function _scanBin({ city, kind, dir }) {
  const rows = [];
  const isJsonTrack = kind === KIND.LIB_JSON || kind === KIND.PROPERTY_CATEGORY;
  const registryDir = isJsonTrack ? null
    : (kind === KIND.LIB_MD ? libBinDir(dir) : binDir(kind, city));
  const reg = isJsonTrack ? [] : await readRegistry(registryDir);
  const regBy = new Map(reg.map(r => [r.storedName, r]));

  if (kind === KIND.PROPERTY_CATEGORY) {
    for (const rec of await readPropertyCategoryBin()) {
      rows.push({
        storedName: rec.storedName || rec.id,
        kind, dir: null,
        slug: rec.id, categoryId: rec.id,
        display: rec.name || rec.id,
        detail: 'категория имущества',
        deletedAt: rec.deletedAt || null,
      });
    }
    return rows.sort((a, b) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || '')));
  }

  if (kind === KIND.LIB_JSON) {
    for (const rec of await readJsonBin(dir)) {
      const storedName = `${dir}__${_safeStoredName(rec.slug)}__${_safeStoredName(rec.category)}`;
      rows.push({
        storedName, kind, dir,
        slug: rec.slug, category: rec.category,
        display: rec.display || rec.name || rec.slug,
        detail: rec.category,
        deletedAt: rec.deletedAt || null,
      });
    }
    return rows;
  }

  // Какие kinds делят общую папку корзины: маркер в имени записи даёт её kind.
//   chronicles/_deleted  — хроники (<slug>_<ts>) и модули (<chr>__<mod>_<ts>);
//   locations/_deleted   — локации (<slug>_<ts>) и районы (district_<slug>_<ts>).
function _siblingMarker(name) {
  if (name.includes('__')) return KIND.MODULE;
  if (name.startsWith('district_')) return KIND.DISTRICT;
  return null;
}
// Наследные записи БЕЗ маркера при скане этих kinds допустимы только при маркере
// (в общей папке маркер — единственный способ отличить модуль/район от хроники/локации).
const NEEDS_MARKER = { [KIND.MODULE]: true, [KIND.DISTRICT]: true };

let entries;
  try { entries = await fs.readdir(registryDir, { withFileTypes: true }); } catch { return rows; }
  for (const e of entries) {
    if (!e.isDirectory() && !((kind === KIND.LIB_MD || kind === KIND.PROPERTY_ITEM) && e.isFile())) continue;
    if (e.name === REGISTRY || e.name.startsWith('.')) continue;
    const rec  = regBy.get(e.name);
    const mark = _siblingMarker(e.name);
    if (rec) { if (rec.kind !== kind) continue; }       // реестр — источник истины
    else if (mark) { if (mark !== kind) continue; }     // маркированная запись другой группы
    else if (NEEDS_MARKER[kind]) continue;              // наследная запись без маркера — не сюда
    const full = path.join(registryDir, e.name);
    const row  = await _describeEntry({ city, kind, dir, storedName: e.name, rec, full, isDir: e.isDirectory() });
    if (row) rows.push(row);
  }
  // Сортировка: свежее удалённое — сверху.
  return rows.sort((a, b) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || '')));
}

// Одна строка корзины: от реестра + «чтение» из папки/файла, если реестра нет.
const _h1 = async p => (await fs.readFile(p, 'utf-8').catch(() => '')).replace(/^﻿/, '').match(/^#\s+(.+)$/m)?.[1]?.replace(/[*[\]]/g, '').trim();
const _artCount = async dir => { try { return (await fs.readdir(dir)).filter(n => !n.startsWith('.')).length; } catch { return 0; } };
const _modulesCount = async full => { try { return (await fs.readdir(path.join(full, 'modules'))).filter(n => !n.startsWith('.')).length; } catch { return 0; } };
const _locDistrict = async (full, slug) => (await fs.readFile(path.join(full, `${slug}.md`), 'utf-8').catch(() => ''))
  .match(/\*\*Район:\*\*\s*([^\n|]+)/)?.[1]?.trim() || null;

async function _describeEntry({ city, kind, dir, storedName, rec, full, isDir }) {
  const base = { storedName, kind, deletedAt: rec?.deletedAt || null };

  if (!rec || rec.kind !== kind) {
    // Fоллбэк для записей без реестра (созданных до фичи) — читать по имени/карточке.
    const fb = await _fallbackDescribe({ city, kind, dir, storedName, full, isDir });
    return fb ? { ...base, ...fb } : null;
  }

  switch (kind) {
    case KIND.CITY:      return { ...base, slug: rec.slug, display: rec.display || await _h1(path.join(full, 'city.md')) || rec.slug, detail: 'город' };
    case KIND.CHARACTER: return { ...base, slug: rec.slug, lineage: rec.lineage || null, display: rec.display || await _h1(path.join(full, `${rec.slug}.md`)) || rec.slug, detail: rec.lineage || '—', art: await _artCount(path.join(full, 'art')) };
    case KIND.LOCATION:  { const district = rec.district || await _locDistrict(full, rec.slug); return { ...base, slug: rec.slug, display: rec.display || await _h1(path.join(full, `${rec.slug}.md`)) || rec.slug, district, detail: district ? `район ${district}` : 'локация' }; }
    case KIND.DISTRICT:  return { ...base, slug: rec.slug, districtSlug: rec.districtSlug, display: rec.display || await _h1(path.join(full, 'district.md')) || rec.slug, detail: 'район' };
    case KIND.CHRONICLE: { const modules = rec.modules ?? await _modulesCount(full); return { ...base, slug: rec.slug, display: rec.display || await _h1(path.join(full, 'events.md')) || rec.slug, modules, detail: 'хроника' }; }
    case KIND.MODULE:    { const slug = rec.mod || rec.slug; return { ...base, chr: rec.chr, mod: rec.mod, display: rec.display || await _h1(path.join(full, `${slug}.md`)) || rec.mod || rec.slug, detail: rec.chr ? `хроника ${rec.chr}` : 'модуль' }; }
    case KIND.LIB_MD:    return { ...base, slug: rec.slug, dir: rec.dir || dir, display: rec.display || await _h1(full) || rec.slug, detail: rec.dir || dir };
    case KIND.PROPERTY_ITEM: return { ...base, slug: rec.slug, city, display: rec.display || await _h1(full) || rec.slug, detail: rec.category || 'предмет' };
    default:             return null;
  }
}

// Описание записи без реестра: вытаскиваем slug/display/detail из имени и карточки.
async function _fallbackDescribe({ city, kind, dir, storedName, full, isDir }) {

  switch (kind) {
    case KIND.CITY: {
      const display = await _h1(path.join(full, 'city.md'));
      const slug = storedName.replace(/__before_restore_\d+$/, '').replace(/_\d+$/, '');
      return { slug: slug || storedName, display: display || slug || storedName, detail: 'город' };
    }
    case KIND.CHARACTER: {
      const slug = storedName.replace(/_\d+$/, '');
      const cardPath = path.join(full, `${slug}.md`);
      const card = await fs.readFile(cardPath, 'utf-8').catch(() => '');
      const display = (card.replace(/^﻿/, '').match(/^#\s+(.+)$/m)?.[1] || slug || storedName).replace(/[*[\]]/g, '').trim();
      const lin = (card.match(/\*\*Линейка WoD:\*\*\s*([^\n|]+)/)?.[1] || '').trim();
      const lineage = (lin.toLowerCase().includes('вампир') ? 'vampires'
        : lin.toLowerCase().includes('фея') ? 'fairies'
        : lin.toLowerCase().includes('оборот') ? 'werewolves'
        : lin.toLowerCase().includes('маг') ? 'mages'
        : lin.toLowerCase().includes('охотник') ? 'hunters'
        : lin.toLowerCase().includes('смертн') || lin.toLowerCase().includes('человек') ? 'mortals'
        : null);
      return { slug: slug || storedName, lineage, display, detail: lin || lineage || '—', art: await _artCount(path.join(full, 'art')) };
    }
    case KIND.LOCATION: {
      const slug = storedName.replace(/_\d+$/, '');
      const cardPath = path.join(full, `${slug}.md`);
      const display = await _h1(cardPath) || slug || storedName;
      const district = await _locDistrict(full, slug);
      return { slug: slug || storedName, display, district, detail: district ? `район ${district}` : 'локация' };
    }
    case KIND.DISTRICT: {
      const slug = storedName.replace(/^district_/, '').replace(/_\d+$/, '');
      const display = await _h1(path.join(full, 'district.md')) || slug || storedName;
      return { slug: slug || storedName, districtSlug: slug, display, detail: 'район' };
    }
    case KIND.CHRONICLE: {
      const slug = storedName.replace(/_\d+$/, '');
      const display = await _h1(path.join(full, 'events.md')) || slug || storedName;
      let modules = 0;
      try { modules = (await fs.readdir(path.join(full, 'modules'))).filter(n => !n.startsWith('.')).length; } catch {}
      return { slug: slug || storedName, display, modules, detail: 'хроника' };
    }
    case KIND.MODULE: {
      // storedName: <chr>__<mod>_<ts>
      const [chrRaw, ...modParts] = storedName.split('__');
      const chr = chrRaw || storedName;
      const mod = modParts.join('__').replace(/_\d+$/, '') || storedName;
      const display = await _h1(path.join(full, `${mod}.md`)) || mod || storedName;
      return { chr, mod, display, detail: `хроника ${chr}` };
    }
    case KIND.LIB_MD: {
      const dir2  = (storedName.match(LIB_MD_DIR_RE)?.[1]) || dir || 'disciplines';
      const slug  = storedName.replace(LIB_MD_DIR_RE, '').replace(/_\d+\.md$/, '').replace(/\.md$/, '');
      const display = await _h1(full) || slug || storedName;
      return { slug, dir: dir2, display, detail: dir2 };
    }
    case KIND.PROPERTY_ITEM: {
      const slug = storedName.replace(/_\d+\.md$/, '').replace(/\.md$/, '');
      const display = await _h1(full) || slug || storedName;
      return { slug, display, detail: 'предмет' };
    }
    default: return null;
  }
}

// ── Полный скан по всем корзинам (GET /api/trash) ────────────────────────────

// Возвращает массив записей, готовый для группировки на клиенте.
async function scanAllTrash(city) {
  const rows = {};
  rows.cities     = await _scanBin({ city, kind: KIND.CITY });
  rows.characters = await _scanBin({ city, kind: KIND.CHARACTER });
  rows.locations  = await _scanBin({ city, kind: KIND.LOCATION });
  rows.districts  = await _scanBin({ city, kind: KIND.DISTRICT });
  rows.chronicles = await _scanBin({ city, kind: KIND.CHRONICLE });
  rows.modules    = await _scanBin({ city, kind: KIND.MODULE });
  rows.library = {};
  for (const dir of LIB_MD_DIRS)  rows.library[dir] = await _scanBin({ city, kind: KIND.LIB_MD, dir });
  for (const dir of LIB_JSON_DIRS) rows.library[dir] = await _scanBin({ city, kind: KIND.LIB_JSON, dir });
  rows.propertyItems      = await _scanBin({ city, kind: KIND.PROPERTY_ITEM });
  rows.propertyCategories = await _scanBin({ city, kind: KIND.PROPERTY_CATEGORY });
  return rows;
}

// Поиск storedName по всем корзинам города — для bulk/restore без явного kind
// (смешанные kinds) и для библиотеки, где dir обязателен. Возвращает строку
// {kind, storedName, dir} или null.
async function _findEntry({ city, kind, storedName }) {
  storedName = _safeStoredName(storedName);
  const kinds = kind
    ? [kind]
    : [KIND.CITY, KIND.CHARACTER, KIND.LOCATION, KIND.DISTRICT, KIND.CHRONICLE, KIND.MODULE,
       KIND.PROPERTY_ITEM, KIND.PROPERTY_CATEGORY];
  for (const k of kinds) {
    const hit = (await _scanBin({ city, kind: k, dir: null })).find(r => r.storedName === storedName);
    if (hit) return hit;
  }
  // Библиотека — по категориям (и MD, и JSON).
  for (const d of [...LIB_MD_DIRS, ...LIB_JSON_DIRS]) {
    const k  = LIB_MD_DIRS.includes(d) ? KIND.LIB_MD : KIND.LIB_JSON;
    const hit = (await _scanBin({ city, kind: k, dir: d })).find(r => r.storedName === storedName);
    if (hit) return hit;
  }
  return null;
}

// ── Restore (целевой путь + 409 при конфликте) ───────────────────────────────

// Возвращает { target, isDir, record } — target уже СВОБОДЕН (проверено).
// Кидает ошибки {status:409/404} для роутера.
async function restoreTrashItem({ city, kind, dir, storedName }) {
  _validated(city, kind, dir);
  storedName = _safeStoredName(storedName);

  // JSON-трек: вернуть запись в <category>.json — отдельный путь (нет папки в корзине).
  if (kind === KIND.LIB_JSON) {
    return restoreJsonBin({ dir, storedName });
  }

  // Категория имущества: вернуть запись в system/property/categories.json.
  if (kind === KIND.PROPERTY_CATEGORY) {
    return restorePropertyCategoryBin({ storedName });
  }

  const registryDir = kind === KIND.LIB_MD ? libBinDir(dir) : binDir(kind, city);
  const full        = path.join(registryDir, storedName);
  const isDir       = await fs.stat(full).then(s => s.isDirectory()).catch(() => null);
  if (isDir === null) throw Object.assign(new Error('Запись в корзине не найдена'), { status: 404 });

  const rec = (await readRegistry(registryDir)).find(r => r.storedName === storedName);
  const recKind = rec?.kind || kind;

  const _conflict = msg => { const e = new Error(msg); e.status = 409; throw e; };

  let target;
  if (recKind === KIND.CHARACTER) {
    const lineage = rec?.lineage || (await _fallbackDescribe({ city, kind, dir, storedName, full, isDir }))?.lineage || null;
    if (!lineage) throw Object.assign(new Error('Не удалось определить линейку персонажа. Восстановление невозможно.'), { status: 409 });
    const slug = rec?.slug || storedName.replace(/_\d+$/, '');
    target = path.join(charsDir(city), lineage, slug);
  } else if (recKind === KIND.LOCATION) {
    const slug = rec?.slug || storedName.replace(/_\d+$/, '');
    target = path.join(locsDir(city), slug);
  } else if (recKind === KIND.DISTRICT) {
    const slug = rec?.districtSlug || storedName.replace(/^district_/, '').replace(/_\d+$/, '');
    target = path.join(locsDir(city), slug);
  } else if (recKind === KIND.CHRONICLE) {
    const slug = rec?.slug || storedName.replace(/_\d+$/, '');
    target = path.join(chroniclesDir(city), slug);
  } else if (recKind === KIND.MODULE) {
    let chr = rec?.chr, mod = rec?.mod;
    if (!chr || !mod) {
      const [c, ...mParts] = storedName.split('__');
      chr = c || storedName; mod = mParts.join('__').replace(/_\d+$/, '') || storedName;
    }
    if (!await fs.stat(path.join(chroniclesDir(city), chr)).catch(() => null)) {
      _conflict('Хроника в корзине — сначала восстановите хронику');
    }
    target = path.join(chroniclesDir(city), chr, 'modules', mod);
    if (await fs.stat(target).catch(() => null)) _conflict('Модуль с таким именем уже существует');
    await fs.mkdir(path.dirname(target), { recursive: true });
  } else if (recKind === KIND.LIB_MD) {
    const d   = rec?.dir || dir || 'disciplines';
    const slug = rec?.slug || storedName.replace(LIB_MD_DIR_RE, '').replace(/_\d+\.md$/, '').replace(/\.md$/, '');
    target = path.join(ROOT, 'system', 'library', d, `${slug}.md`);
    dir = d;
  } else if (recKind === KIND.PROPERTY_ITEM) {
    const slug = rec?.slug || storedName.replace(/_\d+\.md$/, '').replace(/\.md$/, '');
    target = path.join(cityDir(city), 'property', 'items', `${slug}.md`);
  } else { // CITY
    const slug = rec?.slug || storedName.replace(/__before_restore_\d+$/, '').replace(/_\d+$/, '');
    target = path.join(CITIES_DIR, slug);
  }

  if (target !== null) {
    const isFileKind = recKind === KIND.LIB_MD || recKind === KIND.PROPERTY_ITEM;
    const exists = (isDir || isFileKind) ? await fs.stat(target).catch(() => null) : null;
    if (exists) _conflict('Имя уже используется — удалите или верните существующее первым');
  }

  // Снять запись из реестра, вернуть папку/файл на место.
  const records = await readRegistry(registryDir);
  await writeRegistry(registryDir, records.filter(r => r.storedName !== storedName));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(full, target);

  return { target, isDir, dir, slug: rec?.slug || null };
}

// Restore JSON-записи Библиотеки: из `_deleted.json` → обратно в `<category>.json`.
async function restoreJsonBin({ dir, storedName }) {
  const recs = await readJsonBin(dir);
  const rec  = recs.find(r => `${dir}__${r.slug}__${r.category}` === storedName);
  if (!rec) throw Object.assign(new Error('Запись в корзине не найдена'), { status: 404 });
  const file = path.join(ROOT, 'system', 'library', dir, `${rec.category}.json`);
  const list = await _readJsonArray(file);
  if (list.some(x => x.slug === rec.slug))
    throw Object.assign(new Error('Запись с таким именем уже есть в категории'), { status: 409 });
  list.push({ slug: rec.slug, name: rec.name, category: rec.category, custom: true, ...(rec.snapshot || {}), ...(rec.points !== undefined ? { points: rec.points } : {}), ...(rec.description ? { description: rec.description } : {}), ...(rec.system ? { system: rec.system } : {}) });
  await writeFileAtomic(file, JSON.stringify(list, null, 2) + '\n', 'utf-8');
  await writeFileAtomic(libJsonBinFile(dir), JSON.stringify(recs.filter(x => x !== rec), null, 2) + '\n', 'utf-8');
  // Файл записан напрямую (мимо _jsonLibRoutes) — сбросить кэш лоадера категории,
  // иначе следующий GET отдаст старый массив без восстановленной записи.
  _invalidateLibJson(dir, rec.category);
  return { target: file, isDir: false };
}

// Сброс кэша JSON-лоадера библиотеки после restore (delete инвалидирует сам
// _jsonLibRoutes, restore пишет файл напрямую из trash.js). Lazy-require:
// лоадеры зависят только от fs/path, циклов нет.
function _invalidateLibJson(dir, category) {
  try {
    if (dir === 'merits') require('./merits-loader').invalidateMerits(category);
    else if (dir === 'flaws') require('./flaws-loader').invalidateFlaws(category);
    else if (dir === 'backgrounds') require('./backgrounds-loader').invalidateBackgrounds(category);
    else if (dir === 'archetypes') require('./archetypes-loader').invalidateArchetypes(category);
    else if (dir === 'essences') require('./essences-loader').invalidateEssences(category);
    else if (dir === 'specializations') require('./specializations-loader').invalidateSpecializations(category);
  } catch {}
}

// Restore категории имущества: из system/property/_deleted.json → в categories.json.
async function restorePropertyCategoryBin({ storedName }) {
  const recs = await readPropertyCategoryBin();
  const rec  = recs.find(r => (r.storedName || r.id) === storedName);
  if (!rec) throw Object.assign(new Error('Запись в корзине не найдена'), { status: 404 });
  const list = await _readJsonArray(PROPERTY_CATEGORIES_FILE);
  if (list.some(c => c.id === rec.id))
    throw Object.assign(new Error('Категория с таким именем уже есть'), { status: 409 });
  list.push({ id: rec.id, name: rec.name, order: rec.order ?? list.length });
  await fs.mkdir(path.dirname(PROPERTY_CATEGORIES_FILE), { recursive: true });
  await writeFileAtomic(PROPERTY_CATEGORIES_FILE, JSON.stringify(list, null, 2) + '\n', 'utf-8');
  await writeFileAtomic(propertyCategoryBinFile(), JSON.stringify(recs.filter(r => r !== rec), null, 2) + '\n', 'utf-8');
  return { target: PROPERTY_CATEGORIES_FILE, isDir: false };
}

async function _readJsonArray(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf-8')); } catch { return []; }
}

// ── Purge (окончательное удаление из корзины) ────────────────────────────────

async function purgeTrashItem({ city, kind, dir, storedName }) {
  _validated(city, kind, dir);
  storedName = _safeStoredName(storedName);

  if (kind === KIND.LIB_JSON) {
    const list = await readJsonBin(dir);
    if (!list.some(r => `${dir}__${r.slug}__${r.category}` === storedName))
      throw Object.assign(new Error('Запись в корзине не найдена'), { status: 404 });
    await writeFileAtomic(libJsonBinFile(dir), JSON.stringify(list.filter(r => `${dir}__${r.slug}__${r.category}` !== storedName), null, 2) + '\n', 'utf-8');
    return;
  }

  if (kind === KIND.PROPERTY_CATEGORY) {
    const list = await readPropertyCategoryBin();
    if (!list.some(r => (r.storedName || r.id) === storedName))
      throw Object.assign(new Error('Запись в корзине не найдена'), { status: 404 });
    await writeFileAtomic(propertyCategoryBinFile(), JSON.stringify(list.filter(r => (r.storedName || r.id) !== storedName), null, 2) + '\n', 'utf-8');
    return;
  }

  const registryDir = kind === KIND.LIB_MD ? libBinDir(dir) : binDir(kind, city);
  const full        = path.join(registryDir, storedName);
  const stat        = await fs.stat(full).catch(() => null);
  if (!stat) throw Object.assign(new Error('Запись в корзине не найдена'), { status: 404 });
  if (stat.isDirectory()) await fs.rm(full, { recursive: true, force: true });
  else await fs.unlink(full);
  const records = await readRegistry(registryDir);
  await writeRegistry(registryDir, records.filter(r => r.storedName !== storedName));
}

// Очистка всей корзины kind (bulk all / «очистить секцию»). Возвращает количество.
async function clearAllOfKind({ city, kind, dir }) {
  const rows = await _scanBin({ city, kind, dir });
  for (const r of rows) await purgeTrashItem({ city, kind, dir: r.dir || dir, storedName: r.storedName });
  return rows.length;
}

module.exports = {
  KIND, KINDS, LIB_MD_DIRS, LIB_JSON_DIRS,
  binDir, libBinDir, libJsonBinFile,
  PROPERTY_CATEGORIES_FILE, propertyCategoryBinFile,
  readRegistry, writeRegistry, appendRegistry,
  moveToTrash, readJsonBin, readPropertyCategoryBin,
  scanAllTrash, _scanBin, _findEntry,
  restoreTrashItem, restoreJsonBin, restorePropertyCategoryBin, purgeTrashItem, clearAllOfKind,
};