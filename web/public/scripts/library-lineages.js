'use strict';
// Библиотека → разделы линеек «Оборотни» и «Маги» (2026-10-12; спеки
// doc/design/2026-10-11-library-werewolves-spec.md и 2026-10-11-mage-library-tab-spec.md).
//
// Один параметризованный набор по образцу «Смертных» (v20-sheet.js): кэш по категории,
// карточки, детейл в общей модалке K1, делегаты подвкладок и карточек. Свои атрибуты
// data-lin-* — не пересекаются с data-mort-*/data-kin-* (урок data-mort-card-group).
// Код «Смертных» не трогается. Данные — /api/library/<kind> (_mdLibRoutes, routes/library.js).

// fields — строки шапки записи в модалке (ключ API → ключ i18n подписи);
// badge — строка-метка под названием на карточке (ключевое число категории).
const LIN_LIBS = {
  werewolves: {
    groups: [
      { id: 'tribes', kind: 'werewolf-tribes',
        badge: r => r.willpower != null ? t('lin.ww.badgeWillpower', { n: r.willpower }) : '',
        fields: [['totem', 'lin.ww.totem'], ['willpower', 'lin.ww.willpower'], ['restrictions', 'lin.ww.restrictions'], ['gifts', 'lin.ww.gifts']] },
      { id: 'auspices', kind: 'werewolf-auspices',
        badge: r => [r.rage != null ? t('lin.ww.badgeRage', { n: r.rage }) : '', r.moon || ''].filter(Boolean).join(' · '),
        fields: [['moon', 'lin.ww.moon'], ['rage', 'lin.ww.rage'], ['renown', 'lin.ww.renown'], ['gifts', 'lin.ww.gifts']] },
      { id: 'breeds', kind: 'werewolf-breeds',
        badge: r => r.gnosis != null ? t('lin.ww.badgeGnosis', { n: r.gnosis }) : '',
        fields: [['gnosis', 'lin.ww.gnosis'], ['gifts', 'lin.ww.gifts']] },
      { id: 'gifts', kind: 'werewolf-gifts',
        badge: r => r.level != null ? t('lin.ww.badgeLevel', { n: r.level }) : '',
        fields: [['group', 'lin.ww.giftGroup'], ['level', 'lin.ww.level']] },
      { id: 'rites', kind: 'werewolf-rites',
        badge: r => r.level != null ? t('lin.ww.badgeLevel', { n: r.level }) : '',
        fields: [['type', 'lin.ww.riteType'], ['level', 'lin.ww.level']] },
    ],
  },
  mages: {
    groups: [
      { id: 'traditions', kind: 'mage-traditions' },
      { id: 'conventions', kind: 'mage-conventions' },
      { id: 'spheres', kind: 'mage-spheres' },
      { id: 'techniques', kind: 'mage-techniques' },
      { id: 'tarot', kind: 'mage-tarot',
        badge: r => r.arcana || '',
        fields: [['arcana', 'lin.mg.tarotArcana'], ['meaning', 'lin.mg.tarotMeaning'], ['reversed', 'lin.mg.tarotReversed'], ['association', 'lin.mg.tarotAssociation']] },
      { id: 'rotes', kind: 'mage-rotes',
        badge: r => r.spheres || '',
        fields: [['affiliation', 'lin.mg.rotesAffil'], ['spheres', 'lin.mg.rotesSpheres']] },
      { id: 'factions', kind: 'mage-factions' },
      { id: 'chantries', kind: 'mage-chantries',
        badge: r => r.place || '',
        fields: [['type', 'lin.mg.chantryType'], ['place', 'lin.mg.chantryPlace']] },
      { id: 'wonders', kind: 'mage-wonders',
        badge: r => [r.type || '', r.power || ''].filter(Boolean).join(' · '),
        fields: [['type', 'lin.mg.wonderType'], ['power', 'lin.mg.wonderPower']] },
      { id: 'worlds', kind: 'mage-worlds',
        badge: r => r.layer || '',
        fields: [['layer', 'lin.mg.worldLayer']] },
      // Сущности Аватары (2026-10-15, mage-hunter-gaps-spec §4): JSON-трек
      // (system/library/essences/essences.json), уровней нет — карточка +
      // модалка с полем «Стихия». category фиксированная 'essences', см.
      // _linRenderDetail ниже (иначе правка/удаление авторских уходили бы на
      // /api/library/essences/null/:slug).
      { id: 'essences', kind: 'essences',
        badge: r => r.element || '',
        fields: [['element', 'lin.mg.essenceElement']] },
    ],
  },
  fairies: {
    groups: [
      { id: 'kiths', kind: 'fairy-kiths',
        fields: [['birthrights', 'lin.fa.birthrights'], ['frailty', 'lin.fa.frailty'], ['affinity', 'lin.fa.affinity']] },
      { id: 'courts', kind: 'fairy-courts' },
      { id: 'seemings', kind: 'fairy-seemings',
        badge: r => r.glamour != null ? t('lin.fa.badgeGlamour', { n: r.glamour }) : '',
        fields: [['glamour', 'lin.fa.glamour'], ['willpower', 'lin.fa.willpower'], ['banality', 'lin.fa.banality']] },
      { id: 'houses', kind: 'fairy-houses',
        fields: [['boon', 'lin.fa.boon'], ['flaw', 'lin.fa.flaw']] },
      { id: 'arts', kind: 'fairy-arts',
        fields: [['attribute', 'lin.fa.attribute']] },
      { id: 'realms', kind: 'fairy-realms' },
    ],
  },
};

