'use strict';
// Инструменты → 🗑️ Удалённые: просмотр корзин (мягко удалённые сущности активного
// города + удалённые города + Библиотека), одиночное/массовое восстановление,
// окончательное удаление. Спека: docs/design/2026-09-13-trash-tab-techspec.md (D6).
// Паттерн вкладки — backup.js; обратная связь по действиям — showToast (проект).

let _trashLoaded = false;
let _trsFlashSec = null; // ключ секции для подсветки после reload

async function loadTrashTab() {
  if (_trashLoaded) return;
  _trashLoaded = true;
  const el = document.getElementById('trash-content');
  el.innerHTML = `<div class="loading-state"><div class="spinner"></div>${t('ui.loading')}...</div>`;
  try {
    const data = await fetch(`/api/trash?city=${encodeURIComponent(CITY)}`).then(r => r.json());
    if (!data.ok) throw new Error(data.error || t('trash.loadError'));
    el.innerHTML = renderTrashPanel(data.deleted || {});
    wireTrashHandlers();
    if (_trsFlashSec) {
      const sec = el.querySelector(`.trs-section[data-sec="${_trsFlashSec}"]`);
      if (sec) { sec.classList.add('trs-flash'); setTimeout(() => sec.classList.remove('trs-flash'), 1400); }
      _trsFlashSec = null;
    }
  } catch (e) {
    _trashLoaded = false;
    el.innerHTML = `
      <div class="cdet-empty">${t('trash.loadError')}: ${escHtml(e.message)}</div>
      <button class="btn-submit btn-secondary" id="trs-retry">${t('trash.retry')}</button>`;
    document.getElementById('trs-retry').addEventListener('click', loadTrashTab);
  }
}

// Заголовки категорий Библиотеки (для подписей секций).
const TRS_LIB_LABELS = {
  disciplines: t('trash.lib.disciplines'), psychics: t('trash.lib.psychics'),
  clans: t('trash.lib.clans'), sects: t('trash.lib.sects'), titles: t('trash.lib.titles'),
  'mortal-government': t('trash.lib.mortal-government'), 'mortal-religious': t('trash.lib.mortal-religious'),
  'mortal-crime': t('trash.lib.mortal-crime'), 'mortal-civic': t('trash.lib.mortal-civic'),
  'mortal-positions': t('trash.lib.mortal-positions'),
  merits: t('trash.lib.merits'), flaws: t('trash.lib.flaws'), backgrounds: t('trash.lib.backgrounds'),
};

const TRS_SECTIONS = [
  { key: 'cities',     title: '🏙 ' + t('trash.section.cities'),    kind: 'city' },
  { key: 'characters', title: '🧛 ' + t('trash.section.characters'), kind: 'character' },
  { key: 'locations',  title: '📍 ' + t('trash.section.locations'),  kind: 'location' },
  { key: 'districts',  title: '🏘 ' + t('trash.section.districts'),  kind: 'district' },
  { key: 'chronicles', title: '📜 ' + t('trash.section.chronicles'), kind: 'chronicle' },
  { key: 'modules',    title: '🧩 ' + t('trash.section.modules'),    kind: 'module' },
];

const TRS_LINEAGE_LABEL = {
  vampires: '🧛 ' + t('trash.lineage.vampire'), fairies: '🧚 ' + t('trash.lineage.fairy'), mortals: '🧑 ' + t('trash.lineage.mortal'),
  werewolves: '🐺 ' + t('trash.lineage.werewolf'), mages: '🔮 ' + t('trash.lineage.mage'), hunters: '🏹 ' + t('trash.lineage.hunter'),
};

