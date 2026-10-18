'use strict';
/**
 * Sheet Core — shared primitives for all lineage sheets (V20, Changeling, Werewolf, Vampire, Mage).
 * Ф5 Code-review fixes: extracted common dot/box/budget logic to avoid duplication.
 * Provides: dot rendering, checkbox rendering, budget hint calculation, i18n integration.
 */

// ── Dot rendering (0–5 or 0–8 scale) ──────────────────────────────────────────
/**
 * Render a row of dots for a trait value.
 * @param {number} value - Current value (0–max)
 * @param {number} max - Maximum value (5 for V20/Changeling/Mage, 8 for Werewolf)
 * @param {string} traitKey - Unique key for this trait (used for data attr)
 * @param {object} options - { onClick, disabled, size, filledClass, emptyClass }
 * @returns {string} HTML string
 */
function renderDots(value, max, traitKey, options = {}) {
  const {
    onClick = null,
    disabled = false,
    size = 'normal', // 'small' | 'normal' | 'large'
    filledClass = 'dot-filled',
    emptyClass = 'dot-empty',
    containerClass = 'dot-row',
    tooltip = null,
  } = options;

  const cls = `${containerClass} ${size}`;
  const clickHandler = onClick
    ? `onclick="window.sheetCore?.dotClick?.('${traitKey}', event)"`
    : '';
  const disabledAttr = disabled ? 'disabled' : '';
  const titleAttr = tooltip ? `title="${tooltip}"` : '';

  let dots = '';
  for (let i = 1; i <= max; i++) {
    const filled = i <= value ? filledClass : emptyClass;
    dots += `<span class="dot ${filled}" data-key="${traitKey}" data-value="${i}" ${clickHandler} ${disabledAttr} ${titleAttr} aria-label="${i <= value ? 'Filled' : 'Empty'}"></span>`;
  }
  return `<span class="${cls}" data-trait="${traitKey}">${dots}</span>`;
}

// ── Checkbox rendering (health, willpower temp, etc.) ─────────────────────────
/**
 * Render a checkbox for health levels, willpower temp, etc.
 * @param {boolean} checked - Whether checked
 * @param {string} key - Unique key
 * @param {object} options - { onClick, disabled, label, type }
 * @returns {string} HTML string
 */
function renderCheckbox(checked, key, options = {}) {
  const {
    onClick = null,
    disabled = false,
    label = '',
    type = 'checkbox', // 'checkbox' | 'radio'
    containerClass = 'check-cell',
  } = options;

  const clickHandler = onClick
    ? `onclick="window.sheetCore?.checkClick?.('${key}', event)"`
    : '';
  const disabledAttr = disabled ? 'disabled' : '';
  const checkedAttr = checked ? 'checked' : '';
  const labelHtml = label ? `<span class="check-label">${label}</span>` : '';

  return `
    <label class="${containerClass}" data-key="${key}">
      <input type="${type}" ${checkedAttr} ${disabledAttr} ${clickHandler} aria-label="${label || key}">
      ${labelHtml}
    </label>
  `.trim();
}

// ── Budget hint calculation ───────────────────────────────────────────────────
/**
 * Calculate creation budget hint for a lineage.
 * @param {string} lineage - Lineage key (vampire, changeling, werewolf, mage, mortal)
 * @param {object} current - Current point allocations { attrs, abilities, disciplines, backgrounds, ... }
 * @param {object} sectInfo - Sect/clan/tribe info for lineage-specific norms
 * @returns {object} { spent, allowed, free, warnings[] }
 */
function calculateBudgetHint(lineage, current, sectInfo = {}) {
  const budgets = {
    vampire: { attrs: 7, abilities: 13, disciplines: 3, backgrounds: 5, virtues: 7 },
    mortal:  { attrs: 7, abilities: 11, backgrounds: 7 },
    changeling: { attrs: 7, abilities: 13, arts: 3, realms: 3, backgrounds: 5 },
    werewolf: { attrs: 7, abilities: 13, gifts: 3, backgrounds: 7 },
    mage:    { attrs: 7, abilities: 11, spheres: 6, backgrounds: 7, arete: 1 },
    hunter:  { attrs: 7, abilities: 11, edges: 3, backgrounds: 7 },
  };

  const budget = budgets[lineage] || budgets.mortal;
  const result = { spent: {}, allowed: { ...budget }, free: {}, warnings: [] };

  for (const [pool, limit] of Object.entries(budget)) {
    const spent = current[pool] || 0;
    result.spent[pool] = spent;
    result.free[pool] = Math.max(0, limit - spent);
    if (spent > limit) {
      result.warnings.push(`${pool}: ${spent}/${limit} (over by ${spent - limit})`);
    }
  }

  // Lineage-specific adjustments
  if (lineage === 'vampire') {
    // Sect norms affect freebie costs
    const sect = sectInfo.sect || 'camarilla';
    // Could add sect-specific virtue costs here
  }

  return result;
}

// ── i18n: используется глобальный переводчик из i18n.js (window.t).
// Свой стаб t() здесь НЕ заводится: топ-уровневая function t в classic-скрипте
// затирает window.t для ВСЕХ позже загруженных скриптов, и динамические строки
// всего приложения начинают отдаваться сырыми ключами (баг 2026-10-12:
// «сырые ais.* в Настройках», «сырые lib.rit.* в Ритуалах»). setI18n не нужен
// по той же причине — настоящий t() уже глобален к моменту загрузки листов.

// ── Event handlers (to be set by consuming sheet scripts) ─────────────────────
let _dotClickHandler = null;
let _checkClickHandler = null;

function setDotClickHandler(fn) { _dotClickHandler = fn; }
function setCheckClickHandler(fn) { _checkClickHandler = fn; }

// Expose for inline onclick handlers
window.sheetCore = window.sheetCore || {};
window.sheetCore.dotClick = (key, event) => _dotClickHandler?.(key, event);
window.sheetCore.checkClick = (key, event) => _checkClickHandler?.(key, event);

// ── Utility: create trait row with label + dots ───────────────────────────────
function createTraitRow(label, value, max, traitKey, options = {}) {
  const labelHtml = `<span class="trait-label">${label}</span>`;
  const dotsHtml = renderDots(value, max, traitKey, options);
  const valueHtml = options.showValue !== false ? `<span class="trait-value">${value}/${max}</span>` : '';
  return `<div class="trait-row" data-trait="${traitKey}">${labelHtml}${dotsHtml}${valueHtml}</div>`;
}

// ── Utility: create checkbox group (health, willpower) ────────────────────────
function createCheckboxGroup(items, options = {}) {
  const { containerClass = 'check-group', ...rest } = options;
  const html = items.map(item =>
    renderCheckbox(item.checked, item.key, { ...rest, label: item.label })
  ).join('');
  return `<div class="${containerClass}">${html}</div>`;
}

// ── Export ────────────────────────────────────────────────────────────────────
window.sheetCore = {
  renderDots,
  renderCheckbox,
  calculateBudgetHint,
  createTraitRow,
  createCheckboxGroup,
  setDotClickHandler,
  setCheckClickHandler,
};

// Also support module.exports for potential Node usage (tests)
if (typeof module !== 'undefined') {
  module.exports = {
    renderDots,
    renderCheckbox,
    calculateBudgetHint,
    createTraitRow,
    createCheckboxGroup,
    setDotClickHandler,
    setCheckClickHandler,
  };
}