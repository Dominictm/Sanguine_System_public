'use strict';
// Имущество города (Архив → Имущество) — общегородской склад предметов.
//
// Хранение (Hybrid, спека doc/specs/archive-property/spec.md §8):
//   • Категории — ГЛОБАЛЬНЫЕ: system/property/categories.json ([{id,name,order}]).
//     Seed дефолтных 5 вкладок — только при отсутствии файла (после удаления
//     всех категорий файл остаётся [], авто-восстановления нет).
//   • Предметы — per-city: cities/<город>/property/items/<slug>.md (по файлу на
//     предмет), изображения — cities/<город>/property/img/<файл>.
//   • Корзина — cities/<город>/property/_deleted/ (предметы),
//     system/property/_deleted.json (категории). См. web/lib/trash.js.
//
// Разметка предмета (MD):
//   # Название
//
//   **Категория:** Транспорт
//   **Количество:** 3
//   **Владельцы:** Князь, Анна ×2
//   **Уникальный:** да          (только у уникальных; владелец ≤ 1)
//   **Цена:** 500 $
//
//   ![Название](../img/<файл>)
//
//   ## Описание
//   …
//
//   ## Характеристики
//   …

const path = require('path');
const fs   = require('fs').promises;
const { ROOT, CITIES_DIR, cityDir, listCities, writeFileAtomic } = require('./db');

const PROPERTY_DIRNAME = 'property';
const ITEMS_SUBDIR     = 'items';
const IMG_SUBDIR       = 'img';
const DELETED_SUBDIR   = '_deleted';

const CATEGORIES_FILE         = path.join(ROOT, 'system', 'property', 'categories.json');
const CATEGORIES_DELETED_FILE = path.join(ROOT, 'system', 'property', '_deleted.json');

const propertyDir = city => path.join(cityDir(city), PROPERTY_DIRNAME);
const itemsDir    = city => path.join(propertyDir(city), ITEMS_SUBDIR);
const imgDir      = city => path.join(propertyDir(city), IMG_SUBDIR);
const itemDeletedDir = city => path.join(propertyDir(city), DELETED_SUBDIR);
const itemPath    = (city, slug) => path.join(itemsDir(city), `${slug}.md`);

// ── Категории (глобальные, system/property/categories.json) ──────────────────

const DEFAULT_CATEGORIES = () => ([
  { id: 'transport', name: 'Транспорт', order: 0 },
  { id: 'weapons',   name: 'Оружие',    order: 1 },
  { id: 'armor',     name: 'Броня',     order: 2 },
  { id: 'artifacts', name: 'Артефакты', order: 3 },
  { id: 'misc',      name: 'Мелочи',    order: 4 },
]);

function _readJsonArray(file) {
  return fs.readFile(file, 'utf-8').then(raw => {
    const arr = JSON.parse(raw.replace(/^﻿/, ''));
    return Array.isArray(arr) ? arr : [];
  }).catch(() => null);
}

// Категории; при отсутствии файла — сид дефолтных 5 и запись на диск.
async function loadCategories() {
  const arr = await _readJsonArray(CATEGORIES_FILE);
  if (arr !== null) return arr;
  const seed = DEFAULT_CATEGORIES();
  await saveCategories(seed);
  return seed;
}

async function saveCategories(list) {
  await fs.mkdir(path.dirname(CATEGORIES_FILE), { recursive: true });
  await writeFileAtomic(CATEGORIES_FILE, JSON.stringify(list, null, 2) + '\n', 'utf-8');
}

// ── Предметы (per-city) ──────────────────────────────────────────────────────

const FIELD_LABELS = { category: 'Категория', quantity: 'Количество', owner: 'Владелец', owners: 'Владельцы', unique: 'Уникальный', price: 'Цена' };

// ── Владельцы (спека char-property-link, §12) ─────────────────────────────────
// Формат: `- **Владельцы:** Анна ×2, Борис` (без суффикса = ×1). Разделитель —
// запятая; запятая в имени запрещена валидацией (400). Старая метка
// `- **Владелец:**` читается как один владелец с qty = quantity (legacy).
function parseOwners(mdLine, fallbackQty) {
  const out = [];
  for (const part of String(mdLine || '').split(',')) {
    const m = part.trim().match(/^(.*?)(?:\s*[×x]\s*(\d+))?$/);
    if (!m) continue;
    const name = (m[1] || '').trim();
    if (!name) continue;
    let qty = m[2] === undefined ? fallbackQty : parseInt(m[2], 10);
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    out.push({ name, qty });
  }
  // Дубли имён (ручная правка MD) схлопываются, количества суммируются.
  const merged = [];
  for (const o of out) {
    const ex = merged.find(x => x.name === o.name);
    if (ex) ex.qty += o.qty; else merged.push({ ...o });
  }
  return merged;
}

