'use strict';
// Библиотека → подраздел «Ритуалы» (doc/design/2026-09-24-library-rituals-spec.md §11).
// Источник истины — system/library/rituals/*.md (сервер парсит → GET /api/library/rituals).
// Полоса традиций + чипы уровней + поиск RU/EN — фильтрация на клиенте, без запросов;
// показ — плитками .lib-cards, как у дисциплин (2026-10-12, раньше был список <details>
// по группам уровней); клик по плитке открывает detail-модалку v20-sheet.js.
// Создание/правка через форму — library-authoring.js (kind «rituals»), удаление —
// мягкое, в «🗑️ Удалённые». Арт плиток — public/img/system/library/rituals/<slug>.png
// (hasArt из API, заливка — кнопка «Изображение» в detail-модалке).

const RIT_TRADITIONS = ['thaumaturgy', 'necromancy', 'assamite', 'koldun', 'osiris'];

let _ritualsCache = null;       // массив записей API
let _ritLoadFailed = false;
const _ritState = { tradition: 'thaumaturgy', level: 'all', q: '' };

async function ensureRituals(force) {
  if (_ritualsCache && !force) return _ritualsCache;
  const r = await fetch('/api/library/rituals');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  _ritualsCache = Array.isArray(data) ? data : [];
  if (typeof _v20LibraryCache !== 'undefined') delete _v20LibraryCache.ritual; // пикер листа V20 перечитает
  return _ritualsCache;
}
function _ritBySlug(slug) { return (_ritualsCache || []).find(r => r.slug === slug) || null; }

function _ritOfTradition(tr) { return (_ritualsCache || []).filter(r => r.tradition === tr); }

function _ritFiltered() {
  const q = _ritState.q.trim().toLowerCase();
  return _ritOfTradition(_ritState.tradition).filter(r =>
    (_ritState.level === 'all' || r.level === _ritState.level)
    && (!q || `${r.name} ${r.nameEn || ''}`.toLowerCase().includes(q)));
}

function _ritRenderTraditions() {
  const bar = document.getElementById('lib-rit-traditions');
  if (!bar) return;
  bar.innerHTML = RIT_TRADITIONS.map(tr => {
    const on = tr === _ritState.tradition;
    return `<button type="button" class="disciplines-subtab-btn${on ? ' active' : ''}" data-rit-tradition="${tr}" aria-pressed="${on}">${escHtml(t('lib.rit.tradition.' + tr))} <span class="rit-count">${_ritOfTradition(tr).length}</span></button>`;
  }).join('');
}

function _ritRenderLevels() {
  const box = document.getElementById('lib-rit-levels');
  if (!box) return;
  const levels = [...new Set(_ritOfTradition(_ritState.tradition).map(r => r.level).filter(Number.isInteger))].sort((a, b) => a - b);
  if (_ritState.level !== 'all' && !levels.includes(_ritState.level)) _ritState.level = 'all';
  const chip = (val, label) => {
    const on = _ritState.level === val;
    return `<button type="button" class="rit-level-chip${on ? ' active' : ''}" data-rit-level="${val}" aria-pressed="${on}">${escHtml(label)}</button>`;
  };
  box.innerHTML = chip('all', t('lib.rit.allLevels')) + levels.map(l => chip(l, t('lib.rit.levelChip', { n: l }))).join('');
}

function _ritTileHtml(r) {
  const art = r.hasArt
    ? `<img class="lib-card-art" loading="lazy" decoding="async" src="/img/system/library/rituals/${escAttr(r.slug)}.png" alt="">`
    : '';
  const custom = r.custom ? `<span class="lib-card-custom-badge">${t('v20.authorBadge')}</span>` : '';
  const inner = `<div class="lib-card-name">${escHtml(r.name)}</div>`
    + `<div class="lib-card-meta">${escHtml(t('lib.rit.levelShort', { n: r.level ?? '?' }))} · ${escHtml(t('lib.rit.tradition.' + r.tradition))}</div>${custom}`;
  return `<button type="button" class="lib-card${r.hasArt ? ' has-art' : ''}" data-rit-slug="${escAttr(r.slug)}" aria-label="${escAttr(r.name)}">
    ${art}${r.hasArt ? `<div class="lib-card-overlay">${inner}</div>` : inner}
  </button>`;
}

function _ritRenderList() {
  const body = document.getElementById('lib-rituals-body');
  if (!body) return;
  if (_ritLoadFailed) {
    body.innerHTML = `<div class="cdet-empty">${t('lib.rit.loadError')} <button type="button" class="mod-fill-add-btn" data-rit-retry>${t('lib.rit.retry')}</button></div>`;
    return;
  }
  if (!_ritOfTradition(_ritState.tradition).length) {
    body.innerHTML = `<div class="cdet-empty">${t('lib.rit.emptyTradition')}</div>`;
    return;
  }
  const list = _ritFiltered();
  if (!list.length) {
    body.innerHTML = `<div class="cdet-empty">${t('lib.rit.empty')} <button type="button" class="mod-fill-add-btn" data-rit-reset>${t('lib.rit.resetFilters')}</button></div>`;
    return;
  }
  body.innerHTML = `<div class="lib-cards">${list.map(_ritTileHtml).join('')}</div>`;
}

function _ritRenderAll() {
  _ritRenderTraditions();
  _ritRenderLevels();
  _ritRenderList();
}

async function loadRitualsLibrary(force) {
  const body = document.getElementById('lib-rituals-body');
  if (body && (!_ritualsCache || force)) body.innerHTML = `<div class="loading-state"><div class="spinner"></div>${t('v20.loading')}</div>`;
  try { await ensureRituals(force); _ritLoadFailed = false; }
  catch { _ritLoadFailed = true; }
  _ritRenderAll();
}

document.getElementById('tab-lib-rituals')?.addEventListener('click', e => {
  const tr = e.target.closest('[data-rit-tradition]');
  if (tr) { _ritState.tradition = tr.dataset.ritTradition; _ritState.level = 'all'; _ritRenderAll(); return; }
  const lv = e.target.closest('[data-rit-level]');
  if (lv) {
    const v = lv.dataset.ritLevel;
    _ritState.level = v === 'all' ? 'all' : parseInt(v, 10);
    _ritRenderLevels(); _ritRenderList();
    return;
  }
  if (e.target.closest('[data-rit-reset]')) {
    _ritState.level = 'all'; _ritState.q = '';
    const s = document.getElementById('lib-rit-search'); if (s) s.value = '';
    _ritRenderLevels(); _ritRenderList();
    return;
  }
  if (e.target.closest('[data-rit-retry]')) { loadRitualsLibrary(true); return; }
  // Плитка → detail-модалка (v20-sheet.js). Правка/удаление/арт — кнопками
  // модалки (generic K1), инлайн-кнопок в списке больше нет.
  const tile = e.target.closest('[data-rit-slug]');
  if (tile) { _v20OpenRitualModal(tile.dataset.ritSlug); return; }
});

document.getElementById('lib-rit-search')?.addEventListener('input', e => {
  _ritState.q = e.target.value;
  _ritRenderList();
});
