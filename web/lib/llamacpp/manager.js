'use strict';
// Жизненный цикл llama-server (спека doc/design/archive/llamacpp-local-provider/spec.md §2.6).
//
// Одна задача за раз (одна модель в памяти), остальные — в очереди. Сервер
// поднимается под задачу и гасится через unloadGraceSec после ответа (запрос с
// той же моделью/контекстом в паузу переиспользует его). Ошибка, отмена,
// таймаут, рестарт приложения — kill сразу: «висящий» llama-server с занятой
// VRAM недопустим. Состояние задачи — события 'job' / 'log' / 'resources'.

const fs   = require('fs');
const fsp  = fs.promises;
const net  = require('net');
const path = require('path');
const { spawn, spawnSync, execFile } = require('child_process');
const { EventEmitter } = require('events');
const { AsyncLocalStorage } = require('async_hooks');
const aiBusy = require('../ai-busy');
const { AiError, aiWarning } = require('../ai/errors');
const P = require('./paths');
const config = require('./config');
const models = require('./models');
const { createMonitor } = require('./monitor');

const LOG_LINES = 500;
const TEXT_TAIL = 4096;
const LOAD_TIMEOUT_MS = () => Number(process.env.LLAMACPP_LOAD_TIMEOUT_MS) || 5 * 60 * 1000;
const CTX_MARGIN = 256;
// /tokenize считает только текст; число токенов картинки зависит от модели
// (Gemma 3 ≈ 256, Qwen-VL — до тысяч) — резерв, чтобы max_tokens не съел место под них.
const IMG_TOKENS_RESERVE = 1024;

const events = new EventEmitter();
events.setMaxListeners(50);
// Ключ «операции» для статистики ETA: мидлвар кладёт сюда req (маршрут известен
// только внутри обработчика — читаем req.route лениво).
const requestContext = new AsyncLocalStorage();

// ── Состояние ─────────────────────────────────────────────────────────────────
let srv = null;        // { proc, port, modelId, ctx, vision, mmprojLabel, exited, exitCode, startedAt }
let logRing = [];
let job = _idleJob();
let queue = [];        // ожидающие задачи: [{ resolve }]
let busy = false;
let graceTimer = null, graceTick = null, graceUntil = 0;
let current = null;    // { ctrl, cancelled }
let resources = null;
let promptSeq = 0;     // номер вызова для вкладки «Промт» модалки (SSE prompt)
const monitor = createMonitor(s => { resources = s; events.emit('resources', s); });

function _idleJob() {
  return { state: 'idle', phase: null, model: null, ctx: null, operation: null, startedAt: null, phaseAt: null,
    promptProcessed: 0, promptTotal: 0, tokens: 0, maxTokens: 0, expectedTokens: null, etaMode: null, tps: null,
    etaSec: null, queue: 0, graceLeftSec: null, reused: false, vision: false, error: null, textTail: '', finishedAt: null };
}

let _lastJobEmit = 0, _pendingEmit = null;
function _emitJob(force = false) {
  const now = Date.now();
  const send = () => { _lastJobEmit = Date.now(); _pendingEmit = null; events.emit('job', snapshot()); };
  if (force || now - _lastJobEmit >= 250) { if (_pendingEmit) clearTimeout(_pendingEmit); send(); }
  else if (!_pendingEmit) _pendingEmit = setTimeout(send, 250 - (now - _lastJobEmit));
}

function snapshot() {
  const j = { ...job, queue: queue.length };
  if (j.phase === 'generating' && j.tps > 0) {
    let expected = j.expectedTokens || j.maxTokens;
    // Ответ длиннее ожидаемого (так пишут reasoning-модели: тысячи токенов рассуждений) —
    // честная верхняя граница — реальный потолок max_tokens, а не «+15% к текущему».
    if (j.tokens >= expected && j.capTokens > j.tokens) { expected = j.capTokens; j.etaMode = 'max'; }
    else if (j.tokens >= expected) expected = j.tokens;
    j.etaSec = Math.max(0, Math.round((expected - j.tokens) / j.tps));
    j.expectedShown = expected;
  }
  if (graceUntil) j.graceLeftSec = Math.max(0, Math.ceil((graceUntil - Date.now()) / 1000));
  return j;
}

