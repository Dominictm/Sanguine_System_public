'use strict';
// Имущество (Архив → Имущество) — общегородской склад предметов.
// Вкладки-категории (глобальные) + плитки предметов (per-city) + модалка предмета.
// API: /api/property/categories, /api/property/items. Спека: doc/specs/archive-property/spec.md.

const _prop = {
  categories: [],
  items:       [],
  activeCat:   null,
  search:      '',
};

const PROP_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="100%" height="100%" fill="#2a2a2a"/>' +
  '<text x="50%" y="50%" fill="#888" font-family="sans-serif" font-size="14" text-anchor="middle" dominant-baseline="middle">нет фото</text></svg>'
);

function _propQs() { return CITY ? `?city=${encodeURIComponent(CITY)}` : ''; }

// Имена персонажей города — для выбора владельца уникального предмета.
async function _propCharNames() {
  let list = (typeof STATE !== 'undefined' && Array.isArray(STATE.characters) && STATE.characters.length) ? STATE.characters : null;
  if (!list) {
    try { const d = await fetch(`/api/characters${_propQs()}`).then(r => r.json()); list = Array.isArray(d) ? d : []; }
    catch { list = []; }
  }
  return [...new Set(list.map(c => c && c.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// ── Загрузка и рендер страницы ───────────────────────────────────────────────

// Кэш раздела для внешних потребителей (вкладка карточки, пикер): грузит один
// раз, дальше отдаёт готовое. Сам loadProperty() дополнительно перерисовывает
// сетку раздела — из модалки карточки это безвредно (страница скрыта).
async function ensurePropertyLoaded() {
  if (_prop.categories.length) return;
  await loadProperty();
}

async function loadProperty() {
  const grid = document.getElementById('property-grid');
  const empty = document.getElementById('property-empty');
  if (empty) empty.style.display = 'none';
  if (grid) grid.innerHTML = `<div class="loading-state"><div class="spinner"></div>${t('ui.loading')}</div>`;
  _wirePropertyToolbar();
  try {
    const [cats, items] = await Promise.all([
      fetch('/api/property/categories').then(r => r.json()),
      fetch(`/api/property/items${_propQs()}`).then(r => r.json()),
    ]);
    if (!cats.ok) throw new Error(cats.error || t('property.toast.error', { msg: 'categories' }));
    if (!items.ok) throw new Error(items.error || t('property.toast.error', { msg: 'items' }));
    _prop.categories = cats.categories || [];
    _prop.items      = items.items || [];
    if (!_prop.activeCat || !_prop.categories.some(c => c.id === _prop.activeCat))
      _prop.activeCat = _prop.categories[0] ? _prop.categories[0].id : null;
    renderPropertyTabs();
    renderPropertyGrid();
  } catch (e) {
    if (grid) grid.innerHTML = `<div class="cdet-empty">${escHtml(e.message)}</div>`;
  }
}

// Открыть предмет по слагу (из глобального поиска): перейти на страницу и
// показать модалку предмета.
async function openPropertyItem(slug) {
  const page = document.getElementById('page-property');
  if (!page || !page.classList.contains('active')) navigate('property');
  await loadProperty();
  const it = _prop.items.find(i => i.slug === slug);
  if (!it) { showToast(t('property.empty.noItems'), 'error'); return; }
  _prop.activeCat = it.categoryId;
  renderPropertyTabs();
  renderPropertyGrid();
  openPropertyView(it);
}

function _wirePropertyToolbar() {
  const search = document.getElementById('property-search');
  if (search && !search.dataset.wired) {
    search.dataset.wired = '1';
    let tm = null;
    search.addEventListener('input', () => {
      clearTimeout(tm);
      tm = setTimeout(() => { _prop.search = search.value.trim().toLowerCase(); renderPropertyGrid(); }, 250);
    });
  }
  const addBtn = document.getElementById('property-add-btn');
  if (addBtn && !addBtn.dataset.wired) {
    addBtn.dataset.wired = '1';
    addBtn.addEventListener('click', () => openPropertyForm(null));
  }
}

// ── Вкладки категорий ────────────────────────────────────────────────────────

function _catItemCount(cat) {
  return _prop.items.filter(i => i.categoryId === cat.id).length;
}

// Полоса категорий повторяет подвкладки Библиотеки (.disciplines-subtab-btn +
// .rit-count): та же типографика и активная подсветка, чтобы раздел Имущества
// читался в одном ряду с фильтрами библиотеки. Отличие — категории можно
// переименовать/удалить прямо из вкладки, поэтому действия висят в
// .property-tab-actions и проявляются на hover/focus-within.
function renderPropertyTabs() {
  const bar = document.getElementById('property-tabbar');
  if (!bar) return;
  const cats = _prop.categories;
  let html = '';
  for (const c of cats) {
    const n = _catItemCount(c);
    const on = c.id === _prop.activeCat;
    html += `<span class="disciplines-subtab-btn property-tab${on ? ' active' : ''}" data-cat="${escAttr(c.id)}">
      <span class="property-tab-name">${escHtml(c.name)} <span class="rit-count">${n}</span></span>
      <span class="property-tab-actions">
        <button type="button" class="property-tab-act property-tab-edit" data-cat="${escAttr(c.id)}"
          title="${t('property.btn.editCategory')}" aria-label="${t('property.btn.editCategory')}">✎</button>
        <button type="button" class="property-tab-act property-tab-del" data-cat="${escAttr(c.id)}"
          title="${t('property.btn.deleteCategory')}" aria-label="${t('property.btn.deleteCategory')}">✕</button>
      </span>
    </span>`;
  }
  html += `<button type="button" class="disciplines-subtab-btn property-tab-add" id="property-add-cat">${t('property.btn.addCategory')}</button>`;
  bar.innerHTML = html;

  bar.querySelectorAll('.property-tab').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.property-tab-act')) return;
      _prop.activeCat = el.dataset.cat;
      renderPropertyTabs();
      renderPropertyGrid();
    });
    el.addEventListener('dblclick', e => {
      if (e.target.closest('.property-tab-act')) return;
      promptCategory('rename', el.dataset.cat);
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
    });
  });
  bar.querySelectorAll('.property-tab-edit').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); promptCategory('rename', b.dataset.cat); }));
  bar.querySelectorAll('.property-tab-del').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); _deleteCategory(b.dataset.cat); }));
  const addCat = document.getElementById('property-add-cat');
  if (addCat) addCat.addEventListener('click', () => promptCategory('create'));
}

