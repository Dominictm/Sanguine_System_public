// Вынесено из scripts.js (E2.3): страница локаций, детальная модалка, редактор/генератор, панель локаций модуля.
// Зависит от глобалей: STATE, CITY, escHtml, escAttr, showToast, showConfirm (см. utils.js), fetch/document.

// ═══════════════════════════════════════════════════════════════
// Locations
// ═══════════════════════════════════════════════════════════════

// «Статус» (2026-08-06, техспека «Статус заменяет Зону») — заменяет прежнюю
// «Зону контроля» в шапке детальной модалки. Значение теперь чистый тип из
// CITY_LOCATION_TYPES (city.js) — без маркера/заметки, прямое сравнение по
// словарю, а не подстрочный матчинг (тем и отличается от прежнего zoneClass()).
const STATUS_BADGE_CLASS = {
  'Элизиум':        'elysium',
  'Приёмная князя': 'prince',
  'Убежище':        'haven',
  'Шериф':          'sheriff',
  'Сенешаль':       'seneschal',
};
function _statusClass(status) { return STATUS_BADGE_CLASS[status] || 'other'; }

// 🎭-иконка вместо цветного кружка — на карточке (см. _locCardHtml) она стоит
// рядом с бейджем зоны/опасности, у которого свой кружок; без иконки-оси два
// «Высокий» неотличимы друг от друга (2026-08-02-location-card-modal-plan.md §1).
const MASQ_BADGE_LABELS = {
  low:     t('loc.masqLow'),
  medium:  t('loc.masqMed'),
  high:    t('loc.masqHigh'),
};

const DANGER_BADGE_LABELS = {
  low:     t('loc.dangerLow'),
  medium:  t('loc.dangerMed'),
  high:    t('loc.dangerHigh'),
};

// B2 (2026-08-07): тултипов для полей локации не было вообще ни одного (grep
// "field-tip|fieldTip|data-tip" по этому файлу — 0 совпадений). Ключи — по видимому тексту
// лейбла, тем же принципом, что CHAR_FIELD_TIPS/CITY_FIELD_TIPS (scripts.js/city.js).
const LOCATION_FIELD_TIPS = {
  [t('loc.name')]:              t('locTip.name'),
  [t('loc.district')]:          t('locTip.district'),
  [t('loc.neighborhood')]:      t('locTip.neighborhood'),
  [t('loc.address')]:           t('locTip.address'),
  [t('loc.control')]:           t('locTip.control'),
  [t('loc.presence')]:         t('locTip.presence'),
  [t('loc.legendStatus')]:      t('locTip.status'),
  [t('cfl.faction')]:           t('locTip.faction'),
  [t('loc.factions')]:          t('locTip.factions'),
  [t('loc.owner')]:             t('locTip.owner'),
  [t('loc.figures')]:           t('locTip.figures'),
  [t('loc.threats')]:           t('locTip.threats'),
  [t('loc.masquerade')]:        t('locTip.masquerade'),
  [t('loc.dangerField')]:       t('locTip.danger'),
  [t('loc.privateDomain')]:     t('locTip.privateDomain'),
};

// Уровень опасности — собственное поле «Опасность» (техспека §13.1), отдельное от
// «Зоны» (та — про «чья зона контроля», это — про то, насколько там опасно; раньше
// оба смысла жили в одном поле «Зона», разведены по разным инлайн-метаданным).
function zoneDangerLevel(dangerLevel) {
  if (!dangerLevel) return 'unknown';
  if (dangerLevel.includes('🟢')) return 'low';
  if (dangerLevel.includes('🟡')) return 'medium';
  if (dangerLevel.includes('🔴')) return 'high';
  return 'unknown';
}

async function loadLocations() {
  _applyLocSectionTab(_readLocSectionTab());
  if (STATE.locations.length) { renderLocations(); return; }
  document.getElementById('locs-grid').innerHTML =
    '<div class="loading-state"><div class="spinner"></div>' + t('loc.loading') + '</div>';
  try {
    const data = await fetch('/api/locations').then(r => r.json());
    STATE.locations = Array.isArray(data) ? data : [];
    populateDistrictFilter();
    renderLocations();
  } catch {
    document.getElementById('locs-grid').innerHTML =
      '<div class="loading-state form-error">' + t('loc.loadError') + '</div>';
  }
}

function populateDistrictFilter() {
  const sel = document.getElementById('loc-filter-district');
  const current = sel.value;
  const districts = [...new Set(
    STATE.locations.map(l => l.district).filter(Boolean)
  )].sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b, 'ru');
  });
  sel.innerHTML = '<option value="all">' + t('loc.districtsAll') + '</option>' +
    districts.map(d => `<option value="${escAttr(d)}">${escHtml(d)}</option>`).join('');
  if (districts.includes(current)) sel.value = current;
}

function _locCountWord(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

function renderLocations() {
  const { zone, masq, district, search } = STATE.locFilter;
  let list = STATE.locations;
  if (zone     !== 'all') list = list.filter(l => l.locStatus === zone);
  if (masq     !== 'all') list = list.filter(l => l.masqueradeLevel === masq);
  if (district !== 'all') list = list.filter(l => l.district === district);
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(l =>
      (l.title || l.slug).toLowerCase().includes(q) ||
      (l.subtype      || '').toLowerCase().includes(q) ||
      (l.district     || '').toLowerCase().includes(q) ||
      (l.neighborhood || '').toLowerCase().includes(q) ||
      (l.address      || '').toLowerCase().includes(q)
    );
  }

  // Подзаголовок общий для двух вкладок раздела — на «Районах» его держит renderDistricts().
  if (_locSectionTab === 'locations') {
    document.getElementById('locations-sub').textContent =
      `${list.length} ${_locCountWord(list.length, t('loc.countOne'), t('loc.countFew'), t('loc.countMany'))}`;
  }

  const grid = document.getElementById('locs-grid');
  if (!list.length) {
    grid.innerHTML = '<div class="loading-state" style="height:100px">' + t('loc.notFound') + '</div>';
    return;
  }
  grid.innerHTML = list.map((loc, i) =>
    _locCardHtml(loc, { delay: `style="animation-delay:${Math.min(i, 12) * 30}ms"` })
  ).join('');
  fitLocTitles();
}

// Карточка локации (`.loc-card`) — общий источник разметки для главной сетки
// локаций И для «Связанных локаций» на странице модуля (см. _renderModuleLocPanel),
// чтобы вторая не превращалась в отдельный обеднённый список-строку.
// noDelete — без 🗑 (вкладка «Локации» карточки района: удаление — только в основной сетке).
function _locCardHtml(loc, { delay = '', overlayExtra = '', noDelete = false } = {}) {
  const dLvl  = zoneDangerLevel(loc.dangerLevel);
  const mLvl  = loc.masqueradeLevel || 'unknown';
  // Компактные бейджи (2026-08-06, план «карточка локации» §1-2): только иконка + цвет
  // заливки/рамки — «Зона контроля» (zoneBadge) убрана с карточки целиком (осталась
  // только в детальной модалке), «Опасность»/«Маскарад» показывают полный текст по title,
  // не в самом бейдже — на компактной сетке карточек полные подписи не помещались.
  const dangerBadge = dLvl !== 'unknown'
    ? `<span class="badge badge-danger-${dLvl}" title="${escAttr(DANGER_BADGE_LABELS[dLvl])}">⚔️</span>`
    : '';
  const masqBadge = mLvl !== 'unknown'
    ? `<span class="badge badge-masq-${mLvl}" title="${escAttr(MASQ_BADGE_LABELS[mLvl])}">🎭</span>`
    : '';

  const distLine = [loc.district, loc.neighborhood].filter(Boolean).map(escHtml).join(' · ');
  const cardTitle = loc.subtype || loc.title || loc.slug;
  const textBlock = `
    <div class="loc-title">${escHtml(cardTitle)}</div>
    ${distLine    ? `<div class="loc-district">${distLine}</div>` : ''}
    ${loc.address ? `<div class="loc-address">${escHtml(loc.address)}</div>` : ''}
    <div class="loc-badges">${dangerBadge}${masqBadge}</div>`;
  // Иконка удаления — всегда видима (не hover-reveal, см. план §2.1 — деструктивное
  // действие с подтверждением, прятать её не даёт защиты, только вредит на touch).
  // Клик обрабатывается делегатом (см. ниже, data-del-loc) — stopPropagation там же,
  // чтобы не открывать карточку одновременно с удалением.
  const delBtn = noDelete ? '' : `<button type="button" class="loc-card-del-btn" data-del-loc="${escAttr(loc.slug)}" title="${t('loc.delBtnTitle')}" aria-label="${t('loc.delBtnTitle')}">🗑</button>`;

  if (loc.imageUrl) {
    return `<div class="loc-card has-art" data-slug="${escAttr(loc.slug)}" ${delay}>
      <img class="loc-card-img" src="${escAttr(thumbUrl(loc.imageUrl, 640))}" alt="${escAttr(loc.title || loc.slug)}" loading="lazy" decoding="async">
      <div class="loc-card-overlay">${textBlock}</div>
      ${delBtn}
      ${overlayExtra}
    </div>`;
  }
  return `<div class="loc-card" data-slug="${escAttr(loc.slug)}" ${delay}>
    <span class="loc-zone-icon">📍</span>
    ${textBlock}
    ${delBtn}
    ${overlayExtra}
  </div>`;
}

function fitLocTitles() {
  document.querySelectorAll('.loc-card .loc-title').forEach(el => {
    el.style.fontSize = '';
    const fs  = parseFloat(getComputedStyle(el).fontSize);
    const lh  = parseFloat(getComputedStyle(el).lineHeight) || fs * 1.2;
    const max = lh * 2 + 2; // 2 строки + 2px буфер
    if (el.scrollHeight <= max) return;

    // Binary search the largest 0.5px-stepped size in [13, fs] that fits —
    // same result as the old linear shrink loop, far fewer forced reflows
    // (impeccable audit 2026-07-12: O(log n) reads instead of O(n) per card).
    let lo = 13, hi = fs, best = 13;
    while (hi - lo > 0.5) {
      const mid = Math.round((lo + hi) / 2 * 2) / 2; // snap to .5px steps
      el.style.fontSize = mid + 'px';
      if (el.scrollHeight <= max) { best = mid; lo = mid; }
      else { hi = mid; }
    }
    el.style.fontSize = best + 'px';
  });
}

let _currentLocSlug = null;

// ── Sensory palette — per-channel edit/generate (см. модульный сценарий по разделам) ──
// Зеркалит формат таблицы, которую строит/читает parseLocation (lib/parsers.js):
// `| **Канал** | значение |` без заголовка/разделителя — те парсятся отдельно,
// но отбрасываются как строки с пустым value, поэтому здесь не нужны вовсе.
function _sensRebuildTable(list) {
  return (list || []).map(s => `| **${s.channel}** | ${s.value || ''} |`).join('\n');
}

// Обязательные каналы (§C3, техспека 2026-08-04) — Свет/Звук/Запах нельзя удалить
// из детальной модалки (кнопки нет вовсе, не просто дизейблена); backend дублирует
// запрет на PUT /fields (routes/locations.js, key==='sensoryPalette') — не полагаемся
// только на скрытую кнопку. «Тактильное» и произвольные добавленные каналы остаются
// удаляемыми, статус-кво (loc-plan §2.3).
const MANDATORY_SENS_CHANNELS = ['Свет', 'Звук', 'Запах'];

function _renderSensPanel(loc) {
  const DEFAULT_CHANNELS = ['Свет', 'Звук', 'Запах', 'Тактильное'];
  const list = loc.sensoryPalette?.length
    ? loc.sensoryPalette
    : DEFAULT_CHANNELS.map(channel => ({ channel, value: '' }));

  const sectionsHtml = list.map((s, i) => {
    const mandatory = MANDATORY_SENS_CHANNELS.includes(s.channel);
    // Пустой обязательный канал — ⚠️, не нейтральное «Пусто»: незаполненность видна
    // сразу, не открывая вкладку (тот же принцип, что маркер на кнопке вкладки ниже).
    const emptyView = mandatory ? `<div class="cdet-empty">${t('loc.sensEmptyRequired')}</div>` : `<div class="cdet-empty">${t('loc.sensEmptyOptional')}</div>`;
    return `
    <div class="modp-scenario-section">
      <div class="modp-section-header-row">
        <div class="modp-section-label">${escHtml(s.channel)}</div>
        <div class="modp-scenario-sec-btns">
          <button class="cdet-edit-btn" data-editloc="sens-${i}">${t('cdet.editBtn')}</button>
          <button class="cdet-edit-btn" data-sens-regen="${i}">${t('loc.sensRegenBtn')}</button>
          ${mandatory ? '' : `<button class="hooks-del-btn" data-sens-del="${i}" title="${t('loc.sensDelTitle')}">✕</button>`}
        </div>
      </div>
      <div id="locdet-sens-${i}-view">${s.value ? escHtml(s.value) : emptyView}</div>
      <div id="locdet-sens-${i}-edit" style="display:none">
        <textarea class="cdet-edit-textarea" id="locdet-sens-${i}-ta" rows="2">${escHtml(s.value || '')}</textarea>
      </div>
      <div class="cdet-edit-bar" id="locdet-sens-${i}-bar" style="display:none">
        <button class="cdet-save-btn" data-saveloc="sens-${i}">${t('cdet.saveBtn')}</button>
        <button class="cdet-cancel-btn" data-cancelloc="sens-${i}">${t('cdet.cancelBtn')}</button>
        <span class="cdet-save-msg" id="locdet-sens-${i}-msg" style="display:none">${t('cdet.saved')}</span>
      </div>
    </div>
    ${i < list.length - 1 ? '<div class="modp-section-divider"></div>' : ''}`;
  }).join('');

  return `
    <div id="locdet-sens-list">${sectionsHtml}</div>
    <div class="hooks-add-row" id="locdet-sens-add-row" style="display:none;flex-direction:column;gap:6px;margin-top:12px">
      <input class="hooks-input" id="locdet-sens-new-channel" placeholder="${t('loc.sensChannelPh')}">
      <textarea class="cdet-edit-textarea" id="locdet-sens-new-value" rows="2" placeholder="${t('loc.sensValuePh')}"></textarea>
      <div style="display:flex;gap:6px">
        <button class="cdet-save-btn" id="locdet-sens-add-confirm">${t('loc.sensAddConfirm')}</button>
        <button class="cdet-cancel-btn" id="locdet-sens-add-cancel">${t('cdet.cancelBtn')}</button>
      </div>
    </div>
    <button class="hooks-add-btn" id="locdet-sens-add-btn" style="margin-top:10px">${t('loc.sensAddBtn')}</button>`;
}

async function _locReloadSensTab(slug) {
  openLocDetail(slug, 'sens');
}

async function _locRegenSensChannel(idx) {
  const slug = _currentLocSlug;
  const loc  = STATE.locations.find(l => l.slug === slug);
  if (!loc) return;
  const list = loc.sensoryPalette?.length
    ? loc.sensoryPalette
    : ['Свет', 'Звук', 'Запах', 'Тактильное'].map(channel => ({ channel, value: '' }));
  const channel = list[idx]?.channel;
  if (!channel) return;

  const ok = await showConfirm(t('loc.sensRegenConfirm', { channel }), { confirmText: t('loc.sensRegenConfirmBtn') });
  if (!ok) return;

  const btn = document.querySelector(`[data-sens-regen="${idx}"]`);
  const origLabel = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = t('loc.sensGenerating'); }
  try {
    const r = await fetch(`/api/locations/generate${window.location.search}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, name: loc.title || slug, field: 'sensory', channel, context: loc.atmosphere || '' })
    });
    const result = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(result.error || t('loc.sensRegenError'));

    const updated = list.slice();
    updated[idx] = { ...updated[idx], value: result.value || '' };
    const resp = await fetch(`/api/locations/${encodeURIComponent(slug)}/fields${window.location.search}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { sensoryPalette: _sensRebuildTable(updated) } })
    });
    if (!resp.ok) throw new Error(await resp.text());
    loc.sensoryPalette = updated;
    await _locReloadSensTab(slug);
  } catch (err) {
    showToast(t('loc.sensRegenFail', { msg: err.message }), 'error');
    if (btn) { btn.disabled = false; btn.textContent = origLabel; }
  }
}

