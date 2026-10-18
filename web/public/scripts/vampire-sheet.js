'use strict';
// Лист вампира (линейка vampires, схема vampire-1) — бланк STV2098 «Классические правила.
// Вампиры: Маскарад» (2 страницы, спека doc/design/2026-10-12-vampire-sheet-spec.md).
//
// Модель — V20-модель (v20-sheet.js) без Самообладания/Решительности, плюс Столп (bearing),
// тип урона в здоровье и свободный текст описания. Модель живёт в тех же глобалах
// _v20Model/_v20Ctx, поэтому вся механика V20 работает без копирования: точки и клетки,
// режим опыта, пикеры справочника, «Проверить», клановые дисциплины и Изъян, лимиты по
// поколению, авто-значения, 🎲 у строки, сохранение и перегенерация. Сюда попадают через
// _v20ModelFrom (нормализация) и _v20RenderSheet (рендер), обе ветки — по schema.

const VAMP_DAMAGE = ['', 'bashing', 'lethal', 'aggravated'];
const VAMP_DAMAGE_MARK = { '': '', bashing: '/', lethal: 'X', aggravated: '✱' };
const VAMP_COMBAT_ROWS = 5;
const VAMP_SECTS = ['kamarilla', 'anarch', 'sabbat'];

let _vampTab = 'p1', _vampTabSlug = null;
// Секта, выбранная в подсказке бюджета, когда карточка её не называет: { slug, sect }.
let _vampSectPick = null;

// ── Модель ───────────────────────────────────────────────────────────────────

// m — модель после _v20Normalize/_v20ParseMd (её же и меняем: фоновое обогащение
// достоинств/недостатков в _v20Normalize сверяет объект по ссылке). raw — сырой sidecar,
// md — ИИ-лист (из него берётся только Столп: остальное уже разобрал _v20ParseMd).
function _vampNormalize(m, raw, md) {
  m.lineage = 'vampires';
  m.schema = 'vampire-1';
  // Самообладание/Решительность — не V20: в лист не идут, но из файла не теряются.
  const legacy = Object.assign({}, raw && raw.legacy);
  const rs = raw && raw.attributes;
  if (rs?.social?.composure !== undefined && legacy.composure === undefined) legacy.composure = rs.social.composure;
  if (rs?.mental?.resolve !== undefined && legacy.resolve === undefined) legacy.resolve = rs.mental.resolve;
  delete m.attributes.social.composure;
  delete m.attributes.mental.resolve;
  if (Object.keys(legacy).length) m.legacy = legacy; else delete m.legacy;

  const b = (raw && raw.bearing) || (md ? _vampBearingFromMd(md) : null) || {};
  m.bearing = { name: String(b.name || ''), mod: String(b.mod ?? '') };

  // Здоровье: старый флажок (true) — ударный урон; неизвестное значение — пусто.
  const src = Object.assign({}, m.health, raw && raw.health);
  m.health = {};
  for (const [k] of V20_HEALTH) {
    const v = src[k];
    m.health[k] = v === true ? 'bashing' : (VAMP_DAMAGE.includes(v) ? v : '');
  }

  const d = (raw && raw.description) || {};
  m.description.text = String(d.text || m.description.text || '');
  // Специализации без паддинга до фиксированного N: только фактически сохранённые
  // строки, хвостовые полностью пустые обрезаются (тот же трим, что в _v20Normalize;
  // _v20TrimTrailingEmpty не подходит — он смотрит поле `name`, здесь `ability`/`spec`).
  m.specializations = Array.isArray(m.specializations)
    ? m.specializations.map(s => ({ ability: String(s?.ability || ''), spec: String(s?.spec || '') }))
    : [];
  while (m.specializations.length && !m.specializations[m.specializations.length - 1].ability.trim() && !m.specializations[m.specializations.length - 1].spec.trim()) m.specializations.pop();
  m.combat = _v20PadPairs(m.combat, VAMP_COMBAT_ROWS, ['weapon', 'diff', 'damage', 'range', 'rate', 'clip', 'size']);
  return m;
}

// Строка ИИ-листа «| **Столп (Bearing)** | Обычный (0) | — |» → { name, mod }.
function _vampBearingFromMd(md) {
  const row = String(md).match(/^\|\s*\**\s*Столп\s*\(Bearing\)\s*\**\s*\|\s*([^|]*?)\s*\|/mi);
  const v = row && row[1].trim();
  if (!v || v === '—') return null;
  const pm = v.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  return pm ? { name: pm[1].trim(), mod: pm[2].trim() } : { name: v, mod: '' };
}

// Секта из карточки («Камарилья (перебежчик…)», «Анархи», «Шабаш») → ключ норм создания.
function _vampSectFromCard(card) {
  const s = String(card?.sect || '').toLowerCase().trim();
  if (/^камарил/.test(s)) return 'kamarilla';
  if (/^анарх/.test(s)) return 'anarch';
  if (/^шабаш/.test(s)) return 'sabbat';
  return null;
}

function _vampSect() {
  const fromCard = _vampSectFromCard(_v20Ctx?.card);
  if (fromCard) return { sect: fromCard, fromCard: true };
  const pick = _vampSectPick && _vampSectPick.slug === _v20Ctx?.slug ? _vampSectPick.sect : null;
  return { sect: VAMP_SECTS.includes(pick) ? pick : 'kamarilla', fromCard: false };
}

function _vampCreationBudget() {
  return RULES_V20.creation.vampires[_vampSect().sect] || RULES_V20.creation.vampires.kamarilla;
}