function logTail(n = 80) { return logRing.slice(-n); }

function _log(line) {
  if (!line) return;
  logRing.push(line);
  if (logRing.length > LOG_LINES) logRing = logRing.slice(-LOG_LINES);
  events.emit('log', line);
}

function _setPhase(phase, extra = {}) {
  Object.assign(job, { phase, phaseAt: Date.now() }, extra);
  _emitJob(true);
}

// ── Классификация по журналу/коду выхода ──────────────────────────────────────
const NTSTATUS_DLL = new Set([3221225781 /* 0xC0000135 */, 3221225595 /* 0xC000007B */, -1073741515, -1073741701]);

function classifyServerFailure({ exitCode = null, spawnErr = null, modelLabel, ctx, mmprojLabel = null } = {}) {
  const tail = logTail(60).join('\n');
  const p = { provider: 'llamacpp', ...(modelLabel ? { model: modelLabel } : {}), ...(ctx ? { ctx } : {}) };
  const opts = { details: tail || (spawnErr ? spawnErr.message : '') };
  if (spawnErr && /EACCES|EPERM|ENOENT|UNKNOWN/.test(spawnErr.code || '')) return new AiError('LLAMA_START_FAILED', p, opts);
  if (/out of memory|cudaMalloc failed|failed to allocate|ErrorOutOfDeviceMemory|unable to allocate|bad_alloc|not enough memory/i.test(tail)) {
    const vram = tail.match(/(\d+)\s*MiB free/i);
    return new AiError('LLAMA_OOM', { ...p, ...(vram ? { vramGb: Math.round(Number(vram[1]) / 1024) } : {}) }, opts);
  }
  // Проектор зрения от другой модели или битый: clip/mtmd пишут об этом до падения.
  if (mmprojLabel && /(clip_|mtmd_|mmproj)[^\n]*(fail|error|mismatch|unable|invalid)|(fail|error|unable)[^\n]*(mmproj|multimodal|clip model)/i.test(tail)) {
    return new AiError('LLAMA_VISION_FAILED', { ...p, mmproj: mmprojLabel }, opts);
  }
  const arch = tail.match(/unknown model architecture:?\s*'([^']+)'/i);
  if (arch) return new AiError('LLAMA_MODEL_UNSUPPORTED', { ...p, arch: arch[1] }, opts);
  if (/CUDA driver version is insufficient|no CUDA-capable device|vkCreateInstance failed|ggml_cuda_init: failed|cudaGetDeviceCount/i.test(tail)) return new AiError('LLAMA_DRIVER', p, opts);
  if (/invalid magic|failed to read magic|gguf_init_from_file.*failed|not a valid gguf|corrupted|unexpectedly reached end of file/i.test(tail)) return new AiError('LLAMA_MODEL_INVALID', p, opts);
  if (NTSTATUS_DLL.has(exitCode)) return new AiError('LLAMA_START_FAILED', p, opts);
  if (/failed to load model|error loading model/i.test(tail)) return new AiError('LLAMA_MODEL_INVALID', p, opts);
  return new AiError('LLAMA_CRASHED', p, opts);
}

// ── Процесс ───────────────────────────────────────────────────────────────────
function _freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function _killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  else { try { process.kill(pid, 'SIGKILL'); } catch { /* уже вышел */ } }
}

// Точка подмены для тестов: сбой остановки сервера (T9a, спека generation-feedback R16).
const _hooks = { killTree: _killTree };

