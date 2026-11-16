// `rowCommandNames` linearity budget (#5584) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// plugin/bin/lib/issues/typed-command.js's rowCommandNames reads a transcript row's command text, and nothing
// bounds its length: a user can paste any argument string after `/claude-tweaks:dispatch`. No super-linear shape
// was found; the two cases pin the two paths a huge argument takes:
//   - unterminated (no `</command-args>`): refused by the prefix/suffix checks before the argument slice.
//   - terminated, 200k list elements: the argument checks and build-authority.js's parseTypedDispatch run over all
//     of it.
// Moved out of tests/bin-lib/issues/typed-command.test.js, which keeps both verdicts without a clock: a wall-clock
// assertion flakes under sibling-suite load (tests/wall-clock-budget-conformance.test.js). The verdict is asserted
// next to every clock.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { rowCommandNames } = require('../plugin/bin/lib/issues/typed-command');

const BUDGET_MS = 2000;
const COMMAND = (args) => '<command-message>claude-tweaks:dispatch</command-message>\n'
  + `<command-name>/claude-tweaks:dispatch</command-name>\n<command-args>${args}</command-args>`;
const row = (content) => ({ type: 'user', message: { role: 'user', content } });
const timed = (fn) => {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
};

test('rowCommandNames: a huge unterminated argument string stays linear', () => {
  const content = COMMAND('#3,'.repeat(200000)).slice(0, -'</command-args>'.length);
  const { value, ms } = timed(() => rowCommandNames(row(content), 3));
  assert.strictEqual(value, false);
  assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
});

test('rowCommandNames: a terminated 200k-element list stays linear', () => {
  const content = COMMAND(`${'#4,'.repeat(200000)}#3`);
  const { value, ms } = timed(() => rowCommandNames(row(content), 3));
  assert.strictEqual(value, true);
  assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
});
