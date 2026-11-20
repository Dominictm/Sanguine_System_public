// ── Shared browser-side utilities ──────────────────────────────────────────
// Pure/self-contained helpers used across the SPA. No module system in this
// static frontend — loaded via <script> before scripts.js (see index.html),
// declares plain globals. Вынесено из scripts.js (E2.1).

// NOTE: _NTR MUST mirror CYRILLIC_TR in web/lib/parsers.js (this is the browser copy —
// no module system in the static SPA). A unit test (slugify — browser parity) enforces it.
const _NTR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
// _LATIN_TR mirrors LATIN_TR in web/lib/parsers.js — non-decomposing Latin letters.
const _LATIN_TR = { ø:'o', ł:'l', đ:'d', ı:'i', ß:'ss', æ:'ae', œ:'oe', þ:'th', ð:'d' };
function slugifyJS(s) { return (s || '').toLowerCase().split('').map(c => _NTR[c] !== undefined ? _NTR[c] : c).join('').normalize('NFKD').replace(/[̀-ͯ]/g, '').split('').map(c => _LATIN_TR[c] !== undefined ? _LATIN_TR[c] : c).join('').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_'); }

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }

// Библиотека хранит имена как «Русское (English)», карточки — часто голое русское имя:
// единственный хелпер, снимающий английское имя в скобках в конце строки.
function libBareName(fullName) {
  return String(fullName || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// Иконка-тултип с пояснением поля — ставится сразу после текста лейбла/названия.
// Всплывающий текст появляется справа от иконки при наведении/фокусе (см. .field-tip
// в styles.css). Используется во всех формах создания/редактирования (сценарий,
// персонаж, локация, город) — единый механизм, не дублировать под другим именем.
function fieldTip(text) {
  if (!text) return '';
  return ` <span class="field-tip" tabindex="0" data-tip="${escAttr(text)}">ⓘ</span>`;
}

// Всплывающий попап для .field-tip — единый DOM-элемент в <body>, позиционируется
// через getBoundingClientRect() на hover/focus (см. .field-tip-popup в styles.css
// для истории, почему это не CSS ::after). Делегировано на document, а не навешено
// при создании иконки, — .field-tip вставляется через innerHTML в десятках мест
// (fieldTip() выше), отдельных обработчиков на каждый инстанс не будет.
let _fieldTipPopupEl = null;
function _fieldTipPopup() {
  if (!_fieldTipPopupEl) {
    _fieldTipPopupEl = document.createElement('div');
    _fieldTipPopupEl.className = 'field-tip-popup';
    document.body.appendChild(_fieldTipPopupEl);
  }
  return _fieldTipPopupEl;
}
function _showFieldTip(trigger) {
  const text = trigger.dataset.tip;
  if (!text) return;
  const popup = _fieldTipPopup();
  popup.textContent = text;
  const r = trigger.getBoundingClientRect();
  const width = Math.min(300, window.innerWidth * 0.6, 320);
  let left = r.right + 9;
  if (left + width > window.innerWidth - 8) left = r.left - width - 9;
  popup.style.left = Math.max(8, left) + 'px';
  popup.style.top = (r.top + r.height / 2) + 'px';
  popup.classList.add('show');
}
function _hideFieldTip() {
  if (_fieldTipPopupEl) _fieldTipPopupEl.classList.remove('show');
}
document.addEventListener('mouseover', e => {
  const t = e.target.closest('.field-tip');
  if (t) _showFieldTip(t);
});
document.addEventListener('mouseout', e => {
  const t = e.target.closest('.field-tip');
  if (t && !t.contains(e.relatedTarget)) _hideFieldTip();
});
document.addEventListener('focusin', e => {
  const t = e.target.closest('.field-tip');
  if (t) _showFieldTip(t);
});
document.addEventListener('focusout', e => {
  if (e.target.closest('.field-tip')) _hideFieldTip();
});

// ── Toast / Confirm utilities ──────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) { console.error(message); return; }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}

// Единственный открытый оверлей (или null) — защита от повторного вызова
// showConfirm() до того, как предыдущий диалог резолвится (двойной клик по
// кнопке-триггеру, дважды вызывающей showConfirm без ожидания первого
// результата). Без этого гварда каждый вызов создавал НОВЫЙ
// <div id="confirm-overlay"> (дублирующийся id — невалидный HTML) поверх
// предыдущего; после подтверждения верхнего нижний оставался на экране
// полностью интерактивной «сиротой», ссылающейся на устаревшее состояние
// (например, индекс уже удалённой записи) — см.
// doc/audit/2026-07-28-session-feature-qa-report.md, находка №1.
let _confirmOverlay = null;

// Общий каркас showConfirm/showChoice: оверлей #confirm-overlay (role=dialog) с сообщением,
// списком items и рядом кнопок actsHtml. bind(ov, cleanup) вешает обработчики кнопок и
// ставит фокус; Escape и двойной клик по фону → dismissValue.
function _openConfirmOverlay(message, items, actsClass, actsHtml, dismissValue, bind) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.id = 'confirm-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', '_conf-msg');
    ov.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-msg" id="_conf-msg">${escHtml(message)}</div>
        ${Array.isArray(items) && items.length ? `<ul class="confirm-list">${items.map(i => `<li>${escHtml(i)}</li>`).join('')}</ul>` : ''}
        <div class="${actsClass}">${actsHtml}</div>
      </div>`;
    document.body.appendChild(ov);
    _confirmOverlay = ov;
    const cleanup = (result) => { ov.remove(); _confirmOverlay = null; document.removeEventListener('keydown', onKey); resolve(result); };
    const onKey = (e) => { if (e.key === 'Escape') cleanup(dismissValue); };
    document.addEventListener('keydown', onKey);
    bindBackdropDblClickClose(ov, () => cleanup(dismissValue));
    bind(ov, cleanup);
  });
}

// items — список строк под сообщением; dismissValue — результат для Escape / фона (по умолчанию как «Отмена»).
function showConfirm(message, { danger = false, confirmText = t('utils.confirm.ok'), cancelText = t('ui.btn.cancel'), items = null, dismissValue = false } = {}) {
  if (_confirmOverlay) {
    _confirmOverlay.querySelector('#_conf-ok')?.focus();
    return Promise.resolve(dismissValue); // диалог уже открыт — второй (дублирующий) вызов молча отклоняется
  }
  const acts = `<button class="chr-modal-btn ${danger ? 'danger' : 'create'}" id="_conf-ok">${escHtml(confirmText)}</button>
    <button class="chr-modal-btn cancel" id="_conf-cancel">${escHtml(cancelText)}</button>`;
  return _openConfirmOverlay(message, items, 'confirm-acts', acts, dismissValue, (ov, cleanup) => {
    ov.querySelector('#_conf-ok').onclick     = () => cleanup(true);
    ov.querySelector('#_conf-cancel').onclick = () => cleanup(false);
    ov.querySelector('#_conf-ok').focus();
  });
}

// Выбор одного варианта из списка — замена нативного prompt() с вводом номера.
// options — [{ value, label }]; результат — value выбранного или null (Отмена / Escape / фон).
function showChoice(message, options, { items = null, cancelText = t('ui.btn.cancel') } = {}) {
  if (_confirmOverlay) {
    _confirmOverlay.querySelector('.confirm-acts button')?.focus();
    return Promise.resolve(null);
  }
  const acts = options.map((o, i) => `<button class="chr-modal-btn" data-choice="${i}">${escHtml(o.label)}</button>`).join('')
    + `<button class="chr-modal-btn cancel" id="_conf-cancel">${escHtml(cancelText)}</button>`;
  return _openConfirmOverlay(message, items, 'confirm-acts confirm-acts--choice', acts, null, (ov, cleanup) => {
    ov.querySelectorAll('[data-choice]').forEach(b => { b.onclick = () => cleanup(options[+b.dataset.choice].value); });
    ov.querySelector('#_conf-cancel').onclick = () => cleanup(null);
    ov.querySelector('[data-choice]')?.focus();
  });
}

// ── Import from JSON (обратная операция для «⇩ Экспорт» на персонажах/локациях) ──
// `kind` — 'characters' | 'locations', должен совпадать с ключом тела запроса
// и последним сегментом /api/import/<kind>. Файл должен быть тем же JSON-массивом,
// что отдаёт /api/export/<kind> (обязательно поле `raw` — полное содержимое карточки).
async function importCardsFromFile(kind, file, onDone) {
  if (!file) return;
  let items;
  try {
    items = JSON.parse(await file.text());
  } catch (e) {
    showToast(t('utils.import.jsonReadError') + e.message, 'error');
    return;
  }
  if (!Array.isArray(items) || !items.length) {
    showToast(t('utils.import.noArray'), 'warning');
    return;
  }
  try {
    const r = await fetch(`/api/import/${kind}${window.location.search}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [kind]: items }),
    });
    const result = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(result.error || t('utils.import.error'));
    const parts = [t('utils.import.done', { count: result.created.length })];
    if (result.skipped?.length) parts.push(t('utils.import.skipped', { count: result.skipped.length }));
    if (result.errors?.length)  parts.push(t('utils.import.errorsCount', { count: result.errors.length }));
    showToast(parts.join(', '), result.errors?.length ? 'warning' : 'success');
    onDone?.();
  } catch (e) {
    showToast(t('utils.import.failed') + e.message, 'error');
  }
}

