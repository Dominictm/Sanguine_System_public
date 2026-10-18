// ═══════════════════════════════════════════════════════════════════════════
// Лист персонажа оборотня (линейка werewolves) — отдельный от V20 лист.
//
// Раскладка и термины — бланк «Оборотни: Апокалипсис» (Revised, рус.), последняя
// страница книги; правила создания — гл. 3, стр. 99–101. Хранится в том же
// <slug>-sheet.json (schema: 'werewolf-1'), GET/PUT /api/characters/:slug/sheet-data
// без новых роутов. Устройство модуля — скилл werewolf-sheet, спека
// doc/design/2026-10-11-werewolf-sheet-spec.md.
//
// Справочные данные (племена / покровительства / породы) — _wwRefData(): Библиотека
// (/api/library/werewolf-*), если такие категории есть, поверх встроенных таблиц
// RULES_V20.werewolf. Презентационные куски V20-листа (_v20DotsHtml/_v20BoxesHtml/
// _v20Field/_v20Get/_v20Set/…) и CSS .v20-*/.chg-tab/.chg-budget переиспользуются;
// состояние модуля своё (_wwModel/_wwCtx), V20-глобалы не пишутся.
// ═══════════════════════════════════════════════════════════════════════════

const WW_SCHEMA = 'werewolf-1';
const WW_MAX = 5;             // кружков у атрибутов / способностей / деталей биографии (бланк)
const WW_MAX_TRAIT = 10;      // Ярость / Гнозис / Сила воли / Почёт
const WW_ABIL_CAP = 3;        // способности выше 3 при создании — предупреждение, не блокировка

const WW_ATTRS = {
  physical: ['strength', 'dexterity', 'stamina'],
  social:   ['charisma', 'manipulation', 'appearance'],
  mental:   ['perception', 'intelligence', 'wits'],
};
const WW_ABILITIES = {
  talents:    ['alertness', 'athletics', 'brawl', 'dodge', 'empathy', 'expression', 'intimidation', 'primalUrge', 'streetwise', 'subterfuge'],
  skills:     ['animalKen', 'crafts', 'drive', 'etiquette', 'firearms', 'leadership', 'melee', 'performance', 'stealth', 'survival'],
  knowledges: ['computer', 'enigmas', 'investigation', 'law', 'linguistics', 'medicine', 'occult', 'politics', 'rituals', 'science'],
};
const WW_TRAITS = ['rage', 'gnosis', 'willpower'];
const WW_RENOWN = ['glory', 'honor', 'wisdom'];
const WW_HEALTH = ['bruised', 'hurt', 'injured', 'wounded', 'mauled', 'crippled', 'incapacitated'];
const WW_HEALTH_PEN = { bruised: '0', hurt: '−1', injured: '−1', wounded: '−2', mauled: '−2', crippled: '−5', incapacitated: '' };
// Тип урона в клетке здоровья: клик переключает по кругу.
const WW_DAMAGE = ['', 'bashing', 'lethal', 'aggravated'];
const WW_DAMAGE_MARK = { '': '', bashing: '/', lethal: 'X', aggravated: '✱' };

// Минимум строк свободных списков (как на бланке); добавленные сверх — удаляются «×».
const WW_BASE = { backgrounds: 5, gifts: 10, rites: 5, otherTraits: 10, fetishes: 4, 'experience.log': 4, 'combat.weapons': 5 };

const _WW_HEADER_KEYS = ['name', 'player', 'chronicle', 'breed', 'auspice', 'tribe', 'camp', 'packName', 'packTotem', 'concept'];
const _WW_WEAPON_KEYS = ['weapon', 'roll', 'diff', 'dmg', 'range', 'rate', 'clip'];

// Формы — справочник с бланка (модификаторы атрибутов и сложность), не редактируется.
const WW_FORMS = [
  { key: 'homid',  diff: 6, mods: [] },
  { key: 'glabro', diff: 7, mods: [['strength', '+2'], ['stamina', '+2'], ['appearance', '−1'], ['manipulation', '−2']] },
  { key: 'crinos', diff: 6, mods: [['strength', '+4'], ['dexterity', '+1'], ['stamina', '+3'], ['appearance', '0'], ['manipulation', '−3']], delirium: true },
  { key: 'hispo',  diff: 7, mods: [['strength', '+3'], ['dexterity', '+2'], ['stamina', '+3'], ['manipulation', '−3']], note: 'hispo' },
  { key: 'lupus',  diff: 6, mods: [['strength', '+1'], ['dexterity', '+2'], ['stamina', '+2'], ['manipulation', '−3']], note: 'lupus' },
];
// Таблица драки с бланка: [ключ, сложность, урон]; бросок у всех — Ловкость + Рукопашный бой.
const WW_BRAWL = [['bite', 5, 'str1A'], ['body', 7, 'specialB'], ['claw', 6, 'str1A'], ['grapple', 6, 'strB'], ['kick', 7, 'str1B'], ['punch', 6, 'strB']];

// ── Таблица соответствий имён: бланк · глава книги · старый шаблон md · английский ──
const _WW_NAMES = [
  ['attr', 'physical', 'strength',     ['Сила', 'Strength']],
  ['attr', 'physical', 'dexterity',    ['Ловкость', 'Dexterity']],
  ['attr', 'physical', 'stamina',      ['Выносливость', 'Stamina']],
  ['attr', 'social',   'charisma',     ['Обаяние', 'Харизма', 'Charisma']],
  ['attr', 'social',   'manipulation', ['Манипулирование', 'Манипуляция', 'Manipulation']],
  ['attr', 'social',   'appearance',   ['Внешность', 'Привлекательность', 'Appearance']],
  ['attr', 'mental',   'perception',   ['Восприятие', 'Perception']],
  ['attr', 'mental',   'intelligence', ['Интеллект', 'Intelligence']],
  ['attr', 'mental',   'wits',         ['Сообразительность', 'Смекалка', 'Wits']],

  ['abil', 'talents', 'alertness',     ['Бдительность', 'Внимательность', 'Alertness']],
  ['abil', 'talents', 'athletics',     ['Атлетика', 'Атлетизм', 'Athletics']],
  ['abil', 'talents', 'brawl',         ['Рукопашный бой', 'Драка', 'Brawl']],
  ['abil', 'talents', 'dodge',         ['Уклонение', 'Dodge']],
  ['abil', 'talents', 'empathy',       ['Эмпатия', 'Empathy']],
  ['abil', 'talents', 'expression',    ['Красноречие', 'Экспрессия', 'Expression']],
  ['abil', 'talents', 'intimidation',  ['Запугивание', 'Intimidation']],
  ['abil', 'talents', 'primalUrge',    ['Первобытный инстинкт', 'Первобытный зов', 'Primal-Urge', 'Primal Urge']],
  ['abil', 'talents', 'streetwise',    ['Уличные порядки', 'Знание улиц', 'Уличное чутьё', 'Streetwise']],
  ['abil', 'talents', 'subterfuge',    ['Хитрость', 'Subterfuge']],

  ['abil', 'skills', 'animalKen',      ['Понимание зверей', 'Обращение с животными', 'Animal Ken']],
  ['abil', 'skills', 'crafts',         ['Ремесло', 'Ремесла', 'Ремёсла', 'Crafts']],
  ['abil', 'skills', 'drive',          ['Вождение', 'Drive']],
  ['abil', 'skills', 'etiquette',      ['Этикет', 'Etiquette']],
  ['abil', 'skills', 'firearms',       ['Огнестрельное оружие', 'Стрельба', 'Firearms']],
  ['abil', 'skills', 'leadership',     ['Лидерство', 'Leadership']],
  ['abil', 'skills', 'melee',          ['Холодное оружие', 'Фехтование', 'Melee']],
  ['abil', 'skills', 'performance',    ['Исполнение', 'Актёрство', 'Performance']],
  ['abil', 'skills', 'stealth',        ['Скрытность', 'Маскировка', 'Stealth']],
  ['abil', 'skills', 'survival',       ['Выживание', 'Survival']],

  ['abil', 'knowledges', 'computer',      ['Компьютеры', 'Компьютер', 'Информатика', 'Computer']],
  ['abil', 'knowledges', 'enigmas',       ['Загадки', 'Enigmas']],
  ['abil', 'knowledges', 'investigation', ['Расследование', 'Расследования', 'Investigation']],
  ['abil', 'knowledges', 'law',           ['Закон', 'Законы', 'Право', 'Правоведение', 'Law']],
  ['abil', 'knowledges', 'linguistics',   ['Языки', 'Лингвистика', 'Linguistics']],
  ['abil', 'knowledges', 'medicine',      ['Медицина', 'Medicine']],
  ['abil', 'knowledges', 'occult',        ['Оккультизм', 'Occult']],
  ['abil', 'knowledges', 'politics',      ['Политика', 'Politics']],
  ['abil', 'knowledges', 'rituals',       ['Ритуалы', 'Rituals']],
  ['abil', 'knowledges', 'science',       ['Естественные науки', 'Наука', 'Научные', 'Science']],
];

