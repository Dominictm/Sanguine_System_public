'use strict';
// Роутер «Имущество» (Архив → Имущество): общегородской склад предметов.
// Категории — глобальные (system/property/categories.json), предметы — per-city
// (cities/<город>/property/items/*.md + img/). Мягкое удаление — через web/lib/trash.js.
// Спека: doc/specs/archive-property/spec.md.

const express = require('express');
const fs      = require('fs').promises;
const { serverError, validateImageUpload } = require('../lib/http');
const { reqCity } = require('../lib/db');
const { slugify, sanitizeInlineText } = require('../lib/parsers');
const { moveToTrash, KIND } = require('../lib/trash');
const P = require('../lib/property');

const router = express.Router();

const MAX_NAME = 200, MAX_DESC = 1000, MAX_OWNER = 200, MAX_PRICE = 200, MAX_QTY = 999999;

// ── Валидация свободного текста в поля MD ────────────────────────────────────
function _cleanInline(v, max) {
  const s = sanitizeInlineText(v).replace(/[[\]]/g, '').trim();
  return s.slice(0, max);
}
function validateName(raw) {
  const name = _cleanInline(raw, MAX_NAME);
  if (!name) return { error: 'Название обязательно' };
  return { name };
}

// ── Категории ────────────────────────────────────────────────────────────────

function findCategory(list, id) { return list.find(c => c.id === id); }

router.get('/api/property/categories', async (_req, res) => {
  try {
    const list = await P.loadCategories();
    res.json({ ok: true, categories: list.slice().sort((a, b) => (a.order || 0) - (b.order || 0)) });
  } catch (e) { serverError(res, e); }
});

router.post('/api/property/categories', async (req, res) => {
  try {
    const v = validateName(req.body && req.body.name);
    if (v.error) return res.status(400).json({ ok: false, error: v.error });
    const list = await P.loadCategories();
    if (list.some(c => c.name.toLowerCase() === v.name.toLowerCase()))
      return res.status(409).json({ ok: false, error: 'Категория с таким названием уже есть' });
    let id = slugify(v.name) || `cat_${Date.now()}`;
    if (findCategory(list, id)) id = `${id}_${Date.now()}`;
    const cat = { id, name: v.name, order: list.length };
    list.push(cat);
    await P.saveCategories(list);
    res.status(201).json({ ok: true, category: cat });
  } catch (e) { serverError(res, e); }
});

router.put('/api/property/categories/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const list = await P.loadCategories();
    const cat = findCategory(list, id);
    if (!cat) return res.status(404).json({ ok: false, error: 'Категория не найдена' });
    if (req.body && req.body.name !== undefined) {
      const v = validateName(req.body.name);
      if (v.error) return res.status(400).json({ ok: false, error: v.error });
      if (list.some(c => c.id !== id && c.name.toLowerCase() === v.name.toLowerCase()))
        return res.status(409).json({ ok: false, error: 'Категория с таким названием уже есть' });
      const oldName = cat.name;
      cat.name = v.name;
      if (oldName !== v.name) await P.cascadeRenameCategory(oldName, v.name);
    }
    if (req.body && req.body.order !== undefined) {
      const o = parseInt(req.body.order, 10);
      if (Number.isFinite(o)) cat.order = o;
    }
    await P.saveCategories(list);
    res.json({ ok: true, category: cat });
  } catch (e) { serverError(res, e); }
});

