'use strict';
// Фаза I — создание авторских элементов библиотеки (дисциплины, психические
// способности, достоинства, недостатки, факты биографии, кланы, секты).
// Правка/удаление СУЩЕСТВУЮЩИХ элементов переехала в единую детейл-модалку
// (v20-sheet.js, K1, 2026-08-04) — этот файл отвечает только за форму
// создания (#lib-edit-modal) и общий источник конфигурации полей
// (_LIB_FIELD_DEFS/_LIB_KIND_CONFIG), который переиспользует и K1.
// Канон защищён на сервере (см. web/routes/library.js) — эта форма лишь
// собирает поля и вызывает POST/PUT; список полей меняется в зависимости
// от «kind» (см. _LIB_KIND_CONFIG).

const _LIB_MERIT_CATS = [
  ['physical', t('lib.catPhysical')], ['mental', t('lib.catMental')],
  ['social', t('lib.catSocial')], ['supernatural', t('lib.catSupernatural')],
];
const _LIB_FLAW_CATS = [
  ['физические', t('lib.catPhysical')], ['умственные', t('lib.catMental')],
  ['социальные', t('lib.catSocial')], ['сверхъестественные', t('lib.catSupernatural')],
];
const _LIB_BG_CATS = [
  ['general', t('lib.catGeneral')], ['vampire', t('lib.catVampires')], ['ghoul', t('lib.catGhoul')],
  ['mage', t('lib.catMage')], ['changeling', t('lib.catChangeling')],
];

