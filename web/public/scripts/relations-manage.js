// ═══════════════════════════════════════════════════════════════
// Управление связями — «Постоянные» / «Авторские». Открывается с графа (сосед
// #btn-reset). Оба раздела — это ОДИН документ города,
// cities/<город>/rules/relation_types.md (техспека 2026-08-26): «Авторские» больше не
// вычисляются на лету обходом карточек, а хранятся, поэтому у них есть свой цвет, они
// переживают перезагрузку и переносятся в «Постоянные» без потери слага.
// ═══════════════════════════════════════════════════════════════

// Кеш видов связи. Ключ — город: словарь у каждого города свой, и без ключа Лондон
// покрасился бы палитрой Парижа (смена города идёт через полную перезагрузку страницы,
// но кеш переживает мягкие переходы внутри SPA).
let _relTypesCache = null;   // { city, permanent: [], authored: [] }
let _relTypesFull  = [];     // «Постоянные» — источник для фильтра поиска
let _authoredFull  = [];     // то же для «Авторских»

const REL_TYPES_URL = () => `/api/cities/${encodeURIComponent(CITY)}/relation-types`;

/** Документ видов связи текущего города: { permanent, authored }, порядок — как в файле. */
async function ensureRelTypesDoc(force) {
  if (_relTypesCache && _relTypesCache.city === CITY && !force) return _relTypesCache;
  const d = await fetch(REL_TYPES_URL()).then(r => r.json()).catch(() => ({}));
  _relTypesCache = { city: CITY, permanent: d.permanent || [], authored: d.authored || [] };
  return _relTypesCache;
}
/** Плоский список обоих разделов — пикер «Вид отношений» и авто-пары (char-detail.js). */
async function ensureRelTypes(force) {
  const doc = await ensureRelTypesDoc(force);
  return [...doc.permanent, ...doc.authored];
}
// Граф кеширует данные между заходами (STATE.graph.inited, graph.js) — тот же класс
// устаревания, что уже находили для STATE.characters (Фаза 3). Создание/переименование/
// удаление/перенос вида меняет то, чем красится граф — сбрасываем флаг тем же паттерном.
function invalidateRelTypesCache() { _relTypesCache = null; STATE.graph.inited = false; }

function _relItemHtml(t) {
  // Канонические 11 (сид system/library/relation-types.json) защищены от правки; всё
  // остальное в любом разделе — авторское и правится. Признак теперь приезжает с сервера
  // (canon), а не выводится из принадлежности разделу: перенос в «Постоянные» не должен
  // делать вид неудаляемым.
  const actions = t.canon
    ? ''
    : `<button type="button" class="relmgr-item-edit" data-relmgr-edit="${escAttr(t.slug)}" title="Переименовать" aria-label="Переименовать «${escAttr(t.name)}»">✏</button>
       <button type="button" class="relmgr-item-del" data-relmgr-del="${escAttr(t.slug)}" title="Удалить" aria-label="Удалить «${escAttr(t.name)}»">🗑</button>`;
  const usage = t.usage ? `<span class="relmgr-item-usage" title="Вид встречается в карточках персонажей">${t.usage}</span>` : '';
  return `
    <div class="relmgr-item" data-relmgr-slug="${escAttr(t.slug)}" data-relmgr-usage="${t.usage || 0}">
      <div class="rel-type-dot" style="background:${escAttr(t.color)}"></div>
      <span class="relmgr-item-name">${escHtml(t.name)}</span>
      <span class="relmgr-item-actions">${usage}${actions}</span>
    </div>`;
}

function _renderPermanentFiltered(query) {
  const q = (query || '').toLowerCase();
  const list = _relTypesFull.filter(t => !q || t.name.toLowerCase().includes(q));
  const box = document.getElementById('relmgr-permanent-list');
  box.innerHTML = list.length ? list.map(_relItemHtml).join('')
    : `<div class="cdet-empty">${_relTypesFull.length ? 'Ничего не найдено.' : 'Список пуст.'}</div>`;
}

function _renderAuthoredFiltered(query) {
  const q = (query || '').toLowerCase();
  const list = _authoredFull.filter(t => !q || t.name.toLowerCase().includes(q));
  const box = document.getElementById('relmgr-authored-list');
  box.innerHTML = list.length ? list.map(t => `
    <div class="relmgr-item" data-relmgr-slug="${escAttr(t.slug)}" data-relmgr-usage="${t.usage || 0}">
      <div class="rel-type-dot" style="background:${escAttr(t.color)}"></div>
      <span class="relmgr-item-name">${escHtml(t.name)}</span>
      <span class="relmgr-item-actions">
        ${t.usage ? `<span class="relmgr-item-usage" title="Вид встречается в карточках персонажей">${t.usage}</span>` : ''}
        <button type="button" class="relmgr-item-edit" data-relmgr-edit="${escAttr(t.slug)}" title="Переименовать" aria-label="Переименовать «${escAttr(t.name)}»">✏</button>
        <button type="button" class="relmgr-item-del" data-relmgr-del="${escAttr(t.slug)}" title="Удалить" aria-label="Удалить «${escAttr(t.name)}»">🗑</button>
        <button type="button" class="relmgr-item-promote" data-relmgr-promote="${escAttr(t.slug)}" aria-label="Сделать «${escAttr(t.name)}» постоянной связью">Сделать постоянной</button>
      </span>
    </div>`).join('')
    : `<div class="cdet-empty">${_authoredFull.length ? 'Ничего не найдено.' : 'Авторских связей не найдено.'}</div>`;
}

