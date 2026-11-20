'use strict';
// city.md build/parse + скелет файлов нового города.
// Extracted from parsers.js during the 2026-07-12 decomposition.

const { slugify, escapeTableCell, unescapeTableCell, sanitizeInlineText } = require('./shared');
const { buildRelationTypesDoc, seedPermanentEntries } = require('./relation-types');

// ── city.md ──────────────────────────────────────────────────────────────────
// Single source of truth for the city.md section layout, shared by tools/new_city.js,
// POST/PUT /api/cities and the edit form. Order = order rendered in the file.
const CITY_SECTIONS = [
  ['factions',       'Фракции'],
  ['factionsMortal', 'Фракции смертных'],
  ['factionsState',  'Государственные фракции'],
  ['political',  'Политический ландшафт'],
  ['districts',  'Районы'],
  ['landmarks',  'Значимые места'],
  ['locations',  'Ключевые локации'],
  ['hunting',    'Охотничьи угодья'],
  ['edicts',     'Законы домена'],
  ['mortals',    'Смертные институции'],
  ['calendar',   'Календарь города'],
  ['tech',       'Технологии и Маскарад'],
  ['limits',     'Ограничения генерации'],
  ['naming',     'Именник и фактура'],
  ['leitmotif',  'Лейтмотивы и атмосфера'],
  ['specifics',  'Специфика ответа'],
  ['avoid',      'Чего избегать'],
  ['sources',    'Источники'],
];

// Multi-line textarea → markdown bullet list; empty → placeholder.
function _citySection(txt) {
  const lines = String(txt == null ? '' : txt).split('\n').map(l => l.trim()).filter(Boolean);
  return lines.length ? lines.map(l => l.startsWith('-') ? l : `- ${l}`).join('\n') : '- …';
}

const CITY_DEFAULT_DESCRIPTION = 'Опиши здесь свой домен — то, с чем сверяется Рассказчик перед сценой (см. CLAUDE.md → «Активный город»).';

/**
 * Собирает содержимое city.md из полей формы.
 * @param {{display?, year?, description?, political?, factions?, locations?, leitmotif?, specifics?, avoid?, sources?}} fields
 * @returns {string} готовый Markdown city.md
 */
function buildCityMd(fields = {}) {
  const display     = String(fields.display || '').trim() || 'Город';
  const year        = String(fields.year || '').trim() || '20XX';
  const description = String(fields.description || '').trim() || CITY_DEFAULT_DESCRIPTION;
  const body = CITY_SECTIONS.map(([key, heading]) => `## ${heading}\n${_citySection(fields[key])}`).join('\n\n');
  return `# ${display}, ${year} — сеттинг города

${description}

${body}
`;
}

/**
 * Разбирает city.md обратно в структуру для формы редактирования.
 * @param {string} raw — содержимое city.md
 * @returns {{display: string, year: string, description: string, sections: Object<string,string>}}
 *   sections — по ключам CITY_SECTIONS (political/factions/locations/…), каждый — «плоский» текст без буллетов
 */
