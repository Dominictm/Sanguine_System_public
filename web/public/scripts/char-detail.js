// Компактная карточка фамильяра для вкладки «Фамильяр» (5.8) — усечённая версия портрета/полей
// из openCharDetail (portraitCol/infoFields), не полный рекурсивный рендер всей модалки.
function _familiarCardHtml(fc) {
  const icon = lineageIconHtml(fc.lineage);
  const stType = fc.statusType || 'unknown';
  const stLbl = statusLabel(fc);
  const portrait = fc.imageUrl
    ? `<img class="cdet-familiar-portrait" src="${escAttr(fc.imageUrl)}" alt="${escHtml(fc.name)}">`
    : `<div class="cdet-familiar-portrait cdet-familiar-noart">${icon}</div>`;
  const fields = infoFieldsFor(fc.lineage)
    .filter(([k]) => fc[k] && fc[k] !== '—' && !String(fc[k]).includes('⚠️'))
    .slice(0, 4)
    .map(([k, lbl]) => `<div class="cdet-key">${escHtml(lbl)}</div><div class="cdet-val">${escHtml(fc[k])}</div>`)
    .join('');
  return `
    <div class="cdet-familiar-card">
      ${portrait}
      <div class="cdet-familiar-info">
        <div class="cdet-familiar-name">${escHtml(fc.name)}</div>
        <div class="cdet-badges">
          <span class="badge badge-${fc.lineage}">${LINEAGE_LABELS[fc.lineage] || fc.lineage}</span>
          ${stType !== 'unknown' ? `<span class="badge badge-${stType}">${stLbl}</span>` : ''}
        </div>
        <div class="cdet-fields cdet-familiar-fields">${fields}</div>
        <button type="button" class="cdet-familiar-open-btn" data-open-familiar="${escHtml(fc.slug)}">${t('cdet.familiarOpen')}</button>
      </div>
    </div>`;
}

// Одна запись вкладки «Отношения» в режиме просмотра (2026-08-08, Фаза 3 — общий хелпер, чтобы
// не дублировать разметку между начальным рендером карточки и обновлением после сохранения).
// Пустое описание у взаимной связи (§4.4 техспеки Фазы 3 — зеркальная запись сознательно не
// копирует текст с точки зрения другого персонажа) — не баг, но неотличимо от «забыли
// заполнить»; auto-hint (дизайн-ревью Фазы 3, п.4) поясняет это чисто визуально, не как
// сохранённый текст — тем же приглушённым стилем, что .cdet-val.unknown у прочих пустых полей.
function _relViewItemHtml(r) {
  const typeRow = (r.relType || r.mutual)
    ? `<div class="cdet-rel-type">${r.mutual ? `<span class="cdet-rel-mutual-badge" title="${t('cdet.relMutualTitle')}">↔</span> ` : ''}${escHtml(r.relType)}</div>`
    : '';
  const descHtml = (r.mutual && !r.description)
    ? `<div class="cdet-rel-desc cdet-rel-desc-auto">${t('cdet.relAuto')}</div>`
    : `<div class="cdet-rel-desc">${escHtml(r.description)}</div>`;
  return `
    <div class="cdet-rel">
      <div class="cdet-rel-name">${escHtml(r.target)}</div>
      ${typeRow}
      ${descHtml}
    </div>`;
}

// FIX-4b (docs/audit/2026-07-28-fix-plan.md): резолвим по slug, не по name —
// два персонажа с одинаковым именем (переименование сейчас блокируется FIX-4a,
// но в старых данных коллизия могла остаться) раньше всегда открывали ПЕРВОГО
// по порядку из STATE.characters, независимо от того, по какой карточке
// кликнули; второй персонаж был недостижим через интерфейс вообще.
function openCharDetail(slug) {
  const c = STATE.characters.find(ch => ch.slug === slug);
  if (!c) return;

  const icon   = lineageIconHtml(c.lineage);
  const stType = c.statusType || 'unknown';
  const stLbl  = statusLabel(c);

  const clanTint = c.lineage === 'vampire' ? CLAN_COLORS[c.clan] : null;
  const detailModalEl = document.getElementById('char-detail-modal');
  if (clanTint) detailModalEl.style.setProperty('--clan-tint', clanTint);
  else detailModalEl.style.removeProperty('--clan-tint');

  const _reqFields = requiredInfoFor(c.lineage);
  const infoFields = infoFieldsFor(c.lineage)
    .map(([k, lbl]) => {
      const raw = c[k];
      const empty = !raw || raw === '—' || String(raw).includes('⚠️');
      const required = _reqFields.has(k);
      const opt = (empty && !required) ? ' cdet-opt-empty' : '';   // hidden in view mode
      const tip = fieldTip(CHAR_FIELD_TIPS[lbl]);
      const keyHtml = (empty && required)
        ? `${lbl} <span class="cdet-req-flag" title="${t('cdet.reqFlag')}">!</span>${tip}` : `${lbl}${tip}`;
      const display = empty ? t('cdet.unknown') : escHtml(raw);
      const cls = empty ? 'cdet-val unknown' : 'cdet-val';
      return `<div class="cdet-key${opt}">${keyHtml}</div><div class="${cls}${opt}" data-field="${k}">${display}</div>`;
    })
    .join('');

  const relsHtml = (c.relationships || []).map(r => _relViewItemHtml(r)).join('');

  // Вкладка «Фамильяр» (5.8) — признак и линк берутся из «Отношения» (тот же массив, что рендерит
  // вкладку «Отношения»), НЕ из sheet-модели: связь с description, матчащим /фамильяр/i, — источник
  // истины. resolveCharByName — общий фаззи-резолвер имени в реестре персонажей (archive.js).
  // relType (2026-08-08, Фаза 2) — новые связи хранят «Фамильяр» в структурном поле типа, не в
  // description; старые продолжают находиться по description, как раньше.
  const familiarRel = (c.relationships || []).find(r =>
    /фамильяр/i.test(r.relType || '') || /фамильяр/i.test(r.description || ''));
  const familiarChar = familiarRel ? resolveCharByName(familiarRel.target) : null;
  // Если target связи-«фамильяра» по ошибке резолвится в самого владельца карточки
  // (опечатка/неверные данные) — это не осмысленная фича, а аномалия данных: без
  // этой проверки рисовалась бы мини-карточка «фамильяра», указывающая сама на
  // себя, с кнопкой «Открыть карточку целиком», просто перерисовывающей ту же модалку.
  const familiarPanelHtml = !familiarRel ? '' : !familiarChar
    ? `<div class="cdet-empty">${t('cdet.familiarNotFound', { name: escHtml(familiarRel.target) })}</div>`
    : familiarChar.slug === c.slug
    ? `<div class="cdet-empty">${t('cdet.familiarSelf')}</div>`
    : _familiarCardHtml(familiarChar);

  const portraitCol = c.imageUrl
    ? `<div class="cdet-carousel" id="cdet-carousel">
        <img class="cdet-carousel-img" id="cdet-carousel-img" src="${escAttr(c.imageUrl)}" alt="${escHtml(c.name)}">
        <div class="cdet-carousel-overlay" id="cdet-carousel-overlay"></div>
        <button class="cdet-carousel-btn prev" id="cdet-carousel-prev" title="${t('cdet.carouselPrev')}" aria-label="${t('cdet.carouselPrev')}">&#8249;</button>
        <button class="cdet-carousel-btn next" id="cdet-carousel-next" title="${t('cdet.carouselNext')}" aria-label="${t('cdet.carouselNext')}">&#8250;</button>
        <div class="cdet-carousel-dots" id="cdet-carousel-dots"></div>
       </div>`
    : `<div class="cdet-no-portrait">${icon}</div>`;

  const descHtml = [
    c.appearance && !c.appearance.includes('⚠️') ? `
      <div class="cdet-section-title">${t('cdet.appearanceTitle')}</div>
      <div class="cdet-bio">${escHtml(c.appearance)}</div>
      <div class="cdet-divider"></div>` : '',
    c.voice && !c.voice.includes('⚠️') ? `
      <div class="cdet-section-title">${t('cdet.voiceTitle')}</div>
      <div class="cdet-voice">${escHtml(c.voice)}</div>
      <div class="cdet-divider"></div>` : '',
    c.personality && !c.personality.includes('⚠️') ? `
      <div class="cdet-section-title">${t('cdet.personalityTitle')}</div>
      <div class="cdet-bio">${escHtml(c.personality)}</div>
      <div class="cdet-divider"></div>` : '',
    _promptSectionHtml(c.imagePrompt, c.negativePrompt),
  ].filter(Boolean).join('');

  const stampParts = c.lineage === 'vampire'
    ? [c.clan, c.generation ? `${c.generation} ${t('cdet.generation')}` : ''].filter(Boolean)
    : [LINEAGE_LABELS[c.lineage] || c.lineage];
  const stampText = stampParts.filter(p => p && p !== '—' && !String(p).includes('⚠️')).join(' · ');

  document.getElementById('char-detail-content').innerHTML = `
    <div class="cdet-portrait-col" id="cdet-portrait-col">${portraitCol}</div>
    <div class="cdet-info-col">
      <div class="cdet-sticky-header">
        <div class="cdet-header-grain" aria-hidden="true"></div>
        ${stampText ? `<div class="cdet-stamp">${escHtml(stampText)}</div>` : ''}
        <div class="cdet-name">${escHtml(c.name)}</div>
        <div class="cdet-badges">
          <span class="badge badge-${c.lineage}">${LINEAGE_LABELS[c.lineage] || c.lineage}</span>
          ${stType !== 'unknown' ? `<span class="badge badge-${stType}">${stLbl}</span>` : ''}
        </div>
        ${c.statusDetails ? `<div class="cdet-status-details">${escHtml(c.statusDetails)}</div>` : ''}
        <button class="cdet-delete-btn" id="cdet-delete-btn" data-char="${escHtml(c.slug)}" title="${t('cdet.deleteBtnTitle')}">🗑</button>
      </div>
      <div class="cdet-tab-bar">
        <button class="cdet-tab active" data-tab="info">${t('cdet.tabInfo')}</button>
        <button class="cdet-tab" data-tab="bio">${t('cdet.tabBio')}</button>
        <button class="cdet-tab" data-tab="rels">${t('cdet.tabRels')}</button>
        <button class="cdet-tab" data-tab="belongings">${t('cdet.tabBelongings')}${c.belongings?.length ? ` (${c.belongings.length})` : ''}</button>
        <button class="cdet-tab" data-tab="diaries">${t('cdet.tabDiaries')}${c.diaries?.length ? ` (${c.diaries.length})` : ''}</button>
        <button class="cdet-tab" data-tab="sheet" data-char="${escHtml(c.slug)}">${t('cdet.tabSheet')}</button>
        <button class="cdet-tab" data-tab="desc">${t('cdet.tabDesc')}</button>
        ${familiarRel ? `<button class="cdet-tab" data-tab="familiar">${t('cdet.tabFamiliar')}</button>` : ''}
      </div>
      <div class="cdet-panels">
        <div class="cdet-panel active" data-panel="info">
          ${c.presence ? `<div class="cdet-presence">🌍 <b>${t('cdet.presence')}</b> ${escHtml(c.presence)}</div>` : ''}
          ${c.aliases ? `<div class="cdet-presence cdet-aliases">🎭 <b>${t('cdet.aliases')}</b> ${escHtml(c.aliases)}</div>` : ''}
          <div class="cdet-info-header">
            <button class="cdet-edit-btn" id="cdet-edit-btn" data-char="${escHtml(c.slug)}">${t('cdet.editBtn')}</button>
          </div>
          <div class="cdet-fields" id="cdet-info-fields">${infoFields}</div>
          <div class="cdet-edit-bar" id="cdet-edit-bar">
            <button class="cdet-save-btn" id="cdet-save-btn">${t('cdet.saveBtn')}</button>
            <button class="cdet-cancel-btn" id="cdet-cancel-btn">${t('cdet.cancelBtn')}</button>
            <span class="cdet-save-msg" id="cdet-save-msg">${t('cdet.saved')}</span>
          </div>
        </div>
        <div class="cdet-panel" data-panel="bio">
          <div class="cdet-info-header">
            <button class="cdet-edit-btn" data-editpanel="bio" data-char="${escHtml(c.slug)}">${t('cdet.editBtn')}</button>
          </div>
          <div id="cdet-bio-view">
            ${c.biography && !c.biography.includes('⚠️')
              ? `<div class="cdet-bio">${escHtml(c.biography)}</div>`
              : `<div class="cdet-empty">${t('cdet.bioEmpty')}</div>`}
          </div>
          <div id="cdet-bio-edit" style="display:none">
            <div class="cdet-info-header" style="margin-bottom:8px">
              <button class="cdet-gen-prompt-btn" id="cdet-gen-biography" data-char="${escHtml(c.slug)}" title="${t('cdet.genBioTitle')}">${t('cdet.genBioBtn')}</button>
            </div>
            <textarea class="cdet-edit-textarea" id="cdet-bio-ta" rows="10" placeholder="${t('cdet.bioPh')}">${c.biography && !c.biography.includes('⚠️') ? escHtml(c.biography) : ''}</textarea>
          </div>
          <div class="cdet-edit-bar" id="cdet-bio-bar">
            <button class="cdet-save-btn" data-savepanel="bio" data-char="${escHtml(c.slug)}">${t('cdet.saveBtn')}</button>
            <button class="cdet-cancel-btn" data-cancelpanel="bio">${t('cdet.cancelBtn')}</button>
            <span class="cdet-save-msg" id="cdet-bio-msg">${t('cdet.saved')}</span>
          </div>
        </div>
        <div class="cdet-panel" data-panel="rels">
          <div class="cdet-info-header">
            <button class="cdet-edit-btn" data-editpanel="rels" data-char="${escHtml(c.slug)}">${t('cdet.editBtn')}</button>
          </div>
          <div id="cdet-rels-view">
            ${relsHtml ? `<div class="cdet-rels-list">${relsHtml}</div>` : `<div class="cdet-empty">${t('cdet.relsEmpty')}</div>`}
          </div>
          <div id="cdet-rels-edit" style="display:none">
            <div class="cdet-rels-hint">${t('cdet.relsHint')}</div>
            <div id="cdet-rels-rows">${(c.relationships||[]).map(r => _relRowHtml(r.target, r.relType, r.description, r.mutual)).join('')}</div>
            <button class="cdet-rel-add-btn" id="cdet-rel-add-btn" type="button">${t('cdet.relAddBtn')}</button>
            <div id="cdet-rel-type-picker" class="v20-lib-picker cdet-lib-picker-panel" hidden>
              <input type="text" class="v20-lib-search" placeholder="${t('cdet.searchPh')}" id="cdet-rel-type-search">
              <div class="v20-lib-list" id="cdet-rel-type-list"></div>
            </div>
            <datalist id="cdet-rel-names">${(STATE.characters||[]).filter(x => x.slug !== c.slug).map(x => `<option value="${escAttr(x.name)}">`).join('')}</datalist>
          </div>
          <div class="cdet-edit-bar" id="cdet-rels-bar">
            <button class="cdet-save-btn" data-savepanel="rels" data-char="${escHtml(c.slug)}">${t('cdet.saveBtn')}</button>
            <button class="cdet-cancel-btn" data-cancelpanel="rels">${t('cdet.cancelBtn')}</button>
            <span class="cdet-save-msg" id="cdet-rels-msg">${t('cdet.saved')}</span>
          </div>
        </div>
        <div class="cdet-panel" data-panel="belongings">${renderBelongingsPanel(c)}</div>
        <div class="cdet-panel" data-panel="diaries">
          ${renderDiaryList(c)}
        </div>
        <div class="cdet-panel" data-panel="sheet" id="cdet-sheet-panel">
          <div class="loading-state"><div class="spinner"></div>${t('cdet.sheetLoading')}</div>
        </div>
        <div class="cdet-panel" data-panel="desc">
          <div class="cdet-info-header" style="gap:8px">
            <button class="cdet-gen-appearance-btn" id="cdet-gen-appearance" data-char="${escHtml(c.slug)}" title="${t('cdet.genAppearanceTitle')}">${t('cdet.genAppearanceBtn')}</button>
            <button class="cdet-gen-prompt-btn" id="cdet-gen-personality" data-char="${escHtml(c.slug)}" title="${t('cdet.genPersonalityTitle')}">${t('cdet.genPersonalityBtn')}</button>
            <button class="cdet-gen-prompt-btn" id="cdet-gen-prompt" data-char="${escHtml(c.slug)}" title="${t('cdet.genPromptTitle')}">${t('cdet.genPromptBtn')}</button>
            <button class="cdet-edit-btn" data-editpanel="desc" data-char="${escHtml(c.slug)}">${t('cdet.editBtn')}</button>
          </div>
          <div id="cdet-desc-view">
            ${descHtml || `<div class="cdet-empty">${t('cdet.descEmpty')}</div>`}
          </div>
          <div id="cdet-desc-edit" style="display:none">
            <div id="cdet-img-gallery"></div>
            <div class="cdet-section-title">${t('cdet.appearanceTitle')}</div>
            <textarea class="cdet-edit-textarea" id="cdet-appearance-ta" rows="5" placeholder="${t('cdet.appearancePh')}">${c.appearance && !c.appearance.includes('⚠️') ? escHtml(c.appearance) : ''}</textarea>
            <div class="cdet-section-title" style="margin-top:12px">${t('cdet.voiceTitle')}</div>
            <textarea class="cdet-edit-textarea" id="cdet-voice-ta" rows="3" placeholder="${t('cdet.voicePh')}">${c.voice && !c.voice.includes('⚠️') ? escHtml(c.voice) : ''}</textarea>
            <div class="cdet-section-title" style="margin-top:12px">${t('cdet.personalityTitle')}</div>
            <textarea class="cdet-edit-textarea" id="cdet-personality-ta" rows="4" placeholder="${t('cdet.personalityPh')}">${c.personality && !c.personality.includes('⚠️') ? escHtml(c.personality) : ''}</textarea>
            <div class="cdet-section-title" style="margin-top:12px">${t('cdet.promptTitle')}</div>
            <textarea class="cdet-edit-textarea" id="cdet-prompt-ta" rows="6" placeholder="${t('cdet.promptBlockPh')}">${c.imagePrompt ? escHtml(c.imagePrompt) : ''}</textarea>
            <div class="cdet-section-title" style="margin-top:12px">${t('cdet.negPromptTitle')}</div>
            <textarea class="cdet-edit-textarea" id="cdet-negprompt-ta" rows="3" placeholder="photorealistic, ...">${c.negativePrompt ? escHtml(c.negativePrompt) : ''}</textarea>
          </div>
          <div class="cdet-edit-bar" id="cdet-desc-bar">
            <button class="cdet-save-btn" data-savepanel="desc" data-char="${escHtml(c.slug)}">${t('cdet.saveBtn')}</button>
            <button class="cdet-cancel-btn" data-cancelpanel="desc">${t('cdet.cancelBtn')}</button>
            <span class="cdet-save-msg" id="cdet-desc-msg">${t('cdet.saved')}</span>
          </div>
          <div class="cdet-upload-row">
            <button class="cdet-upload-btn" data-char="${escHtml(c.slug)}">${t('cdet.uploadBtn')}</button>
          </div>
          <div class="cdet-divider"></div>
          <div class="cdet-dialogue">
            <div class="cdet-section-title">${t('cdet.dlgTitle')}</div>
            <div class="cdet-dialogue-hint">${t('cdet.dlgHint')}</div>
            <textarea class="cdet-edit-textarea" id="cdet-dlg-situation" rows="2" placeholder="${t('cdet.dlgSituationPh')}"></textarea>
            <button class="cdet-gen-prompt-btn" id="cdet-gen-dialogue" data-char="${escHtml(c.slug)}">${t('cdet.dlgGenBtn')}</button>
            <div id="cdet-dlg-result" class="cdet-dialogue-result" style="display:none"></div>
          </div>
        </div>
        ${familiarRel ? `<div class="cdet-panel" data-panel="familiar">${familiarPanelHtml}</div>` : ''}
      </div>
    </div>`;

  openModal('char-detail-modal');
  if (c.imageUrl) initCarousel(c.slug);
}

