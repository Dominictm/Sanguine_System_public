'use strict';
// «Эпоха персонажа» для промта биографии (spec generation-feedback-2026-10-25 §5.3, R9/R10):
// события хронологии города (archive/timeline.md), пересекающие годы жизни персонажа,
// с возрастом персонажа в каждом событии. Данные идут в блок недоверенных данных промта,
// правила возраста и R10 — в инструкции (eraRules), вне блока данных.
const fs   = require('fs').promises;
const path = require('path');
const { unescapeTableCell } = require('./parsers/shared');
const { parseCityMd } = require('./parsers');

const ERA_MAX_ROWS = 25;
const ERA_TEXT_MAX = 300;

// Первое 3–4-значное число значения поля («1880», «1880 г.», «около 1925») или null.
function yearOf(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null;
  const m = String(v ?? '').match(/(?<!\d)(\d{3,4})(?!\d)/);
  return m ? Number(m[1]) : null;
}

// Год из первой ячейки строки хронологии → {from, to} или null (строка пропускается).
// «1789», «1940–1944»/«1940-1944», «~800–900», «1940-е» → 1940–1949, «Самхайн 1304»,
// «Нояб. 2010 (ранний)»; «XIX в.» и прочее без арабских цифр — null.
function parseYearCell(cell) {
  const s = String(cell || '').replace(/^~\s*/, '').trim();
  let m = s.match(/(?<!\d)(\d{3,4})\s*-е/);
  if (m) { const y = Number(m[1]); return { from: y, to: y + 9 }; }
  m = s.match(/(?<!\d)(\d{3,4})\s*[–—-]\s*~?(\d{3,4})(?!\d)/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  }
  m = s.match(/(?<!\d)(\d{3,4})(?!\d)/);
  return m ? { from: Number(m[1]), to: Number(m[1]) } : null;
}

function cleanEventText(cell) {
  let t = String(cell || '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')   // markdown-ссылки → текст
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > ERA_TEXT_MAX) t = t.slice(0, ERA_TEXT_MAX - 1).trimEnd() + '…';
  return t;
}

// Ячейки строки таблицы; «\|» внутри ячейки — экранированный символ, не разделитель.
function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/).map(c => unescapeTableCell(c.trim()));
}

/**
 * Строки таблиц хронологии (заголовок с первой колонкой «Год»). Прочие таблицы
 * (легенда, «Что помнит кто») пропускаются. Текст — колонка «Событие» (иначе третья).
 * @param {string} md — содержимое timeline.md
 * @returns {{from:number, to:number, text:string}[]}
 */
function parseTimelineRows(md) {
  const lines = String(md || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const rows = [];
  let eventCol = -1;   // -1 — вне таблицы хронологии
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*\|/.test(line)) { eventCol = -1; continue; }
    const cells = splitRow(line);
    // Строка-разделитель «| --- | :---: |» после заголовка.
    if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;
    const prevIsTable = i > 0 && /^\s*\|/.test(lines[i - 1]);
    if (!prevIsTable) {   // заголовок таблицы
      if (/^(год|year)$/i.test(cells[0] || '')) {
        const idx = cells.findIndex(c => /^(событие|event)$/i.test(c));
        eventCol = idx >= 0 ? idx : 2;
      } else eventCol = -1;
      continue;
    }
    if (eventCol < 0) continue;
    const span = parseYearCell(cells[0]);
    const text = cleanEventText(cells[eventCol]);
    if (!span || !text) continue;
    rows.push({ from: span.from, to: span.to, text });
  }
  return rows;
}

function yearsWord(n) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return 'лет';
  if (b === 1) return 'год';
  if (b >= 2 && b <= 4) return 'года';
  return 'лет';
}
const ageText = (a, b) => (a === b ? `${a} ${yearsWord(a)}` : `${a}–${b} ${yearsWord(b)}`);