function parseCityMd(raw) {
  const text = String(raw == null ? '' : raw).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  let display = '', year = '';
  const hm = text.match(/^#\s+(.+?)\s*$/m);
  if (hm) {
    const h1 = hm[1].replace(/\s*—\s*сеттинг города\s*$/i, '').trim();
    const m2 = h1.match(/^(.*?),\s*([^,]+?)\s*$/);
    if (m2) { display = m2[1].trim(); year = m2[2].trim(); }
    else display = h1;
  }
  // Текст между заголовком H1 и первой секцией "##" — общее описание/сеттинг города.
  let description = '';
  if (hm) {
    const afterH1 = text.slice(hm.index + hm[0].length);
    const firstHeadingIdx = afterH1.search(/^##\s+/m);
    const introRaw = firstHeadingIdx === -1 ? afterH1 : afterH1.slice(0, firstHeadingIdx);
    description = introRaw.split('\n').map(l => l.replace(/^>\s?/, '')).join('\n').trim();
  }
  const headingToKey = new Map(CITY_SECTIONS.map(([k, h]) => [h.toLowerCase(), k]));
  const sections = {};
  for (const part of text.split(/^##\s+/m).slice(1)) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim().toLowerCase();
    const key = headingToKey.get(heading);
    if (!key) continue;
    const bodyTxt = nl === -1 ? '' : part.slice(nl + 1);
    sections[key] = bodyTxt.split('\n')
      // Горизонтальная линейка «---» между секциями — разметка, а не пункт списка.
      // Отбрасываем ДО снятия буллета: иначе `replace(/^\s*-\s?/)` съедает первый дефис
      // и оставляет «--» отдельной строкой секции. В рукописных city.md (Париж и т.п.)
      // такие разделители стоят после каждой секции, и «--» протекало в данные —
      // в редакторе «Фракции» оно показывалось фиктивной фракцией, а обратная запись
      // (_replaceCitySection, синк фракций) закрепляла его в файле как «- --».
      .filter(l => !/^\s*-{3,}\s*$/.test(l))
      .map(l => l.replace(/^\s*-\s?/, '').trim())
      .filter(l => l && l !== '…').join('\n');
  }
  return { display, year, description, sections };
}

// Полный каркас нового города — ЕДИНЫЙ источник для POST /api/cities и tools/new_city.js.
// Чистая функция: только строит данные (содержимое файлов + список пустых папок под
// .gitkeep). Сам ввод-вывод делают вызывающие (атомарная запись в сервере, синхронная
// в CLI). До выноса оба пути хардкодили эти шаблоны по отдельности и успели разойтись
// (в visitors.md) — теперь источник один. Принимает те же поля, что buildCityMd, плюс
// districts (CSV-строка или массив).
/**
 * @param {{display?, year?, districts?: string|string[], ...}} fields — те же поля, что buildCityMd
 * @returns {{files: Object<string,string>, keepDirs: string[]}}
 *   files — относительные пути → содержимое (city.md, archive/*.md, стартовая хроника);
 *   keepDirs — пустые папки под .gitkeep (character-линейки, chronicles/, districts/…)
 */
function cityScaffold(fields = {}) {
  const display   = String(fields.display || '').trim() || 'Город';
  const year      = String(fields.year || '').trim() || '20XX';
  const districts = (Array.isArray(fields.districts)
    ? fields.districts
    : String(fields.districts || '').split(','))
    .map(d => String(d).trim()).filter(Boolean);

  const files = {
    // districts приходит CSV-строкой («Монмартр, Бастилия») — она нужна такой для
    // создания папок ниже, но в секцию «## Районы» так попадала ОДНИМ буллетом
    // «- Монмартр, Бастилия». Для текста секции передаём уже разобранный список
    // построчно — по буллету на район (§A6.2).
    'city.md': buildCityMd({ ...fields, districts: districts.join('\n') }),
    'archive/events.md':
`# 📖 Хроника «${display}» — События

> 🔗 Все персонажи — [characters_index.md](characters_index.md)
> 🔗 Протокол записей — [chronicle.md](../../../system/rules/chronicle.md)

---

## 🌍 Состояние мира

> Обновляется после каждой сессии.
> Последнее обновление: **—**.

---

## 📋 Сводная хроника событий

> Агрегат из \`chronicles/<хроника>/events.md\`. Индекс генерируется \`tools/build_city_events.js\` — вручную не править.

<!-- AUTO:events-index -->
<!-- /AUTO:events-index -->
`,
    'archive/political_state.md':
`# Карта фракций — ${display}, ${year}

> Шаблон. Кто контролирует домен, иерархия, ключевые NPC, конфликты.

| Должность | Персонаж | Клан | Примечание |
|---|---|---|---|
|  |  |  |  |

`,
    'archive/characters_index.md':
`# Персонажи — ${display}

> Сводник. Добавляется при создании карточек (по \`system/rules/npcs_city.md\`).
`,
    'archive/visitors.md':
`# Гости из других городов — ${display}

> Персонажи с \`Родной город\` ≠ ${display}, присутствующие здесь. Только ссылки —
> карточка-источник живёт в родном городе (один источник истины).

| Персонаж | Родной город | Появление |
|---|---|---|
|  |  |  |
`,
  };

  // Виды связей — документ города (техспека 2026-08-26): 11 постоянных из сида
  // system/library/relation-types.json и ПУСТОЙ раздел «Авторские» (заголовок +
  // шапка таблицы). Авторские виды копятся сами, когда Рассказчик пишет в карточке
  // свой `[Тип]`, — переносить их из другого города при создании нечего.
  files['rules/relation_types.md'] = buildRelationTypesDoc({
    display, permanent: seedPermanentEntries(), authored: [],
  });

  files['chronicles/sluchaynye_sobytiya/chronicle.md'] =
`# 📂 Случайные события

| **Статус:** | 🟡 Активна |
| **Скрыта** | да |

> Хроника для случайных/фоновых событий города. Не отображается в индексе хроник.
`;
  files['chronicles/sluchaynye_sobytiya/events.md'] =
`# Случайные события — События

`;

  const keepDirs = [
    ...['vampires', 'fairies', 'mortals', 'werewolves', 'mages', 'hunters'].map(l => `characters/${l}`),
    'chronicles',
    'chronicles/sluchaynye_sobytiya/modules',
    'rules',
  ];
  if (districts.length) {
    // Плоско — locations/<rayon-slug>/, БЕЗ обёртки district_NN/ (§8 плана отменил
    // «Округ» как уровень адресации; §A4 — эта функция всё ещё создавала фантомные
    // обёртки, из-за которых POST /api/cities с районами давал ДВЕ папки на район:
    // пустую district_NN/<slug>/.gitkeep рядом с настоящей <slug>/district.md,
    // которую следом создаёт POST /api/cities/:slug/districts).
    // Дедуп по итоговому слагу: два района с одинаковым именем (или дающие один слаг)
    // схлопываются в одну папку.
    const seen = new Set();
    districts.forEach((d, i) => {
      const dslug = slugify(d) || `rayon_${String(i + 1).padStart(2, '0')}`;
      if (seen.has(dslug)) return;
      seen.add(dslug);
      keepDirs.push(`locations/${dslug}`);
    });
    if (!seen.size) keepDirs.push('locations');
  } else {
    keepDirs.push('locations');
  }

  return { files, keepDirs };
}

module.exports = {
  // citySectionBody — та же нормализация «строки формы → тело секции», что применяет
  // buildCityMd. Экспортируется для точечной записи (lib/city_md_writer.js, §A1):
  // без неё запись распарсенного значения обратно теряла бы буллеты, и round-trip
  // «прочитал → записал то же самое» менял файл.
  citySectionBody: _citySection,
  CITY_SECTIONS, CITY_DEFAULT_DESCRIPTION, buildCityMd, parseCityMd,
  cityScaffold,
};
