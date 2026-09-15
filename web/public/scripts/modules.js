// ═══════════════════════════════════════════════════════════════
// Chronicle detail modal (modules list + create/delete module)
// ═══════════════════════════════════════════════════════════════

let _chrDetailSlug    = null;
let _chrDetailDisplay = null;
let _modDeleteTarget  = null; // { chr, mod }
let _modDeleteSource  = 'chr-detail'; // 'chr-detail' | 'modules-page'
let _modSlugEdited    = false;
let _modCreateStandalone = false; // true — открыт не из хроники, нужен select
let _modCreateOpening = false;

function _getModCreateChr() {
  if (!_modCreateStandalone) return _chrDetailSlug;
  const el = document.getElementById('mod-create-chr');
  return el ? el.value.trim() : '';
}

let _chrSelectData = []; // cached chronicle list with hidden flag

async function _loadChrSelect() {
  const sel = document.getElementById('mod-create-chr');
  sel.innerHTML = `<option value="">${t('chr.selectChronicle')}</option>`;
  try {
    const qs     = window.location.search;
    const baseQs = qs ? qs + '&include_hidden=1' : '?include_hidden=1';
    _chrSelectData = await fetch(`/api/chronicles${baseQs}`).then(r => r.json());
    _chrSelectData.forEach(c => {
      const opt = document.createElement('option');
      opt.value       = c.slug;
      opt.textContent = (c.hidden ? '📂 ' : '') + (c.display || c.slug);
      sel.appendChild(opt);
    });
  } catch { _chrSelectData = []; }
}

function _updateTrackCheckbox(chrSlug) {
  const cb = document.getElementById('mod-create-track');
  if (!cb) return;
  const chr = _chrSelectData.find(c => c.slug === chrSlug);
  cb.checked = chr ? !chr.hidden : true;
}

function renderModuleCardInChr(m, chrSlug) {
  const files = [
    m.hasScenario ? `<span class="chd-mod-file">${t('mod.fileScenario')}</span>` : '',
    m.hasFinale   ? `<span class="chd-mod-file chd-file-finale" data-open-finale data-chr="${escHtml(chrSlug)}" data-mod="${escHtml(m.name)}">${t('mod.fileFinale')}</span>` : '',
    m.hasNpc      ? `<span class="chd-mod-file">${t('mod.fileNpcs')}</span>` : '',
  ].filter(Boolean).join('');
  return `
    <div class="chd-mod-card" data-chr="${escHtml(chrSlug)}" data-mod="${escHtml(m.name)}" role="button" tabindex="0">
      <div class="chd-mod-main">
        <div class="chd-mod-title">${escHtml(m.title)}</div>
        ${m.time ? `<div class="chd-mod-time">${escHtml(m.time)}</div>` : ''}
        <div class="chd-mod-meta">
          ${m.type ? `<span class="chd-mod-tag">${escHtml(m.type)}</span>` : ''}
          ${m.format ? `<span class="chd-mod-tag">${escHtml(m.format)}</span>` : ''}
        </div>
        ${files ? `<div class="chd-mod-files">${files}</div>` : ''}
        <div class="chd-mod-slug">${escHtml(m.name)}</div>
      </div>
      <button class="chd-mod-del-btn" data-chr="${escHtml(chrSlug)}" data-mod="${escHtml(m.name)}" title="${t('mod.delTitle')}">🗑</button>
    </div>`;
}

let _chrDetailTab = 'modules';

async function openChrDetail(slug, display, tab) {
  _chrDetailSlug    = slug;
  _chrDetailDisplay = display;
  _chrDetailTab     = tab || 'modules';

  const modal   = document.getElementById('chr-detail-modal');
  const title   = document.getElementById('chr-detail-title');
  const metaEl  = document.getElementById('chr-detail-meta');
  const body    = document.getElementById('chr-detail-body');
  const createBtn = document.getElementById('btn-create-module-in-chr');

  title.textContent   = display;
  metaEl.textContent  = '';
  body.innerHTML      = SPINNER;
  openModal('chr-detail-modal');

  // Sync tab buttons
  document.querySelectorAll('.chr-detail-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.chdTab === _chrDetailTab));
  createBtn.style.display = _chrDetailTab === 'modules' ? '' : 'none';

  // startDate from cache
  const cachedChr = (STATE.chronicles || []).find(c => c.slug === slug);
  if (cachedChr?.startDate) metaEl.textContent = t('chr.startDate', { date: cachedChr.startDate });

  const qs          = window.location.search;
  const periodWrap  = document.getElementById('chd-period-wrap');
  const periodInput = document.getElementById('chd-period-input');
  const periodList  = document.getElementById('chd-period-list');

  periodWrap.style.display = _chrDetailTab === 'events' ? '' : 'none';

  // Reset the recap + director panels on every (re)open / tab switch
  const recapPanel = document.getElementById('chd-recap-panel');
  if (recapPanel) { recapPanel.style.display = 'none'; recapPanel.innerHTML = ''; }
  const dirPanel = document.getElementById('chd-director-panel');
  if (dirPanel) { dirPanel.style.display = 'none'; dirPanel.innerHTML = ''; }

  if (_chrDetailTab === 'modules') {
    periodInput.value = '';
    try {
      const mods = await fetch(`/api/chronicles/${encodeURIComponent(slug)}/modules${qs}`).then(r => r.json());
      if (!mods.length) {
        body.innerHTML = `<div class="loading-state" style="height:100px">${t('chr.noModulesFirst')}</div>`;
        return;
      }
      body.innerHTML = `<div class="chd-mod-grid">${mods.map(m => renderModuleCardInChr(m, slug)).join('')}</div>`;
    } catch {
      body.innerHTML = `<div class="loading-state" style="color:var(--accent3)">${t('common.loadError')}</div>`;
    }
  } else if (_chrDetailTab === 'description') {
    try {
      const r = await fetch(`/api/chronicles/${encodeURIComponent(slug)}/fields${qs}`);
      if (!r.ok) throw new Error('not ok');
      const fields = await r.json();
      STATE._chrFields = STATE._chrFields || {};
      STATE._chrFields[slug] = fields;
      body.innerHTML = _chrDescPanelHtml(fields);
    } catch {
      body.innerHTML = `<div class="loading-state" style="color:var(--accent3)">${t('common.loadError')}</div>`;
    }
  } else {
    // Events tab — load once, cache on STATE
    try {
      await Promise.all([ensureCharsLoaded(), ensureLocsLoaded()]);
      const events = await fetch(`/api/chronicles/${encodeURIComponent(slug)}/events${qs}`).then(r => r.json());
      STATE._chrEvents = STATE._chrEvents || {};
      STATE._chrEvents[slug] = events;

      // Build datalist from event dates (unique year+month combos)
      _buildPeriodDatalist(events, periodList);

      _renderChrEvents(events, periodInput.value.trim());
    } catch {
      body.innerHTML = `<div class="loading-state" style="color:var(--accent3)">${t('chr.loadFailEvents')}</div>`;
    }
  }
}

// ── Вкладка «📝 Описание» — Настроение + свободный текст, читается/пишется из
// chronicle.md (writeChronicleFields, routes/chronicles.js). Тот же view/edit-паттерн
// (cdet-edit-btn/cdet-edit-bar/cdet-save-btn), что уже используют вкладки карточки
// персонажа и локации — переиспользуем готовые классы, не изобретаем свои.
function _chrDescViewInnerHtml(fields) {
  return `
    <div class="vtm-section"><div class="vtm-lbl">${t('chr.desc.mood')}</div><div class="vtm-body">${fields.mood ? escHtml(fields.mood) : '—'}</div></div>
    <div class="vtm-section" style="margin-top:16px"><div class="vtm-lbl">${t('chr.desc.descr')}</div><div class="vtm-body">${fields.description ? escHtml(fields.description).replace(/\n/g, '<br>') : '—'}</div></div>`;
}
function _chrDescPanelHtml(fields) {
  return `
    <div class="chr-desc-panel">
      <div class="cdet-info-header">
        <button class="cdet-edit-btn" id="chr-desc-edit-btn">${t('common.edit')}</button>
      </div>
      <div id="chr-desc-view">${_chrDescViewInnerHtml(fields)}</div>
      <div id="chr-desc-edit" style="display:none">
        <div class="chr-form-group">
          <label class="chr-form-label" for="chr-desc-mood-inp">${t('chr.desc.mood')}</label>
          <input class="chr-form-input" id="chr-desc-mood-inp" value="${escAttr(fields.mood || '')}" placeholder="${t('chr.desc.moodPh')}">
        </div>
        <div class="chr-form-group" style="margin-top:12px">
          <label class="chr-form-label" for="chr-desc-text-ta">${t('chr.desc.descr')}</label>
          <textarea class="cdet-edit-textarea" id="chr-desc-text-ta" rows="8" placeholder="${t('chr.desc.descrPh')}">${escHtml(fields.description || '')}</textarea>
        </div>
      </div>
      <div class="cdet-edit-bar" id="chr-desc-bar" style="display:none">
        <button class="cdet-save-btn" id="chr-desc-save-btn">${t('ui.btn.save')}</button>
        <button class="cdet-cancel-btn" id="chr-desc-cancel-btn">${t('ui.btn.cancel')}</button>
        <span class="cdet-save-msg" id="chr-desc-msg" style="display:none">${t('common.saved')}</span>
      </div>
    </div>`;
}
function _chrDescToggleEdit(enter) {
  const viewEl = document.getElementById('chr-desc-view');
  const editEl = document.getElementById('chr-desc-edit');
  const barEl  = document.getElementById('chr-desc-bar');
  const msgEl  = document.getElementById('chr-desc-msg');
  if (!viewEl || !editEl) return;
  viewEl.style.display = enter ? 'none' : '';
  editEl.style.display = enter ? '' : 'none';
  if (barEl) barEl.style.display = enter ? 'flex' : 'none';
  if (msgEl) msgEl.style.display = 'none';
}
async function _chrDescSave() {
  const slug = _chrDetailSlug;
  if (!slug) return;
  const mood        = document.getElementById('chr-desc-mood-inp')?.value ?? '';
  const description = document.getElementById('chr-desc-text-ta')?.value ?? '';
  const btn = document.getElementById('chr-desc-save-btn');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`/api/chronicles/${encodeURIComponent(slug)}/fields${window.location.search}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mood, description }),
    });
    const fields = await r.json();
    if (!r.ok) { showToast(fields.error || t('chr.desc.saveFail'), 'error'); return; }
    STATE._chrFields = STATE._chrFields || {};
    STATE._chrFields[slug] = fields;
    document.getElementById('chr-desc-view').innerHTML = _chrDescViewInnerHtml(fields);
    _chrDescToggleEdit(false);
    const msgEl = document.getElementById('chr-desc-msg');
    if (msgEl) { msgEl.style.display = ''; setTimeout(() => { msgEl.style.display = 'none'; }, 2000); }
  } catch (e) {
    showToast(t('chr.desc.saveFail') + ': ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Period datalist & filter ──────────────────────────────────────────────────

const RU_MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const RU_MONTHS_NOM = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const RU_MONTH_MAP  = {
  'янв':1,'фев':2,'мар':3,'апр':4,'май':5,'мая':5,'июн':6,'июл':7,'авг':8,'сен':9,'окт':10,'ноя':11,'дек':12
};

function _buildPeriodDatalist(events, datalist) {
  const seen = new Set();
  const opts = [];

  for (const ev of events) {
    const s = (ev.date || '').toLowerCase();
    const ym = s.match(/(\d{4})/);
    if (!ym) continue;
    const year = ym[1];
    let month = 0;
    for (const [stem, n] of Object.entries(RU_MONTH_MAP)) { if (s.includes(stem)) { month = n; break; } }
    if (!month) continue;
    const key = `${year}-${String(month).padStart(2,'0')}`;
    if (!seen.has(key)) {
      seen.add(key);
      opts.push({ key, label: `${RU_MONTHS_NOM[month-1].charAt(0).toUpperCase()}${RU_MONTHS_NOM[month-1].slice(1)} ${year}` });
    }
  }

  // Sort newest first
  opts.sort((a, b) => b.key.localeCompare(a.key));
  datalist.innerHTML = opts.map(o => `<option value="${o.label}">`).join('');
}

function _periodMatchesEvent(ev, period) {
  if (!period) return true;
  const p = period.toLowerCase().trim();
  const s = (ev.date || '').toLowerCase();
  // Match year
  const yearM = p.match(/\d{4}/);
  if (yearM && !s.includes(yearM[0])) return false;
  // Match month (first 3 chars)
  const monthStem = p.replace(/\d{4}/g, '').trim().slice(0, 3);
  if (monthStem.length >= 3) {
    const monthNum = RU_MONTH_MAP[monthStem] || 0;
    if (monthNum) {
      let found = false;
      for (const [stem, n] of Object.entries(RU_MONTH_MAP)) { if (n === monthNum && s.includes(stem)) { found = true; break; } }
      if (!found) return false;
    }
  }
  return true;
}

function _renderChrEvents(events, period) {
  const body = document.getElementById('chr-detail-body');
  const filtered = events.filter(ev => _periodMatchesEvent(ev, period));
  body.innerHTML = filtered.length
    ? `<div class="chd-events-wrap">${renderTimeline(filtered)}</div>`
    : `<div class="loading-state" style="height:80px">${t('chr.noEventsPeriod')}</div>`;
}

// Period input — filter on change (with 3-char autocomplete threshold)
document.getElementById('chd-period-input').addEventListener('input', e => {
  const val = e.target.value.trim();
  if (!_chrDetailSlug) return;
  const events = STATE._chrEvents?.[_chrDetailSlug] || [];
  // Apply filter immediately if value matches a full suggestion or ≥3 chars
  if (val.length === 0 || val.length >= 3) _renderChrEvents(events, val);
});

// Tab switching inside chronicle modal
document.querySelectorAll('.chr-detail-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    if (_chrDetailSlug) openChrDetail(_chrDetailSlug, _chrDetailDisplay, btn.dataset.chdTab);
  });
});

// Open detail on chronicle card click (but not on delete button)
document.addEventListener('click', e => {
  if (e.target.closest('.chr-delete-btn')) return;
  const card = e.target.closest('.chp-card');
  if (!card) return;
  const slug    = card.dataset.slug;
  const display = card.querySelector('.chp-card-name')?.textContent || slug;
  openChrDetail(slug, display, 'modules');
});

// Click on module card inside chronicle modal → open module detail
document.getElementById('chr-detail-body').addEventListener('click', e => {
  if (e.target.closest('#chr-desc-edit-btn'))   { _chrDescToggleEdit(true); return; }
  if (e.target.closest('#chr-desc-cancel-btn')) { _chrDescToggleEdit(false); return; }
  if (e.target.closest('#chr-desc-save-btn'))   { _chrDescSave(); return; }
  if (e.target.closest('.chd-mod-del-btn'))  return;
  if (e.target.closest('.chd-mod-fill-btn')) return;
  const finaleBadge = e.target.closest('[data-open-finale]');
  if (finaleBadge) { openFinalePreview(finaleBadge.dataset.chr, finaleBadge.dataset.mod); return; }
  // chip links (events tab)
  const chipMod = e.target.closest('.chip-mod');
  if (chipMod) {
    const chr = chipMod.dataset.chr || _chrDetailSlug || '';
    openModulePage(chr, chipMod.dataset.mod);
    return;
  }
  const chipChar = e.target.closest('.chip-char');
  if (chipChar) { /* open char detail if needed */ return; }
  const toggle = e.target.closest('.chron-toggle');
  if (toggle) {
    const id = toggle.dataset.id;
    const bodyEl = document.querySelector(`[data-body="${id}"]`);
    if (bodyEl) {
      bodyEl.hidden = !bodyEl.hidden;
      toggle.textContent = bodyEl.hidden ? `${t('chr.more')} ▾` : `${t('chr.collapse')} ▴`;
      if (!bodyEl.hidden) _loadEventFinale(bodyEl); // финал модуля — лениво, как на странице хроники
    }
    return;
  }
  const modCard = e.target.closest('.chd-mod-card');
  if (modCard) {
    const mod = modCard.dataset.mod;
    const chr = modCard.dataset.chr || _chrDetailSlug || '';
    if (mod) openModulePage(chr, mod);
  }
});

// Клавиатурный доступ для карточек модулей (role="button" tabindex="0") — Enter/Space
// дублируют клик; preventDefault на Space, чтобы не скроллить модалку (см. .v20-box в v20-sheet.js).
document.getElementById('chr-detail-body').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.closest('.chd-mod-del-btn'))  return;
  if (e.target.closest('.chd-mod-fill-btn')) return;
  const modCard = e.target.closest('.chd-mod-card');
  if (!modCard) return;
  e.preventDefault();
  const mod = modCard.dataset.mod;
  const chr = modCard.dataset.chr || _chrDetailSlug || '';
  if (mod) openModulePage(chr, mod);
});

// Close detail modal
document.getElementById('chr-detail-close').addEventListener('click', () => {
  closeModal('chr-detail-modal');
});
document.getElementById('chr-detail-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('chr-detail-modal'))
    closeModal('chr-detail-modal');
});

// ── "Ранее в хронике…" — AI recap of recent events ────────────────────────────
let _recapRunning = false;
document.getElementById('chd-recap-btn').addEventListener('click', () => {
  if (_chrDetailSlug) _generateChrRecap(_chrDetailSlug);
});

async function _generateChrRecap(slug) {
  if (_recapRunning) return;
  _recapRunning = true;
  const btn       = document.getElementById('chd-recap-btn');
  const panel     = document.getElementById('chd-recap-panel');
  const origLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = t('chr.recap.generating'); }
  if (panel) {
    panel.style.display = '';
    panel.innerHTML = `<div class="chd-recap-loading"><div class="spinner"></div>${t('chr.recap.loading')}</div>`;
  }
  try {
    const qs        = window.location.search;
    const featPrefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref      = _getPref(featPrefs, 'prose', 'openrouter');
    const preferSource = pref.provider;
    const orModel   = (preferSource === 'openrouter' || preferSource === 'lmstudio') ? (pref.model || null) : null;

    const resp = await fetch(`/api/chronicles/${encodeURIComponent(slug)}/recap${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 3, preferSource, orModel }),
    });
    const d = await resp.json().catch(() => ({}));

    if (resp.status === 429 || d.rateLimited) {
      panel.innerHTML = `<div class="chd-recap-err">${t('chr.recap.rateLimit')}</div>`;
      return;
    }
    if (!d.ok) {
      panel.innerHTML = `<div class="chd-recap-err">⚠ ${escHtml(d.error || t('chr.recap.fail'))}</div>`;
      return;
    }
    panel.innerHTML = `
      <div class="chd-recap-head">
        <span class="chd-recap-title">${t('chd.recap')}</span>
        <span class="chd-recap-meta">${t('chr.recap.meta', { n: d.eventsUsed, source: escHtml(d.source || '') })}</span>
        <button class="chd-recap-copy" id="chd-recap-copy">${t('chr.recap.copy')}</button>
        <button class="chd-recap-close" id="chd-recap-close" title="${t('ui.btn.close')}">✕</button>
      </div>
      <div class="chd-recap-text">${escHtml(d.recap).replace(/\n/g, '<br>')}</div>`;
    document.getElementById('chd-recap-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(d.recap).then(() => {
        const b = document.getElementById('chd-recap-copy');
        if (b) { b.textContent = t('chr.recap.copied'); setTimeout(() => { b.textContent = t('chr.recap.copy'); }, 1500); }
      }).catch(() => {});
    });
    document.getElementById('chd-recap-close').addEventListener('click', () => {
      panel.style.display = 'none'; panel.innerHTML = '';
    });
  } catch (e) {
    if (panel) panel.innerHTML = `<div class="chd-recap-err">⚠ ${escHtml(e.message)}</div>`;
  } finally {
    _recapRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = origLabel || t('chd.recap'); }
  }
}