// Единый источник разметки поля по ключу — переиспользуется формой создания
// (#lib-edit-modal) И режимом правки внутри детейл-модалки (K1,
// _v20RenderLibEditForm) — один рендерер, не два расходящихся куска HTML.
// «name» не входит в fields конкретного kind — рендерится отдельно, всегда первым.
const _LIB_FIELD_DEFS = {
  name:             { label: t('lib.labelName'), type: 'text' },
  clans:            { label: t('lib.labelClans'), type: 'text' },
  affiliation:      { label: t('lib.labelAffiliation'), type: 'text' },
  'category-text':  { label: t('lib.labelCategory'), type: 'text' },
  'category-select':{ label: t('lib.labelCategory'), type: 'select' },
  source:           { label: t('lib.labelSource'), type: 'text' },
  note:             { label: t('lib.labelNote'), type: 'textarea', rows: 2 },
  points:           { label: t('lib.labelPoints'), type: 'number', min: 1, max: 7 },
  description:      { label: t('lib.labelDescription'), type: 'textarea', rows: 4 },
  'system-text':    { label: t('lib.labelSystemText'), type: 'textarea', rows: 4 },
  levels:           { label: t('lib.labelLevels'), type: 'levels' },
  'discipline-list':{ label: t('lib.labelDisciplineList'), type: 'text' },
  weakness:         { label: t('lib.labelWeakness'), type: 'textarea', rows: 2 },
  'checkbox-negative': { label: t('lib.labelNegativeTitle'), type: 'checkbox' },
  // Ритуалы (doc/design/2026-09-24-library-rituals-spec.md §11)
  'name-en':        { label: t('lib.labelNameEn'), type: 'text' },
  // Архетипы «Натура и Маска» (mirror merits без category-select; 'willpower-text' —
  // тот же суффикс-конвеншн, что у 'system-text'/'category-text': ключ поля отличается
  // от ключа записи, см. _LIB_FIELD_RECORD_KEY; существующий 'willpower' — number для
  // оборотней, его не трогаем).
  'name_en':         { label: t('lib.labelNameEn'), type: 'text' },
  'description_en':  { label: t('lib.labelDescription') + ' (EN)', type: 'textarea', rows: 4 },
  'willpower-text':  { label: t('about.archWill'), type: 'textarea', rows: 2 },
  'willpower_en':    { label: t('about.archWill') + ' (EN)', type: 'textarea', rows: 2 },
  // Специализации (doc/design/2026-10-15-sheet-pickers-specializations-spec.md §2.7):
  // 'ability-text' — тот же суффикс-конвеншн, что у 'category-text'/'willpower-text'
  // (ключ поля отличается от ключа записи, см. _LIB_FIELD_RECORD_KEY).
  'ability-text':    { label: t('v20.specAbilityPh'), type: 'text' },
  level:            { label: t('lib.labelLevel'), type: 'number', min: 1, max: 10 },
  literary:         { label: t('lib.labelLiterary'), type: 'textarea', rows: 3 },
  'ritual-system':  { label: t('lib.labelRitualSystem'), type: 'textarea', rows: 4 },
  // Оборотни (2026-10-12, library-lineages.js) — ключи совпадают с полями API.
  totem:            { label: t('lin.ww.totem'), type: 'text' },
  willpower:        { label: t('lin.ww.willpower'), type: 'number', min: 1, max: 5 },
  restrictions:     { label: t('lin.ww.restrictions'), type: 'text' },
  gifts:            { label: t('lin.ww.gifts'), type: 'text' },
  moon:             { label: t('lin.ww.moon'), type: 'text' },
  rage:             { label: t('lin.ww.rage'), type: 'number', min: 1, max: 5 },
  renown:           { label: t('lin.ww.renown'), type: 'text' },
  gnosis:           { label: t('lin.ww.gnosis'), type: 'number', min: 1, max: 5 },
  birthrights:      { label: t('lin.fa.birthrights'), type: 'textarea', rows: 3 },
  frailty:          { label: t('lin.fa.frailty'), type: 'textarea', rows: 2 },
  affinity:         { label: t('lin.fa.affinity'), type: 'text' },
  glamour:          { label: t('lin.fa.glamour'), type: 'number', min: 1, max: 5 },
  banality:         { label: t('lin.fa.banality'), type: 'number', min: 1, max: 5 },
  boon:             { label: t('lin.fa.boon'), type: 'textarea', rows: 2 },
  flaw:             { label: t('lin.fa.flaw'), type: 'textarea', rows: 2 },
  attribute:        { label: t('lin.fa.attribute'), type: 'text' },
  // Пути Просветления (2026-10-15, paths-spec) — ключи совпадают с полями API.
  pathNickname:      { label: t('lib.labelNickname'), type: 'text' },
  pathVirtues:       { label: t('lib.labelVirtues'), type: 'text' },
  pathPillar:        { label: t('lib.labelPillar'), type: 'text' },
  pathSins:          { label: t('lib.labelSins'), type: 'textarea', rows: 10 },
  // Обряды Шабаша (2026-10-15, п.6 мастер-спеки) — ключ совпадает с полем API.
  sabbatRiteType:    { label: t('lib.labelRiteType'), type: 'text' },
  // Дары/обряды оборотней, сферы/техники магов (2026-10-13, lineage-levels.js).
  giftGroup:        { label: t('lin.ww.giftGroup'), type: 'text' },
  giftLevel:        { label: t('lin.ww.level'), type: 'number', min: 1, max: 5 },
  riteType:         { label: t('lin.ww.riteType'), type: 'text' },
  // Таро магов (2026-10-13) — поля шапки карты.
  tarotArcana:      { label: t('lin.mg.tarotArcana'), type: 'text' },
  tarotMeaning:     { label: t('lin.mg.tarotMeaning'), type: 'text' },
  tarotReversed:    { label: t('lin.mg.tarotReversed'), type: 'text' },
  tarotAssociation: { label: t('lin.mg.tarotAssociation'), type: 'text' },
  // Маги по книгам (2026-10-13): роты, часовни, чудеса, миры.
  rotesAffiliation: { label: t('lin.mg.rotesAffil'), type: 'text' },
  rotesSpheres:     { label: t('lin.mg.rotesSpheres'), type: 'text' },
  chantryType:      { label: t('lin.mg.chantryType'), type: 'text' },
  chantryPlace:     { label: t('lin.mg.chantryPlace'), type: 'text' },
  wonderType:       { label: t('lin.mg.wonderType'), type: 'text' },
  wonderPower:      { label: t('lin.mg.wonderPower'), type: 'text' },
  worldLayer:       { label: t('lin.mg.worldLayer'), type: 'text' },
  // Сущности Аватары (2026-10-15, mage-hunter-gaps-spec §4): ключ поля
  // отличается от ключа записи (суффикс-конвеншн willpower-text/ability-text).
  essenceElement:   { label: t('lin.mg.essenceElement'), type: 'text' },
};

// Ключ поля → свойство записи, если они называются по-разному (историческое
// расхождение, было и в прежней версии формы: category-text читает rec.category,
// system-text — rec.system).
const _LIB_FIELD_RECORD_KEY = {
  'category-text': 'category',
  'system-text': 'system',
  'willpower-text': 'willpower',
  'ability-text': 'ability',
  'discipline-list': 'disciplines',
  'checkbox-negative': 'negative',
  'name-en': 'nameEn',
  'ritual-system': 'system',
  'giftGroup': 'group',
  'sabbatRiteType': 'type',
  'pathNickname': 'nickname',
  'pathVirtues': 'virtues',
  'pathPillar': 'pillar',
  'pathSins': 'sins',
  'giftLevel': 'level',
  'riteType': 'type',
  'tarotArcana': 'arcana',
  'tarotMeaning': 'meaning',
  'tarotReversed': 'reversed',
  'tarotAssociation': 'association',
  'rotesAffiliation': 'affiliation',
  'rotesSpheres': 'spheres',
  'chantryType': 'type',
  'chantryPlace': 'place',
  'wonderType': 'type',
  'wonderPower': 'power',
  'worldLayer': 'layer',
  'essenceElement': 'element',
};

