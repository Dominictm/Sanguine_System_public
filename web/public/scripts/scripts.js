// ═══════════════════════════════════════════════════════════════
// City (multi-city) — transparent ?city= on every /api/ call
// ═══════════════════════════════════════════════════════════════
let CITY = new URLSearchParams(location.search).get('city') || '';
(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    if (typeof url === 'string' && url.startsWith('/api/') && !/[?&]city=/.test(url)) {
      url += (url.includes('?') ? '&' : '?') + 'city=' + encodeURIComponent(CITY);
    }
    return _fetch(url, opts);
  };
})();
async function initCitySwitch() {
  const sel = document.getElementById('city-select');
  if (!sel) return;
  try {
    const [{ cities = [], default: def }, summary] = await Promise.all([
      fetch('/api/cities').then(r => r.json()),
      fetch('/api/cities/summary').then(r => r.json()).catch(() => []),
    ]);
    const list = cities.length ? cities : (def ? [def] : []);
    // If the active city isn't set/available, go to the server default (or first city).
    const urlCity = new URLSearchParams(location.search).get('city');
    if (!urlCity && list.length && !list.includes(CITY)) {
      location.search = 'city=' + encodeURIComponent(list.includes(def) ? def : list[0]); return;
    }
    // Список опций (попап открытого select — одна строка «Город, Год» на
    // пункт, как раньше) — берём готовое summary (display+год на город),
    // с фолбэком на голый слаг, если /api/cities/summary недоступен или
    // город ещё без city.md.
    const bySlug = Object.fromEntries((summary || []).map(c => [c.slug, c]));
    sel.innerHTML = list.map(slug => {
      const info  = bySlug[slug];
      const label = info ? `${info.display}${info.year ? `, ${info.year}` : ''}` : slug;
      return `<option value="${escAttr(slug)}"${slug === CITY ? ' selected' : ''}>${escHtml(label)}</option>`;
    }).join('');
    sel.onchange = () => { location.search = 'city=' + encodeURIComponent(sel.value); };

    // Затишье-до-касания: сам select спрятан (только ловит клики/клавиатуру),
    // видимую двухстрочную витрину «Город / Год» рисует .city-switch-display
    // (см. styles.css) — смена города всегда идёт через полную навигацию
    // (location.search=), так что достаточно выставить текст один раз при
    // загрузке, на выбранный сейчас CITY.
    const current = bySlug[CITY];
    const nameEl = document.getElementById('city-switch-name');
    const yearEl = document.getElementById('city-switch-year');
    if (nameEl) nameEl.textContent = current ? current.display : CITY;
    if (yearEl) yearEl.textContent = current?.year || '';
  } catch {}
}
document.addEventListener('DOMContentLoaded', initCitySwitch);

// ═══════════════════════════════════════════════════════════════
// Sidebar collapse (кнопка «◂» под туром) — сворачивает меню в узкую
// иконочную полосу (те же правила, что у @media max-width:900px), состояние
// переживает перезагрузку через localStorage.
// ═══════════════════════════════════════════════════════════════
(function () {
  const KEY = 'sanguine-sidebar-collapsed';
  const btn = document.getElementById('btn-sidebar-collapse');
  const sidebar = document.getElementById('sidebar');
  if (!btn || !sidebar) return;

  function apply(collapsed) {
    sidebar.classList.toggle('collapsed', collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
    const label = collapsed ? t('sidebar.expand.title') : t('sidebar.collapse.title');
    btn.title = label;
    btn.setAttribute('aria-label', label);
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

// ═══════════════════════════════════════════════════════════════
// Тема оформления (кнопка «⛧/☾» в шапке сайдбара, над туром) —
// переключает data-theme на <html>, состояние переживает перезагрузку
// через localStorage (тот же ключ, что читает анти-флеш-скрипт в <head>
// index.html до загрузки CSS). Половины иконок живут в разметке обе, нужная
// показывается через CSS по html[data-theme].
// ═══════════════════════════════════════════════════════════════
(function () {
  const KEY = 'sanguine-theme';
  const btn = document.getElementById('btn-theme');
  if (!btn) return;
  const NIGHT = 'nyc-night';

  function apply(theme) {
    const night = theme === NIGHT;
    if (night) document.documentElement.setAttribute('data-theme', NIGHT);
    else document.documentElement.removeAttribute('data-theme');
    btn.setAttribute('aria-pressed', String(night));
    const label = night ? t('theme.night.label') : t('theme.warm.label');
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }

  let theme = 'blood';
  try { theme = localStorage.getItem(KEY) === NIGHT ? NIGHT : 'blood'; } catch {}
  apply(theme);

  function toggle() {
    // Fade-ceremony: ставим переходный атрибут за кадр до смены темы,
    // снимаем через 400мс (см. base.css html[data-theme-transitioning]).
    // prefers-reduced-motion:reduce глушит transition до .001ms.
    document.documentElement.setAttribute('data-theme-transitioning', '');
    theme = theme === NIGHT ? 'blood' : NIGHT;
    apply(theme);
    try { localStorage.setItem(KEY, theme); } catch {}
    setTimeout(() => document.documentElement.removeAttribute('data-theme-transitioning'), 420);
  }

  btn.addEventListener('click', toggle);

  // Горячая клавиша T — только когда фокус не в поле ввода (не перехватываем
  // ввод имени/поиска) и без модификаторов (не ломаем системные жесты).
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyT' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();
    toggle();
  });
})();

// ═══════════════════════════════════════════════════════════════
// Группы бокового меню (Мир / Игра / Архив) — разворачиваются кликом по
// заголовку, состояние переживает перезагрузку. В рейле 52px список пунктов
// не помещается вовсе: там заголовок открывает всплывающую панель .nav-flyout.
// ═══════════════════════════════════════════════════════════════
const NAV_GROUPS_KEY = 'sanguine-nav-groups';

// Рейл включается двумя независимыми механизмами — классом .collapsed (кнопка
// «◂») и медиазапросом max-width:900px, где класса нет (900px — планшетный
// портрет 601–900px схлопывается в рейл; телефон <700px туда же). Проверять
// надо оба, иначе на узком окне вся логика рейла молча не включится.
function _navRail() {
  const sb = document.getElementById('sidebar');
  return !!sb && (sb.classList.contains('collapsed')
    || window.matchMedia('(max-width: 900px)').matches);
}

function _navGroupsRead() {
  try {
    const raw = JSON.parse(localStorage.getItem(NAV_GROUPS_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }  // битый JSON / отключённые site data = все развёрнуты
}

function _navGroupsWrite(state) {
  try { localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify(state)); } catch {}
}

// Заголовок свёрнутой группы, внутри которой лежит открытая страница, получает
// признак «ты здесь»: планку слева (CSS) плюс суффикс в aria-label — одного
// цвета мало, --accent на --bg2 даёт 1.96:1, ниже порога 3:1.
function _navGroupMarkers() {
  document.querySelectorAll('.nav-group').forEach(sec => {
    const btn = sec.querySelector('.nav-group-toggle');
    if (!btn) return;
    const hasActive = !!sec.querySelector('.nav-item.active');
    btn.classList.toggle('has-active', hasActive);
    const name = btn.dataset.groupName || '';
    const marked = hasActive && (btn.getAttribute('aria-expanded') === 'false' || _navRail());
    btn.setAttribute('aria-label', marked ? t('s.navHere', { name }) : name);
  });
}

function _navGroupSet(sec, expanded, persist) {
  const btn = sec.querySelector('.nav-group-toggle');
  if (!btn) return;
  btn.setAttribute('aria-expanded', String(expanded));
  if (persist) {
    const state = _navGroupsRead();
    state[sec.dataset.group] = expanded;
    _navGroupsWrite(state);
  }
  _navGroupMarkers();
}

// Пункт активной страницы не должен оставаться в свёрнутой группе: иначе после
// перехода из тура, с дашборда или из поиска пользователь видит меню без
// единого признака того, где он находится. В рейле состояние групп не
// применяется и не перезаписывается — свёрнутость это понятие развёрнутой
// панели, и возврат из рейла обязан отдать ровно то, что было до него.
function revealNavGroup(page) {
  const item = document.querySelector(`.nav-item[data-page="${page}"]`);
  const sec  = item && item.closest('.nav-group');
  if (sec && !_navRail()) {
    const btn = sec.querySelector('.nav-group-toggle');
    if (btn && btn.getAttribute('aria-expanded') === 'false') _navGroupSet(sec, true, true);
  }
  _navGroupMarkers();
}

(function () {
  const menu = document.querySelector('.nav-menu');
  if (!menu) return;
  const groups = Array.from(menu.querySelectorAll('.nav-group'));
  if (!groups.length) return;

  // ── Восстановление состояния ────────────────────────────────
  const saved = _navGroupsRead();
  groups.forEach(sec => {
    // Отсутствующий или неизвестный ключ = развёрнута: первый запуск выглядит
    // ровно как раньше.
    if (saved[sec.dataset.group] === false) _navGroupSet(sec, false, false);
  });
  _navGroupMarkers();

  // ── Всплывающая панель рейла ────────────────────────────────
  let flyEl = null;      // единственный экземпляр, переиспользуется
  let flySec = null;     // группа, от которой открыта панель

  function flyout() {
    if (!flyEl) {
      flyEl = document.createElement('div');
      flyEl.className = 'nav-flyout';
      flyEl.addEventListener('click', e => {
        const row = e.target.closest('.nav-flyout-item');
        if (!row) return;
        const page = row.dataset.page;
        closeFlyout(false);
        navigate(page);
      });
      flyEl.addEventListener('keydown', e => {
        const rows = Array.from(flyEl.querySelectorAll('.nav-flyout-item'));
        const i = rows.indexOf(document.activeElement);
        if (e.key === 'ArrowDown')      { e.preventDefault(); rows[(i + 1 + rows.length) % rows.length]?.focus(); }
        else if (e.key === 'ArrowUp')   { e.preventDefault(); rows[(i - 1 + rows.length) % rows.length]?.focus(); }
        else if (e.key === 'Escape')    { e.preventDefault(); closeFlyout(true); }
        else if (e.key === 'Tab')       { closeFlyout(true); }
        else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          const row = document.activeElement.closest?.('.nav-flyout-item');
          if (row) { e.preventDefault(); const page = row.dataset.page; closeFlyout(true); navigate(page); }
        }
      });
      document.body.appendChild(flyEl);
    }
    return flyEl;
  }

  function closeFlyout(focusBack) {
    if (!flySec) return;
    const btn = flySec.querySelector('.nav-group-toggle');
    flySec = null;
    if (flyEl) flyEl.classList.remove('visible');
    if (focusBack && btn) btn.focus();
  }

  function openFlyout(sec) {
    const btn  = sec.querySelector('.nav-group-toggle');
    const icon = sec.querySelector('.nav-group-icon') || btn;
    const el   = flyout();
    flySec = sec;
    el.innerHTML =
      `<div class="nav-flyout-title">${escHtml(btn.dataset.groupName || '')}</div>` +
      Array.from(sec.querySelectorAll('.nav-item')).map(item => {
        const ico = item.querySelector('.nav-icon')?.textContent || '';
        const txt = item.querySelector('span:last-child')?.textContent || '';
        return `<a class="nav-flyout-item${item.classList.contains('active') ? ' active' : ''}"` +
          ` role="link" tabindex="0" data-page="${escAttr(item.dataset.page)}">` +
          `<span class="nav-icon">${escHtml(ico)}</span><span>${escHtml(txt)}</span></a>`;
      }).join('');

    // Панель измеряется до показа: высота нужна, чтобы прижать её к нижнему
    // краю окна, а этого не сделать без реального layout.
    el.style.maxHeight = '';
    el.style.overflowY = '';
    el.style.overflowX = '';
    el.style.left = '-9999px';
    el.style.top  = '0px';
    el.classList.add('visible');

    const rail = document.getElementById('sidebar').getBoundingClientRect();
    const ir   = icon.getBoundingClientRect();
    const h    = el.getBoundingClientRect().height;
    // Порядок важен: сперва прижать к низу, потом ограничить сверху — иначе на
    // окне 480px панель уедет за верхнюю кромку.
    let top = Math.min(ir.top - 6, window.innerHeight - h - 8);
    top = Math.max(top, 8);
    if (h > window.innerHeight - 16) {
      el.style.maxHeight = 'calc(100vh - 16px)';
      el.style.overflowY = 'auto';
      // Явно: по спецификации overflow-x:visible рядом с overflow-y:auto
      // браузер молча превращает в auto, и панель обрастает лишней
      // горизонтальной полосой (та же ловушка разобрана у .nav-menu).
      el.style.overflowX = 'hidden';
    }
    el.style.left = (rail.right + 8) + 'px';
    el.style.top  = top + 'px';
    el.querySelector('.nav-flyout-item')?.focus();
  }

  // ── Клик по заголовку ───────────────────────────────────────
  groups.forEach(sec => {
    const btn = sec.querySelector('.nav-group-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (_navRail()) {
        const same = flySec === sec;
        closeFlyout(false);
        if (!same) openFlyout(sec);   // одновременно открыт ровно один flyout
        return;
      }
      _navGroupSet(sec, btn.getAttribute('aria-expanded') === 'false', true);
    });
  });

  // Клик мимо панели (в том числе по кнопке разворачивания сайдбара) и смена
  // геометрии окна закрывают её — «висящий» flyout поверх развёрнутого меню
  // выглядел бы поломкой.
  document.addEventListener('click', e => {
    if (!flySec) return;
    if (e.target.closest('.nav-flyout') || e.target.closest('.nav-group-toggle')) return;
    closeFlyout(false);
  });
  window.addEventListener('resize', () => closeFlyout(false));
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && flySec) closeFlyout(true);
  });

  // Подсказка .nav-tip не должна накладываться на открытую панель.
  window._navFlyoutOpen = () => !!flySec;
})();

// ═══════════════════════════════════════════════════════════════
// «О программе» — правовая информация: логотип и нотисы Dark Pack Agreement,
// дисклеймер неофициальности, лицензии кода и вендоренных библиотек.
// Соглашение требует, чтобы это было доступно на самом материале, поэтому
// точка входа — постоянный элемент подвала панели, а не страница в меню.
// ═══════════════════════════════════════════════════════════════
(function () {
  const modal = document.getElementById('about-modal');
  if (!modal) return;
  document.getElementById('btn-about')?.addEventListener('click', () => openModal('about-modal'));
  document.getElementById('about-close')?.addEventListener('click', () => closeModal('about-modal'));
  bindBackdropDblClickClose(modal, () => closeModal('about-modal'));
})();

// ═══════════════════════════════════════════════════════════════
// Sidebar nav tooltips (свёрнутая панель) — .nav-tip создаётся один раз и
// позиционируется через position:fixed по getBoundingClientRect() наведённого
// пункта. Это не CSS ::after внутри .nav-item: .nav-menu держит
// overflow-y:auto для прокрутки списка, а браузер по спеке не даёт оставить
// overflow-x visible на элементе с overflow-y:auto (он обрежется до auto
// вместе с ней) — любая всплывашка-потомок обрезалась бы по правому краю
// узкой 52px колонки. position:fixed на отдельном элементе вне #sidebar эту
// обрезку не наследует.
// ═══════════════════════════════════════════════════════════════
(function () {
  const sidebar = document.getElementById('sidebar');
  // Заголовки групп в рейле — такие же безымянные значки, как пункты, и
  // нуждаются в подсказке не меньше: имя группы там больше взять негде.
  const items = document.querySelectorAll('.nav-item, .nav-group-toggle');
  if (!sidebar || !items.length) return;

  let tipEl = null;
  function tip() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'nav-tip';
      tipEl.id = 'nav-tip';
      tipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }

  function show(item) {
    // Оба источника рейла, а не только класс: на окне < 900px подписи пунктов
    // тоже скрыты, и подсказка там нужна ровно так же.
    if (!_navRail()) return;
    // При открытой панели группы подсказка подавляется — иначе два всплывающих
    // слоя накладываются друг на друга.
    if (window._navFlyoutOpen?.()) return;
    const text = item.getAttribute('title');
    if (!text) return;
    // Прячем нативный browser-tooltip на время показа своего, чтобы не
    // накладывались друг на друга; title возвращаем на mouseleave/blur.
    item.dataset.navTitle = text;
    item.removeAttribute('title');
    const el = tip();
    el.textContent = text;
    item.setAttribute('aria-describedby', el.id);
    const r = item.getBoundingClientRect();
    el.style.top = (r.top + r.height / 2) + 'px';
    el.style.left = (r.right + 9) + 'px';
    el.classList.add('visible');
  }

  function hide(item) {
    if (item.dataset.navTitle) {
      item.setAttribute('title', item.dataset.navTitle);
      delete item.dataset.navTitle;
    }
    if (item) item.removeAttribute('aria-describedby');
    if (tipEl) tipEl.classList.remove('visible');
  }

  items.forEach(item => {
    item.addEventListener('mouseenter', () => show(item));
    item.addEventListener('mouseleave', () => hide(item));
    item.addEventListener('focus', () => show(item));
    item.addEventListener('blur', () => hide(item));
  });
})();

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

// Эмодзи остаются источником фоллбэка: файла иконки может не быть (пользователь
// не гонял tools/generate_lineage_icons.js), и тогда интерфейс обязан показать
// прежний символ, а не пустое место.
const LINEAGE_ICONS = {
  vampire: '🧛', fairy: '🧚', mortal: '🧑',
  werewolf: '🐺', mage: '🔮', hunter: '🏹', unknown: '👤'
};

// Миниатюра арта вместо исходника. Сервер отдаёт её лениво и при любой осечке
// сам редиректит на /city-img/…, поэтому вызывающему не нужен свой фоллбэк.
// Ширины ровно две: 640 — сетка карточек (284 CSS × 2 dpr), 96 — узел графа
// (36 × 2). Чужие URL (уже миниатюра, внешняя ссылка) возвращаем как есть.
function thumbUrl(url, width) {
  if (!url || !url.startsWith('/city-img/')) return url;
  return url.replace('/city-img/', '/city-img-thumb/') + `?w=${width}`;
}

// Ключи LINEAGE_ICONS — они же имена файлов иконок; отдельной карты слагов не
// нужно, достаточно проверить, что линейка вообще известна.
const LINEAGE_ICON_URL = l =>
  `img/system/lineages/${Object.hasOwn(LINEAGE_ICONS, l) ? l : 'unknown'}.png`;

// Фоллбэк живёт на onerror, а не на предварительной проверке: HEAD-запрос на
// каждую карточку дороже самой иконки. Текстовый узел вместо <img> наследует
// font-size контейнера, поэтому эмодзи встаёт ровно туда же и того же размера.
function lineageIconFallback(img) {
  img.replaceWith(document.createTextNode(img.dataset.emoji || LINEAGE_ICONS.unknown));
}

// Единая точка отрисовки иконки линейки. Размер задаётся CSS по месту вставки —
// иконка декоративна (alt="", aria-hidden), смысл линейки несёт соседний бейдж.
function lineageIconHtml(lineage) {
  const emoji = LINEAGE_ICONS[lineage] || LINEAGE_ICONS.unknown;
  return `<img class="lineage-icon" src="${LINEAGE_ICON_URL(lineage)}" alt="" aria-hidden="true"`
    // Без loading="lazy": весь набор — семь файлов по 2–11 КБ, они приходят
    // одним махом и лежат в кэше, а ленивая загрузка давала бы пустой квадрат
    // на карточках ниже сгиба в момент прокрутки.
    + ` data-emoji="${emoji}" decoding="async" onerror="lineageIconFallback(this)">`;
}

const STATUS_LABELS = {
  active: t('s.statusActive'), torpor: t('s.statusTorpor'), dead: t('s.statusDead'), missing: t('s.statusMissing'), unknown: t('s.statusUnknown')
};
const LINEAGE_LABELS = {
  vampire: t('s.lineageVampire'), fairy: t('s.lineageFairy'), mortal: t('s.lineageMortal'),
  werewolf: t('s.lineageWerewolf'), mage: t('s.lineageMage'), hunter: t('s.lineageHunter')
};

