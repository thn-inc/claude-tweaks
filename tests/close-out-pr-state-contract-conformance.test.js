// tests/close-out-pr-state-contract-conformance.test.js — #3029: close-out.md
// step 2 must state resolvePrStateByNumber's positional signature and its full
// string-result contract, and say any string result stops the candidate —
// the missing signature is what let a caller misorder the arguments and read
// 'network-failure' as "not DIRTY".
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CLOSE_OUT = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'skills', 'dispatch', 'close-out.md'), 'utf8');
const STEP_2_START = CLOSE_OUT.indexOf('2. **Re-check mergeability');
const STEP_2_END = CLOSE_OUT.indexOf('3. **Convert draft to ready');
const STEP_2 = CLOSE_OUT.slice(STEP_2_START, STEP_2_END);

test('close-out step 2 is locatable', () => {
  assert.ok(STEP_2_START >= 0, 'step 2 heading not found — the heading text moved');
  assert.ok(STEP_2_END > STEP_2_START, 'step 3 heading not found after step 2 — the span would be wrong');
});

test('close-out step 2 names the positional signature', () => {
  assert.match(STEP_2, /resolvePrStateByNumber\(repoRoot, number\)/);
});

test('close-out step 2 names every string result the resolver returns', () => {
  for (const s of ['gh-absent', 'network-failure', 'invalid-arguments', 'pr-not-found']) {
    assert.ok(STEP_2.includes(`'${s}'`), `missing '${s}'`);
  }
});

test('close-out step 2 says a string result stops the candidate, never read as not DIRTY', () => {
  assert.match(STEP_2, /string result[\s\S]{0,120}stop[\s\S]{0,120}never read[\s\S]{0,40}not DIRTY/i);
});
