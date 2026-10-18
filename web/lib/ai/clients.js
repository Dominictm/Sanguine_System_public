'use strict';
/**
 * AI Provider Clients — unified interface for all LLM providers.
 * Extracted from server.js (Ф4 Code-review fixes).
 * Each client implements: generateText(system, user, options) → { text, source, model }
 */

const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = require('@google/genai');

// ── Configuration ─────────────────────────────────────────────────────────────
const OR_FALLBACK_MODELS = [
  'openrouter/auto',
  'openrouter/google/gemini-2.0-flash-exp:free',
  'openrouter/meta-llama/llama-3.1-8b-instruct:free',
  'openrouter/microsoft/phi-3-mini-128k-instruct:free',
];

const OA_MODELS = {
  openrouter: OR_FALLBACK_MODELS,
  openai: ['gpt-4o-mini', 'gpt-4o'],
  lmstudio: [], // Dynamic from /api/lmstudio/models
};

// ── Provider detection ────────────────────────────────────────────────────────
function isOpenRouter(gen) { return gen && gen.source === 'openrouter'; }
function isOpenAI(gen) { return gen && gen.source === 'openai'; }
function isLMStudio(gen) { return gen && gen.source === 'lmstudio'; }
function isAnthropic(gen) { return gen && gen.source === 'anthropic'; }
function isGemini(gen) { return gen && gen.source === 'gemini'; }
function isOA(gen) { return isOpenRouter(gen) || isOpenAI(gen) || isLMStudio(gen); }

// ── Anthropic (Claude) ────────────────────────────────────────────────────────
let _anthropicClient = null;
function getAnthropicClient(apiKey) {
  if (!_anthropicClient || _anthropicClient.apiKey !== apiKey) {
    _anthropicClient = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    _anthropicClient.apiKey = apiKey;
  }
  return _anthropicClient;
}

async function callAnthropic(gen, { system, user, maxTokens, model }) {
  const client = getAnthropicClient(gen.apiKey);
  const msg = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return msg.content[0]?.text?.trim() || '';
}

// ── OpenAI / OpenRouter / LM Studio (OpenAI-compatible) ───────────────────────
async function callOpenAICompatible(gen, { system, user, maxTokens, model, timeout = 75000 }) {
  let baseURL, apiKey, label;
  if (isOpenRouter(gen)) {
    baseURL = 'https://openrouter.ai/api/v1';
    apiKey = gen.apiKey || process.env.OPENROUTER_API_KEY;
    label = 'OpenRouter';
  } else if (isOpenAI(gen)) {
    baseURL = 'https://api.openai.com/v1';
    apiKey = gen.apiKey || process.env.OPENAI_API_KEY;
    label = 'OpenAI';
  } else if (isLMStudio(gen)) {
    baseURL = gen.baseURL || process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1';
    apiKey = gen.apiKey || 'lm-studio'; // LM Studio doesn't require real key
    label = 'LM Studio';
  } else {
    throw new Error('Unknown OA-compatible provider');
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const isAbort = e => (e?.name === 'AbortError')
    || (e?.cause?.name === 'AbortError')      // undici: TypeError: fetch failed
    || (e?.code === 'UND_ERR_ABORTED');

  try {
    const resp = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw Object.assign(
        new Error(`${label} API: ${resp.status}${body ? ` — ${body.slice(0, 300)}` : ''}`),
        { status: resp.status }
      );
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  } catch (e) {
    if (isAbort(e)) {
      throw Object.assign(
        new Error(`Модель «${model}» не ответила за ${Math.round(timeout / 1000)}с`),
        { status: 504 }
      );
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Google Gemini ─────────────────────────────────────────────────────────────
let _geminiClient = null;
function getGeminiClient(apiKey) {
  if (!_geminiClient || _geminiClient.apiKey !== apiKey) {
    _geminiClient = new GoogleGenAI({ apiKey });
    _geminiClient.apiKey = apiKey;
  }
  return _geminiClient;
}

async function callGemini(gen, { system, user, maxTokens, model }) {
  const client = getGeminiClient(gen.apiKey);
  const contents = user;
  const config = { maxOutputTokens: maxTokens, systemInstruction: system };
  const result = await client.models.generateContent({ model, contents, config });
  return result.text?.trim() || '';
}

// ── Unified client interface ──────────────────────────────────────────────────
async function generateText(gen, { system, user, maxTokens = 900, model = null, timeout = 75000 }) {
  const useModel = model || gen.model;
  // Тестовый мок-провайдер (AI_MOCK=1): детерминированная заглушка без сети.
  // Контракт из server.js (mock shaped like Anthropic SDK response) — каждый
  // вызов идёт через gen.client.messages.create, который стабит тест-сервер.
  if (gen && gen.source === 'mock') {
    const msg = await gen.client.messages.create({
      model: useModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    });
    return msg.content[0]?.text?.trim() || '';
  }
  if (isAnthropic(gen)) return callAnthropic(gen, { system, user, maxTokens, model: useModel });
  if (isGemini(gen)) return callGemini(gen, { system, user, maxTokens, model: useModel });
  if (isOA(gen)) return callOpenAICompatible(gen, { system, user, maxTokens, model: useModel, timeout });
  throw new Error(`Unknown provider: ${gen?.source}`);
}

// ── Model list helpers ────────────────────────────────────────────────────────
function getOAFallbackModels(gen) {
  if (isLMStudio(gen)) {
    // LM Studio models fetched dynamically via /api/lmstudio/models
    return gen.models || [gen.model];
  }
  if (isOpenRouter(gen)) return [...OR_FALLBACK_MODELS];
  if (isOpenAI(gen)) return OA_MODELS.openai;
  return [];
}

// ── OAuth / Auth helpers ──────────────────────────────────────────────────────
async function refreshAnthropicToken(refreshToken) {
  // Placeholder for future OAuth token refresh
  // Currently not used — direct API keys in .env
  throw new Error('Anthropic OAuth not implemented');
}

module.exports = {
  // Provider detection
  isOpenRouter, isOpenAI, isLMStudio, isAnthropic, isGemini, isOA,
  // Generation
  generateText,
  // Model lists
  getOAFallbackModels,
  OR_FALLBACK_MODELS,
  OA_MODELS,
  // OAuth
  refreshAnthropicToken,
};