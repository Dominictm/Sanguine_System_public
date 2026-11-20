// ── Свободная генерация + страница свободного модуля (spec doc/design/free-generation) ──────────
// Страница `free-gen`: три режима (персонаж / локация / сценарий), у каждого — своё состояние
// контекста и результата, переключение режима ничего не стирает (§6b). Генерация — только
// /api/free-gen/*, создание — штатными POST (персонаж, локация, модуль kind:'free').
// Свободный модуль: renderFreeModulePage() поверх страницы модуля — 3 вкладки.
// Зависит от глобалей: STATE, CITY, t, escHtml, escAttr, showToast, showConfirm, showAiError,
// openModal, closeModal, LibPicker, LINEAGE_DEFS, CREATE_FIELD_LIBS, VAMPIRE_GENERATIONS,
// _getPref, _providerHasModel, openCharDetail, openLocDetail, openModulePage.
'use strict';

const FG_MODES = ['character', 'location', 'scenario'];
const FG_FEATURE = { character: 'biography', location: 'locations', scenario: 'scenario' };
const FG_REL_GROUPS = ['friends', 'enemies', 'acquaintances'];
const FG_BELONGINGS = ['Персонаж мастера', 'Персонаж игрока', 'Эпизодический персонаж', 'Фамильяр'];
const FG_LINEAGE_ICON = { vampire: '🧛', mortal: '🧑', fairy: '🧚', werewolf: '🐺', mage: '🔮', hunter: '🏹' };

const _fg = {
  inited: false,
  mode: 'character',
  lineages: null,                 // { vampire: { folder, affiliation: [...] }, ... } — с сервера
  busy: false,
  result: { character: null, location: null, scenario: null },
  dirty: { character: false, location: false, scenario: false },
};

function _fgQs() { return window.location.search || ''; }
function _fgPref(mode) {
  const prefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
  const p = _getPref(prefs, FG_FEATURE[mode], 'openrouter');
  return { source: p.provider, model: _providerHasModel(p.provider) ? (p.model || null) : null };
}
const _fgSplit = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const _fgChars = () => STATE.characters || [];
async function _fgEnsureChars() {
  if (_fgChars().length) return;
  const d = await fetch(`/api/characters${_fgQs()}`).then(r => r.json()).catch(() => []);
  STATE.characters = Array.isArray(d) ? d : [];
}
let _fgLocsCache = null;
async function _fgLocations() {
  if (!_fgLocsCache) _fgLocsCache = await fetch(`/api/locations${_fgQs()}`).then(r => r.json()).catch(() => []);
  return Array.isArray(_fgLocsCache) ? _fgLocsCache : [];
}
const _fgCharItems = filter => () => _fgChars().filter(filter || (() => true))
  .map(c => ({ value: c.name, hint: [c.lineage || c.lineageFolder, c.clan].filter(Boolean).join(' · ') }))
  .sort((a, b) => a.value.localeCompare(b.value, 'ru'));
function _fgAttachMulti(input, source, label) {
  if (input && window.LibPicker) LibPicker.attach(input, { source, multi: true, float: true, cache: false, label });
}

// ── Каркас страницы ──────────────────────────────────────────────────────────────
async function loadFreeGen() {
  const root = document.getElementById('fg-root');
  if (!root) return;
  if (!_fg.inited) {
    _fg.inited = true;
    _fgBindStatic();
    _fg.lineages = await fetch('/api/free-gen/lineages').then(r => r.json()).catch(() => ({}));
    _fgRenderContext();
  }
  await _fgEnsureChars();
  _fgSetMode(_fg.mode);
}

function _fgBindStatic() {
  document.querySelectorAll('input[name="fg-mode"]').forEach(r =>
    r.addEventListener('change', () => { if (r.checked) _fgSetMode(r.value); }));
  document.getElementById('fg-generate').addEventListener('click', _fgGenerate);
  FG_MODES.forEach(m => {
    const ta = document.getElementById(`fg-desc-${m}`);
    ta.addEventListener('input', () => _fgSyncGenerateBtn());
  });
  document.getElementById('fg-result').addEventListener('input', () => { _fg.dirty[_fg.mode] = true; });
  document.getElementById('fg-result').addEventListener('click', _fgResultClick);
  window.addEventListener('beforeunload', e => { if (_fgAnyDirty()) { e.preventDefault(); e.returnValue = ''; } });
}

function _fgSetMode(mode) {
  if (!FG_MODES.includes(mode)) mode = 'character';
  _fg.mode = mode;
  document.querySelectorAll('input[name="fg-mode"]').forEach(r => { r.checked = r.value === mode; });
  FG_MODES.forEach(m => {
    document.getElementById(`fg-ctx-${m}`).hidden = m !== mode;
    document.getElementById(`fg-desc-wrap-${m}`).hidden = m !== mode;
  });
  _fgRenderResult();
  _fgSyncGenerateBtn();
}

function _fgSyncGenerateBtn() {
  const btn = document.getElementById('fg-generate');
  const empty = !document.getElementById(`fg-desc-${_fg.mode}`).value.trim();
  btn.disabled = _fg.busy || empty;
  btn.textContent = _fg.busy ? t('fg.generating') : t('fg.generate');
  btn.setAttribute('aria-busy', _fg.busy ? 'true' : 'false');
}

