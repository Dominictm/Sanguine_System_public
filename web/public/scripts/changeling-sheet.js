// ═══════════════════════════════════════════════════════════════════════════
// Лист персонажа подменыша (линейка fairies) — отдельный от V20 лист.
//
// Раскладка — бланк «Changeling: The Dreaming» (3 страницы), термины — книга
// «Подменыши: Греза». Хранится в том же <slug>-sheet.json (schema: 'changeling-1'),
// GET/PUT /api/characters/:slug/sheet-data без новых роутов. Устройство модуля — скилл
// changeling-sheet.
//
// Переиспользуются только презентационные куски V20-листа из v20-sheet.js
// (_v20DotsHtml/_v20BoxesHtml/_v20Get/_v20Set/_v20RebuildDots/_v20RebuildBoxes и CSS
// .v20-*); состояние модуля своё (_chgModel/_chgCtx), V20-глобалы не пишутся.
// ═══════════════════════════════════════════════════════════════════════════

const CHG_SCHEMA = 'changeling-1';
const CHG_MAX = 8;            // кружков у атрибутов / способностей / преимуществ (бланк)
const CHG_MAX_TRAIT = 10;     // Гламур / Воля / Банальность
const CHG_CREATION_CAP = 5;   // выше — предупреждение при создании, но не блокировка

const CHG_ATTRS = {
  physical: ['strength', 'dexterity', 'stamina'],
  social:   ['charisma', 'manipulation', 'appearance'],
  mental:   ['perception', 'intelligence', 'wits'],
};
const CHG_ABILITIES = {
  talents:    ['alertness', 'athletics', 'brawl', 'dodge', 'empathy', 'intimidation', 'kenning', 'persuasion', 'streetwise', 'subterfuge'],
  skills:     ['crafts', 'drive', 'etiquette', 'firearms', 'leadership', 'melee', 'performance', 'security', 'stealth', 'survival'],
  knowledges: ['computer', 'enigmas', 'gremayre', 'investigation', 'law', 'linguistics', 'lore', 'medicine', 'politics', 'science'],
};
const CHG_HEALTH = ['bruised', 'hurt', 'injured', 'wounded', 'mauled', 'crippled', 'incapacitated'];
const CHG_HEALTH_PEN = { bruised: '0', hurt: '−1', injured: '−1', wounded: '−2', mauled: '−2', crippled: '−5', incapacitated: '' };

// Минимум строк свободных списков (как на бланке); добавленные сверх — удаляются «×».
const CHG_BASE = {
  backgrounds: 11, arts: 11, realms: 11, otherTraits: 21, meritsFlaws: 12, bunk: 12,
  birthrights: 5, threshold: 3, 'experience.log': 5, 'combat.weapons': 6, 'combat.armor.notes': 6,
  'combat.animalForm.notes': 2, 'combat.attacks': 4, freeholds: 8,
  'extended.vassals': 6, 'extended.mentor': 6, 'extended.holdings': 6,
  'extended.dreamers': 6, 'extended.contacts': 6, 'extended.retinue': 6,
  'possessions.equipment': 7, 'possessions.chimerical': 7, 'possessions.treasures': 7, 'possessions.companions': 7,
};

// ── Таблица соответствий имён: книга · бланк · старый шаблон md · английский ──
const _CHG_NAMES = [
  ['attr', 'physical', 'strength',     ['Сила', 'Strength']],
  ['attr', 'physical', 'dexterity',    ['Ловкость', 'Dexterity']],
  ['attr', 'physical', 'stamina',      ['Выносливость', 'Stamina']],
  ['attr', 'social',   'charisma',     ['Харизма', 'Обаяние', 'Charisma']],
  ['attr', 'social',   'manipulation', ['Манипулирование', 'Манипуляция', 'Manipulation']],
  ['attr', 'social',   'appearance',   ['Внешность', 'Привлекательность', 'Appearance']],
  ['attr', 'mental',   'perception',   ['Восприятие', 'Perception']],
  ['attr', 'mental',   'intelligence', ['Интеллект', 'Intelligence']],
  ['attr', 'mental',   'wits',         ['Сообразительность', 'Смекалка', 'Wits']],

  ['abil', 'talents', 'alertness',     ['Бдительность', 'Внимательность', 'Alertness']],
  ['abil', 'talents', 'athletics',     ['Атлетизм', 'Атлетика', 'Athletics']],
  ['abil', 'talents', 'brawl',         ['Драка', 'Рукопашный бой', 'Brawl']],
  ['abil', 'talents', 'dodge',         ['Уклонение', 'Dodge']],
  ['abil', 'talents', 'empathy',       ['Эмпатия', 'Empathy']],
  ['abil', 'talents', 'intimidation',  ['Запугивание', 'Intimidation']],
  ['abil', 'talents', 'kenning',       ['Проницательность', 'Кеннинг', 'Kenning']],
  ['abil', 'talents', 'persuasion',    ['Убеждение', 'Persuasion']],
  ['abil', 'talents', 'streetwise',    ['Знание улиц', 'Уличное чутьё', 'Streetwise']],
  ['abil', 'talents', 'subterfuge',    ['Хитрость', 'Subterfuge']],

  ['abil', 'skills', 'crafts',         ['Ремесла', 'Ремесло', 'Crafts']],
  ['abil', 'skills', 'drive',          ['Вождение', 'Drive']],
  ['abil', 'skills', 'etiquette',      ['Этикет', 'Etiquette']],
  ['abil', 'skills', 'firearms',       ['Огнестрельное оружие', 'Стрельба', 'Firearms']],
  ['abil', 'skills', 'leadership',     ['Лидерство', 'Leadership']],
  ['abil', 'skills', 'melee',          ['Фехтование', 'Melee']],
  ['abil', 'skills', 'performance',    ['Актёрство', 'Исполнение', 'Performance']],
  ['abil', 'skills', 'security',       ['Безопасность', 'Security']],
  ['abil', 'skills', 'stealth',        ['Маскировка', 'Скрытность', 'Stealth']],
  ['abil', 'skills', 'survival',       ['Выживание', 'Survival']],

  ['abil', 'knowledges', 'computer',      ['Компьютер', 'Компьютеры', 'Информатика', 'Computer']],
  ['abil', 'knowledges', 'enigmas',       ['Загадки', 'Enigmas']],
  ['abil', 'knowledges', 'gremayre',      ['Гримуары', 'Гримуар', 'Gremayre']],
  ['abil', 'knowledges', 'investigation', ['Расследование', 'Расследования', 'Investigation']],
  ['abil', 'knowledges', 'law',           ['Правоведение', 'Законы', 'Law']],
  ['abil', 'knowledges', 'linguistics',   ['Лингвистика', 'Linguistics']],
  ['abil', 'knowledges', 'lore',          ['Знания', 'Lore']],
  ['abil', 'knowledges', 'medicine',      ['Медицина', 'Medicine']],
  ['abil', 'knowledges', 'politics',      ['Политика', 'Politics']],
  ['abil', 'knowledges', 'science',       ['Наука', 'Научные', 'Естественные науки', 'Science']],
];

