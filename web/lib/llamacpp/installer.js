'use strict';
// Установка llama.cpp в LLM/llama.cpp (спека §2.5).
// Ловушка (проверено 2026-10-21): releases/latest у ggml-org/llama.cpp — это
// v0.7.0 только с nightly-tag.txt; бинарники лежат в пререлизах bNNNNN, поэтому
// берём список релизов и ищем первый с нужным Windows-ассетом.

const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;
const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const { validateZipBeforeExtract, extractZipToDir } = require('../zip');
const { AiError } = require('../ai/errors');
const P = require('./paths');

const BACKENDS = ['cuda-13.4', 'cuda-12.4', 'vulkan', 'cpu'];
const RELEASES_URL = () => process.env.LLAMACPP_RELEASES_URL
  || 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=20';
const ZIP_LIMIT = 1024 * 1024 * 1024; // cudart ≈ 400 МБ — общий лимит 300 МБ не подходит
const CACHE_MS = 30 * 60 * 1000;

const events = new EventEmitter();
let _state = null;           // { state:'running'|'done'|'error', phase, received, total, error, backend }
let _detected = null;
let _releaseCache = new Map(); // backend → { at, value }

const _exec = (cmd, args, timeout = 8000) => new Promise(resolve => {
  execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)));
});

/** Какую сборку ставить на этом компьютере (без сети). */
async function detect() {
  if (_detected) return _detected;
  if (process.env.LLAMACPP_DETECT) { // тесты: "cuda-13.4|RTX|591"
    const [backend, gpu, driver] = process.env.LLAMACPP_DETECT.split('|');
    return (_detected = { backend, gpu: gpu || null, driver: driver || null, vramMb: null });
  }
  const smi = await _exec('nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits']);
  if (smi && smi.trim()) {
    const [name, driver, mem] = smi.trim().split('\n')[0].split(',').map(s => s.trim());
    return (_detected = { backend: backendForDriver(driver), gpu: name, driver, vramMb: Number(mem) || null });
  }
  const ps = await _exec('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join "|"']);
  const gpus = (ps || '').trim().split('|').filter(n => n && !/Microsoft Basic|Remote Display/i.test(n));
  return (_detected = { backend: gpus.length ? 'vulkan' : 'cpu', gpu: gpus[0] || null, driver: null, vramMb: null });
}

/** CUDA 13 требует драйвер NVIDIA ≥ 580. */
function backendForDriver(driver) {
  const major = parseInt(String(driver || '').split('.')[0], 10);
  return Number.isFinite(major) && major >= 580 ? 'cuda-13.4' : 'cuda-12.4';
}

function _assetNames(tag, backend) {
  const names = [`llama-${tag}-bin-win-${backend}-x64.zip`];
  if (backend.startsWith('cuda-')) names.push(`cudart-llama-bin-win-${backend}-x64.zip`);
  return names;
}