// Конфиг per-kind: какие поля показывать (порядок = порядок в форме), как
// собрать тело запроса, как перезагрузить список после сохранения/удаления.
// clans/sects — K3/K4 (2026-08-04): «Секта» клана переиспользует уже
// существующий тип поля category-select (список опций — секты из K4, не
// второй хардкод того же списка) с подписью, переопределённой на «Секта».
const _LIB_KIND_CONFIG = {
disciplines: {
    title: t('lib.titleDiscipline'), fields: ['clans', 'source', 'note', 'levels'],
    reload: () => { _disciplinesCache = null; return loadLibrary(); },
  },
  psychics: {
    title: t('lib.titlePsychic'), fields: ['category-text', 'source', 'note', 'levels'],
    reload: () => { _psychicsCache = null; return loadPsychicsLibrary(); },
  },
  merits: {
    title: t('lib.titleMerit'), fields: ['category-select', 'points', 'description'], categories: _LIB_MERIT_CATS,
    reload: category => loadMeritsLibrary(category),
  },
  flaws: {
    title: t('lib.titleFlaw'), fields: ['category-select', 'points', 'description'], categories: _LIB_FLAW_CATS,
    reload: category => loadFlawsLibrary(category),
  },
  backgrounds: {
    title: t('lib.titleBackground'), fields: ['category-select', 'description', 'system-text'], categories: _LIB_BG_CATS,
    reload: category => loadBackgroundsLibrary(category),
  },
  // Архетипы (doc/design/2026-10-15-about-character-spec.md): плоский список, категории
  // нет — category-select в полях отсутствует, reload категорию игнорирует.
  archetypes: {
    title: t('library.add.archetype'),
    fields: ['name_en', 'description', 'description_en', 'willpower-text', 'willpower_en'],
    // Тот же JSON-трек, что у specializations (isJsonTrack в v20-sheet.js) —
    // без categories правка/удаление уходили на несуществующий MD-URL (404).
    categories: ['archetypes'],
    reload: () => loadArchetypesLibrary(),
  },
  // Специализации (doc/design/2026-10-15-sheet-pickers-specializations-spec.md §2.6-2.7):
  // плоский список, категории нет — category-select в полях отсутствует, reload
  // категорию игнорирует. loadSpecializationsLibrary живёт в v20-sheet.js
  // (правит другой агент) — зовём только через typeof-guard.
  specializations: {
    title: t('library.add.specialization'),
    fields: ['ability-text', 'description'],
    // categories нужен isJsonTrack в _v20SaveLibEdit/_v20DeleteCurrentLibRecord
    // (JSON-трек: /:category/:slug); на форму не влияет — category-select в fields нет.
    categories: ['specializations'],
    reload: () => (typeof loadSpecializationsLibrary === 'function' ? loadSpecializationsLibrary() : null),
  },
  clans: {
    title: t('lib.titleClan'), fields: ['category-select', 'discipline-list', 'weakness', 'source', 'note', 'description'],
    fieldLabels: { 'category-select': t('lib.labelSect') }, categoryRecordKey: 'sect',
    categoriesAsync: async () => (await ensureSects()).map(s => [s.name, s.name]),
    reload: () => { _clansCache = null; return loadKindred('clans'); },
  },
  sects: {
    title: t('lib.titleSect'), fields: ['source', 'note', 'description'],
    reload: () => { _sectsCache = null; return loadKindred('sects'); },
  },
  titles: {
    title: t('lib.titleTitle'), fields: ['affiliation', 'checkbox-negative', 'source', 'note', 'description'],
    reload: () => { _titlesCache = null; return loadKindred('titles'); },
  },
  'sabbat-rites': {
    title: t('lib.titleSabbatRite'), fields: ['sabbatRiteType', 'source', 'note', 'description'],
    reload: () => { _sabRitesCache = null; return loadKindred('rites'); },
  },
  'vampire-paths': {
    title: t('lib.titlePath'), fields: ['pathNickname', 'pathVirtues', 'pathPillar', 'source', 'note', 'description', 'pathSins'],
    reload: () => { _pathsCache = null; return loadKindred('paths'); },
  },
  rituals: {
    title: t('lib.titleRitual'), fields: ['name-en', 'category-select', 'level', 'source', 'literary', 'ritual-system'],
    fieldLabels: { 'category-select': t('lib.labelTradition') }, categoryRecordKey: 'tradition',
    categories: ['thaumaturgy', 'necromancy', 'assamite', 'koldun', 'osiris'].map(c => [c, t('lib.rit.tradition.' + c)]),
    reload: () => loadRitualsLibrary(true),
  },
  // «Смертные» (2026-08-08) — 5 категорий, схема идентична «Секте» выше (см. B.1 техспеки).
  'mortal-government': { title: t('lib.titleGov'), fields: ['source', 'note', 'description'], reload: () => { _mortLibCache.delete('government'); return loadMortalLib('government'); } },
  'mortal-religious':  { title: t('lib.titleOrg'), fields: ['source', 'note', 'description'], reload: () => { _mortLibCache.delete('religious'); return loadMortalLib('religious'); } },
  'mortal-crime':      { title: t('lib.titleCrime'), fields: ['source', 'note', 'description'], reload: () => { _mortLibCache.delete('crime'); return loadMortalLib('crime'); } },
  'mortal-civic':      { title: t('lib.titleOrg'), fields: ['source', 'note', 'description'], reload: () => { _mortLibCache.delete('civic'); return loadMortalLib('civic'); } },
  'mortal-positions':  { title: t('lib.titlePosition'), fields: ['source', 'note', 'description'], reload: () => { _mortLibCache.delete('positions'); return loadMortalLib('positions'); } },
  // «Гули и ревенанты» (2026-10-15) — схема «Смертных»; у семей поле Дисциплины
  // (переиспользует готовый тип 'discipline-list' → record key 'disciplines').
  'ghouls':            { title: t('lib.titleGhoulEntry'), fields: ['source', 'note', 'description'], reload: () => { _ghoulLibCache.delete('ghouls'); return loadGhoulLib('ghouls'); } },
  'revenant-families': { title: t('lib.titleFamily'), fields: ['discipline-list', 'source', 'note', 'description'], reload: () => { _ghoulLibCache.delete('revenants'); return loadGhoulLib('revenants'); } },
  // Оборотни и Маги (2026-10-12) — library-lineages.js.
  'werewolf-tribes':   { title: t('lin.title.tribe'), fields: ['totem', 'willpower', 'restrictions', 'gifts', 'source', 'note', 'description'], reload: () => linLibReload('werewolf-tribes') },
  'werewolf-auspices': { title: t('lin.title.auspice'), fields: ['moon', 'rage', 'renown', 'gifts', 'source', 'note', 'description'], reload: () => linLibReload('werewolf-auspices') },
  'werewolf-breeds':   { title: t('lin.title.breed'), fields: ['gnosis', 'gifts', 'source', 'note', 'description'], reload: () => linLibReload('werewolf-breeds') },
  'mage-traditions':   { title: t('lin.title.tradition'), fields: ['source', 'note', 'description'], reload: () => linLibReload('mage-traditions') },
  'mage-conventions':  { title: t('lin.title.convention'), fields: ['source', 'note', 'description'], reload: () => linLibReload('mage-conventions') },
  'fairy-kiths':      { title: t('lin.title.kith'), fields: ['birthrights', 'frailty', 'affinity', 'source', 'note', 'description'], reload: () => linLibReload('fairy-kiths') },
  'fairy-courts':     { title: t('lin.title.court'), fields: ['source', 'note', 'description'], reload: () => linLibReload('fairy-courts') },
  'fairy-seemings':   { title: t('lin.title.seeming'), fields: ['glamour', 'willpower', 'banality', 'source', 'note', 'description'], reload: () => linLibReload('fairy-seemings') },
  'fairy-houses':     { title: t('lin.title.house'), fields: ['boon', 'flaw', 'source', 'note', 'description'], reload: () => linLibReload('fairy-houses') },
  'fairy-arts':       { title: t('lin.title.art'), fields: ['attribute', 'source', 'note', 'description', 'levels'], reload: () => linLibReload('fairy-arts') },
  'fairy-realms':     { title: t('lin.title.realm'), fields: ['source', 'note', 'description', 'levels'], reload: () => linLibReload('fairy-realms') },
  'werewolf-gifts':   { title: t('lin.title.gift'), fields: ['giftGroup', 'giftLevel', 'source', 'note', 'description', 'system-text'], reload: () => linLibReload('werewolf-gifts') },
  'werewolf-rites':   { title: t('lin.title.rite'), fields: ['riteType', 'giftLevel', 'source', 'note', 'description', 'system-text'], reload: () => linLibReload('werewolf-rites') },
  'mage-spheres':     { title: t('lin.title.sphere'), fields: ['source', 'note', 'description', 'levels'], reload: () => linLibReload('mage-spheres') },
  'mage-techniques':  { title: t('lin.title.technique'), fields: ['source', 'note', 'description', 'system-text'], reload: () => linLibReload('mage-techniques') },
  'mage-tarot':       { title: t('lin.title.tarot'), fields: ['tarotArcana', 'tarotMeaning', 'tarotReversed', 'tarotAssociation', 'source', 'note', 'description', 'system-text'], reload: () => linLibReload('mage-tarot') },
  'mage-rotes':       { title: t('lin.title.rote'), fields: ['rotesAffiliation', 'rotesSpheres', 'source', 'note', 'description', 'system-text'], reload: () => linLibReload('mage-rotes') },
  'mage-factions':    { title: t('lin.title.faction'), fields: ['source', 'note', 'description'], reload: () => linLibReload('mage-factions') },
  'mage-chantries':   { title: t('lin.title.chantry'), fields: ['chantryType', 'chantryPlace', 'source', 'note', 'description', 'system-text'], reload: () => linLibReload('mage-chantries') },
  'mage-wonders':     { title: t('lin.title.wonder'), fields: ['wonderType', 'wonderPower', 'source', 'note', 'description', 'system-text'], reload: () => linLibReload('mage-wonders') },
  'mage-worlds':      { title: t('lin.title.world'), fields: ['worldLayer', 'source', 'note', 'description', 'system-text'], reload: () => linLibReload('mage-worlds') },
  // Сущности Аватары (2026-10-15, mage-hunter-gaps-spec §4): JSON-трек
  // (категории фиксированные, как у archetypes) — без category-select,
  // без уровней, со Стихией и EN-описанием.
  'essences':         { title: t('lin.title.essence'), fields: ['name_en', 'essenceElement', 'description', 'description_en'], categories: ['essences'], reload: () => linLibReload('essences') },
};

