'use strict';
/**
 * AI Layer — unified entry point for all AI functionality.
 * Ф4 Code-review fixes: extracted from server.js.
 */

const clients = require('./clients');
const retry = require('./retry');
const errors = require('./errors');

module.exports = {
  // Clients (configure() — транспорты из server.js)
  ...clients,
  // Retry logic with deadline
  ...retry,
  // Readable provider errors (AiError, classifyAiError, sendError)
  ...errors,
};
