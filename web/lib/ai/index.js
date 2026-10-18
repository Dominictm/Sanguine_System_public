'use strict';
/**
 * AI Layer — unified entry point for all AI functionality.
 * Ф4 Code-review fixes: extracted from server.js.
 */

const clients = require('./clients');
const retry = require('./retry');
const sheet = require('./sheet');
const oauth = require('./oauth');

module.exports = {
  // Clients
  ...clients,
  // Retry logic with deadline
  ...retry,
  // Sheet generation
  ...sheet,
  // OAuth (placeholders)
  ...oauth,
};