// «Атлетика (Athletics)» → «атлетика»; ё→е; дефис и прочая пунктуация → пробел.
function _wwNorm(s) {
  return String(s == null ? '' : s).replace(/\*\*/g, '').replace(/\(.*?\)/g, ' ').toLowerCase()
    .replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const _WW_ALIAS = new Map();
for (const [kind, group, key, names] of _WW_NAMES) {
  for (const n of names) _WW_ALIAS.set(_wwNorm(n), { kind, group, key });
}
function _wwAlias(name) { return _WW_ALIAS.get(_wwNorm(name)) || null; }

// Названия черт (уже через _wwNorm) → путь в модели.
const _WW_TRAIT_NAMES = new Map([
  ['ярость', 'rage'], ['rage', 'rage'],
  ['гнозис', 'gnosis'], ['gnosis', 'gnosis'],
  ['сила воли', 'willpower'], ['воля', 'willpower'], ['willpower', 'willpower'],
  ['слава', 'renown.glory'], ['glory', 'renown.glory'],
  ['честь', 'renown.honor'], ['honor', 'renown.honor'],
  ['мудрость', 'renown.wisdom'], ['wisdom', 'renown.wisdom'],
]);

// ── Модель ────────────────────────────────────────────────────────────────────
const _wwStr = v => (v == null ? '' : String(v));
const _wwInt = (v, max) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0; };
const _wwFlags = (a, n) => Array.from({ length: n }, (_, i) => !!(Array.isArray(a) && a[i]));
const _wwRated = () => ({ name: '', val: 0 });
const _wwLeveled = () => ({ name: '', level: '' });

function _wwStrList(arr, n) {
  const out = Array.isArray(arr) ? arr.map(_wwStr) : [];
  while (out.length < n) out.push('');
  return out;
}
function _wwRatedList(arr, n) {
  const out = Array.isArray(arr) ? arr.map(x => ({ name: _wwStr(x && x.name), val: _wwInt(x && x.val, WW_MAX) })) : [];
  while (out.length < n) out.push(_wwRated());
  return out;
}
// Дары/Обряды: уровень — строка (бланк допускает «1», «2 (Галлиард)» и пустое).
function _wwLeveledList(arr, n) {
  const out = Array.isArray(arr) ? arr.map(x => ({ name: _wwStr(x && x.name), level: _wwStr(x && x.level) })) : [];
  while (out.length < n) out.push(_wwLeveled());
  return out;
}
function _wwPairList(arr, n, keys) {
  const out = Array.isArray(arr) ? arr.map(x => Object.fromEntries(keys.map(k => [k, _wwStr(x && x[k])]))) : [];
  while (out.length < n) out.push(Object.fromEntries(keys.map(k => [k, ''])));
  return out;
}

function _wwEmpty(headerSeed) {
  const h = {};
  for (const k of _WW_HEADER_KEYS) h[k] = _wwStr(headerSeed && headerSeed[k]);
  h.rank = headerSeed && headerSeed.rank != null && headerSeed.rank !== '' ? _wwInt(headerSeed.rank, 5) : 1;
  const trait = p => ({ permanent: p, temp: _wwFlags(null, WW_MAX_TRAIT) });
  const abil = g => WW_ABILITIES[g].map(key => ({ key, val: 0 })).concat([_wwRated(), _wwRated()]);
  const health = {};
  for (const k of WW_HEALTH) health[k] = '';
  const attrs = {};
  for (const [g, keys] of Object.entries(WW_ATTRS)) { attrs[g] = {}; for (const k of keys) attrs[g][k] = 1; }
  return {
    lineage: 'werewolves', schema: WW_SCHEMA, header: h, attributes: attrs,
    abilities: { talents: abil('talents'), skills: abil('skills'), knowledges: abil('knowledges') },
    backgrounds: _wwRatedList(null, WW_BASE.backgrounds),
    gifts: _wwLeveledList(null, WW_BASE.gifts),
    rites: _wwLeveledList(null, WW_BASE.rites),
    renown: { glory: trait(0), honor: trait(0), wisdom: trait(0) },
    rage: trait(1), gnosis: trait(1), willpower: trait(3),
    health,
    otherTraits: _wwRatedList(null, WW_BASE.otherTraits),
    battleScars: '', metisDeformity: '',
    experience: { total: 0, spent: 0, log: _wwStrList(null, WW_BASE['experience.log']) },
    fetishes: _wwPairList(null, WW_BASE.fetishes, ['item', 'level', 'gnosis']),
    combat: { weapons: _wwPairList(null, WW_BASE['combat.weapons'], _WW_WEAPON_KEYS), armor: '' },
  };
}

// Любой вход → полная модель. Sidecar без schema (старый V20-формат или сид при создании)
// пересевается пустой моделью: переносится только шапка-идентичность.
function _wwNormalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const e = _wwEmpty(src.header);
  if (src.schema !== WW_SCHEMA) return e;

  for (const [g, keys] of Object.entries(WW_ATTRS)) {
    for (const k of keys) {
      e.attributes[g][k] = Math.max(1, _wwInt(src.attributes && src.attributes[g] && src.attributes[g][k], WW_MAX));
    }
  }
  for (const g of Object.keys(WW_ABILITIES)) {
    const list = Array.isArray(src.abilities && src.abilities[g]) ? src.abilities[g] : [];
    const byKey = new Map(list.filter(x => x && x.key).map(x => [x.key, x]));
    const fixed = WW_ABILITIES[g].map(key => ({ key, val: _wwInt(byKey.get(key) && byKey.get(key).val, WW_MAX) }));
    const custom = list.filter(x => x && !x.key).map(x => ({ name: _wwStr(x.name), val: _wwInt(x.val, WW_MAX) }));
    while (custom.length < 2) custom.push(_wwRated());
    e.abilities[g] = fixed.concat(custom);
  }
  e.backgrounds = _wwRatedList(src.backgrounds, WW_BASE.backgrounds);
  e.otherTraits = _wwRatedList(src.otherTraits, WW_BASE.otherTraits);
  e.gifts = _wwLeveledList(src.gifts, WW_BASE.gifts);
  e.rites = _wwLeveledList(src.rites, WW_BASE.rites);
  for (const k of WW_TRAITS) {
    const s = src[k] || {};
    e[k] = { permanent: _wwInt(s.permanent, WW_MAX_TRAIT), temp: _wwFlags(s.temp, WW_MAX_TRAIT) };
  }
  for (const k of WW_RENOWN) {
    const s = (src.renown && src.renown[k]) || {};
    e.renown[k] = { permanent: _wwInt(s.permanent, WW_MAX_TRAIT), temp: _wwFlags(s.temp, WW_MAX_TRAIT) };
  }
  for (const k of WW_HEALTH) {
    const v = src.health && src.health[k];
    e.health[k] = WW_DAMAGE.includes(v) ? v : '';
  }
  e.battleScars = _wwStr(src.battleScars);
  e.metisDeformity = _wwStr(src.metisDeformity);
  const xp = src.experience || {};
  e.experience = { total: _wwInt(xp.total, 99999), spent: _wwInt(xp.spent, 99999), log: _wwStrList(xp.log, WW_BASE['experience.log']) };
  e.fetishes = _wwPairList(src.fetishes, WW_BASE.fetishes, ['item', 'level', 'gnosis']);
  const c = src.combat || {};
  e.combat = { weapons: _wwPairList(c.weapons, WW_BASE['combat.weapons'], _WW_WEAPON_KEYS), armor: _wwStr(c.armor) };
  return e;
}

// Поля шапки из карточки персонажа + (если есть) прежняя шапка sidecar'а.
function _wwSeedHeader(card, oldHeader) {
  const h = Object.assign({}, oldHeader || {});
  if (card) {
    for (const k of ['name', 'tribe', 'auspice', 'breed']) {
      const v = _wwStr(card[k]).trim();
      if (v && !v.includes('⚠️') && !h[k]) h[k] = v;
    }
  }
  return h;
}