document.getElementById('chars-grid').addEventListener('click', e => {
  const card = e.target.closest('.char-card[data-slug]');
  if (!card) return;
  if (_foundryBulkMode) { _foundryBulkToggleCard(card.dataset.slug); return; }
  openCharDetail(card.dataset.slug);
});

const charDetailModal = document.getElementById('char-detail-modal');
document.getElementById('char-detail-close').addEventListener('click', () => closeModal('char-detail-modal'));
charDetailModal.addEventListener('click', e => { if (e.target === charDetailModal) closeModal('char-detail-modal'); });

// Tab switching & image upload — delegated on the persistent content container
document.getElementById('char-detail-content').addEventListener('click', e => {
  const tab = e.target.closest('.cdet-tab');
  if (tab) {
    const col = tab.closest('.cdet-info-col');
    col.querySelectorAll('.cdet-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    col.querySelectorAll('.cdet-panel').forEach(p => p.classList.remove('active'));
    col.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    const panels = col.querySelector('.cdet-panels');
    if (panels) panels.scrollTop = 0;
    if (tab.dataset.tab === 'sheet') _loadCharSheet(tab.dataset.char);
    return;
  }
  const openFamiliarBtn = e.target.closest('[data-open-familiar]');
  if (openFamiliarBtn) { openCharDetail(openFamiliarBtn.dataset.openFamiliar); return; }
  if (e.target.closest('#cdet-carousel-prev')) { _carouselGoTo(_carouselIdx - 1, true); return; }
  if (e.target.closest('#cdet-carousel-next')) { _carouselGoTo(_carouselIdx + 1, true); return; }
  if (e.target.closest('#cdet-delete-btn'))  { _confirmDeleteChar(e.target.closest('#cdet-delete-btn').dataset.char); return; }
  if (e.target.closest('#cdet-edit-btn'))    { _enterInfoEdit(e.target.closest('#cdet-edit-btn').dataset.char); return; }
  if (e.target.closest('#cdet-cancel-btn'))  { _exitInfoEdit(false); return; }
  if (e.target.closest('#cdet-save-btn'))    { _saveInfoFields(); return; }

  // Panel edit buttons (bio / rels / desc)
  const editPanelBtn = e.target.closest('[data-editpanel]');
  if (editPanelBtn) { _togglePanelEdit(editPanelBtn.dataset.editpanel, true); return; }
  const cancelPanelBtn = e.target.closest('[data-cancelpanel]');
  if (cancelPanelBtn) { _togglePanelEdit(cancelPanelBtn.dataset.cancelpanel, false); return; }
  const savePanelBtn = e.target.closest('[data-savepanel]');
  if (savePanelBtn) { _savePanelEdit(savePanelBtn.dataset.savepanel, savePanelBtn.dataset.char); return; }

  // Relations editor: add / delete a single row
  if (e.target.closest('#cdet-rel-add-btn')) {
    const rows = document.getElementById('cdet-rels-rows');
    if (rows) {
      rows.insertAdjacentHTML('beforeend', _relRowHtml());
      rows.lastElementChild?.querySelector('.cdet-rel-name-inp')?.focus();
    }
    return;
  }
  const relDelBtn = e.target.closest('.cdet-rel-del-btn');
  if (relDelBtn) {
    const row = relDelBtn.closest('.cdet-rel-row');
    const picker = document.getElementById('cdet-rel-type-picker');
    if (picker && row?.contains(picker)) {
      row.after(picker);
      picker.hidden = true;
    }
    row?.remove();
    return;
  }
  const promptCopyBtn = e.target.closest('#cdet-prompt-copy');
  if (promptCopyBtn) { _copyImagePrompt(promptCopyBtn); return; }
  if (e.target.closest('#cdet-gen-appearance')) { _generateAppearance(e.target.closest('#cdet-gen-appearance').dataset.char); return; }
  if (e.target.closest('#cdet-gen-personality')) { _generatePersonality(e.target.closest('#cdet-gen-personality').dataset.char); return; }
  if (e.target.closest('#cdet-gen-biography')) { _generateBiography(e.target.closest('#cdet-gen-biography').dataset.char); return; }
  if (e.target.closest('#cdet-gen-prompt')) { _generatePrompt(e.target.closest('#cdet-gen-prompt').dataset.char); return; }
  if (e.target.closest('#cdet-gen-dialogue')) { _genDialogue(e.target.closest('#cdet-gen-dialogue').dataset.char); return; }
  if (e.target.closest('.cdet-img-del-btn')) {
    const btn = e.target.closest('.cdet-img-del-btn');
    _deleteCharImage(btn.dataset.char, btn.dataset.file);
    return;
  }

  const uploadBtn = e.target.closest('.cdet-upload-btn');
  if (uploadBtn) { triggerImageUpload(uploadBtn.dataset.char); return; }

  // Belongings (вкладка «Имущество»): добавить / править подпись / удалить
  const belAddBtn = e.target.closest('.cdet-bel-add');
  if (belAddBtn) { _triggerBelongingUpload(belAddBtn.dataset.char); return; }
  const belEditBtn = e.target.closest('.cdet-bel-edit');
  if (belEditBtn) { _editBelongingCaption(belEditBtn.dataset.char, belEditBtn.dataset.file); return; }
  const belDelBtn = e.target.closest('.cdet-bel-del');
  if (belDelBtn) { _deleteBelonging(belDelBtn.dataset.char, belDelBtn.dataset.file); return; }

  // Diary entry form: toggle / generate / save / cancel
  if (e.target.closest('#diary-add-toggle')) {
    const f = document.getElementById('diary-form');
    if (f) f.style.display = f.style.display === 'none' ? '' : 'none';
    return;
  }
  if (e.target.closest('#diary-cancel')) {
    const f = document.getElementById('diary-form'); if (f) f.style.display = 'none';
    return;
  }
  if (e.target.closest('#diary-gen'))  { _diaryGenerate(e.target.closest('#diary-gen').dataset.char); return; }
  if (e.target.closest('#diary-save')) { _diarySave(e.target.closest('#diary-save').dataset.char); return; }

  const diaryDelBtn = e.target.closest('.diary-item-del-btn');
  if (diaryDelBtn) {
    _deleteDiaryEntry(diaryDelBtn.dataset.char, diaryDelBtn.dataset.file, diaryDelBtn.dataset.title);
    return;
  }

  const diaryItem = e.target.closest('.diary-item');
  if (diaryItem) { loadDiaryEntry(diaryItem.dataset.char, diaryItem.dataset.file); return; }

  const diaryBack = e.target.closest('.diary-back');
  if (diaryBack) {
    const c = STATE.characters.find(ch => ch.slug === diaryBack.dataset.char);
    const panel = document.querySelector('#char-detail-content [data-panel="diaries"]');
    if (panel && c) {
      panel.innerHTML = renderDiaryList(c);
      const panels = panel.closest('.cdet-panels');
      if (panels) panels.scrollTop = 0;
    }
    return;
  }

  const diaryEntryEditBtn = e.target.closest('.diary-entry-edit-btn');
  if (diaryEntryEditBtn) { _enterDiaryEntryEdit(); return; }

  const diaryEntryDelBtn = e.target.closest('.diary-entry-del-btn');
  if (diaryEntryDelBtn) {
    _deleteDiaryEntry(diaryEntryDelBtn.dataset.char, diaryEntryDelBtn.dataset.file, diaryEntryDelBtn.dataset.title);
    return;
  }

  const diaryRegenBtn = e.target.closest('.diary-entry-regen-btn');
  if (diaryRegenBtn) { _regenerateDiaryEntry(diaryRegenBtn.dataset.char, diaryRegenBtn.dataset.period); return; }

  const diaryEntrySaveBtn = e.target.closest('.diary-entry-save-btn');
  if (diaryEntrySaveBtn) { _saveDiaryEntryEdit(diaryEntrySaveBtn.dataset.char, diaryEntrySaveBtn.dataset.period, diaryEntrySaveBtn.dataset.file); return; }

  const diaryEntryCancelBtn = e.target.closest('.diary-entry-cancel-btn');
  if (diaryEntryCancelBtn) { loadDiaryEntry(diaryEntryCancelBtn.dataset.char, diaryEntryCancelBtn.dataset.file); return; }
});

// ── Carousel logic ────────────────────────────────────────────────────────────
let _carouselTimer  = null;
let _carouselImages = [];
let _carouselIdx    = 0;

async function initCarousel(charSlug) {
  // Stop previous carousel
  if (_carouselTimer) { clearInterval(_carouselTimer); _carouselTimer = null; }
  _carouselImages = [];
  _carouselIdx = 0;

  const resp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/images${window.location.search}`)
    .catch(() => null);
  if (!resp?.ok) return;
  const { images } = await resp.json().catch(() => ({}));
  if (!images || images.length <= 1) {
    // Hide nav buttons for single image
    document.getElementById('cdet-carousel-prev')?.style.setProperty('display','none');
    document.getElementById('cdet-carousel-next')?.style.setProperty('display','none');
    return;
  }

  _carouselImages = images;
  _carouselIdx    = 0;

  // Build dots
  const dotsEl = document.getElementById('cdet-carousel-dots');
  if (dotsEl) {
    dotsEl.innerHTML = images.map((_, i) =>
      `<div class="cdet-carousel-dot${i === 0 ? ' active' : ''}"></div>`
    ).join('');
  }

  _carouselTimer = setInterval(() => _carouselGoTo(_carouselIdx + 1), 60 * 1000);
}

function _carouselGoTo(targetIdx, resetTimer = false) {
  const img     = document.getElementById('cdet-carousel-img');
  const overlay = document.getElementById('cdet-carousel-overlay');
  const dotsEl  = document.getElementById('cdet-carousel-dots');
  if (!img || !overlay || !_carouselImages.length) {
    clearInterval(_carouselTimer); _carouselTimer = null; return;
  }

  const next = ((targetIdx % _carouselImages.length) + _carouselImages.length) % _carouselImages.length;

  // Phase 1: darken
  overlay.classList.add('dimmed');

  setTimeout(() => {
    // Phase 2: swap image
    _carouselIdx = next;
    img.src = _carouselImages[_carouselIdx];

    // Update dots
    if (dotsEl) {
      dotsEl.querySelectorAll('.cdet-carousel-dot').forEach((d, i) =>
        d.classList.toggle('active', i === _carouselIdx));
    }

    // Phase 3: un-darken
    setTimeout(() => overlay.classList.remove('dimmed'), 300);
  }, 2100);

  // Reset auto-timer on manual nav
  if (resetTimer && _carouselTimer) {
    clearInterval(_carouselTimer);
    _carouselTimer = setInterval(() => _carouselGoTo(_carouselIdx + 1), 60 * 1000);
  }
}

function _carouselAdvance() { _carouselGoTo(_carouselIdx + 1); }

// Stop carousel when the modal closes — FIX-8 (docs/audit/2026-07-28-fix-plan.md):
// this used to only fire on the explicit ✕ button, so closing via Escape or a
// backdrop click left the 60s auto-advance timer running against a hidden modal
// until the next character happened to be opened (initCarousel's own clearInterval
// guard). Watching the modal's own `open` class (closeModal()'s only visible
// signal, shared by every close path — ✕, backdrop click, Escape) covers all of
// them from one place instead of duplicating the stop call at each trigger site.
{
  const modalEl = document.getElementById('char-detail-modal');
  if (modalEl) {
    new MutationObserver(() => {
      if (!modalEl.classList.contains('open') && _carouselTimer) {
        clearInterval(_carouselTimer);
        _carouselTimer = null;
      }
    }).observe(modalEl, { attributes: true, attributeFilter: ['class'] });
  }
}

// ── Panel editing (bio / rels / desc) ────────────────────────────────────────

function _togglePanelEdit(panel, on) {
  const view = document.getElementById(`cdet-${panel}-view`);
  const edit = document.getElementById(`cdet-${panel}-edit`);
  const bar  = document.getElementById(`cdet-${panel}-bar`);
  const btn  = document.querySelector(`[data-editpanel="${panel}"]`);
  if (!view || !edit || !bar) return;
  view.style.display = on ? 'none' : '';
  edit.style.display = on ? '' : 'none';
  bar.classList.toggle('show', on);
  if (btn) { btn.classList.toggle('active', on); btn.textContent = on ? t('cdet.editModeBtn') : t('cdet.editBtn'); }
  if (on) {
    if (panel === 'desc') {
      const charSlug = document.querySelector('[data-editpanel="desc"][data-char]')?.dataset.char;
      if (charSlug) _loadDescImages(charSlug);
    } else if (panel === 'rels') {
      // Rebuild rows from the latest saved relationships (discard prior unsaved edits)
      const charSlug = document.querySelector('[data-editpanel="rels"][data-char]')?.dataset.char;
      const ch  = STATE.characters.find(c => c.slug === charSlug);
      const rows = document.getElementById('cdet-rels-rows');
      // Пикер видов мог быть перенесён внутрь строки — вернуть его в штатное место
      // (после #cdet-rels-rows), иначе innerHTML-перерендер строк его уничтожит.
      const picker = document.getElementById('cdet-rel-type-picker');
      if (picker && rows?.contains(picker)) {
        rows.after(picker);
        picker.hidden = true;
      }
      if (ch && rows) rows.innerHTML = (ch.relationships || []).map(r => _relRowHtml(r.target, r.relType, r.description, r.mutual)).join('');
      rows?.querySelector('.cdet-rel-name-inp')?.focus();
    } else {
      edit.querySelector('textarea')?.focus();
    }
  }
}

async function _savePanelEdit(panel, charSlug) {
  const bar  = document.getElementById(`cdet-${panel}-bar`);
  const msg  = document.getElementById(`cdet-${panel}-msg`);
  const save = bar?.querySelector('.cdet-save-btn');
  if (!save) return;

  save.disabled = true;
  save.textContent = t('cdet.saving');

  const qs = window.location.search;
  let ok = false;

  try {
    if (panel === 'bio') {
      const bio = document.getElementById('cdet-bio-ta')?.value.trim() || '';
      const r = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/fields${qs}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { biography: bio } }) });
      const d = await r.json();
      ok = d.ok;
      if (ok) {
        const ch = STATE.characters.find(c => c.slug === charSlug);
        if (ch) ch.biography = bio;
        document.getElementById('cdet-bio-view').innerHTML =
          bio ? `<div class="cdet-bio">${escHtml(bio)}</div>` : `<div class="cdet-empty">${t('cdet.bioEmpty')}</div>`;
      }
    } else if (panel === 'rels') {
      const lines = Array.from(document.querySelectorAll('#cdet-rels-rows .cdet-rel-row')).map(row => {
        const target  = row.querySelector('.cdet-rel-name-inp')?.value.trim() || '';
        const relType = row.querySelector('.cdet-rel-type-inp')?.value.trim() || '';
        const desc    = row.querySelector('.cdet-rel-desc-inp')?.value.trim() || '';
        const mutual  = row.querySelector('.cdet-rel-mutual-cb')?.checked || false;
        if (!target) return null;
        let body = relType ? `[${relType}] ${desc}`.trim() : desc;
        if (mutual) body = `↔ ${body}`.trim();
        return body ? `${target} — ${body}` : target;
      }).filter(Boolean);
      const r = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/relations${qs}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines }) });
      const d = await r.json();
      ok = d.ok;
      if (ok) {
        // Граф кеширует данные между заходами (STATE.graph.inited, graph.js) — тот же класс
        // устаревания, что уже находили для STATE.characters (Фаза 3). Сохранение связей меняет
        // рёбра/цвета графа — сбрасываем флаг тем же паттерном, что уже используется в проекте
        // (log-session.js, scripts.js) после других действий, влияющих на граф (2026-08-08,
        // хвост Фазы 1, дизайн-ревью п.2).
        STATE.graph.inited = false;
        // Предупреждения синхронизации «Взаимно» (2026-08-08, Фаза 3) — отдельным toast'ом на
        // каждое, не одной строкой через «; » (дизайн-ревью п.3): несколько сразу нечитаемы в
        // компактном, недолго висящем toast.
        (d.warnings || []).forEach(w => showToast(w, 'warning'));
        // Refresh relations view — тот же разбор «↔[Тип] Описание», что и на сервере
        // (web/lib/parsers/character.js), продублирован здесь для мгновенного обновления
        // без повторного запроса персонажа (2026-08-08, Фаза 2-3).
        const rels = lines.map(l => {
          const idx = l.indexOf(' — ');
          if (idx === -1) return { target: l.trim(), relType: '', description: '', mutual: false };
          const target = l.slice(0, idx).trim();
          let rest = l.slice(idx + 3).trim();
          let mutual = false;
          if (rest.startsWith('↔')) { mutual = true; rest = rest.slice(1).trim(); }
          const m = rest.match(/^\[([^\]]+)\]\s*(.*)$/);
          return m ? { target, relType: m[1].trim(), description: m[2].trim(), mutual } : { target, relType: '', description: rest, mutual };
        });
        const ch = STATE.characters.find(c => c.slug === charSlug);
        // Взаимная синхронизация (Фаза 3) правит ЧУЖУЮ карточку на сервере — если тут были
        // (до или после сохранения) взаимные связи, STATE.characters для ДРУГИХ персонажей мог
        // устареть. loadCharacters() пропускает повторный fetch, если STATE.characters уже
        // непуст (scripts.js:604-609) — без обновления открывший карточку цели сразу после
        // этого сохранения увидел бы старые данные до полной перезагрузки страницы.
        const hadMutual = (ch?.relationships || []).some(x => x.mutual);
        const hasMutualNow = rels.some(x => x.mutual);
        if (ch) ch.relationships = rels;
        if (hadMutual || hasMutualNow) {
          // РЕАЛЬНЫЙ БАГ (найден пользователем на живых данных, 2026-08-08): предыдущая версия
          // делала `STATE.characters = []` и останавливалась на этом — массив пустел, но уже
          // отрисованные .char-card в сетке оставались кликабельными и указывали на слаги,
          // которых в пустом массиве больше нет. openCharDetail(slug) ищет персонажа через
          // STATE.characters.find(...) и молча возвращается, если не нашёл (без ошибки, без
          // подсказки) — клик по ЛЮБОЙ карточке переставал что-либо делать, пока пользователь
          // не перезагружал страницу целиком. Правильный паттерн — тот же, что уже используется
          // в проекте после удаления/создания персонажа (scripts.js) — сразу перечитать список
          // и перерисовать сетку, если она сейчас на экране, не оставлять окно с пустым
          // массивом при живых карточках в DOM.
          fetch(`/api/characters${qs}`).then(r => r.json()).then(data => {
            STATE.characters = Array.isArray(data) ? data : [];
            if (STATE.page === 'characters') renderChars();
          }).catch(() => {});
        }
        const relsHtml = rels.map(r => _relViewItemHtml(r)).join('');
        document.getElementById('cdet-rels-view').innerHTML =
          relsHtml ? `<div class="cdet-rels-list">${relsHtml}</div>` : `<div class="cdet-empty">${t('cdet.relsEmpty')}</div>`;
      }
    } else if (panel === 'desc') {
      const appearance   = document.getElementById('cdet-appearance-ta')?.value.trim() || '';
      const voice        = document.getElementById('cdet-voice-ta')?.value.trim() || '';
      const personality  = document.getElementById('cdet-personality-ta')?.value.trim() || '';
      const imagePrompt  = document.getElementById('cdet-prompt-ta')?.value.trim() || '';
      const negativePrompt = document.getElementById('cdet-negprompt-ta')?.value.trim() || '';
      // FIX-3 (docs/audit/2026-07-28-fix-plan.md): send all five fields unconditionally,
      // even empty ones — omitting a falsy field here used to mean the server (which
      // treats "absent" as "leave untouched") never persisted the clear, so the panel
      // showed empty while the old value silently survived on disk until reload.
      const fields = { appearance, voice, personality, imagePrompt, negativePrompt };
      const r = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/fields${qs}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }) });
      const d = await r.json();
      ok = d.ok;
      if (ok) {
        const ch = STATE.characters.find(c => c.slug === charSlug);
        if (ch) Object.assign(ch, { appearance, voice, personality, imagePrompt, negativePrompt });
        // Refresh desc view
        const descHtml = [
          appearance ? `<div class="cdet-section-title">${t('cdet.appearanceTitle')}</div><div class="cdet-bio">${escHtml(appearance)}</div><div class="cdet-divider"></div>` : '',
          voice ? `<div class="cdet-section-title">${t('cdet.voiceTitle')}</div><div class="cdet-voice">${escHtml(voice)}</div><div class="cdet-divider"></div>` : '',
          personality ? `<div class="cdet-section-title">${t('cdet.personalityTitle')}</div><div class="cdet-bio">${escHtml(personality)}</div><div class="cdet-divider"></div>` : '',
          _promptSectionHtml(imagePrompt, negativePrompt),
        ].filter(Boolean).join('');
        document.getElementById('cdet-desc-view').innerHTML = descHtml || `<div class="cdet-empty">${t('cdet.descEmpty')}</div>`;
      }
    }
  } catch(e) { showToast(t('cdet.err') + e.message, 'error'); }

  save.disabled = false;
  save.textContent = t('cdet.saveBtn');
  if (ok) {
    _togglePanelEdit(panel, false);
    if (msg) { msg.classList.add('show'); setTimeout(() => msg.classList.remove('show'), 2500); }
  }
}

async function _generateAppearance(charSlug) {
  if (_genAppearanceRunning) return;
  _genAppearanceRunning = true;
  const btn = document.getElementById('cdet-gen-appearance');
  if (btn) { btn.disabled = true; btn.textContent = t('cdet.analyzing'); }

  try {
    const claudeModel  = localStorage.getItem('ai-model') || 'claude-opus-5';
    const featPrefs    = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const _appPref     = _getPref(featPrefs, 'appearance', 'openrouter');
    const preferSource = _appPref.provider;
    const orModel      = (preferSource === 'openrouter' || preferSource === 'lmstudio') ? (_appPref.model || null) : null;
    const qs           = window.location.search;

    // 1. Генерируем внешность через Vision API
    const resp = await fetch(
      `/api/characters/${encodeURIComponent(charSlug)}/generate-appearance${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: claudeModel, preferSource, orModel }) }
    );
    const d = await resp.json();
    if (resp.status === 429 || d.rateLimited) {
      showToast(t('cdet.rateLimit'), 'warning');
      return;
    }
    if (!d.ok) { showToast(t('cdet.genError') + (d.error || t('cdet.unknownError')), 'error'); return; }

    // 2. Автосохраняем в карточку персонажа
    if (btn) btn.textContent = t('cdet.saving');
    const saveResp = await fetch(
      `/api/characters/${encodeURIComponent(charSlug)}/fields${qs}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { appearance: d.appearance } }) }
    );
    const saveData = await saveResp.json();
    if (!saveData.ok) { showToast(t('cdet.saveError') + (saveData.error || ''), 'error'); return; }

    // 3. Обновляем STATE
    const ch = STATE.characters.find(c => c.slug === charSlug);
    if (ch) ch.appearance = d.appearance;

    // 4. Обновляем вкладку Описание (view-режим)
    const view = document.getElementById('cdet-desc-view');
    if (view) {
      const cur = ch || {};
      const voice       = cur.voice       || '';
      const personality = cur.personality || '';
      const imagePrompt = cur.imagePrompt || '';
      const negPrompt   = cur.negativePrompt || '';
      view.innerHTML = [
        d.appearance  ? `<div class="cdet-section-title">${t('cdet.appearanceTitle')}</div><div class="cdet-bio">${escHtml(d.appearance)}</div><div class="cdet-divider"></div>` : '',
        voice         ? `<div class="cdet-section-title">${t('cdet.voiceTitle')}</div><div class="cdet-voice">${escHtml(voice)}</div><div class="cdet-divider"></div>` : '',
        personality   ? `<div class="cdet-section-title">${t('cdet.personalityTitle')}</div><div class="cdet-bio">${escHtml(personality)}</div><div class="cdet-divider"></div>` : '',
        _promptSectionHtml(imagePrompt, negPrompt),
      ].filter(Boolean).join('') || `<div class="cdet-empty">${t('cdet.descEmpty')}</div>`;
    }

    // 5. Также обновляем textarea если вкладка открыта в режиме редактирования
    const ta = document.getElementById('cdet-appearance-ta');
    if (ta) ta.value = d.appearance;

    // 6. Мигаем сообщением об успехе
    const msg = document.getElementById('cdet-desc-save-msg');
    if (msg) { msg.classList.add('show'); setTimeout(() => msg.classList.remove('show'), 2500); }

    if (btn) btn.title = t('cdet.imagesAnalyzed', { count: d.imagesUsed, source: d.source });
  } catch(e) {
    showToast(t('cdet.connError') + e.message, 'error');
  } finally {
    _genAppearanceRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = t('cdet.genAppearanceBtn'); }
  }
}

async function _loadDescImages(charSlug) {
  const gallery = document.getElementById('cdet-img-gallery');
  if (!gallery) return;
  gallery.innerHTML = '<div class="cdet-img-gallery-loading">' + t('cdet.galleryLoading') + '</div>';

  const resp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/images${window.location.search}`).catch(() => null);
  if (!resp?.ok) { gallery.innerHTML = ''; return; }
  const { images } = await resp.json().catch(() => ({}));

  if (!images?.length) {
    gallery.innerHTML = '<div class="cdet-empty" style="margin-bottom:12px">' + t('cdet.noImages') + '</div>';
    return;
  }

  gallery.innerHTML = `
    <div class="cdet-section-title">${t('cdet.imagesTitle')}</div>
    <div class="cdet-img-gallery-grid">
      ${images.map(url => {
        const filename = decodeURIComponent(url.split('/').pop());
        return `<div class="cdet-img-thumb-wrap">
          <img class="cdet-img-thumb" src="${url}" alt="${escHtml(filename)}" loading="lazy" decoding="async">
          <span class="cdet-img-thumb-name">${escHtml(filename)}</span>
          <button class="cdet-img-del-btn" data-char="${escHtml(charSlug)}" data-file="${escHtml(filename)}" title="${t('cdet.imgDelTitle')}">✕</button>
        </div>`;
      }).join('')}
    </div>
    <div class="cdet-divider"></div>`;
}

