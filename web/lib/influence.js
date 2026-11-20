'use strict';
// Диаграммы влияния по локациям (спека doc/design/influence-charts-2026-11-16/spec.md).
// Расчёт — чистые функции над уже разобранными локациями; чтение справочников и файла
// ручных чисел вынесено в отдельные async-хелперы ниже.
//
// Три списочных поля локации:
//   «Контроль»    — кланы, киты фей, семьи ревенантов, «Охотники», организации смертных;
//   «Фракции»     — секты, фракции смертных, дворы фей, племена оборотней (VtM-таблица, строка «Фракция»);
//   «Присутствие» — линейки.

const path = require('path');
const fs   = require('fs').promises;
const { ROOT, archiveDir, cityDir, writeFileAtomic } = require('./db');
const { parseCityMd, splitMetaList } = require('./parsers');

const LIB_DIR  = path.join(ROOT, 'system', 'library');
const ART_DIR  = path.join(__dirname, '..', 'public', 'img', 'system', 'library');
const OVERRIDES_FILE = 'influence.json';

// Линейки поля «Присутствие». name — значение в файле карточки (данные города, не UI),
// icon — имя файла в /img/system/lineages/.
const LINEAGES = Object.freeze([
  { key: 'vampires',   name: 'Вампиры',  icon: 'vampire' },
  { key: 'fairies',    name: 'Феи',      icon: 'fairy' },
  { key: 'mortals',    name: 'Смертные', icon: 'mortal' },
  { key: 'werewolves', name: 'Оборотни', icon: 'werewolf' },
  { key: 'mages',      name: 'Маги',     icon: 'mage' },
  { key: 'hunters',    name: 'Охотники', icon: 'hunter' },
]);
const HUNTERS = 'Охотники';
const MASQ_LEVELS = Object.freeze(['low', 'medium', 'high', 'unknown']);
// Блоки страницы «Фракции» и те из них, где Рассказчик может вписать число поверх расчёта.
const CITY_BLOCKS = Object.freeze(['factions', 'clans', 'lineages', 'masquerade']);
const OVERRIDE_BLOCKS = Object.freeze(['factions', 'clans', 'lineages']);
// Разделы вкладки «Фракции» карточки района: тип записи → поле локации, из которого он берётся.
const DISTRICT_BLOCKS = Object.freeze([
  { key: 'sects',    type: 'sect',   field: 'faction', art: 'sects' },
  { key: 'mortal',   type: 'mortal', field: 'both' },
  { key: 'clans',    type: 'clan',   field: 'control', art: 'clans' },
  { key: 'families', type: 'family', field: 'control', art: 'revenant-families' },
  { key: 'tribes',   type: 'tribe',  field: 'faction', art: 'werewolf-tribes' },
  { key: 'kiths',    type: 'kith',   field: 'control', art: 'fairy-kiths' },
  { key: 'courts',   type: 'court',  field: 'faction', art: 'fairy-courts' },
]);
// Служебные строки: клиент подписывает их через i18n, поэтому name у них null.
const KEY_OTHER = '_other';
const KEY_NONE  = '_none';

// Правило заполнения полей для ИИ-генерации локаций (FR10): диаграммы считаются по ним,
// поэтому значения должны совпадать со справочниками.
const CONTROL_PROMPT_HINT = `Поле «Контроль» — через запятую, без пояснений в скобках: названия кланов вампиров, китов фей, семей ревенантов, «${HUNTERS}» или организации смертных города. Если локацию никто не контролирует — «—».
Строка «Фракция» таблицы VtM-контекста — через запятую: секты (Камарилья, Шабаш, Анархи…), фракции смертных города, дворы фей, племена оборотней.
Поле «Присутствие» — через запятую линейки из списка: ${LINEAGES.map(l => l.name).join(', ')}.`;

/** Нормализация для сравнения названий: без регистра, без пояснения в скобках, ё = е. */
function normName(s) {
  return String(s == null ? '' : s).replace(/\([^)]*\)/g, ' ').toLowerCase().replace(/ё/g, 'е')
    .replace(/\s+/g, ' ').trim();
}

