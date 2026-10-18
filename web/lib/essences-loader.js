// Loader for Avatar essences library (single file, no subcategories)
// Mirrors patterns from archetypes-loader.js (spec doc/design/2026-10-15-library-mage-hunter-gaps-spec.md §4)

const fs = require('fs');
const path = require('path');

let essencesCache = null;

function loadEssences() {
  if (essencesCache) {
    return essencesCache;
  }

  try {
    const filePath = path.join(__dirname, '../../system/library/essences/essences.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    essencesCache = Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('Failed to load essences/essences.json:', e.message);
    essencesCache = [];
  }

  return essencesCache;
}

function getEssences() {
  return loadEssences();
}

function getAllEssences() {
  return { essences: loadEssences() };
}

// Сбросить кэш после записи в JSON-файл (создание/правка/удаление авторской
// сущности) — без этого следующий getEssences() молча вернёт старый массив
// из памяти до перезапуска сервера.
function invalidateEssences() {
  essencesCache = null;
}

module.exports = { getEssences, getAllEssences, invalidateEssences };