// Подсказка бюджета: группы атрибутов и способностей сравниваются с нормами по убыванию
// (первичная/вторичная/третичная — лучшая подгонка), перерасход переводится в свободные
// пункты по ценам V20. Только подсказка, ввод не ограничивается.
function _vampBudget(m) {
  const b = _vampCreationBudget();
  const cost = RULES_V20.freebieCosts.vampires;
  const sortDesc = a => a.slice().sort((x, y) => y - x);
  const attrs = sortDesc(['physical', 'social', 'mental'].map(g =>
    _v20AttrPairs(m, g).reduce((s, [k]) => s + Math.max(0, _num(m.attributes[g][k], 0) - 1), 0)));
  const abils = sortDesc(['talents', 'skills', 'knowledges'].map(g =>
    m.abilities[g].reduce((s, a) => s + _num(a.val, 0), 0)));
  const disc = m.disciplines.reduce((s, x) => s + _num(x.val, 0), 0);
  const bg = m.backgrounds.reduce((s, x) => s + _num(x.val, 0), 0);
  const virt = ['conscience', 'selfcontrol', 'courage'].reduce((s, k) => s + Math.max(0, _num(m.virtues[k], 0) - 1), 0);
  const lims = { attrs: sortDesc(b.attrs), abils: sortDesc(b.abilities) };
  const over = (u, l) => Math.max(0, u - l);
  const humBase = _num(m.virtues.conscience, 0) + _num(m.virtues.selfcontrol, 0);
  const freebies =
    attrs.reduce((s, u, i) => s + over(u, lims.attrs[i]), 0) * cost.attribute +
    abils.reduce((s, u, i) => s + over(u, lims.abils[i]), 0) * cost.ability +
    over(disc, b.disciplines) * cost.discipline +
    over(bg, b.backgrounds) * cost.background +
    over(virt, b.virtues) * cost.virtue +
    (/^человечност/i.test(m.path || 'Человечность') ? over(_num(m.humanity, 0), humBase) * cost.humanity : 0) +
    over(_num(m.willpower.permanent, 0), _num(m.virtues.courage, 0)) * cost.willpower;
  return { attrs, abils, disc, bg, virt, freebies, b, lims };
}

function _vampBudgetHtml(m) {
  const r = _vampBudget(m);
  const part = (label, used, lim) => `<span class="chg-budget-part${used > lim ? ' chg-over' : ''}">${escHtml(label)} ${used}/${lim}</span>`;
  const tiers = (label, used, lims) => `<span class="chg-budget-part${used.some((u, i) => u > lims[i]) ? ' chg-over' : ''}">${escHtml(label)} ${used.map((u, i) => `${u}/${lims[i]}`).join(' · ')}</span>`;
  const { sect, fromCard } = _vampSect();
  const sectCtl = fromCard
    ? `<span class="chg-budget-note">${escHtml(t('vamp.budget.sect'))}: ${escHtml(t('vamp.sect.' + sect))} (${escHtml(t('vamp.budget.fromCard'))})</span>`
    : `<label class="chg-budget-note vamp-sect-pick">${escHtml(t('vamp.budget.sect'))}:
        <select data-vamp-sect aria-label="${escAttr(t('vamp.budget.sect'))}">${VAMP_SECTS.map(s =>
          `<option value="${s}"${s === sect ? ' selected' : ''}>${escHtml(t('vamp.sect.' + s))}</option>`).join('')}</select></label>`;
  const parts = [
    tiers(t('v20.bandAttrs'), r.attrs, r.lims.attrs),
    tiers(t('v20.bandAbilities'), r.abils, r.lims.abils),
    part(t('v20.colDisciplines'), r.disc, r.b.disciplines),
    part(t('v20.colBackgrounds'), r.bg, r.b.backgrounds),
    part(t('v20.colVirtues'), r.virt, r.b.virtues),
    part(t('vamp.budget.freebies'), r.freebies, r.b.freebies),
  ];
  return `<div class="chg-budget-title">${escHtml(t('vamp.budget.title'))}</div><div class="chg-budget-parts">${parts.join('')}${sectCtl}</div>`;
}

// ── Рендер ───────────────────────────────────────────────────────────────────

function _vampHealthCell(k, label, v) {
  const aria = `${label} — ${t(v ? 'vamp.dmg.' + v : 'vamp.dmg.none')}`;
  return `<button type="button" class="ww-health-cell${v ? ' on ww-dmg-' + v : ''}" data-vamp-health="${k}" aria-label="${escAttr(aria)}" title="${escAttr(aria)}">${VAMP_DAMAGE_MARK[v] || ''}</button>`;
}

