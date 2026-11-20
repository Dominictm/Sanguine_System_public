'use strict';
// Location card parsing. Extracted from parsers.js during the
// 2026-07-12 decomposition.

const { readPrompt } = require('./shared');

// ── Списочные поля («Контроль», «Присутствие», «Фракции») ───────────────────────────────
/**
 * Делит значение метаполя на элементы по «,» и «;» вне круглых скобок: старые карточки
 * хранят пояснения в скобках («Сеттиты (клубы, бары), Анархи (улицы)»). Плейсхолдеры
 * шаблона («[фракция]») и прочерки элементами не считаются.
 * @param {string|null|undefined} raw
 * @returns {string[]}
 */
function splitMetaList(raw) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of String(raw == null ? '' : raw)) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(t => t.trim()).filter(t => t && !/^\[.*\]$/.test(t) && !/^[-–—]+$/.test(t));
}

/**
 * Глушит «,» и «;» внутри элемента — но только НА ВЕРХНЕМ УРОВНЕ, там же, где их видит
 * разделителями `splitMetaList`. Запятая внутри скобок — часть пояснения («Носферату
 * (транспортная сеть, наблюдение)»), и глушить её нельзя: круг «прочитали — записали»
 * портил бы значение, которого пользователь не касался (bagReport 2026-11-19).
 * Незакрытая скобка закрывается: иначе при следующем чтении элемент утянет в себя соседей
 * по списку (`splitMetaList` внутри скобок не режет). Лишняя закрывающая безопасна — обе
 * функции считают глубину одинаково и ниже нуля не уходят.
 * @param {string} s
 * @returns {string}
 */
function _muteListSeparators(s) {
  let depth = 0, out = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    out += ((ch === ',' || ch === ';') && depth === 0) ? ' ' : ch;
  }
  return depth > 0 ? out + ')'.repeat(depth) : out;
}

/**
 * Собирает значение списочного метаполя для записи в строку метаданных. Внутри элемента
 * «,» и «;» верхнего уровня глушатся (они — разделители списка), «|» заменяется всегда
 * (разделитель полей строки метаданных).
 * @param {string[]} items
 * @returns {string}
 */
function joinMetaList(items) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const t = _muteListSeparators(String(raw == null ? '' : raw).replace(/[\r\n]+/g, ' '))
      .replace(/\|/g, '∣').replace(/\s+/g, ' ').trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.join(', ');
}

// ── Location card parser ─────────────────────────────────────────────────────
/**
 * Разбирает Markdown-карточку локации в плоскую структуру для API/фронтенда.
 * Тот же источник истины, которым парсится и сохранённая карточка, и сырой
 * AI-сгенерированный текст (см. `POST /api/locations/parse-generated`).
 * @param {string} rawContent — содержимое `<slug>.md` (или сырой сгенерированный текст той же структуры)
 * @param {string} folderName — имя папки локации (кладётся в `slug`)
 * @returns {{slug: string, title?: string, subtype?: string, district?: string, neighborhood?: string,
 *   address?: string, zone?: string, dangerLevel?: string, control?: string, presence?: string,
 *   controlList: string[], presenceList: string[], factionList: string[], atmosphere?: string,
 *   sensoryPalette: {channel: string, value: string}[], locStatus?: string, faction?: string,
 *   figures?: string, threats?: string, masquerade?: string, masqueradeLevel: 'low'|'medium'|'high'|'unknown',
 *   vtmText?: string, hooks: string[], keyPoints: {place: string, desc: string}[],
 *   imagePrompt?: string, negativePrompt?: string}}
 */
