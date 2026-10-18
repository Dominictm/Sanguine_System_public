'use strict';
/**
 * Per-path mutex for file operations — prevents lost-update on concurrent writes.
 * Simple in-memory promise queue keyed by normalized absolute path.
 * ~30 lines, no dependencies.
 */
const _locks = new Map(); // path -> Promise (queue tail)

/**
 * Execute fn with exclusive access to the given file path.
 * Other callers with the same path will queue and wait.
 * @param {string} filePath - absolute or relative path (will be resolved)
 * @param {Function} fn - async function to execute under lock
 * @returns {Promise<any>} result of fn
 */
async function withFileLock(filePath, fn) {
  const absPath = require('path').resolve(filePath);
  const prev = _locks.get(absPath) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  _locks.set(absPath, current);

  try {
    await prev;
    return await fn();
  } finally {
    release();
    // If the queue tail is our promise, remove the entry; otherwise keep the next waiter's promise
    if (_locks.get(absPath) === current) {
      _locks.delete(absPath);
    }
  }
}

module.exports = { withFileLock };