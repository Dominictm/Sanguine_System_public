// ═══════════════════════════════════════════════════════════════
// Onboarding tour — ceremonial spotlight walkthrough (zero-dep)
// ═══════════════════════════════════════════════════════════════
// Steps target the sidebar (always visible, data-independent) so the tour works
// on a brand-new install with no city/characters yet. Workflow, not features.
const TOUR_SEEN_KEY = 'sanguine-tour-seen';
const TOUR_STEPS = [
  {
    sel: '.city-switch',
    title: 'tour.step1.title',
    body: 'tour.step1.body',
  },
  {
    sel: '.nav-item[data-page="characters"]',
    title: 'tour.step2.title',
    body: 'tour.step2.body',
  },
  {
    sel: '.nav-item[data-page="chronicles-page"]',
    title: 'tour.step3.title',
    body: 'tour.step3.body',
  },
  {
    sel: '.nav-item[data-page="session"]',
    title: 'tour.step4.title',
    body: 'tour.step4.body',
  },
  {
    sel: '.nav-item[data-page="threads"]',
    title: 'tour.step5.title',
    body: 'tour.step5.body',
  },
  {
    sel: '.nav-item[data-page="tools"]',
    title: 'tour.step6.title',
    body: 'tour.step6.body',
  },
];

let _tourIdx = 0;
let _tourEls = null;

function _tourTeardown() {
  if (_tourEls) {
    _tourEls.backdrop.remove();
    _tourEls.spotlight.remove();
    _tourEls.card.remove();
    _tourEls = null;
  }
  window.removeEventListener('resize', _tourReposition);
  window.removeEventListener('keydown', _tourKey);
}

function _tourFinish() {
  _tourTeardown();
  _tourRestoreSidebar();
  try { localStorage.setItem(TOUR_SEEN_KEY, '1'); } catch {}
}

// Тур показывает переключатель домена и пункты меню — в свёрнутой панели не
// видно ни того, ни другого. Разворачиваем на время тура и возвращаем как было
// на выходе; localStorage при этом не трогаем — пользовательский выбор
// «панель свёрнута» остаётся в силе после тура.
let _tourSidebarWasCollapsed = false;

function _tourExpandSidebar() {
  const sb = document.getElementById('sidebar');
  _tourSidebarWasCollapsed = !!sb && sb.classList.contains('collapsed');
  if (_tourSidebarWasCollapsed) sb.classList.remove('collapsed');
}

function _tourRestoreSidebar() {
  if (!_tourSidebarWasCollapsed) return;
  document.getElementById('sidebar')?.classList.add('collapsed');
  _tourSidebarWasCollapsed = false;
}

function _tourNext() {
  if (_tourIdx < TOUR_STEPS.length - 1) { _tourIdx++; _tourRender(); }
  else _tourFinish();
}

function _tourPrev() {
  if (_tourIdx > 0) { _tourIdx--; _tourRender(); }
}

function _tourKey(e) {
  if (e.key === 'Escape')                            _tourFinish();
  else if (e.key === 'ArrowRight' || e.key === 'Enter') _tourNext();
  else if (e.key === 'ArrowLeft')                    _tourPrev();
}

// Шаги целятся в пункты меню, а пункт может лежать в свёрнутой группе или в
// рейле 52px, где пунктов не видно вовсе. В первом случае группу разворачиваем,
// во втором подсвечиваем заголовок группы — иначе прожектор встаёт на элемент
// нулевого размера и шаг выглядит как пустая рамка в углу экрана.
// Схлопнутый элемент не обязан иметь нулевой размер: .city-switch в рейле — это
// max-height:0 + opacity:0, и он остаётся высотой в 1px. Голая проверка
// «width>0 && height>0» такую цель пропускает, и прожектор встаёт пустой рамкой
// в углу. Порог 8px — заведомо меньше самого низкого реального шага (заголовок
// группы, 29px) и заведомо больше остатка схлопнутого блока.
function _tourVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height < 8) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
}

