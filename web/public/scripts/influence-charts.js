// Диаграммы влияния по локациям — страница «Фракции», вкладка «Карта фракций»
// (спека doc/design/influence-charts-2026-11-16/spec.md §7).
//
// Блоки приходят с сервера уже посчитанными (GET /api/influence): четыре для города
// («Фракции», «Кланы», «Линейки», «Маскарад») и семь разделов для района. Здесь — отрисовка: объёмный круг встроенным SVG
// (без библиотек — приложение работает офлайн) и список строк с точными числами.
// Круг декоративен: наклон искажает площади секторов, значения читаются из списка.

const INF_PIE = Object.freeze({
  R: 100,          // радиус круга в единицах viewBox
  TILT: 0.6,       // сжатие по вертикали — «наклон» круга
  DEPTH: 16,       // видимая толщина
  MAX_SLICES: 8,   // больше восьми секторов превращаются в неразличимые щепки
  MIN_ICON_D: 28,  // эмблема рисуется, если в сектор вписывается круг такого диаметра
  VISIBLE_ROWS: 8, // строк списка до кнопки «Показать все»
});
const INF_KEY_OTHER = '_other';
const INF_KEY_NONE = '_none';
const _infSpecial = key => key === INF_KEY_OTHER || key === INF_KEY_NONE;

/**
 * Строки блока → секторы круга. Строки с нулём сектором не становятся. Обычные строки
 * получают цвет палитры по своему месту в списке; когда секторов больше MAX_SLICES,
 * хвост складывается в один сектор «Остальные». Блок «Маскарад» красится по уровню.
 * @param {{key: string, name: ?string, value: number, icon: ?string}[]} rows
 * @param {string} block
 * @returns {{id: string, keys: string[], value: number, cls: string, icon: ?string, kind: string}[]}
 */
function influencePieSlices(rows, block) {
  const live = (rows || []).filter(r => r.value > 0);
  if (block === 'masquerade') {
    return live.map(r => ({ id: r.key, keys: [r.key], value: r.value, cls: `inf-c-${r.key}`, icon: null, kind: 'row' }));
  }
  const regular  = live.filter(r => !_infSpecial(r.key));
  const specials = live.filter(r => _infSpecial(r.key));
  const slots = INF_PIE.MAX_SLICES - specials.length;
  const head  = regular.length > slots ? regular.slice(0, slots - 1) : regular;
  const tail  = regular.slice(head.length);
  const slices = head.map((r, i) => ({ id: r.key, keys: [r.key], value: r.value, cls: `inf-c${i + 1}`, icon: r.icon || null, kind: 'row' }));
  if (tail.length) {
    slices.push({ id: '_rest', keys: tail.map(r => r.key), value: tail.reduce((s, r) => s + r.value, 0), cls: 'inf-c-rest', icon: null, kind: 'rest' });
  }
  for (const r of specials) {
    slices.push({ id: r.key, keys: [r.key], value: r.value, cls: r.key === INF_KEY_OTHER ? 'inf-c-other' : 'inf-c-none', icon: null, kind: r.key === INF_KEY_OTHER ? 'other' : 'none' });
  }
  return slices;
}

/**
 * Углы секторов: по часовой стрелке от верхней точки, в радианах, в сумме ровно 2π.
 * Значения нормируются к своей сумме — ручные числа могут дать не 100 %.
 */
function influencePieAngles(slices) {
  const sum = slices.reduce((s, x) => s + x.value, 0);
  if (!(sum > 0)) return [];
  let acc = 0;
  return slices.map((s, i) => {
    const a0 = (acc / sum) * 2 * Math.PI;
    acc += s.value;
    const a1 = i === slices.length - 1 ? 2 * Math.PI : (acc / sum) * 2 * Math.PI;
    return { ...s, a0, a1 };
  });
}

/** Диаметр круга, вписанного в сектор радиуса R с углом span. */
function influenceInscribedDiameter(span, R = INF_PIE.R) {
  const half = span / 2;
  if (half >= Math.PI / 2) return R;
  const s = Math.sin(half);
  return (2 * R * s) / (1 + s);
}

