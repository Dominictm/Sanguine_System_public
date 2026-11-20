'use strict';
// Настройки llama.cpp — LLM/llamacpp.json (не .env: контекст хранится за
// каждой моделью, и настройки переезжают вместе с папкой моделей).

const fsp = require('fs').promises;
const { configPath, llmRoot } = require('./paths');

const DEFAULT_CTX = 8192;
const CTX_MIN = 512, CTX_MAX = 131072, CTX_STEP = 256;
const GRACE_MAX = 600;
const STAT_ALPHA = 0.3;

// visionModel — модель для задач с картинками («Внешность по арту»); null → model.
const DEFAULTS = () => ({ model: null, visionModel: null, ctx: {}, unloadGraceSec: 30, gpuLayers: 'auto', stats: {} });

let _cache = null;
let _chain = Promise.resolve();

async function load() {
  if (_cache) return _cache;
  let raw = null;
  try { raw = await fsp.readFile(configPath(), 'utf8'); } catch { /* нет файла — дефолты */ }
  let cfg = DEFAULTS();
  if (raw) {
    try {
      const j = JSON.parse(raw);
      cfg = {
        ...cfg, ...j,
        ctx:   j.ctx && typeof j.ctx === 'object' && !Array.isArray(j.ctx) ? j.ctx : {},
        stats: j.stats && typeof j.stats === 'object' && !Array.isArray(j.stats) ? j.stats : {},
      };
      if (!Number.isInteger(cfg.unloadGraceSec) || cfg.unloadGraceSec < 0 || cfg.unloadGraceSec > GRACE_MAX) cfg.unloadGraceSec = 30;
    } catch (e) {
      console.warn(`[llamacpp] ${configPath()} повреждён (${e.message}) — используются настройки по умолчанию`);
    }
  }
  _cache = cfg;
  return cfg;
}

// Запись сериализуется (настройки и статистика пишутся из разных мест).
function save(mutate) {
  _chain = _chain.then(async () => {
    const cfg = await load();
    mutate(cfg);
    await fsp.mkdir(llmRoot(), { recursive: true });
    const tmp = configPath() + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(cfg, null, 2), 'utf8');
    await fsp.rename(tmp, configPath());
    return cfg;
  });
  return _chain;
}

function ctxFor(cfg, modelId) {
  const v = cfg.ctx?.[modelId];
  return Number.isInteger(v) ? v : DEFAULT_CTX;
}

function validCtx(v) {
  return Number.isInteger(v) && v >= CTX_MIN && v <= CTX_MAX && v % CTX_STEP === 0;
}
function validGrace(v) {
  return Number.isInteger(v) && v >= 0 && v <= GRACE_MAX;
}

function recordStat(key, outTokens) {
  if (!key || !(outTokens > 0)) return Promise.resolve();
  return save(cfg => {
    const s = cfg.stats[key];
    cfg.stats[key] = s && s.n > 0
      ? { avgOut: Math.round(s.avgOut + STAT_ALPHA * (outTokens - s.avgOut)), n: s.n + 1 }
      : { avgOut: outTokens, n: 1 };
  }).catch(e => console.warn('[llamacpp] не удалось записать статистику:', e.message));
}

function expectedOut(cfg, key) {
  const s = key && cfg.stats?.[key];
  return s && s.n >= 2 ? s.avgOut : null;
}

// Для тестов: сбросить кэш (файл меняют снаружи).
function _reset() { _cache = null; }

module.exports = {
  DEFAULT_CTX, CTX_MIN, CTX_MAX, CTX_STEP, GRACE_MAX,
  load, save, ctxFor, validCtx, validGrace, recordStat, expectedOut, _reset,
};
