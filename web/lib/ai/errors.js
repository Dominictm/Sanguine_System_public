'use strict';
/**
 * Читаемые ошибки ИИ-провайдеров (спека doc/design/archive/llamacpp-local-provider/spec.md §2.8, F11).
 *
 * Любое исключение транспорта/провайдера превращается в AiError с конвертом
 * { ok:false, error, code, params, hint, action, details, retryable }:
 *  - error/hint — русский текст (сервер всегда отвечал по-русски; клиент
 *    переводит по code через aierr.<CODE>.title/hint и падает обратно на них);
 *  - details — технический текст провайдера без секретов, ≤ 2 КБ;
 *  - params.provider/model — какой провайдер и какая модель отказали.
 * Транспорт, точно знающий причину, ставит err.aiCode — он важнее паттернов.
 */

const DETAILS_MAX = 2048;

const PROVIDER_LABEL = {
  claude: 'Claude', openai: 'GPT', openrouter: 'OpenRouter', gemini: 'Gemini',
  lmstudio: 'LM Studio', llamacpp: 'llama.cpp', mock: 'Mock',
};

function providerOf(source) {
  if (!source) return null;
  const s = String(source).replace(/-fallback$/, '');
  if (s === 'api-key' || s === 'claude-login' || s === 'anthropic') return 'claude';
  if (s === 'gpt') return 'openai'; // клиентский алиас (source: 'gpt')
  return s;
}

function providerLabel(p) { return PROVIDER_LABEL[p] || p || 'провайдер'; }

