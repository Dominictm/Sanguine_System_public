'use strict';
/**
 * Global error middleware for Express.
 * Ensures all errors return consistent JSON envelope: { ok: false, error: '...' }
 * Handles: 400 (validation), 413 (payload too large), 500 (internal), and custom status codes.
 */

// ── Error classes for structured handling ─────────────────────────────────────
class ValidationError extends Error {
  constructor(message, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.code = code;
  }
}

class NotFoundError extends Error {
  constructor(message, code = 'NOT_FOUND') {
    super(message);
    this.name = 'NotFoundError';
    this.status = 404;
    this.code = code;
  }
}

class PayloadTooLargeError extends Error {
  constructor(message, code = 'PAYLOAD_TOO_LARGE') {
    super(message);
    this.name = 'PayloadTooLargeError';
    this.status = 413;
    this.code = code;
  }
}

class ForbiddenError extends Error {
  constructor(message, code = 'FORBIDDEN') {
    super(message);
    this.name = 'ForbiddenError';
    this.status = 403;
    this.code = code;
  }
}

class UnauthorizedError extends Error {
  constructor(message, code = 'UNAUTHORIZED') {
    super(message);
    this.name = 'UnauthorizedError';
    this.status = 401;
    this.code = code;
  }
}

class TimeoutError extends Error {
  constructor(message, code = 'TIMEOUT') {
    super(message);
    this.name = 'TimeoutError';
    this.status = 504;
    this.code = code;
  }
}

// ── Error middleware factory ──────────────────────────────────────────────────
function createErrorMiddleware({ logErrors = true } = {}) {
  return (err, req, res, next) => {
    // If headers already sent, delegate to default Express handler
    if (res.headersSent) {
      return next(err);
    }

    // Determine status code
    const status = err.status || err.statusCode || 500;
    const code = err.code || 'INTERNAL_ERROR';

    // Log error (structured for log aggregation)
    if (logErrors) {
      const logData = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        ip: req.ip,
        status,
        code,
        message: err.message,
        stack: status >= 500 ? err.stack : undefined, // Only log stack for server errors
      };
      console.error('[error]', JSON.stringify(logData));
    }

    // Build response
    const response = {
      ok: false,
      error: err.message || 'Внутренняя ошибка сервера',
      ...(code && { code }),
    };

    // Include details for validation errors in development
    if (status === 400 && err.details) {
      response.details = err.details;
    }

    res.status(status).json(response);
  };
}

// ── 413 Payload Too Large handler (for express.json limit) ────────────────────
function payloadTooLargeHandler(err, req, res, next) {
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      ok: false,
      error: 'Request body too large',
      code: 'PAYLOAD_TOO_LARGE',
    });
  }
  next(err);
}

// ── Not found handler (for unmatched routes) ──────────────────────────────────
function notFoundHandler(req, res) {
  res.status(404).json({
    ok: false,
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
  });
}

module.exports = {
  createErrorMiddleware,
  payloadTooLargeHandler,
  notFoundHandler,
  // Error classes for throwing in routes
  ValidationError,
  NotFoundError,
  PayloadTooLargeError,
  ForbiddenError,
  UnauthorizedError,
  TimeoutError,
};