// ── AI Director — propose next scene ─────────────────────────────────────────
let _directorRunning = false;
document.getElementById('chd-director-btn').addEventListener('click', () => {
  if (_chrDetailSlug) _runDirector(_chrDetailSlug);
});

async function _runDirector(slug) {
  if (_directorRunning) return;
  _directorRunning = true;
  const btn   = document.getElementById('chd-director-btn');
  const panel = document.getElementById('chd-director-panel');
  const orig  = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = t('chr.director.busy'); }
  if (panel) {
    panel.style.display = '';
    panel.innerHTML = `<div class="chd-recap-loading"><div class="spinner"></div>${t('chr.director.analyzing')}</div>`;
  }
  try {
    const qs   = window.location.search;
    const resp = await fetch(`/api/director/propose${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chronicle: slug }),
    });
    const d = await resp.json().catch(() => ({}));
    if (!resp.ok || !d.ok) {
      panel.innerHTML = `<div class="chd-recap-err">⚠ ${escHtml(d.error || t('chr.director.fail'))}</div>`;
      return;
    }
    panel.innerHTML = _renderDirectorPanel(d);
    panel.querySelector('.chd-dir-close')?.addEventListener('click', () => {
      panel.style.display = 'none'; panel.innerHTML = '';
    });
  } catch (e) {
    if (panel) panel.innerHTML = `<div class="chd-recap-err">⚠ ${escHtml(e.message)}</div>`;
  } finally {
    _directorRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = orig || t('chr.director.btn'); }
  }
}

function _renderDirectorPanel(d) {
  const tension = d.tension_now ?? 0;
  const forecast = d.tension_forecast ?? tension;
  const phase = d.phase || 'setup';
  const phaseLabel = { setup: t('chr.director.phase.setup'), conflict: t('chr.director.phase.conflict'), climax: t('chr.director.phase.climax') }[phase] || phase;

  // Tension bar color
  const barColor = tension <= 3 ? 'var(--c-info)' : tension <= 6 ? 'var(--gold)' : 'var(--crimson)';
  const barPct   = Math.round((tension / 10) * 100);

  // Scenes
  const scenesHtml = (d.suggested_scenes || []).map(s => `
    <div class="chd-dir-scene">
      <div class="chd-dir-scene-title">${escHtml(s.title || '')}</div>
      ${s.hook ? `<div class="chd-dir-scene-goal chd-dir-scene-hook">🔗 ${escHtml(s.hook)}</div>` : ''}
      ${s.goal ? `<div class="chd-dir-scene-goal">↳ ${escHtml(s.goal)}</div>` : ''}
      ${s.recommended_characters?.length ? `<div class="chd-dir-scene-chars">${t('chr.director.sceneChars', { names: s.recommended_characters.map(escHtml).join(', ') })}</div>` : ''}
      ${s.tension_after != null ? `<div class="chd-dir-scene-chars">${t('chr.director.tensionAfter', { v: s.tension_after })}</div>` : ''}
    </div>`).join('');

  // Warnings
  const warnsHtml = (d.warnings || []).length ? `
    <div class="chd-dir-section-label">${t('chr.director.warnings')}</div>
    <div class="chd-dir-warnings">
      ${d.warnings.map(w => `<div class="chd-dir-warning">⚠ ${escHtml(w)}</div>`).join('')}
    </div>` : '';

  // World flags
  const flagsHtml = (d.world_flags || []).length ? `
    <div class="chd-dir-section-label">${t('chr.director.worldFlags')}</div>
    <div class="chd-dir-flags">${d.world_flags.slice(0, 5).map(f =>
      `<span class="chd-dir-flag">${escHtml(f)}</span>`
    ).join('')}</div>` : '';

  return `
    <div class="chd-dir-head">
      <span class="chd-dir-title">${t('chr.director.aiTitle')}</span>
      <span class="chd-dir-meta">${escHtml(d.phase_goal || '')}</span>
      <button class="chd-dir-close" title="${t('ui.btn.close')}">✕</button>
    </div>

    <div class="chd-dir-phase-row">
      <span class="chd-dir-phase chd-dir-phase--${escHtml(phase)}">${escHtml(phaseLabel)}</span>
      <span class="chd-dir-phase-goal">${escHtml(d.phase_goal || '')}</span>
    </div>

    <div class="chd-dir-tension-wrap">
      <span class="chd-dir-tension-label">${t('chr.director.tension')}</span>
      <div class="chd-dir-tension-bar">
        <div class="chd-dir-tension-fill" style="transform:scaleX(${barPct / 100});background:${barColor}"></div>
      </div>
      <span class="chd-dir-tension-val">${tension}→${forecast}</span>
    </div>

    <div class="chd-dir-section-label">${t('chr.director.sceneSuggestions')}</div>
    <div class="chd-dir-scenes">${scenesHtml || `<div class="chd-recap-err">${t('chr.director.noEvents')}</div>`}</div>

    ${flagsHtml}
    ${warnsHtml}

    <div class="chd-dir-disclaimer">${t('chr.director.disclaimer')}</div>`;
}

// ── Create module ─────────────────────────────────────────────────────────────

// ── Shared chip helper for both create and fill modals ───────────────────────

let _createPCs  = [];
let _createNPCs = [];

function _addChip(name, arr, containerId) {
  if (!name || arr.includes(name)) return;
  arr.push(name);
  const wrap = document.getElementById(containerId);
  const chip = document.createElement('span');
  chip.className = 'mod-fill-chip';
  chip.textContent = name;
  const rm = document.createElement('button');
  rm.textContent = '×'; rm.className = 'mod-fill-chip-rm';
  rm.addEventListener('click', () => { arr.splice(arr.indexOf(name), 1); chip.remove(); });
  chip.appendChild(rm);
  wrap.appendChild(chip);
}

// «Принадлежность: Персонаж игрока» (см. system/schema/card_schema.md) — либо
// устар. поле «Роль» с тем же смыслом.
function _isPcCharacter(c) {
  return /персонаж игрока/i.test(c.belonging || '') || /персонаж игрока|пк/i.test(c.role || '');
}

async function _populateCharDatalist(pcListId, npcListId) {
  await ensureCharsLoaded();
  const chars = STATE.characters || [];
  const pcs   = chars.filter(_isPcCharacter);
  document.getElementById(pcListId).innerHTML  = pcs.map(c   => `<option value="${escHtml(c.name)}">`).join('');
  document.getElementById(npcListId).innerHTML = chars.map(c => `<option value="${escHtml(c.name)}">`).join('');
}

// ── New module modal ──────────────────────────────────────────────────────────

document.getElementById('btn-create-module-in-chr').addEventListener('click', () => {
  openModCreateModal(false);
});

document.getElementById('btn-create-module-standalone').addEventListener('click', () => {
  openModCreateModal(true);
});

async function openModCreateModal(standalone) {
  if (_modCreateOpening) return;
  _modCreateOpening = true;
  try {
    _modCreateStandalone = standalone;
    _createPCs  = []; _createNPCs = [];
    ['mod-create-name','mod-create-time','mod-create-slug','mod-create-content','mod-create-tone','mod-create-format'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('mod-create-type').value = 'Игровая сессия';
    document.getElementById('mod-create-pcs').innerHTML  = '';
    document.getElementById('mod-create-npcs').innerHTML = '';
    document.getElementById('mod-create-error').style.display = 'none';
    _modSlugEdited = false;

    const trackCb = document.getElementById('mod-create-track');
    if (trackCb) trackCb.checked = true; // default — сбрасывается при выборе хроники

    const chrRow = document.getElementById('mod-create-chr-row');
    if (standalone) {
      chrRow.style.display = '';
      await _loadChrSelect();
    } else {
      chrRow.style.display = 'none';
    }

    openModal('mod-create-modal', '#mod-create-name');
    _populateCharDatalist('mod-create-pc-list', 'mod-create-npc-list');
  } finally {
    _modCreateOpening = false;
  }
}

document.getElementById('mod-create-name').addEventListener('input', e => {
  if (!_modSlugEdited) document.getElementById('mod-create-slug').value = slugifyChr(e.target.value);
});
document.getElementById('mod-create-slug').addEventListener('input', () => { _modSlugEdited = true; });
document.getElementById('mod-create-chr').addEventListener('change', e => { _updateTrackCheckbox(e.target.value); });

document.getElementById('mod-create-add-pc').addEventListener('click', () => {
  const v = document.getElementById('mod-create-pc-input').value.trim();
  _addChip(v, _createPCs, 'mod-create-pcs');
  document.getElementById('mod-create-pc-input').value = '';
});
document.getElementById('mod-create-add-npc').addEventListener('click', () => {
  const v = document.getElementById('mod-create-npc-input').value.trim();
  _addChip(v, _createNPCs, 'mod-create-npcs');
  document.getElementById('mod-create-npc-input').value = '';
});
document.getElementById('mod-create-pc-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('mod-create-add-pc').click(); }
});
document.getElementById('mod-create-npc-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('mod-create-add-npc').click(); }
});

document.getElementById('mod-create-cancel').addEventListener('click', () => {
  closeModal('mod-create-modal');
});
document.getElementById('mod-create-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('mod-create-modal'))
    closeModal('mod-create-modal');
});

document.getElementById('mod-create-submit').addEventListener('click', async () => {
  const name    = document.getElementById('mod-create-name').value.trim();
  const time    = document.getElementById('mod-create-time').value.trim();
  const slug    = document.getElementById('mod-create-slug').value.trim() || slugifyChr(name);
  const type    = document.getElementById('mod-create-type').value.trim();
  const tone    = document.getElementById('mod-create-tone').value.trim();
  const format  = document.getElementById('mod-create-format').value.trim();
  const content = document.getElementById('mod-create-content').value.trim();
  const errEl   = document.getElementById('mod-create-error');
  const btn     = document.getElementById('mod-create-submit');

  if (!name) { errEl.textContent = t('mod.create.errName'); errEl.style.display = ''; return; }
  if (!time) { errEl.textContent = t('mod.create.errTime'); errEl.style.display = ''; return; }
  if (!/\b(?:19|20)\d{2}\b/.test(time) &&
      !await showConfirm(t('mod.create.confirmNoYear'), { confirmText: t('ui.btn.create') })) return;
  errEl.style.display = 'none';

  const chr = _getModCreateChr();
  if (!chr) { errEl.textContent = t('mod.create.errChr'); errEl.style.display = ''; return; }

  btn.disabled = true;
  btn.textContent = t('common.creating');

  try {
    const qs = window.location.search;
    const d  = await fetch(`/api/chronicles/${encodeURIComponent(chr)}/modules${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, time, slug, type, tone, format, pcs: _createPCs, npcs: _createNPCs, content,
          trackInChronology: document.getElementById('mod-create-track')?.checked !== false }) }
    ).then(r => r.json());

    if (!d.ok) { errEl.textContent = d.error || t('archive.error'); errEl.style.display = ''; return; }

    closeModal('mod-create-modal');
    if (_modCreateStandalone) {
      loadModules();
    } else {
      openChrDetail(_chrDetailSlug, _chrDetailDisplay, 'modules');
    }
  } catch (e) {
    errEl.textContent = t('ui.err') + e.message; errEl.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = t('ui.btn.create');
  }
});

// ── Generate scenario modal (for existing modules) ────────────────────────────

let _fillModTarget   = null; // { chr, mod }
let _fillPCs         = [];
let _fillNPCs        = [];
let _fillFromModPage = false;

async function openFillModal(chr, mod, title, fromModPage = false) {
  _fillFromModPage = fromModPage;
  _fillModTarget = { chr, mod };
  _fillPCs  = []; _fillNPCs = [];
  document.getElementById('mod-fill-pcs').innerHTML   = '';
  document.getElementById('mod-fill-npcs').innerHTML  = '';
  document.getElementById('mod-fill-pc-input').value  = '';
  document.getElementById('mod-fill-npc-input').value = '';
  document.getElementById('mod-fill-content').value   = '';
  document.getElementById('mod-fill-error').style.display = 'none';
  document.getElementById('mod-fill-title').textContent = t('mod.fill.title', { title });
  openModal('mod-fill-modal');
  _populateCharDatalist('mod-fill-pc-list', 'mod-fill-npc-list');
}

document.getElementById('mod-fill-add-pc').addEventListener('click', () => {
  const v = document.getElementById('mod-fill-pc-input').value.trim();
  _addChip(v, _fillPCs, 'mod-fill-pcs');
  document.getElementById('mod-fill-pc-input').value = '';
});
document.getElementById('mod-fill-add-npc').addEventListener('click', () => {
  const v = document.getElementById('mod-fill-npc-input').value.trim();
  _addChip(v, _fillNPCs, 'mod-fill-npcs');
  document.getElementById('mod-fill-npc-input').value = '';
});
document.getElementById('mod-fill-pc-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('mod-fill-add-pc').click(); }
});
document.getElementById('mod-fill-npc-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('mod-fill-add-npc').click(); }
});

document.getElementById('mod-fill-cancel').addEventListener('click', () => {
  closeModal('mod-fill-modal');
  _fillModTarget = null;
});
document.getElementById('mod-fill-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('mod-fill-modal')) {
    closeModal('mod-fill-modal');
    _fillModTarget = null;
  }
});

