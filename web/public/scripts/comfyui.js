// ── ComfyUI: изображения персонажей и локаций (spec doc/design/comfyui) ─────────────────────
// Секция «Подключение AI → ComfyUI» (renderConnectSection — адрес и папка), секция «Назначение генераций →
// Генерация изображений» (renderProfilesSection — модель и LoRA портретов и локаций) и блок генерации в карточках.
// Карточки дают только разметку: кнопку [data-comfy-gen="<kind>"] и контейнер
// .comfy-box[data-comfy-kind]; этот модуль сам находит их (MutationObserver) — блок промта
// перерисовывается из нескольких мест, и ни одно не должно помнить про ComfyUI.
// Генерация идёт в модалке прогресса по образцу llama.cpp (spec FR10): этапы, шаги, нагрузка, журнал,
// «свернуть» → индикатор, «отменить». Классы модалки — общие llama-* (components.css).
// Зависит от глобалей: t, escHtml, escAttr, showToast, showConfirm, renderAiErrorBlock, openModal, closeModal,
// STATE, openCharDetail, openLocDetail, runAiErrorAction.
(function () {
  'use strict';

  const qs = () => window.location.search || '';
  const POLL_MS = 1000;
  // Шаги модалки (spec FR10). «Запуск ComfyUI» — только если был автозапуск, «Очередь» — только пока ждём,
  // «Детализация» — только когда у локаций включён второй проход, «Апскейл» — только когда у локаций
  // и районов нашлась апскейл-модель (location-upscale §9).
  const PHASES = ['queued', 'starting', 'loading', 'generating', 'refining', 'decoding', 'upscaling', 'saving', 'done'];
  const SAMPLING = ['generating', 'refining'];
  const lorasLabel = loras => (loras || []).map(l => `${String(l.name).split(/[\\/]/).pop().replace(/\.[a-z0-9]+$/i, '')} ×${l.strength}`).join(', ');
  // Одна генерация за раз (spec FR8) — одно состояние на страницу.
  const S = {
    setup: null,      // окно до запуска (spec FR14): { kind, slug, name, presets, suggested, selected, promptSize, hasPrompt, ckpt, loras, detail, loading }
    cur: null,        // { kind, slug, jobId, startedAt }
    job: null,        // последний ответ GET /jobs/:id
    error: null,      // { error, status } — ошибка старта/задания, показана в модалке
    modalOpen: false, minimized: false, tab: 'log', timer: null, autostarted: false,
    autoScroll: { log: true, prompt: false },
  };

  const fmtClock = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const keyOf = (kind, slug) => `${kind}:${slug}`;
  const isActive = () => !!S.cur && (!S.job || S.job.status === 'running') && !S.error;
  const finished = () => !!S.error || (S.job && S.job.status !== 'running');

  function slugFor(kind, el) {
    if (el?.dataset.comfySlug) return el.dataset.comfySlug;
    if (kind === 'character') return document.getElementById('cdet-gen-prompt')?.dataset.char || '';
    return document.getElementById('locdet-upload-btn')?.dataset.slug || '';
  }

  // ── Кнопка в карточке ──────────────────────────────────────────
  // Не блокируется на время генерации: повторное нажатие открывает модалку задания.
  function syncButtons() {
    const busyKey = isActive() ? keyOf(S.cur.kind, S.cur.slug) : '';
    document.querySelectorAll('[data-comfy-gen]').forEach(btn => {
      const kind = btn.dataset.comfyGen;
      const mine = busyKey && busyKey === keyOf(kind, slugFor(kind, btn));
      const busy = mine ? 'true' : 'false';
      if (btn.getAttribute('aria-busy') !== busy) btn.setAttribute('aria-busy', busy);
      if (btn.disabled) btn.disabled = false;
      // Только при изменении: запись текста — мутация DOM, а наблюдатель ниже снова зовёт syncButtons.
      const text = mine ? t('comfy.generating', { time: fmtClock(Date.now() - S.cur.startedAt) }) : t('comfy.genBtn');
      if (btn.textContent !== text) btn.textContent = text;
    });
  }

  function _tick() {
    syncButtons();
    _renderIndicator();
    if (S.modalOpen) _renderStats();
  }

  // ── Запуск и опрос ─────────────────────────────────────────────
  // Кнопка карточки: идёт генерация — показать её; иначе окно выбора размера (запуск — «Сгенерировать»).
  async function startGeneration(kind, slug) {
    if (!slug) return;
    if (S.cur && !finished()) { openProgress(); return; }
    if (S.cur) _clearFinished();
    document.getElementById('comfy-err-slot')?.replaceChildren();
    S.setup = { kind, slug, loading: true };
    openProgress();
    const d = await fetch(`/api/comfyui/prepare${qs()}${qs() ? '&' : '?'}kind=${kind}&slug=${encodeURIComponent(slug)}`).then(r => r.json()).catch(() => null);
    if (!S.setup || S.setup.slug !== slug) return;   // окно уже закрыли
    if (!d || !d.ok) { S.setup = null; return _fail({ error: d?.error || t('comfy.genError') }); }
    Object.assign(S.setup, { loading: false, name: d.name, presets: d.presets, suggested: d.suggested, selected: d.suggested,
      promptSize: d.promptSize, hasPrompt: d.hasPrompt, ckpt: d.ckpt || '', loras: d.loras || [], detail: !!d.detail });
    _renderModal();
    requestAnimationFrame(() => document.querySelector('#comfy-setup [aria-checked="true"]')?.focus());
  }

  async function _launch() {
    const st = S.setup;
    if (!st || st.loading || !st.hasPrompt) return;
    S.setup = null;
    const { kind, slug, selected: size } = st;
    _reset({ kind, slug, name: st.name, jobId: null, startedAt: Date.now() });
    _renderModal();
    let r, d;
    try {
      r = await fetch(`/api/comfyui/generate${qs()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, slug, size }) });
      d = await r.json().catch(() => ({}));
    } catch (e) { return _fail({ error: e.message }); }
    // Уже идёт другое задание (вкладка перезагружалась) — подключиться к нему.
    if (r.status === 409 && d.job) {
      const prev = await fetch(`/api/comfyui/jobs/${encodeURIComponent(d.job.id)}`).then(x => x.json()).catch(() => null);
      // Прошлое задание закончено, но ComfyUI ещё закрывается — пара секунд.
      if (prev && prev.ok && prev.status !== 'running') return _fail({ error: t('comfy.stoppingRetry') });
      _reset({ kind: d.job.kind, slug: d.job.slug, jobId: d.job.id, startedAt: Date.now() });
      _poll();
      return;
    }
    if (r.status !== 202 || !d.jobId) return _fail({ error: d.error || t('comfy.genError'), status: r.status });
    S.cur.jobId = d.jobId;
    _poll();
  }

  function _reset(cur) {
    S.cur = cur; S.job = null; S.error = null; S.autostarted = false;
    S.autoScroll = { log: true, prompt: false };
    document.getElementById('comfy-err-slot')?.replaceChildren();
    _setTab('log');
    if (!S.timer) S.timer = setInterval(_tick, 1000);
    syncButtons();
  }

  async function _poll() {
    const jobId = S.cur?.jobId;
    while (S.cur && S.cur.jobId === jobId) {
      const d = await fetch(`/api/comfyui/jobs/${encodeURIComponent(jobId)}`).then(r => r.json()).catch(() => null);
      if (S.cur?.jobId !== jobId) return;
      if (!d || !d.ok) return _fail({ error: d?.error || t('comfy.jobLost') });
      S.job = d;
      if (d.startedAt) S.cur.startedAt = d.startedAt;
      if (d.phase === 'starting') S.autostarted = true;
      if (S.modalOpen) _renderModal();
      _renderIndicator();
      syncButtons();
      // Готово, но приложение ещё закрывает автозапущенный ComfyUI — результат показываем сразу,
      // опрос продолжаем, пока сервер не освободится.
      if (d.status !== 'running') {
        if (!S.cur.finishedSeen) { S.cur.finishedSeen = true; _finish(d); }
        if (!d.stopping || !S.cur || S.cur.jobId !== jobId) return;
      }
      await new Promise(res => setTimeout(res, POLL_MS));
    }
  }

  function _finish(d) {
    const { kind, slug } = S.cur;
    if (d.status === 'done') {
      refreshBoxes(kind, slug);
      if (!S.modalOpen) showToast(t('comfy.done'), 'success');
    } else if (d.status === 'cancelled') {
      showToast(t('comfy.cancelled'), 'info');
      closeProgress(true);
      return;
    } else {
      return _fail({ error: d.error || t('comfy.genError'), status: d.errorStatus });
    }
    _stopTimerIfIdle();
    if (S.modalOpen) _renderModal();
    _renderIndicator();
    syncButtons();
  }

  // Ошибка — в модалке (с переходом в настройки при 503), свёрнута — тостом.
  function _fail(err) {
    S.error = err;
    _stopTimerIfIdle();
    syncButtons();
    _renderIndicator();
    if (!S.modalOpen) {
      showToast(err.status === 503 ? `${err.error} ${t('comfy.openSettingsHint')}` : err.error, 'error', 10000);
      return;
    }
    const slot = document.getElementById('comfy-err-slot');
    slot.replaceChildren(renderAiErrorBlock(
      { error: err.error, action: err.status === 503 ? 'open-ai-connect' : null },
      { operation: t('comfy.modalTitle'), noCopy: true, onAction: () => {
        closeProgress(true);
        setTimeout(() => document.getElementById('comfy-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
      } }));
    _setTab('log');
    _renderModal();
    requestAnimationFrame(() => slot.querySelector('.ai-err-title')?.focus());
  }

  function _stopTimerIfIdle() {
    if (!isActive() && S.timer) { clearInterval(S.timer); S.timer = null; }
  }

  // ── Модалка ────────────────────────────────────────────────────
  function _ensureModal() {
    let ov = document.getElementById('comfy-modal');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'comfy-modal';
    ov.className = 'modal-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'comfy-modal-title');
    ov.innerHTML = `
      <div class="modal-box llama-modal-box comfy-modal-box">
        <button type="button" class="modal-close llama-min" id="comfy-min" aria-label="${escAttr(t('llama.minimize'))}" title="${escAttr(t('llama.minimize'))}">—</button>
        <div class="modal-title" id="comfy-modal-title">${escHtml(t('comfy.modalTitle'))}</div>
        <div class="llama-sub" id="comfy-sub"></div>
        <div class="comfy-setup" id="comfy-setup" hidden></div>
        <ol class="llama-steps" id="comfy-steps" aria-label="${escAttr(t('llama.stepsAria'))}"></ol>
        <div class="llama-phase-now" id="comfy-phase-now" role="status" aria-live="polite" tabindex="-1"></div>
        <div class="llama-bar" id="comfy-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="llama-bar-fill"></div></div>
        <div class="llama-stats" id="comfy-stats"></div>
        <div class="llama-meters" id="comfy-meters"></div>
        <div class="llama-err-slot" id="comfy-err-slot"></div>
        <div class="comfy-result" id="comfy-result" hidden></div>
        <div class="llama-tabs" role="tablist">
          <button type="button" role="tab" class="llama-tab" data-tab="log" id="comfy-tab-log">${escHtml(t('comfy.tabLog'))}</button>
          <button type="button" role="tab" class="llama-tab" data-tab="prompt" id="comfy-tab-prompt">${escHtml(t('llama.tabPrompt'))}</button>
        </div>
        <pre class="llama-pane" id="comfy-pane-log" role="tabpanel" aria-labelledby="comfy-tab-log" tabindex="0"></pre>
        <pre class="llama-pane" id="comfy-pane-prompt" role="tabpanel" aria-labelledby="comfy-tab-prompt" tabindex="0" hidden></pre>
        <div class="llama-foot">
          <button type="button" class="llama-btn llama-cancel" id="comfy-cancel">${escHtml(t('llama.cancel'))}</button>
          <button type="button" class="btn-submit comfy-start" id="comfy-start" hidden>${escHtml(t('comfy.start'))}</button>
          <button type="button" class="llama-btn llama-close" id="comfy-close" hidden>${escHtml(t('ui.btn.close'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#comfy-min').addEventListener('click', minimize);
    ov.querySelector('#comfy-close').addEventListener('click', () => closeProgress(true));
    ov.querySelector('#comfy-start').addEventListener('click', _launch);
    // Выбор размера: радиогруппа — клик и стрелки (roving tabindex).
    const setup = ov.querySelector('#comfy-setup');
    setup.addEventListener('click', e => {
      // «изменить» — в «Назначение генераций»: закрыть это окно и карточку, из которой его открыли.
      if (e.target.closest('#comfy-setup-edit')) {
        closeProgress(true);
        document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
        runAiErrorAction('open-ai-features');
        setTimeout(() => document.getElementById('comfy-profiles-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
        return;
      }
      const b = e.target.closest('[data-size]');
      if (b && S.setup) { S.setup.selected = b.dataset.size; _renderSetup(); }
    });
    setup.addEventListener('keydown', e => {
      if (!S.setup?.presets || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const ids = S.setup.presets.map(p => p.id);
      const i = ids.indexOf(S.setup.selected) + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1);
      S.setup.selected = ids[(i + ids.length) % ids.length];
      _renderSetup();
      setup.querySelector('[aria-checked="true"]')?.focus();
    });
    ov.querySelector('#comfy-cancel').addEventListener('click', async () => {
      const jobId = S.cur?.jobId;
      if (!jobId) return;
      const ok = await showConfirm(t('comfy.cancelConfirm'), { danger: true, confirmText: t('llama.cancelYes'), cancelText: t('llama.cancelNo') });
      if (ok) fetch(`/api/comfyui/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }).catch(() => {});
    });
    ov.querySelectorAll('.llama-tab').forEach(b => b.addEventListener('click', () => _setTab(b.dataset.tab)));
    for (const k of ['log', 'prompt']) {
      const pane = ov.querySelector(`#comfy-pane-${k}`);
      pane.addEventListener('scroll', () => { S.autoScroll[k] = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 8; });
    }
    // Escape у openModal вызывает closeModal: для идущей генерации это «свернуть», для готовой — «закрыть».
    new MutationObserver(() => {
      if (S.modalOpen && !ov.classList.contains('open')) {
        S.modalOpen = false;
        if (S.setup) S.setup = null;
        else if (finished()) _clearFinished(); else S.minimized = true;
        _renderIndicator();
      }
    }).observe(ov, { attributes: true, attributeFilter: ['class'] });
    _setTab(S.tab);
    return ov;
  }

  function _setTab(tab) {
    S.tab = tab;
    const ov = document.getElementById('comfy-modal');
    if (!ov) return;
    ov.querySelectorAll('.llama-tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    ov.querySelector('#comfy-pane-log').hidden = tab !== 'log';
    ov.querySelector('#comfy-pane-prompt').hidden = tab !== 'prompt';
  }

  function openProgress() {
    _ensureModal();
    S.modalOpen = true;
    S.minimized = false;
    _renderModal();
    if (!document.getElementById('comfy-modal').classList.contains('open')) openModal('comfy-modal', '#comfy-min');
    _renderIndicator();
  }
  function minimize() {
    if (S.setup || finished()) { closeProgress(true); return; }
    S.minimized = true;
    closeModal('comfy-modal');
  }
  // drop — забыть законченное задание (кандидат остаётся в карточке).
  function closeProgress(drop) {
    if (document.getElementById('comfy-modal')?.classList.contains('open')) closeModal('comfy-modal');
    S.modalOpen = false;
    S.minimized = false;
    S.setup = null;
    if (drop && finished()) _clearFinished();
    _renderIndicator();
  }
  function _clearFinished() {
    S.cur = null; S.job = null; S.error = null;
    _stopTimerIfIdle();
    syncButtons();
  }

  function _phaseOf() {
    const j = S.job;
    if (S.error) return null;
    if (!j) return 'loading';
    if (j.status === 'done') return 'done';
    return j.phase || 'loading';
  }

  function _renderSteps() {
    const ov = document.getElementById('comfy-modal');
    const ph = _phaseOf() || (S.job?.phase) || 'loading';
    const idx = PHASES.indexOf(ph);
    const steps = PHASES.filter(p => (p !== 'queued' || ph === 'queued') && (p !== 'starting' || S.autostarted)
      && (p !== 'refining' || S.job?.detail || ph === 'refining')
      && (p !== 'upscaling' || S.job?.upscale || ph === 'upscaling'));
    ov.querySelector('#comfy-steps').innerHTML = steps.map(p => {
      const i = PHASES.indexOf(p);
      const st = S.error ? (i < idx ? 'done' : 'todo') : i < idx || ph === 'done' ? 'done' : i === idx ? 'now' : 'todo';
      const mark = st === 'done' ? '✓' : st === 'now' ? '●' : '○';
      return `<li class="llama-step llama-step--${st}"${st === 'now' ? ' aria-current="step"' : ''}><span aria-hidden="true">${mark}</span> ${escHtml(t('comfy.phase.' + p))}</li>`;
    }).join('');
    const pos = steps.indexOf(ph) + 1;
    ov.querySelector('#comfy-phase-now').textContent = S.error ? '' : `${t('comfy.phase.' + ph)} · ${pos}/${steps.length}`;
  }

  function _pct() {
    const j = S.job || {}, ph = _phaseOf();
    if (ph === 'done') return 100;
    if (SAMPLING.includes(ph) && j.steps > 0) return Math.min(99, Math.round(100 * j.step / j.steps));
    return null;
  }

  function _renderStats() {
    const ov = document.getElementById('comfy-modal');
    if (!ov) return;
    const j = S.job || {}, ph = _phaseOf();
    const parts = [];
    if (SAMPLING.includes(ph) && j.steps > 0) parts.push(t('comfy.stepOf', { n: j.step, of: j.steps }));
    if (S.cur) parts.push(t('llama.elapsed', { time: fmtClock((j.finishedAt || Date.now()) - S.cur.startedAt) }));
    if (SAMPLING.includes(ph)) parts.push(j.etaSec == null ? t('llama.etaWait') : t('comfy.eta', { time: fmtClock(j.etaSec * 1000) }));
    if (j.stopping) parts.push(t('comfy.stopping'));
    ov.querySelector('#comfy-stats').textContent = S.error ? '' : parts.join(' · ');
  }

  function _meter(label, pct, text) {
    const warn = pct != null && pct >= 90;
    return `<div class="llama-meter${warn ? ' llama-meter--warn' : ''}" role="img" aria-label="${escAttr(`${label}: ${text}`)}">
      <div class="llama-meter-head"><span>${escHtml(label)}</span><span>${escHtml(text)}</span></div>
      <div class="llama-meter-bar"><div style="transform:scaleX(${pct == null ? 0 : Math.min(100, pct) / 100})"></div></div></div>`;
  }

  function _renderMeters() {
    const el = document.getElementById('comfy-meters');
    const r = (S.job && S.job.res) || {};
    const na = t('llama.na');
    const gb = mb => (mb / 1024).toFixed(1);
    const ram = r.ram ? Math.round(100 * r.ram.usedMb / r.ram.totalMb) : null;
    const g = r.gpu;
    const vram = g && g.memTotalMb ? Math.round(100 * g.memUsedMb / g.memTotalMb) : null;
    el.hidden = finished();
    el.innerHTML = [
      _meter(t('llama.mCpu'), r.cpu, r.cpu == null ? na : `${r.cpu} %`),
      _meter(t('llama.mRam'), ram, r.ram ? t('llama.ofGb', { a: gb(r.ram.usedMb), b: gb(r.ram.totalMb) }) : na),
      _meter(t('llama.mGpu'), g ? g.util : null, g ? `${g.util} %` : na),
      _meter(t('llama.mVram'), vram, g && g.memUsedMb != null ? (g.memTotalMb ? t('llama.ofGb', { a: gb(g.memUsedMb), b: gb(g.memTotalMb) }) : t('llama.gbOnly', { a: gb(g.memUsedMb) })) : na),
    ].join('');
  }

  function _renderResult() {
    const box = document.getElementById('comfy-result');
    const c = S.job && S.job.status === 'done' && S.job.candidate;
    box.hidden = !c;
    if (!c) { box.replaceChildren(); return; }
    if (box.dataset.file === c.file) return;   // не перерисовывать картинку каждую секунду
    box.dataset.file = c.file;
    box.innerHTML = `
      <img class="comfy-result-img" src="${escAttr(c.url)}" alt="${escAttr(t('comfy.candidateAlt'))}" decoding="async">
      <div class="comfy-cand-actions">
        <button type="button" class="btn-submit comfy-accept" id="comfy-modal-accept">${escHtml(t('comfy.accept'))}</button>
        <button type="button" class="cdet-cancel-btn comfy-reject" id="comfy-modal-reject">${escHtml(t('comfy.reject'))}</button>
      </div>
      <div class="comfy-result-hint">${escHtml(t('comfy.resultHint'))}</div>`;
    const { kind, slug } = S.cur;
    box.querySelector('#comfy-modal-accept').addEventListener('click', async e => {
      if (await accept(kind, slug, c.file, e.currentTarget, { reopen: false })) { closeProgress(true); _reopenCard(kind, slug); }
    });
    box.querySelector('#comfy-modal-reject').addEventListener('click', async e => {
      if (await reject(kind, slug, c.file, e.currentTarget)) closeProgress(true);
    });
  }

  const _presetLabel = p => `${t('comfy.size.' + p.id)} · ${p.width}×${p.height}`;

  // Окно до запуска: размер (по умолчанию — из промта) и «Сгенерировать».
  function _renderSetup() {
    const ov = document.getElementById('comfy-modal');
    const st = S.setup;
    const box = ov.querySelector('#comfy-setup');
    if (st.loading) { box.innerHTML = `<div class="comfy-setup-hint">${escHtml(t('comfy.preparing'))}</div>`; return; }
    const sug = st.presets.find(p => p.id === st.suggested);
    const hint = !st.hasPrompt ? t('comfy.noPromptHint')
      : st.promptSize ? t('comfy.sizeFromPrompt', { w: st.promptSize.width, h: st.promptSize.height, pw: sug.width, ph: sug.height })
      : t('comfy.sizeNoPrompt', { label: t('comfy.size.' + sug.id) });
    box.innerHTML = `
      <div class="comfy-setup-label" id="comfy-size-label">${escHtml(t('comfy.sizeLabel'))}</div>
      <div class="comfy-sizes" role="radiogroup" aria-labelledby="comfy-size-label">
        ${st.presets.map(p => {
          const on = p.id === st.selected;
          return `<button type="button" role="radio" class="comfy-size${on ? ' is-on' : ''}" data-size="${escAttr(p.id)}" aria-checked="${on}" tabindex="${on ? 0 : -1}">
            <span class="comfy-size-shape" aria-hidden="true" style="aspect-ratio:${p.width} / ${p.height}"></span>
            <span class="comfy-size-name">${escHtml(t('comfy.size.' + p.id))}</span>
            <span class="comfy-size-px">${p.width}×${p.height}${p.id === st.suggested && st.promptSize ? ` · ${escHtml(t('comfy.fromPromptBadge'))}` : ''}</span>
          </button>`;
        }).join('')}
      </div>
      <div class="comfy-setup-hint${st.hasPrompt ? '' : ' comfy-setup-hint--warn'}">${escHtml(hint)}</div>
      <div class="comfy-setup-profile" id="comfy-setup-profile">
        <span>${escHtml([t('comfy.setupModel', { name: st.ckpt || t('comfy.setupModelDefault') }),
          st.loras.length ? t('comfy.setupLoras', { list: lorasLabel(st.loras) }) : t('comfy.setupNoLoras'),
          st.detail ? t('comfy.setupDetail') : ''].filter(Boolean).join(' · '))}</span>
        <button type="button" class="llama-link" id="comfy-setup-edit">${escHtml(t('comfy.setupEdit'))}</button>
      </div>`;
    ov.querySelector('#comfy-start').disabled = !st.hasPrompt;
  }

  function _renderModal() {
    const ov = _ensureModal();
    const inSetup = !!S.setup;
    ov.querySelector('.comfy-modal-box').classList.toggle('comfy-modal--setup', inSetup);
    ov.querySelector('#comfy-setup').hidden = !inSetup;
    ov.querySelector('#comfy-start').hidden = !inSetup;
    if (inSetup) {
      const kindLabel = t(S.setup.kind === 'character' ? 'comfy.kindCharacter' : S.setup.kind === 'district' ? 'comfy.kindDistrict' : 'comfy.kindLocation');
      ov.querySelector('#comfy-sub').textContent = `${kindLabel}: ${S.setup.name || S.setup.slug}`;
      ov.querySelector('#comfy-cancel').hidden = true;
      ov.querySelector('#comfy-close').hidden = false;
      _renderSetup();
      return;
    }
    const j = S.job || {};
    const kindLabel = S.cur ? t(S.cur.kind === 'character' ? 'comfy.kindCharacter' : S.cur.kind === 'district' ? 'comfy.kindDistrict' : 'comfy.kindLocation') : '';
    const loraLabel = j.loras && j.loras.length ? `LoRA ${lorasLabel(j.loras)}` : '';
    ov.querySelector('#comfy-sub').textContent = [kindLabel && `${kindLabel}: ${j.name || S.cur?.name || S.cur?.slug || ''}`, j.ckpt, loraLabel, j.width ? `${j.width}×${j.height}` : '']
      .filter(Boolean).join(' · ');
    _renderSteps();
    const bar = ov.querySelector('#comfy-bar'), fill = bar.firstElementChild, pct = _pct();
    bar.hidden = !!S.error;
    bar.classList.toggle('llama-bar--indet', pct == null && !S.error);
    fill.style.transform = pct == null ? '' : `scaleX(${pct / 100})`;
    if (pct == null) bar.removeAttribute('aria-valuenow'); else bar.setAttribute('aria-valuenow', String(pct));
    _renderStats();
    _renderMeters();
    _renderResult();

    const log = ov.querySelector('#comfy-pane-log');
    log.textContent = (j.log && j.log.length) ? j.log.join('\n') : t('comfy.logEmpty');
    if (S.autoScroll.log) log.scrollTop = log.scrollHeight;
    const pr = ov.querySelector('#comfy-pane-prompt');
    const p = j.prompt;
    const promptText = p ? [`${t('comfy.positive')}\n${p.positive}`, p.negative ? `${t('comfy.negative')}\n${p.negative}` : ''].filter(Boolean).join('\n\n') : t('comfy.logEmpty');
    if (pr.textContent !== promptText) pr.textContent = promptText;

    const done = finished();
    ov.querySelector('#comfy-cancel').hidden = done || !S.cur?.jobId;
    ov.querySelector('#comfy-close').hidden = !done;
  }

  // ── Индикатор (свёрнутая модалка), над рядом плавающих кнопок ──
  function _renderIndicator() {
    let el = document.getElementById('comfy-indicator');
    const show = !!S.cur && !S.modalOpen && (isActive() || (S.job && S.job.status === 'done'));
    if (!show) { if (el) el.hidden = true; return; }
    if (!el) {
      el = document.createElement('button');
      el.type = 'button';
      el.id = 'comfy-indicator';
      el.className = 'llama-indicator comfy-indicator';
      el.addEventListener('click', openProgress);
      document.body.appendChild(el);
    }
    el.hidden = false;
    const j = S.job || {}, pct = _pct();
    const label = j.status === 'done' ? t('comfy.indDone')
      : pct != null ? t('comfy.indStep', { n: j.step, of: j.steps })
      : t('comfy.indPhase', { phase: t('comfy.phase.' + (_phaseOf() || 'loading')) });
    const html = `<span class="llama-ind-icon" aria-hidden="true">🖼️</span><span class="llama-ind-text">${escHtml(label)}</span>`;
    if (el.innerHTML !== html) el.innerHTML = html;
    el.setAttribute('aria-label', `ComfyUI: ${label}`);
  }

  // ── Кандидаты ──────────────────────────────────────────────────
  async function loadBox(box) {
    const kind = box.dataset.comfyKind, slug = slugFor(kind, box);
    if (!slug) return;
    box.dataset.ready = '1';
    const d = await fetch(`/api/comfyui/candidates${qs()}${qs() ? '&' : '?'}kind=${kind}&slug=${encodeURIComponent(slug)}`).then(r => r.json()).catch(() => null);
    const list = d?.candidates || [];
    box.innerHTML = list.length ? `
      <div class="cdet-section-title comfy-title">${escHtml(t('comfy.candidates', { n: list.length }))}</div>
      ${list.map(c => `<figure class="comfy-cand" data-file="${escAttr(c.file)}">
        <img class="comfy-cand-img" src="${escAttr(c.url)}" alt="${escAttr(t('comfy.candidateAlt'))}" loading="lazy" decoding="async">
        <figcaption class="comfy-cand-actions">
          <button type="button" class="btn-submit comfy-accept" data-comfy-accept="${escAttr(c.file)}">${escHtml(t('comfy.accept'))}</button>
          <button type="button" class="cdet-cancel-btn comfy-reject" data-comfy-reject="${escAttr(c.file)}">${escHtml(t('comfy.reject'))}</button>
        </figcaption>
      </figure>`).join('')}` : '';
  }

  function refreshBoxes(kind, slug) {
    document.querySelectorAll(`.comfy-box[data-comfy-kind="${kind}"]`).forEach(box => { if (slugFor(kind, box) === slug) loadBox(box); });
  }

  // Как после ручной загрузки: свежий список и переоткрытая карточка на той же вкладке.
  async function _reopenCard(kind, slug) {
    if (kind === 'character') {
      if (!document.getElementById('char-detail-modal')?.classList.contains('open')) return;
      const list = await fetch(`/api/characters${qs()}`).then(x => x.json()).catch(() => null);
      if (Array.isArray(list)) STATE.characters = list;
      openCharDetail(slug);
      document.querySelector('#char-detail-modal .cdet-tab[data-tab="desc"]')?.click();
    } else if (kind === 'district') {
      if (!document.getElementById('district-detail-modal')?.classList.contains('open')) return;
      await loadDistricts(); // STATE.districts свежим списком — openDistrictDetail ищет по нему
      openDistrictDetail(slug, { tab: 'images' });
    } else {
      if (!document.getElementById('loc-detail-modal')?.classList.contains('open')) return;
      const list = await fetch(`/api/locations${qs()}`).then(x => x.json()).catch(() => null);
      if (Array.isArray(list)) STATE.locations = list;
      openLocDetail(slug, 'images');
    }
  }

  async function accept(kind, slug, file, btn, { reopen = true } = {}) {
    btn.disabled = true;
    try {
      const r = await fetch(`/api/comfyui/candidates/accept${qs()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, slug, file }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { showToast(d.error || t('comfy.acceptError'), 'error'); btn.disabled = false; return false; }
      showToast(t('comfy.accepted', { file: d.filename }), 'success');
      if (reopen) await _reopenCard(kind, slug);
      else refreshBoxes(kind, slug);
      return true;
    } catch (e) { showToast(e.message, 'error'); btn.disabled = false; return false; }
  }

  async function reject(kind, slug, file, btn) {
    if (!await showConfirm(t('comfy.rejectConfirm'), { danger: true, confirmText: t('comfy.reject') })) return false;
    btn.disabled = true;
    const r = await fetch(`/api/comfyui/candidates${qs()}${qs() ? '&' : '?'}kind=${kind}&slug=${encodeURIComponent(slug)}&file=${encodeURIComponent(file)}`, { method: 'DELETE' }).catch(() => null);
    if (!r?.ok) { showToast(t('comfy.rejectError'), 'error'); btn.disabled = false; return false; }
    refreshBoxes(kind, slug);
    return true;
  }

  document.addEventListener('click', e => {
    const gen = e.target.closest('[data-comfy-gen]');
    if (gen) { startGeneration(gen.dataset.comfyGen, slugFor(gen.dataset.comfyGen, gen)); return; }
    const acc = e.target.closest('[data-comfy-accept]'), rej = e.target.closest('[data-comfy-reject]');
    if (!acc && !rej) return;
    const box = e.target.closest('.comfy-box');
    if (!box) return;
    const kind = box.dataset.comfyKind, slug = slugFor(kind, box);
    if (acc) accept(kind, slug, acc.dataset.comfyAccept, acc);
    else reject(kind, slug, rej.dataset.comfyReject, rej);
  });

  // Новые блоки (открытие карточки, перерисовка промта) — подгрузить кандидатов и состояние кнопки.
  new MutationObserver(() => {
    document.querySelectorAll('.comfy-box:not([data-ready])').forEach(loadBox);
    if (document.querySelector('[data-comfy-gen]')) syncButtons();
  }).observe(document.body, { childList: true, subtree: true });

  // После перезагрузки страницы идущая генерация снова видна индикатором.
  fetch('/api/comfyui/status').then(r => r.json()).then(d => {
    if (d && d.job && !S.cur) { _reset({ kind: d.job.kind, slug: d.job.slug, jobId: d.job.id, startedAt: Date.now() }); S.minimized = true; _poll(); }
  }).catch(() => {});

  // ── «Подключение AI» → ComfyUI: только связь (profiles-spec FR1) ──────────────
  // Чем рисовать (модель, LoRA) — в «Назначении генераций», renderProfilesSection.
  function renderConnectSection(el, settings) {
    if (!el) return;
    const s = settings || {};
    el.innerHTML = `
      <div class="ais-section-title">${t('comfy.title')}
        <span class="ais-live-dot" id="ais-comfy-dot">⏳ ${t('ais.lmsProbing')}</span>
      </div>
      <div class="ais-section-hint">${t('comfy.hint')}</div>
      <div class="ais-field">
        <label class="ais-label" for="ais-comfy-url">${t('comfy.urlLabel')}</label>
        <input class="ais-input" id="ais-comfy-url" type="text" value="${escAttr(s.COMFYUI_BASE_URL || 'http://127.0.0.1:8188')}">
        <div class="ais-field-hint">${t('comfy.urlHint')}</div>
      </div>
      <div class="ais-field">
        <label class="ais-label" for="ais-comfy-dir">${t('comfy.dirLabel')}</label>
        <input class="ais-input" id="ais-comfy-dir" type="text" placeholder="D:\\ComfyUI" value="${escAttr(s.COMFYUI_DIR || '')}">
        <div class="ais-field-hint">${t('comfy.dirHint')}</div>
      </div>
      <div class="ais-field-hint comfy-moved">${escHtml(t('comfy.modelsMoved'))}
        <button type="button" class="llama-link" id="ais-comfy-to-features">${escHtml(t('comfy.modelsMovedLink'))}</button></div>
      <button class="ais-confirm-btn" id="ais-comfy-save">${t('comfy.saveBtn')}</button>
      <div class="ais-status" id="ais-comfy-status" role="status" aria-live="polite"></div>`;

    const dot = el.querySelector('#ais-comfy-dot');
    const probe = async () => {
      const d = await fetch('/api/comfyui/status').then(r => r.json()).catch(() => null);
      const ok = !!d?.available;
      dot.className = `ais-live-dot ais-live-${ok ? 'online' : 'offline'}`;
      dot.textContent = ok ? t('comfy.online') : t('comfy.offline');
    };
    probe();
    el.querySelector('#ais-comfy-to-features').addEventListener('click', () => runAiErrorAction('open-ai-features'));
    el.querySelector('#ais-comfy-save').addEventListener('click', async () => {
      const btn = el.querySelector('#ais-comfy-save'), status = el.querySelector('#ais-comfy-status');
      btn.disabled = true; status.className = 'ais-status'; status.textContent = '';
      try {
        const body = { restart: false, COMFYUI_BASE_URL: el.querySelector('#ais-comfy-url').value.trim(),
          COMFYUI_DIR: el.querySelector('#ais-comfy-dir').value.trim() };
        const d = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
        if (!d.ok) throw new Error(d.error);
        Object.assign(s, body);
        status.textContent = t('ais.saved'); status.classList.add('ok');
        probe();
        // Адрес или папка сменились — списки моделей в «Назначении генераций» уже не те.
        document.getElementById('comfy-profiles-section')?.dispatchEvent(new Event('comfy:reload'));
      } catch (e) { status.textContent = t('ais.saveError') + e.message; status.classList.add('err'); }
      finally { btn.disabled = false; }
    });
  }

  // ── «Назначение генераций» → «Генерация изображений» (profiles-spec FR2–FR5, §6) ──
  // Две карточки: портреты персонажей и изображения локаций — своя модель и свой список LoRA.
  // Хранятся на сервере (LLM/comfyui.json), поэтому у секции своя кнопка «Сохранить».
  const PROFILE_CARDS = [
    { kind: 'character', icon: '🧛' },
    { kind: 'location', icon: '🏙️' },
  ];

  function renderProfilesSection(el) {
    if (!el) return;
    // data — ответ GET /api/comfyui/profiles; draft — то, что в полях (сила — строкой, как ввели).
    const P = { data: null, draft: null, failed: false };
    const toDraft = profiles => {
      const d = {};
      for (const { kind } of PROFILE_CARDS) {
        const p = profiles?.[kind] || {};
        d[kind] = { ckpt: p.ckpt || '', loras: (p.loras || []).map(l => ({ name: l.name, strength: String(l.strength), trigger: l.trigger || '' })) };
        if (kind === 'location') d[kind].detail = !!p.detail;
      }
      return d;
    };
    const maxLoras = () => P.data?.maxLoras || 4;
    const effectiveCkpt = kind => P.draft[kind].ckpt || P.data?.defaults?.[kind] || '';

    const loraArchOf = name => (P.data?.loraArch || {})[name] || null;
    // Архитектуру и «модель на тегах» определяет сервер (ckptInfo) — правила по имени файла живут в одном месте.
    const ckptInfoOf = kind => (P.data?.ckptInfo || {})[effectiveCkpt(kind)] || { arch: 'sdxl', tags: false };
    const wantArch = kind => ckptInfoOf(kind).arch;
    // Фильтр соответствия: LoRA другой архитектуры, чем модель карточки, в список не попадают
    // (архитектура не определилась — показываем, решать пользователю).
    const loraFits = (kind, name) => !loraArchOf(name) || loraArchOf(name) === wantArch(kind);
    const hiddenLoras = kind => (P.data?.loras || []).filter(n => !loraFits(kind, n)).length;

    const loraOptions = (kind, cur) => {
      const loras = P.data?.loras || [];
      const arch = loraArchOf;
      const want = wantArch(kind);
      // Уже выбранная остаётся в списке, даже если не подходит модели или не найдена, — с пометкой;
      // при пустых списках пометки «не найдена» нет.
      const fit = loras.filter(n => n === cur || loraFits(kind, n));
      const names = cur && !loras.includes(cur) ? [cur, ...fit] : fit;
      const note = name => loras.length && !loras.includes(name) ? ' ' + t('comfy.loraMissing')
        : arch(name) && arch(name) !== want ? ' ' + t('comfy.loraIncompat', { arch: t('comfy.arch.' + arch(name)) }) : '';
      return `<option value="">${escHtml(t('comfy.prof.loraPick'))}</option>` + names.map(name =>
        `<option value="${escAttr(name)}"${name === cur ? ' selected' : ''}>${escHtml(name + note(name))}</option>`).join('');
    };

    const cardHtml = ({ kind, icon }) => {
      const d = P.draft[kind];
      const list = P.data?.checkpoints || [];
      const names = d.ckpt && !list.includes(d.ckpt) ? [d.ckpt, ...list] : list;
      const def = P.data?.defaults?.[kind];
      const id = `comfy-prof-${kind}`;
      const rows = d.loras.map((l, i) => {
        const n = i + 1;
        return `<div class="comfy-prof-lora" data-i="${i}">
          <select class="ais-input comfy-prof-lora-name" data-f="name" aria-label="${escAttr(t('comfy.prof.loraFileAria', { n }))}">${loraOptions(kind, l.name)}</select>
          <input class="ais-input comfy-prof-lora-strength" data-f="strength" type="number" min="0" max="2" step="0.05" inputmode="decimal"
            value="${escAttr(l.strength)}" aria-label="${escAttr(t('comfy.prof.loraStrengthAria', { n }))}" title="${escAttr(t('comfy.loraStrengthLabel'))}">
          <input class="ais-input comfy-prof-lora-trigger" data-f="trigger" type="text" maxlength="260" value="${escAttr(l.trigger)}"
            placeholder="${escAttr(t('comfy.loraTriggerPh'))}" aria-label="${escAttr(t('comfy.prof.loraTriggerAria', { n }))}">
          <button type="button" class="comfy-prof-lora-del" data-del="${i}" aria-label="${escAttr(t('comfy.prof.loraDelAria', { name: l.name || n }))}" title="${escAttr(t('comfy.prof.loraDel'))}">✕</button>
        </div>`;
      }).join('');
      const full = d.loras.length >= maxLoras();
      const tagWarn = kind === 'location' && ckptInfoOf(kind).tags;
      return `
        <div class="ais-feat-card comfy-prof-card" data-comfy-profile="${kind}">
          <div class="ais-feat-card-header">
            <span class="ais-feat-icon" aria-hidden="true">${icon}</span>
            <div class="ais-feat-meta">
              <div class="ais-feat-label">${escHtml(t(`comfy.prof.${kind}Label`))}</div>
              <div class="ais-feat-desc">${escHtml(t(`comfy.prof.${kind}Desc`))}</div>
            </div>
          </div>
          <label class="ais-label comfy-prof-label" for="${id}-ckpt">${escHtml(t('comfy.ckptLabel'))}</label>
          <select class="ais-feat-model-select comfy-prof-ckpt" id="${id}-ckpt">
            <option value="">${escHtml(def ? t('comfy.prof.ckptDefault', { name: def }) : t('comfy.prof.ckptDefaultNone'))}</option>
            ${names.map(n => `<option value="${escAttr(n)}"${n === d.ckpt ? ' selected' : ''}>${escHtml(n + (list.length && !list.includes(n) ? ' ' + t('comfy.loraMissing') : ''))}</option>`).join('')}
          </select>
          ${tagWarn ? `<div class="ais-field-hint comfy-prof-tagwarn">${escHtml(t('comfy.prof.tagModelWarn'))}</div>` : ''}
          <div class="ais-label comfy-prof-label" id="${id}-loras-label">${escHtml(t('comfy.prof.lorasLabel'))}</div>
          <div class="comfy-prof-loras" role="group" aria-labelledby="${id}-loras-label">
            ${rows || `<div class="comfy-prof-empty">${escHtml(t('comfy.prof.lorasEmpty'))}</div>`}
          </div>
          <div class="comfy-prof-add-row">
            <button type="button" class="ais-confirm-btn ais-ghost-btn comfy-prof-add" data-add="${kind}"${full ? ' disabled' : ''}>${escHtml(t('comfy.prof.loraAdd'))}</button>
            ${full ? `<span class="ais-field-hint">${escHtml(t('comfy.prof.lorasMax', { n: maxLoras() }))}</span>` : ''}
          </div>
          ${hiddenLoras(kind) ? `<div class="ais-field-hint comfy-prof-filter">${escHtml(t('comfy.prof.lorasFiltered', { arch: t('comfy.arch.' + wantArch(kind)), n: hiddenLoras(kind) }))}</div>` : ''}
          <div class="ais-field-hint">${escHtml(t('comfy.loraStrengthHint'))}</div>
          ${kind === 'location' ? `
          <label class="comfy-prof-check" for="${id}-detail">
            <input type="checkbox" id="${id}-detail"${d.detail ? ' checked' : ''}>
            <span>${escHtml(t('comfy.prof.detailLabel'))}</span>
          </label>
          <div class="ais-field-hint">${escHtml(t('comfy.prof.detailHint'))}</div>` : ''}
        </div>`;
    };

    const render = () => {
      const d = P.data;
      const dotCls = d?.available ? 'online' : 'offline';
      const sourceHint = P.failed ? '' : d.source === 'disk' ? t('comfy.prof.sourceDisk') : '';
      el.innerHTML = `
        <div class="ais-section-title">${escHtml(t('comfy.prof.title'))}
          <span class="ais-live-dot ais-live-${dotCls}" id="comfy-prof-dot">${escHtml(d?.available ? t('comfy.online') : t('comfy.offline'))}</span>
        </div>
        <div class="ais-section-hint">${escHtml(t('comfy.prof.hint'))}</div>
        ${sourceHint ? `<div class="ais-field-hint" id="comfy-prof-source">${escHtml(sourceHint)}</div>` : ''}
        ${P.failed || d.source === 'none' ? `<div class="comfy-prof-notice" id="comfy-prof-notice">
          <span>${escHtml(t(P.failed ? 'comfy.prof.loadError' : 'comfy.prof.notConnected'))}</span>
          <button type="button" class="llama-link" id="comfy-prof-open-connect">${escHtml(t('comfy.prof.openConnect'))}</button>
        </div>` : ''}
        <div class="ais-feat-cards comfy-prof-cards">${PROFILE_CARDS.map(cardHtml).join('')}</div>
        <div class="ais-feat-actions">
          <button class="ais-confirm-btn" id="comfy-prof-save">${escHtml(t('comfy.prof.saveBtn'))}</button>
          <button type="button" class="ais-confirm-btn ais-ghost-btn" id="comfy-prof-refresh">${escHtml(t('comfy.prof.refresh'))}</button>
          <div class="ais-status" id="comfy-prof-status" role="status" aria-live="polite"></div>
        </div>`;
    };

    const setStatus = (text, cls) => {
      const st = el.querySelector('#comfy-prof-status');
      if (!st) return;
      st.textContent = text; st.className = 'ais-status' + (cls ? ' ' + cls : '');
    };

    // keepDraft — «Обновить списки» не теряет несохранённые правки.
    const load = async keepDraft => {
      if (!P.data) el.innerHTML = `<div class="loading-state"><div class="spinner"></div>${escHtml(t('comfy.prof.loading'))}</div>`;
      const d = await fetch('/api/comfyui/profiles').then(r => r.json()).catch(() => null);
      P.failed = !d || !d.ok;
      if (!P.failed) P.data = d;
      else if (!P.data) P.data = { available: false, source: 'none', checkpoints: [], loras: [], loraArch: {}, ckptInfo: {}, profiles: {}, defaults: {}, maxLoras: 4 };
      if (!keepDraft || !P.draft) P.draft = toDraft(P.data.profiles);
      render();
    };

    const cardKind = node => node.closest('[data-comfy-profile]')?.dataset.comfyProfile;

    // Правка поля — только в черновик (фокус не теряется); структура (строки, модель) — перерисовка.
    el.addEventListener('input', e => {
      const kind = cardKind(e.target), row = e.target.closest('.comfy-prof-lora');
      if (!kind) return;
      if (row && e.target.dataset.f && e.target.dataset.f !== 'name') P.draft[kind].loras[Number(row.dataset.i)][e.target.dataset.f] = e.target.value;
    });
    el.addEventListener('change', e => {
      const kind = cardKind(e.target);
      if (!kind) return;
      const row = e.target.closest('.comfy-prof-lora');
      if (e.target.classList.contains('comfy-prof-ckpt')) {
        P.draft[kind].ckpt = e.target.value;
        render();   // пометки «не сработает» у LoRA считаются от модели карточки
        el.querySelector(`#comfy-prof-${kind}-ckpt`)?.focus();
      } else if (row && e.target.dataset.f === 'name') {
        P.draft[kind].loras[Number(row.dataset.i)].name = e.target.value;
        row.querySelector('[data-del]').setAttribute('aria-label', t('comfy.prof.loraDelAria', { name: e.target.value || Number(row.dataset.i) + 1 }));
      } else if (e.target.type === 'checkbox') P.draft[kind].detail = e.target.checked;
    });
    el.addEventListener('click', async e => {
      const add = e.target.closest('[data-add]'), del = e.target.closest('[data-del]');
      if (add) {
        const kind = add.dataset.add;
        if (P.draft[kind].loras.length >= maxLoras()) return;
        P.draft[kind].loras.push({ name: '', strength: '0.4', trigger: '' });
        render();
        el.querySelector(`[data-comfy-profile="${kind}"] .comfy-prof-lora:last-child .comfy-prof-lora-name`)?.focus();
      } else if (del) {
        const kind = cardKind(del);
        P.draft[kind].loras.splice(Number(del.dataset.del), 1);
        render();
        el.querySelector(`[data-comfy-profile="${kind}"] [data-add]`)?.focus();
      } else if (e.target.closest('#comfy-prof-open-connect')) runAiErrorAction('open-ai-connect');
      else if (e.target.closest('#comfy-prof-refresh')) { await load(true); el.querySelector('#comfy-prof-refresh')?.focus(); }
      else if (e.target.closest('#comfy-prof-save')) save();
    });
    el.addEventListener('comfy:reload', () => load(true));

    async function save() {
      const body = {};
      for (const { kind } of PROFILE_CARDS) {
        const d = P.draft[kind];
        const loras = [];
        for (let i = 0; i < d.loras.length; i++) {
          const l = d.loras[i];
          if (!l.name) continue;   // строка без выбранного файла ничего не значит
          const strength = Number(String(l.strength).trim().replace(',', '.'));
          if (String(l.strength).trim() === '' || !Number.isFinite(strength) || strength < 0 || strength > 2) {
            setStatus(t('comfy.prof.strengthError', { name: l.name }), 'err');
            el.querySelector(`[data-comfy-profile="${kind}"] .comfy-prof-lora[data-i="${i}"] .comfy-prof-lora-strength`)?.focus();
            return;
          }
          loras.push({ name: l.name, strength, trigger: l.trigger.trim() });
        }
        body[kind] = { ckpt: d.ckpt, loras };
        if (kind === 'location') body[kind].detail = !!d.detail;
      }
      const btn = el.querySelector('#comfy-prof-save');
      btn.disabled = true; setStatus('');
      try {
        const r = await fetch('/api/comfyui/profiles', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
        await load(false);
        setStatus(t('ais.saved'), 'ok');
        el.querySelector('#comfy-prof-save')?.focus();
        setTimeout(() => { if (el.querySelector('#comfy-prof-status')?.textContent === t('ais.saved')) setStatus(''); }, 2000);
      } catch (err) {
        setStatus(t('ais.saveError') + err.message, 'err');
        btn.disabled = false;
      }
    }

    load(false);
  }

  window.ComfyUI = { renderConnectSection, renderProfilesSection };
})();
