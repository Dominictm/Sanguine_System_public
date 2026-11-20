'use strict';

// Lightweight counter of in-flight AI generations. Exposed via /api/status so
// dev-tooling (run-sanguine-web skill) can check before POST /api/restart
// whether a long LM Studio / OpenAI / Gemini / Anthropic stream is active.

let _count = 0;
let _since = null;

module.exports = {
  begin()    { if (_count++ === 0) _since = Date.now(); },
  end()      { if (_count > 0) { _count--; if (_count === 0) _since = null; } },
  snapshot() { return { active: _count, since: _since ? new Date(_since).toISOString() : null }; },
};