function _trsDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return escHtml(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function _trsDetail(row) {
  if (row.kind === 'character') return TRS_LINEAGE_LABEL[row.lineage] || row.lineage || row.detail || '';
  return row.detail || '';
}

function _trsRow(row, secKey) {
  const q = `data-sec="${secKey}" data-kind="${escAttr(row.kind)}" data-stored="${escAttr(row.storedName)}" data-dir="${escAttr(row.dir || '')}"`;
  return `
    <div class="trs-row" ${q}>
      <input type="checkbox" class="trs-cb" ${q} aria-label="${t('trash.select')} ${escAttr(row.display)}">
      <span class="trs-name">${escHtml(row.display)}</span>
      ${_trsDetail(row) ? `<span class="trs-detail">${escHtml(_trsDetail(row))}</span>` : ''}
      <span class="trs-date">${_trsDate(row.deletedAt)}</span>
      <div class="trs-actions">
        <button class="ls-del trs-act" data-act="restore" ${q} title="${t('trash.restore')}" aria-label="${t('trash.restore')} ${escAttr(row.display)}">↩️</button>
        <button class="ls-del trs-act trs-act-danger" data-act="purge" ${q} title="${t('trash.purge')}" aria-label="${t('trash.purge')} ${escAttr(row.display)}">🗑</button>
      </div>
    </div>`;
}

function _trsSectionHtml(section, subtitle, rows, note) {
  const secKey = section.key;
  return `
    <div class="ls-section trs-section" data-sec="${secKey}">
      <div class="ls-sec-title">${section.title}${subtitle ? `<span class="trs-sub">${escHtml(subtitle)}</span>` : ''}</div>
      <label class="bkp-city-row bkp-city-row--all trs-all-row">
        <input type="checkbox" class="trs-all-cb" data-sec="${secKey}" aria-label="${t('trash.selectAllInSection')}">
        <span class="bkp-city-name">${t('trash.selectAll')}</span>
        <span class="trs-count">(${rows.length})</span>
      </label>
      <div class="trs-rows">${rows.map(r => _trsRow(r, secKey)).join('')}</div>
      <div class="trs-actions-bar">
        <button class="ls-add trs-bulk" data-act="restore" data-sec="${secKey}" disabled>${t('trash.restoreSelected')}</button>
        <button class="ls-add trs-danger-btn trs-bulk" data-act="purge" data-sec="${secKey}" disabled>${t('trash.purgeSelected')}</button>
        <span class="trs-links">
          <button class="ls-add trs-all" data-act="restore" data-sec="${secKey}">${t('trash.restoreAll')}</button>
          <button class="ls-add trs-all trs-all-danger" data-act="purge" data-sec="${secKey}">${t('trash.purgeAll')}</button>
        </span>
      </div>
      ${note ? `<p class="trs-note">${note}</p>` : ''}
    </div>`;
}

function renderTrashPanel(deleted) {
  const citySub = CITY ? `${t('trash.cityPrefix')} ${CITY}` : '';
  const note = t('trash.restoreNote');

  const perFast = key => (deleted[key] || []).length;
  const lib = deleted.library || {};
  const total = Object.values(deleted).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0)
    + Object.values(lib).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);

  if (total === 0) {
    return '<div class="cdet-empty">🗑 ' + t('trash.empty') + '</div>';
  }

  let cards = '';
  for (const sec of TRS_SECTIONS) {
    if (!perFast(sec.key)) continue;
    cards += _trsSectionHtml(sec, sec.key === 'cities' ? t('trash.subAllCities') : citySub, deleted[sec.key], note);
  }

  const libDirs = Object.keys(TRS_LIB_LABELS).filter(d => Array.isArray(lib[d]) && lib[d].length);
  for (const dir of libDirs) {
    cards += _trsSectionHtml(
      { key: `library_${dir}`, title: `📚 ${TRS_LIB_LABELS[dir]}` },
      t('trash.subLibrary'),
      lib[dir],
      note);
  }

  const out = `
    <div class="trs-grid">${cards}</div>
    <div class="ls-section bkp-danger-zone trs-global">
      <div class="ls-sec-title bkp-danger-title">⚠ ${t('trash.globalTitle')}</div>
      <p class="form-hint" style="font-style:normal;margin-bottom:14px">
        ${t('trash.globalHint')}
      </p>
      <div class="btn-row">
        <button class="btn-submit btn-secondary" id="trs-global-restore">${t('trash.restoreAll')}</button>
        <button class="btn-submit bkp-restore-btn" id="trs-global-purge">${t('trash.purgeAllDeleted')}</button>
      </div>
    </div>`;

  return out;
}

