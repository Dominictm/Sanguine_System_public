'use strict';
// Профиль подтверждённых сверхъестественных способностей персонажа для генеративных
// промтов карточки (spec doc/design/archive/biography-generation §§6.2–6.8). Возвращает текст-
// allowlist: только силы, явно записанные в карточке и найденные в профильной библиотеке
// линейки, с описаниями уровней не выше записанного. Неизвестная линейка/клан → пусто.

const path = require('path');
const fs = require('fs').promises;
const {
  parseFairyArtMd, parseFairyRealmMd, parseWerewolfGiftMd, parseWerewolfRiteMd, parseMageSphereMd,
} = require('./lineage-levels');

// Клановые дисциплины — поле «Дисциплины» записи клана в system/library/clans/ (единый источник
// для клиента и сервера, spec doc/design/archive/info-tab-library-pickers §8). Клиентский двойник —
// v20LibClanDisciplines в public/scripts/v20-sheet.js; паритет обоих разборов проверяет all.test.js.
// Неизвестный клан → [] (fail-closed): фоллбэка к «Клан / принадлежность» дисциплин нет.

// Явные варианты написания (опечатки, множественное число) → нормализованное RU-имя записи клана.
const CLAN_ALIASES = Object.freeze({
  'тореадоры': 'тореадор',
  'малкавиане': 'малкавиан', 'малкавианы': 'малкавиан',
  'гангрелы': 'гангрел',
  'тремеры': 'тремер',
  'цимиски': 'цимисхи', 'тзимище': 'цимисхи',
  'каппадокиец': 'каппадокийцы', 'капподакийцы': 'каппадокийцы', 'cappadocians': 'каппадокийцы',
  'ассамит': 'ассамиты', 'assamites': 'ассамиты',
  'истинный бруха': 'истинные бруха',
  'сетиты': 'последователи сета', 'setites': 'последователи сета',
  'баабли': 'баали',
  'салубри': 'салюбри', // так писала форма создания до перехода на Библиотеку (spec lib-pickers-unified)
  'гэнгрел': 'гангрел', 'асамиты': 'ассамиты', 'серпанты света': 'змеи света', // прежний хардкод формы
});

