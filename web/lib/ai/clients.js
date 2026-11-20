'use strict';
/**
 * AI Provider Clients — единая точка вызова модели для всех провайдеров.
 *
 * Транспорты (OpenAI-совместимый chat/completions со SSE-стримом LM Studio,
 * Gemini с Vertex/ключом, aiBusy) живут в server.js и передаются сюда через
 * configure() при старте: раньше здесь были их упрощённые копии, которые
 * не знали Claude-источников 'api-key'/'claude-login' и теряли стрим LM Studio
 * (баг-фикс перед спекой doc/design/archive/llamacpp-local-provider/spec.md §2.1).
 */

const aiBusy = require('../ai-busy');

// ── Транспорты, внедряемые server.js ──────────────────────────────────────────
const _deps = {
  callOpenAI: null,       // (model, system, user, images, timeoutMs, maxTokens) → text
  callOpenRouter: null,
  callLmStudio: null,
  geminiText: null,       // (system, user, {model, maxTokens, timeoutMs}) → text
  llamaCppGenerate: null, // ({model, system, user, maxTokens, timeoutMs}) → {text, warnings}
  orFallbackModels: [],
};

function configure(deps = {}) {
  for (const k of Object.keys(_deps)) if (deps[k] !== undefined) _deps[k] = deps[k];
}
// Для тестов: подменить транспорты стабами и вернуть исходные.
function _snapshotDeps() { return { ..._deps }; }

function _need(name) {
  if (typeof _deps[name] !== 'function') throw new Error(`AI-слой не сконфигурирован: нет транспорта ${name}`);
  return _deps[name];
}

// ── Provider detection ────────────────────────────────────────────────────────
// Claude приходит из makeGenerationClient как 'api-key' (ANTHROPIC_API_KEY) или
// 'claude-login' (OAuth Claude Code); 'anthropic' оставлен для совместимости.
const ANTHROPIC_SOURCES = new Set(['anthropic', 'api-key', 'claude-login']);

function isOpenRouter(gen) { return !!gen && gen.source === 'openrouter'; }
function isOpenAI(gen)     { return !!gen && gen.source === 'openai'; }
function isLMStudio(gen)   { return !!gen && gen.source === 'lmstudio'; }
function isLlamaCpp(gen)   { return !!gen && gen.source === 'llamacpp'; }
function isAnthropic(gen)  { return !!gen && ANTHROPIC_SOURCES.has(gen.source); }
function isGemini(gen)     { return !!gen && gen.source === 'gemini'; }
function isMock(gen)       { return !!gen && gen.source === 'mock'; }
function isOA(gen)         { return isOpenRouter(gen) || isOpenAI(gen) || isLMStudio(gen); }
// Локальные провайдеры: длинный дедлайн, большой лимит токенов, без fallback.
function isLocal(gen)      { return isLMStudio(gen) || isLlamaCpp(gen); }

// OpenAI-совместимый транспорт по источнику (сигнатура callOpenAI/…).
function _oaCall(gen) {
  if (isOpenAI(gen))   return _need('callOpenAI');
  if (isLMStudio(gen)) return _need('callLmStudio');
  return _need('callOpenRouter');
}
// OpenRouter получает курируемые бесплатные резервные модели; OpenAI/LM Studio — только выбранную.
function _oaModels(gen) {
  if (isOpenAI(gen) || isLMStudio(gen)) return [gen.model];
  return [gen.model, ...(_deps.orFallbackModels || []).filter(m => m !== gen.model)];
}

// ── Единый вызов ──────────────────────────────────────────────────────────────
// → { text, warnings? }
async function generateText(gen, { system, user, maxTokens = 900, model = null, timeout = 75000, etaHint = null, stage = null }) {
  const useModel = model || gen.model;
  if (isMock(gen) || isAnthropic(gen)) {
    // Мок (AI_MOCK=1) повторяет форму ответа Anthropic SDK — тот же путь.
    if (!gen.client) throw Object.assign(new Error('Claude не подключён'), { status: 503 });
    aiBusy.begin();
    try {
      const m = await gen.client.messages.create({
        model: useModel, max_tokens: maxTokens, system,
        messages: [{ role: 'user', content: user }],
      });
      return { text: m.content?.[0]?.text?.trim() || '', stopReason: m.stop_reason || null };
    } finally { aiBusy.end(); }
  }
  if (isGemini(gen)) {
    return { text: await _need('geminiText')(system, user, { model: useModel, maxTokens, timeoutMs: timeout }) };
  }
  if (isOA(gen)) {
    return { text: await _oaCall(gen)(useModel, system, user, [], timeout, maxTokens) };
  }
  if (isLlamaCpp(gen)) {
    return await _need('llamaCppGenerate')({ model: useModel, system, user, maxTokens, etaHint, timeoutMs: timeout, stage });
  }
  throw new Error(`Unknown provider: ${gen?.source}`);
}

function getOAFallbackModels(gen) { return _oaModels(gen); }

module.exports = {
  configure, _snapshotDeps,
  isOpenRouter, isOpenAI, isLMStudio, isLlamaCpp, isAnthropic, isGemini, isMock, isOA, isLocal,
  _oaCall, _oaModels, getOAFallbackModels,
  generateText,
};