// События, пересекающие [birthYear, cityYear]; при переборе — равномерно по годам:
// диапазон жизни делится на ERA_MAX_ROWS корзин, из каждой берётся по событию
// (ближайшему к центру корзины), пока не набран лимит. Результат — по возрастанию года.
function pickEraRows({ birthYear, cityYear, rows }) {
  const by = yearOf(birthYear), cy = yearOf(cityYear);
  if (by == null || cy == null || by > cy) return [];
  const hit = (rows || []).filter(r => r && r.from <= cy && r.to >= by);
  const sorted = hit.slice().sort((x, y) => x.from - y.from || x.to - y.to);
  if (sorted.length <= ERA_MAX_ROWS) return sorted;
  const span = cy - by + 1;
  const buckets = Array.from({ length: ERA_MAX_ROWS }, () => []);
  for (const r of sorted) {
    const mid = (Math.max(r.from, by) + Math.min(r.to, cy)) / 2;
    const k = Math.min(ERA_MAX_ROWS - 1, Math.floor(((mid - by) / span) * ERA_MAX_ROWS));
    buckets[k].push({ r, mid });
  }
  buckets.forEach((b, k) => {
    const center = by + (k + 0.5) * span / ERA_MAX_ROWS;
    b.sort((x, y) => Math.abs(x.mid - center) - Math.abs(y.mid - center));
  });
  const picked = [];
  for (let round = 0; picked.length < ERA_MAX_ROWS; round++) {
    let any = false;
    for (const b of buckets) {
      if (round < b.length) { any = true; if (picked.length < ERA_MAX_ROWS) picked.push(b[round].r); }
    }
    if (!any) break;
  }
  return picked.sort((x, y) => x.from - y.from || x.to - y.to);
}

/**
 * Блок «Эпоха персонажа» (текст для блока данных промта) или '' — если неизвестен
 * год рождения или год города. Пометки «смертный / уже обращён» — только при embraceYear
 * (любая линейка; у не-вампиров поля обычно нет). lineage — для единообразия контракта.
 * @returns {string}
 */
function eraBlock({ birthYear, embraceYear, cityYear, rows, lineage } = {}) { // eslint-disable-line no-unused-vars
  const by = yearOf(birthYear), cy = yearOf(cityYear);
  if (by == null || cy == null || by > cy) return '';
  let ey = yearOf(embraceYear);
  if (ey != null && (ey < by || ey > cy)) ey = null;   // явная ошибка в карточке — без пометок
  const head = [`Годы жизни: ${by}–${cy} (сейчас, в ${cy}, ${ageText(cy - by, cy - by)})`];
  if (ey != null) head.push(`обращён в ${ey} (в ${ageText(ey - by, ey - by)})`);
  const picked = pickEraRows({ birthYear: by, cityYear: cy, rows });
  if (!picked.length) return `${head.join('; ')}.\nСобытий хронологии города за годы жизни нет.`;
  const lines = picked.map(r => {
    const from = Math.max(r.from, by), to = Math.min(r.to, cy);
    const years = r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`;
    let state = '';
    if (ey != null) state = from >= ey ? ', уже обращён' : to < ey ? ', смертный' : `, обращён в ${ey}`;
    return `- ${years} (${ageText(from - by, to - by)}${state}): ${r.text}`;
  });
  return `${head.join('; ')}.\nСобытия хронологии города за годы жизни (возраст персонажа в тот момент):\n${lines.join('\n')}`;
}

/**
 * Инструкции к блоку эпохи (вне блока данных): правило возраста; при пустой хронологии —
 * R10 (крупные общеизвестные события страны/региона города из знаний модели).
 * @param {{hasEvents:boolean, region:string}} opts
 * @returns {string[]} строки требований без маркера списка
 */
function eraRules({ hasEvents, region } = {}) {
  const out = [
    'Эпоха персонажа (блок данных выше): события — фон, упоминать их не обязательно. Правило возраста: до 6 лет персонаж событие не помнит; в 6–15 лет — только как фон детства, не участник; с 16 лет — возможен участник, если это согласуется с фактами карточки. Пометка «уже обращён» — событие персонаж застал после обращения.',
  ];
  if (!hasEvents) {
    out.push(`В хронологии города нет событий за годы жизни персонажа: можно опереться на крупные общеизвестные исторические события страны или региона города${region ? ` «${region}»` : ''} за эти годы (войны, революции, катастрофы) из собственных знаний — без точных дат и деталей, в которых нет уверенности; правило возраста то же.`);
  }
  return out;
}

/**
 * Источники эпохи для города: год и название (регион) из city.md, строки timeline.md.
 * Отсутствие файлов — не ошибка: пустые значения.
 * @param {string} cityRoot — абсолютный путь к cities/<город>
 * @returns {Promise<{cityYear:number|null, region:string, rows:object[]}>}
 */
async function readEraSources(cityRoot) {
  let cityYear = null, region = '', rows = [];
  try {
    const p = parseCityMd(await fs.readFile(path.join(cityRoot, 'city.md'), 'utf-8'));
    cityYear = yearOf(p.year);
    region = String(p.display || '').trim();
  } catch {}
  try { rows = parseTimelineRows(await fs.readFile(path.join(cityRoot, 'archive', 'timeline.md'), 'utf-8')); } catch {}
  return { cityYear, region, rows };
}

module.exports = { parseTimelineRows, eraBlock, eraRules, pickEraRows, readEraSources, yearOf, parseYearCell, ERA_MAX_ROWS };
