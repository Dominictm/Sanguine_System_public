'use strict';
// Документ «Виды связей» города — cities/<город>/rules/relation_types.md
// (техспека docs/design/2026-08-26-relation-types-city-document-techspec.md).
//
// Здесь ТОЛЬКО текст: разбор/сборка markdown и сид постоянных видов. Файловый
// ввод-вывод, резолвер типа связи и зеркальные пары — в web/lib/relation-types.js.
// Разделение то же, что у остальных парсеров: чистая функция от строки, чтобы её
// могли звать и сервер, и CLI-тулы (миграция 008), не таща за собой fs-слой.

const { slugify } = require('./shared');

// Сид постоянных видов — system/library/relation-types.json (11 канонических).
// require() статического JSON, а не async-чтение: cityScaffold() синхронна и чиста,
// а сид обязан остаться ОДНИМ файлом-истиной — иначе имена и цвета разъедутся между
// библиотекой и каркасом нового города. Файл меняется вручную и очень редко, кеш
// require() здесь не мешает (правка сида по определению влияет только на города,
// создаваемые ПОСЛЕ неё, — см. §4.1 техспеки).
const SEED = require('../../../system/library/relation-types.json');

const SECTION_PERMANENT = 'Постоянные';
const SECTION_AUTHORED  = 'Авторские';
// Литерал колонки «Пара» для прежней логики Брат/Сестра по полю «Пол» цели (§4.6).
const PAIR_BY_GENDER = 'по полу';
// Плейсхолдер пустой необязательной ячейки — и на запись, и на чтение.
const EMPTY_CELL = '—';
// Зарезервировано графом: 'neutral' — «не распознано», 'aggregate' — синтетическое
// ребро режима ?compact=true. Ни то, ни другое не вид связи (§3.3): попав в документ,
// они стали бы переименовываемыми и удаляемыми, и граф остался бы без фоллбэка.
const RESERVED_SLUGS = new Set(['neutral', 'aggregate']);
const RESERVED_NAMES = new Set(['neutral', 'aggregate', 'нейтральный', 'агрегировано']);

// Ключевые слова и зеркальные пары канонических 11 — то, чем раньше были
// categorizeRel() (web/lib/parsers/character.js) и REL_AUTO_PAIRS
// (web/routes/characters.js). Ключ — слаг сида, порядок берётся из самого сида.
const SEED_META = {
  sir:           { pair: 'Чайлд',        keywords: ['создал', 'обратил'] },
  chayld:        { pair: 'Сир',          keywords: ['потомок'] },
  brat:          { pair: PAIR_BY_GENDER, keywords: ['брат'] },
  sestra:        { pair: PAIR_BY_GENDER, keywords: ['сестр'] },
  gul:           { pair: 'Домитор',      keywords: [] },
  domitor:       { pair: 'Гуль',         keywords: [] },
  familyar:      { pair: '',             keywords: ['фамильяр'] },
  soyuznik:      { pair: '',             keywords: ['друг', 'подруг', 'доверя', 'помощ', 'поддерж'] },
  vrag:          { pair: '',             keywords: ['ненавид', 'угроз', 'конфликт', 'противн', 'вражд'] },
  semya:         { pair: '',             keywords: ['мать', 'отец', 'семь', 'родств', 'племян'] },
  taynaya_svyaz: { pair: '',             keywords: ['тайн', 'секрет', 'скрыт', 'негласн', 'подпольн'] },
};

// Четыре легаси-категории categorizeRel(), у которых нет пары в библиотеке. При
// миграции существующего города уходят в «Авторские» (§7 п.3): постоянный набор
// остаётся ровно из 11, но и выбросить их нельзя — на живых данных это десятки
// связей, которые иначе схлопнулись бы в скрытый neutral. Цвета — из REL_COLORS
// (web/public/scripts/graph.js), чтобы граф не перекрасился.
const LEGACY_AUTHORED = [
  { name: 'Преданность', slug: 'predannost', color: '#B8860B', pair: '', keywords: ['лояльн', 'предан', 'служ', 'свита'] },
  { name: 'Романтика',   slug: 'romantika',  color: '#D06890', pair: '', keywords: ['любов', 'романт', 'привязан', 'влюбл'] },
  { name: 'Подозрение',  slug: 'podozrenie', color: '#9B6BAE', pair: '', keywords: ['подозр', 'осторожн', 'насторож'] },
  { name: 'Знакомый',    slug: 'znakomyy',   color: '#6FA8A8', pair: '', keywords: ['знаком', 'приятел', 'контакт', 'встреч'] },
];

/** @returns {{slug: string, name: string, color: string, pair: string, keywords: string[]}[]} 11 постоянных видов из сида */
function seedPermanentEntries() {
  return SEED.map(t => {
    const meta = SEED_META[t.slug] || { pair: '', keywords: [] };
    return { slug: t.slug, name: t.name, color: t.color, pair: meta.pair, keywords: [...meta.keywords] };
  });
}

/** @returns {string[]} слаги канонических видов — их нельзя переименовать/удалить (§4.2) */
function canonSlugs() { return SEED.map(t => t.slug); }

/** @returns {{slug, name, color, pair, keywords}[]} копии легаси-категорий для «Авторских» при миграции */
function legacyAuthoredEntries() { return LEGACY_AUTHORED.map(e => ({ ...e, keywords: [...e.keywords] })); }