async function _locDeleteSensChannel(idx) {
  const slug = _currentLocSlug;
  const loc  = STATE.locations.find(l => l.slug === slug);
  if (!loc?.sensoryPalette?.length) return;
  const channel = loc.sensoryPalette[idx]?.channel;
  if (!channel) return;

  const ok = await showConfirm(t('loc.sensDelConfirm', { channel }), { danger: true, confirmText: t('city.confirmDelete') });
  if (!ok) return;

  const updated = loc.sensoryPalette.slice();
  updated.splice(idx, 1);
  try {
    const resp = await fetch(`/api/locations/${encodeURIComponent(slug)}/fields${window.location.search}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { sensoryPalette: _sensRebuildTable(updated) } })
    });
    if (!resp.ok) throw new Error(await resp.text());
    loc.sensoryPalette = updated;
    await _locReloadSensTab(slug);
  } catch {
    showToast(t('loc.sensDelFail'), 'error');
  }
}

async function _locAddSensChannel() {
  const slug = _currentLocSlug;
  const loc  = STATE.locations.find(l => l.slug === slug);
  if (!loc) return;
  const nameEl  = document.getElementById('locdet-sens-new-channel');
  const valueEl = document.getElementById('locdet-sens-new-value');
  const channel = (nameEl?.value || '').trim();
  const value   = (valueEl?.value || '').trim();
  if (!channel) { nameEl?.focus(); return; }
  if (!value)   { showToast(t('loc.sensValueRequired'), 'error'); valueEl?.focus(); return; }

  const list = loc.sensoryPalette?.length
    ? loc.sensoryPalette
    : ['Свет', 'Звук', 'Запах', 'Тактильное'].map(c => ({ channel: c, value: '' }));
  if (list.some(s => s.channel.toLowerCase() === channel.toLowerCase())) {
    showToast(t('loc.sensDuplicate'), 'error');
    return;
  }
  const updated = [...list, { channel, value }];
  try {
    const resp = await fetch(`/api/locations/${encodeURIComponent(slug)}/fields${window.location.search}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { sensoryPalette: _sensRebuildTable(updated) } })
    });
    if (!resp.ok) throw new Error(await resp.text());
    loc.sensoryPalette = updated;
    await _locReloadSensTab(slug);
  } catch {
    showToast(t('loc.sensAddFail'), 'error');
  }
}

// ── «Контроль», «Фракции», «Присутствие»: множественный выбор из справочников ──
// Спека influence-charts-2026-11-16 §7. Значения — чипы; 📚 открывает общий LibPicker.
// «Контроль» — кланы, киты фей, семьи ревенантов, охотники, организации смертных;
// «Фракции» (VtM-вкладка) — секты, фракции смертных, дворы фей, племена оборотней;
// «Присутствие» — линейки. У первых двух дополнительно своё текстовое значение. Старый свободный текст карточки показывается
// чипами как есть и переписывается в файле только при сохранении поля.
let _locCtlOptions = null; // { groups, factionGroups, lineages } — GET /api/locations/control-options, один раз на страницу

async function _locLoadCtlOptions() {
  if (_locCtlOptions) return _locCtlOptions;
  try {
    const r = await fetch(`/api/locations/control-options?city=${encodeURIComponent(CITY)}`);
    if (!r.ok) throw new Error(r.statusText);
    _locCtlOptions = await r.json();
  } catch { return { groups: [], factionGroups: [], lineages: [] }; } // не кэшируем сбой — следующее открытие попробует снова
  return _locCtlOptions;
}

const _LOC_LINEAGE_KEYS = { 'вампиры': 'vampires', 'феи': 'fairies', 'смертные': 'mortals', 'оборотни': 'werewolves', 'маги': 'mages', 'охотники': 'hunters' };
// Линейки хранятся в карточке русскими названиями (данные города), подпись — по языку интерфейса.
function _locMultiLabel(kind, value) {
  if (kind !== 'presence') return value;
  const key = _LOC_LINEAGE_KEYS[String(value).trim().toLowerCase()];
  return key ? t(`inf.lineage.${key}`) : value;
}

function _locChipHtml(kind, value, editable) {
  const label = _locMultiLabel(kind, value);
  return `<span class="loc-chip" data-value="${escAttr(value)}"><span class="loc-chip-text">${escHtml(label)}</span>${editable
    ? `<button type="button" class="loc-chip-x" data-loc-chip-x aria-label="${escAttr(t('loc.multi.remove', { name: label }))}">✕</button>` : ''}</span>`;
}

function _locChipsViewHtml(kind, values) {
  return `<span class="loc-chips">${(values || []).map(v => _locChipHtml(kind, v, false)).join('')}</span>`;
}

// Разметка поля; id — корень виджета, по нему же читается значение (_locMultiValues).
function _locMultiHtml(kind, id, values) {
  const own = kind !== 'presence'
    ? `<input type="text" class="form-control loc-multi-own" data-loc-multi-own placeholder="${escAttr(t('loc.multi.ownPh'))}" aria-label="${escAttr(t('loc.multi.ownPh'))}" autocomplete="off">
       <button type="button" class="chr-modal-btn loc-multi-own-add" data-loc-multi-add>${t('loc.multi.add')}</button>` : '';
  return `<div class="loc-multi" id="${id}" data-loc-multi="${kind}">
    <div class="loc-chips loc-multi-chips" data-loc-multi-chips>${(values || []).map(v => _locChipHtml(kind, v, true)).join('')}</div>
    <div class="loc-multi-tools">
      <button type="button" class="lib-picker-btn" data-loc-multi-pick title="${escAttr(t('loc.multi.pick'))}" aria-label="${escAttr(t(_LOC_MULTI_PICK_LABEL[kind]))}">📚</button>
      ${own}
    </div>
    <div class="lib-picker" id="${id}-picker" hidden></div>
  </div>`;
}

const _LOC_MULTI_PICK_LABEL = { control: 'loc.multi.pickControl', faction: 'loc.multi.pickFaction', presence: 'loc.multi.pickPresence' };
// Группы пикера по виду поля: ключ группы из ответа сервера → ключ подписи.
const _LOC_MULTI_GROUPS = {
  control: { clans: 'loc.multi.gClans', kiths: 'loc.multi.gKiths', families: 'loc.multi.gFamilies', hunters: 'loc.multi.gHunters', mortal: 'loc.multi.gMortal' },
  faction: { sects: 'loc.multi.gSects', mortal: 'loc.multi.gMortalFactions', courts: 'loc.multi.gCourts', tribes: 'loc.multi.gTribes' },
};

function _locMultiValues(root) {
  const el = typeof root === 'string' ? document.getElementById(root) : root;
  return el ? [...el.querySelectorAll('.loc-chip')].map(c => c.dataset.value) : null;
}

// Модалка создания/редактирования локации: поле рисуется заново при каждом открытии
// (разметка модалки статична, а подписи виджета зависят от языка интерфейса).
function _locEditMultiRender(kind, values) {
  const host = document.getElementById(`loc-edit-${kind}-host`);
  if (host) host.innerHTML = _locMultiHtml(kind, `loc-edit-${kind}`, values);
}

const _locMultiHas = (el, value) => (_locMultiValues(el) || []).some(v => v.trim().toLowerCase() === String(value).trim().toLowerCase());

function _locMultiToggle(el, value) {
  const v = String(value || '').trim();
  if (!v) return;
  const chips = el.querySelector('[data-loc-multi-chips]');
  const hit = [...chips.querySelectorAll('.loc-chip')].find(c => c.dataset.value.trim().toLowerCase() === v.toLowerCase());
  if (hit) hit.remove();
  else chips.insertAdjacentHTML('beforeend', _locChipHtml(el.dataset.locMulti, v, true));
}

function _locMultiPicker(el) {
  const kind = el.dataset.locMulti;
  const panel = el.querySelector('.lib-picker');
  if (!panel || !window.LibPicker) return null;
  const groupLabel = _LOC_MULTI_GROUPS[kind];
  return LibPicker.mount(panel, {
    label: t(_LOC_MULTI_PICK_LABEL[kind]),
    closeOnPick: false, // мультивыбор: список остаётся открытым, выбранное помечается ✓
    emptyText: t('city.nothingFound'),
    groups: !groupLabel ? null : Object.keys(groupLabel).map(key => ({
      key, label: t(groupLabel[key]), alwaysShow: key === 'mortal',
      emptyText: key === 'mortal' ? t('loc.multi.mortalEmpty') : t('city.nothingFound'),
    })),
    source: async () => {
      const opts = await _locLoadCtlOptions();
      if (kind === 'presence') return (opts.lineages || []).map(l => ({ value: l.value, label: t(`inf.lineage.${l.key}`) }));
      return ((kind === 'faction' ? opts.factionGroups : opts.groups) || [])
        .flatMap(g => (g.items || []).map(it => ({ value: it.value, hint: it.hint || '', group: g.key })));
    },
    isSelected: it => _locMultiHas(el, it.value),
    onPick: it => _locMultiToggle(el, it.value),
  });
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-loc-multi]');
  if (!el) return;
  if (e.target.closest('[data-loc-multi-pick]')) { _locMultiPicker(el)?.toggle(); return; }
  const x = e.target.closest('[data-loc-chip-x]');
  if (x) {
    // Фокус не должен пропасть вместе с чипом: уходит на соседний ✕ либо на кнопку 📚.
    const chip = x.closest('.loc-chip');
    const next = (chip.nextElementSibling || chip.previousElementSibling)?.querySelector('[data-loc-chip-x]')
      || el.querySelector('[data-loc-multi-pick]');
    chip.remove();
    next?.focus();
    el.querySelector('.lib-picker')?._libPicker?.refresh();
    return;
  }
  if (e.target.closest('[data-loc-multi-add]')) _locMultiAddOwn(el);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches?.('[data-loc-multi-own]')) return;
  e.preventDefault(); // Enter в поле «своё» добавляет чип, а не отправляет форму модалки
  _locMultiAddOwn(e.target.closest('[data-loc-multi]'));
});
function _locMultiAddOwn(el) {
  const inp = el.querySelector('[data-loc-multi-own]');
  // «,» «;» «|» — разделители списка и полей строки метаданных: в одном значении недопустимы.
  const v = (inp?.value || '').replace(/[,;|]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!v) return;
  if (!_locMultiHas(el, v)) _locMultiToggle(el, v);
  inp.value = '';
  inp.focus();
  el.querySelector('.lib-picker')?._libPicker?.refresh();
}