// ── События ────────────────────────────────────────────────────────────────────

function wireTrashHandlers() {
  const container = document.getElementById('trash-content');
  let busy = 0;

  const setBusy = on => {
    busy += on ? 1 : -1;
    const active = busy > 0;
    container.querySelectorAll('.trs-act, .trs-bulk, .trs-all, #trs-global-restore, #trs-global-purge').forEach(b => { b.disabled = active; });
  };

  const rowsOf = sec => Array.from(container.querySelectorAll(`.trs-row[data-sec="${sec}"]`));
  const cbOf = sec => Array.from(container.querySelectorAll(`.trs-cb[data-sec="${sec}"]`));
  // Ошибка действия показывается в самой секции (D6.2): div `.trs-error` под кнопками.
  const secError = (sec, msg) => {
    const secEl = container.querySelector(`.trs-section[data-sec="${sec}"]`);
    if (!secEl) return;
    let err = secEl.querySelector('.trs-error');
    if (!err) { err = document.createElement('div'); err.className = 'trs-error'; secEl.appendChild(err); }
    err.textContent = msg;
    err.hidden = false;
  };
  const syncAllFor = sec => {
    const cbs = cbOf(sec);
    const all = container.querySelector(`.trs-all-cb[data-sec="${sec}"]`);
    if (!all) return;
    const checked = cbs.filter(c => c.checked).length;
    all.checked = cbs.length > 0 && checked === cbs.length;
    all.indeterminate = checked > 0 && checked < cbs.length;
    container.querySelectorAll(`.trs-bulk[data-sec="${sec}"]`).forEach(b => { b.disabled = checked === 0; });
  };
  const syncAll = () => Array.from(container.querySelectorAll('.trs-all-cb')).forEach(a => syncAllFor(a.dataset.sec));

  container.querySelectorAll('.trs-all-cb').forEach(all => {
    all.addEventListener('change', () => {
      cbOf(all.dataset.sec).forEach(c => { c.checked = all.checked; });
      syncAllFor(all.dataset.sec);
    });
  });
  container.querySelectorAll('.trs-cb').forEach(cb => cb.addEventListener('change', () => syncAllFor(cb.dataset.sec)));

  const reload = () => { _trashLoaded = false; loadTrashTab(); };
  const cityScoped = k => k === 'character' || k === 'location' || k === 'district' || k === 'chronicle' || k === 'module';

  // Одиночные действия на строке.
  container.querySelectorAll('.trs-act').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.trs-row');
      const act = btn.dataset.act;
      const body = {
        city: cityScoped(row.dataset.kind) ? CITY : null,
        kind: row.dataset.kind, storedName: row.dataset.stored, dir: row.dataset.dir || '',
      };

      if (act === 'purge') {
        const ok = await showConfirm(`${t('trash.purgeOne', { name: escHtml(row.dataset.stored) })} ${t('trash.irreversible')}.`, { danger: true, confirmText: t('ui.btn.delete') });
        if (!ok) return;
      }

      setBusy(true);
      try {
        const resp = await fetch(act === 'restore' ? '/api/trash/restore' : '/api/trash', {
          method: act === 'restore' ? 'POST' : 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(act === 'restore' ? body : { ...body, storedNames: [body.storedName] }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || t('trash.opFailed'));
        if (act === 'restore') { _trsFlashSec = row.dataset.sec; showToast(t('trash.restored'), 'success'); }
        else showToast(t('trash.purged'), 'success');
        reload();
      } catch (e) {
        showToast(e.message, 'error');
        secError(row.dataset.sec, e.message);
      } finally {
        setBusy(false);
      }
    });
  });

  // Массовые операции секции (выбранные / всё в секции).
  container.querySelectorAll('.trs-bulk, .trs-all').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sec = btn.dataset.sec;
      const isSectionAll = btn.classList.contains('trs-all');
      const cbs = isSectionAll ? rowsOf(sec) : cbOf(sec).filter(c => c.checked);
      if (!cbs.length) return;
      const kind = cbs[0].dataset.kind || '';
      const storedNames = cbs.map(c => c.dataset.stored);

      const isRestore = btn.dataset.act === 'restore';
      if (!isRestore) {
        const full = storedNames.length === cbOf(sec).length;
        const ok = await showConfirm(
          full ? `${t('trash.purgeSection')} ${t('trash.irreversible')}.` : `${t('trash.purgeMany', { n: storedNames.length })} ${t('trash.irreversible')}.`,
          { danger: true, confirmText: t('ui.btn.delete') });
        if (!ok) return;
      } else {
        const ok = await showConfirm(t('trash.restoreMany', { n: storedNames.length }), { confirmText: t('ui.btn.restore') });
        if (!ok) return;
      }

      setBusy(true);
      try {
        const resp = await fetch(isRestore ? '/api/trash/bulk' : '/api/trash', {
          method: isRestore ? 'POST' : 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            city: CITY, kind, dir: cbs[0].dataset.dir || '', storedNames,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || t('trash.opFailed'));
        const done = data.restored ?? data.purged ?? 0;
        const failed = data.failed || [];
        if (failed.length) {
          showToast(`${isRestore ? t('trash.restored') : t('trash.purged')}: ${done}, ${t('trash.failed')}: ${failed.map(f => f.error).join('; ')}`,
            failed.length === storedNames.length ? 'error' : 'warning');
        } else {
          showToast(`${isRestore ? t('trash.restored') : t('trash.purged')}: ${done}`, 'success');
        }
        if (isRestore || done > 0) { _trsFlashSec = sec; reload(); }
      } catch (e) {
        showToast(e.message, 'error');
        secError(sec, e.message);
      } finally {
        setBusy(false);
      }
    });
  });

  // Глобальные операции (storedNames без kind — сервер угадывает kind по записям).
  const globalRestore = document.getElementById('trs-global-restore');
  const globalPurge = document.getElementById('trs-global-purge');
  if (globalPurge) {
    globalPurge.addEventListener('click', async () => {
      const names = collectVisibleStoredNames();
      if (!names.length) return;
      const ok = await showConfirm(
        `${t('trash.purgeAllVisible', { n: names.length })} ${t('trash.irreversible')}.`,
        { danger: true, confirmText: t('trash.purgeForever') });
      if (!ok) return;
      setBusy(true);
      try {
        const resp = await fetch('/api/trash', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ city: CITY, storedNames: names }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || t('trash.opFailed'));
        showToast(`${t('trash.purged')}: ${data.purged || 0}`, 'success');
        reload();
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        setBusy(false);
      }
    });
  }
  if (globalRestore) {
    globalRestore.addEventListener('click', async () => {
      const names = collectVisibleStoredNames();
      if (!names.length) return;
      const ok = await showConfirm(t('trash.restoreAllVisible', { n: names.length }), { confirmText: t('ui.btn.restore') });
      if (!ok) return;
      setBusy(true);
      try {
        const resp = await fetch('/api/trash/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ city: CITY, storedNames: names }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || t('trash.opFailed'));
        const failed = data.failed || [];
        if (failed.length) {
          showToast(`${t('trash.restored')}: ${data.restored}, ${t('trash.failed')}: ${failed.map(f => f.error).join('; ')}`,
            failed.length === names.length ? 'error' : 'warning');
        } else {
          showToast(`${t('trash.restored')}: ${data.restored}`, 'success');
        }
        if ((data.restored || 0) > 0) reload();
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        setBusy(false);
      }
    });
  }

  syncAll();
}

function collectVisibleStoredNames() {
  const names = [];
  const seen = new Set();
  document.querySelectorAll('#trash-content .trs-cb').forEach(cb => {
    if (!seen.has(cb.dataset.stored)) { seen.add(cb.dataset.stored); names.push(cb.dataset.stored); }
  });
  return names;
}