function _vampLibPicker(kind, extra = '') {
  return `<div class="v20-lib-picker" data-v20-lib-kind="${kind}" hidden>
      <input type="text" class="v20-lib-search" placeholder="${t('v20.sheetSearchPh')}" data-v20-lib-kind="${kind}" aria-label="${escAttr(t('v20.sheetSearchPh'))}">
      ${extra}
      <div class="v20-lib-list" data-v20-lib-kind="${kind}"></div>
    </div>`;
}
function _vampLibBtn(kind, tipKey) {
  return `<button type="button" class="v20-mini-action v20-lib-add-btn" data-v20-lib-kind="${kind}" title="${t(tipKey)}" aria-label="${t(tipKey)}">📚</button>`;
}
// Пикер архетипов для Натуры/Маски (doc/design/2026-10-15-about-character-spec.md п.5):
// тот же визуальный паттерн, что _vampLibPicker выше, но свои data-атрибуты
// (data-vamp-arch-*), чтобы не пересекаться с data-v20-lib-kind flow (_v20BindPanel).
function _vampArchPicker(target) {
  return `<div class="v20-lib-picker" data-vamp-arch-picker="${target}" title="${t('vamp.archPickTitle')}" hidden>
      <input type="text" class="v20-lib-search" data-vamp-arch-search="${target}" placeholder="${t('v20.sheetSearchPh')}" aria-label="${escAttr(t('v20.sheetSearchPh'))}">
      <div class="v20-lib-list" data-vamp-arch-list="${target}"></div>
    </div>`;
}
function _vampArchField(label, tpath, val, target, tipKey) {
  const field = _v20Field(label, tpath, val).replace('class="v20-field"', 'class="v20-field" style="flex:1;min-width:0"');
  return `<div><div style="display:flex;gap:4px;align-items:center">${field}<button type="button" class="v20-mini-action" data-vamp-arch="${target}" title="${t(tipKey)}" aria-label="${t(tipKey)}">📚</button></div>${_vampArchPicker(target)}</div>`;
}
// Кэши справочников (архетипы, кланы, специализации) — общие из v20-sheet.js
// (ensure*/_*Cache; v20-sheet.js грузится раньше и обязателен для листа вампира).
// Библиотека после создания/правки/удаления записи перезагружает именно их, поэтому
// пикеры листа сразу видят свежий список, без своих устаревающих копий.
function _vampArchLib() { return _archetypesCache || []; }
function _vampRenderArchList(target, filter = '') {
  const panel = document.getElementById('cdet-sheet-panel');
  const box = panel?.querySelector(`[data-vamp-arch-list="${target}"]`);
  if (!box) return;
  const q = String(filter || '').toLowerCase();
  const lib = _vampArchLib().filter(a => !q || `${a.name || ''} ${a.name_en || ''}`.toLowerCase().includes(q));
  box.innerHTML = lib.map(a => `<button type="button" class="v20-lib-item" data-vamp-arch-item="${target}" data-vamp-arch-name="${escAttr(a.name)}"><span>${escHtml(a.name)}</span>${a.name_en ? `<span class="v20-lib-hint">${escHtml(a.name_en)}</span>` : ''}</button>`).join('');
}
async function _vampToggleArchPicker(target) {
  const panel = document.getElementById('cdet-sheet-panel');
  const picker = panel?.querySelector(`[data-vamp-arch-picker="${target}"]`);
  if (!picker) return;
  if (picker.hidden) {
    const lib = await ensureArchetypes();
    if (!lib.length) return; // пустой справочник — пустой список не открываем
    picker.hidden = false;
    _vampRenderArchList(target, picker.querySelector('[data-vamp-arch-search]')?.value || '');
    picker.querySelector('[data-vamp-arch-search]')?.focus();
  } else {
    picker.hidden = true;
  }
}
// Выбор подставляет имя в header.nature/header.demeanor; ручной ввод остаётся
// возможным (поле — свободный текст, связи со справочником нет).
function _vampPickArchetype(target, name) {
  _v20Set(_v20Model, target === 'nature' ? 'header.nature' : 'header.demeanor', name);
  _v20MarkDirty();
  _vampRenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
}
// Пикер клана в шапке (поле header.clan) — тот же визуальный паттерн, что
// _vampArchField/_vampArchPicker выше, но свои data-атрибуты (data-vamp-clan-*).
// Источник — GET /api/library/clans (MD-парсинг, поле name). Связи нет: удаление
// записи из Библиотеки листы не трогает.
function _vampClanPicker() {
  return `<div class="v20-lib-picker" data-vamp-clan-picker hidden>
      <input type="text" class="v20-lib-search" data-vamp-clan-search placeholder="${t('v20.sheetSearchPh')}" aria-label="${escAttr(t('v20.sheetSearchPh'))}">
      <div class="v20-lib-list" data-vamp-clan-list></div>
    </div>`;
}
function _vampClanField(label, tpath, val) {
  const field = _v20Field(label, tpath, val).replace('class="v20-field"', 'class="v20-field" style="flex:1;min-width:0"');
  return `<div><div style="display:flex;gap:4px;align-items:center">${field}<button type="button" class="v20-mini-action" data-vamp-clan title="${t('vamp.pickClanTip')}" aria-label="${t('vamp.pickClanTip')}">📚</button></div>${_vampClanPicker()}</div>`;
}
function _vampRenderClanList(filter = '') {
  const panel = document.getElementById('cdet-sheet-panel');
  const box = panel?.querySelector('[data-vamp-clan-list]');
  if (!box) return;
  const q = String(filter || '').toLowerCase();
  const lib = (_clansCache || []).filter(c => !q || String(c.name || '').toLowerCase().includes(q));
  box.innerHTML = lib.map(c => `<button type="button" class="v20-lib-item" data-vamp-clan-item data-vamp-clan-name="${escAttr(c.name)}"><span>${escHtml(c.name)}</span>${c.sect ? `<span class="v20-lib-hint">${escHtml(c.sect)}</span>` : ''}</button>`).join('');
}
async function _vampToggleClanPicker() {
  const panel = document.getElementById('cdet-sheet-panel');
  const picker = panel?.querySelector('[data-vamp-clan-picker]');
  if (!picker) return;
  if (picker.hidden) {
    const lib = await ensureClans();
    if (!lib.length) return; // пустой справочник — пустой список не открываем
    picker.hidden = false;
    _vampRenderClanList(picker.querySelector('[data-vamp-clan-search]')?.value || '');
    picker.querySelector('[data-vamp-clan-search]')?.focus();
  } else {
    picker.hidden = true;
  }
}
function _vampPickClan(name) {
  _v20Set(_v20Model, 'header.clan', name);
  _v20MarkDirty();
  _vampRenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
}
// Per-row пикер специализаций: кнопка 📚 у поля spec (data-vamp-spec=i) открывает
// справочник специализаций (GET /api/library/specializations, {slug, ability, name,
// description?}). ОДНА общая панель в spec-колонке. Если у строки указана способность
// и в справочнике есть её записи — список фильтруется по ней, иначе виден весь
// справочник. Выбор пишет spec (и ability записи справочника) и закрывает панель.
let _vampSpecRowIdx = null;
function _vampRenderSpecList(filter = '') {
  const panel = document.getElementById('cdet-sheet-panel');
  const box = panel?.querySelector('[data-vamp-spec-list]');
  if (!box) return;
  const q = String(filter || '').toLowerCase();
  const ability = String(_v20Model?.specializations?.[_vampSpecRowIdx]?.ability || '').trim().toLowerCase();
  let lib = _specializationsCache || [];
  const byAbility = ability ? lib.filter(it => String(it.ability || '').toLowerCase() === ability) : [];
  if (byAbility.length) lib = byAbility;
  if (q) lib = lib.filter(it => String(it.name || '').toLowerCase().includes(q) || String(it.ability || '').toLowerCase().includes(q));
  box.innerHTML = lib.length
    ? lib.map(it => `<button type="button" class="v20-lib-item" data-vamp-spec-item="${escAttr(it.slug)}" data-vamp-spec-name="${escAttr(it.name)}"><span>${escHtml(it.name)}</span><span class="v20-lib-hint">${escHtml(it.ability || '')}</span></button>`).join('')
    : `<div class="cdet-empty">${t('v20.libEmpty')}</div>`;
}
async function _vampToggleSpecPicker(idx) {
  const panel = document.getElementById('cdet-sheet-panel');
  const picker = panel?.querySelector('[data-vamp-spec-picker]');
  if (!picker) return;
  if (!picker.hidden && _vampSpecRowIdx === idx) { picker.hidden = true; return; }
  _vampSpecRowIdx = idx;
  await ensureSpecializations();
  picker.hidden = false;
  const search = picker.querySelector('[data-vamp-spec-search]');
  if (search) search.value = '';
  _vampRenderSpecList('');
  search?.focus();
}
function _vampPickSpec(slug) {
  const row = _v20Model?.specializations?.[_vampSpecRowIdx];
  const it = (_specializationsCache || []).find(x => x.slug === slug);
  if (!row || !it) return;
  _v20Set(_v20Model, `specializations.${_vampSpecRowIdx}.spec`, it.name);
  if (it.ability) _v20Set(_v20Model, `specializations.${_vampSpecRowIdx}.ability`, it.ability);
  _v20MarkDirty();
  // Ре-рендер пересоздаёт панель скрытой — пикер закрывается.
  _vampRenderSheet(document.getElementById('cdet-sheet-panel'), _v20Ctx.name);
}
function _vampRemoveBtn(section, i) {
  return `<button type="button" class="v20-row-remove-btn" data-v20-remove="${section}" data-v20-remove-idx="${i}" title="${t('v20.removeRowTip')}" aria-label="${escAttr(t('v20.removeRowTip'))}">×</button>`;
}

