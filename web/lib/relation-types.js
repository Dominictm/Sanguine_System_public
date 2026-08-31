'use strict';
// Виды связей персонажей — ОДИН документ на город, cities/<город>/rules/relation_types.md
// (техспека docs/design/2026-08-26-relation-types-city-document-techspec.md).
//
// До 2026-08-26 то же понятие описывали четыре независимых хардкода: глобальный
// system/library/relation-types.json, categorizeRel() по ключевым словам,
// REL_LABELS/REL_COLORS графа и REL_AUTO_PAIRS в двух копиях. Они расходились, и одно
// понятие давало на графе два чипа. Здесь — файловый слой и резолвер над документом;
// разбор/сборка самого markdown — web/lib/parsers/relation-types.js.
//
// system/library/relation-types.json остаётся, но меняет роль: из живого хранилища
// становится ЭТАЛОННЫМ СИДОМ (11 канонических видов для каркаса нового города) и
// списком слагов, защищённых от переименования/удаления.

const fs   = require('fs').promises;
const path = require('path');
const { ROOT, cityDir, writeFileAtomic } = require('./db');
const { slugify, parseCityMd } = require('./parsers');
const {
  parseRelationTypesDoc, buildRelationTypesDoc, seedPermanentEntries, canonSlugs,
  PAIR_BY_GENDER, RESERVED_SLUGS, RESERVED_NAMES,
} = require('./parsers/relation-types');

const SEED_FILE = path.join(ROOT, 'system', 'library', 'relation-types.json');
const DOC_REL_PATH = path.join('rules', 'relation_types.md');
const CANON_SLUGS = new Set(canonSlugs());

const relationTypesPath = city => path.join(cityDir(city), DOC_REL_PATH);
const isCanonSlug = slug => CANON_SLUGS.has(String(slug || ''));

