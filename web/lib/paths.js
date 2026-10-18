'use strict';
// Парсер справочника Путей Просветления: system/library/vampire-paths/<slug>.md.
// Формат см. doc/design/2026-10-15-library-paths-spec.md §2 — зеркало sects
// (шапка + ## Описание) плюс таблица ## Иерархия грехов (ровно 10 строк,
// рейтинги 10→1; у Человечности 2 колонки, у путей — 3 с Обоснованием).

const EMOJI_RE = /^#\s+([^\wА-Яа-яЁё]*)\s*(.+)$/m;
const PATH_SINS_COUNT = 10;

function field(content, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = content.match(new RegExp(`^[-*]\\s*\\*\\*${esc}\\s*:\\*\\*\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

// «Русское (English)» → { name, nameEn } (зеркало rituals.js::splitNames).
function splitNames(title) {
  const m = String(title || '').match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  return m ? { name: m[1].trim(), nameEn: m[2].trim() } : { name: String(title || '').trim(), nameEn: '' };
}

function parseSinsTable(md) {
  const sins = [];
  const sec = String(md || '').match(/\n##\s+Иерархия грехов\s*\n+([\s\S]*?)(?=\n##\s|\s*$)/i);
  if (!sec) return sins;
  for (const line of sec[1].split('\n')) {
    const cells = line.trim().split('|').map(c => c.trim()).filter(c => c !== '');
    if (cells.length < 2) continue;
    if (!/^\d+$/.test(cells[0])) continue; // шапка и разделитель
    if (/^-+$/.test(cells[1])) continue;
    sins.push({
      rating: parseInt(cells[0], 10),
      sin: cells[1],
      reason: cells.length >= 3 ? cells.slice(2).join(' | ') : null,
    });
  }
  return sins;
}

function parsePathMd(rawContent, slug) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const r = {
    slug, name: slug, nameEn: '', nickname: '', virtues: '', pillar: '',
    source: '', note: '', description: '', sins: [], custom: false,
  };

  const hm = content.match(EMOJI_RE);
  if (hm) Object.assign(r, splitNames(hm[2]));
  r.nickname = field(content, 'Прозвище') || '';
  r.virtues = field(content, 'Добродетели') || '';
  r.pillar = field(content, 'Столп') || '';
  r.source = field(content, 'Источник') || '';
  r.custom = field(content, 'Авторское') === 'да';

  const head = content.split(/\n##\s/)[0];
  const noteLines = (head.match(/^>\s?(.*)$/gm) || []).map(l => l.replace(/^>\s?/, '').trim()).filter(Boolean);
  if (noteLines.length) r.note = noteLines.join(' ');

  const dm = content.match(/\n##\s+Описание\s*\n+([\s\S]*?)(?=\n##\s+Иерархия грехов|\s*$)/i);
  if (dm) r.description = dm[1].replace(/\n-{3,}\s*$/, '').trim();

  r.sins = parseSinsTable(content);
  return r;
}

// Человечность первая, далее — по русскому имени.
function comparePaths(a, b) {
  const ao = a.slug === 'chelovechnost' ? -1 : 0, bo = b.slug === 'chelovechnost' ? -1 : 0;
  if (ao !== bo) return ao - bo;
  return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
}

// Строки таблицы из массива грехов (для шаблона авторской записи):
// sins — [{ rating, sin, reason|null }, ...].
function sinsTableLines(sins) {
  const hasReason = (sins || []).some(s => s && String(s.reason || '').trim());
  const lines = hasReason
    ? ['| Показатель | Грех | Обоснование |', '|---|---|---|']
    : ['| Показатель | Грех |', '|---|---|'];
  for (const s of (sins || [])) {
    const cells = [`| ${s.rating}`, `${s.sin || ''}`];
    if (hasReason) cells.push(`${s.reason || ''}`);
    lines.push(cells.join(' | ') + ' |');
  }
  return lines;
}

module.exports = { parsePathMd, comparePaths, parseSinsTable, sinsTableLines, splitNames, PATH_SINS_COUNT };