function _hhmm(epochSec) {
  const d = new Date(epochSec * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function _fetch(url, opts = {}) {
  try {
    return await fetch(url, { ...opts, headers: { 'User-Agent': 'Sanguine-System', Accept: 'application/vnd.github+json', ...(opts.headers || {}) } });
  } catch (e) {
    throw new AiError('INSTALL_OFFLINE', { provider: 'llamacpp' }, { details: `${e.message} ${e.cause?.code || ''}`, cause: e });
  }
}

/** Первый релиз с нужными ассетами: { tag, assets:[{name,url,size}], totalBytes }. */
async function findRelease(backend) {
  if (!BACKENDS.includes(backend)) throw new AiError('INSTALL_NO_ASSET', { provider: 'llamacpp', backend });
  const hit = _releaseCache.get(backend);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const resp = await _fetch(RELEASES_URL());
  if (resp.status === 403 || resp.status === 429) {
    const reset = Number(resp.headers.get('x-ratelimit-reset'));
    if (resp.headers.get('x-ratelimit-remaining') === '0' || resp.status === 429) {
      throw new AiError('INSTALL_RATE_LIMIT', { provider: 'llamacpp', ...(reset ? { resetAt: _hhmm(reset) } : {}) }, { details: `GitHub API ${resp.status}` });
    }
  }
  if (!resp.ok) throw new AiError('INSTALL_OFFLINE', { provider: 'llamacpp' }, { details: `GitHub API ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 300)}` });
  const releases = await resp.json();
  for (const r of Array.isArray(releases) ? releases : []) {
    const want = _assetNames(r.tag_name, backend);
    const found = want.map(n => (r.assets || []).find(a => a.name === n));
    if (found.every(Boolean)) {
      const value = {
        tag: r.tag_name,
        assets: found.map(a => ({ name: a.name, url: a.browser_download_url, size: a.size })),
        totalBytes: found.reduce((s, a) => s + (a.size || 0), 0),
      };
      _releaseCache.set(backend, { at: Date.now(), value });
      return value;
    }
  }
  throw new AiError('INSTALL_NO_ASSET', { provider: 'llamacpp', backend });
}

async function readInstallInfo() {
  try { return JSON.parse(await fsp.readFile(P.installInfoPath(), 'utf8')); } catch { return null; }
}

function status() { return _state ? { ..._state, error: _state.error ? _state.error.toJSON() : null } : null; }
const isRunning = () => _state?.state === 'running';

function _emit() { events.emit('install', status()); }

const DL_RETRIES = () => Number(process.env.LLAMACPP_DL_RETRIES ?? 5);
const DL_IDLE_MS = () => Number(process.env.LLAMACPP_DL_IDLE_MS) || 60000;

// Одна попытка: качает с offset (Range) и дописывает в файл. → число байт за попытку.
// Обрыв/зависание (нет данных DL_IDLE_MS) — исключение с .partial = true.
async function _downloadAttempt(asset, file, base, offset) {
  const ctrl = new AbortController();
  let idle = setTimeout(() => ctrl.abort(), DL_IDLE_MS());
  const bump = () => { clearTimeout(idle); idle = setTimeout(() => ctrl.abort(), DL_IDLE_MS()); };
  let resp;
  try {
    resp = await fetch(asset.url, { signal: ctrl.signal, headers: { 'User-Agent': 'Sanguine-System', Accept: 'application/octet-stream',
      ...(offset ? { Range: `bytes=${offset}-` } : {}) } });
  } catch (e) { clearTimeout(idle); throw Object.assign(new Error(`${e.message} ${e.cause?.code || ''}`.trim()), { partial: true }); }
  if (!resp.ok || !resp.body) { clearTimeout(idle); throw Object.assign(new Error(`HTTP ${resp.status}`), { http: resp.status }); }
  // Сервер проигнорировал Range — начинаем файл заново.
  const resumed = offset > 0 && resp.status === 206;
  const out = fs.createWriteStream(file, { flags: resumed ? 'a' : 'w' });
  let got = resumed ? offset : 0;
  const writeErr = new Promise((_, rej) => out.on('error', rej));
  try {
    const reader = resp.body.getReader();
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), writeErr]);
      if (done) break;
      bump();
      got += value.length;
      _state.received = base + got;
      if (!out.write(value)) await Promise.race([new Promise(r => out.once('drain', r)), writeErr]);
      _emitThrottled();
    }
    await new Promise((res, rej) => out.end(err => (err ? rej(err) : res())));
  } catch (e) {
    out.destroy();
    if (e.code === 'ENOSPC') throw e;
    throw Object.assign(new Error(ctrl.signal.aborted ? `нет данных ${DL_IDLE_MS() / 1000} с` : e.message), { partial: true, got });
  } finally { clearTimeout(idle); }
  return got;
}

// Скачивание с докачкой: обрыв посреди файла — продолжаем с места (Range), до DL_RETRIES раз.
async function _download(asset, file, base) {
  const interrupted = details => new AiError('INSTALL_INTERRUPTED', { provider: 'llamacpp',
    receivedMb: Math.round(_state.received / 1048576), totalMb: Math.round((_state.total || 0) / 1048576) }, { details });
  let got = 0;
  const log = [];
  for (let attempt = 0; attempt <= DL_RETRIES(); attempt++) {
    try {
      got = await _downloadAttempt(asset, file, base, got);
      if (!asset.size || got === asset.size) return got;
      log.push(`${asset.name}: ${got} из ${asset.size} байт`);
    } catch (e) {
      if (e.code === 'ENOSPC') throw new AiError('INSTALL_DISK', { provider: 'llamacpp', needMb: Math.ceil((_state.total || 0) / 1048576) }, { cause: e });
      if (e.got != null) got = e.got;
      else { try { got = fs.statSync(file).size; } catch { got = 0; } }
      log.push(`попытка ${attempt + 1}: ${asset.name}: ${e.message}`);
      // Ни байта не скачано и сеть не отвечает — это нет доступа, а не обрыв.
      if (!_state.received && attempt === DL_RETRIES()) throw new AiError('INSTALL_OFFLINE', { provider: 'llamacpp' }, { details: log.join('\n') });
    }
    _state.retries = (_state.retries || 0) + 1;
    _emit();
    await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 15000)));
  }
  throw interrupted(log.join('\n'));
}

let _lastEmit = 0;
function _emitThrottled() { const n = Date.now(); if (n - _lastEmit > 250) { _lastEmit = n; _emit(); } }

function _verify(dir) {
  const exe = process.env.LLAMACPP_SERVER_BIN || path.join(dir, 'llama-server.exe');
  const isJs = exe.endsWith('.js');
  return new Promise(resolve => {
    execFile(isJs ? process.execPath : exe, isJs ? [exe, '--version'] : ['--version'],
      { cwd: dir, timeout: 30000, windowsHide: true },
      (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim(), err }));
  });
}

/**
 * Запуск установки в фоне. canStart() — менеджер свободен (нет генерации и
 * модели в памяти), иначе LLAMA_BUSY. Возвращается сразу; прогресс — events/status().
 */
