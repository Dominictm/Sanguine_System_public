'use strict';
// Запись однострочного поля карточки «- **Ярлык:** значение» — общая для PUT /api/characters/:slug/fields
// и добора данных перед генерацией (spec doc/design/archive/generation-retry-preflight §7 ADR-2).

/**
 * Заменяет строку поля (ярлык — по префиксу, «Клан» совпадёт и с «Клан / Раса») или вставляет её:
 * перед блоком «Отношения», а если его нет — после последней однострочной строки-поля.
 * Строка-поле — «- **Ярлык:** значение» целиком в одной строке: блоки с ярлыком на отдельной строке
 * (промты, «Отношения») полями не считаются, иначе новое поле уезжало под негативный промт (Б18).
 * Нет ни одной строки-поля — карточка не меняется.
 * @returns {string} новая карточка
 */
function upsertCardLine(card, mdKey, rawValue) {
  const value   = String(rawValue ?? '').replace(/\n+/g, ' ').trim();
  const escaped = mdKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lineRe  = new RegExp(`^(- \\*\\*${escaped}[^*\\n]*:\\*\\*).*$`, 'm');
  const newLine = `- **${mdKey}:** ${value}`;
  if (lineRe.test(card)) return card.replace(lineRe, newLine);
  const fields = [...card.matchAll(/^- \*\*[^*:\n]+[^*\n]*:\*\*[^\S\n]*\S.*$/gm)];
  if (!fields.length) return card;
  const rel = card.search(/^- \*\*Отношения:\*\*/m);
  if (rel >= 0) return card.slice(0, rel) + newLine + '\n' + card.slice(rel);
  const lastM = fields.at(-1);
  const pos = lastM.index + lastM[0].length;
  return card.slice(0, pos) + '\n' + newLine + card.slice(pos);
}

module.exports = { upsertCardLine };
