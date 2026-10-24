// Dream redact latency budget (#2968) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// redact() caps its input before the secret regexes run. Uncapped, SECRET_NAME's unbounded runs
// backtrack quadratically on a keyword-bearing tool output (~2 s at 120k chars), so a 120k-char
// input must redact under 500 ms. Lives outside tests/ because a wall-clock assertion flakes under
// sibling-suite load; the functional half (the output is capped to PRE_REDACT_CHARS) stays in
// tests/bin-lib/dream/scan.test.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('../plugin/bin/lib/dream/scan');

test('redact: a huge keyword-bearing tool output stays fast (input is capped before the secret regexes run)', () => {
  // Uncapped, SECRET_NAME's unbounded runs backtrack quadratically here (~2 s at 120k chars).
  const huge = 'TOKEN'.repeat(24000);
  const started = Date.now();
  const out = redact(huge);
  assert.ok(Date.now() - started < 500, `redact took ${Date.now() - started} ms`);
  assert.ok(out.startsWith('TOKEN'), out.slice(0, 20));
});