// Акцентный цвет клана для тонировки фона модалки персонажа (openCharDetail).
// Подбор по мотивам цветокодировки клановых глав V20-корбука — не каноничен,
// чисто оформительское решение.
const CLAN_COLORS = {
  'Асамиты':              '#b3001b',
  'Бруха':                '#c2410c',
  'Вентру':                '#2c5aa0',
  'Гэнгрел':               '#8a6d3b',
  'Джованни':              '#3d2b4f',
  'Ласомбра':              '#2b1f4a',
  'Малкавиан':             '#6a3d9a',
  'Носферату':             '#4a5d3a',
  'Равнос':                '#d2691e',
  'Последователи Сета':    '#a67c00',
  'Тореадор':              '#b5476b',
  'Тремер':                '#5b2a6e',
  'Тзимище':               '#7a1f2b',
  // Кровные линии
  'Баали':                 '#4a0e0e',
  'Дочери Какофонии':      '#4a6a7a',
  'Каппадокийцы':          '#5a5a52',
  'Нагараджа':             '#8a4a1e',
  'Салубри':               '#3a6a8a',
  'Самеди':                '#3a1f3a',
  'Серпанты Света':        '#6a7a1e',
};

// REL_COLORS/REL_LABELS/NODE_COLORS/MOCK_GRAPH moved to public/graph.js (E2.2).
// REL_TYPE_OPTIONS (datalist) removed 2026-08-08, Фаза 2 — заменено пикером из библиотеки
// «Постоянные связи» (relations-manage.js, ensureRelTypes()), см. char-detail.js.

// V20 generation range (3rd = eldest/Methuselah-tier down to 14th = thin-blooded), offered
// as a dropdown wherever generation is entered/edited — keeps the value numeric and in-canon.
const VAMPIRE_GENERATIONS = ['14-е', '13-е', '12-е', '11-е', '10-е', '9-е', '8-е', '7-е', '6-е', '5-е', '4-е', '3-е'];

// ═══════════════════════════════════════════════════════════════
// State & routing
// ═══════════════════════════════════════════════════════════════

// Слаг вкладки (data-belonging-tab) → точное значение поля «Принадлежность»
// в карточке персонажа. 'all' — особый случай, под фильтр не попадает.
// Единый источник для renderChars() и дефолта в модалке «Новый НПС».
const BELONGING_TAB_VALUES = {
  master:   'Персонаж мастера',
  player:   'Персонаж игрока',
  episodic: 'Эпизодический персонаж',
  familiar: 'Фамильяр',
};

// Обобщение .chars-empty (техспека §10.1) — единый компонент пустого состояния для
// любого раздела навигации, не только списка персонажей. Задача сообщения — объяснить,
// как завести запись этого типа, а не констатировать «ничего нет» (см. emptyCharsState
// ниже — оригинальный, специфичный для персонажей пример). hint может содержать простую
// инлайн-разметку (напр. <b>) — вызывающий код отвечает за экранирование динамических
// частей внутри, сам helper их не экранирует.
function emptyStateHtml({ title = t('s.emptyDefaultTitle'), body = '', hint = '' } = {}) {
  return `<div class="chars-empty">
    <div class="chars-empty-title">${escHtml(title)}</div>
    ${body ? `<p class="chars-empty-body">${body}</p>` : ''}
    ${hint ? `<p class="chars-empty-hint">${hint}</p>` : ''}
  </div>`;
}

// Пустое состояние списка персонажей. Задача — объяснить, как завести запись
// этого типа, а не сообщить «ничего нет».
function emptyCharsState(belonging, lineage, status, search) {
  const narrowed = lineage !== 'all' || status !== 'all' || !!search;
  if (belonging === 'familiar' && !narrowed) {
    return emptyStateHtml({
      title: t('dash.familiarTitle'),
      body: t('dash.familiarBody'),
      hint: t('dash.familiarHint'),
    });
  }
  if (narrowed) {
    return emptyStateHtml({
      title: t('dash.emptyTitle'),
      body: t('dash.emptyBody'),
      hint: t('dash.emptyHint'),
    });
  }
  return emptyStateHtml({
    body: t('dash.emptyBelongingBody'),
    hint: t('dash.emptyBelongingHint'),
  });
}

const STATE = {
  page: 'dashboard',
  characters: [],
  filter: { lineage: 'all', status: 'all', search: '', belonging: 'all' },
  graph: { data: null, svg: null, zoom: null, sim: null, nodes: null, links: null, inited: false },
  selectedNode: null,
  locations: [],
  locFilter: { zone: 'all', masq: 'all', district: 'all', search: '' },
};

// Переход между разделами — короткий кроссфейд: уходящий раздел доигрывает
// fade-out и только по его animationend раздел переключается на новый
// (который получает свой fade-in). Без этого второй раздел появлялся
// плавно, а первый пропадал мгновенно — переход выглядел рваным.
//
// Направление анимации зависит от типа перехода (см. styles.css — три пары
// keyframes):
// - Между пунктами верхнего меню (.nav-item[data-page]) — горизонтальный
//   слайд, направление берётся из порядка пунктов в меню: переход к пункту
//   правее по списку выглядит как движение «вперёд» (уходит влево, новый
//   въезжает справа), к пункту левее — «назад» (зеркально). Так соседние
//   разделы ощущаются разным движением, а не одним и тем же затемнением.
// - Переходы на служебные детальные страницы вне меню (module/city — открываются
//   кликом по карточке, а не пунктом меню) остаются на исходном вертикальном
//   fade+rise — они не часть горизонтального «ряда» разделов.
// При prefers-reduced-motion или повторном клике по уже открытому разделу —
// переключение мгновенное, без анимации.
const _NAV_ORDER = () => Array.from(document.querySelectorAll('.nav-item[data-page]')).map(el => el.dataset.page);

function navigate(page) {
  const prev = document.querySelector('.page.active');
  const next = document.getElementById(`page-${page}`);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let dir = null; // 'fwd' | 'back' | null (null = стандартный вертикальный fade)
  if (prev) {
    const order = _NAV_ORDER();
    const prevIdx = order.indexOf(prev.id.replace(/^page-/, ''));
    const nextIdx = order.indexOf(page);
    if (prevIdx !== -1 && nextIdx !== -1 && prevIdx !== nextIdx) dir = nextIdx > prevIdx ? 'fwd' : 'back';
  }

  const applyPage = () => {
    STATE.page = page;
    // Останавливаем карусели сетки при уходе со страницы «Персонажи».
    if (page !== 'characters') _clearGridTimers();
    document.querySelectorAll('.nav-item').forEach(el => {
      const on = el.dataset.page === page;
      el.classList.toggle('active', on);
      if (on) el.setAttribute('aria-current', 'page');
      else    el.removeAttribute('aria-current');
    });
    revealNavGroup(page);
    // page-in-fwd/page-in-back снимаются здесь с ВСЕХ разделов (не только с
    // next) перед добавлением нужного варианта — а не по animationend после
    // проигрывания. Снятие класса по animationend роняло специфичность
    // обратно на голое «.page.active» (у него своя, отдельно объявленная
    // анимация page-in) — смена значения animation-name заставляла браузер
    // проиграть её заново, и раздел ещё раз мигал фейдом сразу после слайда.
    document.querySelectorAll('.page.page-in-fwd, .page.page-in-back')
      .forEach(el => el.classList.remove('page-in-fwd', 'page-in-back'));
    document.querySelectorAll('.page').forEach(el =>
      el.classList.toggle('active', el.id === `page-${page}`));
    if (next && dir && !reduced) next.classList.add(dir === 'fwd' ? 'page-in-fwd' : 'page-in-back');

    if (page === 'dashboard')  loadDashboard();
    if (page === 'chronicle')  loadChronicle();
    if (page === 'characters') loadCharacters();
    if (page === 'graph')      loadGraph();
    if (page === 'chronicles-page') loadChroniclesPage();
    if (page === 'modules')         loadModules();
    if (page === 'module')          loadModulePage();
    if (page === 'session')    loadSessionScreen();
    if (page === 'city')       loadCityPage();
    if (page === 'threads')    loadThreads();
    if (page === 'locations')  loadLocations();
    if (page === 'library')    loadKindred();
    if (page === 'audio-library') loadAudioLibrary();
    if (page === 'factions')   loadFactions();
    if (page === 'rumors')     loadRumors();
    if (page === 'search')     loadSearch();
    if (page === 'city-new')   loadCitiesGrid();
  };

  const outClass = dir === 'fwd' ? 'page-out-fwd' : dir === 'back' ? 'page-out-back' : 'page-out';
  if (prev && next && prev !== next && !reduced) {
    // prev может ещё нести page-in-fwd/page-in-back со своего собственного
    // въезда (снимается только в начале applyPage() СЛЕДУЮЩЕГО перехода,
    // то есть позже, чем нужно здесь). .page.active.page-in-* специфичнее
    // .page.page-out-* (3 класса против 2) — если не снять его сейчас,
    // добавление outClass ничего не меняет в animation-name, animationend
    // не срабатывает, и navigate() дальше не отрабатывает вообще (зависшая
    // навигация после первого клика).
    prev.classList.remove('page-in-fwd', 'page-in-back');
    prev.classList.add(outClass);
    prev.addEventListener('animationend', () => {
      prev.classList.remove(outClass);
      applyPage();
    }, { once: true });
  } else {
    if (prev) prev.classList.remove('page-out', 'page-out-fwd', 'page-out-back');
    applyPage();
  }
}