// Удаление категории: категория → в корзину (JSON-трек), все её предметы во ВСЕХ
// городах → в per-city корзины. Только по явному подтверждению на клиенте.
router.delete('/api/property/categories/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const list = await P.loadCategories();
    const cat = findCategory(list, id);
    if (!cat) return res.status(404).json({ ok: false, error: 'Категория не найдена' });

    const removedItems = await P.cascadeDeleteCategoryItems(cat.name);
    for (const { city, slug } of removedItems) {
      try {
        await moveToTrash({
          src: P.itemPath(city, slug),
          kind: KIND.PROPERTY_ITEM, city, slug,
          extra: { category: cat.name, display: slug },
        });
      } catch { /* best-effort: файла может не быть */ }
    }

    await moveToTrash({
      kind: KIND.PROPERTY_CATEGORY,
      storedName: cat.id,
      extra: { id: cat.id, name: cat.name, order: cat.order },
    });

    await P.saveCategories(list.filter(c => c.id !== id));
    res.json({ ok: true, deletedItems: removedItems.length });
  } catch (e) { serverError(res, e); }
});

// ── Предметы (per-city) ──────────────────────────────────────────────────────

// Разрешает category id → name (и обратно) по текущему списку категорий.
function _catByName(list, name) { return list.find(c => c.name === name); }

// Дополняет предмет ссылками на изображение и id категории для клиента.
function decorate(city, item, list) {
  const cat = _catByName(list, item.category);
  return {
    ...item,
    categoryId: cat ? cat.id : '',
    imageUrl: P.imageUrl(city, item.image),
    thumbUrl: P.imageThumbUrl(city, item.image, 640),
  };
}

router.get('/api/property/items', async (req, res) => {
  try {
    const city = reqCity(req);
    const [items, categories] = await Promise.all([P.listItems(city), P.loadCategories()]);
    let out = items;
    if (req.query.category) {
      const cat = findCategory(categories, req.query.category);
      if (cat) out = items.filter(i => i.category === cat.name);
      else out = [];
    }
    res.json({ ok: true, city, items: out.map(i => decorate(city, i, categories)) });
  } catch (e) { serverError(res, e); }
});

// Тело: { name*, category*(id), description, quantity, owner|owners, unique, price, stats,
//         base64?, ext? } — изображение в base64 (паттерн upload-belonging).
// owners: [{ name*, qty? }] (qty по умолчанию 1); legacy owner: строка → один
// владелец с qty = quantity. Имя с запятой → 400 (разделитель формата, §12).
function _parseOwners(b, fallbackQty) {
  if (b.owners !== undefined) {
    if (!Array.isArray(b.owners)) return { error: 'Владельцы должны быть списком' };
    const out = [];
    for (const o of b.owners) {
      const name = _cleanInline(o && o.name, MAX_OWNER);
      if (!name) return { error: 'Имя владельца обязательно' };
      if (name.includes(',')) return { error: 'Имя владельца не должно содержать запятую' };
      let qty = o.qty === undefined ? 1 : parseInt(o.qty, 10);
      if (!Number.isFinite(qty) || qty < 1) return { error: 'Количество владельца — целое ≥ 1' };
      qty = Math.min(qty, MAX_QTY);
      const ex = out.find(x => x.name === name);
      if (ex) ex.qty = Math.min(ex.qty + qty, MAX_QTY); else out.push({ name, qty });
    }
    return { owners: out };
  }
  if (b.owner !== undefined && String(b.owner || '').trim() !== '') {
    const name = _cleanInline(b.owner, MAX_OWNER);
    if (!name) return { error: 'Имя владельца обязательно' };
    if (name.includes(',')) return { error: 'Имя владельца не должно содержать запятую' };
    // Legacy: количество из общего поля quantity (спека §12).
    return { owners: [{ name, qty: fallbackQty }] };
  }
  return { owners: [] };
}

