'use strict';

const PROFILES = Object.freeze({
  vampires: Object.freeze({
    appearanceLabel: 'вампира', imageLineage: 'vampire', imageAesthetic: 'Vampire: The Masquerade',
    abilityRules: 'Вампир: упоминай только подтверждённые на листе дисциплины из кланового списка; конкретный эффект — только если подтверждён его уровень и описание.',
    // Мягкая формулировка для биографии, характера/голоса и дневника (spec generation-feedback R4).
    abilityRulesLenient: 'Вампир: упоминай только дисциплины из профиля; если уровень не указан — обтекаемо, в общих чертах, без конкретных приёмов и механик.',
    clanStyle: true,
  }),
  fairies: Object.freeze({
    appearanceLabel: 'феи / ченджлинга', imageLineage: 'changeling / fairy', imageAesthetic: 'Changeling: The Dreaming',
    abilityRules: 'Фея: используй только записанные Искусства и Королевства и не превышай их уровни.', clanStyle: false,
  }),
  mortals: Object.freeze({
    appearanceLabel: 'смертного', imageLineage: 'mortal', imageAesthetic: 'World of Darkness mortal',
    abilityRules: 'Смертный: обычный человек не имеет сверхъестественных сил; исключения допустимы только при явной записи в карточке.', clanStyle: false,
  }),
  werewolves: Object.freeze({
    appearanceLabel: 'оборотня', imageLineage: 'werewolf', imageAesthetic: 'Werewolf: The Apocalypse',
    abilityRules: 'Оборотень: используй только записанные или явно доступные по правилам Дары и обряды.', clanStyle: false,
  }),
  mages: Object.freeze({
    appearanceLabel: 'мага', imageLineage: 'mage', imageAesthetic: 'Mage: The Ascension',
    abilityRules: 'Маг: описывай магические эффекты только в пределах записанных Сфер и уровней.', clanStyle: false,
  }),
  hunters: Object.freeze({
    appearanceLabel: 'охотника', imageLineage: 'hunter', imageAesthetic: 'Hunter: The Reckoning',
    abilityRules: 'Охотник: используй только явно подтверждённые Грани/Дары; организация и кредо сами по себе не дают силу.', clanStyle: false,
  }),
});

const NEUTRAL_PROFILE = Object.freeze({
  appearanceLabel: 'персонажа', imageLineage: 'character', imageAesthetic: 'dark fantasy RPG',
  abilityRules: 'Не описывай конкретные сверхъестественные способности.', clanStyle: false,
});

function getLineagePromptProfile(lineage) {
  return PROFILES[lineage] || NEUTRAL_PROFILE;
}

// Правило способностей для мягкого режима; у линеек без своей мягкой формулировки — обычное.
function lenientAbilityRules(lineage) {
  const p = getLineagePromptProfile(lineage);
  return p.abilityRulesLenient || p.abilityRules;
}

// Папка линейки по подписи «Линейка WoD» серверной карточки (модульный НПС без записи
// в characters/). Нераспознанная подпись → '' (нейтральный профиль).
function lineageFolderFromLabel(label) {
  const h = String(label || '').toLocaleLowerCase('ru');
  if (/vampire|вампир|сородич|kindred/.test(h)) return 'vampires';
  if (/hunter|охотник/.test(h)) return 'hunters';
  if (/mortal|смертн|гуль/.test(h)) return 'mortals';
  if (/fair|changeling|ченджлинг|подменыш|фе[яи]/.test(h)) return 'fairies';
  if (/werewolf|оборотн|garou|гару/.test(h)) return 'werewolves';
  if (/mage|маг(?:и|а)?(?:\s|$)|ascension/.test(h)) return 'mages';
  return '';
}

module.exports = { PROFILES, NEUTRAL_PROFILE, getLineagePromptProfile, lenientAbilityRules, lineageFolderFromLabel };