// ── Import characters from ZIP (селективный с артами/вещами/листами/дневниками) ──
function showImportConflictChoice() {
  if (_confirmOverlay) return Promise.resolve(null);
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.id = 'confirm-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', '_conflict-msg');
    ov.innerHTML = `
      <div class="confirm-box" style="max-width:480px">
        <div class="confirm-msg" id="_conflict-msg">${escHtml(t('chars.import.conflictMsg'))}</div>
        <div class="confirm-acts" style="flex-wrap:wrap;gap:8px">
          <button class="chr-modal-btn" id="_conf-skip">${escHtml(t('chars.import.conflictSkip'))}</button>
          <button class="chr-modal-btn" id="_conf-rename">${escHtml(t('chars.import.conflictRename'))}</button>
          <button class="chr-modal-btn danger" id="_conf-overwrite">${escHtml(t('chars.import.conflictOverwrite'))}</button>
          <button class="chr-modal-btn cancel" id="_conf-cancel">${escHtml(t('ui.btn.cancel'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    _confirmOverlay = ov;
    const cleanup = (result) => { ov.remove(); _confirmOverlay = null; document.removeEventListener('keydown', onKey); resolve(result); };
    const onKey = (e) => { if (e.key === 'Escape') cleanup(null); };
    document.addEventListener('keydown', onKey);
    ov.querySelector('#_conf-skip').onclick = () => cleanup('skip');
    ov.querySelector('#_conf-rename').onclick = () => cleanup('rename');
    ov.querySelector('#_conf-overwrite').onclick = () => cleanup('overwrite');
    ov.querySelector('#_conf-cancel').onclick = () => cleanup(null);
    bindBackdropDblClickClose(ov, () => cleanup(null));
    ov.querySelector('#_conf-skip').focus();
  });
}

async function importCharsZipFromFile(file, onDone) {
  if (!file) return;
  const mode = await showImportConflictChoice();
  if (!mode) return;
  try {
    const qs = window.location.search;
    const sep = qs ? '&' : '?';
    const url = `/api/import/characters/zip${qs}${sep}onConflict=${encodeURIComponent(mode)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: file,
    });
    const result = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(result.error || t('utils.import.error'));
    const parts = [];
    if (result.created?.length) parts.push(t('utils.import.done', { count: result.created.length }));
    if (result.renamed?.length) parts.push(t('chars.import.renamed', { count: result.renamed.length }));
    if (result.skipped?.length) parts.push(t('utils.import.skipped', { count: result.skipped.length }));
    if (result.errors?.length) parts.push(t('utils.import.errorsCount', { count: result.errors.length }));
    const msg = parts.length ? parts.join(', ') : t('chars.import.zipDone');
    showToast(msg, result.errors?.length ? 'warning' : 'success');
    if (result.errors?.length) console.warn('[import-zip] errors', result.errors);
    if (result.renamed?.length) console.info('[import-zip] renamed', result.renamed);
    onDone?.();
  } catch (e) {
    showToast(t('utils.import.failed') + e.message, 'error');
  }
}