// ── Контекст режимов ─────────────────────────────────────────────────────────────
function _fgRenderContext() {
  // Персонаж: линейка → поля принадлежности; друзья/враги/знакомые.
  const linSel = document.getElementById('fg-lineage');
  linSel.innerHTML = `<option value="">${escHtml(t('fg.lineageAny'))}</option>` +
    Object.keys(_fg.lineages || {}).map(k =>
      `<option value="${escAttr(k)}">${FG_LINEAGE_ICON[k] || ''} ${escHtml(t('lineage.' + k))}</option>`).join('');
  linSel.addEventListener('change', _fgRenderAffiliation);
  FG_REL_GROUPS.forEach(g => _fgAttachMulti(document.getElementById(`fg-rel-${g}`), _fgCharItems(), t(`fg.rel.${g}`)));

  // Локация: район.
  fetch(`/api/cities/${encodeURIComponent(CITY)}/districts`).then(r => r.ok ? r.json() : []).then(list => {
    const sel = document.getElementById('fg-district');
    sel.innerHTML = `<option value="">${escHtml(t('fg.districtAny'))}</option>` +
      (Array.isArray(list) ? list : []).map(d => `<option value="${escAttr(d.name)}">${escHtml(d.name)}</option>`).join('');
  }).catch(() => {});

  // Сценарий: игроки — только «Персонаж игрока», НПС — все, локации — slug'и.
  _fgAttachMulti(document.getElementById('fg-pcs'), _fgCharItems(c => c.belonging === 'Персонаж игрока'), t('fg.pcs'));
  _fgAttachMulti(document.getElementById('fg-npcs'), _fgCharItems(), t('fg.npcs'));
  _fgAttachMulti(document.getElementById('fg-locs'), async () => (await _fgLocations())
    .map(l => ({ value: l.title || l.slug, hint: l.district || '', slug: l.slug })), t('fg.locs'));
}

function _fgRenderAffiliation() {
  const lin = document.getElementById('fg-lineage').value;
  const box = document.getElementById('fg-affiliation');
  const params = (_fg.lineages?.[lin]?.affiliation) || [];
  const defs = (LINEAGE_DEFS[lin]?.fields || []).filter(f => params.includes(f.param));
  box.innerHTML = defs.map(f => {
    const id = `fg-aff-${f.param}`;
    const control = f.param === 'generation'
      ? `<select class="form-control" id="${id}" data-aff="${f.param}"><option value="">${escHtml(t('s.phSelectEmpty'))}</option>${VAMPIRE_GENERATIONS.map(o => `<option value="${escAttr(o)}">${escHtml(o)}</option>`).join('')}</select>`
      : `<input class="form-control" id="${id}" data-aff="${f.param}" type="text" placeholder="${escAttr(f.placeholder || '')}"${f.lib ? ` data-lib="${escAttr(f.lib)}"` : ''}>`;
    return `<div class="form-group"><label class="form-label" for="${id}">${escHtml(f.label)}</label>${control}</div>`;
  }).join('');
  box.hidden = !defs.length;
  box.querySelectorAll('input[data-lib]').forEach(inp => {
    const def = CREATE_FIELD_LIBS[inp.dataset.lib];
    if (def && window.LibPicker) LibPicker.attach(inp, { ...def, float: true, label: inp.closest('.form-group')?.querySelector('.form-label')?.textContent?.trim() });
  });
}

function _fgCollectRequest(mode) {
  const description = document.getElementById(`fg-desc-${mode}`).value.trim();
  const pref = _fgPref(mode);
  if (mode === 'character') {
    const affiliation = {};
    document.querySelectorAll('#fg-affiliation [data-aff]').forEach(el => { if (el.value.trim()) affiliation[el.dataset.aff] = el.value.trim(); });
    const body = { description, lineage: document.getElementById('fg-lineage').value || undefined, affiliation, ...pref };
    FG_REL_GROUPS.forEach(g => { body[g] = _fgSplit(document.getElementById(`fg-rel-${g}`).value); });
    return body;
  }
  if (mode === 'location') return { description, district: document.getElementById('fg-district').value || undefined, ...pref };
  return { draft: description, pcs: _fgSplit(document.getElementById('fg-pcs').value), npcs: _fgSplit(document.getElementById('fg-npcs').value), locationNames: _fgSplit(document.getElementById('fg-locs').value), ...pref };
}

async function _fgLocSlugs(names) {
  const locs = await _fgLocations();
  return names.map(n => (locs.find(l => (l.title || l.slug) === n || l.slug === n) || {}).slug).filter(Boolean);
}