function openLocDetail(slug, keepTab) {
  const loc = STATE.locations.find(l => l.slug === slug);
  if (!loc) return;
  _currentLocSlug = slug;

  const mLvl = loc.masqueradeLevel || 'unknown';
  const dLvl = zoneDangerLevel(loc.dangerLevel);

  const imgCol = loc.imageUrl
    ? `<div class="locdet-carousel" id="locdet-carousel">
        <img class="locdet-carousel-img" id="locdet-carousel-img" src="${escAttr(loc.imageUrl)}" alt="${escAttr(loc.title || loc.slug)}">
        <div class="locdet-carousel-overlay" id="locdet-carousel-overlay"></div>
        <button class="locdet-carousel-btn prev" id="locdet-carousel-prev" title="${t('cdet.carouselPrev')}">&#8249;</button>
        <button class="locdet-carousel-btn next" id="locdet-carousel-next" title="${t('cdet.carouselNext')}">&#8250;</button>
        <div class="locdet-carousel-dots" id="locdet-carousel-dots"></div>
       </div>`
    : `<div class="locdet-no-img">📍</div>`;

  // ── Panels content ────────────────────────────────────────────

  const metaFields = [
    ['subtype',      t('loc.name'),              loc.subtype],
    ['district',     t('loc.district'),          loc.district],
    ['neighborhood', t('loc.neighborhood'),      loc.neighborhood],
    ['address',      t('loc.address'),           loc.address],
  ];
  // «Контроль» и «Влияние» — списки (спека influence-charts §7): в просмотре чипы, в правке
  // выбор из справочников. Пустой список в просмотре не показывается, как и пустое поле.
  const multiFields = [
    ['control',   t('loc.control'),   loc.controlList || []],
    ['presence', t('loc.presence'), loc.presenceList || []],
  ];
  const metaViewHtml = `<div class="locdet-table">${
    metaFields.filter(([, , v]) => v).map(([, k, v]) =>
      `<div class="locdet-row"><div class="locdet-key">${escHtml(k)}${fieldTip(LOCATION_FIELD_TIPS[k])}</div><div class="locdet-val">${escHtml(v)}</div></div>`).join('')
  }${
    multiFields.filter(([, , list]) => list.length).map(([kind, k, list]) =>
      `<div class="locdet-row" data-locdet-multi-view="${kind}"><div class="locdet-key">${escHtml(k)}${fieldTip(LOCATION_FIELD_TIPS[k])}</div><div class="locdet-val">${_locChipsViewHtml(kind, list)}</div></div>`).join('')
  }</div>`;
  // «Район» (district) — не обычное текстовое поле: выбор из уже существующих
  // районов (тот же #loc-district-list datalist, что и в модалке создания/
  // редактирования локации) + кнопка открепления (техспека 2026-08-05, Часть
  // IV). Сохраняется отдельным путём от остальных полей meta — см. _locSavePanel.
  const metaEditHtml = `<div class="locdet-edit-fields">${metaFields.map(([key, label, val]) => key === 'district'
    ? `<div class="locdet-field-row">
         <label class="locdet-field-lbl">${escHtml(label)}${fieldTip(LOCATION_FIELD_TIPS[label])}</label>
         <div class="locdet-district-row">
           <input class="form-control locdet-field-inp" id="locdet-meta-district" value="${escAttr(val || '')}" placeholder="${escAttr(label)}" list="loc-district-list" autocomplete="off">
           <button type="button" class="chr-modal-btn danger" id="locdet-meta-district-clear" title="${t('loc.detachDistrictTitle')}">✕</button>
         </div>
       </div>`
    : `<div class="locdet-field-row">
       <label class="locdet-field-lbl">${escHtml(label)}${fieldTip(LOCATION_FIELD_TIPS[label])}</label>
       <input class="form-control locdet-field-inp" id="locdet-meta-${key}" value="${escAttr(val || '')}" placeholder="${escAttr(label)}">
     </div>`).join('')}${multiFields.map(([kind, label, list]) =>
    `<div class="locdet-field-row" role="group" aria-label="${escAttr(label)}">
       <span class="locdet-field-lbl">${escHtml(label)}${fieldTip(LOCATION_FIELD_TIPS[label])}</span>
       ${_locMultiHtml(kind, `locdet-meta-${kind}`, list)}
     </div>`).join('')}</div>`;

  const atmViewHtml = loc.atmosphere
    ? `<div class="locdet-atm">${escHtml(loc.atmosphere)}</div>`
    : `<div class="cdet-empty">${t('loc.atmEmpty')}</div>`;
  const atmEditHtml = `<textarea class="cdet-edit-textarea" id="locdet-atm-ta" rows="12">${escHtml(loc.atmosphere || '')}</textarea>`;

  // «Фракции» — список (чипы); при «Частном домене» в той же строке таблицы имя хозяина.
  const factionChips = !loc.privateDomain && (loc.factionList || []).length
    ? { html: _locChipsViewHtml('faction', loc.factionList) } : null;
  const vtmSections = [
    [t('loc.legendStatus'),   loc.locStatus],
    loc.privateDomain ? [t('loc.owner'), loc.faction] : [t('loc.factions'), factionChips],
    [t('loc.figures'),        loc.figures],
    [t('loc.threats'),        loc.threats],
    [t('loc.masquerade'),     loc.masquerade],
    [t('loc.dangerField'),    DANGER_BADGE_LABELS[zoneDangerLevel(loc.dangerLevel)] || ''],
  ].filter(([, v]) => v);
  const vtmParts = [];
  if (loc.vtmText) vtmParts.push(`<div class="locdet-atm">${escHtml(loc.vtmText)}</div>`);
  vtmSections.forEach(([k, v]) => vtmParts.push(
    `<div class="vtm-section"><div class="vtm-lbl">${escHtml(k)}${fieldTip(LOCATION_FIELD_TIPS[k])}</div><div class="vtm-body"${v && v.html ? ' data-locdet-multi-view="faction"' : ''}>${v && v.html ? v.html : escHtml(v)}</div></div>`
  ));
  const vtmViewHtml = vtmParts.length
    ? vtmParts.join('<div class="diary-divider"></div>')
    : `<div class="cdet-empty">${t('loc.vtmEmpty')}</div>`;
  // Форма по полям (не пустая textarea) — переиспользует locdet-field-row/-lbl/-inp,
  // тот же паттерн, что уже использует соседняя вкладка «Метаданные» (metaEditHtml выше),
  // designspec §11.3. Маскарад — единственное поле как <select> (3 уровня, тот же
  // паттерн, что «Опасность» в форме редактирования), остальные — свободный текст.
  const VTM_MASQ_OPTS = [['', t('s.phSelectEmpty')], ['🟢', `🟢 ${t('loc.masqOptLow')}`], ['🟡', `🟡 ${t('loc.masqOptMed')}`], ['🔴', `🔴 ${t('loc.masqOptHigh')}`]];
  const maqRaw = loc.masquerade || '';
  const maqSelVal = VTM_MASQ_OPTS.find(([v]) => v && maqRaw.includes(v))?.[0] || '';
  const VTM_DANGER_OPTS = [['', t('s.phSelectEmpty')], ['🟢', `🟢 ${t('loc.dangerOptLow')}`], ['🟡', `🟡 ${t('loc.dangerOptMed')}`], ['🔴', `🔴 ${t('loc.dangerOptHigh')}`]];
  const dangerRaw = loc.dangerLevel || '';
  const dangerSelVal = VTM_DANGER_OPTS.find(([v]) => v && dangerRaw.includes(v))?.[0] || '';
  // «Частный домен» (§3.4) — переключает лейбл/даталист поля «Фракция» ↔ «Хозяин».
  // Начальное состояние строится здесь (не только через change-обработчик), чтобы уже
  // сохранённая карточка с privateDomain: true открывалась сразу в режиме «Хозяин».
  // «Фракции» — множественный выбор (#locdet-vtm-factions); «Хозяин» — одно имя в поле
  // #locdet-vtm-faction. Показано одно из двух, переключает чекбокс «Частный домен».
  const factionLbl = loc.privateDomain ? t('loc.owner') : t('loc.factions');
  const vtmEditHtml = `<div class="locdet-edit-fields">
      <div class="locdet-field-row">
        <label class="locdet-field-lbl">${t('loc.legendStatus')}${fieldTip(LOCATION_FIELD_TIPS[t('loc.legendStatus')])}</label>
        <select class="form-control locdet-field-inp" id="locdet-vtm-status">
          <option value=""${!loc.locStatus ? ' selected' : ''}>—</option>
          ${CITY_LOCATION_TYPES.map(t => `<option value="${escAttr(t)}"${t === loc.locStatus ? ' selected' : ''}>${escHtml(t)}</option>`).join('')}
        </select>
      </div>
      <div class="locdet-field-row">
        <span class="locdet-field-lbl" id="locdet-vtm-faction-lbl">${factionLbl}${fieldTip(LOCATION_FIELD_TIPS[factionLbl])}</span>
        <div id="locdet-vtm-factions-wrap" role="group" aria-labelledby="locdet-vtm-faction-lbl"${loc.privateDomain ? ' hidden' : ''}>${_locMultiHtml('faction', 'locdet-vtm-factions', loc.privateDomain ? [] : (loc.factionList || []))}</div>
        <div class="locdet-faction-row">
          <input class="form-control locdet-field-inp" id="locdet-vtm-faction" list="locdet-owner-chars-list" value="${escAttr(loc.privateDomain ? (loc.faction || '') : '')}" placeholder="${t('loc.ownerPh')}" aria-labelledby="locdet-vtm-faction-lbl" autocomplete="off"${loc.privateDomain ? '' : ' hidden'}>
          <label class="locdet-checkbox-row"><input type="checkbox" id="locdet-vtm-private-domain"${loc.privateDomain ? ' checked' : ''}>${t('loc.privateDomain')}${fieldTip(LOCATION_FIELD_TIPS[t('loc.privateDomain')])}</label>
        </div>
        <datalist id="locdet-owner-chars-list"></datalist>
      </div>
      <div class="locdet-field-row">
        <label class="locdet-field-lbl">${t('loc.figures')}${fieldTip(LOCATION_FIELD_TIPS[t('loc.figures')])}</label>
        <input class="form-control locdet-field-inp" id="locdet-vtm-figures" value="${escAttr(loc.figures || '')}" placeholder="${t('loc.figures')}">
      </div>
      <div class="locdet-field-row">
        <label class="locdet-field-lbl">${t('loc.threats')}${fieldTip(LOCATION_FIELD_TIPS[t('loc.threats')])}</label>
        <input class="form-control locdet-field-inp" id="locdet-vtm-threats" value="${escAttr(loc.threats || '')}" placeholder="${t('loc.threats')}">
      </div>
      <div class="locdet-field-row">
        <label class="locdet-field-lbl">${t('loc.masquerade')}${fieldTip(LOCATION_FIELD_TIPS[t('loc.masquerade')])}</label>
        <select class="form-control locdet-field-inp" id="locdet-vtm-masquerade">
          ${VTM_MASQ_OPTS.map(([v, label]) => `<option value="${v}"${v === maqSelVal ? ' selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div class="locdet-field-row">
        <label class="locdet-field-lbl">${t('loc.dangerField')}${fieldTip(LOCATION_FIELD_TIPS[t('loc.dangerField')])}</label>
        <select class="form-control locdet-field-inp" id="locdet-vtm-danger">
          ${VTM_DANGER_OPTS.map(([v, label]) => `<option value="${v}"${v === dangerSelVal ? ' selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="cdet-section-title" style="margin:10px 0 6px">${t('loc.proseTitle')}</div>
    <textarea class="cdet-edit-textarea" id="locdet-vtm-ta" rows="8">${escHtml(loc.vtmText || '')}</textarea>`;

  const keyPointsHtml = loc.keyPoints?.length
    ? `<div class="locdet-table">${loc.keyPoints.map(kp =>
        `<div class="locdet-row">
          <div class="locdet-key">${escHtml(kp.place)}</div>
          <div class="locdet-val">${escHtml(kp.desc)}</div>
        </div>`).join('')}</div>`
    : `<div class="cdet-empty">${t('loc.keysEmpty')}</div>`;
  // Форма по 2 полям вместо raw-textarea (§C1, тот же паттерн, что уже применён к
  // «Крючкам» рядом — hooks-item/hooks-input/hooks-del-btn переиспользуются как есть,
  // здесь просто два .hooks-input в строке вместо одного). Место/Описание — реальные
  // ячейки markdown-таблицы (не список), поэтому «|» внутри значений сворачиваем в
  // лукалайк ∣, иначе стороннее значение сдвинуло бы соседнюю колонку при следующем
  // разборе — тот же приём, что уже применяют vtmTable/subtype (routes/locations.js).
  const keyEditHtml = `
    <div id="locdet-keys-edit-list">
      ${(loc.keyPoints || []).map(kp => `
        <div class="hooks-item">
          <input class="hooks-input keypt-place-inp" value="${escAttr(kp.place)}" placeholder="${t('loc.keyPlacePh')}">
          <input class="hooks-input keypt-desc-inp" value="${escAttr(kp.desc)}" placeholder="${t('loc.keyDescPh')}">
          <button class="hooks-del-btn" title="${t('loc.delRowTitle')}">✕</button>
        </div>`).join('')}
    </div>
    <button class="hooks-add-btn" id="locdet-keys-add">${t('loc.keyAddBtn')}</button>`;

  const sensPanelHtml = _renderSensPanel(loc);
  // Маркер на кнопке вкладки — незаполненность видна без захода на вкладку (§C3).
  // Каналов, которых в карточке нет вовсе (алиасы «Зрение» и т.п., см. комментарий
  // у MANDATORY_SENS_CHANNELS), это тоже засчитывает как «не заполнено» — корректно,
  // раз обязательного канала под этим именем на самом деле нет.
  const sensHasEmpty = MANDATORY_SENS_CHANNELS.some(ch => {
    const found = loc.sensoryPalette?.find(s => s.channel === ch);
    return !found?.value;
  });

  const hooksViewHtml = loc.hooks?.length
    ? `<div class="locdet-hooks">${loc.hooks.map((h, i) =>
        `<div class="locdet-hook">
          <span class="locdet-hook-num">${i + 1}</span>
          <span class="locdet-hook-text">${escHtml(h)}</span>
        </div>`).join('')}</div>`
    : `<div class="cdet-empty">${t('loc.hooksEmpty')}</div>`;
  const hooksEditHtml = `
    <div id="locdet-hooks-edit-list">
      ${(loc.hooks || []).map((h, i) => `
        <div class="hooks-item">
          <span class="hooks-num">${i + 1}</span>
          <input class="hooks-input" value="${escAttr(h)}" placeholder="${t('loc.hookPh')}">
          <button class="hooks-del-btn" title="${t('loc.delRowTitle')}">✕</button>
        </div>`).join('')}
    </div>
    <button class="hooks-add-btn" id="locdet-hooks-add">${t('loc.hookAddBtn')}</button>`;

  // ── Images tab ────────────────────────────────────────────────
  const images = loc.imageUrls || (loc.imageUrl ? [loc.imageUrl] : []);
  const galleryHtml = images.length
    ? `<div class="locdet-img-gallery">${images.map(u => {
        const filename = decodeURIComponent(u.split('/').pop());
        return `<div class="locdet-img-thumb-wrap">
          <img class="locdet-thumb" src="${escAttr(u)}" alt="" loading="lazy" decoding="async">
          <span class="locdet-thumb-name">${escHtml(filename)}</span>
          <button class="locdet-img-del-btn" data-loc="${escAttr(slug)}" data-file="${escAttr(filename)}" title="${t('cdet.imgDelTitle')}">✕</button>
        </div>`;
      }).join('')}</div>`
    : `<div class="cdet-empty" style="margin-bottom:12px">${t('loc.imagesEmpty')}</div>`;

  // ── Helper: panel with edit button ────────────────────────────
  function editPanel(id, viewHtml, editHtml, opts = {}) {
    const { noEdit } = opts;
    return `
      <div class="cdet-info-header">
        ${!noEdit ? `<button class="cdet-edit-btn" data-editloc="${id}">${t('cdet.editBtn')}</button>` : ''}
      </div>
      <div id="locdet-${id}-view">${viewHtml}</div>
      <div id="locdet-${id}-edit" style="display:none">${editHtml}</div>
      <div class="cdet-edit-bar" id="locdet-${id}-bar" style="display:none">
        <button class="cdet-save-btn" data-saveloc="${id}">${t('cdet.saveBtn')}</button>
        <button class="cdet-cancel-btn" data-cancelloc="${id}">${t('cdet.cancelBtn')}</button>
        <span class="cdet-save-msg" id="locdet-${id}-msg" style="display:none">${t('cdet.saved')}</span>
      </div>`;
  }

  document.getElementById('loc-detail-content').innerHTML = `
    <div class="locdet-img-col">${imgCol}</div>
    <div class="cdet-info-col">
      <div class="cdet-sticky-header">
        <div class="cdet-name">${escHtml(loc.title || loc.slug)}</div>
        ${loc.subtype ? `<div class="locdet-subtype">${escHtml(loc.subtype)}</div>` : ''}
        <button class="cdet-edit-btn" id="locdet-open-edit-modal" data-slug="${escAttr(slug)}" style="margin-bottom:6px">${t('loc.editGenBtn')}</button>
        <button class="cdet-edit-btn locdet-delete-btn" id="locdet-delete-btn" data-slug="${escAttr(slug)}" style="margin-bottom:6px">${t('loc.deleteBtn')}</button>
        <div class="locdet-legend-row">
          <div class="locdet-legend-item">
            <span class="locdet-legend-lbl">${t('loc.legendStatus')}</span>
            <span class="badge badge-status-${_statusClass(loc.locStatus)}">${loc.locStatus ? escHtml(loc.locStatus.toUpperCase()) : '—'}</span>
          </div>
          ${dLvl !== 'unknown' ? `<div class="locdet-legend-item">
            <span class="locdet-legend-lbl">${t('loc.legendDanger')}</span>
            <span class="badge badge-danger-${dLvl}">${DANGER_BADGE_LABELS[dLvl]}</span>
          </div>` : ''}
          ${mLvl !== 'unknown' ? `<div class="locdet-legend-item">
            <span class="locdet-legend-lbl">${t('loc.legendMasq')}</span>
            <span class="badge badge-masq-${mLvl}">${MASQ_BADGE_LABELS[mLvl]}</span>
          </div>` : ''}
        </div>
      </div>
      <div class="cdet-tab-bar">
        <button class="cdet-tab active" data-tab="meta">${t('loc.tabMeta')}</button>
        <button class="cdet-tab" data-tab="atm">${t('loc.tabAtm')}</button>
        <button class="cdet-tab" data-tab="vtm">VtM</button>
        <button class="cdet-tab" data-tab="sens">${t('loc.tabSens')}${sensHasEmpty ? ' ⚠️' : ''}</button>
        <button class="cdet-tab" data-tab="keys">${t('loc.tabKeys')}</button>
        <button class="cdet-tab" data-tab="hooks">${t('loc.tabHooks')}</button>
        <button class="cdet-tab" data-tab="images">${t('loc.tabImages')}</button>
      </div>
      <div class="cdet-panels">
        <div class="cdet-panel active" data-panel="meta">${editPanel('meta', metaViewHtml, metaEditHtml)}</div>
        <div class="cdet-panel" data-panel="atm">${editPanel('atm', atmViewHtml, atmEditHtml)}</div>
        <div class="cdet-panel" data-panel="vtm">${editPanel('vtm', vtmViewHtml, vtmEditHtml)}</div>
        <div class="cdet-panel" data-panel="sens">${sensPanelHtml}</div>
        <div class="cdet-panel" data-panel="keys">${editPanel('keys', keyPointsHtml, keyEditHtml)}</div>
        <div class="cdet-panel" data-panel="hooks">${editPanel('hooks', hooksViewHtml, hooksEditHtml)}</div>
        <div class="cdet-panel" data-panel="images">
          ${galleryHtml}
          <div class="cdet-upload-row">
            <button class="cdet-upload-btn" id="locdet-upload-btn" data-slug="${escAttr(slug)}">${t('cdet.uploadBtn')}</button>
            <span id="locdet-upload-msg" class="cdet-save-msg" style="display:none">${t('loc.uploaded')}</span>
          </div>
          <div class="cdet-section-title cdet-prompt-head locdet-prompt-head" style="margin-top:16px">
            <span>${t('loc.promptTitle')}</span>
            <button type="button" class="cdet-gen-prompt-btn" id="locdet-gen-prompt" data-slug="${escAttr(slug)}" title="${t('loc.genPromptTitle')}">${t('loc.genPromptBtn')}</button>
          </div>
          <textarea class="cdet-prompt-box" id="locdet-img-prompt-ta">${escHtml(loc.imagePrompt || '')}</textarea>
          <div class="cdet-section-title" style="margin-top:12px">${t('loc.negPromptTitle')}</div>
          <textarea class="cdet-prompt-box cdet-prompt-neg" id="locdet-img-neg-ta">${escHtml(loc.negativePrompt || '')}</textarea>
          <div class="cdet-edit-bar" style="margin-top:8px;display:flex">
            <button class="cdet-save-btn" data-saveloc="images">${t('loc.savePrompts')}</button>
            <span class="cdet-save-msg" id="locdet-images-msg" style="display:none">${t('cdet.saved')}</span>
          </div>
          <div class="comfy-loc-row">
            <button type="button" class="cdet-gen-prompt-btn comfy-gen-btn" data-comfy-gen="location" data-comfy-slug="${escAttr(slug)}" title="${t('comfy.genTitle')}">${t('comfy.genBtn')}</button>
            <span class="comfy-loc-hint">${t('comfy.savedPromptHint')}</span>
          </div>
          <div class="comfy-box" data-comfy-kind="location" data-comfy-slug="${escAttr(slug)}"></div>
        </div>
      </div>
    </div>`;

  openModal('loc-detail-modal');
  if (loc.imageUrl) initLocCarousel(slug);
  // Даталист «Хозяин» (режим «Частный домен») наполняется заранее: реестр персонажей
  // мог быть ещё не загружен (страница локаций его сама не тянет), а клик по полю
  // открывает пикер мгновенно — пустой список читается как «Справочник недоступен».
  _fillOwnerCharsList();

  if (keepTab) {
    const tab = document.querySelector(`#loc-detail-content .cdet-tab[data-tab="${keepTab}"]`);
    if (tab) tab.click();
  }
}

// Location card clicks
document.getElementById('locs-grid').addEventListener('click', e => {
  const delBtn = e.target.closest('.loc-card-del-btn');
  if (delBtn) { deleteLoc(delBtn.dataset.delLoc); return; }
  const card = e.target.closest('.loc-card[data-slug]');
  if (card) openLocDetail(card.dataset.slug);
});

document.getElementById('btn-export-locs')?.addEventListener('click', e => {
  e.preventDefault();
  window.location.href = `/api/export/locations${window.location.search}`;
});
document.getElementById('btn-import-locs')?.addEventListener('click', e => {
  e.preventDefault();
  document.getElementById('import-locs-file')?.click();
});
document.getElementById('import-locs-file')?.addEventListener('change', async e => {
  const file = e.target.files[0];
  // loadLocations() при непустом кэше только перерисовывает его — без сброса
  // импортированные локации видны лишь после F5.
  await importCardsFromFile('locations', file, () => {
    STATE.locations = [];
    return loadLocations();
  });
  e.target.value = '';
});

// Location filter events
document.getElementById('loc-search').addEventListener('input', e => {
  STATE.locFilter.search = e.target.value;
  if (STATE.locations.length) renderLocations();
});
document.getElementById('loc-filter-zone').addEventListener('change', e => {
  STATE.locFilter.zone = e.target.value;
  if (STATE.locations.length) renderLocations();
});
document.getElementById('loc-filter-district').addEventListener('change', e => {
  STATE.locFilter.district = e.target.value;
  if (STATE.locations.length) renderLocations();
});
document.getElementById('loc-filter-masq').addEventListener('change', e => {
  STATE.locFilter.masq = e.target.value;
  if (STATE.locations.length) renderLocations();
});

// ── Вкладки раздела «Локации / Районы» (спека locations-districts-tab) ──────────
const LOC_SECTION_TAB_KEY = 'sanguine-locations-tab';
let _locSectionTab = 'locations';

function _readLocSectionTab() {
  try { return localStorage.getItem(LOC_SECTION_TAB_KEY) === 'districts' ? 'districts' : 'locations'; }
  catch { return 'locations'; }
}

// Вид вкладок + подгрузка районов. Сохранение выбора — только switchLocSectionTab.
function _applyLocSectionTab(tab) {
  _locSectionTab = tab === 'districts' ? 'districts' : 'locations';
  document.querySelectorAll('[data-loc-tab]').forEach(btn => {
    const on = btn.dataset.locTab === _locSectionTab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  document.getElementById('loc-tab-locations').hidden = _locSectionTab !== 'locations';
  document.getElementById('loc-tab-districts').hidden = _locSectionTab !== 'districts';
  if (_locSectionTab === 'districts') loadDistricts();
}

function switchLocSectionTab(tab) {
  if (tab === _locSectionTab) return; // клик по уже активной вкладке — не перезагружать сетку
  _applyLocSectionTab(tab);
  try { localStorage.setItem(LOC_SECTION_TAB_KEY, _locSectionTab); } catch {}
  if (_locSectionTab === 'locations' && STATE.locations.length) renderLocations();
}

document.querySelector('#page-locations .loc-section-tabs')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-loc-tab]');
  if (btn) switchLocSectionTab(btn.dataset.locTab);
});

// ── Районы: сетка ────────────────────────────────────────────────────────────
// Привязка локации к району — папка (первый сегмент dirRelPath), а не текстовая
// метка loc.district: то же правило, что у страницы города (_cityViewDistrictsHtml).
function _districtLocations(distSlug) {
  return STATE.locations.filter(l => (l.dirRelPath || '').split('/')[0] === distSlug);
}

let _distSearch = '';
let _distLoadSeq = 0;

// Перезагрузка при каждом входе на вкладку и после каждой мутации — район могли
// изменить на странице города, а запрос дешёвый. ensureLocsLoaded — иначе при
// прямом заходе на «Районы» счётчики локаций нулевые.
async function loadDistricts() {
  const grid = document.getElementById('districts-grid');
  const seq = ++_distLoadSeq;
  if (!STATE.districts.length) {
    grid.innerHTML = '<div class="loading-state"><div class="spinner"></div>' + t('loc.dist.loading') + '</div>';
  }
  try {
    const [r] = await Promise.all([
      fetch(`/api/cities/${encodeURIComponent(CITY)}/districts`),
      ensureLocsLoaded(),
    ]);
    if (!r.ok) throw new Error(r.statusText);
    const data = await r.json();
    if (seq !== _distLoadSeq) return; // устаревший ответ — уже ушёл более новый запрос
    STATE.districts = Array.isArray(data) ? data : [];
    renderDistricts();
  } catch {
    if (seq !== _distLoadSeq) return;
    grid.innerHTML = '<div class="loading-state form-error">' + t('loc.dist.loadError') + '</div>';
  }
}

function renderDistricts() {
  const all = STATE.districts;
  const q = _distSearch.trim().toLowerCase();
  const list = q ? all.filter(d => (d.name || d.slug).toLowerCase().includes(q)) : all;

  if (_locSectionTab === 'districts') {
    document.getElementById('locations-sub').textContent =
      `${list.length} ${_locCountWord(list.length, t('loc.dist.countOne'), t('loc.dist.countFew'), t('loc.dist.countMany'))}`;
  }

  const grid = document.getElementById('districts-grid');
  if (!all.length) {
    grid.innerHTML = emptyStateHtml({ title: t('loc.dist.empty'), body: t('loc.dist.emptyBody') });
    return;
  }
  if (!list.length) {
    grid.innerHTML = '<div class="loading-state" style="height:100px">' + t('loc.dist.notFound') + '</div>';
    return;
  }
  grid.innerHTML = list.map((d, i) =>
    _distGridCardHtml(d, `style="animation-delay:${Math.min(i, 12) * 30}ms"`)
  ).join('');
  fitLocTitles();
}

// Карточка района в сетке — каркас .loc-card без арта (у district.md нет art/).
function _distGridCardHtml(dist, delay = '') {
  const n = _districtLocations(dist.slug).length;
  const name = dist.name || dist.slug;
  return `<div class="loc-card dist-card" data-dist-slug="${escAttr(dist.slug)}" role="button" tabindex="0" aria-label="${escAttr(name)}" ${delay}>
    <span class="loc-zone-icon" aria-hidden="true">🏘️</span>
    <div class="loc-title">${escHtml(name)}</div>
    <div class="loc-district">${n} ${_locCountWord(n, t('loc.countOne'), t('loc.countFew'), t('loc.countMany'))}</div>
    <button type="button" class="loc-card-del-btn" data-del-dist="${escAttr(dist.slug)}" title="${t('loc.dist.deleteTitle')}" aria-label="${t('loc.dist.deleteTitle')}">🗑</button>
  </div>`;
}

const districtsGrid = document.getElementById('districts-grid');
districtsGrid.addEventListener('click', e => {
  const delBtn = e.target.closest('[data-del-dist]');
  if (delBtn) { e.stopPropagation(); _deleteDistrict(delBtn.dataset.delDist); return; }
  const card = e.target.closest('.dist-card[data-dist-slug]');
  if (card) openDistrictDetail(card.dataset.distSlug);
});
districtsGrid.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('.dist-card[data-dist-slug]');
  if (!card || e.target !== card) return; // Enter на 🗑 — нативный клик кнопки
  e.preventDefault();
  openDistrictDetail(card.dataset.distSlug);
});
document.getElementById('dist-search').addEventListener('input', e => {
  _distSearch = e.target.value;
  renderDistricts();
});
document.getElementById('dist-page-create-btn').addEventListener('click', () => openDistrictDetail(null, { create: true }));