async function _stopServer() {
  _clearGrace();
  const s = srv;
  srv = null;
  if (!s) return;
  if (!s.exited) {
    _hooks.killTree(s.proc.pid);
    await Promise.race([new Promise(r => s.proc.once('exit', r)), new Promise(r => setTimeout(r, 5000))]);
  }
  await fsp.rm(P.pidPath(), { force: true }).catch(() => {});
  _log('[sanguine] сервер llama.cpp остановлен, модель выгружена');
}

// mmprojAbs — проектор зрения: передаётся только под задачу с картинками (спека llamacpp-vision §2.4).
async function _startServer(modelId, modelAbs, ctx, modelLabel, mmprojAbs = null) {
  const cfg = await config.load();
  const port = await _freePort();
  const args = ['-m', modelAbs, '-c', String(ctx), '--host', '127.0.0.1', '--port', String(port),
    '-ngl', String(cfg.gpuLayers || 'auto'), '--no-webui', '--timeout', '3600'];
  if (mmprojAbs) args.push('--mmproj', mmprojAbs);
  const mmprojLabel = mmprojAbs ? path.basename(mmprojAbs) : null;
  const { cmd, args: fullArgs } = P.serverCommand(args);
  logRing = [];
  _log(`[sanguine] запуск: ${path.basename(cmd)} -m ${path.basename(modelAbs)} -c ${ctx} --port ${port}${mmprojLabel ? ` --mmproj ${mmprojLabel}` : ''}`);
  let spawnErr = null;
  const proc = spawn(cmd, fullArgs, { cwd: fs.existsSync(P.binDir()) ? P.binDir() : undefined, windowsHide: true });
  const s = { proc, port, modelId, ctx, vision: !!mmprojAbs, mmprojLabel, exited: false, exitCode: null, startedAt: Date.now() };
  srv = s;
  const onData = d => String(d).split(/\r?\n/).forEach(l => _log(l.trimEnd()));
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('error', e => { spawnErr = e; s.exited = true; });
  proc.on('exit', code => { s.exited = true; s.exitCode = code; _log(`[sanguine] процесс завершился (код ${code})`); });
  if (proc.pid) await fsp.writeFile(P.pidPath(), String(proc.pid)).catch(() => {});
  _setPhase('loading');

  // Ожидание загрузки: /health 503 = грузится, 200 = готов.
  const deadline = Date.now() + LOAD_TIMEOUT_MS();
  for (;;) {
    if (current?.cancelled) throw new AiError('LLAMA_CANCELLED', { provider: 'llamacpp' });
    if (s.exited) throw classifyServerFailure({ exitCode: s.exitCode, spawnErr, modelLabel, ctx, mmprojLabel });
    if (Date.now() > deadline) throw new AiError('LLAMA_LOAD_TIMEOUT', { provider: 'llamacpp', model: modelLabel }, { details: logTail(30).join('\n') });
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch { /* ещё не слушает */ }
    await new Promise(r => setTimeout(r, 500));
  }
}

// ── Пауза перед выгрузкой ─────────────────────────────────────────────────────
function _clearGrace() {
  if (graceTimer) clearTimeout(graceTimer);
  if (graceTick) clearInterval(graceTick);
  graceTimer = graceTick = null;
  graceUntil = 0;
}

// Финальное событие паузы приходит всегда (спека generation-feedback R16): «0 / выгружается»
// перед остановкой, затем idle — даже если остановка упала. Если слот за это время занял
// новый запрос, job уже его — не затираем, но шлём, чтобы клиент ушёл с паузы.
function _scheduleUnload(sec) {
  _clearGrace();
  if (!sec) return _stopServer().finally(() => { job = { ..._idleJob(), finishedAt: Date.now() }; _emitJob(true); });
  graceUntil = Date.now() + sec * 1000;
  job = { ..._idleJob(), state: 'grace', model: job.model, ctx: job.ctx, finishedAt: Date.now() };
  graceTick = setInterval(() => _emitJob(true), 1000);
  graceTick.unref?.();
  graceTimer = setTimeout(async () => {
    _clearGrace();
    if (busy) { _emitJob(true); return; }
    job = { ...job, state: 'grace', phase: 'unloading', graceLeftSec: 0 };
    _emitJob(true);
    try {
      await _stopServer();
    } catch (e) {
      console.error('[llamacpp] выгрузка после паузы не удалась:', e.message);
    } finally {
      if (!busy) job = _idleJob();
      _emitJob(true);
    }
  }, sec * 1000);
  graceTimer.unref?.();
  _emitJob(true);
  return Promise.resolve();
}