async function _deleteCharImage(charSlug, filename) {
  if (!await showConfirm(t('cdet.imgDeleteConfirm', { name: filename }), { danger: true, confirmText: t('cdet.imgDelTitle') })) return;

  const qs = window.location.search;
  try {
    const resp = await fetch(
      `/api/characters/${encodeURIComponent(charSlug)}/images/${encodeURIComponent(filename)}${qs}`,
      { method: 'DELETE' }
    );
    const d = await resp.json();
    if (!d.ok) { showToast(t('cdet.imgDeleteError') + (d.error || ''), 'error'); return; }

    // Remove thumbnail from gallery
    const wrap = document.querySelector(`.cdet-img-del-btn[data-file="${CSS.escape(filename)}"]`)?.closest('.cdet-img-thumb-wrap');
    if (wrap) wrap.remove();

    const grid = document.querySelector('.cdet-img-gallery-grid');
    if (grid && !grid.querySelectorAll('.cdet-img-thumb-wrap').length) {
      document.getElementById('cdet-img-gallery').innerHTML =
        '<div class="cdet-empty" style="margin-bottom:12px">' + t('cdet.noImages') + '</div>';
    }

    // Refresh carousel (remove deleted image from list)
    const encodedFile = encodeURIComponent(filename);
    _carouselImages = _carouselImages.filter(u => !u.includes(encodedFile) && !u.includes(filename));
    if (_carouselImages.length) {
      _carouselIdx = Math.min(_carouselIdx, _carouselImages.length - 1);
      _carouselGoTo(_carouselIdx);
      // Rebuild dots
      const dotsEl = document.getElementById('cdet-carousel-dots');
      if (dotsEl) {
        dotsEl.innerHTML = _carouselImages.map((_, i) =>
          `<div class="cdet-carousel-dot${i === _carouselIdx ? ' active' : ''}"></div>`
        ).join('');
      }
    } else {
      if (_carouselTimer) { clearInterval(_carouselTimer); _carouselTimer = null; }
      const carouselEl = document.getElementById('cdet-carousel');
      const col = document.getElementById('cdet-portrait-col');
      if (col) col.innerHTML = '<div class="cdet-no-portrait">🩸</div>';
    }

    // Invalidate grid cache
    if (_gridImages[charSlug]) {
      _gridImages[charSlug] = _gridImages[charSlug].filter(u => !u.includes(encodedFile) && !u.includes(filename));
    }
  } catch (e) {
    showToast(t('cdet.err') + e.message, 'error');
  }
}