// ── Районы: карточка (модалка) ───────────────────────────────────────────────
// Поля «Метаданных» — массив описаний (F14: перенос поля на другую вкладку —
// правка массива). Подписи — общие с формой района страницы города.
const DISTRICT_META_FIELDS = [
  { key: 'name',        label: 'city.districtNameLabel' },
  { key: 'type',        label: 'city.districtTypeLabel' },
  { key: 'sect',        label: 'city.districtFactionsLabel' },
  { key: 'clan',        label: 'city.districtClanLabel' },
  { key: 'description', label: 'city.districtDescLabel', multiline: true, emptyKey: 'loc.dist.descEmpty' },
];

let _currentDist = null;      // район в открытой модалке ({} в режиме создания)
let _distCreateMode = false;
let _distFactionNames = [];

// Подпись без маркера обязательности «*» — в просмотре он не нужен.
const _distFieldLabel = f => t(f.label).replace(/\s*\*\s*$/, '');

function _distMetaViewHtml(dist) {
  const rows = DISTRICT_META_FIELDS.map(f => {
    const v = String(dist[f.key] || '').trim();
    const val = v
      ? `<div class="locdet-val${f.multiline ? ' distdet-multiline' : ''}">${escHtml(v)}</div>`
      : (f.emptyKey
        ? `<div class="locdet-val"><span class="cdet-empty distdet-empty">${t(f.emptyKey)}</span></div>`
        : '<div class="locdet-val">—</div>');
    return `<div class="locdet-row" data-dist-field="${f.key}"><div class="locdet-key">${escHtml(_distFieldLabel(f))}</div>${val}</div>`;
  });
  return `<div class="locdet-table">${rows.join('')}</div>`;
}

function _distLocsPanelHtml(locs) {
  return locs.length
    ? `<div class="locs-grid distdet-locs-grid">${locs.map(l => _locCardHtml(l, { noDelete: true })).join('')}</div>`
    : `<div class="cdet-empty">${t('loc.dist.locsEmpty')}</div>`;
}

// ── Вкладка «Изображения» района (spec doc/design/district-images-2026-11-17) ──
// Галерея — art/ рядом с district.md; промты — сайдкар art/prompts.json (секций в
// карточке не бывает: PUT /districts перезаписывает district.md целиком). Разметка
// повторяет вкладку локации (единый вид), но у района СВОИ обработчики — локационные
// завязаны на /api/locations/…, STATE.locations и контейнер #loc-detail-content.

function _distGalleryHtml(images) {
  if (images === null) return `<div class="cdet-empty" style="margin-bottom:12px">${t('distdet.imagesEmpty')}</div>`;
  return images.length
    ? `<div class="locdet-img-gallery">${images.map(u => {
        const filename = decodeURIComponent(u.split('/').pop());
        return `<div class="locdet-img-thumb-wrap">
          <img class="locdet-thumb" src="${escAttr(u)}" alt="" loading="lazy" decoding="async">
          <span class="locdet-thumb-name">${escHtml(filename)}</span>
          <button class="distdet-img-del-btn" data-file="${escAttr(filename)}" title="${t('cdet.imgDelTitle')}">✕</button>
        </div>`;
      }).join('')}</div>`
    : `<div class="cdet-empty" style="margin-bottom:12px">${t('distdet.imagesEmpty')}</div>`;
}

// Неблокирующая догрузка: модалка района открывается сразу, галерея и промты
// приходят следом (GET /images отдаёт и то, и другое — расширение контракта локаций).
async function _loadDistImages(slug) {
  const slot = document.getElementById('distdet-images-slot');
  if (!slot || _currentDist?.slug !== slug) return;
  let images = [], prompts = { positive: '', negative: '' };
  try {
    const r = await fetch(`/api/cities/${encodeURIComponent(CITY)}/districts/${encodeURIComponent(slug)}/images`);
    if (r.ok) {
      const d = await r.json();
      images = d.images || [];
      prompts = d.prompts || prompts;
    }
  } catch { /* без сети — пустая галерея */ }
  if (_currentDist?.slug !== slug) return; // пока грузились, открыли другой район
  const slotNow = document.getElementById('distdet-images-slot');
  if (slotNow) slotNow.innerHTML = _distGalleryHtml(images);
  const posTa = document.getElementById('distdet-img-prompt-ta');
  const negTa = document.getElementById('distdet-img-neg-ta');
  if (posTa) posTa.value = prompts.positive || '';
  if (negTa) negTa.value = prompts.negative || '';
}

// Кнопка comfy-генерации не блокируется на клиенте — паритет с локацией: модалка
// prepare сама запрещает старт без сохранённого промта (hasPrompt → #comfy-start).

function _distImagesPanelHtml(dist) {
  return `
    <div id="distdet-images-slot"><div class="cdet-empty" style="margin-bottom:12px">${t('distdet.imagesEmpty')}</div></div>
    <div class="cdet-upload-row">
      <button class="cdet-upload-btn" id="distdet-upload-btn" data-slug="${escAttr(dist.slug)}">${t('cdet.uploadBtn')}</button>
      <span id="distdet-upload-msg" class="cdet-save-msg" style="display:none">${t('loc.uploaded')}</span>
    </div>
    <div class="cdet-section-title cdet-prompt-head locdet-prompt-head" style="margin-top:16px">
      <span>${t('loc.promptTitle')}</span>
      <button type="button" class="cdet-gen-prompt-btn" id="distdet-gen-prompt" data-slug="${escAttr(dist.slug)}" title="${t('distdet.genPromptTitle')}">${t('loc.genPromptBtn')}</button>
    </div>
    <textarea class="cdet-prompt-box" id="distdet-img-prompt-ta"></textarea>
    <div class="cdet-section-title" style="margin-top:12px">${t('loc.negPromptTitle')}</div>
    <textarea class="cdet-prompt-box cdet-prompt-neg" id="distdet-img-neg-ta"></textarea>
    <div class="cdet-edit-bar" style="margin-top:8px;display:flex">
      <button class="cdet-save-btn" id="distdet-save-prompts">${t('loc.savePrompts')}</button>
      <span class="cdet-save-msg" id="distdet-images-msg" style="display:none">${t('cdet.saved')}</span>
    </div>
    <div class="comfy-loc-row">
      <button type="button" class="cdet-gen-prompt-btn comfy-gen-btn" data-comfy-gen="district" data-comfy-slug="${escAttr(dist.slug)}" title="${t('comfy.genTitle')}">${t('comfy.genBtn')}</button>
      <span class="comfy-loc-hint">${t('comfy.savedPromptHint')}</span>
    </div>
    <div class="comfy-box" data-comfy-kind="district" data-comfy-slug="${escAttr(dist.slug)}"></div>`;
}

// Загрузка картинки в галерею района — тот же поток, что у локации (_locTriggerUpload):
// файл → base64 → POST upload-image → переоткрытие карточки на вкладке изображений.
function _distTriggerUpload(slug) {
  if (!slug) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const msgEl = document.getElementById('distdet-upload-msg');
    const btn   = document.getElementById('distdet-upload-btn');
    if (btn) btn.disabled = true;
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const ext  = file.name.split('.').pop() || 'jpg';
      const resp = await fetch(`/api/cities/${encodeURIComponent(CITY)}/districts/${encodeURIComponent(slug)}/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, ext })
      });
      if (!resp.ok) throw new Error(await resp.text());
      showSaveMsg(msgEl, { text: t('loc.uploaded'), hideAfter: 2500 });
      await openDistrictDetail(slug, { tab: 'images' }); // свежая галерея + кандидаты comfy
    } catch {
      showSaveMsg(msgEl, { text: t('loc.uploadError'), error: true });
    } finally {
      if (btn) btn.disabled = false;
    }
  };
  input.click();
}

// Удаление картинки из галереи района. Ссылок в карточке нет (секций не бывает),
// поэтому после удаления достаточно перерисовать сетку на месте — без переоткрытия.
async function _deleteDistImage(slug, filename) {
  if (!slug) return;
  if (!await showConfirm(t('cdet.imgDeleteConfirm', { name: filename }), { danger: true, confirmText: t('cdet.imgDelTitle') })) return;
  try {
    const resp = await fetch(`/api/cities/${encodeURIComponent(CITY)}/districts/${encodeURIComponent(slug)}/images/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    const d = await resp.json();
    if (!d.ok) { showToast(t('cdet.imgDeleteError') + (d.error || ''), 'error'); return; }
    const wrap = document.querySelector(`.distdet-img-del-btn[data-file="${CSS.escape(filename)}"]`)?.closest('.locdet-img-thumb-wrap');
    if (wrap) wrap.remove();
    const grid = document.querySelector('#distdet-images-panel .locdet-img-gallery');
    if (grid && !grid.querySelectorAll('.locdet-img-thumb-wrap').length) {
      grid.outerHTML = `<div class="cdet-empty" style="margin-bottom:12px">${t('distdet.imagesEmpty')}</div>`;
    }
  } catch {
    showToast(t('cdet.imgDeleteError'), 'error');
  }
}

// Промты района — сайдкар art/prompts.json (PUT …/prompt); секций в district.md нет.
async function _distSavePrompts() {
  const slug = _currentDist?.slug;
  if (!slug) return;
  const msgEl = document.getElementById('distdet-images-msg');
  try {
    const r = await fetch(`/api/cities/${encodeURIComponent(CITY)}/districts/${encodeURIComponent(slug)}/prompt`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        positive: document.getElementById('distdet-img-prompt-ta')?.value || '',
        negative: document.getElementById('distdet-img-neg-ta')?.value || '',
      }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    showSaveMsg(msgEl, { text: t('cdet.saved'), hideAfter: 2500 });
  } catch (e) {
    showSaveMsg(msgEl, { text: '✗ ' + e.message, error: true });
  }
}