function getOrigLabel(id) {
  return {
    'btn-new-city':    t('utils.btn.newCity'),
    'btn-validate':    t('utils.btn.validate'),
    'btn-validate-fix':t('utils.btn.validateFix'),
  }[id] || t('utils.btn.default');
}

// ── Modal focus management ──────────────────────────────────────────────
// Replaces a prior MutationObserver-based auto-trap (watched .open on any
// .chr-modal-backdrop/.modal-overlay) that looked correct but was empirically
// confirmed non-functional (impeccable audit 2026-07-12 + CDP verification:
// focus never entered the modal, Tab escaped freely, Escape did nothing).
// This version is explicit — every modal open/close call site calls these
// two functions directly instead of relying on a passive class-attribute
// watcher, so there's no timing ambiguity about when focusableEls() runs
// relative to the class/layout change.
const _modalState = new Map(); // id -> { prevFocus, trapHandler }

const _FOCUSABLE_SEL = 'button:not([disabled]), [href], input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function _modalFocusables(modal) {
  return Array.from(modal.querySelectorAll(_FOCUSABLE_SEL))
    .filter(el => el.offsetParent !== null);
}

// ── Backdrop click-to-close (только двойной щелчок) ─────────────────────────
// Закрытие модального окна кликом по затемнённому фону («за границей окна»)
// требует двойного щелчка: одиночный клик мимо панели игнорируется, чтобы он
// не обронил незаполненную форму (трекер: случайное попадание по полоске фона
// рядом с окном). Крестик и Escape закрывают как раньше, одним действием.
// `e.detail` на клике — число щелчков в серии: второй щелчок серии (≥2) закрывает.
function bindBackdropDblClickClose(overlay, closeFn) {
  if (!overlay) return;
  overlay.addEventListener('click', e => {
    if (e.target !== overlay) return; // клик внутри панели — не фон
    if (e.detail < 2) return;         // одиночный клик — ничего не закрываем
    closeFn();
  });
}