/** Квадрат, целиком накрывающий сектор, в координатах круга (до наклона). */
function influenceSliceBox(a0, a1, R = INF_PIE.R) {
  const pts = [[0, 0], [R * Math.sin(a0), -R * Math.cos(a0)], [R * Math.sin(a1), -R * Math.cos(a1)]];
  for (let k = 0; k <= 4; k++) {
    const a = (k * Math.PI) / 2;
    if (a > a0 && a < a1) pts.push([R * Math.sin(a), -R * Math.cos(a)]);
  }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const side = Math.max(maxX - minX, maxY - minY);
  return { x: (minX + maxX) / 2 - side / 2, y: (minY + maxY) / 2 - side / 2, size: side };
}

const _infN = v => (Math.round(v * 100) / 100).toString();

function _infTopPath(a0, a1) {
  const R = INF_PIE.R;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M0 0L${_infN(R * Math.sin(a0))} ${_infN(-R * Math.cos(a0))}A${R} ${R} 0 ${large} 1 ${_infN(R * Math.sin(a1))} ${_infN(-R * Math.cos(a1))}Z`;
}

// Боковая грань видна только на ближней к зрителю половине обода (углы от π/2 до 3π/2).
function _infSidePath(a0, a1) {
  const { R, TILT, DEPTH } = INF_PIE;
  const s0 = Math.max(a0, Math.PI / 2), s1 = Math.min(a1, (3 * Math.PI) / 2);
  if (s1 - s0 <= 1e-6) return '';
  const p = a => [R * Math.sin(a), -R * TILT * Math.cos(a)];
  const [x0, y0] = p(s0), [x1, y1] = p(s1);
  const ry = R * TILT;
  return `M${_infN(x0)} ${_infN(y0)}A${R} ${_infN(ry)} 0 0 1 ${_infN(x1)} ${_infN(y1)}L${_infN(x1)} ${_infN(y1 + DEPTH)}A${R} ${_infN(ry)} 0 0 0 ${_infN(x0)} ${_infN(y0 + DEPTH)}Z`;
}

const _infAttr = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * SVG объёмного круга. uid — уникальный префикс id клип-путей (на странице четыре круга).
 * titleOf(slice) — текст всплывающей подсказки сектора.
 */
function influencePieSvg(slices, uid, titleOf = () => '') {
  const { R, TILT, DEPTH } = INF_PIE;
  const pad = 4;
  const vb = `${-R - pad} ${_infN(-R * TILT - pad)} ${2 * (R + pad)} ${_infN(2 * R * TILT + DEPTH + 2 * pad)}`;
  const open = `<svg class="inf-pie" viewBox="${vb}" aria-hidden="true" focusable="false">`;
  const sectors = influencePieAngles(slices);
  if (!sectors.length) {
    return `${open}<path class="inf-side inf-c-none" d="${_infSidePath(0, 2 * Math.PI)}"/>`
      + `<g transform="scale(1 ${TILT})"><circle class="inf-top inf-c-none" r="${R}"/></g></svg>`;
  }
  const sides = sectors.map(s => {
    const d = _infSidePath(s.a0, s.a1);
    return d ? `<path class="inf-side ${s.cls}" data-inf-slice="${_infAttr(s.id)}" d="${d}"/>` : '';
  }).join('');
  const tops = sectors.map((s, i) => {
    const full = s.a1 - s.a0 >= 2 * Math.PI - 1e-6;
    const shape = cls => (full ? `<circle class="${cls}" r="${R}"/>` : `<path class="${cls}" d="${_infTopPath(s.a0, s.a1)}"/>`);
    const clipId = `${uid}-clip-${i}`;
    const withIcon = s.icon && influenceInscribedDiameter(s.a1 - s.a0) >= INF_PIE.MIN_ICON_D;
    let icon = '';
    if (withIcon) {
      const box = influenceSliceBox(s.a0, s.a1);
      // Не загрузилась — убираем картинку: под ней уже лежит заливка цветом сектора.
      icon = `<clipPath id="${clipId}">${shape('')}</clipPath>`
        + `<image class="inf-icon" href="${_infAttr(s.icon)}" x="${_infN(box.x)}" y="${_infN(box.y)}" width="${_infN(box.size)}" height="${_infN(box.size)}"`
        + ` preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" onerror="this.remove()"/>`
        + `<g clip-path="url(#${clipId})">${shape('inf-rim')}</g>`;
    }
    const title = titleOf(s);
    return `<g class="inf-slice ${s.cls}" data-inf-slice="${_infAttr(s.id)}">${title ? `<title>${_infAttr(title)}</title>` : ''}`
      + `${shape('inf-top')}${icon}${shape('inf-gap')}</g>`;
  }).join('');
  return `${open}${sides}<g transform="scale(1 ${TILT})">${tops}</g></svg>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { INF_PIE, influencePieSlices, influencePieAngles, influenceInscribedDiameter, influenceSliceBox, influencePieSvg };
}

// ── Панель ───────────────────────────────────────────────────────────────────
// Одна и та же панель рисуется в двух местах: на странице «Фракции» (четыре блока города,
// числа правятся вручную) и на вкладке «Фракции» карточки района (семь разделов района,
// только чтение). Настройки и состояние (раскрытая строка, «Показать все») лежат на самом
// элементе панели — panel._inf, поэтому панели не мешают друг другу.
const INF_CITY_BLOCKS = ['factions', 'clans', 'lineages', 'masquerade'];
const INF_DISTRICT_BLOCKS = ['sects', 'mortal', 'clans', 'families', 'tribes', 'kiths', 'courts'];

function _infRowName(block, row) {
  if (row.key === INF_KEY_OTHER) return t('inf.row.other');
  if (row.key === INF_KEY_NONE)  return t('inf.row.none');
  if (block === 'lineages')   return t(`inf.lineage.${row.key}`);
  if (block === 'masquerade') return t(`inf.masq.${row.key}`);
  return row.name || row.key;
}

function _infShare(share) {
  if (share >= 0.999) return '';
  const known = { 2: '½', 3: '⅓', 4: '¼' };
  const n = Math.round(1 / share);
  return Math.abs(1 / n - share) < 0.01 ? (known[n] || `1/${n}`) : `${Math.round(share * 100)}%`;
}

function _infBlockHtml(panel, block, rows, total) {
  const st = panel._inf;
  const uid = st.cfg.uid;
  const slices = influencePieSlices(rows, block);
  const clsOf = {};
  for (const s of slices) for (const k of s.keys) clsOf[k] = { cls: s.cls, id: s.id };
  const titleOf = s => (s.kind === 'rest'
    ? `${t('inf.row.rest')} — ${s.value}%`
    : `${_infRowName(block, rows.find(r => r.key === s.id) || { key: s.id })} — ${s.value}%`);
  const editable = st.cfg.editable && block !== 'masquerade';
  const sum = rows.reduce((s, r) => s + r.value, 0);
  const hasManual = rows.some(r => r.manual != null);
  const onlyNone = rows.length === 1 && rows[0].key === INF_KEY_NONE;

  const regular = rows.filter(r => !_infSpecial(r.key));
  const hiddenCount = Math.max(0, regular.length - INF_PIE.VISIBLE_ROWS);
  const showAll = !!st.showAll[block];
  let regularSeen = 0;

  const rowsHtml = rows.map((r, i) => {
    const name = _infRowName(block, r);
    const paint = clsOf[r.key] || { cls: 'inf-c-zero', id: '' };
    const special = _infSpecial(r.key);
    const collapsed = !special && ++regularSeen > INF_PIE.VISIBLE_ROWS && !showAll;
    const open = st.expanded[block] === r.key;
    const locsId = `${uid}-locs-${block}-${i}`;
    const locs = (r.locations || []).map(l => {
      const share = _infShare(l.share);
      return `<li class="inf-loc"><button type="button" class="inf-loc-link" data-inf-loc="${escAttr(l.slug)}">${escHtml(l.title)}</button>`
        + `${share ? `<span class="inf-loc-share">${share}</span>` : ''}</li>`;
    }).join('');
    const value = editable
      ? `<span class="inf-value"><input type="number" class="inf-input" min="0" max="100" step="1" inputmode="numeric" value="${r.value}"`
        + ` data-inf-prev="${r.value}" aria-label="${escAttr(t('inf.inputAria', { name }))}"><span class="inf-pct" aria-hidden="true">%</span></span>`
      : `<span class="inf-value inf-value-static">${block === 'masquerade' ? t('inf.masqCount', { n: r.count, pct: r.value }) : `${r.value}%`}</span>`;
    const manual = editable && r.manual != null
      ? `<span class="inf-manual"><span class="inf-manual-tag">${t('inf.manual')}</span> <span class="inf-manual-auto">${t('inf.autoWas', { pct: r.auto })}</span></span>`
        + `<button type="button" class="inf-reset" data-inf-reset title="${escAttr(t('inf.reset'))}" aria-label="${escAttr(t('inf.resetAria', { name }))}">↺</button>`
      : '';
    const emblem = r.icon && block !== 'masquerade'
      ? `<img class="inf-emblem" src="${escAttr(r.icon)}" alt="" aria-hidden="true" loading="lazy" decoding="async" onerror="this.remove()">`
      : '';
    return `<li class="inf-row${collapsed ? ' is-collapsed' : ''}${r.manual != null ? ' is-manual' : ''}" data-inf-key="${escAttr(r.key)}" data-inf-slice="${escAttr(paint.id)}">
      <div class="inf-row-main">
        <span class="inf-swatch ${paint.cls}" aria-hidden="true"></span>${emblem}
        <button type="button" class="inf-row-name" aria-expanded="${open}" aria-controls="${locsId}">${escHtml(name)}</button>
        ${manual}${value}
      </div>
      <ul class="inf-locs" id="${locsId}"${open ? '' : ' hidden'}>${locs || `<li class="inf-loc inf-loc-empty">${t('inf.noLocs')}</li>`}</ul>
    </li>`;
  }).join('');

  const more = hiddenCount
    ? `<li class="inf-more"><button type="button" class="inf-more-btn" data-inf-more aria-expanded="${showAll}">${showAll ? t('inf.showLess') : t('inf.showAll', { n: regular.length })}</button></li>`
    : '';
  const hint = onlyNone ? `<p class="inf-hint">${t(block === 'lineages' ? 'inf.hintPresence' : block === 'masquerade' ? 'inf.hintMasq' : 'inf.hintControl')}</p>` : '';
  const sumNote = editable && hasManual && sum !== 100 ? `<div class="inf-pie-sum">${t('inf.sum', { pct: sum })}</div>` : '';
  const sub = st.cfg.district ? '' : `<div class="inf-block-sub">${t('inf.byLocs', { n: total })}</div>`;

  return `<section class="inf-block" data-inf-block="${block}" aria-labelledby="${uid}-title-${block}">
    <h3 class="inf-block-title" id="${uid}-title-${block}">${t(`${st.cfg.district ? 'inf.dblock' : 'inf.block'}.${block}`)}</h3>
    ${sub}
    <div class="inf-block-body">
      <div class="inf-pie-wrap">${influencePieSvg(slices, `${uid}-${block}`, titleOf)}${sumNote}</div>
      <ul class="inf-rows">${rowsHtml}${more}</ul>
    </div>
    ${hint}
  </section>`;
}

function _infRender(panel) {
  const st = panel._inf;
  const data = st.data;
  if (!data) return;
  const uid = st.cfg.uid;
  const head = st.cfg.district
    ? `<div class="inf-block-sub" id="${uid}-title">${t('inf.district.byLocs', { n: data.total })}</div>`
    : `<h2 class="inf-charts-title" id="${uid}-title">${t('inf.title')}</h2>`;
  const wrap = body => `<section class="inf-charts${st.cfg.district ? ' inf-charts--district' : ''}" aria-labelledby="${uid}-title">${head}${body}</section>`;
  if (!data.total) {
    panel.innerHTML = wrap(st.cfg.district
      ? `<div class="cdet-empty inf-empty">${t('inf.district.noLocations')}</div>`
      : `<div class="cdet-empty inf-empty">${t('inf.noLocations')} <button type="button" class="inf-link" data-inf-goto="locations">${t('inf.gotoLocations')}</button></div>`);
    return;
  }
  // У района пустые разделы не показываются: семь кругов «нет данных» только шумят.
  const blocks = st.cfg.blocks.filter(b => !st.cfg.district || (data.blocks[b] || []).length);
  if (!blocks.length) {
    panel.innerHTML = wrap(`<div class="cdet-empty inf-empty">${t('inf.district.empty')}</div>`);
    return;
  }
  panel.innerHTML = wrap(`<div class="inf-grid">${blocks.map(b => _infBlockHtml(panel, b, data.blocks[b] || [], data.total)).join('')}</div>
    <div class="inf-status" role="status" aria-live="polite"></div>`);
}

async function _infLoad(panel, { announce = '', focus = null } = {}) {
  const st = panel._inf;
  if (!st.data) panel.innerHTML = '<div class="loading-state inf-loading"><div class="spinner"></div></div>';
  const url = st.cfg.url();
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    const data = await r.json();
    if (panel._inf !== st || st.cfg.url() !== url) return; // панель успели переключить на другой район
    st.data = data;
  } catch (e) {
    st.data = null;
    panel.innerHTML = `<div class="cdet-empty inf-error">${escHtml(t('inf.loadErr', { msg: e.message }))} <button type="button" class="inf-link" data-inf-retry>${t('inf.retry')}</button></div>`;
    return;
  }
  _infRender(panel);
  if (announce) { const s = panel.querySelector('.inf-status'); if (s) s.textContent = announce; }
  if (focus) {
    const row = [...panel.querySelectorAll(`[data-inf-block="${focus.block}"] .inf-row`)].find(el => el.dataset.infKey === focus.key);
    (row?.querySelector(focus.sel) || row?.querySelector('.inf-input') || row?.querySelector('.inf-row-name'))?.focus();
  }
}

async function _infSaveOverride(panel, block, key, value, focusSel) {
  const r = await fetch(`/api/influence/override${window.location.search}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ block, key, value }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.ok) throw new Error(body.error || t('archive.error'));
  await _infLoad(panel, { announce: t(value == null ? 'inf.resetDone' : 'inf.saved'), focus: { block, key, sel: focusSel } });
}

