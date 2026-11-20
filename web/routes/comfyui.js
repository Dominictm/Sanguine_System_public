'use strict';
// Генерация изображений персонажей и локаций через локальный ComfyUI (spec doc/design/comfyui).
// Генерация — фоновое задание (первая загрузка модели идёт минутами): POST запускает, GET опрашивает.
// Результат — кандидат в art/_candidates/, текущий арт не трогается до явного «Принять».

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { serverError, aiRateLimit } = require('../lib/http');
const { ROOT, reqCity, charsDir, locsDir, getAllCharacters, findLocMdPath, invalidateChars, invalidateLocs, writeFileAtomic } = require('../lib/db');
const { parseLocation, parseDistrictMd, DISTRICT_FILENAME } = require('../lib/parsers');
const { saveCharacterArt, saveLocationArt, saveDistrictArt, readDistrictPrompts } = require('../lib/art-store');
const comfy = require('../lib/comfyui');
const { createMonitor } = require('../lib/llamacpp/monitor');

const CITIES_DIR = path.join(ROOT, 'cities');
// Размер по умолчанию — если в промте нет «W×H» (spec FR14): персонаж — портрет, локация — пейзаж.
const KINDS = {
  character: { width: 832, height: 1216, preset: 'portrait' },
  location:  { width: 1216, height: 832, preset: 'landscape' },
  district:  { width: 1216, height: 832, preset: 'landscape' },
};
const presetById = id => comfy.SIZE_PRESETS.find(p => p.id === id) || null;
// Район генерируется профилем и параметрами локаций (landscape). lib/comfyui.js типизирует
// kind сам (KIND_LIST/KIND_PARAMS/PREFERRED_CKPTS) и молча деградирует неизвестный kind к
// character (steps/cfg и негатив-дополнения персонажей) — поэтому на границе route→lib kind
// транслируется (spec doc/design/district-images-2026-11-17, FR7).
const libKind = kind => (kind === 'district' ? 'location' : kind);
// Размер, который модалка предлагает по умолчанию: из промта (подогнан к пресету) → по виду сущности.
function suggestedSize(kind, positive) {
  const fromPrompt = comfy.promptSize(positive);
  return { promptSize: fromPrompt, preset: fromPrompt ? comfy.fitPreset(fromPrompt) : presetById(KINDS[kind].preset) };
}
const JOB_TTL_MS = 3600_000;
const SLUG_RE = /^[^\\/]+$/;
// Заглушки шаблонов карточек — это не промт (characters.js, _locCardTemplate).
const isPlaceholderPrompt = s => !s || /^⏳|^\[промт\]$/i.test(s.trim());

const jobs = new Map();          // jobId → { status, phase, step, steps, log, res, …, candidate, error }
let running = null;              // jobId текущей генерации (одна за раз — spec FR8)
const LOG_MAX = 200;

// Нагрузка CPU/RAM/GPU/VRAM — тот же монитор, что у модалки llama.cpp (spec FR10).
let monitorJob = null;
const monitor = createMonitor(s => { if (monitorJob) monitorJob.res = s; });

function _log(job, text) {
  const d = new Date();
  const hh = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
  job.log.push(`[${hh}] ${text}`);
  if (job.log.length > LOG_MAX) job.log.splice(0, job.log.length - LOG_MAX);
}

// Оценка оставшегося времени по средней длительности шага (первый шаг — с загрузкой, не в счёт).
function _etaSec(job) {
  if (!['generating', 'refining'].includes(job.phase) || !job.steps || job.step < 2 || !job.stepT0) return null;
  const per = (job.stepAt - job.stepT0) / (job.step - 1);
  return Math.max(0, Math.round((per * (job.steps - job.step)) / 1000));
}

function _pruneJobs(now = Date.now()) {
  for (const [id, j] of jobs) if (j.finishedAt && now - j.finishedAt > JOB_TTL_MS) jobs.delete(id);
}

function _imgUrl(file) {
  return '/city-img/' + path.relative(CITIES_DIR, file).split(path.sep).map(encodeURIComponent).join('/');
}

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

