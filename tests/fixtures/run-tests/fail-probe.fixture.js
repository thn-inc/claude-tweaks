// Not a `*.test.js` on purpose: the real suite must never collect this. The process-level tests in
// tests/run-tests-isolation.test.js copy it into a fresh temp root as `fail.test.js` and run
// tools/run-tests.js over that root, to pin that a red suite turns the runner red (#3969).
'use strict';
const { test } = require('node:test');

test('fails on purpose', () => {
  throw new Error('deliberate failure');
});