document.querySelectorAll('[data-page]').forEach(el => {
  el.addEventListener('click', () => navigate(el.dataset.page));
  // These are <a> without href / clickable elements — make them keyboard-operable.
  if (!el.hasAttribute('href')) {
    if (!el.hasAttribute('role'))     el.setAttribute('role', 'link');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        navigate(el.dataset.page);
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════

async function loadDashboard() {
  const el = document.getElementById('dash-content');
  el.innerHTML = `<div class="loading-state"><div class="spinner"></div>${t('ui.loading')}</div>`;
  try {
    const [stats, threads] = await Promise.all([
      fetch('/api/status').then(r => r.json()),
      fetch('/api/threads' + (window.location.search || '')).then(r => r.json()).catch(() => null),
    ]);
    renderDashboard(stats, el, threads);
    loadIntegrity();
  } catch {
    el.innerHTML = `<div class="loading-state" style="color:var(--accent3)">${t('dash.serverNotResponding')}</div>`;
  }
}

function animateValue(el, target, dur = 900) {
  let start = null;
  const step = ts => {
    if (!start) start = ts;
    const p = Math.min((ts - start) / dur, 1);
    el.textContent = Math.round(p * p * target);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderDashboard(s, container, threads) {
  // «Висящие нити» — незакрытые нити, дольше всех не двигавшиеся в игровом
  // времени (staleMonths считает сервер от самой свежей нити города).
  const staleThreads = (Array.isArray(threads) ? threads : [])
    .filter(t => (t.status === 'active' || t.status === 'background') && t.staleMonths >= 1)
    .sort((a, b) => b.staleMonths - a.staleMonths)
    .slice(0, 5);
  const _monthsWord = n => n % 10 === 1 && n % 100 !== 11 ? t('dash.staleMonthsOne')
    : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? t('dash.staleMonthsFew') : t('dash.staleMonthsMany'));
  const staleBlock = staleThreads.length ? `
    <div class="dash-stale-threads">
      <div class="dash-stale-title">${t('dash.staleTitle')}</div>
      ${staleThreads.map(th => `
        <button class="dash-stale-row stat-clickable" data-nav="threads" data-thread-id="${th.id}" data-thread-file="${escAttr(th.file || '')}" title="${escHtml(th.description || th.title)}">
          <span class="dash-stale-dot ${th.status}"></span>
          <span class="dash-stale-name">${escHtml(th.title)}</span>
          <span class="dash-stale-age">${th.staleMonths} ${_monthsWord(th.staleMonths)} ${t('dash.staleAge')}</span>
        </button>`).join('')}
    </div>` : '';

  // Broken links badge
  const blCount = s.brokenLinks;
  const blBadge = blCount === null || blCount === undefined
    ? `<span class="badge-integrity neutral">${t('dash.notChecked')}</span>`
    : blCount === 0
      ? `<span class="badge-integrity ok">${t('dash.linksOk')}</span>`
      : `<span class="badge-integrity err">${blCount} ${t('dash.brokenLinks')}</span>`;

  const LINEAGES = [
    { key: 'vampires',   label: t('s.linVampires'),   color: 'var(--accent)'     },
    { key: 'fairies',    label: t('s.linFairies'),    color: 'var(--c-fairy)'    },
    { key: 'mortals',    label: t('s.linMortals'),    color: 'var(--text3)'      },
    { key: 'werewolves', label: t('s.linWerewolves'), color: 'var(--c-werewolf)' },
    { key: 'mages',      label: t('s.linMages'),      color: 'var(--c-mage)'     },
    { key: 'hunters',    label: t('s.linHunters'),    color: 'var(--c-hunter)'   },
  ];

  const activeLineages = LINEAGES.filter(l => (s[l.key] || 0) > 0);

  // Цифры — читаемым пергаментом (кровь #8B0000 на тёмном давала 1.9:1);
  // цвет линейки сохранён как тонкий маркер у ярлыка (решение пользователя).
  const lineageCards = activeLineages.map(l => `
      <div class="stat-card">
        <div class="stat-label"><span class="stat-lin-dot" style="background:${l.color}"></span>${l.label}</div>
        <div class="stat-value" id="sv-${l.key}">0</div>
      </div>`).join('');

  container.innerHTML = `
    <div class="stats-grid">
      ${lineageCards}
      <div class="stat-card">
        <div class="stat-label">${t('dash.statModules')}</div>
        <div class="stat-value gold" id="sv-modules">0</div>
        <div class="stat-detail">${t('dash.statModulesSub')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">${t('dash.statLocations')}</div>
        <div class="stat-value" id="sv-locations">0</div>
        <div class="stat-detail">${t('dash.statLocationsSub')}</div>
      </div>
      <div class="stat-card stat-clickable" data-nav="chronicle">
        <div class="stat-label">${t('dash.statEvents')}</div>
        <div class="stat-value gold" id="sv-events">0</div>
        <div class="stat-detail">${t('dash.statEventsSub')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">${t('dash.statThreads')}</div>
        <div class="stat-value accent" id="sv-threads">0</div>
        <div class="stat-detail">${t('dash.statThreadsSub')}</div>
      </div>
    </div>
    <div class="substats">
      <div class="substat">
        <div class="substat-dot" style="background:var(--c-success)"></div>
        <span>${s.active || 0} ${t('dash.activeCount')}</span>
      </div>
      <div class="substat">
        <div class="substat-dot" style="background:var(--c-lore)"></div>
        <span>${s.torpor || 0} ${t('dash.torporCount')}</span>
      </div>
    </div>
    ${staleBlock}
    <div class="integrity-row">${blBadge}</div>
    <div id="integrity-panel" class="integrity-panel"></div>`;

  activeLineages.forEach((l, i) => {
    const el = document.getElementById(`sv-${l.key}`);
    if (el) animateValue(el, s[l.key], 900 + i * 80);
  });
  animateValue(document.getElementById('sv-modules'), s.modules || 0);
  animateValue(document.getElementById('sv-locations'), s.locations || 0);
  animateValue(document.getElementById('sv-events'), s.events || 0, 1100);
  animateValue(document.getElementById('sv-threads'), s.openThreads || 0, 1200);
}

// Click on "Настройки моделей" link in dashboard → go to AI tab
document.addEventListener('click', e => {
  const link = e.target.closest('[data-nav][data-tab]');
  if (!link) return;
  const page = link.dataset.nav;
  const tab  = link.dataset.tab;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navBtn = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navBtn) navBtn.classList.add('active');
  // Этот путь navigate() не зовёт вообще и подсветку ставит сам — значит и
  // группу разворачивать здесь тоже приходится вручную.
  revealNavGroup(page);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');
  // Activate the sub-tab
  if (tab) {
    document.querySelectorAll(`#page-${page} .tab-btn`).forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll(`#page-${page} .tab-panel`).forEach(p =>
      p.classList.toggle('active', p.id === `tab-${tab}`));
    if (tab === 'ai-connect')  loadAiConnectTab();
    if (tab === 'ai-features') loadAiFeaturesTab();
    if (tab === 'gen-rules')   loadGenRulesTab();
  }
});

// ── Integrity panel ────────────────────────────────────────────
async function loadIntegrity() {
  const el = document.getElementById('integrity-panel');
  if (!el) return;
  el.innerHTML = `<div class="ip-loading">${t('dash.ipLoading')}</div>`;
  let data;
  try { data = await fetch('/api/integrity').then(r => r.json()); }
  catch { el.innerHTML = ''; return; }
  if (!data || data.error) { el.innerHTML = ''; return; }
  renderIntegrity(data, el);
}

function renderIntegrity(data, el) {
  const dot = sev => `<span class="ip-dot ip-${sev}"></span>`;
  const blState = data.brokenLinks == null ? 'neutral' : data.brokenLinks === 0 ? 'ok' : 'err';
  const blCount = data.brokenLinks == null ? '—' : data.brokenLinks;

  const total = (data.totalIssues || 0) + (data.brokenLinks > 0 ? data.brokenLinks : 0);

  // Broken-links pseudo-check (no expandable list — details live in Tools→Проверка)
  let rows = `
    <div class="ip-check">
      <div class="ip-check-head">
        ${dot(blState)}<span class="ip-label">${t('dash.ipBrokenLinks')}</span>
        <span class="ip-count ${data.brokenLinks > 0 ? 'has' : ''}">${blCount}</span>
      </div>
    </div>`;

  for (const c of (data.checks || [])) {
    const n = c.items.length;
    const sev = n === 0 ? 'ok' : c.severity;
    const shown = c.items.slice(0, 40);
    const more = n - shown.length;
    rows += `
      <div class="ip-check">
        <div class="ip-check-head ${n > 0 ? 'ip-expandable' : ''}" data-check="${c.id}">
          ${dot(sev)}<span class="ip-label">${escHtml(c.label)}</span>
          <span class="ip-count ${n > 0 ? 'has' : ''}">${n}</span>
          ${n > 0 ? '<span class="ip-chevron">▾</span>' : ''}
        </div>
        ${n > 0 ? `<div class="ip-items" data-items="${c.id}" hidden>
          <div class="ip-hint">${escHtml(c.hint)}</div>
          ${shown.map(i => `<div class="ip-item">${escHtml(i)}</div>`).join('')}
          ${more > 0 ? `<div class="ip-more">${t('dash.ipMore', { n: more })}</div>` : ''}
        </div>` : ''}
      </div>`;
  }

  el.innerHTML = `
    <div class="ip-header">
      <span class="ip-title">${t('dash.ipTitle')}</span>
      <span class="ip-summary ${total === 0 ? 'ip-clean' : ''}">${total === 0 ? t('dash.ipClean') : total + ' ' + t('dash.ipIssues')}</span>
    </div>
    ${rows}
    <div class="ip-canon">
      <div class="ip-canon-title">${t('dash.ipCanonTitle')}</div>
      <textarea id="ip-canon-text" class="ip-canon-text" rows="3" placeholder="${t('dash.ipCanonPh')}"></textarea>
      <button id="ip-canon-btn" class="ip-canon-btn">${t('dash.ipCanonBtn')}</button>
      <div id="ip-canon-result" class="canon-result" style="display:none"></div>
    </div>`;
}

// Clickable dashboard stat cards → navigate; integrity rows → expand
document.getElementById('dash-content').addEventListener('click', e => {
  const card = e.target.closest('.stat-clickable[data-nav]');
  if (card) {
    if (card.dataset.threadId) _pendingThreadFocus = { id: card.dataset.threadId, file: card.dataset.threadFile };
    navigate(card.dataset.nav);
    return;
  }

  if (e.target.closest('#ip-canon-btn')) {
    _runCanonCheck(document.getElementById('ip-canon-text')?.value || '',
      document.getElementById('ip-canon-result'),
      document.getElementById('ip-canon-btn'), t('dash.ipCanonBtn'));
    return;
  }

  const head = e.target.closest('.ip-check-head.ip-expandable');
  if (head) {
    const items = document.querySelector(`.ip-items[data-items="${head.dataset.check}"]`);
    const chev = head.querySelector('.ip-chevron');
    if (items) {
      const opening = items.hasAttribute('hidden');
      items.toggleAttribute('hidden', !opening);
      if (chev) chev.textContent = opening ? '▴' : '▾';
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// Characters
// ═══════════════════════════════════════════════════════════════

async function loadCharacters() {
  if (STATE.characters.length) {
    renderChars();
    _injectGridDims();
    // Перезапускаем карусели после возврата на страницу (таймеры были остановлены при уходе).
    initGridCarousels();
    return;
  }
  document.getElementById('chars-grid').innerHTML =
    `<div class="loading-state"><div class="spinner"></div>${t('ui.loading')}</div>`;
  try {
    const data = await fetch('/api/characters').then(r => r.json());
    STATE.characters = Array.isArray(data) ? data : [];
    renderChars();
    initGridCarousels();
  } catch {
    document.getElementById('chars-grid').innerHTML =
      '<div class="loading-state" style="color:var(--accent3)">⚠ ' + t('dash.charsLoadErr').replace(/^⚠ /, '') + '</div>';
  }
}

function renderChars() {
  const { lineage, status, search, belonging } = STATE.filter;
  let list = STATE.characters;
  if (lineage !== 'all')      list = list.filter(c => c.lineage === lineage);
  if (status  !== 'all')      list = list.filter(c => c.statusType === status);
  if (belonging !== 'all') list = list.filter(c => c.belonging === BELONGING_TAB_VALUES[belonging]);
  if (search)                 list = list.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  document.getElementById('chars-count-label').textContent = `${list.length} ${t('dash.charsCount')}`;

  const grid = document.getElementById('chars-grid');
  if (!list.length) {
    grid.innerHTML = emptyCharsState(belonging, lineage, status, search);
    return;
  }

  grid.innerHTML = list.map((c, i) => {
    const icon   = lineageIconHtml(c.lineage);
    const stType = c.statusType || 'unknown';
    const stLbl  = statusLabel(c);
    const linBadge = `<span class="badge badge-${c.lineage}">${LINEAGE_LABELS[c.lineage] || c.lineage}</span>`;
    const stBadge  = stType !== 'unknown' ? `<span class="badge badge-${stType}">${stLbl}</span>` : '';
    const stRow    = stBadge ? `<div class="char-status-row">${stBadge}</div>` : '';
    const textBlock = `
      <div class="char-name">${escHtml(c.name)}</div>
      <div class="char-clan">${c.lineage === 'mortal' ? '' : escHtml(c.clan || c.lineageLabel || '—')}</div>
      <div class="char-badges">${linBadge}</div>`;
    const delay = `style="animation-delay:${Math.min(i, 12) * 30}ms"`;

    if (c.imageUrl) {
      return `<div class="char-card has-art" data-slug="${escHtml(c.slug)}" ${delay}>
        <img class="char-card-art" src="${escAttr(thumbUrl(c.imageUrl, 640))}" alt="${escHtml(c.name)}" loading="lazy" decoding="async">
        <div class="char-card-overlay">${textBlock}</div>
        ${stRow}
      </div>`;
    }
    return `<div class="char-card" data-slug="${escHtml(c.slug)}" ${delay}>
      <span class="char-lineage-icon">${icon}</span>
      ${stRow}
      ${textBlock}
    </div>`;
  }).join('');
  _foundryBulkApplyCardClasses();
  _charExportApplyCardClasses();
}

// ── Selective character export (ZIP with art/belongings/sheet/journal) ───────
let _charExportMode = false;
const _charExportSelected = new Set(); // slugs

function _charExportApplyCardClasses() {
  for (const card of document.querySelectorAll('.char-card[data-slug]')) {
    const slug = card.dataset.slug;
    card.classList.remove('char-exp-selectable', 'char-exp-selected');
    if (!_charExportMode) continue;
    card.classList.add('char-exp-selectable');
    if (_charExportSelected.has(slug)) card.classList.add('char-exp-selected');
  }
}

function _charExportUpdateButton() {
  const btn = document.getElementById('btn-export-chars');
  const cancelBtn = document.getElementById('btn-export-chars-cancel');
  if (!btn) return;
  if (!_charExportMode) {
    btn.textContent = t('chars.btn.export');
    btn.classList.remove('active');
    if (cancelBtn) cancelBtn.style.display = 'none';
    return;
  }
  const n = _charExportSelected.size;
  btn.textContent = n ? t('chars.export.nSelected', { n }) : t('chars.export.selectHint');
  btn.classList.add('active');
  if (cancelBtn) cancelBtn.style.display = '';
}

function _charExportToggleCard(slug) {
  if (_charExportSelected.has(slug)) _charExportSelected.delete(slug);
  else _charExportSelected.add(slug);
  _charExportApplyCardClasses();
  _charExportUpdateButton();
}

async function _charExportDownload() {
  const slugs = Array.from(_charExportSelected);
  try {
    const res = await fetch(`/api/characters/export${location.search}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cd = res.headers.get('content-disposition') || '';
    a.download = /filename="([^"]+)"/.exec(cd)?.[1] || 'characters_export.zip';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showToast(t('chars.export.done', { count: slugs.length }), 'success');
  } catch (e) {
    showToast(t('chars.export.err') + e.message, 'error');
  }
}

function _charExportExit() {
  _charExportMode = false;
  _charExportSelected.clear();
  _charExportApplyCardClasses();
  _charExportUpdateButton();
}

document.getElementById('btn-export-chars')?.addEventListener('click', async e => {
  // Foundry bulk mode is hidden (display:none) but keep mutual exclusion if triggered via console
  if (_foundryBulkMode) { _foundryBulkExit(); }
  e.preventDefault();
  if (!_charExportMode) {
    if (!STATE.characters.length) { showToast(t('chars.export.noChars'), 'warning'); return; }
    _charExportMode = true;
    _charExportApplyCardClasses();
    _charExportUpdateButton();
    return;
  }
  if (!_charExportSelected.size) { showToast(t('chars.export.choose'), 'warning'); return; }
  await _charExportDownload();
  _charExportExit();
});
document.getElementById('btn-export-chars-cancel')?.addEventListener('click', e => {
  e.preventDefault();
  _charExportExit();
});

// ── Bulk Foundry export: selection mode ─────────────────────────────────────
let _foundryBulkMode = false;
const _foundryBulkSelected = new Set();  // slugs

function _foundryBulkSupportedLineages() { return ['vampire', 'mortal']; }

function _foundryBulkApplyCardClasses() {
  for (const card of document.querySelectorAll('.char-card[data-slug]')) {
    const slug = card.dataset.slug;
    const c = STATE.characters.find(x => x.slug === slug);
    card.classList.remove('fdry-selectable', 'fdry-selected', 'fdry-disabled');
    if (!_foundryBulkMode || !c) continue;
    if (_foundryBulkSupportedLineages().includes(c.lineage)) {
      card.classList.add('fdry-selectable');
      if (_foundryBulkSelected.has(c.slug)) card.classList.add('fdry-selected');
    } else {
      card.classList.add('fdry-disabled');
    }
  }
}

function _foundryBulkUpdateButton() {
  const btn = document.getElementById('btn-export-foundry-bulk');
  const cancelBtn = document.getElementById('btn-export-foundry-cancel');
  if (!btn) return;
  if (!_foundryBulkMode) {
    btn.textContent = t('dash.foundryExport');
    if (cancelBtn) cancelBtn.style.display = 'none';
    return;
  }
  const n = _foundryBulkSelected.size;
  btn.textContent = n ? t('dash.foundryExportN', { n }) : t('dash.foundrySelect');
  if (cancelBtn) cancelBtn.style.display = '';
}

function _foundryBulkToggleCard(slug) {
  const c = STATE.characters.find(x => x.slug === slug);
  if (!c || !_foundryBulkSupportedLineages().includes(c.lineage)) return;
  if (_foundryBulkSelected.has(c.slug)) _foundryBulkSelected.delete(c.slug);
  else _foundryBulkSelected.add(c.slug);
  _foundryBulkApplyCardClasses();
  _foundryBulkUpdateButton();
}

async function _foundryBulkDownload() {
  const slugs = Array.from(_foundryBulkSelected);
  try {
    const res = await fetch(`/api/characters/export-foundry-bulk${location.search}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cd = res.headers.get('content-disposition') || '';
    a.download = /filename="([^"]+)"/.exec(cd)?.[1] || 'foundry_export.zip';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    showToast(t('dash.foundryExportErr') + e.message, 'error');
  }
}

function _foundryBulkExit() {
  _foundryBulkMode = false;
  _foundryBulkSelected.clear();
  _foundryBulkApplyCardClasses();
  _foundryBulkUpdateButton();
}

document.getElementById('btn-export-foundry-bulk')?.addEventListener('click', async e => {
  e.preventDefault();
  if (!_foundryBulkMode) {
    _foundryBulkMode = true;
    _foundryBulkApplyCardClasses();
    _foundryBulkUpdateButton();
    return;
  }
  if (!_foundryBulkSelected.size) return;
  await _foundryBulkDownload();
  _foundryBulkExit();
});
document.getElementById('btn-export-foundry-cancel')?.addEventListener('click', e => {
  e.preventDefault();
  _foundryBulkExit();
});

document.getElementById('search-input').addEventListener('input', e => {
  STATE.filter.search = e.target.value;
  if (STATE.characters.length) { renderChars(); _injectGridDims(); }
});

// ── Grid carousel ─────────────────────────────────────────────────────────────
const GRID_MIN = 12_000;   // мин. интервал между сменами (12 с)
const GRID_MAX = 50_000;   // макс. интервал (50 с)

let _gridImages  = {};   // slug → [url, ...]
let _gridIdxs    = {};   // slug → current index
let _gridTimers  = {};   // slug → pending timeoutID

function _clearGridTimers() {
  for (const id of Object.values(_gridTimers)) clearTimeout(id);
  _gridTimers = {};
}

function _scheduleCard(slug) {
  const delay = GRID_MIN + Math.floor(Math.random() * (GRID_MAX - GRID_MIN));
  _gridTimers[slug] = setTimeout(() => _advanceCard(slug), delay);
}

async function initGridCarousels() {
  _clearGridTimers();
  _gridImages = {};
  _gridIdxs   = {};

  // Данные уже в STATE.characters (загружены loadCharacters) —
  // отдельный fetch /api/characters/all-images больше не нужен.
  for (const c of (STATE.characters || [])) {
    if (c.images && c.images.length > 1) _gridImages[c.slug] = c.images;
  }

  // _gridIdxs больше не сеется здесь заранее нулём — _injectGridDims() тут же
  // ниже пересчитывает реальный индекс по отрисованной img.src для каждой
  // карточки (см. комментарий там); отдельный проход стал бы мёртвым кодом,
  // который сразу перезаписывается и может ввести в заблуждение.
  _injectGridDims();

  // Каждая карточка стартует в свой случайный момент, независимо
  for (const slug of Object.keys(_gridImages)) {
    if ((_gridImages[slug]?.length || 0) < 2) continue;
    const initDelay = Math.floor(Math.random() * GRID_MAX);
    _gridTimers[slug] = setTimeout(() => _advanceCard(slug), initDelay);
  }
}

function _injectGridDims() {
  for (const slug of Object.keys(_gridImages)) {
    const card = document.querySelector(`.char-card[data-slug="${CSS.escape(slug)}"]`);
    if (!card || card.querySelector('.char-card-dim')) continue;
    // Ресинк «текущего» индекса с тем, что реально отрисовано: карточка
    // изначально показывает c.imageUrl (бэкенд берёт ПОСЛЕДНИЙ отсортированный
    // файл, см. web/lib/db.js), а не images[0] — без этого do-while в
    // _advanceCard иногда гарантированно выбирает уже показанную картинку
    // (не видно смены). Пересчитываем при каждой (пере)отрисовке карточки —
    // renderChars() перерисовывает грид при каждом фильтре/поиске, всегда
    // возвращая imageUrl, так что старый индекс тут же снова устаревает.
    const img = card.querySelector('.char-card-art');
    if (img) {
      // src карточки — миниатюра, а список all-images отдаёт исходники: сравниваем
    // по одинаково преобразованным ссылкам, иначе индекс всегда -1 и первая смена
    // кадра гарантированно показывает то же изображение.
    const idx = (_gridImages[slug] || []).findIndex(u => thumbUrl(u, 640) === img.getAttribute('src'));
      _gridIdxs[slug] = idx === -1 ? 0 : idx;
    }
    const dim = document.createElement('div');
    dim.className = 'char-card-dim';
    card.insertBefore(dim, card.firstChild);
  }
}

function _advanceCard(slug) {
  // Не работаем вне страницы «Персонажи» — экономим CPU и трафик.
  if (STATE.page !== 'characters') return;
  const images = _gridImages[slug];
  if (!images || images.length < 2) return;
  const card = document.querySelector(`.char-card[data-slug="${CSS.escape(slug)}"]`);
  // Карточка сейчас не в DOM (скрыта фильтром/поиском по имени) — не бросаем
  // цикл насовсем: без переброса таймера карусель этого персонажа умирала бы
  // навсегда при первом же срабатывании под фильтром, т.к. больше ничто её не
  // перезапустит (initGridCarousels вызывается только один раз за визит на
  // страницу). Планируем следующую попытку и выходим.
  if (!card) { _scheduleCard(slug); return; }
  const img = card.querySelector('.char-card-art');
  const dim = card.querySelector('.char-card-dim');
  if (!img || !dim) { _scheduleCard(slug); return; }

  dim.classList.add('dark');
  setTimeout(() => {
    let next;
    do { next = Math.floor(Math.random() * images.length); } while (next === _gridIdxs[slug]);
    _gridIdxs[slug] = next;
    // Слайдшоу сетки тоже идёт через миниатюры: иначе каждая смена кадра
    // тянет исходник на 2–3 МБ, и трафик страницы растёт без предела со временем.
    img.src = thumbUrl(images[next], 640);
    setTimeout(() => {
      dim.classList.remove('dark');
      _scheduleCard(slug); // следующий интервал — снова случайный
    }, 300);
  }, 2100);
}

// Все / Эпизодические — переключатель по «Принадлежности» (фаза H).
document.querySelectorAll('[data-belonging-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-belonging-tab]').forEach(b => {
      const isActive = b === btn;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', String(isActive));
    });
    STATE.filter.belonging = btn.dataset.belongingTab;
    if (STATE.characters.length) { renderChars(); _injectGridDims(); }
  });
});

document.getElementById('filter-lineage').addEventListener('change', e => {
  STATE.filter.lineage = e.target.value;
  if (STATE.characters.length) { renderChars(); _injectGridDims(); }
});

document.getElementById('filter-status').addEventListener('change', e => {
  STATE.filter.status = e.target.value;
  if (STATE.characters.length) { renderChars(); _injectGridDims(); }
});

// Relationship Graph (loadGraph, renderGraph, showInfoPanel, etc.) moved to
// public/graph.js (E2.2).

// ═══════════════════════════════════════════════════════════════
// Tools
// ═══════════════════════════════════════════════════════════════

// Restart server — живёт в .page-header страницы «Инструменты» (П.6, 2026-08-07), видна при
// любой открытой вкладке, поэтому обработчик навешивается один раз здесь, а не внутри
// loadAiConnectTab()/loadAiFeaturesTab() (как было раньше — кнопка не реагировала, пока
// вкладка AI ни разу не открыта).
document.getElementById('ais-restart-btn').addEventListener('click', async () => {
  const btn    = document.getElementById('ais-restart-btn');
  const status = document.getElementById('ais-restart-status');
  btn.disabled = true;
  status.className = 'ais-status';
  status.textContent = t('dash.serverStopping');

  try {
    await fetch('/api/restart', { method: 'POST' }).catch(() => {}); // may fail if server dies mid-request

    status.textContent = t('dash.serverRestarting');

    // Poll until server responds again (max 20s)
    const start = Date.now();
    let up = false;
    while (Date.now() - start < 20000) {
      await new Promise(r => setTimeout(r, 800));
      try {
        const r = await fetch('/api/auth-status', { cache: 'no-store' });
        if (r.ok) { up = true; break; }
      } catch {}
    }

    if (up) {
      status.textContent = t('dash.serverStarted');
      status.classList.add('ok');
      _resetAiSettingsCache();
      // Перезапуск мог случиться при любой открытой вкладке «Инструментов» — перечитываем
      // ту из двух AI-вкладок, что сейчас видна; невидимая подхватит свежие данные лениво,
      // при следующем открытии (флаг уже сброшен строкой выше).
      setTimeout(() => {
        if (document.getElementById('tab-ai-connect')?.classList.contains('active')) loadAiConnectTab();
        if (document.getElementById('tab-ai-features')?.classList.contains('active')) loadAiFeaturesTab();
      }, 300);
    } else {
      status.textContent = t('dash.serverNotResponding');
      status.classList.add('err');
    }
  } catch (e) {
    status.textContent = '✗ ' + e.message; status.classList.add('err');
  } finally {
    btn.disabled = false;
  }
});

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
    if (tab === 'ai-connect')      loadAiConnectTab();
    if (tab === 'ai-features')     loadAiFeaturesTab();
    if (tab === 'gen-rules')       loadGenRulesTab();
    if (tab === 'lib-kindred')     loadKindred();
    if (tab === 'lib-mortal')      loadMortalLib();
    if (tab === 'lib-disciplines') {
      document.querySelectorAll('.disciplines-subtab-btn').forEach(b => {
        const isAll = b.dataset.discGroup === 'all';
        b.classList.toggle('active', isAll);
        b.setAttribute('aria-pressed', isAll ? 'true' : 'false');
      });
      loadLibrary('all');
    }
    if (tab === 'lib-psychics')    loadPsychicsLibrary();
    if (tab === 'lib-merits')      loadMeritsLibrary('physical');
    if (tab === 'lib-flaws')       loadFlawsLibrary('физические');
    if (tab === 'lib-backgrounds') loadBackgroundsLibrary('general');
    if (tab === 'guide')           loadGuideTab();
    if (tab === 'backup')          loadBackupTab();
    if (tab === 'trash')           loadTrashTab();
  });

  // Merits subtabs (physical/mental/social/supernatural)
  document.addEventListener('click', e => {
    const btn = e.target.closest('.merits-subtab-btn');
    if (!btn) return;
    const cat = btn.dataset.meritCat;
    if (!cat) return;

    const bar = btn.closest('.merits-subtab-bar');
    bar.querySelectorAll('.merits-subtab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadMeritsLibrary(cat);
  });

  // Flaws subtabs (физические/умственные/социальные/сверхъестественные)
  document.addEventListener('click', e => {
    const btn = e.target.closest('.flaws-subtab-btn');
    if (!btn) return;
    const cat = btn.dataset.flawCat;
    if (!cat) return;

    const bar = btn.closest('.flaws-subtab-bar');
    bar.querySelectorAll('.flaws-subtab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadFlawsLibrary(cat);
  });

  // Backgrounds subtabs (general/vampire/ghoul/mage/changeling)
  document.addEventListener('click', e => {
    const btn = e.target.closest('.backgrounds-subtab-btn');
    if (!btn) return;
    const cat = btn.dataset.bgCat;
    if (!cat) return;

    const bar = btn.closest('.backgrounds-subtab-bar');
    bar.querySelectorAll('.backgrounds-subtab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadBackgroundsLibrary(cat);
  });

  // Disciplines subtabs (all/combo/koldun/necromancy/thaumaturgy/dark-thaumaturgy/assamite/setite)
  document.addEventListener('click', e => {
    const btn = e.target.closest('.disciplines-subtab-btn');
    if (!btn) return;
    const group = btn.dataset.discGroup;
    if (!group) return;
    const bar = btn.closest('.disciplines-subtab-bar');
    bar.querySelectorAll('.disciplines-subtab-btn').forEach(b => {
      b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
    loadLibrary(group);
  });

  // Kindred subtabs (clans/sects), вложены в единственную панель верхней
  // вкладки «Сородичи» (lib-kindred). Не переиспользуют .tab-btn/.tab-panel —
  // эти классы ловит глобальный делегат выше в этом файле, который погасил бы
  // активность верхней вкладки при клике сюда. Визуал переиспользует
  // .disciplines-subtab-bar/-btn (тот же компонент, что и у «Дисциплин»),
  // поведение — отдельный data-атрибут и отдельный обработчик.
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-kin-group]');
    if (!btn) return;
    const group = btn.dataset.kinGroup;
    const bar = btn.closest('.disciplines-subtab-bar');
    bar.querySelectorAll('[data-kin-group]').forEach(b => {
      b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
    document.querySelectorAll('.kindred-subpanel').forEach(p =>
      p.classList.toggle('active', p.id === `kin-sub-${group}`));
    loadKindred(group);
  });

  // «Смертные» (2026-08-08) — тот же паттерн, что «Сородичи» выше, свой data-атрибут/класс.
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-mort-group]');
    if (!btn) return;
    const group = btn.dataset.mortGroup;
    const bar = btn.closest('.disciplines-subtab-bar');
    bar.querySelectorAll('[data-mort-group]').forEach(b => {
      b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
    document.querySelectorAll('.mortal-subpanel').forEach(p =>
      p.classList.toggle('active', p.id === `mort-sub-${group}`));
    loadMortalLib(group);
  });
});

// ═══════════════════════════════════════════════════════════════
// AI Models Settings tab
// ═══════════════════════════════════════════════════════════════

// Fallback if /api/openrouter/models is unavailable
const OR_FREE_MODELS_FALLBACK = [
  { id: 'google/gemma-4-26b-a4b-it:free',   label: 'Google Gemma 4 26B (Vision)' },
  { id: 'nvidia/nemotron-nano-12b-v2-vl:free', label: 'Nvidia Nemotron Nano 12B VL' },
  { id: 'moonshotai/kimi-k2.6:free',         label: 'Moonshot Kimi K2.6' },
  { id: 'openrouter/free',                   label: 'Free Models Router' },
];
// Keep OR_FREE_MODELS alias for other usages
const OR_FREE_MODELS = OR_FREE_MODELS_FALLBACK;

// Per-feature curated model lists (fallback when live fetch fails)
const OR_FEAT_MODELS_FALLBACK = {
  // Vision-capable models — для анализа изображений персонажей
  appearance: [
    { id: 'meta-llama/llama-3.2-11b-vision-instruct:free', label: 'Llama 3.2 11B Vision' },
    { id: 'qwen/qwen2.5-vl-7b-instruct:free',             label: 'Qwen 2.5 VL 7B (Vision)' },
    { id: 'google/gemma-3-27b-it:free',                   label: 'Google Gemma 3 27B' },
    { id: 'microsoft/phi-4-multimodal-instruct:free',     label: 'Microsoft Phi-4 Multimodal' },
    { id: 'openrouter/free',                              label: 'Free Models Router' },
  ],
  // Strong instruction-following models — для структурированных карточек локаций
  locations: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
    { id: 'deepseek/deepseek-chat:free',            label: 'DeepSeek Chat' },
    { id: 'google/gemma-3-27b-it:free',             label: 'Google Gemma 3 27B' },
    { id: 'mistralai/mistral-7b-instruct:free',     label: 'Mistral 7B Instruct' },
    { id: 'openrouter/free',                        label: 'Free Models Router' },
  ],
  // Creative/narrative models — для дневников и финалов сессии
  prose: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
    { id: 'deepseek/deepseek-r1:free',              label: 'DeepSeek R1 (Reasoning)' },
    { id: 'qwen/qwen3-235b-a22b:free',              label: 'Qwen3 235B A22B' },
    { id: 'google/gemma-3-27b-it:free',             label: 'Google Gemma 3 27B' },
    { id: 'openrouter/free',                        label: 'Free Models Router' },
  ],
  // Long-context narrative — сценарии модулей и NPC-карточки
  scenario: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
    { id: 'deepseek/deepseek-r1:free',              label: 'DeepSeek R1 (Reasoning)' },
    { id: 'qwen/qwen3-235b-a22b:free',              label: 'Qwen3 235B A22B' },
    { id: 'google/gemma-3-27b-it:free',             label: 'Google Gemma 3 27B' },
    { id: 'openrouter/free',                        label: 'Free Models Router' },
  ],
  // Conversational/character models — для реплик НПС в характере
  dialogue: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
    { id: 'qwen/qwen3-235b-a22b:free',              label: 'Qwen3 235B A22B' },
    { id: 'google/gemma-3-27b-it:free',             label: 'Google Gemma 3 27B' },
    { id: 'mistralai/mistral-7b-instruct:free',     label: 'Mistral 7B Instruct' },
    { id: 'openrouter/free',                        label: 'Free Models Router' },
  ],
  // Strong instruction-following models — для англоязычного промта по описанию внешности
  prompt: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
    { id: 'deepseek/deepseek-chat:free',            label: 'DeepSeek Chat' },
    { id: 'qwen/qwen3-235b-a22b:free',              label: 'Qwen3 235B A22B' },
    { id: 'google/gemma-3-27b-it:free',             label: 'Google Gemma 3 27B' },
    { id: 'openrouter/free',                        label: 'Free Models Router' },
  ],
  // Conversational/character models — для характера и голоса по внешности и биографии
  personality: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
    { id: 'qwen/qwen3-235b-a22b:free',              label: 'Qwen3 235B A22B' },
    { id: 'google/gemma-3-27b-it:free',             label: 'Google Gemma 3 27B' },
    { id: 'deepseek/deepseek-chat:free',            label: 'DeepSeek Chat' },
    { id: 'openrouter/free',                        label: 'Free Models Router' },
  ],
  // Creative/narrative models — для биографии по информации/отношениям персонажа
  biography: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
    { id: 'deepseek/deepseek-r1:free',              label: 'DeepSeek R1 (Reasoning)' },
    { id: 'qwen/qwen3-235b-a22b:free',              label: 'Qwen3 235B A22B' },
    { id: 'google/gemma-3-27b-it:free',             label: 'Google Gemma 3 27B' },
    { id: 'openrouter/free',                        label: 'Free Models Router' },
  ],
  // Strong instruction-following models — для числового V20-листа по карточке персонажа
  sheet: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
    { id: 'deepseek/deepseek-r1:free',              label: 'DeepSeek R1 (Reasoning)' },
    { id: 'qwen/qwen3-235b-a22b:free',              label: 'Qwen3 235B A22B' },
    { id: 'google/gemma-3-27b-it:free',             label: 'Google Gemma 3 27B' },
    { id: 'openrouter/free',                        label: 'Free Models Router' },
  ],
};

