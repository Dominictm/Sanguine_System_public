'use strict';
// Вкладка «📁 Удалённые» — просмотр/восстановление/окончательное удаление мягко
// удалённых сущностей (города, персонажи, локации, районы, хроники, модули,
// Библиотека MD и JSON). Ходит в web/lib/trash.js (корзины + реестр происхождения).
// Спека: docs/design/2026-09-13-trash-tab-techspec.md (D1).

const express = require('express');
const {
  reqCity, invalidateChars, invalidateLocs,
} = require('../lib/db');
const trashLib = require('../lib/trash');

// Фабрика (паттерн backup.js/tools.js). DI намеренно не используется — слой ходит
// только в web/lib/trash.js и web/lib/db.js; покомпонентные тесты гоняют trash.js
// напрямую, e2e — реальный сервер с временным HOME.
function trashRouterFactory() {
  const router = express.Router();

  // GET /api/trash?city=<c> → полный список корзин.
  router.get('/api/trash', async (req, res) => {
    const city = reqCity(req);
    try {
      const rows = await trashLib.scanAllTrash(city);
      res.json({ ok: true, city, deleted: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: `Не удалось загрузить корзины: ${e.message}` });
    }
  });

  // POST /api/trash/restore {city?, kind, storedName, dir?} → одна запись.
  router.post('/api/trash/restore', async (req, res) => {
    const { kind, storedName, dir } = req.body || {};
    const city = req.body && req.body.city;
    if (!kind || !storedName) return res.status(400).json({ ok: false, error: 'Не указаны kind или storedName' });
    try {
      const r = await trashLib.restoreTrashItem({ city, kind, storedName, dir });
      // Кэши персонажей/локаций города зависят от того, что вернулось на ось.
      if (kind === 'character' || kind === 'location' || kind === 'district') {
        invalidateChars(city); invalidateLocs(city);
      }
      if (kind === 'chronicle' || kind === 'module') invalidateChars(city);
      res.json({ ok: true, target: r.target });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/trash/bulk {city?, kind?, storedNames?, all?} → restore многие.
  // storedNames могут быть смешанными kinds (kind не обязателен) — kind угадывается
  // по записям. Частичные конфликты не роняют запрос: { ok, restored, failed }.
  router.post('/api/trash/bulk', async (req, res) => {
    const { kind, storedNames, all, dir } = req.body || {};
    const city = req.body && req.body.city;
    let entries;
    try {
      entries = await _resolveBulkEntries({ city, kind, storedNames, all });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
    const { restored, failed } = await _runBulk(entries.map(e => ({ ...e, city })));
    const touched = new Set(entries.map(e => e.kind));
    if (touched.has('character') || touched.has('location') || touched.has('district')) { invalidateChars(city); invalidateLocs(city); }
    if (touched.has('chronicle') || touched.has('module')) invalidateChars(city);
    res.json({ ok: true, restored, failed: failed.map(f => ({ storedName: f.storedName, error: f.error })) });
  });

  // DELETE /api/trash {city?, kind?, storedNames?, all?} → purge навсегда.
  router.delete('/api/trash', async (req, res) => {
    const { kind, storedNames, all, dir } = req.body || {};
    const city = req.body && req.body.city;
    let entries;
    try {
      entries = await _resolveBulkEntries({ city, kind, storedNames, all, purge: true });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
    const { restored, failed } = await _runBulk(entries.map(e => ({ ...e, city })), true);
    const touched = new Set(entries.map(e => e.kind));
    if (touched.has('character') || touched.has('location') || touched.has('district')) { invalidateChars(city); invalidateLocs(city); }
    if (touched.has('chronicle') || touched.has('module')) invalidateChars(city);
    res.json({ ok: true, purged: restored, failed: failed.map(f => ({ storedName: f.storedName, error: f.error })) });
  });

  return router;
}

// Превращает параметры bulk-запроса в плоский список {kind, storedName, dir}.
// all:true → все записи корзины kind (без city — все города); иначе — по storedNames:
// kind задан явно либо подбирается первым совпадением по всем корзинам (смешанные kinds).
async function _resolveBulkEntries({ city, kind, storedNames, all, dir }) {
  if (all) {
    if (!kind) throw new Error('Для all:true обязателен параметр kind');
    const lib  = kind === trashLib.KIND.LIB_MD || kind === trashLib.KIND.LIB_JSON;
    const dirs = lib ? (kind === trashLib.KIND.LIB_MD ? trashLib.LIB_MD_DIRS : trashLib.LIB_JSON_DIRS) : [null];
    let rows = [];
    for (const d of dirs) rows.push(...await trashLib._scanBin({ city, kind, dir: d }));
    return rows.map(r => ({ kind, storedName: r.storedName, dir: r.dir }));
  }
  if (!Array.isArray(storedNames) || !storedNames.length) throw new Error('Пустой список storedNames');
  return Promise.all(storedNames.map(async sn => {
    // Для библиотеки dir обязателен — ищем запись по storedName (kind уточняем), иначе
    // пользовательский kind (не-библиотечный) принимаем как есть.
    if (!kind || kind === trashLib.KIND.LIB_MD || kind === trashLib.KIND.LIB_JSON) {
      const found = await trashLib._findEntry({ city, storedName: sn });
      if (!found) { const e = new Error(`Не найдена запись ${sn}`); e.status = 404; throw e; }
      return { kind: found.kind, storedName: sn, dir: found.dir };
    }
    return { kind, storedName: sn, dir };
  }));
}

// Последовательный прогон restore/purge: часть может падать (409/404) — ловим по одному.
async function _runBulk(entries, purge) {
  const restored = [];
  const failed = [];
  for (const e of entries) {
    try {
      if (purge) await trashLib.purgeTrashItem(e);
      else await trashLib.restoreTrashItem(e);
      restored.push(e.storedName);
    } catch (err) {
      failed.push({ storedName: e.storedName, error: err.message });
    }
  }
  return { restored: restored.length, failed };
}

module.exports = { trashRouterFactory };