// focusSelector: optional CSS selector (scoped to the modal) for the element
// to focus on open — e.g. a name input. Falls back to the first focusable
// element. Pass null to just focus the modal's first focusable child.
// Сообщение у кнопки сохранения (.cdet-save-msg). Видимо только с классом .show
// (opacity: 0 + transition) — одного style.display недостаточно (Б13), поэтому
// display и .show переключаются только вместе, через эти два хелпера.
// text: undefined — оставить текущий текст; error — красный цвет; hideAfter — мс.
function showSaveMsg(el, { text, error = false, hideAfter = 0 } = {}) {
  if (!el) return;
  if (text !== undefined) el.textContent = text;
  el.style.color = error ? 'var(--c-error)' : '';
  el.style.display = '';
  el.classList.add('show');
  if (hideAfter) setTimeout(() => hideSaveMsg(el), hideAfter);
}
function hideSaveMsg(el) {
  if (!el) return;
  el.classList.remove('show');
  el.style.display = 'none';
}

function openModal(id, focusSelector = null) {
  const modal = document.getElementById(id);
  if (!modal) return;
  // A redundant open (e.g. two rapid clicks before the prior open settles)
  // must not leak the previous trapHandler off of `document`.
  const existing = _modalState.get(id);
  if (existing) document.removeEventListener('keydown', existing.trapHandler);
  const prevFocus = document.activeElement;
  modal.classList.add('open');

  // Most modals in this app are shown via a CSS `visibility: hidden -> visible`
  // transition (not display:none -> block), so an element can report a
  // non-null offsetParent (unaffected by visibility) while still being
  // un-focusable the instant classList.add() runs, before the browser
  // applies the new computed style. Deferring one frame fixes it reliably.
  requestAnimationFrame(() => {
    const toFocus = (focusSelector && modal.querySelector(focusSelector)) || _modalFocusables(modal)[0];
    toFocus?.focus();
  });

  // Listens on `document` (not `modal`) so Escape/Tab work even in the brief
  // window before focus actually lands inside the modal — a keydown handler
  // on the modal element itself only fires once an event bubbles from a
  // descendant that already has focus.
  const trapHandler = e => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Escape') { closeModal(id); return; }
    if (e.key !== 'Tab') return;
    const els = _modalFocusables(modal);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', trapHandler);
  _modalState.set(id, { prevFocus, trapHandler });
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('open');
  const state = _modalState.get(id);
  if (state) {
    document.removeEventListener('keydown', state.trapHandler);
    if (state.prevFocus && typeof state.prevFocus.focus === 'function') state.prevFocus.focus();
    _modalState.delete(id);
  }
}