// ── Генерация ────────────────────────────────────────────────────────────────────
async function _fgGenerate() {
  const mode = _fg.mode;
  if (_fg.busy || !document.getElementById(`fg-desc-${mode}`).value.trim()) return;
  if (_fg.result[mode] && _fg.dirty[mode] && !(await showConfirm(t('fg.regenConfirm'), { danger: true }))) return;
  const body = _fgCollectRequest(mode);
  if (mode === 'scenario') { body.locations = await _fgLocSlugs(body.locationNames); delete body.locationNames; }
  _fg.busy = true;
  _fgSyncGenerateBtn();
  _fgStatus(t('fg.generating'));
  try {
    const resp = await fetch(`/api/free-gen/${mode}${_fgQs()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await resp.json().catch(() => ({}));
    if (resp.status === 429 || d.rateLimited) { showToast(t('cdet.rateLimit'), 'warning'); _fgStatus(''); return; }
    if (!resp.ok || !d.ok) { showAiError(d, { operation: t(`fg.mode.${mode}`) }); _fgStatus(''); return; }
    _fg.result[mode] = mode === 'scenario' ? { text: d.text, request: body } : { ...d, request: body };
    _fg.dirty[mode] = false;
    _fgRenderResult();
    _fgStatus(t('fg.done'));
    document.getElementById('fg-result-title')?.focus();
  } catch (e) {
    showAiError({ error: e.message }, { operation: t(`fg.mode.${mode}`) });
    _fgStatus('');
  } finally {
    _fg.busy = false;
    _fgSyncGenerateBtn();
  }
}
function _fgStatus(text) { const el = document.getElementById('fg-status'); if (el) el.textContent = text; }

// ── Форма результата ─────────────────────────────────────────────────────────────
// Многострочные в формате карточки — только биография и промт арта; остальные поля карточки
// однострочные (upsertCardLine), форма не обещает абзацев, которые схлопнутся (review-fixes И8).
const FG_CHAR_TEXTAREAS = new Set(['biography', 'imagePrompt']);
// Поля карточки (POST /api/characters `fields`), а не параметры формы создания — как CHAR_CARD_KEYS на сервере.
const FG_CARD_KEYS = ['personality', 'voice', 'want', 'fear', 'leverage', 'imagePrompt'];
function _fgCharFieldDefs(lineage) {
  const def = LINEAGE_DEFS[lineage] || LINEAGE_DEFS.mortal;
  const base = def.fields.map(f => ({ key: f.param, label: f.label, area: FG_CHAR_TEXTAREAS.has(f.param), required: !!f.required, card: false }));
  const card = [
    ['personality', t('fg.f.personality')], ['voice', t('fg.f.voice')], ['want', t('fg.f.want')],
    ['fear', t('fg.f.fear')], ['leverage', t('fg.f.leverage')], ['imagePrompt', t('fg.f.imagePrompt')],
  ].map(([key, label]) => ({ key, label, area: FG_CHAR_TEXTAREAS.has(key), card: true }));
  return [...base, ...card];
}
const FG_LOC_FIELDS = [
  ['name', 'fg.l.name'], ['address', 'fg.l.address'], ['neighborhood', 'fg.l.neighborhood'], ['zone', 'fg.l.zone'],
  ['dangerLevel', 'fg.l.danger'], ['control', 'fg.l.control'], ['presence', 'fg.l.presence'], ['atmosphere', 'fg.l.atmosphere', true],
  ['sensoryPalette', 'fg.l.sensory', true], ['vtmText', 'fg.l.vtmText', true], ['faction', 'fg.l.faction'],
  ['figures', 'fg.l.figures'], ['threats', 'fg.l.threats'], ['masquerade', 'fg.l.masquerade'],
  ['keyPoints', 'fg.l.keyPoints', true], ['hooks', 'fg.l.hooks', true], ['imagePrompt', 'fg.l.imagePrompt', true],
  ['negativePrompt', 'fg.l.negativePrompt', true],
];

function _fgFieldHtml(id, key, label, value, area, required) {
  const v = value == null ? '' : String(value);
  // Пол — выбор из значений схемы (GENDER_OPTIONS, общий с формой создания); недопустимое → пусто (И1).
  const ctl = key === 'gender'
    ? `<select class="form-control" id="${id}" data-fg-field="gender"${required ? ' required' : ''}><option value="">${escHtml(t('s.phSelect'))}</option>${GENDER_OPTIONS.map(o => `<option value="${escAttr(o)}"${o === v ? ' selected' : ''}>${escHtml(o)}</option>`).join('')}</select>`
    : area
    ? `<textarea class="form-control" id="${id}" data-fg-field="${escAttr(key)}" rows="${Math.min(10, Math.max(3, v.split('\n').length + 1))}">${escHtml(v)}</textarea>`
    : `<input class="form-control" id="${id}" data-fg-field="${escAttr(key)}" type="text" value="${escAttr(v)}"${required ? ' required' : ''}>`;
  return `<div class="form-group${area ? ' fg-field-wide' : ''}"><label class="form-label" for="${id}">${escHtml(label)}${required ? ' *' : ''}</label>${ctl}</div>`;
}

function _fgRenderResult() {
  const box = document.getElementById('fg-result');
  const mode = _fg.mode;
  const res = _fg.result[mode];
  if (!res) {
    box.innerHTML = `<p class="fg-empty">${escHtml(t(`fg.empty.${mode}`))}</p>`;
    return;
  }
  const warn = (res.warnings || []).length
    ? `<div class="fg-warnings" role="status">${res.warnings.map(w => `<div>⚠ ${escHtml(w)}</div>`).join('')}</div>` : '';
  if (mode === 'scenario') {
    box.innerHTML = `<h2 class="fg-result-title" id="fg-result-title" tabindex="-1">${escHtml(t('fg.result.scenario'))}</h2>${warn}
      <textarea class="form-control fg-scenario-text" id="fg-scenario-text" rows="18" aria-labelledby="fg-result-title">${escHtml(res.text)}</textarea>
      <div class="fg-actions"><button type="button" class="btn-submit" data-fg-act="save-scenario">${escHtml(t('fg.saveScenario'))}</button></div>`;
    return;
  }
  if (mode === 'character') {
    const lineage = res.fields.lineage || res.request.lineage || 'mortal';
    const values = { ...res.fields, ...res.cardFields };
    const linOpts = Object.keys(_fg.lineages || {}).map(k =>
      `<option value="${escAttr(k)}"${k === lineage ? ' selected' : ''}>${escHtml(t('lineage.' + k))}</option>`).join('');
    const rel = FG_REL_GROUPS.filter(g => (res.relations?.[g] || []).length)
      .map(g => `<div><span class="fg-rel-label">${escHtml(t(`fg.rel.${g}`))}:</span> ${escHtml(res.relations[g].join(', '))}</div>`).join('');
    box.innerHTML = `<h2 class="fg-result-title" id="fg-result-title" tabindex="-1">${escHtml(t('fg.result.character'))}</h2>${warn}
      <div class="form-group"><label class="form-label" for="fg-r-lineage">${escHtml(t('fg.lineage'))}</label>
        <select class="form-control" id="fg-r-lineage" data-fg-field="lineage">${linOpts}</select></div>
      <div class="fg-form-grid">${_fgCharFieldDefs(lineage).map(f => _fgFieldHtml(`fg-r-${f.key}`, f.key, f.label, values[f.key], f.area, f.required)).join('')}</div>
      ${rel ? `<div class="fg-rels">${rel}</div>` : ''}
      <div class="fg-actions"><button type="button" class="btn-submit" data-fg-act="create-character">${escHtml(t('fg.createCharacter'))}</button></div>`;
    document.getElementById('fg-r-lineage').addEventListener('change', e => {
      // Правки раскладываются по тем же двум объектам, что отдаёт сервер, — иначе старые
      // cardFields перекрыли бы их при перерисовке (review-fixes И3).
      for (const [k, v] of Object.entries(_fgReadForm())) {
        if (FG_CARD_KEYS.includes(k)) res.cardFields = { ...res.cardFields, [k]: v };
        else res.fields = { ...res.fields, [k]: v };
      }
      res.fields.lineage = e.target.value;
      _fgRenderResult();
      _fg.dirty.character = true;
    });
    return;
  }
  const f = res.fields || {};
  const districts = Array.from(document.getElementById('fg-district').options).filter(o => o.value).map(o => o.value);
  const district = f.district || res.request.district || '';
  box.innerHTML = `<h2 class="fg-result-title" id="fg-result-title" tabindex="-1">${escHtml(t('fg.result.location'))}</h2>${warn}
    <div class="form-group"><label class="form-label" for="fg-r-district">${escHtml(t('fg.district'))}</label>
      <input class="form-control" id="fg-r-district" data-fg-field="district" type="text" list="fg-r-district-list" value="${escAttr(district)}">
      <datalist id="fg-r-district-list">${districts.map(d => `<option value="${escAttr(d)}"></option>`).join('')}</datalist></div>
    <div class="fg-form-grid">${FG_LOC_FIELDS.map(([key, lbl, area]) => _fgFieldHtml(`fg-r-${key}`, key, t(lbl), f[key], !!area, key === 'name')).join('')}</div>
    <div class="fg-actions"><button type="button" class="btn-submit" data-fg-act="create-location">${escHtml(t('fg.createLocation'))}</button></div>`;
}

function _fgReadForm() {
  const out = {};
  document.querySelectorAll('#fg-result [data-fg-field]').forEach(el => { out[el.dataset.fgField] = el.value.trim(); });
  return out;
}

function _fgResultClick(e) {
  const act = e.target.closest('[data-fg-act]')?.dataset.fgAct;
  if (act === 'create-character') _fgOpenCreateChar();
  if (act === 'create-location') _fgCreateLocation(e.target.closest('button'));
  if (act === 'save-scenario') _fgOpenSaveScenario();
}

// ── Создание персонажа ───────────────────────────────────────────────────────────
function _fgOpenCreateChar() {
  const req = Array.from(document.querySelectorAll('#fg-result [required]')).filter(i => !i.value.trim());
  if (req.length) { req.forEach(i => i.setAttribute('aria-invalid', 'true')); req[0].focus(); showToast(t('fg.fillRequired'), 'warning'); return; }
  const sel = document.getElementById('fg-cc-belonging');
  sel.innerHTML = FG_BELONGINGS.map(b => `<option value="${escAttr(b)}"${b === 'Персонаж мастера' ? ' selected' : ''}>${escHtml(b)}</option>`).join('');
  document.getElementById('fg-cc-master').value = '';
  document.getElementById('fg-cc-mutual').checked = false;
  document.getElementById('fg-cc-error').textContent = '';
  _fgSyncMaster();
  openModal('fg-create-char-modal', '#fg-cc-belonging');
}
function _fgSyncMaster() {
  const isFam = document.getElementById('fg-cc-belonging').value === 'Фамильяр';
  document.getElementById('fg-cc-master-wrap').hidden = !isFam;
}

async function _fgCreateCharacter() {
  const res = _fg.result.character;
  if (!res) return;
  const form = _fgReadForm();
  const belonging = document.getElementById('fg-cc-belonging').value;
  const master = document.getElementById('fg-cc-master').value.trim();
  const errEl = document.getElementById('fg-cc-error');
  if (belonging === 'Фамильяр' && !master) { errEl.textContent = t('fg.masterRequired'); document.getElementById('fg-cc-master').focus(); return; }
  const body = { belonging, master: master || undefined, mutual: document.getElementById('fg-cc-mutual').checked, fields: {} };
  // Только видимые поля формы; биография и внешность — через `fields`, одним путём записи (И8).
  for (const [k, v] of Object.entries(form)) {
    if (!v) continue;
    if (FG_CARD_KEYS.includes(k) || k === 'biography' || k === 'appearance') body.fields[k] = v;
    else body[k] = v;
  }
  body.relations = res.relations || {};
  const btn = document.getElementById('fg-cc-submit');
  btn.disabled = true;
  try {
    const resp = await fetch(`/api/characters${_fgQs()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await resp.json().catch(() => ({}));
    if (!resp.ok || !d.ok) {
      errEl.textContent = d.error || t('fg.createError');
      if (resp.status === 409) { closeModal('fg-create-char-modal'); const n = document.getElementById('fg-r-name'); n?.setAttribute('aria-invalid', 'true'); n?.focus(); showToast(d.error, 'error'); }
      return;
    }
    closeModal('fg-create-char-modal');
    (d.warnings || []).forEach(w => showToast(w, 'warning'));
    showToast(t('fg.charCreated', { name: d.name }), 'success');
    _fg.result.character = null; _fg.dirty.character = false;
    _fgRenderResult();
    STATE.characters = [];
    if (STATE.graph) STATE.graph.inited = false;
    await _fgEnsureChars();
    openCharDetail(d.slug);
  } catch (e) {
    errEl.textContent = e.message;
  } finally { btn.disabled = false; }
}

// ── Создание локации ─────────────────────────────────────────────────────────────
const _fgTable = (head, rows) => `${head}\n|---|---|\n${rows.map(([a, b]) => `| **${a}** | ${b} |`).join('\n')}`;
function _fgLocFields(form) {
  const lines = v => String(v || '').split('\n').map(s => s.trim()).filter(Boolean);
  const fields = {};
  for (const k of ['atmosphere', 'vtmText', 'imagePrompt', 'negativePrompt', 'address', 'neighborhood', 'zone', 'dangerLevel', 'control', 'hooks'])
    if (form[k]) fields[k] = form[k];
  const sensory = lines(form.sensoryPalette).map(l => { const i = l.indexOf(':'); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, '']; });
  if (sensory.length) fields.sensoryPalette = _fgTable('| Канал | |', sensory);
  const points = lines(form.keyPoints).map(l => { const m = l.split(/\s+[—–-]\s+/); return [m[0].trim(), m.slice(1).join(' — ').trim()]; });
  if (points.length) fields.keyPoints = `| Место | Описание |\n|---|---|\n${points.map(([a, b]) => `| ${a} | ${b} |`).join('\n')}`;
  const table = {};
  for (const k of ['faction', 'figures', 'threats', 'masquerade']) if (form[k]) table[k] = form[k];
  if (Object.keys(table).length) fields.vtmTable = table;
  return fields;
}

async function _fgCreateLocation(btn) {
  const form = _fgReadForm();
  if (!form.name) { const n = document.getElementById('fg-r-name'); n?.setAttribute('aria-invalid', 'true'); n?.focus(); showToast(t('fg.fillRequired'), 'warning'); return; }
  btn.disabled = true;
  try {
    const resp = await fetch(`/api/locations${_fgQs()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, district: form.district || '', fields: _fgLocFields(form) }) });
    const d = await resp.json().catch(() => ({}));
    if (!resp.ok || !d.ok) { showToast(d.error || t('fg.createError'), 'error'); if (resp.status === 409) document.getElementById('fg-r-name')?.focus(); return; }
    if (d.warning) showToast(d.warning, 'warning');
    showToast(t('fg.locCreated', { name: form.name }), 'success');
    _fg.result.location = null; _fg.dirty.location = false; _fgLocsCache = null;
    _fgRenderResult();
    if (typeof STATE !== 'undefined') STATE.locations = [];
    if (typeof openLocDetail === 'function') openLocDetail(d.slug);
  } catch (e) { showToast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

// ── Сохранение свободного сценария ───────────────────────────────────────────────
async function _fgOpenSaveScenario() {
  const sel = document.getElementById('fg-ss-chronicle');
  sel.innerHTML = `<option value="">…</option>`;
  document.getElementById('fg-ss-error').textContent = '';
  openModal('fg-save-scenario-modal', '#fg-ss-chronicle');
  const list = await fetch(`/api/chronicles${_fgQs()}`).then(r => r.json()).catch(() => []);
  sel.innerHTML = `<option value="">${escHtml(t('fg.ss.chroniclePick'))}</option>` +
    (Array.isArray(list) ? list : []).map(c => `<option value="${escAttr(c.slug)}">${escHtml(c.display || c.slug)}</option>`).join('');
}

async function _fgSaveScenario() {
  const res = _fg.result.scenario;
  if (!res) return;
  const chr = document.getElementById('fg-ss-chronicle').value;
  const name = document.getElementById('fg-ss-name').value.trim();
  const time = document.getElementById('fg-ss-time').value.trim();
  const errEl = document.getElementById('fg-ss-error');
  const firstEmpty = [['fg-ss-chronicle', chr], ['fg-ss-name', name], ['fg-ss-time', time]].find(([, v]) => !v);
  if (firstEmpty) { errEl.textContent = t('fg.fillRequired'); document.getElementById(firstEmpty[0]).focus(); return; }
  const text = document.getElementById('fg-scenario-text').value;
  const btn = document.getElementById('fg-ss-submit');
  btn.disabled = true;
  try {
    const resp = await fetch(`/api/chronicles/${encodeURIComponent(chr)}/modules${_fgQs()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, time, kind: 'free', scenarioText: text, pcs: res.request.pcs, npcs: res.request.npcs, locations: res.request.locations }),
    });
    const d = await resp.json().catch(() => ({}));
    if (!resp.ok || !d.ok) { errEl.textContent = d.error || t('fg.createError'); return; }
    closeModal('fg-save-scenario-modal');
    showToast(t('fg.scenarioSaved', { name }), 'success');
    _fg.result.scenario = null; _fg.dirty.scenario = false;
    _fgRenderResult();
    openModulePage(chr, d.slug);
  } catch (e) { errEl.textContent = e.message; }
  finally { btn.disabled = false; }
}