function formatOwners(owners) {
  return (owners || []).map(o => (o.qty && o.qty !== 1) ? `${o.name} ×${o.qty}` : o.name).join(', ');
}

function ownersTotalQty(owners) {
  return (owners || []).reduce((s, o) => s + (Number.isFinite(o.qty) && o.qty > 0 ? o.qty : 1), 0);
}

function _fieldRe(label) { return new RegExp(`\\*\\*${label}:\\*\\*[ \\t]*(.*)$`, 'm'); }

function _block(md, heading) {
  const re = new RegExp(`^##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=^##\\s|\\s*$)`, 'm');
  const m = md.match(re);
  return m ? m[1].replace(/^🤍/, '').trim() : '';
}

function _splitBlocks(text) {
  const out = [];
  const re = /^##\s+(.+?)\s*\n([\s\S]*?)(?=^##\s|\s*$)/gm;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ heading: m[1].trim(), body: m[2].trim() });
  return out;
}

// Парсит MD предмета в объект (image — только имя файла).
function parseItemMd(md, slug) {
  md = String(md || '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const name = (md.match(/^#\s+(.+)$/m)?.[1] || slug || '').trim();
  const blocks = _splitBlocks(md);
  const findBlock = names => blocks.find(b => names.some(n => b.heading.toLowerCase().includes(n)));
  const imgM = md.match(/!\[[^\]]*\]\(([^)]+)\)/);
  const quantity = parseInt((md.match(_fieldRe('Количество'))?.[1] || '1').trim(), 10) || 0;
  // Новая метка «Владельцы» — массив; legacy «Владелец» — один с qty = quantity.
  const ownersLine = md.match(_fieldRe('Владельцы'))?.[1];
  const legacyOwner = (md.match(_fieldRe('Владелец'))?.[1] || '').trim();
  const owners = ownersLine !== undefined
    ? parseOwners(ownersLine, 1)
    : (legacyOwner ? [{ name: legacyOwner, qty: quantity || 1 }] : []);
  return {
    slug,
    name,
    category:     (md.match(_fieldRe('Категория'))?.[1]  || '').trim(),
    quantity:     owners.length ? ownersTotalQty(owners) : quantity,
    owner:        owners.length === 1 ? owners[0].name
                  : (legacyOwner && !owners.length ? legacyOwner : ''),
    owners,
    // Уникальный предмет: не больше одного владельца, в пикер карточки не попадает.
    unique:       /^(да|yes|true|1)$/i.test((md.match(_fieldRe('Уникальный'))?.[1] || '').trim()),
    price:        (md.match(_fieldRe('Цена'))?.[1]       || '').trim(),
    image:        imgM ? path.basename(decodeURIComponent(imgM[1].trim())) : '',
    description:  findBlock(['описание'])?.body || '',
    stats:        findBlock(['характеристик'])?.body || '',
  };
}

function buildItemMd(item) {
  const owners = Array.isArray(item.owners) ? item.owners.filter(o => o && o.name) : [];
  // Legacy-вход (owner-строка без owners) нормализуем в одного владельца с qty
  // из поля quantity — как делает и роут (регрессия старых тестов).
  if (!owners.length && item.owner)
    owners.push({ name: String(item.owner).trim(), qty: Number.isFinite(item.quantity) && item.quantity >= 1 ? item.quantity : 1 });
  const lines = [`# ${item.name}`, ''];
  lines.push(`**${FIELD_LABELS.category}:** ${item.category}`);
  lines.push(`**${FIELD_LABELS.quantity}:** ${owners.length ? ownersTotalQty(owners)
    : (Number.isFinite(item.quantity) ? item.quantity : 1)}`);
  if (owners.length) lines.push(`**${FIELD_LABELS.owners}:** ${formatOwners(owners)}`);
  else if (item.owner) lines.push(`**${FIELD_LABELS.owner}:** ${item.owner}`);
  if (item.unique) lines.push(`**${FIELD_LABELS.unique}:** да`);
  if (item.price) lines.push(`**${FIELD_LABELS.price}:** ${item.price}`);
  if (item.image) {
    lines.push('');
    lines.push(`![${item.name}](../${IMG_SUBDIR}/${encodeURIComponent(item.image)})`);
  }
  lines.push('');
  lines.push('## Описание');
  lines.push('');
  lines.push(item.description || '');
  lines.push('');
  lines.push('## Характеристики');
  lines.push('');
  lines.push(item.stats || '');
  lines.push('');
  return lines.join('\n');
}