// «🎨 Промт» во вкладке «Изображения» карточки района: промт по «Описанию» district.md.
// Результат встаёт в поля и сразу сохраняется (паритет с локацией, _locGeneratePrompt) —
// кнопка «Сгенерировать изображение» берёт промт из сохранённого сайдкара.
let _distGenPromptRunning = false;
async function _distGeneratePrompt(slug) {
  if (_distGenPromptRunning || !slug) return;
  const posTa = document.getElementById('distdet-img-prompt-ta');
  const negTa = document.getElementById('distdet-img-neg-ta');
  if (posTa && posTa.value.trim()
    && !await showConfirm(t('loc.genPromptOverwrite'), { confirmText: t('loc.genPromptOverwriteYes') })) return;
  _distGenPromptRunning = true;
  const btn = () => document.getElementById('distdet-gen-prompt');
  if (btn()) { btn().disabled = true; btn().setAttribute('aria-busy', 'true'); btn().textContent = t('cdet.generating'); }
  try {
    const featPrefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref = _getPref(featPrefs, 'prompt', 'openrouter');
    const preferSource = pref.provider;
    const orModel = _providerHasModel(preferSource) ? (pref.model || null) : null;
    const resp = await fetch(`/api/cities/${encodeURIComponent(CITY)}/districts/${encodeURIComponent(slug)}/generate-prompt${window.location.search}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferSource, orModel }),
    });
    const d = await resp.json().catch(() => ({}));
    if (resp.status === 429 || d.rateLimited) { showToast(t('cdet.rateLimit'), 'warning'); return; }
    if (!d.ok) { showAiError(d, { operation: t('ais.featPrompt') }); return; }
    // Модалку могли закрыть или открыть другой район, пока шла генерация, — чужие поля не трогаем.
    if (document.getElementById('distdet-gen-prompt')?.dataset.slug !== slug || !posTa?.isConnected) return;
    posTa.value = d.positive;
    if (negTa) negTa.value = d.negative || '';
    await _distSavePrompts();
  } catch (e) {
    showToast(t('cdet.err') + e.message, 'error');
  } finally {
    _distGenPromptRunning = false;
    if (btn()) { btn().disabled = false; btn().removeAttribute('aria-busy'); btn().textContent = t('loc.genPromptBtn'); }
  }
}

// Опции «Влияние — фракция» — секция «Фракции» city.md (тот же источник, что у
// страницы города; текущее значение, которого нет в списке, сохраняет
// _districtSectOptionsHtml отдельной опцией).
async function _fetchDistFactionNames() {
  try {
    const list = await fetch(`/api/cities/${encodeURIComponent(CITY)}/factions-list`).then(r => r.ok ? r.json() : []);
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function _distDetailHtml(dist, create) {
  const locs = create ? [] : _districtLocations(dist.slug);
  const title = create ? t('loc.dist.newTitle') : (dist.name || dist.slug);
  return `
    <div class="locdet-img-col"><div class="locdet-no-img" aria-hidden="true">🏘️</div></div>
    <div class="cdet-info-col">
      <div class="cdet-sticky-header">
        <div class="cdet-name" id="distdet-title">${escHtml(title)}</div>
        ${create ? '' : `<button type="button" class="cdet-edit-btn locdet-delete-btn" id="distdet-delete-btn" style="margin-bottom:6px">${t('loc.dist.deleteBtn')}</button>`}
      </div>
      <div class="cdet-tab-bar">
        <button type="button" class="cdet-tab active" data-tab="meta">${t('loc.dist.tabMeta')}</button>
        ${create ? '' : `<button type="button" class="cdet-tab" data-tab="locs">${t('loc.dist.tabLocs', { n: locs.length })}</button>`}
        ${create ? '' : `<button type="button" class="cdet-tab" data-tab="factions">${t('loc.dist.tabFactions')}</button>`}
        ${create ? '' : `<button type="button" class="cdet-tab" data-tab="images">${t('loc.tabImages')}</button>`}
      </div>
      <div class="cdet-panels">
        <div class="cdet-panel active" data-panel="meta">
          <div class="cdet-info-header">
            ${create ? '' : `<button type="button" class="cdet-edit-btn" id="distdet-edit-btn">${t('cdet.editBtn')}</button>`}
          </div>
          <div id="distdet-view"${create ? ' style="display:none"' : ''}>${create ? '' : _distMetaViewHtml(dist)}</div>
          <div id="distdet-edit" class="dist-edit-fields"${create ? '' : ' style="display:none"'}>${create ? _districtFieldsHtml({}, _distFactionNames) : ''}</div>
          <div class="cdet-edit-bar" id="distdet-bar" style="display:${create ? 'flex' : 'none'}">
            <button type="button" class="cdet-save-btn" id="distdet-save-btn">${create ? t('ui.btn.create') : t('cdet.saveBtn')}</button>
            <button type="button" class="cdet-cancel-btn" id="distdet-cancel-btn">${t('cdet.cancelBtn')}</button>
            <span class="cdet-save-msg" id="distdet-msg" role="status" aria-live="polite" style="display:none"></span>
          </div>
        </div>
        ${create ? '' : `<div class="cdet-panel" data-panel="locs">${_distLocsPanelHtml(locs)}</div>`}
        ${create ? '' : `<div class="cdet-panel" data-panel="factions" id="distdet-factions-panel"></div>`}
        ${create ? '' : `<div class="cdet-panel" data-panel="images" id="distdet-images-panel">${_distImagesPanelHtml(dist)}</div>`}
      </div>
    </div>`;
}

async function openDistrictDetail(slug, { tab = null, create = false } = {}) {
  const dist = create ? {} : STATE.districts.find(d => d.slug === slug);
  if (!dist) return;
  _currentDist = dist;
  _distCreateMode = create;
  _distFactionNames = await _fetchDistFactionNames();
  document.getElementById('district-detail-content').innerHTML = _distDetailHtml(dist, create);
  // Галерея и промты района — неблокирующая догрузка (GET /images), модалка уже отрисована.
  if (!create) _loadDistImages(dist.slug);
  // Создание → сохранение перерисовывает уже открытую модалку: повторный openModal
  // запомнил бы как «вернуть фокус» кнопку, которой больше нет в DOM.
  if (!districtDetailModal.classList.contains('open')) {
    openModal('district-detail-modal', create ? '.city-district-name' : null);
  }
  fitLocTitles();
  if (tab) document.querySelector(`#district-detail-content .cdet-tab[data-tab="${tab}"]`)?.click();
}

function _distToggleEdit(enter) {
  const viewEl = document.getElementById('distdet-view');
  const editEl = document.getElementById('distdet-edit');
  if (!viewEl || !editEl) return;
  // Форма строится заново при каждом входе — «Отмена» не оставляет недосохранённых правок.
  if (enter) editEl.innerHTML = _districtFieldsHtml(_currentDist, _distFactionNames);
  viewEl.style.display = enter ? 'none' : '';
  editEl.style.display = enter ? '' : 'none';
  document.getElementById('distdet-bar').style.display = enter ? 'flex' : 'none';
  hideSaveMsg(document.getElementById('distdet-msg'));
  if (enter) editEl.querySelector('.city-district-name')?.focus();
}

function _distShowMsg(text, isError) {
  showSaveMsg(document.getElementById('distdet-msg'), { text, error: isError });
}

async function _saveDistrict() {
  const editEl = document.getElementById('distdet-edit');
  const btn = document.getElementById('distdet-save-btn');
  if (!editEl || !btn || btn.disabled) return;
  const fields = _collectDistrictCard(editEl);
  if (!fields.name) {
    _distShowMsg(t('city.districtNameRequired'), true);
    editEl.querySelector('.city-district-name')?.focus();
    return;
  }
  const create = _distCreateMode;
  const base = `/api/cities/${encodeURIComponent(CITY)}/districts`;
  const url = create ? base : `${base}/${encodeURIComponent(_currentDist.slug)}`;
  const idleText = create ? t('ui.btn.create') : t('cdet.saveBtn');

  btn.disabled = true;
  btn.textContent = t('cdet.saving');
  try {
    const r = await fetch(url, {
      method: create ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    if (j.warning) showToast(j.warning, 'warning');
    await loadDistricts();
    if (create) {
      // Список мог не перезагрузиться (сеть) — район уже создан, карточку всё равно открываем.
      if (!STATE.districts.some(d => d.slug === j.slug)) STATE.districts.push({ slug: j.slug, ...fields });
      showToast(t('city.districtCreated', { name: fields.name }), 'success');
      await openDistrictDetail(j.slug);
      return;
    }
    _currentDist = STATE.districts.find(d => d.slug === _currentDist.slug) || { ..._currentDist, ...fields };
    document.getElementById('distdet-view').innerHTML = _distMetaViewHtml(_currentDist);
    document.getElementById('distdet-title').textContent = _currentDist.name || _currentDist.slug;
    // Полоса кнопок с сообщением скрывается вместе с формой — успех сообщаем тостом.
    _distToggleEdit(false);
    showToast(t('city.savedMsg'), 'success');
  } catch (e) {
    _distShowMsg(`✗ ${e.message}`, true);
  } finally {
    // После успешного создания модалка уже перерисована — старой кнопки нет в DOM.
    if (btn.isConnected) { btn.disabled = false; btn.textContent = idleText; }
  }
}

async function _deleteDistrict(slug) {
  const dist = STATE.districts.find(d => d.slug === slug);
  if (!dist) return;
  const title = dist.name || dist.slug;
  const ok = await showConfirm(t('loc.dist.deleteConfirm', { title }), { danger: true, confirmText: t('ui.btn.delete') });
  if (!ok) return;
  try {
    const r = await fetch(`/api/cities/${encodeURIComponent(CITY)}/districts/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 409 && Array.isArray(j.locations) && j.locations.length) {
        showToast(`${j.error} (${j.locations.join(', ')})`, 'error');
      } else {
        showToast(j.error || t('city.districtDeleteErr'), 'error');
      }
      return;
    }
    if (j.warning) showToast(j.warning, 'warning');
    showToast(t('city.districtDeleted', { title }), 'success');
    if (_currentDist?.slug === slug) closeModal('district-detail-modal');
    await loadDistricts();
  } catch (e) {
    showToast(t('city.districtDeleteErrMsg', { msg: e.message }), 'error');
  }
}

const districtDetailModal = document.getElementById('district-detail-modal');
document.getElementById('district-detail-close').addEventListener('click', () => closeModal('district-detail-modal'));
bindBackdropDblClickClose(districtDetailModal, () => closeModal('district-detail-modal'));

document.getElementById('district-detail-content').addEventListener('click', e => {
  if (e.target.closest('#distdet-edit-btn'))   { _distToggleEdit(true); return; }
  if (e.target.closest('#distdet-save-btn'))   { _saveDistrict(); return; }
  if (e.target.closest('#distdet-cancel-btn')) {
    if (_distCreateMode) closeModal('district-detail-modal');
    else _distToggleEdit(false);
    return;
  }
  if (e.target.closest('#distdet-delete-btn')) { _deleteDistrict(_currentDist?.slug); return; }

  // Вкладка «Изображения» района — свои обработчики (контракты локаций, другой роутер).
  if (e.target.closest('#distdet-upload-btn'))   { _distTriggerUpload(_currentDist?.slug); return; }
  if (e.target.closest('#distdet-save-prompts')) { _distSavePrompts(); return; }
  const distGenPrompt = e.target.closest('#distdet-gen-prompt');
  if (distGenPrompt) { _distGeneratePrompt(distGenPrompt.dataset.slug); return; }
  const distDelImg = e.target.closest('.distdet-img-del-btn');
  if (distDelImg) { _deleteDistImage(_currentDist?.slug, distDelImg.dataset.file); return; }

  // Переход «район → локация» (F8): модалки не стекуются — Escape на document
  // закрыл бы обе, поэтому модалка района закрывается до открытия локации.
  const locCard = e.target.closest('.loc-card[data-slug]');
  if (locCard) {
    closeModal('district-detail-modal');
    openLocDetail(locCard.dataset.slug);
    return;
  }

  const tab = e.target.closest('.cdet-tab');
  if (!tab) return;
  const col = tab.closest('.cdet-info-col');
  col.querySelectorAll('.cdet-tab').forEach(b => b.classList.toggle('active', b === tab));
  col.querySelectorAll('.cdet-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab.dataset.tab));
  const panels = col.querySelector('.cdet-panels');
  if (panels) panels.scrollTop = 0;
  if (tab.dataset.tab === 'locs') fitLocTitles();
  // «Фракции» района считаются при каждом входе на вкладку: локации могли поправить.
  if (tab.dataset.tab === 'factions' && _currentDist?.slug) {
    loadDistrictInfluence(document.getElementById('distdet-factions-panel'), _currentDist.slug,
      { beforeOpenLoc: () => closeModal('district-detail-modal') });
  }
});

// Лайтбокс миниатюр района — свой хук на контейнере района (у локаций —
// на #loc-detail-content, 1603): общий обработчик не достанет до чужой модалки.
document.getElementById('district-detail-content').addEventListener('click', e => {
  if (e.target.closest('.distdet-img-del-btn')) return; // ✕ — удаление, не просмотр
  const thumb = e.target.closest('.locdet-thumb');
  if (!thumb) return;
  const imgs = Array.from(document.querySelectorAll('#district-detail-content .locdet-img-gallery .locdet-thumb')).map(i => i.src);
  const idx  = Math.max(0, imgs.indexOf(thumb.src));
  if (imgs.length) openLightbox(imgs, idx);
}, true);

// Location modal close
const locDetailModal = document.getElementById('loc-detail-modal');
document.getElementById('loc-detail-close').addEventListener('click', () => {
  closeModal('loc-detail-modal');
  if (_locCarouselTimer) { clearInterval(_locCarouselTimer); _locCarouselTimer = null; }
});
bindBackdropDblClickClose(locDetailModal, () => closeModal('loc-detail-modal'));

// Tab switching + carousel + edit/save/cancel + upload in location modal
document.getElementById('loc-detail-content').addEventListener('click', e => {
  if (e.target.closest('#locdet-carousel-prev')) { _locCarouselGoTo(_locCarouselIdx - 1, true); return; }
  if (e.target.closest('#locdet-carousel-next')) { _locCarouselGoTo(_locCarouselIdx + 1, true); return; }

  // Сенсорная палитра — per-channel регенерация/удаление/добавление (проверяем
  // раньше generic .hooks-del-btn ниже, т.к. кнопка удаления канала делит с ним класс).
  const sensRegenBtn = e.target.closest('[data-sens-regen]');
  if (sensRegenBtn) { _locRegenSensChannel(parseInt(sensRegenBtn.dataset.sensRegen, 10)); return; }
  const sensDelBtn = e.target.closest('[data-sens-del]');
  if (sensDelBtn) { _locDeleteSensChannel(parseInt(sensDelBtn.dataset.sensDel, 10)); return; }
  if (e.target.closest('#locdet-sens-add-btn')) {
    document.getElementById('locdet-sens-add-btn').style.display = 'none';
    const row = document.getElementById('locdet-sens-add-row');
    if (row) { row.style.display = 'flex'; document.getElementById('locdet-sens-new-channel')?.focus(); }
    return;
  }
  if (e.target.closest('#locdet-sens-add-cancel')) {
    document.getElementById('locdet-sens-add-row').style.display = 'none';
    document.getElementById('locdet-sens-add-btn').style.display = '';
    return;
  }
  if (e.target.closest('#locdet-sens-add-confirm')) { _locAddSensChannel(); return; }

  if (e.target.closest('.hooks-del-btn')) {
    const item = e.target.closest('.hooks-item');
    if (item) { item.remove(); _renumberHooks(); }
    return;
  }
  if (e.target.closest('#locdet-keys-add')) {
    const list = document.getElementById('locdet-keys-edit-list');
    if (list) {
      const div = document.createElement('div');
      div.className = 'hooks-item';
      div.innerHTML = `<input class="hooks-input keypt-place-inp" placeholder="${t('loc.keyPlacePh')}"><input class="hooks-input keypt-desc-inp" placeholder="${t('loc.keyDescPh')}"><button class="hooks-del-btn" title="${t('loc.delRowTitle')}">✕</button>`;
      list.appendChild(div);
      div.querySelector('.keypt-place-inp')?.focus();
    }
    return;
  }
  if (e.target.closest('#locdet-hooks-add')) {
    const list = document.getElementById('locdet-hooks-edit-list');
    if (list) {
      const n = list.querySelectorAll('.hooks-item').length + 1;
      const div = document.createElement('div');
      div.className = 'hooks-item';
      div.innerHTML = `<span class="hooks-num">${n}</span><input class="hooks-input" placeholder="${t('loc.hookPh')}"><button class="hooks-del-btn" title="${t('loc.delRowTitle')}">✕</button>`;
      list.appendChild(div);
      div.querySelector('.hooks-input').focus();
    }
    return;
  }

  const editBtn   = e.target.closest('[data-editloc]');
  const saveBtn   = e.target.closest('[data-saveloc]');
  const cancelBtn = e.target.closest('[data-cancelloc]');
  const uploadBtn = e.target.closest('#locdet-upload-btn');

  if (editBtn) {
    _locToggleEdit(editBtn.dataset.editloc, true);
    // Датаlist существующих районов — тот же источник, что и в модалке
    // создания/редактирования локации, только здесь ему негде было
    // populate'иться раньше (openLocEditModal туда не вызывалась).
    if (editBtn.dataset.editloc === 'meta') _loadDistrictsList();
    if (editBtn.dataset.editloc === 'vtm') _fillOwnerCharsList();
    return;
  }
  if (cancelBtn) { _locToggleEdit(cancelBtn.dataset.cancelloc, false); return; }
  if (saveBtn)   { _locSavePanel(saveBtn.dataset.saveloc);           return; }
  if (uploadBtn) { _locTriggerUpload(uploadBtn.dataset.slug);        return; }
  const genPromptBtn = e.target.closest('#locdet-gen-prompt');
  if (genPromptBtn) { _locGeneratePrompt(genPromptBtn.dataset.slug); return; }
  if (e.target.closest('#locdet-meta-district-clear')) {
    // ✕ очищает поле полностью; пустой «Район» при сохранении превращается в
    // «Другие» (см. _locSavePanel) — PUT /district пустую строку отклоняет.
    const inp = document.getElementById('locdet-meta-district');
    if (inp) { inp.value = ''; inp.focus(); }
    return;
  }

  const tab = e.target.closest('.cdet-tab');
  if (!tab) return;
  const col = tab.closest('.cdet-info-col');
  col.querySelectorAll('.cdet-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  col.querySelectorAll('.cdet-panel').forEach(p => p.classList.remove('active'));
  col.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
  const panels = col.querySelector('.cdet-panels');
  if (panels) panels.scrollTop = 0;
});

function _renumberHooks() {
  document.querySelectorAll('#locdet-hooks-edit-list .hooks-item').forEach((item, i) => {
    const num = item.querySelector('.hooks-num');
    if (num) num.textContent = i + 1;
  });
}

// §C1 — строки формы «Ключевые точки» обратно в markdown-таблицу. Пустой список
// (не единственный случай — счищена и последняя строка) даёт тот же пустой шаблон,
// что и _locCardTemplate/routes/locations.js, чтобы карточка визуально не отличалась
// от только что созданной. «|» в значениях сворачивается в ∣ (см. комментарий у
// keyEditHtml) — реальная таблица, не список, соседняя колонка иначе бы сдвинулась.
function _collectLocDetKeyPoints() {
  const esc = s => String(s).replace(/\|/g, '∣');
  const rows = Array.from(document.querySelectorAll('#locdet-keys-edit-list .hooks-item'))
    .map(item => ({
      place: item.querySelector('.keypt-place-inp')?.value.trim() || '',
      desc:  item.querySelector('.keypt-desc-inp')?.value.trim() || '',
    }))
    .filter(r => r.place || r.desc);
  return rows.length
    ? `| Место | Описание |\n|---|---|\n${rows.map(r => `| ${esc(r.place)} | ${esc(r.desc)} |`).join('\n')}`
    : '| Место | Описание |\n|---|---|\n| | |';
}

function _locToggleEdit(panel, enter) {
  const viewEl = document.getElementById(`locdet-${panel}-view`);
  const editEl = document.getElementById(`locdet-${panel}-edit`);
  const barEl  = document.getElementById(`locdet-${panel}-bar`);
  const msgEl  = document.getElementById(`locdet-${panel}-msg`);
  if (!viewEl || !editEl) return;
  viewEl.style.display = enter ? 'none' : '';
  editEl.style.display = enter ? '' : 'none';
  if (barEl) barEl.style.display = enter ? 'flex' : 'none';
  hideSaveMsg(msgEl);
}

async function _locSavePanel(panel) {
  const slug = _currentLocSlug;
  if (!slug) return;
  const msgEl = document.getElementById(`locdet-${panel}-msg`);
  const fields = {};

  if (panel === 'atm') {
    fields.atmosphere = document.getElementById('locdet-atm-ta')?.value || '';
  } else if (panel === 'vtm') {
    fields.vtmText = document.getElementById('locdet-vtm-ta')?.value || '';
    fields.vtmTable = {
      locStatus:  document.getElementById('locdet-vtm-status')?.value.trim() || '',
      // «Частный домен» — имя хозяина строкой; иначе список фракций (сервер соберёт «a, b»).
      faction:    document.getElementById('locdet-vtm-private-domain')?.checked
        ? (document.getElementById('locdet-vtm-faction')?.value.trim() || '')
        : (_locMultiValues('locdet-vtm-factions') || []),
      figures:    document.getElementById('locdet-vtm-figures')?.value.trim() || '',
      threats:    document.getElementById('locdet-vtm-threats')?.value.trim() || '',
      masquerade: document.getElementById('locdet-vtm-masquerade')?.value || '',
    };
    // «Опасность»/«Частный домен» — обычные метаданные-бюллеты (**Label:**), НЕ строки
    // VtM-таблицы — сохраняются отдельными полями verbatim, не через vtmTable
    // (2026-08-06, план «карточка локации» §3.3-3.4).
    fields.dangerLevel   = document.getElementById('locdet-vtm-danger')?.value || '';
    fields.privateDomain = document.getElementById('locdet-vtm-private-domain')?.checked ? 'да' : '';
  } else if (panel.startsWith('sens-')) {
    const idx  = parseInt(panel.slice('sens-'.length), 10);
    const val  = document.getElementById(`locdet-${panel}-ta`)?.value ?? '';
    const loc  = STATE.locations.find(l => l.slug === slug);
    const list = loc?.sensoryPalette?.length
      ? loc.sensoryPalette.slice()
      : ['Свет', 'Звук', 'Запах', 'Тактильное'].map(channel => ({ channel, value: '' }));
    if (!list[idx]) return;
    list[idx] = { ...list[idx], value: val };
    fields.sensoryPalette = _sensRebuildTable(list);
  } else if (panel === 'keys') {
    fields.keyPoints = _collectLocDetKeyPoints();
  } else if (panel === 'hooks') {
    const hookInputs = document.querySelectorAll('#locdet-hooks-edit-list .hooks-input');
    fields.hooks = Array.from(hookInputs).map(i => i.value.trim()).filter(Boolean).join('\n');
  } else if (panel === 'meta') {
    for (const key of ['subtype', 'neighborhood', 'address']) {
      const el = document.getElementById(`locdet-meta-${key}`);
      if (el) fields[key] = el.value;
    }
    // Списочные поля уходят массивом — сервер сам собирает «a, b» и чистит разделители.
    for (const key of ['control', 'presence']) {
      const list = _locMultiValues(`locdet-meta-${key}`);
      if (list) fields[key] = list;
    }
    // district — НЕ через общий PUT /fields (это только текст, папка не
    // переезжает) — отдельный PUT /district ниже, физический перенос, тот
    // же путь, что уже проверен _attachLocationToDistrict/
    // _detachLocationFromDistrict (city.js). Меняем только если правда
    // изменилось — не дёргать подтверждение на каждое сохранение meta.
  } else if (panel === 'images') {
    fields.imagePrompt    = document.getElementById('locdet-img-prompt-ta')?.value || '';
    fields.negativePrompt = document.getElementById('locdet-img-neg-ta')?.value || '';
  }

  if (panel === 'meta') {
    const districtInp = document.getElementById('locdet-meta-district');
    const loc = STATE.locations.find(l => l.slug === slug);
    // Пустой «Район» = открепление: тот же фолбэк «Другие», что у создания
    // локации без района. Без поля в DOM — район не трогаем. Локация уже в drugie/
    // (например, создана без района — метка пустая): сервер перенос в ту же папку
    // пропускает, поэтому и подтверждение не спрашиваем — иначе оно всплывало бы
    // на каждом сохранении «Метаданных».
    const typedDistrict = districtInp?.value.trim() || '';
    const newDistrict = districtInp ? (typedDistrict || 'Другие') : '';
    const oldDistrict = loc?.district || '';
    const alreadyDefault = !typedDistrict && (loc?.dirRelPath || '').split('/')[0] === 'drugie';
    if (newDistrict && newDistrict !== oldDistrict && !alreadyDefault) {
      const ok = await showConfirm(
        t('loc.moveDistrictConfirm', { district: newDistrict }),
        { confirmText: t('loc.moveBtn') }
      );
      if (!ok) return;
      try {
        const r = await fetch(`/api/locations/${encodeURIComponent(slug)}/district${window.location.search}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ district: newDistrict }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      } catch (e) {
        showSaveMsg(msgEl, { text: '✗ ' + e.message, error: true });
        return;
      }
    }
  }

  try {
    const resp = await fetch(`/api/locations/${encodeURIComponent(slug)}/fields${window.location.search}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });
    if (!resp.ok) throw new Error(await resp.text());

    // Полоса с сообщением скрывается вместе с формой — успех панели сообщаем тостом;
    // у «Изображений» полоса постоянная, там сообщение у кнопки.
    if (panel === 'images') showSaveMsg(msgEl, { text: t('cdet.saved'), hideAfter: 2500 });
    else { _locToggleEdit(panel, false); showToast(t('cdet.saved'), 'success'); }

    // Reload and re-render keeping current tab
    const activeTab = document.querySelector('#loc-detail-content .cdet-tab.active')?.dataset.tab;
    const data = await fetch(`/api/locations${window.location.search}`).then(r => r.json()).catch(() => null);
    if (data) {
      STATE.locations = data;
      openLocDetail(slug, activeTab);
    }
    // Карточку могли открыть со страницы «Фракции» — диаграммы считаются из её полей.
    if (typeof refreshInfluenceChartsIfVisible === 'function') refreshInfluenceChartsIfVisible();
  } catch {
    showSaveMsg(msgEl, { text: t('loc.error'), error: true });
  }
}


function _locTriggerUpload(slug) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const msgEl = document.getElementById('locdet-upload-msg');
    const btn   = document.getElementById('locdet-upload-btn');
    if (btn) btn.disabled = true;
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const ext  = file.name.split('.').pop() || 'jpg';
      const resp = await fetch(`/api/locations/${encodeURIComponent(slug)}/upload-image${window.location.search}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, ext })
      });
      if (!resp.ok) throw new Error(await resp.text());
      const { url } = await resp.json();

      showSaveMsg(msgEl, { text: t('loc.uploaded'), hideAfter: 2500 });

      // Reload and re-render
      const data = await fetch(`/api/locations${window.location.search}`).then(r => r.json()).catch(() => null);
      if (data) {
        STATE.locations = data;
        openLocDetail(slug, 'images');
      }
    } catch {
      showSaveMsg(msgEl, { text: t('loc.uploadError'), error: true });
    } finally {
      if (btn) btn.disabled = false;
    }
  };
  input.click();
}