function _vampPage1(m, derived, clanInfo, cap) {
  // Кубик для ВСЕХ строк; без имени — disabled + тултип (снимается input-обработчиком
  // в _v20BindPanel без ре-рендера). Зеркало generic-рендера в v20-sheet.js.
  const rollIcon = (kind, path, disabled) => disabled
    ? `<button type="button" class="v20-roll-icon-btn" data-roll-seed="${kind}:${path}" title="${t('v20.rollNeedName')}" disabled>🎲</button>`
    : `<button type="button" class="v20-roll-icon-btn" data-roll-seed="${kind}:${path}" title="${t('v20.rollTitle')}" aria-label="${escAttr(t('v20.rollTitle'))}">🎲</button>`;
  const header = `
    <div class="v20-header vamp-header">
      <div class="vamp-header-col">
        ${_v20Field(t('v20.fPlayer'), 'header.player', m.header.player)}
        ${_v20Field(t('v20.fName'), 'header.name', m.header.name)}
        ${_v20Field(t('v20.fGen'), 'header.generation', m.header.generation)}
        ${_v20Field(t('v20.fSire'), 'header.sire', m.header.sire)}
      </div>
      <div class="vamp-header-col">
        ${_vampArchField(t('v20.fNature'), 'header.nature', m.header.nature, 'nature', 'vamp.pickNatureTip')}
        ${_vampArchField(t('v20.fMask'), 'header.demeanor', m.header.demeanor, 'demeanor', 'vamp.pickDemeanorTip')}
        ${_v20Field(t('v20.fArchetype'), 'header.concept', m.header.concept)}
        ${_vampClanField(t('v20.fClan'), 'header.clan', m.header.clan)}
      </div>
    </div>`;

  const attrCol = g => `<div class="v20-col"><div class="v20-col-title">${V20_ATTR_GROUP_LABELS[g]}</div>${_v20AttrPairs(m, g).map(([k, ru]) =>
    `<div class="v20-row-roll-wrap">${_v20DotRow(ru, `attributes.${g}.${k}`, m.attributes[g][k], cap)}${rollIcon('attr', `attributes.${g}.${k}`)}</div>`).join('')}</div>`;
  const abilCol = g => {
    const baseline = _v20AbilityBaselineLen(g);
    const rows = m.abilities[g].map((slot, i) => {
      const rowHtml = slot.fixed
        ? _v20DotRow(slot.name, `abilities.${g}.${i}.val`, slot.val, cap)
        : _v20NamedDotRow(`abilities.${g}.${i}.name`, slot.name, `abilities.${g}.${i}.val`, slot.val, cap, i >= baseline ? `abilities:${g}` : '');
      return `<div class="v20-row-roll-wrap">${rowHtml}${rollIcon('abil', `abilities.${g}.${i}`, !slot.name)}</div>`;
    }).join('');
    return `<div class="v20-col"><div class="v20-col-title">${V20_ABILITY_GROUP_LABELS[g]}${_v20AddRowBtn(`abilities:${g}`)}</div>${rows}</div>`;
  };

  const discFillBtn = clanInfo && m.disciplines.slice(0, 3).every(d => !d.name)
    ? `<button type="button" class="v20-mini-action" data-v20-action="fill-clan-disc" title="${t('v20.fillClanDiscTip')}">+ ${t('v20.fillClanDiscBtn')}</button>` : '';
  const discRow = (d, i) => {
    const infoBtn = v20DisciplineKey(d.name) ? `<button type="button" class="v20-disc-info-btn" data-disc-view="${escAttr(d.name)}" title="${t('v20.rollPowerTitle', { name: escAttr(d.name) })}">ℹ</button>` : '';
    return `<div class="v20-row v20-named v20-disc-row">${_vampRemoveBtn('disciplines', i)}${infoBtn}<input class="v20-line-input" data-tpath="disciplines.${i}.name" value="${escAttr(d.name)}" placeholder="…" aria-label="${escAttr(t('v20.colDisciplines'))}">${_v20DotsHtml(`disciplines.${i}.val`, d.val, cap)}</div>`;
  };
  const discCol = `<div class="v20-col">
    <div class="v20-col-title">${t('v20.colDisciplines')}${discFillBtn}${_vampLibBtn('discipline', 'v20.libDiscTip')}${_v20AddRowBtn('disciplines')}</div>
    ${_vampLibPicker('discipline')}
    ${m.disciplines.map(discRow).join('')}
  </div>`;
  const bgCol = `<div class="v20-col"><div class="v20-col-title">${t('v20.colBackgrounds')}${_vampLibBtn('background', 'v20.libBgTip')}${_v20AddRowBtn('backgrounds')}</div>
    ${_vampLibPicker('background')}
    ${m.backgrounds.map((b, i) => _v20NamedDotRow(`backgrounds.${i}.name`, b.name, `backgrounds.${i}.val`, b.val, cap, 'backgrounds')).join('')}</div>`;
  const virtCol = `<div class="v20-col"><div class="v20-col-title">${t('v20.colVirtues')}</div>
      ${_v20DotRow(t('v20.virtueConsc'), 'virtues.conscience', m.virtues.conscience)}
      ${_v20DotRow(t('v20.virtueSelf'), 'virtues.selfcontrol', m.virtues.selfcontrol)}
      ${_v20DotRow(t('v20.virtueCourage'), 'virtues.courage', m.virtues.courage)}</div>`;

  // Спецблок с нуля: «+» в заголовке, «×» у каждой строки, per-row 📚 у поля spec
  // (выбор из справочника специализаций), пустое состояние.
  const specRows = m.specializations.length ? m.specializations.map((s, i) =>
    `<div class="v20-pair-row">${_vampRemoveBtn('specializations', i)}<input class="v20-line-input" data-tpath="specializations.${i}.ability" value="${escAttr(s.ability)}" placeholder="${t('v20.specAbilityPh')}" aria-label="${escAttr(t('v20.specAbilityPh'))}"><span class="v20-row-roll-wrap"><input class="v20-line-input" data-tpath="specializations.${i}.spec" value="${escAttr(s.spec)}" placeholder="${t('v20.specSpecPh')}" aria-label="${escAttr(t('v20.specSpecPh'))}"><button type="button" class="v20-mini-action" data-vamp-spec="${i}" title="${t('vamp.pickSpecTip')}" aria-label="${escAttr(t('vamp.pickSpecTip'))}">📚</button></span></div>`).join('')
    : `<div class="cdet-empty">${t('v20.specEmpty')}</div>`;
  const specPicker = `<div class="v20-lib-picker" data-vamp-spec-picker hidden>
      <input type="text" class="v20-lib-search" data-vamp-spec-search placeholder="${t('v20.sheetSearchPh')}" aria-label="${escAttr(t('v20.sheetSearchPh'))}">
      <div class="v20-lib-list" data-vamp-spec-list></div>
    </div>`;

  const humanity = `<div class="v20-stat-block v20-stat-block--centered">
      <div class="v20-stat-title"><input class="v20-line-input v20-path-title" data-tpath="path" value="${escAttr(m.path)}" placeholder="${t('v20.humanity')}" aria-label="${escAttr(t('vamp.pathAria'))}">${_v20AutoBadge(m.humanity, derived.humanity, 'humanity', 'dot')}</div>
      ${_v20DotsHtml('humanity', m.humanity, 10)}
      <div class="vamp-bearing">
        <span class="vamp-bearing-lbl">${escHtml(t('vamp.bearing'))}:</span>
        <input class="v20-line-input" data-tpath="bearing.name" value="${escAttr(m.bearing.name)}" placeholder="${escAttr(t('vamp.bearingNamePh'))}" aria-label="${escAttr(t('vamp.bearing'))}">
        <span aria-hidden="true">(</span><input class="v20-mini-input vamp-bearing-mod" data-tpath="bearing.mod" value="${escAttr(m.bearing.mod)}" aria-label="${escAttr(t('vamp.bearingModAria'))}"><span aria-hidden="true">)</span>
      </div>
    </div>`;
  const willpower = `<div class="v20-stat-block v20-stat-block--centered">
      <div class="v20-stat-title">${t('v20.willpower')} ${_v20AutoBadge(m.willpower.permanent, derived.willpower, 'willpower.permanent', 'dot')}<button type="button" class="v20-mini-action" data-v20-action="spend-willpower" title="${t('v20.spendWillpowerTip')}">−1</button></div>
      ${_v20DotsHtml('willpower.permanent', m.willpower.permanent, 10)}
      ${_v20BoxesHtml('willpower.temp', m.willpower.temp)}
    </div>`;
  const gen = derived.gen;
  const blood = `<div class="v20-stat-block v20-stat-block--centered">
      <div class="v20-stat-title">${t('v20.statBlood')}${gen ? `<span class="v20-gen-info" title="${t('v20.genInfoTitle', { gen: m.header.generation, blood: gen.bloodMax ?? t('v20.genNoCap'), turn: gen.bloodPerTurn ?? '—', dots: gen.maxDots })}">ⓘ</span>` : ''}<button type="button" class="v20-mini-action" data-v20-action="spend-blood" title="${t('v20.spendBloodTip')}">−1</button></div>
      ${gen && gen.bloodMax == null
        ? `<input type="number" min="0" class="v20-mini-input v20-blood-counter" data-tpath="bloodPoolCount" value="${escAttr(m.bloodPoolCount)}" title="${t('v20.gen3CountTitle')}" aria-label="${escAttr(t('v20.statBlood'))}">`
        : _v20BoxesHtml('bloodPool', m.bloodPool)}
      <label class="v20-inline-field">${t('v20.lblBloodTurn')} ${gen && gen.bloodPerTurn != null ? _v20AutoBadge(m.bloodPerTurn, gen.bloodPerTurn, 'bloodPerTurn', 'text') : ''}<input class="v20-mini-input" data-tpath="bloodPerTurn" value="${escAttr(m.bloodPerTurn)}"></label>
    </div>`;

  const healthRows = V20_HEALTH.map(([k, ru, pen]) =>
    `<div class="v20-health-row ww-health-row"><span class="v20-health-name">${escHtml(ru)}</span><span class="v20-health-pen">${escHtml(pen)}</span>${_vampHealthCell(k, ru, m.health[k])}</div>`).join('');
  const legend = `<div class="ww-health-legend">${VAMP_DAMAGE.slice(1).map(d => `<span>${VAMP_DAMAGE_MARK[d]} ${escHtml(t('vamp.dmg.' + d))}</span>`).join('')}</div>`;
  const flawBtn = clanInfo && clanInfo.weakness
    ? `<button type="button" class="v20-mini-action" data-v20-action="insert-clan-weakness" title="${t('v20.insertWeaknessTip')}">+ ${t('v20.insertWeaknessBtn')}</button>` : '';
  const exp = `<div class="v20-stat-block ww-gap">
      <div class="v20-stat-title">${t('v20.statExp')}</div>
      <label class="v20-inline-field">${t('v20.expTotal')} <input class="v20-mini-input" data-tpath="experience.total" data-exp value="${escAttr(m.experience.total)}"></label>
      <label class="v20-inline-field">${t('v20.expSpent')} <input class="v20-mini-input" data-tpath="experience.spent" data-exp value="${escAttr(m.experience.spent)}"></label>
      <label class="v20-inline-field">${t('v20.expRemain')} <span class="v20-exp-remain" id="v20-exp-remain">${_num(m.experience.total, 0) - _num(m.experience.spent, 0)}</span></label>
    </div>
    ${m.experience.log?.length ? `<div class="v20-xp-log">
      <div class="v20-xp-log-title">${t('v20.xpLogTitle')}</div>
      ${m.experience.log.slice(0, 8).map(le => `<div class="v20-xp-log-row"><span>${escHtml(le.date)} · ${escHtml(le.text)}</span><span>−${le.cost}</span></div>`).join('')}
    </div>` : ''}`;

  return `${header}
    <div class="v20-band">${t('v20.bandAttrs')}</div>
    <div class="v20-grid3">${attrCol('physical')}${attrCol('social')}${attrCol('mental')}</div>
    <div class="v20-band">${t('v20.bandAbilities')}</div>
    <div class="v20-grid3">${abilCol('talents')}${abilCol('skills')}${abilCol('knowledges')}</div>
    <div class="v20-band">${t('v20.bandAdvantages')}</div>
    <div class="v20-grid3">${discCol}${bgCol}${virtCol}</div>
    <div class="v20-band vamp-band-blank" aria-hidden="true"></div>
    <div class="v20-grid3 v20-bottom">
      <div class="v20-col"><div class="v20-col-title">${t('v20.colSpec')}${_v20AddRowBtn('specializations', 'v20.specAddTip')}</div>
        <div class="vamp-spec-head" aria-hidden="true"><span>${escHtml(t('v20.specAbilityPh'))}</span><span>${escHtml(t('v20.specSpecPh'))}</span></div>
        ${specPicker}${specRows}</div>
      <div class="v20-col">${humanity}${willpower}${blood}</div>
      <div class="v20-col">
        <div class="v20-col-title">${t('v20.colHealth')}</div>
        <div class="v20-health">${healthRows}</div>${legend}
        <div class="v20-col-title ww-gap">${t('v20.colFlaw')}${flawBtn}</div>
        <input class="v20-field-input" data-tpath="flaw" value="${escAttr(m.flaw)}" aria-label="${escAttr(t('v20.colFlaw'))}">
        ${exp}
      </div>
    </div>`;
}