function parseLocation(rawContent, folderName) {
  const content = rawContent.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const loc = { slug: folderName };

  const hm = content.match(/^#\s+(.+)$/m);
  if (hm) loc.title = hm[1].trim();

  // Parse any **Label:** value | or end-of-line pattern
  function metaField(label) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // [^\\S\\n]* — пробелы без перевода строки: пустое последнее поле («… | **Контроль:** ») не должно
    // захватывать следующую строку карточки («---») как своё значение (Б21).
    const m = content.match(new RegExp(`\\*\\*${esc}:\\*\\*[^\\S\\n]*([^|\\n]+?)(?=[^\\S\\n]*\\||[^\\S\\n]*\\n|[^\\S\\n]*$)`, 'm'));
    return m ? m[1].trim() : null;
  }

  loc.subtype      = metaField('Название');
  loc.district     = metaField('Район');
  loc.neighborhood = metaField('Дополнение к адресу');
  loc.address      = metaField('Адрес');
  loc.zone         = metaField('Зона');
  loc.dangerLevel  = metaField('Опасность');
  loc.control      = metaField('Контроль');
  // «Присутствие» (линейки) и списочный вид «Контроля» — спека influence-charts-2026-11-16 §6.
  // loc.control остаётся строкой: на неё опираются поиск и свободная генерация.
  loc.presence     = metaField('Присутствие');
  loc.controlList  = splitMetaList(loc.control);
  loc.presenceList = splitMetaList(loc.presence);
  // «Частный домен» (2026-08-06, план «карточка локации» §3.4) — чекбокс на VtM-
  // вкладке: переключает, что хранит поле «Фракция» (loc.faction) — название фракции
  // или имя персонажа-хозяина. Само поле faction парсер не различает (просто текст).
  loc.privateDomain = /^да$/i.test(metaField('Частный домен') || '');

  // Atmosphere — emoji and exact wording optional
  // Тело раздела — от конца строки заголовка: при пустом разделе захват пуст, а не «следующий
  // заголовок с таблицей» (раньше `\n+` съедал перевод строки перед «## …», и граница терялась).
  const atmM = content.match(/## (?:🎭\s+)?Атмосфера[^\n]*([\s\S]*?)(?=\n## |\n---)/);
  if (atmM) loc.atmosphere = atmM[1].trim();

  // Sensory palette — raw table text
  const sensM = content.match(/## (?:👁️\s+)?Сенсорная палитра[^\n]*([\s\S]*?)(?=\n## |\n---)/i);
  if (sensM) {
    loc.sensoryPalette = (sensM[1].match(/^\|[^|\n]+\|[^|\n]+\|/gm) || [])
      .filter(r => !r.match(/[-]{3}/))
      .map(r => {
        const cells = r.split('|').slice(1, -1).map(c => c.replace(/\*\*/g, '').trim());
        return { channel: cells[0], value: cells[1] };
      })
      .filter(r => r.channel && r.value);
  } else {
    loc.sensoryPalette = [];
  }

  // VtM table fields
  for (const [label, key] of [
    ['Статус',            'locStatus'],
    ['Фракция',           'faction'],
    ['Постоянные фигуры', 'figures'],
    ['Угрозы',            'threats'],
    ['Маскарад',          'masquerade'],
  ]) {
    const m = content.match(new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*([^|\\n]+)\\|`));
    if (m) loc[key] = m[1].trim();
  }

  // VtM section — prose only (strip table rows, separator lines, Маскарад inline)
  const vtmFreeM = content.match(/## (?:🩸\s+)?(?:VtM[^\n]*|Контекст[^\n]*)\n+([\s\S]+?)(?=\n## |\n---)/i);
  if (vtmFreeM) {
    const prose = vtmFreeM[1]
      .split('\n')
      .filter(l => !l.startsWith('|'))
      .join('\n')
      .replace(/\*\*Маскарад:\*\*[^\n]*/g, '')
      .trim();
    if (prose) loc.vtmText = prose;
  }

  // Masquerade from inline bold if not found in table
  if (!loc.masquerade) {
    const maqInline = content.match(/\*\*Маскарад:\*\*\s*([^\n]+)/);
    if (maqInline) loc.masquerade = maqInline[1].trim();
  }

  // «Фракции» — та же строка таблицы «Фракция», прочитанная списком. При «Частном домене»
  // в ней имя хозяина, а не фракции: список пуст, строка loc.faction остаётся как есть.
  loc.factionList = loc.privateDomain ? [] : splitMetaList(loc.faction);

  const maq = loc.masquerade || '';
  loc.masqueradeLevel = maq.includes('🟢') ? 'low' : maq.includes('🟡') ? 'medium' : maq.includes('🔴') ? 'high' : 'unknown';

  // Hooks — emoji, numbering and heading text optional
  const hooksM = content.match(/## (?:🪝\s+)?(?:Сценарные крючки|\d+\s+крючка?|Крючки)[^\n]*\n+([\s\S]+?)(?=\n## |\n---|$)/i);
  loc.hooks = hooksM
    ? (hooksM[1].match(/^\d+\..+$/gm) || []).map(h => h.replace(/^\d+\.\s*/, '').trim())
    : [];

  // Key points table (## Ключевые точки...)
  const keyM = content.match(/## (?:🗺️\s+)?Ключевые точки[^\n]*\n+([\s\S]+?)(?=\n## |\n---|$)/i);
  if (keyM) {
    loc.keyPoints = (keyM[1].match(/^\|[^|\n]+\|[^|\n]+\|/gm) || [])
      .filter(r => !r.match(/[-]{3}/) && !r.match(/^\|\s*\*?\*?(?:Место|Place|Параметр)\*?\*?\s*\|/i))
      .map(r => {
        const cells = r.split('|').slice(1, -1).map(c => c.replace(/\*\*/g, '').trim());
        return { place: cells[0], desc: cells[1] };
      })
      .filter(r => r.place);
  } else {
    loc.keyPoints = [];
  }

  // Image prompts (handles both card formats — see readPrompt)
  const imgPM = readPrompt(content, 'image');
  if (imgPM !== undefined) loc.imagePrompt = imgPM;
  const negPM = readPrompt(content, 'negative');
  if (negPM !== undefined) loc.negativePrompt = negPM;

  return loc;
}

module.exports = { parseLocation, splitMetaList, joinMetaList };
