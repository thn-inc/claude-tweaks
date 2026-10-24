// tests/bin-lib/run-liveness/constants.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { HEARTBEAT_THROTTLE_MS, LIVE_WINDOW_MS, LEGACY_DEAD_MS } = require('../../../plugin/bin/lib/run-liveness/constants');

test('the live window is at least ten times the heartbeat throttle', () => {
  assert.ok(LIVE_WINDOW_MS >= 10 * HEARTBEAT_THROTTLE_MS);
  assert.strictEqual(HEARTBEAT_THROTTLE_MS, 60_000);
  assert.strictEqual(LIVE_WINDOW_MS, 600_000);
  assert.strictEqual(LEGACY_DEAD_MS, 259_200_000);
});