// ── Сетка предметов ──────────────────────────────────────────────────────────

function renderPropertyGrid() {
  const grid  = document.getElementById('property-grid');
  const empty = document.getElementById('property-empty');
  if (!grid || !empty) return;

  const sub = document.getElementById('property-sub');
  if (sub) sub.textContent = t('property.sub');

  if (!_prop.categories.length) {
    grid.innerHTML = ''; grid.style.display = 'none';
    empty.textContent = t('property.empty.noCategories');
    empty.style.display = '';
    return;
  }
  if (!_prop.activeCat) _prop.activeCat = _prop.categories[0].id;

  let list = _prop.items.filter(i => i.categoryId === _prop.activeCat);
  if (_prop.search) {
    list = list.filter(i => `${i.name} ${i.description || ''}`.toLowerCase().includes(_prop.search));
  }

  if (!list.length) {
    grid.innerHTML = ''; grid.style.display = 'none';
    empty.textContent = _prop.search ? t('property.empty.noItems') : t('property.empty.noItemsAll');
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  grid.style.display = '';
  grid.innerHTML = list.map(_tileHtml).join('');
}

function _tileHtml(it) {
  const thumb = it.thumbUrl || PROP_PLACEHOLDER;
  const desc  = (it.description || '').slice(0, 60);
  return `<figure class="cdet-bel-tile property-tile" data-slug="${escAttr(it.slug)}" role="listitem">
    <img class="cdet-bel-img" src="${escAttr(thumb)}" alt="${escHtml(it.name)}" loading="lazy" decoding="async"
      data-act="view" title="${escAttr(it.name)}" onerror="this.src='${PROP_PLACEHOLDER}'">
    <figcaption class="cdet-bel-cap" data-act="view">${escHtml(it.name)}</figcaption>
    ${desc ? `<div class="cdet-bel-desc" title="${escAttr(it.description)}">${escHtml(desc)}${it.description.length > 60 ? '…' : ''}</div>` : ''}
    ${it.unique ? `<span class="property-qty" title="${escAttr(t('property.form.unique'))}">${escHtml(t('property.badge.unique'))}</span>` : ''}
    <button class="cdet-bel-btn cdet-bel-edit" data-act="edit" title="${t('property.btn.editItem')}" aria-label="${t('property.btn.editItem')}">✎</button>
    <button class="cdet-bel-btn cdet-bel-del" data-act="del" title="${t('property.btn.deleteItem')}" aria-label="${t('property.btn.deleteItem')}">✕</button>
  </figure>`;
}

// Делегирование кликов по сетке (плитка / ✎ / ✕).
document.addEventListener('click', e => {
  const tile = e.target.closest('.property-tile');
  if (!tile) return;
  const item = _prop.items.find(i => i.slug === tile.dataset.slug);
  if (!item) return;
  const act = (e.target.closest('[data-act]') || {}).dataset?.act;
  if (act === 'edit')       openPropertyForm(item);
  else if (act === 'del')   _deleteItem(item);
  else if (act === 'view')  openPropertyView(item);
});

// ── Модалка просмотра предмета ───────────────────────────────────────────────

function openPropertyView(it) {
  const cat = _prop.categories.find(c => c.id === it.categoryId);
  const rows = [
    [t('property.form.category'), cat ? cat.name : it.category],
    it.unique ? [t('property.form.unique'), (it.owners || [])[0]?.name || t('property.form.uniqueOwner.none')] : null,
    it.price ? [t('property.form.stats'), it.price] : null,
  ].filter(Boolean);
  const img = it.imageUrl || PROP_PLACEHOLDER;

  const ov = _overlay(`
    <div class="confirm-box property-view" role="document" style="max-width:820px">
      <div class="confirm-title">${escHtml(it.name)}</div>
      <div class="property-view-body">
        <div class="property-view-imgwrap">
          <img src="${escAttr(img)}" alt="${escHtml(it.name)}" onerror="this.src='${PROP_PLACEHOLDER}'">
        </div>
        <div class="property-view-info">
          <div class="property-view-fields">
            ${rows.map(([k, v]) => `<div class="property-view-row"><span class="property-view-k">${escHtml(k)}</span><span class="property-view-v">${escHtml(v)}</span></div>`).join('')}
          </div>
          ${it.description ? `<div class="property-view-block"><div class="property-view-k">${t('property.form.description')}</div><p>${escHtml(it.description)}</p></div>` : ''}
          ${it.stats ? `<div class="property-view-block"><div class="property-view-k">${t('property.form.stats')}</div><p>${escHtml(it.stats)}</p></div>` : ''}
        </div>
      </div>
      <div class="confirm-acts">
        <button class="chr-modal-btn cancel" data-x="edit">${t('property.btn.editItem')}</button>
        <button class="chr-modal-btn cancel" data-x="del">${t('property.btn.deleteItem')}</button>
        <button class="chr-modal-btn create" data-x="close">${t('ui.btn.close')}</button>
      </div>
    </div>`, 'prop-view-overlay');

  ov.querySelector('[data-x="close"]').onclick = () => ov.remove();
  ov.querySelector('[data-x="edit"]').onclick = () => { ov.remove(); openPropertyForm(it); };
  ov.querySelector('[data-x="del"]').onclick  = () => { ov.remove(); _deleteItem(it); };
}

// ── Форма добавления/редактирования предмета ─────────────────────────────────

// opts (необязательно, для вызова из карточки персонажа — спека char-property-link):
//   initialOwners: [{ name, qty? }] — предзаполнение владельца (+количества);
//   asOwners: true — слать owners[] вместо owner-строки (тот же POST, те же правила);
//   onSaved(item) — колбэк после успешного сохранения.
function openPropertyForm(it, opts = {}) {
  if (!_prop.categories.length) { showToast(t('property.empty.noCategories'), 'error'); return; }
  const isEdit = !!it;
  const catOptions = _prop.categories.map(c =>
    `<option value="${escAttr(c.id)}" ${it && it.categoryId === c.id ? 'selected' : (!it && c.id === _prop.activeCat ? 'selected' : '')}>${escHtml(c.name)}</option>`
  ).join('');

  const ov = _overlay(`
    <div class="confirm-box" role="document" style="max-width:560px">
      <div class="confirm-title">${isEdit ? t('property.modal.editItem') : t('property.modal.addItem')}</div>
      <label class="form-label">${t('property.form.name')}</label>
      <input class="form-control" id="_prop-name" maxlength="200" value="${escAttr(it ? it.name : '')}">

      <label class="form-label" style="margin-top:10px">${t('property.form.category')}</label>
      <select class="form-control" id="_prop-cat">${catOptions}</select>

      <label class="form-label" style="margin-top:10px">${t('property.form.image')}</label>
      <input type="file" id="_prop-img" accept="image/jpeg,image/png,image/webp,image/gif" class="form-control">
      <div class="property-img-hint" id="_prop-img-hint" style="font-size:var(--fs-sm);color:var(--text3);margin-top:4px">
        ${isEdit && it.image ? escHtml(it.image) : ''}
      </div>

      <label class="form-label" style="margin-top:10px">${t('property.form.description')}</label>
      <textarea class="form-control" id="_prop-desc" rows="3" maxlength="1000" placeholder="${t('property.form.description.ph')}">${escHtml(it ? it.description : '')}</textarea>

      <label class="form-label" style="margin-top:10px">${t('property.form.stats')}</label>
      <textarea class="form-control" id="_prop-stats" rows="2" maxlength="1000" placeholder="${t('property.form.stats.ph')}">${escHtml(it ? (it.stats || it.price || '') : '')}</textarea>

      <label class="property-unique-row" style="margin-top:10px">
        <input type="checkbox" id="_prop-unique" ${it && it.unique ? 'checked' : ''}>
        <span>${t('property.form.unique')}</span>
      </label>
      <div id="_prop-unique-wrap" style="display:${it && it.unique ? '' : 'none'}">
        <label class="form-label" for="_prop-unique-owner" style="margin-top:6px">${t('property.form.uniqueOwner')}</label>
        <select class="form-control" id="_prop-unique-owner"><option value="">${t('property.form.uniqueOwner.none')}</option></select>
      </div>

      <div class="bel-cap-err" id="_prop-err" style="display:none;font-size:var(--fs-sm);margin-top:6px"></div>
      <div class="confirm-acts" style="margin-top:12px">
        <button class="chr-modal-btn cancel" data-x="cancel" type="button">${t('ui.btn.cancel')}</button>
        <button class="chr-modal-btn create" data-x="save" type="button">${t('ui.btn.save')}</button>
      </div>
    </div>`, 'prop-form-overlay');

  const nameI = ov.querySelector('#_prop-name');
  const err   = ov.querySelector('#_prop-err');
  const imgI  = ov.querySelector('#_prop-img');
  const hint  = ov.querySelector('#_prop-img-hint');
  let upload  = null; // { base64, ext }

  // Уникальный предмет: чекбокс открывает выбор единственного владельца.
  const uniqI  = ov.querySelector('#_prop-unique');
  const uniqW  = ov.querySelector('#_prop-unique-wrap');
  const ownerS = ov.querySelector('#_prop-unique-owner');
  const preOwner = (it && (it.owners || [])[0]?.name)
    || (opts.initialOwners || []).find(o => o && o.name)?.name || '';
  uniqI.addEventListener('change', () => { uniqW.style.display = uniqI.checked ? '' : 'none'; });
  _propCharNames().then(names => {
    if (preOwner && !names.includes(preOwner)) names.unshift(preOwner);
    ownerS.insertAdjacentHTML('beforeend', names.map(n =>
      `<option value="${escAttr(n)}"${n === preOwner ? ' selected' : ''}>${escHtml(n)}</option>`).join(''));
  });

  imgI.addEventListener('change', () => {
    const file = imgI.files && imgI.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { err.textContent = t('property.toast.error', { msg: 'image' }); err.style.display = ''; return; }
    if (file.size > 20 * 1024 * 1024) { err.textContent = t('property.toast.error', { msg: '20MB' }); err.style.display = ''; return; }
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result);
      upload = { base64: res.split(',')[1] || '', ext };
      hint.innerHTML = `<img src="${escAttr(res)}" alt="" style="max-height:70px;border-radius:var(--r-md)">`;
    };
    reader.readAsDataURL(file);
  });

  ov.querySelector('[data-x="cancel"]').onclick = () => ov.remove();
  ov.querySelector('[data-x="save"]').onclick = async () => {
    const name = nameI.value.trim();
    if (!name) { err.textContent = t('property.form.name'); err.style.display = ''; return; }
    const body = {
      name,
      category: ov.querySelector('#_prop-cat').value,
      description: ov.querySelector('#_prop-desc').value.trim(),
      stats: ov.querySelector('#_prop-stats').value.trim(),
    };
    // Полей «Количество» и «Владелец» в форме нет. PUT заменяет владельцев целиком,
    // поэтому при правке отправляем текущих как есть; при создании из карточки
    // персонажа владелец — сам персонаж (opts.initialOwners), из раздела — без владельца.
    if (isEdit) {
      body.owners = Array.isArray(it.owners) ? it.owners.map(o => ({ name: o.name, qty: o.qty })) : [];
      body.quantity = it.quantity ?? 1;
    } else if (opts.asOwners && Array.isArray(opts.initialOwners)) {
      body.owners = opts.initialOwners.filter(o => o && o.name).map(o => ({ name: o.name, qty: o.qty >= 1 ? o.qty : 1 }));
      body.quantity = body.owners.length ? body.owners.reduce((s, o) => s + o.qty, 0) : 1;
    } else {
      body.owners = [];
      body.quantity = 1;
    }
    // Уникальный: владелец — только выбранный в списке (или никто).
    body.unique = uniqI.checked;
    if (body.unique) {
      body.owners = ownerS.value ? [{ name: ownerS.value, qty: 1 }] : [];
      body.quantity = 1;
    }
    if (upload) { body.base64 = upload.base64; body.ext = upload.ext; }
    try {
      const resp = await fetch(`/api/property/items${isEdit ? '/' + encodeURIComponent(it.slug) : ''}${_propQs()}`,
        { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || t('property.toast.error', { msg: resp.status }));
      ov.remove();
      showToast(isEdit ? t('property.toast.itemUpdated') : t('property.toast.itemCreated'), 'success');
      await loadProperty();
      if (typeof opts.onSaved === 'function') await opts.onSaved(data.item);
    } catch (e) {
      err.textContent = e.message; err.style.display = '';
    }
  };

  nameI.focus();
  nameI.select();
  nameI.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ov.querySelector('#_prop-desc').focus(); } });
}