function _libLevelRowHtml(lvl = {}) {
  return `<div class="mod-fill-chips lib-level-row" style="align-items:flex-start;gap:6px;margin-bottom:6px">
    <input class="chr-form-input" style="width:60px" type="number" min="1" max="10" placeholder="${t('lib.levelNumPh')}" data-lib-level-n value="${escAttr(lvl.level ?? '')}">
    <input class="chr-form-input" style="flex:1" placeholder="${t('lib.levelNamePh')}" data-lib-level-name value="${escAttr(lvl.name || '')}">
    <button type="button" class="lib-card-action-btn" data-lib-level-remove title="${t('lib.removeLevel')}">✕</button>
    <textarea class="chr-form-input" style="flex-basis:100%" rows="2" placeholder="${t('lib.levelLiteraryPh')}" data-lib-level-literary>${escHtml(lvl.literary || '')}</textarea>
    <textarea class="chr-form-input" style="flex-basis:100%" rows="2" placeholder="${t('lib.levelSystemPh')}" data-lib-level-system>${escHtml(lvl.system || '')}</textarea>
  </div>`;
}

// root — контейнер, внутри которого искать/собирать поля: либо #lib-edit-modal
// (форма создания), либо #v20-disc-modal-body (режим правки внутри K1). Оба
// используют одну и ту же разметку (_libFieldRowHtml), поэтому один и тот же
// набор функций работает для обоих без дублирования.
function _libFieldRowHtml(key, value, labelOverride) {
  const def = _LIB_FIELD_DEFS[key];
  if (!def) return '';
  const label = labelOverride || def.label;
  if (key === 'levels') {
    return `<div class="chr-form-group" data-lib-field="levels">
      <label class="chr-form-label">${escHtml(label)}</label>
      <div class="lib-levels-list" data-lib-levels-list></div>
      <button type="button" class="mod-fill-add-btn" data-lib-add-level>${t('lib.addLevel')}</button>
    </div>`;
  }
  if (def.type === 'checkbox') {
    return `<div class="chr-form-group chr-form-checkbox-row" data-lib-field="${key}">
      <label class="chr-form-checkbox-label">
        <input type="checkbox" data-lib-input${value ? ' checked' : ''}>
        ${escHtml(label)}
      </label>
    </div>`;
  }
  if (def.type === 'select') {
    return `<div class="chr-form-group" data-lib-field="${key}">
      <label class="chr-form-label">${escHtml(label)}</label>
      <select class="chr-form-input" data-lib-input></select>
    </div>`;
  }
  if (def.type === 'textarea') {
    return `<div class="chr-form-group" data-lib-field="${key}">
      <label class="chr-form-label">${escHtml(label)}</label>
      <textarea class="chr-form-input chr-form-textarea" rows="${def.rows || 3}" data-lib-input>${escHtml(value || '')}</textarea>
    </div>`;
  }
  const numAttrs = def.type === 'number' ? ` type="number" min="${def.min ?? ''}" max="${def.max ?? ''}"` : ' type="text" autocomplete="off"';
  return `<div class="chr-form-group" data-lib-field="${key}">
    <label class="chr-form-label">${key === 'name' ? label + ' *' : label}</label>
    <input class="chr-form-input"${numAttrs} value="${escAttr(value ?? '')}" data-lib-input>
  </div>`;
}