// ── Каталог: status, заголовок, подсказка, действие, можно ли повторить ──────
// p — params (provider, model, …); P(p) — человеческое имя провайдера.
const P = p => providerLabel(p.provider);
const CATALOG = {
  // Облачные провайдеры и общие
  // 503 — как отвечали транспорт и готовые ответы роутеров (AI_ERR.NOT_CONFIGURED): один код — один статус.
  AI_NOT_CONFIGURED:   { status: 503, action: 'open-ai-connect',
    title: p => `${P(p)} не подключён`,
    hint:  () => 'Добавьте ключ или войдите в «Подключение AI» либо назначьте другой провайдер.' },
  AI_AUTH:             { status: 401, action: 'open-ai-connect',
    title: p => `Ключ ${P(p)} не принят`,
    hint:  () => 'Проверьте ключ в «Подключение AI» или замените его.' },
  AI_OAUTH_EXPIRED:    { status: 401, action: 'open-ai-connect',
    title: () => 'Вход в Claude истёк',
    hint:  () => 'Войдите снова в «Подключение AI» или выполните вход в Claude Code.' },
  AI_QUOTA:            { status: 402, action: 'open-ai-features',
    title: p => `У ${P(p)} закончился баланс или квота`,
    hint:  () => 'Пополните баланс или назначьте этой генерации другой провайдер.' },
  AI_RATE_LIMIT:       { status: 429, action: 'retry', retryable: true,
    title: p => `${P(p)} просит подождать`,
    hint:  p => p.retryAfterSec ? `Слишком много запросов. Повторите через ${p.retryAfterSec} с.` : 'Слишком много запросов. Повторите через минуту.' },
  AI_OVERLOADED:       { status: 503, action: 'retry', retryable: true,
    title: p => `Сервис ${P(p)} перегружен или недоступен`,
    hint:  () => 'Это временно — повторите чуть позже или смените провайдер.' },
  AI_MODEL_NOT_FOUND:  { status: 400, action: 'open-ai-features',
    title: p => p.model ? `Модель «${p.model}» недоступна у ${P(p)}` : `Модель недоступна у ${P(p)}`,
    hint:  () => 'Выберите другую модель в «Назначении генераций».' },
  AI_NOT_TEXT_MODEL:   { status: 502, action: 'open-ai-features',
    title: p => `«${p.model || 'Модель'}» рисует картинки, а не пишет текст`,
    hint:  () => 'Выберите текстовую модель в «Назначении генераций».' },
  AI_CONTEXT_TOO_LONG: { status: 400, action: 'open-ai-features',
    title: p => p.model ? `Запрос слишком большой для «${p.model}»` : 'Запрос слишком большой для модели',
    hint:  () => 'Выберите модель с бо́льшим контекстом.' },
  AI_SAFETY:           { status: 422, action: 'open-ai-features',
    title: p => `${P(p)} отказался отвечать`,
    hint:  () => 'Сработал фильтр безопасности провайдера. Попробуйте другой провайдер — для мрачных тем лучше подходит локальная модель.' },
  AI_NETWORK:          { status: 502, action: 'retry', retryable: true,
    title: p => `Нет связи с ${P(p)}`,
    hint:  () => 'Проверьте интернет и что брандмауэр не блокирует приложение.' },
  AI_TIMEOUT:          { status: 504, action: 'retry', retryable: true,
    title: p => p.seconds ? `${P(p)} не ответил за ${p.seconds} с` : `${P(p)} не ответил вовремя`,
    hint:  p => (p.provider === 'llamacpp' || p.provider === 'lmstudio')
      ? 'Возьмите модель поменьше или уменьшите объём генерации.'
      : 'Повторите позже или смените провайдер.' },
  AI_EMPTY:            { status: 502, action: 'retry', retryable: true,
    title: p => `${P(p)} вернул пустой ответ`,
    hint:  () => 'Повторите или выберите другую модель.' },
  AI_INVALID_OUTPUT:   { status: 502, action: 'retry', retryable: true,
    title: () => 'Модель ответила не в нужном формате',
    hint:  () => 'Повторите — или выберите модель посильнее. Подробности — что именно не так.' },
  AI_NO_VISION:        { status: 400, action: 'open-ai-features',
    title: p => `${P(p)} не умеет смотреть изображения`,
    hint:  p => p.provider === 'lmstudio'
      ? 'Загрузите в LM Studio модель с поддержкой изображений (например, Qwen2.5-VL) или назначьте «Внешности по арту» другой провайдер.'
      : 'Назначьте «Внешности по арту» облачный провайдер в «Назначении генераций».' },
  AI_BAD_REQUEST:      { status: 400, action: null,
    title: p => `${P(p)} отклонил запрос`,
    hint:  () => 'Ответ провайдера — в подробностях.' },
  AI_UNKNOWN:          { status: 500, action: null,
    title: p => `Непредвиденная ошибка ${P(p)}`,
    hint:  () => 'Повторите; если не поможет — скопируйте подробности.' },

  // LM Studio
  LMS_OFFLINE:     { status: 503, action: 'retry', retryable: true,
    title: () => 'LM Studio не запущен',
    hint:  () => 'Откройте LM Studio и включите сервер (Developer → Start Server).' },
  LMS_NO_MODEL:    { status: 400, action: null,
    title: () => 'В LM Studio не загружена модель',
    hint:  () => 'Загрузите модель в LM Studio или укажите её в «Подключение AI».' },
  LMS_LOAD_FAILED: { status: 502, action: null,
    title: () => 'LM Studio не смог загрузить модель',
    hint:  () => 'Чаще всего не хватает памяти — возьмите модель поменьше.' },
  LMS_DROPPED:     { status: 502, action: 'retry', retryable: true,
    title: () => 'LM Studio оборвал соединение во время генерации',
    hint:  () => 'Проверьте, что модель не выгружается из-за нехватки памяти, и повторите.' },

  // llama.cpp — генерация
  LLAMA_PLATFORM:          { status: 400, action: null,
    title: () => 'llama.cpp доступен только в Windows', hint: () => 'Назначьте другой провайдер.' },
  LLAMA_NOT_INSTALLED:     { status: 400, action: 'install-llamacpp',
    title: () => 'llama.cpp не установлен', hint: () => 'Установите его в «Подключение AI» → llama.cpp.' },
  LLAMA_NO_MODEL:          { status: 400, action: 'open-models-dir',
    title: () => 'Не выбрана модель llama.cpp', hint: () => 'Положите файл .gguf в папку LLM\\models и выберите его в настройках.' },
  LLAMA_MODEL_MISSING:     { status: 400, action: 'open-llamacpp-settings',
    title: p => `Файл модели «${p.model || '?'}» не найден`, hint: () => 'Его удалили или переименовали — выберите модель заново.' },
  LLAMA_MODEL_INVALID:     { status: 502, action: 'open-models-dir',
    title: () => 'Файл модели повреждён или это не GGUF', hint: () => 'Скачайте модель заново.' },
  LLAMA_MODEL_UNSUPPORTED: { status: 502, action: 'install-llamacpp',
    title: p => p.arch ? `Эта сборка llama.cpp не знает архитектуру «${p.arch}»` : 'Эта сборка llama.cpp не знает архитектуру модели',
    hint:  () => 'Обновите llama.cpp в «Подключение AI».' },
  LLAMA_OOM:               { status: 502, action: 'open-llamacpp-settings',
    title: () => 'Модели не хватило памяти',
    hint:  p => `${p.model ? `«${p.model}»` : 'Модель'}${p.ctx ? ` с контекстом ${p.ctx}` : ''} не помещается в память${p.vramGb ? ` видеокарты (${p.vramGb} ГБ)` : ''}. Уменьшите контекст или возьмите квантизацию поменьше (например, Q4_K_S).` },
  LLAMA_DRIVER:            { status: 502, action: 'switch-backend',
    title: () => 'Драйвер видеокарты не подходит к сборке llama.cpp',
    hint:  () => 'Обновите драйвер или переустановите llama.cpp со сборкой Vulkan/CPU.' },
  LLAMA_START_FAILED:      { status: 502, action: 'install-llamacpp',
    title: () => 'Сервер llama.cpp не запустился',
    hint:  () => 'Не хватает файлов сборки или её блокирует антивирус: переустановите llama.cpp и добавьте папку LLM в исключения антивируса.' },
  LLAMA_LOAD_TIMEOUT:      { status: 504, action: null,
    title: () => 'Модель загружается слишком долго',
    hint:  () => 'Медленный диск или мало оперативной памяти — возьмите модель поменьше.' },
  LLAMA_CTX_OVERFLOW:      { status: 400, action: 'open-llamacpp-settings',
    title: p => p.promptTokens ? `Запрос (${p.promptTokens} ток.) не помещается в контекст ${p.ctx}` : 'Запрос не помещается в контекст модели',
    hint:  p => p.variant === 'images'
      ? `Картинки не поместились в контекст${p.ctx ? ` ${p.ctx}` : ''}. Увеличьте контекст модели до 16384 или больше.`
      : 'Увеличьте размер контекста для этой модели.' },
  // llama.cpp — зрение (спека llamacpp-vision §2.5)
  LLAMA_NO_MMPROJ:         { status: 400, action: 'open-models-dir',
    title: p => `У модели «${p.model || '?'}» нет проектора зрения`,
    hint:  () => 'Положите файл mmproj-….gguf от этой модели в ту же папку (его выпускают вместе с моделью) или выберите модель с меткой 👁 в «Назначении генераций».' },
  LLAMA_VISION_FAILED:     { status: 502, action: 'open-models-dir',
    title: () => 'Не удалось подключить проектор зрения',
    hint:  p => `Файл «${p.mmproj || 'mmproj'}», похоже, от другой модели или повреждён. Скачайте mmproj той же модели, что и «${p.model || '?'}».` },
  LLAMA_IMAGE_FORMAT:      { status: 400, action: 'open-ai-features',
    title: () => 'llama.cpp не прочитал изображение',
    hint:  () => 'Поддерживаются JPG, PNG, GIF. Сохраните арт в одном из этих форматов или назначьте облачный провайдер.' },
  LLAMA_CRASHED:           { status: 502, action: 'retry', retryable: true,
    title: () => 'Сервер llama.cpp аварийно завершился', hint: () => 'Повторите; причина — в журнале сервера.' },
  LLAMA_STREAM_BROKEN:     { status: 502, action: 'retry', retryable: true,
    title: () => 'Связь с сервером llama.cpp оборвалась', hint: () => 'Повторите генерацию.' },
  LLAMA_CANCELLED:         { status: 499, action: null,
    title: () => 'Генерация отменена', hint: () => '' },
  LLAMA_BUSY:              { status: 409, action: null,
    title: () => 'llama.cpp сейчас занят', hint: () => 'Дождитесь конца генерации или выгрузите модель.' },

  // llama.cpp — установка
  INSTALL_OFFLINE:     { status: 502, action: 'retry', retryable: true,
    title: () => 'Нет доступа к GitHub', hint: () => 'Проверьте интернет и повторите установку.' },
  INSTALL_RATE_LIMIT:  { status: 429, action: 'retry', retryable: true,
    title: () => 'GitHub временно ограничил запросы',
    hint:  p => p.resetAt ? `Повторите после ${p.resetAt}.` : 'Повторите через час.' },
  INSTALL_NO_ASSET:    { status: 404, action: null,
    title: p => `Сборка «${p.backend || '?'}» не найдена`, hint: () => 'Выберите другую сборку.' },
  INSTALL_DISK:        { status: 507, action: null,
    title: () => 'Не хватает места на диске',
    hint:  p => p.needMb ? `Нужно примерно ${p.needMb} МБ свободного места.` : 'Освободите место и повторите.' },
  INSTALL_INTERRUPTED: { status: 502, action: 'retry', retryable: true,
    title: () => 'Загрузка прервалась',
    hint:  p => p.receivedMb != null ? `Скачано ${p.receivedMb} из ${p.totalMb} МБ. Повторите установку.` : 'Повторите установку.' },
  INSTALL_UNSAFE_ZIP:  { status: 422, action: null,
    title: () => 'Архив не прошёл проверку безопасности', hint: () => 'Установка отменена, файлы не распакованы.' },
  INSTALL_EXTRACT:     { status: 500, action: 'retry', retryable: true,
    title: () => 'Не удалось распаковать llama.cpp', hint: () => 'Файл занят другой программой или его блокирует антивирус.' },
  INSTALL_VERIFY:      { status: 500, action: 'switch-backend',
    title: () => 'Установленный сервер не запускается', hint: () => 'Его блокирует антивирус или сборка не подходит к компьютеру — выберите другую.' },
};