// ── Очередь ───────────────────────────────────────────────────────────────────
// Слот передаётся ждущему напрямую (busy остаётся true): иначе между
// «busy = false» и продолжением ждущего новый запрос успевал занять слот,
// и две задачи шли разом по общему srv/current/job.
// deadlineAt — общий срок задачи: время в очереди тоже считается.
async function _acquire(deadlineAt) {
  if (!busy) { busy = true; return; }
  await new Promise((resolve, reject) => {
    const waiter = { resolve: () => { clearTimeout(waiter.timer); resolve(); } };
    waiter.timer = setTimeout(() => {
      const i = queue.indexOf(waiter);
      if (i >= 0) queue.splice(i, 1);
      _emitJob(true);
      reject(new Error('queue-deadline'));
    }, Math.max(0, deadlineAt - Date.now()));
    waiter.timer.unref?.();
    queue.push(waiter);
    _emitJob(true);
  });
}
function _release() {
  const next = queue.shift();
  if (next) next.resolve();
  else busy = false;
  _emitJob(true);
}

// ── SSE-генерация ─────────────────────────────────────────────────────────────
// images — [{ buf, mime }]: уходят в формате OpenAI (image_url с data:-URL), как у облачных провайдеров.
// Текст сетевой ошибки undici: само «terminated» не называет причину — она лежит в cause
// (UND_ERR_BODY_TIMEOUT, ECONNRESET, socket hang up…). Без неё обрыв долгой локальной
// генерации в отчёте неотличим от любого другого (баг-репорт 2026-11-19).
function _causeText(e) {
  const c = e?.cause;
  const extra = [c?.code, c?.message].filter(Boolean).join(" ");
  return extra ? `${e.message} (${extra})` : String(e.message || e);
}

async function _chat(port, { system, user, images = [], maxTokens, signal, modelLabel }) {
  const userContent = images.length
    ? [...images.map(({ buf, mime }) => ({ type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } })),
      { type: 'text', text: user }]
    : user;
  const body = {
    messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: userContent }],
    max_tokens: maxTokens, stream: true, return_progress: true, timings_per_token: true,
  };
  let resp;
  try {
    resp = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw Object.assign(new Error(_causeText(e)), { stream: true });
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    const p = { provider: 'llamacpp', ...(modelLabel ? { model: modelLabel } : {}) };
    if (/exceed.*context|context size|n_ctx/i.test(t)) {
      throw new AiError('LLAMA_CTX_OVERFLOW', { ...p, ctx: srv?.ctx, ...(images.length ? { images: images.length, variant: 'images' } : {}) }, { details: t.slice(0, 1000) });
    }
    if (images.length && /failed to (load|decode|process) image|unable to load image|invalid image|unsupported image/i.test(t)) {
      throw new AiError('LLAMA_IMAGE_FORMAT', p, { details: t.slice(0, 1000) });
    }
    if (images.length && /image input is not supported|mmproj|multimodal/i.test(t)) {
      throw new AiError('LLAMA_VISION_FAILED', { ...p, mmproj: srv?.mmprojLabel || null }, { details: t.slice(0, 1000) });
    }
    throw Object.assign(new Error(`llama-server HTTP ${resp.status}`), { http: resp.status, body: t });
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', content = '', reasoning = '', finish = null, gotDone = false;
  const take = payload => {
    if (payload === '[DONE]') { gotDone = true; return; }
    let c; try { c = JSON.parse(payload); } catch { return; }
    if (c.prompt_progress) {
      const pp = c.prompt_progress;
      if (job.phase !== 'prompt') _setPhase('prompt');
      job.promptTotal = pp.total || job.promptTotal;
      job.promptProcessed = (pp.processed || 0) + (pp.cache || 0);
      _emitJob();
    }
    const ch = c.choices?.[0];
    const d = ch?.delta;
    if (d?.content || d?.reasoning_content) {
      if (job.phase !== 'generating') _setPhase('generating');
      if (d.content) content += d.content;
      if (d.reasoning_content) reasoning += d.reasoning_content;
      job.tokens += 1;
      job.textTail = (job.textTail + (d.content || d.reasoning_content)).slice(-TEXT_TAIL);
    }
    if (ch?.finish_reason) finish = ch.finish_reason;
    const tm = c.timings;
    if (tm) {
      if (tm.predicted_n) job.tokens = tm.predicted_n;
      if (tm.predicted_per_second) job.tps = Math.round(tm.predicted_per_second * 10) / 10;
    }
    _emitJob();
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith('data:')) take(line.slice(5).trim());
      }
    }
  } catch (e) {
    if (signal.aborted) throw e;
    throw Object.assign(new Error(_causeText(e)), { stream: true });
  }
  if (!gotDone && !finish) throw Object.assign(new Error('поток оборвался без [DONE]'), { stream: true });
  return { text: (content.trim() || reasoning.trim()), finish };
}

