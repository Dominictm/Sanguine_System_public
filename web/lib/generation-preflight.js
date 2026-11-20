'use strict';
// Проверка полноты данных персонажей перед генерацией (spec doc/design/archive/generation-retry-preflight
// §3 L1–L4, §7 ADR-2, §8.2–8.3). Пустое поле, выводимое из Библиотеки без ИИ, предлагается к
// добору (fill); невыводимое — пропуск (missing). Без решения пользователя (заголовок
// X-Gen-Preflight) эндпоинт отвечает 409 GEN_PREFLIGHT и модель не вызывает.

const fs = require('fs').promises;
const { resolveClanDisciplines, isRecorded } = require('./ability-profile');
const { upsertCardLine } = require('./card-fields');
const { parseCharacter } = require('./parsers');
const { lineageFolderFromLabel } = require('./lineage-prompt-profile');

const HEADER = 'x-gen-preflight';
const APPLIED_HEADER = 'X-Gen-Preflight-Applied';
const FILL_LEVEL = 0; // клановые доступны изначально, прокачивать их не обязательно (решение пользователя)

const _val = v => { const s = String(v || '').trim(); return s && !s.includes('⚠️') ? s : ''; };

// Обязательное поле линейки без добора: [ключ персонажа, ключ поля в контракте].
const REQUIRED_BY_LINEAGE = {
  werewolves: [c => c.tribe, 'tribe'],
  mages:      [c => c.tradition, 'tradition'],
  fairies:    [c => c.kith || c.clan, 'kith'],
};

/**
 * @param {Array<{char: object, cardPath: string, sheetJsonPath?: string|null}>} targets
 * @param {{clans: object[]|null, disciplines: object[]|null}} lib — null: Библиотека недоступна
 * @returns {{fill: object[], missing: object[]}}
 */
function checkTargets(targets, lib) {
  const fill = [], missing = [];
  const seen = new Set();
  for (const t of targets || []) {
    const c = t?.char;
    if (!c || seen.has(t.cardPath)) continue;
    seen.add(t.cardPath);
    const who = { slug: c.slug || '', name: c.name || c.slug || '' };
    const lineage = c.lineageFolder || '';

    if (lineage === 'vampires') {
      const clan = _val(c.clan);
      if (!clan) { missing.push({ ...who, field: 'clan', reason: 'clan-empty', value: '' }); continue; }
      // Пустой каталог — тоже «недоступна»: иначе каждый клан выглядел бы неизвестным.
      if (!lib.clans?.length || !lib.disciplines?.length) { missing.push({ ...who, field: 'disciplines', reason: 'library-unavailable', value: clan }); continue; }
      const canon = resolveClanDisciplines(clan, lib);
      if (!canon.length) { missing.push({ ...who, field: 'clan', reason: 'clan-unknown', value: clan }); continue; }
      const recorded = [_val(c.disciplines), _val(c.features)].join('\n');
      if (canon.some(({ disc }) => isRecorded(disc, recorded))) continue;
      const values = canon.filter(x => !x.note).map(x => x.disc.name);
      if (values.length) fill.push({ ...who, field: 'disciplines', values, level: FILL_LEVEL, clan });
      continue;
    }
    const req = REQUIRED_BY_LINEAGE[lineage];
    if (req && !_val(req[0](c))) missing.push({ ...who, field: req[1], reason: 'field-empty', value: '' });
  }
  return { fill, missing };
}

// «Анимализм» в листе совпадает с записью «Анимализм (Animalism)» — как isRecorded по алиасам.
const _sameDisc = (rowName, libName) => isRecorded({ name: libName }, String(rowName || ''));

