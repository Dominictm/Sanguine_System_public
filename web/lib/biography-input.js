'use strict';

function formatBiographyRelationships(relationships) {
  return (Array.isArray(relationships) ? relationships : [])
    .filter(r => r?.target && (String(r.description || '').trim() || (r.relType && !/^нейтральн/i.test(r.relType))))
    .map(r => `${r.target}${r.relType ? ` [${r.relType}]` : ''}${r.description ? ` — ${r.description}` : ''}`)
    .join('\n');
}

// Пол — идентичность, а не биографический факт: одной строкой «Пол» и ещё одним фактом
// историю не составить (spec biography-generation §7).
function hasSufficientBiographyInput({ infoLines = '', relLines = '', biographyNotes = '', draft = '' } = {}) {
  const factCount = String(infoLines).split('\n').filter(l => l.trim() && !/^Пол:/.test(l)).length;
  return Boolean(String(biographyNotes).trim() || String(draft).trim() || String(relLines).trim() || factCount >= 2);
}

module.exports = { formatBiographyRelationships, hasSufficientBiographyInput };