// ── apiFetch: opt-in helper for consistent fetch error handling ────────────
// doc/audit/2026-07-09-project-improvement-plan.md P1.7 found ~140 raw
// fetch() calls across the frontend with inconsistent .catch()/.ok handling
// (some silently swallow errors, some don't check status at all). Rewriting
// all 140 at once was explicitly out of scope (too much surface for one
// pass) — this helper exists so NEW code, and code touched incidentally
// while fixing something else, has a one-line consistent option instead of
// hand-rolling try/catch + .ok checks again. Throws on network failure or a
// non-2xx response (with the parsed JSON body's `.error` if present).
async function apiFetch(url, opts) {
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new Error(t('utils.networkError') + e.message);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || t('utils.requestFailed', { status: res.status }));
  return body;
}

// ── Читаемые ошибки ИИ-провайдеров (спека llamacpp-local-provider §2.8, §3.6–3.7) ──
// Сервер отдаёт конверт { error, code, params, hint, action, details, retryable }.
// Текст берём из словаря по code (aierr.<CODE>.title/hint); если в шаблоне
// остались неподставленные {{…}} — вариант «_short», иначе русский текст сервера.
// Ответ без code (старый формат) показывается как раньше — d.error.
const _AI_PROVIDER_KEYS = ['claude', 'openai', 'openrouter', 'gemini', 'lmstudio', 'llamacpp', 'mock'];