// Полная разметка формы (имя всегда первым + поля kind.fields) — общий вызов
// для формы создания и для режима правки K1.
function _libFormFieldsHtml(kind, rec = {}) {
  const cfg = _LIB_KIND_CONFIG[kind];
  if (!cfg) return '';
  const labels = cfg.fieldLabels || {};
  let html = _libFieldRowHtml('name', rec.name || '');
  for (const key of cfg.fields) {
    if (key === 'levels') { html += _libFieldRowHtml('levels'); continue; }
    if (key === 'category-select') { html += _libFieldRowHtml(key, '', labels[key]); continue; }
    // Иерархия грехов: массив sins[] → 10 строк «грех | обоснование».
    if (key === 'pathSins') {
      const val = Array.isArray(rec.sins) ? rec.sins.map(s =>
        s && s.reason ? `${s.sin || ''} | ${s.reason}` : String((s && s.sin) || '')) : [];
      html += _libFieldRowHtml(key, val.join('\n'), labels[key]);
      continue;
    }
    const recKey = _LIB_FIELD_RECORD_KEY[key] || key;
    html += _libFieldRowHtml(key, rec[recKey], labels[key]);
  }
  return html;
}

function _libRenderLevels(root, levels) {
  const box = root.querySelector('[data-lib-levels-list]');
  if (box) box.innerHTML = (levels && levels.length ? levels : [{}]).map(_libLevelRowHtml).join('');
}

