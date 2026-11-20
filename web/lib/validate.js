'use strict';
/**
 * Centralized validation helpers for routes.
 * Replaces ad-hoc validation scattered across route handlers.
 * All functions throw on invalid input with structured error messages.
 */

const path = require('path');

// ── City slug validation ──────────────────────────────────────────────────────
// City slugs: lowercase alphanumeric + underscore, cannot start with _ or .
// Matches the existing CITY_SLUG_RE pattern used in backup.js and cities.js
const CITY_SLUG_RE = /^[a-z0-9][a-z0-9_]*$/;
function assertCitySlug(slug, paramName = 'slug') {
  if (!slug || typeof slug !== 'string' || !CITY_SLUG_RE.test(slug)) {
    const err = new Error(`Invalid ${paramName}: must be lowercase alphanumeric + underscore, not starting with _`);
    err.status = 400;
    err.code = 'INVALID_CITY_SLUG';
    throw err;
  }
}

// ── Character slug validation ─────────────────────────────────────────────────
// Character slugs follow same pattern as city slugs
const CHAR_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;
function assertCharSlug(slug, paramName = 'slug') {
  if (!slug || typeof slug !== 'string' || !CHAR_SLUG_RE.test(slug)) {
    const err = new Error(`Invalid ${paramName}: must be lowercase alphanumeric + underscore/hyphen`);
    err.status = 400;
    err.code = 'INVALID_CHAR_SLUG';
    throw err;
  }
}

// ── Module/Chronicle slug validation ──────────────────────────────────────────
const MOD_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;
function assertModSlug(slug, paramName = 'slug') {
  if (!slug || typeof slug !== 'string' || !MOD_SLUG_RE.test(slug)) {
    const err = new Error(`Invalid ${paramName}: must be lowercase alphanumeric + underscore/hyphen`);
    err.status = 400;
    err.code = 'INVALID_MOD_SLUG';
    throw err;
  }
}

// ── Location slug validation ──────────────────────────────────────────────────
const LOC_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;
function assertLocSlug(slug, paramName = 'slug') {
  if (!slug || typeof slug !== 'string' || !LOC_SLUG_RE.test(slug)) {
    const err = new Error(`Invalid ${paramName}: must be lowercase alphanumeric + underscore/hyphen`);
    err.status = 400;
    err.code = 'INVALID_LOC_SLUG';
    throw err;
  }
}

// ── Generic stored-name validation (files, folders) ───────────────────────────
// For any stored name that must be a safe filesystem name
const STORED_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
function assertStoredName(name, paramName = 'name') {
  if (!name || typeof name !== 'string' || !STORED_NAME_RE.test(name)) {
    const err = new Error(`Invalid ${paramName}: must be alphanumeric + underscore/hyphen/dot`);
    err.status = 400;
    err.code = 'INVALID_STORED_NAME';
    throw err;
  }
}

// ── Filename validation (for diary, uploads, etc.) ────────────────────────────
// Only alphanumeric, underscore, hyphen, dot; no path traversal
const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
function assertFilename(filename, paramName = 'filename') {
  if (!filename || typeof filename !== 'string' || !FILENAME_RE.test(filename)) {
    const err = new Error(`Invalid ${paramName}: only alphanumeric, underscore, hyphen, dot allowed`);
    err.status = 400;
    err.code = 'INVALID_FILENAME';
    throw err;
  }
  // Additional path traversal check
  const normalized = path.normalize(filename).replace(/\\/g, '/');
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    const err = new Error(`Path traversal in ${paramName}`);
    err.status = 400;
    err.code = 'PATH_TRAVERSAL';
    throw err;
  }
}

// ── Diary file validation (journal/<name>.md) ─────────────────────────────────
const DIARY_FILE_RE = /^journal\/[A-Za-z0-9_-]+\.md$/;
function assertDiaryFile(file, paramName = 'file') {
  if (!file || typeof file !== 'string' || !DIARY_FILE_RE.test(file)) {
    const err = new Error(`Invalid ${paramName}: must be journal/<name>.md`);
    err.status = 400;
    err.code = 'INVALID_DIARY_FILE';
    throw err;
  }
}

// ── JSON body validation helpers ──────────────────────────────────────────────
function assertJsonBody(body, requiredFields = []) {
  if (!body || typeof body !== 'object') {
    const err = new Error('Request body must be a JSON object');
    err.status = 400;
    err.code = 'INVALID_JSON_BODY';
    throw err;
  }
  for (const field of requiredFields) {
    if (!(field in body)) {
      const err = new Error(`Missing required field: ${field}`);
      err.status = 400;
      err.code = 'MISSING_FIELD';
      throw err;
    }
  }
}

// ── String field validation (non-empty after trim) ────────────────────────────
function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    const err = new Error(`${fieldName} must be a non-empty string`);
    err.status = 400;
    err.code = 'EMPTY_STRING';
    throw err;
  }
}

// ── Numeric range validation ──────────────────────────────────────────────────
function assertNumberInRange(value, min, max, fieldName) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    const err = new Error(`${fieldName} must be a number between ${min} and ${max}`);
    err.status = 400;
    err.code = 'OUT_OF_RANGE';
    throw err;
  }
}

// ── Enum validation ───────────────────────────────────────────────────────────
function assertEnum(value, allowedValues, fieldName) {
  if (!allowedValues.includes(value)) {
    const err = new Error(`${fieldName} must be one of: ${allowedValues.join(', ')}`);
    err.status = 400;
    err.code = 'INVALID_ENUM';
    throw err;
  }
}

// ── Centralized router.param for common params ────────────────────────────────
// Usage: router.param('citySlug', validate.param('citySlug', assertCitySlug))
function param(name, validator) {
  return (req, res, next, value) => {
    try {
      validator(value, name);
      next();
    } catch (e) {
      next(e);
    }
  };
}

// Export all validators and the param factory
module.exports = {
  // Slug validators
  assertCitySlug,
  assertCharSlug,
  assertModSlug,
  assertLocSlug,
  assertStoredName,
  assertFilename,
  assertDiaryFile,
  // Generic validators
  assertJsonBody,
  assertNonEmptyString,
  assertNumberInRange,
  assertEnum,
  // Router param factory
  param,
  // Regex constants (for direct use where needed)
  CITY_SLUG_RE,
  CHAR_SLUG_RE,
  MOD_SLUG_RE,
  LOC_SLUG_RE,
  STORED_NAME_RE,
  FILENAME_RE,
  DIARY_FILE_RE,
};