document.getElementById('mod-fill-generate').addEventListener('click', async () => {
  if (!_fillModTarget) return;
  const content = document.getElementById('mod-fill-content').value.trim();
  const errEl   = document.getElementById('mod-fill-error');
  const btn     = document.getElementById('mod-fill-generate');
  if (!content) { errEl.textContent = t('mod.fill.errContent'); errEl.style.display = ''; return; }
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = t('mod.fill.busy');

  try {
    const qs      = window.location.search;
    const prefs   = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const locPref = _getPref(prefs, 'locations', 'openrouter');
    const d  = await fetch(
      `/api/chronicles/${encodeURIComponent(_fillModTarget.chr)}/modules/${encodeURIComponent(_fillModTarget.mod)}/fill${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pcs: _fillPCs, npcs: _fillNPCs, content, locSource: locPref.provider, locModel: locPref.model }) }
    ).then(r => r.json());

    if (!d.ok) { errEl.textContent = d.error || t('mod.fill.errGen'); errEl.style.display = ''; return; }

    closeModal('mod-fill-modal');
    const fromMod = _fillFromModPage;
    _fillModTarget   = null;
    _fillFromModPage = false;
    if (fromMod) { loadModulePage(); }
    else if (_chrDetailSlug) { openChrDetail(_chrDetailSlug, _chrDetailDisplay, 'modules'); }

    const locMsg = d.locations?.length
      ? `\n${t('mod.fill.locationsCreated', { n: d.locations.length, names: d.locations.join(', ') })}`
      : '';
    showToast(t('mod.fill.done', { file: d.file, locMsg }), 'success');
  } catch (e) {
    errEl.textContent = t('ui.err') + e.message; errEl.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = t('mod.fill.btn');
  }
});

// ── Delete module ─────────────────────────────────────────────────────────────

document.addEventListener('click', e => {
  const delBtn = e.target.closest('.chd-mod-del-btn') || e.target.closest('.module-del-btn');
  if (!delBtn) return;
  _modDeleteSource  = e.target.closest('.module-del-btn') ? 'modules-page' : 'chr-detail';
  _modDeleteTarget  = { chr: delBtn.dataset.chr, mod: delBtn.dataset.mod };
  const body    = document.getElementById('mod-delete-body');
  const confirm = document.getElementById('mod-delete-confirm');
  confirm.disabled = false;
  body.innerHTML = `
    <div class="chr-modal-warn">${t('mod.delete.warn', { mod: escHtml(_modDeleteTarget.mod) })}</div>
    <div class="chr-modal-section"><b>${t('mod.delete.willDelete')}</b>
      <ul>
        <li>${t('mod.delete.itemFiles')}</li>
        <li>${t('mod.delete.itemEpisodic')}</li>
        <li>${t('mod.delete.itemEvents')}</li>
        <li>${t('mod.delete.itemDiaries')}</li>
      </ul>
      ${t('mod.delete.canonSafe')}
    </div>`;
  openModal('mod-delete-modal');
});

document.getElementById('mod-delete-cancel').addEventListener('click', () => {
  closeModal('mod-delete-modal');
  _modDeleteTarget = null;
});
document.getElementById('mod-delete-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('mod-delete-modal')) {
    closeModal('mod-delete-modal');
    _modDeleteTarget = null;
  }
});

document.getElementById('mod-delete-confirm').addEventListener('click', async () => {
  if (!_modDeleteTarget) return;
  const { chr, mod } = _modDeleteTarget;
  const confirm = document.getElementById('mod-delete-confirm');
  const body    = document.getElementById('mod-delete-body');
  confirm.disabled = true; confirm.textContent = t('common.deleting');

  try {
    const qs = window.location.search;
    const d  = await fetch(`/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}${qs}`,
      { method: 'DELETE' }).then(r => r.json());

    if (!d.ok) throw new Error(d.error || t('archive.error'));
    const cleaned = d.cleanedChars?.length ? t('mod.delete.cleanedDiaries', { n: d.cleanedChars.length }) : '';
    body.innerHTML = `<div style="color:var(--accent1)">${t('mod.delete.done', { name: escHtml(mod), cleaned })}</div>`;
    setTimeout(() => {
      closeModal('mod-delete-modal');
      _modDeleteTarget = null;
      confirm.textContent = t('ui.btn.delete');
      if (_modDeleteSource === 'modules-page') {
        loadModules();
      } else {
        openChrDetail(chr, _chrDetailDisplay, 'modules');
      }
    }, 1500);
  } catch (err) {
    body.innerHTML = `<div style="color:var(--accent2)">${t('ui.err')}${escHtml(err.message)}</div>`;
    confirm.disabled = false; confirm.textContent = t('ui.btn.delete');
  }
});

// ── Create chronicle modal ────────────────────────────────────────────────────

const slugifyChr = slugifyJS;  // alias — one browser slug impl (see slugifyJS / _NTR)

let _slugEdited = false;

document.getElementById('btn-create-chronicle').addEventListener('click', () => {
  document.getElementById('chr-create-name').value  = '';
  document.getElementById('chr-create-slug').value  = '';
  document.getElementById('chr-create-mood').value  = '';
  document.getElementById('chr-create-error').style.display = 'none';
  _slugEdited = false;
  openModal('chr-create-modal', '#chr-create-name');
});

document.getElementById('chr-create-name').addEventListener('input', e => {
  if (!_slugEdited) document.getElementById('chr-create-slug').value = slugifyChr(e.target.value);
});
document.getElementById('chr-create-slug').addEventListener('input', () => { _slugEdited = true; });

document.getElementById('chr-create-cancel').addEventListener('click', () => {
  closeModal('chr-create-modal');
});
document.getElementById('chr-create-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('chr-create-modal'))
    closeModal('chr-create-modal');
});

document.getElementById('chr-create-submit').addEventListener('click', async () => {
  const name  = document.getElementById('chr-create-name').value.trim();
  const slug  = document.getElementById('chr-create-slug').value.trim() || slugifyChr(name);
  const mood  = document.getElementById('chr-create-mood').value.trim();
  const errEl = document.getElementById('chr-create-error');
  const btn   = document.getElementById('chr-create-submit');

  if (!name) { errEl.textContent = t('chr.create.errName'); errEl.style.display = ''; return; }
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = t('common.creating');

  try {
    const qs = window.location.search;
    const d  = await fetch(`/api/chronicles${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug, mood }) }).then(r => r.json());

    if (!d.ok) { errEl.textContent = d.error || t('archive.error'); errEl.style.display = ''; return; }

    closeModal('chr-create-modal');
    loadChroniclesPage();
  } catch (e) {
    errEl.textContent = t('chr.create.errConn', { msg: e.message }); errEl.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = t('ui.btn.create');
  }
});

// Enter submits form
document.getElementById('chr-create-modal').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('chr-create-submit').click();
});

// ── Delete modal logic ────────────────────────────────────────────────────────

let _chrDeleteSlug = null;

document.addEventListener('click', async e => {
  const delBtn = e.target.closest('.chr-delete-btn');
  if (!delBtn) return;

  const slug    = delBtn.dataset.slug;
  const modal   = document.getElementById('chr-delete-modal');
  const body    = document.getElementById('chr-delete-body');
  const confirm = document.getElementById('chr-delete-confirm');
  _chrDeleteSlug = slug;
  confirm.disabled = true;
  openModal('chr-delete-modal');
  body.innerHTML = `<div class="loading-state" style="height:80px"><div class="spinner"></div>${t('chr.delete.analyzing')}</div>`;

  try {
    const qs = window.location.search;
    const d  = await fetch(`/api/chronicles/${encodeURIComponent(slug)}/delete-preview${qs}`).then(r => r.json());
    if (d.error) throw new Error(d.error);

    const tempHtml = d.tempChars.length
      ? `<div class="chr-modal-section">
          <b>${t('chr.delete.tempNpcs')}:</b>
          <ul>${d.tempChars.map(c => `<li>${escHtml(c.name)} <span class="chr-modal-dim">(${escHtml(c.lineageFolder)}/${escHtml(c.slug)})</span></li>`).join('')}</ul>
         </div>`
      : `<div class="chr-modal-section chr-modal-dim">${t('chr.delete.tempNpcsNone')}</div>`;

    body.innerHTML = `
      <div class="chr-modal-warn">${t('chr.delete.warn', { slug: escHtml(slug) })}</div>
      <div class="chr-modal-section"><b>${t('chr.delete.filesLabel')}:</b> ${d.filesToDelete.length}</div>
      ${tempHtml}
      <div class="chr-modal-section">${t('chr.delete.charsSafe')}</div>`;
    confirm.disabled = false;
  } catch (err) {
    body.innerHTML = `<div style="color:var(--accent2)">${t('ui.err')}${escHtml(err.message)}</div>`;
  }
});

document.getElementById('chr-delete-cancel').addEventListener('click', () => {
  closeModal('chr-delete-modal');
  _chrDeleteSlug = null;
});
document.getElementById('chr-delete-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('chr-delete-modal')) {
    closeModal('chr-delete-modal');
    _chrDeleteSlug = null;
  }
});

document.getElementById('chr-delete-confirm').addEventListener('click', async () => {
  if (!_chrDeleteSlug) return;
  const slug    = _chrDeleteSlug;
  const confirm = document.getElementById('chr-delete-confirm');
  const body    = document.getElementById('chr-delete-body');
  confirm.disabled = true;
  confirm.textContent = t('common.deleting');
  try {
    const qs = window.location.search;
    const d  = await fetch(`/api/chronicles/${encodeURIComponent(slug)}${qs}`,
      { method: 'DELETE' }).then(r => r.json());
    if (!d.ok) throw new Error(d.error || t('chr.delete.errDelete'));

    const movedMsg = d.moved?.length
      ? t('chr.delete.movedNpcs', { names: d.moved.map(m => escHtml(m.name)).join(', ') })
      : '';
    body.innerHTML = `<div style="color:var(--accent1)">${t('chr.delete.done', { slug: escHtml(slug), moved: movedMsg })}</div>`;
    setTimeout(() => {
      closeModal('chr-delete-modal');
      _chrDeleteSlug = null;
      confirm.textContent = t('ui.btn.delete');
      loadChroniclesPage();
    }, 1800);
  } catch (err) {
    body.innerHTML = `<div style="color:var(--accent2)">${t('ui.err')}${escHtml(err.message)}</div>`;
    confirm.disabled = false;
    confirm.textContent = t('ui.btn.delete');
  }
});

function _modulesWord(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return t('mod.wordOne');
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return t('mod.wordFew');
  return t('mod.wordMany');
}

async function loadModules() {
  const el = document.getElementById('modules-list');
  el.innerHTML = '<div class="loading-state"><div class="spinner"></div>' + t('ui.loading') + '</div>';
  try {
    const mods = await fetch(`/api/modules${window.location.search}`).then(r => r.json());
    document.getElementById('modules-sub').textContent =
      mods.length ? t('mod.subCount', { count: mods.length, word: _modulesWord(mods.length) }) : t('mod.subChronicle');
    if (!mods.length) {
      el.innerHTML = `<div class="loading-state" style="height:120px">${t('mod.noModules')}</div>`;
      return;
    }
    el.innerHTML = mods.map(m => {
      const files = [
        m.hasScenario ? `<span class="module-file">${t('mod.fileScenario')}</span>` : '',
        m.hasFinale   ? `<span class="module-file file-finale" data-open-finale data-chr="${escHtml(m.chronicle || '')}" data-mod="${escHtml(m.name)}">${t('mod.fileFinale')}</span>` : '',
        m.hasNpc      ? `<span class="module-file">${t('mod.fileNpcs')}</span>` : '',
      ].filter(Boolean).join('');
      return `
      <div class="module-card" data-name="${escHtml(m.name)}" data-chronicle="${escHtml(m.chronicle || '')}">
        <div class="module-title">${escHtml(m.title)}</div>
        ${m.time ? `<div class="module-time">${escHtml(m.time)}</div>` : ''}
        <div class="module-meta">
          ${m.tone   ? `<span class="module-tag">${escHtml(m.tone)}</span>`   : ''}
          ${m.format ? `<span class="module-tag">${escHtml(m.format)}</span>` : ''}
          ${m.type   ? `<span class="module-tag mod-type">${escHtml(m.type)}</span>` : ''}
        </div>
        ${files ? `<div class="module-files">${files}</div>` : ''}
        <div class="module-slug">${escHtml(m.name)}</div>
        <button class="module-del-btn" data-chr="${escHtml(m.chronicle || '')}" data-mod="${escHtml(m.name)}" title="${t('mod.delTitle')}">🗑</button>
      </div>`;
    }).join('');
  } catch {
    el.innerHTML = `<div class="loading-state" style="color:var(--accent3)">${t('common.loadError')}</div>`;
  }
}

// ── Module card click → open detail page ────────────────────────────────────

document.getElementById('modules-list').addEventListener('click', e => {
  if (e.target.closest('.module-del-btn')) return;
  const finaleBadge = e.target.closest('[data-open-finale]');
  if (finaleBadge) { openFinalePreview(finaleBadge.dataset.chr, finaleBadge.dataset.mod); return; }
  const card = e.target.closest('.module-card');
  if (!card) return;
  const name      = card.dataset.name;
  const chronicle = card.dataset.chronicle;
  if (!name || !chronicle) return;
  openModulePage(chronicle, name);
});

// «📜 Финал» в связанных файлах модуля → лёгкая модалка с текстом finale.md,
// без перехода на страницу модуля (тот же /detail, что и вкладка «Финал» там).
async function openFinalePreview(chr, mod) {
  if (!chr || !mod) return;
  const modal = document.getElementById('finale-preview-modal');
  const body  = document.getElementById('finale-preview-body');
  const title = document.getElementById('finale-preview-title');
  const tlBtn = document.getElementById('finale-preview-to-timeline');
  title.textContent = t('mod.finaleTitle');
  tlBtn.style.display = 'none';
  body.innerHTML = `<div class="loading-state"><div class="spinner"></div>${t('ui.loading')}</div>`;
  openModal('finale-preview-modal');
  try {
    const data = await fetch(
      `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/detail${window.location.search}`
    ).then(r => r.json());
    title.textContent = `${t('mod.finaleTitle')} — ${data.title || mod}`;
    body.innerHTML = data.finale
      ? mdToHtmlPlain(data.finale)
      : `<div class="cdet-empty">${t('mod.finaleNone')}</div>`;
    if (data.finale) {
      tlBtn.style.display = '';
      tlBtn.dataset.chr = chr; tlBtn.dataset.mod = mod;
      tlBtn.dataset.title = data.title || mod;
    }
  } catch {
    body.innerHTML = `<div class="cdet-empty">${t('mod.finaleLoadFail')}</div>`;
  }
}
// ── «📕 Книга» — компиляция хроники в самодостаточный HTML-документ ──────────
// Сборка на клиенте (серверного MD-рендерера нет): book-data + events →
// новая вкладка с инлайн-CSS (тёмная тема + светлая печать). Ссылки на .md
// в отдельном документе мертвы — упрощаются до текста.
function _bookMd(md) {
  return mdToHtmlBlock((md || '').replace(/\[([^\]]+)\]\([^)]*\.md[^)]*\)/g, '$1'));
}

