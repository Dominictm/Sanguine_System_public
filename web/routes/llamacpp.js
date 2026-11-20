'use strict';
// Роутер встроенного провайдера llama.cpp (спека doc/design/archive/llamacpp-local-provider/spec.md §2.4).
const express = require('express');
const { spawn } = require('child_process');
const { AiError, sendError } = require('../lib/ai/errors');
const P = require('../lib/llamacpp/paths');
const config = require('../lib/llamacpp/config');
const models = require('../lib/llamacpp/models');
const installer = require('../lib/llamacpp/installer');
const manager = require('../lib/llamacpp/manager');

const router = express.Router();

async function _settingsView() {
  const cfg = await config.load();
  return { model: cfg.model, visionModel: cfg.visionModel || null, ctx: cfg.ctx, defaultCtx: config.DEFAULT_CTX, unloadGraceSec: cfg.unloadGraceSec,
    limits: { ctxMin: config.CTX_MIN, ctxMax: config.CTX_MAX, ctxStep: config.CTX_STEP, graceMax: config.GRACE_MAX } };
}

router.get('/api/llamacpp/status', async (req, res) => {
  req.action = '🦙 llama.cpp: статус';
  try {
    res.json({
      ok: true,
      platformOk: P.platformOk(),
      detected: P.platformOk() ? await installer.detect() : null,
      installed: P.isInstalled() ? (await installer.readInstallInfo()) || { build: null, backend: null } : null,
      install: installer.status(),
      backends: installer.BACKENDS,
      modelsDir: P.modelsDir(),
      settings: await _settingsView(),
      job: manager.snapshot(),
    });
  } catch (e) { sendError(res, e); }
});

// Размер скачивания для кнопки «Установить (≈ N МБ)» — ходит в GitHub (кэш 30 мин).
router.get('/api/llamacpp/release', async (req, res) => {
  req.action = '🦙 llama.cpp: поиск сборки';
  try {
    const backend = req.query.backend && req.query.backend !== 'auto' ? String(req.query.backend) : (await installer.detect()).backend;
    const rel = await installer.findRelease(backend);
    res.json({ ok: true, backend, tag: rel.tag, totalBytes: rel.totalBytes, assets: rel.assets.map(a => ({ name: a.name, size: a.size })) });
  } catch (e) { sendError(res, e); }
});

router.post('/api/llamacpp/install', express.json(), async (req, res) => {
  req.action = '🦙 llama.cpp: установка';
  try {
    if (!P.platformOk()) throw new AiError('LLAMA_PLATFORM', { provider: 'llamacpp' });
    const backend = req.body?.backend || 'auto';
    if (backend !== 'auto' && !installer.BACKENDS.includes(backend)) {
      return res.status(400).json({ ok: false, error: `Неизвестная сборка «${backend}»` });
    }
    const st = await installer.install(backend, { canStart: manager.isIdle });
    res.status(202).json({ ok: true, install: st });
  } catch (e) { sendError(res, e); }
});

router.get('/api/llamacpp/models', async (req, res) => {
  req.action = '🦙 llama.cpp: модели';
  try {
    await P.ensureDirs();
    res.json({ ok: true, models: await models.list(), modelsDir: P.modelsDir() });
  } catch (e) { sendError(res, e); }
});

router.post('/api/llamacpp/settings', express.json(), async (req, res) => {
  req.action = '🦙 llama.cpp: настройки';
  try {
    const b = req.body || {};
    const list = await models.list();
    const ids = new Set(list.map(m => m.id));
    if (b.model !== undefined && b.model !== null && !ids.has(b.model)) {
      return res.status(400).json({ ok: false, error: 'Такой модели нет в папке LLM\\models' });
    }
    // Модель для изображений — только из списка и только с проектором зрения (спека llamacpp-vision §2.3).
    const visionIds = new Set(list.filter(m => m.vision).map(m => m.id));
    if (b.visionModel !== undefined && b.visionModel !== null && !visionIds.has(b.visionModel)) {
      return res.status(400).json({ ok: false, error: 'Эта модель не видит изображения: рядом с ней нет файла mmproj' });
    }
    if (b.ctx !== undefined) {
      if (!b.ctx || !ids.has(b.ctx.id)) return res.status(400).json({ ok: false, error: 'Контекст можно задать только для модели из списка' });
      if (!config.validCtx(b.ctx.value)) {
        return res.status(400).json({ ok: false, error: `Контекст — целое число от ${config.CTX_MIN} до ${config.CTX_MAX}, кратное ${config.CTX_STEP}` });
      }
    }
    if (b.unloadGraceSec !== undefined && !config.validGrace(b.unloadGraceSec)) {
      return res.status(400).json({ ok: false, error: `Пауза выгрузки — целое число секунд от 0 до ${config.GRACE_MAX}` });
    }
    await config.save(cfg => {
      if (b.model !== undefined) cfg.model = b.model;
      if (b.visionModel !== undefined) cfg.visionModel = b.visionModel;
      if (b.ctx !== undefined) cfg.ctx[b.ctx.id] = b.ctx.value;
      if (b.unloadGraceSec !== undefined) cfg.unloadGraceSec = b.unloadGraceSec;
      // Контексты удалённых моделей не копятся.
      for (const id of Object.keys(cfg.ctx)) if (!ids.has(id)) delete cfg.ctx[id];
      if (cfg.model && !ids.has(cfg.model)) cfg.model = null;
      if (cfg.visionModel && !visionIds.has(cfg.visionModel)) cfg.visionModel = null;
    });
    res.json({ ok: true, settings: await _settingsView() });
  } catch (e) { sendError(res, e); }
});

router.post('/api/llamacpp/open-models-dir', async (req, res) => {
  req.action = '🦙 llama.cpp: папка моделей';
  try {
    await P.ensureDirs();
    if (process.platform === 'win32' && !process.env.AI_MOCK) {
      spawn('explorer.exe', [P.modelsDir()], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    }
    res.json({ ok: true, modelsDir: P.modelsDir() });
  } catch (e) { sendError(res, e); }
});

router.post('/api/llamacpp/cancel', (req, res) => {
  req.action = '🦙 llama.cpp: отмена';
  res.json({ ok: true, cancelled: manager.cancel() });
});

router.post('/api/llamacpp/unload', async (req, res) => {
  req.action = '🦙 llama.cpp: выгрузка';
  try { await manager.unloadNow(); res.json({ ok: true }); }
  catch (e) { sendError(res, e); }
});

// SSE: job / log / resources / install. Новое подключение сразу получает снимок.
router.get('/api/llamacpp/events', (req, res) => {
  req.action = '🦙 llama.cpp: события';
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  const send = (event, data) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); res.flush?.(); };
  send('job', manager.snapshot());
  send('log', { lines: manager.logTail(200), reset: true });
  const r = manager.resourcesSnapshot();
  if (r) send('resources', r);
  const inst = installer.status();
  if (inst) send('install', inst);

  const onJob = j => send('job', j);
  const onLog = l => send('log', { lines: [l] });
  const onRes = s => send('resources', s);
  const onInst = s => send('install', s);
  const onPrompt = p => send('prompt', p);
  manager.events.on('job', onJob);
  manager.events.on('log', onLog);
  manager.events.on('resources', onRes);
  manager.events.on('prompt', onPrompt);
  installer.events.on('install', onInst);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    manager.events.off('job', onJob);
    manager.events.off('log', onLog);
    manager.events.off('resources', onRes);
    manager.events.off('prompt', onPrompt);
    installer.events.off('install', onInst);
  });
});

module.exports = { router };