let _genPromptRunning = false;

// Generate in-character NPC dialogue lines (Voice + clan style)
async function _genDialogue(charSlug) {
  const sitEl = document.getElementById('cdet-dlg-situation');
  const box   = document.getElementById('cdet-dlg-result');
  const btn   = document.getElementById('cdet-gen-dialogue');
  const situation = sitEl?.value.trim() || '';
  if (!box) return;
  box.style.display = '';
  if (!situation) { box.innerHTML = '<div class="canon-warn">' + t('cdet.dlgSituationWarn') + '</div>'; return; }
  btn.disabled = true; btn.textContent = t('cdet.dlgGenerating');
  box.innerHTML = '<div class="canon-loading">' + t('cdet.dlgLoading') + '</div>';
  try {
    const qs    = window.location.search;
    const prefs = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const pref  = _getPref(prefs, 'dialogue', 'openrouter');
    const d = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/dialogue${qs}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ situation, source: pref.provider, model: pref.model }) }
    ).then(r => r.json());
    if (!d.ok) { box.innerHTML = `<div class="canon-warn">${t('cdet.err')}${escHtml(d.error || t('cdet.dlgFailed'))}</div>`; return; }
    const lines = (d.text || '').split('\n').map(l => l.trim()).filter(Boolean);
    box.innerHTML = (lines.length ? _dlgFallbackNote(d.source) : '') + (lines.length
      ? `<div class="cdet-dlg-lines">${lines.map(l => `<div class="cdet-dlg-line">${escHtml(l)}</div>`).join('')}</div>`
      : `<div class="canon-warn">${t('cdet.dlgEmpty')}</div>`);
  } catch (e) {
    box.innerHTML = `<div class="canon-warn">${t('cdet.err')}${escHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = t('cdet.dlgGenBtn');
  }
}

// Single source of truth for the "Промт для генерации" block in #cdet-desc-view,
// so the copy button (#cdet-prompt-copy) can't silently drop out of one of the
// several re-render call sites (initial render, manual save, AI generation) again.
function _promptSectionHtml(imagePrompt, negativePrompt) {
  if (!imagePrompt) return '';
  return `
    <div class="cdet-section-title cdet-prompt-head">
      <span>${t('cdet.promptViewTitle')}</span>
      <button type="button" class="cdet-prompt-copy" id="cdet-prompt-copy"
        title="${t('cdet.copyPromptTitle', { neg: negativePrompt ? t('cdet.andNeg') : '' })}" aria-label="${t('cdet.copyPromptAria')}">⧉</button>
    </div>
    <textarea class="cdet-prompt-box" readonly>${escHtml(imagePrompt)}</textarea>
    ${negativePrompt ? `
      <div class="cdet-section-title" style="margin-top:14px">${t('cdet.negPromptTitle')}</div>
      <textarea class="cdet-prompt-box cdet-prompt-neg" readonly>${escHtml(negativePrompt)}</textarea>` : ''}`;
}

// Copy positive + negative image prompt as one clipboard payload (A1111-style,
// so it can be pasted whole and most generators parse the "Negative prompt:" tail).
function _copyImagePrompt(btn) {
  const view = btn.closest('#cdet-desc-view') || document;
  const pos = view.querySelector('.cdet-prompt-box:not(.cdet-prompt-neg)')?.value.trim() || '';
  const neg = view.querySelector('.cdet-prompt-neg')?.value.trim() || '';
  if (!pos && !neg) return;
  const payload = neg ? `${pos}\n\nNegative prompt: ${neg}` : pos;
  const flash = ok => {
    btn.textContent = ok ? '✓' : '✕';
    btn.classList.toggle('copied', ok);
    setTimeout(() => { btn.textContent = '⧉'; btn.classList.remove('copied'); }, 1400);
  };
  navigator.clipboard.writeText(payload).then(() => flash(true)).catch(() => flash(false));
}

async function _generatePrompt(charSlug) {
  if (_genPromptRunning) return;

  const c = STATE.characters.find(ch => ch.slug === charSlug);
  if (!c) return;

  // Treat placeholder markers (⏳ Заполнить… / ⚠️ Требуется уточнение) as "no prompt yet".
  const existingPrompt = (c.imagePrompt || '').trim();
  const isPlaceholder  = !existingPrompt || /⏳|⚠️/.test(existingPrompt);
  if (!isPlaceholder) {
    if (!await showConfirm(t('cdet.promptExists'), { confirmText: t('cdet.replace') })) return;
  }

  _genPromptRunning = true;
  const btn = document.getElementById('cdet-gen-prompt');
  if (btn) { btn.disabled = true; btn.textContent = t('cdet.generating'); }

  try {
    const qs = window.location.search;
    const featPrefs  = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const _promptPref = _getPref(featPrefs, 'prompt', 'openrouter');
    const preferSource = _promptPref.provider;
    const orModel    = (preferSource === 'openrouter' || preferSource === 'lmstudio') ? (_promptPref.model || null) : null;

    const resp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/generate-prompt${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferSource, orModel }),
    });
    const d = await resp.json();

    if (resp.status === 429 || d.rateLimited) {
      showToast(t('cdet.rateLimit'), 'warning');
      return;
    }
    if (!d.ok) {
      showToast(t('cdet.genPromptError') + (d.error || t('cdet.unknownError')), 'error');
      return;
    }

    const saveResp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/fields${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { imagePrompt: d.positive, negativePrompt: d.negative } }),
    });
    const saveData = await saveResp.json();
    if (!saveData.ok) { showToast(t('cdet.savePromptError') + (saveData.error || ''), 'error'); return; }

    Object.assign(c, { imagePrompt: d.positive, negativePrompt: d.negative });

    const descView = document.getElementById('cdet-desc-view');
    if (descView) {
      const appearance  = c.appearance && !c.appearance.includes('⚠️') ? c.appearance : '';
      const voice       = c.voice && !c.voice.includes('⚠️') ? c.voice : '';
      const personality = c.personality && !c.personality.includes('⚠️') ? c.personality : '';
      const html = [
        appearance ? `<div class="cdet-section-title">${t('cdet.appearanceTitle')}</div><div class="cdet-bio">${escHtml(appearance)}</div><div class="cdet-divider"></div>` : '',
        voice ? `<div class="cdet-section-title">${t('cdet.voiceTitle')}</div><div class="cdet-voice">${escHtml(voice)}</div><div class="cdet-divider"></div>` : '',
        personality ? `<div class="cdet-section-title">${t('cdet.personalityTitle')}</div><div class="cdet-bio">${escHtml(personality)}</div><div class="cdet-divider"></div>` : '',
        _promptSectionHtml(d.positive, d.negative),
      ].filter(Boolean).join('');
      descView.innerHTML = html;
    }
    const promptTa = document.getElementById('cdet-prompt-ta');
    if (promptTa) promptTa.value = d.positive;
    const negTa = document.getElementById('cdet-negprompt-ta');
    if (negTa) negTa.value = d.negative || '';

  } catch (e) {
    showToast(t('cdet.err') + e.message, 'error');
  } finally {
    _genPromptRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = t('cdet.genPromptBtn'); }
  }
}

let _genPersonalityRunning = false;

async function _generatePersonality(charSlug) {
  if (_genPersonalityRunning) return;

  const c = STATE.characters.find(ch => ch.slug === charSlug);
  if (!c) return;

  const hasAppearance = c.appearance && !c.appearance.includes('⚠️');
  const hasBio        = c.biography && !c.biography.includes('⚠️');
  if (!hasAppearance && !hasBio) {
    showToast(t('cdet.needAppearanceBio'), 'warning');
    return;
  }

  const existingPersonality = (c.personality || '').trim();
  if (existingPersonality && !/⚠️/.test(existingPersonality)) {
    if (!await showConfirm(t('cdet.personalityExists'), { confirmText: t('cdet.generate') })) return;
  }

  _genPersonalityRunning = true;
  const btn = document.getElementById('cdet-gen-personality');
  if (btn) { btn.disabled = true; btn.textContent = t('cdet.generating'); }

  try {
    const qs = window.location.search;
    const featPrefs     = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const _persPref     = _getPref(featPrefs, 'personality', 'openrouter');
    const preferSource  = _persPref.provider;
    const orModel       = (preferSource === 'openrouter' || preferSource === 'lmstudio') ? (_persPref.model || null) : null;

    const resp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/generate-personality${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferSource, orModel }),
    });
    const d = await resp.json();

    if (resp.status === 429 || d.rateLimited) {
      showToast(t('cdet.rateLimit'), 'warning');
      return;
    }
    if (!d.ok) {
      showToast(t('cdet.genPersonalityError') + (d.error || t('cdet.unknownError')), 'error');
      return;
    }

    const fields = { personality: d.personality };
    if (d.voice) fields.voice = d.voice;
    const saveResp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/fields${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const saveData = await saveResp.json();
    if (!saveData.ok) { showToast(t('cdet.saveError') + (saveData.error || ''), 'error'); return; }

    Object.assign(c, fields);

    const descView = document.getElementById('cdet-desc-view');
    if (descView) {
      const appearance = c.appearance && !c.appearance.includes('⚠️') ? c.appearance : '';
      const voice       = c.voice && !c.voice.includes('⚠️') ? c.voice : '';
      descView.innerHTML = [
        appearance ? `<div class="cdet-section-title">${t('cdet.appearanceTitle')}</div><div class="cdet-bio">${escHtml(appearance)}</div><div class="cdet-divider"></div>` : '',
        voice ? `<div class="cdet-section-title">${t('cdet.voiceTitle')}</div><div class="cdet-voice">${escHtml(voice)}</div><div class="cdet-divider"></div>` : '',
        d.personality ? `<div class="cdet-section-title">${t('cdet.personalityTitle')}</div><div class="cdet-bio">${escHtml(d.personality)}</div><div class="cdet-divider"></div>` : '',
        _promptSectionHtml(c.imagePrompt, c.negativePrompt),
      ].filter(Boolean).join('') || `<div class="cdet-empty">${t('cdet.descEmpty')}</div>`;
    }

    const persTa = document.getElementById('cdet-personality-ta');
    if (persTa) persTa.value = d.personality || '';
    if (d.voice) {
      const voiceTa = document.getElementById('cdet-voice-ta');
      if (voiceTa) voiceTa.value = d.voice;
    }
  } catch (e) {
    showToast(t('cdet.err') + e.message, 'error');
  } finally {
    _genPersonalityRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = t('cdet.genPersonalityBtn'); }
  }
}

let _genBiographyRunning = false;

async function _generateBiography(charSlug) {
  if (_genBiographyRunning) return;

  const c = STATE.characters.find(ch => ch.slug === charSlug);
  if (!c) return;

  const existingBio = (c.biography || '').trim();
  if (existingBio && !/⚠️/.test(existingBio)) {
    if (!await showConfirm(t('cdet.bioExists'), { confirmText: t('cdet.generate') })) return;
  }

  _genBiographyRunning = true;
  const btn = document.getElementById('cdet-gen-biography');
  if (btn) { btn.disabled = true; btn.textContent = t('cdet.generating'); }

  try {
    const qs = window.location.search;
    const featPrefs    = JSON.parse(localStorage.getItem('ai-feature-prefs') || '{}');
    const _bioPref     = _getPref(featPrefs, 'biography', 'openrouter');
    const preferSource = _bioPref.provider;
    const orModel       = (preferSource === 'openrouter' || preferSource === 'lmstudio') ? (_bioPref.model || null) : null;

    const resp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/generate-biography${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferSource, orModel }),
    });
    const d = await resp.json();

    if (resp.status === 429 || d.rateLimited) {
      showToast(t('cdet.rateLimit'), 'warning');
      return;
    }
    if (!d.ok) {
      showToast(t('cdet.genBioError') + (d.error || t('cdet.unknownError')), 'error');
      return;
    }

    const saveResp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/fields${qs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { biography: d.biography } }),
    });
    const saveData = await saveResp.json();
    if (!saveData.ok) { showToast(t('cdet.saveBioError') + (saveData.error || ''), 'error'); return; }

    c.biography = d.biography;

    document.getElementById('cdet-bio-view').innerHTML =
      d.biography ? `<div class="cdet-bio">${escHtml(d.biography)}</div>` : `<div class="cdet-empty">${t('cdet.bioEmpty')}</div>`;
    const bioTa = document.getElementById('cdet-bio-ta');
    if (bioTa) bioTa.value = d.biography || '';
  } catch (e) {
    showToast(t('cdet.err') + e.message, 'error');
  } finally {
    _genBiographyRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = t('cdet.genBioBtn'); }
  }
}

// ── Info field editing ────────────────────────────────────────────────────────
// _editCharSlug — стабильная идентичность редактируемого персонажа (slug не
// меняется при переименовании, в отличие от имени — FIX-4b,
// docs/audit/2026-07-28-fix-plan.md). _editOrigName нужен только чтобы
// восстановить отображаемое имя в шапке при отмене, к идентичности отношения
// не имеет.
let _editCharSlug   = null;
let _editOrigName   = null;
let _editOrigValues = {};
let _genAppearanceRunning = false;

function _enterInfoEdit(charSlug) {
  _editCharSlug = charSlug;
  _editOrigName = STATE.characters.find(c => c.slug === charSlug)?.name || '';
  _editOrigValues = {};

  const grid = document.getElementById('cdet-info-fields');
  const btn  = document.getElementById('cdet-edit-btn');
  const bar  = document.getElementById('cdet-edit-bar');
  if (!grid || !btn || !bar) return;

  grid.classList.add('editing');   // reveal empty optional fields while editing

  // Make name in sticky header editable
  const nameEl = document.querySelector('#char-detail-content .cdet-name');
  if (nameEl && !document.getElementById('cdet-name-input')) {
    const nameInput = document.createElement('input');
    nameInput.className = 'cdet-name-input';
    nameInput.id = 'cdet-name-input';
    nameInput.value = _editOrigName;
    nameInput.placeholder = t('cdet.namePh');
    nameEl.replaceWith(nameInput);
  }

  // Replace each .cdet-val with an input
  grid.querySelectorAll('.cdet-val').forEach(cell => {
    const key = cell.dataset.field;
    const isUnknown = cell.classList.contains('unknown');
    const current = isUnknown ? '' : cell.textContent;
    _editOrigValues[key] = current;

    let input;
    if (key === 'status') {
      input = document.createElement('select');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      const options = ['Жив', 'Жива', 'Торпор', 'Мёртв', 'Мертва', 'Пропал', 'Неизвестно'];
      // Старые/нестандартные значения («Активен», «Уничтожен (декабрь 2010)» и т.п.)
      // не входят в список — не подменяем их молча, а добавляем как есть первым
      // пунктом, чтобы сохранение без изменений не потеряло исходный текст.
      if (current && !options.includes(current)) options.unshift(current);
      options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (current === opt) o.selected = true;
        input.appendChild(o);
      });
    } else if (key === 'belonging') {
      input = document.createElement('select');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      ['Персонаж мастера', 'Персонаж игрока', 'Эпизодический персонаж', 'Фамильяр'].forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (current === opt) o.selected = true;
        input.appendChild(o);
      });
    } else if (key === 'generation') {
      input = document.createElement('select');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      // Legacy cards stored generation as a bare number ("8") or with qualifiers
      // ("12-е (предположительно)") — match by leading digits so a clean numeric
      // value still pre-selects correctly; anything else falls back to blank.
      const curNum = (current.match(/\d+/) || [])[0];
      const blank = document.createElement('option');
      blank.value = ''; blank.textContent = t('s.phSelectEmpty');
      input.appendChild(blank);
      VAMPIRE_GENERATIONS.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (curNum && opt.startsWith(curNum + '-')) o.selected = true;
        input.appendChild(o);
      });
    } else if (key === 'clan') {
      // A3 (2026-08-07): автодополнение из библиотеки — только <datalist>, без чип-пикера
      // (решение пользователя §0.2 техспеки char-loc-city-fields). Ручной ввод не блокируется.
      input = document.createElement('input');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      input.value = current;
      input.placeholder = t('cdet.unknown');
      input.setAttribute('list', 'cdet-clans-list');
      input.setAttribute('autocomplete', 'off');
    } else if (key === 'sect' && ['mortal', 'hunter'].includes(_lineageOf(_editCharSlug))) {
      // Секта — пикер (2026-08-08), только для mortal/hunter. Одиночный выбор (Часть III
      // §3.1 анализа) — тот же паттерн, что «Титул» (не «Дисциплины» — секта одна). Для
      // ВАМПИРА эта ветка не срабатывает (гейт по линейке) — sect остаётся обычным текстом,
      // веткой ниже.
      const wrap = document.createElement('div');
      wrap.className = 'cdet-field-with-pick';
      const inp = document.createElement('input');
      inp.className = 'cdet-field-input';
      inp.dataset.field = key;
      inp.value = current;
      inp.placeholder = t('cdet.unknown');
      inp.setAttribute('autocomplete', 'off');
      wrap.appendChild(inp);
      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'cdet-lib-pick-btn';
      pickBtn.dataset.pickSect = '1';
      pickBtn.title = t('cdet.pickSect');
      pickBtn.setAttribute('aria-label', t('cdet.pickSect'));
      pickBtn.textContent = '📚';
      wrap.appendChild(pickBtn);

      const outer = document.createElement('div');
      outer.appendChild(wrap);
      outer.insertAdjacentHTML('beforeend', `
        <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-sect-picker" hidden>
          <input type="text" class="v20-lib-search" placeholder="${t('cdet.searchPh')}" id="cdet-sect-search">
          <div class="v20-lib-list" id="cdet-sect-list"></div>
        </div>`);
      input = outer;
    } else if (key === 'sect') {
      // A3 (2026-08-07): автодополнение из библиотеки — только <datalist>, без чип-пикера
      // (решение пользователя §0.2 техспеки char-loc-city-fields). Ручной ввод не блокируется.
      // Вампир (и остальные линейки generic-набора, «Фракция») — без изменений.
      input = document.createElement('input');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      input.value = current;
      input.placeholder = t('cdet.unknown');
      input.setAttribute('list', 'cdet-sects-list');
      input.setAttribute('autocomplete', 'off');
    } else if (key === 'sectRole' && ['mortal', 'hunter'].includes(_lineageOf(_editCharSlug))) {
      // Роль в секте — обычное поле, без пикера (свободный текст, источник не указан
      // пользователем). Условная видимость — см. _cdetInitConditionalRows/делегат ниже.
      // Плейсхолдер с примером (дизайн-ревью 2026-08-08 п.2) — единственное из четырёх новых
      // полей без библиотечного пикера, пользователю не за что зацепиться без подсказки.
      input = document.createElement('input');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      input.value = current;
      input.placeholder = t('cdet.rolePh');
      input.setAttribute('autocomplete', 'off');
    } else if (key === 'organization' && ['mortal', 'hunter'].includes(_lineageOf(_editCharSlug))) {
      // Организация — пикер с группировкой по 3 категориям библиотеки «Смертные» (БЕЗ
      // «Правительственных служб» — та зарезервирована для «Государственные фракции» города,
      // Часть III §3.3 анализа). Все три группы всегда видимы — нет «приоритетной».
      const wrap = document.createElement('div');
      wrap.className = 'cdet-field-with-pick';
      const inp = document.createElement('input');
      inp.className = 'cdet-field-input';
      inp.dataset.field = key;
      inp.value = current;
      inp.placeholder = t('cdet.unknown');
      inp.setAttribute('autocomplete', 'off');
      wrap.appendChild(inp);
      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'cdet-lib-pick-btn';
      pickBtn.dataset.pickOrganization = '1';
      pickBtn.title = t('cdet.pickOrganization');
      pickBtn.setAttribute('aria-label', t('cdet.pickOrganization'));
      pickBtn.textContent = '📚';
      wrap.appendChild(pickBtn);

      const outer = document.createElement('div');
      outer.appendChild(wrap);
      const groups = [['religious', t('cdet.orgGroupReligious')], ['crime', t('cdet.orgGroupCrime')], ['civic', t('cdet.orgGroupCivic')]];
      outer.insertAdjacentHTML('beforeend', `
        <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-organization-picker" hidden>
          <input type="text" class="v20-lib-search" placeholder="${t('cdet.searchPh')}" id="cdet-organization-search">
          ${groups.map(([g, label]) => `
            <div class="cdet-lib-picker-group" data-group="${g}">
              <div class="cdet-lib-picker-group-label">${label}</div>
              <div class="v20-lib-list" id="cdet-organization-list-${g}"></div>
            </div>`).join('')}
        </div>`);
      input = outer;
    } else if (key === 'position' && ['mortal', 'hunter'].includes(_lineageOf(_editCharSlug))) {
      // Должность — пикер по образцу «Титула», условная видимость от «Организации».
      const wrap = document.createElement('div');
      wrap.className = 'cdet-field-with-pick';
      const inp = document.createElement('input');
      inp.className = 'cdet-field-input';
      inp.dataset.field = key;
      inp.value = current;
      inp.placeholder = t('cdet.unknown');
      inp.setAttribute('autocomplete', 'off');
      wrap.appendChild(inp);
      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'cdet-lib-pick-btn';
      pickBtn.dataset.pickPosition = '1';
      pickBtn.title = t('cdet.pickPosition');
      pickBtn.setAttribute('aria-label', t('cdet.pickPosition'));
      pickBtn.textContent = '📚';
      wrap.appendChild(pickBtn);

      const outer = document.createElement('div');
      outer.appendChild(wrap);
      outer.insertAdjacentHTML('beforeend', `
        <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-position-picker" hidden>
          <input type="text" class="v20-lib-search" placeholder="${t('cdet.searchPh')}" id="cdet-position-search">
          <div class="v20-lib-list" id="cdet-position-list"></div>
        </div>`);
      input = outer;
    } else if (key === 'disciplines') {
      // Пикер (2026-08-08) добавляется РЯДОМ с datalist, не вместо.
      const wrap = document.createElement('div');
      wrap.className = 'cdet-field-with-pick';
      const inp = document.createElement('input');
      inp.className = 'cdet-field-input';
      inp.dataset.field = key;
      inp.value = current;
      inp.placeholder = t('cdet.unknown');
      inp.setAttribute('list', 'cdet-disciplines-list');
      inp.setAttribute('autocomplete', 'off');
      wrap.appendChild(inp);
      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'cdet-lib-pick-btn';
      pickBtn.dataset.pickDiscipline = '1';
      pickBtn.title = t('cdet.pickDisciplines');
      pickBtn.setAttribute('aria-label', t('cdet.pickDisciplines'));
      pickBtn.textContent = '📚';
      wrap.appendChild(pickBtn);

      const outer = document.createElement('div');
      outer.appendChild(wrap);
      outer.insertAdjacentHTML('beforeend', `
        <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-discipline-picker" hidden>
          <input type="text" class="v20-lib-search" placeholder="${t('cdet.searchPh')}" id="cdet-discipline-search">
          <div class="cdet-lib-picker-group" data-group="priority">
            <div class="cdet-lib-picker-group-label">${t('cdet.groupClanDisciplines')}</div>
            <div class="v20-lib-list" id="cdet-discipline-list-priority"></div>
          </div>
          <div class="cdet-lib-picker-group" data-group="all">
            <div class="cdet-lib-picker-group-label">${t('cdet.groupAllDisciplines')}</div>
            <div class="v20-lib-list" id="cdet-discipline-list-all"></div>
          </div>
        </div>`);
      input = outer;
    } else if (key === 'hierarchy' && _lineageOf(_editCharSlug) !== 'fairy') {
      // A2.8 (2026-08-07): пикер «из библиотеки Титулов» — только не-феи (у фей «Иерархия»
      // осталась отдельным полем, не «Титул», решение пользователя §0.1 техспеки). Ручной
      // ввод не блокируется — кнопка лишь подставляет значение в то же поле.
      const wrap = document.createElement('div');
      wrap.className = 'cdet-field-with-pick';
      const inp = document.createElement('input');
      inp.className = 'cdet-field-input';
      inp.dataset.field = key;
      inp.value = current;
      inp.placeholder = t('cdet.unknown');
      wrap.appendChild(inp);
      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'cdet-lib-pick-btn';
      pickBtn.dataset.pickTitle = '1';
      pickBtn.title = t('cdet.pickTitle');
      pickBtn.setAttribute('aria-label', t('cdet.pickTitle'));
      pickBtn.textContent = '📚';
      wrap.appendChild(pickBtn);

      const outer = document.createElement('div');
      outer.appendChild(wrap);
      outer.insertAdjacentHTML('beforeend', `
        <div class="v20-lib-picker cdet-lib-picker-panel" id="cdet-title-picker" hidden>
          <input type="text" class="v20-lib-search" placeholder="${t('cdet.searchPh')}" id="cdet-title-search">
          <div class="cdet-lib-picker-group" data-group="priority">
            <div class="cdet-lib-picker-group-label">${t('cdet.groupBySectClan')}</div>
            <div class="v20-lib-list" id="cdet-title-list-priority"></div>
          </div>
          <div class="cdet-lib-picker-group" data-group="all">
            <div class="cdet-lib-picker-group-label">${t('cdet.groupAllTitles')}</div>
            <div class="v20-lib-list" id="cdet-title-list-all"></div>
          </div>
        </div>`);
      input = outer;
    } else {
      input = document.createElement('input');
      input.className = 'cdet-field-input';
      input.dataset.field = key;
      input.value = current;
      input.placeholder = t('cdet.unknown');
    }
    cell.replaceWith(input);
  });

  _ensureCdetLibDatalists();
  _cdetInitConditionalRows();

  btn.classList.add('active');
  btn.textContent = t('cdet.editModeLabel');
  bar.classList.add('show');

  // Focus name input
  document.getElementById('cdet-name-input')?.focus();
}

// A3 (2026-08-07): три <datalist> для автодополнения Клан/Секта/Дисциплины во вкладке
// «Информация» — заполняются один раз при входе в режим редактирования (не на каждое
// открытие карточки), библиотеки кешируются самими ensureClans/ensureSects/ensureDisciplines
// (v20-sheet.js) — общий кеш с V20-листом, повторный вызов не бьёт по сети.
async function _ensureCdetLibDatalists() {
  if (!document.getElementById('cdet-clans-list')) {
    const dl = document.createElement('datalist'); dl.id = 'cdet-clans-list';
    document.body.appendChild(dl);
  }
  if (!document.getElementById('cdet-sects-list')) {
    const dl = document.createElement('datalist'); dl.id = 'cdet-sects-list';
    document.body.appendChild(dl);
  }
  if (!document.getElementById('cdet-disciplines-list')) {
    const dl = document.createElement('datalist'); dl.id = 'cdet-disciplines-list';
    document.body.appendChild(dl);
  }
  await Promise.all([ensureClans(), ensureSects(), ensureDisciplines()]);
  const clansEl = document.getElementById('cdet-clans-list');
  const sectsEl = document.getElementById('cdet-sects-list');
  if (clansEl) clansEl.innerHTML = (_clansCache || []).map(c => `<option value="${escAttr(c.name)}">`).join('');
  if (sectsEl) sectsEl.innerHTML = (_sectsCache || []).map(s => `<option value="${escAttr(s.name)}">`).join('');
  const discInput = document.querySelector('.cdet-field-input[data-field="disciplines"]');
  const clanInput = document.querySelector('.cdet-field-input[data-field="clan"]');
  _refreshCdetDisciplinesDatalist(discInput?.value || '', clanInput?.value.trim() || '');
}

// Нативный <datalist> фильтрует по совпадению ВСЕГО значения инпута, не последнего токена
// после запятой — без этой пересборки подсказки для второй дисциплины переставали бы
// появляться, как только в поле уже есть текст. Подставляем в <option value> уже набранный
// текст (до последней запятой) + предлагаемое имя, чтобы браузер продолжал матчить полное
// значение, а подстановка добавляла дисциплину к списку, а не заменяла его.
// Библиотека хранит «Русское (English)» (d.name), v20ClanInfo(clan).disciplines — голое
// русское имя без скобки — сравнение напрямую никогда не совпадает. Один хелпер,
// используется и старым datalist (фикс регресса клановой сортировки), и пикером дисциплин.
function _disciplineBareName(fullName) {
  return String(fullName || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}
function _cdetDisciplinesDatalistOptions(currentValue, clanName) {
  const prefix = currentValue.replace(/[^,]*$/, '').replace(/,\s*$/, '');
  const already = new Set(currentValue.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
  const info = clanName ? v20ClanInfo(clanName) : null;
  const clanDiscs = new Set((info?.disciplines || []).map(d => d.toLowerCase()));
  const names = (_disciplinesCache || []).map(d => d.name)
    .filter(n => !already.has(n.toLowerCase()))
    .sort((a, b) => (clanDiscs.has(_disciplineBareName(b).toLowerCase()) ? 1 : 0) - (clanDiscs.has(_disciplineBareName(a).toLowerCase()) ? 1 : 0) || a.localeCompare(b, 'ru'));
  return names.map(n => `<option value="${escAttr((prefix ? prefix + ', ' : '') + n)}">`).join('');
}
function _refreshCdetDisciplinesDatalist(currentValue, clanName) {
  const dl = document.getElementById('cdet-disciplines-list');
  if (dl) dl.innerHTML = _cdetDisciplinesDatalistOptions(currentValue, clanName);
}
// Пересборка при вводе в «Дисциплины» (следующий токен) И при смене «Клан» (клановые —
// первыми, п.3 анализа) — оба поля видны одновременно только на вкладке «Информация»
// персонажа-вампира в режиме редактирования, делегат безопасен и для остальных линеек
// (просто не находит .cdet-field-input[data-field="disciplines"] и выходит).
document.addEventListener('input', e => {
  const discInput = e.target.matches('.cdet-field-input[data-field="disciplines"]')
    ? e.target : (e.target.matches('.cdet-field-input[data-field="clan"]')
      ? document.querySelector('.cdet-field-input[data-field="disciplines"]') : null);
  if (!discInput) return;
  const clanVal = document.querySelector('.cdet-field-input[data-field="clan"]')?.value.trim() || '';
  _refreshCdetDisciplinesDatalist(discInput.value, clanVal);
  // Пикер дисциплин (2026-08-08) — если панель открыта, держим её в синхроне с тем же
  // событием (смена «Клан» → перегруппировка «Клановые», правка «Дисциплины» руками → ✓-метки).
  const discPicker = document.getElementById('cdet-discipline-picker');
  if (discPicker && !discPicker.hidden) _renderDisciplinePickerLists(document.getElementById('cdet-discipline-search')?.value || '');
});

// Дисциплины (2026-08-08) — токенизация текущего значения поля, эвристика сопоставления
// токена с записью библиотеки (легаси-карточки хранят голое английское имя, библиотека —
// «Русское (English)» — сравнение по подстроке в обе стороны + по обеим частям).
function _cdetDisciplineTokens(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}
function _disciplineTokenMatches(token, d) {
  const t = token.toLowerCase();
  if (!t) return false;
  const full = d.name.toLowerCase();
  const en = (d.name.match(/\(([^)]+)\)/)?.[1] || '').toLowerCase();
  const ru = _disciplineBareName(d.name).toLowerCase();
  return t.includes(full) || (en && t.includes(en)) || (ru && t.includes(ru));
}
function _disciplineAlreadyIn(value, d) {
  return _cdetDisciplineTokens(value).some(tok => _disciplineTokenMatches(tok, d));
}
function _disciplineItemHtml(d, selected) {
  const hint = escHtml(_libCleanClans(d.clans));
  return `<button type="button" class="v20-lib-item${selected ? ' cdet-lib-item-selected' : ''}" data-cdet-discipline="${escAttr(d.name)}"><span>${selected ? '✓ ' : ''}${escHtml(d.name)}</span><span class="v20-lib-hint">${hint}</span></button>`;
}
async function _renderDisciplinePickerLists(query) {
  await ensureDisciplines();
  const all = _disciplinesCache || [];
  const clanInput = document.querySelector('.cdet-field-input[data-field="clan"]');
  const discInput = document.querySelector('.cdet-field-input[data-field="disciplines"]');
  const clan = clanInput?.value.trim() || '';
  const currentValue = discInput?.value || '';
  const info = clan ? v20ClanInfo(clan) : null;
  const clanDiscs = new Set((info?.disciplines || []).map(n => n.toLowerCase()));
  const q = (query || '').toLowerCase();
  const matchesQuery = d => !q || d.name.toLowerCase().includes(q);
  const isClanDisc = d => clanDiscs.has(_disciplineBareName(d.name).toLowerCase());

  const priority = all.filter(d => matchesQuery(d) && isClanDisc(d));
  const prioritySlugs = new Set(priority.map(d => d.slug));
  const rest = all.filter(d => matchesQuery(d) && !prioritySlugs.has(d.slug));

  const priorityGroup = document.querySelector('#cdet-discipline-picker .cdet-lib-picker-group[data-group="priority"]');
  const priorityList  = document.getElementById('cdet-discipline-list-priority');
  const allList       = document.getElementById('cdet-discipline-list-all');
  if (priorityGroup) priorityGroup.style.display = priority.length ? '' : 'none';
  if (priorityList) priorityList.innerHTML = priority.map(d => _disciplineItemHtml(d, _disciplineAlreadyIn(currentValue, d))).join('');
  if (allList) {
    allList.innerHTML = rest.length ? rest.map(d => _disciplineItemHtml(d, _disciplineAlreadyIn(currentValue, d))).join('')
      : (all.length
          ? `<div class="cdet-empty">${t('cdet.emptyNotFoundManual')}</div>`
          : `<div class="cdet-empty">${t('cdet.emptyNoDisciplines')}</div>`);
  }
}

// ── Секта / Роль в секте / Организация / Должность (2026-08-08, mortal/hunter) ──────────────

// Условная видимость — CSS-класс на строке .cdet-key+сосед, не вставка/удаление DOM (строка
// всегда в DOM, как любое другое поле; тот же generic-паттерн, что уже прячет пустые поля в
// просмотре, cdet-opt-empty). Точка входа — конец _enterInfoEdit (см. _cdetInitConditionalRows).
function _cdetSyncConditionalRow(triggerKey, targetKey) {
  const trigger = document.querySelector(`.cdet-field-input[data-field="${triggerKey}"]`);
  const targetInput = document.querySelector(`.cdet-field-input[data-field="${targetKey}"]`);
  if (!trigger || !targetInput) return;
  // targetInput может быть внутри top-level wrapper'а (organization/position —
  // .cdet-field-with-pick+панель) — скрываем сам wrapper (ближайший предок-прямой сиблинг
  // .cdet-key), не сам инпут. Контейнер полей — #cdet-info-fields (см. _enterInfoEdit).
  let row = targetInput;
  while (row.parentElement && row.parentElement.id !== 'cdet-info-fields') row = row.parentElement;
  const key = row.previousElementSibling;
  const hasValue = !!trigger.value.trim();
  row.classList.toggle('cdet-cond-hidden', !hasValue);
  if (key) key.classList.toggle('cdet-cond-hidden', !hasValue);
}
function _cdetInitConditionalRows() {
  _cdetSyncConditionalRow('sect', 'sectRole');
  _cdetSyncConditionalRow('organization', 'position');
}
document.addEventListener('input', e => {
  if (e.target.matches('.cdet-field-input[data-field="sect"]')) _cdetSyncConditionalRow('sect', 'sectRole');
  if (e.target.matches('.cdet-field-input[data-field="organization"]')) _cdetSyncConditionalRow('organization', 'position');
});

// Одиночный выбор (не toggle-мультивыбор, как у Дисциплин) — клик записывает значение,
// закрывает панель, фокус в поле. Без ✓-пометки «уже выбрано» — элемент не может быть
// «частично выбран», в отличие от списка Дисциплин.
function _sectItemHtml(s) {
  return `<button type="button" class="v20-lib-item" data-name="${escAttr(s.name)}"><span>${escHtml(s.name)}</span></button>`;
}
async function _renderSectPickerList(query) {
  await ensureSects();
  const q = (query || '').toLowerCase();
  const list = (_sectsCache || []).filter(s => !q || s.name.toLowerCase().includes(q));
  const box = document.getElementById('cdet-sect-list');
  if (box) box.innerHTML = list.length ? list.map(_sectItemHtml).join('')
    : `<div class="cdet-empty">${t('cdet.emptyNotFoundManual')}</div>`;
}

async function _renderOrganizationPickerList(query) {
  const groups = ['religious', 'crime', 'civic'];
  await Promise.all(groups.map(ensureMortLib));
  const q = (query || '').toLowerCase();
  for (const g of groups) {
    const full = _mortLibCache.get(g) || [];
    const list = full.filter(r => !q || r.name.toLowerCase().includes(q));
    // Пустая группа (не по фильтру поиска, а вообще — категория без записей) скрывается
    // целиком (дизайн-ревью п.4) — иначе «Ничего не найдено» висело бы постоянно.
    const groupEl = document.querySelector(`#cdet-organization-picker .cdet-lib-picker-group[data-group="${g}"]`);
    if (groupEl) groupEl.style.display = full.length ? '' : 'none';
    const listEl = document.getElementById(`cdet-organization-list-${g}`);
    if (listEl) listEl.innerHTML = list.length ? list.map(r => `<button type="button" class="v20-lib-item" data-name="${escAttr(r.name)}"><span>${escHtml(r.name)}</span></button>`).join('')
      : `<div class="cdet-empty">${t('cdet.emptyNotFound')}</div>`;
  }
}

