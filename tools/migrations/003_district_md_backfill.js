'use strict';
// Бэкофилл district.md — план 2026-08-02-city-creation-restructure-spec.md §5.1.
// Каждая папка района (locations/<район>/, содержащая хотя бы одну вложенную
// папку-локацию со своим <slug>.md) должна иметь рядом district.md с метаданными
// района: папка района могла появиться в обход штатного ensureDistrictMd()
// (web/lib/districts.js) — руками, старым CLI или переносом, — и тогда района не
// видно в GET /districts. Там, где district.md ещё нет — создаём с плейсхолдерами ⚠️
// (Тип района, Влияние — Секта/Клан, Описание); Название берём из имени папки
// района (человекочитаемо восстановить точное историческое название по одному
// только слагу нельзя — тоже плейсхолдер формата «⚠️ <slug>», чтобы не выдумывать
// факт, см. CLAUDE.md «Канонные факты»).
//
// Тот же buildDistrictMd, что и POST /api/cities/:slug/districts и tools/new_district.js
// (web/lib/parsers/district.js) — единый источник шаблона.
//
// Идемпотентна: рayон с уже существующим district.md пропускается → { changed: 0 }
// на повторном прогоне. Служебные папки locations/ (_deleted, drugie) пропускаются
// целиком — см. isServiceDistrictFolder (web/lib/districts.js).

const fs = require('fs'), path = require('path');
const { buildDistrictMd, DISTRICT_FILENAME } = require('../../web/lib/parsers/district');
// Служебные папки locations/ (корзина «_deleted», отстойник «drugie») районами не являются —
// правило берём из web/lib/districts.js, а не повторяем здесь: своя копия и разошлась бы.
const { isServiceDistrictFolder } = require('../../web/lib/districts');

function subdirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); }
  catch { return []; }
}
// district.md — метаданные самого района, не карточка локации — исключаем его при
// проверке «есть ли здесь СВОЙ .md напрямую» (иначе уже мигрированный/бэкофилленный
// район на повторном прогоне перестаёт опознаваться как rayon-папка).
function hasDirectMd(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .some(e => e.isFile() && e.name.endsWith('.md') && e.name !== DISTRICT_FILENAME);
}
// Район = папка НЕ содержащая свой .md напрямую (значит внутри — вложенные
// папки-локации со своими <slug>.md), т.е. приведена к форме
// «Город → Район → Локация». `district_NN` — обычное имя папки района, а не
// отдельный уровень пути: миграция 002, убиравшая этот «уровень», выведена из
// эксплуатации 2026-11-17 (см. tools/migrations/README.md).
function isRayonDir(dir) {
  return subdirs(dir).length > 0 && !hasDirectMd(dir);
}

module.exports = {
  description: 'бэкофилл district.md с плейсхолдерами для папок районов, где его ещё нет (2026-08-02, §5.1)',
  migrateFs({ cityDir, log }) {
    const locRoot = path.join(cityDir, 'locations');
    let changed = 0;
    if (!fs.existsSync(locRoot)) return { changed };

    for (const rayonSlug of subdirs(locRoot)) {
      const rayonDir = path.join(locRoot, rayonSlug);
      // Служебная папка — ПЕРВОЙ проверкой: «_deleted» и «drugie» формально выглядят как
      // район (внутри папки-локации, своего .md нет), и миграция сеяла им district.md —
      // плейсхолдер в корзине и в отстойнике, который в «Районах» всё равно не показывается.
      if (isServiceDistrictFolder(rayonSlug)) continue;
      if (!isRayonDir(rayonDir)) continue; // карточка локации напрямую / пустой район — не наш случай
      const districtPath = path.join(rayonDir, DISTRICT_FILENAME);
      if (fs.existsSync(districtPath)) continue;

      const md = buildDistrictMd({ name: `⚠️ ${rayonSlug}` });
      fs.writeFileSync(districtPath, md, 'utf8');
      changed++;
      log(`district.md создан: locations/${rayonSlug}/${DISTRICT_FILENAME}`);
    }
    return { changed };
  },
};