function _tourTarget(step) {
  const m = /\.nav-item\[data-page="([^"]+)"\]/.exec(step.sel);
  if (m && typeof revealNavGroup === 'function') revealNavGroup(m[1]);
  const el = document.querySelector(step.sel);
  if (!el) return null;
  if (_tourVisible(el)) return el;
  // Рейл по медиазапросу (окно < 700px) развернуть нельзя — там у пункта меню
  // остаётся заголовок его группы, он и становится целью шага.
  const fallback = el.closest?.('.nav-group')?.querySelector('.nav-group-toggle');
  return _tourVisible(fallback) ? fallback : null;
}

function _tourReposition() {
  if (!_tourEls) return;
  const target = _tourTarget(TOUR_STEPS[_tourIdx]);
  if (!target) { _tourFinish(); return; }
  const r = target.getBoundingClientRect();
  const pad = 6;
  const sp = _tourEls.spotlight;
  sp.style.top    = `${r.top - pad}px`;
  sp.style.left   = `${r.left - pad}px`;
  sp.style.width  = `${r.width + pad * 2}px`;
  sp.style.height = `${r.height + pad * 2}px`;
  // Card sits to the right of the sidebar target, vertically aligned, clamped to viewport.
  const card  = _tourEls.card;
  const gap   = 16;
  const cardW = card.offsetWidth  || 340;
  const cardH = card.offsetHeight || 180;
  let left = r.right + gap;
  if (left + cardW > window.innerWidth - 12) left = Math.max(12, r.left - cardW - gap);
  let top = r.top;
  if (top + cardH > window.innerHeight - 12) top = Math.max(12, window.innerHeight - cardH - 12);
  card.style.left = `${left}px`;
  card.style.top  = `${top}px`;
}

function _tourRender() {
  const step = TOUR_STEPS[_tourIdx];
  if (!_tourTarget(step)) { _tourNext(); return; }
  const last = _tourIdx === TOUR_STEPS.length - 1;
  _tourEls.card.innerHTML = `
    <div class="tour-step-label">${escHtml(t('tour.stepLabel', { i: _tourIdx + 1, n: TOUR_STEPS.length }))}</div>
    <div class="tour-card-title">${escHtml(t(step.title))}</div>
    <div class="tour-card-body">${escHtml(t(step.body))}</div>
    <div class="tour-actions">
      <button type="button" class="tour-btn tour-btn-ghost" data-act="skip">${t('tour.skip')}</button>
      <div class="tour-actions-right">
        <button type="button" class="tour-btn tour-btn-ghost" data-act="prev"${_tourIdx === 0 ? ' disabled' : ''}>${t('tour.back')}</button>
        <button type="button" class="tour-btn tour-btn-primary" data-act="next">${last ? t('tour.done') : t('tour.next')}</button>
      </div>
    </div>`;
  _tourReposition();
}

function startTour() {
  if (_tourEls) return;
  _tourIdx = 0;
  _tourExpandSidebar();
  const backdrop  = document.createElement('div'); backdrop.id  = 'tour-backdrop';
  const spotlight = document.createElement('div'); spotlight.id = 'tour-spotlight';
  const card      = document.createElement('div'); card.id      = 'tour-card';
  document.body.append(backdrop, spotlight, card);
  _tourEls = { backdrop, spotlight, card };
  backdrop.addEventListener('click', _tourNext);
  card.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'next')      _tourNext();
    else if (act === 'prev') _tourPrev();
    else if (act === 'skip') _tourFinish();
  });
  window.addEventListener('resize', _tourReposition);
  window.addEventListener('keydown', _tourKey);
  _tourRender();
}

document.getElementById('btn-tour')?.addEventListener('click', startTour);

// First-run auto-launch (once). Wait for the sidebar and initial load to settle.
window.addEventListener('load', () => {
  let seen = false;
  try { seen = localStorage.getItem(TOUR_SEEN_KEY) === '1'; } catch {}
  if (!seen && document.querySelector('.city-switch')) setTimeout(startTour, 900);
});