const _norm = s => String(s || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

function normalizeClanKey(clanName) {
  const key = _norm(String(clanName || '').replace(/\(.*?\)/g, ' ').replace(/[«»"']/g, ''));
  if (!key || key.includes('⚠️')) return '';
  return CLAN_ALIASES[key] || key;
}

const _bareName = name => String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
const _enName = name => (String(name || '').match(/\(([^)]+)\)\s*$/) || [])[1] || '';

// Запись клана по имени из карточки: RU-имя → EN в скобках (в т.ч. «Lasombra») → алиас → префикс.
function findLibClan(clanName, clans) {
  const list = clans || [];
  const key = normalizeClanKey(clanName);
  const rawEn = _norm(_enName(clanName));
  if (!key && !rawEn) return null;
  const exact = list.find(c => _norm(_bareName(c.name)) === key || (_enName(c.name) && _norm(_enName(c.name)) === key)
    || (rawEn && _norm(_enName(c.name)) === rawEn));
  if (exact) return exact;
  if (key.length < 4) return null;
  const prefixed = list.filter(c => { const ru = _norm(_bareName(c.name)); return ru.startsWith(key) || key.startsWith(ru); });
  return prefixed.sort((a, b) => _bareName(a.name).length - _bareName(b.name).length)[0] || null;
}

// Поле «Дисциплины» записи клана → [{ disc, note }]. «Имя (пометка)» — условная клановая;
// скобка с английским именем самой дисциплины пометкой не считается (старый формат записей).
// Несопоставленные токены («остальные — любые») пропускаются; дубль — безусловная ветка побеждает.
function parseClanDisciplineField(field, disciplines) {
  const out = new Map();
  for (const tok of String(field || '').split(/[,;]|\s—\s/).map(s => s.trim()).filter(Boolean)) {
    const bare = _norm(_bareName(tok));
    const paren = _enName(tok);
    const disc = (disciplines || []).find(d => _norm(_bareName(d.name)) === bare || (_enName(d.name) && _norm(_enName(d.name)) === bare)
      || (paren && _enName(d.name) && _norm(_enName(d.name)) === _norm(paren)));
    if (!disc) continue;
    const note = paren && _norm(paren) !== _norm(_enName(disc.name)) && _norm(paren) !== _norm(_bareName(disc.name)) ? paren.trim() : '';
    const prev = out.get(disc.slug || disc.name);
    if (!prev || (prev.note && !note)) out.set(disc.slug || disc.name, { disc, note });
  }
  return [...out.values()];
}

function resolveClanDisciplines(clanName, { clans, disciplines }) {
  const rec = findLibClan(clanName, clans);
  return rec ? parseClanDisciplineField(rec.disciplines, disciplines) : [];
}

// Для промтов: «Анимализм, Стойкость, Доминирование (только если: обращённые до 1995)».
function clanDisciplineNames(clanName, lib) {
  return resolveClanDisciplines(clanName, lib)
    .map(({ disc, note }) => _bareName(disc.name) + (note ? ` (только если: ${note})` : ''));
}

const EMPTY_PROFILE = '(нет явно записанных способностей; конкретные сверхъестественные действия не указывать)';

// Имена записи для поиска в тексте карточки: части «Рус (Eng)» и слаг (dark-thaumaturgy → dark thaumaturgy).
function recordAliases(rec) {
  return [...String(rec?.name || '').split(/[()]/), String(rec?.slug || '').replace(/[-_]+/g, ' ')]
    .map(n => n.trim()).filter(n => n.length >= 3);
}

const _esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const _wordRe = alias => new RegExp(`(?<![\\p{L}])${_esc(alias)}(?![\\p{L}])`, 'iu');

function isRecorded(rec, recorded) {
  return recordAliases(rec).some(a => _wordRe(a).test(recorded));
}

// Уровень, записанный рядом с названием в пределах одного пункта списка: «Анимализм 2»,
// «Auspex ●●», «Силы (уровень 3)». Не записан → 0 (эффекты не подтверждаются).
function recordedLevel(rec, recorded) {
  let best = 0;
  for (const alias of recordAliases(rec)) {
    const re = new RegExp(`(?<![\\p{L}])${_esc(alias)}(?![\\p{L}])[^\\n,;]{0,30}?(?:(\\d)|(●+))`, 'giu');
    for (const m of recorded.matchAll(re)) best = Math.max(best, m[1] ? Number(m[1]) : m[2].length);
  }
  return best;
}

// Природа силы для мягкого режима — эпиграф записи (у дисциплин — note), первое предложение-два.
const _natureText = rec => String(rec.note || rec.description || '').replace(/s+/g, ' ').trim().slice(0, 240);

// opts.namesOnly — только «Имя — уровень» (промт листа, spec generation-feedback R19);
// opts.lenient — сила без уровня описывается в общих чертах (биография/характер/дневник, R4).
function levelledText(rec, recorded, opts = {}) {
  const level = recordedLevel(rec, recorded);
  if (opts.namesOnly) return `**${rec.name}** — ${level ? `уровень ${level}` : 'уровень не указан'}`;
  if (opts.lenient && !level) {
    const nature = _natureText(rec);
    return `**${rec.name}** — уровень не указан: упоминай только природу силы в общих чертах, без приёмов, уровней и механик.${nature ? `
  ${nature}` : ''}`;
  }
  const lines = (rec.levels || []).filter(l => Number(l.level) <= level).slice(0, 5)
    .map(l => `  Уровень ${l.level} — ${l.name}: ${String(l.literary || '').slice(0, 240)}${l.system ? ` (Система: ${String(l.system).slice(0, 240)})` : ''}`);
  return `**${rec.name}**${lines.length ? ` (записанный уровень ${level})\n${lines.join('\n')}` : '\nКарточка не задаёт уровень: не утверждать конкретные эффекты.'}`;
}

const singleText = rec => `**${rec.name}**${rec.level ? ` (уровень ${rec.level})` : ''}: ${[rec.description, rec.system && `Система: ${rec.system}`].filter(Boolean).join(' ')}`.slice(0, 700);

async function readLibraryFolder(root, folder, parser) {
  const dir = path.join(root, 'system', 'library', folder);
  const files = await fs.readdir(dir).catch(() => []);
  return Promise.all(files.filter(f => /\.md$/i.test(f) && f.toLowerCase() !== 'readme.md').map(async file => {
    const raw = await fs.readFile(path.join(dir, file), 'utf8').catch(() => '');
    return parser(raw, path.basename(file, '.md'));
  }));
}

/**
 * @param {object} char — персонаж (parseCharacter), обязательно lineageFolder с сервера
 * @param {{root: string, loadDisciplines: () => Promise<object[]>, loadPsychics: () => Promise<object[]>,
 *          loadClans: () => Promise<object[]>}} deps
 * @returns {Promise<string>} allowlist для промта (никогда не пустая строка)
 */
async function buildAbilityProfile(char, { root, loadDisciplines, loadPsychics, loadClans }, opts = {}) {
  const lineage = char?.lineageFolder || '';
  const recorded = [char?.disciplines, char?.features].filter(v => v && !String(v).includes('⚠️ Требуется')).join('\n');

  if (lineage === 'vampires') {
    const [clans, library] = await Promise.all([
      (loadClans ? loadClans() : Promise.resolve([])).catch(() => []), loadDisciplines().catch(() => [])]);
    const canon = resolveClanDisciplines(char.clan, { clans, disciplines: library });
    if (!canon.length) return '(клан не найден в Библиотеке кланов: дисциплины не подтверждены, конкретные силы не указывать)';
    const matched = canon.filter(({ disc }) => isRecorded(disc, recorded));
    const allowed = canon.map(({ disc, note }) => _bareName(disc.name) + (note ? ` (только если: ${note})` : ''));
    return matched.map(({ disc, note }) => levelledText(disc, recorded, opts) + (note ? `\nКлановая только при условии: ${note}.` : '')).join('\n\n')
      || `(нет подтверждённых клановых дисциплин; клан допускает только: ${allowed.join(', ')}; конкретные силы не указывать)`;
  }
  if (lineage === 'hunters') {
    const confirmed = String(char?.features || '').trim();
    return confirmed && !confirmed.includes('⚠️') ? `Записанные в карточке Грани/Дары (только они): ${confirmed}` : EMPTY_PROFILE;
  }

  let records = [];
  if (lineage === 'fairies') {
    const [arts, realms] = await Promise.all([
      readLibraryFolder(root, 'fairy-arts', parseFairyArtMd), readLibraryFolder(root, 'fairy-realms', parseFairyRealmMd)]);
    records = [...arts, ...realms].filter(r => isRecorded(r, recorded)).map(r => levelledText(r, recorded, opts));
  } else if (lineage === 'werewolves') {
    const [gifts, rites] = await Promise.all([
      readLibraryFolder(root, 'werewolf-gifts', parseWerewolfGiftMd), readLibraryFolder(root, 'werewolf-rites', parseWerewolfRiteMd)]);
    records = [...gifts, ...rites].filter(r => isRecorded(r, recorded)).map(r => opts.namesOnly ? `**${r.name}**${r.level ? ` — уровень ${r.level}` : ''}` : singleText(r));
  } else if (lineage === 'mages') {
    records = (await readLibraryFolder(root, 'mage-spheres', parseMageSphereMd))
      .filter(r => isRecorded(r, recorded)).map(r => levelledText(r, recorded, opts));
  } else if (lineage === 'mortals') {
    // Экстрасенс — Numina из каталога; гуль — только дисциплины из поля «Дисциплины» карточки.
    const ghoulDisc = String(char?.disciplines || '');
    const [psychics, disciplines] = await Promise.all([
      loadPsychics().catch(() => []), ghoulDisc.trim() ? loadDisciplines().catch(() => []) : []]);
    records = [
      ...psychics.filter(r => isRecorded(r, recorded)).map(r => levelledText(r, recorded, opts)),
      ...disciplines.filter(d => isRecorded(d, ghoulDisc)).map(d => levelledText(d, ghoulDisc, opts)),
    ];
  } else {
    return EMPTY_PROFILE;
  }
  return records.join('\n\n') || EMPTY_PROFILE;
}

module.exports = {
  CLAN_ALIASES, EMPTY_PROFILE,
  normalizeClanKey, findLibClan, parseClanDisciplineField, resolveClanDisciplines, clanDisciplineNames,
  isRecorded, recordedLevel, buildAbilityProfile,
};