// → записано ли хоть что-то (карточка без строк-полей «- **X:**» не меняется — тогда false).
async function _applyOne(target, item, { writeFileAtomic }) {
  if (!target) return false;
  let wrote = false;
  const raw = await fs.readFile(target.cardPath, 'utf-8');
  const card = raw.replace(/^﻿/, '');
  const current = _val(target.char.disciplines);
  const add = item.values.filter(v => !_sameDisc(current, v));
  if (add.length) {
    const next = [current, ...add].filter(Boolean).join(', ');
    const out = upsertCardLine(card, 'Дисциплины', next);
    if (out !== card) { await writeFileAtomic(target.cardPath, out, 'utf-8'); wrote = true; }
  }
  if (!target.sheetJsonPath) return wrote;
  const rawJson = await fs.readFile(target.sheetJsonPath, 'utf-8').catch(() => null);
  if (rawJson === null) return wrote; // листа нет — только карточка
  let data;
  try { data = JSON.parse(rawJson); } catch { return wrote; } // битый лист не чиним
  if (!Array.isArray(data.disciplines)) return wrote;
  let changed = false;
  for (const name of item.values) {
    if (data.disciplines.some(d => _sameDisc(d?.name, name))) continue;
    const empty = data.disciplines.find(d => d && !String(d.name || '').trim());
    if (empty) { empty.name = name; empty.val = item.level; } else data.disciplines.push({ name, val: item.level });
    changed = true;
  }
  if (changed) await writeFileAtomic(target.sheetJsonPath, JSON.stringify(data, null, 2), 'utf-8');
  return wrote || changed;
}

function parseDecision(req) {
  const tokens = String(req.get?.(HEADER) || req.headers?.[HEADER] || '').toLowerCase().split(',').map(s => s.trim());
  return { apply: tokens.includes('apply'), nofill: tokens.includes('nofill'), confirm: tokens.includes('confirm') };
}

/**
 * Решение по запросу: { proceed: true } или ответ 409 (proceed: false — эндпоинт выходит).
 * Добор пишется только когда генерация действительно пойдёт (все решения получены).
 * @param {object} o
 * @param {() => Promise<object[]>} o.resolveTargets — персонажи промта
 * @param {() => Promise<{clans, disciplines}>} o.loadLib
 * @param {(f: string, d: string, e: string) => Promise<void>} o.writeFileAtomic
 * @param {() => void} [o.onApplied] — сброс кэша персонажей
 */
async function runPreflight(req, res, { resolveTargets, loadLib, writeFileAtomic, onApplied }) {
  const targets = (await resolveTargets()).filter(Boolean);
  if (!targets.length) return { proceed: true };
  const lib = await loadLib().catch(() => ({ clans: null, disciplines: null }));
  let { fill, missing } = checkTargets(targets, lib);
  if (!fill.length && !missing.length) return { proceed: true };
  const d = parseDecision(req);
  const send = (f, m) => {
    require('./http').refundAiRate(req); // модель не вызывалась — слот лимита возвращаем
    res.status(409).json({ ok: false, code: 'GEN_PREFLIGHT', error: 'Не хватает данных для генерации', fill: f, missing: m });
    return { proceed: false };
  };
  if (fill.length && !d.apply && !d.nofill) return send(fill, missing);
  if (d.nofill) {
    missing = [...missing, ...fill.map(f => ({ slug: f.slug, name: f.name, field: f.field, reason: 'field-empty', value: '' }))];
    fill = [];
  }
  if (missing.length && !d.confirm) return send([], missing);
  const applied = [];
  if (fill.length) {
    const byCard = new Map(targets.map(t => [t.char.slug || t.cardPath, t]));
    for (const item of fill) if (await _applyOne(byCard.get(item.slug), item, { writeFileAtomic })) applied.push(item);
    if (applied.length) {
      onApplied?.();
      // Клиент (gen-preflight.js) показывает «Добавлено» и обновляет карточки только по этому списку —
      // по тому, что сервер действительно записал, а не по своему решению.
      res.set(APPLIED_HEADER, applied.map(a => encodeURIComponent(a.slug)).join(','));
    }
  }
  return { proceed: true, applied };
}

// ── Резолверы персонажей промта ───────────────────────────────────────────────