const _linCache = new Map(); // kind -> list

// Виды с силовым телом без шкалы (обряды/техники и книжные категории магов) —
// модалка показывает два раздела без точек. Вынесено: список проверяется при
// каждом рендере деталей и в ветке тела.
const _linRiteKinds = ['werewolf-rites', 'mage-techniques', 'mage-tarot', 'mage-rotes', 'mage-chantries', 'mage-wonders', 'mage-worlds'];

function _linGroup(kind) {
  for (const lib of Object.values(LIN_LIBS)) {
    const g = lib.groups.find(x => x.kind === kind);
    if (g) return g;
  }
  return null;
}
function _linIsKind(kind) { return !!_linGroup(kind); }

// «Дети Гайи (Children of Gaia)» → «Дети Гайи»: на карточке и в заголовке — без EN-скобок.
function _linDisplayName(name) {
  return String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || String(name || '');
}

async function ensureLinLib(kind) {
  if (_linCache.has(kind)) return _linCache.get(kind);
  let list = [];
  try { list = await fetch(`/api/library/${kind}`).then(r => r.json()); } catch { /* пусто */ }
  if (!Array.isArray(list)) list = [];
  // Файлы названы английскими слагами — порядок API не алфавитный для читателя.
  list.sort((a, b) => _linDisplayName(a.name).localeCompare(_linDisplayName(b.name), 'ru'));
  _linCache.set(kind, list);
  return list;
}
function _linBySlug(kind, slug) { return (_linCache.get(kind) || []).find(x => x.slug === slug) || null; }

// Фильтры силовых подвкладок (чипы уровней + поиск RU/EN) — зеркало ритуалов
// (library-rituals.js: _ritState/_ritFiltered/_ritRenderLevels). Состояние
// клиентское, без запросов; сбрасывается кнопкой в пустом состоянии.
// Дары и обряды фильтруются независимо друг от друга.
const _linGiftFilter = { level: 'all', q: '' };
const _linRiteFilter = { level: 'all', q: '' };
// Таро магов (2026-10-13): чипы — по Аркану (строка), а не по уровню.
const _linTarotFilter = { arcana: 'all', q: '' };
const _LIN_FILTER_IDS = {
  'werewolf-gifts': { state: () => _linGiftFilter, levels: 'lib-werewolf-gifts-levels', search: 'lib-werewolf-gifts-search', by: 'level' },
  'werewolf-rites': { state: () => _linRiteFilter, levels: 'lib-werewolf-rites-levels', search: 'lib-werewolf-rites-search', by: 'level' },
  'mage-tarot': { state: () => _linTarotFilter, levels: 'lib-mage-tarot-levels', search: 'lib-mage-tarot-search', by: 'arcana' },
};