let _locCarouselImages = [];
let _locCarouselIdx    = 0;
let _locCarouselTimer  = null;

async function initLocCarousel(slug) {
  if (_locCarouselTimer) { clearInterval(_locCarouselTimer); _locCarouselTimer = null; }
  _locCarouselImages = [];
  _locCarouselIdx = 0;

  const resp = await fetch(`/api/locations/${encodeURIComponent(slug)}/images${window.location.search}`)
    .catch(() => null);
  if (!resp?.ok) return;
  const { images } = await resp.json().catch(() => ({}));
  if (!images || images.length <= 1) {
    document.getElementById('locdet-carousel-prev')?.style.setProperty('display', 'none');
    document.getElementById('locdet-carousel-next')?.style.setProperty('display', 'none');
    return;
  }

  _locCarouselImages = images;
  _locCarouselIdx    = 0;

  const dotsEl = document.getElementById('locdet-carousel-dots');
  if (dotsEl) {
    dotsEl.innerHTML = images.map((_, i) =>
      `<div class="locdet-carousel-dot${i === 0 ? ' active' : ''}"></div>`
    ).join('');
  }

  _locCarouselTimer = setInterval(() => _locCarouselGoTo(_locCarouselIdx + 1), 60 * 1000);
}

function _locCarouselGoTo(targetIdx, resetTimer = false) {
  const img     = document.getElementById('locdet-carousel-img');
  const overlay = document.getElementById('locdet-carousel-overlay');
  const dotsEl  = document.getElementById('locdet-carousel-dots');
  if (!img || !overlay || !_locCarouselImages.length) {
    clearInterval(_locCarouselTimer); _locCarouselTimer = null; return;
  }

  const next = ((targetIdx % _locCarouselImages.length) + _locCarouselImages.length) % _locCarouselImages.length;

  overlay.classList.add('dimmed');
  setTimeout(() => {
    _locCarouselIdx = next;
    img.src = _locCarouselImages[_locCarouselIdx];
    if (dotsEl) {
      dotsEl.querySelectorAll('.locdet-carousel-dot').forEach((d, i) =>
        d.classList.toggle('active', i === _locCarouselIdx));
    }
    setTimeout(() => overlay.classList.remove('dimmed'), 300);
  }, 2100);

  if (resetTimer && _locCarouselTimer) {
    clearInterval(_locCarouselTimer);
    _locCarouselTimer = setInterval(() => _locCarouselGoTo(_locCarouselIdx + 1), 60 * 1000);
  }
}

// ── Image Lightbox ───────────────────────────────────────────────────────────

let _lbImages = [];
let _lbIdx    = 0;
let _lbMeta   = null; // опционально: [{caption, description}] для имущества

function openLightbox(images, startIdx = 0, meta = null) {
  _lbImages = images;
  _lbIdx    = startIdx;
  _lbMeta   = Array.isArray(meta) ? meta : null;
  _lbRender();
  document.getElementById('img-lightbox').classList.add('open');
}

function _lbRender() {
  const img     = document.getElementById('lightbox-img');
  const counter = document.getElementById('lightbox-counter');
  const prev    = document.getElementById('lightbox-prev');
  const next    = document.getElementById('lightbox-next');
  const metaEl  = document.getElementById('lightbox-meta');
  const capEl   = document.getElementById('lightbox-caption');
  const descEl  = document.getElementById('lightbox-desc');
  img.src       = _lbImages[_lbIdx];
  img.alt       = (_lbMeta && _lbMeta[_lbIdx]?.caption) ? _lbMeta[_lbIdx].caption : '';
  counter.textContent = _lbImages.length > 1 ? `${_lbIdx + 1} / ${_lbImages.length}` : '';
  prev.style.display  = _lbImages.length > 1 ? '' : 'none';
  next.style.display  = _lbImages.length > 1 ? '' : 'none';
  if (_lbMeta && _lbMeta[_lbIdx]) {
    const m = _lbMeta[_lbIdx];
    capEl.textContent = m.caption || '';
    descEl.textContent = m.description || '';
    descEl.style.display = m.description ? '' : 'none';
    capEl.style.display = m.caption ? '' : 'none';
    metaEl.hidden = !m.caption && !m.description;
    metaEl.style.display = metaEl.hidden ? 'none' : '';
    document.getElementById('img-lightbox').classList.toggle('with-meta', !metaEl.hidden);
  } else {
    if (metaEl) { metaEl.hidden = true; metaEl.style.display = 'none'; }
    document.getElementById('img-lightbox').classList.remove('with-meta');
  }
}

function _lbGo(delta) {
  _lbIdx = ((_lbIdx + delta) % _lbImages.length + _lbImages.length) % _lbImages.length;
  _lbRender();
}

(function _initLightbox() {
  const lb   = document.getElementById('img-lightbox');
  document.getElementById('lightbox-close').addEventListener('click', () => lb.classList.remove('open'));
  document.getElementById('lightbox-prev').addEventListener('click',  () => _lbGo(-1));
  document.getElementById('lightbox-next').addEventListener('click',  () => _lbGo(1));
  bindBackdropDblClickClose(lb, () => lb.classList.remove('open'));
  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); _lbGo(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); _lbGo(1); }
    if (e.key === 'Escape')     lb.classList.remove('open');
  });
})();

// Open lightbox: carousel image (dblclick, consistent with characters) or gallery thumbnail (click)
document.getElementById('loc-detail-content').addEventListener('click', e => {
  const delBtn = e.target.closest('.locdet-img-del-btn');
  if (delBtn) { _deleteLocImage(delBtn.dataset.loc, delBtn.dataset.file); return; }
  const thumb = e.target.closest('.locdet-thumb');
  if (thumb) {
    const loc = STATE.locations.find(l => l.slug === _currentLocSlug);
    const imgs = (loc?.imageUrls) || (loc?.imageUrl ? [loc.imageUrl] : [thumb.src]);
    const idx  = imgs.indexOf(thumb.src);
    openLightbox(imgs, idx >= 0 ? idx : 0);
  }
}, true);
document.getElementById('loc-detail-content').addEventListener('dblclick', e => {
  const carousel = e.target.closest('#locdet-carousel-img');
  if (carousel) {
    const images = _locCarouselImages.length ? _locCarouselImages : [carousel.src];
    openLightbox(images, _locCarouselIdx);
  }
}, true);

// ═══════════════════════════════════════════════════════════════════════════
// Location Edit / Create Modal
// ═══════════════════════════════════════════════════════════════════════════

let _locEditSlug = null; // null = create, string = edit

