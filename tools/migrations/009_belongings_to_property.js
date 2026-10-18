'use strict';
// Миграция belongings персонажей в раздел «Имущество» (спека char-property-link §12/ФТ6).
// Каждый файл <slug>/belongings/<файл> с буллетом `- [Подпись](belongings/<файл>) — Описание`
// в `## 🧳 Имущество` карточки становится предметом раздела:
//   название = подпись, описание сохраняется, картинка переезжает в property/img/,
//   владелец = персонаж (qty 1). Секция вырезается из карточки, папка belongings/
//   удаляется. Предмет с таким именем уже есть → дописываем владельца (без дублей).
// Категория новых предметов: 'misc' (Мелочи), иначе первая по order.
// Идемпотентна: нет секции и нет belongings/ → { changed: 0 }.

const fs = require('fs');
const path = require('path');
const { parseCharacter } = require('../../web/lib/parsers/character');
const { slugify } = require('../../web/lib/parsers/shared');
const P = require('../../web/lib/property');

const SECTION = '## 🧳 Имущество';
const BULLET_RE = /^\s*-\s+\[([^\]]*)\]\(belongings\/([^)]+)\)(?:\s*—\s*(.*))?$/;

function listDirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); }
  catch { return []; }
}

function pickMiscCategory() {
  let list = null;
  try {
    const raw = fs.readFileSync(P.CATEGORIES_FILE, 'utf-8').replace(/^﻿/, '');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) list = arr;
  } catch { /* нет файла — сидим на дефолтах ниже */ }
  if (!list) {
    list = P.DEFAULT_CATEGORIES();
    try {
      fs.mkdirSync(path.dirname(P.CATEGORIES_FILE), { recursive: true });
      fs.writeFileSync(P.CATEGORIES_FILE, JSON.stringify(list, null, 2) + '\n', 'utf8');
    } catch { /* best-effort */ }
  }
  return list.find(c => c.id === 'misc')
      || list.slice().sort((a, b) => (a.order || 0) - (b.order || 0))[0]
      || { id: 'misc', name: 'Мелочи' };
}

// Уникальное имя картинки в property/img: <itemslug>_mig_<NN>.<ext>.
function nextMigImageName(imgDir, itemSlug, ext) {
  let existing = [];
  try { existing = fs.readdirSync(imgDir); } catch { /* нет папки */ }
  let n = 1;
  let name = `${itemSlug}_mig_${String(n).padStart(2, '0')}.${ext}`;
  while (existing.includes(name) && n < 1000) {
    n++;
    name = `${itemSlug}_mig_${String(n).padStart(2, '0')}.${ext}`;
  }
  return name;
}

module.exports = {
  description: 'belongings персонажей → предметы раздела «Имущество» с владельцем-персонажем (char-property-link)',
  migrateFs({ cityDir, citySlug, log }) {
    let changed = 0;
    const charsRoot = path.join(cityDir, 'characters');
    if (!fs.existsSync(charsRoot)) return { changed };

    for (const lineage of listDirs(charsRoot)) {
      if (lineage.startsWith('_')) continue;
      for (const slug of listDirs(path.join(charsRoot, lineage))) {
        if (slug.startsWith('_')) continue;
        changed += migrateCharacter({ cityDir, citySlug, lineage, slug, log });
      }
    }
    return { changed };
  },
};

function migrateCharacter({ cityDir, citySlug, lineage, slug, log }) {
  const charDir = path.join(cityDir, 'characters', lineage, slug);
  const cardPath = path.join(charDir, `${slug}.md`);
  const belDir = path.join(charDir, 'belongings');
  let changed = 0;

  let card;
  try { card = fs.readFileSync(cardPath, 'utf-8').replace(/^﻿/, '').replace(/\r\n/g, '\n'); }
  catch { return 0; }
  if (!card.includes(SECTION) && !fs.existsSync(belDir)) return 0;

  const char = parseCharacter(card, slug, lineage);
  const ownerName = (char.name || slug).trim();
  const cat = pickMiscCategory();

  // Буллеты секции (только belongings-ссылки; чужие строки не трогаем).
  const moved = [];
  const lines = card.split('\n');
  const keep = [];
  let inSection = false;
  for (const line of lines) {
    if (line.trim() === SECTION) { inSection = true; continue; }
    if (inSection && /^##\s/.test(line)) inSection = false;
    if (inSection) {
      const m = line.match(BULLET_RE);
      if (m) {
        moved.push({ caption: m[1].trim(), file: m[2].trim(), description: (m[3] || '').trim() });
        continue;
      }
      if (line.trim() === '') continue; // пустые строки секции уходят вместе с ней
      keep.push(line);
      inSection = false; // чужой контент — секцию дальше не разбираем как belongings
      continue;
    }
    keep.push(line);
  }
  // Секция убирается всегда, когда дошли досюда (даже если буллетов нет, а папка есть).
  card = keep.join('\n').replace(/\n{3,}/g, '\n\n');
  try { fs.writeFileSync(cardPath, card, 'utf8'); } catch { return 0; }

  const propImgDir = path.join(cityDir, 'property', 'img');
  try { fs.mkdirSync(propImgDir, { recursive: true }); } catch { /* best-effort */ }

  for (const b of moved) {
    const caption = b.caption || 'Без названия (миграция)';
    const itemSlug = slugify(caption) || `mig_${slug}`;
    const srcFile = path.join(belDir, path.basename(b.file));
    let image = '';
    if (fs.existsSync(srcFile)) {
      const ext = (path.extname(srcFile).slice(1) || 'jpg').toLowerCase();
      image = nextMigImageName(propImgDir, itemSlug, ext);
      try {
        fs.renameSync(srcFile, path.join(propImgDir, image));
      } catch {
        try { fs.copyFileSync(srcFile, path.join(propImgDir, image)); } catch { image = ''; }
      }
    }

    // Предмет с таким именем уже есть → дописать владельца (идемпотентность).
    const itemFile = path.join(cityDir, 'property', 'items', `${itemSlug}.md`);
    let item = null;
    try {
      const raw = fs.readFileSync(itemFile, 'utf-8');
      item = P.parseItemMd(raw, itemSlug);
    } catch { /* нет — создаём */ }
    if (item) {
      const owners = Array.isArray(item.owners) ? item.owners : [];
      if (!owners.some(o => o.name === ownerName)) owners.push({ name: ownerName, qty: 1 });
      item.owners = owners;
      item.owner = '';
      item.quantity = P.ownersTotalQty(owners);
    } else {
      item = {
        slug: itemSlug, name: caption, category: cat.name,
        description: b.description, quantity: 1,
        owners: [{ name: ownerName, qty: 1 }], owner: '',
        price: '', image, stats: '',
      };
    }
    try {
      fs.mkdirSync(path.join(cityDir, 'property', 'items'), { recursive: true });
      fs.writeFileSync(itemFile, P.buildItemMd(item), 'utf8');
    } catch { continue; }
    changed++;
    log(`belongings→property: ${lineage}/${slug} «${caption}» → ${itemSlug} (владелец ${ownerName})`);
  }

  // Папка belongings/ больше не нужна (файлы либо переехали, либо их не было).
  try {
    const left = fs.readdirSync(belDir);
    if (!left.length || left.every(f => f === '.gitkeep')) {
      for (const f of left) { try { fs.rmSync(path.join(belDir, f), { recursive: true, force: true }); } catch {} }
      try { fs.rmdirSync(belDir); } catch {}
    }
  } catch { /* нет папки — ок */ }
  return changed;
}