// «Атлетика (Athletics)» → «атлетика»; ё→е; лишняя пунктуация и ** убираются.
function _chgNorm(s) {
  return String(s == null ? '' : s).replace(/\*\*/g, '').replace(/\(.*?\)/g, ' ').toLowerCase()
    .replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const _CHG_ALIAS = new Map();
for (const [kind, group, key, names] of _CHG_NAMES) {
  for (const n of names) _CHG_ALIAS.set(_chgNorm(n), { kind, group, key });
}
function _chgAlias(name) { return _CHG_ALIAS.get(_chgNorm(name)) || null; }

// ── Модель ────────────────────────────────────────────────────────────────────
const _chgStr = v => (v == null ? '' : String(v));
const _chgInt = (v, max) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0; };
const _chgRated = () => ({ name: '', val: 0 });
const _chgFlags = (a, n) => Array.from({ length: n }, (_, i) => !!(Array.isArray(a) && a[i]));

function _chgStrList(arr, n) {
  const out = Array.isArray(arr) ? arr.map(_chgStr) : [];
  while (out.length < n) out.push('');
  return out;
}
function _chgRatedList(arr, n) {
  const out = Array.isArray(arr) ? arr.map(x => ({ name: _chgStr(x && x.name), val: _chgInt(x && x.val, CHG_MAX) })) : [];
  while (out.length < n) out.push(_chgRated());
  return out;
}
function _chgPairList(arr, n, keys) {
  const out = Array.isArray(arr) ? arr.map(x => Object.fromEntries(keys.map(k => [k, _chgStr(x && x[k])]))) : [];
  while (out.length < n) out.push(Object.fromEntries(keys.map(k => [k, ''])));
  return out;
}
const _CHG_WEAPON_KEYS = ['weapon', 'diff', 'dmg', 'acc', 'spd', 'clip', 'range', 'conceal'];
const _CHG_HEADER_KEYS = ['name', 'player', 'chronicle', 'court', 'legacy', 'house', 'seeming', 'kith', 'motley', 'nature', 'demeanor'];

function _chgEmpty(headerSeed) {
  const h = {};
  for (const k of _CHG_HEADER_KEYS) h[k] = _chgStr(headerSeed && headerSeed[k]);
  const trait = () => ({ permanent: 1, temp: _chgFlags(null, CHG_MAX_TRAIT) });
  const abil = g => CHG_ABILITIES[g].map(key => ({ key, val: 0 })).concat([_chgRated(), _chgRated()]);
  const health = {};
  for (const k of CHG_HEALTH) health[k] = { r: false, x: false };
  const attrs = {};
  for (const [g, keys] of Object.entries(CHG_ATTRS)) { attrs[g] = {}; for (const k of keys) attrs[g][k] = 1; }
  return {
    lineage: 'fairies', schema: CHG_SCHEMA, header: h, attributes: attrs,
    abilities: { talents: abil('talents'), skills: abil('skills'), knowledges: abil('knowledges') },
    backgrounds: _chgRatedList(null, CHG_BASE.backgrounds),
    arts: _chgRatedList(null, CHG_BASE.arts),
    realms: _chgRatedList(null, CHG_BASE.realms),
    birthrights: _chgStrList(null, CHG_BASE.birthrights),
    threshold: _chgStrList(null, CHG_BASE.threshold),
    glamour: trait(), willpower: trait(), banality: trait(),
    health,
    otherTraits: _chgRatedList(null, CHG_BASE.otherTraits),
    meritsFlaws: _chgStrList(null, CHG_BASE.meritsFlaws),
    bunk: _chgPairList(null, CHG_BASE.bunk, ['desc', 'level']),
    experience: { total: 0, spent: 0, log: _chgStrList(null, CHG_BASE['experience.log']) },
    combat: {
      weapons: _chgPairList(null, CHG_BASE['combat.weapons'], _CHG_WEAPON_KEYS),
      armor: { class: '', rating: '', penalty: '', desc: '', notes: _chgStrList(null, CHG_BASE['combat.armor.notes']) },
      animalForm: { strength: 0, dexterity: 0, stamina: 0, notes: _chgStrList(null, CHG_BASE['combat.animalForm.notes']) },
      attacks: _chgStrList(null, CHG_BASE['combat.attacks']),
    },
    extended: Object.fromEntries(['vassals', 'mentor', 'holdings', 'dreamers', 'contacts', 'retinue']
      .map(k => [k, _chgStrList(null, CHG_BASE['extended.' + k])])),
    possessions: Object.fromEntries(['equipment', 'chimerical', 'treasures', 'companions']
      .map(k => [k, _chgStrList(null, CHG_BASE['possessions.' + k])])),
    freeholds: _chgPairList(null, CHG_BASE.freeholds, ['location', 'desc']),
  };
}

