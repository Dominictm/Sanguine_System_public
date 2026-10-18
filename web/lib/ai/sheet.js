'use strict';
/**
 * Sheet Generation Helpers — extracted from server.js (Ф4 Code-review fixes).
 * Contains sheet lineage configs, pool configs, and prompt builders.
 */

// ── Per-lineage sheet config ──────────────────────────────────────────────────
const _SHEET_LINEAGES = {
  vampire:    { file: 'character_sheet_v20.md',        master: 'Vampire: The Masquerade V20', title: 'V20',        extras: 'клан, поколение, клановые дисциплины и слабость — по справочным таблицам' },
  mortal:     { file: 'character_sheet_mortal.md',      master: 'Classic World of Darkness (смертные)', title: 'Смертный', extras: 'у смертного НЕТ дисциплин, запаса крови, поколения и Пути — только Человечность' },
  changeling: { file: 'character_sheet_changeling.md',  master: 'Changeling: The Dreaming', title: 'Подменыш', extras: 'вместо дисциплин — Искусства и Сферы; вместо крови — Glamour/Banality; стартовые числа помечены как ориентир' },
  werewolf:   { file: 'character_sheet_werewolf.md',    master: 'Werewolf: The Apocalypse (Revised)', title: 'Оборотень', extras: 'нет дисциплин, крови и добродетелей; Ярость по Покровительству, Гнозис по Породе, Сила воли по Племени, Почёт (Слава/Честь/Мудрость), Ранг 1, три Дара — от Породы, Покровительства и Племени' },
  mage:       { file: 'character_sheet_mage.md',        master: 'Mage: The Ascension', title: 'Маг', extras: 'нет дисциплин и крови; магические способности — Сферы; Арете, Квинтэссенция, Парадокс по Традиции' },
  hunter:     { file: 'character_sheet_hunter.md',      master: 'Hunter: The Reckoning', title: 'Охотник', extras: 'нет дисциплин и крови; Кресты, Дары, Энергия' },
};

function getSheetLineageConfig(lineage) {
  return _SHEET_LINEAGES[lineage] || _SHEET_LINEAGES.vampire;
}

// ── Resolve sheet lineage from hint ───────────────────────────────────────────
function resolveSheetLineage(hint) {
  const h = (hint || '').toLowerCase();
  if (/mortal|смертн|гуль|ревенант/.test(h))                                  return 'mortal';
  if (/hunter|охотник/.test(h))                                                return 'mortal';
  if (/fair|fae|fey|ченджлинг|changeling|подменыш|фея|фейри|пак/.test(h))    return 'changeling';
  if (/werewolf|оборотн|garou|гару/.test(h))                                  return 'werewolf';
  if (/mage|маг(?:и|а|е|у|ов)?(?:\s|$)|ascension/.test(h))                   return 'mage';
  return 'vampire';
}

// ── Creation pools per lineage ────────────────────────────────────────────────
const _SHEET_POOLS = {
  vampire:    { attrs: '7/5/3', abilities: '13/9/5', disciplines: '3', backgrounds: '5', virtues: '7 (добродетели 1+1+1, свободные 4)' },
  mortal:     { attrs: '7/5/3', abilities: '11/7/4', backgrounds: '7' },
  changeling: { attrs: '7/5/3', abilities: '13/9/5', arts: '3 (Art 1+1+1)', realms: '3 (Realm 1+1+1)', backgrounds: '5' },
  werewolf:   { attrs: '7/5/3', abilities: '13/9/5', gifts: '3', backgrounds: '7', rage: 'по Покровительству', gnosis: 'по Породе', willpower: 'по Племени' },
  mage:       { attrs: '7/5/3', abilities: '11/7/4', spheres: '6', backgrounds: '7', arete: '1' },
  hunter:     { attrs: '7/5/3', abilities: '11/7/4', edges: '3', backgrounds: '7' },
};

function getSheetPools(lineage) {
  return _SHEET_POOLS[lineage] || _SHEET_POOLS.vampire;
}