// Build per-feature model lists. Every feature gets ALL free models reported live by
// the API, with «openrouter/free» pinned to the top so it's always available. The
// curated OR_FEAT_MODELS_FALLBACK is used only when the live fetch failed (offline).
function _buildFeatOrModels(liveModels) {
  if (!liveModels?.length) return { ...OR_FEAT_MODELS_FALLBACK };
  const rest = liveModels.filter(m => m.id !== 'openrouter/free');
  const free = liveModels.find(m => m.id === 'openrouter/free') || { id: 'openrouter/free', label: 'Free Models Router' };
  const all  = [free, ...rest];                       // openrouter/free first, then every free model
  const result = {};
  for (const feat of Object.keys(OR_FEAT_MODELS_FALLBACK)) result[feat] = all;
  return result;
}
const CLAUDE_MODELS = [
  { id: 'claude-opus-5',             label: t('s.modelOpus5') },
  { id: 'claude-sonnet-5',           label: t('s.modelSonnet5') },
  { id: 'claude-haiku-4-5-20251001', label: t('s.modelHaiku45') },
];
const OPENAI_MODELS = [
  { id: 'gpt-4o-mini',  label: t('s.modelGptMini') },
  { id: 'gpt-4o',       label: t('s.modelGpt4o') },
  { id: 'gpt-4.1',      label: t('s.modelGpt41') },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
];
// Сверено с живым списком моделей Google (GET /v1beta/models, 2026-07-16) —
// только текстовые модели генерации прозы, без TTS/image/robotics/preview-шлака.
const GEMINI_MODELS = [
  { id: 'gemini-3.1-pro-preview',   label: t('s.modelGem31Pro') },
  { id: 'gemini-3.1-flash-lite',    label: t('s.modelGem31Flash') },
  { id: 'gemini-2.5-pro',           label: t('s.modelGem25Pro') },
  { id: 'gemini-2.5-flash',         label: t('s.modelGem25Flash') },
];
// Resolve a feature's model list by provider.
function _modelsForProvider(provider, orModels, lmModels) {
  if (provider === 'claude')  return CLAUDE_MODELS;
  if (provider === 'openai')  return OPENAI_MODELS;
  if (provider === 'gemini')  return GEMINI_MODELS;
  if (provider === 'lmstudio') return lmModels || [{ id: '', label: t('ais.lmsAutoModel') }];
  return orModels;
}

let _aiConnectLoaded  = false;
let _aiFeaturesLoaded = false;
// Оба флага сбрасываются вместе — сохранение ключа/OAuth на «Подключение AI» меняет
// orSettings, который также влияет на «Назначение генераций» (П.4, 2026-08-07: было
// одним _aiSettingsLoaded на цельный loadAiSettings(), разбито на два независимых
// загрузчика без общего кеша — см. техспеку 2026-08-07-tools-tab-restructure-techspec.md §4.2).
function _resetAiSettingsCache() {
  _aiConnectLoaded  = false;
  _aiFeaturesLoaded = false;
}
let _orModelsRuntime  = null; // cached after first fetch

function _renderFeatCard(feat, icon, label, desc, pref, orModels, lmModels) {
  const provider = pref.provider || 'openrouter';
  const model    = pref.model;
  const models   = _modelsForProvider(provider, orModels, lmModels);
  const opts = models.map(m =>
    `<option value="${escHtml(m.id)}" ${model === m.id ? 'selected' : ''}>${escHtml(m.label)}</option>`
  ).join('');
  const radio = (val, lbl) =>
    `<label class="ais-feat-prov-btn">
       <input type="radio" name="feat-${feat}" value="${val}" ${provider === val ? 'checked' : ''}>
       <span>${lbl}</span>
     </label>`;
  // Порядок блоков = порядок решения: что генерируем → кто генерирует → какой моделью.
  // Раньше выбор провайдера стоял в одной строке с заголовком, у правого края карточки:
  // при ширине панели ~1100px между названием функции и его переключателем оставалось
  // ~700px пустоты, и связь «эта функция ↔ этот провайдер» держалась только на строке.
  return `
    <div class="ais-feat-card" data-feat="${feat}">
      <div class="ais-feat-card-header">
        <span class="ais-feat-icon" aria-hidden="true">${icon}</span>
        <div class="ais-feat-meta">
          <div class="ais-feat-label">${label}</div>
          <div class="ais-feat-desc">${desc}</div>
        </div>
      </div>
      <div class="ais-feat-card-radios" role="radiogroup" aria-label="${t('s.providerAria', { label })}">
        ${radio('openrouter', 'OpenRouter')}
        ${radio('openai', 'GPT')}
        ${radio('claude', 'Claude')}
        ${radio('gemini', 'Gemini')}
        ${radio('lmstudio', t('ais.featLmStudio'))}
      </div>
      <select class="ais-feat-model-select" id="feat-${feat}-model" aria-label="${t('s.modelAria', { label })}">${opts}</select>
    </div>`;
}

// Human-readable Claude auth state for the credentials section.
function _claudeAuthHint(s) {
  const o = s.claudeOauth;
  if (o && !o.expired) {
    const left = o.expiresIn != null ? t('ais.tokenExpiry', { n: o.expiresIn }) : '';
    return t('ais.claudeOAuthActive', { subscription: escHtml(o.subscription), left });
  }
  if (o && o.expired) return t('ais.claudeOAuthExpired');
  if (s.hasAnthropicKey) return t('ais.claudeKeyActive');
  return t('ais.claudeNotAuth');
}

// Backward-compat helper: prefs[key] may be string (old) or {provider, model} (new)
function _getPref(prefs, key, defProv = 'openrouter') {
  const v = prefs[key];
  if (!v)                     return { provider: defProv, model: null };
  if (typeof v === 'string')  return { provider: v, model: null };
  return { provider: v.provider || defProv, model: v.model || null };
}

// П.4 (2026-08-07): разбито из единой loadAiSettings() на два независимых загрузчика —
// «Подключение AI» (ключи/OAuth, orSettings) и «Назначение генераций» (feat-карточки,
// orModels + localStorage). Независимые fetch, без общего кеша между ними — см. техспеку
// 2026-08-07-tools-tab-restructure-техspec.md §4.2 для обоснования.
async function loadAiConnectTab() {
  if (_aiConnectLoaded) return;
  _aiConnectLoaded = true;
  const el = document.getElementById('ai-connect-content');

  let orSettings = { OPENROUTER_MODEL: '', hasKey: false, hasOpenAIKey: false, hasAnthropicKey: false, claudeOauth: null };
  try { orSettings = await fetch('/api/settings').then(r => r.json()); } catch {}

  el.innerHTML = `
    <div class="ais-left">

      <!-- OpenRouter section -->
      <div class="ais-section">
        <div class="ais-section-title">${t('ais.orTitle')}</div>
        <div class="ais-section-hint">${t('ais.orHint')}</div>

        <div class="ais-field">
          <label class="ais-label">API Key</label>
          <input class="ais-input" id="ais-or-key" type="password"
            placeholder="${orSettings.hasKey ? t('ais.orKeyPhSet') : t('ais.orKeyPhEmpty')}"
            autocomplete="new-password">
          <div class="ais-field-hint">${t('ais.orHintKey')}</div>
        </div>

        <button class="ais-confirm-btn" id="ais-or-save">${t('ais.orSaveBtn')}</button>
        <div class="ais-status" id="ais-or-status"></div>
      </div>

      <!-- OpenAI / GPT section -->
      <div class="ais-section">
        <div class="ais-section-title">${t('ais.openaiTitle')}</div>
        <div class="ais-section-hint">${t('ais.openaiHint')}</div>

        <div class="ais-field">
          <label class="ais-label">API Key
            <span class="ais-key-state ${orSettings.hasOpenAIKey ? 'ok' : ''}">${orSettings.hasOpenAIKey ? t('ais.keySet') : t('ais.keyNotSet')}</span>
          </label>
          <input class="ais-input" id="ais-openai-key" type="password"
            placeholder="${orSettings.hasOpenAIKey ? t('ais.openaiKeyPhSet') : t('ais.openaiKeyPhEmpty')}"
            autocomplete="new-password">
          <div class="ais-field-hint">${t('ais.openaiHintKey')}</div>
        </div>

        <button class="ais-confirm-btn" id="ais-openai-save">${t('ais.openaiSaveBtn')}</button>
        <div class="ais-status" id="ais-openai-status"></div>
      </div>

      <!-- Google Gemini section -->
      <div class="ais-section">
        <div class="ais-section-title">${t('ais.geminiTitle')}</div>
        <div class="ais-section-hint">${t('ais.geminiHint')}</div>

        <div class="ais-field">
          <label class="ais-label">${t('ais.geminiAccessLabel')}</label>
          <div class="ais-claude-btnrow">
            <label class="ais-feat-prov-btn">
              <input type="radio" name="gemini-auth-type" id="ais-gemini-auth-apikey" value="api-key" ${(orSettings.GEMINI_AUTH_TYPE || 'api-key') === 'api-key' ? 'checked' : ''}>
              <span>${t('ais.geminiApiKeyTag')}</span>
            </label>
            <label class="ais-feat-prov-btn">
              <input type="radio" name="gemini-auth-type" id="ais-gemini-auth-vertex" value="vertex" ${orSettings.GEMINI_AUTH_TYPE === 'vertex' ? 'checked' : ''}>
              <span>${t('ais.geminiVertexTag')}</span>
            </label>
          </div>
        </div>

        <div id="ais-gemini-apikey-fields">
          <div class="ais-field">
            <label class="ais-label">${t('ais.geminiApiKeyLabel')}
              <span class="ais-key-state ${orSettings.hasGeminiKey ? 'ok' : ''}">${orSettings.hasGeminiKey ? t('ais.keySet') : t('ais.keyNotSet')}</span>
            </label>
            <input class="ais-input" id="ais-gemini-key" type="password"
              placeholder="${orSettings.hasGeminiKey ? t('ais.geminiKeyPhSet') : t('ais.geminiKeyPhEmpty')}"
              autocomplete="new-password">
            <div class="ais-field-hint">${t('ais.geminiKeyHint')}</div>
          </div>
        </div>

        <div id="ais-gemini-vertex-fields" style="display:none">
          <div class="ais-field">
            <label class="ais-label">${t('ais.geminiProjectLabel')}</label>
            <input class="ais-input" id="ais-gemini-project" type="text"
              placeholder="${t('ais.geminiProjectPh')}" value="${escAttr(orSettings.GOOGLE_CLOUD_PROJECT || '')}">
          </div>
          <div class="ais-field">
            <label class="ais-label">${t('ais.geminiRegionLabel')}</label>
            <input class="ais-input" id="ais-gemini-location" type="text"
              placeholder="us-central1" value="${escAttr(orSettings.GOOGLE_CLOUD_LOCATION || '')}">
          </div>
          <div class="ais-field">
            <label class="ais-label">${t('ais.geminiSaLabel')}
              <span class="ais-key-state ${orSettings.hasVertexKeyFile ? 'ok' : ''}">${orSettings.hasVertexKeyFile ? t('ais.keySet') : t('ais.keyNotSet')}</span>
            </label>
            <textarea class="ais-input" id="ais-gemini-vertex-json" rows="4"
              placeholder='${orSettings.hasVertexKeyFile ? t('ais.geminiVertexPhSet') : t('ais.geminiVertexPh')}'></textarea>
            <div class="ais-field-hint">${t('ais.geminiSaHint')}</div>
          </div>
        </div>

        <div class="ais-field">
          <label class="ais-label">${t('ais.geminiModelLabel')}</label>
          <select class="ais-input" id="ais-gemini-model">
            ${GEMINI_MODELS.map(m => `<option value="${escHtml(m.id)}" ${(orSettings.GEMINI_MODEL || 'gemini-2.5-flash') === m.id ? 'selected' : ''}>${escHtml(m.label)}</option>`).join('')}
          </select>
        </div>

        <button class="ais-confirm-btn" id="ais-gemini-save">${t('ais.geminiSaveBtn')}</button>
        <div class="ais-status" id="ais-gemini-status"></div>
      </div>

      <!-- Claude / Anthropic section -->
      <div class="ais-section">
        <div class="ais-section-title">${t('ais.claudeTitle')}</div>
        <div class="ais-section-hint" id="ais-claude-hint">${_claudeAuthHint(orSettings)}</div>

        <!-- Вариант 1: вход через Claude Code (OAuth, без API-ключа) -->
        <div class="ais-field">
          <label class="ais-label">${t('ais.claudeOAuthHeader')} <span class="ais-key-state">${t('ais.claudeOAuthHint')}</span></label>
          <div class="ais-claude-btnrow">
            <button class="ais-confirm-btn ais-claude-oauth-btn" id="ais-claude-login">${t('ais.claudeLoginBtn')}</button>
            <button class="ais-confirm-btn ais-ghost-btn" id="ais-claude-status">${t('ais.claudeStatusBtn')}</button>
            ${orSettings.claudeOauth?.expired && orSettings.claudeOauth?.hasRefresh
              ? `<button class="ais-confirm-btn ais-ghost-btn" id="ais-claude-refresh">${t('ais.claudeRefreshBtn')}</button>` : ''}
          </div>
          <div class="ais-claude-code-form" id="ais-claude-code-form" style="display:none">
            <input class="ais-input ais-mono" id="ais-claude-code" placeholder="${t('ais.claudeCodePh')}">
            <button class="ais-confirm-btn" id="ais-claude-code-submit">${t('ais.claudeCodeSubmitBtn')}</button>
          </div>
          <div class="ais-field-hint">${t('ais.claudeOAuthDesc')}</div>
          <div class="ais-status" id="ais-claude-oauth-status"></div>
        </div>

        <!-- Вариант 2: API-ключ -->
        <div class="ais-field">
          <label class="ais-label">${t('ais.claudeKeyLabel')}
            <span class="ais-key-state ${orSettings.hasAnthropicKey ? 'ok' : ''}">${orSettings.hasAnthropicKey ? t('ais.keySet') : t('ais.keyNotSet')}</span>
          </label>
          <input class="ais-input" id="ais-anthropic-key" type="password"
            placeholder="${orSettings.hasAnthropicKey ? t('ais.claudeKeyPhSet') : t('ais.claudeKeyPhEmpty')}"
            autocomplete="new-password">
          <div class="ais-field-hint">${t('ais.claudeKeyHint')}</div>
        </div>

        <button class="ais-confirm-btn" id="ais-anthropic-save">${t('ais.claudeSaveBtn')}</button>
        <div class="ais-status" id="ais-anthropic-status"></div>
      </div>

      <!-- LM Studio section (local, no API key) -->
      <div class="ais-section">
        <div class="ais-section-title">${t('ais.lmsTitle')}
          <span class="ais-live-dot ais-lms-dot" id="ais-lms-dot" title="${t('ais.lmsUrlHint')}">⏳ ${t('ais.lmsProbing')}</span>
        </div>
        <div class="ais-section-hint">${t('ais.lmsHint')}</div>

        <div class="ais-field">
          <label class="ais-label">${t('ais.lmsUrlLabel')}</label>
          <input class="ais-input" id="ais-lmstudio-url" type="text"
            placeholder="${t('ais.lmsUrlPh')}" value="${escAttr(orSettings.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1')}">
          <div class="ais-field-hint">${t('ais.lmsUrlHint')}</div>
        </div>

        <div class="ais-field">
          <label class="ais-label">${t('ais.lmsModelLabel')}</label>
          <input class="ais-input" id="ais-lmstudio-model" type="text"
            placeholder="${t('ais.lmsModelPh')}" value="${escAttr(orSettings.LMSTUDIO_MODEL || '')}">
          <div class="ais-field-hint">${t('ais.lmsModelHint')}</div>
        </div>

        <button class="ais-confirm-btn" id="ais-lmstudio-save">${t('ais.lmsSaveBtn')}</button>
        <div class="ais-status" id="ais-lmstudio-status"></div>
      </div>

    </div><!-- /ais-left -->`;

  // Save an API key to .env (shared by OpenRouter / OpenAI / Claude sections)
  const _saveKey = async (btnId, statusId, inputId, field, btnLabel) => {
    const btn    = document.getElementById(btnId);
    const status = document.getElementById(statusId);
    const key    = document.getElementById(inputId).value;
    btn.disabled = true; btn.textContent = t('ais.saving');
    status.className = 'ais-status';
    try {
      const d = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: key })
      }).then(r => r.json());
      if (!d.ok) throw new Error(d.error);
      status.textContent = d.needsRestart ? t('ais.savedRestart') : t('ais.saved');
      status.classList.add('ok');
      _resetAiSettingsCache();
      if (d.needsRestart) setTimeout(() => { _resetAiSettingsCache(); loadAiConnectTab(); }, 2500);
    } catch (e) {
      status.textContent = t('ais.saveError') + e.message; status.classList.add('err');
    } finally { btn.disabled = false; btn.textContent = btnLabel; }
  };

  document.getElementById('ais-or-save').addEventListener('click',
    () => _saveKey('ais-or-save', 'ais-or-status', 'ais-or-key', 'OPENROUTER_API_KEY', t('ais.orSaveBtn')));
  document.getElementById('ais-openai-save').addEventListener('click',
    () => _saveKey('ais-openai-save', 'ais-openai-status', 'ais-openai-key', 'OPENAI_API_KEY', t('ais.openaiSaveBtn')));
  // Переключатель вида доступа — показывает поля своего варианта.
  const _geminiToggleAuthFields = () => {
    const vertex = document.getElementById('ais-gemini-auth-vertex').checked;
    document.getElementById('ais-gemini-apikey-fields').style.display = vertex ? 'none' : '';
    document.getElementById('ais-gemini-vertex-fields').style.display = vertex ? '' : 'none';
  };
  document.getElementById('ais-gemini-auth-apikey').addEventListener('change', _geminiToggleAuthFields);
  document.getElementById('ais-gemini-auth-vertex').addEventListener('change', _geminiToggleAuthFields);
  _geminiToggleAuthFields();

  document.getElementById('ais-gemini-save').addEventListener('click', async () => {
    const btn    = document.getElementById('ais-gemini-save');
    const status = document.getElementById('ais-gemini-status');
    const key    = document.getElementById('ais-gemini-key').value;
    const model  = document.getElementById('ais-gemini-model').value;
    const authType = document.getElementById('ais-gemini-auth-vertex').checked ? 'vertex' : 'api-key';
    const project  = document.getElementById('ais-gemini-project').value.trim();
    const location = document.getElementById('ais-gemini-location').value.trim();
    const vertexJson = document.getElementById('ais-gemini-vertex-json').value;
    btn.disabled = true; btn.textContent = t('ais.saveShort');
    status.className = 'ais-status'; status.textContent = '';
    try {
      const body = { restart: true, GEMINI_AUTH_TYPE: authType };
      if (authType === 'vertex') {
        body.GOOGLE_CLOUD_PROJECT = project;
        body.GOOGLE_CLOUD_LOCATION = location;
        if (vertexJson.trim()) body.GEMINI_VERTEX_KEY_JSON = vertexJson;
      } else {
        if (key !== '') body.GEMINI_API_KEY = key;
      }
      if (model) body.GEMINI_MODEL = model;
      const d = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json());
      if (!d.ok) throw new Error(d.error);
      status.textContent = d.needsRestart ? t('ais.savedRestart') : t('ais.saved');
      status.classList.add('ok');
      _resetAiSettingsCache();
      if (d.needsRestart) setTimeout(() => { _resetAiSettingsCache(); loadAiConnectTab(); }, 2500);
    } catch (e) {
      status.textContent = t('ais.saveError') + e.message; status.classList.add('err');
    } finally { btn.disabled = false; btn.textContent = t('ais.geminiSaveBtn'); }
  });
  document.getElementById('ais-anthropic-save').addEventListener('click',
    () => _saveKey('ais-anthropic-save', 'ais-anthropic-status', 'ais-anthropic-key', 'ANTHROPIC_API_KEY', t('ais.claudeSaveBtn')));

  // LM Studio save (address + model, no API key)
  document.getElementById('ais-lmstudio-save').addEventListener('click', async () => {
    const btn    = document.getElementById('ais-lmstudio-save');
    const status = document.getElementById('ais-lmstudio-status');
    const url    = document.getElementById('ais-lmstudio-url').value.trim();
    const model  = document.getElementById('ais-lmstudio-model').value.trim();
    btn.disabled = true; btn.textContent = t('ais.saveShort');
    status.className = 'ais-status'; status.textContent = '';
    try {
      const body = { restart: true };
      if (url !== '') body.LMSTUDIO_BASE_URL = url;
      else body.LMSTUDIO_BASE_URL = '';
      if (model !== undefined) body.LMSTUDIO_MODEL = model;
      const d = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json());
      if (!d.ok) throw new Error(d.error);
      status.textContent = d.needsRestart ? t('ais.savedRestart') : t('ais.saved');
      status.classList.add('ok');
      _resetAiSettingsCache();
      if (d.needsRestart) setTimeout(() => { _resetAiSettingsCache(); loadAiConnectTab(); }, 2500);
    } catch (e) {
      status.textContent = t('ais.saveError') + e.message; status.classList.add('err');
    } finally { btn.disabled = false; btn.textContent = t('ais.lmsSaveBtn'); }
  });

  // Probe local AI servers (LM Studio) async after render — live status indicator
  const lmsDot = document.getElementById('ais-lms-dot');
  if (lmsDot) {
    const _setLmsDot = (state, label) => {
      lmsDot.className = `ais-live-dot ais-lms-dot ais-live-${state}`;
      lmsDot.textContent = label;
    };
    fetch('/api/settings/probe-local').then(r => r.json()).then(d => {
      _setLmsDot(d.lmStudioAvailable ? 'online' : 'offline', d.lmStudioAvailable ? t('ais.lmsOnline') : t('ais.lmsOffline'));
    }).catch(() => _setLmsDot('offline', t('ais.lmsOffline')));
  }

  // Claude Code OAuth login (no API key): open authorize URL, then paste the code
  let _claudeOauthState = null;
  const claudeOauthStatus = document.getElementById('ais-claude-oauth-status');
  document.getElementById('ais-claude-login')?.addEventListener('click', async () => {
    claudeOauthStatus.className = 'ais-status';
    claudeOauthStatus.textContent = t('ais.claudeOauthPreparing');
    try {
      const d = await fetch('/api/claude/oauth/start', { method: 'POST' }).then(r => r.json());
      if (!d.ok) throw new Error(d.error);
      _claudeOauthState = d.state;
      window.open(d.url, '_blank', 'noopener');
      document.getElementById('ais-claude-code-form').style.display = '';
      document.getElementById('ais-claude-code').focus();
      claudeOauthStatus.textContent = t('ais.claudeOauthOpened');
    } catch (e) { claudeOauthStatus.textContent = '✗ ' + e.message; claudeOauthStatus.classList.add('err'); }
  });
  document.getElementById('ais-claude-code-submit')?.addEventListener('click', async () => {
    const btn  = document.getElementById('ais-claude-code-submit');
    const code = document.getElementById('ais-claude-code').value.trim();
    if (!code) { claudeOauthStatus.className = 'ais-status err'; claudeOauthStatus.textContent = t('ais.claudeCodeNeeded'); return; }
    btn.disabled = true; btn.textContent = t('ais.saveShort');
    claudeOauthStatus.className = 'ais-status'; claudeOauthStatus.textContent = t('ais.claudeCodeExchanging');
    try {
      const d = await fetch('/api/claude/oauth/exchange', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state: _claudeOauthState })
      }).then(r => r.json());
      if (!d.ok) throw new Error(d.error);
      claudeOauthStatus.textContent = t('ais.claudeOauthSuccess', { sub: d.claudeOauth?.subscription || '—' });
      claudeOauthStatus.classList.add('ok');
      _resetAiSettingsCache(); setTimeout(loadAiConnectTab, 900);
    } catch (e) { claudeOauthStatus.textContent = '✗ ' + e.message; claudeOauthStatus.classList.add('err'); }
    finally { btn.disabled = false; btn.textContent = t('ais.claudeCodeSubmitBtn'); }
  });
  document.getElementById('ais-claude-status')?.addEventListener('click', async () => {
    claudeOauthStatus.className = 'ais-status'; claudeOauthStatus.textContent = t('ais.claudeOauthStatusUpdating');
    try { await fetch('/api/claude/status').then(r => r.json()); _resetAiSettingsCache(); loadAiConnectTab(); }
    catch (e) { claudeOauthStatus.textContent = '✗ ' + e.message; claudeOauthStatus.classList.add('err'); }
  });
  document.getElementById('ais-claude-refresh')?.addEventListener('click', async () => {
    const btn = document.getElementById('ais-claude-refresh');
    btn.disabled = true; btn.textContent = t('ais.saveShort');
    claudeOauthStatus.className = 'ais-status'; claudeOauthStatus.textContent = t('ais.claudeTokenUpdating');
    try {
      const d = await fetch('/api/claude/oauth/refresh', { method: 'POST' }).then(r => r.json());
      if (!d.ok) throw new Error(d.error);
      claudeOauthStatus.textContent = t('ais.claudeTokenUpdated'); claudeOauthStatus.classList.add('ok');
      _resetAiSettingsCache(); setTimeout(loadAiConnectTab, 700);
    } catch (e) { claudeOauthStatus.textContent = '✗ ' + e.message; claudeOauthStatus.classList.add('err'); btn.disabled = false; btn.textContent = t('ais.claudeRefreshBtn'); }
  });
}