function _libCollectLevels(root) {
  return Array.from(root.querySelectorAll('[data-lib-levels-list] .lib-level-row')).map(row => ({
    level: parseInt(row.querySelector('[data-lib-level-n]').value, 10) || 1,
    name: row.querySelector('[data-lib-level-name]').value.trim(),
    literary: row.querySelector('[data-lib-level-literary]').value.trim(),
    system: row.querySelector('[data-lib-level-system]').value.trim(),
  })).filter(l => l.name);
}

function _libFieldInput(root, key) {
  return root.querySelector(`[data-lib-field="${key}"] [data-lib-input]`);
}

async function _libFillCategorySelect(root, kind, selected) {
  const cfg = _LIB_KIND_CONFIG[kind];
  const sel = _libFieldInput(root, 'category-select');
  if (!sel) return;
  const options = cfg.categoriesAsync ? await cfg.categoriesAsync() : (cfg.categories || []);
  sel.innerHTML = options.map(([v, label]) => `<option value="${escAttr(v)}">${escHtml(label)}</option>`).join('');
  if (selected) sel.value = selected;
}

// Заполняет root (сам контейнер полей — не модалка целиком) разметкой формы
// (создание ИЛИ правка — одна функция на оба случая) и текущими значениями
// rec (пустой объект для создания).
async function _libRenderForm(root, kind, rec = {}) {
  const cfg = _LIB_KIND_CONFIG[kind];
  if (!cfg) return;
  root.innerHTML = _libFormFieldsHtml(kind, rec);
  if (cfg.fields.includes('category-select')) {
    const selected = rec[cfg.categoryRecordKey || 'category'] || '';
    await _libFillCategorySelect(root, kind, selected);
  }
  if (cfg.fields.includes('levels')) _libRenderLevels(root, rec.levels || []);
}

