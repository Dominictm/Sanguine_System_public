// ── Общий пикер справочников (spec doc/design/archive/lib-pickers-unified) ───────────────
// Один компонент вместо <datalist> и разрозненных пикеров: вид — пикер «+ из библиотеки» листа
// персонажа (строки «имя + серая подсказка», группы, поиск). Классы — только .lib-picker-*.
//
// Два режима:
//   LibPicker.attach(input, opts) — поле со справочником: подсказки при вводе, 📚, ↑/↓/Enter/Escape;
//     значение пишется в поле (multi — список через запятую). Все <input list> приложения
//     апгрейдятся в этот режим автоматически (внизу файла).
//   LibPicker.mount(panel, cfg)   — панель «+ из библиотеки» / 📚 у существующей разметки: поиск
//     внутри панели, выбор вызывает cfg.onPick(item). Панели открываются независимо друг от друга.
//
// Элемент списка: { value, label?, hint?, search?, group? } (+ любые поля для itemAttrs/onPick).
(function () {
  'use strict';

  let _seq = 0;
  const _open = new Set();   // открытые attach-пикеры (закрываются кликом вне поля)

  const _norm = s => String(s || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
  const _tokens = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  // Хвостовой разделитель multi-поля: «место под следующую запись», а не пустой токен.
  const TAIL_SEP = /[\s,]*,[\s,]*$/;
  // Значение multi-поля для сохранения: хвост снят. Поле читают и при живом фокусе (автосейв по
  // change, submit по Enter) — тогда blur ещё не сработал, и чистит значение именно этот вызов.
  const _clean = v => String(v || '').replace(TAIL_SEP, '').trim();
  const _attrs = obj => Object.entries(obj || {}).filter(([, v]) => v != null && v !== false)
    .map(([k, v]) => ` ${k}="${escAttr(v === true ? '' : v)}"`).join('');

  function _defaultMatch(item, q) {
    if (!q) return true;
    return _norm([item.label || item.value, item.hint, item.search].filter(Boolean).join(' ')).includes(q);
  }

  // ── Общий рендер строк ───────────────────────────────────────────────────────
  // → { html, ordered } — ordered: элементы в порядке idx (для клавиатуры и клика).
  function _listHtml(shown, { idPrefix, groups, isSelected, itemAttrs, listAttrs, emptyText }) {
    const itemHtml = (item, idx) => {
      const sel = !!isSelected(item);
      return `<button type="button" role="option" id="${idPrefix}-o${idx}" tabindex="-1" data-idx="${idx}"
        class="lib-picker-item${sel ? ' is-selected' : ''}" aria-selected="${sel ? 'true' : 'false'}"
        data-value="${escAttr(item.value)}"${_attrs(itemAttrs ? itemAttrs(item) : null)}><span class="lib-picker-name">${sel ? '✓ ' : ''}${escHtml(item.label || item.value)}</span>${item.hint ? `<span class="lib-picker-hint">${escHtml(item.hint)}</span>` : ''}</button>`;
    };
    const empty = text => `<div class="cdet-empty">${escHtml(text)}</div>`;
    if (!groups) {
      return { ordered: shown, html: `<div class="lib-picker-list"${_attrs(listAttrs)}>${shown.length ? shown.map(itemHtml).join('') : empty(emptyText)}</div>` };
    }
    let html = '', idx = 0;
    const ordered = [];
    const last = groups.length - 1;
    // alwaysShow — группа видна и пустой (со своим emptyText); без таких групп «ничего не найдено»
    // показывает последняя (обычно «Все …»), остальные пустые скрываются.
    const anyAlways = groups.some(g => g.alwaysShow);
    groups.forEach((g, gi) => {
      const rows = shown.filter(it => (it.group || null) === g.key);
      const showEmpty = !shown.length && gi === last && !anyAlways;
      if (!rows.length && !showEmpty && !g.alwaysShow) return;
      html += `<div class="lib-picker-group" data-group="${escAttr(g.key)}"><div class="lib-picker-group-label">${escHtml(g.label)}</div>
        <div class="lib-picker-list"${_attrs(g.listAttrs)}>${rows.length ? rows.map((it, i) => itemHtml(it, idx + i)).join('') : empty(g.emptyText || emptyText)}</div></div>`;
      idx += rows.length;
      ordered.push(...rows);
    });
    return { ordered, html };
  }

  function _highlight(root, idPrefix, active, focusEl) {
    root.querySelectorAll('.lib-picker-item').forEach(b => b.classList.toggle('is-active', Number(b.dataset.idx) === active));
    const act = root.querySelector(`#${idPrefix}-o${active}`);
    if (act) { focusEl?.setAttribute('aria-activedescendant', act.id); act.scrollIntoView({ block: 'nearest' }); }
    else focusEl?.removeAttribute('aria-activedescendant');
  }

  // ↑/↓/Home/End/Enter по списку; → true, если клавиша обработана.
  function _navKey(e, st, pick, refreshHl) {
    const n = st.shown.length;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
      e.preventDefault();
      st.active = e.key === 'ArrowDown' ? (st.active + 1) % n : (st.active <= 0 ? n - 1 : st.active - 1);
      refreshHl(); return true;
    }
    if (e.key === 'Home' && n) { e.preventDefault(); st.active = 0; refreshHl(); return true; }
    if (e.key === 'End' && n) { e.preventDefault(); st.active = n - 1; refreshHl(); return true; }
    if (e.key === 'Enter' && st.active >= 0 && n) { e.preventDefault(); pick(st.shown[st.active]); return true; }
    return false;
  }

  // ── attach: поле со справочником ─────────────────────────────────────────────
  function attach(input, opts = {}) {
    if (!input || input._libPicker) return input && input._libPicker;
    const o = { multi: false, button: true, groups: null, match: _defaultMatch, ...opts };
    const id = `lib-picker-${++_seq}`;
    input.setAttribute('autocomplete', 'off');
    input.removeAttribute('list');
    // Метка «значение поля — список через запятую»: по ней читатели (сохранение «Информации»)
    // снимают хвостовой разделитель через LibPicker.clean, не зная, кто именно повесил пикер.
    if (o.multi) input.dataset.libMulti = '1';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', id);

    let field = input.parentElement;
    if (o.button) {
      field = document.createElement('div');
      field.className = 'lib-picker-field';
      input.replaceWith(field);
      field.appendChild(input);
    }
    const panel = document.createElement('div');
    panel.className = 'lib-picker' + (o.float ? ' lib-picker--float' : '');
    panel.id = id;
    panel.hidden = true;
    panel.setAttribute('role', 'listbox');
    if (o.multi) panel.setAttribute('aria-multiselectable', 'true');
    if (o.label) panel.setAttribute('aria-label', o.label);
    // float — панель поверх страницы (в body, position: fixed): поле стоит во flex-ряду, в сетке
    // ключ/значение или в часто перерисовываемом листе; встроенная панель сдвигала бы раскладку.
    if (o.float) document.body.appendChild(panel);
    else (o.button ? field : input).insertAdjacentElement('afterend', panel);

    let btn = null;
    if (o.button) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lib-picker-btn';
      // 📚 — Библиотека; источник из данных города («Домен / Локация» — 📍, «Дитя» — 👤)
      // подписывается своим значком, чтобы кнопка не обещала справочник.
      btn.textContent = o.buttonIcon || '📚';
      const lbl = o.buttonLabel || t('picker.libBtn');
      btn.title = lbl;
      btn.setAttribute('aria-label', lbl);
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-controls', id);
      field.appendChild(btn);
    }

    // mode: 'type' — открыта вводом, хвост после последней запятой — поиск; 'browse' — 📚/↓, весь список.
    const state = { items: null, loading: null, failed: false, active: -1, shown: [], mode: 'browse' };

    async function load() {
      if (state.items && o.cache !== false) return state.items;
      if (!state.loading) {
        state.loading = Promise.resolve(typeof o.source === 'function' ? o.source() : o.source)
          .then(list => { state.items = Array.isArray(list) ? list : []; state.failed = false; return state.items; })
          .catch(() => { state.failed = true; state.items = null; return []; })
          .finally(() => { state.loading = null; });
      }
      return state.loading;
    }

    const query = () => _norm(o.multi ? (input.value.split(',').pop() || '') : input.value);
    // sameToken(token, item) — «этот токен поля и есть эта запись» (по умолчанию точное совпадение;
    // «Дисциплины» сравнивают «Анимализм» с «Анимализм (Animalism)» нечётко, как их 📚-панель).
    const same = o.sameToken || ((tok, item) => _norm(tok) === _norm(item.value));
    const selected = item => (o.multi ? _tokens(input.value).some(tok => same(tok, item)) : same(input.value, item));
    const hl = () => _highlight(panel, id, state.active, input);

    async function render() {
      if (!state.items) panel.innerHTML = `<div class="cdet-empty">${escHtml(t('picker.loading'))}</div>`;
      const items = await load();
      // 📚 показывает весь список: фильтр по уже введённому значению спрятал бы остальные варианты.
      const q = state.mode === 'type' ? query() : '';
      const shown = items.filter(it => o.match(it, q));
      if (state.failed) { state.shown = []; panel.innerHTML = `<div class="cdet-empty">${escHtml(o.unavailableText || t('picker.unavailable'))}</div>`; return; }
      const r = _listHtml(shown, {
        idPrefix: id, groups: o.groups, isSelected: selected,
        emptyText: items.length ? (o.emptyText || t('picker.emptyFree')) : (o.noItemsText || t('picker.unavailable')),
      });
      state.shown = r.ordered;
      state.active = Math.min(state.active, r.ordered.length - 1);
      panel.innerHTML = r.html;
      hl();
    }

    // Плавающая панель — под полем (или над ним, если снизу не хватает места), не уже 220px.
    function position() {
      if (!o.float || panel.hidden) return;
      const r = input.getBoundingClientRect();
      const w = Math.min(Math.max(r.width, 220), window.innerWidth - 16);
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      panel.style.width = `${w}px`;
      panel.style.left = `${left}px`;
      const below = window.innerHeight - r.bottom;
      const h = panel.offsetHeight || 240;
      panel.style.top = below < h + 8 && r.top > below ? `${Math.max(8, r.top - h - 4)}px` : `${r.bottom + 4}px`;
    }

    function open(mode = 'browse') {
      state.mode = mode;
      for (const p of [..._open]) if (p !== api) p.close();
      panel.hidden = false;
      _open.add(api);
      input.setAttribute('aria-expanded', 'true');
      btn?.setAttribute('aria-expanded', 'true');
      position();
      return render().then(position);
    }
    function close() {
      panel.hidden = true;
      _open.delete(api);
      state.active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      btn?.setAttribute('aria-expanded', 'false');
    }

    function pick(item) {
      if (!item) return;
      if (o.multi) {
        let toks = _tokens(input.value);
        // Набранный хвост после последней запятой — это поиск, а не значение.
        if (state.mode === 'type' && !/,\s*$/.test(input.value) && query() && toks.length) toks.pop();
        // Уже есть — снять все совпавшие токены (toggle), иначе добавить.
        if (toks.some(tok => same(tok, item))) toks = toks.filter(tok => !same(tok, item)); else toks.push(item.value);
        // Разделитель виден сразу после выбора: следующую запись ищут, не дописывая запятую руками,
        // и поле прямо показывает, что место под неё готово (баг-репорты 2026-11-18 и 2026-11-19 —
        // невидимое «ожидание» разделителя терялось при любом уходе фокуса). Пустым токеном на диск
        // хвост не уходит: его снимает trimTail на blur, а читатели значения — LibPicker.clean.
        input.value = toks.length ? `${toks.join(', ')}, ` : '';
        // Значение перезаписано целиком — курсор к хвосту, чтобы ввод продолжился с новой записи.
        try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
      } else {
        input.value = item.value;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      o.onPick?.(item, input);
      if (o.multi) { state.mode = 'browse'; render(); } else { close(); input.focus(); }
    }

    // Хвост «…, » (поставленный выбором или набранный руками) — приглашение к следующей записи,
    // не пустой токен: уход фокуса его снимает, и на сохранение уходит чистое значение.
    function trimTail() {
      if (!o.multi || !TAIL_SEP.test(input.value)) return;
      input.value = input.value.replace(TAIL_SEP, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    input.addEventListener('input', e => {
      if (e.isTrusted) { state.active = -1; open('type'); } else if (!panel.hidden) render();
    });
    input.addEventListener('keydown', e => {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && panel.hidden) {
        e.preventDefault();
        open().then(() => { state.active = 0; hl(); });
        return;
      }
      if (panel.hidden) return;
      if (_navKey(e, state, pick, hl)) return;
      if (e.key === 'Escape') {
        // Escape закрывает только панель — не модалку, в которой стоит поле.
        e.preventDefault(); e.stopPropagation(); close();
      } else if (e.key === 'Tab') close();
    });
    panel.addEventListener('mousedown', e => e.preventDefault()); // фокус остаётся в поле
    btn?.addEventListener('mousedown', e => e.preventDefault());
    // Фокус ушёл в другое поле (Tab, клик, программный фокус) — панель не должна висеть,
    // а хвостовой разделитель multi-поля снимается: значение уходит на сохранение чистым.
    input.addEventListener('blur', () => { close(); trimTail(); });
    panel.addEventListener('click', e => {
      const b = e.target.closest('.lib-picker-item');
      if (b) pick(state.shown[Number(b.dataset.idx)]);
    });
    // 📚 при открытых подсказках ввода — весь список; повторное нажатие закрывает.
    btn?.addEventListener('click', () => {
      if (panel.hidden || state.mode === 'type') { open('browse'); input.focus(); } else close();
    });
    // Поле без 📚 (бывший <datalist>) открывает весь список кликом — как нативная подсказка.
    if (o.openOnClick) input.addEventListener('click', () => { if (panel.hidden) open('browse'); });

    const api = {
      input, panel, button: btn, open, close, position, float: !!o.float,
      refresh: () => (panel.hidden ? null : render()),
      setSource(src) { o.source = src; state.items = null; return api.refresh(); },
    };
    input._libPicker = api;
    if (o.float) _floats.add(api);
    return api;
  }

  // ── mount: панель «+ из библиотеки» / 📚 ──────────────────────────────────────
  // cfg: source ([] | () => [] | async), search (true), searchAttrs ({id, …}), searchPlaceholder,
  //   header (HTML между поиском и списком — напр. переключатель «Все традиции»), groups
  //   ([{key, label, listAttrs, alwaysShow, emptyText}] или (items) => [...] — вычисляется после
  //   загрузки, по полному списку без поиска), listAttrs (атрибуты единственного списка),
  //   itemAttrs(item) (data-атрибуты строки), isSelected(item) (✓), onPick(item, api),
  //   closeOnPick (true), match, emptyText, noItemsText, label.
  // Повторный mount той же панели обновляет cfg (лист перерисовывает разметку целиком —
  // вызывающий монтирует заново при каждом открытии).
  function mount(panel, cfg = {}) {
    if (!panel) return null;
    if (panel._libPicker) { Object.assign(panel._libPicker.cfg, cfg); return panel._libPicker; }
    const c = { search: true, closeOnPick: true, match: _defaultMatch, isSelected: () => false, ...cfg };
    const id = panel.id || `lib-picker-${++_seq}`;
    if (!panel.id) panel.id = id;
    panel.classList.add('lib-picker');
    panel.setAttribute('role', 'region');
    if (c.label) panel.setAttribute('aria-label', c.label);
    panel.innerHTML = `${c.search ? `<input type="text" class="lib-picker-search" role="combobox" aria-autocomplete="list"
        aria-expanded="false" aria-controls="${id}-list" placeholder="${escAttr(c.searchPlaceholder || t('cdet.searchPh'))}"
        aria-label="${escAttr(c.searchPlaceholder || t('cdet.searchPh'))}"${_attrs(c.searchAttrs)}>` : ''}${c.header || ''}
      <div class="lib-picker-body" id="${id}-list" role="listbox"></div>`;
    const search = panel.querySelector('.lib-picker-search');
    const body = panel.querySelector('.lib-picker-body');
    const st = { active: -1, shown: [], returnFocus: null };
    const hl = () => _highlight(body, id, st.active, search);

    async function render() {
      let items;
      try {
        const src = c.source;
        items = await Promise.resolve(typeof src === 'function' ? src() : src);
        items = Array.isArray(items) ? items : [];
      } catch {
        st.shown = [];
        body.innerHTML = `<div class="cdet-empty">${escHtml(t('picker.unavailable'))}</div>`;
        return;
      }
      const q = _norm(search ? search.value : '');
      const shown = items.filter(it => c.match(it, q));
      const r = _listHtml(shown, {
        idPrefix: id, groups: typeof c.groups === 'function' ? c.groups(items) : c.groups,
        isSelected: c.isSelected, itemAttrs: c.itemAttrs, listAttrs: c.listAttrs,
        emptyText: items.length ? (c.emptyText || t('cdet.emptyNotFoundManual')) : (c.noItemsText || t('picker.unavailable')),
      });
      st.shown = r.ordered;
      st.active = Math.min(st.active, r.ordered.length - 1);
      body.innerHTML = r.html;
      hl();
    }
    // Сначала закрыть (close возвращает фокус туда, откуда открыли), потом onPick — он может
    // перевести фокус в заполненное поле или перерисовать лист целиком.
    function pick(item) {
      if (!item) return;
      if (c.closeOnPick) close();
      c.onPick?.(item, api);
      if (!c.closeOnPick && panel.isConnected) render();
    }
    function open() {
      st.returnFocus = document.activeElement;
      panel.hidden = false;
      st.active = -1;
      search?.setAttribute('aria-expanded', 'true');
      const p = render();
      search?.focus();
      return p;
    }
    // restoreFocus: false — когда панель прячут, пока пользователь печатает в другом поле.
    function close({ restoreFocus = true } = {}) {
      panel.hidden = true;
      st.active = -1;
      search?.setAttribute('aria-expanded', 'false');
      search?.removeAttribute('aria-activedescendant');
      const back = st.returnFocus;
      st.returnFocus = null;
      if (restoreFocus && back && back.isConnected && typeof back.focus === 'function') back.focus();
    }

    search?.addEventListener('input', () => { st.active = -1; render(); });
    search?.addEventListener('keydown', e => {
      if (_navKey(e, st, pick, hl)) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    body.addEventListener('click', e => {
      const b = e.target.closest('.lib-picker-item');
      if (b) pick(st.shown[Number(b.dataset.idx)]);
    });

    const api = {
      panel, cfg: c, open, close,
      // Внешнее изменение (поле, клан, другая строка) — список новый, прежняя подсветка неактуальна.
      refresh: () => { if (panel.hidden) return null; st.active = -1; return render(); },
      toggle: () => (panel.hidden ? open() : close()),
      get isOpen() { return !panel.hidden; },
    };
    panel._libPicker = api;
    return api;
  }

  const _floats = new Set();
  // Поле перерисовали (лист, строки связей) — его плавающая панель в body больше не нужна.
  function _prune() {
    for (const p of [..._floats]) {
      if (p.input.isConnected) continue;
      p.close();
      p.panel.remove();
      _floats.delete(p);
    }
  }

  // Клик вне поля/панели закрывает открытые пикеры полей.
  document.addEventListener('mousedown', e => {
    for (const p of [..._open]) {
      if (p.panel.contains(e.target) || p.input.contains(e.target) || (p.button && p.button.contains(e.target))) continue;
      p.close();
    }
  });
  const _reposition = () => { for (const p of _open) if (p.float) p.position(); };
  window.addEventListener('resize', _reposition);
  document.addEventListener('scroll', e => {
    if (e.target instanceof Element && e.target.closest('.lib-picker')) return; // прокрутка самого списка
    _reposition();
  }, true);

  // ── Авто-апгрейд <input list> (spec lib-pickers-unified U1, этап 2) ─────────────
  // Любое поле с <datalist> — в т.ч. отрисованное позже (листы, модули, локации, город) —
  // получает плавающий пикер в общем виде. Варианты читаются из его <datalist> при каждом
  // открытии (cache: false): код, который пересобирает <option>, продолжает работать как есть.
  // Нативный список отключается снятием атрибута list; id списка — в data-lib-list.
  function _upgrade(input) {
    const listId = input.getAttribute('list');
    if (!listId || input.tagName !== 'INPUT') return;
    input.dataset.libList = listId;
    if (input._libPicker) { input.removeAttribute('list'); return; }
    attach(input, {
      button: false, float: true, cache: false, openOnClick: true, multi: input.dataset.libMulti === '1',
      label: input.getAttribute('aria-label') || input.placeholder || '',
      source: () => {
        const dl = document.getElementById(input.dataset.libList);
        return dl ? [...dl.options].map(op => ({ value: op.value, hint: op.label && op.label !== op.value ? op.label : '' }))
          .filter(it => it.value) : [];
      },
    });
  }
  function _scan(root) {
    if (root.matches && root.matches('input[list]')) _upgrade(root);
    root.querySelectorAll && root.querySelectorAll('input[list]').forEach(_upgrade);
  }
  // Дёшево на горячих путях (стрим текста модели, граф): текстовые узлы и сами панели пропускаются,
  // уборка плавающих панелей — только если что-то удалили и такие панели вообще есть.
  new MutationObserver(muts => {
    let removed = false;
    for (const m of muts) {
      if (m.type === 'attributes') { _upgrade(m.target); continue; }
      if (m.removedNodes.length) removed = true;
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || (n.classList && n.classList.contains('lib-picker'))) continue;
        _scan(n);
      }
    }
    if (removed && _floats.size) _prune();
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['list'] });
  _scan(document);

  window.LibPicker = {
    attach, mount, closeAll: () => [..._open].forEach(p => p.close()), upgrade: _upgrade,
    clean: _clean,    // значение multi-поля без хвостового разделителя (для сохранения)
    tokens: _tokens,  // записи multi-поля: по запятым, без пустых
  };
})();