const _byName = (chars, name) => {
  const n = String(name || '').trim().toLocaleLowerCase('ru');
  return n ? chars.find(c => String(c.name || '').toLocaleLowerCase('ru') === n) : null;
};

/** Цели для персонажей города: путь карточки и JSON-листа. */
function cityTargets(chars, { charsDir, city, path }) {
  return (chars || []).filter(Boolean).map(c => {
    const dir = path.join(charsDir(city), c.lineageFolder, c.slug);
    return { char: c, cardPath: path.join(dir, `${c.slug}.md`), sheetJsonPath: path.join(dir, `${c.slug}-sheet.json`) };
  });
}
const charsByNames = (chars, names) => [...new Set((names || []).map(n => _byName(chars, n)).filter(Boolean))];
const charsBySlugs = (chars, slugs) => [...new Set((slugs || []).map(s => chars.find(c => c.slug === s)).filter(Boolean))];
// Персонажи, чьё имя целиком встречается в тексте (промт «закрытия модуля» — сценарий, НПС, сессии).
function charsMentioned(chars, text) {
  const hay = String(text || '');
  if (!hay) return [];
  return (chars || []).filter(c => {
    const name = String(c.name || '').trim();
    if (name.length < 3) return false;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}])${esc}(?![\\p{L}])`, 'iu').test(hay);
  });
}
// Слаги владельцев stub-файлов дневников: characters/<линейка>/<slug>/…
const stubOwnerSlugs = stubs => (stubs || []).map(rel => String(rel).replace(/\\/g, '/').match(/characters\/[^/]+\/([^/]+)\//)?.[1]).filter(Boolean);

/** Карточка НПС модуля (вне папок линеек): линейка — по «Линейка WoD», иначе не проверяется. */
async function moduleNpcTarget(cardPath, slug) {
  const raw = await fs.readFile(cardPath, 'utf-8').catch(() => '');
  if (!raw) return null;
  const char = { ...parseCharacter(raw.replace(/^﻿/, ''), slug), slug };
  char.lineageFolder = char.lineageFolder || lineageFolderFromLabel(raw.match(/\*\*Линейка WoD:\*\*\s*([^\n|]+)/)?.[1]);
  return char.lineageFolder ? { char, cardPath, sheetJsonPath: null } : null;
}

// ── Защёлка для эндпоинтов генерации ─────────────────────────────────────────
// Зависимости — лениво: db и роутер Библиотеки сами тянут парсеры, а этот модуль им не нужен.
async function _defaultLoadLib() {
  const { loadClans, loadDisciplines } = require('../routes/library');
  const [clans, disciplines] = await Promise.all([loadClans(), loadDisciplines()]);
  return { clans, disciplines };
}

/**
 * Вызов в начале эндпоинта генерации, до вызова модели:
 *   if (!(await genPreflight(req, res, city, chars => charsBySlugs(chars, [slug]))).proceed) return;
 * @param {(chars: object[]) => object[]|Promise<object[]>} pick — персонажи города из промта
 * @param {object[]} [extraTargets] — цели вне папок линеек (НПС модуля, moduleNpcTarget)
 */
async function genPreflight(req, res, city, pick, extraTargets = []) {
  const db = require('./db');
  const path = require('path');
  return runPreflight(req, res, {
    resolveTargets: async () => {
      const chars = pick ? await pick(await db.getAllCharacters(city)) : [];
      return [...cityTargets(chars, { charsDir: db.charsDir, city, path }), ...(extraTargets || [])];
    },
    loadLib: _defaultLoadLib,
    writeFileAtomic: db.writeFileAtomic,
    onApplied: () => db.invalidateChars(city),
  });
}

module.exports = {
  HEADER, FILL_LEVEL, checkTargets, runPreflight, parseDecision, genPreflight,
  cityTargets, charsByNames, charsBySlugs, charsMentioned, stubOwnerSlugs, moduleNpcTarget,
};