// ── Name hints for werewolf (blanck vs old template) ──────────────────────────
const _WEREWOLF_NAMES_HINT = `
ВАЖНО: Используй названия из БЛАНКА (не старый шаблон правила):
- Атрибуты: Сила, Ловкость, Выносливость / Харизма, Манипуляция, Внешность / Восприятие, Интеллект, Смекалка.
- Способности: Таланты (Бдительность, Атлетизм, Устрашение, Интуиция, Кеннинг, Лидерство, Маскировка, Выступление, Смекалка, Уличная мудрость, Подружка), Навыки (Езда, Огнестрел, Рукопашный, Безопасность, Кража, Выживание, Ремесло, Этика, Механика, Плавание, Животноводство), Познания (Компьютеры, Загадки, Медицина, Наука, Оккультизм, Политика, Ритуалы, Энциклопедия, Право, Лингвистика).
- Дары (Gifts) — только те, что есть в библиотеке или на бланке. Не выдумывай.
`;

const _V20_NAMES_HINT = `
Используй названия из V20-бланка:
- Атрибуты: Сила, Ловкость, Выносливость / Харизма, Манипуляция, Внешность / Восприятие, Интеллект, Смекалка.
- Способности: Таланты, Навыки, Познания — стандартный V20-набор.
- Дисциплины — только клановые + общие.
`;

// ── Build sheet generation prompt ─────────────────────────────────────────────
function buildSheetPrompt({ displayName, card, sheetLineage, clanDiscBlock, psyBlock, poolsLine }) {
  const cfg = getSheetLineageConfig(sheetLineage);
  const namesHint = sheetLineage === 'werewolf' ? _WEREWOLF_NAMES_HINT : _V20_NAMES_HINT;

  return `Составь ПОЛНЫЙ лист персонажа «${displayName}» по карточке ниже.

# КАРТОЧКА ПЕРСОНАЖА
${(card || '').slice(0, 3500)}
${clanDiscBlock}${psyBlock}

Требования:
- Точно следуй СТРУКТУРЕ, ПОРЯДКУ и ФОРМАТУ ШАБЛОНА из правил (заголовки «##», таблицы, точки «●○»).
- Используй ТОЛЬКО названия характеристик и разделов из ШАБЛОНА выше. ${namesHint}
- ОБЯЗАТЕЛЬНО учитывай специфику и роль персонажа (Шаг 7): профильные способности — высокие, непрофильные — низкие.
- Характеристики 1–5, способности 0–5; ${cfg.extras}.
${poolsLine ? `- ⚠️ ОБЯЗАТЕЛЬНО ПОЛНОСТЬЮ РАСПРЕДЕЛИ ВСЕ ОЧКИ ВО ВСЕХ ПУЛАХ СОЗДАНИЯ, без остатка: ${poolsLine}. Не оставляй неизрасходованные точки — если по концепции трудно найти применение, добавь точку в наименее заметную профильную черту, но пул должен быть исчерпан полностью.\n` : ''}- Заполни ВСЕ разделы шаблона. Поля без данных в карточке заполняй разумно по концепции или ставь «—». Разделы, помеченные «опционально/если есть», включай только при наличии данных.
- Для КАЖДОЙ точечной черты (характеристики, способности, дисциплины/искусства/сферы, факты биографии, добродетели) указывай И точки, И число в формате «| Название | ●●●○○ | N |» — чтобы лист можно было редактировать.
- Верни ТОЛЬКО markdown-лист. Никаких пояснений, вступлений, «Вот лист:».`;
}

// ── Build clan/discussion block for vampires ──────────────────────────────────
function buildClanDiscBlock(gen, card) {
  // This is a simplified version — the full logic is in server.js
  // and would need the library loaders. Kept as placeholder.
  return '';
}

// ── Psychic block for mortals ─────────────────────────────────────────────────
function buildPsychicBlock(card, loadPsychics) {
  // Placeholder — full logic in server.js
  return '';
}

module.exports = {
  _SHEET_LINEAGES,
  _SHEET_POOLS,
  getSheetLineageConfig,
  resolveSheetLineage,
  getSheetPools,
  _WEREWOLF_NAMES_HINT,
  _V20_NAMES_HINT,
  buildSheetPrompt,
  buildClanDiscBlock,
  buildPsychicBlock,
};