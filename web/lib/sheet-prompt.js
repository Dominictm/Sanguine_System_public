'use strict';
// Данные и правила для промта генерации листа вампира (spec generation-feedback-2026-10-25,
// R19–R22): белый список полей карточки вместо её сырого текста, правила только своей
// секты без разделов, не нужных генерации, бюджеты создания по секте, шапка из карточки.

// Секта карточки → ключ правил. Тот же разбор, что у клиента (vampire-sheet.js:
// _vampSectFromCard); неизвестная/пустая секта → Камарилья (правила: «по умолчанию»).
const VAMP_SECT_KEYS = ['kamarilla', 'anarch', 'sabbat'];
function vampSectKey(sect) {
  const s = String(sect || '').toLowerCase().trim();
  if (/^анарх/.test(s)) return 'anarch';
  if (/^шабаш/.test(s)) return 'sabbat';
  return 'kamarilla';
}

// Бюджеты создания — зеркало RULES_V20.creation.vampires (public/scripts/rules-v20.js),
// паритет проверяет all.test.js.
const VAMP_SECT_POOLS = Object.freeze({
  kamarilla: { attrs: [7, 5, 3], abilities: [13, 9, 5], disciplines: 3, backgrounds: 5, virtues: 7 },
  anarch:    { attrs: [6, 5, 3], abilities: [12, 8, 5], disciplines: 4, backgrounds: 6, virtues: 7 },
  sabbat:    { attrs: [7, 5, 3], abilities: [13, 9, 5], disciplines: 4, backgrounds: 0, virtues: 5 },
});

const _clean = v => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s && !s.includes('⚠️') ? s : '';
};

// R20: поля карточки, которые видит модель. Клан и поколение не идут — их ставит код (R21).
const SHEET_CARD_FIELDS = [
  ['sect', 'Секта'], ['hierarchy', 'Титул'], ['profession', 'Профессия'], ['role', 'Роль'],
  ['concept', 'Концепция'], ['nature', 'Натура'], ['demeanor', 'Маска'],
  ['derangements', 'Деранжементы / особенности'], ['disciplines', 'Дисциплины'],
];

/** @param {object} char — parseCharacter карточки @returns {string} строки «- **Поле:** значение» */
function sheetCardFacts(char) {
  return SHEET_CARD_FIELDS
    .map(([key, label]) => [label, _clean(char?.[key])])
    .filter(([, v]) => v)
    .map(([label, v]) => `- **${label}:** ${v.slice(0, 400)}`)
    .join('\n');
}

// R22: <!-- sect:<key> -->…<!-- /sect --> — только своя секта (метки снимаются);
// <!-- gen:skip -->…<!-- /gen --> — вырезается целиком. Файл без разметки — как есть.
function sheetRulesFor(text, sectKey) {
  const own = VAMP_SECT_KEYS.includes(sectKey) ? sectKey : 'kamarilla';
  return String(text || '')
    .replace(/<!--\s*gen:skip\s*-->[\s\S]*?<!--\s*\/gen\s*-->\n?/g, '')
    .replace(/<!--\s*sect:([\w-]+)\s*-->\n?([\s\S]*?)<!--\s*\/sect\s*-->\n?/g, (_, key, body) => (key === own ? body : ''))
    .replace(/\n{3,}/g, '\n\n');
}

// R21: строки шапки «| Клан | … |» / «- **Клан:** …» в ответе модели → значения карточки.
// Пустое значение карточки — строку модели не трогаем.
const HEADER_LABELS = { clan: 'Клан', generation: 'Поколение', sect: 'Секта' };
function applySheetHeader(md, values) {
  let out = String(md || '');
  for (const [key, label] of Object.entries(HEADER_LABELS)) {
    const v = _clean(values?.[key]);
    if (!v) continue;
    const safe = v.replace(/\|/g, '∣').replace(/\$/g, '$$$$');
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Метка шаблона — «**Клан (Clan)**»: английская скобка необязательна.
    const lbl = `${esc}(?:\\s*\\([^)]*\\))?`;
    out = out
      .replace(new RegExp(`^(\\|\\s*\\*{0,2}${lbl}\\*{0,2}\\s*\\|)[^|\\n]*(\\|)`, 'm'), `$1 ${safe} $2`)
      .replace(new RegExp(`^(\\s*[-*]\\s*\\*\\*${lbl}:\\*\\*)[^\\n]*`, 'm'), `$1 ${safe}`);
  }
  return out;
}

// Есть ли титул строкой в разделе «Факты биографии» листа (для предупреждения, не отказа).
function sheetHasTitleBackground(md, title) {
  const t = _clean(title).toLowerCase();
  if (!t) return true;
  const sec = String(md || '').match(/#{2,3}[^\n]*Факты биографии[^\n]*\n([\s\S]*?)(?=\n#{2,3} |$)/i);
  return !!sec && sec[1].toLowerCase().includes(t);
}

module.exports = {
  VAMP_SECT_KEYS, VAMP_SECT_POOLS, SHEET_CARD_FIELDS,
  vampSectKey, sheetCardFacts, sheetRulesFor, applySheetHeader, sheetHasTitleBackground,
};