function _vampPage2(m, cap) {
  const mfRows = m.meritsFlaws.map((mf, i) => `<div class="v20-row v20-named v20-mf-row">${_vampRemoveBtn('meritsFlaws', i)}
      <input class="v20-line-input" data-tpath="meritsFlaws.${i}.name" value="${escAttr(mf.name)}" placeholder="${t('v20.mfNamePh')}" aria-label="${escAttr(t('v20.mfNamePh'))}">
      <select class="v20-mf-kind" data-tpath="meritsFlaws.${i}.kind" aria-label="${escAttr(t('v20.colMf'))}">
        <option value="merit"${mf.kind !== 'flaw' ? ' selected' : ''}>${t('v20.kindMerit')}</option>
        <option value="flaw"${mf.kind === 'flaw' ? ' selected' : ''}>${t('v20.kindFlaw')}</option>
      </select>
      <input type="number" min="0" class="v20-mini-input" data-tpath="meritsFlaws.${i}.points" value="${escAttr(mf.points)}" aria-label="${escAttr(t('vamp.pointsAria'))}">
    </div>`).join('');
  const otRows = m.otherTraits.map((x, i) => _v20NamedDotRow(`otherTraits.${i}.name`, x.name, `otherTraits.${i}.val`, x.val, cap, 'otherTraits')).join('');
  const ritRows = m.rituals.map((r, i) => `<div class="v20-pair-row">${_vampRemoveBtn('rituals', i)}<input class="v20-line-input" data-tpath="rituals.${i}.name" value="${escAttr(r.name)}" placeholder="${t('v20.ritNamePh')}" aria-label="${escAttr(t('v20.ritNamePh'))}"><input class="v20-line-input v20-ritual-lvl" data-tpath="rituals.${i}.level" value="${escAttr(r.level)}" placeholder="${t('v20.ritLevelPh')}" aria-label="${escAttr(t('v20.ritLevelPh'))}"></div>`).join('');
  const ritAll = `<label class="v20-lib-toggle"><input type="checkbox" data-v20-rit-all> ${t('v20.ritAllTraditions')}</label>`;

  // Видимый возраст = Год обращения − Год рождения (карточка); пустое поле предзаполняется.
  const ageComputed = _v20ComputeApparentAge(_v20Ctx?.card);
  if (ageComputed != null && !String(m.description.apparentAge || '').trim()) m.description.apparentAge = String(ageComputed);
  const DESC = [['birthDate', 'v20.descBirth'], ['apparentAge', 'v20.descAppAge'], ['deathDate', 'v20.descDeath'], ['gender', 'v20.descGender'], ['race', 'v20.descRace'],
    ['hair', 'v20.descHair'], ['eyes', 'v20.descEyes'], ['heightWeight', 'v20.descHeightW'], ['build', 'v20.descBuild'], ['nationality', 'v20.descNationality']];
  const descFields = DESC.map(([k, lk]) => {
    if (k !== 'apparentAge' || ageComputed == null) return _v20Field(t(lk), `description.${k}`, m.description[k]);
    const badge = _v20AutoBadge(m.description[k], ageComputed, 'description.apparentAge', 'text');
    return `<label class="v20-field"><span class="v20-field-lbl">${escHtml(t(lk))}${badge}</span><input class="v20-field-input" data-tpath="description.${k}" value="${escAttr(m.description[k] || '')}"></label>`;
  }).join('');

  const COLS = ['weapon', 'diff', 'damage', 'range', 'rate', 'clip', 'size'];
  const LABELS = ['v20.combatWeapon', 'v20.combatDiff', 'v20.combatDamage', 'v20.combatRange', 'v20.combatRate', 'v20.combatClip', 'v20.combatSize'].map(k => t(k));
  const combat = `<div class="v20-combat"><div class="v20-combat-row v20-combat-head">${LABELS.map(l => `<span>${l}</span>`).join('')}</div>${m.combat.map((c, i) =>
    `<div class="v20-combat-row">${COLS.map((k, ci) => `<label class="v20-combat-cell" data-label="${escAttr(LABELS[ci])}"><input class="v20-line-input" data-tpath="combat.${i}.${k}" value="${escAttr(c[k])}" aria-label="${escAttr(LABELS[ci])}"></label>`).join('')}</div>`).join('')}</div>`;

  return `<div class="vamp-p2">
    <div class="vamp-p2-side">
      <div class="v20-col-title">${t('v20.colMf')}${_vampLibBtn('meritflaw', 'v20.libMfTip')}${_v20AddRowBtn('meritsFlaws')}</div>
      ${_vampLibPicker('meritflaw')}
      ${mfRows}
      <div class="v20-col-title ww-gap">${t('v20.colOther')}${_v20AddRowBtn('otherTraits')}</div>
      ${otRows}
      <div class="v20-col-title ww-gap">${t('v20.colRituals')}${_vampLibBtn('ritual', 'v20.libRitTip')}${_v20AddRowBtn('rituals')}</div>
      ${_vampLibPicker('ritual', ritAll)}
      ${ritRows}
    </div>
    <div class="vamp-p2-main">
      <div class="v20-band">${t('v20.colHistory')}</div>
      <textarea class="v20-textarea" data-tpath="history" rows="5" placeholder="${t('v20.historyPh')}" aria-label="${escAttr(t('v20.colHistory'))}">${escHtml(m.history)}</textarea>
      <div class="v20-col-title ww-gap">${t('v20.colGoals')}</div>
      <textarea class="v20-textarea" data-tpath="goals" rows="3" placeholder="${t('v20.goalsPh')}" aria-label="${escAttr(t('v20.colGoals'))}">${escHtml(m.goals)}</textarea>
      <div class="v20-band">${t('v20.colDesc')}</div>
      <textarea class="v20-textarea" data-tpath="description.text" rows="3" placeholder="${escAttr(t('vamp.descTextPh'))}" aria-label="${escAttr(t('v20.colDesc'))}">${escHtml(m.description.text)}</textarea>
      <div class="v20-desc-fields vamp-desc-fields">${descFields}</div>
      <div class="v20-band">${t('v20.colAllies')}</div>
      <textarea class="v20-textarea" data-tpath="allies" rows="5" placeholder="${t('v20.onePerLinePh')}" aria-label="${escAttr(t('v20.colAllies'))}">${escHtml(m.allies)}</textarea>
      <div class="v20-band">${t('v20.colPossessions')}</div>
      <textarea class="v20-textarea" data-tpath="possessions" rows="5" placeholder="${t('v20.onePerLinePh')}" aria-label="${escAttr(t('v20.colPossessions'))}">${escHtml(m.possessions)}</textarea>
      <div class="v20-band">${t('v20.bandCombat')}</div>
      ${combat}
    </div>
  </div>`;
}