async function _tokenize(port, text, signal) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/tokenize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text }), signal,
    });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j.tokens) ? j.tokens.length : null;
  } catch { return null; }
}

function _statKey() {
  const req = requestContext.getStore();
  if (!req) return null;
  const route = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : req.path;
  return `${req.method} ${route}`;
}

// ── Публичный вызов генерации ─────────────────────────────────────────────────
/**
 * → { text, warnings }. Бросает только AiError.
 * model — id из LLM/models (null → модель по умолчанию из настроек).
 */
// etaHint — лимит, который просил маршрут (до запаса для reasoning-моделей): верхняя
// оценка длины ответа для ETA, пока нет статистики.
// images — [{ buf, mime }] (спека llamacpp-vision): нужен проектор зрения рядом с моделью.
// stage — шаг запроса для вкладки «Промт» (generate | validate | retry), необязателен.
async function generate({ model = null, system, user, images = [], maxTokens = 4096, etaHint = null, timeoutMs = 20 * 60 * 1000, stage = null }) {
  // Промт — только в SSE для открытой модалки, не в журнал и не на диск; картинки — числом.
  events.emit('prompt', { seq: ++promptSeq, stage: stage || null, system: system || '', user: String(user || ''),
    images: Array.isArray(images) ? images.length : 0 });
  if (!P.platformOk()) throw new AiError('LLAMA_PLATFORM', { provider: 'llamacpp' });
  if (!P.isInstalled()) throw new AiError('LLAMA_NOT_INSTALLED', { provider: 'llamacpp' });
  const cfg = await config.load();
  const needVision = Array.isArray(images) && images.length > 0;
  // Картинки без явной модели — «модель для изображений» из настроек, иначе модель по умолчанию.
  const modelId = model || (needVision && cfg.visionModel) || cfg.model;
  if (!modelId) throw new AiError('LLAMA_NO_MODEL', { provider: 'llamacpp' });
  const resolved = await models.resolve(modelId);
  const modelLabel = path.basename(modelId).replace(/\.gguf$/i, '');
  if (!resolved) throw new AiError('LLAMA_MODEL_MISSING', { provider: 'llamacpp', model: modelLabel });
  const modelAbs = resolved.abs;
  // До очереди: без проектора задача с картинками бессмысленна, модель не грузим.
  if (needVision && !resolved.mmprojAbs) throw new AiError('LLAMA_NO_MMPROJ', { provider: 'llamacpp', model: modelLabel });
  // Контекст раздела «Назначения генераций» (spec generation-feedback R13) приходит в теле
  // запроса полем llamaCtx; нет или вне границ — по модели, как раньше (API, тесты, старый клиент).
  const reqCtx = Number(requestContext.getStore()?.body?.llamaCtx);
  const ctx = config.validCtx(reqCtx) ? reqCtx : config.ctxFor(cfg, modelId);
  const statKey = _statKey();
  const limit = etaHint || maxTokens;
  const key = statKey ? `${statKey}#${limit}` : `other#${limit}`;
  const operation = statKey;

  const deadlineAt = Date.now() + timeoutMs;
  const timeoutErr = () => new AiError('AI_TIMEOUT', { provider: 'llamacpp', model: modelLabel, seconds: Math.round(timeoutMs / 1000) });
  try { await _acquire(deadlineAt); }
  catch { throw timeoutErr(); } // срок истёк, пока задача ждала очереди — модель не запускаем
  const ctrl = new AbortController();
  current = { ctrl, cancelled: false };
  const timer = setTimeout(() => { current && (current.timedOut = true); ctrl.abort(); }, Math.max(0, deadlineAt - Date.now()));
  aiBusy.begin();
  monitor.start();
  let ok = false;
  try {
    _clearGrace();
    // Сервер с проектором обслуживает и текст; без проектора под картинки — перезапуск.
    const reuse = !!(srv && !srv.exited && srv.modelId === modelId && srv.ctx === ctx && (srv.vision || !needVision));
    job = { ..._idleJob(), state: 'running', model: modelLabel, ctx, operation, startedAt: Date.now(), maxTokens,
      expectedTokens: config.expectedOut(cfg, key), reused: reuse, vision: needVision };
    job.etaMode = job.expectedTokens ? 'avg' : 'max';
    if (!reuse) {
      await _stopServer();
      _setPhase('starting');
      await _startServer(modelId, modelAbs, ctx, modelLabel, needVision ? resolved.mmprojAbs : null);
    }
    _setPhase('prompt');

    const textTokens = await _tokenize(srv.port, `${system || ''}\n${user || ''}`, ctrl.signal);
    const promptTokens = textTokens != null ? textTokens + (needVision ? images.length * IMG_TOKENS_RESERVE : 0) : null;
    if (promptTokens != null && promptTokens >= ctx - CTX_MARGIN) {
      throw new AiError('LLAMA_CTX_OVERFLOW', { provider: 'llamacpp', model: modelLabel, ctx, promptTokens,
        ...(needVision ? { images: images.length, variant: 'images' } : {}) });
    }
    const effMax = promptTokens != null ? Math.max(1, Math.min(maxTokens, ctx - promptTokens - 16)) : maxTokens;
    job.maxTokens = etaHint ? Math.min(effMax, etaHint) : effMax;
    job.capTokens = effMax;
    if (promptTokens != null) job.promptTotal = promptTokens;

    let out;
    try {
      out = await _chat(srv.port, { system, user, images: needVision ? images : [], maxTokens: effMax, signal: ctrl.signal, modelLabel });
    } catch (e) {
      if (e.isAiError) throw e;
      if (current?.cancelled) throw new AiError('LLAMA_CANCELLED', { provider: 'llamacpp' });
      if (current?.timedOut) throw new AiError('AI_TIMEOUT', { provider: 'llamacpp', model: modelLabel, seconds: Math.round(timeoutMs / 1000) });
      if (srv?.exited || (srv && await new Promise(r => setTimeout(() => r(srv?.exited), 300)))) {
        throw classifyServerFailure({ exitCode: srv?.exitCode, modelLabel, ctx, mmprojLabel: srv?.mmprojLabel });
      }
      if (e.stream) throw new AiError('LLAMA_STREAM_BROKEN', { provider: 'llamacpp', model: modelLabel }, { details: `${e.message}\n${logTail(20).join('\n')}` });
      throw new AiError('AI_UNKNOWN', { provider: 'llamacpp', model: modelLabel }, { details: `${e.message}\n${(e.body || '').slice(0, 800)}\n${logTail(20).join('\n')}` });
    }
    if (!out.text) throw new AiError('AI_EMPTY', { provider: 'llamacpp', model: modelLabel }, { details: logTail(20).join('\n') });

    const warnings = out.finish === 'length' ? [aiWarning('LLAMA_TRUNCATED', { maxTokens: effMax })] : [];
    _setPhase('done', { state: 'done', finishedAt: Date.now(), truncated: out.finish === 'length' });
    config.recordStat(key, job.tokens);
    ok = true;
    return { text: out.text, warnings };
  } catch (e) {
    const err = e.isAiError ? e
      : current?.cancelled ? new AiError('LLAMA_CANCELLED', { provider: 'llamacpp' })
      : current?.timedOut ? new AiError('AI_TIMEOUT', { provider: 'llamacpp', model: modelLabel, seconds: Math.round(timeoutMs / 1000) })
      : new AiError('AI_UNKNOWN', { provider: 'llamacpp', model: modelLabel }, { details: e.message });
    job = { ...job, state: err.code === 'LLAMA_CANCELLED' ? 'cancelled' : 'error', error: err.toJSON(), finishedAt: Date.now() };
    _emitJob(true);
    throw err;
  } finally {
    clearTimeout(timer);
    aiBusy.end();
    monitor.stop();
    current = null;
    try {
      if (ok) await _scheduleUnload((await config.load()).unloadGraceSec);
      else await _stopServer(); // ошибка/отмена/таймаут — без паузы
    } catch (e) {
      console.error('[llamacpp] выгрузка после задачи не удалась:', e.message);
    } finally {
      _release(); // слот освобождается при любом исходе выгрузки — иначе очередь висит до рестарта
    }
  }
}

