// Loader for specializations library (single file, no subcategories)
// Mirrors patterns from archetypes-loader.js

const fs = require('fs');
const path = require('path');

let specializationsCache = null;

function loadSpecializations() {
  if (specializationsCache) {
    return specializationsCache;
  }

  try {
    const filePath = path.join(__dirname, '../../system/library/specializations/specializations.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    specializationsCache = Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('Failed to load specializations/specializations.json:', e.message);
    specializationsCache = [];
  }

  return specializationsCache;
}

function getSpecializations() {
  return loadSpecializations();
}

function getAllSpecializations() {
  return { specializations: loadSpecializations() };
}

// Сбросить кэш после записи в JSON-файл (создание/правка/удаление авторской
// специализации) — без этого следующий getSpecializations() молча вернёт старый
// массив из памяти до перезапуска сервера.
function invalidateSpecializations() {
  specializationsCache = null;
}

module.exports = { getSpecializations, getAllSpecializations, invalidateSpecializations };
