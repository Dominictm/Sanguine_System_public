'use strict';
// Общий парсер силовых справочников линеек: Искусства/Королевства фей,
// Дары/Обряды оборотней, Сферы/Техники магов.
// system/library/<kind>/<slug>.md. Обобщение web/lib/fairy-arts.js
// (спека doc/specs/werewolf-mage-library-expansion/spec.md §2.1):
// уровни всегда плоские «Уровень 1..5». Старые имена parseFairy* сохранены
// (импорты в routes/library.js и тестах обновлены на этот модуль).
//
// Формат файла искусства/сферы:
//   # <emoji> <Название> (English)
//   - **Атрибут:** …            (только искусства; у сфер поля нет)
//   - **Источник:** Книга, стр. N
//   > (опц. вводная — строки-цитаты)
//   ## Уровень N — <Название силы> (English)
//   **Литературное описание.** …
//   **Система.** …
//
// Формат файла королевства:
//   # <Название> (English)
//   - **Источник:** Книга, стр. N
//   ## Описание
//   <вводный текст>
//   ## Уровень N — <Название ступени>
//   <текст ступени одним блоком → literary, system: ''>
//
// Формат файла Дара (одна запись = один Дар, не шкала):
//   # <Название> (English)
//   - **Группа:** …              (порода/покровительство/племя)
//   - **Уровень:** 1–5
//   - **Источник:** Книга, гл. 4
//   **Литературное описание.** …
//   **Система.** …
//
// Формат файла обряда/техники (без числовых уровней):
//   # <Название> (English)
//   - **Тип:** …                 (обряды; у техник поля нет)
//   - **Источник:** …
//   ## Описание
//   <текст>
//   **Система.** …               (опц.)

const EMOJI_RE = /^#\s+([^\wА-Яа-яЁё]*)\s*(.+)$/m;