function _infBind(panel) {
  if (panel.dataset.infBound) return;
  panel.dataset.infBound = '1';

  panel.addEventListener('change', async e => {
    const input = e.target.closest('.inf-input');
    if (!input) return;
    const row = input.closest('.inf-row');
    const block = input.closest('[data-inf-block]').dataset.infBlock;
    const raw = input.value.trim();
    const val = Number(raw);
    // Только целое 0–100: дробь и пустое поле не округляем молча — Рассказчик должен видеть, что сохранилось.
    if (raw === '' || !Number.isInteger(val) || val < 0 || val > 100) {
      input.value = input.dataset.infPrev;
      showToast(t('inf.badValue'), 'error');
      return;
    }
    if (String(val) === input.dataset.infPrev) return;
    try { await _infSaveOverride(panel, block, row.dataset.infKey, val, '.inf-input'); }
    catch (err) {
      input.value = input.dataset.infPrev;
      showToast(t('inf.saveErr', { msg: err.message }), 'error');
    }
  });

  panel.addEventListener('click', async e => {
    const st = panel._inf;
    if (!st) return;
    if (e.target.closest('[data-inf-retry]')) { _infLoad(panel); return; }
    const go = e.target.closest('[data-inf-goto]');
    if (go) { navigate(go.dataset.infGoto); return; }
    const blockEl = e.target.closest('[data-inf-block]');
    if (!blockEl) return;
    const block = blockEl.dataset.infBlock;

    if (e.target.closest('[data-inf-more]')) {
      st.showAll[block] = !st.showAll[block];
      _infRender(panel);
      panel.querySelector(`[data-inf-block="${block}"] [data-inf-more]`)?.focus();
      return;
    }
    const loc = e.target.closest('[data-inf-loc]');
    if (loc) {
      const slug = loc.dataset.infLoc;
      // Модалки не стекуются: карточка района закрывается перед открытием локации.
      st.cfg.beforeOpenLoc?.();
      ensureLocsLoaded().then(() => openLocDetail(slug));
      return;
    }
    const row = e.target.closest('.inf-row');
    if (!row) return;
    const key = row.dataset.infKey;
    if (e.target.closest('[data-inf-reset]')) {
      try { await _infSaveOverride(panel, block, key, null, '.inf-input'); }
      catch (err) { showToast(t('inf.saveErr', { msg: err.message }), 'error'); }
      return;
    }
    if (e.target.closest('.inf-row-name')) {
      // Раскрыта одна строка на блок.
      st.expanded[block] = st.expanded[block] === key ? null : key;
      _infRender(panel);
      [...panel.querySelectorAll(`[data-inf-block="${block}"] .inf-row`)].find(el => el.dataset.infKey === key)
        ?.querySelector('.inf-row-name')?.focus();
    }
  });

  // Наведение и фокус связывают строку списка с её сектором (и обратно).
  const hot = (el, on) => {
    const blockEl = el.closest('[data-inf-block]');
    const id = el.closest('[data-inf-slice]')?.dataset.infSlice;
    if (!blockEl) return;
    blockEl.querySelectorAll('.is-hot').forEach(x => x.classList.remove('is-hot'));
    blockEl.classList.toggle('has-hot', !!(on && id));
    if (!on || !id) return;
    blockEl.querySelectorAll('[data-inf-slice]').forEach(x => { if (x.dataset.infSlice === id) x.classList.add('is-hot'); });
  };
  panel.addEventListener('mouseover', e => { if (e.target.closest('[data-inf-slice]')) hot(e.target, true); });
  panel.addEventListener('mouseout',  e => { if (e.target.closest('[data-inf-slice]')) hot(e.target, false); });
  panel.addEventListener('focusin',   e => { if (e.target.closest('.inf-row')) hot(e.target, true); });
  panel.addEventListener('focusout',  e => { if (e.target.closest('.inf-row')) hot(e.target, false); });
}