function _linPowerFiltered(kind) {
  const ids = _LIN_FILTER_IDS[kind];
  const st = ids.state();
  const q = st.q.trim().toLowerCase();
  if (ids.by === 'arcana')
    return (_linCache.get(kind) || []).filter(r =>
      (st.arcana === 'all' || r.arcana === st.arcana)
      && (!q || String(r.name || '').toLowerCase().includes(q)));
  return (_linCache.get(kind) || []).filter(r =>
    (st.level === 'all' || r.level === st.level)
    && (!q || String(r.name || '').toLowerCase().includes(q)));
}

function _linGiftFiltered() { return _linPowerFiltered('werewolf-gifts'); }

function _linRenderPowerLevels(kind) {
  const ids = _LIN_FILTER_IDS[kind];
  const box = document.getElementById(ids.levels);
  if (!box) return;
  const st = ids.state();
  if (ids.by === 'arcana') {
    const arcanas = [...new Set((_linCache.get(kind) || []).map(r => r.arcana).filter(Boolean))];
    if (st.arcana !== 'all' && !arcanas.includes(st.arcana)) st.arcana = 'all';
    const chip = (val, label) => {
      const on = st.arcana === val;
      return `<button type="button" class="rit-level-chip${on ? ' active' : ''}" data-lin-filter-arcana="${escAttr(kind)}:${escAttr(val)}" aria-pressed="${on}">${escHtml(label)}</button>`;
    };
    box.innerHTML = chip('all', t('lin.mg.allArcana')) + arcanas.map(a => chip(a, a)).join('');
    return;
  }
  const levels = [...new Set((_linCache.get(kind) || []).map(r => r.level).filter(Number.isInteger))].sort((a, b) => a - b);
  if (st.level !== 'all' && !levels.includes(st.level)) st.level = 'all';
  const chip = (val, label) => {
    const on = st.level === val;
    return `<button type="button" class="rit-level-chip${on ? ' active' : ''}" data-lin-filter-level="${kind}:${val}" aria-pressed="${on}">${escHtml(label)}</button>`;
  };
  box.innerHTML = chip('all', t('lin.ww.allLevels')) + levels.map(l => chip(l, t('lin.ww.levelChip', { n: l }))).join('');
}

function _linRenderGiftLevels() { _linRenderPowerLevels('werewolf-gifts'); }

function _linCardsHtml(kind) {
  const g = _linGroup(kind);
  const filtered = !!_LIN_FILTER_IDS[kind];
  const list = filtered ? _linPowerFiltered(kind) : (_linCache.get(kind) || []);
  if (!list.length) {
    if (filtered && (_linCache.get(kind) || []).length)
      return `<div class="cdet-empty">${t(kind === 'werewolf-rites' ? 'lin.ww.riteEmpty' : kind === 'mage-tarot' ? 'lin.mg.tarotEmpty' : 'lin.ww.giftEmpty')} <button type="button" class="mod-fill-add-btn" data-lin-filter-reset="${kind}">${t(kind === 'mage-tarot' ? 'lin.mg.resetFilters' : 'lin.ww.resetFilters')}</button></div>`;
    return `<div class="cdet-empty">${t('lin.empty')}</div>`;
  }
  return `<div class="lib-cards">${list.map(r => {
    const art = r.hasArt
      ? `<img class="lib-card-art" loading="lazy" decoding="async" src="/img/system/library/${kind}/${escAttr(r.slug)}.png" alt="">`
      : '';
    const meta = g && g.badge ? g.badge(r) : '';
    const badge = r.custom ? `<span class="lib-card-custom-badge">${t('v20.authorBadge')}</span>` : '';
    const inner = `<div class="lib-card-name">${escHtml(_linDisplayName(r.name))}</div>${meta ? `<div class="lib-card-meta">${escHtml(meta)}</div>` : ''}${badge}`;
    return `<button type="button" class="lib-card${r.hasArt ? ' has-art' : ''}" data-lin-kind="${escAttr(kind)}" data-lin-slug="${escAttr(r.slug)}">
      ${art}${r.hasArt ? `<div class="lib-card-overlay">${inner}</div>` : inner}
    </button>`;
  }).join('')}</div>`;
}