class AiError extends Error {
  constructor(code, params = {}, { details = '', cause = null, status = null } = {}) {
    const c = CATALOG[code] || CATALOG.AI_UNKNOWN;
    const p = { ...params };
    super(c.title(p));
    this.name = 'AiError';
    this.isAiError = true;
    this.code = CATALOG[code] ? code : 'AI_UNKNOWN';
    this.status = status || c.status;
    this.params = p;
    this.hint = c.hint(p);
    this.action = c.action || null;
    this.retryable = !!c.retryable;
    this.details = clipDetails(scrubSecrets(details));
    if (cause) this.cause = cause;
  }
  toJSON() {
    return {
      ok: false, error: this.message, code: this.code, params: this.params,
      hint: this.hint, action: this.action, details: this.details, retryable: this.retryable,
    };
  }
}

// ── Секреты и длина подробностей ──────────────────────────────────────────────
function scrubSecrets(text) {
  if (!text) return '';
  return String(text)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza***')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***')
    .replace(/((?:api[_-]?key|key|token|access_token|refresh_token|authToken)["']?\s*[=:]\s*["']?)[^\s"'&,}]{6,}/gi, '$1***')
    .replace(/[A-Za-z]:[\\/][^\s"']*?(?:\.env|\.gemini-vertex-key\.json|\.credentials\.json)/gi, '***')
    .replace(/\S*\.gemini-vertex-key\.json/gi, '***');
}

function clipDetails(text) {
  const s = String(text || '');
  return s.length > DETAILS_MAX ? s.slice(0, DETAILS_MAX - 1) + '…' : s;
}

// ── Классификация ─────────────────────────────────────────────────────────────
function _netCode(e) {
  return e?.code || e?.cause?.code || e?.cause?.cause?.code || '';
}

function _retryAfterSec(e) {
  const h = e?.headers;
  const v = h && (typeof h.get === 'function' ? h.get('retry-after') : h['retry-after']);
  const n = Number(v);
  return n > 0 ? Math.round(n) : null;
}

/**
 * err → AiError. ctx: { provider, model, serverLog }.
 * Уже классифицированные ошибки возвращаются как есть (дополняются provider/model).
 */
function classifyAiError(err, ctx = {}) {
  if (err && err.isAiError) {
    if (ctx.provider && !err.params.provider) err.params.provider = ctx.provider;
    if (ctx.model && !err.params.model) err.params.model = ctx.model;
    return err;
  }
  const provider = providerOf(err?.provider || ctx.provider) || null; // транспорт точнее (резерв, мок)
  const model = ctx.model || err?.model || null;
  const params = { provider, ...(model ? { model } : {}), ...(err?.aiParams || {}) };
  const status = err?.status ?? err?.statusCode ?? null;
  const msg = String(err?.message || err || '');
  const body = String(err?.providerBody || '');
  const hay = `${msg}\n${body}\n${err?.providerCode || ''}\n${err?.error?.error?.type || ''}`;
  const details = [err?.providerCode, body || msg, ctx.serverLog].filter(Boolean).join('\n');
  const mk = (code, extra = {}) => new AiError(code, { ...params, ...extra }, { details, cause: err });

  if (err?.aiCode) return mk(err.aiCode);

  // Сеть
  const net = _netCode(err);
  if (provider === 'lmstudio' && (net === 'ECONNREFUSED' || /ECONNREFUSED/.test(hay))) return mk('LMS_OFFLINE');
  if (/^(ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/.test(net)
      || /fetch failed|Нет доступа к Google Gemini/i.test(msg)) {
    return mk(provider === 'lmstudio' ? 'LMS_DROPPED' : 'AI_NETWORK');
  }

  // LM Studio — по тексту сервера
  if (provider === 'lmstudio') {
    if (/No models loaded/i.test(hay)) return mk('LMS_NO_MODEL');
    if (/Failed to load model/i.test(hay)) return mk('LMS_LOAD_FAILED');
    if (/оборвал соединение/i.test(hay)) return mk('LMS_DROPPED');
  }

  // Таймауты
  if (status === 504 || err?.name === 'TimeoutError' || /timeout|не ответила? за|deadline/i.test(msg)) {
    const m = msg.match(/за (\d+)\s*с/) || msg.match(/\((\d+)s budget/);
    const seconds = m ? Number(m[1]) : (/20 min/.test(msg) ? 1200 : null);
    return mk('AI_TIMEOUT', seconds ? { seconds } : {});
  }

  // Явные смысловые признаки — до общих статусов
  if (/истёк/i.test(msg) && provider === 'claude') return mk('AI_OAUTH_EXPIRED');
  if (/insufficient_quota|insufficient[_ ]credits|credit balance|exceeded your current quota|quota.*(per day|daily)|per.?day/i.test(hay) || status === 402) {
    return mk('AI_QUOTA');
  }
  if (/context_length_exceeded|prompt is too long|maximum context length|exceeds the maximum number of tokens|context window|too many tokens/i.test(hay)) {
    return mk('AI_CONTEXT_TOO_LONG');
  }
  // Регистр важен: «safetySettings» в тексте 400-й ошибки — не срабатывание фильтра.
  if (/content_filter|\bSAFETY\b|blockReason|PROHIBITED_CONTENT|stop_reason\W{0,4}refusal/.test(hay)) return mk('AI_SAFETY');
  if (/генератор изображений/i.test(msg)) return mk('AI_NOT_TEXT_MODEL');
  if (/model_not_found|No endpoints found|is not found for API version|does not exist|not a valid model|Unknown model|Invalid model/i.test(hay) || status === 404) {
    return mk('AI_MODEL_NOT_FOUND');
  }
  if (/не задан|Нет источника для генерации|не подключ/i.test(msg) || (status === 503 && /Vertex AI: не заданы/.test(msg))) {
    return mk('AI_NOT_CONFIGURED');
  }
  if (status === 401 || status === 403 || /authentication_error|invalid_api_key|API_KEY_INVALID|PERMISSION_DENIED|invalid x-api-key|Unauthorized/i.test(hay)) {
    return mk('AI_AUTH');
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|rate.?limit|Превышен лимит запросов/i.test(hay)) {
    const ra = _retryAfterSec(err);
    return mk('AI_RATE_LIMIT', ra ? { retryAfterSec: ra } : {});
  }
  // Пустой/бракованный ответ приходит с 502 — проверяем до общих 5xx.
  if (/пустой ответ/i.test(msg)) return mk('AI_EMPTY');
  if (/нерелевантн|обрезанн|не в нужном формате|битый JSON|не вернула JSON/i.test(msg)) return mk('AI_INVALID_OUTPUT');
  if (status === 529 || /overloaded/i.test(hay) || (status >= 500 && status <= 503)) return mk('AI_OVERLOADED');
  if (status === 400 || status === 422) return mk('AI_BAD_REQUEST');
  return mk('AI_UNKNOWN');
}

/** Ошибка резервной цепочки: главная — выбранного провайдера, резервы — в details. */
function withFallbackDetails(primary, fallbacks = []) {
  if (!fallbacks.length) return primary;
  const lines = fallbacks.map(f => `резерв ${providerLabel(f.provider)}: ${f.err?.message || f.err}`);
  primary.details = clipDetails(scrubSecrets([primary.details, ...lines].filter(Boolean).join('\n')));
  return primary;
}

const NET_CODES = /^(ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_\w+)$/;
/** Ошибка пришла от провайдера/транспорта (а не от валидации/файлов роутера)? */
function looksLikeProviderError(e) {
  if (!e || typeof e !== 'object') return false;
  if (e.isAiError || e.aiCode || e.providerBody !== undefined || e.provider) return true;
  if (/APIError|ApiError|TimeoutError/.test(e.constructor?.name || '') || e.name === 'TimeoutError') return true;
  if (e.headers && (e.status || e.statusCode)) return true; // Anthropic/Gemini SDK
  return NET_CODES.test(_netCode(e)) || /fetch failed/.test(e.message || '');
}

/** Контекст ошибки из тела запроса генерации: какой провайдер и модель выбраны. */
function aiCtx(req) {
  const b = (req && req.body) || {};
  return { provider: providerOf(b.preferSource || b.source || null), model: b.orModel || b.model || null };
}

/**
 * Ответ-конверт по ошибке: AiError → полный конверт; ошибка провайдера —
 * классифицируется (ctx: {provider, model} — обычно aiCtx(req)); прочее — {ok:false, error} как раньше.
 */
function sendError(res, e, { fallbackStatus = 500, extra = {}, provider = null, model = null } = {}) {
  if (e && !e.isAiError && looksLikeProviderError(e)) e = classifyAiError(e, { provider, model });
  if (e && e.isAiError) {
    console.error(`[ai-error] ${e.code}: ${e.message}${e.details ? ` | ${e.details.split('\n')[0].slice(0, 300)}` : ''}`);
    return res.status(e.status).json({ ...e.toJSON(), ...extra, ...(e.code === 'AI_RATE_LIMIT' ? { rateLimited: true } : {}) });
  }
  const st = e?.status ?? e?.statusCode;
  const status = st >= 400 && st < 600 ? st : fallbackStatus;
  return res.status(status).json({ ok: false, error: e?.message ?? String(e), ...extra, ...(e?.rateLimited ? { rateLimited: true } : {}) });
}

// Поля конверта для готовых ответов роутеров, где ошибку формируют сами
// (брак формата / пустой ответ / нет провайдера): текст error остаётся прежним,
// клиент по code показывает перевод и действие.
const AI_ERR = {
  INVALID_OUTPUT: { code: 'AI_INVALID_OUTPUT', action: 'retry', retryable: true },
  EMPTY:          { code: 'AI_EMPTY',          action: 'retry', retryable: true },
  NOT_CONFIGURED: { code: 'AI_NOT_CONFIGURED', action: 'open-ai-connect', retryable: false },
};

/** Предупреждение (не ошибка) в ответе роутера. */
function aiWarning(code, params = {}) {
  const texts = {
    LLAMA_TRUNCATED: p => `Ответ мог оборваться: модель упёрлась в лимит ${p.maxTokens || ''} токенов.`.replace('  ', ' '),
  };
  return { code, params, message: (texts[code] || (() => code))(params) };
}

module.exports = {
  AiError, AI_ERR, CATALOG, aiCtx, classifyAiError, withFallbackDetails, sendError, aiWarning, looksLikeProviderError,
  scrubSecrets, clipDetails, providerOf, providerLabel, DETAILS_MAX,
};