function _libCollectForm(root, kind) {
  const cfg = _LIB_KIND_CONFIG[kind];
  const body = { name: (_libFieldInput(root, 'name')?.value || '').trim() };
  for (const key of cfg.fields) {
    if (key === 'levels') { body.levels = _libCollectLevels(root); continue; }
    // Строки «грех | обоснование» → [{ rating: 10-i, sin, reason }]; сервер
    // проверяет ровно 10 записей 10→1 (400 иначе).
    if (key === 'pathSins') {
      const raw = (_libFieldInput(root, key)?.value || '').split('\n').map(l => l.trim()).filter(Boolean);
      body.sins = raw.map((line, i) => {
        const [sin, ...rest] = line.split('|');
        const reason = rest.join('|').trim();
        return { rating: 10 - i, sin: sin.trim(), reason: reason || null };
      });
      continue;
    }
    if (key === 'category-select') continue; // собирается отдельно ниже (ключ различается: category/sect)
    if (key === 'checkbox-negative') { body.negative = !!_libFieldInput(root, key)?.checked; continue; }
    const recKey = _LIB_FIELD_RECORD_KEY[key] || key;
    body[recKey] = (_libFieldInput(root, key)?.value || '').trim();
  }
  if (cfg.fields.includes('category-select')) {
    const val = _libFieldInput(root, 'category-select')?.value || '';
    body[cfg.categoryRecordKey || 'category'] = val;
  }
  return body;
}

// Единая точка поиска записи по kind/slug/category — используется и формой
// создания (для reload после сохранения — не нужен), и K1 (v20-sheet.js) для
// заполнения режима правки и текста подтверждения удаления.
function _libFindRecord(kind, slug, category) {
  if (kind === 'disciplines') return _discBySlug(slug);
  if (kind === 'psychics') return _psyBySlug(slug);
  if (kind === 'merits') return (_meritsCache[category] || []).find(x => x.slug === slug);
  if (kind === 'archetypes') return (typeof _archetypeBySlug === 'function' ? _archetypeBySlug(slug) : null);
  if (kind === 'specializations') return (typeof _specializationBySlug === 'function' ? _specializationBySlug(slug) : null);
  if (kind === 'flaws') return (_flawsCache[category] || []).find(x => x.slug === slug);
  if (kind === 'backgrounds') return _backgroundBySlug(category, slug);
  if (kind === 'clans') return _clanBySlug(slug);
  if (kind === 'sects') return _sectBySlug(slug);
  if (kind === 'titles') return _titleBySlug(slug);
  if (kind === 'rituals') return _ritBySlug(slug);
  if (kind === 'vampire-paths') return _pathBySlug(slug);
  if (kind === 'ghouls') return _ghoulBySlug('ghouls', slug);
  if (kind === 'revenant-families') return _ghoulBySlug('revenants', slug);
  if (kind === 'sabbat-rites') return _sabRiteBySlug(slug);
  if (kind.startsWith('mortal-')) return _mortBySlug(kind.slice('mortal-'.length), slug);
  if (typeof _linIsKind === 'function' && _linIsKind(kind)) return _linBySlug(kind, slug);
  return null;
}

// ── Форма создания (#lib-edit-modal) — без правки, только POST ──────────────
let _libCreateKind = null;
let _libCreateCategory = null; // категория, с которой открыли модалку (активная подвкладка или фиксированная)
let _libCreateIsFork = false; // для toast-подтверждения в _libSaveCreate ниже
let _libEditSlug = null;      // правка авторской записи через ту же форму (PUT) — сейчас только ритуалы

// Форк канона (2026-08-08) — «(копия)» — не защита от коллизии имени (её обеспечивает
// существующая проверка slug на сервере, POST /api/library/<kind> вернёт 409), а подсказка,
// чтобы форма не открывалась с именем, дословно совпадающим с каноном.
function _libForkedName(name) {
  return `${name} (${t('lib.copySuffix')})`;
}

// Третий параметр sourceRec — опциональный, для форка канона (вызовы без него, с кнопок
// «+ Добавить», ведут себя как прежде, byte-for-byte). Поля формы уже называются один в один
// с полями, которые парсеры (parseClanMd/parseDisciplineMd/…) возвращают в записи — та же
// логика, что уже предзаполняет форму правки авторских записей, работает и здесь без
// адаптеров: канон и авторские записи отдаёт один и тот же парсер, различается только custom.
async function _libOpenCreateModal(kind, category, sourceRec, editSlug) {
  const cfg = _LIB_KIND_CONFIG[kind];
  if (!cfg) return;
  _libCreateKind = kind;
  _libCreateCategory = category ?? null;
  _libEditSlug = editSlug || null;
  _libCreateIsFork = !!sourceRec && !editSlug;
  const prefix = editSlug ? t('lib.editPrefix') : sourceRec ? t('lib.copyPrefix') : t('lib.newPrefix');
  document.getElementById('lib-edit-title').textContent = `${prefix}: ${cfg.title}`;
  const fieldsBox = document.getElementById('lib-edit-fields');
  document.getElementById('lib-edit-error').style.display = 'none';
  const rec = editSlug ? { ...sourceRec }
    : sourceRec ? { ...sourceRec, name: _libForkedName(sourceRec.name) }
    : (cfg.categoryRecordKey ? (category ? { [cfg.categoryRecordKey]: category } : {}) : { category });
  await _libRenderForm(fieldsBox, kind, rec);
  openModal('lib-edit-modal', '[data-lib-field="name"] input');
}

