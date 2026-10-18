'use strict';
// Парсер справочника ритуалов: system/library/rituals/<slug>.md → структура для API/веба.
// Канонический источник — MD-файлы (по одному на ритуал). Формат — README.md там же,
// спека — doc/design/2026-09-24-library-rituals-spec.md §10.
//
// Формат файла:
//   # <emoji> <Название> (English Name)
//   - **Традиция:** thaumaturgy | necromancy | assamite | koldun | osiris
//   - **Уровень:** N
//   - **Источник:** <Книга>, стр. N [(не сверено)]
//   - **Авторское:** да            (только у авторских записей)
//   **Литературное описание.** …
//   **Система.** …

// Традиции: код → русское название, допустимые уровни, файл дисциплины Библиотеки
// (null — дисциплины в Библиотеке нет) и префикс слага.
const TRADITIONS = {
  thaumaturgy: { name: 'Тауматургия',            levels: [1, 10], discipline: 'thaumaturgy',      prefix: 'thaum' },
  necromancy:  { name: 'Некромантия',            levels: [1, 5],  discipline: 'necromancy',       prefix: 'necro' },
  assamite:    { name: 'Ассамитское колдовство', levels: [1, 7],  discipline: 'assamite-sorcery', prefix: 'assamite' },
  koldun:      { name: 'Колдунство',             levels: [1, 9],  discipline: 'koldun',           prefix: 'koldun' },
  osiris:      { name: 'Дети Осириса',           levels: [10, 10], discipline: null,              prefix: 'osiris' },
};
const TRADITION_ORDER = Object.keys(TRADITIONS);

const H1_RE = /^#\s+([^\wА-Яа-яЁё]*)\s*(.+)$/m;

function field(content, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = content.match(new RegExp(`^[-*]\\s*\\*\\*${esc}\\s*:\\*\\*\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

// «Защита Убежища (Defense of the Sacred Haven)» → { name, nameEn }
function splitNames(title) {
  const m = String(title || '').match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  return m ? { name: m[1].trim(), nameEn: m[2].trim() } : { name: String(title || '').trim(), nameEn: '' };
}

const clean = s => s ? s.replace(/\s+/g, ' ').replace(/\s*-{3,}\s*$/, '').trim() : '';

function isLevelValid(tradition, level) {
  const t = TRADITIONS[tradition];
  return !!t && Number.isInteger(level) && level >= t.levels[0] && level <= t.levels[1];
}

function parseRitualMd(rawContent, slug) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const r = { slug, name: slug, nameEn: '', tradition: '', level: null, source: '', verified: true,
    literary: '', system: '', custom: false };

  const hm = content.match(H1_RE);
  if (hm) Object.assign(r, splitNames(hm[2]));
  r.tradition = (field(content, 'Традиция') || '').toLowerCase();
  const lvl = parseInt(field(content, 'Уровень') || '', 10);
  r.level = Number.isFinite(lvl) ? lvl : null;
  r.source = field(content, 'Источник') || '';
  r.verified = !/не сверено/i.test(r.source);
  r.custom = field(content, 'Авторское') === 'да';

  const lit = content.match(/\*\*Литературное описание\.?\*\*\s*([\s\S]*?)(?=\n\s*\*\*Система|\s*$)/i);
  const sys = content.match(/\*\*Система\.?\*\*\s*([\s\S]*?)\s*$/i);
  r.literary = clean(lit && lit[1]);
  r.system = clean(sys && sys[1]);
  return r;
}

// Порядок списка: традиция (как в TRADITIONS) → уровень → название.
function compareRituals(a, b) {
  const ta = TRADITION_ORDER.indexOf(a.tradition), tb = TRADITION_ORDER.indexOf(b.tradition);
  const oa = ta === -1 ? 99 : ta, ob = tb === -1 ? 99 : tb;
  if (oa !== ob) return oa - ob;
  if ((a.level ?? 99) !== (b.level ?? 99)) return (a.level ?? 99) - (b.level ?? 99);
  return a.name.localeCompare(b.name, 'ru');
}

module.exports = { TRADITIONS, TRADITION_ORDER, parseRitualMd, compareRituals, isLevelValid, splitNames };
