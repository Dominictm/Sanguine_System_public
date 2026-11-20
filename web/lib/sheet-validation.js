'use strict';

function validateSheetStructure(raw, lineage, profile = {}) {
  const text = String(raw || '').trim();
  const titleError = profile.requiredTitle && !text.startsWith(profile.requiredTitle);
  const missing = (profile.requiredHeadings || []).filter(h => !text.toLocaleLowerCase().includes(h.toLocaleLowerCase()));
  const forbiddenHeadings = (profile.forbiddenHeadings || []).filter(re => re.test(text));
  const hunterForbidden = lineage === 'hunter'
    && /^#{1,4}\s+.*(?:дисциплин|поколени|запас крови)|^\|\s*\*\*?(?:Дисциплина|Поколение|Запас крови)/im.test(text);
  const errors = [
    ...missing.map(h => `нет обязательного раздела ${h}`),
    ...(titleError ? [`неверный заголовок листа, ожидается ${profile.requiredTitle}`] : []),
    ...(forbiddenHeadings.length || hunterForbidden ? ['содержит разделы другой линейки'] : []),
  ];
  return { ok: Boolean(text) && errors.length === 0, errors };
}

// Сумма точек и число точечных строк раздела (heading — текущий «##» или последний «###»).
function sheetSectionDots(md, sectionRe) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let h2 = '', h3 = '', total = 0, rows = 0;
  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) { h2 = h2Match[1]; h3 = ''; continue; }
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) { h3 = h3Match[1]; continue; }
    if (!sectionRe.test(`${h3} ${h2}`) || !/^\s*\|/.test(line)) continue;
    const cells = line.split('|').map(cell => cell.trim()).filter(Boolean);
    if (cells.length < 2 || cells.every(cell => /^:?-{2,}:?$/.test(cell))) continue;
    const name = cells[0].replace(/\*/g, '').trim();
    if (!name || /^(?:способност|характеристик|атрибут|дисциплин|факт биографии|backgrounds|предыстор|добродетел|название|поле)/i.test(name)) continue;
    const dots = cells.find(cell => /^[●○]+$/.test(cell));
    if (!dots) continue;
    total += (dots.match(/●/g) || []).length;
    rows++;
  }
  return rows ? { total, rows } : null;
}

function sheetSectionDotTotal(md, sectionRe) {
  return sheetSectionDots(md, sectionRe)?.total ?? null;
}

// Предупреждения о НЕДОБОРЕ пулов создания (не блокируют сохранение листа): атрибуты и
// добродетели начинают с 1 точки на строку, перебор законно даётся свободными очками.
function validateSheetPools(md, pools = {}) {
  const sum = a => (Array.isArray(a) ? a.reduce((s, n) => s + n, 0) : null);
  const checks = [
    ['Атрибуты', /атрибут|характеристик/i, sum(pools.attrs), 1],
    ['Способности', /способност/i, sum(pools.abilities), 0],
    ['Дисциплины', /дисциплин/i, pools.disciplines, 0],
    ['Дары', /дар[ыа]/i, pools.gifts, 0],
    ['Сферы', /сфер[ыа]/i, pools.spheres, 0],
    ['Искусства', /искусств|arts/i, pools.arts, 0],
    ['Королевства', /королевств|realms/i, pools.realms, 0],
    ['Факты биографии', /факт.*биограф|детал.*биограф|backgrounds|предыстор/i, pools.backgrounds, 0],
    ['Добродетели', /добродетел/i, pools.virtues, 1],
  ];
  const errors = [];
  for (const [label, heading, expected, basePerRow] of checks) {
    if (!Number.isFinite(expected)) continue;
    const found = sheetSectionDots(md, heading);
    if (!found) { errors.push(`нет точечных строк в пуле «${label}» (ожидалось ${expected})`); continue; }
    const spent = found.total - found.rows * basePerRow;
    if (spent < expected) errors.push(`пул «${label}» недораспределён: ${spent}/${expected} точек`);
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { validateSheetStructure, validateSheetPools, sheetSectionDotTotal };