function _aiErrText(key, params, fallback) {
  const full = t(key, params);
  if (full !== key && !/\{\{/.test(full)) return full;
  // RU: текст сервера точнее короткого варианта (в нём есть модель, контекст…).
  if (fallback && (window.i18nLang ? window.i18nLang() : 'ru') !== 'en') return fallback;
  const short = t(key + '_short', params);
  if (short !== key + '_short' && !/\{\{/.test(short)) return short;
  return fallback || '';
}

function aiErrorView(d, { operation = '' } = {}) {
  if (d instanceof Error) {
    // fetch к самому приложению не дошёл — это не ошибка провайдера.
    const offline = d.name === 'TypeError' || /Failed to fetch|NetworkError/i.test(d.message);
    return { code: null, title: offline ? t('aierr.APP_OFFLINE.title') : d.message, hint: offline ? t('aierr.APP_OFFLINE.hint') : '',
      operation, action: null, details: '', retryable: offline, cancelled: false };
  }
  d = d || {};
  const code = /^(AI|LLAMA|LMS|INSTALL)_[A-Z_]+$/.test(d.code || '') ? d.code : null;
  const params = { ...(d.params || {}) };
  if (params.provider) params.P = _AI_PROVIDER_KEYS.includes(params.provider) ? t('aierr.provider.' + params.provider) : params.provider;
  const title = code ? _aiErrText(`aierr.${code}.title`, params, d.error) : (d.error || t('cdet.unknownError'));
  // params.variant — уточнённая подсказка того же кода (aierr.<CODE>.hint_<variant>), если она есть в словаре.
  const variantKey = code && params.variant ? `aierr.${code}.hint_${params.variant}` : null;
  const variantHint = variantKey ? t(variantKey, params) : variantKey;
  const hint  = variantKey && variantHint !== variantKey && !/\{\{/.test(variantHint) ? variantHint
    : code ? _aiErrText(`aierr.${code}.hint`, params, d.hint) : (d.hint || '');
  const extra = [d.details, ...(Array.isArray(d.validationErrors) ? d.validationErrors : []), ...(Array.isArray(d.violations) ? d.violations : [])]
    .filter(Boolean).join('\n');
  const op = [operation, params.P].filter(Boolean).join(' · ');
  return { code, title, hint, operation: op, action: d.action || null, details: [code, extra].filter(Boolean).join('\n'),
    retryable: !!d.retryable, cancelled: code === 'LLAMA_CANCELLED', declined: d.code === 'GEN_PREFLIGHT_DECLINED' };
}

// Действие из конверта → переход. Возвращает false, если действие нельзя выполнить здесь.
function runAiErrorAction(action, onRetry) {
  if (action === 'retry') { if (onRetry) { onRetry(); return true; } return false; }
  if (action === 'open-models-dir') { fetch('/api/llamacpp/open-models-dir', { method: 'POST' }).catch(() => {}); return true; }
  const page = { 'open-ai-connect': 'settings-ai-connect', 'open-llamacpp-settings': 'settings-ai-connect',
    'install-llamacpp': 'settings-ai-connect', 'switch-backend': 'settings-ai-connect', 'open-ai-features': 'settings-ai-features' }[action];
  if (!page || typeof navigate !== 'function') return false;
  navigate(page);
  if (page === 'settings-ai-connect') {
    setTimeout(() => document.getElementById('llama-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  }
  return true;
}

function _aiActionLabel(action, retryable, onRetry) {
  if ((action === 'retry' || retryable) && onRetry) return t('aierr.act.retry');
  if (!action || action === 'retry') return '';
  return t('aierr.act.' + action);
}

function _aiRunAct(v, onRetry) {
  if ((v.action === 'retry' || v.retryable) && onRetry) onRetry();
  else runAiErrorAction(v.action, onRetry);
}

// Блок ошибки (модалка llama.cpp, секция установки, встроенные места ошибок).
// onRegenerate — основная кнопка «Перегенерировать» (модалка llama.cpp); noCopy — без «Скопировать».
function renderAiErrorBlock(d, { operation = '', onRetry = null, compact = false, onAction = null, onRegenerate = null, noCopy = false } = {}) {
  const v = aiErrorView(d, { operation });
  const box = document.createElement('div');
  box.className = 'ai-err' + (compact ? ' ai-err--compact' : '') + (v.cancelled ? ' ai-err--neutral' : '');
  box.setAttribute('role', 'alert');
  const actLabel = _aiActionLabel(v.action, v.retryable, onRetry);
  box.innerHTML = `
    <div class="ai-err-title" tabindex="-1">${v.cancelled ? '' : '⚠ '}${escHtml(v.title)}</div>
    ${v.operation ? `<div class="ai-err-op">${escHtml(v.operation)}</div>` : ''}
    ${v.hint ? `<div class="ai-err-hint">${escHtml(v.hint)}</div>` : ''}
    ${actLabel || onRegenerate ? `<div class="ai-err-actions">${onRegenerate ? `<button type="button" class="ai-err-act ai-err-regen">${escHtml(t('llama.regenerate'))}</button>` : ''}${actLabel ? `<button type="button" class="ai-err-act">${escHtml(actLabel)}</button>` : ''}</div>` : ''}
    ${v.details ? `<details class="ai-err-details"><summary>${escHtml(t('aierr.details'))}</summary>
      <pre class="ai-err-pre">${escHtml(v.details)}</pre>
      ${noCopy ? '' : `<button type="button" class="ai-err-copy">${escHtml(t('aierr.copy'))}</button>`}</details>` : ''}`;
  box.querySelector('.ai-err-regen')?.addEventListener('click', e => { e.currentTarget.disabled = true; e.currentTarget.textContent = t('llama.regenerating'); onRegenerate(); });
  box.querySelector('.ai-err-act:not(.ai-err-regen)')?.addEventListener('click', () => { if (onAction) onAction(v.action); _aiRunAct(v, onRetry); });
  box.querySelector('.ai-err-copy')?.addEventListener('click', async e => {
    try { await navigator.clipboard.writeText(`${v.title}\n${v.hint}\n${v.details}`); e.target.textContent = t('aierr.copied'); }
    catch { e.target.textContent = t('aierr.copyFail'); }
  });
  return box;
}

// Встроенное место ошибки (диалог НПС, рекап, форма модуля): компактный блок вместо строки «Ошибка: …».
function showAiErrorIn(el, d, opts = {}) {
  if (!el) return;
  el.innerHTML = '';
  if (d && d.code === 'GEN_PREFLIGHT_DECLINED') return; // генерацию отменил сам пользователь
  el.appendChild(renderAiErrorBlock(d, { compact: true, ...opts }));
}

// Модалка «Подробнее» для тоста (создаётся один раз).
function showAiErrorDetails(d, opts = {}) {
  let ov = document.getElementById('ai-err-modal');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'ai-err-modal';
    ov.className = 'modal-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', t('aierr.modalTitle'));
    ov.innerHTML = `<div class="modal-box ai-err-modal-box">
      <button class="modal-close" type="button" aria-label="${escAttr(t('ui.btn.close'))}">✕</button>
      <div class="modal-title">${escHtml(t('aierr.modalTitle'))}</div><div class="ai-err-modal-body"></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('.modal-close').addEventListener('click', () => closeModal('ai-err-modal'));
    bindBackdropDblClickClose(ov, () => closeModal('ai-err-modal'));
  }
  const body = ov.querySelector('.ai-err-modal-body');
  body.innerHTML = '';
  const block = renderAiErrorBlock(d, { ...opts, onAction: () => closeModal('ai-err-modal') });
  block.querySelector('details')?.setAttribute('open', '');
  body.appendChild(block);
  openModal('ai-err-modal', '.ai-err-title');
}

// Тост ошибки генерации: 10 с, пауза при наведении/фокусе, крестик, действие, «Подробнее».
function showAiError(d, { operation = '', onRetry = null, duration = 10000 } = {}) {
  const v = aiErrorView(d, { operation });
  const container = document.getElementById('toast-container');
  if (!container) { console.error(v.title, v.details); return; }
  if (v.declined) return; // пользователь сам закрыл диалог «Данные не полные» — без тоста
  if (v.cancelled) { showToast(v.title, 'info'); return; }
  // Ошибку генерации через llama.cpp уже показывает его модалка — без дубля.
  if (window.LlamaUI && window.LlamaUI.isShowingError(d)) return;
  const olds = container.querySelectorAll('.toast.ai-err-toast');
  if (olds.length >= 3) olds[0].remove();
  const el = document.createElement('div');
  el.className = 'toast error ai-err-toast';
  el.setAttribute('role', 'alert');
  const actLabel = _aiActionLabel(v.action, v.retryable, onRetry);
  el.innerHTML = `
    <button type="button" class="ai-err-toast-close" aria-label="${escAttr(t('ui.btn.close'))}">✕</button>
    <div class="ai-err-title">⚠ ${escHtml(v.title)}</div>
    ${v.operation ? `<div class="ai-err-op">${escHtml(v.operation)}</div>` : ''}
    ${v.hint ? `<div class="ai-err-hint">${escHtml(v.hint)}</div>` : ''}
    <div class="ai-err-actions">
      ${actLabel ? `<button type="button" class="ai-err-act">${escHtml(actLabel)}</button>` : ''}
      ${v.details ? `<button type="button" class="ai-err-more">${escHtml(t('aierr.more'))}</button>` : ''}
    </div>`;
  container.appendChild(el);
  let timer = null;
  const remove = () => { clearTimeout(timer); el.classList.add('fade-out'); el.addEventListener('animationend', () => el.remove(), { once: true }); };
  const arm = () => { clearTimeout(timer); timer = setTimeout(remove, duration); };
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', arm);
  el.addEventListener('focusin', () => clearTimeout(timer));
  el.addEventListener('focusout', arm);
  el.querySelector('.ai-err-toast-close').addEventListener('click', remove);
  el.querySelector('.ai-err-act')?.addEventListener('click', () => { remove(); _aiRunAct(v, onRetry); });
  el.querySelector('.ai-err-more')?.addEventListener('click', () => { remove(); showAiErrorDetails(d, { operation, onRetry }); });
  arm();
}