// «# 🔥 Бруха (Brujah)» → { name: 'Бруха', en: 'Brujah' }; BOM и эмодзи-префикс отбрасываются.
function _parseLibHeader(md) {
  const text = String(md || '').replace(/^﻿/, '');
  const m = text.match(/^#\s+(.+)$/m);
  if (!m) return null;
  const title = m[1].replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const pm = title.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const sect = (text.match(/^-\s*\*\*Секта:\*\*[^\S\n]*(.+)$/m) || [])[1];
  return { name: (pm ? pm[1] : title).trim(), en: pm ? pm[2].trim() : '', sect: sect ? sect.trim() : '' };
}

async function _readLibDir(dir) {
  const full  = path.join(LIB_DIR, dir);
  const files = (await fs.readdir(full).catch(() => []))
    .filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();
  const out = [];
  for (const f of files) {
    const head = _parseLibHeader(await fs.readFile(path.join(full, f), 'utf-8').catch(() => ''));
    if (head && head.name) out.push({ slug: f.replace(/\.md$/, ''), ...head });
  }
  return out;
}

async function _artSet(section) {
  return new Set(await fs.readdir(path.join(ART_DIR, section)).catch(() => []));
}

const _mdList = text => String(text || '').split('\n').map(l => l.replace(/^\s*-\s?/, '').trim()).filter(Boolean);
const _ART_SECTIONS = ['clans', 'sects', 'fairy-kiths', 'fairy-courts', 'werewolf-tribes', 'revenant-families'];

/**
 * Словарь распознавания «Контроля» и «Фракций» для города: справочники Библиотеки +
 * организации смертных из city.md. art — какие эмблемы реально лежат на диске.
 * @param {string} city
 */
async function loadDictionary(city) {
  const [clans, kiths, families, sects, courts, tribes, cityRaw, ...artSets] = await Promise.all([
    _readLibDir('clans'), _readLibDir('fairy-kiths'), _readLibDir('revenant-families'),
    _readLibDir('sects'), _readLibDir('fairy-courts'), _readLibDir('werewolf-tribes'),
    fs.readFile(path.join(cityDir(city), 'city.md'), 'utf-8').catch(() => ''),
    ..._ART_SECTIONS.map(_artSet),
  ]);
  const sec = parseCityMd(cityRaw).sections || {};
  const mortal = [...new Set([..._mdList(sec.factionsMortal), ..._mdList(sec.factionsState)])];
  const art = Object.fromEntries(_ART_SECTIONS.map((s, i) => [s, artSets[i]]));
  return { clans, kiths, families, sects, courts, tribes, mortal, art };
}

// norm → запись. Порядок добавления = приоритет при совпадении названий между справочниками.
function _buildIndex(groups) {
  const index = new Map();
  for (const [type, list] of groups) {
    for (const e of list || []) {
      const entry = typeof e === 'string' ? { name: e } : e;
      for (const n of [entry.name, entry.en]) {
        const k = normName(n);
        if (k && !index.has(k)) index.set(k, { type, name: entry.name, slug: entry.slug || '', sect: entry.sect || '' });
      }
    }
  }
  return index;
}

function _cached(dict, prop, build) {
  if (!dict[prop]) Object.defineProperty(dict, prop, { value: build(), enumerable: false });
  return dict[prop];
}
const _controlIndex = dict => _cached(dict, '_controlIndex', () => _buildIndex([
  ['clan', dict.clans], ['kith', dict.kiths], ['family', dict.families],
  ['hunters', [{ name: HUNTERS, en: 'Hunters' }]], ['mortal', dict.mortal],
]));
const _factionIndex = dict => _cached(dict, '_factionIndex', () => _buildIndex([
  ['sect', dict.sects], ['court', dict.courts], ['tribe', dict.tribes], ['mortal', dict.mortal],
]));

// Совпадение — по русскому или английскому названию без учёта регистра и пояснения в
// скобках; у старого свободного текста дополнительно распознаётся название справочника
// в начале («Носферату Парижа» → клан Носферату). Организации смертных — только целиком.
function _classify(token, index) {
  const raw = String(token == null ? '' : token).trim();
  const key = normName(raw);
  if (index.has(key)) return { ...index.get(key) };
  let best = null;
  for (const [k, e] of index) {
    if (e.type === 'mortal' || e.type === 'hunters') continue;
    if (key.startsWith(k + ' ') && (!best || k.length > best.k.length)) best = { k, e };
  }
  return best ? { ...best.e } : { type: 'custom', name: raw };
}

/** Элемент «Контроля» → { type: 'clan'|'kith'|'family'|'hunters'|'mortal'|'custom', name, slug?, sect? }. */
const classifyControl = (token, dict) => _classify(token, _controlIndex(dict));
/** Элемент «Фракций» → { type: 'sect'|'court'|'tribe'|'mortal'|'custom', name, slug? }. */
const classifyFaction = (token, dict) => _classify(token, _factionIndex(dict));

/**
 * Секта элемента «Контроля» — запасной источник блока «Фракции», когда в поле «Фракции»
 * секты нет: у клана — поле «Секта» Библиотеки, у своего значения — оно само, если это
 * название секты. Сверка по справочнику целиком (все секты, не только три) — решение
 * пользователя 2026-11-17: правило одно и для поля, и для старого текста «Контроля».
 * @returns {{name: string, slug: string}|null}
 */
function sectOf(entry, dict) {
  const want = entry.type === 'clan' ? entry.sect : entry.type === 'custom' ? entry.name : '';
  const k = normName(want);
  if (!k) return null;
  const hit = (dict.sects || []).find(s => normName(s.name) === k || normName(s.en) === k);
  return hit ? { name: hit.name, slug: hit.slug } : null;
}

function _lineageOf(token) {
  const k = normName(token);
  return LINEAGES.find(l => normName(l.name) === k || l.key === k) || null;
}

const _pct = (weight, total) => (total > 0 ? Math.round((weight / total) * 100) : 0);

// Собирает строки блока из Map key → { name, weight, icon, locations }.
function _rows(acc, total, manualMap, { order = null } = {}) {
  const manual = (manualMap && typeof manualMap === 'object') ? manualMap : {};
  for (const key of Object.keys(manual)) {
    // Ручное число строки, которой в расчёте больше нет, показывается, пока его не снимут.
    if (!acc.has(key)) acc.set(key, { name: key.startsWith('_') ? null : key, weight: 0, icon: null, locations: [] });
  }
  const rows = [...acc.entries()].map(([key, r]) => {
    const auto = _pct(r.weight, total);
    const m = Number.isInteger(manual[key]) ? manual[key] : null;
    return { key, name: r.name, weight: r.weight, auto, manual: m, value: m == null ? auto : m, icon: r.icon || null, locations: r.locations };
  });
  const tail = k => (k === KEY_OTHER ? 1 : k === KEY_NONE ? 2 : 0);
  rows.sort((a, b) => tail(a.key) - tail(b.key)
    || (order ? order.indexOf(a.key) - order.indexOf(b.key) : (b.value - a.value) || (b.weight - a.weight))
    || String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
  return rows;
}

function _bump(acc, key, name, icon, share, loc) {
  let r = acc.get(key);
  if (!r) { r = { name, weight: 0, icon, locations: [] }; acc.set(key, r); }
  r.weight += share;
  const prev = r.locations.find(l => l.slug === loc.slug);
  if (prev) prev.share += share;
  else r.locations.push({ slug: loc.slug, title: loc.title || loc.subtype || loc.slug, share });
}

const _list = (loc, listKey, rawKey) => (Array.isArray(loc[listKey]) ? loc[listKey] : splitMetaList(loc[rawKey]));
const _libIcon = (dict, section, slug) => (section && slug && dict.art && dict.art[section] && dict.art[section].has(`${slug}.png`)
  ? `/img/system/library/${section}/${slug}.png` : null);
// Тип записи справочника → папка её эмблем. Организации смертных и охотники — без арта.
const _ART_BY_TYPE = Object.freeze({
  sect: 'sects', court: 'fairy-courts', tribe: 'werewolf-tribes',
  clan: 'clans', kith: 'fairy-kiths', family: 'revenant-families',
});
// При «Частном домене» строка «Фракция» хранит имя хозяина, а не фракции — в расчёт не идёт.
const _factionTokens = loc => (loc.privateDomain ? [] : _list(loc, 'factionList', 'faction'));

/**
 * Четыре блока страницы «Фракции». Локация весит 1, вес делится поровну между
 * значениями поля; доля — от числа всех локаций города.
 * @param {object[]} locations — результат parseLocation
 * @param {object} dict — loadDictionary()
 * @param {object} [overrides] — { factions: {key: число}, clans: {...}, lineages: {...} }
 */
function computeInfluence(locations, dict, overrides = {}) {
  const locs  = Array.isArray(locations) ? locations : [];
  const total = locs.length;
  const clans = new Map(), factions = new Map(), lineages = new Map(), masq = new Map();
  // Строка блока «Фракции» — любая распознанная запись поля: секта, двор фей (для фей это
  // тот же уровень, что секта у вампиров), племя оборотней, организация смертных.
  const bumpFaction = (e, share, loc) =>
    _bump(factions, e.name, e.name, _libIcon(dict, _ART_BY_TYPE[e.type], e.slug), share, loc);

  for (const loc of locs) {
    const control = _list(loc, 'controlList', 'control');
    const classified = control.map(t => classifyControl(t, dict));
    if (!control.length) {
      _bump(clans, KEY_NONE, null, null, 1, loc);
    } else {
      const share = 1 / control.length;
      for (const e of classified) {
        if (e.type === 'clan') _bump(clans, e.name, e.name, _libIcon(dict, 'clans', e.slug), share, loc);
        else _bump(clans, KEY_OTHER, null, null, share, loc);
      }
    }

    // «Фракции»: записи одноимённого поля; пусто — секта по клану из «Контроля».
    const fac = _factionTokens(loc);
    if (fac.length) {
      const share = 1 / fac.length;
      for (const t of fac) {
        const e = classifyFaction(t, dict);
        if (e.type !== 'custom') { bumpFaction(e, share, loc); continue; }
        // В старом тексте поля вместо фракции часто стоит клан («Вентру (финансы)») —
        // его секта берётся из Библиотеки, как и при пустом поле.
        const sect = sectOf(classifyControl(t, dict), dict);
        if (sect) bumpFaction({ type: 'sect', ...sect }, share, loc);
        else _bump(factions, KEY_OTHER, null, null, share, loc);
      }
    } else if (control.length) {
      const share = 1 / control.length;
      for (const e of classified) {
        const sect = sectOf(e, dict);
        if (sect) bumpFaction({ type: 'sect', ...sect }, share, loc);
        else _bump(factions, KEY_OTHER, null, null, share, loc);
      }
    } else {
      _bump(factions, KEY_NONE, null, null, 1, loc);
    }

    const presence = _list(loc, 'presenceList', 'presence');
    if (!presence.length) {
      _bump(lineages, KEY_NONE, null, null, 1, loc);
    } else {
      const share = 1 / presence.length;
      for (const token of presence) {
        const l = _lineageOf(token);
        if (l) _bump(lineages, l.key, l.name, `/img/system/lineages/${l.icon}.png`, share, loc);
        else _bump(lineages, KEY_OTHER, null, null, share, loc);
      }
    }

    const level = MASQ_LEVELS.includes(loc.masqueradeLevel) ? loc.masqueradeLevel : 'unknown';
    _bump(masq, level, null, null, 1, loc);
  }

  const ov = (overrides && typeof overrides === 'object') ? overrides : {};
  const masqRows = total ? _rows(masq, total, null, { order: MASQ_LEVELS }).map(r => ({ ...r, count: r.weight })) : [];
  return {
    total,
    blocks: {
      factions:   total ? _rows(factions, total, ov.factions) : [],
      clans:      total ? _rows(clans, total, ov.clans) : [],
      lineages:   total ? _rows(lineages, total, ov.lineages) : [],
      masquerade: masqRows,
    },
  };
}

/**
 * Разделы вкладки «Фракции» карточки района: кто присутствует в его локациях. Каждый
 * раздел — один тип записей; доля считается внутри раздела (от суммы весов записей
 * этого типа), служебных строк «Прочее» и «Не указано» нет — пустой раздел остаётся пустым.
 * Ручных чисел у района нет.
 * @param {object[]} locations — локации одного района
 */
function computeDistrictInfluence(locations, dict) {
  const locs = Array.isArray(locations) ? locations : [];
  const acc  = Object.fromEntries(DISTRICT_BLOCKS.map(b => [b.key, new Map()]));
  const byType = Object.fromEntries(DISTRICT_BLOCKS.map(b => [b.type, b]));

  const feed = (tokens, classify, field, loc, seen) => {
    if (!tokens.length) return;
    const share = 1 / tokens.length;
    for (const t of tokens) {
      const e = classify(t, dict);
      const block = byType[e.type];
      if (!block || (block.field !== field && block.field !== 'both')) continue;
      // Раздел «Фракции смертных» собирается из обоих полей: организация, названная и в
      // «Контроле», и во «Фракциях» одной локации, — это одна запись, а не две.
      const mark = `${block.key}|${normName(e.name)}`;
      if (seen.has(mark)) continue;
      seen.add(mark);
      _bump(acc[block.key], e.name, e.name, block.art ? _libIcon(dict, block.art, e.slug) : null, share, loc);
    }
  };
  for (const loc of locs) {
    const seen = new Set();
    feed(_list(loc, 'controlList', 'control'), classifyControl, 'control', loc, seen);
    feed(_factionTokens(loc), classifyFaction, 'faction', loc, seen);
  }

  const blocks = {};
  for (const b of DISTRICT_BLOCKS) {
    const sum = [...acc[b.key].values()].reduce((s, r) => s + r.weight, 0);
    blocks[b.key] = _rows(acc[b.key], sum, null);
  }
  return { total: locs.length, blocks };
}

/** Группы пикеров «Контроля» и «Фракций», список линеек «Присутствия» — для клиента. */
function controlOptions(dict) {
  const lib = list => (list || []).map(e => ({ value: e.name, hint: e.en || '' }));
  const mortal = (dict.mortal || []).map(n => ({ value: n, hint: '' }));
  return {
    groups: [
      { key: 'clans',    items: lib(dict.clans) },
      { key: 'kiths',    items: lib(dict.kiths) },
      { key: 'families', items: lib(dict.families) },
      { key: 'hunters',  items: [{ value: HUNTERS, hint: '' }] },
      { key: 'mortal',   items: mortal },
    ],
    factionGroups: [
      { key: 'sects',  items: lib(dict.sects) },
      { key: 'mortal', items: mortal },
      { key: 'courts', items: lib(dict.courts) },
      { key: 'tribes', items: lib(dict.tribes) },
    ],
    lineages: LINEAGES.map(l => ({ key: l.key, value: l.name, icon: `/img/system/lineages/${l.icon}.png` })),
  };
}

// ── Ручные числа: cities/<город>/archive/influence.json ──────────────────────
function _cleanOverrides(raw) {
  const out = {};
  for (const block of OVERRIDE_BLOCKS) {
    out[block] = {};
    const b = raw && typeof raw === 'object' ? raw[block] : null;
    const src = b && typeof b === 'object' && !Array.isArray(b) ? b : {}; // массив — тоже битые данные
    for (const [k, v] of Object.entries(src)) {
      if (Number.isInteger(v) && v >= 0 && v <= 100) out[block][k] = v;
    }
  }
  return out;
}

/** Отсутствующий или битый файл читается как «ручных чисел нет». */
async function readOverrides(city) {
  const raw = await fs.readFile(path.join(archiveDir(city), OVERRIDES_FILE), 'utf-8').catch(() => '');
  try { return _cleanOverrides(JSON.parse(raw.replace(/^﻿/, ''))); } catch { return _cleanOverrides(null); }
}

// Очередь записи на город: read-modify-write файла целиком, а правок прилетает несколько
// подряд (строку правят, уходят на соседнюю). Без очереди два запроса читают одно и то же
// состояние, и второй перезаписывает первое — ручное число молча теряется.
const _writeQueue = new Map();

/** value === null снимает ручное число строки. */
function writeOverride(city, block, key, value) {
  const prev = _writeQueue.get(city) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const data = await readOverrides(city);
    if (value == null) delete data[block][key];
    else data[block][key] = value;
    await fs.mkdir(archiveDir(city), { recursive: true });
    await writeFileAtomic(path.join(archiveDir(city), OVERRIDES_FILE), JSON.stringify(data, null, 2) + '\n', 'utf-8');
    return data;
  });
  // Хвост очереди чистим, чтобы Map не рос по городу навсегда.
  _writeQueue.set(city, next);
  next.catch(() => {}).finally(() => { if (_writeQueue.get(city) === next) _writeQueue.delete(city); });
  return next;
}

module.exports = {
  LINEAGES, HUNTERS, MASQ_LEVELS, CITY_BLOCKS, OVERRIDE_BLOCKS, DISTRICT_BLOCKS, KEY_OTHER, KEY_NONE,
  CONTROL_PROMPT_HINT,
  normName, loadDictionary, classifyControl, classifyFaction, sectOf,
  computeInfluence, computeDistrictInfluence, controlOptions,
  readOverrides, writeOverride,
};