async function _chrBuildBook() {
  if (!_chrDetailSlug) return;
  const qs = window.location.search;
  let data, events;
  try {
    [data, events] = await Promise.all([
      fetch(`/api/chronicles/${encodeURIComponent(_chrDetailSlug)}/book-data${qs}`).then(r => r.json()),
      fetch(`/api/chronicles/${encodeURIComponent(_chrDetailSlug)}/events${qs}`).then(r => r.json()),
    ]);
  } catch { showToast(t('chr.book.fail'), 'error'); return; }
  if (data.error) { showToast(data.error, 'error'); return; }

  const eventsHtml = (Array.isArray(events) ? events : []).map(ev => `
    <article class="book-event">
      <h3>📅 ${escHtml(ev.date || '')}${ev.title ? ` — ${escHtml(ev.title)}` : ''}</h3>
      ${ev.location?.text ? `<p class="book-loc">📍 ${escHtml(ev.location.text)}</p>` : ''}
      ${ev.eventsText ? _bookMd(ev.eventsText) : ''}
      ${ev.consequences?.length ? `<h4>${t('chr.book.consequences')}</h4><ul>${ev.consequences.map(c => `<li>${escHtml(c)}</li>`).join('')}</ul>` : ''}
    </article>`).join('');

  const finalesHtml = (data.modules || []).filter(m => m.finale && m.finale.trim()).map(m => `
    <section class="book-section">
      <h2>📜 ${escHtml(m.title)}</h2>
      ${_bookMd(m.finale)}
    </section>`).join('');

  const html = `<!DOCTYPE html><html lang="${t('chr.book.lang')}"><head><meta charset="utf-8">
<title>${escHtml(data.display)}</title>
<style>
  body { background: #0d0a12; color: #d8d2c8; font: 16px/1.65 Georgia, 'Times New Roman', serif;
         max-width: 72ch; margin: 0 auto; padding: 48px 24px; }
  h1, h2, h3, h4 { font-family: Georgia, serif; color: #e8e2d8; line-height: 1.25; }
  h1 { font-size: 2rem; } h2 { font-size: 1.5rem; margin-top: 2.2em; } h3 { font-size: 1.15rem; margin-top: 1.6em; }
  .book-title { text-align: center; margin-bottom: 3em; }
  .book-title .sub { color: #8a8378; }
  .book-section, .book-event { margin-bottom: 1.6em; }
  .book-loc { color: #8a8378; margin-top: -0.4em; }
  blockquote { border-left: 2px solid #5a4a4a; margin-left: 0; padding-left: 1em; color: #b0a898; }
  hr { border: none; border-top: 1px solid #3a3340; margin: 2em 0; }
  a { color: inherit; text-decoration: none; pointer-events: none; }
  @media print {
    body { background: #fff; color: #1a1a1a; padding: 0; }
    h1, h2, h3, h4 { color: #000; }
    .book-section, .book-event { break-inside: avoid; }
    h2 { break-before: page; }
    .book-title h2 { break-before: auto; }
  }
</style></head><body>
  <div class="book-title">
    <h1>${escHtml(data.display)}</h1>
    <p class="sub">Sanguine System · ${t('chr.book.assembled')} ${escHtml(new Date().toLocaleDateString(t('chr.book.lang')))}</p>
  </div>
  ${data.chronicleMd ? `<section class="book-section">${_bookMd(data.chronicleMd)}</section>` : ''}
  ${eventsHtml ? `<section class="book-section"><h2>${t('chr.book.events')}</h2>${eventsHtml}</section>` : ''}
  ${finalesHtml ? `<h2>${t('chr.book.finales')}</h2>${finalesHtml}` : ''}
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { showToast(t('chr.book.windowBlocked'), 'error'); return; }
  win.document.write(html);
  win.document.close();
}
document.getElementById('chd-book').addEventListener('click', _chrBuildBook);

// «🕰️ В хронологию» в шапке модалки хроники — итог всей хроники одной строкой.
document.getElementById('chd-to-timeline').addEventListener('click', () => {
  if (!_chrDetailSlug) return;
  openTimelineAddModal({
    title: _chrDetailDisplay || _chrDetailSlug,
    linkText: _chrDetailDisplay || _chrDetailSlug,
    linkHref: `../chronicles/${_chrDetailSlug}/chronicle.md`,
  });
});
document.getElementById('finale-preview-to-timeline').addEventListener('click', e => {
  const { chr, mod, title } = e.currentTarget.dataset;
  closeModal('finale-preview-modal');
  openTimelineAddModal({ title, linkText: title, linkHref: `../chronicles/${chr}/modules/${mod}/${mod}.md` });
});
document.getElementById('finale-preview-close').addEventListener('click', () => {
  closeModal('finale-preview-modal');
});
document.getElementById('finale-preview-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('finale-preview-modal'))
    closeModal('finale-preview-modal');
});

// ── Module Detail Page ───────────────────────────────────────────────────────

STATE.currentModule = null;

// Намерение «после загрузки страницы модуля — переключиться на вкладку и
// префилльнуть форму» (тикет 3.7), по аналогии с _pendingThreadFocus в
// archive.js. Устанавливается session-screen.js перед openModulePage() (кнопка
// «→ Записать сессию»), применяется и обнуляется в loadModulePage() сразу
// после renderModulePage() — та синхронно рендерит все панели модуля, включая
// форму сессий (#modp-panel-sessions), так что DOM уже готов к этому моменту.
let _pendingModulePrefill = null;

function openModulePage(chronicle, name) {
  STATE.currentModule = { chronicle, name };
  closeModal('chr-detail-modal');
  navigate('module');
}

async function loadModulePage() {
  if (!STATE.currentModule) { navigate('modules'); return; }
  const { chronicle, name } = STATE.currentModule;
  const qs = window.location.search;

  // Reset tab to info
  document.querySelectorAll('.modp-tab').forEach(b => b.classList.toggle('active', b.dataset.modtab === 'info'));
  document.querySelectorAll('.modp-panel').forEach(p => p.classList.toggle('active', p.id === 'modp-panel-info'));

  // Show loading state (also closes header quick-edit left open from a previous module)
  document.getElementById('modp-header-edit').style.display = 'none';
  document.getElementById('modp-title').style.display  = '';
  document.getElementById('modp-badges').style.display  = '';
  document.getElementById('modp-title').textContent = `⏳ ${t('ui.loading')}`;
  document.getElementById('modp-badges').innerHTML = '';
  ['info','scenario','events','npcs','locations','threads'].forEach(tab =>
    document.getElementById(`modp-panel-${tab}`).innerHTML = `<div class="loading-state"><div class="spinner"></div>${t('ui.loading')}</div>`);

  try {
    const [data] = await Promise.all([
      fetch(`/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/detail${qs}`).then(r => r.json()),
      // Reuse the roster so НПС-names can link to their cards (and openCharDetail works)
      STATE.characters.length ? Promise.resolve()
        : fetch(`/api/characters${qs}`).then(r => r.json()).then(d => { STATE.characters = Array.isArray(d) ? d : []; }).catch(() => {}),
    ]);
    if (data.error) throw new Error(data.error);
    renderModulePage(data); // синхронно рендерит ВСЕ панели, включая форму сессий (#modp-panel-sessions) — DOM готов сразу после этого вызова

    // Применяем отложенное намерение «→ Записать сессию» (тикет 3.7), если оно
    // было выставлено session-screen.js перед openModulePage().
    if (_pendingModulePrefill) {
      const prefill = _pendingModulePrefill;
      _pendingModulePrefill = null;
      if (prefill.tab === 'sessions') {
        // Программно «кликаем» по вкладке — тот же путь, что и ручной клик GM,
        // без дублирования логики переключения .active из делегированного
        // обработчика #modp-tabbar ниже.
        document.querySelector('.modp-tab[data-modtab="sessions"]')?.click();
        // Контекстный селектор через #modp-panel-sessions — НЕ голый lookup по
        // id «sess-notes»/«sess-scenes»: те же id рендерит #sess-notes-wrap на
        // экране Сессии (session-screen.js) для виджета «Заметки сессии» — тот
        // же класс id-коллизии, что уже чинили в _sessHydrateSessionNotes
        // (см. регрессионный тест выше по коду).
        const notesEl  = document.getElementById('modp-panel-sessions').querySelector('#sess-notes');
        const scenesEl = document.getElementById('modp-panel-sessions').querySelector('#sess-scenes');
        if (notesEl && !notesEl.value.trim() && prefill.notes) notesEl.value = prefill.notes;
        if (scenesEl && !scenesEl.value.trim() && prefill.scenes) scenesEl.value = prefill.scenes;
      }
    }
  } catch (e) {
    document.getElementById('modp-title').textContent = t('mod.headerLoading');
    document.getElementById('modp-panel-info').innerHTML = `<div class="modp-empty"><div class="modp-empty-icon">⚠</div>${escHtml(e.message)}</div>`;
  }
}

// Scenes from the scenario that are NOT already covered by any earlier session
// record of this module — используется и формой «+ Запись сессии»
// (renderModulePage → sceneSelect), и агрегатом заметок при переходе с экрана
// Сессии (session-screen.js, кнопка «→ Записать сессию», тикет 3.7): обе
// стороны должны считать «сыграно» одинаково, поэтому логика вынесена сюда, а
// не продублирована в двух файлах. `scenes` — data.scenes/_sessDetail.scenes
// ([{date, title}]), `sessions` — data.sessions/_sessDetail.sessions
// ([{scenes}]) — тот же `/detail`-ответ на обеих страницах.
function _filterUnrecordedScenes(scenes, sessions) {
  const playedText = (sessions || []).map(s => s.scenes || '').join(' | ').toLowerCase();
  return (scenes || [])
    .map(sc => (sc.date ? `${sc.date} — ${sc.title}` : sc.title))
    .filter(Boolean)
    .filter(label => {
      const datePart = (label.match(/^(?:сцена|эпизод)\s*\d+/i) || [''])[0].toLowerCase();
      if (playedText.includes(label.toLowerCase())) return false;
      if (datePart && playedText.includes(datePart)) return false;
      return true;
    });
}

// Resolve a character by name (exact, ё-insensitive) against the loaded roster.
function _findCharByName(name) {
  const n = (name || '').toLowerCase().replace(/ё/g, 'е').trim();
  return (STATE.characters || []).find(c => (c.name || '').toLowerCase().replace(/ё/g, 'е').trim() === n);
}

// Generic placeholders in npc.md desc that just repeat the section — hidden in the UI.
const NPC_DESC_NOISE = /^(персонаж игрока|пк|роль(\s+в\s+модуле)?|нпс)$/i;

// Render the «НПС» tab from structured groups: clickable name (→ card), trimmed desc,
// and a per-NPC «Реплика НПС» box (situation textarea + generate button).
// Карточки НПС модуля (`.char-card`, переиспользуется с главной сетки персонажей —
// см. renderChars) — по аналогии с «Связанными локациями» (_locCardHtml/.modp-loc-cards
// в locations.js). Канон-НПС кликабельны (открывают карточку через уже существующий
// делегированный обработчик [data-open-char] ниже), модульные (неканоничные) — превью
// без клика: у них нет отдельной карточки в общем реестре персонажей.
function _renderModuleNpcCards(groups) {
  const entries = groups.filter(g => g.kind !== 'pc').flatMap(g => g.entries);
  if (!entries.length) return '';
  const cards = entries.map(e => {
    // e.name — сырой текст из npc.md (может отличаться от канонич. имени карточки,
    // напр. «Кален Урес / Госпожа Бубенчик» вместо «Госпожа Бубенчик») — как и
    // в _renderModuleNpcGroups, резолвим через ростер и кликаем по known.name.
    const known = e.sheetScope === 'character' ? _findCharByName(e.name) : null;
    const clickable = !!known;
    const icon = lineageIconHtml(e.lineage);
    const subtitle = e.clan || (e.sheetScope === 'module' ? t('mod.npcSubtitleModule') : t('mod.npcSubtitle'));
    const textBlock = `
      <div class="char-name">${escHtml(e.name)}</div>
      <div class="char-clan">${escHtml(subtitle)}</div>`;
    const attrs = clickable ? `data-open-char="${escAttr(known.slug)}"` : '';
    const staticCls = clickable ? '' : ' modp-npc-card-static';
    const delGroup = e.sheetScope === 'module' ? 'modular' : 'canon';
    // Без event.stopPropagation() — обработчик клика на #modp-panel-npcs уже
    // проверяет [data-npc-del-name] раньше [data-open-char] и делает return,
    // так что открытие карточки персонажа не срабатывает при клике по ✕
    // (см. делегированный обработчик ниже); stopPropagation тут не нужен и
    // раньше приводил к тому, что событие вообще не доходило до панели.
    const delBtn = `<button class="modp-npc-card-del" data-npc-del-name="${escAttr(e.name)}"
      data-npc-del-group="${delGroup}" title="${t('mod.removeFromModule')}">✕</button>`;
    if (e.imageUrl) {
      return `<div class="char-card has-art modp-npc-card${staticCls}" ${attrs}>
        <img class="char-card-art" src="${escHtml(thumbUrl(e.imageUrl, 640))}" alt="${escHtml(e.name)}" loading="lazy" decoding="async">
        <div class="char-card-overlay">${textBlock}</div>
        ${delBtn}
      </div>`;
    }
    return `<div class="char-card modp-npc-card${staticCls}" ${attrs}>
      <span class="char-lineage-icon">${icon}</span>
      ${textBlock}
      ${delBtn}
    </div>`;
  }).join('');
  return `<div class="modp-char-cards">${cards}</div>`;
}

function _renderModuleNpcGroups(groups) {
  return groups.map(g => {
    const entries = g.entries.map(e => {
      const known    = _findCharByName(e.name);
      const nameHtml = known
        ? `<a class="modp-npc-name modp-npc-link" data-open-char="${escAttr(known.slug)}" title="${t('mod.openCard')}">${escHtml(e.name)}</a>`
        : `<span class="modp-npc-name">${escHtml(e.name)}</span>`;
      const desc     = (e.desc || '').trim();
      const descHtml = (desc && !NPC_DESC_NOISE.test(desc))
        ? `<span class="modp-npc-desc">${escHtml(desc)}</span>` : '';
      // Лист персонажа — кнопки напротив имени (если контекст листа разрешим)
      const sheetCtl = e.slug ? `
        <div class="modp-npc-sheet" data-sheet-scope="${e.sheetScope}" data-sheet-name="${escAttr(e.name)}" data-sheet-slug="${escAttr(e.slug)}">
          ${ e.hasSheet
            ? `<button class="modp-sheet-btn" data-sheet-act="view">📋 ${t('mod.sheetView')}</button>
               <button class="modp-sheet-btn ghost" data-sheet-act="regen" title="${t('mod.sheetRegenTitle')}">♻</button>
               <button class="modp-sheet-btn ghost" data-sheet-act="edit" title="${t('mod.sheetEditTitle')}">✏</button>`
            : `<button class="modp-sheet-btn" data-sheet-act="gen">📋 ${t('mod.sheetGen')}</button>` }
        </div>` : '';
      // Promote button — only for modular NPCs
      let promoteCtl = '';
      if (g.kind === 'modular' && e.slug) {
        const pc = e.promoteCheck;
        const allMet = pc && pc.survived && pc.inFinale && pc.inMultipleModules;
        const tip = pc
          ? `${pc.survived ? '✓' : '✗'} ${t('mod.promote.critSurvived')} · ${pc.inFinale ? '✓' : '✗'} ${t('mod.promote.critFinale')} · ${pc.inMultipleModules ? '✓' : '✗'} ${t('mod.promote.critModules')}`
          : t('mod.promote.notChecked');
        promoteCtl = `<button class="modp-promote-btn${allMet ? ' ready' : ''}"
          data-promote-slug="${escAttr(e.slug)}" data-promote-name="${escAttr(e.name)}"
          title="${escAttr(tip)}">⬆ ${t('mod.promote.btn')}</button>`;
      }
      // Удалить из модуля — и НПС, и ПК (только запись в npc.md; для модульных
      // НПС дополнительно удаляется их собственная карточка npc/<slug>/, т.к.
      // она существует только в рамках этого модуля — см. showConfirm ниже).
      const delCtl = `<button class="modp-npc-del-btn" data-npc-del-name="${escAttr(e.name)}"
        data-npc-del-group="${g.kind}" title="${t('mod.removeFromModule')}">🗑</button>`;
      // Реплики — только для НПС (ПК озвучивают игроки, не Мастер)
      const dlg = g.kind !== 'pc' ? `
        <div class="modp-npc-dlg">
          <textarea class="modp-npc-sit" rows="2" placeholder="${t('mod.dlg.situationPh')}"></textarea>
          <button class="modp-npc-dlg-btn" data-npc-name="${escAttr(e.name)}" data-npc-modular="${g.kind === 'modular' ? 1 : 0}">💬 ${t('mod.dlg.btn')}</button>
          <div class="modp-npc-dlg-result" style="display:none"></div>
        </div>` : '';
      return `<div class="modp-npc-entry">
        <div class="modp-npc-head">
          <div class="modp-npc-head-main">${nameHtml}${descHtml}</div>
          <div class="modp-npc-actions">${sheetCtl}${promoteCtl}${delCtl}</div>
        </div>
        ${dlg}
      </div>`;
    }).join('');
    return `<div class="modp-npc-group">
      <div class="modp-npc-group-title">${escHtml(g.title)}</div>
      ${entries}
    </div>`;
  }).join('');
}

// Generate in-character replies for one NPC on the module page (Voice + clan style).
async function _genModuleNpcDialogue(btn) {
  const entry = btn.closest('.modp-npc-entry');
  const sit   = entry.querySelector('.modp-npc-sit');
  const box   = entry.querySelector('.modp-npc-dlg-result');
  const name  = btn.dataset.npcName;
  const modular = btn.dataset.npcModular === '1';
  const situation = sit?.value.trim() || '';
  box.style.display = '';
  if (!situation) { box.innerHTML = `<div class="canon-warn">${t('mod.dlg.describe')}</div>`; return; }
  const lbl = btn.textContent;
  btn.disabled = true; btn.textContent = t('common.generating');
  box.innerHTML = `<div class="canon-loading">💬 ${t('mod.dlg.generating')}</div>`;
  try {
    const qs    = window.location.search;
    const prefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref  = _getPref(prefs, 'dialogue', 'openrouter');
    const body  = { situation, source: pref.provider, model: pref.model };
    // Модульные НПС не в общем реестре — подскажем серверу, где искать карточку
    if (modular && STATE.currentModule) { body.chr = STATE.currentModule.chronicle; body.mod = STATE.currentModule.name; }
    const d = await fetch(`/api/characters/${encodeURIComponent(modular ? name : _charSlug(name))}/dialogue${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    ).then(r => r.json());
    if (!d.ok) { box.innerHTML = `<div class="canon-warn">${t('ui.err')}${escHtml(d.error || t('mod.dlg.fail'))}</div>`; return; }
    const lines = (d.text || '').split('\n').map(l => l.trim()).filter(Boolean);
    box.innerHTML = (lines.length ? _dlgFallbackNote(d.source) : '') + (lines.length
      ? `<div class="cdet-dlg-lines">${lines.map(l => `<div class="cdet-dlg-line">${escHtml(l)}</div>`).join('')}</div>`
      : `<div class="canon-warn">${t('mod.dlg.empty')}</div>`);
  } catch (e) {
    box.innerHTML = `<div class="canon-warn">${t('ui.err')}${escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = lbl;
  }
}

// Muted note when Claude was rate-limited and the server fell back to another provider.
function _dlgFallbackNote(source) {
  if (source === 'openrouter-fallback')
    return `<div class="canon-warn" style="margin-bottom:6px">${t('mod.dlg.fallbackOr')}</div>`;
  if (source === 'openai-fallback')
    return `<div class="canon-warn" style="margin-bottom:6px">${t('mod.dlg.fallbackGpt')}</div>`;
  return '';
}

function _renderParticipantChips(group, items) {
  const chips = items.map(p => {
    const nm = typeof p === 'string' ? p : (p.name || '');
    return `<div class="moddet-chip" data-name="${escHtml(nm)}">
      ${escHtml(nm)}
      <button class="moddet-chip-rm" data-rmname="${escHtml(nm)}" data-rmgroup="${group}" title="${t('ui.btn.delete')}">×</button>
    </div>`;
  }).join('');
  const datalistChars = group === 'pcs' ? (STATE.characters || []).filter(_isPcCharacter) : (STATE.characters || []);
  return `
    <div class="moddet-chips-wrap" id="moddet-${group}-chips">${chips}</div>
    <div class="moddet-add-row">
      <input class="moddet-add-input" id="moddet-${group}-add-input"
        placeholder="${group === 'pcs' ? t('mod.participant.pcPh') : t('mod.participant.npcPh')}"
        list="moddet-${group}-datalist" autocomplete="off">
      <datalist id="moddet-${group}-datalist">
        ${datalistChars.map(c => `<option value="${escHtml(c.name)}">`).join('')}
      </datalist>
      <button class="modp-save-btn" data-addchip="${group}" style="white-space:nowrap">+ ${t('mod.participant.add')}</button>
    </div>`;
}

// Браузерное зеркало lib/parsers.js: parseScenarioSections/replaceScenarioSection
// (см. комментарий там же — реальные сценарии не следуют фиксированному списку
// заголовков, поэтому парсим по ЛЮБЫМ `## `, а не по жёстко заданным именам).
function _parseScenarioSections(raw) {
  const text = String(raw == null ? '' : raw).replace(/\r\n/g, '\n');
  const firstIdx = text.search(/^##\s+/m);
  if (firstIdx === -1) return { preamble: text, sections: [] };
  const preamble = text.slice(0, firstIdx);
  const rest = text.slice(firstIdx);
  const parts = rest.split(/\n(?=##\s+)/);
  const sections = [];
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).replace(/^##\s+/, '').trim();
    let body = nl === -1 ? '' : part.slice(nl + 1);
    body = body.replace(/\n+---+\s*$/, '').replace(/^\n+/, '').replace(/\s+$/, '');

    // Сцены, вложенные как `### ` под общим `## Сцены` — разворачиваем в
    // отдельные разделы (level 3), чтобы каждая сцена редактировалась/
    // перегенерировалась независимо. Зеркалит lib/parsers.js.
    const h3Idx = body.search(/^###\s+/m);
    if (h3Idx !== -1) {
      const intro = body.slice(0, h3Idx).replace(/\s+$/, '');
      sections.push({ heading, body: intro, level: 2, parent: null });
      const h3parts = body.slice(h3Idx).split(/\n(?=###\s+)/);
      for (const h3part of h3parts) {
        const h3nl = h3part.indexOf('\n');
        const h3heading = (h3nl === -1 ? h3part : h3part.slice(0, h3nl)).replace(/^###\s+/, '').trim();
        let h3body = h3nl === -1 ? '' : h3part.slice(h3nl + 1);
        h3body = h3body.replace(/^\n+/, '').replace(/\s+$/, '');
        sections.push({ heading: h3heading, body: h3body, level: 3, parent: heading });
      }
    } else {
      sections.push({ heading, body, level: 2, parent: null });
    }
  }
  return { preamble, sections };
}

// Рендерит вкладку «Сценарий» разбитой по разделам (## в scenario.md), каждый
// со своими кнопками «Редактировать»/«Перегенерировать». Вызывается и из
// renderModulePage, и повторно — после сохранения/регена одного раздела
// (без полной перезагрузки страницы модуля).
// Раздел «🔒 GM-справка — закрытая информация» (и синонимы) — секреты Мастера,
// вписанные AI прямо в сценарий. Здесь нет ролевой системы/отдельного вида для
// игроков — это чисто визуальная страховка при демонстрации экрана: пометить
// такие разделы и дать кнопку временно скрыть их из вида.
const MODP_GM_SECTION_RE = /🔒|GM[\s-]?справк|только\s+для\s+(мастера|рассказчика)/i;
const MODP_SCENE_ADDED_RE = /<!--\s*meta:sceneAdded:\s*1\s*-->/i;

// Пояснения к типовым блокам/полям сценария — показываются в тултипе справа
// от названия. Заголовки генерируются ИИ и не фиксированы дословно (напр.
// «Тактика Графа Жубака», «Бросок — Распознать намерения»), поэтому
// сопоставление идёт по паттернам начала строки, а не точным совпадением.
const MODP_SCENARIO_TOOLTIPS = [
  [/^🔒?\s*GM-справк/i, t('mod.scen.tipGm')],
  [/^Что произошло до начала сессии/i, t('mod.scen.tipPrelude')],
  [/^Тайная мотивация/i, t('mod.scen.tipSecretMotif')],
  [/^Проверка таймлайна/i, t('mod.scen.tipTimelineCheck')],
  [/— детали$/i, t('mod.scen.tipNpcDetails')],
  [/^Пролог/i, t('mod.scen.tipPrologue')],
  [/^Сцена\s*\d+/i, t('mod.scen.tipScene')],
  [/^Финал/i, t('mod.scen.tipFinale')],
  [/^Открытые вопросы/i, t('mod.scen.tipOpenQuestions')],
  [/^Колорит/i, t('mod.scen.tipColor')],
  [/^Описание для игрока/i, t('mod.scen.tipPlayerDesc')],
  [/^GM[\s-]?подсказки/i, t('mod.scen.tipGmHints')],
  [/^Бросок/i, t('mod.scen.tipRoll')],
  [/^Тактика/i, t('mod.scen.tipTactics')],
  [/^Вводный текст$/i, t('mod.scen.tipIntro')],
];

function _scenarioTooltipFor(heading) {
  const h = heading || '';
  for (const [re, text] of MODP_SCENARIO_TOOLTIPS) if (re.test(h)) return text;
  return '';
}

function _scenarioTooltipHtml(heading) {
  return fieldTip(_scenarioTooltipFor(heading));
}

// Минимальный редактируемый каркас сценария (Пролог / Сцена 1 / Финал) —
// для ручного заполнения без ИИ-генерации. Формат/breadcrumb — как у
// AI-генерации (routes/modules/fill.js POST .../fill), чтобы каркас потом
// парсился теми же блоками, что и сгенерированный сценарий.
function _buildScenarioSkeleton(title, modSlug) {
  return [
    `# Сценарий — ${title}`,
    '',
    `> 🔗 [Модуль](${modSlug}.md) | [Хроника](../../events.md) | [НПС](npc.md)`,
    '',
    '---',
    '',
    '## Пролог — Название',
    '### Описание для игрока',
    '⚠️ Заполни.',
    '',
    '### GM-подсказки',
    '⚠️ Заполни.',
    '',
    '---',
    '',
    '## Сцена 1 — Название',
    '### Описание для игрока',
    '⚠️ Заполни.',
    '',
    '### Колорит',
    '⚠️ 2-3 детали места/времени, которые нельзя перепутать с другим городом.',
    '',
    '---',
    '',
    '## Финал — Название',
    '### Описание для игрока',
    '⚠️ Заполни.',
    '',
  ].join('\n');
}

function _renderScenarioPanel(data) {
  const raw = data.scenario || '';
  const { sections } = _parseScenarioSections(raw);
  // {heading, parent} по индексу секции в плоском списке — используется при
  // сохранении/перегенерации отдельного поля (parent нужен, чтобы отличить
  // одноимённые поля разных сцен — «GM-подсказки», «Описание для игрока» и т.п.).
  STATE.scenarioSectionHeadings = sections.map(s => ({ heading: s.heading, parent: s.parent }));
  const hasGmSections = sections.some(s => MODP_GM_SECTION_RE.test(s.heading));

  // Визуально объединяем плоский список секций в блоки по родительскому
  // `##`-заголовку (GM-справка / Пролог / Сцена N / Финал) — каждый блок одна
  // карточка с общими кнопками «Редактировать»/«Перегенерировать» на весь блок,
  // а его `### `-поля внутри — со своей иконкой перегенерации.
  const blocks = [];
  sections.forEach((s, i) => {
    if (s.level === 2) blocks.push({ heading: s.heading, idx: i, introBody: s.body, fields: [] });
    else if (blocks.length) blocks[blocks.length - 1].fields.push({ heading: s.heading, body: s.body, idx: i });
  });

  const blocksHtml = blocks.length
    ? blocks.map(b => {
        const isGM = MODP_GM_SECTION_RE.test(b.heading);
        const gmAttr  = isGM ? ' data-gm="1"' : '';
        const gmBadge = isGM ? ` <span class="modp-gm-badge">🔒 ${t('mod.scen.gmBadge')}</span>` : '';
        const needsFinaleRegen = /^Финал(?:\s*[—–:.-].*)?$/i.test(b.heading) && MODP_SCENE_ADDED_RE.test(raw);
        const finaleWarn = needsFinaleRegen
          ? ` <span class="modp-block-warn">⚠️ ${t('mod.scen.finaleWarn')}</span>` : '';

        const items = [];
        if (b.introBody || !b.fields.length) items.push({ heading: b.fields.length ? t('mod.scen.introText') : '', body: b.introBody, idx: b.idx });
        items.push(...b.fields);
        const fieldIdxs = items.map(it => it.idx).join(',');

        const itemsHtml = items.map(it => `
        <div class="modp-scenario-field">
          <div class="modp-field-header-row">
            ${it.heading ? `<div class="modp-field-label">${escHtml(it.heading)}${_scenarioTooltipHtml(it.heading)}</div>` : '<div></div>'}
            <button class="modp-field-regen-btn" data-scensec-regen="${it.idx}" title="${t('mod.scen.regenFieldTitle')}">🔄</button>
          </div>
          <div id="moddet-scensec${it.idx}-view" class="modp-md">${mdToHtmlPlain(it.body)}</div>
          <div id="moddet-scensec${it.idx}-edit" style="display:none">
            <textarea class="cdet-edit-textarea" id="moddet-scensec${it.idx}-ta" rows="10"
              style="width:100%;font-family:monospace;font-size:var(--fs-lg)">${escHtml(it.body)}</textarea>
          </div>
          <div class="modp-edit-bar" id="moddet-scensec${it.idx}-bar" style="display:none">
            <button class="modp-save-btn" data-savemod="scensec${it.idx}">${t('ui.btn.save')}</button>
            <button class="modp-cancel-btn" data-cancelmod="scensec${it.idx}">${t('ui.btn.cancel')}</button>
            <span class="modp-save-msg" id="moddet-scensec${it.idx}-msg" style="display:none">${t('common.saved')}</span>
          </div>
        </div>`).join('');

        return `
      <div class="modp-scenario-block"${gmAttr} data-field-idxs="${fieldIdxs}">
        <div class="modp-block-header-row">
          <div class="modp-block-label">${escHtml(b.heading)}${_scenarioTooltipHtml(b.heading)}${gmBadge}${finaleWarn}</div>
          <div class="modp-scenario-sec-btns">
            <button class="modp-edit-btn" data-editblock="${b.idx}">${t('common.edit')}</button>
            <button class="modp-edit-btn modp-block-saveall-btn" data-blocksaveall="${b.idx}" style="display:none">💾 ${t('mod.scen.saveAll')}</button>
            <button class="modp-edit-btn" data-blockregen="${b.idx}">🔄 ${t('mod.scen.regenBlock')}</button>
          </div>
        </div>
        <div class="modp-block-body">${itemsHtml}</div>
      </div>`;
      }).join('')
    : (raw ? `<div class="modp-md">${mdToHtmlPlain(raw)}</div>` : `
      <div class="cdet-empty">${t('mod.scen.notGenerated')}</div>
      <div class="modp-scenario-empty-actions">
        <span class="cdet-empty">${t('mod.scen.emptyHint')}</span>
        <button class="modp-edit-btn" id="modp-scenario-manual-btn">📝 ${t('mod.scen.manualBtn')}</button>
      </div>`);

  const panel = document.getElementById('modp-panel-scenario');
  panel.classList.toggle('modp-hide-gm', !!STATE.hideGmSections);
  panel.innerHTML = `
  <div class="modp-scenario-toolbar">
    <button class="modp-edit-btn" data-editmod="scenario">${t('mod.scen.editAll')}</button>
    ${raw ? `<button class="modp-edit-btn" id="modp-regen-scenario-btn" style="margin-left:8px">♻ ${t('mod.scen.regenAll')}</button>` : ''}
    ${raw ? `<button class="modp-edit-btn" id="modp-add-scene-btn" style="margin-left:8px">➕ ${t('mod.scen.addScene')}</button>` : ''}
    ${hasGmSections ? `<button class="modp-edit-btn" id="modp-toggle-gm-btn" style="margin-left:8px">${STATE.hideGmSections ? t('mod.scen.showGm') : t('mod.scen.hideGm')}</button>` : ''}
  </div>
  <div id="moddet-scenario-view">${blocksHtml}</div>
  <div id="moddet-scenario-edit" style="display:none">
    <textarea class="cdet-edit-textarea" id="moddet-scenario-ta" rows="40"
      style="width:100%;font-family:monospace;font-size:var(--fs-lg)">${escHtml(raw)}</textarea>
  </div>
  <div class="modp-edit-bar" id="moddet-scenario-bar" style="display:none">
    <button class="modp-save-btn" data-savemod="scenario">${t('ui.btn.save')}</button>
    <button class="modp-cancel-btn" data-cancelmod="scenario">${t('ui.btn.cancel')}</button>
    <span class="modp-save-msg" id="moddet-scenario-msg" style="display:none">${t('common.saved')}</span>
  </div>`;
}

function renderModulePage(data) {
  function modPanel(id, viewHtml, editHtml) {
    return `
    <div class="cdet-info-header">
      <button class="modp-edit-btn" data-editmod="${id}">${t('common.edit')}</button>
    </div>
    <div id="moddet-${id}-view">${viewHtml}</div>
    <div id="moddet-${id}-edit" style="display:none">${editHtml}</div>
    <div class="modp-edit-bar" id="moddet-${id}-bar" style="display:none">
      <button class="modp-save-btn" data-savemod="${id}">${t('ui.btn.save')}</button>
      <button class="modp-cancel-btn" data-cancelmod="${id}">${t('ui.btn.cancel')}</button>
      <span class="modp-save-msg" id="moddet-${id}-msg" style="display:none">${t('common.saved')}</span>
    </div>`;
  }
  // Как modPanel, но заголовок секции и кнопка «Редактировать» — в одну строку
  // (см. «Участники»/«НПС»), а не заголовок отдельно + кнопка ниже.
  function sectionPanel(id, label, viewHtml, editHtml) {
    return `
    <div class="modp-section-header-row">
      <div class="modp-section-label">${label}</div>
      <button class="modp-edit-btn" data-editmod="${id}">${t('common.edit')}</button>
    </div>
    <div id="moddet-${id}-view">${viewHtml}</div>
    <div id="moddet-${id}-edit" style="display:none">${editHtml}</div>
    <div class="modp-edit-bar" id="moddet-${id}-bar" style="display:none">
      <button class="modp-save-btn" data-savemod="${id}">${t('ui.btn.save')}</button>
      <button class="modp-cancel-btn" data-cancelmod="${id}">${t('ui.btn.cancel')}</button>
      <span class="modp-save-msg" id="moddet-${id}-msg" style="display:none">${t('common.saved')}</span>
    </div>`;
  }

  STATE.currentModuleData = data;
  // Header
  document.getElementById('modp-title').textContent = data.title || data.name;

  const isClosed = /закрыт/i.test(data.status || '');
  const badges = [
    data.status && `<span class="modp-badge${isClosed ? ' modp-badge-closed' : ''}">${escHtml(data.status)}</span>`,
    data.type   && `<span class="modp-badge">🎭 ${escHtml(data.type)}</span>`,
    data.time   && `<span class="modp-badge">📅 ${escHtml(data.time)}</span>`,
    data.tone   && `<span class="modp-badge">🌙 ${escHtml(data.tone)}</span>`,
    data.format && `<span class="modp-badge">📖 ${escHtml(data.format)}</span>`,
    data.chronicle && `<span class="modp-badge" style="border-color:var(--gold-tint-40);color:var(--text);opacity:0.7">📕 ${escHtml(data.chronicleDisplay || data.chronicle)}</span>`,
  ].filter(Boolean).join('');
  document.getElementById('modp-badges').innerHTML = badges;

  // Disable «Закрыть модуль» if already closed
  const closeBtn = document.getElementById('modp-close-btn');
  if (closeBtn) {
    closeBtn.disabled = isClosed;
    closeBtn.textContent = isClosed ? t('modp.closed') : t('modp.close');
  }

  // ── Info tab ──────────────────────────────────────────────────────────────────
  // Название/Тип/Время/Тон/Формат/Хроника редактируются в шапке (modp-header-edit) —
  // здесь дублировать их не нужно.

  // Description panel
  const descViewHtml = data.description
    ? `<div class="modp-concept-text">${escHtml(data.description)}</div>`
    : `<div class="cdet-empty">${t('mod.info.noConcept')}</div>`;
  const descEditHtml = `<textarea class="cdet-edit-textarea" id="moddet-desc-ta" rows="8" style="width:100%">${escHtml(data.description || '')}</textarea>`;

  // Персонажи игроков / НПС — два независимых раздела, каждый со своей
  // кнопкой «Редактировать» (не общая на двоих, не таблица).
  const pcNames  = (data.pcs  || []).map(p => typeof p === 'string' ? p : (p.name || ''));
  const npcNames = (data.npcs || []).map(p => typeof p === 'string' ? p : (p.name || ''));
  const pcViewHtml  = pcNames.length
    ? `<ul class="modp-part-list">${pcNames.map(n => `<li>${escHtml(n)}</li>`).join('')}</ul>`
    : `<div class="cdet-empty">${t('mod.info.unspecified')}</div>`;
  const npcViewHtml = npcNames.length
    ? `<ul class="modp-part-list">${npcNames.map(n => `<li>${escHtml(n)}</li>`).join('')}</ul>`
    : `<div class="cdet-empty">${t('mod.info.unspecified')}</div>`;
  const pcEditHtml  = _renderParticipantChips('pcs', data.pcs || []);
  const npcEditHtml = _renderParticipantChips('npcs', data.npcs || []);

  const infoHtml = `
  <div class="modp-section-label">💡 ${t('mod.info.concept')}</div>
  ${modPanel('desc', descViewHtml, descEditHtml)}
  <div class="modp-section-divider"></div>
  ${sectionPanel('pcs', `🎭 ${t('mod.info.pcs')}`, pcViewHtml, pcEditHtml)}
  <div class="modp-section-divider"></div>
  ${sectionPanel('npcs', `👤 ${t('mod.info.npcs')}`, npcViewHtml, npcEditHtml)}`;

  document.getElementById('modp-panel-info').innerHTML = infoHtml;

  // ── СЦЕНАРИЙ (разбит по разделам — см. _renderScenarioPanel) ──
  _renderScenarioPanel(data);

  // ── ФИНАЛ (finale.md — пишется при закрытии модуля, Фаза C) ──
  const finaleRaw = data.finale || '';
  const finaleViewHtml = finaleRaw
    ? `<div class="modp-md">${mdToHtmlPlain(finaleRaw)}</div>`
    : `<div class="modp-empty"><div class="modp-empty-icon">📜</div>${t('mod.finaleHint')}</div>`;
  document.getElementById('modp-panel-finale').innerHTML = finaleRaw
    ? modPanel('finale', finaleViewHtml,
        `<textarea class="cdet-edit-textarea" id="moddet-finale-ta" rows="20"
          style="width:100%;font-family:monospace;font-size:var(--fs-lg)">${escHtml(finaleRaw)}</textarea>`)
    : finaleViewHtml;

  // ── СЕССИИ (Фаза B — ведение во время игры) ──
  const sessions = data.sessions || [];
  const today    = new Date().toISOString().slice(0, 10);
  const sessHtml = sessions.length
    ? sessions.map((s, i) => `
        <div class="modp-session" data-sess-idx="${i}">
          <div class="modp-session-head">
            <span class="modp-session-title">${escHtml(s.title)}</span>
            ${s.status ? `<span class="modp-session-status">${escHtml(s.status)}</span>` : ''}
            <button class="modp-session-edit" data-sess-idx="${i}" title="${t('mod.sess.editTitle')}">✏️</button>
            <button class="modp-session-delete" data-sess-idx="${i}" title="${t('mod.sess.delTitle')}">🗑</button>
          </div>
          ${s.scenes ? `<div class="modp-session-scenes">${t('mod.sess.played', { scenes: escHtml(s.scenes) })}</div>` : ''}
          ${s.body ? `<div class="modp-session-body">${mdToHtmlPlain(s.body, { allowHeadings: false })}</div>` : ''}
        </div>`).join('')
    : `<div class="modp-empty"><div class="modp-empty-icon">🎲</div>${t('mod.sess.none')}</div>`;

  document.getElementById('modp-panel-sessions').innerHTML = `
    <div class="modp-session-form">
      <div class="modp-session-form-title">+ ${t('mod.sess.addTitle')}</div>
      <div class="modp-sf-row">
        <input id="sess-date" class="modp-sf-input" placeholder="${t('mod.sess.datePh')}" value="${today}">
        <select id="sess-status" class="modp-sf-input">
          <option>🟡 В процессе</option>
          <option>🟢 Завершён</option>
        </select>
      </div>
      <input id="sess-scenes" class="modp-sf-input" placeholder="${t('mod.sess.scenesPh')}">
      <textarea id="sess-notes" class="modp-sf-input modp-sf-area" rows="4" placeholder="${t('mod.sess.notesPh')}"></textarea>
      <div class="modp-sf-btns">
        <button id="sess-add-btn" class="modp-gen-btn">${t('mod.sess.add')}</button>
        <button id="sess-canon-btn" class="modp-canon-btn" title="${t('mod.sess.canonTitle')}">🔍 ${t('mod.sess.canonBtn')}</button>
      </div>
      <div id="sess-error" class="modp-sf-error" style="display:none"></div>
      <div id="sess-canon-result" class="canon-result" style="display:none"></div>
    </div>
    <div class="modp-session-list">${sessHtml}</div>`;
  document.getElementById('sess-add-btn').addEventListener('click', _addSessionEntry);
  document.getElementById('sess-canon-btn').addEventListener('click', () => {
    const scenes = document.getElementById('sess-scenes')?.value.trim() || '';
    const notes  = document.getElementById('sess-notes')?.value.trim() || '';
    const text   = [scenes && `${t('mod.sess.playedPrefix')} ${scenes}`, notes].filter(Boolean).join('\n');
    _runCanonCheck(text, document.getElementById('sess-canon-result'), document.getElementById('sess-canon-btn'), `🔍 ${t('mod.sess.canonBtn')}`);
  });

  // ── СОБЫТИЯ ──
  if (data.events?.length) {
    document.getElementById('modp-panel-events').innerHTML =
      data.events.map(ev => `
        <div class="modp-event">
          <div class="modp-event-date">${escHtml(ev.date || '')}</div>
          <div class="modp-event-title">${escHtml(ev.title || '')}</div>
          ${ev.description ? `<div class="modp-event-desc">${escHtml(ev.description)}</div>` : ''}
        </div>`).join('');
  } else {
    document.getElementById('modp-panel-events').innerHTML =
      `<div class="modp-empty"><div class="modp-empty-icon">📅</div>${t('mod.events.none')}</div>`;
  }

  // ── НПС ──
  const npcPanel = document.getElementById('modp-panel-npcs');
  if (data.npcGroups?.length) {
    npcPanel.innerHTML = _renderModuleNpcCards(data.npcGroups) + _renderModuleNpcGroups(data.npcGroups);
  } else if (data.npcContent) {
    npcPanel.innerHTML = `<div class="modp-md">${mdToHtmlPlain(data.npcContent)}</div>`;
  } else if (data.npcs?.length) {
    npcPanel.innerHTML =
      `<div class="modp-char-list">${data.npcs.map(p => `
        <div class="modp-char-item" style="flex-direction:column;align-items:flex-start;gap:4px">
          <span class="modp-char-name">${escHtml(p.name)}</span>
          <span class="modp-char-role">${escHtml(p.role)}</span>
        </div>`).join('')}</div>`;
  } else {
    npcPanel.innerHTML =
      `<div class="modp-empty"><div class="modp-empty-icon">👥</div>${t('mod.npcs.noFile')}</div>`;
  }
  // ── NPC toolbar & add-form ──
  npcPanel.insertAdjacentHTML('beforeend', `
  <div class="modp-npc-add-toolbar" style="margin-top:16px">
    ${!data.npcContent
      ? `<button class="modp-edit-btn" id="modp-init-npcmd-btn">📄 ${t('mod.npcs.createFile')}</button>`
      : ''
    }
    <button class="modp-edit-btn" id="modp-add-npc-btn">+ ${t('mod.npcs.addBtn')}</button>
  </div>

  <div id="modp-npc-add-form" style="display:none;margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:var(--r-sm)">
    <div style="margin-bottom:8px">
      <label style="display:block;font-size:var(--fs-lg);color:var(--text2);margin-bottom:2px">${t('mod.npcs.nameLabel')}</label>
      <input class="moddet-add-input" id="modp-npc-add-name"
        list="modp-npc-add-datalist" placeholder="${t('mod.npcs.namePh')}" autocomplete="off" style="width:100%">
      <datalist id="modp-npc-add-datalist">
        ${(STATE.characters || []).map(c => `<option value="${escAttr(c.name)}">`).join('')}
      </datalist>
    </div>
    <div style="margin-bottom:8px">
      <label style="display:block;font-size:var(--fs-lg);color:var(--text2);margin-bottom:2px">${t('mod.npcs.groupLabel')}</label>
      <select class="moddet-add-input" id="modp-npc-add-group" style="width:100%">
        <option value="modular">🆕 ${t('mod.npcs.groupModular')}</option>
        <option value="canon">📚 ${t('mod.npcs.groupCanon')}</option>
        <option value="pc">🎭 ${t('mod.npcs.groupPc')}</option>
      </select>
    </div>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="modp-save-btn" id="modp-npc-add-submit">${t('mod.npcs.addSubmit')}</button>
      <button class="modp-cancel-btn" id="modp-npc-add-cancel">${t('ui.btn.cancel')}</button>
      <span class="modp-save-msg" id="modp-npc-add-msg" style="display:none"></span>
    </div>
  </div>`);

  // ── ЛОКАЦИИ ──
  _renderModuleLocPanel(data);

  // ── НИТИ ──
  document.getElementById('modp-panel-threads').innerHTML = data.openThreads
    ? `<div class="modp-md">${mdToHtmlPlain(data.openThreads)}</div>`
    : `<div class="modp-empty"><div class="modp-empty-icon">🧵</div>${t('mod.threads.none')}</div>`;
}

// Minimal markdown → HTML converter
// allowHeadings: FIX-20 (docs/audit/2026-07-28-fix-plan.md) — session/scene
// notes are freeform prose, never real markdown documents; the server
// unescapes a stored '\#'/'\##' (kept escaped on disk since FIX-2, so a note
// starting with '#' can't fabricate a fake session/scene record on the next
// parse — see web/lib/parsers/shared.js sanitizeFreeformBody) before sending
// it here, so by the time it reaches this renderer a once-escaped '#' is
// indistinguishable from a real one. Rather than thread escape-state through
// the whole read pipeline, callers that only ever hold prose (no legitimate
// headings) pass allowHeadings:false so '#'/'##' render as literal text
// instead of a fabricated <h2> (confirmed live: a note with '\## Сессия 99'
// rendered as a real bolded heading inline in the session body).
function mdToHtmlPlain(md, { allowHeadings = true } = {}) {
  if (!md) return '';
  // Extract code blocks before escaping
  const codeBlocks = [];
  let src = md.replace(/```([\s\S]*?)```/g, (_, inner) => {
    codeBlocks.push(inner);
    return `\x00CODE${codeBlocks.length - 1}\x00`;
  });
  // Escape HTML in the rest
  src = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Inline code
  src = src.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // Headers
  if (allowHeadings) {
    src = src.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    src = src.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    src = src.replace(/^####\s+(.+)$/gm,  '<h4>$1</h4>');
    src = src.replace(/^###\s+(.+)$/gm,   '<h3>$1</h3>');
    src = src.replace(/^##\s+(.+)$/gm,    '<h2>$1</h2>');
    src = src.replace(/^#\s+(.+)$/gm,     '<h2>$1</h2>');
  }
  // Bold + italic
  src = src.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  src = src.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  src = src.replace(/\*(.+?)\*/g,         '<em>$1</em>');
  // Links: [text](href)
  src = src.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => resolveMdLink(t, h));
  // Blockquote
  src = src.replace(/^&gt;\s*(.+)$/gm, '<blockquote>$1</blockquote>');
  // Horizontal rule
  src = src.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:16px 0">');
  // Lists (group consecutive li into ul)
  src = src.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  src = src.replace(/^(\d+)\.\s+(.+)$/gm, '<li>$2</li>');
  src = src.replace(/(<li>[^]*?<\/li>(\n|$))+/g, m => `<ul>${m}</ul>`);
  // Paragraphs
  src = src.replace(/\n\n+/g, '\x01');
  const paras = src.split('\x01').map(chunk => {
    const t = chunk.trim();
    if (!t) return '';
    if (/^<(h[1-6]|ul|blockquote|hr|pre)/.test(t)) return t;
    return `<p>${t.replace(/\n/g, '<br>')}</p>`;
  });
  src = paras.join('\n');
  // Restore code blocks
  codeBlocks.forEach((cb, i) => {
    const escaped = cb.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    src = src.replace(`\x00CODE${i}\x00`, `<pre><code>${escaped}</code></pre>`);
  });
  return src;
}

// Module page tab switching
document.getElementById('modp-tabbar').addEventListener('click', e => {
  const btn = e.target.closest('.modp-tab');
  if (!btn) return;
  const tab = btn.dataset.modtab;
  document.querySelectorAll('.modp-tab').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.modp-panel').forEach(p => p.classList.toggle('active', p.id === `modp-panel-${tab}`));
});

// Info panel: edit / save / cancel panel handlers
document.getElementById('modp-panel-info').addEventListener('click', e => {
  const editModBtn   = e.target.closest('[data-editmod]');
  const saveModBtn   = e.target.closest('[data-savemod]');
  const cancelModBtn = e.target.closest('[data-cancelmod]');

  if (editModBtn)   { _modToggleEdit(editModBtn.dataset.editmod, true);      return; }
  if (cancelModBtn) { _modToggleEdit(cancelModBtn.dataset.cancelmod, false);  return; }
  if (saveModBtn)   { _modSavePanel(saveModBtn.dataset.savemod);              return; }

  // Remove chip
  const rmBtn = e.target.closest('[data-rmname]');
  if (rmBtn) {
    const chip = rmBtn.closest('.moddet-chip');
    if (chip) chip.remove();
    return;
  }

  // Add chip
  const addChipBtn = e.target.closest('[data-addchip]');
  if (addChipBtn) {
    const group  = addChipBtn.dataset.addchip;
    const input  = document.getElementById(`moddet-${group}-add-input`);
    const nm     = input?.value?.trim();
    if (!nm) return;
    const chips  = document.getElementById(`moddet-${group}-chips`);
    if (chips) {
      if (Array.from(chips.querySelectorAll('.moddet-chip')).some(c => c.dataset.name === nm)) {
        if (input) input.value = '';
        return;
      }
      const div = document.createElement('div');
      div.className = 'moddet-chip';
      div.dataset.name = nm;
      div.innerHTML = `${escHtml(nm)}<button class="moddet-chip-rm" data-rmname="${escHtml(nm)}" data-rmgroup="${group}" title="${t('ui.btn.delete')}">×</button>`;
      chips.appendChild(div);
    }
    if (input) input.value = '';
    return;
  }
});

// Finale panel: edit / save / cancel handlers
document.getElementById('modp-panel-finale').addEventListener('click', e => {
  const editModBtn   = e.target.closest('[data-editmod]');
  const saveModBtn   = e.target.closest('[data-savemod]');
  const cancelModBtn = e.target.closest('[data-cancelmod]');

  if (editModBtn)   { _modToggleEdit(editModBtn.dataset.editmod, true);      return; }
  if (cancelModBtn) { _modToggleEdit(cancelModBtn.dataset.cancelmod, false);  return; }
  if (saveModBtn)   { _modSavePanel(saveModBtn.dataset.savemod);              return; }
});

// Scenario panel: edit / save / cancel / regen handlers
document.getElementById('modp-panel-scenario').addEventListener('click', e => {
  const editModBtn   = e.target.closest('[data-editmod]');
  const saveModBtn   = e.target.closest('[data-savemod]');
  const cancelModBtn = e.target.closest('[data-cancelmod]');

  if (editModBtn)   { _modToggleEdit(editModBtn.dataset.editmod, true);      return; }
  if (cancelModBtn) {
    _modToggleEdit(cancelModBtn.dataset.cancelmod, false);
    _modSyncBlockSaveAllVisibility(cancelModBtn.dataset.cancelmod);
    return;
  }
  if (saveModBtn)   { _modSavePanel(saveModBtn.dataset.savemod);              return; }

  const manualBtn = e.target.closest('#modp-scenario-manual-btn');
  if (manualBtn) {
    const d   = STATE.currentModuleData;
    const chr = d?.chronicle || STATE.currentModule?.chronicle;
    const mod = d?.name      || STATE.currentModule?.name;
    if (!chr || !mod) return;
    (async () => {
      const ok = await showConfirm(t('mod.scen.manualConfirm'), { confirmText: t('ui.btn.create') });
      if (!ok) return;
      manualBtn.disabled = true;
      const origLabel = manualBtn.textContent;
      manualBtn.textContent = t('mod.scen.creating');
      const skeleton = _buildScenarioSkeleton(d.title || d.name || mod, mod);
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${window.location.search}`,
          { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: skeleton }) }
        );
        if (!r.ok) {
          const result = await r.json().catch(() => ({}));
          throw new Error(result.error || t('mod.scen.manualFail'));
        }
        await _reloadModulePage();
      } catch (err) {
        showToast(t('mod.scen.manualFail') + ': ' + err.message, 'error');
        manualBtn.disabled = false;
        manualBtn.textContent = origLabel;
      }
    })();
    return;
  }

  if (e.target.id === 'modp-toggle-gm-btn') {
    STATE.hideGmSections = !STATE.hideGmSections;
    _renderScenarioPanel(STATE.currentModuleData);
    return;
  }

  if (e.target.id === 'modp-add-scene-btn') {
    const d   = STATE.currentModuleData;
    const chr = d?.chronicle || STATE.currentModule?.chronicle;
    const mod = d?.name      || STATE.currentModule?.name;
    if (!chr || !mod) return;
    const addSceneBtn = e.target;
    (async () => {
      addSceneBtn.disabled = true;
      const origLabel = addSceneBtn.textContent;
      addSceneBtn.textContent = t('mod.scen.adding');
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/scene${window.location.search}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
        );
        const result = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(result.error || t('mod.scen.addSceneFail'));
        STATE.currentModuleData.scenario = result.scenario;
        _renderScenarioPanel(STATE.currentModuleData);
        showToast(t('mod.scen.sceneAdded', { heading: result.heading }), 'success');
      } catch (err) {
        showToast(t('mod.scen.addSceneFail') + ': ' + err.message, 'error');
        addSceneBtn.disabled = false;
        addSceneBtn.textContent = origLabel;
      }
    })();
    return;
  }

  if (e.target.id === 'modp-regen-scenario-btn') {
    const d   = STATE.currentModuleData;
    const chr = d?.chronicle || STATE.currentModule?.chronicle;
    const mod = d?.name      || STATE.currentModule?.name;
    if (!chr || !mod) return;

    const btn = e.target;
    (async () => {
      const ok = await showConfirm(t('mod.scen.regenAllConfirm'), { danger: true, confirmText: t('mod.regen') });
      if (!ok) return;
      btn.disabled = true;
      btn.textContent = t('common.generating');
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/fill${window.location.search}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pcs:     (d.pcs  || []).map(p => typeof p === 'string' ? p : p.name),
              npcs:    (d.npcs || []).map(p => typeof p === 'string' ? p : p.name),
              content: d.description || ''
            })
          }
        );
        const result = await r.json();
        if (!r.ok) throw new Error(result.error || t('mod.regenFail'));
        await _reloadModulePage();
      } catch (err) {
        showToast(t('mod.regenFail') + ': ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = `♻ ${t('mod.scen.regenAll')}`;
      }
    })();
    return;
  }

  const regenSecBtn = e.target.closest('[data-scensec-regen]');
  if (regenSecBtn) {
    const idx    = parseInt(regenSecBtn.dataset.scensecRegen, 10);
    const info   = (STATE.scenarioSectionHeadings || [])[idx];
    const d      = STATE.currentModuleData;
    const chr    = d?.chronicle || STATE.currentModule?.chronicle;
    const mod    = d?.name      || STATE.currentModule?.name;
    if (!info || !chr || !mod) return;
    const { heading, parent } = info;

    (async () => {
      const ok = await showConfirm(t('mod.scen.regenSectionConfirm', { heading }), { confirmText: t('mod.regen') });
      if (!ok) return;
      regenSecBtn.disabled = true;
      const origLabel = regenSecBtn.textContent;
      regenSecBtn.textContent = '⏳';
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/section/regenerate${window.location.search}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              heading, parent,
              pcs:  (d.pcs  || []).map(p => typeof p === 'string' ? p : p.name),
              npcs: (d.npcs || []).map(p => typeof p === 'string' ? p : p.name),
            })
          }
        );
        const result = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(result.error || t('mod.regenFail'));
        STATE.currentModuleData.scenario = result.scenario;
        _renderScenarioPanel(STATE.currentModuleData);
      } catch (err) {
        showToast(t('mod.scen.regenSectionFail') + ': ' + err.message, 'error');
        regenSecBtn.disabled = false;
        regenSecBtn.textContent = origLabel;
      }
    })();
    return;
  }

  const editBlockBtn = e.target.closest('[data-editblock]');
  if (editBlockBtn) {
    const block = editBlockBtn.closest('.modp-scenario-block');
    const idxs  = (block?.dataset.fieldIdxs || '').split(',').filter(Boolean);
    idxs.forEach(idx => _modToggleEdit(`scensec${idx}`, true));
    const saveAllBtn = block?.querySelector('[data-blocksaveall]');
    if (saveAllBtn) saveAllBtn.style.display = '';
    return;
  }

  const blockRegenBtn = e.target.closest('[data-blockregen]');
  if (blockRegenBtn) {
    const idx    = parseInt(blockRegenBtn.dataset.blockregen, 10);
    const info   = (STATE.scenarioSectionHeadings || [])[idx];
    const d      = STATE.currentModuleData;
    const chr    = d?.chronicle || STATE.currentModule?.chronicle;
    const mod    = d?.name      || STATE.currentModule?.name;
    if (!info || !chr || !mod) return;
    const heading = info.heading;

    (async () => {
      const ok = await showConfirm(t('mod.scen.regenBlockConfirm', { heading }), { confirmText: t('mod.regen') });
      if (!ok) return;
      blockRegenBtn.disabled = true;
      const origLabel = blockRegenBtn.textContent;
      blockRegenBtn.textContent = t('common.generating');
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/regenerate${window.location.search}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              heading,
              pcs:  (d.pcs  || []).map(p => typeof p === 'string' ? p : p.name),
              npcs: (d.npcs || []).map(p => typeof p === 'string' ? p : p.name),
            })
          }
        );
        const result = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(result.error || t('mod.regenFail'));
        STATE.currentModuleData.scenario = result.scenario;
        _renderScenarioPanel(STATE.currentModuleData);
      } catch (err) {
        showToast(t('mod.scen.regenBlockFail') + ': ' + err.message, 'error');
        blockRegenBtn.disabled = false;
        blockRegenBtn.textContent = origLabel;
      }
    })();
    return;
  }

  const saveAllBtn = e.target.closest('[data-blocksaveall]');
  if (saveAllBtn) {
    const block = saveAllBtn.closest('.modp-scenario-block');
    const idxs  = (block?.dataset.fieldIdxs || '').split(',').filter(Boolean);
    const d     = STATE.currentModuleData;
    const chr   = d?.chronicle || STATE.currentModule?.chronicle;
    const mod   = d?.name      || STATE.currentModule?.name;
    if (!chr || !mod || !idxs.length) return;

    const fields = idxs.map(idx => {
      const info = (STATE.scenarioSectionHeadings || [])[parseInt(idx, 10)];
      const ta   = document.getElementById(`moddet-scensec${idx}-ta`);
      return info ? { heading: info.heading, parent: info.parent, content: ta ? ta.value : '' } : null;
    }).filter(Boolean);
    if (!fields.length) return;

    (async () => {
      saveAllBtn.disabled = true;
      const origLabel = saveAllBtn.textContent;
      saveAllBtn.textContent = t('common.saving');
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/block/fields${window.location.search}`,
          { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }
        );
        const result = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(result.error || t('common.saveError'));
        STATE.currentModuleData.scenario = result.scenario;
        _renderScenarioPanel(STATE.currentModuleData);
        if (Array.isArray(result.skipped) && result.skipped.length) {
          showToast(`${t('mod.scen.saveSkipped', { names: escHtml(result.skipped.join(', ')) })}`, 'error');
        }
      } catch (err) {
        showToast(t('mod.scen.saveBlockFail') + ': ' + err.message, 'error');
        saveAllBtn.disabled = false;
        saveAllBtn.textContent = origLabel;
      }
    })();
    return;
  }
});

// Add an in-play session entry (Phase B)
// Canon consistency check (shared by session form & integrity panel)
function _renderCanonIssues(issues) {
  if (!Array.isArray(issues) || !issues.length)
    return `<div class="canon-ok">✓ ${t('mod.sess.canonOk')}</div>`;
  return `<div class="canon-issues">${issues.map(i => `
    <div class="canon-issue canon-${(i.severity || 'medium')}">
      <span class="canon-issue-char">${escHtml(i.character || '?')}</span>
      <div class="canon-issue-body">
        <div class="canon-issue-text">${escHtml(i.issue || '')}</div>
        ${i.quote ? `<div class="canon-issue-quote">«${escHtml(i.quote)}»</div>` : ''}
      </div>
    </div>`).join('')}</div>`;
}
async function _runCanonCheck(text, box, btn, btnLabel) {
  if (!box) return;
  box.style.display = '';
  if (!text || !text.trim()) {
    box.innerHTML = `<div class="canon-warn">${t('mod.sess.canonEmpty')}</div>`;
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = t('mod.sess.canonBusy'); }
  box.innerHTML = `<div class="canon-loading">🔍 ${t('mod.sess.canonLoading')}</div>`;
  try {
    const qs    = window.location.search;
    const prefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref  = _getPref(prefs, 'prose', 'claude');
    const d = await fetch('/api/canon-check' + qs,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, source: pref.provider, model: pref.model }) }
    ).then(r => r.json());
    box.innerHTML = d.ok ? _renderCanonIssues(d.issues)
                         : `<div class="canon-warn">${t('ui.err')}${escHtml(d.error || t('mod.sess.canonFail'))}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="canon-warn">${t('ui.err')}${escHtml(e.message)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btnLabel || `🔍 ${t('mod.sess.canonBtn')}`; }
  }
}

async function _addSessionEntry() {
  if (!STATE.currentModule) return;
  const { chronicle, name } = STATE.currentModule;
  const btn   = document.getElementById('sess-add-btn');
  const errEl = document.getElementById('sess-error');
  const date   = document.getElementById('sess-date').value.trim();
  const status = document.getElementById('sess-status').value.trim();
  const scenes = document.getElementById('sess-scenes').value.trim();
  const notes  = document.getElementById('sess-notes').value.trim();
  if (!notes && !scenes) {
    errEl.textContent = t('mod.sess.errFill');
    errEl.style.display = ''; return;
  }
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = t('common.saving');
  try {
    const qs = window.location.search;
    const d  = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/session${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, status, scenes, notes }) }
    ).then(r => r.json());
    if (!d.ok) { errEl.textContent = d.error || t('archive.error'); errEl.style.display = ''; return; }
    await _reloadModulePage();
  } catch (e) {
    errEl.textContent = t('ui.err') + e.message; errEl.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = t('mod.sess.add');
  }
}

// Turn a session card into an inline edit form (pre-filled)
function _editSessionEntry(idx) {
  const s = (STATE.currentModuleData?.sessions || [])[idx];
  const card = document.querySelector(`.modp-session[data-sess-idx="${idx}"]`);
  if (!s || !card) return;
  const statusOpts = ['🟡 В процессе', '🟢 Завершён'];
  card.innerHTML = `
    <div class="modp-session-form" style="margin:0">
      <div class="modp-session-form-title">✏️ ${t('mod.sess.editTitle2', { title: escHtml(s.title) })}</div>
      <div class="modp-sf-row">
        <input id="sess-edit-date" class="modp-sf-input" value="${escHtml(s.date || '')}" placeholder="${t('mod.sess.dateShort')}">
        <select id="sess-edit-status" class="modp-sf-input">
          ${statusOpts.map(o => `<option ${o === s.status ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
      </div>
      <input id="sess-edit-scenes" class="modp-sf-input" value="${escHtml(s.scenes || '')}" placeholder="${t('mod.sess.scenesPh')}">
      <textarea id="sess-edit-notes" class="modp-sf-input modp-sf-area" rows="4" placeholder="${t('mod.sess.notesPhShort')}">${escHtml(s.body || '')}</textarea>
      <div style="display:flex;gap:8px;align-items:center">
        <button id="sess-edit-save" class="modp-gen-btn">${t('ui.btn.save')}</button>
        <button id="sess-edit-cancel" class="modp-back-btn">${t('ui.btn.cancel')}</button>
        <div id="sess-edit-error" class="modp-sf-error" style="display:none"></div>
      </div>
    </div>`;
  document.getElementById('sess-edit-save').addEventListener('click', () => _saveSessionEdit(idx));
  document.getElementById('sess-edit-cancel').addEventListener('click', _reloadModulePage);
}

async function _saveSessionEdit(idx) {
  if (!STATE.currentModule) return;
  const { chronicle, name } = STATE.currentModule;
  const btn   = document.getElementById('sess-edit-save');
  const errEl = document.getElementById('sess-edit-error');
  const date   = document.getElementById('sess-edit-date').value.trim();
  const status = document.getElementById('sess-edit-status').value.trim();
  const scenes = document.getElementById('sess-edit-scenes').value.trim();
  const notes  = document.getElementById('sess-edit-notes').value.trim();
  if (!notes && !scenes) {
    errEl.textContent = t('mod.sess.errFill');
    errEl.style.display = ''; return;
  }
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = t('mod.busy');
  try {
    const qs = window.location.search;
    const d  = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/session/${idx}${qs}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, status, scenes, notes }) }
    ).then(r => r.json());
    if (!d.ok) { errEl.textContent = d.error || t('archive.error'); errEl.style.display = ''; return; }
    await _reloadModulePage();
  } catch (e) {
    errEl.textContent = t('ui.err') + e.message; errEl.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = t('ui.btn.save');
  }
}

// Delete a recorded session entry outright (not just edit) — remaining entries'
// «Сессия N» numbering is derived from array position on every write
// (_writeSessionsFile, shared.js), so a delete from the middle renumbers the
// rest automatically, same as the server already does for edits.
async function _deleteSessionEntry(idx) {
  if (!STATE.currentModule) return;
  const s = (STATE.currentModuleData?.sessions || [])[idx];
  if (!s) return;
  if (!await showConfirm(t('mod.sess.delConfirm', { title: escHtml(s.title) }), { danger: true, confirmText: t('ui.btn.delete') })) return;
  const { chronicle, name } = STATE.currentModule;
  try {
    const qs = window.location.search;
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/session/${idx}${qs}`,
      { method: 'DELETE' }
    );
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.error || r.statusText);
    await _reloadModulePage();
  } catch (e) {
    showToast(t('ui.err') + e.message, 'error');
  }
}

// Edit/delete-button delegation on the (static) sessions panel — survives innerHTML rebuilds
document.getElementById('modp-panel-sessions').addEventListener('click', e => {
  const editBtn = e.target.closest('.modp-session-edit');
  if (editBtn) { _editSessionEntry(+editBtn.dataset.sessIdx); return; }
  const delBtn = e.target.closest('.modp-session-delete');
  if (delBtn) _deleteSessionEntry(+delBtn.dataset.sessIdx);
});

// НПС-panel delegation — open card on name click, generate replies, manage sheets
document.getElementById('modp-panel-npcs').addEventListener('click', e => {
  const dlgBtn = e.target.closest('.modp-npc-dlg-btn');
  if (dlgBtn) { _genModuleNpcDialogue(dlgBtn); return; }
  const sheetBtn = e.target.closest('.modp-sheet-btn');
  if (sheetBtn) { _onModuleSheetBtn(sheetBtn); return; }
  const promoteBtn = e.target.closest('.modp-promote-btn');
  if (promoteBtn) { _onPromoteNpc(promoteBtn); return; }
  const delBtn = e.target.closest('[data-npc-del-name]');
  if (delBtn) { _onDeleteModuleNpc(delBtn.dataset.npcDelName, delBtn.dataset.npcDelGroup); return; }
  const link = e.target.closest('[data-open-char]');
  if (link) { e.preventDefault(); openCharDetail(link.dataset.openChar); }

  // Show/hide NPC add form
  if (e.target.id === 'modp-add-npc-btn') {
    const form = document.getElementById('modp-npc-add-form');
    if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
    return;
  }

  // Hide NPC add form
  if (e.target.id === 'modp-npc-add-cancel') {
    const form = document.getElementById('modp-npc-add-form');
    if (form) form.style.display = 'none';
    return;
  }

  // Init npc.md
  if (e.target.id === 'modp-init-npcmd-btn') {
    const d   = STATE.currentModuleData;
    const chr = d?.chronicle || STATE.currentModule?.chronicle;
    const mod = d?.name      || STATE.currentModule?.name;
    if (!chr || !mod) return;
    const btn = e.target;
    btn.disabled = true;
    (async () => {
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/npc${window.location.search}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initOnly: true }) }
        );
        if (!r.ok) throw new Error(await r.text());
        await _reloadModulePage();
      } catch (err) {
        showToast(t('ui.err') + err.message, 'error');
        btn.disabled = false;
      }
    })();
    return;
  }

  // Submit NPC add form
  if (e.target.id === 'modp-npc-add-submit') {
    const d     = STATE.currentModuleData;
    const chr   = d?.chronicle || STATE.currentModule?.chronicle;
    const mod   = d?.name      || STATE.currentModule?.name;
    const name  = document.getElementById('modp-npc-add-name')?.value?.trim();
    const group = document.getElementById('modp-npc-add-group')?.value || 'modular';
    const msg   = document.getElementById('modp-npc-add-msg');
    if (!name) {
      if (msg) { msg.textContent = `⚠ ${t('mod.npcs.errName')}`; msg.style.display = ''; }
      return;
    }
    const btn = e.target;
    if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
    btn.disabled = true;
    (async () => {
      try {
        const r = await fetch(
          `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/npc${window.location.search}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, group }) }
        );
        const result = await r.json();
        if (!r.ok) throw new Error(result.error || t('mod.npcs.errAdd'));
        await _reloadModulePage();
      } catch (err) {
        if (msg) { msg.textContent = '✗ ' + err.message; msg.style.display = ''; }
        btn.disabled = false;
      }
    })();
    return;
  }
});