// «Назначение генераций» (П.4/П.5, 2026-08-07) — не читает /api/settings: _renderFeatCard
// не использует orSettings нигде (проверено — только featOrModels/featPrefs), поэтому,
// в отличие от «Подключение AI», здесь только один fetch (модели OpenRouter).
async function loadAiFeaturesTab() {
  if (_aiFeaturesLoaded) return;
  _aiFeaturesLoaded = true;
  const el = document.getElementById('ai-features-content');

  // Fetch live OR models list (fallback to hardcoded on failure)
  let orModels = OR_FREE_MODELS_FALLBACK;
  try {
    const md = await fetch('/api/openrouter/models').then(r => r.json());
    if (md.ok && md.models?.length) orModels = md.models;
  } catch {}

  // Fetch live LM Studio models (empty on failure)
  let lmModels = [{ id: '', label: t('ais.lmsAutoModel') }];
  try {
    const ld = await fetch('/api/lmstudio/models').then(r => r.json());
    if (ld.ok && ld.models?.length) lmModels = [{ id: '', label: t('ais.lmsAutoModel') }, ...ld.models];
  } catch {}

  // Per-feature curated lists (reconciled against live data)
  const featOrModels = _buildFeatOrModels(orModels);

  const featPrefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
  const appearPref   = _getPref(featPrefs, 'appearance', 'openrouter');
  const locPref      = _getPref(featPrefs, 'locations',  'openrouter');
  const prosePref    = _getPref(featPrefs, 'prose',      'claude');
  const dialoguePref = _getPref(featPrefs, 'dialogue',   'openrouter');
  const promptPref   = _getPref(featPrefs, 'prompt',     'openrouter');
  const personalityPref = _getPref(featPrefs, 'personality', 'openrouter');
  const biographyPref   = _getPref(featPrefs, 'biography',   'openrouter');
  const sheetPref    = _getPref(featPrefs, 'sheet',      'claude');
  const scenarioPref = _getPref(featPrefs, 'scenario',   'openrouter');

  el.innerHTML = `
    <div class="ais-right">
      <div class="ais-section ais-features-section">
        <div class="ais-section-title">${t('ais.featTitle')}</div>
        <div class="ais-section-hint">${t('ais.featHint')}</div>

        <!-- Значки берутся из Segoe UI Emoji (см. .ais-feat-icon): 🪄 (Emoji 13.0)
             в системном шрифте Windows 10 нет, у «прозы» она рисовалась пустым
             квадратом — заменена на 📜. -->
        <div class="ais-feat-cards" id="ais-feat-cards">
          ${_renderFeatCard('appearance', '👁', t('ais.featAppearance'),    t('ais.featAppearanceDesc'), appearPref,   featOrModels.appearance, lmModels)}
          ${_renderFeatCard('locations',  '📍', t('ais.featLocations'),    t('ais.featLocationsDesc'),   locPref,      featOrModels.locations, lmModels)}
          ${_renderFeatCard('prose',      '📜', t('ais.featProse'),        t('ais.featProseDesc'),      prosePref,    featOrModels.prose, lmModels)}
          ${_renderFeatCard('dialogue',   '💬', t('ais.featDialogue'),     t('ais.featDialogueDesc'),   dialoguePref, featOrModels.dialogue, lmModels)}
          ${_renderFeatCard('prompt',     '🎨', t('ais.featPrompt'),       t('ais.featPromptDesc'),     promptPref,   featOrModels.prompt, lmModels)}
          ${_renderFeatCard('personality', '🎭', t('ais.featPersonality'), t('ais.featPersonalityDesc'), personalityPref, featOrModels.personality, lmModels)}
          ${_renderFeatCard('biography',  '📖', t('ais.featBiography'),    t('ais.featBiographyDesc'), biographyPref, featOrModels.biography, lmModels)}
          ${_renderFeatCard('sheet',      '📋', t('ais.featSheet'),        t('ais.featSheetDesc'),      sheetPref,    featOrModels.sheet, lmModels)}
          ${_renderFeatCard('scenario',   '📜', t('ais.featScenario'),     t('ais.featScenarioDesc'),   scenarioPref, featOrModels.scenario, lmModels)}
        </div>

        <div class="ais-feat-actions">
          <button class="ais-confirm-btn" id="ais-feat-save">${t('ais.featSaveBtn')}</button>
          <div class="ais-status" id="ais-feat-status" role="status" aria-live="polite"></div>
        </div>
      </div>
    </div><!-- /ais-right -->`;

  // Wire radio changes to swap model dropdown options
  el.querySelectorAll('.ais-feat-card').forEach(card => {
    const feat = card.dataset.feat;
    card.querySelectorAll(`input[name="feat-${feat}"]`).forEach(radio => {
      radio.addEventListener('change', () => {
        const sel = document.getElementById(`feat-${feat}-model`);
        if (!sel) return;
        const orList = featOrModels[feat] || OR_FEAT_MODELS_FALLBACK[feat] || OR_FREE_MODELS_FALLBACK;
        const models = _modelsForProvider(radio.value, orList, lmModels);
        sel.innerHTML = models.map(m =>
          `<option value="${escHtml(m.id)}">${escHtml(m.label)}</option>`
        ).join('');
      });
    });
  });

  document.getElementById('ais-feat-save').addEventListener('click', () => {
    const status = document.getElementById('ais-feat-status');
    const prefs  = {};
    for (const feat of ['appearance', 'locations', 'prose', 'dialogue', 'prompt', 'personality', 'biography', 'sheet', 'scenario']) {
      const provSel = document.querySelector(`input[name="feat-${feat}"]:checked`);
      const modSel  = document.getElementById(`feat-${feat}-model`);
      if (provSel) prefs[feat] = { provider: provSel.value, model: modSel?.value || null };
    }
    localStorage.setItem('ai-feature-prefs', JSON.stringify(prefs));
    status.textContent = t('ais.saved');
    status.className = 'ais-status ok';
    setTimeout(() => { status.textContent = ''; status.className = 'ais-status'; }, 2000);
  });
}

// ── Generation Rules tab (gen-rules) ────────────────────────────────────────
async function loadGenRulesTab() {
  const el = document.getElementById('gen-rules-content');
  if (!el) return;
  el.innerHTML = `<div class="loading-state"><div class="spinner"></div>${t('tools.genRules.loading')}</div>`;

  let currentMode = 'b';
  try {
    const data = await fetch('/api/settings').then(r => r.json());
    currentMode = data.GENERATION_MODE || 'b';
  } catch {
    el.innerHTML = `<div class="err">${t('tools.genRules.error')}</div>`;
    return;
  }

  const updateBadge = (mode) => {
    const badge = document.getElementById('gen-rules-badge');
    if (badge) badge.textContent = mode === 'c' ? '· C' : '· B';
  };
  updateBadge(currentMode);

  el.innerHTML = `
    <div class="ais-right">
      <div class="ais-section">
        <div class="ais-section-title">${t('tools.genRules.title')}</div>
        <div class="ais-section-hint">${t('tools.genRules.hint')}</div>

        <div class="gr-cards" id="gr-cards">
          <div class="gr-card${currentMode === 'b' ? ' active' : ''}" data-mode="b" role="radio" aria-checked="${currentMode === 'b'}" tabindex="0">
            <div class="gr-card-header">
              <input type="radio" name="gen-mode" value="b" ${currentMode === 'b' ? 'checked' : ''} aria-hidden="true" tabindex="-1">
              <span class="gr-card-title">${t('tools.genRules.cardB')}</span>
            </div>
            <div class="gr-card-desc">${t('tools.genRules.cardBDesc')}</div>
            <div class="gr-card-warning">${t('tools.genRules.cardBWarning')}</div>
            <details class="gr-card-details">
              <summary>${t('common.details')}</summary>
              <div class="gr-card-detail-text">${t('tools.genRules.cardBDetail')}</div>
            </details>
          </div>

          <div class="gr-card${currentMode === 'c' ? ' active' : ''}" data-mode="c" role="radio" aria-checked="${currentMode === 'c'}" tabindex="0">
            <div class="gr-card-header">
              <input type="radio" name="gen-mode" value="c" ${currentMode === 'c' ? 'checked' : ''} aria-hidden="true" tabindex="-1">
              <span class="gr-card-title">${t('tools.genRules.cardC')}</span>
            </div>
            <div class="gr-card-desc">${t('tools.genRules.cardCDesc')}</div>
            <details class="gr-card-details">
              <summary>${t('common.details')}</summary>
              <div class="gr-card-detail-text">${t('tools.genRules.cardCDetail')}</div>
            </details>
          </div>
        </div>

        <div class="ais-status" id="gr-status" role="status" aria-live="polite"></div>
      </div>
    </div>`;

  // Wire card click → radio select + confirm modal
  el.querySelectorAll('.gr-card').forEach(card => {
    const handler = async () => {
      const mode = card.dataset.mode;
      if (mode === currentMode) return; // no-op on same card

      const confirmed = await showConfirm(t('tools.genRules.confirmMsg'), {
        confirmText: t('ui.btn.save'),
        cancelText: t('ui.btn.cancel'),
      });
      if (!confirmed) return;

      const status = document.getElementById('gr-status');
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ GENERATION_MODE: mode, restart: false }),
        });
        const data = await res.json();
        if (data.ok) {
          currentMode = mode;
          updateBadge(mode);
          el.querySelectorAll('.gr-card').forEach(c => {
            const isActive = c.dataset.mode === mode;
            c.classList.toggle('active', isActive);
            c.setAttribute('aria-checked', isActive);
            c.querySelector('input[type="radio"]').checked = isActive;
          });
          status.textContent = t('tools.genRules.modeActive', { mode: mode.toUpperCase() });
          status.className = 'ais-status ok';
          setTimeout(() => { status.textContent = ''; status.className = 'ais-status'; }, 2000);
        } else {
          status.textContent = data.error || 'Error';
          status.className = 'ais-status err';
        }
      } catch (e) {
        status.textContent = e.message;
        status.className = 'ais-status err';
      }
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  });
}

async function runTool(tool, params, outId, btn) {
  const out = document.getElementById(outId);
  btn.disabled = true;
  btn.textContent = t('ais.running');
  out.className = 'output-area show';
  out.textContent = '$ powershell ' + tool + '.ps1\n\n';

  try {
    const res = await fetch('/api/run-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, params })
    });
    const data = await res.json();
    const cls = data.success ? 'ok' : 'err';
    out.innerHTML = `$ powershell ${tool}.ps1\n\n<span class="${cls}">${escHtml(data.output || t('ais.noOutput'))}</span>`;
    if (data.success) {
      STATE.characters = [];
      STATE.graph.inited = false;
      if (STATE.page === 'dashboard') loadDashboard();
    }
  } catch (e) {
    out.innerHTML = `<span class="err">${t('ais.serverConnError')}\n${e.message}</span>`;
  }

  btn.disabled = false;
  btn.textContent = getOrigLabel(btn.id);
}