function _linDetailHtml(kind, r) {
  if (!r) return '<div class="v20-disc-empty">' + t('v20.empty') + '</div>';
  const g = _linGroup(kind);
  const badge = r.custom ? `<span class="lib-card-custom-badge">${t('v20.authorBadge')}</span>` : '';
  const rows = (g && g.fields || []).map(([key, label]) => {
    const v = r[key];
    if (v == null || v === '') return '';
    return `<div class="lib-power-sec"><div class="lib-power-label">${escHtml(t(label))}</div><p class="lib-power-text">${escHtml(String(v))}</p></div>`;
  }).join('');
  // Искусства/Королевства фей и Сферы магов — уровни как у дисциплин (точки + имя +
  // «Литературное описание» + «Система»; _libPowerHtml из v20-sheet.js,
  // пустой раздел «Система» не рисуется — то, что нужно ступеням королевств).
  // Спека — doc/specs/fairy-arts-realms-modal/spec.md.
  // Дары оборотней — одна запись = один Дар: один .lib-power-блок с точками = level.
  // Обряды/техники — силовое тело (описание + система) без шкалы.
  // Спека — doc/specs/werewolf-mage-library-expansion/spec.md.
  const levelsHtml = (kind === 'fairy-arts' || kind === 'fairy-realms' || kind === 'mage-spheres') && Array.isArray(r.levels)
    ? r.levels.map(l => _libPowerHtml({ level: l.level, name: l.name, literary: l.literary, system: l.system })).join('')
    : '';
  // Дары — один .lib-power-блок с точками = level. Обряды/техники/таро/роты/
  // часовни/чудеса/миры — те же два раздела без точек (уровней в книге нет).
  const giftHtml = kind === 'werewolf-gifts'
    ? _libPowerHtml({ level: r.level, name: _linDisplayName(r.name), literary: r.description, system: r.system })
    : '';
  const riteHtml = _linRiteKinds.includes(kind)
    ? `${r.description ? `<div class="lib-power-sec"><div class="lib-power-label">${escHtml(t('v20.literaryDesc'))}</div><p class="lib-power-text">${escHtml(r.description)}</p></div>` : ''}`
      + `${r.system ? `<div class="lib-power-sec"><div class="lib-power-label">${escHtml(t('v20.system'))}</div><p class="lib-power-text lib-power-sys">${escHtml(r.system)}</p></div>` : ''}`
    : '';
  const bodyHtml = (kind === 'werewolf-gifts')
    ? giftHtml
    : _linRiteKinds.includes(kind)
      ? riteHtml
      : `${r.description ? `<p class="lib-power-text">${escHtml(r.description)}</p>` : ''}${levelsHtml}`;
  return `<div class="v20-disc-detail-head"><h3>${escHtml(_linDisplayName(r.name))}</h3>${badge}</div>
    ${r.note ? `<div class="v20-disc-note">${escHtml(r.note)}</div>` : ''}
    ${rows}
    ${bodyHtml}
    ${r.source ? `<div class="v20-disc-note">${t('v20.sourceValue', { source: escHtml(r.source) })}</div>` : ''}`;
}

function _linRenderList(kind) {
  const body = document.getElementById(`lib-${kind}-body`);
  if (body) body.innerHTML = _linCardsHtml(kind);
  if (_LIN_FILTER_IDS[kind]) _linRenderPowerLevels(kind);
}

function _linRenderDetail(kind, slug) {
  const r = _linBySlug(kind, slug);
  // JSON-треки среди lin-видов (essences) несут фиксированную категорию —
  // без неё K1-правка/удаление строили бы URL с category=null (400).
  const category = kind === 'essences' ? 'essences' : null;
  _v20SetLibDetailBody(_linDetailHtml(kind, r), r ? { kind, slug, category, custom: !!r.custom } : null);
}
async function _linOpenModal(kind, slug) {
  _v20OpenLibModalShell();
  await ensureLinLib(kind);
  _linRenderDetail(kind, slug);
}