// Promote episodic NPC to canonical character
async function _onPromoteNpc(btn) {
  if (!STATE.currentModule) return;
  const { chronicle, name: mod } = STATE.currentModule;
  const slug    = btn.dataset.promoteSlug;
  const npcName = btn.dataset.promoteName;
  const isReady = btn.classList.contains('ready');

  const LINEAGES = [
    { value: 'vampires', label: `🧛 ${t('mod.lineage.vampire')}` },
    { value: 'mortals',  label: `🧑 ${t('mod.lineage.mortal')}` },
    { value: 'fairies',  label: `🧚 ${t('mod.lineage.fairy')}` },
    { value: 'werewolves', label: `🐺 ${t('mod.lineage.werewolf')}` },
    { value: 'mages',    label: `🔮 ${t('mod.lineage.mage')}` },
    { value: 'hunters',  label: `🏹 ${t('mod.lineage.hunter')}` },
  ];

  const condMsg = btn.title ? `\n${t('mod.promote.conditions')}: ${btn.title}` : '';
  const forceMsg = isReady ? '' : `\n⚠️ ${t('mod.promote.forceWarn')}`;
  const lineage  = prompt(
    t('mod.promote.prompt', { name: npcName, condMsg, forceMsg, lineages: LINEAGES.map((l, i) => `${i + 1}. ${l.label}`).join('\n') }),
    '1'
  );
  if (lineage === null) return;
  const idx = (parseInt(lineage, 10) || 1) - 1;
  const chosen = LINEAGES[Math.max(0, Math.min(idx, LINEAGES.length - 1))];

  btn.disabled = true;
  btn.textContent = t('mod.busy2');
  try {
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(mod)}/npc/${encodeURIComponent(slug)}/promote`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineage: chosen.value, force: !isReady }) }
    );
    const d = await r.json();
    if (!r.ok) {
      showToast(`${t('ui.err')}${d.error || r.status}\n${d.conditions ? JSON.stringify(d.conditions, null, 2) : ''}`, 'error');
      btn.disabled = false;
      btn.textContent = `⬆ ${t('mod.promote.btn')}`;
      return;
    }
    btn.textContent = t('mod.promote.done');
    btn.style.color = 'var(--gold)';
    // Refresh module page so the NPC now shows as canonical
    setTimeout(loadModulePage, 800);
  } catch (err) {
    showToast(`${t('ui.err')}${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = `⬆ ${t('mod.promote.btn')}`;
  }
}