// Run a Node CLI tool (cities/-aware) via /api/tool/:name with an args array.
// _NTR/_LATIN_TR/slugifyJS/escHtml/escAttr/showToast/showConfirm/getOrigLabel
// now live in public/utils.js (loaded before this file — see index.html).
async function runNodeTool(name, args, outId, btn) {
  const out = document.getElementById(outId);
  btn.disabled = true; btn.textContent = t('ais.running');
  out.className = 'output-area show'; out.textContent = `$ node tools/${name}.js\n\n`;
  let ok = false;
  try {
    const data = await fetch('/api/tool/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args }) }).then(r => r.json());
    ok = !!data.ok;
    const cls = ok ? 'ok' : 'err';
    out.innerHTML = `$ node tools/${name}.js\n\n<span class="${cls}">${escHtml(data.output || t('ais.noOutput'))}</span>`;
    if (ok) { STATE.characters = []; STATE.graph.inited = false; if (STATE.page === 'dashboard') loadDashboard(); }
  } catch (e) {
    out.innerHTML = `<span class="err">${t('ais.connError')}\n${e.message}</span>`;
  }
  btn.disabled = false; btn.textContent = getOrigLabel(btn.id) || t('ais.ready');
  return ok;
}

// Character API routes are keyed by ASCII slug, not the Cyrillic display name
// (avoids percent-encoded Cyrillic in the URL bar). Modular module-only NPCs have
// no slug — those fall back to the raw name, which the dialogue route also accepts.
function _charSlug(name) {
  return STATE.characters.find(c => c.name === name)?.slug || name;
}

// One editable relationship row (name + type-picker + mutual checkbox + description + delete)
// for the «Отношения» tab (2026-08-08, Фаза 3 — добавлен чекбокс «Взаимно», Фаза 2 — тип и
// описание разделены, было одно поле).
function _relRowHtml(target = '', relType = '', description = '', mutual = false) {
  return `<div class="cdet-rel-row">
    <div class="cdet-rel-row-top">
      <input class="cdet-rel-name-inp" list="cdet-rel-names" placeholder="${t('relmgr.namePh')}" value="${escAttr(target)}">
      <div class="cdet-field-with-pick">
        <input class="cdet-rel-type-inp" placeholder="${t('relmgr.typePh')}" value="${escAttr(relType)}">
        <button type="button" class="cdet-lib-pick-btn" data-pick-rel-type="1" title="${t('relmgr.typeLibBtn')}" aria-label="${t('relmgr.typeLibAria')}">📚</button>
      </div>
      <button class="cdet-rel-del-btn" type="button" title="${t('relmgr.deleteTitle')}">✕</button>
    </div>
    <label class="cdet-rel-mutual">
      <input type="checkbox" class="cdet-rel-mutual-cb"${mutual ? ' checked' : ''}> ${t('relmgr.mutual')}
    </label>
    <textarea class="cdet-rel-desc-inp" placeholder="${t('relmgr.descPh')}" rows="2">${escHtml(description)}</textarea>
  </div>`;
}

// Compact, safe Markdown → HTML renderer for module files & chronicle prose.
// Escapes first, then applies a limited block/inline grammar. Links render as
// Resolve a markdown link [text](href) to an HTML element.
// Characters and locations become clickable links that open their detail modals.
// text и href приходят уже через escHtml (&<> экранированы, кавычки — нет),
// поэтому в атрибуты дописываем экранирование кавычек, а внешние ссылки
// пропускаем только по белому списку схем: всё прочее (javascript:, data:,
// относительные пути на файлы) — инертный текст.
function resolveMdLink(text, href) {
  href = href.trim().replace(/^&lt;([\s\S]*)&gt;$/, '$1').trim(); // CommonMark: [t](<путь>)
  const attr = s => s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const inert = `<span class="md-link">${text}</span>`;
  const entitySlug = () => {
    const slug = href.replace(/\.md$/, '').split('/').pop();
    return /^[a-z0-9_-]+$/i.test(slug) ? slug : null;
  };
  if (/\/characters\//.test(href)) {
    const slug = entitySlug();
    return slug ? `<a class="md-link md-link-char" data-char-slug="${slug}" href="#">${text}</a>` : inert;
  }
  if (/\/locations\//.test(href)) {
    const slug = entitySlug();
    return slug ? `<a class="md-link md-link-loc" data-loc-slug="${slug}" href="#">${text}</a>` : inert;
  }
  if (href.startsWith('#')) {
    return `<a class="md-link md-link-anchor" href="${attr(href)}">${text}</a>`;
  }
  if (/^(https?:\/\/|mailto:)/i.test(href)) {
    return `<a class="md-link" href="${attr(href)}" target="_blank" rel="noopener">${text}</a>`;
  }
  return inert;
}

// GitHub-style heading slug (must stay deterministic — docs/guide.md's TOC
// hardcodes anchors like #7-сессия-живой-режим-игры against this exact shape).
function slugifyHeading(text) {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
}

// styled text (relative .md paths don't resolve in the browser).
function mdInline(s) {
  return escHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => resolveMdLink(t, h));
}
function mdToHtmlBlock(md) {
  if (!md) return '';
  const lines = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let html = '', i = 0;
  const usedSlugs = new Map();
  const nextId = text => {
    const base = slugifyHeading(text) || 'section';
    const n = (usedSlugs.get(base) || 0) + 1;
    usedSlugs.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
  const isBlockStart = t => /^(#{1,6}\s|>|[-*]\s|\d+\.\s|\||```)/.test(t) || /^---+$/.test(t);
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }

    if (/^```/.test(t)) {
      i++;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      i++; // skip closing fence
      html += `<pre class="md-pre"><code>${escHtml(buf.join('\n'))}</code></pre>`;
      continue;
    }

    if (/^---+$/.test(t)) { html += '<hr class="md-hr">'; i++; continue; }

    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const lvl = Math.min(h[1].length, 6); const id = nextId(h[2]); html += `<div class="md-h md-h${lvl}" id="${id}">${mdInline(h[2])}</div>`; i++; continue; }

    if (/^>\s?/.test(t)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) { buf.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
      html += `<blockquote class="md-quote">${mdInline(buf.join(' '))}</blockquote>`; continue;
    }

    if (/^\|/.test(t) && i + 1 < lines.length && /^\|[\s:|-]+\|?$/.test(lines[i + 1].trim())) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i].trim())) { rows.push(lines[i].trim()); i++; }
      const cells = r => r.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      html += '<table class="md-table"><thead><tr>' + head.map(c => `<th>${mdInline(c)}</th>`).join('') +
        '</tr></thead><tbody>' + body.map(r => '<tr>' + r.map(c => `<td>${mdInline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>';
      continue;
    }

    if (/^[-*]\s+/.test(t)) {
      const buf = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) { buf.push(lines[i].trim().replace(/^[-*]\s+/, '')); i++; }
      html += '<ul class="md-ul">' + buf.map(b => `<li>${mdInline(b)}</li>`).join('') + '</ul>'; continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      const buf = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) { buf.push(lines[i].trim().replace(/^\d+\.\s+/, '')); i++; }
      html += '<ol class="md-ol">' + buf.map(b => `<li>${mdInline(b)}</li>`).join('') + '</ol>'; continue;
    }

    const buf = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i].trim())) { buf.push(lines[i].trim()); i++; }
    html += `<p class="md-p">${mdInline(buf.join(' '))}</p>`;
  }
  return html;
}

let _guideLoaded = false;
async function loadGuideTab() {
  if (_guideLoaded) return;
  _guideLoaded = true;
  const el = document.getElementById('guide-content');
  try {
    const data = await fetch('/api/guide').then(r => r.json());
    if (!data.content) throw new Error('пусто');
    el.innerHTML = `<div class="md-body guide-body">${mdToHtmlBlock(data.content)}</div>`;
  } catch {
    _guideLoaded = false;
    el.innerHTML = `<div class="cdet-empty">${t('tools.guideLoadErr')}</div>`;
  }
}

// Bare canonical status words written without checking «Пол» (common at creation,
// where the card text is just «Жив» regardless of gender) — grammatically correct
// for display by gender. Anything with extra narrative (e.g. «Жив, но в бегах»)
// is left as-is below; this only intervenes on an exact bare-word match.
const GENDERED_STATUS_WORD = {
  'жив':    { 'Мужской': 'Жив',   'Женский': 'Жива' },
  'жива':   { 'Мужской': 'Жив',   'Женский': 'Жива' },
  'мёртв':  { 'Мужской': 'Мёртв', 'Женский': 'Мертва' },
  'мертва': { 'Мужской': 'Мёртв', 'Женский': 'Мертва' },
};
function statusLabel(c) {
  const raw = (c.status || '').trim();
  const gendered = GENDERED_STATUS_WORD[raw.toLowerCase()]?.[c.gender];
  if (gendered) return gendered;
  if (raw && !raw.includes('⚠️')) return raw;
  return STATUS_LABELS[c.statusType || 'unknown'] || '—';
}
// getOrigLabel moved to public/utils.js (E2.1).

const cityNameInput = document.getElementById('city-name');
const citySlugPreview = document.getElementById('city-slug-preview');
cityNameInput.addEventListener('input', () => {
  citySlugPreview.textContent = slugifyJS(cityNameInput.value.trim()) || '—';
});

// Структурные редакторы формы создания — те же компоненты, что в модалке редактирования
// города (единый источник разметки/сбора между создать/редактировать). Инжектятся лениво
// в loadCitiesGrid() (city.js) — там все const-наборы (CITY_SECTS, DISTRICT_TYPES и т.п.)
// уже инициализированы.
const _cityFactionsCreateHost   = document.getElementById('city-factions-editor');
const _cityDistrictsCreateHost  = document.getElementById('city-districts-editor');
const _cityPoliticalCreateHost  = document.getElementById('city-political-editor');
const _cityLocationsCreateHost  = document.getElementById('city-locations-editor');
const _cityRulesCreateHost      = document.getElementById('city-rules-editor');

document.getElementById('btn-new-city').addEventListener('click', async () => {
  const city = cityNameInput.value.trim();
  const year = document.getElementById('city-year').value.trim();
  if (!city) { showToast(t('city.nameRequired'), 'warning'); return; }
  if (!year) { showToast(t('city.yearRequired'), 'warning'); return; }
  if (!/^\d{3,4}$/.test(year)) { showToast(t('city.yearInvalid'), 'warning'); return; }

  const btn = document.getElementById('btn-new-city');
  const out = document.getElementById('out-new-city');
  const payload = {
    name: city, year,
    description: document.getElementById('city-description').value.trim(),
    political:  _cityPoliticalCreateHost ? _collectPoliticalRows(_cityPoliticalCreateHost) : '',
    factions:   _cityFactionsCreateHost ? _collectFactions(_cityFactionsCreateHost) : '',
    factionsMortal: _cityFactionsCreateHost ? _collectFactionsMortal(_cityFactionsCreateHost) : '',
    factionsState:  _cityFactionsCreateHost ? _collectFactionsState(_cityFactionsCreateHost) : '',
    locations:  _cityLocationsCreateHost ? _collectLocationRows(_cityLocationsCreateHost) : '',
    leitmotif:  document.getElementById('city-leitmotif').value.trim(),
    specifics:  document.getElementById('city-specifics').value.trim(),
    avoid:      document.getElementById('city-avoid').value.trim(),
    sources:    document.getElementById('city-sources').value.trim(),
    // Секции «живого города» из свёрнутого блока «Правила и ограничения» (§A2).
    // Блок рисуется из CITY_RULE_SECTIONS_CREATE (city.js, без landmarks — T4,
    // 2026-08-04) — оттуда же берём список ключей, чтобы поля не разъехались
    // с разметкой при добавлении новой секции.
    ...Object.fromEntries(CITY_RULE_SECTIONS_CREATE.map(([key]) =>
      [key, document.getElementById(`city-${key}`)?.value.trim() || ''])),
  };
  btn.disabled = true; btn.textContent = t('city.creating');
  if (out) { out.className = 'output-area show'; out.textContent = ''; }
  try {
    const d = await fetch('/api/cities', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json());
    if (!d.ok) { if (out) out.innerHTML = `<span class="err">⚠ ${escHtml(d.error || t('chars.deleteError'))}</span>`; return; }
    if (Array.isArray(d.warnings)) d.warnings.forEach(w => showToast(w, 'warning'));

    // Районы больше не заводятся в форме создания (T2, 2026-08-04) — добавляются
    // постфактум карточками района на странице только что созданного города.
    if (out) out.innerHTML = `<span class="ok">${t('city.created', { slug: escHtml(d.slug) })}</span>`;
    setTimeout(() => { location.search = 'city=' + encodeURIComponent(d.slug); }, 900);
  } catch (e) {
    if (out) out.innerHTML = `<span class="err">⚠ ${escHtml(e.message)}</span>`;
  } finally {
    btn.disabled = false; btn.textContent = t('city.createBtn');
  }
});

document.getElementById('btn-validate').addEventListener('click', () => {
  runTool('validate_links', {}, 'out-validate', document.getElementById('btn-validate'));
});

document.getElementById('btn-validate-fix').addEventListener('click', () => {
  runTool('validate_links', { Fix: 'true' }, 'out-validate', document.getElementById('btn-validate-fix'));
});

// ── Tab «🛠 Ещё»: Node-инструменты над текущим городом ──────────────────────────
function _moreBtn(id, name, argsFn) {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener('click', () => {
    if (!CITY) { showToast(t('city.firstSelect'), 'warning'); return; }
    const args = argsFn(); if (!args) return;
    runNodeTool(name, args, 'out-more', el);
  });
}
_moreBtn('btn-migrate', 'migrate_char', () => {
  const slug = document.getElementById('mig-slug').value.trim();
  const to   = document.getElementById('mig-to').value.trim();
  if (!slug || !to) { showToast(t('city.transferSlugPh'), 'warning'); return null; }
  return ['visit', CITY, document.getElementById('mig-lineage').value, slug, to, document.getElementById('mig-when').value.trim()];
});
_moreBtn('btn-close-chr', 'close_chronicle', () => {
  const chr = document.getElementById('close-chr').value.trim();
  if (!chr) { showToast(t('city.transferChrPh'), 'warning'); return null; }
  return [CITY, chr, document.getElementById('close-note').value.trim()];
});
_moreBtn('btn-rebuild-idx', 'build_city_events', () => [CITY]);
_moreBtn('btn-sync-index', 'sync_index', () => [CITY]);

// ═══════════════════════════════════════════════════════════════
// Modules
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// Chronicles list (with delete)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// Chronicles page
// ═══════════════════════════════════════════════════════════════

const STATUS_LABEL = { active: t('chron.statusActive'), closed: t('chron.statusClosed'), paused: t('chron.statusPaused') };
const STATUS_CLS   = { active: 'chr-status-active', closed: 'chr-status-closed', paused: 'chr-status-paused' };

function renderChronicleCard(c) {
  const statusLbl = STATUS_LABEL[c.status] || c.status;
  const statusCls = STATUS_CLS[c.status]   || '';
  const meta = [
    c.startDate ? `<span class="chp-meta-item">🗓 ${escHtml(c.startDate)}</span>` : '',
c.events    ? `<span class="chp-meta-item">📅 ${c.events} ${t('chron.eventsCount')}</span>` : '',
      c.modules   ? `<span class="chp-meta-item">📖 ${c.modules} ${t('chron.modulesCount')}</span>` : '',
  ].filter(Boolean).join('');
  return `
    <div class="chp-card" data-slug="${escHtml(c.slug)}">
      <div class="chp-card-header">
        <div class="chp-card-name">${escHtml(c.display)}</div>
        <span class="chp-status ${statusCls}">${statusLbl}</span>
      </div>
      ${meta ? `<div class="chp-card-meta">${meta}</div>` : ''}
      <div class="chp-card-actions">
        <button class="chr-delete-btn" data-slug="${escHtml(c.slug)}">${t('chron.deleteBtn')}</button>
      </div>
    </div>`;
}

