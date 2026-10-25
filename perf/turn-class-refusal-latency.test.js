// Turn-class guard-refusal latency budget (#4029) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// classifyToolCall matches its guard-refusal regex against only the first 2,048 chars of an
// is_error result, with bounded quantifiers ([IL-162]). Unbounded, `Permission to use \S+.*has
// been denied` backtracked quadratically on one unbroken run (30 s at 200k chars), so a 200k-char
// input must classify under 200 ms. Lives outside tests/ because a wall-clock assertion flakes
// under sibling-suite load; the functional half (a leading refusal still matches, refusal text
// past the slice does not) stays in tests/bin-lib/timing/turn-class.test.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyToolCall } = require('../plugin/bin/lib/timing/turn-class');

test('classifyToolCall: a 200k-char is_error result classifies in under 200 ms', () => {
  const huge = 'Permission to use ' + 'x'.repeat(200000);
  const started = Date.now();
  const cls = classifyToolCall({ name: 'Bash', input: { command: 'grep x' }, isError: true, resultText: huge });
  assert.ok(Date.now() - started < 200, `classified in ${Date.now() - started} ms`);
  assert.equal(cls, 'explore');
});