// Точка входа раздела (navigate → 'lib-werewolves' / 'lib-mages'). onlyKind — перерисовать одну
// категорию (переключение подвкладки, перезагрузка после правки).
async function loadLinLib(lib, onlyKind) {
  const cfg = LIN_LIBS[lib];
  if (!cfg) return;
  for (const g of cfg.groups) {
    if (onlyKind && onlyKind !== g.kind) continue;
    const body = document.getElementById(`lib-${g.kind}-body`);
    if (body && !_linCache.has(g.kind)) body.innerHTML = `<div class="loading-state"><div class="spinner"></div>${t('v20.loading')}</div>`;
    await ensureLinLib(g.kind);
    _linRenderList(g.kind);
  }
}
// Перезагрузка категории после создания/правки/удаления (конфиг library-authoring.js).
function linLibReload(kind) {
  _linCache.delete(kind);
  for (const [lib, cfg] of Object.entries(LIN_LIBS)) {
    if (cfg.groups.some(g => g.kind === kind)) return loadLinLib(lib, kind);
  }
}

document.addEventListener('click', e => {
  const card = e.target.closest('[data-lin-slug]');
  if (card) { _linOpenModal(card.dataset.linKind, card.dataset.linSlug); return; }
  const glv = e.target.closest('[data-lin-filter-level]');
  if (glv) {
    const [kind, v] = String(glv.dataset.linFilterLevel || '').split(':');
    if (_LIN_FILTER_IDS[kind]) {
      const st = _LIN_FILTER_IDS[kind].state();
      st.level = v === 'all' ? 'all' : parseInt(v, 10);
      _linRenderPowerLevels(kind); _linRenderList(kind);
    }
    return;
  }
  const tav = e.target.closest('[data-lin-filter-arcana]');
  if (tav) {
    const parts = String(tav.dataset.linFilterArcana || '').split(':');
    const kind = parts.shift();
    const v = parts.join(':');
    if (kind && _LIN_FILTER_IDS[kind] && _LIN_FILTER_IDS[kind].by === 'arcana') {
      _LIN_FILTER_IDS[kind].state().arcana = v === 'all' ? 'all' : v;
      _linRenderPowerLevels(kind); _linRenderList(kind);
    }
    return;
  }
  if (e.target.closest('[data-lin-gift-reset]') || e.target.closest('[data-lin-filter-reset]')) {
    const m = e.target.closest('[data-lin-filter-reset]');
    for (const k of (m ? [m.dataset.linFilterReset] : ['werewolf-gifts'])) {
      if (!_LIN_FILTER_IDS[k]) continue;
      const st = _LIN_FILTER_IDS[k].state();
      if ('level' in st) st.level = 'all';
      if ('arcana' in st) st.arcana = 'all';
      st.q = '';
      const s = document.getElementById(_LIN_FILTER_IDS[k].search); if (s) s.value = '';
      _linRenderPowerLevels(k); _linRenderList(k);
    }
    return;
  }
  const tab = e.target.closest('[data-lin-group]');
  if (!tab) return;
  const bar = tab.closest('.disciplines-subtab-bar');
  if (!bar) return;
  bar.querySelectorAll('[data-lin-group]').forEach(b => {
    const on = b === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const page = bar.closest('.page');
  if (page) page.querySelectorAll('.lin-subpanel').forEach(p => p.classList.toggle('active', p.dataset.linPanel === tab.dataset.linGroup));
  loadLinLib(tab.dataset.linLib, tab.dataset.linGroup);
});

// Поиск силовых подвкладок — зеркало #lib-rit-search (фильтрация на клиенте).
document.addEventListener('input', e => {
  const t = e.target && e.target.closest ? e.target.closest('#lib-werewolf-gifts-search, #lib-werewolf-rites-search, #lib-mage-tarot-search') : null;
  if (!t) return;
  const kind = t.id === 'lib-werewolf-rites-search' ? 'werewolf-rites'
    : t.id === 'lib-mage-tarot-search' ? 'mage-tarot' : 'werewolf-gifts';
  _LIN_FILTER_IDS[kind].state().q = t.value;
  _linRenderList(kind);
});
