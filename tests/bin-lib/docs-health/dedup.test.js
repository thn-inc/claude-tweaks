const { test } = require('node:test');
const assert = require('node:assert');
const { decide } = require('../../../plugin/bin/lib/docs-health/dedup');

// plugin/bin/lib/docs-health/dedup.js is nothing but
// `module.exports = require('../health-core/dedup')`, so every export is
// health-core's. decide()'s behaviour is tested in
// tests/bin-lib/health-core/dedup.test.js; this file only proves the wrapper
// is still a pass-through.
test('#5552 AC4.1: decide is the shared health-core implementation, not a local reimplementation', () => {
  assert.strictEqual(decide, require('../../../plugin/bin/lib/health-core/dedup').decide);
});