// ── Категории: create/rename/delete ──────────────────────────────────────────

function _findCat(id) { return _prop.categories.find(c => c.id === id); }

function promptCategory(mode, id) {
  const cat = id ? _findCat(id) : null;
  if (mode === 'rename' && !cat) return;
  const ov = _overlay(`
    <div class="confirm-box" role="document" style="max-width:460px">
      <div class="confirm-title">${mode === 'create' ? t('property.modal.addCategory') : t('property.modal.editCategory')}</div>
      <input class="form-control" id="_prop-catname" maxlength="200" placeholder="${t('property.modal.categoryName.ph')}"
        value="${cat ? escAttr(cat.name) : ''}">
      <div class="bel-cap-err" id="_prop-caterr" style="display:none;font-size:var(--fs-sm);margin-top:6px"></div>
      <div class="confirm-acts" style="margin-top:12px">
        <button class="chr-modal-btn cancel" data-x="cancel" type="button">${t('ui.btn.cancel')}</button>
        <button class="chr-modal-btn create" data-x="save" type="button">${t('ui.btn.save')}</button>
      </div>
    </div>`, 'prop-cat-overlay');

  const inp = ov.querySelector('#_prop-catname');
  const err = ov.querySelector('#_prop-caterr');
  ov.querySelector('[data-x="cancel"]').onclick = () => ov.remove();
  ov.querySelector('[data-x="save"]').onclick = async () => {
    const name = inp.value.trim();
    if (!name) { err.textContent = t('property.modal.categoryName'); err.style.display = ''; return; }
    try {
      const url = mode === 'create' ? '/api/property/categories' : `/api/property/categories/${encodeURIComponent(id)}`;
      const resp = await fetch(url, { method: mode === 'create' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || t('property.toast.error', { msg: resp.status }));
      ov.remove();
      if (mode === 'create' && data.category) _prop.activeCat = data.category.id;
      showToast(mode === 'create' ? t('property.toast.categoryCreated') : t('property.toast.categoryUpdated'), 'success');
      await loadProperty();
    } catch (e) { err.textContent = e.message; err.style.display = ''; }
  };
  inp.focus(); inp.select();
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') ov.querySelector('[data-x="save"]').click(); });
}

async function _deleteCategory(id) {
  const cat = _findCat(id);
  if (!cat) return;
  const n = _catItemCount(cat);
  const ok = await showConfirm(t('property.confirm.deleteCategory', { name: cat.name, count: n }), { danger: true, confirmText: t('ui.btn.delete') });
  if (!ok) return;
  try {
    const resp = await fetch(`/api/property/categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || t('property.toast.error', { msg: resp.status }));
    if (_prop.activeCat === id) _prop.activeCat = null;
    showToast(t('property.toast.categoryDeleted'), 'success');
    await loadProperty();
  } catch (e) { showToast(e.message, 'error'); }
}

async function _deleteItem(it) {
  const ok = await showConfirm(t('property.confirm.deleteItem', { name: it.name }), { danger: true, confirmText: t('ui.btn.delete') });
  if (!ok) return;
  try {
    const resp = await fetch(`/api/property/items/${encodeURIComponent(it.slug)}${_propQs()}`, { method: 'DELETE' });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || t('property.toast.error', { msg: resp.status }));
    showToast(t('property.toast.itemDeleted'), 'success');
    await loadProperty();
  } catch (e) { showToast(e.message, 'error'); }
}

// ── Общий оверлей модалки ────────────────────────────────────────────────────

function _overlay(innerHtml, id) {
  const ov = document.createElement('div');
  ov.id = id;
  ov.className = 'prop-overlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.innerHTML = innerHtml;
  document.body.appendChild(ov);
  const onKey = e => { if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  return ov;
}