// prefilledDistrict: опциональное имя района — предзаполняет и дизейблит поле
// «Район» (для встраивания модалки в блок «Район» формы создания/редактирования
// города, где район уже определён контекстом вызова). Актуально только для
// создания (slug=null); при редактировании существующей локации район всегда
// остаётся редактируемым.
function openLocEditModal(slug, prefilledDistrict) {
  _locEditSlug = slug || null;
  const title = document.getElementById('loc-edit-title');
  const delBtn = document.getElementById('loc-edit-delete-btn');
  const errDiv = document.getElementById('loc-edit-error');

  title.textContent = slug ? t('loc.editTitle') : t('loc.createTitle');
  delBtn.style.display = slug ? '' : 'none';
  errDiv.style.display = 'none';
  errDiv.textContent = '';
  document.getElementById('loc-edit-gen-hint').textContent = '';

  // Clear fields
  ['name','district','neighborhood','address','control','atmosphere','vtm-context','hooks','image-prompt','context'].forEach(id => {
    const el = document.getElementById(`loc-edit-${id}`);
    if (el) el.value = '';
  });
  document.getElementById('loc-edit-danger').value = '';
  _locEditMultiRender('control', []);
  _locEditMultiRender('presence', []);

  const districtEl = document.getElementById('loc-edit-district');
  districtEl.disabled = false;
  if (!slug && prefilledDistrict) {
    districtEl.value = prefilledDistrict;
    districtEl.disabled = true;
  }

  if (slug) {
    const loc = STATE.locations.find(l => l.slug === slug);
    if (loc) {
      document.getElementById('loc-edit-name').value        = loc.title || loc.subtype || loc.slug || '';
      document.getElementById('loc-edit-district').value    = loc.district || '';
      document.getElementById('loc-edit-neighborhood').value = loc.neighborhood || '';
      document.getElementById('loc-edit-address').value     = loc.address || '';
      _locEditMultiRender('control', loc.controlList || []);
      _locEditMultiRender('presence', loc.presenceList || []);
      document.getElementById('loc-edit-atmosphere').value  = loc.atmosphere || '';
      document.getElementById('loc-edit-hooks').value       = (loc.hooks || []).join('\n');
      document.getElementById('loc-edit-image-prompt').value = loc.imagePrompt || '';
      document.getElementById('loc-edit-vtm-context').value = loc.vtmText || '';
      // Опасность — отдельное поле (техспека §13.1), значение — тот же цветной кружок,
      // что раньше жил внутри «Зоны».
      const dv = loc.dangerLevel || '';
      const dangerEl = document.getElementById('loc-edit-danger');
      for (const opt of dangerEl.options) {
        if (opt.value && dv.includes(opt.value)) { dangerEl.value = opt.value; break; }
      }
    }
  }

  // Populate districts datalist for the Район field
  _loadDistrictsList();

  openModal('loc-edit-modal', '#loc-edit-name');
}

// GET /api/cities/:slug/districts — контракт из techspec (§2.4):
// [{slug, name, type, sect, clan}]. Эндпоинт может ещё не существовать
// (параллельная задача District-сущности) — 404/сетевая ошибка не должны
// ломать модалку локации, район всё равно можно ввести вручную.
async function _loadDistrictsList() {
  const dl = document.getElementById('loc-district-list');
  if (!dl) return;
  dl.innerHTML = '';
  try {
    const r = await fetch(`/api/cities/${encodeURIComponent(CITY)}/districts`);
    if (!r.ok) return; // 404 — эндпоинт ещё не реализован либо город не найден
    const districts = await r.json();
    if (!Array.isArray(districts)) return;
    dl.innerHTML = districts
      .map(d => (d && (d.name || d.slug) || '').trim())
      .filter(Boolean)
      .map(name => `<option value="${escAttr(name)}">`)
      .join('');
  } catch { /* эндпоинт недоступен — молча, поле остаётся свободным текстом */ }
}

// Даталист «Хозяин» (режим «Частный домен») — персонажи-вампиры уже загруженного
// реестра города, доп. сетевой запрос не нужен (§3.4). Но страница «Локации» сама
// реестр персонажей не грузит (loadLocations тянет только /api/locations) — если
// карточку открыли с первого захода, STATE.characters пуст и пикер поля показывал
// «Справочник недоступен». Дозагружаем реестр перед наполнением (кэш в
// ensureCharsLoaded: повторные вызовы бесплатны).
async function _fillOwnerCharsList() {
  const dl = document.getElementById('locdet-owner-chars-list');
  if (!dl) return;
  if (typeof ensureCharsLoaded === 'function') await ensureCharsLoaded();
  const names = (STATE.characters || []).filter(c => c.lineage === 'vampire').map(c => c.name);
  dl.innerHTML = names.map(n => `<option value="${escAttr(n)}">`).join('');
}

// Чекбокс «Частный домен» (§3.4) — переключает лейбл/даталист поля «Фракция» ↔
// «Хозяин». Очищает поле при переключении (значение из одного режима семантически
// невалидно в другом) — но только «со вспышкой», если реально было что чистить, и
// только если там реально ЧТО-ТО было (дизайн-документ §3.2, не мигать вхолостую).
document.addEventListener('change', e => {
  if (!e.target.matches('#locdet-vtm-private-domain')) return;
  const input = document.getElementById('locdet-vtm-faction');
  const lbl   = document.getElementById('locdet-vtm-faction-lbl');
  const multi = document.getElementById('locdet-vtm-factions');
  const wrap  = document.getElementById('locdet-vtm-factions-wrap');
  if (!input || !lbl || !multi || !wrap) return;
  const hadValue = !!input.value.trim() || (_locMultiValues(multi) || []).length > 0;
  input.value = '';
  multi.querySelector('[data-loc-multi-chips]').innerHTML = '';
  multi.querySelector('.lib-picker')?._libPicker?.close({ restoreFocus: false });
  input.hidden = !e.target.checked;
  wrap.hidden = e.target.checked;
  if (e.target.checked) {
    lbl.textContent = t('loc.owner');
    // Список хозяев мог ещё не быть наполнен (заполняется при входе в правку
    // VtM-вкладки и при открытии карточки) — наполняем и здесь: пользователь
    // может включить режим сразу и кликнуть в поле (функция async, кэш бесплатен).
    _fillOwnerCharsList();
  } else {
    lbl.textContent = t('loc.factions');
  }
  // Вспышка «поле очищено» есть только у текстового поля; у списка пропавшие чипы видны и так.
  if (hadValue && e.target.checked) {
    const flash = input;
    flash.classList.remove('field-cleared-flash');
    void flash.offsetWidth; // restart animation if triggered twice in a row
    flash.classList.add('field-cleared-flash');
    flash.addEventListener('animationend', () => flash.classList.remove('field-cleared-flash'), { once: true });
  }
});

function closeLocEditModal() {
  closeModal('loc-edit-modal');
  _locEditSlug = null;
}