// Delete an entry (НПС or ПК) from the module's npc.md — from either the card
// grid (✕) or the detailed list (🗑). Modular НПС also lose their own card
// folder (npc/<slug>/ — it only ever existed for this module), so warn louder
// for that case; canon/ПК entries just drop the reference line, the roster
// character itself is never touched.
async function _onDeleteModuleNpc(name, group) {
  if (!STATE.currentModule) return;
  const { chronicle, name: mod } = STATE.currentModule;
  const msg = group === 'modular'
    ? t('mod.npcDel.modularConfirm', { name: escHtml(name) })
    : t('mod.npcDel.canonConfirm', { name: escHtml(name) });
  if (!await showConfirm(msg, { danger: true, confirmText: t('ui.btn.delete') })) return;
  try {
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(mod)}/npc${window.location.search}`,
      { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, group }) }
    );
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.error || r.statusText);
    await _reloadModulePage();
  } catch (e) {
    showToast(`${t('ui.err')}${e.message}`, 'error');
  }
}

// Handle a sheet button on the module NPC tab (generate / view / regenerate / edit)
async function _onModuleSheetBtn(btn) {
  const wrap  = btn.closest('.modp-npc-sheet');
  const scope = wrap.dataset.sheetScope;
  const ctx = scope === 'module'
    ? { scope: 'module', label: wrap.dataset.sheetName, chr: STATE.currentModule.chronicle, mod: STATE.currentModule.name, slug: wrap.dataset.sheetSlug, onSaved: loadModulePage }
    : { scope: 'character', name: wrap.dataset.sheetName, slug: wrap.dataset.sheetSlug, label: wrap.dataset.sheetName, onSaved: loadModulePage };
  const act = btn.dataset.sheetAct;
  if (act === 'view') { openSheetOverlay(ctx, 'view'); return; }
  if (act === 'edit') { openSheetOverlay(ctx, 'edit'); return; }
  if (act === 'regen' && !await showConfirm(t('mod.sheet.regenConfirm'), { danger: true, confirmText: t('mod.regen') })) return;
  _generateSheet(ctx, btn);
}

// Back button
document.getElementById('modp-back-btn').addEventListener('click', () => navigate('modules'));

// ── Сворачивание шапки модуля (кнопка «▴» рядом с заголовком) — тот же паттерн,
// что и сворачивание сайдбара (scripts.js, KEY='sanguine-sidebar-collapsed'),
// свой ключ localStorage, глобальный (не per-модуль). ──────────────────────────
(function () {
  const KEY = 'sanguine-module-header-collapsed';
  const btn = document.getElementById('modp-header-collapse-btn');
  const header = document.querySelector('.modp-header');
  if (!btn || !header) return;

  function apply(collapsed) {
    header.classList.toggle('collapsed', collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
    const label = collapsed ? t('modp.collapse.expand') : t('modp.collapse.title');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    // Сворачивание закрывает открытую форму правки заголовка — иначе она остаётся
    // в DOM развёрнутой под max-height:0. #modp-header-edit-btn НЕ тумблер (только
    // открывает форму) — закрывает её #modp-hedit-cancel.
    if (collapsed) {
      const editBlock = document.getElementById('modp-header-edit');
      if (editBlock && editBlock.style.display !== 'none') {
        document.getElementById('modp-hedit-cancel')?.click();
      }
    }
  }

  let collapsed = false;
  try { collapsed = localStorage.getItem(KEY) === '1'; } catch {}
  apply(collapsed);

  btn.addEventListener('click', () => {
    collapsed = !collapsed;
    apply(collapsed);
    try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch {}
  });
})();

// ── Header quick-edit: название/тип/дата/тон/хроника ──────────────────────────
document.getElementById('modp-header-edit-btn').addEventListener('click', async () => {
  const data = STATE.currentModuleData || {};
  document.getElementById('modp-hedit-title').value = data.title || data.name || '';
  document.getElementById('modp-hedit-type').value  = data.type  || '';
  document.getElementById('modp-hedit-time').value  = data.time  || '';
  document.getElementById('modp-hedit-tone').value  = data.tone  || '';
  document.getElementById('modp-hedit-format').value = data.format || '';
  document.getElementById('modp-hedit-track').checked = data.trackInChronology !== false;

  document.getElementById('modp-title').style.display  = 'none';
  document.getElementById('modp-badges').style.display  = 'none';
  document.getElementById('modp-header-edit').style.display = '';

  const chrSel = document.getElementById('modp-hedit-chronicle');
  chrSel.innerHTML = `<option value="">⏳ ${t('ui.loading')}</option>`;
  try {
    const qs = window.location.search;
    const baseQs = qs ? qs + '&include_hidden=1' : '?include_hidden=1';
    const chrs = await fetch(`/api/chronicles${baseQs}`).then(r => r.json());
    chrSel.innerHTML = (Array.isArray(chrs) ? chrs : []).map(c =>
      `<option value="${escAttr(c.slug)}"${c.slug === data.chronicle ? ' selected' : ''}>${escHtml((c.hidden ? '📂 ' : '') + (c.display || c.slug))}</option>`
    ).join('');
  } catch {
    chrSel.innerHTML = `<option value="${escAttr(data.chronicle || '')}">${escHtml(data.chronicle || '')}</option>`;
  }
});

document.getElementById('modp-hedit-cancel').addEventListener('click', () => {
  document.getElementById('modp-header-edit').style.display = 'none';
  document.getElementById('modp-title').style.display  = '';
  document.getElementById('modp-badges').style.display  = '';
});

document.getElementById('modp-hedit-save').addEventListener('click', async () => {
  if (!STATE.currentModule) return;
  const { chronicle, name } = STATE.currentModule;
  const qs    = window.location.search;
  const msgEl = document.getElementById('modp-hedit-msg');
  const btn   = document.getElementById('modp-hedit-save');

  const title = document.getElementById('modp-hedit-title').value.trim();
  const type  = document.getElementById('modp-hedit-type').value.trim();
  const time  = document.getElementById('modp-hedit-time').value.trim();
  const tone   = document.getElementById('modp-hedit-tone').value.trim();
  const format = document.getElementById('modp-hedit-format').value.trim();
  const track  = document.getElementById('modp-hedit-track').checked;
  const toChr  = document.getElementById('modp-hedit-chronicle').value;

  if (!title) { showToast(t('mod.hedit.errTitle'), 'warning'); return; }
  if (!time)  { showToast(t('mod.hedit.errTime'), 'warning'); return; }

  btn.disabled = true;
  try {
    const r = await fetch(`/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/fields${qs}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { title, type, time, tone, format, trackInChronology: track } }),
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);

    if (toChr && toChr !== chronicle) {
      const mv = await fetch(`/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/move${qs}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toChronicle: toChr }),
      }).then(r => r.json());
      if (!mv.ok) throw new Error(mv.error || t('mod.hedit.moveFail'));
      STATE.currentModule.chronicle = toChr;
    }

    document.getElementById('modp-header-edit').style.display = 'none';
    document.getElementById('modp-title').style.display  = '';
    document.getElementById('modp-badges').style.display  = '';
    if (msgEl) { msgEl.style.display = ''; msgEl.textContent = t('modp.edit.saved'); setTimeout(() => { msgEl.style.display = 'none'; }, 2000); }
    await loadModulePage();
  } catch (e) {
    showToast(t('ui.err') + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// Generate module button — direct generation from existing module data
document.getElementById('modp-gen-btn').addEventListener('click', async () => {
  if (!STATE.currentModule) return;
  const { chronicle, name } = STATE.currentModule;
  const data = STATE.currentModuleData || {};
  const btn  = document.getElementById('modp-gen-btn');

  if (data.scenario && !await showConfirm(t('mod.genConfirm'), { danger: true, confirmText: t('mod.regen') })) return;

  btn.disabled = true; btn.textContent = t('common.generating');
  btn.setAttribute('aria-busy', 'true');
  try {
    const qs      = window.location.search;
    const prefs   = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const locPref = _getPref(prefs, 'locations', 'openrouter');
    const pcs     = (data.pcs  || []).map(p => p.name || p);
    const npcs    = (data.npcs || []).map(p => p.name || p);

    const d = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/fill${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pcs, npcs, content: '', locSource: locPref.provider, locModel: locPref.model }) }
    ).then(r => r.json());

    if (!d.ok) { showToast(t('mod.errGenPrefix') + (d.error || t('mod.unknownError')), 'error'); return; }

    const lines = [t('mod.genOk', { file: d.file })];
    if (d.locations?.length)       lines.push(t('mod.genNewLocs', { n: d.locations.length, names: d.locations.join(', ') }));
    if (d.reusedLocations?.length) lines.push(t('mod.genReusedLocs', { names: d.reusedLocations.join(', ') }));
    if (d.npcs?.length)            lines.push(t('mod.genNewNpcs', { n: d.npcs.length, names: d.npcs.join(', ') }));
    if (d.canonNpcs?.length)       lines.push(t('mod.genCanonNpcs', { names: d.canonNpcs.join(', ') }));
    if (d.timelineWarnings?.length) {
      lines.push('');
      lines.push(t('mod.genTimelineWarnTitle'));
      for (const w of d.timelineWarnings) {
        const sev = w.severity === 'high' ? '🔴' : '🟡';
        lines.push(`${sev} ${w.character}: ${w.issue}`);
      }
    }
    if (d.missingTopics?.length) {
      lines.push('');
      lines.push(t('mod.genMissingTopics', { names: d.missingTopics.map(t => t.label).join(', ') }));
    }
    const resultEl = document.getElementById('modp-gen-result');
    if (resultEl) {
      resultEl.innerHTML = `<div class="modp-gen-result-inner">
        <div class="modp-gen-result-title">${t('mod.genResultTitle')}</div>
        ${lines.slice(1).map(l => l ? `<div>${escHtml(l)}</div>` : '').join('')}
      </div>`;
      resultEl.style.display = '';
      setTimeout(() => { resultEl.style.display = 'none'; }, 8000);
    }
    _reloadModulePage();
  } catch (e) {
    showToast(t('ui.err') + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = t('modp.gen');
    btn.removeAttribute('aria-busy');
  }
});

// Close module (Phase C — module-close rules)
document.getElementById('modp-close-btn').addEventListener('click', () => {
  if (!STATE.currentModule) return;
  const data = STATE.currentModuleData || {};
  document.getElementById('modp-close-nosessions').style.display = (data.sessions || []).length ? 'none' : '';
  document.getElementById('modp-close-diaries-check').checked = false;
  openModal('modp-close-modal');
});
document.getElementById('modp-close-cancel-btn').addEventListener('click', () => {
  closeModal('modp-close-modal');
});
document.getElementById('modp-close-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modp-close-modal'))
    closeModal('modp-close-modal');
});

// Месяц-название (РУ) → номер месяца — грубый эвристический разбор свободного
// текста поля «Время» модуля («Декабрь 2001, пятница») в период ГГГГ-ММ для
// дневников. Возвращает null, если год/месяц уверенно не определяются —
// тогда дневники остаются полностью ручным шагом, как и раньше.
const _RU_MONTH_STEMS = ['янв', 'февр', 'март', 'апрел', 'май', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'нояб', 'дек'];
function _parsePeriodFromModuleTime(text) {
  const t = String(text || '').toLowerCase();
  const yearM = t.match(/\b(19|20)\d{2}\b/);
  if (!yearM) return null;
  const monthIdx = _RU_MONTH_STEMS.findIndex(stem => t.includes(stem));
  if (monthIdx === -1) return null;
  return `${yearM[0]}-${String(monthIdx + 1).padStart(2, '0')}`;
}

// Дневники по завершении модуля — опционально (чекбокс), по умолчанию выключено:
// по правилам Фазы C (module_rules.md) это ручной шаг, здесь просто убирает его
// для тех, кто хочет батч-генерацию по всем участникам-персонажам сразу.
async function _generateDiariesForModule(data, period) {
  const qs = window.location.search;
  const allChars = await fetch(`/api/characters${qs}`).then(r => r.json()).catch(() => []);
  const wantedNames = new Set();
  (data.pcs || []).forEach(p => wantedNames.add(typeof p === 'string' ? p : p.name));
  (data.npcGroups || []).forEach(g => { if (g.kind === 'canon') g.entries.forEach(e => wantedNames.add(e.name)); });

  const targets = [...wantedNames]
    .map(name => allChars.find(c => c.name === name))
    .filter(Boolean);

  const prefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
  const prose = _getPref(prefs, 'prose', 'openrouter');
  const session = data.title || data.name || '';

  let created = 0; const errors = [];
  for (const ch of targets) {
    try {
      const gen = await fetch(`/api/characters/${encodeURIComponent(ch.slug)}/diary/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, session, preferSource: prose.provider, orModel: (prose.provider === 'openrouter' || prose.provider === 'lmstudio') ? prose.model : null }),
      }).then(r => r.json());
      if (gen.error || !gen.text) { errors.push(ch.name); continue; }
      const save = await fetch(`/api/characters/${encodeURIComponent(ch.slug)}/diary`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, session, text: gen.text }),
      }).then(r => r.json());
      if (save.error) { errors.push(ch.name); continue; }
      created++;
    } catch { errors.push(ch.name); }
  }
  return { created, errors, total: targets.length };
}