// Любой вход → полная модель. Sidecar без schema (старый V20-формат фей) пересевается
// пустой моделью: переносится только шапка-идентичность, V20-поля не сохраняются.
function _chgNormalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const e = _chgEmpty(src.header);
  if (src.schema !== CHG_SCHEMA) return e;

  for (const [g, keys] of Object.entries(CHG_ATTRS)) {
    for (const k of keys) {
      const v = _chgInt(src.attributes && src.attributes[g] && src.attributes[g][k], CHG_MAX);
      e.attributes[g][k] = Math.max(1, v);
    }
  }
  for (const g of Object.keys(CHG_ABILITIES)) {
    const list = Array.isArray(src.abilities && src.abilities[g]) ? src.abilities[g] : [];
    const byKey = new Map(list.filter(x => x && x.key).map(x => [x.key, x]));
    const fixed = CHG_ABILITIES[g].map(key => ({ key, val: _chgInt(byKey.get(key) && byKey.get(key).val, CHG_MAX) }));
    const custom = list.filter(x => x && !x.key).map(x => ({ name: _chgStr(x.name), val: _chgInt(x.val, CHG_MAX) }));
    while (custom.length < 2) custom.push(_chgRated());
    e.abilities[g] = fixed.concat(custom);
  }
  for (const k of ['backgrounds', 'arts', 'realms']) e[k] = _chgRatedList(src[k], CHG_BASE[k]);
  e.otherTraits = _chgRatedList(src.otherTraits, CHG_BASE.otherTraits);
  e.birthrights = _chgStrList(src.birthrights, CHG_BASE.birthrights);
  e.threshold = _chgStrList(src.threshold, CHG_BASE.threshold);
  e.meritsFlaws = _chgStrList(src.meritsFlaws, CHG_BASE.meritsFlaws);
  e.bunk = _chgPairList(src.bunk, CHG_BASE.bunk, ['desc', 'level']);
  for (const k of ['glamour', 'willpower', 'banality']) {
    const s = src[k] || {};
    e[k] = { permanent: Math.max(0, _chgInt(s.permanent, CHG_MAX_TRAIT)), temp: _chgFlags(s.temp, CHG_MAX_TRAIT) };
  }
  for (const k of CHG_HEALTH) {
    const s = (src.health && src.health[k]) || {};
    e.health[k] = { r: !!s.r, x: !!s.x };
  }
  const xp = src.experience || {};
  e.experience = {
    total: _chgInt(xp.total, 99999), spent: _chgInt(xp.spent, 99999),
    log: _chgStrList(xp.log, CHG_BASE['experience.log']),
  };
  const c = src.combat || {};
  e.combat.weapons = _chgPairList(c.weapons, CHG_BASE['combat.weapons'], _CHG_WEAPON_KEYS);
  const ar = c.armor || {};
  e.combat.armor = {
    class: _chgStr(ar.class), rating: _chgStr(ar.rating), penalty: _chgStr(ar.penalty), desc: _chgStr(ar.desc),
    notes: _chgStrList(ar.notes, CHG_BASE['combat.armor.notes']),
  };
  const af = c.animalForm || {};
  e.combat.animalForm = {
    strength: _chgInt(af.strength, CHG_MAX), dexterity: _chgInt(af.dexterity, CHG_MAX), stamina: _chgInt(af.stamina, CHG_MAX),
    notes: _chgStrList(af.notes, CHG_BASE['combat.animalForm.notes']),
  };
  e.combat.attacks = _chgStrList(c.attacks, CHG_BASE['combat.attacks']);
  for (const k of Object.keys(e.extended)) e.extended[k] = _chgStrList(src.extended && src.extended[k], CHG_BASE['extended.' + k]);
  for (const k of Object.keys(e.possessions)) e.possessions[k] = _chgStrList(src.possessions && src.possessions[k], CHG_BASE['possessions.' + k]);
  e.freeholds = _chgPairList(src.freeholds, CHG_BASE.freeholds, ['location', 'desc']);
  return e;
}

// Поля шапки из карточки персонажа + (если есть) прежняя шапка sidecar'а.
function _chgSeedHeader(card, oldHeader) {
  const h = Object.assign({}, oldHeader || {});
  if (card) {
    if (card.name && !h.name) h.name = card.name;
    if (card.kith && !h.kith) h.kith = card.kith;
    if (card.court && !h.court) h.court = card.court;
    if (card.seeming && !h.seeming) h.seeming = card.seeming;
    if (card.house && !h.house) h.house = card.house;
    if (card.nature && !h.nature) h.nature = card.nature;
    if (card.demeanor && !h.demeanor) h.demeanor = card.demeanor;
  }
  return h;
}

// ── Разбор markdown-листа ИИ (новый формат шаблона и старый) ─────────────────
function _chgFindOrAdd(list, name, val) {
  const empty = list.find(r => !r.key && !r.name && !r.val);   // фиксированные слоты (с key) не занимаем
  if (empty) { empty.name = name; empty.val = val; return; }
  list.push({ name, val });
}

// Название строки «Черты Характера» → ключ модели (имя уже прошло _chgNorm).
const _CHG_TRAIT_NAMES = new Map([
  ['гламур', 'glamour'], ['glamour', 'glamour'],
  ['банальность', 'banality'], ['banality', 'banality'],
  ['воля', 'willpower'], ['сила воли', 'willpower'], ['willpower', 'willpower'],
  ['воля постоянная', 'willpower'], ['постоянная воля', 'willpower'], ['воля постоянный', 'willpower'],
]);

// Рейтинг строки таблицы: «●●●○○», «●●○ 3» или просто «3». Число приоритетнее подсчёта ●.
// Своя функция, а не V20-_parseRatingCells: та режет всё выше 5, а у подменыша до 8 (и 10).
function _chgRatingFromCells(cells) {
  let dots = null, num = null, m;
  for (const c of cells.slice(1)) {
    if (/^[●○]+$/.test(c)) dots = (c.match(/●/g) || []).length;
    else if ((m = c.match(/^[●○]+\s*(\d+)$/))) num = parseInt(m[1], 10);
    else if (/^\d+$/.test(c)) num = parseInt(c, 10);
  }
  return num !== null ? num : dots;
}

