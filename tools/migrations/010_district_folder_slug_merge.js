'use strict';
// Слияние папок-дублей районов (doc/bagReport.md Б16). Старый POST /api/locations без
// района клал локацию в кириллическую папку `Другие/`, а перенос/открепление (PUT
// /district) — в `slugify(...)` = `drugie/`; ручные правки давали то же для `Ценр/` и
// `tsenr/`. GET /districts показывал оба района, а локация попадала только в slug-папку.
//
// Правило: папка района, имя которой не совпадает со slugify(имя), сливается в папку
// slugify(имя). Переносятся все вложенные записи, кроме district.md; при совпадении
// имени записи в обеих папках запись остаётся на месте (данные не теряются), папка-
// источник тогда не удаляется. district.md:
//   - в slug-папке его нет — переносится из источника;
//   - есть в обеих — остаётся тот, где больше заполненных полей (при равенстве — slug-
//     папки); если у оставшегося название — шаблон бэкфилла 003 («⚠️ <slug>»), оно
//     заменяется именем папки-источника: это и есть исходное человекочитаемое название.
// Входящие ссылки на перенесённые локации правятся тем же updateMdLinks, что и PUT
// /district. Идемпотентна: после слияния папок с не-slug именами не остаётся (кроме
// конфликтных — по ним повторный прогон ничего не переносит → { changed: 0 }).

const fs = require('fs'), path = require('path');
const { slugify } = require('../../web/lib/parsers');
const { parseDistrictMd, DISTRICT_FILENAME } = require('../../web/lib/parsers/district');
const { updateMdLinks } = require('../../web/lib/md_links');

function entries(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

function filledCount(raw) {
  const d = parseDistrictMd(raw);
  return ['type', 'sect', 'clan', 'description'].filter(k => d[k]).length;
}

// Шаблонное название бэкфилла 003: «# 🏘️ ⚠️ <slug>».
function isBackfillName(raw, slug) {
  const m = String(raw).replace(/^﻿/, '').match(/^#\s+(.*)$/m);
  if (!m) return true;
  const title = m[1].replace(/^🏘️\s*/u, '').trim();
  return title === `⚠️ ${slug}` || title === slug || !title;
}

function setDistrictName(raw, name) {
  return /^﻿?#\s+.*$/m.test(raw)
    ? raw.replace(/^(﻿?)#\s+.*$/m, `$1# 🏘️ ${name}`)
    : `# 🏘️ ${name}\n\n${raw}`;
}

function sameDir(a, b) {
  try {
    const sa = fs.statSync(a), sb = fs.statSync(b);
    return sa.ino === sb.ino && sa.dev === sb.dev && sa.ino !== 0;
  } catch { return false; }
}

module.exports = {
  description: 'слияние папок-дублей районов (Другие → drugie, Ценр → tsenr) в папку slugify(имя) (Б16)',
  migrateFs({ cityDir, log }) {
    const locRoot = path.join(cityDir, 'locations');
    let changed = 0;
    const renameMap = [];

    for (const e of entries(locRoot)) {
      if (!e.isDirectory() || e.name.startsWith('_')) continue;
      const name = e.name;
      const slug = slugify(name);
      if (!slug || slug === name) continue;

      const srcDir = path.join(locRoot, name);
      const dstDir = path.join(locRoot, slug);

      // Только регистр отличается, а ФС регистронезависимая (Windows) — это одна и та
      // же папка: переименование через временное имя.
      if (sameDir(srcDir, dstDir)) {
        const tmp = path.join(locRoot, `${slug}.__case_tmp`);
        fs.renameSync(srcDir, tmp);
        fs.renameSync(tmp, dstDir);
        for (const child of entries(dstDir)) {
          if (child.isDirectory()) renameMap.push({ oldRel: `${name}/${child.name}`, newRel: `${slug}/${child.name}` });
        }
        changed++;
        log(`папка района переименована: locations/${name} → locations/${slug}`);
        continue;
      }

      fs.mkdirSync(dstDir, { recursive: true });
      let conflicts = 0;

      for (const child of entries(srcDir)) {
        if (child.name === DISTRICT_FILENAME) continue;
        const from = path.join(srcDir, child.name);
        const to   = path.join(dstDir, child.name);
        if (fs.existsSync(to)) {
          conflicts++;
          log(`конфликт: locations/${slug}/${child.name} уже есть — locations/${name}/${child.name} оставлена на месте`);
          continue;
        }
        fs.renameSync(from, to);
        if (child.isDirectory()) renameMap.push({ oldRel: `${name}/${child.name}`, newRel: `${slug}/${child.name}` });
        changed++;
        log(`перенесено: locations/${name}/${child.name} → locations/${slug}/${child.name}`);
      }

      const srcMd = path.join(srcDir, DISTRICT_FILENAME);
      const dstMd = path.join(dstDir, DISTRICT_FILENAME);
      const srcRaw = fs.existsSync(srcMd) ? fs.readFileSync(srcMd, 'utf8') : null;
      if (srcRaw !== null && !conflicts) {
        const dstRaw = fs.existsSync(dstMd) ? fs.readFileSync(dstMd, 'utf8') : null;
        let result = dstRaw === null || filledCount(srcRaw) > filledCount(dstRaw) ? srcRaw : dstRaw;
        // Шаблон 003 у источника — «⚠️ Ценр», у slug-папки — «⚠️ tsenr»: оба шаблонные,
        // а имя папки-источника и есть исходное название района.
        if (isBackfillName(result, slug) || isBackfillName(result, name)) result = setDistrictName(result, name);
        if (result !== dstRaw) fs.writeFileSync(dstMd, result, 'utf8');
        fs.unlinkSync(srcMd);
        changed++;
        log(`district.md объединён: locations/${name} → locations/${slug}`);
      }

      if (!conflicts && !entries(srcDir).length) {
        fs.rmdirSync(srcDir);
        log(`удалена пустая папка locations/${name}`);
      }
    }

    if (renameMap.length) {
      try { updateMdLinks(cityDir, renameMap, { log }); }
      catch (err) { log(`ссылки на перенесённые локации обновить не удалось: ${err.message}`); }
    }
    return { changed };
  },
};