// ── Защита несохранённого результата при уходе (решение В5) ────────────────────
// Любой несохранённый результат — уже «потеря» при уходе, даже без правок.
function _fgAnyDirty() { return FG_MODES.some(m => !!_fg.result[m]); }
// navigate — глобальная функция scripts.js; оборачиваем, чтобы спросить до ухода со страницы.
const _fgNavigateInner = navigate;
// eslint-disable-next-line no-global-assign
navigate = function (page) {
  if (STATE.page === 'free-gen' && page !== 'free-gen' && _fgAnyDirty()) {
    showConfirm(t('fg.leaveConfirm'), { danger: true, confirmText: t('fg.leaveOk') }).then(ok => {
      if (!ok) return;
      FG_MODES.forEach(m => { _fg.result[m] = null; _fg.dirty[m] = false; });
      _fgRenderResult();
      _fgNavigateInner(page);
    });
    return;
  }
  return _fgNavigateInner(page);
};

// ── Модалки (разметка — index.html) ──────────────────────────────────────────────
document.getElementById('fg-cc-belonging')?.addEventListener('change', _fgSyncMaster);
document.getElementById('fg-cc-submit')?.addEventListener('click', _fgCreateCharacter);
document.getElementById('fg-ss-submit')?.addEventListener('click', _fgSaveScenario);
document.querySelectorAll('[data-fg-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.fgClose)));
{
  const master = document.getElementById('fg-cc-master');
  if (master && window.LibPicker) LibPicker.attach(master, { source: _fgCharItems(), float: true, cache: false, label: t('fg.master') });
}

// ══ Страница свободного модуля (FR14–FR15) ═══════════════════════════════════════
let _fgMod = null; // { chr, mod, data, locs }

function _fgModBase() { return `/api/chronicles/${encodeURIComponent(_fgMod.chr)}/modules/${encodeURIComponent(_fgMod.mod)}`; }

async function renderFreeModulePage(data) {
  const mine = { chr: data.chronicle, mod: data.name, data, locs: [] };
  _fgMod = mine;
  document.getElementById('page-module').classList.add('is-free');
  document.getElementById('modp-badges').insertAdjacentHTML('afterbegin', `<span class="modp-badge fg-free-badge">${escHtml(t('fg.freeBadge'))}</span>`);
  document.querySelector('.modp-tab[data-modtab="scenario"]')?.click();

  document.getElementById('modp-panel-scenario').innerHTML = `
    <label class="modp-section-label" for="fg-mod-text">${escHtml(t('fg.mod.scenario'))}</label>
    <textarea class="form-control fg-scenario-text" id="fg-mod-text" rows="20">${escHtml(data.freeScenario || '')}</textarea>
    <div class="fg-actions"><button type="button" class="btn-submit" data-fgm="save-text">${escHtml(t('ui.btn.save'))}</button>
      <span class="fg-saved" id="fg-mod-text-msg" role="status" aria-live="polite"></span></div>`;

  document.getElementById('modp-panel-finale').innerHTML = `
    <label class="modp-section-label" for="fg-mod-finale">${escHtml(t('fg.mod.finale'))}</label>
    <textarea class="form-control fg-scenario-text" id="fg-mod-finale" rows="14">${escHtml(String(data.finale || '').trim())}</textarea>
    <div class="fg-actions">
      <button type="button" class="btn-submit" data-fgm="save-finale">${escHtml(t('ui.btn.save'))}</button>
      <button type="button" class="modp-gen-btn" data-fgm="diaries">${escHtml(t('fg.diary.open'))}</button>
      <span class="fg-saved" id="fg-mod-finale-msg" role="status" aria-live="polite"></span></div>`;

  const linked = await fetch(`${_fgModBase()}/locations${_fgQs()}`).then(r => r.json()).catch(() => ({ linked: [] }));
  // Пока ждали ответ, могли открыть другой модуль — тогда этот рендер устарел (review-fixes И7).
  if (_fgMod !== mine) return;
  mine.locs = (linked.linked || []).map(l => ({ slug: l.slug, title: l.title || l.slug }));
  _fgRenderParticipants();
}

function _fgRenderParticipants() {
  const d = _fgMod.data;
  const pcs = (d.pcs || []).map(p => p.name), npcs = (d.npcs || []).map(n => n.name);
  const row = (id, label, value) => `<div class="form-group"><label class="form-label" for="${id}">${escHtml(label)}</label>
    <input class="form-control" id="${id}" type="text" value="${escAttr(value.join(', '))}"></div>`;
  const el = document.getElementById('modp-panel-participants');
  el.innerHTML = `${row('fg-mod-pcs', t('fg.pcs'), pcs)}${row('fg-mod-npcs', t('fg.npcs'), npcs)}${row('fg-mod-locs', t('fg.locs'), _fgMod.locs.map(l => l.title))}
    <div class="fg-actions"><button type="button" class="btn-submit" data-fgm="save-participants">${escHtml(t('ui.btn.save'))}</button>
      <span class="fg-saved" id="fg-mod-part-msg" role="status" aria-live="polite"></span></div>`;
  _fgAttachMulti(document.getElementById('fg-mod-pcs'), _fgCharItems(c => c.belonging === 'Персонаж игрока'), t('fg.pcs'));
  _fgAttachMulti(document.getElementById('fg-mod-npcs'), _fgCharItems(), t('fg.npcs'));
  _fgAttachMulti(document.getElementById('fg-mod-locs'), async () => (await _fgLocations()).map(l => ({ value: l.title || l.slug, hint: l.district || '' })), t('fg.locs'));
}

function _fgSaved(id, ok, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = ok ? t('common.saved') : '';
  if (!ok) showToast(msg || t('fg.createError'), 'error');
}

async function _fgModAction(act, btn) {
  const put = (url, body) => fetch(`${_fgModBase()}${url}${_fgQs()}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => ({ ok: r.ok, d: await r.json().catch(() => ({})) }));
  btn.disabled = true;
  try {
    if (act === 'save-text') {
      const r = await put('/free-scenario', { text: document.getElementById('fg-mod-text').value });
      _fgSaved('fg-mod-text-msg', r.ok, r.d.error);
    }
    if (act === 'save-finale') {
      const content = document.getElementById('fg-mod-finale').value.trim();
      if (!content) { showToast(t('fg.finaleEmpty'), 'warning'); return; }
      const r = await put('/finale', { content });
      if (r.ok) _fgMod.data.finale = content;
      _fgSaved('fg-mod-finale-msg', r.ok, r.d.error);
    }
    if (act === 'save-participants') {
      const r = await put('/participants', { pcs: _fgSplit(document.getElementById('fg-mod-pcs').value), npcs: _fgSplit(document.getElementById('fg-mod-npcs').value) });
      if (!r.ok) { _fgSaved('fg-mod-part-msg', false, r.d.error); return; }
      _fgMod.data.pcs = r.d.pcs.map(name => ({ name })); _fgMod.data.npcs = r.d.npcs.map(name => ({ name }));
      const wanted = await _fgLocSlugs(_fgSplit(document.getElementById('fg-mod-locs').value));
      const have = _fgMod.locs.map(l => l.slug);
      for (const s of wanted.filter(s => !have.includes(s)))
        await fetch(`${_fgModBase()}/locations${_fgQs()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: s }) });
      for (const s of have.filter(s => !wanted.includes(s)))
        await fetch(`${_fgModBase()}/locations/${encodeURIComponent(s)}${_fgQs()}`, { method: 'DELETE' });
      const locs = await _fgLocations();
      _fgMod.locs = wanted.map(s => ({ slug: s, title: (locs.find(l => l.slug === s) || {}).title || s }));
      _fgSaved('fg-mod-part-msg', true);
    }
    if (act === 'diaries') _fgOpenDiaries();
  } catch (e) { showToast(e.message, 'error'); }
  finally { btn.disabled = false; }
}
['modp-panel-scenario', 'modp-panel-finale', 'modp-panel-participants'].forEach(id =>
  document.getElementById(id)?.addEventListener('click', e => {
    const b = e.target.closest('[data-fgm]');
    if (b && _fgMod && document.getElementById('page-module').classList.contains('is-free')) _fgModAction(b.dataset.fgm, b);
  }));