// Все предметы города (каталог items/, `_`-папки пропускаются).
async function listItems(city) {
  const dir = itemsDir(city);
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md') || e.name.startsWith('_')) continue;
    const slug = e.name.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(dir, e.name), 'utf-8').catch(() => '');
    if (md) out.push(parseItemMd(md, slug));
  }
  return out;
}

async function readItem(city, slug) {
  if (!isSafeSlug(slug)) return null;
  const md = await fs.readFile(itemPath(city, slug), 'utf-8').catch(() => null);
  return md === null ? null : parseItemMd(md, slug);
}

async function writeItem(city, slug, item) {
  await fs.mkdir(itemsDir(city), { recursive: true });
  await writeFileAtomic(itemPath(city, slug), buildItemMd(item), 'utf-8');
}

async function removeItemFile(city, slug) {
  await fs.rm(itemPath(city, slug), { force: true });
}

// Проверка «слаг — безопасное имя файла».
function isSafeSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9][a-z0-9_]*$/.test(slug);
}

// Следующий свободный номер изображения для предмета: <slug>_<NN>.<ext>.
async function nextImageName(city, slug, ext) {
  const dir = imgDir(city);
  const existing = await fs.readdir(dir).catch(() => []);
  const prefix = `${slug}_`;
  const nums = existing
    .filter(f => f.startsWith(prefix))
    .map(f => { const m = f.match(/_(\d+)\.[a-z0-9]+$/i); return m ? parseInt(m[1], 10) : 0; })
    .filter(n => n > 0);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `${slug}_${String(next).padStart(2, '0')}.${ext}`;
}

async function writeImage(city, filename, buffer) {
  const dir = imgDir(city);
  await fs.mkdir(dir, { recursive: true });
  await writeFileAtomic(path.join(dir, filename), buffer);
}

async function removeImage(city, filename) {
  if (!filename) return;
  await fs.rm(path.join(imgDir(city), path.basename(filename)), { force: true }).catch(() => {});
}

// Изображение по ссылке из MD (../img/<file>) → URL-путь /city-img/<city>/property/img/<file>.
function imageUrl(city, filename) {
  if (!filename) return '';
  return `/city-img/${city}/${PROPERTY_DIRNAME}/${IMG_SUBDIR}/${encodeURIComponent(filename)}`;
}
function imageThumbUrl(city, filename, w = 640) {
  if (!filename) return '';
  return `/city-img-thumb/${city}/${PROPERTY_DIRNAME}/${IMG_SUBDIR}/${encodeURIComponent(filename)}?w=${w}`;
}

// ── Каскад: категория переименована/удалена во всех городах ──────────────────
// best-effort: ошибка в городе не роняет операцию (см. спеку §8).

async function cascadeRenameCategory(oldName, newName) {
  const cities = await listCities();
  let touched = 0;
  for (const city of cities) {
    const items = await listItems(city);
    for (const it of items) {
      if (it.category === oldName) {
        it.category = newName;
        try { await writeItem(city, it.slug, it); touched++; } catch { /* best-effort */ }
      }
    }
  }
  return touched;
}

// Возвращает список {city, slug} удалённых предметов (для ответа DELETE).
async function cascadeDeleteCategoryItems(categoryName) {
  const cities = await listCities();
  const removed = [];
  for (const city of cities) {
    const items = await listItems(city);
    for (const it of items) {
      if (it.category === categoryName) removed.push({ city, slug: it.slug });
    }
  }
  return removed;
}

module.exports = {
  PROPERTY_DIRNAME, ITEMS_SUBDIR, IMG_SUBDIR, DELETED_SUBDIR,
  CATEGORIES_FILE, CATEGORIES_DELETED_FILE, DEFAULT_CATEGORIES,
  propertyDir, itemsDir, imgDir, itemDeletedDir, itemPath,
  loadCategories, saveCategories, _readJsonArray,
  parseItemMd, buildItemMd, parseOwners, formatOwners, ownersTotalQty, listItems, readItem, writeItem, removeItemFile,
  isSafeSlug, nextImageName, writeImage, removeImage, imageUrl, imageThumbUrl,
  cascadeRenameCategory, cascadeDeleteCategoryItems,
  CITIES_DIR,
};
