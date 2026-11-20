// Loader for archetypes library (single file, no subcategories)
// Mirrors patterns from merits-loader.js

const fs = require('fs');
const path = require('path');

let archetypesCache = null;

function loadArchetypes() {
  if (archetypesCache) {
    return archetypesCache;
  }

  try {
    const filePath = path.join(__dirname, '../../system/library/archetypes/archetypes.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    archetypesCache = Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('Failed to load archetypes/archetypes.json:', e.message);
    archetypesCache = [];
  }

  return archetypesCache;
}

function getArchetypes() {
  return loadArchetypes();
}

function getAllArchetypes() {
  return { archetypes: loadArchetypes() };
}

// Сбросить кэш после записи в JSON-файл (создание/правка/удаление авторского
// архетипа) — без этого следующий getArchetypes() молча вернёт старый массив
// из памяти до перезапуска сервера.
function invalidateArchetypes() {
  archetypesCache = null;
}

module.exports = { getArchetypes, getAllArchetypes, invalidateArchetypes };