/** Привязывает панель к источнику данных и загружает её. Повторный вызов — новая загрузка с чистым состоянием. */
function mountInfluencePanel(panel, cfg) {
  if (!panel) return;
  panel._inf = { cfg, data: null, expanded: {}, showAll: {} };
  _infBind(panel);
  return _infLoad(panel);
}

// ── Страница «Фракции» ───────────────────────────────────────────────────────
const _infCityPanel = () => document.getElementById('factions-influence-panel');

function loadInfluenceCharts() {
  const panel = _infCityPanel();
  if (!panel) return;
  if (panel._inf) return _infLoad(panel); // состояние (раскрытая строка) сохраняется между заходами
  return mountInfluencePanel(panel, {
    uid: 'inf', blocks: INF_CITY_BLOCKS, editable: true, district: false,
    url: () => `/api/influence${window.location.search}`,
  });
}

function clearInfluenceCharts() {
  const panel = _infCityPanel();
  if (!panel) return;
  panel.innerHTML = '';
  if (panel._inf) panel._inf.data = null;
}

// Карточка локации открывается поверх «Фракций»: после сохранения её полей круги пересчитываются.
function refreshInfluenceChartsIfVisible() {
  const panel = _infCityPanel();
  if (panel && panel._inf && panel.querySelector('.inf-charts') && document.getElementById('page-factions')?.classList.contains('active')) {
    _infLoad(panel);
  }
}

// ── Вкладка «Фракции» карточки района ────────────────────────────────────────
/** districtSlug — слаг папки района; beforeOpenLoc — закрыть карточку района перед открытием локации. */
function loadDistrictInfluence(panel, districtSlug, { beforeOpenLoc } = {}) {
  const search = window.location.search; // город — тем же параметром, что у остальных запросов страницы
  return mountInfluencePanel(panel, {
    uid: 'inf-dist', blocks: INF_DISTRICT_BLOCKS, editable: false, district: true, beforeOpenLoc,
    url: () => `/api/influence${search}${search ? '&' : '?'}district=${encodeURIComponent(districtSlug)}`,
  });
}