async function install(backendReq, { canStart = () => true } = {}) {
  if (isRunning() || !canStart()) throw new AiError('LLAMA_BUSY', { provider: 'llamacpp' });
  // Reserve the installer slot before detect() yields. Otherwise concurrent
  // `auto` requests can both pass isRunning() and race over the shared staging dir.
  _state = { state: 'running', phase: 'resolve', received: 0, total: 0, error: null, backend: backendReq || 'auto' };
  _emit();
  let backend;
  try {
    backend = backendReq === 'auto' || !backendReq ? (await detect()).backend : backendReq;
    if (!BACKENDS.includes(backend)) throw new AiError('INSTALL_NO_ASSET', { provider: 'llamacpp', backend });
    _state.backend = backend;
  } catch (e) {
    _state = null;
    _emit();
    throw e;
  }
  _run(backend).catch(() => { /* состояние уже записано в _state */ });
  return status();
}

async function _run(backend) {
  const staging = P.stagingDir();
  const dlDir = path.join(staging, 'dl');
  const outDir = path.join(staging, 'llama.cpp');
  try {
    const rel = await findRelease(backend);
    _state.total = rel.totalBytes;
    _state.phase = 'download';
    _emit();
    await fsp.rm(staging, { recursive: true, force: true });
    await fsp.mkdir(dlDir, { recursive: true });
    await fsp.mkdir(outDir, { recursive: true });

    let base = 0;
    const zips = [];
    for (const a of rel.assets) {
      const file = path.join(dlDir, a.name);
      base += await _download(a, file, base);
      zips.push(file);
    }

    _state.phase = 'extract';
    _emit();
    for (const z of zips) {
      // Один буфер — и на предвалидацию, и на распаковку (раньше файл читался дважды).
      // Распаковка чистым Node'ом (extractZipToDir) вместо Expand-Archive: на части
      // Windows-образов тот падает перегрузкой ExtractToDirectory — INSTALL_EXTRACT
      // на каждой установке в CI.
      const zipBuf = await fsp.readFile(z);
      const check = validateZipBeforeExtract(zipBuf, { maxTotalUncompressed: ZIP_LIMIT });
      if (!check.ok) throw new AiError('INSTALL_UNSAFE_ZIP', { provider: 'llamacpp' }, { details: check.error });
      try { await extractZipToDir(zipBuf, outDir); }
      catch (e) { throw new AiError('INSTALL_EXTRACT', { provider: 'llamacpp' }, { details: e.message, cause: e }); }
    }
    // Некоторые архивы кладут файлы в подпапку — поднимаем к корню.
    const exe = await _findExe(outDir);
    if (!exe && !process.env.LLAMACPP_SERVER_BIN) throw new AiError('INSTALL_VERIFY', { provider: 'llamacpp' }, { details: 'llama-server.exe не найден в архиве' });
    const exeDir = exe ? path.dirname(exe) : outDir;

    _state.phase = 'verify';
    _emit();
    const v = await _verify(exeDir);
    if (!v.ok) throw new AiError('INSTALL_VERIFY', { provider: 'llamacpp' }, { details: `${v.err?.message || ''}\n${v.out}`.trim() });
    await fsp.writeFile(path.join(exeDir, 'install.json'),
      JSON.stringify({ build: rel.tag, backend, installedAt: new Date().toISOString(), version: (v.out.split(/\r?\n/)[0] || '').trim() || null }, null, 2));

    // Атомарная подмена: старая установка в .old, новая на место, .old удаляется.
    const target = P.binDir();
    const old = target + '.old';
    await fsp.rm(old, { recursive: true, force: true });
    const hadOld = fs.existsSync(target);
    if (hadOld) await fsp.rename(target, old);
    try { await fsp.rename(exeDir, target); }
    catch (e) { if (hadOld) await fsp.rename(old, target).catch(() => {}); throw new AiError('INSTALL_EXTRACT', { provider: 'llamacpp' }, { details: e.message, cause: e }); }
    await fsp.rm(old, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    await P.ensureDirs();
    _state = { ..._state, state: 'done', phase: 'done', build: rel.tag };
    _emit();
  } catch (e) {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    const err = e.isAiError ? e : (e.code === 'ENOSPC'
      ? new AiError('INSTALL_DISK', { provider: 'llamacpp' }, { cause: e })
      : new AiError('INSTALL_EXTRACT', { provider: 'llamacpp' }, { details: e.message, cause: e }));
    if (fs.existsSync(P.binDir())) err.params.keptPrevious = true;
    _state = { ..._state, state: 'error', error: err };
    _emit();
    throw err;
  }
}

async function _findExe(dir, depth = 0) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) if (e.isFile() && e.name.toLowerCase() === 'llama-server.exe') return path.join(dir, e.name);
  if (depth < 2) for (const e of entries) if (e.isDirectory()) { const f = await _findExe(path.join(dir, e.name), depth + 1); if (f) return f; }
  return null;
}

// Для тестов.
function _reset() { _state = null; _detected = null; _releaseCache = new Map(); }

module.exports = { BACKENDS, detect, backendForDriver, findRelease, install, status, isRunning, readInstallInfo, events, _reset };