async function saveLocEdit() {
  const saveBtn = document.getElementById('loc-edit-save-btn');
  const errDiv  = document.getElementById('loc-edit-error');
  const name    = document.getElementById('loc-edit-name').value.trim();
  const district = document.getElementById('loc-edit-district').value.trim();

  errDiv.style.display = 'none';
  if (!name) { errDiv.textContent = t('loc.nameRequired'); errDiv.style.display = ''; return; }
  // Район обязателен только при создании (UI-уровня required — техспека §3.2,
  // сервер по-прежнему принимает пустой district с фолбэком на «Другие»).
  if (!_locEditSlug && !district) { errDiv.textContent = t('loc.districtRequired'); errDiv.style.display = ''; return; }

  saveBtn.disabled = true;
  saveBtn.textContent = t('loc.saving');

  try {
    if (_locEditSlug) {
      // Edit: update individual fields via PUT /fields
      // Always include every field so empty string clears the existing value
      const fields = {
        subtype:     name,
        atmosphere:  document.getElementById('loc-edit-atmosphere').value.trim(),
        hooks:       document.getElementById('loc-edit-hooks').value.trim(),
        imagePrompt: document.getElementById('loc-edit-image-prompt').value.trim(),
        district:    document.getElementById('loc-edit-district').value.trim(),
        neighborhood:document.getElementById('loc-edit-neighborhood').value.trim(),
        address:     document.getElementById('loc-edit-address').value.trim(),
        control:     _locMultiValues('loc-edit-control') || [],
        presence:    _locMultiValues('loc-edit-presence') || [],
        dangerLevel: document.getElementById('loc-edit-danger').value,
        // sensoryPalette здесь НЕ отправляется (§C2) — раздел убран из формы,
        // сенсорика правится только в детальной модалке (_locSavePanel('sens-N')).
        // Отсутствующий в fields ключ PUT /fields не трогает — существующие каналы
        // локации остаются как есть, не затираются пустой строкой.
        vtmText:        document.getElementById('loc-edit-vtm-context').value.trim(),
      };

      const r = await fetch(`/api/locations/${encodeURIComponent(_locEditSlug)}/fields?city=${encodeURIComponent(CITY)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    } else {
      // Create
      const r = await fetch(`/api/locations?city=${encodeURIComponent(CITY)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          district: document.getElementById('loc-edit-district').value.trim() || undefined,
          context: document.getElementById('loc-edit-context').value.trim() || undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      const { slug: newSlug } = await r.json();
      // If saving the follow-up fields fails, keep this form open in edit mode.
      // Retrying must update the already-created card instead of POSTing a duplicate.
      _locEditSlug = newSlug;
      document.getElementById('loc-edit-title').textContent = t('loc.editTitle');
      document.getElementById('loc-edit-delete-btn').style.display = '';

      // Write remaining fields that POST /api/locations doesn't accept
      const extraFields = {
        neighborhood: document.getElementById('loc-edit-neighborhood').value.trim(),
        address:      document.getElementById('loc-edit-address').value.trim(),
        control:      _locMultiValues('loc-edit-control') || [],
        presence:     _locMultiValues('loc-edit-presence') || [],
        atmosphere:   document.getElementById('loc-edit-atmosphere').value.trim(),
        hooks:        document.getElementById('loc-edit-hooks').value.trim(),
        imagePrompt:  document.getElementById('loc-edit-image-prompt').value.trim(),
        dangerLevel:  document.getElementById('loc-edit-danger').value,
        // sensoryPalette здесь тоже не заполняется (§C2) — сенсорика на этапе создания
        // недоступна намеренно, тем же принципом, что уже работает для «Ключевых
        // точек»/VtM-таблицы: заполняется после, в детальной модалке.
        vtmText:        document.getElementById('loc-edit-vtm-context').value.trim(),
      };
      // Списочные поля приходят массивом: пустой массив — это «нечего дописывать», а не
      // истина. Без этой проверки создание локации «только с названием» всегда слало бы
      // PUT /fields и затирало плейсхолдеры шаблона карточки.
      const hasExtra = Object.values(extraFields).some(v => (Array.isArray(v) ? v.length > 0 : !!v));
      if (hasExtra) {
        const rf = await fetch(`/api/locations/${encodeURIComponent(newSlug)}/fields?city=${encodeURIComponent(CITY)}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: extraFields }),
        });
        if (!rf.ok) {
          const detail = await rf.json().catch(() => ({}));
          throw new Error(detail.error || t('loc.error'));
        }
      }
    }

    // Refresh locations cache
    STATE.locations = [];
    closeLocEditModal();
    await loadLocations();
  } catch (e) {
    errDiv.textContent = e.message;
    errDiv.style.display = '';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = t('cdet.saveBtn');
  }
}

// slug по умолчанию = _locEditSlug — сохраняет старое поведение вызова из формы
// редактирования/генерации (`#loc-edit-modal`) без правок в остальных её местах.
// Явный slug — новые точки входа (карточка сетки, детальная модалка), где формы
// редактирования вообще нет на экране (2026-08-06, план «карточка локации» §2.1-2.3).
async function deleteLoc(slug = _locEditSlug) {
  if (!slug) return;
  // §B2 — цель удаления не восстановить обратно (в отличие от переноса, §B1): ссылки
  // на неё станут битыми без возможности автоподстановки нового пути. Read-only
  // проверка ПЕРЕД confirm — предупреждаем, но не блокируем: решение за Рассказчиком.
  let warnText = '';
  try {
    const bl = await fetch(`/api/locations/${encodeURIComponent(slug)}/backlinks?city=${encodeURIComponent(CITY)}`).then(r => r.ok ? r.json() : null);
    if (bl && bl.count > 0) {
      const more = bl.files.length > 5 ? t('loc.deleteWarnMore', { n: bl.files.length - 5 }) : '';
      const shown = bl.files.slice(0, 5).join(', ') + more;
      warnText = t('loc.deleteWarn', { count: bl.count, shown });
    }
  } catch { /* проверка best-effort — сбой не должен блокировать сам confirm */ }

  if (!await showConfirm(t('loc.deleteConfirm', { name: slug, warn: warnText }), { danger: true, confirmText: t('city.confirmDelete') })) return;
  // Кнопка формы редактирования — может отсутствовать на экране (вызов с карточки/
  // детальной модалки, форма не открыта); отключаем, только если она есть.
  const btn = document.getElementById('loc-edit-delete-btn');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`/api/locations/${encodeURIComponent(slug)}?city=${encodeURIComponent(CITY)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    closeLocEditModal();          // no-op, если форма не открыта
    closeModal('loc-detail-modal'); // no-op, если модалка не открыта
    STATE.locations = [];
    await loadLocations();
    showToast(t('loc.deleted'), 'success');
  } catch (e) {
    const errDiv = document.getElementById('loc-edit-error');
    if (errDiv) { errDiv.textContent = e.message; errDiv.style.display = ''; }
    else showToast(t('loc.deleteFail', { msg: e.message }), 'error');
    if (btn) btn.disabled = false;
  }
}
// Обратная совместимость — старый вызов из формы `#loc-edit-modal` без аргумента.
const deleteLocCurrent = () => deleteLoc();

// Удаление изображения локации из галереи карточки (аналог _deleteCharImage)
async function _deleteLocImage(locSlug, filename) {
  if (!await showConfirm(t('cdet.imgDeleteConfirm', { name: filename }), { danger: true, confirmText: t('cdet.imgDelTitle') })) return;
  const qs = window.location.search;
  try {
    const resp = await fetch(
      `/api/locations/${encodeURIComponent(locSlug)}/images/${encodeURIComponent(filename)}${qs}`,
      { method: 'DELETE' }
    );
    const d = await resp.json();
    if (!d.ok) { showToast(t('cdet.imgDeleteError') + (d.error || ''), 'error'); return; }

    // Remove thumbnail from gallery
    const wrap = document.querySelector(`.locdet-img-del-btn[data-file="${CSS.escape(filename)}"]`)?.closest('.locdet-img-thumb-wrap');
    if (wrap) wrap.remove();

    const grid = document.querySelector('.locdet-img-gallery');
    if (grid && !grid.querySelectorAll('.locdet-img-thumb-wrap').length) {
      grid.innerHTML =
        '<div class="cdet-empty" style="margin-bottom:12px">' + t('loc.imagesEmpty') + '</div>';
    }

    // Remove deleted image from local state without a full refetch
    const loc = STATE.locations.find(l => l.slug === locSlug);
    if (loc) {
      loc.imageUrls = (loc.imageUrls || []).filter(u => {
        const fn = decodeURIComponent(u.split('/').pop());
        return fn !== filename;
      });
      if (loc.imageUrl && decodeURIComponent(loc.imageUrl.split('/').pop()) === filename) {
        loc.imageUrl = loc.imageUrls?.[0] || null;
      }
    }
    openLocDetail(locSlug, 'images');
  } catch {
    showToast(t('cdet.imgDeleteError'), 'error');
  }
}

// «🎨 Промт» во вкладке «Изображения» карточки локации: промт по атмосфере и сенсорике карточки
// (провайдер и модель — функция «Генерация промта» из «Назначения генераций»). Результат встаёт
// в поля и сразу сохраняется: кнопка «Сгенерировать изображение» берёт промт из карточки.
let _locGenPromptRunning = false;
async function _locGeneratePrompt(slug) {
  if (_locGenPromptRunning || !slug) return;
  const posTa = document.getElementById('locdet-img-prompt-ta');
  const negTa = document.getElementById('locdet-img-neg-ta');
  if (posTa && posTa.value.trim() && !/^⏳|^\[промт\]$/i.test(posTa.value.trim())
    && !await showConfirm(t('loc.genPromptOverwrite'), { confirmText: t('loc.genPromptOverwriteYes') })) return;
  _locGenPromptRunning = true;
  const btn = () => document.getElementById('locdet-gen-prompt');
  if (btn()) { btn().disabled = true; btn().setAttribute('aria-busy', 'true'); btn().textContent = t('cdet.generating'); }
  try {
    const featPrefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref = _getPref(featPrefs, 'prompt', 'openrouter');
    const preferSource = pref.provider;
    const orModel = _providerHasModel(preferSource) ? (pref.model || null) : null;
    const resp = await fetch(`/api/locations/${encodeURIComponent(slug)}/generate-prompt${window.location.search}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferSource, orModel }),
    });
    const d = await resp.json().catch(() => ({}));
    if (resp.status === 429 || d.rateLimited) { showToast(t('cdet.rateLimit'), 'warning'); return; }
    if (!d.ok) { showAiError(d, { operation: t('ais.featPrompt') }); return; }
    // Карточку могли закрыть или открыть другую, пока шла генерация, — чужие поля не трогаем.
    if (document.getElementById('locdet-gen-prompt')?.dataset.slug !== slug || !posTa?.isConnected) return;
    posTa.value = d.positive;
    if (negTa) negTa.value = d.negative || '';
    await _locSavePanel('images');
  } catch (e) {
    showToast(t('cdet.err') + e.message, 'error');
  } finally {
    _locGenPromptRunning = false;
    if (btn()) { btn().disabled = false; btn().removeAttribute('aria-busy'); btn().textContent = t('loc.genPromptBtn'); }
  }
}

async function runLocFieldRegen(field) {
  const slug = _locEditSlug;
  const name = document.getElementById('loc-edit-name').value.trim();
  const context = document.getElementById('loc-edit-context').value.trim();
  const hint    = document.getElementById('loc-edit-gen-hint');
  const spinner = document.getElementById('loc-gen-spinner');
  hint.textContent = '';
  spinner.style.display = '';

  try {
    const featPrefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref = _getPref(featPrefs, 'locations', 'openrouter');
    const preferSource = pref.provider;
    const orModel = _providerHasModel(preferSource) ? (pref.model || null) : null;

    const r = await fetch(`/api/locations/generate?city=${encodeURIComponent(CITY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, name, field, context, source: preferSource, model: orModel }),
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    const { value } = await r.json();
    if (!value) throw new Error(t('loc.emptyResponse'));

    const fieldMap = { atmosphere: 'atmosphere', imagePrompt: 'image-prompt', hooks: 'hooks', vtmText: 'vtm-context' };
    const elId = fieldMap[field];
    if (elId) document.getElementById(`loc-edit-${elId}`).value = value;
    hint.textContent = t('loc.genDone');
  } catch (e) {
    hint.textContent = `⚠ ${e.message}`;
  } finally {
    spinner.style.display = 'none';
  }
}

async function runLocFullGen() {
  const slug = _locEditSlug;
  const name = document.getElementById('loc-edit-name').value.trim();
  const context = document.getElementById('loc-edit-context').value.trim();
  if (!name) { document.getElementById('loc-edit-error').textContent = t('loc.genNameRequired'); document.getElementById('loc-edit-error').style.display = ''; return; }

  const hint    = document.getElementById('loc-edit-gen-hint');
  const btn     = document.getElementById('loc-edit-gen-full-btn');
  const spinner = document.getElementById('loc-gen-spinner');
  hint.textContent = '';
  btn.disabled = true;
  spinner.style.display = '';

  try {
    const featPrefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref = _getPref(featPrefs, 'locations', 'openrouter');
    const preferSource = pref.provider;
    const orModel = _providerHasModel(preferSource) ? (pref.model || null) : null;

    const r = await fetch(`/api/locations/generate?city=${encodeURIComponent(CITY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, name, context, source: preferSource, model: orModel }),
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    const { content } = await r.json();
    if (!content) throw new Error(t('loc.aiEmpty'));

    // Парсинг делегирован /api/locations/parse-generated — тот же parseLocation
    // (lib/parsers.js), которым парсятся сохранённые карточки локаций.
    const parseR = await fetch(`/api/locations/parse-generated${window.location.search}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: content }),
    });
    if (!parseR.ok) throw new Error((await parseR.json()).error || parseR.statusText);
    const parsed = await parseR.json();

    if (parsed.atmosphere) document.getElementById('loc-edit-atmosphere').value = parsed.atmosphere;
    if (parsed.hooks?.length) document.getElementById('loc-edit-hooks').value = parsed.hooks.map(h => `${h}`).join('\n');

    const promptM = content.match(/```\s*\n([\s\S]+?)```/);
    if (promptM) document.getElementById('loc-edit-image-prompt').value = promptM[1].trim();

    // parsed.sensoryPalette из ответа AI-генерации здесь больше не подставляется
    // (§C2) — форме негде её показать. Сенсорика, сгенерированная вместе с полной
    // карточкой, для этого пути теряется — принятое следствие решения не дублировать
    // редактор каналов в форме; подробное заполнение — после, в детальной модалке
    // (которая умеет генерировать по каналу отдельно, с тем же результатом).

    // Только проза — табличные строки идут отдельным структурным путём;
    // отправка их же как vtmText задвоила бы таблицу поверх существующей.
    if (parsed.vtmText) {
      const prose = parsed.vtmText.split('\n').filter(l => !l.startsWith('|') && l.trim()).join('\n').trim();
      if (prose) document.getElementById('loc-edit-vtm-context').value = prose;
    }

    hint.textContent = t('loc.genCardDone');
  } catch (e) {
    hint.textContent = `⚠ ${e.message}`;
  } finally {
    btn.disabled = false;
    spinner.style.display = 'none';
  }
}

// Wire up modal events
(function _initLocEditModal() {
  document.getElementById('loc-edit-cancel').addEventListener('click', closeLocEditModal);
  document.getElementById('loc-edit-save-btn').addEventListener('click', saveLocEdit);
  document.getElementById('loc-edit-delete-btn').addEventListener('click', deleteLocCurrent);
  document.getElementById('loc-edit-gen-full-btn').addEventListener('click', runLocFullGen);
  bindBackdropDblClickClose(document.getElementById('loc-edit-modal'), closeLocEditModal);
  document.getElementById('loc-edit-modal').addEventListener('click', e => {
    const regenBtn = e.target.closest('.loc-edit-regen-btn');
    if (regenBtn) runLocFieldRegen(regenBtn.dataset.field);
  });

  // "Create location" button on locations page
  document.getElementById('loc-page-create-btn')?.addEventListener('click', () => openLocEditModal(null));

  document.getElementById('btn-export-locs')?.addEventListener('click', e => {
    e.preventDefault();
    window.location.href = `/api/export/locations${window.location.search}`;
  });

  // "Edit"/"Delete" buttons in loc-detail-modal (delegated)
  document.getElementById('loc-detail-content').addEventListener('click', e => {
    const editBtn = e.target.closest('#locdet-open-edit-modal');
    if (editBtn) { openLocEditModal(editBtn.dataset.slug); return; }
    const delBtn = e.target.closest('#locdet-delete-btn');
    if (delBtn) deleteLoc(delBtn.dataset.slug);
  });
})();

// ═══════════════════════════════════════════════════════════════════════════
// Module Locations Panel
// ═══════════════════════════════════════════════════════════════════════════

async function _renderModuleLocPanel(data) {
  await ensureLocsLoaded();
  const panel = document.getElementById('modp-panel-locations');
  const { chronicle, name: modName } = STATE.currentModule || {};

  const linked   = data.linkedLocations || [];
  const extracted = data.locations || [];

  const linkedHtml = linked.length
    ? `<div class="modp-loc-cards">${linked.map(loc => _locCardHtml(loc, {
        overlayExtra: `<button class="modp-loc-card-unlink" data-unlink="${escAttr(loc.slug)}" title="${t('loc.unlinkTitle')}" onclick="event.stopPropagation()">✕</button>`,
      })).join('')}</div>`
    : `<div class="modp-empty" style="padding:8px 0">${t('loc.noLinked')}</div>`;

  // «Mentioned in scenario» — with quick-attach buttons
  const mentionedHtml = extracted.length
    ? `<ul class="modp-locs-mentioned-list">
        ${extracted.map(loc => {
          const locName = loc.name || '';
          const isLinked = linked.some(
            l => (l.title || '').toLowerCase() === locName.toLowerCase());
          const existsInCity = (STATE.locations || []).find(
            l => (l.name || l.title || '').toLowerCase() === locName.toLowerCase());
          const attachSlug = existsInCity?.slug;
          return `<li class="modp-locs-mentioned-item">
            <span>${escHtml(locName)}</span>
            ${isLinked
              ? `<span class="modp-locs-linked-badge">${t('loc.linkedBadge')}</span>`
              : attachSlug
                ? `<button class="modp-locs-attach-btn"
                     data-attach-slug="${escAttr(attachSlug)}"
                     data-attach-name="${escAttr(locName)}">${t('loc.attachBtn')}</button>`
                : `<button class="modp-locs-create-btn"
                     data-create-name="${escAttr(locName)}">${t('loc.createCardBtn')}</button>`
            }
          </li>`;
        }).join('')}
      </ul>`
    : '';

  panel.innerHTML = `
    <div class="modp-locs-toolbar">
      <button class="modp-locs-add-btn" id="modp-locs-attach-toggle">${t('loc.attachLocBtn')}</button>
      <button class="modp-locs-new-btn" id="modp-locs-gen-toggle">${t('loc.newLocForScene')}</button>
    </div>

    <div class="modp-loc-attach-panel" id="modp-loc-attach-panel">
      <input class="chr-form-input modp-loc-attach-search" id="modp-loc-attach-search" placeholder="${t('locations.search.ph')}" autocomplete="off">
      <div class="modp-loc-attach-list" id="modp-loc-attach-list"></div>
    </div>

    <div class="modp-loc-gen-form" id="modp-loc-gen-form">
      <div class="chr-form-group">
        <label class="chr-form-label" for="modp-loc-gen-name">${t('loc.genNameLabel')}</label>
        <input class="chr-form-input" id="modp-loc-gen-name" placeholder="${t('loc.genNamePh')}" autocomplete="off">
      </div>
      <div class="chr-form-group">
        <label class="chr-form-label" for="modp-loc-gen-context">${t('loc.genCtxLabel')}</label>
        <input class="chr-form-input" id="modp-loc-gen-context" placeholder="${t('loc.genCtxPh')}" autocomplete="off">
      </div>
      <div class="modp-loc-gen-actions">
        <button class="chr-modal-btn cancel" id="modp-loc-gen-cancel">${t('cdet.cancelBtn')}</button>
        <button class="chr-modal-btn create" id="modp-loc-gen-save">${t('loc.createAttachBtn')}</button>
      </div>
    </div>

    <div class="modp-locs-section-title">${t('loc.linkedTitle')}</div>
    <div id="modp-loc-chip-list">${linkedHtml}</div>

    ${mentionedHtml ? `<div class="modp-locs-section-title">${t('loc.mentionedTitle')}</div>${mentionedHtml}` : ''}
  `;

  // ── Event wiring for this panel ──────────────────────────────────
  const linkedSlugs = linked.map(l => l.slug);

  // Attach panel toggle
  document.getElementById('modp-locs-attach-toggle').addEventListener('click', () => {
    const p = document.getElementById('modp-loc-attach-panel');
    const isOpen = p.classList.toggle('open');
    if (isOpen) _fillAttachList(linkedSlugs);
  });

  // Gen form toggle
  document.getElementById('modp-locs-gen-toggle').addEventListener('click', () => {
    document.getElementById('modp-loc-gen-form').classList.toggle('open');
  });
  document.getElementById('modp-loc-gen-cancel').addEventListener('click', () => {
    document.getElementById('modp-loc-gen-form').classList.remove('open');
  });

  // Search filter for attach list
  document.getElementById('modp-loc-attach-search').addEventListener('input', e => {
    _fillAttachList(linkedSlugs, e.target.value);
  });

  // Chip clicks → open loc detail; unlink buttons
  document.getElementById('modp-loc-chip-list').addEventListener('click', e => {
    const unlinkBtn = e.target.closest('[data-unlink]');
    if (unlinkBtn) {
      _modLocUnlink(chronicle, modName, unlinkBtn.dataset.unlink);
      return;
    }
    const delBtn = e.target.closest('.loc-card-del-btn');
    if (delBtn) { deleteLoc(delBtn.dataset.delLoc); return; }
    const card = e.target.closest('.loc-card');
    if (card) {
      const slug = card.dataset.slug;
      if (slug) { ensureLocsLoaded().then(() => openLocDetail(slug)); }
    }
  });

  // Quick-attach existing location from mentioned list
  const mentionedList = panel.querySelector('.modp-locs-mentioned-list');
  if (mentionedList) {
    mentionedList.addEventListener('click', e => {
      const attachBtn = e.target.closest('[data-attach-slug]');
      if (attachBtn) {
        const slug = attachBtn.dataset.attachSlug;
        if (!slug) return;
        attachBtn.disabled = true;
        _modLocLink(chronicle, modName, slug).catch(() => { attachBtn.disabled = false; });
        return;
      }

      // Create new location card with pre-filled name
      const createLocBtn = e.target.closest('[data-create-name]');
      if (createLocBtn) {
        const locName = createLocBtn.dataset.createName;
        if (typeof openLocEditModal === 'function') {
          openLocEditModal(null);
          // Pre-fill name after modal opens (next tick)
          setTimeout(() => {
            const nameInput = document.getElementById('loc-edit-name');
            if (nameInput) nameInput.value = locName;
          }, 0);
        } else {
          const modal = document.getElementById('loc-edit-modal');
          if (modal) {
            modal.style.display = 'flex';
            const nameInput = document.getElementById('loc-edit-name');
            if (nameInput) nameInput.value = locName;
          }
        }
      }
    });
  }

  // Create + link
  document.getElementById('modp-loc-gen-save').addEventListener('click', async () => {
    const locName = document.getElementById('modp-loc-gen-name').value.trim();
    const ctx     = document.getElementById('modp-loc-gen-context').value.trim();
    if (!locName) return;
    const btn = document.getElementById('modp-loc-gen-save');
    btn.disabled = true;
    btn.textContent = t('loc.creating');
    try {
      const r = await fetch(`/api/locations?city=${encodeURIComponent(CITY)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: locName, context: ctx, generate: !!ctx }),
      });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      const { slug } = await r.json();
      STATE.locations = [];
      await _modLocLink(chronicle, modName, slug);
    } catch (e) {
      showToast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = t('loc.createAttachBtn');
    }
  });
}

function _fillAttachList(linkedSlugs, query = '') {
  const listEl = document.getElementById('modp-loc-attach-list');
  if (!listEl) return;
  const q = query.toLowerCase();
  const items = STATE.locations
    .filter(l => !q || (l.title || l.slug).toLowerCase().includes(q) || (l.district || '').toLowerCase().includes(q))
    .slice(0, 40);

  listEl.innerHTML = items.length
    ? items.map(loc => {
        const isLinked = linkedSlugs.includes(loc.slug);
        const title = loc.title || loc.subtype || loc.slug;
        const meta  = [loc.district, loc.neighborhood].filter(Boolean).join(' · ');
        return `<div class="modp-loc-attach-item${isLinked ? ' already-linked' : ''}" data-attach="${escAttr(loc.slug)}" title="${escAttr(meta)}">
          ${escHtml(title)}${meta ? ` <span style="color:var(--text-muted);font-size:var(--fs-xs)">(${escHtml(meta)})</span>` : ''}
        </div>`;
      }).join('')
    : `<div style="padding:6px;color:var(--text-muted);font-size:var(--fs-lg)">${t('loc.notFound')}</div>`;

  listEl.querySelectorAll('.modp-loc-attach-item:not(.already-linked)').forEach(el => {
    el.addEventListener('click', () => {
      const { chronicle, name: modName } = STATE.currentModule || {};
      _modLocLink(chronicle, modName, el.dataset.attach);
    });
  });
}

async function _modLocLink(chronicle, modName, slug) {
  try {
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(modName)}/locations?city=${encodeURIComponent(CITY)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) }
    );
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    // Re-fetch module detail only — _renderModuleLocPanel uses data.linkedLocations, not STATE.locations
    const dataR = await fetch(`/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(modName)}/detail?city=${encodeURIComponent(CITY)}`);
    const data  = await dataR.json();
    await _renderModuleLocPanel(data);
  } catch (e) { showToast(e.message, 'error'); }
}

async function _modLocUnlink(chronicle, modName, slug) {
  try {
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(modName)}/locations/${encodeURIComponent(slug)}?city=${encodeURIComponent(CITY)}`,
      { method: 'DELETE' }
    );
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    const dataR = await fetch(`/api/chronicles/${encodeURIComponent(chronicle)}/modules/${encodeURIComponent(modName)}/detail?city=${encodeURIComponent(CITY)}`);
    const data  = await dataR.json();
    await _renderModuleLocPanel(data);
  } catch (e) { showToast(e.message, 'error'); }
}

async function ensureLocsLoaded() {
  if (STATE.locations.length) return;
  try {
    const data = await fetch(`/api/locations?city=${encodeURIComponent(CITY)}`).then(r => r.json());
    STATE.locations = Array.isArray(data) ? data : [];
    // Only refresh the location filter when on the locations page (element may be absent)
    const distSel = document.getElementById('loc-filter-district');
    if (distSel) populateDistrictFilter();
  } catch (e) {
    // Swallowed on purpose (callers show whatever list they already have),
    // but log it — a network failure here looks identical to "no locations
    // exist" otherwise (doc/audit/2026-07-09-project-improvement-plan.md P1.7).
    console.error('ensureLocsLoaded:', e);
  }
}
