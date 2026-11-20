// ── llama.cpp: раздел «Подключение AI», модалка прогресса, индикатор ────────────
// Спека doc/design/archive/llamacpp-local-provider/spec.md §3. Сервер — routes/llamacpp.js.
//
// Модалка открывается сама: тонкая обёртка window.fetch замечает POST с
// JSON-телом, где preferSource/source === 'llamacpp' (так не нужно править
// каждую из ~20 точек генерации), и подписывается на SSE /api/llamacpp/events.
// В тело запроса обёртка дописывает только llamaCtx — контекст раздела «Назначения
// генераций» (spec generation-feedback R13), если вызывающий его не передал.
(function () {
  'use strict';

  const PHASES = ['queued', 'starting', 'loading', 'prompt', 'generating', 'done'];
  const CTX_PRESETS = [4096, 8192, 16384, 32768, 65536];
  const S = {
    es: null, job: null, res: null, log: [], text: '', install: null,
    pending: 0, req: null, modalOpen: false, minimized: false, showingError: null,
    closeTimer: null, idleTimer: null, openTimer: null, autoScroll: { text: true, log: true, prompt: false }, tab: 'text',
    prompts: [], held: null, lastShown: null, graceWatch: null, dropLogReset: false,
  };

  // ── Форматирование ───────────────────────────────────────────────────────────
  const fmtMb = b => b >= 1073741824 ? t('llama.gb', { n: (b / 1073741824).toFixed(1) }) : t('llama.mb', { n: Math.max(1, Math.round(b / 1048576)) });
  const fmtClock = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  function fmtEta(j) {
    if (j.etaSec == null) return t('llama.etaWait');
    if (j.etaSec < 60) return t('llama.etaLeft', { eta: t('llama.etaLessMin') });
    const base = t('llama.etaMin', { n: Math.round(j.etaSec / 60) });
    return j.etaMode === 'max' ? t('llama.etaMax', { eta: base }) : t('llama.etaLeft', { eta: base });
  }

  // ── Распознать запрос генерации через llama.cpp ─────────────────────────────
  function _llamaBody(init) {
    if (!init || String(init.method || 'GET').toUpperCase() !== 'POST') return null;
    if (typeof init.body !== 'string' || !init.body.includes('llamacpp')) return null;
    try {
      const b = JSON.parse(init.body);
      return b && (b.preferSource === 'llamacpp' || b.source === 'llamacpp') ? b : null;
    } catch { return null; }
  }

  // URL генерации → раздел «Назначения генераций»: одна таблица и для подписи операции,
  // и для контекста раздела (порядок важен — первое совпадение).
  const FEATURE_BY_URL = [
    [/free-gen\/character/, 'biography'], [/free-gen\/location/, 'locations'], [/free-gen\/scenario/, 'scenario'],
    [/generate-appearance/, 'appearance'], [/generate-prompt/, 'prompt'],
    [/generate-personality/, 'personality'], [/generate-biography/, 'biography'],
    [/\/sheet/, 'sheet'], [/fill|scenario/, 'scenario'], [/location/, 'locations'],
    [/dialog|reply|lines|npc/, 'dialogue'], [/prose|diary|recap|journal/, 'prose'],
  ];
  const FEATURE_LABEL_KEY = {
    appearance: 'ais.featAppearance', prompt: 'ais.featPrompt', personality: 'ais.featPersonality',
    biography: 'ais.featBiography', sheet: 'ais.featSheet', scenario: 'ais.featScenario',
    locations: 'ais.featLocations', dialogue: 'ais.featDialogue', prose: 'ais.featProse',
  };
  const featureOf = url => (FEATURE_BY_URL.find(([re]) => re.test(url)) || [])[1] || null;

  function _operationLabel(url) {
    const feat = featureOf(url);
    return feat ? t(FEATURE_LABEL_KEY[feat]) : t('llama.opGeneric');
  }

  function _readFeaturePrefs() {
    try { return JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}') || {}; } catch { return {}; }
  }

  // Контекст раздела в тело запроса, если вызывающий не задал свой.
  function _withFeatureCtx(url, init, body) {
    if (body.llamaCtx) return init;
    const ctx = Number(_readFeaturePrefs()[featureOf(url)]?.ctx);
    if (!Number.isInteger(ctx) || ctx <= 0) return init;
    return { ...init, body: JSON.stringify({ ...body, llamaCtx: ctx }) };
  }

  // Ошибку держим в модалке, а вызывающему коду ответ отдаём только по «Закрыть»; «Перегенерировать»
  // повторяет тот же запрос, и вызывающий получает уже его результат (spec generation-retry-preflight
  // ADR-1) — точки генерации не правятся.
  const _origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const body = _llamaBody(init);
    if (!body) return _origFetch(input, init);
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    init = _withFeatureCtx(url, init, body);
    return new Promise((resolve, reject) => {
      const run = () => {
        const req = { url, operation: _operationLabel(url), startedAt: Date.now() };
        _beginRequest(req);
        _origFetch(input, init).then(async resp => {
          let data = null;
          try { data = await resp.clone().json(); } catch { data = null; }
          // Сервер ждёт решения по неполным данным (gen-preflight.js) — это не ошибка генерации.
          if (data && data.code === 'GEN_PREFLIGHT') { _quietEnd(req); resolve(resp); return; }
          const failed = !resp.ok || (data && data.ok === false);
          const held = _endRequest(req, failed ? (data || { error: t('cdet.unknownError') }) : data, failed, run, () => resolve(resp));
          if (!held) resolve(resp);
        }, err => {
          if (!_endRequest(req, err, true, run, () => reject(err))) reject(err);
        });
      };
      run();
    });
  };

  function _beginRequest(req) {
    // Новый запрос, пока прошлый держит ошибку в модалке: прошлый вызывающий получает свою ошибку,
    // иначе его промис не завершится никогда (кнопка навсегда в «загрузке»).
    if (S.held) _releaseHeld();
    S.pending++;
    S.req = req;
    S.showingError = null;
    S.held = null;
    S.truncated = false;
    clearTimeout(S.closeTimer);
    clearTimeout(S.openTimer);
    // Чистое состояние (R5): ни ошибки, ни журнала, ни фазы/статистики прошлой задачи.
    S.text = '';
    S.prompts = [];
    S.log = [];
    S.job = null;
    document.getElementById('llama-err-slot')?.replaceChildren();
    _setTab('text');
    // Новое подключение сразу шлёт журнал прошлой задачи (reset) — его не показываем.
    if (connect()) S.dropLogReset = true;
    // Открываем не сразу: ответ GEN_PREFLIGHT приходит быстро, модалка не должна мигать (ADR-4).
    // Первое событие prompt этого запроса откроет её раньше.
    if (S.modalOpen || S.minimized) openProgress();
    else S.openTimer = setTimeout(() => { if (S.req === req && S.pending) openProgress(); }, 300);
  }

  function _quietEnd(req) {
    S.pending = Math.max(0, S.pending - 1);
    if (S.req !== req) return;
    clearTimeout(S.openTimer);
    if (S.modalOpen || S.minimized) closeProgress();
  }

  // → true, если ответ удержан до решения пользователя (ошибка показана в модалке).
  function _endRequest(req, d, failed, regenerate, release) {
    S.pending = Math.max(0, S.pending - 1);
    if (S.req !== req) return false;
    clearTimeout(S.openTimer);
    if (failed) {
      if (d && d.code === 'LLAMA_CANCELLED') { closeProgress(); showToast(t('llama.cancelledToast'), 'info'); return false; }
      if (!S.modalOpen && !S.minimized) openProgress();
      S.showingError = d;
      S.held = { release, regenerate: _canRegenerate(d) ? regenerate : null };
      _showModalError(d);
      return true;
    }
    const body = d;
    const sec = Math.round((Date.now() - req.startedAt) / 1000);
    _renderPhase('done');
    S.closeTimer = setTimeout(() => { if (!S.showingError) closeProgress(); }, 1500);
    showToast(t('llama.doneToast', { time: fmtClock(sec) }), 'success');
    const warn = (body && Array.isArray(body.warnings) ? body.warnings : []).find(w => w && w.code === 'LLAMA_TRUNCATED');
    if (warn || S.truncated) showToast(t('llama.truncatedToast'), 'warning');
    return false;
  }

  // Повтор поможет: ошибка формата/сети/таймаут или без кода. Нет — у кодов с переходом в настройки и отмены.
  function _canRegenerate(d) {
    if (d instanceof Error) return true;
    const v = aiErrorView(d);
    if (v.cancelled || v.code === 'LLAMA_PLATFORM') return false;
    return !v.action || v.action === 'retry' || v.retryable;
  }

  // «Закрыть» / Escape при показанной ошибке: вызывающий код получает исходный ответ.
  function _releaseHeld() {
    const h = S.held;
    S.held = null;
    if (S.showingError) S.lastShown = { d: S.showingError, at: Date.now() };
    S.showingError = null;
    if (h) h.release();
  }

  // Тост об ошибке не дублирует то, что уже видно в модалке llama.cpp — и то, что пользователь
  // только что закрыл (ответ отдаётся вызывающему коду после «Закрыть»).
  function isShowingError(d) {
    if (!d) return false;
    if (S.showingError && (S.modalOpen || S.minimized)) return true;
    const last = S.lastShown;
    return !!(last && Date.now() - last.at < 3000 && (last.d === d || (last.d.code === d.code && last.d.error === d.error)));
  }

  // ── SSE ──────────────────────────────────────────────────────────────────────
  // → true, если открыто новое подключение.
  function connect() {
    clearTimeout(S.idleTimer);
    if (S.es) return false;
    const es = new EventSource('/api/llamacpp/events');
    S.es = es;
    es.addEventListener('job', e => _applyJob(JSON.parse(e.data)));
    es.addEventListener('log', e => {
      const d = JSON.parse(e.data);
      if (d.reset && S.dropLogReset) { S.dropLogReset = false; return; }
      S.log = d.reset ? d.lines : S.log.concat(d.lines).slice(-500);
      _renderLog();
    });
    es.addEventListener('resources', e => { S.res = JSON.parse(e.data); _renderMeters(); });
    // Промт каждого вызова модели текущего запроса — вкладка «Промт» (spec generation-retry-preflight P1).
    es.addEventListener('prompt', e => {
      if (!S.req || S.showingError) return;
      S.prompts.push(JSON.parse(e.data));
      if (!S.modalOpen && !S.minimized && S.pending) { clearTimeout(S.openTimer); openProgress(); }
      else _renderPrompts();
    });
    es.addEventListener('install', e => { S.install = JSON.parse(e.data); _renderInstall(); });
    es.onerror = () => { /* EventSource сам переподключается */ };
    return true;
  }

  // Пока идёт наш запрос, итог прошлой задачи (ошибка/готово, пауза, простой — например, снимок
  // при новом подключении) не рисуем (R5). Живые 'running' принимаем всегда: это наша задача
  // или та, за которой мы стоим в очереди.
  function _isStaleJob(j) {
    if (!S.pending || !S.req || !j || j.state === 'running') return false;
    return !j.startedAt || j.startedAt < S.req.startedAt;
  }
  function _applyJob(j) {
    if (_isStaleJob(j)) return;
    S.job = j;
    _onJob();
  }

  // Сторож паузы (R16): если финальное событие паузы потерялось (разрыв SSE, сбой выгрузки),
  // через graceLeftSec + 10 с после последнего события состояние берётся из GET /status.
  // Тики паузы идут раз в секунду и каждый раз переставляют срок.
  function _armGraceWatch() {
    clearTimeout(S.graceWatch);
    S.graceWatch = null;
    const j = S.job || {};
    if (j.state !== 'grace') return;
    const sec = Math.max(0, Number(j.graceLeftSec) || 0) + 10;
    S.graceWatch = setTimeout(_graceWatchFire, sec * 1000);
  }
  async function _graceWatchFire() {
    S.graceWatch = null;
    if (S.es && S.es.readyState === EventSource.CLOSED) { S.es.close(); S.es = null; }
    if (!S.es) connect(); // снимок job придёт и по новому подключению
    try {
      const st = await _origFetch('/api/llamacpp/status').then(r => r.json());
      if (st && st.job) _applyJob(st.job);
      else _armGraceWatch();
    } catch {
      // Сервер недоступен — повторим, пока индикатор в паузе.
      if ((S.job || {}).state === 'grace') S.graceWatch = setTimeout(_graceWatchFire, 10000);
    }
  }
  function _maybeDisconnect() {
    clearTimeout(S.idleTimer);
    S.idleTimer = setTimeout(() => {
      const busy = S.pending > 0 || (S.job && ['running', 'grace'].includes(S.job.state)) || (S.install && S.install.state === 'running');
      if (!busy && !S.modalOpen && S.es) { S.es.close(); S.es = null; }
    }, 5000);
  }

  function _onJob() {
    const j = S.job || {};
    if (j.textTail) S.text = j.textTail;
    if (j.state === 'done' && j.truncated) S.truncated = true;
    _renderIndicator();
    _armGraceWatch();
    if (S.modalOpen) _renderModal();
    if (!['running', 'grace'].includes(j.state)) _maybeDisconnect();
    _refreshSectionBusy();
  }

  // ── Модалка ──────────────────────────────────────────────────────────────────
  function _ensureModal() {
    let ov = document.getElementById('llama-modal');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'llama-modal';
    ov.className = 'modal-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'llama-modal-title');
    ov.innerHTML = `
      <div class="modal-box llama-modal-box">
        <button type="button" class="modal-close llama-min" id="llama-min" aria-label="${escAttr(t('llama.minimize'))}" title="${escAttr(t('llama.minimize'))}">—</button>
        <div class="modal-title" id="llama-modal-title">${escHtml(t('llama.modalTitle'))}</div>
        <div class="llama-sub" id="llama-sub"></div>
        <ol class="llama-steps" id="llama-steps" aria-label="${escAttr(t('llama.stepsAria'))}"></ol>
        <div class="llama-phase-now" id="llama-phase-now" role="status" aria-live="polite"></div>
        <div class="llama-bar" id="llama-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="llama-bar-fill"></div></div>
        <div class="llama-stats" id="llama-stats"></div>
        <div class="llama-meters" id="llama-meters"></div>
        <div class="llama-err-slot" id="llama-err-slot"></div>
        <div class="llama-tabs" role="tablist">
          <button type="button" role="tab" class="llama-tab" data-tab="text" id="llama-tab-text">${escHtml(t('llama.tabText'))}</button>
          <button type="button" role="tab" class="llama-tab" data-tab="prompt" id="llama-tab-prompt">${escHtml(t('llama.tabPrompt'))}</button>
          <button type="button" role="tab" class="llama-tab" data-tab="log" id="llama-tab-log">${escHtml(t('llama.tabLog'))}</button>
        </div>
        <div class="llama-pane-caption" id="llama-pane-caption" aria-live="off"></div>
        <pre class="llama-pane" id="llama-pane-text" role="tabpanel" aria-labelledby="llama-tab-text" tabindex="0"></pre>
        <pre class="llama-pane" id="llama-pane-prompt" role="tabpanel" aria-labelledby="llama-tab-prompt" tabindex="0" hidden></pre>
        <pre class="llama-pane" id="llama-pane-log" role="tabpanel" aria-labelledby="llama-tab-log" tabindex="0" hidden></pre>
        <div class="llama-foot">
          <button type="button" class="llama-btn llama-cancel" id="llama-cancel">${escHtml(t('llama.cancel'))}</button>
          <button type="button" class="llama-btn llama-close" id="llama-close" hidden>${escHtml(t('ui.btn.close'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    // Escape у openModal вызывает closeModal — для этой модалки это «свернуть».
    ov.querySelector('#llama-min').addEventListener('click', minimize);
    ov.querySelector('#llama-close').addEventListener('click', () => { _releaseHeld(); closeProgress(); });
    ov.querySelector('#llama-cancel').addEventListener('click', async () => {
      const ok = await showConfirm(t('llama.cancelConfirm'), { danger: true, confirmText: t('llama.cancelYes'), cancelText: t('llama.cancelNo') });
      if (ok) fetch('/api/llamacpp/cancel', { method: 'POST' }).catch(() => {});
    });
    ov.querySelectorAll('.llama-tab').forEach(b => b.addEventListener('click', () => _setTab(b.dataset.tab)));
    for (const k of ['text', 'log', 'prompt']) {
      const pane = ov.querySelector(`#llama-pane-${k}`);
      pane.addEventListener('scroll', () => { S.autoScroll[k] = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 8; });
    }
    new MutationObserver(() => {
      // closeModal (Escape) снимает .open — считаем это сворачиванием.
      // Escape при показанной ошибке — это «Закрыть»: удержанный ответ уходит вызывающему.
      if (S.modalOpen && !ov.classList.contains('open')) {
        S.modalOpen = false; S.minimized = !S.showingError;
        if (S.showingError) _releaseHeld();
        _renderIndicator(); _maybeDisconnect();
      }
    }).observe(ov, { attributes: true, attributeFilter: ['class'] });
    _setTab(S.tab);
    return ov;
  }

  function _setTab(tab) {
    S.tab = tab;
    const ov = document.getElementById('llama-modal');
    if (!ov) return;
    ov.querySelectorAll('.llama-tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    ov.querySelector('#llama-pane-text').hidden = tab !== 'text';
    ov.querySelector('#llama-pane-caption').hidden = tab !== 'text';
    ov.querySelector('#llama-pane-prompt').hidden = tab !== 'prompt';
    ov.querySelector('#llama-pane-log').hidden = tab !== 'log';
  }

  function openProgress() {
    _ensureModal();
    S.modalOpen = true;
    S.minimized = false;
    _renderModal();
    if (!document.getElementById('llama-modal').classList.contains('open')) openModal('llama-modal', '#llama-min');
    _renderIndicator();
  }
  function minimize() {
    S.minimized = true;
    closeModal('llama-modal');
  }
  function closeProgress() {
    clearTimeout(S.closeTimer);
    S.minimized = false;
    if (document.getElementById('llama-modal')?.classList.contains('open')) closeModal('llama-modal');
    S.modalOpen = false;
    _renderIndicator();
    _maybeDisconnect();
  }

  function _phaseOf(j) {
    if (!j) return 'starting';
    if (j.queue > 0 && j.state !== 'running') return 'queued';
    if (j.state === 'grace') return 'done'; // phase 'unloading' паузы — не шаг задачи
    return j.phase || (j.state === 'done' ? 'done' : 'starting');
  }

  function _renderPhase(forced) {
    const ov = document.getElementById('llama-modal');
    if (!ov) return;
    const j = S.job || {};
    const ph = forced || _phaseOf(j);
    const idx = PHASES.indexOf(ph);
    const steps = PHASES.filter(p => p !== 'queued' || ph === 'queued');
    ov.querySelector('#llama-steps').innerHTML = steps.map(p => {
      const i = PHASES.indexOf(p);
      const st = i < idx || ph === 'done' ? 'done' : i === idx ? 'now' : 'todo';
      const mark = st === 'done' ? '✓' : st === 'now' ? '●' : '○';
      return `<li class="llama-step llama-step--${st}"${st === 'now' ? ' aria-current="step"' : ''}><span aria-hidden="true">${mark}</span> ${escHtml(t('llama.phase.' + p, { n: j.queue || 1 }))}</li>`;
    }).join('');
    const pos = steps.indexOf(ph) + 1;
    ov.querySelector('#llama-phase-now').textContent = `${t('llama.phase.' + ph, { n: j.queue || 1 })} · ${pos}/${steps.length}`;
  }

  function _renderModal() {
    const ov = _ensureModal();
    const j = S.job || {};
    const ph = S.showingError ? (_phaseOf(j) === 'done' ? 'generating' : _phaseOf(j)) : _phaseOf(j);
    ov.querySelector('#llama-sub').textContent = [S.req?.operation, j.model && j.vision ? `${j.model} ${t('llama.visionBadge')}` : j.model, j.ctx ? t('llama.ctxShort', { n: j.ctx }) : ''].filter(Boolean).join(' · ');
    if (!S.showingError) _renderPhase();

    // Прогресс-бар: чтение промта — по prompt_progress, генерация — от ожидаемой длины.
    const bar = ov.querySelector('#llama-bar');
    const fill = bar.firstElementChild;
    let pct = null;
    if (ph === 'prompt' && j.promptTotal > 0) pct = Math.min(100, Math.round(100 * j.promptProcessed / j.promptTotal));
    else if (ph === 'generating' && (j.expectedShown || j.maxTokens)) pct = Math.min(99, Math.round(100 * j.tokens / (j.expectedShown || j.maxTokens)));
    else if (ph === 'done') pct = 100;
    bar.classList.toggle('llama-bar--indet', pct == null && !S.showingError);
    fill.style.transform = pct == null ? '' : `scaleX(${pct / 100})`;
    if (pct == null) bar.removeAttribute('aria-valuenow'); else bar.setAttribute('aria-valuenow', String(pct));

    const elapsed = j.startedAt ? Math.round((Date.now() - j.startedAt) / 1000) : 0;
    const parts = [];
    if (ph === 'prompt' && pct != null) parts.push(t('llama.promptPct', { n: pct }));
    if (ph === 'generating') {
      parts.push(j.expectedShown ? t('llama.tokensOf', { n: j.tokens, of: j.expectedShown }) : t('llama.tokens', { n: j.tokens }));
      if (j.tps) parts.push(t('llama.tps', { n: j.tps }));
    }
    if (j.startedAt) parts.push(t('llama.elapsed', { time: fmtClock(elapsed) }));
    if (ph === 'generating' || ph === 'prompt') parts.push(fmtEta(j));
    ov.querySelector('#llama-stats').textContent = parts.join(' · ');

    const pane = ov.querySelector('#llama-pane-text');
    pane.textContent = S.text || t('llama.textEmpty');
    if (S.autoScroll.text) pane.scrollTop = pane.scrollHeight;
    _renderMeters();
    _renderLog();
    _renderPrompts();

    const errored = !!S.showingError;
    // После ошибки счётчики задачи уже не про неё (сервер мог перейти в паузу/простой).
    bar.hidden = errored;
    if (errored) ov.querySelector('#llama-stats').textContent = '';
    ov.querySelector('#llama-cancel').hidden = errored || ph === 'done';
    ov.querySelector('#llama-close').hidden = !errored;
  }

  const _stageLabel = (p, i) => t('llama.stage.' + (p.stage || 'call'), { n: i + 1 });

  // Вкладка «Промт»: system + user каждого вызова запроса по порядку; картинки — числом.
  function _renderPrompts() {
    const pane = document.getElementById('llama-pane-prompt');
    if (!pane) return;
    pane.textContent = S.prompts.length ? S.prompts.map((p, i) => [
      `── ${i + 1} · ${_stageLabel(p, i)} ──`,
      p.system ? `${t('llama.promptSystem')}\n${p.system}` : '',
      `${t('llama.promptUser')}\n${p.user}`,
      p.images ? t('llama.images', { n: p.images }) : '',
    ].filter(Boolean).join('\n')).join('\n\n') : t('llama.promptEmpty');
    if (S.autoScroll.prompt) pane.scrollTop = pane.scrollHeight;
    const cap = document.getElementById('llama-pane-caption');
    const last = S.prompts.at(-1);
    if (cap) cap.textContent = last ? t('llama.answerOf', { stage: _stageLabel(last, S.prompts.length - 1) }) : '';
  }

  function _renderLog() {
    const pane = document.getElementById('llama-pane-log');
    if (!pane) return;
    pane.textContent = S.log.length ? S.log.join('\n') : t('llama.logEmpty');
    if (S.autoScroll.log) pane.scrollTop = pane.scrollHeight;
  }

  function _meter(label, pct, text) {
    const warn = pct != null && pct >= 90;
    const aria = `${label}: ${text}`;
    return `<div class="llama-meter${warn ? ' llama-meter--warn' : ''}" role="img" aria-label="${escAttr(aria)}">
      <div class="llama-meter-head"><span>${escHtml(label)}</span><span>${escHtml(text)}</span></div>
      <div class="llama-meter-bar"><div style="transform:scaleX(${pct == null ? 0 : Math.min(100, pct) / 100})"></div></div></div>`;
  }

  function _renderMeters() {
    const el = document.getElementById('llama-meters');
    if (!el) return;
    const r = S.res || {};
    const na = t('llama.na');
    const gb = mb => (mb / 1024).toFixed(1);
    const ram = r.ram ? Math.round(100 * r.ram.usedMb / r.ram.totalMb) : null;
    const g = r.gpu;
    const vram = g && g.memTotalMb ? Math.round(100 * g.memUsedMb / g.memTotalMb) : null;
    el.innerHTML = [
      _meter(t('llama.mCpu'), r.cpu, r.cpu == null ? na : `${r.cpu} %`),
      _meter(t('llama.mRam'), ram, r.ram ? t('llama.ofGb', { a: gb(r.ram.usedMb), b: gb(r.ram.totalMb) }) : na),
      _meter(t('llama.mGpu'), g ? g.util : null, g ? `${g.util} %` : na),
      _meter(t('llama.mVram'), vram, g && g.memUsedMb != null ? (g.memTotalMb ? t('llama.ofGb', { a: gb(g.memUsedMb), b: gb(g.memTotalMb) }) : t('llama.gbOnly', { a: gb(g.memUsedMb) })) : na),
    ].join('');
  }

  function _showModalError(d) {
    if (!S.modalOpen && !S.minimized) { showAiError(d, { operation: S.req?.operation }); return; }
    if (S.minimized) { openProgress(); }
    const ov = _ensureModal();
    const slot = ov.querySelector('#llama-err-slot');
    slot.innerHTML = '';
    const regen = S.held && S.held.regenerate;
    slot.appendChild(renderAiErrorBlock(d, {
      operation: S.req?.operation, noCopy: true,
      // Действие-переход (настройки, папка моделей) закрывает модалку — удержанный ответ отдаём.
      onAction: () => { _releaseHeld(); closeProgress(); },
      onRegenerate: regen ? () => {
        S.held = null; S.showingError = null; slot.innerHTML = '';
        _setTab('text');
        regen();
        requestAnimationFrame(() => document.getElementById('llama-phase-now')?.focus());
      } : null,
    }));
    _setTab('log');
    _renderModal();
    requestAnimationFrame(() => slot.querySelector('.ai-err-title')?.focus());
  }

  // ── Индикатор (плавающая кнопка рядом с кубиком и плеером) ───────────────────
  // Отсчёт кончился или сервер уже гасит модель — «выгрузка…», а не застывшее «через 1 с» (R16).
  const _graceLabel = j => j.phase === 'unloading' || (j.graceLeftSec != null && j.graceLeftSec <= 0)
    ? t('llama.indUnloading') : t('llama.indGrace', { n: j.graceLeftSec ?? '' });
  function _renderIndicator() {
    const j = S.job || {};
    const active = S.pending > 0 || ['running', 'grace'].includes(j.state);
    let el = document.getElementById('llama-indicator');
    if (!active || (S.modalOpen && j.state !== 'grace')) { if (el) el.hidden = true; _hidePopover(); return; }
    if (!el) {
      el = document.createElement('button');
      el.type = 'button';
      el.id = 'llama-indicator';
      el.className = 'llama-indicator';
      el.addEventListener('click', () => {
        if ((S.job || {}).state === 'grace' && S.pending === 0) _togglePopover();
        else openProgress();
      });
      document.body.appendChild(el);
    }
    el.hidden = false;
    let label;
    if (j.state === 'grace' && S.pending === 0) label = _graceLabel(j);
    else {
      const ph = _phaseOf(j);
      const pct = ph === 'generating' && (j.expectedShown || j.maxTokens) ? Math.min(99, Math.round(100 * j.tokens / (j.expectedShown || j.maxTokens)))
        : ph === 'prompt' && j.promptTotal ? Math.round(100 * j.promptProcessed / j.promptTotal) : null;
      label = pct == null ? t('llama.indPhase', { phase: t('llama.phase.' + ph, { n: j.queue || 1 }) }) : t('llama.indPct', { n: pct });
    }
    el.innerHTML = `<span class="llama-ind-icon" aria-hidden="true">🦙</span><span class="llama-ind-text">${escHtml(label)}</span>`;
    el.setAttribute('aria-label', `llama.cpp: ${label}`);
    const pop = document.getElementById('llama-popover');
    if (pop && !pop.hidden) _fillPopover(pop);
  }

  function _togglePopover() {
    let pop = document.getElementById('llama-popover');
    if (pop && !pop.hidden) { _hidePopover(); return; }
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'llama-popover';
      pop.className = 'llama-popover';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', t('llama.popAria'));
      document.body.appendChild(pop);
      document.addEventListener('keydown', e => { if (e.key === 'Escape') _hidePopover(); });
    }
    pop.hidden = false;
    _fillPopover(pop);
    pop.querySelector('button')?.focus();
  }
  function _fillPopover(pop) {
    const j = S.job || {};
    pop.innerHTML = `<div class="llama-pop-text">${escHtml(t('llama.popInMemory', { model: j.model || '' }))}</div>
      <div class="llama-pop-sub">${escHtml(_graceLabel(j))}</div>
      <button type="button" class="ais-confirm-btn llama-unload">${escHtml(t('llama.unloadNow'))}</button>`;
    pop.querySelector('.llama-unload').addEventListener('click', async () => {
      const d = await fetch('/api/llamacpp/unload', { method: 'POST' }).then(r => r.json()).catch(() => null);
      _hidePopover();
      if (d && d.ok) showToast(t('llama.unloadedToast'), 'success'); else if (d) showAiError(d);
    });
  }
  function _hidePopover() { const p = document.getElementById('llama-popover'); if (p) p.hidden = true; }

  // ── Раздел «Подключение AI» ──────────────────────────────────────────────────
  let _sec = null; // { el, status, models }

  async function renderConnectSection(container) {
    if (!container) return;
    container.innerHTML = `<div class="ais-section-title">${escHtml(t('llama.title'))}</div>
      <div class="ais-section-hint">${escHtml(t('llama.loading'))}</div>`;
    let status = null, models = [];
    try {
      [status, models] = await Promise.all([
        _origFetch('/api/llamacpp/status').then(r => r.json()),
        _origFetch('/api/llamacpp/models').then(r => r.json()).then(d => d.models || []).catch(() => []),
      ]);
    } catch (e) {
      container.innerHTML = '';
      container.appendChild(renderAiErrorBlock(e, { compact: true }));
      return;
    }
    S.install = status.install;
    if (status.job) { S.job = status.job; _renderIndicator(); }
    if (status.install?.state === 'running' || ['running', 'grace'].includes(status.job?.state)) connect();
    _sec = { el: container, status, models };
    _drawSection();
  }

  function _drawSection() {
    if (!_sec) return;
    const { el, status, models } = _sec;
    if (!status.platformOk) {
      el.innerHTML = `<div class="ais-section-title">${escHtml(t('llama.title'))}</div>
        <div class="ais-section-hint">${escHtml(t('llama.onlyWindows'))}</div>`;
      return;
    }
    const inst = status.installed;
    const det = status.detected || {};
    const s = status.settings || {};
    const backendOpt = b => `<option value="${b}">${escHtml(t('llama.backend.' + b))}</option>`;
    el.innerHTML = `
      <div class="ais-section-title">${escHtml(t('llama.title'))}
        <span class="ais-live-dot ${inst ? 'ais-live-online' : 'ais-live-offline'}" id="llama-dot">${escHtml(inst ? t('llama.installedDot') : t('llama.notInstalledDot'))}</span>
      </div>
      <div class="ais-section-hint">${escHtml(t('llama.hint'))}</div>

      <div class="ais-field llama-install">
        <div class="llama-install-state" id="llama-install-state">${escHtml(inst
          ? t('llama.installedAs', { build: inst.build || '?', backend: inst.backend ? t('llama.backend.' + inst.backend) : '?' })
          : t('llama.notInstalled'))}</div>
        <label class="ais-label" for="llama-backend">${escHtml(t('llama.backendLabel'))}</label>
        <div class="llama-row">
          <select class="ais-input" id="llama-backend">
            <option value="auto">${escHtml(t('llama.backendAuto', { backend: det.backend ? t('llama.backend.' + det.backend) : '?' }))}</option>
            ${(status.backends || []).map(backendOpt).join('')}
          </select>
          <button type="button" class="ais-confirm-btn" id="llama-install-btn">${escHtml(inst ? t('llama.update') : t('llama.install'))}</button>
        </div>
        <div class="ais-field-hint" id="llama-size-hint"></div>
        <div class="llama-bar llama-install-bar" id="llama-install-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" hidden><div class="llama-bar-fill"></div></div>
        <div class="ais-field-hint" id="llama-install-text" aria-live="polite"></div>
        <div id="llama-install-err"></div>
      </div>

      <fieldset class="llama-settings" id="llama-settings" ${inst ? '' : 'disabled'}>
        ${inst ? '' : `<div class="ais-field-hint">${escHtml(t('llama.installFirst'))}</div>`}
        <!-- Модель и контекст выбираются в «Назначении генераций» для каждого раздела (spec generation-feedback R11). -->
        <div class="ais-field">
          ${models.length ? `<div class="llama-models-found" id="llama-models-found">${escHtml(t('llama.modelsFound', { n: models.length }))}</div>` : `<div class="llama-empty">
            <div>${escHtml(t('llama.noModels'))}</div>
            <code class="llama-path">${escHtml(status.modelsDir || 'LLM\\models')}</code></div>`}
          <div class="llama-row">
            <button type="button" class="llama-btn" id="llama-open-dir">📂 ${escHtml(t('llama.openDir'))}</button>
            <button type="button" class="llama-btn" id="llama-refresh">⟳ ${escHtml(t('llama.refreshList'))}</button>
          </div>
        </div>
        <div class="ais-field">
          <label class="ais-label" for="llama-grace">${escHtml(t('llama.graceLabel'))}</label>
          <input class="ais-input llama-grace" id="llama-grace" type="number" min="0" max="${s.limits?.graceMax || 600}" step="1" value="${Number.isInteger(s.unloadGraceSec) ? s.unloadGraceSec : 30}">
          <div class="ais-field-hint">${escHtml(t('llama.graceHint'))}</div>
        </div>
        <button type="button" class="ais-confirm-btn" id="llama-save">${escHtml(t('llama.save'))}</button>
        <div class="ais-status" id="llama-save-status" role="status" aria-live="polite"></div>
      </fieldset>`;
    _wireSection();
    _renderInstall();
    _refreshSectionBusy();
  }

  function _wireSection() {
    const $ = id => document.getElementById(id);
    const backend = $('llama-backend');
    const sizeHint = $('llama-size-hint');
    const loadSize = async () => {
      sizeHint.textContent = t('llama.sizeLoading');
      try {
        const d = await _origFetch(`/api/llamacpp/release?backend=${encodeURIComponent(backend.value)}`).then(r => r.json());
        sizeHint.textContent = d.ok ? t('llama.sizeHint', { size: fmtMb(d.totalBytes), build: d.tag }) : aiErrorView(d).title;
      } catch { sizeHint.textContent = ''; }
    };
    backend.addEventListener('change', loadSize);
    loadSize();

    $('llama-install-btn').addEventListener('click', async () => {
      $('llama-install-err').innerHTML = '';
      connect();
      const d = await _origFetch('/api/llamacpp/install', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backend: backend.value }),
      }).then(r => r.json()).catch(e => e);
      if (d instanceof Error || !d.ok) { $('llama-install-err').appendChild(renderAiErrorBlock(d, { compact: true })); return; }
      S.install = d.install;
      _renderInstall();
    });

    $('llama-open-dir')?.addEventListener('click', () => _origFetch('/api/llamacpp/open-models-dir', { method: 'POST' }).catch(() => {}));
    $('llama-refresh')?.addEventListener('click', async () => {
      _sec.models = await _origFetch('/api/llamacpp/models').then(r => r.json()).then(d => d.models || []).catch(() => _sec.models);
      _drawSection();
    });

    $('llama-save').addEventListener('click', async () => {
      const status = $('llama-save-status');
      const btn = $('llama-save');
      const body = { unloadGraceSec: Number($('llama-grace').value) };
      btn.disabled = true;
      status.className = 'ais-status'; status.textContent = '';
      try {
        const d = await _origFetch('/api/llamacpp/settings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        }).then(r => r.json());
        if (!d.ok) throw new Error(d.error);
        _sec.status.settings = d.settings;
        status.textContent = t('ais.saved'); status.classList.add('ok');
        if (typeof _resetAiSettingsCache === 'function') _resetAiSettingsCache();
      } catch (e) {
        status.textContent = t('ais.saveError') + e.message; status.classList.add('err');
      } finally { btn.disabled = false; _refreshSectionBusy(); }
    });
  }

  function _renderInstall() {
    const bar = document.getElementById('llama-install-bar');
    if (!bar || !_sec) return;
    const st = S.install;
    const txt = document.getElementById('llama-install-text');
    const btn = document.getElementById('llama-install-btn');
    const running = st && st.state === 'running';
    bar.hidden = !running;
    if (running) {
      const pct = st.total ? Math.round(100 * st.received / st.total) : null;
      bar.classList.toggle('llama-bar--indet', pct == null || st.phase !== 'download');
      bar.firstElementChild.style.transform = pct == null ? '' : `scaleX(${pct / 100})`;
      if (pct != null) bar.setAttribute('aria-valuenow', String(pct));
      txt.textContent = st.phase === 'download' && st.total
        ? t('llama.instDownload', { a: fmtMb(st.received), b: fmtMb(st.total) }) + (st.retries ? ` · ${t('llama.instRetry', { n: st.retries })}` : '')
        : t('llama.inst.' + (st.phase || 'resolve'));
      btn.disabled = true;
      btn.textContent = t('llama.installing');
    } else if (st && st.state === 'done' && !_sec.status.installed) {
      showToast(t('llama.installedToast'), 'success');
      renderConnectSection(_sec.el); // перерисовать с установленным состоянием
    } else if (st && st.state === 'done') {
      txt.textContent = '';
      if (_sec.status.installed?.build !== st.build) { showToast(t('llama.installedToast'), 'success'); renderConnectSection(_sec.el); }
    } else if (st && st.state === 'error') {
      txt.textContent = '';
      const slot = document.getElementById('llama-install-err');
      if (slot && !slot.dataset.shown) {
        slot.innerHTML = '';
        slot.appendChild(renderAiErrorBlock(st.error, { compact: true, onRetry: () => { slot.dataset.shown = ''; btn.click(); } }));
        slot.dataset.shown = '1';
      }
    }
  }

  function _refreshSectionBusy() {
    const btn = document.getElementById('llama-install-btn');
    if (!btn || !_sec) return;
    const j = S.job || {};
    const running = S.install && S.install.state === 'running';
    const busy = j.state === 'running' || S.pending > 0;
    const grace = j.state === 'grace';
    btn.disabled = !!(running || busy || grace);
    btn.title = busy ? t('llama.busyGen') : grace ? t('llama.busyGrace') : '';
    if (!running) btn.textContent = _sec.status.installed ? t('llama.update') : t('llama.install');
    const save = document.getElementById('llama-save');
    if (save) { save.disabled = busy; save.title = busy ? t('llama.busyGen') : ''; }
  }

  // ── Модели для «Назначения генераций» ────────────────────────────────────────
  async function featureModels() {
    try {
      const [st, md] = await Promise.all([
        _origFetch('/api/llamacpp/status').then(r => r.json()),
        _origFetch('/api/llamacpp/models').then(r => r.json()),
      ]);
      const list = md.models || [];
      const label = m => `${m.label}${m.vision ? ` · ${t('llama.visionBadge')}` : ''} · ${fmtMb(m.sizeBytes)}`;
      const item = m => ({ id: m.id, label: label(m), trainCtx: m.trainCtx || null });
      return {
        installed: !!st.installed && st.platformOk !== false,
        // Модель раздела обязательна (spec generation-feedback R12): пункта «по умолчанию» нет.
        models: list.map(item),
        // «Внешность по арту» (спека llamacpp-vision §3.2): только модели, которые видят изображения.
        visionModels: list.filter(m => m.vision).map(item),
        hasModels: list.length > 0,
        hasVisionModels: list.some(m => m.vision),
        defaultCtx: st.settings?.defaultCtx || 8192,
        limits: { ctxMin: 512, ctxMax: 131072, ctxStep: 256, ...(st.settings?.limits || {}) },
      };
    } catch {
      return { installed: false, hasModels: false, models: [], visionModels: [], defaultCtx: 8192,
        limits: { ctxMin: 512, ctxMax: 131072, ctxStep: 256 } };
    }
  }

  // Опции «Контекста» раздела: пресеты + текущее значение, пометка «больше обученного».
  function ctxOptionsHtml(cur, trainCtx) {
    const presets = CTX_PRESETS.includes(cur) ? CTX_PRESETS : [...CTX_PRESETS, cur].sort((a, b) => a - b);
    return presets.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${v}${trainCtx && v > trainCtx ? ` — ${escHtml(t('llama.ctxOver'))}` : ''}</option>`).join('')
      + `<option value="custom">${escHtml(t('llama.ctxOther'))}</option>`;
  }

  // Перенос настроек llama.cpp в разделы (spec generation-feedback R14), один раз: модель по умолчанию /
  // для изображений и контекст модели из LLM/llamacpp.json — в разделы, где выбран llama.cpp.
  // Флаг ai-feature-prefs.__v = 2. Поля в llamacpp.json остаются фолбэком сервера.
  async function migrateFeaturePrefs() {
    const prefs = _readFeaturePrefs();
    if (prefs.__v === 2) return false;
    let changed = false;
    try {
      if (Object.entries(prefs).some(([k, p]) => k !== '__v' && p?.provider === 'llamacpp')) {
        const [st, md] = await Promise.all([
          _origFetch('/api/llamacpp/status').then(r => r.json()),
          _origFetch('/api/llamacpp/models').then(r => r.json()),
        ]);
        const s = st.settings || {};
        const firstVision = (md.models || []).find(m => m.vision)?.id || null;
        for (const [feat, p] of Object.entries(prefs)) {
          if (feat === '__v' || p?.provider !== 'llamacpp') continue;
          if (!p.model) {
            p.model = feat === 'appearance' ? (s.visionModel || firstVision || null) : (s.model || null);
            changed = true;
          }
          if (!p.ctx) { p.ctx = (p.model && s.ctx?.[p.model]) || s.defaultCtx || 8192; changed = true; }
        }
      }
    } catch { return false; } // сервер недоступен — перенос при следующем запуске
    prefs.__v = 2;
    try { localStorage.setItem('ai-feature-prefs', JSON.stringify(prefs)); } catch {}
    if (changed) showToast(t('llama.prefsMigrated'), 'success');
    return changed;
  }

  // ── Старт: если генерация уже идёт (перезагрузка страницы) — вернуть индикатор ──
  async function init() {
    try {
      const st = await _origFetch('/api/llamacpp/status').then(r => r.json());
      S.job = st.job;
      S.install = st.install;
      if (['running', 'grace'].includes(st.job?.state) || st.install?.state === 'running') { connect(); _renderIndicator(); }
    } catch { /* сервер ещё не готов — индикатор появится при следующей генерации */ }
    migrateFeaturePrefs();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.LlamaUI = { renderConnectSection, featureModels, ctxOptionsHtml, migrateFeaturePrefs, featureOf, isShowingError, openProgress, _state: S };
})();
