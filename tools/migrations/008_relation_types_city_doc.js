'use strict';
// Виды связей как документ города — техспека
// docs/design/2026-08-26-relation-types-city-document-techspec.md, §7.
//
// До этой миграции вид связи описывали четыре независимых хардкода (глобальный
// system/library/relation-types.json, categorizeRel(), REL_LABELS/REL_COLORS графа,
// REL_AUTO_PAIRS в двух копиях). Они сводятся в один документ на город,
// cities/<город>/rules/relation_types.md — файл, которого раньше не существовало,
// поэтому контракт структурный (migrateFs), а не контентный.
//
// Состав документа:
//   «Постоянные» — 11 канонических из сида + любые записи, которые пользователь
//                  успел завести в глобальном relation-types.json (custom: true):
//                  они копируются во ВСЕ города, потеря данных дороже лишней строки;
//   «Авторские»  — четыре легаси-категории categorizeRel() без библиотечной пары
//                  (Преданность, Романтика, Подозрение, Знакомый) + каждое непустое
//                  `[Тип]` с карточек города, не совпавшее ни с одним постоянным именем.
//                  Легаси-категории идут именно сюда, а не в «Постоянные»: постоянный
//                  набор должен остаться ровно из 11, но выбросить их нельзя — на живых
//                  данных это десятки связей, которые иначе схлопнулись бы в скрытый neutral.
//
// Идемпотентна: город, у которого rules/relation_types.md уже есть, пропускается
// целиком → { changed: 0 } на повторном прогоне. Существующие файлы не переписываются.

const fs = require('fs'), path = require('path');
const {
  buildRelationTypesDoc, seedPermanentEntries, legacyAuthoredEntries, parseCharacter, parseCityMd, slugify,
} = require('../../web/lib/parsers');
const { randomRelColor, SEED_FILE } = require('../../web/lib/relation-types');

const DOC_REL = path.join('rules', 'relation_types.md');
const LINEAGES = ['vampires', 'fairies', 'mortals', 'werewolves', 'mages', 'hunters'];

function subdirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); }
  catch { return []; }
}

// Записи, которые пользователь успел добавить в глобальный сид из веба (custom: true).
// На момент внедрения таких нет — страховка на случай, если появятся до апдейта.
function customSeedEntries() {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')); } catch { return []; }
  return list.filter(t => t && t.custom).map(t => ({
    slug: t.slug || slugify(t.name), name: t.name, color: t.color || randomRelColor(), pair: '', keywords: [],
  })).filter(t => t.slug && t.name);
}

// Все непустые `[Тип]` с карточек города — тот же скан, который до сих пор делала на
// лету _authoredDescriptions() в relations-manage.js, только результат теперь сохраняется.
function cardRelTypes(cityDir) {
  const charsDir = path.join(cityDir, 'characters');
  const out = [];
  for (const lineage of LINEAGES) {
    const lineageDir = path.join(charsDir, lineage);
    for (const slug of subdirs(lineageDir)) {
      const card = path.join(lineageDir, slug, `${slug}.md`);
      if (!fs.existsSync(card)) continue;
      try {
        for (const r of parseCharacter(fs.readFileSync(card, 'utf8'), slug, lineage).relationships || []) {
          const t = String(r.relType || '').trim();
          if (t) out.push(t);
        }
      } catch { /* нечитаемая карточка не должна ронять миграцию города целиком */ }
    }
  }
  return out;
}

// Заголовок документа — то же имя города, что подставляет cityScaffold() новому
// городу (display без года), чтобы мигрированный и свежесозданный файлы не отличались.
function cityDisplay(cityDir, citySlug) {
  try { return parseCityMd(fs.readFileSync(path.join(cityDir, 'city.md'), 'utf8')).display || citySlug; }
  catch { return citySlug; }
}

module.exports = {
  description: 'виды связей → документ города cities/<город>/rules/relation_types.md (2026-08-26, §7)',
  migrateFs({ cityDir, citySlug, log }) {
    // Раннер обходит ВСЕ папки в cities/ — в том числе служебные (audio/, _restore_tmp/).
    // Признак настоящего города — city.md; без него документ создавать нечего.
    if (!fs.existsSync(path.join(cityDir, 'city.md'))) return { changed: 0 };
    const docPath = path.join(cityDir, DOC_REL);
    if (fs.existsSync(docPath)) return { changed: 0 };

    const permanent = [...seedPermanentEntries(), ...customSeedEntries()];
    const takenNames = new Set(permanent.map(e => e.name.toLowerCase()));
    const takenSlugs = new Set(permanent.map(e => e.slug));

    const authored = [];
    const push = e => {
      const key = e.name.toLowerCase();
      if (takenNames.has(key) || takenSlugs.has(e.slug)) return;
      takenNames.add(key); takenSlugs.add(e.slug);
      authored.push(e);
    };
    for (const e of legacyAuthoredEntries()) push(e);
    for (const name of cardRelTypes(cityDir)) {
      const slug = slugify(name);
      if (slug) push({ slug, name, color: randomRelColor(), pair: '', keywords: [] });
    }

    fs.mkdirSync(path.dirname(docPath), { recursive: true });
    fs.writeFileSync(docPath, buildRelationTypesDoc({
      display: cityDisplay(cityDir, citySlug), permanent, authored,
    }), 'utf8');
    log(`${DOC_REL.replace(/\\/g, '/')} создан: ${permanent.length} постоянных, ${authored.length} авторских`);
    return { changed: 1 };
  },
};
