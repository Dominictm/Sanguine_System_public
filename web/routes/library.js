'use strict';
// Роутер библиотеки: справочники дисциплин и психических способностей
// (system/library/…). Город-нейтральные данные, кэш по mtime файлов.
// loadDisciplines/loadPsychics экспортируются отдельно — их использует
// генерация V20-листов в server.js.

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { serverError, validateImageUpload } = require('../lib/http');
const { ROOT, writeFileAtomic } = require('../lib/db');
const { slugify, sanitizeInlineText, sanitizeFreeformBody } = require('../lib/parsers');
const { parseDisciplineMd, pathArtSlug } = require('../lib/disciplines');
const { parsePsychicMd } = require('../lib/psychics');
const { TRADITIONS: RIT_TRADITIONS, parseRitualMd, compareRituals, isLevelValid: isRitualLevelValid } = require('../lib/rituals');
const { parseClanMd } = require('../lib/clans');
const { parseSectMd } = require('../lib/sects');
const { parseFairyArtMd, parseFairyRealmMd,
  parseWerewolfGiftMd, parseWerewolfRiteMd, parseMageSphereMd, parseMageTechniqueMd,
  parseMageTarotMd } = require('../lib/lineage-levels');
const { parseTitleMd } = require('../lib/titles');
const { parsePathMd, comparePaths, sinsTableLines, PATH_SINS_COUNT } = require('../lib/paths');
const { getMerits, getAllMerits, invalidateMerits } = require('../lib/merits-loader');
const { getFlaws, getAllFlaws, invalidateFlaws } = require('../lib/flaws-loader');
const { getBackgrounds, getAllBackgrounds, invalidateBackgrounds } = require('../lib/backgrounds-loader');
const { getArchetypes, getAllArchetypes, invalidateArchetypes } = require('../lib/archetypes-loader');
const { getEssences, getAllEssences, invalidateEssences } = require('../lib/essences-loader');
const { getSpecializations, getAllSpecializations, invalidateSpecializations } = require('../lib/specializations-loader');

const router = express.Router();

// ── Библиотека: справочник дисциплин (system/library/disciplines/*.md) ──────────
// Город-нейтральные данные → кэш по mtime каталога.
//
// Stress-test 2026-09-24: без TTL каждый GET даже при совпадении sig стоил
// readdir каталога + readdir двух каталогов арта + stat каждого .md (~25 fs-вызовов),
// а холодный кэш под 200 параллельными клиентами — N полных распарсовываний
// одних и тех же файлов. Теперь: TTL (2 с) пропустить пересчёт sig, single-flight
// склеивает параллельные холодные загрузки в одну. Инвалидация API-мутациями
// (_discInvalidate) по-прежнему мгновенная; правки MD «снаружи» (в редакторе)
// подхватываются не позже чем через DISC_TTL_MS.
// DISC_TTL_MS=0 через env отключает TTL (тестовый харнесс: фикстуры пишутся
// напрямую в FS и должны быть видны немедленно).
const DISC_TTL_MS = process.env.DISC_TTL_MS !== undefined
  ? Math.max(0, parseInt(process.env.DISC_TTL_MS, 10) || 0)
  : 2000;
let _discCache = null; // { sig, list, at }
let _discFlight = null; // Promise | null — in-flight загрузка
let _discGen = 0; // bump при invalidate: не записывать в кэш устаревший полёт
const DISC_DIR = path.join(ROOT, 'system', 'library', 'disciplines');
const _discInvalidate = () => { _discCache = null; _discGen++; };

