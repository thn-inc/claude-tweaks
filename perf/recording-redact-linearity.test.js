// Recording redaction linearity budget (#4612) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// redact.js runs over walkthrough captions, story titles, link text and failure messages of unbounded length.
// Shapes probed while writing it, each with its fix reverted: an unanchored rule restarting inside a long token (over 20 s on
// the two long tokens, without the left-boundary lookbehind), a leading `\s*` restarting at every space of a run (over 20 s on
// the space run, with an empty name allowed), and reading the value before checking the name (about 4 s on `a=` repeated).
// Also: a quoted value taking a backslash run with `\\+` (over 30 s on the unterminated run). No reverted fix tried turned
// the repeated-flag case red; it stays as the flag rule's budget. The long prefix case goes red on its verdict when the
// value stops at a separator; on time, only when its boundary is gone and its value also fails to reach a terminator.
// scrubPaths walks trailing separators by hand: `[\\/]+$` restarts at every separator of a run (seconds on the run before a name).
// Lives outside tests/ for the same reason the other perf/ files do: a wall-clock assertion flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { redactText } = require('../plugin/bin/lib/walkthrough/redact');
const { scrubPaths } = require('../plugin/bin/lib/walkthrough/record');

const BUDGET_MS = 1000;
const INPUTS = [
  ['a long token', 'a'.repeat(200000)],
  ['a long hyphenated token', 'a-'.repeat(100000)],
  ['a long space run inside a line', `a${' '.repeat(200000)}b`],
  ['repeated non-credential assignments', 'a='.repeat(50000)],
  ['repeated non-credential flags', '--a '.repeat(50000)],
  ['repeated two-character separators', 'a=='.repeat(50000)],
  ['a backslash run in an unterminated quote', `token="${'\\'.repeat(200000)}`],
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

const SCRUB_INPUTS = [
  ['a long token', 'a'.repeat(200000), 'a'.repeat(200000)],
  ['a long separator run', '/'.repeat(200000), '/'.repeat(200000)],
  ['one long path', '/a'.repeat(100000), 'a'],
  ['one long path ending in separators', `/a${'/'.repeat(200000)}`, 'a'],
  ['many short paths', ' /a/b'.repeat(40000), ' b'.repeat(40000)],
  ['a long unterminated quoted path', `'/${'a '.repeat(100000)}`, `'${'a '.repeat(100000)}`],
  ['repeated open quotes', "'/".repeat(100000), "'/".repeat(100000)],
  ['a long separator run before a name', `${'/'.repeat(200000)}a`, 'a'],
  ['a long relative token', 'a/'.repeat(100000), 'a/'.repeat(100000)],
  ['a long whitespace run', ` ${' '.repeat(200000)}x`, ` ${' '.repeat(200000)}x`],
];

for (const [label, input, expected] of SCRUB_INPUTS) {
  test(`scrubPaths stays linear on ${label}`, () => {
    const start = performance.now();
    const text = scrubPaths(input);
    const ms = performance.now() - start;
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
    assert.ok(text === expected, `unexpected text, length ${text.length}`);
  });
}

test('redactText stays linear on a long repeated prefix, which is one secret', () => {
  const start = performance.now();
  const { text, count, residual } = redactText('sk_'.repeat(70000));
  const ms = performance.now() - start;
  assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
  assert.strictEqual(count, 1);
  assert.strictEqual(text, '[redacted]');
  assert.strictEqual(residual, ' ');
});