async function _libSaveCreate() {
  const kind = _libCreateKind;
  const cfg = _LIB_KIND_CONFIG[kind];
  if (!cfg) return;
  const errEl = document.getElementById('lib-edit-error');
  errEl.style.display = 'none';
  const fieldsBox = document.getElementById('lib-edit-fields');
  const body = _libCollectForm(fieldsBox, kind);
  if (!body.name) { errEl.textContent = t('lib.nameRequired'); errEl.style.display = ''; return; }
  // Kinds без category-select (archetypes, specializations) категорию в тело не
  // кладут — сервер (_jsonLibRoutes) требует category (400 иначе). Подставляем ту,
  // с которой открыли модалку (фиксированная, см. _libWireAddButtons). У остальных
  // body.category уже заполнен из селекта — не трогаем.
  if (body.category == null && _libCreateCategory != null) body.category = _libCreateCategory;

  const submitBtn = document.getElementById('lib-edit-submit');
  submitBtn.disabled = true;
  try {
    const url = _libEditSlug ? `/api/library/${kind}/${encodeURIComponent(_libEditSlug)}` : `/api/library/${kind}`;
    const r = await fetch(url, {
      method: _libEditSlug ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(x => x.json());
    if (!r.ok) { errEl.textContent = r.error || t('lib.saveError'); errEl.style.display = ''; return; }
    closeModal('lib-edit-modal');
    if (_libCreateIsFork) showToast(t('lib.forkCreated', { name: body.name }), 'success');
    await cfg.reload(body.category);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = '';
  } finally {
    submitBtn.disabled = false;
  }
}

document.getElementById('lib-edit-cancel')?.addEventListener('click', () => closeModal('lib-edit-modal'));
document.getElementById('lib-edit-submit')?.addEventListener('click', _libSaveCreate);
bindBackdropDblClickClose(document.getElementById('lib-edit-modal'), () => closeModal('lib-edit-modal'));
document.getElementById('lib-edit-modal')?.addEventListener('click', e => {
  if (e.target.closest('[data-lib-add-level]')) {
    document.querySelector('#lib-edit-modal [data-lib-levels-list]')?.insertAdjacentHTML('beforeend', _libLevelRowHtml());
  }
  if (e.target.closest('[data-lib-level-remove]')) e.target.closest('.lib-level-row').remove();
});

// «+ Добавить» — категория (для merits/flaws/backgrounds) берётся с активной
// подвкладки; по одному обработчику на каждый подраздел Библиотеки хватает и на
// clans/sects внутри «Сородичей».
function _libWireAddButtons(containerId) {
  document.getElementById(containerId)?.addEventListener('click', e => {
    const addBtn = e.target.closest('[data-lib-add]');
    if (!addBtn) return;
    const kind = addBtn.dataset.libAdd;
    let category = null;
    if (kind === 'merits') category = document.querySelector('.merits-subtab-btn.active')?.dataset.meritCat;
    if (kind === 'flaws') category = document.querySelector('.flaws-subtab-btn.active')?.dataset.flawCat;
    if (kind === 'backgrounds') category = document.querySelector('.backgrounds-subtab-btn.active')?.dataset.bgCat;
    if (kind === 'archetypes') category = 'archetypes'; // фиксированная, форму категории не показываем
    if (kind === 'essences') category = 'essences'; // фиксированная, как у архетипов
    if (kind === 'specializations') category = 'specializations'; // фиксированная, как у архетипов
    if (kind === 'rituals') category = document.querySelector('#lib-rit-traditions .disciplines-subtab-btn.active')?.dataset.ritTradition;
    _libOpenCreateModal(kind, category);
  });
}
for (const _libPage of ['page-lib-about', 'page-lib-kindred', 'page-lib-mortal', 'page-lib-ghouls', 'page-lib-werewolves', 'page-lib-mages', 'page-lib-fairies', 'page-lib-disciplines',
    'page-lib-rituals', 'page-lib-psychics']) _libWireAddButtons(_libPage);