// Случайный цвет (2026-08-08, п.9 запроса) — HSL с фиксированным диапазоном S/L, подобранным
// под палитру графа (средняя насыщенность/светлота, читаемо на тёмном фоне интерфейса):
// случайно варьируется только оттенок (H).
function randomRelColor() {
  const h = Math.floor(Math.random() * 360);
  const s = 55 + Math.floor(Math.random() * 15); // 55–70%
  const l = 45 + Math.floor(Math.random() * 10); // 45–55%
  return hslToHex(h, s, l);
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// ── Чтение / запись документа ────────────────────────────────────────────────

/**
 * Читает документ города. Отсутствие файла — не ошибка: город, созданный до
 * миграции 008 и не прошедший её (например каталог, который раннер миграций
 * пропустил), работает по сиду, а не остаётся вообще без словаря.
 * @param {string} city — слаг города
 * @returns {Promise<{permanent: Entry[], authored: Entry[], errors: string[], exists: boolean, title: string}>}
 */
async function readRelationTypesDoc(city) {
  let raw = null;
  try { raw = await fs.readFile(relationTypesPath(city), 'utf-8'); } catch {}
  if (raw === null) {
    return { permanent: seedPermanentEntries(), authored: [], errors: [], exists: false, title: await _cityDisplay(city) };
  }
  const doc = parseRelationTypesDoc(raw);
  // Битая ручная правка не должна ронять граф/модалку — строка пропускается, а факт
  // виден в логе сервера (§9 техспеки). Документ при чтении не переписывается.
  if (doc.errors.length) {
    console.warn(`[relation-types] ${city}/${DOC_REL_PATH}: ${doc.errors.join('; ')}`);
  }
  const h1 = raw.match(/^#\s+.*?Виды связей\s*—\s*(.+?)\s*$/m);
  return { ...doc, exists: true, title: h1 ? h1[1].trim() : await _cityDisplay(city) };
}

// То же имя города, что у cityScaffold() (display без года) — заголовок документа
// не должен отличаться между мигрированным и свежесозданным городом.
async function _cityDisplay(city) {
  try { return parseCityMd(await fs.readFile(path.join(cityDir(city), 'city.md'), 'utf-8')).display || ''; }
  catch { return ''; }
}

/** Атомарно перезаписывает документ города, сохраняя заголовок. */
async function writeRelationTypesDoc(city, { permanent, authored, title }) {
  const display = title !== undefined ? title : (await readRelationTypesDoc(city)).title;
  const md = buildRelationTypesDoc({ display, permanent, authored });
  await fs.mkdir(path.dirname(relationTypesPath(city)), { recursive: true });
  await writeFileAtomic(relationTypesPath(city), md, 'utf-8');
  return md;
}

// ── Резолвер типа связи (§3.2 техспеки) ──────────────────────────────────────

/**
 * Единый порядок разрешения вида связи — им пользуются и /api/graph, и модалка,
 * и запись карточки. Заменил categorizeRel(): цепочка `if`-ов по ключевым словам
 * переехала в документ, где порядок строк виден и правится перестановкой.
 *
 * 1. Структурное поле `[Тип]` — точное совпадение имени, «Постоянные» раньше «Авторских».
 * 2. `[Тип]` заполнен, но не найден → новый авторский вид (синтетическая запись,
 *    unknown:true — при сохранении карточки он допишется в «Авторские», §4.4).
 * 3. `[Тип]` пуст → подстрочный поиск ИМЕНИ вида в описании, длинные имена раньше коротких.
 * 4. Не нашли → ключевые слова, в порядке строк документа сверху вниз.
 * 5. Не нашли → null (граф покажет neutral).
 *
 * @param {{permanent: Entry[], authored: Entry[]}} doc
 * @returns {(relType: string, description: string) => (Entry & {section, canon, unknown?})|null}
 */
function makeRelationResolver(doc) {
  const permanent = doc.permanent.map(e => ({ ...e, section: 'permanent', canon: isCanonSlug(e.slug) }));
  const authored  = doc.authored.map(e => ({ ...e, section: 'authored', canon: false }));
  const all = [...permanent, ...authored];
  const byName = new Map(all.map(e => [e.name.trim().toLowerCase(), e]));
  // Порядок для шага 3: внутри раздела — от длинного имени к короткому (специфичное
  // раньше общего), но «Постоянные» целиком раньше «Авторских».
  const byLen = s => [...s].sort((a, b) => b.name.length - a.name.length);
  const nameScan = [...byLen(permanent), ...byLen(authored)];

  return function resolveRelation(relType, description) {
    const t = String(relType || '').trim();
    if (t) {
      const exact = byName.get(t.toLowerCase());
      if (exact) return exact;
      // Вид, которого в документе ещё нет: слаг/имя известны, цвета нет — граф
      // покрасит его нейтральным до тех пор, пока запись не появится в «Авторских».
      return { slug: slugify(t) || 'neutral', name: t, color: '', pair: '', keywords: [], section: 'authored', canon: false, unknown: true };
    }
    const d = String(description || '').toLowerCase();
    if (!d) return null;
    for (const e of nameScan) { if (d.includes(e.name.toLowerCase())) return e; }
    for (const e of all) { if (e.keywords.some(k => d.includes(k))) return e; }
    return null;
  };
}

/** Резолвер для города — одно чтение документа на вызов. */
async function getRelationResolver(city) {
  const doc = await readRelationTypesDoc(city);
  return { doc, resolve: makeRelationResolver(doc) };
}

// ── Зеркальные пары (§4.6) ───────────────────────────────────────────────────

/**
 * Имя вида для зеркальной («Взаимно») строки на карточке цели. Колонка «Пара»
 * заместила REL_AUTO_PAIRS: литерал «по полу» — прежняя логика Брат/Сестра по полю
 * «Пол» ЦЕЛИ, пустая пара — зеркалим тем же именем (симметричный вид).
 * @param {{permanent, authored}} doc
 * @param {string} typeName — вид на стороне источника
 * @param {string} targetGender — «Мужской» / «Женский» / '' у легаси-карточки без поля
 */
function mirrorTypeName(doc, typeName, targetGender) {
  const t = String(typeName || '').trim();
  if (!t) return '';
  const entry = [...doc.permanent, ...doc.authored].find(e => e.name.toLowerCase() === t.toLowerCase());
  const pair = entry ? String(entry.pair || '').trim() : '';
  if (!pair) return t;
  if (pair.toLowerCase() === PAIR_BY_GENDER) {
    if (targetGender === 'Мужской') return 'Брат';
    if (targetGender === 'Женский') return 'Сестра';
    return t; // пол цели неизвестен — зеркалим тем же словом
  }
  return pair;
}

// ── Авто-регистрация новых авторских видов (§4.4) ────────────────────────────

/**
 * Дописывает в «Авторские» те `[Тип]`, которых нет ни в одном разделе. Это замена
 * прежней вычисляемой на лету агрегации `_authoredDescriptions()`: раздел ведёт
 * себя как журнал того, что Рассказчик действительно использует, и переживает
 * перезагрузку. Повторное сохранение той же связи ничего не дублирует.
 * @returns {Promise<string[]>} имена добавленных видов
 */
async function ensureAuthoredTypes(city, typeNames) {
  const names = [...new Set((typeNames || []).map(n => String(n || '').trim()).filter(Boolean))];
  if (!names.length) return [];
  const doc = await readRelationTypesDoc(city);
  const known = new Set([...doc.permanent, ...doc.authored].map(e => e.name.toLowerCase()));
  const slugs = new Set([...doc.permanent, ...doc.authored].map(e => e.slug));
  const added = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (known.has(key) || RESERVED_NAMES.has(key)) continue;
    let slug = slugify(name);
    if (!slug || RESERVED_SLUGS.has(slug)) continue;
    // Слаг — ключ ребра графа, он обязан быть уникальным: два разных имени могут
    // дать один слаг («Друг/друг.» → drug), тогда фильтр графа склеил бы их в один чип.
    if (slugs.has(slug)) {
      let i = 2;
      while (slugs.has(`${slug}_${i}`)) i++;
      slug = `${slug}_${i}`;
    }
    doc.authored.push({ slug, name, color: randomRelColor(), pair: '', keywords: [] });
    known.add(key); slugs.add(slug);
    added.push(name);
  }
  if (added.length) await writeRelationTypesDoc(city, doc);
  return added;
}

module.exports = {
  SEED_FILE, DOC_REL_PATH, relationTypesPath,
  isCanonSlug, randomRelColor,
  readRelationTypesDoc, writeRelationTypesDoc,
  makeRelationResolver, getRelationResolver,
  mirrorTypeName, ensureAuthoredTypes,
};