function field(content, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = content.match(new RegExp(`^[-*]\\s*\\*\\*${esc}\\s*:\\*\\*\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

// «Уровень 3 — Забытие (Fugue)» → { level:3, name:'…' }
function parseFairyLevelHeading(text) {
  const m = text.match(/^Уровень\s+(\d+)\s*[—–-]\s*(.+)$/i);
  if (!m) return null;
  return { level: parseInt(m[1], 10), name: m[2].trim() };
}

// Из тела секции вытащить «Литературное описание.» и «Система.»
function splitFairyLevelBody(body) {
  const lit = body.match(/\*\*Литературное описание\.?\*\*\s*([\s\S]*?)(?=\n\s*\*\*Система|\s*$)/i);
  const sys = body.match(/\*\*Система\.?\*\*\s*([\s\S]*?)\s*$/i);
  // Снять хвостовой markdown-разделитель (--- перед следующим заголовком) и схлопнуть пробелы.
  const clean = s => s ? s.replace(/\n-{3,}\s*$/, '').replace(/\s+/g, ' ').replace(/\s*-{3,}\s*$/, '').trim() : '';
  return { literary: clean(lit && lit[1]), system: clean(sys && sys[1]) };
}

// Текст ступени королевства одним блоком: plain-часть тела (до секции
// «Система», без маркера «Литературное описание») + текст системы.
// Покрывает все формы: plain only, маркеры, смешанную (plain + **Система.**,
// ровно то, что пишет авторский шаблон _FA_LEVEL_REALM).
function fairyRealmText(body) {
  const b = String(body || '');
  const clean = s => s ? s.replace(/\n-{3,}\s*$/, '').replace(/\s+/g, ' ').replace(/\s*-{3,}\s*$/, '').trim() : '';
  const sysM = b.match(/\*\*Система\.?\*\*\s*([\s\S]*?)\s*$/i);
  const system = clean(sysM && sysM[1]);
  const head = (sysM ? b.slice(0, sysM.index) : b).replace(/\*\*Литературное описание\.?\*\*/i, '');
  return [clean(head), system].filter(Boolean).join(' ');
}

function baseHead(content, slug) {
  const rec = { slug, name: slug, source: '', note: '', description: '', custom: false };
  const hm = content.match(EMOJI_RE);
  if (hm) rec.name = hm[2].trim();
  rec.source = field(content, 'Источник') || '';
  rec.custom = field(content, 'Авторское') === 'да';
  const head = content.split(/\n##\s/)[0];
  const noteLines = (head.match(/^>\s?(.*)$/gm) || []).map(l => l.replace(/^>\s?/, '').trim()).filter(Boolean);
  if (noteLines.length) rec.note = noteLines.join(' ');
  return rec;
}

// Вводный ## Описание — только до следующего ## (уровни не втекают).
function introDescription(content) {
  const parts = content.split(/\n##\s+/).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    if (/^Описание$/i.test(heading)) {
      const body = nl === -1 ? '' : part.slice(nl + 1);
      return body.replace(/\n-{3,}\s*$/, '').trim();
    }
  }
  return '';
}

function splitLevels(content) {
  const levels = [];
  const h2parts = content.split(/\n##\s+/).slice(1); // [0] — шапка
  for (const part of h2parts) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const bodyAll = nl === -1 ? '' : part.slice(nl + 1);
    const ph = parseFairyLevelHeading(heading);
    if (!ph) continue; // «Описание» и прочие не-уровни пропускаем
    levels.push({ ...ph, ...splitFairyLevelBody(bodyAll), text: fairyRealmText(bodyAll) });
  }
  levels.sort((a, b) => a.level - b.level);
  return levels;
}

function parseFairyArtMd(rawContent, slug) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rec = baseHead(content, slug);
  rec.attribute = field(content, 'Атрибут') || '';
  rec.description = introDescription(content);
  rec.levels = splitLevels(content);
  return rec;
}

function parseFairyRealmMd(rawContent, slug) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rec = baseHead(content, slug);
  rec.description = introDescription(content);
  // Текст ступени — единый блок → literary (в книге у ступеней нет пары
  // описание/система). Общий редактор уровней и рендер работают без форков.
  rec.levels = splitLevels(content).map(l => ({
    level: l.level, name: l.name, literary: l.text, system: '',
  }));
  return rec;
}

// Тело силового блока без уровней: маркеры **Литературное описание.** /
// **Система.** в шапке файла (Дары) либо после ## Описание (обряды/техники).
function splitPowerBody(content) {
  const body = String(content || '').split(/\n##\s/)[0] + '\n' + introDescription(content);
  const lit = String(content || '').match(/\*\*Литературное описание\.?\*\*\s*([\s\S]*?)(?=\n\s*\*\*Система|\s*$)/i);
  const sys = String(content || '').match(/\*\*Система\.?\*\*\s*([\s\S]*?)\s*$/i);
  const clean = s => s ? s.replace(/\n-{3,}\s*$/, '').replace(/\s+/g, ' ').replace(/\s*-{3,}\s*$/, '').trim() : '';
  void body;
  return { literary: clean(lit && lit[1]), system: clean(sys && sys[1]) };
}

// Дар: одна запись = один Дар. description = литературное описание,
// system = система (пул/стоимость текстом, как в книге).
function parseWerewolfGiftMd(rawContent, slug) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rec = baseHead(content, slug);
  rec.group = field(content, 'Группа') || '';
  const lvl = parseInt(field(content, 'Уровень') || '', 10);
  rec.level = Number.isFinite(lvl) ? lvl : null;
  const ps = splitPowerBody(content);
  rec.description = ps.literary;
  rec.system = ps.system;
  return rec;
}

// Обряд: текстовые поля, без числовых уровней.
function parseWerewolfRiteMd(rawContent, slug) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rec = baseHead(content, slug);
  rec.type = field(content, 'Тип') || '';
  rec.description = introDescription(content).replace(/\*\*Система\.?\*\*[\s\S]*$/i, '').trim();
  const sys = content.match(/\*\*Система\.?\*\*\s*([\s\S]*?)\s*$/i);
  const clean = s => s ? s.replace(/\n-{3,}\s*$/, '').replace(/\s+/g, ' ').replace(/\s*-{3,}\s*$/, '').trim() : '';
  rec.system = clean(sys && sys[1]);
  if (!rec.description) {
    const ps = splitPowerBody(content);
    rec.description = ps.literary;
    if (!rec.system) rec.system = ps.system;
  }
  return rec;
}

// Сфера мага: формат Искусства без поля «Атрибут».
function parseMageSphereMd(rawContent, slug) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rec = baseHead(content, slug);
  rec.description = introDescription(content);
  rec.levels = splitLevels(content);
  return rec;
}

// Техника творения эффектов: обзорная карточка без уровней.
function parseMageTechniqueMd(rawContent, slug) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rec = baseHead(content, slug);
  rec.description = introDescription(content).replace(/\*\*Система\.?\*\*[\s\S]*$/i, '').trim();
  const sys = content.match(/\*\*Система\.?\*\*\s*([\s\S]*?)\s*$/i);
  const clean = s => s ? s.replace(/\n-{3,}\s*$/, '').replace(/\s+/g, ' ').replace(/\s*-{3,}\s*$/, '').trim() : '';
  rec.system = clean(sys && sys[1]);
  if (!rec.description) {
    const ps = splitPowerBody(content);
    rec.description = ps.literary;
    if (!rec.system) rec.system = ps.system;
  }
  return rec;
}

// Карта Таро мага (2026-10-13 — отдельная подвкладка «Таро»): тело как у
// техники (образ + игровое применение), плюс поля шапки Аркан / Значение /
// Перевёрнутая / Ассоциация. Поля читает и общий fields-контур _mdLibRoutes,
// здесь дублируются для прямых вызовов парсера (тесты).
function parseMageTarotMd(rawContent, slug) {
  const content = String(rawContent || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rec = parseMageTechniqueMd(content, slug);
  rec.arcana = field(content, 'Аркан') || '';
  rec.meaning = field(content, 'Значение') || '';
  rec.reversed = field(content, 'Перевёрнутая') || '';
  rec.association = field(content, 'Ассоциация') || '';
  return rec;
}

module.exports = {
  parseFairyArtMd, parseFairyRealmMd, parseFairyLevelHeading,
  parseWerewolfGiftMd, parseWerewolfRiteMd, parseMageSphereMd, parseMageTechniqueMd,
  parseMageTarotMd,
};