function _parseItemBody(req, categories) {
  const b = req.body || {};
  const nv = validateName(b.name);
  if (nv.error) return { error: nv.error };
  const cat = findCategory(categories, b.category);
  if (!cat) return { error: 'Категория не найдена' };

  const description = String(b.description || '').slice(0, MAX_DESC).trim();
  const stats       = String(b.stats || '').slice(0, MAX_DESC).trim();
  const price       = _cleanInline(b.price, MAX_PRICE);
  let quantity = parseInt(b.quantity, 10);
  if (!Number.isFinite(quantity) || quantity < 0) quantity = 1;
  quantity = Math.min(quantity, MAX_QTY);

  const ow = _parseOwners(b, quantity);
  if (ow.error) return { error: ow.error };
  // Явный массив owners: количество — производное (сумма). Legacy owner-строка
  // уже несёт qty = quantity, своё поле не трогаем (регрессия старых тестов).
  if (b.owners !== undefined && ow.owners.length)
    quantity = ow.owners.reduce((s, o) => s + o.qty, 0);

  // Уникальный предмет — максимум один владелец, всегда в единственном экземпляре.
  const unique = b.unique === true || b.unique === 'true';
  if (unique && ow.owners.length > 1) return { error: 'У уникального предмета может быть только один владелец' };
  if (unique) { ow.owners.forEach(o => { o.qty = 1; }); quantity = 1; }

  return { name: nv.name, categoryName: cat.name, categoryId: cat.id, description, stats, owners: ow.owners, owner: ow.owners.length === 1 ? ow.owners[0].name : '', unique, price, quantity };
}

router.post('/api/property/items', express.json({ limit: '20mb' }), async (req, res) => {
  try {
    const city = reqCity(req);
    const categories = await P.loadCategories();
    const parsed = _parseItemBody(req, categories);
    if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

    const slug = slugify(parsed.name);
    if (!P.isSafeSlug(slug)) return res.status(400).json({ ok: false, error: 'Некорректное название предмета' });
    if (await P.readItem(city, slug))
      return res.status(409).json({ ok: false, error: 'Предмет с таким названием уже есть в этом городе' });

    let image = '';
    if (req.body && req.body.base64) {
      const val = validateImageUpload(req.body.base64, req.body.ext);
      if (!val.ok) return res.status(400).json({ ok: false, error: val.error });
      image = await P.nextImageName(city, slug, val.ext);
      await P.writeImage(city, image, val.buffer);
    }

    const item = { slug, name: parsed.name, category: parsed.categoryName, description: parsed.description,
      quantity: parsed.quantity, owners: parsed.owners, owner: parsed.owner, unique: parsed.unique, price: parsed.price, image, stats: parsed.stats };
    await P.writeItem(city, slug, item);
    res.status(201).json({ ok: true, item: decorate(city, item, categories) });
  } catch (e) { serverError(res, e); }
});