// Сущность карточки: папка, промты, запись принятого арта.
async function resolveEntity(city, kind, slug) {
  if (!KINDS[kind]) throw new HttpError(400, 'kind: ожидается character, location или district');
  slug = String(slug || '');
  if (!slug || !SLUG_RE.test(slug) || slug.includes('..')) throw new HttpError(400, 'Недопустимый slug');
  if (kind === 'character') {
    const char = (await getAllCharacters(city)).find(c => c.slug === slug);
    if (!char) throw new HttpError(404, 'Персонаж не найден');
    const dir = path.join(charsDir(city), char.lineageFolder, char.slug);
    return {
      dir, slug, name: char.name, gender: char.gender && !char.gender.includes('⚠️') ? char.gender : '',
      positive: isPlaceholderPrompt(char.imagePrompt) ? '' : char.imagePrompt.trim(),
      negative: isPlaceholderPrompt(char.negativePrompt) ? '' : String(char.negativePrompt || '').trim(),
      save: async buf => { const r = await saveCharacterArt(dir, char.slug, buf, 'png'); invalidateChars(city); return r; },
    };
  }
  if (kind === 'district') {
    // findLocMdPath пропускает district.md (db.js) — резолвер района свой: папка района.
    // Инвалидация кэша локаций не нужна: getAllLocations art-папки районов не читает.
    const dir = path.join(locsDir(city), slug);
    const raw = await fs.readFile(path.join(dir, DISTRICT_FILENAME), 'utf-8').catch(() => null);
    if (raw === null) throw new HttpError(404, 'Район не найден');
    const { name } = parseDistrictMd(raw);
    const { positive, negative } = await readDistrictPrompts(dir);
    return {
      dir, slug, name: name || slug,
      positive: isPlaceholderPrompt(positive) ? '' : positive.trim(),
      negative: isPlaceholderPrompt(negative) ? '' : negative.trim(),
      save: async buf => saveDistrictArt(dir, slug, buf, 'png'),
    };
  }
  const mdPath = await findLocMdPath(slug, city);
  if (!mdPath) throw new HttpError(404, 'Локация не найдена');
  const loc = parseLocation(await fs.readFile(mdPath, 'utf-8'), slug);
  return {
    dir: path.dirname(mdPath), slug, name: loc.title || slug,
    positive: isPlaceholderPrompt(loc.imagePrompt) ? '' : String(loc.imagePrompt).trim(),
    negative: isPlaceholderPrompt(loc.negativePrompt) ? '' : String(loc.negativePrompt || '').trim(),
    save: async buf => { const r = await saveLocationArt(mdPath, slug, buf, 'png'); invalidateLocs(city); return r; },
  };
}

const candDir = ent => path.join(ent.dir, 'art', comfy.CANDIDATES_DIR);

async function listCandidates(ent) {
  const dir = candDir(ent);
  const files = (await fs.readdir(dir).catch(() => [])).filter(f => comfy.CANDIDATE_RE.test(f)).sort().reverse();
  return files.map(file => ({ file, url: _imgUrl(path.join(dir, file)) }));
}

function _checkFile(file) {
  if (!comfy.CANDIDATE_RE.test(String(file || ''))) throw new HttpError(400, 'Недопустимое имя кандидата');
  return String(file);
}

// Архитектура каждой LoRA (sdxl / sd15 / flux / other / null) — настройки помечают несовместимые.
async function _loraArchMap(dir, loras) {
  const out = {};
  for (const n of loras) out[n] = await comfy.loraArch(dir, n);
  return out;
}

function _send(res, e) {
  if (e instanceof HttpError || e instanceof comfy.ComfyError) return res.status(e.status).json({ ok: false, error: e.message });
  return serverError(res, e);
}

