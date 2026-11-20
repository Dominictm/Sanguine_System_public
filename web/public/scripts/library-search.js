'use strict';
// Библиотека → поиск по названию во всех вкладках (doc/design/archive/2026-10-25-library-search-spec.md).
// Общий DOM-фильтр: поле [data-lib-search] в строке .lib-add-row управляет соседним
// .lib-panel — скрывает .lib-card (или её .lib-card-wrap), чьё название не содержит
// запрос. Рендеры списков не знают о поиске: MutationObserver переприменяет фильтр
// после каждого innerHTML (загрузка, CRUD-reload, смена группы/категории).
// Название — data-search-name (полное, с EN-скобкой, там где карточка её срезает),
// иначе текст .lib-card-name. Дары/Обряды/Таро/Ритуалы — свои фильтры по данным,
// у них нет data-lib-search, сюда не входят.

function _libSearchNorm(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
}

function _libSearchApply(input, panel) {
  const q = _libSearchNorm(input.value);
  const cards = panel.querySelectorAll('.lib-card');
  let shown = 0;
  for (const card of cards) {
    // Специализации: совпадение с заголовком секции (способностью) — вся секция.
    const secTitle = card.closest('.lib-subsec')?.querySelector('.lib-subsec-title')?.textContent;
    const name = card.dataset.searchName || card.querySelector('.lib-card-name')?.textContent;
    const hit = !q || _libSearchNorm(name).includes(q) || (!!secTitle && _libSearchNorm(secTitle).includes(q));
    (card.closest('.lib-card-wrap') || card).classList.toggle('is-search-hidden', !hit);
    if (hit) shown++;
  }
  // Секция без видимых карточек скрывается целиком.
  for (const sec of panel.querySelectorAll('.lib-subsec')) {
    sec.classList.remove('is-search-hidden');
    const any = [...sec.querySelectorAll('.lib-card')].some(c => !c.closest('.is-search-hidden'));
    sec.classList.toggle('is-search-hidden', !any);
  }
  // Пустое состояние и live-регион живут ПОСЛЕ панели: внутри их стёр бы
  // innerHTML рендера, а запись в панель снова будила бы observer.
  const st = input._libSearch;
  const nothing = !!q && cards.length > 0 && shown === 0;
  st.empty.hidden = !nothing;
  if (nothing) st.emptyText.textContent = t('lib.search.empty', { q: input.value.trim() });
  st.live.textContent = q && cards.length ? t('lib.search.found', { n: shown }) : '';
}

function _libSearchWire(input) {
  const row = input.closest('.lib-add-row');
  const panel = row?.nextElementSibling;
  if (!panel || !panel.classList.contains('lib-panel')) return;

  const empty = document.createElement('div');
  empty.className = 'cdet-empty lib-search-empty';
  empty.hidden = true;
  const emptyText = document.createElement('span');
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'mod-fill-add-btn';
  reset.textContent = t('lib.search.reset');
  empty.append(emptyText, ' ', reset);
  const live = document.createElement('div');
  live.className = 'lib-search-live';
  live.setAttribute('aria-live', 'polite');
  panel.after(empty, live);
  input._libSearch = { empty, emptyText, live };

  const apply = () => _libSearchApply(input, panel);
  const clear = () => { input.value = ''; apply(); input.focus(); };
  input.addEventListener('input', apply);
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); clear(); }
  });
  reset.addEventListener('click', clear);
  new MutationObserver(apply).observe(panel, { childList: true, subtree: true });
}

document.querySelectorAll('[data-lib-search]').forEach(_libSearchWire);