// ── Справочные данные: Библиотека поверх встроенных таблиц ───────────────────
// Записи Библиотеки (контракт — спека вкладки «Оборотни», §7): племя — willpower,
// restrictions, totem, gifts; покровительство — rage, renown, moon, gifts; порода —
// gnosis, gifts. Числа могут прийти строкой. Запись Библиотеки перекрывает встроенную
// с тем же названием (по имени или алиасу), авторские добавляются в конец.
const _WW_REF_KINDS = { tribes: 'werewolf-tribes', auspices: 'werewolf-auspices', breeds: 'werewolf-breeds' };
let _wwRefCache = null, _wwRefPromise = null;

function _wwRefKeys(e) {
  const keys = [e.name, ...(e.aliases || [])];
  const en = String(e.name || '').match(/\(([^)]+)\)/);   // «Дети Гайи (Children of Gaia)»
  if (en) keys.push(en[1]);
  return keys.map(_wwNorm).filter(Boolean);
}
function _wwMergeRef(builtin, lib) {
  const out = (builtin || []).map(e => Object.assign({ source: 'builtin' }, e));
  for (const rec of (Array.isArray(lib) ? lib : [])) {
    if (!rec || !rec.name) continue;
    const entry = Object.assign({}, rec, { name: String(rec.name).replace(/\s*\([^)]*\)\s*$/, '').trim() || rec.name, source: 'library' });
    const keys = _wwRefKeys(rec);
    const i = out.findIndex(e => _wwRefKeys(e).some(k => keys.includes(k)));
    if (i >= 0) {
      const base = Object.assign({}, out[i]);
      // Свой текст ограничений в Библиотеке отменяет встроенные структурные forbid/minimum.
      if (rec.restrictions != null && rec.forbid == null) delete base.forbid;
      if (rec.restrictions != null && rec.minimum == null) delete base.minimum;
      out[i] = Object.assign(base, entry, { aliases: base.aliases });
    }
    else out.push(entry);
  }
  return out;
}
async function _wwFetchLib(kind) {
  try {
    const r = await fetch(`/api/library/${kind}`);
    if (r && r.ok === false) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
async function _wwRefData(force) {
  if (_wwRefCache && !force) return _wwRefCache;
  if (_wwRefPromise && !force) return _wwRefPromise;
  const B = (typeof RULES_V20 !== 'undefined' && RULES_V20.werewolf) || {};
  _wwRefPromise = (async () => {
    const [tribes, auspices, breeds] = await Promise.all(Object.values(_WW_REF_KINDS).map(_wwFetchLib));
    _wwRefCache = {
      tribes: _wwMergeRef(B.tribes, tribes),
      auspices: _wwMergeRef(B.auspices, auspices),
      breeds: _wwMergeRef(B.breeds, breeds),
    };
    _wwRefPromise = null;
    return _wwRefCache;
  })();
  return _wwRefPromise;
}
function _wwRefSync() {
  if (_wwRefCache) return _wwRefCache;
  const B = (typeof RULES_V20 !== 'undefined' && RULES_V20.werewolf) || {};
  return { tribes: _wwMergeRef(B.tribes, []), auspices: _wwMergeRef(B.auspices, []), breeds: _wwMergeRef(B.breeds, []) };
}
// Поиск по точному имени/алиасу, затем по вхождению целыми словами («Гару Дети Гайи» → «Дети Гайи»,
// но «Карун» ≠ «Арун»).
function _wwFindRef(list, name) {
  const n = _wwNorm(name);
  if (!n) return null;
  return (list || []).find(e => _wwRefKeys(e).includes(n))
      || (list || []).find(e => _wwRefKeys(e).some(k => ` ${n} `.includes(` ${k} `)))
      || null;
}
const _wwNum = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

// «Слава 2, Мудрость 1» → { glory: 2, wisdom: 1 }; текст без чисел шкал → null.
function _wwParseRenown(text) {
  const out = {};
  const s = _wwNorm(text);
  for (const [re, k] of [[/(?:слава|glory) (\d+)/, 'glory'], [/(?:честь|honor) (\d+)/, 'honor'], [/(?:мудрость|wisdom) (\d+)/, 'wisdom']]) {
    const m = s.match(re);
    if (m) out[k] = _wwInt(m[1], WW_MAX_TRAIT);
  }
  return Object.keys(out).length ? out : null;
}
const _wwGiftNames = text => String(text || '').split(/[,;]/).map(x => x.trim()).filter(Boolean);

// Стартовые значения по шапке: { rage, gnosis, willpower, renown(text), renownSet, gifts[], unknown[] }.
function _wwStartValues(header, ref) {
  const R = ref || _wwRefSync();
  const a = _wwFindRef(R.auspices, header.auspice);
  const b = _wwFindRef(R.breeds, header.breed);
  const tr = _wwFindRef(R.tribes, header.tribe);
  const unknown = [];
  if (header.auspice && !a) unknown.push('auspice');
  if (header.breed && !b) unknown.push('breed');
  if (header.tribe && !tr) unknown.push('tribe');
  return {
    auspice: a, breed: b, tribe: tr, unknown,
    rage: a ? _wwNum(a.rage) : null,
    gnosis: b ? _wwNum(b.gnosis) : null,
    willpower: tr ? _wwNum(tr.willpower) : null,
    renown: a && a.renown ? String(a.renown) : '',
    renownSet: a ? _wwParseRenown(a.renown) : null,
    gifts: [b, a, tr].filter(Boolean).flatMap(e => _wwGiftNames(e.gifts)),
  };
}

// Нарушения ограничений племени по деталям биографии: [{name, kind:'forbid'|'minimum', need}].
// Встроенные записи несут forbid/minimum; у записи Библиотеки — только текст restrictions,
// из него берутся названия после «нельзя:».
function _wwTribeViolations(m, tribe) {
  if (!tribe) return [];
  let forbid = Array.isArray(tribe.forbid) ? tribe.forbid : null;
  if (!forbid) {
    const mt = String(tribe.restrictions || '').match(/нельзя:\s*([^;]+)/i);
    forbid = mt ? mt[1].split(',').map(x => x.trim()).filter(Boolean) : [];
  }
  const out = [];
  const bgs = m.backgrounds.filter(r => r.name && r.val > 0);
  for (const f of forbid) {
    const fn = _wwNorm(f);
    if (fn && bgs.some(r => _wwNorm(r.name).includes(fn))) out.push({ name: f, kind: 'forbid' });
  }
  for (const [name, need] of Object.entries(tribe.minimum || {})) {
    const row = bgs.find(r => _wwNorm(r.name).includes(_wwNorm(name)));
    if (!row || row.val < need) out.push({ name, kind: 'minimum', need });
  }
  return out;
}

// ── Разбор markdown-листа ИИ (новый шаблон и старый) ─────────────────────────
function _wwFindOrAdd(list, name, val) {
  const empty = list.find(r => !r.key && !r.name && !r.val);   // фиксированные слоты (с key) не занимаем
  if (empty) { empty.name = name; empty.val = val; return; }
  list.push({ name, val });
}
function _wwAddLeveled(list, name, level) {
  const empty = list.find(r => !r.name && !r.level);
  if (empty) { empty.name = name; empty.level = level; return; }
  list.push({ name, level });
}
// Рейтинг строки таблицы: «●●●○○», «●●○ 3» или просто «3». Число приоритетнее подсчёта ●.
function _wwRatingFromCells(cells) {
  let dots = null, num = null, m;
  for (const c of cells.slice(1)) {
    if (/^[●○]+$/.test(c)) dots = (c.match(/●/g) || []).length;
    else if ((m = c.match(/^[●○]+\s*(\d+)$/))) num = parseInt(m[1], 10);
    else if (/^\d+$/.test(c)) num = parseInt(c, 10);
  }
  return num !== null ? num : dots;
}
const _wwCell = c => { const v = String(c || '').replace(/\*\*/g, '').trim(); return (!v || v === '—' || v === '-' || v.includes('⚠️')) ? '' : v; };

function _wwParseMd(md, headerSeed) {
  const m = _wwEmpty(headerSeed);
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let sec = '', sub = '', cm;
  //  в JS — граница только по ASCII-словам: границу задаёт (?: |$) на нормализованном имени.
  const HEAD = [
    [/^имя стаи(?: |$)|^стая(?: |$)/, 'packName'], [/^тотем(?: стаи)?(?: |$)/, 'packTotem'],
    [/^имя(?: |$)/, 'name'], [/^игрок(?: |$)/, 'player'], [/^хроника(?: |$)/, 'chronicle'],
    [/^порода(?: |$)/, 'breed'], [/^(?:покровительство|каста|auspice)(?: |$)/, 'auspice'],
    [/^племя(?: |$)/, 'tribe'], [/^лагерь(?: |$)/, 'camp'],
    [/^(?:концепт|концепция|амплуа)(?: |$)/, 'concept'], [/^ранг(?: |$)/, 'rank'],
  ];
  for (const ln of lines) {
    if ((cm = ln.match(/^##\s+(.+)$/)))  { sec = _wwNorm(cm[1]); sub = ''; continue; }
    if ((cm = ln.match(/^###\s+(.+)$/))) { sub = _wwNorm(cm[1]); continue; }
    if (!/^\s*\|/.test(ln) || /\|\s*:?-{3,}/.test(ln)) continue;
    const cells = ln.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 2) continue;
    const rawName = cells[0].replace(/\*\*/g, '').trim();
    const name = _wwNorm(rawName);
    if (!name || /^(поле|характеристика|атрибут|способность|значение|название|черта|деталь биографии|уровень|дар|обряд|фетиш|предмет|оружие|маневр оружие)$/.test(name)) continue;
    const ctx = `${sec} ${sub}`;

    if (/концепц|шапк/.test(sec)) {
      const hit = HEAD.find(([re]) => re.test(name));
      const v = _wwCell(cells[1]);
      if (hit && v) m.header[hit[1]] = hit[1] === 'rank' ? _wwInt(v.match(/\d+/) ? v.match(/\d+/)[0] : 1, 5) : v;
      continue;
    }
    if (/шрам|уродств/.test(sec)) {
      const v = _wwCell(cells[1]);
      if (/шрам/.test(name)) m.battleScars = v;
      else if (/уродств/.test(name)) m.metisDeformity = v;
      continue;
    }
    if (/фетиш/.test(ctx)) {
      const lvl = _wwCell(cells[1]), gn = _wwCell(cells[2]);
      const empty = m.fetishes.find(f => !f.item);
      const row = { item: rawName, level: lvl, gnosis: gn };
      if (empty) Object.assign(empty, row); else m.fetishes.push(row);
      continue;
    }
    if (/^дар|дары|gift/.test(sub) || (!sub && /^дар|дары/.test(sec))) { _wwAddLeveled(m.gifts, rawName, _wwCell(cells[1])); continue; }
    if (/^обряд|rite/.test(sub) || (!sub && /^обряд/.test(sec))) { _wwAddLeveled(m.rites, rawName, _wwCell(cells[1])); continue; }
    if (/опыт|experience/.test(sec)) {
      const n = _wwRatingFromCells(cells);
      if (n === null) continue;
      if (/^(всего|полный|total)/.test(name)) m.experience.total = _wwInt(n, 99999);
      else if (/^(потрачено|spent)/.test(name)) m.experience.spent = _wwInt(n, 99999);
      continue;
    }
    const val = _wwRatingFromCells(cells);
    if (val === null) continue;

    // Черты и Почёт — только строка с ТОЧНЫМ названием (префикс не годится: Дар «Ярость
    // Фенрира» затёр бы Ярость). У них лимит 10.
    const tr = _WW_TRAIT_NAMES.get(name);
    if (tr) { _v20Set(m, `${tr}.permanent`, _wwInt(val, WW_MAX_TRAIT)); continue; }

    if (/детал|биограф|факт|предыстор|background/.test(ctx)) { _wwFindOrAdd(m.backgrounds, rawName, _wwInt(val, WW_MAX)); continue; }
    if (/друг.* черт|other/.test(ctx)) { _wwFindOrAdd(m.otherTraits, rawName, _wwInt(val, WW_MAX)); continue; }

    const a = _wwAlias(rawName);
    if (a && a.kind === 'attr') { m.attributes[a.group][a.key] = Math.max(1, _wwInt(val, WW_MAX)); continue; }
    if (a && a.kind === 'abil') { const row = m.abilities[a.group].find(x => x.key === a.key); if (row) row.val = _wwInt(val, WW_MAX); continue; }

    let placed = false;
    for (const [g, re] of [['talents', /талант/], ['skills', /навык|умени/], ['knowledges', /познан|знани/]]) {
      if (re.test(sub) || (!sub && re.test(sec))) { _wwFindOrAdd(m.abilities[g], rawName, _wwInt(val, WW_MAX)); placed = true; break; }
    }
    // Способности старого шаблона без аналога (Гуманитарные науки, Воровство…) — в Другие черты.
    if (!placed && /способност/.test(ctx)) _wwFindOrAdd(m.otherTraits, rawName, _wwInt(val, WW_MAX));
  }
  return m;
}

// ── Бросок кубов: списки для панели 🎲 (dice.js) ─────────────────────────────
function _wwDiceLists(m) {
  const attrs = [], abils = [];
  for (const [g, keys] of Object.entries(WW_ATTRS)) {
    for (const k of keys) { const val = (m.attributes[g] || {})[k] || 0; if (val > 0) attrs.push({ label: t('ww.attr.' + k), val }); }
  }
  for (const g of Object.keys(WW_ABILITIES)) {
    for (const slot of (m.abilities[g] || [])) {
      const val = slot.val || 0;
      const label = slot.key ? t('ww.ab.' + slot.key) : slot.name;
      if (label && val > 0) abils.push({ label, val });
    }
  }
  return { attrs, abils };
}
// Самостоятельные пулы (вместо добродетелей V20): Ярость, Гнозис, Сила воли — постоянные.
function _wwDiceTraits(m) {
  return WW_TRAITS.map(k => [t('ww.' + k), (m[k] || {}).permanent || 0]);
}

// ── Подсказка бюджета создания (не блокирует ввод) ───────────────────────────
function _wwBudgetHtml(m) {
  const R = (typeof RULES_V20 !== 'undefined' && RULES_V20.creation && RULES_V20.creation.werewolves) || {};
  const attrLim = R.attrs || [7, 5, 3], abLim = R.abilities || [13, 9, 5];
  const bgLim = R.backgrounds || 5, giftLim = R.gifts || 3, freebies = R.freebies || 15;
  const sum = arr => arr.reduce((s, x) => s + (x.val || 0), 0);
  const attrUsed = Object.values(m.attributes).map(g => Object.values(g).reduce((s, v) => s + Math.max(0, v - 1), 0)).sort((a, b) => b - a);
  const abUsed = Object.values(m.abilities).map(sum).sort((a, b) => b - a);
  const gifts = m.gifts.filter(g => g.name.trim()).length;
  const part = (label, used, lim) => `<span class="chg-budget-part${used > lim ? ' chg-over' : ''}">${escHtml(label)} ${used}/${lim}</span>`;
  const tiers = (label, used, lims) => `<span class="chg-budget-part${used.some((u, i) => u > lims[i]) ? ' chg-over' : ''}">${escHtml(label)} ${used.map((u, i) => `${u}/${lims[i]}`).join(' · ')}</span>`;
  const above = Object.values(m.abilities).reduce((s, g) => s + g.filter(x => x.val > WW_ABIL_CAP).length, 0);
  const parts = [
    tiers(t('ww.band.attrs'), attrUsed, attrLim),
    tiers(t('ww.band.abilities'), abUsed, abLim),
    part(t('ww.col.backgrounds'), sum(m.backgrounds), bgLim),
    part(t('ww.col.gifts'), gifts, giftLim),
    `<span class="chg-budget-part">${escHtml(t('ww.budget.freebies', { n: freebies }))}</span>`,
  ];
  const sv = _wwStartValues(m.header);
  const notes = [];
  if (above) notes.push(t('ww.budget.above3', { count: above }));
  const start = [];
  if (sv.rage != null) start.push(t('ww.budget.rage', { n: sv.rage, from: sv.auspice.name }));
  if (sv.gnosis != null) start.push(t('ww.budget.gnosis', { n: sv.gnosis, from: sv.breed.name }));
  if (sv.willpower != null) start.push(t('ww.budget.willpower', { n: sv.willpower, from: sv.tribe.name }));
  if (sv.renown) start.push(t('ww.budget.renown', { text: sv.renown }));
  if (start.length) notes.push(t('ww.budget.start') + ' ' + start.join(' · '));
  for (const k of sv.unknown) notes.push(t('ww.budget.unknown.' + k));
  if (sv.tribe && sv.tribe.restrictions) notes.push(t('ww.budget.restrictions', { text: sv.tribe.restrictions }));
  const warn = _wwTribeViolations(m, sv.tribe).map(v => v.kind === 'forbid'
    ? t('ww.budget.forbidden', { name: v.name }) : t('ww.budget.minimum', { name: v.name, n: v.need }));
  const canApply = sv.rage != null || sv.gnosis != null || sv.willpower != null || sv.gifts.length;
  return `<div class="chg-budget-title">${escHtml(t('ww.budget.title'))}</div>
    <div class="chg-budget-parts">${parts.join('')}</div>
    ${notes.length ? `<div class="chg-budget-parts">${notes.map(n => `<span class="chg-budget-note">${escHtml(n)}</span>`).join('')}</div>` : ''}
    ${warn.length ? `<div class="chg-budget-parts">${warn.map(n => `<span class="chg-budget-part chg-over">${escHtml(n)}</span>`).join('')}</div>` : ''}
    ${canApply ? `<button type="button" class="cdet-sheet-btn ww-apply-btn" data-ww-apply title="${escAttr(t('ww.apply.tip'))}">${escHtml(t('ww.apply.btn'))}</button>` : ''}`;
}

// «Применить стартовые значения»: Ярость/Гнозис/Сила воли/Почёт перезаписываются, Ранг 0 → 1,
// начальные Дары добавляются в пустые строки, если таких названий ещё нет. Возвращает число правок.
function _wwApplyStart(m, ref) {
  const sv = _wwStartValues(m.header, ref);
  let n = 0;
  const set = (k, v) => { if (v != null && m[k].permanent !== v) { m[k].permanent = _wwInt(v, WW_MAX_TRAIT); n++; } };
  set('rage', sv.rage); set('gnosis', sv.gnosis); set('willpower', sv.willpower);
  if (sv.renownSet) {
    for (const k of WW_RENOWN) {
      const v = sv.renownSet[k] || 0;
      if (m.renown[k].permanent !== v) { m.renown[k].permanent = v; n++; }
    }
  }
  if (!m.header.rank) { m.header.rank = 1; n++; }
  const have = new Set(m.gifts.map(g => _wwNorm(g.name)).filter(Boolean));
  for (const g of sv.gifts) {
    if (have.has(_wwNorm(g))) continue;
    _wwAddLeveled(m.gifts, g, '1'); have.add(_wwNorm(g)); n++;
  }
  return n;
}

// ── Пикер Даров из справочника (2026-10-13,
// спека doc/specs/werewolf-mage-library-expansion/spec.md §2.3): кнопка
// «+ Из справочника» у строк Даров, фильтр по группе с preselect
// (порода/покровительство/племя персонажа) + «все». Образец — пикер
// ритуалов V20 (_v20ToggleLibPicker/_v20RenderV20LibList).
let _wwGiftCache = null;
async function _wwLoadGifts() {
  if (_wwGiftCache) return _wwGiftCache;
  try {
    const data = await fetch('/api/library/werewolf-gifts').then(r => r.json());
    _wwGiftCache = Array.isArray(data) ? data : [];
  } catch { _wwGiftCache = []; }
  return _wwGiftCache;
}
function _wwGiftLibBtn() {
  return `<button type="button" class="v20-mini-action v20-lib-add-btn" data-ww-gift-lib title="${escAttr(t('ww.libGiftTip'))}">+ ${escHtml(t('v20.addFromLibBtn'))}</button>`;
}
function _wwGiftLibBlock() {
  return `<div class="v20-lib-picker" data-ww-gift-picker hidden>
      <input type="text" class="v20-lib-search" placeholder="${escAttr(t('v20.sheetSearchPh'))}" aria-label="${escAttr(t('v20.sheetSearchPh'))}" data-ww-gift-search>
      <select class="chr-form-input" aria-label="${escAttr(t('lin.ww.giftGroup'))}" data-ww-gift-group></select>
      <div class="v20-lib-list" data-ww-gift-list></div>
    </div>`;
}
// Группы персонажа для preselect фильтра: порода, покровительство, племя.
function _wwGiftOwnGroups() {
  const h = (_wwModel && _wwModel.header) || {};
  return [h.breed, h.auspice, h.tribe].map(x => String(x || '').trim()).filter(Boolean);
}
// Группа записи — строка или список через запятую (слитые дубли).
function _wwGiftGroupsOf(x) {
  return String(x && x.group || '').split(',').map(s => s.trim()).filter(Boolean);
}
function _wwGiftGroupOptions(lib) {
  const groups = [...new Set((lib || []).flatMap(_wwGiftGroupsOf))].sort((a, b) => a.localeCompare(b, 'ru'));
  return ['', ...groups];
}
function _wwRenderGiftList(lib, picker) {
  const listEl = picker.querySelector('[data-ww-gift-list]');
  const sel = picker.querySelector('[data-ww-gift-group]');
  const q = (picker.querySelector('[data-ww-gift-search]')?.value || '').trim().toLowerCase();
  const g = sel?.value || '';
  if (!listEl) return;
  const items = (lib || []).filter(x => {
    if (g && !_wwGiftGroupsOf(x).includes(g)) return false;
    if (q && !(String(x.name || '').toLowerCase().includes(q))) return false;
    return true;
  });
  listEl.innerHTML = items.map(x => {
    const nm = _linDisplayName ? _linDisplayName(x.name) : x.name;
    const hint = [x.level != null ? t('lin.ww.badgeLevel', { n: x.level }) : '', _wwGiftGroupsOf(x).join(', ') || ''].filter(Boolean).join(' · ');
    return `<button type="button" class="v20-lib-item" data-ww-gift-item="${escAttr(x.name)}"><span>${escHtml(nm)}</span><span class="v20-lib-hint">${escHtml(hint)}</span></button>`;
  }).join('') || `<div class="cdet-empty">${escHtml(t('lin.empty'))}</div>`;
}
async function _wwToggleGiftPicker() {
  const panel = document.getElementById('cdet-sheet-panel');
  if (!panel) return;
  const picker = panel.querySelector('[data-ww-gift-picker]');
  if (!picker) return;
  if (picker.hidden) {
    const lib = await _wwLoadGifts();
    if (!lib.length) return; // пустой справочник → кнопки нет смысла показывать список
    picker.hidden = false;
    const sel = picker.querySelector('[data-ww-gift-group]');
    const opts = _wwGiftGroupOptions(lib);
    const own = _wwGiftOwnGroups();
    const pre = opts.find(o => o && own.some(x => x.toLowerCase().includes(o.toLowerCase()) || o.toLowerCase().includes(x.toLowerCase()))) || '';
    sel.innerHTML = opts.map(o => `<option value="${escAttr(o)}"${o === pre ? ' selected' : ''}>${escHtml(o || t('v20.ritAllTraditions'))}</option>`).join('');
    _wwRenderGiftList(lib, picker);
  } else picker.hidden = true;
}
function _wwAddGift(name) {
  const found = (_wwGiftCache || []).find(x => (x.name || '') === name);
  const level = found?.level != null ? String(found.level) : '';
  const m = _wwModel;
  if (!m) return;
  const empty = m.gifts.find(r => !String(r?.name || '').trim());
  if (empty) { empty.name = name; empty.level = level; }
  else m.gifts.push({ name, level });
  _wwRerender();
}

// ── Рендер ────────────────────────────────────────────────────────────────────
let _wwModel = null, _wwCtx = null, _wwDirty = false, _wwTab = 'main', _wwRev = 0;

function _wwDots(dpath, val, max, warnAbove) {
  let html = _v20DotsHtml(dpath, val, max);
  if (warnAbove && val > warnAbove) html = html.replace('class="v20-dots"', 'class="v20-dots chg-over"');
  return html;
}
function _wwDotRow(label, dpath, val, max, warnAbove) {
  return `<div class="v20-row"><span class="v20-row-name">${escHtml(label)}</span>${_wwDots(dpath, val, max, warnAbove)}</div>`;
}
function _wwRm(path, idx, base) {
  return idx >= base
    ? `<button type="button" class="v20-row-remove-btn" data-ww-remove="${escAttr(path)}" data-ww-idx="${idx}" title="${escAttr(t('v20.removeRowTip'))}">×</button>` : '';
}
function _wwAddBtn(path) {
  return `<button type="button" class="v20-mini-action v20-add-row-btn" data-ww-add="${escAttr(path)}" title="${escAttr(t('v20.addRowTip'))}">+</button>`;
}
function _wwRatedRows(path, list) {
  const base = WW_BASE[path] || 0;
  return list.map((r, i) => `<div class="v20-row v20-named">${_wwRm(path, i, base)}<input class="v20-line-input" data-tpath="${path}.${i}.name" value="${escAttr(r.name)}" placeholder="…" aria-label="${escAttr(t('ww.ph.name'))}">${_wwDots(`${path}.${i}.val`, r.val, WW_MAX)}</div>`).join('');
}
function _wwLeveledRows(path, list) {
  const base = WW_BASE[path] || 0;
  return list.map((r, i) => `<div class="v20-pair-row">${_wwRm(path, i, base)}<input class="v20-line-input" data-tpath="${path}.${i}.name" value="${escAttr(r.name)}" placeholder="…" aria-label="${escAttr(t('ww.ph.name'))}"><input class="v20-line-input v20-ritual-lvl" data-tpath="${path}.${i}.level" value="${escAttr(r.level)}" placeholder="${escAttr(t('ww.ph.level'))}" aria-label="${escAttr(t('ww.ph.level'))}"></div>`).join('');
}
function _wwTextRows(path, list, labelKey) {
  const base = WW_BASE[path] || 0;
  const aria = labelKey ? ` aria-label="${escAttr(t(labelKey))}"` : '';
  return list.map((v, i) => `<div class="v20-pair-row">${_wwRm(path, i, base)}<input class="v20-line-input" data-tpath="${path}.${i}" value="${escAttr(v)}"${aria}></div>`).join('');
}
function _wwTraitBlock(path, titleKey, tr) {
  return `<div class="v20-col">
    <div class="v20-col-title">${escHtml(t(titleKey))}</div>
    <div class="v20-row"><span class="v20-row-name">${escHtml(t('ww.permanent'))}</span>${_v20DotsHtml(`${path}.permanent`, tr.permanent, WW_MAX_TRAIT)}</div>
    <div class="v20-row"><span class="v20-row-name">${escHtml(t('ww.temporary'))}</span>${_v20BoxesHtml(`${path}.temp`, tr.temp)}</div>
  </div>`;
}
function _wwDatalist(id, list) {
  return `<datalist id="${id}">${(list || []).map(e => `<option value="${escAttr(e.name)}">`).join('')}</datalist>`;
}

function _wwPageMain(m) {
  const ref = _wwRefSync();
  const lists = { breed: 'ww-breed-list', auspice: 'ww-auspice-list', tribe: 'ww-tribe-list' };
  const hf = k => _v20Field(t('ww.h.' + k), 'header.' + k, m.header[k], lists[k] ? ` list="${lists[k]}" data-ww-ref` : '');
  const header = `<div class="v20-header">${['name', 'breed', 'packName', 'player', 'auspice', 'packTotem', 'chronicle', 'tribe', 'concept'].map(hf).join('')}
    ${hf('camp')}
    ${_v20Field(t('ww.h.rank'), 'header.rank', String(m.header.rank), ' inputmode="numeric" data-ww-int="5"')}
    ${_wwDatalist(lists.breed, ref.breeds)}${_wwDatalist(lists.auspice, ref.auspices)}${_wwDatalist(lists.tribe, ref.tribes)}</div>`;

  const attrCol = (g, titleKey) => `<div class="v20-col"><div class="v20-col-title">${escHtml(t(titleKey))}</div>${
    WW_ATTRS[g].map(k => _wwDotRow(t('ww.attr.' + k), `attributes.${g}.${k}`, m.attributes[g][k], WW_MAX)).join('')}</div>`;
  const abCol = (g, titleKey) => {
    const rows = m.abilities[g].map((r, i) => {
      if (r.key) return _wwDotRow(t('ww.ab.' + r.key), `abilities.${g}.${i}.val`, r.val, WW_MAX, WW_ABIL_CAP);
      return `<div class="v20-row v20-named"><button type="button" class="v20-row-remove-btn" data-ww-remove="abilities.${g}" data-ww-idx="${i}" title="${escAttr(t('v20.removeRowTip'))}">×</button><input class="v20-line-input" data-tpath="abilities.${g}.${i}.name" value="${escAttr(r.name)}" placeholder="…" aria-label="${escAttr(t('ww.ph.name'))}">${_wwDots(`abilities.${g}.${i}.val`, r.val, WW_MAX, WW_ABIL_CAP)}</div>`;
    }).join('');
    return `<div class="v20-col"><div class="v20-col-title">${escHtml(t(titleKey))}${_wwAddBtn('abilities.' + g)}</div>${rows}</div>`;
  };

  return `
    ${header}
    <div class="v20-band">${escHtml(t('ww.band.attrs'))}</div>
    <div class="v20-grid3">${attrCol('physical', 'ww.col.physical')}${attrCol('social', 'ww.col.social')}${attrCol('mental', 'ww.col.mental')}</div>
    <div class="v20-band">${escHtml(t('ww.band.abilities'))}</div>
    <div class="v20-grid3">${abCol('talents', 'ww.col.talents')}${abCol('skills', 'ww.col.skills')}${abCol('knowledges', 'ww.col.knowledges')}</div>
    <div class="v20-band">${escHtml(t('ww.band.advantages'))}</div>
    <div class="v20-grid3">
      <div class="v20-col"><div class="v20-col-title">${escHtml(t('ww.col.backgrounds'))}${_wwAddBtn('backgrounds')}</div>${_wwRatedRows('backgrounds', m.backgrounds)}</div>
      <div class="v20-col"><div class="v20-col-title">${escHtml(t('ww.col.gifts'))}${_wwGiftLibBtn()}${_wwAddBtn('gifts')}</div>${_wwGiftLibBlock()}${_wwLeveledRows('gifts', m.gifts)}</div>
      <div class="v20-col"><div class="v20-col-title">${escHtml(t('ww.col.rites'))}${_wwAddBtn('rites')}</div>${_wwLeveledRows('rites', m.rites)}</div>
    </div>`;
}

function _wwHealthCell(k, v) {
  const lvl = t('ww.hl.' + k);
  const label = `${lvl} — ${t(v ? 'ww.dmg.' + v : 'ww.dmg.none')}`;
  return `<button type="button" class="ww-health-cell${v ? ' on ww-dmg-' + v : ''}" data-ww-health="${k}" aria-label="${escAttr(label)}" title="${escAttr(label)}">${WW_DAMAGE_MARK[v] || ''}</button>`;
}

function _wwPageRenown(m) {
  const healthRows = WW_HEALTH.map(k => `<div class="v20-health-row ww-health-row"><span class="v20-health-name">${escHtml(t('ww.hl.' + k))}</span><span class="v20-health-pen">${WW_HEALTH_PEN[k]}</span>${_wwHealthCell(k, m.health[k])}</div>`).join('');
  const legend = `<div class="ww-health-legend">${WW_DAMAGE.slice(1).map(d => `<span>${WW_DAMAGE_MARK[d]} ${escHtml(t('ww.dmg.' + d))}</span>`).join('')}</div>`;
  const otCols = [0, 1].map(c => `<div class="v20-col">${m.otherTraits.map((r, i) => (i % 2 === c)
    ? `<div class="v20-row v20-named">${_wwRm('otherTraits', i, WW_BASE.otherTraits)}<input class="v20-line-input" data-tpath="otherTraits.${i}.name" value="${escAttr(r.name)}" placeholder="…" aria-label="${escAttr(t('ww.ph.name'))}">${_wwDots(`otherTraits.${i}.val`, r.val, WW_MAX)}</div>` : '').join('')}</div>`).join('');
  const xp = m.experience;
  return `
    <div class="v20-band">${escHtml(t('ww.band.renown'))}</div>
    <div class="v20-grid3">${WW_RENOWN.map(k => _wwTraitBlock('renown.' + k, 'ww.renown.' + k, m.renown[k])).join('')}</div>
    <div class="v20-band">${escHtml(t('ww.band.traits'))}</div>
    <div class="v20-grid3">${WW_TRAITS.map(k => _wwTraitBlock(k, 'ww.' + k, m[k])).join('')}</div>
    <div class="v20-grid3 ww-gap">
      <div class="v20-col"><div class="v20-col-title">${escHtml(t('ww.band.health'))}</div><div class="v20-health">${healthRows}</div>${legend}</div>
      <div class="v20-col" style="grid-column: span 2">
        <div class="v20-col-title">${escHtml(t('ww.band.otherTraits'))}${_wwAddBtn('otherTraits')}</div>
        <div class="ww-other">${otCols}</div>
      </div>
    </div>
    <div class="v20-grid3">
      ${_v20Field(t('ww.battleScars'), 'battleScars', m.battleScars)}
      ${_v20Field(t('ww.metisDeformity'), 'metisDeformity', m.metisDeformity)}
    </div>
    <div class="v20-band">${escHtml(t('ww.band.xp'))}</div>
    <div class="v20-grid3">
      ${_v20Field(t('ww.xp.total'), 'experience.total', xp.total, ' inputmode="numeric" data-ww-exp')}
      ${_v20Field(t('ww.xp.spent'), 'experience.spent', xp.spent, ' inputmode="numeric" data-ww-exp')}
      <div class="v20-field"><span class="v20-field-lbl">${escHtml(t('ww.xp.remain'))}</span><span class="v20-field-input" id="ww-xp-remain">${(xp.total || 0) - (xp.spent || 0)}</span></div>
    </div>
    <div class="v20-col"><div class="v20-col-title">${escHtml(t('ww.xp.log'))}${_wwAddBtn('experience.log')}</div>${_wwTextRows('experience.log', xp.log, 'ww.xp.log')}</div>`;
}

function _wwPageForms(m) {
  const forms = WW_FORMS.map(f => `<div class="ww-form-card">
      <div class="ww-form-name">${escHtml(t('ww.form.' + f.key))}</div>
      <ul class="ww-form-mods">${f.mods.length
        ? f.mods.map(([attr, mod]) => `<li>${escHtml(t('ww.attr.' + attr))} <b>${escHtml(mod)}</b></li>`).join('')
        : `<li>${escHtml(t('ww.form.noChange'))}</li>`}
        ${f.note ? `<li>${escHtml(t('ww.form.note.' + f.note))}</li>` : ''}</ul>
      <div class="ww-form-diff">${escHtml(t('ww.form.diff', { n: f.diff }))}</div>
      ${f.delirium ? `<div class="ww-form-delirium">${escHtml(t('ww.form.delirium'))}</div>` : ''}
    </div>`).join('');
  const fetRows = m.fetishes.map((f, i) => `<div class="v20-pair-row">${_wwRm('fetishes', i, WW_BASE.fetishes)}<input class="v20-line-input" data-tpath="fetishes.${i}.item" value="${escAttr(f.item)}" placeholder="${escAttr(t('ww.fet.item'))}" aria-label="${escAttr(t('ww.fet.item'))}"><input class="v20-line-input v20-ritual-lvl" data-tpath="fetishes.${i}.level" value="${escAttr(f.level)}" placeholder="${escAttr(t('ww.fet.level'))}" aria-label="${escAttr(t('ww.fet.level'))}"><input class="v20-line-input v20-ritual-lvl" data-tpath="fetishes.${i}.gnosis" value="${escAttr(f.gnosis)}" placeholder="${escAttr(t('ww.fet.gnosis'))}" aria-label="${escAttr(t('ww.fet.gnosis'))}"></div>`).join('');
  const wCols = _WW_WEAPON_KEYS.map(k => [k, 'ww.cb.' + k]);
  const labels = wCols.map(([, k]) => t(k));
  const head = `<div class="v20-combat-row ww-combat-row v20-combat-head">${labels.map(l => `<span>${escHtml(l)}</span>`).join('')}</div>`;
  const rows = m.combat.weapons.map((w, i) => `<div class="v20-combat-row ww-combat-row">${wCols.map(([k], ci) =>
    `<label class="v20-combat-cell" data-label="${escAttr(labels[ci])}"><input class="v20-line-input" data-tpath="combat.weapons.${i}.${k}" value="${escAttr(w[k])}" aria-label="${escAttr(labels[ci])}"></label>`).join('')}</div>`).join('');
  const brawl = `<table class="ww-brawl"><thead><tr><th>${escHtml(t('ww.brawl.maneuver'))}</th><th>${escHtml(t('ww.brawl.roll'))}</th><th>${escHtml(t('ww.brawl.diff'))}</th><th>${escHtml(t('ww.brawl.dmg'))}</th></tr></thead><tbody>${
    WW_BRAWL.map(([k, diff, dmg]) => `<tr><td>${escHtml(t('ww.brawl.' + k))}</td><td>${escHtml(t('ww.brawl.rollValue'))}</td><td>${diff}</td><td>${escHtml(t('ww.brawl.dmg.' + dmg))}</td></tr>`).join('')}</tbody></table>
    <div class="ww-brawl-legend">${escHtml(t('ww.brawl.legend'))}</div>`;
  return `
    <div class="v20-band">${escHtml(t('ww.band.forms'))}</div>
    <div class="ww-forms">${forms}</div>
    <div class="v20-band">${escHtml(t('ww.band.fetishes'))}${_wwAddBtn('fetishes')}</div>
    <div class="v20-col">${fetRows}</div>
    <div class="v20-band">${escHtml(t('ww.band.combat'))}${_wwAddBtn('combat.weapons')}</div>
    <div class="v20-combat">${head}${rows}</div>
    <div class="v20-grid3">
      <div class="v20-col" style="grid-column: span 2"><details class="ww-brawl-wrap" open><summary class="v20-col-title">${escHtml(t('ww.brawl.title'))}</summary>${brawl}</details></div>
      <div class="v20-col">${_v20Field(t('ww.cb.armor'), 'combat.armor', m.combat.armor)}</div>
    </div>`;
}

function _wwRenderSheet(panel) {
  const m = _wwModel;
  const tabs = [['main', 'ww.tab.main'], ['renown', 'ww.tab.renown'], ['forms', 'ww.tab.forms']];
  const pages = { main: _wwPageMain(m), renown: _wwPageRenown(m), forms: _wwPageForms(m) };
  panel.innerHTML = `
    <div class="cdet-sheet-toolbar">
      <button class="cdet-sheet-btn primary" id="ww-save" disabled title="${escAttr(t('v20.saveTip'))}">${t('v20.savedSheet')}</button>
      <button class="cdet-sheet-btn" id="ww-regen" title="${escAttr(t('v20.regenTip'))}">${t('v20.regenBtn')}</button>
      <span class="v20-status" id="ww-status"></span>
    </div>
    <div class="chg-budget ww-budget" id="ww-budget">${_wwBudgetHtml(m)}</div>
    <div class="chg-tabs" role="tablist">${tabs.map(([id, k]) =>
      `<button type="button" class="chg-tab${_wwTab === id ? ' active' : ''}" role="tab" aria-selected="${_wwTab === id}" data-ww-tab="${id}">${escHtml(t(k))}</button>`).join('')}</div>
    <div class="v20-sheet ww-sheet">${tabs.map(([id]) =>
      `<div class="chg-page" role="tabpanel" data-ww-page="${id}"${_wwTab === id ? '' : ' hidden'}>${pages[id]}</div>`).join('')}</div>
    <div class="v20-foot">${escHtml(t('ww.foot'))}</div>`;
  document.getElementById('ww-save').addEventListener('click', _wwSave);
  document.getElementById('ww-regen').addEventListener('click', e => _wwRegen(e.currentTarget));
  _wwBind(panel);
  if (_wwDirty) _wwMarkDirty();
}

// ── Взаимодействие ───────────────────────────────────────────────────────────
function _wwRefresh() {
  const b = document.getElementById('ww-budget');
  if (b) b.innerHTML = _wwBudgetHtml(_wwModel);
}
function _wwMarkDirty() {
  _wwDirty = true;
  _wwRev++;
  const btn = document.getElementById('ww-save'), st = document.getElementById('ww-status');
  if (btn) { btn.disabled = false; btn.textContent = t('v20.btnSaveSheet'); }
  if (st) { st.textContent = t('v20.unsaved'); st.className = 'v20-status dirty'; }
}
function _wwRerender() {
  _wwDirty = true;
  _wwRenderSheet(document.getElementById('cdet-sheet-panel'));
}

function _wwAddRow(path) {
  const arr = _v20Get(_wwModel, path);
  if (!Array.isArray(arr)) return;
  if (path.startsWith('abilities.') || path === 'backgrounds' || path === 'otherTraits') arr.push(_wwRated());
  else if (path === 'gifts' || path === 'rites') arr.push(_wwLeveled());
  else if (path === 'fetishes') arr.push({ item: '', level: '', gnosis: '' });
  else if (path === 'combat.weapons') arr.push(Object.fromEntries(_WW_WEAPON_KEYS.map(k => [k, ''])));
  else arr.push('');
  _wwRerender();
}
function _wwRemoveRow(path, idx) {
  const arr = _v20Get(_wwModel, path);
  if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return;
  arr.splice(idx, 1);
  _wwRerender();
}

async function _wwApplyClick() {
  const sv = _wwStartValues(_wwModel.header);
  const msg = t('ww.apply.confirm', {
    rage: sv.rage ?? '—', gnosis: sv.gnosis ?? '—', willpower: sv.willpower ?? '—',
    renown: sv.renown || '—', gifts: sv.gifts.join(', ') || '—',
  });
  if (!await showConfirm(msg, { confirmText: t('ww.apply.ok') })) return;
  if (_wwApplyStart(_wwModel)) _wwRerender();
}

function _wwBind(panel) {
  if (panel._wwBound) return;
  panel._wwBound = true;

  const onDot = dot => {
    const span = dot.closest('.v20-dots'); if (!span) return;
    const dpath = span.dataset.dpath, d = +dot.dataset.d;
    const cur = _v20Get(_wwModel, dpath) || 0;
    const min = dpath.startsWith('attributes.') ? 1 : 0;
    const nv = Math.max(min, (cur === d) ? d - 1 : d);
    _v20Set(_wwModel, dpath, nv);
    _v20RebuildDots(span, nv);
    span.classList.toggle('chg-over', dpath.startsWith('abilities.') && nv > WW_ABIL_CAP);
    _wwRefresh();
    _wwMarkDirty();
  };
  const onBox = box => {
    const wrap = box.closest('.v20-boxes'); if (!wrap) return;
    const bpath = box.dataset.bpath, i = +box.dataset.i;
    const arr = _v20Get(_wwModel, bpath) || [];
    const cur = arr.filter(Boolean).length, d = i + 1;
    const nvArr = _wwFlags(null, arr.length).map((_, k) => k < ((cur === d) ? d - 1 : d));
    _v20Set(_wwModel, bpath, nvArr);
    _v20RebuildBoxes(wrap, nvArr);
    _wwMarkDirty();
  };
  const onHealth = cell => {
    const k = cell.dataset.wwHealth;
    const cur = _wwModel.health[k] || '';
    const nv = WW_DAMAGE[(WW_DAMAGE.indexOf(cur) + 1) % WW_DAMAGE.length];
    _wwModel.health[k] = nv;
    cell.outerHTML = _wwHealthCell(k, nv);
    const fresh = panel.querySelector(`[data-ww-health="${k}"]`);
    if (fresh) fresh.focus();
    _wwMarkDirty();
  };

  panel.addEventListener('click', e => {
    const tab = e.target.closest('[data-ww-tab]');
    if (tab) {
      _wwTab = tab.dataset.wwTab;
      panel.querySelectorAll('[data-ww-tab]').forEach(b => {
        const on = b.dataset.wwTab === _wwTab;
        b.classList.toggle('active', on); b.setAttribute('aria-selected', on);
      });
      panel.querySelectorAll('[data-ww-page]').forEach(p => { p.hidden = p.dataset.wwPage !== _wwTab; });
      return;
    }
    const hc = e.target.closest('[data-ww-health]'); if (hc) { onHealth(hc); return; }
    if (e.target.closest('[data-ww-apply]')) { _wwApplyClick(); return; }
    if (e.target.closest('[data-ww-gift-lib]')) { _wwToggleGiftPicker(); return; }
    const gi = e.target.closest('[data-ww-gift-item]');
    if (gi) { _wwAddGift(gi.dataset.wwGiftItem); return; }
    const dot = e.target.closest('.v20-dot'); if (dot) { onDot(dot); return; }
    const box = e.target.closest('.v20-box'); if (box && box.dataset.i !== undefined) { onBox(box); return; }
    const add = e.target.closest('[data-ww-add]'); if (add) { _wwAddRow(add.dataset.wwAdd); return; }
    const rm = e.target.closest('[data-ww-remove]'); if (rm) { _wwRemoveRow(rm.dataset.wwRemove, +rm.dataset.wwIdx); return; }
  });
  panel.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const dot = e.target.closest('.v20-dot');
    if (dot) { e.preventDefault(); onDot(dot); return; }
    const box = e.target.closest('.v20-box');
    if (box && box.dataset.i !== undefined) { e.preventDefault(); onBox(box); }
  });
  panel.addEventListener('change', e => {
    if (e.target.closest('[data-ww-gift-group]')) {
      const picker = panel.querySelector('[data-ww-gift-picker]');
      if (picker) _wwRenderGiftList(_wwGiftCache || [], picker);
    }
  });
  panel.addEventListener('input', e => {
    if (e.target.closest('[data-ww-gift-search]')) {
      const picker = panel.querySelector('[data-ww-gift-picker]');
      if (picker) _wwRenderGiftList(_wwGiftCache || [], picker);
      return;
    }
    const f = e.target.closest('[data-tpath]'); if (!f) return;
    let val = f.value;
    if (f.hasAttribute('data-ww-int')) val = _wwInt(val, +f.dataset.wwInt);
    if (f.hasAttribute('data-ww-exp')) {
      val = _wwInt(val, 99999);
      const rem = document.getElementById('ww-xp-remain');
      const xp = _wwModel.experience;
      const total = f.dataset.tpath === 'experience.total' ? val : xp.total;
      const spent = f.dataset.tpath === 'experience.spent' ? val : xp.spent;
      if (rem) rem.textContent = total - spent;
    }
    _v20Set(_wwModel, f.dataset.tpath, val);
    if (f.hasAttribute('data-ww-ref') || f.dataset.tpath.startsWith('backgrounds.')) _wwRefresh();
    _wwMarkDirty();
  });
}

async function _wwSave() {
  const btn = document.getElementById('ww-save'), st = document.getElementById('ww-status');
  btn.disabled = true; const old = btn.textContent; btn.textContent = t('v20.saving');
  // Снимок модели и номера правки на момент нажатия: правки во время PUT оставляют лист «не сохранён».
  const rev = _wwRev, ctx = _wwCtx, body = JSON.stringify({ data: _wwModel });
  try {
    const r = await fetch(`/api/characters/${encodeURIComponent(ctx.slug)}/sheet-data${location.search}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }
    ).then(r => r.json());
    if (!r.ok) throw new Error(r.error || t('v20.errGeneric'));
    if (_wwCtx !== ctx) return;
    if (rev !== _wwRev) { _wwMarkDirty(); return; }
    _wwDirty = false;
    btn.textContent = t('v20.savedSheet'); btn.disabled = true;
    if (st) { st.textContent = t('v20.savedStatus'); st.className = 'v20-status ok'; }
  } catch (e) {
    btn.disabled = false; btn.textContent = old;
    if (st) { st.textContent = '✗ ' + e.message; st.className = 'v20-status err'; }
  }
}

async function _wwRegen(btn) {
  const msg = _wwDirty ? t('v20.regenDirty') : t('v20.regenClean');
  if (!await showConfirm(msg, { danger: _wwDirty, confirmText: t('v20.regenBtnConfirm') })) return;
  // Контекст фиксируется ДО долгого запроса: результат принадлежит тому, для кого запрошен.
  const ctx = _wwCtx;
  const stale = () => _wwCtx !== ctx;
  const old = btn.textContent; btn.disabled = true; btn.textContent = t('v20.regenLoading');
  try {
    const ok = await _generateSheet({ scope: 'character', name: ctx.name, slug: ctx.slug }, null);
    if (!ok) throw new Error(t('v20.genFailed'));
    const q = location.search ? location.search + '&fromMd=1' : '?fromMd=1';
    const d = await fetch(`/api/characters/${encodeURIComponent(ctx.slug)}/sheet-data${q}`).then(r => r.json());
    if (stale()) return;
    _wwModel = _wwParseMd(d.md || '', _wwSeedHeader(ctx.card, _wwModel && _wwModel.header));
    _wwDirty = true;
    _wwRenderSheet(document.getElementById('cdet-sheet-panel'));
    await _wwSave();                              // sidecar обязан совпасть с новым md
  } catch (e) {
    showToast(t('v20.errPrefix', { msg: e.message }), 'error');
    if (!stale()) { btn.disabled = false; btn.textContent = old; }
  }
}

// ── Точки входа ──────────────────────────────────────────────────────────────
// Для _loadCharSheet (v20-sheet.js) и dice.js: d — ответ GET sheet-data ({source, data|md, lineage}).
// Sidecar без schema (сид при создании) при наличии ИИ-листа (-sheet.md) разбирается из него.
async function _wwResolveModel(charSlug, card, d) {
  if (d && d.source === 'json' && d.data && d.data.schema === WW_SCHEMA) return _wwNormalize(d.data);
  let md = d && d.source === 'md' ? d.md : '';
  if (d && d.source === 'json') {
    try {
      const q = location.search ? location.search + '&fromMd=1' : '?fromMd=1';
      const r = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/sheet-data${q}`).then(x => x.json());
      if (r && r.source === 'md') md = r.md || '';
    } catch { /* нет md — пустая модель */ }
  }
  const seed = _wwSeedHeader(card, d && d.data && d.data.header);
  return md ? _wwParseMd(md, seed) : _wwNormalize({ header: seed });
}

async function _loadWerewolfSheet(panel, charSlug, card, d) {
  // Несохранённые правки того же персонажа не затираем перечитыванием с диска.
  if (_wwDirty && _wwCtx && _wwCtx.slug === charSlug && _wwModel) {
    _wwRenderSheet(panel);
    return;
  }
  const ctx = { slug: charSlug, name: (card && card.name) || charSlug, card: card || null };
  const [model] = await Promise.all([_wwResolveModel(charSlug, card, d), _wwRefData()]);
  _wwCtx = ctx;
  _wwModel = model;
  _wwDirty = false;
  _wwTab = 'main';
  _wwRenderSheet(panel);
}