function _vampRenderSheet(panel, charName) {
  if (!panel) return;
  const m = _v20Model;
  if (_vampTabSlug !== _v20Ctx?.slug) { _vampTab = 'p1'; _vampTabSlug = _v20Ctx?.slug; }
  const derived = _v20Derive(m);
  const clanInfo = v20ClanInfo(m.header.clan);
  const cap = _v20MaxDotsForGen(m.header.generation);
  const tabs = [['p1', 'vamp.tab.main'], ['p2', 'vamp.tab.bio']];
  const pages = { p1: _vampPage1(m, derived, clanInfo, cap), p2: _vampPage2(m, cap) };
  const dirty = !!_v20DirtyFlag;

  panel.innerHTML = `
    <div class="cdet-sheet-toolbar">
      <button class="cdet-sheet-btn primary" id="v20-save"${dirty ? '' : ' disabled'} title="${t('v20.saveTip')}">${dirty ? t('v20.btnSaveSheet') : t('v20.savedSheet')}</button>
      <button class="cdet-sheet-btn" id="v20-regen" title="${t('v20.regenTip')}">${t('v20.regenBtn')}</button>
      <button class="cdet-sheet-btn" id="v20-validate" title="${t('v20.validateTip')}">${t('v20.validateBtn')}</button>
      <button class="cdet-sheet-btn${_v20XpMode ? ' active' : ''}" id="v20-xpmode" title="${t('v20.xpTip')}" aria-pressed="${_v20XpMode}">${t('v20.xpModeBtn')}${_v20XpMode ? t('v20.xpModeOn') : ''}</button>
      <span class="v20-status${dirty ? ' dirty' : ''}" id="v20-status">${dirty ? t('v20.unsaved') : ''}</span>
    </div>
    <div class="v20-val-report" id="v20-validate-report"></div>
    <div class="chg-budget" id="vamp-budget">${_vampBudgetHtml(m)}</div>
    <div class="chg-tabs" role="tablist" aria-label="${escAttr(t('cdet.tabSheetVampire'))}">${tabs.map(([id, k]) =>
      `<button type="button" class="chg-tab${_vampTab === id ? ' active' : ''}" role="tab" id="vamp-tab-${id}" aria-controls="vamp-page-${id}" aria-selected="${_vampTab === id}" tabindex="${_vampTab === id ? 0 : -1}" data-vamp-tab="${id}">${escHtml(t(k))}</button>`).join('')}</div>
    <div class="v20-sheet vamp-sheet">${tabs.map(([id]) =>
      `<div class="vamp-page" role="tabpanel" id="vamp-page-${id}" aria-labelledby="vamp-tab-${id}" data-vamp-page="${id}"${_vampTab === id ? '' : ' hidden'}>${pages[id]}</div>`).join('')}</div>
    <div class="v20-foot">${t('v20.creationFoot')}</div>`;

  document.getElementById('v20-save').addEventListener('click', _v20Save);
  document.getElementById('v20-regen').addEventListener('click', e => _v20Regen(e.currentTarget));
  document.getElementById('v20-validate').addEventListener('click', _v20ToggleValidation);
  document.getElementById('v20-xpmode').addEventListener('click', () => { _v20XpMode = !_v20XpMode; _vampRenderSheet(panel, charName); });
  _v20BindPanel(panel);
  _vampBindPanel(panel);
}

