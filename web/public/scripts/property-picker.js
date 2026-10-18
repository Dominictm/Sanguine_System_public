'use strict';
// Модалка «Выбрать из справочника» (спека char-property-link §13): мини-копия
// раздела «Имущество» — полоса категорий + сетка плиток + поиск. Клик по чужой
// плитке добавляет персонажа во владельцы (идемпотентно, без confirm — действие
// обратимо кнопкой ✕ во вкладке). Свои вещи помечены бейджем. Уникальные
// предметы (флаг «Уникальный» в форме предмета) здесь не показываются.
//
// Изоляция: свои классы ppick-* (делегат раздела ловит только .property-tile,
// делегат карточки — только внутри #char-detail-content, а модалка в body).

async function openPropertyPicker({ charSlug, charName, onChanged }) {
  await ensurePropertyLoaded();

  const ov = _overlay(`
    <div class="confirm-box" role="dialog" aria-modal="true" aria-label="${escAttr(t('charprop.pickerTitle'))}" style="max-width:820px">
      <div class="confirm-title">${escHtml(t('charprop.pickerTitle'))}</div>
      <input class="form-control ppick-search" placeholder="${escAttr(t('charprop.pickerSearchPh'))}" aria-label="${escAttr(t('charprop.pickerSearchPh'))}">
      <div class="disciplines-subtab-bar ppick-bar" role="group" aria-label="${escAttr(t('charprop.pickerTitle'))}"></div>
      <div class="ppick-grid cdet-bel-grid" role="list"></div>
      <div class="ppick-empty cdet-empty" style="display:none"></div>
      <div class="confirm-acts" style="margin-top:12px">
        <button class="chr-modal-btn cancel" data-x="new" type="button">+ ${escHtml(t('charprop.newItem'))}</button>
        <button class="chr-modal-btn create" data-x="close" type="button">${t('ui.btn.close')}</button>
      </div>
    </div>`, 'prop-picker-overlay');

  const state = { cat: 'all', q: '' };
  const bar = ov.querySelector('.ppick-bar');
  const grid = ov.querySelector('.ppick-grid');
  const empty = ov.querySelector('.ppick-empty');
  const search = ov.querySelector('.ppick-search');

  const mine = slug => (_prop.items.find(i => i.slug === slug)?.owners || []).some(o => o.name === charName);
  const myQty = slug => (_prop.items.find(i => i.slug === slug)?.owners || []).find(o => o.name === charName)?.qty || 0;

  function renderBar() {
    const all = `<button type="button" class="disciplines-subtab-btn${state.cat === 'all' ? ' active' : ''}" data-ppick-cat="all" aria-pressed="${state.cat === 'all'}">${escHtml(t('charprop.allCats'))}</button>`;
    bar.innerHTML = all + _prop.categories.map(c =>
      `<button type="button" class="disciplines-subtab-btn${state.cat === c.id ? ' active' : ''}" data-ppick-cat="${escAttr(c.id)}" aria-pressed="${state.cat === c.id}">${escHtml(c.name)}</button>`
    ).join('');
  }

  function renderGrid() {
    const q = state.q.toLowerCase();
    // Уникальные предметы выдаются только формой предмета — в пикере их нет.
    const list = _prop.items.filter(i => !i.unique &&
      (state.cat === 'all' || i.categoryId === state.cat) &&
      (!q || `${i.name} ${i.description || ''}`.toLowerCase().includes(q)));
    if (!list.length) {
      grid.innerHTML = '';
      empty.style.display = '';
      empty.textContent = _prop.items.length ? t('charprop.pickerNoMatch') : t('charprop.sectionEmpty');
      return;
    }
    empty.style.display = 'none';
    grid.innerHTML = list.map(i => {
      const isMine = mine(i.slug);
      return `<figure class="cdet-bel-tile ppick-tile${isMine ? ' mine' : ''}" data-slug="${escAttr(i.slug)}" role="listitem">
        <img class="cdet-bel-img" src="${escAttr(i.thumbUrl || i.imageUrl)}" alt="${escHtml(i.name)}" loading="lazy" decoding="async">
        <figcaption class="cdet-bel-cap">${escHtml(i.name)}</figcaption>
        ${isMine ? `<span class="ppick-mine">${escHtml(t('charprop.mine'))}${myQty(i.slug) > 1 ? ` ×${myQty(i.slug)}` : ''}</span>` : ''}
      </figure>`;
    }).join('');
  }

  function render() { renderBar(); renderGrid(); }

  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-ppick-cat]');
    if (!b) return;
    state.cat = b.dataset.ppickCat;
    renderBar(); renderGrid();
  });

  let searchTimer = null;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = search.value.trim(); renderGrid(); }, 200);
  });

  grid.addEventListener('click', async e => {
    const tile = e.target.closest('.ppick-tile');
    if (!tile || tile.classList.contains('mine')) return; // свои не дублируем
    const slug = tile.dataset.slug;
    try {
      const resp = await fetch(`/api/property/items/${encodeURIComponent(slug)}/owners${_propQs()}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: charName }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || t('property.toast.error', { msg: resp.status }));
      await loadProperty();
      showToast(t('charprop.added'), 'success');
      if (typeof onChanged === 'function') await onChanged();
      render();
    } catch (err) {
      showToast(t('charprop.addError') + err.message, 'error');
    }
  });

  ov.querySelector('[data-x="close"]').onclick = () => ov.remove();
  ov.querySelector('[data-x="new"]').onclick = () => {
    ov.remove();
    openPropertyForm(null, {
      asOwners: true,
      initialOwners: [{ name: charName, qty: 1 }],
      onSaved: async () => { if (typeof onChanged === 'function') await onChanged(); },
    });
  };

  search.focus();
  render();
}