async function _loadDisciplinesMeta() {
  const files = (await fs.readdir(DISC_DIR).catch(() => null));
  if (!files) return null;
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();

  const imgDir = path.join(__dirname, '..', 'public', 'img', 'system', 'library', 'disciplines');
  const artFiles = await fs.readdir(imgDir).catch(() => []);
  // Арт Путей (path-based школы) живёт отдельно: paths/<disc>__<path>.png.
  const pathsImgDir = path.join(__dirname, '..', 'public', 'img', 'system', 'library', 'paths');
  const pathArtFiles = await fs.readdir(pathsImgDir).catch(() => []);

  // Сигнатура по mtime каждого файла: правка содержимого существующего .md
  // не меняет mtime каталога, поэтому ключевать по нему нельзя (иначе кэш не сбросится).
  // Список картинок тоже входит в сигнатуру — появление нового PNG должно
  // сбрасывать кэш так же надёжно, как правка текста дисциплины.
  const stats = await Promise.all(mds.map(f => fs.stat(path.join(DISC_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|')
    + '||art:' + artFiles.sort().join(',')
    + '||partart:' + pathArtFiles.sort().join(',');
  return { sig, mds, artFiles, pathArtFiles };
}

async function _parseDisciplines(meta) {
  const list = [];
  for (const f of meta.mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(DISC_DIR, f), 'utf-8').catch(() => '');
    if (md) {
      const parsed = parseDisciplineMd(md, slug);
      parsed.hasArt = meta.artFiles.includes(slug + '.png');
      for (const p of parsed.paths) {
        p.artSlug = pathArtSlug(slug, p.name);
        p.hasArt = meta.pathArtFiles.includes(p.artSlug + '.png');
      }
      list.push(parsed);
    }
  }
  return list;
}

async function loadDisciplines() {
  if (_discCache && (Date.now() - _discCache.at) < DISC_TTL_MS) return _discCache.list;
  if (_discFlight) return _discFlight;

  const gen = _discGen;
  const p = (async () => {
    const meta = await _loadDisciplinesMeta();
    if (!meta) return [];
    if (_discCache && _discCache.sig === meta.sig) {
      _discCache.at = Date.now();
      return _discCache.list;
    }
    const list = await _parseDisciplines(meta);
    // Мутация через API во время полёта → invalidate уже сбросил кэш и поднял
    // gen: не затираем её более свежее состояние ответом, прочитанным до записи.
    if (gen === _discGen) {
      _discCache = { sig: meta.sig, list, at: Date.now() };
    }
    return list;
  })();

  _discFlight = p;
  try {
    return await p;
  } finally {
    if (_discFlight === p) _discFlight = null;
  }
}

router.get('/api/library/disciplines', async (_req, res) => {
  try { res.json(await loadDisciplines()); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник психических способностей (system/library/psychics/*.md) ──
// Город-нейтральные данные → тот же mtime-кэш, что и у дисциплин (см. выше).
let _psyCache = null; // { sig, list }
const PSY_DIR = path.join(ROOT, 'system', 'library', 'psychics');

async function loadPsychics() {
  const files = (await fs.readdir(PSY_DIR).catch(() => null));
  if (!files) return [];
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();

  const imgDir = path.join(__dirname, '..', 'public', 'img', 'system', 'library', 'psychics');
  const artFiles = await fs.readdir(imgDir).catch(() => []);

  const stats = await Promise.all(mds.map(f => fs.stat(path.join(PSY_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|') + '||art:' + artFiles.sort().join(',');
  if (_psyCache && _psyCache.sig === sig) return _psyCache.list;

  const list = [];
  for (const f of mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(PSY_DIR, f), 'utf-8').catch(() => '');
    if (md) {
      const parsed = parsePsychicMd(md, slug);
      parsed.hasArt = artFiles.includes(slug + '.png');
      list.push(parsed);
    }
  }
  _psyCache = { sig, list };
  return list;
}

router.get('/api/library/psychics', async (_req, res) => {
  try { res.json(await loadPsychics()); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник кланов (system/library/clans/*.md) — K3, 2026-08-04 ──
// Город-нейтральные данные → тот же mtime-кэш, что у дисциплин/психики.
// hasArt — см. _withArt/_artFileSet ниже (те же PNG-конвенции, что у дисциплин).
let _clanCache = null; // { sig, list }
const CLANS_DIR = path.join(ROOT, 'system', 'library', 'clans');

async function loadClans() {
  const files = (await fs.readdir(CLANS_DIR).catch(() => null));
  if (!files) return [];
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();
  const stats = await Promise.all(mds.map(f => fs.stat(path.join(CLANS_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|');
  if (_clanCache && _clanCache.sig === sig) return _clanCache.list;
  const list = [];
  for (const f of mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(CLANS_DIR, f), 'utf-8').catch(() => '');
    if (md) list.push(parseClanMd(md, slug));
  }
  _clanCache = { sig, list };
  return list;
}

router.get('/api/library/clans', async (_req, res) => {
  try { res.json(_withArt(await loadClans(), await _artFileSet('clans'))); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник сект (system/library/sects/*.md) — K4, 2026-08-04 ──
let _sectCache = null; // { sig, list }
const SECTS_DIR = path.join(ROOT, 'system', 'library', 'sects');

async function loadSects() {
  const files = (await fs.readdir(SECTS_DIR).catch(() => null));
  if (!files) return [];
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();
  const stats = await Promise.all(mds.map(f => fs.stat(path.join(SECTS_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|');
  if (_sectCache && _sectCache.sig === sig) return _sectCache.list;
  const list = [];
  for (const f of mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(SECTS_DIR, f), 'utf-8').catch(() => '');
    if (md) list.push(parseSectMd(md, slug));
  }
  _sectCache = { sig, list };
  return list;
}

router.get('/api/library/sects', async (_req, res) => {
  try { res.json(_withArt(await loadSects(), await _artFileSet('sects'))); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник титулов (system/library/titles/*.md) — 2026-08-06 ──
// Зеркало clans/sects выше. Отличие от Клана/Секты: поле «Принадлежность»
// (свободный текст) вместо «Секта», и boolean-флаг «Негативный».
let _titleCache = null; // { sig, list }
const TITLES_DIR = path.join(ROOT, 'system', 'library', 'titles');

async function loadTitles() {
  const files = (await fs.readdir(TITLES_DIR).catch(() => null));
  if (!files) return [];
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();
  const stats = await Promise.all(mds.map(f => fs.stat(path.join(TITLES_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|');
  if (_titleCache && _titleCache.sig === sig) return _titleCache.list;
  const list = [];
  for (const f of mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(TITLES_DIR, f), 'utf-8').catch(() => '');
    if (md) list.push(parseTitleMd(md, slug));
  }
  _titleCache = { sig, list };
  return list;
}

router.get('/api/library/titles', async (_req, res) => {
  try { res.json(_withArt(await loadTitles(), await _artFileSet('titles'))); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: комбинированные дисциплины (system/library/combo_disciplines.json) ──
// Город-нейтральные данные. У комбо нет шкалы 1–5 — только предпосылки (prereq)
// и описание, поэтому это отдельный JSON, а не .md-дисциплина (иначе комбо
// засоряли бы список «все дисциплины» и требовали фиктивных уровней-точек).
const COMBO_FILE = path.join(ROOT, 'system', 'library', 'combo_disciplines.json');
let _comboCache = null; // { mtimeMs, list }
async function loadCombos() {
  const st = await fs.stat(COMBO_FILE).catch(() => null);
  if (!st) return [];
  if (_comboCache && _comboCache.mtimeMs === st.mtimeMs) return _comboCache.list;
  const raw = await fs.readFile(COMBO_FILE, 'utf-8').catch(() => '[]');
  let list;
  try { list = JSON.parse(raw); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  _comboCache = { mtimeMs: st.mtimeMs, list };
  return list;
}
router.get('/api/library/combo-disciplines', async (_req, res) => {
  // hasArt — как у merits/flaws: файлы combo/<slug>.png читаются на каждый
  // запрос (см. _artFileSet ниже), чтобы новый арт подхватывался без рестарта.
  try { res.json(_withArt(await loadCombos(), await _artFileSet('combo'))); }
  catch (e) { serverError(res, e); }
});

// Набор PNG-файлов в web/public/img/system/library/<section>/ (генерирует
// tools/generate_library_art.js) — читается на каждый запрос (каталог
// маленький, кэш не нужен), т.к. hasArt считается отдельно от кэша
// getMerits/getFlaws/getBackgrounds — иначе появление нового арта без
// рестарта сервера не отражалось бы в ответе (эти три лоадера кэшируют
// сами записи бессрочно, см. web/lib/merits-loader.js).
async function _artFileSet(section) {
  const dir = path.join(__dirname, '..', 'public', 'img', 'system', 'library', section);
  const files = await fs.readdir(dir).catch(() => []);
  return new Set(files);
}
const _withArt = (list, art) => list.map(x => ({ ...x, hasArt: art.has(x.slug + '.png') }));

// ── Библиотека: справочник достоинств (system/library/merits/*.json) ──────────
// JSON-based merits library (physical, social, mental, supernatural)
router.get('/api/library/merits/:category', async (req, res) => {
  try {
    const merits = getMerits(req.params.category);
    res.json(_withArt(merits, await _artFileSet('merits')));
  } catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник недостатков (system/library/flaws/*.json) ──────────
// JSON-based flaws library (физические, умственные, социальные, сверхъестественные)
router.get('/api/library/flaws/:category', async (req, res) => {
  try {
    const flaws = getFlaws(req.params.category);
    res.json(_withArt(flaws, await _artFileSet('flaws')));
  } catch (e) { serverError(res, e); }
});

// ── Библиотека: объединённые списки достоинств/недостатков (все категории слиты) ──
// Для пикера в листе персонажа (см. web/public/scripts.js: _v20LoadLibrary) — не нужно
// отдельно грузить 4+4 эндпоинта по категориям на клиенте.
router.get('/api/library/merits', async (_req, res) => {
  try { res.json(_withArt(Object.values(getAllMerits()).flat(), await _artFileSet('merits'))); }
  catch (e) { serverError(res, e); }
});

router.get('/api/library/flaws', async (_req, res) => {
  try { res.json(_withArt(Object.values(getAllFlaws()).flat(), await _artFileSet('flaws'))); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник фактов биографии (system/library/backgrounds/*.json) ──
// JSON-based backgrounds library (general, vampire, ghoul, mage, changeling)
router.get('/api/library/backgrounds/:category', async (req, res) => {
  try {
    const backgrounds = getBackgrounds(req.params.category);
    res.json(_withArt(backgrounds, await _artFileSet('backgrounds')));
  } catch (e) { serverError(res, e); }
});

router.get('/api/library/backgrounds', async (_req, res) => {
  try { res.json(_withArt(Object.values(getAllBackgrounds()).flat(), await _artFileSet('backgrounds'))); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник архетипов (system/library/archetypes/archetypes.json) ──
// JSON-based archetypes library (единый файл, без подкатегорий). Арт —
// web/public/img/system/library/archetypes/<slug>.png через _artFileSet;
// пока PNG не сгенерированы, hasArt у всех false (фолбэк без рестарта).
router.get('/api/library/archetypes/:category', async (req, res) => {
  try {
    const archetypes = getArchetypes(req.params.category);
    res.json(_withArt(archetypes, await _artFileSet('archetypes')));
  } catch (e) { serverError(res, e); }
});

router.get('/api/library/archetypes', async (_req, res) => {
  try { res.json(_withArt(Object.values(getAllArchetypes()).flat(), await _artFileSet('archetypes'))); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: Сущности Аватары (system/library/essences/essences.json) ──
// JSON-based essences library (единый файл, без подкатегорий — как archetypes).
// Арт — web/public/img/system/library/essences/<slug>.png через _artFileSet;
// пока PNG не сгенерированы, hasArt у всех false (фолбэк без рестарта).
router.get('/api/library/essences/:category', async (req, res) => {
  try {
    const essences = getEssences(req.params.category);
    res.json(_withArt(essences, await _artFileSet('essences')));
  } catch (e) { serverError(res, e); }
});

router.get('/api/library/essences', async (_req, res) => {
  try { res.json(_withArt(Object.values(getAllEssences()).flat(), await _artFileSet('essences'))); }
  catch (e) { serverError(res, e); }
});

// ── Библиотека: справочник специализаций (system/library/specializations/specializations.json) ──
// JSON-based specializations library (единый файл, без подкатегорий — как archetypes).
// Арта нет — _artFileSet('specializations') вернёт пустой сет, hasArt у всех false (фолбэк).
// Опциональный фильтр ?ability= — точное совпадение ability после trim (кириллица в URL-encoding).
router.get('/api/library/specializations/:category', async (req, res) => {
  try {
    const specializations = getSpecializations(req.params.category);
    res.json(_withArt(specializations, await _artFileSet('specializations')));
  } catch (e) { serverError(res, e); }
});

router.get('/api/library/specializations', async (req, res) => {
  try {
    let list = Object.values(getAllSpecializations()).flat();
    const ability = typeof req.query.ability === 'string' ? req.query.ability.trim() : '';
    if (ability) list = list.filter(s => s.ability === ability);
    res.json(_withArt(list, await _artFileSet('specializations')));
  } catch (e) { serverError(res, e); }
});

// ═══════════════════════════════════════════════════════════════════════════
// Фаза I — авторские (не канонические) элементы библиотеки: CRUD поверх тех же
// файлов. Создание помечает запись «Авторское: да» (MD) / "custom": true
// (JSON) — правка и удаление разрешены ТОЛЬКО для таких записей, канонический
// V20-контент через это API не редактируется и не удаляется.
// ═══════════════════════════════════════════════════════════════════════════

// sanitizeInlineText on clans/source/level name/literary/system: FIX-16
// (doc/audit/2026-07-28-fix-plan.md, continuation of FIX-2) — each is spliced
// into a single template line; an embedded '\n## Уровень N — …' would otherwise
// break out into a real H2/level heading that parseDisciplineMd then treats as
// genuine data (confirmed live during QA: a fake level 99 appeared in the API).
function _discTemplate({ name, clans, source, note, levels }) {
  const lines = [`# ${name}`, `- **Клан / принадлежность:** ${sanitizeInlineText(clans || '')}`];
  if (source) lines.push(`- **Источник:** ${sanitizeInlineText(source)}`);
  lines.push('- **Авторское:** да');
  if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${sanitizeInlineText(l)}`); }
  lines.push('');
  for (const lvl of (levels || [])) {
    lines.push(`## Уровень ${lvl.level} — ${sanitizeInlineText(lvl.name || '')}`, '', `**Литературное описание.** ${sanitizeInlineText(lvl.literary || '')}`, '', `**Система.** ${sanitizeInlineText(lvl.system || '')}`, '');
  }
  return lines.join('\n');
}

router.post('/api/library/disciplines', express.json(), async (req, res) => {
  try {
    const { name, clans, source, note, levels } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const slug = slugify(name);
    if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
    const file = path.join(DISC_DIR, `${slug}.md`);
    if (await fs.stat(file).catch(() => null))
      return res.status(409).json({ error: 'Дисциплина с таким названием уже существует', slug });
    await writeFileAtomic(file, _discTemplate({ name: name.trim(), clans, source, note, levels }), 'utf-8');
    _discInvalidate();
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.put('/api/library/disciplines/:slug', express.json(), async (req, res) => {
  try {
    // FIX-17 (doc/audit/2026-07-28-fix-plan.md): unlike POST (which derives its
    // filename via slugify(name)), this took :slug from the URL straight into
    // path.join — a '..' segment would resolve outside DISC_DIR. Gated in practice
    // by the "Авторское: да" check below (can only touch an existing, custom-marked
    // file, not write anywhere new), but slugify() closes it outright.
    const slug = slugify(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(DISC_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Дисциплина не найдена' });
    if (!parseDisciplineMd(existing, slug).custom)
      return res.status(403).json({ error: 'Редактирование доступно только для авторских дисциплин' });
    const { name, clans, source, note, levels } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    await writeFileAtomic(file, _discTemplate({ name: name.trim(), clans, source, note, levels }), 'utf-8');
    _discInvalidate();
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/library/disciplines/:slug', async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(DISC_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Дисциплина не найдена' });
    if (!parseDisciplineMd(existing, slug).custom)
      return res.status(403).json({ error: 'Удаление доступно только для авторских дисциплин' });
    const trashDir = path.join(DISC_DIR, '_deleted');
    await fs.mkdir(trashDir, { recursive: true });
    await fs.rename(file, path.join(trashDir, `${slug}_${Date.now()}.md`));
    _discInvalidate();
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// sanitizeInlineText: see _discTemplate above (same FIX-16 breakout risk).
function _psyTemplate({ name, category, roll, source, note, levels }) {
  const lines = [`# ${name}`, `- **Категория:** ${sanitizeInlineText(category || '')}`];
  if (roll) lines.push(`- **Бросок:** ${sanitizeInlineText(roll)}`);
  if (source) lines.push(`- **Источник:** ${sanitizeInlineText(source)}`);
  lines.push('- **Авторское:** да');
  if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${sanitizeInlineText(l)}`); }
  lines.push('');
  for (const lvl of (levels || [])) {
    lines.push(`## Уровень ${lvl.level} — ${sanitizeInlineText(lvl.name || '')}`, '', `**Литературное описание.** ${sanitizeInlineText(lvl.literary || '')}`, '', `**Система.** ${sanitizeInlineText(lvl.system || '')}`, '');
  }
  return lines.join('\n');
}

router.post('/api/library/psychics', express.json(), async (req, res) => {
  try {
    const { name, category, roll, source, note, levels } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const slug = slugify(name);
    if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
    const file = path.join(PSY_DIR, `${slug}.md`);
    if (await fs.stat(file).catch(() => null))
      return res.status(409).json({ error: 'Способность с таким названием уже существует', slug });
    await writeFileAtomic(file, _psyTemplate({ name: name.trim(), category, roll, source, note, levels }), 'utf-8');
    _psyCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.put('/api/library/psychics/:slug', express.json(), async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(PSY_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Способность не найдена' });
    if (!parsePsychicMd(existing, slug).custom)
      return res.status(403).json({ error: 'Редактирование доступно только для авторских способностей' });
    const { name, category, roll, source, note, levels } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    await writeFileAtomic(file, _psyTemplate({ name: name.trim(), category, roll, source, note, levels }), 'utf-8');
    _psyCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/library/psychics/:slug', async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(PSY_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Способность не найдена' });
    if (!parsePsychicMd(existing, slug).custom)
      return res.status(403).json({ error: 'Удаление доступно только для авторских способностей' });
    const trashDir = path.join(PSY_DIR, '_deleted');
    await fs.mkdir(trashDir, { recursive: true });
    await fs.rename(file, path.join(trashDir, `${slug}_${Date.now()}.md`));
    _psyCache = null;
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// ── Библиотека: ритуалы (system/library/rituals/*.md) — спека
// doc/design/2026-09-24-library-rituals-spec.md. ≈350 файлов → кэш с TTL и
// single-flight, как у дисциплин (DISC_TTL_MS), чтобы не stat'ить каждый файл на запрос.
const RIT_DIR = path.join(ROOT, 'system', 'library', 'rituals');
let _ritCache = null;  // { sig, list, at }
let _ritFlight = null;

async function _loadRitualsFresh() {
  const files = (await fs.readdir(RIT_DIR).catch(() => null));
  if (!files) return { sig: '', list: [] };
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();
  // Арт плиток (2026-10-12): public/img/system/library/rituals/<slug>.png —
  // та же PNG-конвенция, что у дисциплин/психики. Список входит в сигнатуру,
  // чтобы залитый арт сбрасывал кэш и hasArt подхватывался без рестарта.
  const imgDir = path.join(__dirname, '..', 'public', 'img', 'system', 'library', 'rituals');
  const artFiles = await fs.readdir(imgDir).catch(() => []);
  const stats = await Promise.all(mds.map(f => fs.stat(path.join(RIT_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|')
    + '||art:' + artFiles.sort().join(',');
  if (_ritCache && _ritCache.sig === sig) return { sig, list: _ritCache.list };
  const art = new Set(artFiles);
  const list = [];
  for (const f of mds) {
    const md = await fs.readFile(path.join(RIT_DIR, f), 'utf-8').catch(() => '');
    if (!md) continue;
    const parsed = parseRitualMd(md, f.replace(/\.md$/, ''));
    parsed.hasArt = art.has(parsed.slug + '.png');
    list.push(parsed);
  }
  list.sort(compareRituals);
  return { sig, list };
}

async function loadRituals() {
  if (_ritCache && DISC_TTL_MS > 0 && Date.now() - _ritCache.at < DISC_TTL_MS) return _ritCache.list;
  if (!_ritFlight) {
    _ritFlight = _loadRitualsFresh()
      .then(({ sig, list }) => { _ritCache = { sig, list, at: Date.now() }; return list; })
      .finally(() => { _ritFlight = null; });
  }
  return _ritFlight;
}

router.get('/api/library/rituals', async (_req, res) => {
  try { res.json(await loadRituals()); }
  catch (e) { serverError(res, e); }
});

function _ritTemplate({ name, nameEn, tradition, level, source, literary, system }) {
  const title = nameEn ? `${sanitizeInlineText(name)} (${sanitizeInlineText(nameEn)})` : sanitizeInlineText(name);
  const lines = [`# 🕯️ ${title}`, '', `- **Традиция:** ${tradition}`, `- **Уровень:** ${level}`];
  if (source) lines.push(`- **Источник:** ${sanitizeInlineText(source)}`);
  lines.push('- **Авторское:** да', '',
    `**Литературное описание.** ${sanitizeInlineText(literary || '')}`, '',
    `**Система.** ${sanitizeInlineText(system || '')}`, '');
  return lines.join('\n');
}

// Общая валидация тела POST/PUT → { error } или нормализованные поля.
function _ritValidate(body) {
  const b = body || {};
  const name = String(b.name || '').trim();
  if (!name) return { error: 'Название обязательно' };
  const tradition = String(b.tradition || '').trim().toLowerCase();
  if (!RIT_TRADITIONS[tradition]) return { error: `Неизвестная традиция: ${tradition || '—'}` };
  const level = parseInt(b.level, 10);
  if (!isRitualLevelValid(tradition, level)) {
    const [lo, hi] = RIT_TRADITIONS[tradition].levels;
    return { error: `Уровень для традиции «${RIT_TRADITIONS[tradition].name}» — от ${lo} до ${hi}` };
  }
  return { name, nameEn: String(b.nameEn || '').trim(), tradition, level,
    source: String(b.source || '').trim(), literary: String(b.literary || ''), system: String(b.system || '') };
}

function _ritInvalidate() { _ritCache = null; }

router.post('/api/library/rituals', express.json(), async (req, res) => {
  try {
    const v = _ritValidate(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const base = slugify(v.nameEn || v.name);
    if (!base) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
    const slug = `${RIT_TRADITIONS[v.tradition].prefix}_${base}`;
    const file = path.join(RIT_DIR, `${slug}.md`);
    if (await fs.stat(file).catch(() => null))
      return res.status(409).json({ error: 'Ритуал с таким названием в этой традиции уже существует', slug });
    await fs.mkdir(RIT_DIR, { recursive: true });
    await writeFileAtomic(file, _ritTemplate(v), 'utf-8');
    _ritInvalidate();
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.put('/api/library/rituals/:slug', express.json(), async (req, res) => {
  try {
    const slug = slugify(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(RIT_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Ритуал не найден' });
    if (!parseRitualMd(existing, slug).custom)
      return res.status(403).json({ error: 'Редактирование доступно только для авторских ритуалов' });
    const v = _ritValidate(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    await writeFileAtomic(file, _ritTemplate(v), 'utf-8');
    _ritInvalidate();
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/library/rituals/:slug', async (req, res) => {
  try {
    const slug = slugify(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(RIT_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Ритуал не найден' });
    if (!parseRitualMd(existing, slug).custom)
      return res.status(403).json({ error: 'Удаление доступно только для авторских ритуалов' });
    const trashDir = path.join(RIT_DIR, '_deleted');
    await fs.mkdir(trashDir, { recursive: true });
    await fs.rename(file, path.join(trashDir, `${slug}_${Date.now()}.md`));
    _ritInvalidate();
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// ── Библиотека: CRUD кланов (K3, 2026-08-04) — зеркало disciplines выше, но без
// «levels» (клан не силовая шкала, одна секция «## Описание»).
function _clanTemplate({ name, sect, disciplines, weakness, source, note, description }) {
  const lines = [`# ${name}`];
  if (sect) lines.push(`- **Секта:** ${sanitizeInlineText(sect)}`);
  if (disciplines) lines.push(`- **Дисциплины:** ${sanitizeInlineText(disciplines)}`);
  if (weakness) lines.push(`- **Слабость:** ${sanitizeInlineText(weakness)}`);
  if (source) lines.push(`- **Источник:** ${sanitizeInlineText(source)}`);
  lines.push('- **Авторское:** да');
  if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${sanitizeInlineText(l)}`); }
  lines.push('', '## Описание', '', sanitizeFreeformBody(description || ''), '');
  return lines.join('\n');
}

router.post('/api/library/clans', express.json(), async (req, res) => {
  try {
    const { name, sect, disciplines, weakness, source, note, description } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const slug = slugify(name);
    if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
    const file = path.join(CLANS_DIR, `${slug}.md`);
    if (await fs.stat(file).catch(() => null))
      return res.status(409).json({ error: 'Клан с таким названием уже существует', slug });
    await writeFileAtomic(file, _clanTemplate({ name: name.trim(), sect, disciplines, weakness, source, note, description }), 'utf-8');
    _clanCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.put('/api/library/clans/:slug', express.json(), async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(CLANS_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Клан не найден' });
    if (!parseClanMd(existing, slug).custom)
      return res.status(403).json({ error: 'Редактирование доступно только для авторских кланов' });
    const { name, sect, disciplines, weakness, source, note, description } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    await writeFileAtomic(file, _clanTemplate({ name: name.trim(), sect, disciplines, weakness, source, note, description }), 'utf-8');
    _clanCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/library/clans/:slug', async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(CLANS_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Клан не найден' });
    if (!parseClanMd(existing, slug).custom)
      return res.status(403).json({ error: 'Удаление доступно только для авторских кланов' });
    const trashDir = path.join(CLANS_DIR, '_deleted');
    await fs.mkdir(trashDir, { recursive: true });
    await fs.rename(file, path.join(trashDir, `${slug}_${Date.now()}.md`));
    _clanCache = null;
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// ── Библиотека: CRUD сект (K4, 2026-08-04) — зеркало clans выше, меньше полей.
function _sectTemplate({ name, source, note, description }) {
  const lines = [`# ${name}`];
  if (source) lines.push(`- **Источник:** ${sanitizeInlineText(source)}`);
  lines.push('- **Авторское:** да');
  if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${sanitizeInlineText(l)}`); }
  lines.push('', '## Описание', '', sanitizeFreeformBody(description || ''), '');
  return lines.join('\n');
}

router.post('/api/library/sects', express.json(), async (req, res) => {
  try {
    const { name, source, note, description } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const slug = slugify(name);
    if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
    const file = path.join(SECTS_DIR, `${slug}.md`);
    if (await fs.stat(file).catch(() => null))
      return res.status(409).json({ error: 'Секта с таким названием уже существует', slug });
    await writeFileAtomic(file, _sectTemplate({ name: name.trim(), source, note, description }), 'utf-8');
    _sectCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.put('/api/library/sects/:slug', express.json(), async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(SECTS_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Секта не найдена' });
    if (!parseSectMd(existing, slug).custom)
      return res.status(403).json({ error: 'Редактирование доступно только для авторских сект' });
    const { name, source, note, description } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    await writeFileAtomic(file, _sectTemplate({ name: name.trim(), source, note, description }), 'utf-8');
    _sectCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/library/sects/:slug', async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(SECTS_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Секта не найдена' });
    if (!parseSectMd(existing, slug).custom)
      return res.status(403).json({ error: 'Удаление доступно только для авторских сект' });
    const trashDir = path.join(SECTS_DIR, '_deleted');
    await fs.mkdir(trashDir, { recursive: true });
    await fs.rename(file, path.join(trashDir, `${slug}_${Date.now()}.md`));
    _sectCache = null;
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// ── Библиотека: CRUD титулов (2026-08-06) — зеркало сект выше, с двумя
// дополнительными полями: «Принадлежность» (affiliation) и boolean «Негативный».
function _titleTemplate({ name, affiliation, negative, source, note, description }) {
  const lines = [`# ${name}`];
  if (affiliation) lines.push(`- **Принадлежность:** ${sanitizeInlineText(affiliation)}`);
  if (negative) lines.push('- **Негативный:** да');
  if (source) lines.push(`- **Источник:** ${sanitizeInlineText(source)}`);
  lines.push('- **Авторское:** да');
  if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${sanitizeInlineText(l)}`); }
  lines.push('', '## Описание', '', sanitizeFreeformBody(description || ''), '');
  return lines.join('\n');
}

router.post('/api/library/titles', express.json(), async (req, res) => {
  try {
    const { name, affiliation, negative, source, note, description } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const slug = slugify(name);
    if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
    const file = path.join(TITLES_DIR, `${slug}.md`);
    if (await fs.stat(file).catch(() => null))
      return res.status(409).json({ error: 'Титул с таким названием уже существует', slug });
    await writeFileAtomic(file, _titleTemplate({ name: name.trim(), affiliation, negative, source, note, description }), 'utf-8');
    _titleCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.put('/api/library/titles/:slug', express.json(), async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(TITLES_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Титул не найден' });
    if (!parseTitleMd(existing, slug).custom)
      return res.status(403).json({ error: 'Редактирование доступно только для авторских титулов' });
    const { name, affiliation, negative, source, note, description } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    await writeFileAtomic(file, _titleTemplate({ name: name.trim(), affiliation, negative, source, note, description }), 'utf-8');
    _titleCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/library/titles/:slug', async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(TITLES_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Титул не найден' });
    if (!parseTitleMd(existing, slug).custom)
      return res.status(403).json({ error: 'Удаление доступно только для авторских титулов' });
    const trashDir = path.join(TITLES_DIR, '_deleted');
    await fs.mkdir(trashDir, { recursive: true });
    await fs.rename(file, path.join(trashDir, `${slug}_${Date.now()}.md`));
    _titleCache = null;
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// ── Библиотека: Пути Просветления (system/library/vampire-paths/*.md) — 2026-10-15 ──
// Зеркало сект выше + поля шапки (Прозвище/Добродетели/Столп) и таблица
// ## Иерархия грехов (ровно 10 строк, рейтинги 10→1). Спека —
// doc/design/2026-10-15-library-paths-spec.md.
let _pathCache = null; // { sig, list }
const PATHS_DIR = path.join(ROOT, 'system', 'library', 'vampire-paths');

async function loadPaths() {
  const files = (await fs.readdir(PATHS_DIR).catch(() => null));
  if (!files) return [];
  const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();
  const stats = await Promise.all(mds.map(f => fs.stat(path.join(PATHS_DIR, f)).catch(() => null)));
  const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|');
  if (_pathCache && _pathCache.sig === sig) return _pathCache.list;
  const list = [];
  for (const f of mds) {
    const slug = f.replace(/\.md$/, '');
    const md = await fs.readFile(path.join(PATHS_DIR, f), 'utf-8').catch(() => '');
    if (md) list.push(parsePathMd(md, slug));
  }
  list.sort(comparePaths);
  _pathCache = { sig, list };
  return list;
}

router.get('/api/library/vampire-paths', async (_req, res) => {
  try { res.json(_withArt(await loadPaths(), await _artFileSet('vampire-paths'))); }
  catch (e) { serverError(res, e); }
});

// sins: массив ровно из PATH_SINS_COUNT записей { rating 10..1, sin, reason? }.
function _readPathSins(body) {
  const arr = body?.sins;
  if (!Array.isArray(arr) || arr.length !== PATH_SINS_COUNT)
    return { error: `Иерархия грехов: ровно ${PATH_SINS_COUNT} записей (10→1)` };
  const sins = [];
  for (const s of arr) {
    const rating = Number(s?.rating);
    const sin = sanitizeInlineText(String(s?.sin || '')).trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 10 || !sin)
      return { error: 'Иерархия грехов: каждая запись — рейтинг 1–10 и непустой грех' };
    sins.push({ rating, sin, reason: sanitizeInlineText(String(s?.reason || '')).trim() || null });
  }
  sins.sort((a, b) => b.rating - a.rating);
  for (let i = 0; i < sins.length; i++)
    if (sins[i].rating !== PATH_SINS_COUNT - i)
      return { error: 'Иерархия грехов: рейтинги должны идти 10→1 без пропусков' };
  return { sins };
}

function _pathTemplate({ name, nameEn, nickname, virtues, pillar, source, note, description, sins }) {
  const lines = [`# ${name}${nameEn ? ` (${nameEn})` : ''}`];
  if (nickname) lines.push(`- **Прозвище:** ${sanitizeInlineText(nickname)}`);
  if (virtues) lines.push(`- **Добродетели:** ${sanitizeInlineText(virtues)}`);
  if (pillar) lines.push(`- **Столп:** ${sanitizeInlineText(pillar)}`);
  if (source) lines.push(`- **Источник:** ${sanitizeInlineText(source)}`);
  lines.push('- **Авторское:** да');
  if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${sanitizeInlineText(l)}`); }
  lines.push('', '## Описание', '', sanitizeFreeformBody(description || ''), '');
  lines.push('## Иерархия грехов', '', ...sinsTableLines(sins || []), '');
  return lines.join('\n');
}

router.post('/api/library/vampire-paths', express.json(), async (req, res) => {
  try {
    const { name, nameEn, nickname, virtues, pillar, source, note, description } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const sv = _readPathSins(req.body);
    if (sv.error) return res.status(400).json({ error: sv.error });
    const slug = slugify(name);
    if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
    const file = path.join(PATHS_DIR, `${slug}.md`);
    if (await fs.stat(file).catch(() => null))
      return res.status(409).json({ error: 'Путь с таким названием уже существует', slug });
    await fs.mkdir(PATHS_DIR, { recursive: true });
    await writeFileAtomic(file, _pathTemplate({ name: name.trim(), nameEn, nickname, virtues, pillar, source, note, description, sins: sv.sins }), 'utf-8');
    _pathCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.put('/api/library/vampire-paths/:slug', express.json(), async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(PATHS_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Путь не найден' });
    if (!parsePathMd(existing, slug).custom)
      return res.status(403).json({ error: 'Редактирование доступно только для авторских путей' });
    const { name, nameEn, nickname, virtues, pillar, source, note, description } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const sv = _readPathSins(req.body);
    if (sv.error) return res.status(400).json({ error: sv.error });
    await writeFileAtomic(file, _pathTemplate({ name: name.trim(), nameEn, nickname, virtues, pillar, source, note, description, sins: sv.sins }), 'utf-8');
    _pathCache = null;
    res.json({ ok: true, slug });
  } catch (e) { serverError(res, e); }
});

router.delete('/api/library/vampire-paths/:slug', async (req, res) => {
  try {
    const slug = slugify(req.params.slug);   // FIX-17 — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
    const file = path.join(PATHS_DIR, `${slug}.md`);
    const existing = await fs.readFile(file, 'utf-8').catch(() => null);
    if (existing == null) return res.status(404).json({ error: 'Путь не найден' });
    if (!parsePathMd(existing, slug).custom)
      return res.status(403).json({ error: 'Удаление доступно только для авторских путей' });
    const trashDir = path.join(PATHS_DIR, '_deleted');
    await fs.mkdir(trashDir, { recursive: true });
    await fs.rename(file, path.join(trashDir, `${slug}_${Date.now()}.md`));
    _pathCache = null;
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// ── Библиотека: загрузка/замена изображения записи (2026-08-08) ─────────────
// Один слот на запись (не как у персонажа — там несколько портретов). Заменяет существующий
// файл тем же путём — writeFileAtomic делает саму перезапись идемпотентной, отдельной ветки
// «файла ещё нет» не требуется. Доступно для ЛЮБОЙ записи, включая каноническую — правка
// канона по духу (не по механике: файл заменяется целиком, не патчится) рискует тем же
// откатом на update.bat, что и правка текста, но цена мягче (не потеря авторского текста).
// Имя kind совпадает с именем каталога и в system/library/<kind>/, и в
// web/public/img/system/library/<kind>/ — везде без исключений, поэтому таблица
// kind → каталог не нужна, путь строится прямо из :kind (проверенного по белому списку).
const LIB_IMAGE_KINDS = new Set([
  'disciplines', 'psychics', 'clans', 'sects', 'titles', 'merits', 'flaws', 'backgrounds',
  'mortal-government', 'mortal-religious', 'mortal-crime', 'mortal-civic', 'mortal-positions',
  'ghouls', 'revenant-families', 'sabbat-rites', 'vampire-paths',
  'rituals',
  'mage-traditions', 'mage-conventions', 'werewolf-tribes', 'werewolf-auspices', 'werewolf-breeds',
  'fairy-kiths', 'fairy-courts', 'fairy-seemings', 'fairy-houses',
  'fairy-arts', 'fairy-realms',
  'werewolf-gifts', 'werewolf-rites', 'mage-spheres', 'mage-techniques', 'mage-tarot',
  'mage-rotes', 'mage-factions', 'mage-chantries', 'mage-wonders', 'mage-worlds',
]);

router.post('/api/library/:kind/:slug/image', express.json({ limit: '20mb' }), async (req, res) => {
  try {
    const kind = req.params.kind;
    if (!LIB_IMAGE_KINDS.has(kind)) return res.status(400).json({ error: 'Неизвестная категория библиотеки' });
    const slug = slugify(req.params.slug);   // FIX-17 pattern — see disciplines PUT above
    if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });

    // Только PNG — вся читающая сторона библиотеки жёстко предполагает .png. Фронтенд обязан
    // прислать уже сконвертированный PNG (<canvas>-конвертация, v20-sheet.js).
    const validated = validateImageUpload(req.body.base64, 'png');
    if (!validated.ok) return res.status(400).json({ error: validated.error });

    const imgDir = path.join(__dirname, '..', 'public', 'img', 'system', 'library', kind);
    await fs.mkdir(imgDir, { recursive: true });
    await writeFileAtomic(path.join(imgDir, `${slug}.png`), validated.buffer);
    // Ни один *Cache-объект не хранит сам факт hasArt отдельно от чтения каталога на каждый
    // запрос (_artFileSet) — инвалидировать нечего, следующий GET увидит новый файл сразу.
    res.json({ ok: true, url: `/img/system/library/${kind}/${slug}.png` });
  } catch (e) { serverError(res, e); }
});

// ── Обобщённый MD-track CRUD (2026-08-08) — то же обобщение, что _jsonLibRoutes уже сделала
// для JSON-track при добавлении третьей JSON-категории (см. ниже). Кланы/Секты/Титулы НЕ
// переводятся на этот хелпер — своя разметка, есть причина для отдельного кода (у Клана есть
// «Дисциплины»/«Слабость», у Титула — «Принадлежность»/«Негативный») — только 5 новых категорий
// «Смертные», у которых схема идентична друг другу и «Секте» (имя/источник/примечание/описание,
// без специфичных полей).
// fields (необязательно, 2026-10-12 — Библиотека «Оборотни»): доп. строки шапки записи
// `- **<label>:** значение` → ключ API. type 'int' — целое в [min, max] (пусто допустимо),
// 'text' — строка. Без fields поведение прежнее («Смертные», «Маги»).
// parse (необязательно, 2026-10-13 — Искусства/Королевства фей): хук
// `(md, slug) => partialRec`, подмешивается в запись поверх базы (уровни).
// templateLevels (необязательно): `(lvl) => string[]` — строки MD одного уровня
// для авторского шаблона (зеркало _discTemplate: без серверной валидации,
// безымянные отсекает клиент в _libCollectLevels).
// powerBody (необязательно, 2026-10-13 — Дары/Обряды/Техники): запись — одна
// сила без шкалы уровней; тело пишется маркерами **Литературное описание.** /
// **Система.** вместо ## Описание, поле формы `description` → литературное,
// `system-text` → система.
function _mdLibRoutes({ apiName, dir, noun, fields = [], parse: parseHook, templateLevels, powerBody }) {
  const DIR = path.join(ROOT, 'system', 'library', dir);
  let cache = null; // { sig, list }

  const fieldRe = label => new RegExp(`^[-*]\\s*\\*\\*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\*\\*\\s*(.+)$`, 'm');
  function parse(md, slug) {
    const rec = parseSectMd(md, slug);
    const body = String(md || '').replace(/\r\n?/g, '\n');
    for (const f of fields) {
      const m = body.match(fieldRe(f.label));
      const raw = m ? m[1].trim() : '';
      rec[f.key] = f.type === 'int' ? (raw === '' || isNaN(parseInt(raw, 10)) ? null : parseInt(raw, 10)) : raw;
    }
    if (parseHook) Object.assign(rec, parseHook(md, slug));
    return rec;
  }
  // Проверка и нормализация полей из тела запроса: { values } или { error }.
  function readFields(body) {
    const values = {};
    for (const f of fields) {
      const raw = body?.[f.key];
      if (raw == null || String(raw).trim() === '') { values[f.key] = ''; continue; }
      if (f.type === 'int') {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < f.min || n > f.max)
          return { error: `${f.label}: целое число от ${f.min} до ${f.max}` };
        values[f.key] = n;
      } else values[f.key] = sanitizeInlineText(String(raw)).trim();
    }
    return { values };
  }

  async function load() {
    const files = (await fs.readdir(DIR).catch(() => null));
    if (!files) return [];
    const mds = files.filter(f => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort();
    const stats = await Promise.all(mds.map(f => fs.stat(path.join(DIR, f)).catch(() => null)));
    const sig = mds.map((f, i) => `${f}:${stats[i] ? stats[i].mtimeMs : 0}`).join('|');
    if (cache && cache.sig === sig) return cache.list;
    const list = [];
    for (const f of mds) {
      const slug = f.replace(/\.md$/, '');
      const md = await fs.readFile(path.join(DIR, f), 'utf-8').catch(() => '');
      if (md) list.push(parse(md, slug)); // база — формат «Секты», плюс поля fields
    }
    cache = { sig, list };
    return list;
  }

  router.get(`/api/library/${apiName}`, async (_req, res) => {
    try { res.json(_withArt(await load(), await _artFileSet(apiName))); }
    catch (e) { serverError(res, e); }
  });

  function template({ name, source, note, description, levels, system }, values = {}) {
    const lines = [`# ${name}`];
    for (const f of fields) if (values[f.key] !== '' && values[f.key] != null) lines.push(`- **${f.label}:** ${values[f.key]}`);
    if (source) lines.push(`- **Источник:** ${sanitizeInlineText(source)}`);
    lines.push('- **Авторское:** да');
    if (note) { lines.push(''); for (const l of note.split('\n')) lines.push(`> ${sanitizeInlineText(l)}`); }
    if (powerBody) {
      lines.push('', `**Литературное описание.** ${sanitizeInlineText(description || '')}`, '');
      if (system && String(system).trim()) lines.push(`**Система.** ${sanitizeInlineText(system)}`, '');
    } else {
      lines.push('', '## Описание', '', sanitizeFreeformBody(description || ''), '');
    }
    if (templateLevels) for (const lvl of (levels || [])) {
      const n = parseInt(lvl && lvl.level, 10) || 1;
      lines.push(`## Уровень ${n} — ${sanitizeInlineText((lvl && lvl.name) || '')}`, '');
      for (const l of templateLevels(lvl || {}, n)) lines.push(l);
      lines.push('');
    }
    return lines.join('\n');
  }

  router.post(`/api/library/${apiName}`, express.json(), async (req, res) => {
    try {
      const { name, source, note, description, levels, system } = req.body || {};
      if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
      const fv = readFields(req.body);
      if (fv.error) return res.status(400).json({ error: fv.error });
      const slug = slugify(name);
      if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
      const file = path.join(DIR, `${slug}.md`);
      if (await fs.stat(file).catch(() => null))
        return res.status(409).json({ error: `${noun} с таким названием уже существует`, slug });
      // В отличие от Кланов/Секты/Титулов, у этих пяти категорий каталог не гарантированно
      // существует заранее (новая библиотека без канонических записей на старте) — mkdir
      // идемпотентен, не мешает уже существующим каталогам с готовым контентом.
      await fs.mkdir(DIR, { recursive: true });
      await writeFileAtomic(file, template({ name: name.trim(), source, note, description, levels, system }, fv.values), 'utf-8');
      cache = null;
      res.json({ ok: true, slug });
    } catch (e) { serverError(res, e); }
  });

  router.put(`/api/library/${apiName}/:slug`, express.json(), async (req, res) => {
    try {
      const slug = slugify(req.params.slug);   // FIX-17 pattern — see disciplines PUT above
      if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
      const file = path.join(DIR, `${slug}.md`);
      const existing = await fs.readFile(file, 'utf-8').catch(() => null);
      if (existing == null) return res.status(404).json({ error: `${noun} не найден(а)` });
      if (!parseSectMd(existing, slug).custom)
        return res.status(403).json({ error: `Редактирование доступно только для авторских записей` });
      const { name, source, note, description, levels, system } = req.body || {};
      if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
      const fv = readFields(req.body);
      if (fv.error) return res.status(400).json({ error: fv.error });
      await writeFileAtomic(file, template({ name: name.trim(), source, note, description, levels, system }, fv.values), 'utf-8');
      cache = null;
      res.json({ ok: true, slug });
    } catch (e) { serverError(res, e); }
  });

  router.delete(`/api/library/${apiName}/:slug`, async (req, res) => {
    try {
      const slug = slugify(req.params.slug);   // FIX-17 pattern — see disciplines PUT above
      if (!slug) return res.status(400).json({ error: 'Недопустимый slug' });
      const file = path.join(DIR, `${slug}.md`);
      const existing = await fs.readFile(file, 'utf-8').catch(() => null);
      if (existing == null) return res.status(404).json({ error: `${noun} не найден(а)` });
      if (!parseSectMd(existing, slug).custom)
        return res.status(403).json({ error: `Удаление доступно только для авторских записей` });
      const trashDir = path.join(DIR, '_deleted');
      await fs.mkdir(trashDir, { recursive: true });
      await fs.rename(file, path.join(trashDir, `${slug}_${Date.now()}.md`));
      cache = null;
      res.json({ ok: true });
    } catch (e) { serverError(res, e); }
  });

  return { load };
}

_mdLibRoutes({ apiName: 'mortal-government', dir: 'mortal-government', noun: 'Служба' });
_mdLibRoutes({ apiName: 'mortal-religious',  dir: 'mortal-religious',  noun: 'Организация' });
_mdLibRoutes({ apiName: 'mortal-crime',      dir: 'mortal-crime',      noun: 'Группировка' });
_mdLibRoutes({ apiName: 'mortal-civic',      dir: 'mortal-civic',      noun: 'Организация' });
_mdLibRoutes({ apiName: 'mortal-positions',  dir: 'mortal-positions',  noun: 'Должность' });

// «Гули и ревенанты» (2026-10-15) — схема «Смертных»; у семей поле Дисциплины.
// Спека — doc/design/2026-10-15-library-vampire-gaps-spec.md §4.
_mdLibRoutes({ apiName: 'ghouls', dir: 'ghouls', noun: 'Запись' });
_mdLibRoutes({ apiName: 'revenant-families', dir: 'revenant-families', noun: 'Семья', fields: [
  { key: 'disciplines', label: 'Дисциплины', type: 'text' },
] });

// «Обряды Шабаша» (2026-10-15) — схема «Смертных»; поле Тип
// (священный/мирский/основополагающий). Спека — там же, §5.
_mdLibRoutes({ apiName: 'sabbat-rites', dir: 'sabbat-rites', noun: 'Обряд', fields: [
  { key: 'type', label: 'Тип', type: 'text' },
] });

// «Маги» (2026-10-12) — Традиции и Конвенции, схема «Смертных».
_mdLibRoutes({ apiName: 'mage-traditions',  dir: 'mage-traditions',  noun: 'Традиция' });
_mdLibRoutes({ apiName: 'mage-conventions', dir: 'mage-conventions', noun: 'Конвенция' });

// «Оборотни» (2026-10-12) — этап 1. Ключи полей — контракт с листом оборотня (_wwRefData).
const _WW_GIFTS = { key: 'gifts', label: 'Начальные Дары', type: 'text' };
_mdLibRoutes({ apiName: 'werewolf-tribes', dir: 'werewolf-tribes', noun: 'Племя', fields: [
  { key: 'totem', label: 'Тотем', type: 'text' },
  { key: 'willpower', label: 'Сила воли', type: 'int', min: 1, max: 5 },
  { key: 'restrictions', label: 'Ограничения деталей биографии', type: 'text' },
  _WW_GIFTS,
] });
_mdLibRoutes({ apiName: 'werewolf-auspices', dir: 'werewolf-auspices', noun: 'Покровительство', fields: [
  { key: 'moon', label: 'Луна', type: 'text' },
  { key: 'rage', label: 'Ярость', type: 'int', min: 1, max: 5 },
  { key: 'renown', label: 'Начальный Почёт', type: 'text' },
  _WW_GIFTS,
] });
_mdLibRoutes({ apiName: 'werewolf-breeds', dir: 'werewolf-breeds', noun: 'Порода', fields: [
  { key: 'gnosis', label: 'Гнозис', type: 'int', min: 1, max: 5 },
  _WW_GIFTS,
] });

// «Феи» (2026-10-12) — Киты (Права рождения/Слабость/Предрасположенность),
// Дворы (без доп. полей) и Обличья (стартовые Гламур/Воля/Банальность —
// сверены с changeling-sheet.js:_chgSeemingStart). Спека —
// doc/design/2026-10-12-library-fairies-spec.md.
_mdLibRoutes({ apiName: 'fairy-kiths', dir: 'fairy-kiths', noun: 'Кит', fields: [
  { key: 'birthrights', label: 'Права рождения', type: 'text' },
  { key: 'frailty', label: 'Слабость', type: 'text' },
  { key: 'affinity', label: 'Предрасположенность', type: 'text' },
] });
_mdLibRoutes({ apiName: 'fairy-courts', dir: 'fairy-courts', noun: 'Двор' });
_mdLibRoutes({ apiName: 'fairy-seemings', dir: 'fairy-seemings', noun: 'Обличье', fields: [
  { key: 'glamour', label: 'Гламур', type: 'int', min: 1, max: 5 },
  { key: 'willpower', label: 'Сила воли', type: 'int', min: 1, max: 5 },
  { key: 'banality', label: 'Банальность', type: 'int', min: 1, max: 5 },
] });
_mdLibRoutes({ apiName: 'fairy-houses', dir: 'fairy-houses', noun: 'Дом', fields: [
  { key: 'boon', label: 'Благо', type: 'text' },
  { key: 'flaw', label: 'Порок', type: 'text' },
] });

// «Феи» — Искусства (Атрибут + уровни) и Королевства (уровни; текст ступени —
// одним блоком). Модалки — как дисциплины (точки + описание + система),
// спека — doc/specs/fairy-arts-realms-modal/spec.md.
const _FA_LEVEL_ART = lvl => [
  `**Литературное описание.** ${sanitizeInlineText(lvl.literary || '')}`, '',
  `**Система.** ${sanitizeInlineText(lvl.system || '')}`,
];
const _FA_LEVEL_REALM = lvl => {
  const lines = [sanitizeInlineText(lvl.literary || '')];
  if (lvl.system && String(lvl.system).trim())
    lines.push('', `**Система.** ${sanitizeInlineText(lvl.system)}`);
  return lines;
};
_mdLibRoutes({ apiName: 'fairy-arts', dir: 'fairy-arts', noun: 'Искусство', fields: [
  { key: 'attribute', label: 'Атрибут', type: 'text' },
], parse: parseFairyArtMd, templateLevels: _FA_LEVEL_ART });
_mdLibRoutes({ apiName: 'fairy-realms', dir: 'fairy-realms', noun: 'Королевство',
  parse: parseFairyRealmMd, templateLevels: _FA_LEVEL_REALM });

// «Оборотни» — Дары и Обряды + «Маги» — Сферы и Техники (2026-10-13,
// спека doc/specs/werewolf-mage-library-expansion/spec.md).
// Дары: одна запись = один Дар (группа + уровень 1–5, без шкалы levels);
// тело — силовые маркеры (powerBody). Обряды/техники: тип + силовое тело.
_mdLibRoutes({ apiName: 'werewolf-gifts', dir: 'werewolf-gifts', noun: 'Дар', fields: [
  { key: 'group', label: 'Группа', type: 'text' },
  { key: 'level', label: 'Уровень', type: 'int', min: 1, max: 5 },
], parse: parseWerewolfGiftMd, powerBody: true });
_mdLibRoutes({ apiName: 'werewolf-rites', dir: 'werewolf-rites', noun: 'Обряд', fields: [
  { key: 'type', label: 'Тип', type: 'text' },
  { key: 'level', label: 'Уровень', type: 'int', min: 1, max: 5 },
], parse: parseWerewolfRiteMd, powerBody: true });
_mdLibRoutes({ apiName: 'mage-spheres', dir: 'mage-spheres', noun: 'Сфера',
  parse: parseMageSphereMd, templateLevels: _FA_LEVEL_ART });
_mdLibRoutes({ apiName: 'mage-techniques', dir: 'mage-techniques', noun: 'Техника',
  parse: parseMageTechniqueMd, powerBody: true });

// «Маги» — Таро (2026-10-13, отдельная подвкладка): 22 Старших Аркана +
// 56 Младших (Искание/Изначальность/Динамизм/Узор). Тело — как у техник
// (образ + применение), фильтр чипов — по Аркану (клиент, library-lineages.js).
_mdLibRoutes({ apiName: 'mage-tarot', dir: 'mage-tarot', noun: 'Карта', fields: [
  { key: 'arcana', label: 'Аркан', type: 'text' },
  { key: 'meaning', label: 'Значение', type: 'text' },
  { key: 'reversed', label: 'Перевёрнутая', type: 'text' },
  { key: 'association', label: 'Ассоциация', type: 'text' },
], parse: parseMageTarotMd, powerBody: true });

// «Маги» — наполнение по книгам братств и сетинга (2026-10-13): Роты
// (фирменные эффекты), Фракции (малые и тёмные силы, схема Традиций),
// Часовни, Чудеса и Миры (силовое тело как у техник).
_mdLibRoutes({ apiName: 'mage-rotes', dir: 'mage-rotes', noun: 'Рота', fields: [
  { key: 'affiliation', label: 'Принадлежность', type: 'text' },
  { key: 'spheres', label: 'Сферы', type: 'text' },
], parse: parseMageTechniqueMd, powerBody: true });
_mdLibRoutes({ apiName: 'mage-factions', dir: 'mage-factions', noun: 'Фракция' });
_mdLibRoutes({ apiName: 'mage-chantries', dir: 'mage-chantries', noun: 'Часовня', fields: [
  { key: 'type', label: 'Тип', type: 'text' },
  { key: 'place', label: 'Расположение', type: 'text' },
], parse: parseMageTechniqueMd, powerBody: true });
_mdLibRoutes({ apiName: 'mage-wonders', dir: 'mage-wonders', noun: 'Чудо', fields: [
  { key: 'type', label: 'Тип', type: 'text' },
  { key: 'power', label: 'Сила', type: 'text' },
], parse: parseMageTechniqueMd, powerBody: true });
_mdLibRoutes({ apiName: 'mage-worlds', dir: 'mage-worlds', noun: 'Мир', fields: [
  { key: 'layer', label: 'Слой', type: 'text' },
], parse: parseMageTechniqueMd, powerBody: true });

// ── JSON-track (достоинства/недостатки/факты биографии) ─────────────────────
const MERIT_CATEGORIES      = ['physical', 'social', 'mental', 'supernatural'];
const FLAW_CATEGORIES       = ['физические', 'умственные', 'социальные', 'сверхъестественные'];
const BACKGROUND_CATEGORIES = ['general', 'vampire', 'ghoul', 'mage', 'changeling'];

async function _readJsonArray(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf-8')); }
  catch { return []; }
}

// Опциональное поле restriction (§5 спеки doc/design/2026-10-15-library-mage-hunter-gaps-spec.md):
// машиночитаемый дубль текстовых ограничений записи. Отсутствие поля = без ограничений
// (обратная совместимость, существующие тесты не трогаем). GET отдают записи целиком
// ({...x} в _withArt), поэтому отдельно ничего менять не нужно — только POST/PUT.
// Существующие sectOnly/clanOnly у фонов НЕ удаляются. specializations — вне скоупа.
const RESTRICTION_KEYS = ['sects', 'clans', 'lineages', 'minWillpower', 'minHumanity',
  'requires', 'incompatible', 'maxLevels', 'priceMultiplier', 'note'];
const _RESTRICTION_ARRAYS = ['sects', 'clans', 'lineages', 'requires', 'incompatible'];
const _RESTRICTION_NUMS = ['minWillpower', 'minHumanity', 'maxLevels', 'priceMultiplier'];

// Возвращает null, если поля restriction нет в теле (путь «как раньше»);
// { fields } при корректном объекте; { err } — уже отправленный 400 при мусоре.
function _restrictionFields(body, res) {
  if (body?.restriction === undefined) return null;
  const r = body.restriction;
  if (!r || typeof r !== 'object' || Array.isArray(r))
    return { err: res.status(400).json({ error: 'Поле restriction должно быть объектом' }) };
  for (const k of Object.keys(r)) {
    if (!RESTRICTION_KEYS.includes(k))
      return { err: res.status(400).json({ error: `Неизвестный ключ restriction: ${k}` }) };
  }
  for (const k of _RESTRICTION_ARRAYS) {
    if (r[k] !== undefined && (!Array.isArray(r[k]) || !r[k].every(x => typeof x === 'string')))
      return { err: res.status(400).json({ error: `Поле restriction.${k} должно быть массивом строк` }) };
  }
  for (const k of _RESTRICTION_NUMS) {
    if (r[k] !== undefined && (typeof r[k] !== 'number' || !Number.isFinite(r[k])))
      return { err: res.status(400).json({ error: `Поле restriction.${k} должно быть числом` }) };
  }
  if (r.note !== undefined && typeof r.note !== 'string')
    return { err: res.status(400).json({ error: 'Поле restriction.note должно быть строкой' }) };
  return { fields: { restriction: r } };
}

function _jsonLibRoutes({ apiName, dir, categories, invalidate, extraFields, requiredFields = [], allowRestriction = false }) {
  const dirPath = path.join(ROOT, 'system', 'library', dir);

  // Проверка обязательных полей тела (requiredFields): пустое значение → 400.
  function _checkRequired(body, res) {
    for (const f of requiredFields) {
      const v = body?.[f];
      if (v == null || String(v).trim() === '')
        return res.status(400).json({ error: `Поле ${f} обязательно` });
    }
    return null;
  }

  router.post(`/api/library/${apiName}`, express.json(), async (req, res) => {
    try {
      const { category, name } = req.body || {};
      if (!categories.includes(category)) return res.status(400).json({ error: 'Неизвестная категория' });
      if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
      const reqErr = _checkRequired(req.body, res);
      if (reqErr) return reqErr;
      const slug = slugify(name);
      if (!slug) return res.status(400).json({ error: 'Не удалось построить slug из названия' });
      const file = path.join(dirPath, `${category}.json`);
      const list = await _readJsonArray(file);
      if (list.some(x => x.slug === slug))
        return res.status(409).json({ error: 'Запись с таким названием уже есть в категории', slug });
      let restr = {};
      if (allowRestriction) {
        const parsed = _restrictionFields(req.body, res);
        if (parsed?.err) return parsed.err;
        if (parsed) restr = parsed.fields;
      }
      const entry = { slug, name: name.trim(), ...extraFields(req.body), ...restr, category, custom: true };
      list.push(entry);
      await writeFileAtomic(file, JSON.stringify(list, null, 2) + '\n', 'utf-8');
      invalidate(category);
      res.json({ ok: true, slug });
    } catch (e) { serverError(res, e); }
  });

  router.put(`/api/library/${apiName}/:category/:slug`, express.json(), async (req, res) => {
    try {
      const { category, slug } = req.params;
      if (!categories.includes(category)) return res.status(400).json({ error: 'Неизвестная категория' });
      const file = path.join(dirPath, `${category}.json`);
      const list = await _readJsonArray(file);
      const idx = list.findIndex(x => x.slug === slug);
      if (idx === -1) return res.status(404).json({ error: 'Запись не найдена' });
      if (!list[idx].custom) return res.status(403).json({ error: 'Редактирование доступно только для авторских записей' });
      const { name } = req.body || {};
      if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
      const reqErr = _checkRequired(req.body, res);
      if (reqErr) return reqErr;
      let restr = {};
      if (allowRestriction) {
        const parsed = _restrictionFields(req.body, res);
        if (parsed?.err) return parsed.err;
        if (parsed) restr = parsed.fields;
      }
      list[idx] = { ...list[idx], name: name.trim(), ...extraFields(req.body), ...restr };
      await writeFileAtomic(file, JSON.stringify(list, null, 2) + '\n', 'utf-8');
      invalidate(category);
      res.json({ ok: true });
    } catch (e) { serverError(res, e); }
  });

  router.delete(`/api/library/${apiName}/:category/:slug`, async (req, res) => {
    try {
      const { category, slug } = req.params;
      if (!categories.includes(category)) return res.status(400).json({ error: 'Неизвестная категория' });
      const file = path.join(dirPath, `${category}.json`);
      const list = await _readJsonArray(file);
      const idx = list.findIndex(x => x.slug === slug);
      if (idx === -1) return res.status(404).json({ error: 'Запись не найдена' });
      if (!list[idx].custom) return res.status(403).json({ error: 'Удаление доступно только для авторских записей' });
      const entry = list[idx];
      list.splice(idx, 1);
      await writeFileAtomic(file, JSON.stringify(list, null, 2) + '\n', 'utf-8');
      // Мягкое удаление → _deleted.json категории (вкладка «Удалённые», D5):
      // запись остаётся восстанавливаемой через /api/trash.
      const deletedFile = path.join(dirPath, '_deleted.json');
      const bin = await _readJsonArray(deletedFile);
      bin.push({
        storedName: `${dir}__${entry.slug}__${category}`,
        kind: 'library-json', dir, slug: entry.slug, category,
        name: entry.name, display: entry.name, custom: true,
        deletedAt: new Date().toISOString(),
        snapshot: entry,
      });
      await writeFileAtomic(deletedFile, JSON.stringify(bin, null, 2) + '\n', 'utf-8');
      invalidate(category);
      res.json({ ok: true });
    } catch (e) { serverError(res, e); }
  });
}

_jsonLibRoutes({
  apiName: 'merits', dir: 'merits', categories: MERIT_CATEGORIES, invalidate: invalidateMerits,
  extraFields: b => ({ points: b.points ?? '', description: b.description || '' }),
  allowRestriction: true,
});
_jsonLibRoutes({
  apiName: 'flaws', dir: 'flaws', categories: FLAW_CATEGORIES, invalidate: invalidateFlaws,
  extraFields: b => ({ points: b.points ?? '', description: b.description || '' }),
  allowRestriction: true,
});
_jsonLibRoutes({
  apiName: 'backgrounds', dir: 'backgrounds', categories: BACKGROUND_CATEGORIES, invalidate: invalidateBackgrounds,
  extraFields: b => ({ description: b.description || '', system: b.system || '' }),
  allowRestriction: true,
});
_jsonLibRoutes({
  apiName: 'archetypes', dir: 'archetypes', categories: ['archetypes'], invalidate: invalidateArchetypes,
  extraFields: b => ({ name_en: b.name_en || '', description: b.description || '', description_en: b.description_en || '', willpower: b.willpower || '', willpower_en: b.willpower_en || '' }),
  allowRestriction: true,
});
_jsonLibRoutes({
  apiName: 'essences', dir: 'essences', categories: ['essences'], invalidate: invalidateEssences,
  extraFields: b => ({ name_en: b.name_en || '', element: b.element || '', description: b.description || '', description_en: b.description_en || '' }),
  allowRestriction: true,
});
_jsonLibRoutes({
  apiName: 'specializations', dir: 'specializations', categories: ['specializations'], invalidate: invalidateSpecializations,
  extraFields: b => ({ ability: b.ability || '', description: b.description || '' }),
  requiredFields: ['ability'],
});

module.exports = { router, loadDisciplines, loadPsychics };