document.getElementById('modp-close-confirm-btn').addEventListener('click', async () => {
  if (!STATE.currentModule) return;
  const { chronicle, name } = STATE.currentModule;
  const data = STATE.currentModuleData || {};
  const wantDiaries = document.getElementById('modp-close-diaries-check').checked;
  closeModal('modp-close-modal');

  const btn = document.getElementById('modp-close-btn');
  btn.disabled = true; btn.textContent = t('mod.close.busy');
  try {
    const qs    = window.location.search;
    const prefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const prose = _getPref(prefs, 'prose', 'claude');
    const d = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/close${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: prose.provider, model: prose.model }) }
    ).then(r => r.json());
    if (!d.ok) { showToast(t('mod.errClosePrefix') + (d.error || t('mod.unknownError')), 'error'); return; }
    const lines = [t('mod.close.done')];
    if (d.finale)  lines.push(t('mod.close.finaleCreated'));
    if (d.event)   lines.push(t('mod.close.eventAdded'));

    if (wantDiaries) {
      const period = _parsePeriodFromModuleTime(data.time);
      if (!period) {
        lines.push(t('mod.close.diaryNoPeriod'));
      } else {
        const diaryResult = await _generateDiariesForModule(data, period);
        if (diaryResult.total === 0) lines.push(t('mod.close.diaryNoTargets'));
        else {
          lines.push(t('mod.close.diariesMade', { period, n: diaryResult.created, total: diaryResult.total }));
          if (diaryResult.errors.length) lines.push(t('mod.close.diariesFailed', { names: diaryResult.errors.join(', ') }));
        }
      }
    }

    if (d.reminders?.length) lines.push('', t('mod.close.remaining'), ...d.reminders.map(r => '• ' + r));
    showToast(lines.join('\n'), 'success');
    loadModulePage();
  } catch (e) {
    showToast(t('ui.err') + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = t('modp.close');
  }
});

