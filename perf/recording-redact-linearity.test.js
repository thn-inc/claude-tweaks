// Recording redaction linearity budget (#4612) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// redact.js runs over walkthrough captions, story titles, link text and failure messages of unbounded length.
// Shapes probed while writing it, each with its fix reverted: an unanchored rule restarting inside a long token (over 20 s on
// the two long tokens, without the left-boundary lookbehind), a leading `\s*` restarting at every space of a run (over 20 s on
// the space run, with an empty name allowed), and reading the value before checking the name (about 4 s on `a=` repeated).
// No reverted fix tried turned the repeated-flag case red; it stays as the flag rule's budget.
// Lives outside tests/ for the same reason the other perf/ files do: a wall-clock assertion flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { redactText } = require('../plugin/bin/lib/walkthrough/redact');

const BUDGET_MS = 1000;
const INPUTS = [
  ['a long token', 'a'.repeat(200000)],
  ['a long hyphenated token', 'a-'.repeat(100000)],
  ['a long space run inside a line', `a${' '.repeat(200000)}b`],
  ['repeated non-credential assignments', 'a='.repeat(50000)],
  ['repeated non-credential flags', '--a '.repeat(50000)],
];

for (const [label, input] of INPUTS) {
  test(`redactText stays linear on ${label}`, () => {
    const start = performance.now();
    const { text, count, residual } = redactText(input);
    const ms = performance.now() - start;
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
    assert.strictEqual(count, 0);
    assert.ok(text === input, `text changed, length ${text.length}`);
    assert.ok(residual === input, `residual changed, length ${residual.length}`);
  });
}