router.put('/api/property/items/:slug', express.json({ limit: '20mb' }), async (req, res) => {
  try {
    const city = reqCity(req);
    const slug = req.params.slug;
    if (!P.isSafeSlug(slug)) return res.status(400).json({ ok: false, error: 'Некорректный слаг' });
    const existing = await P.readItem(city, slug);
    if (!existing) return res.status(404).json({ ok: false, error: 'Предмет не найден' });

    const categories = await P.loadCategories();
    const parsed = _parseItemBody(req, categories);
    if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

    let image = existing.image;
    if (req.body && req.body.base64) {
      const val = validateImageUpload(req.body.base64, req.body.ext);
      if (!val.ok) return res.status(400).json({ ok: false, error: val.error });
      const newImage = await P.nextImageName(city, slug, val.ext);
      await P.writeImage(city, newImage, val.buffer);
      if (existing.image && existing.image !== newImage) await P.removeImage(city, existing.image);
      image = newImage;
    }

    const item = { slug, name: parsed.name, category: parsed.categoryName, description: parsed.description,
      quantity: parsed.quantity, owners: parsed.owners, owner: parsed.owner, unique: parsed.unique, price: parsed.price, image, stats: parsed.stats };
    await P.writeItem(city, slug, item);
    res.json({ ok: true, item: decorate(city, item, categories) });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/property/items/:slug', async (req, res) => {
  try {
    const city = reqCity(req);
    const slug = req.params.slug;
    if (!P.isSafeSlug(slug)) return res.status(400).json({ ok: false, error: 'Некорректный слаг' });
    const existing = await P.readItem(city, slug);
    if (!existing) return res.status(404).json({ ok: false, error: 'Предмет не найден' });

    await moveToTrash({
      src: P.itemPath(city, slug),
      kind: KIND.PROPERTY_ITEM, city, slug,
      extra: { category: existing.category, display: existing.name },
    });
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// ── Владельцы (спека char-property-link, §12) ───────────────────────────────
// Отдельные эндпоинты вместо read-modify-write через PUT: два мастера,
// добавляющие одновременно, иначе потеряли бы друг друга.

function _parseOwnerName(raw) {
  const name = _cleanInline(raw, MAX_OWNER);
  if (!name) return { error: 'Имя владельца обязательно' };
  if (name.includes(',')) return { error: 'Имя владельца не должно содержать запятую' };
  return { name };
}

// Upsert владельца: нет — добавить (qty по умолчанию 1), есть — обновить qty
// (если передано). Без qty повторный вызов — no-op 200 (идемпотентность).
router.post('/api/property/items/:slug/owners', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const city = reqCity(req);
    const slug = req.params.slug;
    if (!P.isSafeSlug(slug)) return res.status(400).json({ ok: false, error: 'Некорректный слаг' });
    const item = await P.readItem(city, slug);
    if (!item) return res.status(404).json({ ok: false, error: 'Предмет не найден' });

    const v = _parseOwnerName(req.body && req.body.name);
    if (v.error) return res.status(400).json({ ok: false, error: v.error });
    let qty;
    if (req.body && req.body.qty !== undefined) {
      qty = parseInt(req.body.qty, 10);
      if (!Number.isFinite(qty) || qty < 1) return res.status(400).json({ ok: false, error: 'Количество владельца — целое ≥ 1' });
      qty = Math.min(qty, MAX_QTY);
    }

    const owners = Array.isArray(item.owners) ? item.owners.map(o => ({ ...o })) : [];
    const ex = owners.find(o => o.name === v.name);
    // Уникальный предмет уже у другого персонажа — второго владельца не бывает.
    if (item.unique && !ex && owners.length)
      return res.status(409).json({ ok: false, error: `Уникальный предмет уже принадлежит: ${owners[0].name}` });
    if (item.unique) qty = 1;
    if (ex) { if (qty !== undefined) ex.qty = qty; }
    else owners.push({ name: v.name, qty: qty === undefined ? 1 : qty });
    item.owners = owners;
    item.owner = owners.length === 1 ? owners[0].name : '';
    item.quantity = P.ownersTotalQty(owners);
    await P.writeItem(city, slug, item);

    const categories = await P.loadCategories();
    res.json({ ok: true, item: decorate(city, item, categories) });
  } catch (e) { serverError(res, e); }
});

// Снять владельца. Предмет без владельцев остаётся в разделе (виден только там).
router.delete('/api/property/items/:slug/owners/:name', async (req, res) => {
  try {
    const city = reqCity(req);
    const slug = req.params.slug;
    if (!P.isSafeSlug(slug)) return res.status(400).json({ ok: false, error: 'Некорректный слаг' });
    const item = await P.readItem(city, slug);
    if (!item) return res.status(404).json({ ok: false, error: 'Предмет не найден' });

    const name = decodeURIComponent(req.params.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'Имя владельца обязательно' });
    const owners = (Array.isArray(item.owners) ? item.owners : []).filter(o => o.name !== name);
    if (owners.length === (item.owners || []).length)
      return res.status(404).json({ ok: false, error: 'Такого владельца у предмета нет' });
    item.owners = owners;
    item.owner = owners.length === 1 ? owners[0].name : '';
    item.quantity = owners.length ? P.ownersTotalQty(owners) : (item.quantity || 1);
    await P.writeItem(city, slug, item);

    const categories = await P.loadCategories();
    res.json({ ok: true, item: decorate(city, item, categories) });
  } catch (e) { serverError(res, e); }
});

module.exports = { router };