// Delete module (+ cleanup of chronicle events, diary links, modular NPCs)
document.getElementById('modp-del-btn').addEventListener('click', async () => {
  if (!STATE.currentModule) return;
  const { chronicle, name } = STATE.currentModule;
  const qs = window.location.search;

  // Load preview data before showing modal
  const preview = await fetch(
    `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}/delete-preview${qs}`
  ).then(r => r.json()).catch(() => null);

  const previewEl = document.getElementById('modp-del-preview');
  if (previewEl) {
    const parts = [];
    if (preview?.fileCount)           parts.push(`${t('mod.delPreview.mdFiles')}: <b>${preview.fileCount}</b>`);
    if (preview?.modularNpcs?.length) parts.push(`${t('mod.delPreview.modularNpcs')}: <b>${escHtml(preview.modularNpcs.join(', '))}</b>`);
    if (preview?.eventCount)          parts.push(`${t('mod.delPreview.eventCount')}: <b>${preview.eventCount}</b>`);
    if (preview?.affectedChars?.length) parts.push(`${t('mod.delPreview.diaries')}: <b>${escHtml(preview.affectedChars.join(', '))}</b>`);
    previewEl.innerHTML = parts.length
      ? `<ul style="margin:0;padding-left:18px">${parts.map(p => `<li>${p}</li>`).join('')}</ul>`
      : `<div style="color:var(--text2)">${t('mod.delPreview.noData')}</div>`;
  }

  const unlockCheck = document.getElementById('modp-del-unlock-check');
  const confirmBtn  = document.getElementById('modp-del-confirm-btn');
  if (unlockCheck) unlockCheck.checked = false;
  if (confirmBtn)  confirmBtn.disabled = true;
  if (unlockCheck) unlockCheck.onchange = () => {
    if (confirmBtn) confirmBtn.disabled = !unlockCheck.checked;
  };

  document.getElementById('modp-del-cancel-btn').onclick = () => {
    closeModal('modp-delete-modal');
  };

  document.getElementById('modp-del-confirm-btn').onclick = async () => {
    closeModal('modp-delete-modal');
    const delBtn = document.getElementById('modp-del-btn');
    if (delBtn) { delBtn.disabled = true; delBtn.textContent = t('common.deleting'); }
    try {
      const d = await fetch(
        `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(name)}${qs}`,
        { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }
      ).then(r => r.json());
      if (!d.ok) { showToast(t('mod.errDeletePrefix') + (d.error || t('mod.unknownError')), 'error'); return; }
      navigate('modules');
    } catch (e) {
      showToast(t('ui.err') + e.message, 'error');
    } finally {
      if (delBtn) { delBtn.disabled = false; delBtn.textContent = t('modp.delete'); }
    }
  };

  openModal('modp-delete-modal');
});

document.getElementById('modp-delete-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modp-delete-modal'))
    closeModal('modp-delete-modal');
});

// Global click delegation for md-link-char / md-link-loc produced by resolveMdLink()
document.addEventListener('click', e => {
  const charLink = e.target.closest('.md-link-char');
  if (charLink) {
    e.preventDefault();
    const slug = charLink.dataset.charSlug;
    ensureCharsLoaded().then(() => openCharDetail(slug));
    return;
  }
  const locLink = e.target.closest('.md-link-loc');
  if (locLink) {
    e.preventDefault();
    const slug = locLink.dataset.locSlug;
    if (slug) openLocDetail(slug);
  }
});

