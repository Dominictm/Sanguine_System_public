'use strict';
/**
 * OAuth Helpers — placeholder for future OAuth integration (Ф4 Code-review fixes).
 * Currently not used — direct API keys in .env.
 * Extracted from server.js DI plumbing.
 */

// ── Anthropic OAuth (Claude.ai) ──────────────────────────────────────────────
// Not currently implemented. Would handle:
// - Authorization code flow
// - Token storage/refresh
// - Scopes management

async function getAnthropicAuthUrl(state) {
  // Placeholder
  throw new Error('Anthropic OAuth not implemented');
}

async function exchangeAnthropicCode(code) {
  // Placeholder
  throw new Error('Anthropic OAuth not implemented');
}

async function refreshAnthropicToken(refreshToken) {
  // Placeholder
  throw new Error('Anthropic OAuth not implemented');
}

// ── Google OAuth (Vertex AI) ─────────────────────────────────────────────────
// Handled via service account key file (GOOGLE_APPLICATION_CREDENTIALS)
// No OAuth flow needed for server-to-server.

// ── OpenAI OAuth ──────────────────────────────────────────────────────────────
async function getOpenAIAuthUrl(state) {
  throw new Error('OpenAI OAuth not implemented');
}

async function exchangeOpenAICode(code) {
  throw new Error('OpenAI OAuth not implemented');
}

module.exports = {
  // Anthropic
  getAnthropicAuthUrl,
  exchangeAnthropicCode,
  refreshAnthropicToken,
  // OpenAI
  getOpenAIAuthUrl,
  exchangeOpenAICode,
};