function _vampRefreshBudget() {
  const el = document.getElementById('vamp-budget');
  if (el && _v20Model && _v20Model.schema === 'vampire-1') el.innerHTML = _vampBudgetHtml(_v20Model);
}

// Свои обработчики поверх _v20BindPanel: вкладки, здоровье с типом урона, секта, бюджет.
// Панель живёт, пока открыта карточка, — вешаем один раз; каждая ветка проверяет, что в
// панели сейчас лист вампира.
function _vampBindPanel(panel) {
  if (panel._vampBound) return;
  panel._vampBound = true;
  const isVamp = () => _v20Model && _v20Model.schema === 'vampire-1';
  const selectTab = (id, focus) => {
    _vampTab = id;
    panel.querySelectorAll('[data-vamp-tab]').forEach(b => {
      const on = b.dataset.vampTab === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    panel.querySelectorAll('[data-vamp-page]').forEach(p => { p.hidden = p.dataset.vampPage !== id; });
  };
  panel.addEventListener('click', e => {
    if (!isVamp()) return;
    const tab = e.target.closest('[data-vamp-tab]');
    if (tab) { selectTab(tab.dataset.vampTab, false); return; }
    const archBtn = e.target.closest('[data-vamp-arch]');
    if (archBtn) { _vampToggleArchPicker(archBtn.dataset.vampArch); return; }
    const archItem = e.target.closest('[data-vamp-arch-item]');
    if (archItem) { _vampPickArchetype(archItem.dataset.vampArchItem, archItem.dataset.vampArchName); return; }
    const clanBtn = e.target.closest('[data-vamp-clan]');
    if (clanBtn) { _vampToggleClanPicker(); return; }
    const clanItem = e.target.closest('[data-vamp-clan-item]');
    if (clanItem) { _vampPickClan(clanItem.dataset.vampClanName); return; }
    const specBtn = e.target.closest('[data-vamp-spec]');
    if (specBtn) { _vampToggleSpecPicker(+specBtn.dataset.vampSpec); return; }
    const specItem = e.target.closest('[data-vamp-spec-item]');
    if (specItem) { _vampPickSpec(specItem.dataset.vampSpecItem); return; }
    const cell = e.target.closest('[data-vamp-health]');
    if (cell) {
      const k = cell.dataset.vampHealth;
      const nv = VAMP_DAMAGE[(VAMP_DAMAGE.indexOf(_v20Model.health[k] || '') + 1) % VAMP_DAMAGE.length];
      _v20Model.health[k] = nv;
      const label = (V20_HEALTH.find(([key]) => key === k) || [])[1] || k;
      cell.outerHTML = _vampHealthCell(k, label, nv);
      panel.querySelector(`[data-vamp-health="${k}"]`)?.focus();
      _v20MarkDirty();
      return;
    }
    // Точки и клетки обрабатывает _v20BindPanel; бюджет пересчитываем после него.
    if (e.target.closest('.v20-dot, .v20-box')) setTimeout(_vampRefreshBudget, 0);
  });
  panel.addEventListener('keydown', e => {
    if (!isVamp()) return;
    const tab = e.target.closest('[data-vamp-tab]');
    if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      const ids = ['p1', 'p2'];
      const i = ids.indexOf(tab.dataset.vampTab);
      selectTab(ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length], true);
      return;
    }
    if (e.target.closest('.v20-dot, .v20-box') && (e.key === 'Enter' || e.key === ' ')) setTimeout(_vampRefreshBudget, 0);
  });
  panel.addEventListener('change', e => {
    if (!isVamp()) return;
    const sel = e.target.closest('[data-vamp-sect]');
    if (sel) { _vampSectPick = { slug: _v20Ctx?.slug, sect: sel.value }; _vampRefreshBudget(); }
  });
  panel.addEventListener('input', e => {
    if (!isVamp()) return;
    const s = e.target.closest('[data-vamp-arch-search]');
    if (s) { _vampRenderArchList(s.dataset.vampArchSearch, s.value); return; }
    const cs = e.target.closest('[data-vamp-clan-search]');
    if (cs) { _vampRenderClanList(cs.value); return; }
    const ss = e.target.closest('[data-vamp-spec-search]');
    if (ss) { _vampRenderSpecList(ss.value); }
  });
}