module.exports = function comfyuiRouter() {
  const router = express.Router();

  router.get('/api/comfyui/status', async (req, res) => {
    try {
      const cfg = comfy.config();
      const cur = running && jobs.get(running);
      res.json({ ok: true, available: await comfy.isUp(cfg.baseUrl), baseUrl: cfg.baseUrl, dir: cfg.dir,
        busy: !!running, autostart: !!cfg.dir,
        // Идущее задание — чтобы страница после перезагрузки снова показала его модалку.
        job: cur ? { id: running, kind: cur.kind, slug: cur.slug } : null });
    } catch (e) { _send(res, e); }
  });

  // Профили генерации (profiles-spec §4.2): списки моделей и LoRA + сохранённые профили портретов и локаций.
  // ComfyUI не запущен — списки с диска из папки автозапуска (source: 'disk'), чтобы настроить заранее.
  router.get('/api/comfyui/profiles', async (req, res) => {
    try {
      const cfg = comfy.config();
      const available = await comfy.isUp(cfg.baseUrl);
      const [checkpoints, loras, profiles] = await Promise.all([
        available ? comfy.listCheckpoints(cfg.baseUrl) : comfy.listLocalModels(cfg.dir, 'checkpoints'),
        available ? comfy.listLoras(cfg.baseUrl) : comfy.listLocalModels(cfg.dir, 'loras'),
        comfy.loadProfiles(),
      ]);
      // selected — модель, которая реально возьмётся (сохранённая или по умолчанию вида).
      // defaults — что возьмётся при «По умолчанию».
      const selected = {}, defaults = {};
      for (const kind of Object.keys(KINDS)) {
        const lk = libKind(kind); // профиль и дефолт чекпоинта — по виду-источнику (район → локации)
        defaults[kind] = comfy.pickCheckpoint(checkpoints, '', lk);
        selected[kind] = checkpoints.length ? comfy.pickCheckpoint(checkpoints, profiles[lk].ckpt, lk) : profiles[lk].ckpt;
      }
      // Архитектура и «модель на тегах» каждого чекпоинта (и сохранённых, которых нет в списке).
      const ckptInfo = {};
      for (const name of [...checkpoints, ...Object.values(profiles).map(p => p.ckpt)]) if (name) ckptInfo[name] = comfy.ckptInfo(name);
      res.json({ ok: true, available, source: available ? 'live' : checkpoints.length ? 'disk' : 'none', checkpoints, loras, ckptInfo,
        loraArch: await _loraArchMap(cfg.dir, loras), profiles, selected, defaults, maxLoras: comfy.MAX_LORAS });
    } catch (e) { _send(res, e); }
  });

  router.put('/api/comfyui/profiles', express.json(), async (req, res) => {
    try {
      res.json({ ok: true, profiles: await comfy.saveProfiles(req.body) });
    } catch (e) { _send(res, e); }
  });

  // Данные окна перед генерацией (spec FR14): пресеты размеров, предложенный размер и чем будет нарисовано.
  router.get('/api/comfyui/prepare', async (req, res) => {
    try {
      const ent = await resolveEntity(reqCity(req), req.query.kind, req.query.slug);
      const { promptSize, preset } = suggestedSize(req.query.kind, ent.positive);
      const profile = (await comfy.loadProfiles())[libKind(req.query.kind)];
      res.json({ ok: true, name: ent.name, hasPrompt: !!ent.positive, presets: comfy.SIZE_PRESETS, promptSize, suggested: preset.id,
        ckpt: profile.ckpt, loras: profile.loras.map(({ name, strength }) => ({ name, strength })), detail: !!profile.detail });
    } catch (e) { _send(res, e); }
  });

  router.post('/api/comfyui/generate', aiRateLimit, express.json(), async (req, res) => {
    try {
      _pruneJobs();
      const city = reqCity(req);
      const { kind, slug, size } = req.body || {};
      const ent = await resolveEntity(city, kind, slug);
      if (!ent.positive) throw new HttpError(400, 'Сначала сгенерируй или заполни промт для изображения.');
      // Размер — только из пресетов (SDXL ~1 Мп); не задан — из промта, затем по виду сущности.
      if (size !== undefined && size !== null && size !== '' && !presetById(size))
        throw new HttpError(400, `Неизвестный размер «${size}»`);
      const frame = size ? presetById(size) : suggestedSize(kind, ent.positive).preset;
      if (running) {
        const cur = jobs.get(running);
        return res.status(409).json({ ok: false, error: 'Генерация изображения уже идёт — дождись её окончания.',
          job: cur ? { id: running, kind: cur.kind, slug: cur.slug } : null });
      }
      // Профиль вида: персонаж — портреты, локация и район — локации (profiles-spec FR5).
      const profile = (await comfy.loadProfiles())[libKind(kind)];
      const cfg = { ...comfy.config(), profile };
      if (!await comfy.isUp(cfg.baseUrl)) {
        const problem = comfy.autostartProblem(cfg);
        if (problem) throw new HttpError(503, problem);
      }

      const jobId = crypto.randomUUID();
      const job = {
        status: 'running', phase: 'loading', startedAt: Date.now(), kind, slug: ent.slug, name: ent.name, city,
        width: frame.width, height: frame.height, size: frame.id, step: 0, steps: 0, stepT0: 0, stepAt: 0, log: [], res: null, ckpt: profile.ckpt || '',
        loras: [], detail: false, upscale: null,
        prompt: { positive: ent.positive, negative: ent.negative }, cancel: false,
      };
      jobs.set(jobId, job);
      running = jobId;
      res.status(202).json({ ok: true, jobId });

      (async () => {
        monitorJob = job;
        monitor.start();
        _log(job, `Генерация: ${ent.name} (${kind === 'character' ? 'персонаж' : kind === 'district' ? 'район' : 'локация'})`);
        try {
          const buf = await comfy.generate({ positive: ent.positive, negative: ent.negative, gender: ent.gender, kind: libKind(kind), width: frame.width, height: frame.height }, cfg, {
            onPhase: p => { job.phase = p; },
            onLog: text => _log(job, text),
            // Во вкладку «Промт» — то, что реально ушло в ComfyUI (с тегами пола и триггерами LoRA);
            // loras — только применённые (несовместимые и отсутствующие пропущены).
            onInfo: ({ ckpt, loras, detail, upscale, positive, negative, width, height }) => {
              job.ckpt = ckpt; job.detail = detail; job.upscale = upscale;
              job.width = width; job.height = height;   // размер готовой картинки (после детализации и апскейла)
              job.loras = loras.map(({ name, strength }) => ({ name, strength }));
              job.prompt = { positive, negative };
            },
            onProgress: ({ step, steps }) => {
              const now = Date.now();
              if (step <= 1 || !job.stepT0) job.stepT0 = now;
              job.step = step; job.steps = steps; job.stepAt = now;
            },
            isCancelled: () => job.cancel,
          });
          job.phase = 'saving';
          const dir = candDir(ent);
          await fs.mkdir(dir, { recursive: true });
          const file = `candidate_${Date.now()}.png`;
          await writeFileAtomic(path.join(dir, file), buf);
          job.candidate = { file, url: _imgUrl(path.join(dir, file)) };
          _log(job, `Кандидат сохранён: ${file}`);
          job.phase = 'done';
          job.status = 'done';
        } catch (e) {
          if (job.cancel || e.status === 499) { job.status = 'cancelled'; _log(job, 'Генерация отменена'); }
          else {
            job.status = 'error';
            job.error = e instanceof comfy.ComfyError ? e.message : `Ошибка генерации: ${e.message}`;
            job.errorStatus = e.status || 500;
            _log(job, `Ошибка: ${job.error}`);
            console.error('[comfyui]', job.error);
          }
        } finally {
          job.finishedAt = Date.now();
          if (monitorJob === job) { monitor.stop(); monitorJob = null; }
          // ComfyUI, поднятый автозапуском, закрываем — освобождаем видеопамять (spec FR9).
          if (await comfy.stopLaunched().catch(() => false)) _log(job, 'ComfyUI закрыт — видеопамять освобождена');
          if (running === jobId) running = null;
        }
      })();
    } catch (e) { _send(res, e); }
  });

  router.get('/api/comfyui/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: 'Задание не найдено (сервер перезапускался?) — кандидат, если он готов, есть в карточке.' });
    const { status, phase, startedAt, finishedAt, candidate, error, errorStatus, kind, slug, name, width, height,
      step, steps, ckpt, loras, detail, upscale, prompt, res: resources } = job;
    res.json({ ok: true, status, phase, startedAt, finishedAt, elapsedMs: (finishedAt || Date.now()) - startedAt,
      candidate, error, errorStatus, kind, slug, name, width, height, step, steps, etaSec: _etaSec(job), ckpt, loras, detail, upscale, prompt,
      res: resources, log: job.log, stopping: running === req.params.id && status !== 'running' });
  });

  router.post('/api/comfyui/jobs/:id/cancel', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: 'Задание не найдено' });
    if (job.status !== 'running') return res.json({ ok: true, status: job.status });
    job.cancel = true;
    _log(job, 'Запрошена отмена…');
    res.json({ ok: true, status: 'cancelling' });
  });

  router.get('/api/comfyui/candidates', async (req, res) => {
    try {
      const ent = await resolveEntity(reqCity(req), req.query.kind, req.query.slug);
      res.json({ ok: true, candidates: await listCandidates(ent) });
    } catch (e) { _send(res, e); }
  });

  router.post('/api/comfyui/candidates/accept', express.json(), async (req, res) => {
    try {
      const { kind, slug, file } = req.body || {};
      const ent = await resolveEntity(reqCity(req), kind, slug);
      const src = path.join(candDir(ent), _checkFile(file));
      const buf = await fs.readFile(src).catch(() => null);
      if (!buf) throw new HttpError(404, 'Кандидат не найден');
      if (!buf.subarray(0, 8).equals(comfy.PNG_SIGNATURE)) throw new HttpError(400, 'Кандидат повреждён: не PNG');
      const { filename } = await ent.save(buf);
      await fs.unlink(src).catch(() => {});
      res.json({ ok: true, filename, url: _imgUrl(path.join(ent.dir, 'art', filename)) });
    } catch (e) { _send(res, e); }
  });

  router.delete('/api/comfyui/candidates', async (req, res) => {
    try {
      const ent = await resolveEntity(reqCity(req), req.query.kind, req.query.slug);
      const src = path.join(candDir(ent), _checkFile(req.query.file));
      try { await fs.unlink(src); } catch { throw new HttpError(404, 'Кандидат не найден'); }
      res.json({ ok: true });
    } catch (e) { _send(res, e); }
  });

  return router;
};

module.exports.KINDS = KINDS;
module.exports._resetForTests = () => { jobs.clear(); running = null; };