function _chgParseMd(md, headerSeed) {
  const m = _chgEmpty(headerSeed);
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let sec = '', sub = '', cm;
  //  в JS — граница только по ASCII-словам, для кириллицы не работает: границу слова
  // задаёт (?: |$) на уже нормализованном имени.
  const HEAD = [
    [/^имя(?: |$)/, 'name'], [/^игрок(?: |$)/, 'player'], [/^хроника(?: |$)/, 'chronicle'],
    [/^(?:двор|легаси)(?: |$)/, 'court'], [/^наследие(?: |$)/, 'legacy'], [/^дом(?: |$)/, 'house'],
    [/^(?:обличье|видимость)(?: |$)/, 'seeming'], [/^(?:кит|род)(?: |$)/, 'kith'], [/^(?:табор|группа)(?: |$)/, 'motley'],
    [/^натура(?: |$)/, 'nature'], [/^маска(?: |$)/, 'demeanor'],
  ];
  const place = (g, name, val) => {
    const a = _chgAlias(name);
    if (a && a.kind === 'attr') { m.attributes[a.group][a.key] = Math.max(1, _chgInt(val, CHG_MAX)); return true; }
    if (a && a.kind === 'abil') { const row = m.abilities[a.group].find(x => x.key === a.key); if (row) row.val = _chgInt(val, CHG_MAX); return true; }
    return false;
  };
  for (const ln of lines) {
    if ((cm = ln.match(/^##\s+(.+)$/)))  { sec = _chgNorm(cm[1]); sub = ''; continue; }
    if ((cm = ln.match(/^###\s+(.+)$/))) { sub = _chgNorm(cm[1]); continue; }
    if (!/^\s*\|/.test(ln) || /\|\s*:?-{3,}/.test(ln)) continue;
    const cells = ln.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 2) continue;
    const rawName = cells[0].replace(/\*\*/g, '').trim();
    const name = _chgNorm(rawName);
    if (!name || /^(поле|характеристика|атрибут|способность|значение|название|искусство|сфера|черта|факт биографии|уровень)$/.test(name)) continue;

    if (/концепц|шапк/.test(sec)) {
      const hit = HEAD.find(([re]) => re.test(name));
      if (hit) { const v = cells[1].replace(/\*\*/g, '').trim(); if (v && v !== '—' && !v.includes('⚠️')) m.header[hit[1]] = v; }
      continue;
    }
    const val = _chgRatingFromCells(cells);
    if (val === null) continue;

    // Черты Характера — только строка с ТОЧНЫМ названием черты (после нормализации «-» тоже
    // пробел, поэтому префикс не годится: искусство «Гламур-щит» затёрло бы Гламур).
    // Лимит у них 10, у прочего 8 (_chgInt). «Воля — временный пул» в карту не входит.
    const traitKey = _CHG_TRAIT_NAMES.get(name) || null;
    if (traitKey) { m[traitKey].permanent = _chgInt(val, CHG_MAX_TRAIT); continue; }

    if (place(sub || sec, rawName, val)) continue;

    const ctx = `${sec} ${sub}`;
    if (/искусств/.test(ctx))                      { _chgFindOrAdd(m.arts, rawName, _chgInt(val, CHG_MAX)); continue; }
    if (/королевств|сфер|реалм|realm/.test(ctx))   { _chgFindOrAdd(m.realms, rawName, _chgInt(val, CHG_MAX)); continue; }
    if (/дополнен|факт|предыстор|background/.test(ctx)) { _chgFindOrAdd(m.backgrounds, rawName, _chgInt(val, CHG_MAX)); continue; }
    for (const [g, re] of [['talents', /талант/], ['skills', /навык/], ['knowledges', /познан|знани/]]) {
      if (re.test(sub) || (!sub && re.test(sec))) { _chgFindOrAdd(m.abilities[g], rawName, _chgInt(val, CHG_MAX)); break; }
    }
  }
  return m;
}

// ── Бросок кубов: списки для панели 🎲 (dice.js) ─────────────────────────────
function _chgDiceLists(m) {
  const attrs = [], abils = [];
  for (const [g, keys] of Object.entries(CHG_ATTRS)) {
    for (const k of keys) { const val = (m.attributes[g] || {})[k] || 0; if (val > 0) attrs.push({ label: t('chg.attr.' + k), val }); }
  }
  for (const g of Object.keys(CHG_ABILITIES)) {
    for (const slot of (m.abilities[g] || [])) {
      const val = slot.val || 0;
      const label = slot.key ? t('chg.ab.' + slot.key) : slot.name;
      if (label && val > 0) abils.push({ label, val });
    }
  }
  return { attrs, abils };
}

// ── Подсказка бюджета создания (не блокирует ввод) ───────────────────────────
function _chgSeemingStart(seeming) {
  const s = _chgNorm(seeming);
  if (/^дит|child/.test(s))                          return { g: 5, w: 1, b: 1 };
  if (/^юнош|^юнец|^вильдер|wilder/.test(s))         return { g: 4, w: 2, b: 3 };
  if (/^старец|^старик|^гранд|grump/.test(s))        return { g: 3, w: 5, b: 5 };
  return null;
}

function _chgBudgetHtml(m) {
  const R = (typeof RULES_V20 !== 'undefined' && RULES_V20.creation && RULES_V20.creation.fairies) || {};
  const attrLim = R.attrs || [7, 5, 3], abLim = R.abilities || [13, 9, 5];
  const bgLim = R.backgrounds || 5, artLim = R.arts || 3, realmLim = R.realms || 5;
  const sum = arr => arr.reduce((s, x) => s + (x.val || 0), 0);
  const attrUsed = Object.values(m.attributes).map(g => Object.values(g).reduce((s, v) => s + Math.max(0, v - 1), 0)).sort((a, b) => b - a);
  const abUsed = Object.values(m.abilities).map(sum).sort((a, b) => b - a);
  const part = (label, used, lim) => `<span class="chg-budget-part${used > lim ? ' chg-over' : ''}">${escHtml(label)} ${used}/${lim}</span>`;
  const tiers = (label, used, lims) => `<span class="chg-budget-part${used.some((u, i) => u > lims[i]) ? ' chg-over' : ''}">${escHtml(label)} ${used.map((u, i) => `${u}/${lims[i]}`).join(' · ')}</span>`;
  const above3 = Object.values(m.abilities).reduce((s, g) => s + g.filter(x => x.val > 3).length, 0);
  const start = _chgSeemingStart(m.header.seeming);
  const parts = [
    tiers(t('chg.band.attrs'), attrUsed, attrLim),
    tiers(t('chg.band.abilities'), abUsed, abLim),
    part(t('chg.col.backgrounds'), sum(m.backgrounds), bgLim),
    part(t('chg.col.arts'), sum(m.arts), artLim),
    part(t('chg.col.realms'), sum(m.realms), realmLim),
  ];
  let extra = '';
  if (above3) extra += `<span class="chg-budget-note">${escHtml(t('chg.budget.above3', { count: above3 }))}</span>`;
  if (start) extra += `<span class="chg-budget-note">${escHtml(t('chg.budget.start', { g: start.g, w: start.w, b: start.b }))}</span>`;
  return `<div class="chg-budget-title">${escHtml(t('chg.budget.title'))}</div><div class="chg-budget-parts">${parts.join('')}${extra}</div>`;
}

// ── Рендер ────────────────────────────────────────────────────────────────────
let _chgModel = null, _chgCtx = null, _chgDirty = false, _chgTab = 'main', _chgRev = 0;

function _chgDots(dpath, val, max) {
  let html = _v20DotsHtml(dpath, val, max);
  if (max === CHG_MAX && val > CHG_CREATION_CAP) html = html.replace('class="v20-dots"', 'class="v20-dots chg-over"');
  return html;
}
// Строка «название — точки» (как _v20DotRow), но с подсветкой значения выше лимита создания.
function _chgDotRow(label, dpath, val, max) {
  return `<div class="v20-row"><span class="v20-row-name">${escHtml(label)}</span>${_chgDots(dpath, val, max)}</div>`;
}
function _chgRm(path, idx, base) {
  return idx >= base
    ? `<button type="button" class="v20-row-remove-btn" data-chg-remove="${escAttr(path)}" data-chg-idx="${idx}" title="${escAttr(t('v20.removeRowTip'))}">×</button>` : '';
}
function _chgAddBtn(path) {
  return `<button type="button" class="v20-mini-action v20-add-row-btn" data-chg-add="${escAttr(path)}" title="${escAttr(t('v20.addRowTip'))}">+</button>`;
}
// Строка «название + точки» из списка [{name,val}] (Дополнения/Искусства/Королевства/Другие Черты).
function _chgRatedRows(path, list) {
  const base = CHG_BASE[path] || 0;
  return list.map((r, i) => `<div class="v20-row v20-named">${_chgRm(path, i, base)}<input class="v20-line-input" data-tpath="${path}.${i}.name" value="${escAttr(r.name)}" placeholder="…">${_chgDots(`${path}.${i}.val`, r.val, CHG_MAX)}</div>`).join('');
}
function _chgTextRows(path, list, ph = '') {
  const base = CHG_BASE[path] || 0;
  return list.map((v, i) => `<div class="v20-pair-row">${_chgRm(path, i, base)}<input class="v20-line-input" data-tpath="${path}.${i}" value="${escAttr(v)}" placeholder="${escAttr(ph)}"></div>`).join('');
}
function _chgTextCol(titleKey, path, list) {
  return `<div class="v20-col"><div class="v20-col-title">${escHtml(t(titleKey))}${_chgAddBtn(path)}</div>${_chgTextRows(path, list)}</div>`;
}
function _chgTraitBlock(key, titleKey, m) {
  return `<div class="v20-col">
    <div class="v20-col-title">${escHtml(t(titleKey))}</div>
    <div class="v20-row"><span class="v20-row-name">${escHtml(t('chg.permanent'))}</span>${_v20DotsHtml(`${key}.permanent`, m[key].permanent, CHG_MAX_TRAIT)}</div>
    <div class="v20-row"><span class="v20-row-name">${escHtml(t('chg.temporary'))}</span>${_v20BoxesHtml(`${key}.temp`, m[key].temp)}</div>
  </div>`;
}

function _chgPageMain(m) {
  const hf = (k, extra = '') => _v20Field(t('chg.h.' + k), 'header.' + k, m.header[k], extra);
  const seemingList = `<datalist id="chg-seeming-list"><option value="${escAttr(t('chg.seeming.childling'))}"><option value="${escAttr(t('chg.seeming.wilder'))}"><option value="${escAttr(t('chg.seeming.grump'))}"></datalist>`;
  const header = `<div class="v20-header">${['name', 'court', 'seeming', 'player', 'legacy', 'kith', 'chronicle', 'house', 'motley']
    .map(k => hf(k, k === 'seeming' ? ' list="chg-seeming-list"' : '')).join('')}${seemingList}</div>`;

  const attrCol = (g, titleKey) => `<div class="v20-col"><div class="v20-col-title">${escHtml(t(titleKey))}</div>${
    CHG_ATTRS[g].map(k => _chgDotRow(t('chg.attr.' + k), `attributes.${g}.${k}`, m.attributes[g][k], CHG_MAX)).join('')}</div>`;
  const abCol = (g, titleKey) => {
    const rows = m.abilities[g].map((r, i) => {
      if (r.key) return _chgDotRow(t('chg.ab.' + r.key), `abilities.${g}.${i}.val`, r.val, CHG_MAX);
      return `<div class="v20-row v20-named"><button type="button" class="v20-row-remove-btn" data-chg-remove="abilities.${g}" data-chg-idx="${i}" title="${escAttr(t('v20.removeRowTip'))}">×</button><input class="v20-line-input" data-tpath="abilities.${g}.${i}.name" value="${escAttr(r.name)}" placeholder="…">${_chgDots(`abilities.${g}.${i}.val`, r.val, CHG_MAX)}</div>`;
    }).join('');
    return `<div class="v20-col"><div class="v20-col-title">${escHtml(t(titleKey))}${_chgAddBtn('abilities.' + g)}</div>${rows}</div>`;
  };
  const advCol = (key, titleKey) => `<div class="v20-col"><div class="v20-col-title">${escHtml(t(titleKey))}${_chgAddBtn(key)}</div>${_chgRatedRows(key, m[key])}</div>`;

  const healthRows = CHG_HEALTH.map(k => {
    const h = m.health[k];
    const lvl = t('chg.hl.' + k);
    const box = (c, on) => `<input type="checkbox" class="v20-box chg-health-box" data-hpath="health.${k}.${c}" aria-label="${escAttr(lvl + ' — ' + t('chg.hl.col' + c.toUpperCase()))}"${on ? ' checked' : ''}>`;
    return `<div class="v20-health-row chg-health-row"><span class="v20-health-name">${escHtml(lvl)}</span><span class="v20-health-pen">${CHG_HEALTH_PEN[k]}</span>${box('r', h.r)}${box('x', h.x)}</div>`;
  }).join('');
  const healthHead = `<div class="v20-health-row chg-health-row chg-health-head"><span class="v20-health-name"></span><span class="v20-health-pen"></span><span class="chg-health-col" title="${escAttr(t('chg.hl.colRTip'))}">${escHtml(t('chg.hl.colR'))}</span><span class="chg-health-col" title="${escAttr(t('chg.hl.colXTip'))}">${escHtml(t('chg.hl.colX'))}</span></div>`;

  return `
    ${header}
    <div class="v20-band">${escHtml(t('chg.band.attrs'))}</div>
    <div class="v20-grid3">${attrCol('physical', 'chg.col.physical')}${attrCol('social', 'chg.col.social')}${attrCol('mental', 'chg.col.mental')}</div>
    <div class="v20-band">${escHtml(t('chg.band.abilities'))}</div>
    <div class="v20-grid3">${abCol('talents', 'chg.col.talents')}${abCol('skills', 'chg.col.skills')}${abCol('knowledges', 'chg.col.knowledges')}</div>
    <div class="v20-band">${escHtml(t('chg.band.advantages'))}</div>
    <div class="v20-grid3">${advCol('backgrounds', 'chg.col.backgrounds')}${advCol('arts', 'chg.col.arts')}${advCol('realms', 'chg.col.realms')}</div>
    <div class="v20-band">${escHtml(t('chg.band.charTraits'))}</div>
    <div class="v20-grid3">
      <div class="v20-col">
        <div class="v20-col-title">${escHtml(t('chg.col.birthrights'))}${_chgAddBtn('birthrights')}</div>${_chgTextRows('birthrights', m.birthrights)}
        <div class="v20-col-title" style="margin-top:12px">${escHtml(t('chg.col.threshold'))}${_chgAddBtn('threshold')}</div>${_chgTextRows('threshold', m.threshold)}
      </div>
      <div class="v20-col">
        ${_chgTraitBlock('glamour', 'chg.glamour', m)}
        ${_chgTraitBlock('willpower', 'chg.willpower', m)}
        ${_chgTraitBlock('banality', 'chg.banality', m)}
      </div>
      <div class="v20-col"><div class="v20-col-title">${escHtml(t('chg.band.health'))}</div><div class="v20-health">${healthHead}${healthRows}</div></div>
    </div>`;
}

function _chgPageTraits(m) {
  const wCols = [['weapon', 'chg.cb.weapon'], ['diff', 'chg.cb.diff'], ['dmg', 'chg.cb.dmg'], ['acc', 'chg.cb.acc'], ['spd', 'chg.cb.spd'], ['clip', 'chg.cb.clip'], ['range', 'chg.cb.range'], ['conceal', 'chg.cb.conceal']];
  const labels = wCols.map(([, k]) => t(k));
  const head = `<div class="v20-combat-row chg-combat-row v20-combat-head">${labels.map(l => `<span>${escHtml(l)}</span>`).join('')}</div>`;
  const rows = m.combat.weapons.map((w, i) => `<div class="v20-combat-row chg-combat-row">${wCols.map(([k], ci) =>
    `<label class="v20-combat-cell" data-label="${escAttr(labels[ci])}"><input class="v20-line-input" data-tpath="combat.weapons.${i}.${k}" value="${escAttr(w[k])}"></label>`).join('')}</div>`).join('');
  const armor = m.combat.armor;
  const af = m.combat.animalForm;
  const bunkRows = m.bunk.map((b, i) => `<div class="v20-pair-row">${_chgRm('bunk', i, CHG_BASE.bunk)}<input class="v20-line-input" data-tpath="bunk.${i}.desc" value="${escAttr(b.desc)}" placeholder="${escAttr(t('chg.bunk.desc'))}"><input class="v20-line-input v20-ritual-lvl" data-tpath="bunk.${i}.level" value="${escAttr(b.level)}" placeholder="${escAttr(t('chg.bunk.level'))}"></div>`).join('');
  const otCols = [0, 1, 2].map(c => `<div class="v20-col">${m.otherTraits.map((r, i) => (i % 3 === c)
    ? `<div class="v20-row v20-named">${_chgRm('otherTraits', i, CHG_BASE.otherTraits)}<input class="v20-line-input" data-tpath="otherTraits.${i}.name" value="${escAttr(r.name)}" placeholder="…">${_chgDots(`otherTraits.${i}.val`, r.val, CHG_MAX)}</div>` : '').join('')}</div>`).join('');
  const xp = m.experience;
  const remain = (xp.total || 0) - (xp.spent || 0);

  return `
    <div class="v20-band">${escHtml(t('chg.band.otherTraits'))}${_chgAddBtn('otherTraits')}</div>
    <div class="v20-grid3">${otCols}</div>
    <div class="v20-grid3">
      <div class="v20-col"><div class="v20-col-title">${escHtml(t('chg.band.meritsFlaws'))}${_chgAddBtn('meritsFlaws')}</div>${_chgTextRows('meritsFlaws', m.meritsFlaws)}</div>
      <div class="v20-col" style="grid-column: span 2"><div class="v20-col-title" title="${escAttr(t('chg.bunk.tip'))}">${escHtml(t('chg.band.bunk'))}${_chgAddBtn('bunk')}</div>${bunkRows}</div>
    </div>
    <div class="v20-band">${escHtml(t('chg.band.xp'))}</div>
    <div class="v20-grid3">
      ${_v20Field(t('chg.xp.total'), 'experience.total', xp.total, ' inputmode="numeric" data-chg-exp')}
      ${_v20Field(t('chg.xp.spent'), 'experience.spent', xp.spent, ' inputmode="numeric" data-chg-exp')}
      <div class="v20-field"><span class="v20-field-lbl">${escHtml(t('chg.xp.remain'))}</span><span class="v20-field-input" id="chg-xp-remain">${remain}</span></div>
    </div>
    <div class="v20-col"><div class="v20-col-title">${escHtml(t('chg.xp.log'))}${_chgAddBtn('experience.log')}</div>${_chgTextRows('experience.log', xp.log)}</div>
    <div class="v20-band">${escHtml(t('chg.band.combat'))}</div>
    <div class="v20-combat">${head}${rows}</div>
    <div class="v20-grid3">
      <div class="v20-col">
        <div class="v20-col-title">${escHtml(t('chg.cb.armor'))}</div>
        ${_v20Field(t('chg.cb.armorClass'), 'combat.armor.class', armor.class)}
        ${_v20Field(t('chg.cb.armorRating'), 'combat.armor.rating', armor.rating)}
        ${_v20Field(t('chg.cb.armorPenalty'), 'combat.armor.penalty', armor.penalty)}
        ${_v20Field(t('chg.cb.armorDesc'), 'combat.armor.desc', armor.desc)}
        ${_chgTextRows('combat.armor.notes', armor.notes)}
      </div>
      <div class="v20-col">
        <div class="v20-col-title">${escHtml(t('chg.cb.animalForm'))}</div>
        ${['strength', 'dexterity', 'stamina'].map(k => _chgDotRow(t('chg.attr.' + k), `combat.animalForm.${k}`, af[k], CHG_MAX)).join('')}
        ${_chgTextRows('combat.animalForm.notes', af.notes)}
      </div>
      <div class="v20-col">
        <div class="v20-col-title">${escHtml(t('chg.cb.attacks'))}${_chgAddBtn('combat.attacks')}</div>
        ${_chgTextRows('combat.attacks', m.combat.attacks)}
      </div>
    </div>`;
}

function _chgPageExtended(m) {
  const ext = ['vassals', 'mentor', 'holdings', 'dreamers', 'contacts', 'retinue'];
  const poss = ['equipment', 'chimerical', 'treasures', 'companions'];
  const fh = m.freeholds.map((f, i) => `<div class="v20-pair-row">${_chgRm('freeholds', i, CHG_BASE.freeholds)}<input class="v20-line-input" data-tpath="freeholds.${i}.location" value="${escAttr(f.location)}" placeholder="${escAttr(t('chg.fh.location'))}"><input class="v20-line-input chg-fh-desc" data-tpath="freeholds.${i}.desc" value="${escAttr(f.desc)}" placeholder="${escAttr(t('chg.fh.desc'))}"></div>`).join('');
  return `
    <div class="v20-band">${escHtml(t('chg.band.extended'))}</div>
    <div class="chg-lists">${ext.map(k => _chgTextCol('chg.ext.' + k, 'extended.' + k, m.extended[k])).join('')}</div>
    <div class="v20-band">${escHtml(t('chg.band.possessions'))}</div>
    <div class="chg-lists">${poss.map(k => _chgTextCol('chg.pos.' + k, 'possessions.' + k, m.possessions[k])).join('')}</div>
    <div class="v20-band">${escHtml(t('chg.band.freeholds'))}${_chgAddBtn('freeholds')}</div>
    <div class="v20-col">${fh}</div>`;
}

function _chgRenderSheet(panel) {
  const m = _chgModel;
  const tabs = [['main', 'chg.tab.main'], ['traits', 'chg.tab.traits'], ['ext', 'chg.tab.ext']];
  const pages = { main: _chgPageMain(m), traits: _chgPageTraits(m), ext: _chgPageExtended(m) };
  panel.innerHTML = `
    <div class="cdet-sheet-toolbar">
      <button class="cdet-sheet-btn primary" id="chg-save" disabled title="${escAttr(t('v20.saveTip'))}">${t('v20.savedSheet')}</button>
      <button class="cdet-sheet-btn" id="chg-regen" title="${escAttr(t('v20.regenTip'))}">${t('v20.regenBtn')}</button>
      <span class="v20-status" id="chg-status"></span>
    </div>
    <div class="chg-budget" id="chg-budget">${_chgBudgetHtml(m)}</div>
    <div class="chg-tabs" role="tablist">${tabs.map(([id, k]) =>
      `<button type="button" class="chg-tab${_chgTab === id ? ' active' : ''}" role="tab" aria-selected="${_chgTab === id}" data-chg-tab="${id}">${escHtml(t(k))}</button>`).join('')}</div>
    <div class="v20-sheet chg-sheet">${tabs.map(([id]) =>
      `<div class="chg-page" role="tabpanel" data-chg-page="${id}"${_chgTab === id ? '' : ' hidden'}>${pages[id]}</div>`).join('')}</div>
    <div class="v20-foot">${escHtml(t('chg.foot'))}</div>`;
  document.getElementById('chg-save').addEventListener('click', _chgSave);
  document.getElementById('chg-regen').addEventListener('click', e => _chgRegen(e.currentTarget));
  _chgBind(panel);
  if (_chgDirty) _chgMarkDirty();
}

// ── Взаимодействие ───────────────────────────────────────────────────────────
function _chgRefresh() {
  const b = document.getElementById('chg-budget');
  if (b) b.innerHTML = _chgBudgetHtml(_chgModel);
}
function _chgMarkDirty() {
  _chgDirty = true;
  _chgRev++;
  const btn = document.getElementById('chg-save'), st = document.getElementById('chg-status');
  if (btn) { btn.disabled = false; btn.textContent = t('v20.btnSaveSheet'); }
  if (st) { st.textContent = t('v20.unsaved'); st.className = 'v20-status dirty'; }
}

function _chgBlankLike(arr) {
  const sample = arr[arr.length - 1];
  if (typeof sample === 'string' || sample === undefined) return '';
  return Object.fromEntries(Object.keys(sample).map(k => [k, typeof sample[k] === 'number' ? 0 : '']));
}
function _chgAddRow(path) {
  const arr = _v20Get(_chgModel, path);
  if (!Array.isArray(arr)) return;
  const row = _chgBlankLike(arr);
  if (path.startsWith('abilities.')) { arr.push({ name: '', val: 0 }); }
  else arr.push(row);
  _chgDirty = true;
  _chgRenderSheet(document.getElementById('cdet-sheet-panel'));
}
function _chgRemoveRow(path, idx) {
  const arr = _v20Get(_chgModel, path);
  if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return;
  arr.splice(idx, 1);
  _chgDirty = true;
  _chgRenderSheet(document.getElementById('cdet-sheet-panel'));
}

function _chgBind(panel) {
  if (panel._chgBound) return;
  panel._chgBound = true;

  const onDot = dot => {
    const span = dot.closest('.v20-dots'); if (!span) return;
    const dpath = span.dataset.dpath, d = +dot.dataset.d;
    const cur = _v20Get(_chgModel, dpath) || 0;
    const min = dpath.startsWith('attributes.') ? 1 : 0;
    const nv = Math.max(min, (cur === d) ? d - 1 : d);
    _v20Set(_chgModel, dpath, nv);
    _v20RebuildDots(span, nv);
    span.classList.toggle('chg-over', +span.dataset.max === CHG_MAX && nv > CHG_CREATION_CAP);
    _chgRefresh();
    _chgMarkDirty();
  };
  const onBox = box => {
    const wrap = box.closest('.v20-boxes'); if (!wrap) return;
    const bpath = box.dataset.bpath, i = +box.dataset.i;
    const arr = _v20Get(_chgModel, bpath) || [];
    const cur = arr.filter(Boolean).length, d = i + 1;
    const nvArr = _chgFlags(null, arr.length).map((_, k) => k < ((cur === d) ? d - 1 : d));
    _v20Set(_chgModel, bpath, nvArr);
    _v20RebuildBoxes(wrap, nvArr);
    _chgMarkDirty();
  };

  panel.addEventListener('click', e => {
    const tab = e.target.closest('[data-chg-tab]');
    if (tab) {
      _chgTab = tab.dataset.chgTab;
      panel.querySelectorAll('[data-chg-tab]').forEach(b => {
        const on = b.dataset.chgTab === _chgTab;
        b.classList.toggle('active', on); b.setAttribute('aria-selected', on);
      });
      panel.querySelectorAll('[data-chg-page]').forEach(p => { p.hidden = p.dataset.chgPage !== _chgTab; });
      return;
    }
    const dot = e.target.closest('.v20-dot'); if (dot) { onDot(dot); return; }
    const box = e.target.closest('.v20-box'); if (box && box.dataset.i !== undefined) { onBox(box); return; }
    const add = e.target.closest('[data-chg-add]'); if (add) { _chgAddRow(add.dataset.chgAdd); return; }
    const rm = e.target.closest('[data-chg-remove]'); if (rm) { _chgRemoveRow(rm.dataset.chgRemove, +rm.dataset.chgIdx); return; }
  });
  panel.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const dot = e.target.closest('.v20-dot');
    if (dot) { e.preventDefault(); onDot(dot); return; }
    const box = e.target.closest('.v20-box');
    if (box && box.dataset.i !== undefined) { e.preventDefault(); onBox(box); }
  });
  panel.addEventListener('change', e => {
    const hb = e.target.closest('[data-hpath]');
    if (hb) { _v20Set(_chgModel, hb.dataset.hpath, hb.checked); _chgMarkDirty(); }
  });
  panel.addEventListener('input', e => {
    const f = e.target.closest('[data-tpath]'); if (!f) return;
    let val = f.value;
    if (f.hasAttribute('data-chg-exp')) {
      val = _chgInt(val, 99999);
      const rem = document.getElementById('chg-xp-remain');
      const xp = _chgModel.experience;
      const total = f.dataset.tpath === 'experience.total' ? val : xp.total;
      const spent = f.dataset.tpath === 'experience.spent' ? val : xp.spent;
      if (rem) rem.textContent = total - spent;
    }
    _v20Set(_chgModel, f.dataset.tpath, val);
    if (f.dataset.tpath === 'header.seeming') _chgRefresh();
    _chgMarkDirty();
  });
}

async function _chgSave() {
  const btn = document.getElementById('chg-save'), st = document.getElementById('chg-status');
  btn.disabled = true; const old = btn.textContent; btn.textContent = t('v20.saving');
  // Снимок модели и номера правки на момент нажатия: пока идёт PUT, пользователь может
  // править дальше — тогда после ответа лист остаётся «не сохранён», а не ложно «сохранён».
  const rev = _chgRev, ctx = _chgCtx, body = JSON.stringify({ data: _chgModel });
  try {
    const r = await fetch(`/api/characters/${encodeURIComponent(ctx.slug)}/sheet-data${location.search}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }
    ).then(r => r.json());
    if (!r.ok) throw new Error(r.error || t('v20.errGeneric'));
    if (_chgCtx !== ctx) return;                 // за время запроса открыли другого персонажа
    if (rev !== _chgRev) { _chgMarkDirty(); return; }
    _chgDirty = false;
    btn.textContent = t('v20.savedSheet'); btn.disabled = true;
    if (st) { st.textContent = t('v20.savedStatus'); st.className = 'v20-status ok'; }
  } catch (e) {
    btn.disabled = false; btn.textContent = old;
    if (st) { st.textContent = '✗ ' + e.message; st.className = 'v20-status err'; }
  }
}

async function _chgRegen(btn) {
  const msg = _chgDirty ? t('v20.regenDirty') : t('v20.regenClean');
  if (!await showConfirm(msg, { danger: _chgDirty, confirmText: t('v20.regenBtnConfirm') })) return;
  // Контекст фиксируется ДО долгого запроса: пока ИИ пишет лист, пользователь может
  // открыть другого персонажа — результат принадлежит тому, для кого запрошен.
  const ctx = _chgCtx;
  const stale = () => _chgCtx !== ctx;
  const old = btn.textContent; btn.disabled = true; btn.textContent = t('v20.regenLoading');
  try {
    const ok = await _generateSheet({ scope: 'character', name: ctx.name, slug: ctx.slug }, null);
    if (!ok) throw new Error(t('v20.genFailed'));
    const q = location.search ? location.search + '&fromMd=1' : '?fromMd=1';
    const d = await fetch(`/api/characters/${encodeURIComponent(ctx.slug)}/sheet-data${q}`).then(r => r.json());
    if (stale()) return;                          // ушли на другого персонажа — лист в файле уже новый, UI не трогаем
    _chgModel = _chgParseMd(d.md || '', _chgSeedHeader(ctx.card, _chgModel && _chgModel.header));
    _chgDirty = true;                             // перегенерированное — несохранённое, пока не сохранят
    _chgRenderSheet(document.getElementById('cdet-sheet-panel'));
    await _chgSave();                             // sidecar обязан совпасть с новым md, иначе при следующем открытии вернётся старый
  } catch (e) {
    showToast(t('v20.errPrefix', { msg: e.message }), 'error');
    if (!stale()) { btn.disabled = false; btn.textContent = old; }
  }
}

// ── Точки входа ──────────────────────────────────────────────────────────────
// Для _loadCharSheet (v20-sheet.js) и dice.js: d — ответ GET sheet-data ({source, data|md, lineage}).
// Модель из ответа sheet-data. Старый V20-sidecar фей (без schema) при наличии ИИ-листа
// (-sheet.md) разбирается из него — одинаково для листа и для панели кубов.
async function _chgResolveModel(charSlug, card, d) {
  if (d && d.source === 'json' && d.data && d.data.schema === CHG_SCHEMA) return _chgNormalize(d.data);
  let md = d && d.source === 'md' ? d.md : '';
  if (d && d.source === 'json') {
    try {
      const q = location.search ? location.search + '&fromMd=1' : '?fromMd=1';
      const r = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/sheet-data${q}`).then(x => x.json());
      if (r && r.source === 'md') md = r.md || '';
    } catch { /* нет md — пустая модель */ }
  }
  const seed = _chgSeedHeader(card, d && d.data && d.data.header);
  return md ? _chgParseMd(md, seed) : _chgNormalize({ header: seed });
}

async function _loadFairySheet(panel, charSlug, card, d) {
  // Клик по вкладке «Лист» вызывает загрузку каждый раз (и _loadCharSheet уже заменил
  // содержимое панели спиннером), а панель живёт, пока открыта карточка: несохранённые
  // правки не затираем перечитыванием с диска — перерисовываем из памяти.
  if (_chgDirty && _chgCtx && _chgCtx.slug === charSlug && _chgModel) {
    _chgRenderSheet(panel);
    return;
  }
  const ctx = { slug: charSlug, name: (card && card.name) || charSlug, card: card || null };
  const model = await _chgResolveModel(charSlug, card, d);
  _chgCtx = ctx;
  _chgModel = model;
  _chgDirty = false;
  _chgTab = 'main';
  // Обработчики вешаются на панель ОДИН раз (она переживает повторные заходы на вкладку);
  // новая карточка = новый элемент панели = свежая привязка.
  _chgRenderSheet(panel);
}