async function _refreshRelMgr(force) {
  const doc = await ensureRelTypesDoc(force);
  _relTypesFull = doc.permanent;
  _authoredFull = doc.authored;
  _renderPermanentFiltered(document.getElementById('relmgr-permanent-search')?.value || '');
  _renderAuthoredFiltered(document.getElementById('relmgr-authored-search')?.value || '');
}

document.getElementById('btn-manage-relations')?.addEventListener('click', async () => {
  invalidateRelTypesCache();
  const permSearch = document.getElementById('relmgr-permanent-search');
  const authSearch = document.getElementById('relmgr-authored-search');
  if (permSearch) permSearch.value = '';
  if (authSearch) authSearch.value = '';
  openModal('relations-manage-modal');
  await _refreshRelMgr(true);
});
document.getElementById('relmgr-close')?.addEventListener('click', () => closeModal('relations-manage-modal'));

document.getElementById('relmgr-permanent-search')?.addEventListener('input', e => _renderPermanentFiltered(e.target.value));
document.getElementById('relmgr-authored-search')?.addEventListener('input', e => _renderAuthoredFiltered(e.target.value));

document.getElementById('relmgr-add-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('relmgr-new-name');
  const errBox = document.getElementById('relmgr-add-error');
  errBox.style.display = 'none';
  const name = input.value.trim();
  if (!name) return;
  const r = await fetch(REL_TYPES_URL(), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  const d = await r.json();
  if (!r.ok) { errBox.textContent = d.error || 'Не удалось добавить связь'; errBox.style.display = ''; return; }
  input.value = '';
  invalidateRelTypesCache();
  await _refreshRelMgr(true);
});

// Инлайн-редактирование имени по клику ✏ (не prompt() — третий слой диалога поверх уже
// открытой модалки поверх графа, лишний скачок контекста для правки одного слова; тот же
// паттерн, что вкладка «Информация» карточки персонажа, .cdet-field-input).
function _startInlineEdit(row, slug) {
  const nameEl = row.querySelector('.relmgr-item-name');
  const current = nameEl.textContent;
  const usage = Number(row.dataset.relmgrUsage) || 0;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'relmgr-item-name-input';
  input.value = current;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const commit = async () => {
    if (done) return; done = true;
    const next = input.value.trim();
    if (!next || next === current) { await _refreshRelMgr(true); return; }
    // Карточки персонажей ссылаются на вид ПО ИМЕНИ, и переименование их не трогает —
    // массовая перезапись личных файлов хроники необратима, её должен запускать владелец
    // данных отдельно, а не получать побочным эффектом правки словаря. Но масштаб
    // расхождения он обязан видеть заранее.
    if (usage) {
      const ok = await showConfirm(
        `Вид «${current}» используется в ${usage} ${_relCardsWord(usage)}. Их текст не изменится — там останется «${current}».`,
        { confirmText: 'Переименовать' });
      if (!ok) { await _refreshRelMgr(true); return; }
    }
    const r = await fetch(`${REL_TYPES_URL()}/${encodeURIComponent(slug)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: next }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); showToast(d.error || 'Не удалось переименовать связь', 'error'); }
    invalidateRelTypesCache();
    await _refreshRelMgr(true);
  };
  const cancel = async () => { if (done) return; done = true; await _refreshRelMgr(true); };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
}

function _relCardsWord(n) {
  const t = n % 100, o = n % 10;
  if (t >= 11 && t <= 14) return 'карточках';
  return o === 1 ? 'карточке' : 'карточках';
}

document.addEventListener('click', async e => {
  const delBtn = e.target.closest('[data-relmgr-del]');
  if (delBtn) {
    const row = delBtn.closest('.relmgr-item');
    const name = row?.querySelector('.relmgr-item-name')?.textContent || '';
    const usage = Number(row?.dataset.relmgrUsage) || 0;
    // Удаление вида не чинит карточки: связи с этим именем на следующем чтении уедут
    // по остальным шагам резолвера — скорее всего в «Нейтральный», скрытый на графе
    // по умолчанию. Диалог обязан это назвать (§4.5).
    const ok = await showConfirm(
      usage
        ? `Удалить связь «${name}» из словаря города? Она используется в ${usage} ${_relCardsWord(usage)} — эти связи уедут в «Нейтральный» и по умолчанию скроются на графе.`
        : `Удалить связь «${name}» из словаря города?`,
      { danger: true, confirmText: 'Удалить' });
    if (!ok) return;
    const r = await fetch(`${REL_TYPES_URL()}/${encodeURIComponent(delBtn.dataset.relmgrDel)}`, { method: 'DELETE' });
    if (!r.ok) { const d = await r.json().catch(() => ({})); showToast(d.error || 'Не удалось удалить связь', 'error'); }
    invalidateRelTypesCache();
    await _refreshRelMgr(true);
    return;
  }
  const editBtn = e.target.closest('[data-relmgr-edit]');
  if (editBtn) {
    _startInlineEdit(editBtn.closest('.relmgr-item'), editBtn.dataset.relmgrEdit);
    return;
  }
  const promoteBtn = e.target.closest('[data-relmgr-promote]');
  if (promoteBtn) {
    // Перенос строки между разделами одного файла — слаг, цвет, пара и ключевые слова
    // сохраняются. Раньше кнопка делала POST, то есть СОЗДАВАЛА новую запись с новым
    // цветом, а «авторская» строка исчезала лишь потому, что переставала отличаться
    // от постоянной.
    const r = await fetch(`${REL_TYPES_URL()}/${encodeURIComponent(promoteBtn.dataset.relmgrPromote)}/promote`, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(d.error || 'Не удалось сделать связь постоянной', 'error'); return; }
    invalidateRelTypesCache();
    await _refreshRelMgr(true);
    return;
  }
});