async function _renderPositionPickerList(query) {
  await ensureMortLib('positions');
  const q = (query || '').toLowerCase();
  const list = (_mortLibCache.get('positions') || []).filter(r => !q || r.name.toLowerCase().includes(q));
  const box = document.getElementById('cdet-position-list');
  if (box) box.innerHTML = list.length ? list.map(r => `<button type="button" class="v20-lib-item" data-name="${escAttr(r.name)}"><span>${escHtml(r.name)}</span></button>`).join('')
    : `<div class="cdet-empty">${t('cdet.emptyNotFoundManual')}</div>`;
}

// A2.8 (2026-08-07): пикер «из библиотеки Титулов» для вкладки «Информация» — раскрывающаяся
// встроенная панель (не модалка поверх модалки, design.md §1.2), переиспользует классы
// .v20-lib-picker/.v20-lib-list/.v20-lib-item/.v20-lib-hint из V20-листа, но со своей
// логикой открытия/поиска/выбора (тот файл завязан на #cdet-sheet-panel, другой контекст).
function _titleAffMatches(aff, needle) {
  return !!needle && String(aff || '').toLowerCase().includes(String(needle).toLowerCase());
}
// Мульти-выбор (2026-08-08, Часть 8) — по образцу «Дисциплин»: значение поля «Титул» —
// CSV-список, токенизация переиспользует _cdetDisciplineTokens (функция обобщённая, несмотря
// на название — тот же паттерн переиспользования, что уже применён к _disciplineBareName).
// У титулов имя в библиотеке уже голое русское (без «(English)»), сопоставление — точное
// совпадение без эвристик, в отличие от дисциплин.
function _titleAlreadyIn(value, t) {
  const needle = t.name.trim().toLowerCase();
  return _cdetDisciplineTokens(value).some(tok => tok.trim().toLowerCase() === needle);
}
function _titleItemHtml(t, selected) {
  const hint = escHtml(t.affiliation || '');
  const label = (t.negative ? '⚠️ ' : '') + t.name;
  return `<button type="button" class="v20-lib-item${selected ? ' cdet-lib-item-selected' : ''}" aria-pressed="${selected ? 'true' : 'false'}" data-cdet-title="${escAttr(t.name)}"><span>${selected ? '✓ ' : ''}${escHtml(label)}</span><span class="v20-lib-hint">${hint}</span></button>`;
}
async function _renderTitlePickerLists(query) {
  await ensureTitles();
  const all = _titlesCache || [];
  const sectInput = document.querySelector('.cdet-field-input[data-field="sect"]');
  const clanInput = document.querySelector('.cdet-field-input[data-field="clan"]');
  const titleInput = document.querySelector('.cdet-field-input[data-field="hierarchy"]');
  const sect = sectInput?.value.trim() || '';
  const clan = clanInput?.value.trim() || '';
  const currentValue = titleInput?.value || '';
  const q = (query || '').toLowerCase();
  const matchesQuery = t => !q || t.name.toLowerCase().includes(q);
  const priority = all.filter(t => matchesQuery(t) && (_titleAffMatches(t.affiliation, sect) || _titleAffMatches(t.affiliation, clan)));
  const prioritySlugs = new Set(priority.map(t => t.slug));
  const rest = all.filter(t => matchesQuery(t) && !prioritySlugs.has(t.slug));

  const priorityGroup = document.querySelector('#cdet-title-picker .cdet-lib-picker-group[data-group="priority"]');
  const priorityList  = document.getElementById('cdet-title-list-priority');
  const allList       = document.getElementById('cdet-title-list-all');
  if (priorityGroup) priorityGroup.style.display = priority.length ? '' : 'none';
  if (priorityList) priorityList.innerHTML = priority.map(t => _titleItemHtml(t, _titleAlreadyIn(currentValue, t))).join('');
  if (allList) {
    allList.innerHTML = rest.length ? rest.map(t => _titleItemHtml(t, _titleAlreadyIn(currentValue, t))).join('')
      : (all.length
          ? `<div class="cdet-empty">${t('cdet.emptyNotFoundManual')}</div>`
          : `<div class="cdet-empty">${t('cdet.emptyNoTitles')}</div>`);
  }
}
// Ручная правка поля «Титул» держит ✓-пометки в синхроне (зеркало делегата «Дисциплин»,
// строки выше) — проще: без производного datalist, только перерисовка панели, если открыта.
document.addEventListener('input', e => {
  if (!e.target.matches('.cdet-field-input[data-field="hierarchy"]')) return;
  const titlePicker = document.getElementById('cdet-title-picker');
  if (titlePicker && !titlePicker.hidden) _renderTitlePickerLists(document.getElementById('cdet-title-search')?.value || '');
});
document.addEventListener('click', async e => {
  const pickBtn = e.target.closest('.cdet-lib-pick-btn[data-pick-title]');
  if (pickBtn) {
    const picker = document.getElementById('cdet-title-picker');
    if (!picker) return;
    if (picker.hidden) {
      picker.hidden = false;
      await _renderTitlePickerLists('');
    } else {
      picker.hidden = true;
    }
    return;
  }
  const item = e.target.closest('#cdet-title-picker .v20-lib-item');
  if (item) {
    // Toggle add/remove (2026-08-08, Часть 8) — зеркало блока discItem ниже: панель НЕ
    // закрывается (можно добавить несколько подряд), значение — CSV-список.
    const titleInput = document.querySelector('.cdet-field-input[data-field="hierarchy"]');
    const name = item.dataset.cdetTitle || '';
    if (titleInput && name) {
      const tokens = _cdetDisciplineTokens(titleInput.value);
      const idx = tokens.findIndex(tok => tok.trim().toLowerCase() === name.trim().toLowerCase());
      if (idx !== -1) tokens.splice(idx, 1); else tokens.push(name);
      titleInput.value = tokens.join(', ');
    }
    await _renderTitlePickerLists(document.getElementById('cdet-title-search')?.value || '');
    return;
  }
  const discPickBtn = e.target.closest('.cdet-lib-pick-btn[data-pick-discipline]');
  if (discPickBtn) {
    const picker = document.getElementById('cdet-discipline-picker');
    if (!picker) return;
    if (picker.hidden) {
      picker.hidden = false;
      await _renderDisciplinePickerLists('');
    } else {
      picker.hidden = true;
    }
    return;
  }
  const discItem = e.target.closest('#cdet-discipline-picker .v20-lib-item');
  if (discItem) {
    const discInput = document.querySelector('.cdet-field-input[data-field="disciplines"]');
    const name = discItem.dataset.cdetDiscipline || '';
    const d = (_disciplinesCache || []).find(x => x.name === name);
    if (discInput && d) {
      const tokens = _cdetDisciplineTokens(discInput.value);
      const stillMatching = tok => _disciplineTokenMatches(tok, d);
      if (tokens.some(stillMatching)) {
        // toggle-удаление — убираем ВСЕ совпавшие токены целиком, вместе с любым хвостовым
        // комментарием в той же запятой-ячейке (не хирургическая правка текста).
        discInput.value = tokens.filter(tok => !stillMatching(tok)).join(', ');
      } else {
        tokens.push(d.name);
        discInput.value = tokens.join(', ');
      }
      // Держит datalist в синхроне с новым значением — тот же input-делегат сработает сам.
      discInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Панель НЕ закрывается (можно добавить несколько подряд) — перерисовываем с текущим
    // поисковым запросом, чтобы ✓-пометки обновились.
    await _renderDisciplinePickerLists(document.getElementById('cdet-discipline-search')?.value || '');
    return;
  }

  const sectPickBtn = e.target.closest('.cdet-lib-pick-btn[data-pick-sect]');
  if (sectPickBtn) {
    const picker = document.getElementById('cdet-sect-picker');
    if (picker.hidden) { picker.hidden = false; await _renderSectPickerList(''); } else { picker.hidden = true; }
    return;
  }
  const sectItem = e.target.closest('#cdet-sect-picker .v20-lib-item');
  if (sectItem) {
    const sectInput = document.querySelector('.cdet-field-input[data-field="sect"]');
    if (sectInput) {
      sectInput.value = sectItem.dataset.name || '';
      sectInput.dispatchEvent(new Event('input', { bubbles: true })); // держит «Роль в секте» в синхроне
    }
    document.getElementById('cdet-sect-picker').hidden = true;
    sectInput?.focus();
    return;
  }

  const orgPickBtn = e.target.closest('.cdet-lib-pick-btn[data-pick-organization]');
  if (orgPickBtn) {
    const picker = document.getElementById('cdet-organization-picker');
    if (picker.hidden) { picker.hidden = false; await _renderOrganizationPickerList(''); } else { picker.hidden = true; }
    return;
  }
  const orgItem = e.target.closest('#cdet-organization-picker .v20-lib-item');
  if (orgItem) {
    const orgInput = document.querySelector('.cdet-field-input[data-field="organization"]');
    if (orgInput) {
      orgInput.value = orgItem.dataset.name || '';
      orgInput.dispatchEvent(new Event('input', { bubbles: true })); // держит «Должность» в синхроне
    }
    document.getElementById('cdet-organization-picker').hidden = true;
    orgInput?.focus();
    return;
  }

  const posPickBtn = e.target.closest('.cdet-lib-pick-btn[data-pick-position]');
  if (posPickBtn) {
    const picker = document.getElementById('cdet-position-picker');
    if (picker.hidden) { picker.hidden = false; await _renderPositionPickerList(''); } else { picker.hidden = true; }
    return;
  }
  const posItem = e.target.closest('#cdet-position-picker .v20-lib-item');
  if (posItem) {
    const posInput = document.querySelector('.cdet-field-input[data-field="position"]');
    if (posInput) posInput.value = posItem.dataset.name || '';
    document.getElementById('cdet-position-picker').hidden = true;
    posInput?.focus();
    return;
  }

  // Вид отношений (2026-08-08, Фаза 2) — ЕДИНСТВЕННАЯ панель на все строки «Отношения» (строк
  // может быть много, они динамически добавляются/удаляются — фиксированный id на КАЖДУЮ строку
  // дал бы дублирующиеся id, тот же класс бага, что уже чинили для пикеров фракций города).
  // Панель физически переезжает к активной строке через insertAdjacentElement, не клонируется.
  const relTypePickBtn = e.target.closest('.cdet-lib-pick-btn[data-pick-rel-type]');
  if (relTypePickBtn) {
    const row = relTypePickBtn.closest('.cdet-rel-row');
    _activeRelTypeInput = row.querySelector('.cdet-rel-type-inp');
    const picker = document.getElementById('cdet-rel-type-picker');
    // Клик по 📚 другой строки должен ПЕРЕВОДИТЬ панель (открыть на новой строке),
    // а не глотать первый клик на скрытие. Тоггл только когда панель уже на этой строке.
    const wasOnThisRow = !picker.hidden && picker.parentElement?.closest('.cdet-rel-row') === row;
    row.querySelector('.cdet-rel-row-top').insertAdjacentElement('afterend', picker);
    if (wasOnThisRow) { picker.hidden = true; } else { picker.hidden = false; await _renderRelTypePickerList(''); }
    return;
  }
  const relTypeItem = e.target.closest('#cdet-rel-type-picker .v20-lib-item');
  if (relTypeItem) {
    if (_activeRelTypeInput) _activeRelTypeInput.value = relTypeItem.dataset.name || '';
    document.getElementById('cdet-rel-type-picker').hidden = true;
    _relSyncAutoMutual(_activeRelTypeInput?.closest('.cdet-rel-row'));
    _activeRelTypeInput?.focus();
    return;
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'cdet-title-search') _renderTitlePickerLists(e.target.value);
  if (e.target.id === 'cdet-discipline-search') _renderDisciplinePickerLists(e.target.value);
  if (e.target.id === 'cdet-sect-search') _renderSectPickerList(e.target.value);
  if (e.target.id === 'cdet-organization-search') _renderOrganizationPickerList(e.target.value);
  if (e.target.id === 'cdet-position-search') _renderPositionPickerList(e.target.value);
  if (e.target.id === 'cdet-rel-type-search') _renderRelTypePickerList(e.target.value);
  if (e.target.matches('.cdet-rel-type-inp')) _relSyncAutoMutual(e.target.closest('.cdet-rel-row'));
});

// Авто-парные виды связи — выбор одного из них включает «Взаимно» автоматически.
// Второй копии списка на клиенте больше нет: признак «у вида есть пара» приезжает
// вместе с самими видами из документа города (колонка «Пара»), а зеркальное имя
// по-прежнему считает сервер при сохранении. Раньше здесь лежал REL_AUTO_PAIR_TYPES —
// дубликат REL_AUTO_PAIRS из web/routes/characters.js с пометкой «держать в синхроне».
async function _relSyncAutoMutual(row) {
  const typeInp = row?.querySelector('.cdet-rel-type-inp');
  const mutualCb = row?.querySelector('.cdet-rel-mutual-cb');
  if (!typeInp || !mutualCb) return;
  const name = typeInp.value.trim().toLowerCase();
  if (!name) return;
  const types = await ensureRelTypes();
  if (types.some(t => t.name.toLowerCase() === name && String(t.pair || '').trim())) mutualCb.checked = true;
}

// Вид отношений — рендер списка панели-пикера (§2.3 техспеки Фазы 2). ensureRelTypes() —
// общий кеш из relations-manage.js, оба раздела документа города подряд.
let _activeRelTypeInput = null;
async function _renderRelTypePickerList(query) {
  const types = await ensureRelTypes();
  const q = (query || '').toLowerCase();
  const list = types.filter(t => !q || t.name.toLowerCase().includes(q));
  const box = document.getElementById('cdet-rel-type-list');
  if (box) box.innerHTML = list.length
    ? list.map(t => `<button type="button" class="v20-lib-item" data-name="${escAttr(t.name)}"><span>${escHtml(t.name)}</span></button>`).join('')
    : `<div class="cdet-empty">${t('cdet.emptyNotFoundManual')}</div>`;
}

function _exitInfoEdit(saved) {
  const grid = document.getElementById('cdet-info-fields');
  const btn  = document.getElementById('cdet-edit-btn');
  const bar  = document.getElementById('cdet-edit-bar');
  if (!grid || !btn || !bar) return;

  // Restore name in sticky header
  const nameInput = document.getElementById('cdet-name-input');
  if (nameInput) {
    const displayName = saved ? (nameInput.value.trim() || _editOrigName) : _editOrigName;
    const nameEl = document.createElement('div');
    nameEl.className = 'cdet-name';
    nameEl.textContent = displayName;
    nameInput.replaceWith(nameEl);
  }

  // Restore value cells (+ re-apply view-mode hiding of empty optional fields)
  const _lineage   = _lineageOf(_editCharSlug);
  const _reqFields = requiredInfoFor(_lineage);
  const _fieldSet  = infoFieldsFor(_lineage);
  // «.cdet-key + *» — не «.cdet-field-input» напрямую: поле «Титул» (A2.8) заменяет
  // .cdet-val не голым <input>, а обёрткой (input + кнопка пикера + сама панель пикера) —
  // топ-уровневый элемент, реально стоящий рядом с .cdet-key, нужно заменить целиком,
  // иначе панель пикера осиротеет в DOM вместо чистого восстановления .cdet-val.
  grid.querySelectorAll('.cdet-key + *').forEach(topEl => {
    const input = topEl.matches('.cdet-field-input') ? topEl : topEl.querySelector('.cdet-field-input');
    if (!input) return;
    const key      = input.dataset.field;
    const value    = saved ? input.value.trim() : (_editOrigValues[key] || '');
    const empty    = !value;
    const required = _reqFields.has(key);
    const hide     = empty && !required;
    const div = document.createElement('div');
    div.className = 'cdet-val' + (empty ? ' unknown' : '') + (hide ? ' cdet-opt-empty' : '');
    div.dataset.field = key;
    div.textContent   = empty ? t('cdet.unknown') : value;
    // sync the preceding label cell (hide class + required «!» флаг)
    const keyCell = topEl.previousElementSibling;
    if (keyCell && keyCell.classList.contains('cdet-key')) {
      const lbl = (_fieldSet.find(([fk]) => fk === key) || [null, key])[1];
      keyCell.innerHTML = (empty && required)
        ? `${lbl} <span class="cdet-req-flag" title="${t('cdet.reqFlag')}">!</span>` : lbl;
      keyCell.classList.toggle('cdet-opt-empty', hide);
    }
    topEl.replaceWith(div);
  });
  grid.classList.remove('editing');

  btn.classList.remove('active');
  btn.textContent = t('cdet.editBtn');
  bar.classList.remove('show');
  _editCharSlug = null;
  _editOrigName = null;
}

async function _saveInfoFields() {
  const grid    = document.getElementById('cdet-info-fields');
  const saveBtn = document.getElementById('cdet-save-btn');
  const msg     = document.getElementById('cdet-save-msg');
  if (!grid || !_editCharSlug) return;

  const slug = _editCharSlug;
  const fields = {};

  // Collect name from header input if changed
  const nameInput = document.getElementById('cdet-name-input');
  const newName = nameInput?.value.trim();
  if (newName && newName !== _editOrigName) fields.name = newName;

  grid.querySelectorAll('.cdet-field-input').forEach(inp => {
    const key = inp.dataset.field;
    const v = inp.value.trim();
    // Пустое значение раньше просто не попадало в payload — если поле УЖЕ было
    // непустым и пользователь его очистил, очистка тихо не сохранялась (найдено
    // тестировщиком 2026-08-08: стёртая «Роль в секте» не пропадала из файла, а
    // пряталась из виду условной видимостью Части 5 и всплывала обратно при
    // повторном заполнении «Секта»). Шлём пустое значение, только если поле
    // РЕАЛЬНО было непустым при входе в правку (значит очистка осознанная) —
    // не шлём пустые значения полей, которые и так всегда были пустыми, иначе
    // каждое сохранение захламляло бы карточку пустыми строками для всех
    // никогда не заполнявшихся полей.
    if (v) fields[key] = v;
    else if (_editOrigValues[key]) fields[key] = '';
  });

  saveBtn.disabled = true;
  saveBtn.textContent = t('cdet.saving');

  try {
    const resp = await fetch(
      `/api/characters/${encodeURIComponent(slug)}/fields${window.location.search}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }) }
    );
    const d = await resp.json();
    if (d.ok) {
      // Update STATE cache
      const ch = STATE.characters.find(c => c.slug === slug);
      if (ch) Object.assign(ch, fields);

      // Sync grid card display text when name changed — slug (the identity
      // key on the card and every data-char in this modal) never changes on
      // rename, so unlike before nothing else needs re-keying here.
      if (fields.name) {
        const gridCard = document.querySelector(`.char-card[data-slug="${CSS.escape(slug)}"]`);
        const gridNameEl = gridCard?.querySelector('.char-name');
        if (gridNameEl) gridNameEl.textContent = fields.name;
        _editOrigName = fields.name;
      }

      _exitInfoEdit(true);
      msg.classList.add('show');
      setTimeout(() => msg.classList.remove('show'), 2500);
    } else {
      showToast(t('cdet.err') + (d.error || t('cdet.saveFailed')), 'error');
    }
  } catch(e) {
    showToast(t('cdet.connError') + e.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = t('cdet.saveBtn');
  }
}

async function triggerImageUpload(charSlug) {
  const input = document.createElement('input');
  input.type  = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,image/gif';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const btn = document.querySelector('.cdet-upload-btn');
    if (btn) { btn.textContent = t('cdet.loadingPlaceholder'); btn.disabled = true; }
    try {
      const ext    = file.name.split('.').pop().toLowerCase();
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = () => res(r.result.split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const resp   = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, ext })
      });
      const result = await resp.json();
      if (result.success) {
        const newUrl = result.url + '?t=' + Date.now();
        // Patch the character in STATE so the card and modal re-open correctly
        const charInState = STATE.characters.find(ch => ch.slug === charSlug);
        if (charInState) charInState.imageUrl = newUrl;
        // Update portrait in modal immediately
        const col = document.getElementById('cdet-portrait-col');
        if (col) col.innerHTML = `<div class="cdet-carousel" id="cdet-carousel">
          <img class="cdet-carousel-img" id="cdet-carousel-img" src="${escAttr(newUrl)}" alt="${escHtml(charInState?.name || '')}">
          <div class="cdet-carousel-overlay" id="cdet-carousel-overlay"></div>
          <button class="cdet-carousel-btn prev" id="cdet-carousel-prev" title="${t('cdet.carouselPrev')}" aria-label="${t('cdet.carouselPrev')}">&#8249;</button>
          <button class="cdet-carousel-btn next" id="cdet-carousel-next" title="${t('cdet.carouselNext')}" aria-label="${t('cdet.carouselNext')}">&#8250;</button>
          <div class="cdet-carousel-dots" id="cdet-carousel-dots"></div>
         </div>`;
        initCarousel(charSlug);
        // Re-render cards if user is on the characters page
        if (STATE.page === 'characters') renderChars();
        const b = document.querySelector('.cdet-upload-btn');
        if (b) {
          b.textContent = `${t('cdet.savedAs')} ${result.filename}${t('cdet.uploadMore')}`;
          b.style.background = 'rgba(0,80,0,.25)';
          b.disabled = false;
        }
      } else {
        throw new Error(result.error || t('cdet.unknownError'));
      }
    } catch (err) {
      const isOffline = err.message.includes('Failed to fetch') || err.name === 'TypeError';
      const b = document.querySelector('.cdet-upload-btn');
      if (b) { b.textContent = t('cdet.uploadBtn'); b.disabled = false; }
      if (isOffline) {
        showToast(t('dash.serverNotResponding'), 'error');
      } else {
        showToast(t('cdet.uploadError') + err.message, 'error');
      }
    }
  };
  input.click();
}

// ── Belongings (вкладка «Имущество») ─────────────────────────────────────────

function _belUrl(c, b) {
  return `/city-img/${c.city}/characters/${c.lineageFolder}/${encodeURIComponent(c.slug)}/belongings/${encodeURIComponent(b.file)}`;
}
// Миниатюра; сервер сам редиректит на исходник, если формат не ресайзится (WebP) —
// см. /city-img-thumb в server.js.
function _belThumbUrl(c, b) {
  return `/city-img-thumb/${c.city}/characters/${c.lineageFolder}/${encodeURIComponent(c.slug)}/belongings/${encodeURIComponent(b.file)}?w=640`;
}

function renderBelongingsPanel(c) {
  const list  = c.belongings || [];
  const addBtn = `<button class="cdet-bel-add" data-char="${escHtml(c.slug)}">${t('cdet.belAddBtnPlus')}</button>`;
  if (!list.length) {
    return `<div class="cdet-bel-toolbar">${addBtn}</div>
      <div class="cdet-empty">${t('cdet.belEmpty')}</div>`;
  }
  const tiles = list.map(b => `
    <figure class="cdet-bel-tile">
      <img class="cdet-bel-img" src="${escAttr(_belThumbUrl(c, b))}" alt="${escHtml(b.caption)}" loading="lazy" decoding="async">
      <figcaption class="cdet-bel-cap">${escHtml(b.caption)}</figcaption>
      <button class="cdet-bel-btn cdet-bel-edit" data-char="${escHtml(c.slug)}" data-file="${escAttr(b.file)}" title="${t('cdet.belCaptionEdit')}" aria-label="${t('cdet.belCaptionEdit')}">✎</button>
      <button class="cdet-bel-btn cdet-bel-del" data-char="${escHtml(c.slug)}" data-file="${escAttr(b.file)}" title="${t('cdet.imgDelTitle')}" aria-label="${t('cdet.imgDelTitle')}">✕</button>
    </figure>`).join('');
  return `<div class="cdet-bel-toolbar">${addBtn}</div>
    <div class="cdet-bel-grid">${tiles}</div>`;
}

// Модалка подписи (add/edit): обязательное поле, запрет [ ] и переводов строк,
// Enter = сохранить, Esc/оверлей = отмена. Разрешается в null (отмена).
function _promptCaption({ title = t('cdet.belAddBtn'), initial = '' } = {}) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.id = 'bel-caption-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-title">${escHtml(title)}</div>
        <input class="bel-cap-inp" id="_bel-cap-inp" maxlength="200" placeholder="${t('cdet.belCaptionPh')}" value="${escAttr(initial)}">
        <div class="bel-cap-err" id="_bel-cap-err" style="display:none"></div>
        <div class="confirm-acts">
          <button class="chr-modal-btn cancel" id="_bel-cap-cancel" type="button">${t('cdet.cancelBtn')}</button>
          <button class="chr-modal-btn create" id="_bel-cap-ok" type="button" disabled>${t('cdet.saveBtn')}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const inp = ov.querySelector('#_bel-cap-inp');
    const err = ov.querySelector('#_bel-cap-err');
    const ok  = ov.querySelector('#_bel-cap-ok');
    const cleanup = v => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const validate = () => {
      const v = inp.value.trim();
      const hasForbidden = /[[\]\r\n]/.test(v);
      const tooLong = v.length > 200;
      if (hasForbidden) { err.textContent = t('cdet.belCaptionInvalid'); err.style.display = ''; }
      else if (tooLong) { err.textContent = t('cdet.belCaptionTooLong'); err.style.display = ''; }
      else err.style.display = 'none';
      ok.disabled = !v || hasForbidden || tooLong;
    };
    inp.addEventListener('input', validate);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !ok.disabled) cleanup(inp.value.trim()); });
    const onKey = e => { if (e.key === 'Escape') cleanup(null); };
    document.addEventListener('keydown', onKey);
    ok.onclick = () => cleanup(inp.value.trim());
    ov.querySelector('#_bel-cap-cancel').onclick = () => cleanup(null);
    ov.addEventListener('click', e => { if (e.target === ov) cleanup(null); });
    inp.focus();
    inp.select();
    validate();
  });
}

function _repaintBelongingsPanel(charSlug) {
  const c = STATE.characters.find(ch => ch.slug === charSlug);
  const panel = document.querySelector('#char-detail-content [data-panel="belongings"]');
  if (panel && c) panel.innerHTML = renderBelongingsPanel(c);
  const tab = document.querySelector('#char-detail-content .cdet-tab[data-tab="belongings"]');
  if (tab && c) tab.textContent = `${t('cdet.belTitle')}${(c.belongings || []).length ? ` (${(c.belongings || []).length})` : ''}`;
}

async function _triggerBelongingUpload(charSlug) {
  // Устаревший скрытый инпут от отменённого ранее выбора — убрать, чтобы не
  // дублировался и не конфликтовал с новым (id уникален для детерминированных
  // селекторов, в т.ч. автотестов: на странице уже висит #modal-img-input).
  document.querySelectorAll('input[type="file"][data-bel]').forEach(n => n.remove());
  const input = document.createElement('input');
  input.id     = 'bel-file-input';
  input.setAttribute('data-bel', '');
  input.type   = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,image/gif';
  // Офскрин, но РАСПОЛОЖЕНЫЙ (не display:none): скрытые input[type=file]
  // не дают Chromedriver воспроизвести выбор файла (событие change не срабатывает),
  // и элемент всё равно ненавязчив: смещён за экран, pointer-events:none, таб-недоступен.
  input.style.cssText = 'position:fixed;left:0;top:-1000px;width:1px;height:44px;opacity:0.01;pointer-events:none;';
  input.tabIndex = -1;
  // Виснет в DOM до выбора файла (детшифр-инпут не принимает выбор дисков);
  // onchange — единственная точка выхода, на отмену диалога остаётся скрытым.
  document.body.appendChild(input);
  input.onchange = async () => {
    input.remove();
    const file = input.files[0];
    if (!file) return;
    const caption = await _promptCaption({ title: t('cdet.belAddBtn') });
    if (!caption) return;
    const addBtn = document.querySelector('.cdet-bel-add');
    if (addBtn) { addBtn.disabled = true; addBtn.textContent = t('cdet.loadingPlaceholder'); }
    try {
      const ext    = file.name.split('.').pop().toLowerCase();
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = () => res(r.result.split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const resp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/upload-belonging${window.location.search}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, ext, caption })
      });
      const result = await resp.json();
      if (!result.success) throw new Error(result.error || t('cdet.unknownError'));
      const charInState = STATE.characters.find(ch => ch.slug === charSlug);
      if (charInState) {
        charInState.belongings = charInState.belongings || [];
        charInState.belongings.push({ file: result.filename, caption });
      }
      _repaintBelongingsPanel(charSlug);
      showToast(t('cdet.belAdded'), 'success');
    } catch (err) {
      showToast(t('cdet.loadError') + err.message, 'error');
    } finally {
      if (addBtn) { addBtn.disabled = false; addBtn.textContent = t('cdet.belAddBtnPlus'); }
    }
  };
  input.click();
}

async function _editBelongingCaption(charSlug, file) {
  const c = STATE.characters.find(ch => ch.slug === charSlug);
  const item = (c?.belongings || []).find(b => b.file === file);
  if (!item) return;
  const caption = await _promptCaption({ title: t('cdet.belCaptionEdit'), initial: item.caption });
  if (!caption || caption === item.caption) return;
  try {
    const resp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/belonging/${encodeURIComponent(file)}${window.location.search}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption })
    });
    const d = await resp.json();
    if (!d.success) throw new Error(d.error || t('cdet.belCaptionError'));
    item.caption = caption;
    _repaintBelongingsPanel(charSlug);
    showToast(t('cdet.belCaptionUpdated'), 'success');
  } catch (e) {
    showToast(t('cdet.err') + e.message, 'error');
  }
}

async function _deleteBelonging(charSlug, file) {
  if (!await showConfirm(t('cdet.imgDeleteConfirm', { name: file }), { danger: true, confirmText: t('cdet.imgDelTitle') })) return;
  try {
    const resp = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/belonging/${encodeURIComponent(file)}${window.location.search}`, {
      method: 'DELETE'
    });
    const d = await resp.json();
    if (!d.ok) { showToast(t('cdet.imgDeleteError') + (d.error || ''), 'error'); return; }
    const c = STATE.characters.find(ch => ch.slug === charSlug);
    if (c) c.belongings = (c.belongings || []).filter(b => b.file !== file);
    _repaintBelongingsPanel(charSlug);
    showToast(t('cdet.belRemoved'), 'success');
  } catch (e) {
    showToast(t('cdet.err') + e.message, 'error');
  }
}

// Locations page (list/detail) moved to public/locations.js (E2.3).
// ── Module page: editPanel helpers ────────────────────────────────────────────

// После отмены редактирования одного поля внутри блока проверяет, остались ли
// ещё открытые поля — если нет, прячет кнопку «Сохранить всё» этого блока
// (она включается только при входе в блок целиком, см. data-editblock).
function _modSyncBlockSaveAllVisibility(panel) {
  if (!panel || !panel.startsWith('scensec')) return;
  const viewEl = document.getElementById(`moddet-${panel}-view`);
  const block  = viewEl?.closest('.modp-scenario-block');
  if (!block) return;
  const saveAllBtn = block.querySelector('[data-blocksaveall]');
  if (!saveAllBtn) return;
  const anyEditing = Array.from(block.querySelectorAll('.modp-scenario-field [id$="-edit"]'))
    .some(ed => ed.style.display !== 'none');
  if (!anyEditing) saveAllBtn.style.display = 'none';
}

function _modToggleEdit(panel, enter) {
  const viewEl = document.getElementById(`moddet-${panel}-view`);
  const editEl = document.getElementById(`moddet-${panel}-edit`);
  const barEl  = document.getElementById(`moddet-${panel}-bar`);
  const msgEl  = document.getElementById(`moddet-${panel}-msg`);
  if (!viewEl || !editEl) return;
  viewEl.style.display = enter ? 'none' : '';
  editEl.style.display = enter ? '' : 'none';
  if (barEl) barEl.style.display = enter ? 'flex' : 'none';
  if (msgEl) msgEl.style.display = 'none';
}

async function _modSavePanel(panel) {
  const d   = STATE.currentModuleData;
  const chr = d?.chronicle || STATE.currentModule?.chronicle;
  const mod = d?.name      || STATE.currentModule?.name;
  if (!chr || !mod) return;

  const msgEl  = document.getElementById(`moddet-${panel}-msg`);
  const fields = {};

  if (panel === 'desc') {
    fields.description = document.getElementById('moddet-desc-ta')?.value || '';

  } else if (panel === 'pcs' || panel === 'npcs') {
    const chips = document.querySelectorAll(`#moddet-${panel}-chips .moddet-chip`);
    fields[panel] = Array.from(chips).map(c => c.dataset.name).filter(Boolean);

  } else if (panel === 'scenario') {
    const content = document.getElementById('moddet-scenario-ta')?.value || '';
    try {
      const r = await fetch(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario${window.location.search}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }
      );
      if (!r.ok) throw new Error(await r.text());
      if (msgEl) { msgEl.style.display = ''; setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 2500); }
      _modToggleEdit(panel, false);
      await _reloadModulePage();
    } catch { if (msgEl) { msgEl.textContent = t('cdet.saveSectionFail'); msgEl.style.display = ''; } }
    return;

  } else if (panel === 'finale') {
    const content = document.getElementById('moddet-finale-ta')?.value || '';
    try {
      const r = await fetch(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/finale${window.location.search}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }
      );
      if (!r.ok) throw new Error(await r.text());
      if (msgEl) { msgEl.style.display = ''; setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 2500); }
      _modToggleEdit(panel, false);
      await _reloadModulePage();
    } catch { if (msgEl) { msgEl.textContent = t('cdet.saveSectionFail'); msgEl.style.display = ''; } }
    return;

  } else if (panel.startsWith('scensec')) {
    const idx     = parseInt(panel.slice('scensec'.length), 10);
    const info    = (STATE.scenarioSectionHeadings || [])[idx];
    const content = document.getElementById(`moddet-${panel}-ta`)?.value || '';
    if (!info) return;
    const { heading, parent } = info;

    // Сохранение ОДНОГО поля блока полностью перерисовывает панель (свежие
    // данные с сервера) — это сбрасывает все поля блока в режим просмотра.
    // Если рядом в том же блоке ещё открыты другие поля с несохранёнными
    // правками (кнопка «Редактировать» на блоке открывает их все разом),
    // черновики нужно снять перед перерисовкой и восстановить после — иначе
    // сохранение одного поля молча стирает правки в соседних.
    const block = document.getElementById(`moddet-${panel}-view`)?.closest('.modp-scenario-block');
    const siblingDrafts = [];
    if (block) {
      const idxs = (block.dataset.fieldIdxs || '').split(',').filter(Boolean);
      for (const siblingIdx of idxs) {
        if (siblingIdx === String(idx)) continue;
        const editEl = document.getElementById(`moddet-scensec${siblingIdx}-edit`);
        if (editEl && editEl.style.display !== 'none') {
          const ta = document.getElementById(`moddet-scensec${siblingIdx}-ta`);
          if (ta) siblingDrafts.push({ idx: siblingIdx, value: ta.value });
        }
      }
    }

    try {
      const r = await fetch(
        `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/scenario/section${window.location.search}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ heading, content, parent }) }
      );
      const result = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(result.error || t('cdet.saveFailed'));
      STATE.currentModuleData.scenario = result.scenario;
      _renderScenarioPanel(STATE.currentModuleData);
      for (const draft of siblingDrafts) {
        _modToggleEdit(`scensec${draft.idx}`, true);
        const ta = document.getElementById(`moddet-scensec${draft.idx}-ta`);
        if (ta) ta.value = draft.value;
      }
      if (siblingDrafts.length) {
        // Соседние поля снова в режиме редактирования — блок опять содержит
        // несколько открытых полей, поэтому кнопка «Сохранить всё» должна
        // быть видна, как и при обычном входе в блок целиком (data-editblock).
        const restoredBlock = document.getElementById(`moddet-scensec${siblingDrafts[0].idx}-view`)?.closest('.modp-scenario-block');
        const saveAllBtn = restoredBlock?.querySelector('[data-blocksaveall]');
        if (saveAllBtn) saveAllBtn.style.display = '';
      }
    } catch (e) {
      if (msgEl) { msgEl.textContent = t('cdet.saveSectionFail'); msgEl.style.display = ''; }
      showToast(t('cdet.saveSectionError') + e.message, 'error');
    }
    return;
  }

  try {
    const r = await fetch(
      `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/fields${window.location.search}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }
    );
    if (!r.ok) throw new Error(await r.text());
    if (msgEl) { msgEl.style.display = ''; setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 2500); }
    _modToggleEdit(panel, false);
    await _reloadModulePage();
  } catch { if (msgEl) { msgEl.textContent = t('cdet.saveSectionFail'); msgEl.style.display = ''; } }
}

async function _reloadModulePage() {
  const chr = STATE.currentModule?.chronicle;
  const mod = STATE.currentModule?.name;
  if (!chr || !mod) return;
  const activeTab = document.querySelector('.modp-tab.active')?.dataset?.modtab || 'info';
  const data = await fetch(
    `/api/chronicles/${encodeURIComponent(chr)}/modules/${encodeURIComponent(mod)}/detail${window.location.search}`
  ).then(r => r.json()).catch(() => null);
  if (data) {
    STATE.currentModuleData = data;
    renderModulePage(data);
    if (activeTab && activeTab !== 'info') {
      document.querySelectorAll('.modp-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.modtab === activeTab));
      document.querySelectorAll('.modp-panel').forEach(p =>
        p.classList.toggle('active', p.id === `modp-panel-${activeTab}`));
    }
  }
}
