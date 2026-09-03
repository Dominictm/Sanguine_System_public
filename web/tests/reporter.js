'use strict';
// Minimal spec-style reporter for `npm run test:unit` (node:test custom reporter).
// The public release does not ship the full internal reporter; this shim keeps the
// declared reporter path (`--test-reporter=./tests/reporter.js`) functional.
//
// Node runs custom reporters as `compose(moduleExports(), runStream)` and expects the
// module's export to produce a Transform. Node composes the test event stream (objects)
// into the reporter's writable side and pipes strings out of its readable side, so this
// Transform consumes object-mode events and emits human-readable spec lines.

const { Transform } = require('stream');

function makeReporter() {
  return new Transform({
    writableObjectMode: true,
    transform(evt, _enc, cb) {
      if (!evt || typeof evt !== 'object' || !evt.type) {
        cb();
        return;
      }
      const { type, data } = evt;
      const name = (data && data.name) || '';
      switch (type) {
        case 'test:pass':
          cb(null, `pass  ${name}\n`);
          break;
        case 'test:fail': {
          let first = '';
          const err = data && data.diag && data.diag.error;
          if (err) first = String(err.message || err).split('\n')[0];
          cb(null, `FAIL  ${name}\n      ${first}\n`);
          break;
        }
        case 'test:skip':
          cb(null, `skip  ${name}\n`);
          break;
        case 'test:diagnostic':
          cb(null, `${(data && data.message) || ''}\n`);
          break;
        default:
          cb();
      }
    },
  });
}

module.exports = makeReporter;
