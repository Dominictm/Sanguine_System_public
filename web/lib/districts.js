'use strict';
// Районы города на диске — общий код для routes/cities.js (CRUD районов) и
// routes/locations.js (создание локации в новом районе, Б12). Файл-карточка района —
// cities/<city>/locations/<rayon-slug>/district.md (шаблон — lib/parsers/district.js).

const path = require('path');
const fs   = require('fs').promises;
const { cityDir, locsDir, writeFileAtomic } = require('./db');
const { slugify, buildDistrictMd, parseDistrictMd, DISTRICT_FILENAME } = require('./parsers');
const { replaceCitySectionBullets } = require('./city_md_writer');

// Служебные папки locations/, которые физически могут содержать district.md
// (или сами по себе — директории), но районами не являются: `_deleted` —
// корзина мягкого удаления (db.js/cities.js/locations.js уже пропускают её
// везде при обходе), `drugie` (slugify('Другие')) — служебный отстойник для
// локаций без явной привязки (routes/locations.js и modules/fill.js кладут их
// в DEFAULT_DISTRICT_SLUG), у него тоже может завестись district.md
// (например, если через него когда-то физически перемещали локацию), но в
// списке «Районы» ему делать нечего — это не редактируемая сущность.
// Литерал 'Другие' — легаси-папка до миграции 010 (слияние в drugie, Б16).
const DEFAULT_DISTRICT_SLUG = slugify('Другие');

function isServiceDistrictFolder(name) {
  return !name || name.startsWith('_') || name === DEFAULT_DISTRICT_SLUG || name === 'Другие';
}

// Список районов города напрямую с диска: [{slug, name, type, sect, clan, description}].
async function listDistricts(slug) {
  const root = locsDir(slug);
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { entries = []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (isServiceDistrictFolder(e.name)) continue;
    const districtFile = path.join(root, e.name, DISTRICT_FILENAME);
    const raw = await fs.readFile(districtFile, 'utf-8').catch(() => null);
    if (raw === null) continue;
    const { name, type, sect, clan, description } = parseDistrictMd(raw);
    out.push({ slug: e.name, name: name || e.name, type, sect, clan, description });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return out;
}

// Секция «## Районы» в city.md — ОДНОСТОРОННЕЕ зеркало district.md-сущностей (§A3.2,
// решение ОВ-2: district.md остаётся единственным источником истины, дублировать
// тип/секту/клан в текст секции не нужно — они уже там). Перестраивается целиком при
// любой мутации района: по буллету на имя, в том же порядке, что отдаёт GET /districts.
// replaceCitySectionBullets (не upsert!) — та же семантика, что у уже принятого
// _syncCityFactionsList (routes/archive.js, §11): если секции «## Районы» в файле нет
// вообще (рукописный city.md без нужной секции), синк молча пропускается с warning,
// новую секцию сюрпризом не создаём. Non-blocking — район уже сохранён к моменту
// вызова, сбой записи city.md его не откатывает. Возвращает текст warning или null.
async function syncCityDistrictsList(slug) {
  try {
    const file = path.join(cityDir(slug), 'city.md');
    const raw = await fs.readFile(file, 'utf-8').catch(() => null);
    if (raw === null) return null;
    const names = (await listDistricts(slug)).map(d => d.name);
    const updated = replaceCitySectionBullets(raw, 'Районы', names);
    if (updated === null) return 'Район сохранён, но в city.md не найдена секция «Районы» — синк пропущен';
    if (updated === raw) return null; // уже актуально
    await writeFileAtomic(file, updated, 'utf-8');
    return null;
  } catch (e) {
    return `Район сохранён, но не удалось синхронизировать список «Районы» в описании города: ${e.message}`;
  }
}

// Б12: папка района, заведённая мимо POST …/districts (создание локации с новым
// названием района), получает district.md сразу — иначе район не виден в
// GET /districts до перезапуска сервера (миграция 003_district_md_backfill).
// Уже существующий district.md не трогается (флаг 'wx'). Возвращает
// { created: boolean, warning: string|null }.
async function ensureDistrictMd(slug, folder, displayName) {
  if (isServiceDistrictFolder(folder)) return { created: false, warning: null };
  const file = path.join(locsDir(slug), folder, DISTRICT_FILENAME);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buildDistrictMd({ name: String(displayName || '').trim() || folder }), { encoding: 'utf-8', flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') return { created: false, warning: null };
    throw e;
  }
  return { created: true, warning: await syncCityDistrictsList(slug) };
}

module.exports = { DEFAULT_DISTRICT_SLUG, isServiceDistrictFolder, listDistricts, syncCityDistrictsList, ensureDistrictMd };