// ── Разбор ───────────────────────────────────────────────────────────────────

function _splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}
function _cell(v) {
  const s = String(v == null ? '' : v).trim();
  return (!s || s === EMPTY_CELL || s === '-' || s === '--') ? '' : s;
}
function _parseKeywords(v) {
  return _cell(v).split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
}
function _isColor(v) { return /^#[0-9a-fA-F]{6}$/.test(v); }

/**
 * Разбирает документ «Виды связей» города.
 * Терпим к ручной правке (§9): битая строка пропускается и попадает в `errors`,
 * документ при чтении не переписывается. Дубль имени (без учёта регистра, в обоих
 * разделах сразу) — тоже `errors`: вторая строка отбрасывается, иначе «сделать
 * постоянной» и резолвер получили бы двух кандидатов на одно имя.
 * @param {string} rawContent — содержимое `rules/relation_types.md`
 * @returns {{permanent: Entry[], authored: Entry[], errors: string[]}}
 *   Entry = {slug, name, color, pair, keywords: string[]}
 */
function parseRelationTypesDoc(rawContent) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const out = { permanent: [], authored: [], errors: [] };
  const seenNames = new Map(); // имя без регистра → раздел, где уже встретилось
  const seenSlugs = new Set();

  let bucket = null;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    const head = line.match(/^##\s+(.+?)\s*$/);
    if (head) {
      const title = head[1].trim().toLowerCase();
      bucket = title === SECTION_PERMANENT.toLowerCase() ? out.permanent
             : title === SECTION_AUTHORED.toLowerCase()  ? out.authored
             : null;
      continue;
    }
    if (!bucket || !line.startsWith('|')) continue;

    const cells = _splitRow(line);
    if (cells.length < 3) continue;                       // не строка таблицы видов
    if (/^-{2,}$|^:?-+:?$/.test(cells[0])) continue;      // разделитель шапки
    if (cells[0] === 'Вид') continue;                     // шапка

    const name  = _cell(cells[0]);
    const slug  = _cell(cells[1]) || slugify(name);
    const color = _cell(cells[2]);
    const pair  = _cell(cells[3]);
    const keywords = _parseKeywords(cells[4]);

    if (!name)            { out.errors.push(`строка без имени вида: ${line}`); continue; }
    if (!slug)            { out.errors.push(`не удалось построить слаг для «${name}»`); continue; }
    if (!_isColor(color)) { out.errors.push(`«${name}»: цвет «${cells[2]}» не в формате #RRGGBB`); continue; }
    if (RESERVED_SLUGS.has(slug) || RESERVED_NAMES.has(name.toLowerCase())) {
      out.errors.push(`«${name}» — зарезервированное имя графа, строка пропущена`);
      continue;
    }
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) {
      out.errors.push(`дубль имени «${name}» (уже есть в разделе «${seenNames.get(nameKey)}»), строка пропущена`);
      continue;
    }
    if (seenSlugs.has(slug)) {
      out.errors.push(`дубль слага «${slug}» у «${name}», строка пропущена`);
      continue;
    }
    seenNames.set(nameKey, bucket === out.permanent ? SECTION_PERMANENT : SECTION_AUTHORED);
    seenSlugs.add(slug);
    bucket.push({ slug, name, color, pair, keywords });
  }

  return out;
}

// ── Сборка ───────────────────────────────────────────────────────────────────

const TABLE_HEAD = '| Вид | Слаг | Цвет | Пара | Ключевые слова |\n|---|---|---|---|---|';

function _row(e) {
  const kw = (e.keywords || []).join(', ');
  return `| ${e.name} | ${e.slug} | ${e.color} | ${e.pair || EMPTY_CELL} | ${kw || EMPTY_CELL} |`;
}

/**
 * Собирает документ «Виды связей» города. Раздел без записей остаётся заголовком
 * с шапкой таблицы — чтобы и парсер, и глаз видели, что раздел существует (§4.1).
 * @param {{display?: string, permanent?: Entry[], authored?: Entry[]}} doc
 * @returns {string} markdown
 */
function buildRelationTypesDoc({ display, permanent = [], authored = [] } = {}) {
  const title = String(display || '').trim();
  return [
    `# 🔗 Виды связей${title ? ` — ${title}` : ''}`,
    '',
    '> Словарь видов связи этого города. Правится из веба (граф → «Связи») и руками.',
    '> Порядок строк = приоритет: при совпадении по ключевым словам побеждает верхняя.',
    '> Формат — docs/design/2026-08-26-relation-types-city-document-techspec.md',
    '',
    `## ${SECTION_PERMANENT}`,
    '',
    TABLE_HEAD,
    ...permanent.map(_row),
    '',
    `## ${SECTION_AUTHORED}`,
    '',
    TABLE_HEAD,
    ...authored.map(_row),
    '',
  ].join('\n');
}

module.exports = {
  SECTION_PERMANENT, SECTION_AUTHORED, PAIR_BY_GENDER, EMPTY_CELL,
  RESERVED_SLUGS, RESERVED_NAMES,
  seedPermanentEntries, canonSlugs, legacyAuthoredEntries,
  parseRelationTypesDoc, buildRelationTypesDoc,
};
