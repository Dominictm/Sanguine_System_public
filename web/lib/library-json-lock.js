'use strict';

const path = require('path');
const { ROOT } = require('./db');
const { withFileLock } = require('./mutex');

const LIB_JSON_DIRS = new Set(['merits', 'flaws', 'backgrounds', 'archetypes', 'essences', 'specializations']);

function withLibraryJsonLock(dir, fn) {
  if (!LIB_JSON_DIRS.has(dir)) throw new Error(`Unknown library JSON directory: ${dir}`);
  const lockFile = path.join(ROOT, 'system', 'library', dir, '.library-json-transaction');
  return withFileLock(lockFile, fn);
}

module.exports = { LIB_JSON_DIRS, withLibraryJsonLock };