function cancel() {
  if (!current) return false;
  current.cancelled = true;
  current.ctrl.abort();
  if (srv && !srv.exited) _killTree(srv.proc.pid);
  return true;
}

async function unloadNow() {
  if (busy) throw new AiError('LLAMA_BUSY', { provider: 'llamacpp' });
  await _stopServer();
  job = _idleJob();
  _emitJob(true);
}

/** Модель в памяти или идёт задача — установку/обновление запускать нельзя. */
const isIdle = () => !busy && !srv;

// Синхронно — для process.on('exit'): дочерний процесс не должен пережить приложение.
function shutdownSync() {
  _clearGrace();
  if (srv && !srv.exited) _killTree(srv.proc.pid);
  try { fs.rmSync(P.pidPath(), { force: true }); } catch { /* нет файла */ }
  srv = null;
  monitor.stop();
}

/** При старте приложения: убить осиротевший llama-server по LLM/.pid. */
async function killOrphan() {
  let pid;
  try { pid = Number((await fsp.readFile(P.pidPath(), 'utf8')).trim()); } catch { return false; }
  if (!pid || pid === process.pid) return false;
  let alive = false;
  if (process.platform === 'win32') {
    // PID мог достаться другому процессу — убиваем только llama-server
    // (фейковый сервер тестов — node.exe, и только при LLAMACPP_SERVER_BIN).
    const image = process.env.LLAMACPP_SERVER_BIN ? /"(llama-server\.exe|node\.exe)"/i : /"llama-server\.exe"/i;
    const out = await new Promise(r => execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (e, so) => r(e ? '' : String(so))));
    alive = image.test(out) && out.includes(`"${pid}"`);
  }
  if (alive) { _killTree(pid); console.log(`[llamacpp] остановлен осиротевший llama-server (PID ${pid})`); }
  await fsp.rm(P.pidPath(), { force: true }).catch(() => {});
  return alive;
}

function resourcesSnapshot() { return resources; }

module.exports = {
  events, requestContext, generate, cancel, unloadNow, snapshot, logTail, isIdle,
  shutdownSync, killOrphan, resourcesSnapshot, classifyServerFailure, _hooks,
};