async function loadChroniclesPage() {
  const el  = document.getElementById('chronicles-cards-list');
  const sub = document.getElementById('chronicles-page-sub');
  if (!el) return;
  el.innerHTML = SPINNER;
  try {
    const qs   = window.location.search;
    const chrs = await fetch(`/api/chronicles${qs}`).then(r => r.json());
    STATE.chronicles = chrs; // cache for detail modal
    if (sub) sub.textContent = chrs.length ? `${chrs.length} ${t('chron.countLabel')}` : t('chron.noChronicles');
    if (!chrs.length) {
      el.innerHTML = `<div class="loading-state" style="height:120px">${t('chron.empty')}</div>`;
      return;
    }
    el.innerHTML = `<div class="chp-grid">${chrs.map(renderChronicleCard).join('')}</div>`;
  } catch {
    el.innerHTML = `<div class="loading-state" style="color:var(--accent3)">${t('common.loadError')}</div>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// Module Detail Modal
// ═══════════════════════════════════════════════════════════════

async function openModuleDetail(name, preferTab) {
  const modal   = document.getElementById('module-detail-modal');
  const content = document.getElementById('module-detail-content');
  content.innerHTML = `<div class="mod-loading">${SPINNER}</div>`;
  openModal('module-detail-modal');

  let d;
  try { d = await fetch(`/api/modules/${encodeURIComponent(name)}`).then(r => r.json()); }
  catch { content.innerHTML = `<div class="cdet-empty" style="padding:40px">${t('chron.loadModuleErr')}</div>`; return; }
  if (d.error) { content.innerHTML = `<div class="cdet-empty" style="padding:40px">${escHtml(d.error)}</div>`; return; }

  const tabs = [];
if (d.main)     tabs.push(['overview', t('chron.tabOverview'), d.main]);
      if (d.scenario) tabs.push(['scenario', t('chron.tabScenario'), d.scenario]);
      if (d.finale)   tabs.push(['finale',   t('chron.tabFinale'),   d.finale]);
      if (d.npc)      tabs.push(['npc',      t('chron.tabNpc'),      d.npc]);
      if (!tabs.length) tabs.push(['overview', t('chron.tabOverview'), t('chron.filesNotFound')]);

  const active = preferTab && tabs.some(t => t[0] === preferTab) ? preferTab : tabs[0][0];

  content.innerHTML = `
    <div class="cdet-info-col mod-info-col">
      <div class="cdet-sticky-header">
        <div class="cdet-name">${escHtml(d.title || name)}</div>
        <div class="mod-modal-slug-row">
          <span class="mod-modal-slug">📁 ${escHtml(d.name)}</span>
          <button class="mod-gen-scenario-btn"
            data-mod="${escHtml(d.name)}"
            data-chr="${escHtml(d.chronicle || '')}">${t('chron.generateScenario')}</button>
        </div>
      </div>
      <div class="cdet-tab-bar">
        ${tabs.map(t => `<button class="cdet-tab ${t[0] === active ? 'active' : ''} ${t[0] === 'finale' ? 'tab-finale' : ''}" data-tab="${t[0]}">${escHtml(t[1])}</button>`).join('')}
      </div>
      <div class="cdet-panels">
        ${tabs.map(t => `<div class="cdet-panel ${t[0] === active ? 'active' : ''}" data-panel="${t[0]}"><div class="md-body">${mdToHtmlBlock(t[2])}</div></div>`).join('')}
      </div>
    </div>`;
}

// Click: "🪄 Сгенерировать сценарий" button in module detail modal
document.getElementById('module-detail-content').addEventListener('click', e => {
  const genBtn = e.target.closest('.mod-gen-scenario-btn');
  if (!genBtn) return;
  const mod = genBtn.dataset.mod;
  const chr = genBtn.dataset.chr || _chrDetailSlug || '';
  closeModal('module-detail-modal');
  openFillModal(chr, mod, mod);
});

// Module modal: tab switching (same pattern as char/loc modals)
document.getElementById('module-detail-content').addEventListener('click', e => {
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

// Module modal close
const moduleDetailModal = document.getElementById('module-detail-modal');
document.getElementById('module-detail-close').addEventListener('click', () => closeModal('module-detail-modal'));
bindBackdropDblClickClose(moduleDetailModal, () => closeModal('module-detail-modal'));

// ═══════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════

loadDashboard();

// ═══════════════════════════════════════════════════════════════
// Char Detail Modal
// ═══════════════════════════════════════════════════════════════

// Наборы полей вкладки «Информация» — свои для каждой линейки WoD.
// Карточка хранит линейко-специфичные поля (Раса/Двор/Титул у фей, Профессия у смертных);
// здесь выбирается, какие из них показывать и в каком порядке.
const INFO_FIELDS_BY_LINEAGE = {
  vampire: [
    ['status',       t('cfl.status')],
    ['statusDetails',t('cfl.statusDetails')],
    ['gender',       t('cfl.gender')],
    ['clan',         t('cfl.clan')],
    ['sect',         t('cfl.sect')],
    ['generation',   t('cfl.generation')],
    ['birthYear',    t('cfl.birthYear')],
    ['embraceYear',  t('cfl.embraceYear')],
    ['sire',         t('cfl.sire')],
    ['childe',       t('cfl.childe')],
    ['location',     t('cfl.location')],
    ['hierarchy',    t('cfl.hierarchy')],
    ['disciplines',  t('cfl.disciplines')],
    ['derangements', t('cfl.derangements')],
    ['profession',   t('cfl.profession')],
    ['role',         t('cfl.role')],
    ['nature',       t('cfl.nature')],
    ['demeanor',     t('cfl.demeanor')],
    ['concept',      t('cfl.concept')],
    ['belonging',    t('cfl.belonging')],
    ['want',       t('cfl.want')],
    ['fear',       t('cfl.fear')],
    ['leverage',   t('cfl.leverage')],
  ],
  fairy: [
    ['status',     t('cfl.status')],
    ['statusDetails',t('cfl.statusDetails')],
    ['gender',     t('cfl.gender')],
    ['race',       t('cfl.race')],
    ['kith',       t('cfl.kith')],
    ['court',      t('cfl.court')],
    ['title',      t('cfl.hierarchy')],
    ['birthYear',  t('cfl.birthYear')],
    ['location',   t('cfl.freehold')],
    ['features',   t('cfl.features')],
    ['hierarchy',  t('cfl.hierarchyFairy')],
    ['role',       t('cfl.role')],
    ['nature',     t('cfl.nature')],
    ['demeanor',   t('cfl.demeanor')],
    ['belonging',  t('cfl.belonging')],
    ['want',       t('cfl.want')],
    ['fear',       t('cfl.fear')],
    ['leverage',   t('cfl.leverage')],
  ],
  mortal: [
    ['status',       t('cfl.status')],
    ['statusDetails',t('cfl.statusDetails')],
    ['gender',       t('cfl.gender')],
    ['sect',         t('cfl.sect')],
    ['sectRole',     t('cfl.sectRole')],
    ['organization', t('cfl.organization')],
    ['position',     t('cfl.position')],
    ['profession',   t('cfl.profession')],
    ['birthYear',    t('cfl.birthYear')],
    ['location',     t('cfl.location')],
    ['relatives',    t('cfl.relatives')],
    ['attitude',     t('cfl.attitude')],
    ['hierarchy',    t('cfl.hierarchy')],
    ['role',         t('cfl.role')],
    ['nature',       t('cfl.nature')],
    ['demeanor',     t('cfl.demeanor')],
    ['belonging',    t('cfl.belonging')],
    ['want',       t('cfl.want')],
    ['fear',       t('cfl.fear')],
    ['leverage',   t('cfl.leverage')],
  ],
  // Охотник — отдельный литерал, не алиас mortal (осознанное решение: сегодня совпадают, но
  // не обязаны — у охотника в V20 есть Numina/практики, которых нет у рядового смертного).
  // V20-лист уже относится к охотнику как к смертному (_resolveSheetLineage, server.js) —
  // вкладка «Информация» раньше отставала (падала в INFO_FIELDS_GENERIC), теперь синхронна.
  hunter: [
    ['status',       t('cfl.status')],
    ['statusDetails',t('cfl.statusDetails')],
    ['gender',       t('cfl.gender')],
    ['sect',         t('cfl.sect')],
    ['sectRole',     t('cfl.sectRole')],
    ['organization', t('cfl.organization')],
    ['position',     t('cfl.position')],
    ['profession',   t('cfl.profession')],
    ['birthYear',    t('cfl.birthYear')],
    ['location',     t('cfl.location')],
    ['relatives',    t('cfl.relatives')],
    ['attitude',     t('cfl.attitude')],
    ['hierarchy',    t('cfl.hierarchy')],
    ['role',         t('cfl.role')],
    ['nature',       t('cfl.nature')],
    ['demeanor',     t('cfl.demeanor')],
    ['belonging',    t('cfl.belonging')],
    ['want',       t('cfl.want')],
    ['fear',       t('cfl.fear')],
    ['leverage',   t('cfl.leverage')],
  ],
};
// Оборотни / маги / охотники: пока нет выделенного набора — общий минимум.
const INFO_FIELDS_GENERIC = [
  ['status',    t('cfl.status')],
  ['statusDetails', t('cfl.statusDetails')],
  ['gender',    t('cfl.gender')],
  ['race',      t('cfl.raceType')],
  ['sect',      t('cfl.faction')],
  ['birthYear', t('cfl.birthYear')],
  ['location',  t('cfl.location')],
  ['hierarchy', t('cfl.hierarchy')],
  ['role',      t('cfl.role')],
  ['belonging', t('cfl.belonging')],
    ['want',       t('cfl.want')],
    ['fear',       t('cfl.fear')],
    ['leverage',   t('cfl.leverage')],
];
function infoFieldsFor(lineage) {
  return INFO_FIELDS_BY_LINEAGE[lineage] || INFO_FIELDS_GENERIC;
}

// Обязательное (всегда видимое) поле — своё для линейки. Показывается даже пустым с флагом «!».
const REQUIRED_INFO_KEY = { vampire: 'clan', fairy: 'race', mortal: 'profession', hunter: 'profession' };
function requiredInfoFor(lineage) {
  const k = REQUIRED_INFO_KEY[lineage];
  return new Set(k ? [k] : []);
}
// Линейка персонажа по slug (для режима редактирования, где под рукой только он).
function _lineageOf(slug) {
  return (STATE.characters.find(c => c.slug === slug) || {}).lineage || 'vampire';
}

function renderDiaryList(c) {
  const ch = escHtml(c.slug);
  const items = c.diaries?.length
    ? `<div class="diaries-list">${c.diaries.map(d => `
        <div class="diary-item" data-char="${ch}" data-file="${escHtml(d.file)}" data-title="${escHtml(d.title)}">
          <span class="diary-item-icon">📜</span>
          <span class="diary-item-title">${escHtml(d.title)}</span>
          <button class="diary-item-del-btn" data-char="${ch}" data-file="${escHtml(d.file)}" data-title="${escHtml(d.title)}" title="${t('diary.deleteEntryBtn')}">✕</button>
          <span class="diary-item-arrow">→</span>
        </div>`).join('')}</div>`
    : `<div class="cdet-empty">${t('diary.empty')}</div>`;

  return `
    ${items}
    <div class="diary-tools">
      <button class="cdet-edit-btn" id="diary-add-toggle" data-char="${ch}">${t('diary.addBtn')}</button>
    </div>
    <div class="diary-form" id="diary-form" style="display:none">
      <div class="form-row">
        <div class="form-group"><label class="form-label">${t('diary.periodLabel')}</label><input class="form-control" id="diary-period" placeholder="${t('diary.periodPh')}"></div>
        <div class="form-group" style="flex:2"><label class="form-label">${t('diary.sessionLabel')}</label><input class="form-control" id="diary-session" placeholder="${t('diary.sessionPh')}"></div>
      </div>
      <div class="form-group"><label class="form-label">${t('diary.hintLabel')}</label><input class="form-control" id="diary-hint" placeholder="${t('diary.hintPh')}"></div>
      <textarea class="cdet-edit-textarea" id="diary-text" rows="10" placeholder="${t('diary.textPh')}"></textarea>
      <div class="btn-row" style="margin-top:10px;align-items:center">
        <button class="btn-submit" id="diary-gen" data-char="${ch}">${t('diary.genBtn')}</button>
        <button class="btn-submit" id="diary-save" data-char="${ch}">${t('diary.saveBtn')}</button>
        <button class="btn-submit btn-secondary" id="diary-cancel">${t('diary.cancelBtn')}</button>
        <span id="diary-form-msg"></span>
      </div>
    </div>`;
}

function _diaryMsg(text, ok = true) {
  const m = document.getElementById('diary-form-msg');
  if (m) { m.textContent = text; m.style.color = ok ? 'var(--gold)' : 'var(--accent3)'; }
}

function formatDiaryText(text) {
  if (!text) return '';
  return text.split(/\n\n+/)
    .filter(Boolean)
    .map(para => `<p>${escHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Holds the currently-viewed diary entry's data so the edit/regenerate/save
// handlers (triggered by delegated clicks, with no room to carry full text via
// dataset) have something to read from and write back into.
let _diaryEntryState = null;

function _diaryEntryToolbar(charSlug, file, data) {
  const title = data.session || data.title || '';
  const period = file.replace(/^journal\//, '').replace(/\.md$/, '');
  const canEdit = data.format !== 'retrospective';
  return `
    <div class="diary-entry-toolbar">
      <button class="diary-back" data-char="${escHtml(charSlug)}">${t('diary.backBtn')}</button>
      <div class="diary-entry-toolbar-actions">
        ${canEdit ? `<button class="cdet-edit-btn diary-entry-edit-btn" data-char="${escHtml(charSlug)}" data-file="${escHtml(file)}" data-period="${escHtml(period)}">✏ ${t('diary.editBtn')}</button>` : ''}
        <button class="diary-entry-del-btn" data-char="${escHtml(charSlug)}" data-file="${escHtml(file)}" data-title="${escHtml(title)}" title="${t('diary.delTitle')}">🗑 ${t('diary.delBtn')}</button>
      </div>
    </div>`;
}

async function loadDiaryEntry(charSlug, file) {
  const panel = document.querySelector('#char-detail-content [data-panel="diaries"]');
  if (!panel) return;
  panel.innerHTML = `<div class="diary-loading"><div class="spinner"></div>${t('diary.loading')}</div>`;
  try {
    const data = await fetch(
      `/api/characters/${encodeURIComponent(charSlug)}/diary?file=${encodeURIComponent(file)}`
    ).then(r => r.json());
    if (data.error) throw new Error(data.error);
    const panels = panel.closest('.cdet-panels');
    if (panels) panels.scrollTop = 0;

    _diaryEntryState = { charSlug, file, data };

    if (data.format === 'retrospective') {
      panel.innerHTML = `
        ${_diaryEntryToolbar(charSlug, file, data)}
        ${data.title ? `<div class="diary-retro-title">${escHtml(data.title)}</div>` : ''}
        ${(data.sections || []).map(s => `
          <div class="diary-retro-section">
            <div class="diary-retro-date">📅 ${escHtml(s.title)}</div>
            <div class="diary-retro-body">${formatDiaryText(s.body)}</div>
          </div>
          <div class="diary-divider"></div>
        `).join('')}`;
    } else {
      panel.innerHTML = `
        ${_diaryEntryToolbar(charSlug, file, data)}
        ${data.session   ? `<div class="diary-session">📅 ${escHtml(data.session)}</div>`   : ''}
        ${data.location  ? `<div class="diary-meta">📍 ${escHtml(data.location)}</div>`      : ''}
        ${data.tone      ? `<div class="diary-meta">🎭 ${escHtml(data.tone)}</div>`          : ''}
        ${data.text      ? `<div class="diary-divider"></div><div class="diary-text">${escHtml(data.text)}</div>` : ''}
        ${data.crossRefs?.length ? `
          <div class="diary-divider"></div>
          <div class="cdet-section-title">${t('diary.mirrorTitle')}</div>
          <div class="diary-crossrefs">${data.crossRefs.map(r =>
            `<div class="diary-crossref">${escHtml(r)}</div>`).join('')}
          </div>` : ''}`;
    }
  } catch (err) {
    const panels = panel.closest('.cdet-panels');
    if (panels) panels.scrollTop = 0;
    panel.innerHTML = `
      <button class="diary-back" data-char="${escHtml(charSlug)}">${t('diary.backBtn')}</button>
      <div class="cdet-empty">${t('diary.loadError')}${escHtml(err.message)}</div>`;
  }
}

function _enterDiaryEntryEdit() {
  const st = _diaryEntryState;
  if (!st) return;
  const panel = document.querySelector('#char-detail-content [data-panel="diaries"]');
  if (!panel) return;
  const { charSlug, file, data } = st;
  const period = file.replace(/^journal\//, '').replace(/\.md$/, '');

  panel.innerHTML = `
    <div class="diary-entry-toolbar">
      <button class="diary-back" data-char="${escHtml(charSlug)}">${t('diary.backBtn')}</button>
    </div>
    <div class="cdet-section-title">${t('diary.entryTitleLabel')}</div>
    <input class="form-control" id="diary-entry-session-ta" value="${escAttr(data.session || '')}" placeholder="${t('diary.entryTitlePh')}">
    <div class="cdet-section-title" style="margin-top:12px">${t('diary.textLabel')}</div>
    <textarea class="cdet-edit-textarea" id="diary-entry-text-ta" rows="14">${escHtml(data.text || '')}</textarea>
    <div class="cdet-edit-bar show" id="diary-entry-edit-bar">
      <button class="cdet-gen-prompt-btn diary-entry-regen-btn" data-char="${escHtml(charSlug)}" data-period="${escHtml(period)}">${t('diary.regenBtn')}</button>
      <button class="cdet-save-btn diary-entry-save-btn" data-char="${escHtml(charSlug)}" data-period="${escHtml(period)}" data-file="${escHtml(file)}">${t('diary.entrySaveBtn')}</button>
      <button class="cdet-cancel-btn diary-entry-cancel-btn" data-char="${escHtml(charSlug)}" data-file="${escHtml(file)}">${t('diary.entryCancelBtn')}</button>
      <span class="cdet-save-msg" id="diary-entry-save-msg">${t('diary.entrySaved')}</span>
    </div>`;
}

async function _regenerateDiaryEntry(charSlug, period) {
  const btn = document.querySelector('.diary-entry-regen-btn');
  const textTa = document.getElementById('diary-entry-text-ta');
  const sessionTa = document.getElementById('diary-entry-session-ta');
  if (!textTa) return;

  const draft = textTa.value.trim();
  if (draft && !await showConfirm(t('diary.genConfirm'), { confirmText: t('diary.genConfirmBtn') })) return;

  if (btn) { btn.disabled = true; btn.textContent = t('diary.generating'); }
  try {
    const featPrefs    = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref         = _getPref(featPrefs, 'prose', 'openrouter');
    const preferSource = pref.provider;
    const orModel      = (preferSource === 'openrouter' || preferSource === 'lmstudio') ? (pref.model || null) : null;
    const r = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/diary/generate`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, session: sessionTa?.value.trim() || '', draft, preferSource, orModel }) }).then(r => r.json());
    if (r.error) { showToast(t('diary.genError') + r.error, 'error'); return; }
    textTa.value = r.text || '';
  } catch (e) {
    showToast(t('ui.err') + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('diary.regenBtn'); }
  }
}

async function _saveDiaryEntryEdit(charSlug, period, file) {
  const textTa = document.getElementById('diary-entry-text-ta');
  const sessionTa = document.getElementById('diary-entry-session-ta');
  const text = textTa?.value.trim() || '';
  if (!text) { showToast(t('diary.emptyText'), 'warning'); return; }

  const btn = document.querySelector('.diary-entry-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
  try {
    const r = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/diary`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, session: sessionTa?.value.trim() || '', text, mode: 'replace' }) }).then(r => r.json());
    if (r.error) { showToast(t('diary.saveError') + r.error, 'error'); return; }
    STATE.characters = []; await ensureCharsLoaded();
    await loadDiaryEntry(charSlug, file);
  } catch (e) {
    showToast(t('ui.err') + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('diary.entrySaveBtn'); }
  }
}

async function _deleteDiaryEntry(charSlug, file, title) {
  if (!await showConfirm(t('diary.deleteConfirmText', { title: title || file }), { danger: true, confirmText: t('diary.deleteConfirmBtn') })) return;
  try {
    const r = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/diary?file=${encodeURIComponent(file)}`,
      { method: 'DELETE' }).then(r => r.json());
    if (!r.ok) { showToast(t('diary.deleteError') + (r.error || ''), 'error'); return; }
    STATE.characters = []; await ensureCharsLoaded();
    const c = STATE.characters.find(ch => ch.slug === charSlug);
    const panel = document.querySelector('#char-detail-content [data-panel="diaries"]');
    if (panel && c) panel.innerHTML = renderDiaryList(c);
  } catch (e) {
    showToast(t('ui.err') + e.message, 'error');
  }
}

// Soft-delete a character: preview affected refs, confirm, then DELETE.
async function _confirmDeleteChar(slug) {
  const c = STATE.characters.find(ch => ch.slug === slug);
  const name = c?.name || slug;
  let pv;
  try { pv = await fetch(`/api/characters/${encodeURIComponent(slug)}/delete-preview${location.search}`).then(r => r.json()); }
  catch (e) { showToast(t('diary.previewError') + e.message, 'error'); return; }
  if (pv.error) { showToast(pv.error, 'error'); return; }

  const list = arr => arr.length
    ? `<ul>${arr.slice(0, 12).map(f => `<li>${escHtml(f)}</li>`).join('')}${arr.length > 12 ? `<li>${t('dash.ipMore', { n: arr.length - 12 })}</li>` : ''}</ul>`
    : ' <i>—</i>';
  const artNoteSuffix = pv.art ? `<i> — ${t('chars.deleteArtNote', { count: pv.art })}</i>` : '';

  const ov = document.createElement('div');
  ov.className = 'chr-modal-backdrop open';
  ov.innerHTML = `
    <div class="chr-modal">
      <div class="chr-modal-title">${t('chars.deleteTitle')}</div>
      <div class="chr-modal-body">
        <div class="chr-modal-warn">${t('chars.deleteDesc', { name: escHtml(name) })}${artNoteSuffix}</div>
        <div class="chr-modal-section">${t('chars.deleteStructural', { count: pv.structural.length })}${list(pv.structural)}</div>
        <div class="chr-modal-section">${t('chars.deleteProse', { count: pv.prose.length })}${list(pv.prose)}</div>
      </div>
      <div class="chr-modal-actions">
        <button class="chr-modal-btn cancel" data-act="cancel">${t('chars.deleteCancel')}</button>
        <button class="chr-modal-btn danger"  data-act="ok">${t('chars.deleteOk')}</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  bindBackdropDblClickClose(ov, close);
  ov.querySelector('[data-act="cancel"]').addEventListener('click', close);
  ov.querySelector('[data-act="ok"]').addEventListener('click', async () => {
    const btn = ov.querySelector('[data-act="ok"]');
    btn.disabled = true; btn.textContent = t('chars.deleting');
    try {
      const d = await fetch(`/api/characters/${encodeURIComponent(slug)}${location.search}`, { method: 'DELETE' })
        .then(r => r.json());
      if (!d.ok) throw new Error(d.error || t('chars.deleteError'));
      close();
      closeModal('char-detail-modal');
      STATE.graph.inited = false;
      fetch('/api/characters').then(r => r.json()).then(data => {
        STATE.characters = Array.isArray(data) ? data : [];
        if (STATE.page === 'characters') renderChars();
        if (STATE.page === 'dashboard')  loadDashboard();
      }).catch(() => { STATE.characters = []; });
    } catch (e) {
      btn.disabled = false; btn.textContent = t('chars.deleteOk');
      showToast(t('chars.deleteError') + e.message, 'error');
    }
  });
}

// Locations detail: upload/carousel/lightbox moved to public/locations.js (E2.3).

// ═══════════════════════════════════════════════════════════════
// Create Character Modal
// ═══════════════════════════════════════════════════════════════

const VAMPIRE_CLANS = [
  // 13 канонических кланов V20
  'Асамиты', 'Бруха', 'Вентру', 'Гэнгрел', 'Джованни',
  'Ласомбра', 'Малкавиан', 'Носферату', 'Равнос',
  'Последователи Сета', 'Тореадор', 'Тремер', 'Тзимище',
  // Кровные линии
  'Баали', 'Дочери Какофонии', 'Каппадокийцы', 'Нагараджа',
  'Салубри', 'Самеди', 'Серпанты Света',
];

const VAMPIRE_SECTS = [
  'Камарилья', 'Анархи', 'Шабаш', 'Независимый',
];

// V20 архетипы Натуры/Маски — нет канонического списка в проекте, список авторский (рус. термин + англ. оригинал).
const NATURE_DEMEANOR_ARCHETYPES = [
  'Архитектор (Architect)', 'Автократ (Autocrat)', 'Бонвиван (Bon Vivant)', 'Хвастун (Bravo)',
  'Опекун (Caregiver)', 'Кавалер (Cavalier)', 'Гуляка (Celebrant)', 'Конформист (Conformist)',
  'Хитрец (Conniver)', 'Брюзга (Curmudgeon)', 'Удалец (Daredevil)', 'Девиант (Deviant)',
  'Директор (Director)', 'Фанатик (Fanatic)', 'Галант (Gallant)', 'Судья (Judge)',
  'Одиночка (Loner)', 'Мученик (Martyr)', 'Монстр (Monster)', 'Педагог (Pedagogue)',
  'Перфекционист (Perfectionist)', 'Бунтарь (Rebel)', 'Выживальщик (Survivor)',
  'Традиционалист (Traditionalist)', 'Визионер (Visionary)',
];

const CHANGELING_SEEMINGS = ['Дитя (Childling)', 'Вильдер (Wilder)', 'Гранд (Grump)'];
const CHANGELING_COURTS   = ['Благой (Seelie)', 'Неблагой (Unseelie)'];
const CHANGELING_KITHS = [
  'Богган (Boggan)', 'Гилли Ду (Ghille Dhu)', 'Красная Шапка (Redcap)', 'Нокер (Nocker)',
  'Пак (Pooka)', 'Сатир (Satyr)', 'Слуа (Sluagh)', 'Тролль (Troll)',
  'Ши / Сидхе (Sidhe)', 'Эшу (Eshu)',
];

const GENDER_OPTIONS = ['Мужской', 'Женский'];

const LINEAGE_DEFS = {
  vampire:  { label:t('s.lineageVampire'),          type:'vampire',
    fields:[
      { param:'name',        label:t('cfl.name'),           required:true, placeholder:t('s.phNameVamp') },
      { param:'gender',      label:t('cfl.gender'),         required:true, options:GENDER_OPTIONS, placeholder:t('s.phSelect') },
      { param:'clan',        label:t('cfl.clan'),           required:true, options:VAMPIRE_CLANS, placeholder:t('s.phSelectOrType') },
      { param:'sect',        label:t('cfl.sect'),           required:true, options:VAMPIRE_SECTS, placeholder:t('s.phSelectOrType') },
      { param:'generation',  label:t('cfl.generation'),                    placeholder:t('s.phGen10th') },
      { param:'birthYear',   label:t('cfl.birthYear'),                 placeholder:'1612' },
      { param:'embraceYear', label:t('cfl.embraceYear'),                placeholder:'1640' },
      { param:'sire',        label:t('cfl.sire'),                          placeholder:t('s.phSire') },
      { param:'nature',      label:t('cfl.natureArchetype'),              options:NATURE_DEMEANOR_ARCHETYPES, placeholder:t('s.phSelectOrType') },
      { param:'demeanor',    label:t('cfl.demeanorArchetype'),             options:NATURE_DEMEANOR_ARCHETYPES, placeholder:t('s.phSelectOrType') },
      { param:'concept',     label:t('cfl.conceptFull'),           placeholder:t('s.phConcept') },
      { param:'biography',   label:t('cfl.biography'),     textarea:true, placeholder:t('s.phBio') },
      { param:'appearance',  label:t('cfl.appearance'),     textarea:true, placeholder:t('s.phAppearance') },
    ]},
  mortal:   { label:t('s.lineageMortal'),         type:'mortal',
    fields:[
      { param:'name',     label:t('cfl.name'),                  required:true,  placeholder:t('s.phNameMortal') },
      { param:'gender',   label:t('cfl.gender'),                required:true,  options:GENDER_OPTIONS, placeholder:t('s.phSelect') },
      { param:'nature',   label:t('cfl.natureArchetype'),                     options:NATURE_DEMEANOR_ARCHETYPES, placeholder:t('s.phSelectOrType') },
      { param:'demeanor', label:t('cfl.demeanorArchetype'),                      options:NATURE_DEMEANOR_ARCHETYPES, placeholder:t('s.phSelectOrType') },
      { param:'role',     label:t('cfl.professionFull'),                   placeholder:t('s.phMortalRole') },
      { param:'biography', label:t('cfl.biography'),           textarea:true, placeholder:t('s.phBio') },
      { param:'appearance', label:t('cfl.appearance'),          textarea:true, placeholder:t('s.phAppearance') },
    ]},
  fairy:    { label:t('s.fairyCreateLabel'),  type:'fairy',
    fields:[
      { param:'name',   label:t('cfl.name'),                  required:true,  placeholder:t('s.phNameFairy') },
      { param:'gender', label:t('cfl.gender'),                required:true,  options:GENDER_OPTIONS, placeholder:t('s.phSelect') },
      { param:'clan',   label:t('cfl.kithFull'),                           options:CHANGELING_KITHS, placeholder:t('s.phSelectOrType') },
      { param:'seeming', label:t('cfl.seeming'),   required:true,  options:CHANGELING_SEEMINGS, placeholder:t('s.phSelect') },
      { param:'court',  label:t('cfl.court'),                                 options:CHANGELING_COURTS, placeholder:t('s.phSelect') },
      { param:'house',  label:t('cfl.house'),                     placeholder:t('s.phHouse') },
      { param:'nature',   label:t('cfl.natureArchetype'),                   options:NATURE_DEMEANOR_ARCHETYPES, placeholder:t('s.phSelectOrType') },
      { param:'demeanor', label:t('cfl.demeanorArchetype'),                    options:NATURE_DEMEANOR_ARCHETYPES, placeholder:t('s.phSelectOrType') },
      { param:'role',   label:t('cfl.role'),                                 placeholder:t('s.phFairyRole') },
      { param:'biography', label:t('cfl.biography'),         textarea:true, placeholder:t('s.phBio') },
      { param:'appearance', label:t('cfl.appearance'),         textarea:true, placeholder:t('s.phAppearance') },
    ]},
  werewolf: { label:t('s.lineageWerewolf'),        type:'werewolf',
    fields:[
      { param:'name',    label:t('cfl.name'),                  required:true, placeholder:t('s.phNameWerewolf') },
      { param:'gender',  label:t('cfl.gender'),                required:true, options:GENDER_OPTIONS, placeholder:t('s.phSelect') },
      { param:'tribe',   label:t('cfl.tribe'),                 required:true, placeholder:t('s.phTribe') },
      { param:'auspice', label:t('cfl.caste'),                               placeholder:t('s.phAuspice') },
      { param:'role',    label:t('cfl.role'),                               placeholder:t('s.phWerewolfRole') },
      { param:'biography', label:t('cfl.biography'),          textarea:true, placeholder:t('s.phBio') },
      { param:'appearance', label:t('cfl.appearance'),         textarea:true, placeholder:t('s.phAppearance') },
    ]},
  mage:     { label:t('s.lineageMage'),             type:'mage',
    fields:[
      { param:'name',      label:t('cfl.name'),                required:true, placeholder:t('s.phNameMage') },
      { param:'gender',    label:t('cfl.gender'),              required:true, options:GENDER_OPTIONS, placeholder:t('s.phSelect') },
      { param:'tradition', label:t('cfl.tradition'),           required:true, placeholder:t('s.phTradition') },
      { param:'role',      label:t('cfl.role'),                              placeholder:t('s.phMageRole') },
      { param:'biography', label:t('cfl.biography'),          textarea:true, placeholder:t('s.phBio') },
      { param:'appearance', label:t('cfl.appearance'),         textarea:true, placeholder:t('s.phAppearance') },
    ]},
  hunter:   { label:t('s.lineageHunter'),         type:'hunter',
    fields:[
      { param:'name',   label:t('cfl.name'),                   required:true, placeholder:t('s.phNameHunter') },
      { param:'gender', label:t('cfl.gender'),                 required:true, options:GENDER_OPTIONS, placeholder:t('s.phSelect') },
      { param:'clan',   label:t('cfl.organization'),                          placeholder:t('s.phHuntOrg') },
      { param:'role',   label:t('cfl.role'),                                 placeholder:t('s.phHuntRole') },
      { param:'biography', label:t('cfl.biography'),          textarea:true, placeholder:t('s.phBio') },
      { param:'appearance', label:t('cfl.appearance'),         textarea:true, placeholder:t('s.phAppearance') },
    ]},
};

// Пояснения к полям создания/редактирования персонажа — по тексту лейбла
// (одни и те же лейблы повторяются у разных линеек с одним смыслом, поэтому
// сопоставление не завязано на param/лineage).
const CHAR_FIELD_TIPS = {
  [t('cfl.name')]: t('cflTip.name'),
  [t('cfl.gender')]: t('cflTip.gender'),
  [t('cfl.clan')]: t('cflTip.clan'),
  [t('cfl.sect')]: t('cflTip.sect'),
  [t('cfl.generation')]: t('cflTip.generation'),
  [t('cfl.birthYear')]: t('cflTip.birthYear'),
  [t('cfl.embraceYear')]: t('cflTip.embraceYear'),
  [t('cfl.sire')]: t('cflTip.sire'),
  [t('cfl.natureArchetype')]: t('cflTip.natureArchetype'),
  [t('cfl.demeanorArchetype')]: t('cflTip.demeanorArchetype'),
  [t('cfl.conceptFull')]: t('cflTip.conceptFull'),
  [t('cfl.biography')]: t('cflTip.biography'),
  [t('cfl.appearance')]: t('cflTip.appearance'),
  [t('cfl.kithFull')]: t('cflTip.kithFull'),
  [t('cfl.seeming')]: t('cflTip.seeming'),
  [t('cfl.court')]: t('cflTip.court'),
  [t('cfl.house')]: t('cflTip.house'),
  [t('cfl.role')]: t('cflTip.role'),
  [t('cfl.professionFull')]: t('cflTip.professionFull'),
  [t('cfl.tribe')]: t('cflTip.tribe'),
  [t('cfl.organization')]: t('cflTip.organization'),
  // Доп. лейблы карточки/детального просмотра (отличаются формулировкой от
  // формы создания того же поля, напр. «Натура» vs «Натура (архетип)»).
  [t('cfl.status')]: t('cflTip.status'),
  [t('cfl.statusDetails')]: t('cflTip.statusDetails'),
  [t('cfl.childe')]: t('cflTip.childe'),
  [t('cfl.location')]: t('cflTip.location'),
  // A2 (2026-08-07): ключ 'Иерархия' убран — лейбл в UI больше не существует ни для одной
  // линейки (вампиры/смертные/generic теперь показывают «Титул», см. ключ ниже; феи
  // по-прежнему «Иерархия», но отдельного тултипа под этот случай не заводилось и раньше —
  // при желании завести отдельно можно, задачей не требовалось).
  [t('cfl.disciplines')]: t('cflTip.disciplines'),
  [t('cfl.derangements')]: t('cflTip.derangements'),
  [t('cfl.profession')]: t('cflTip.profession'),
  [t('cfl.nature')]: t('cflTip.nature'),
  [t('cfl.demeanor')]: t('cflTip.demeanor'),
  [t('cfl.concept')]: t('cflTip.concept'),
  [t('cfl.belonging')]: t('cflTip.belonging'),
  // B1 (2026-08-07): три поля есть во всех линейках (vampire/fairy/mortal/generic), тултипов
  // не было ни у одного.
  [t('cfl.want')]: t('cflTip.want'),
  [t('cfl.fear')]: t('cflTip.fear'),
  [t('cfl.leverage')]: t('cflTip.leverage'),
  [t('cfl.race')]: t('cflTip.race'),
  [t('cfl.kith')]: t('cflTip.kith'),
  // B1/A2 (2026-08-07): один текст на оба смысла (Двор фей vs. фракция остальных линеек) —
  // словарь плоский по всему проекту, вводить вложенность ради одного поля непропорционально.
  [t('cfl.hierarchy')]: t('cflTip.hierarchy'),
  [t('cfl.freehold')]: t('cflTip.freehold'),
  [t('cfl.features')]: t('cflTip.features'),
  [t('cfl.relatives')]: t('cflTip.relatives'),
  [t('cfl.attitude')]: t('cflTip.attitude'),
  [t('cfl.raceType')]: t('cflTip.raceType'),
  [t('cfl.faction')]: t('cflTip.faction'),
};

const charModal   = document.getElementById('char-modal');
const modalS1     = document.getElementById('modal-s1');
const modalS2     = document.getElementById('modal-s2');
const modalS2Title= document.getElementById('modal-s2-title');
const modalFields = document.getElementById('modal-fields');
const modalOut    = document.getElementById('modal-output');
const modalSubmit = document.getElementById('modal-submit');
let   modalLineage= null;

const modalImgBtn     = document.getElementById('modal-img-btn');
const modalImgInput   = document.getElementById('modal-img-input');
const modalImgPreview = document.getElementById('modal-img-preview');
const modalImgThumb   = document.getElementById('modal-img-thumb');
const modalImgClear   = document.getElementById('modal-img-clear');
let   modalImgB64 = null;
let   modalImgExt = null;

function resetModalImg() {
  modalImgB64 = null;
  modalImgExt = null;
  modalImgInput.value = '';
  modalImgThumb.src = '';
  modalImgPreview.style.display = 'none';
  modalImgBtn.textContent = t('s.imgAdd');
  modalImgBtn.style.borderColor = '';
}

modalImgBtn.addEventListener('click', () => modalImgInput.click());

modalImgInput.addEventListener('change', () => {
  const file = modalImgInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    modalImgB64 = e.target.result.split(',')[1];
    modalImgExt = file.name.split('.').pop().toLowerCase();
    modalImgThumb.src = e.target.result;
    modalImgPreview.style.display = '';
    modalImgBtn.textContent = t('s.imgChange');
    modalImgBtn.style.borderColor = 'var(--gold)';
  };
  reader.readAsDataURL(file);
});

modalImgClear.addEventListener('click', () => resetModalImg());

function openCharModal() {
  openModal('char-modal');
  showModalStep(1);
}
function closeCharModal() {
  closeModal('char-modal');
  modalOut.style.display = 'none';
  modalOut.textContent = '';
}
function showModalStep(n) {
  modalS1.style.display = n === 1 ? '' : 'none';
  modalS2.style.display = n === 2 ? '' : 'none';
  modalOut.style.display = 'none';
  modalSubmit.disabled = false;
  modalSubmit.textContent = t('chars.created');
  if (n === 1) resetModalImg();
}

document.getElementById('btn-open-create-char').addEventListener('click', openCharModal);
document.getElementById('btn-import-chars-zip')?.addEventListener('click', e => {
  e.preventDefault();
  document.getElementById('import-chars-zip-file')?.click();
});
document.getElementById('import-chars-zip-file')?.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (file) await importCharsZipFromFile(file, loadCharacters);
  e.target.value = '';
});
document.getElementById('modal-close').addEventListener('click', closeCharModal);
document.getElementById('modal-back').addEventListener('click', () => showModalStep(1));
bindBackdropDblClickClose(charModal, closeCharModal);