// Обычный модуль — снять режим свободного (вызывается из loadModulePage до рендера).
function resetFreeModulePage() {
  document.getElementById('page-module')?.classList.remove('is-free');
  _fgMod = null;
}

// ── Дневники из финала: черновики → подтверждение → запись ───────────────────────
const _fgDiary = { rows: [], running: false };
function _fgModPeriod() {
  const time = String(_fgMod?.data?.time || '');
  const y = time.match(/(19|20)\d{2}/)?.[0];
  const months = ['январ', 'феврал', 'март', 'апрел', 'ма[йя]', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
  const mi = months.findIndex(m => new RegExp(m, 'i').test(time));
  const iso = time.match(/(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  if (y && mi >= 0) return `${y}-${String(mi + 1).padStart(2, '0')}`;
  return new Date().toISOString().slice(0, 7);
}

function _fgOpenDiaries() {
  if (!String(_fgMod.data.finale || '').trim()) { showToast(t('fg.finaleEmpty'), 'warning'); return; }
  const names = [...(_fgMod.data.pcs || []), ...(_fgMod.data.npcs || [])].map(p => p.name);
  const chars = _fgChars();
  _fgDiary.rows = names.map(n => ({ name: n, char: chars.find(c => c.name === n) || null, checked: true, status: 'pending', text: '', error: '' }))
    .filter(r => r.char);
  document.getElementById('fg-dm-period').value = _fgModPeriod();
  _fgRenderDiaryRows();
  openModal('fg-diary-modal', '#fg-dm-period');
  _fgRunDiaries();
}

function _fgRenderDiaryRows() {
  const list = document.getElementById('fg-dm-list');
  if (!_fgDiary.rows.length) { list.innerHTML = `<p class="fg-empty">${escHtml(t('fg.diary.none'))}</p>`; _fgSyncDiarySubmit(); return; }
  list.innerHTML = _fgDiary.rows.map((r, i) => `
    <div class="fg-dm-row" data-row="${i}">
      <label class="fg-dm-check"><input type="checkbox" data-dm-check="${i}"${r.checked ? ' checked' : ''}${r.status === 'done' ? '' : ' disabled'}>
        <span>${escHtml(r.name)}</span></label>
      <span class="fg-dm-status fg-dm-${r.status}">${escHtml(t(`fg.diary.st.${r.status}`))}${r.error ? `: ${escHtml(r.error)}` : ''}</span>
      ${r.status === 'error' ? `<button type="button" class="modp-edit-btn" data-dm-retry="${i}">${escHtml(t('fg.diary.retry'))}</button>` : ''}
      ${r.status === 'done' ? `<details class="fg-dm-draft"><summary>${escHtml(t('fg.diary.draft'))}</summary>
        <textarea class="form-control" data-dm-text="${i}" rows="6" aria-label="${escAttr(t('fg.diary.draft') + ' — ' + r.name)}">${escHtml(r.text)}</textarea></details>` : ''}
    </div>`).join('');
  _fgSyncDiarySubmit();
}
function _fgSyncDiarySubmit() {
  document.getElementById('fg-dm-submit').disabled = _fgDiary.running || !_fgDiary.rows.some(r => r.checked && r.status === 'done');
}

async function _fgGenDiary(row) {
  row.status = 'running'; row.error = '';
  _fgRenderDiaryRows();
  const prefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
  const p = _getPref(prefs, 'prose', 'claude');
  try {
    const resp = await fetch(`/api/characters/${encodeURIComponent(row.char.slug)}/diary/generate${_fgQs()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period: document.getElementById('fg-dm-period').value, session: _fgMod.data.title || '',
        moduleRef: { chr: _fgMod.chr, mod: _fgMod.mod }, preferSource: p.provider, orModel: _providerHasModel(p.provider) ? p.model : null }),
    });
    const d = await resp.json().catch(() => ({}));
    if (!resp.ok || !d.ok) { row.status = 'error'; row.error = d.error || String(resp.status); }
    else { row.status = 'done'; row.text = d.text; }
  } catch (e) { row.status = 'error'; row.error = e.message; }
}

async function _fgRunDiaries() {
  _fgDiary.running = true;
  for (const row of _fgDiary.rows) if (row.status === 'pending') await _fgGenDiary(row);
  _fgDiary.running = false;
  _fgRenderDiaryRows();
}

async function _fgWriteDiaries() {
  const period = document.getElementById('fg-dm-period').value.trim();
  const chosen = _fgDiary.rows.filter(r => r.checked && r.status === 'done');
  let written = 0;
  document.getElementById('fg-dm-submit').disabled = true;
  for (const r of chosen) {
    const resp = await fetch(`/api/characters/${encodeURIComponent(r.char.slug)}/diary${_fgQs()}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period, session: _fgMod.data.title || '', text: r.text, mode: 'append' }),
    }).catch(() => null);
    if (resp?.ok) { written++; r.status = 'written'; r.checked = false; }
    else { r.status = 'error'; r.error = t('fg.diary.writeError'); }
  }
  _fgRenderDiaryRows();
  showToast(t('fg.diary.written', { n: written, m: chosen.length }), written === chosen.length ? 'success' : 'warning');
  if (written === chosen.length) closeModal('fg-diary-modal');
}

document.getElementById('fg-dm-list')?.addEventListener('change', e => {
  const i = e.target.dataset.dmCheck;
  if (i != null) { _fgDiary.rows[i].checked = e.target.checked; _fgSyncDiarySubmit(); }
});
document.getElementById('fg-dm-list')?.addEventListener('input', e => {
  const i = e.target.dataset.dmText;
  if (i != null) _fgDiary.rows[i].text = e.target.value;
});
document.getElementById('fg-dm-list')?.addEventListener('click', async e => {
  const i = e.target.closest('[data-dm-retry]')?.dataset.dmRetry;
  if (i == null || _fgDiary.running) return;
  _fgDiary.running = true;
  await _fgGenDiary(_fgDiary.rows[i]);
  _fgDiary.running = false;
  _fgRenderDiaryRows();
});
document.getElementById('fg-dm-submit')?.addEventListener('click', _fgWriteDiaries);