document.querySelectorAll('.lineage-pick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    modalLineage = btn.dataset.type;
    const def = LINEAGE_DEFS[modalLineage];
    modalS2Title.textContent = def.label;
    modalFields.innerHTML = def.fields.map(f => {
      const listId = f.options ? `dl-${f.param}-${modalLineage}` : '';
      const datalist = f.options
        ? `<datalist id="${listId}">${f.options.map(o => `<option value="${escHtml(o)}">`).join('')}</datalist>`
        : '';
      // Generation is a closed enum (unlike clan/sect/nature/demeanor, which allow
      // free text via datalist) — render a real <select> so it can't be typo'd or
      // left in a non-canonical format; mirrors the <select> in _enterInfoEdit.
      const control = f.param === 'generation'
        ? `<select class="form-control" data-param="${f.param}">
            <option value="">${t('s.phSelectEmpty')}</option>
            ${VAMPIRE_GENERATIONS.map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('')}
          </select>`
        : f.textarea
        ? `<textarea class="form-control" data-param="${f.param}" rows="3"
            placeholder="${escHtml(f.placeholder || '')}"></textarea>`
        : `<input class="form-control" data-param="${f.param}"
            placeholder="${escHtml(f.placeholder || '')}"
            type="text" ${f.required ? 'required' : ''}
            ${listId ? `list="${listId}"` : ''}>`;
      return `
      <div class="form-group">
        <label class="form-label">${escHtml(f.label)}${f.required ? ' *' : ''}${fieldTip(CHAR_FIELD_TIPS[f.label])}</label>
        ${control}
        ${datalist}
      </div>`;
    }).join('');
    // «Принадлежность» — общее поле для всех линеек (не входит в per-lineage
    // fields[], иначе пришлось бы дублировать в 6 массивах). Если открыто со
    // вкладки «🎭 Эпизодические» — по умолчанию подставляется «Эпизодический
    // персонаж» (фаза H, план 2026-07-16).
    const belongingDefault = BELONGING_TAB_VALUES[STATE.filter.belonging] || 'Персонаж мастера';
    modalFields.insertAdjacentHTML('beforeend', `
      <div class="form-group">
        <label class="form-label">${t('cfl.belonging')}${fieldTip(CHAR_FIELD_TIPS[t('cfl.belonging')])}</label>
        <select class="form-control" data-param="belonging">
          <option value="Персонаж мастера" ${belongingDefault === 'Персонаж мастера' ? 'selected' : ''}>Персонаж мастера</option>
          <option value="Персонаж игрока" ${belongingDefault === 'Персонаж игрока' ? 'selected' : ''}>Персонаж игрока</option>
          <option value="Эпизодический персонаж" ${belongingDefault === 'Эпизодический персонаж' ? 'selected' : ''}>Эпизодический персонаж</option>
          <option value="Фамильяр" ${belongingDefault === 'Фамильяр' ? 'selected' : ''}>Фамильяр</option>
        </select>
      </div>`);
    showModalStep(2);
    const firstField = modalFields.querySelector('input, textarea');
    if (firstField) firstField.focus();
  });
});

modalSubmit.addEventListener('click', async () => {
  const def = LINEAGE_DEFS[modalLineage];
  const params = {};
  let valid = true;

  modalFields.querySelectorAll('[data-param]').forEach(el => {
    const v = el.value.trim();
    if (el.required && !v) { el.style.borderColor = 'var(--crimson)'; valid = false; }
    else { el.style.borderColor = ''; if (v) params[el.dataset.param] = v; }
  });
  if (!valid) return;

  const charName = params.name || params.Name || '';
  const qs = location.search;

  modalSubmit.disabled = true;
  modalSubmit.textContent = t('chars.creating');
  modalOut.style.display = 'block';
  modalOut.className = 'output-area show';
  modalOut.textContent = '';

  const reset = () => { modalSubmit.disabled = false; modalSubmit.textContent = t('chars.created'); };
  const fail  = msg => { modalOut.className = 'output-area show'; modalOut.textContent = '⚠ ' + msg; reset(); };

  // Shared success: optional art upload → refresh list → close.
  const onCreated = async (okMsg, slug) => {
    modalOut.className = 'output-area show ok';
    modalOut.textContent = okMsg;
    STATE.graph.inited = false;
    if (modalImgB64 && charName) {
      try {
        const u = await fetch(`/api/characters/${encodeURIComponent(slug || _charSlug(charName))}/upload-image${qs}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64: modalImgB64, ext: modalImgExt })
        }).then(r => r.json());
        modalOut.textContent += (u && u.ok) ? '\n' + t('chars.artUploaded') : '\n' + t('chars.artFailed');
      } catch { /* не критично */ }
    }
    fetch('/api/characters').then(r => r.json()).then(data => {
      STATE.characters = Array.isArray(data) ? data : [];
      if (STATE.page === 'characters') renderChars();
    }).catch(() => { STATE.characters = []; });
    setTimeout(closeCharModal, 900);
  };

  try {
    // Все линейки идут через единый rules-compliant card-эндпоинт — заполняет
    // clan/sect/generation/birth/embrace/sire/nature/demeanor/concept/seeming/
    // court/house/tribe/auspice/tradition/role/bio/appearance по линейке.
    const payload = {
      name: charName, lineage: def.type, gender: params.gender || '',
      clan: params.clan || '', sect: params.sect || '',
      generation: params.generation || '', birthYear: params.birthYear || '',
      embraceYear: params.embraceYear || '', sire: params.sire || '',
      nature: params.nature || '', demeanor: params.demeanor || '', concept: params.concept || '',
      seeming: params.seeming || '', court: params.court || '', house: params.house || '',
      tribe: params.tribe || '', auspice: params.auspice || '', tradition: params.tradition || '',
      role: params.role || '',
      biography: params.biography || '', appearance: params.appearance || '',
      belonging: params.belonging || '',
    };
    const d = await fetch('/api/characters' + qs, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.json());
    if (!d.ok) return fail(d.error || t('chars.deleteError'));
    await onCreated(t('chars.createdPath', { city: CITY, lineage: d.lineage, slug: d.slug }), d.slug);
  } catch (e) {
    fail(e.message);
  }
});

// Location Edit/Create Modal + Module Locations Panel moved to public/locations.js (E2.3).
// Onboarding tour moved to public/tour.js (E2.4).
