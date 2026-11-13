// `hooks.js ledger-row` text-path linearity budget (#4439) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// The verb feeds --item/--phase/--resolution text (and the --*-file twins) straight into the ledger row writers,
// and nothing bounds its length. Two shapes were found in the final whole-branch review:
//   - the newline collapse `/\s*\r?\n\s*/g` in wrap-up/ledger-write.js's rewriteLedgerRow and stage-item/ledger.js's
//     ledgerCell restarted at every character of a long run of spaces and failed at its end (`a`, 100k spaces, `b`: about
//     7 s; 1.2 s at 40k, about 30 s at 200k). Fixed by ledger-cells.js's collapseLineBreaks.
//   - wrap-up/pack.js's namesRecordReference tested `/\bitem\s*$/i` against `resolution.slice(0, m.index)` once per `#N`
//     match (`'item #1 '.repeat(n)`: 1.8 s at 160k characters, quadratic). Fixed by a hand walk back over whitespace.
// Lives outside tests/ for the same reason the other perf/ files do: a wall-clock assertion flakes under sibling-suite
// load (tests/wall-clock-budget-conformance.test.js). The verdict is asserted next to every clock.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { rewriteLedgerRow } = require('../plugin/bin/lib/wrap-up/ledger-write');
const { appendLedgerRow, checkLedgerStatus } = require('../plugin/bin/lib/stage-item/ledger');
const { namesRecordReference } = require('../plugin/bin/lib/wrap-up/pack');

const BUDGET_MS = 2000;
const timed = (fn) => {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
};

const HEAD = '| # | Phase | Item | Status | Resolution |\n|---|-------|------|--------|------------|\n';
const LEDGER = `${HEAD}| 1 | build | x | open | — |\n`;
const N = 100000;
const SPACES = ' '.repeat(N);

// The collapse cases: [label, input, the collapsed cell text]. Only the shapes the old regex was quadratic on: a
// whitespace run with no line break (a run WITH one, or a long run of line breaks, matched once and was linear). Byte
// equivalence with the old regex on line-break shapes is tests/bin-lib/wrap-up/ledger-cells.test.js's.
const COLLAPSE = [
  ['100k spaces between two words', `a${SPACES}b`, `a${SPACES}b`],
  ['100k spaces', SPACES, ''],
];

for (const [label, input, collapsed] of COLLAPSE) {
  test(`rewriteLedgerRow (the settle path): ${label} stays linear`, () => {
    const { value, ms } = timed(() => rewriteLedgerRow(LEDGER, { item: 1, status: 'accepted', resolution: input }));
    const expected = `${HEAD}| 1 | build | x | accepted | ${collapsed || '—'} |\n`;
    // assert.ok, not strictEqual: a failing strictEqual would print 100k characters.
    assert.ok(value === expected, `wrong output (${value.length} chars, expected ${expected.length})`);
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
  });

  test(`ledgerCell (appendLedgerRow's item, phase and resolution): ${label} stays linear`, () => {
    const { value, ms } = timed(() => appendLedgerRow(LEDGER, { phase: input, item: input, status: 'accepted', resolution: input }));
    const cell = collapsed || '—';
    // An empty phase or item cell stays empty; only the Resolution cell falls back to the dash.
    const expected = `${LEDGER}| 2 | ${collapsed} | ${collapsed} | accepted | ${cell} |\n`;
    assert.ok(value.text === expected, `wrong output (${value.text.length} chars, expected ${expected.length})`);
    assert.strictEqual(value.number, 2);
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
  });
}

const ITEM_REPEATS = 50000;

// [label, input, the run's own record numbers, the verdict].
for (const [label, input, own, expected] of [
  ['50k `item #1 ` repeats', 'item #1 '.repeat(ITEM_REPEATS), [], false],
  ['50k `item #1 ` repeats then a bare #2', `${'item #1 '.repeat(ITEM_REPEATS)}#2`, [], true],
  ['the run\'s own #2 then 50k `item #1 ` repeats', `#2 ${'item #1 '.repeat(ITEM_REPEATS)}`, [2], false],
  ['50k `item\\n#1` repeats', 'item\n#1 '.repeat(ITEM_REPEATS), [], false],
]) {
  test(`namesRecordReference: ${label} stays linear`, () => {
    const { value, ms } = timed(() => namesRecordReference(input, own));
    assert.strictEqual(value, expected);
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
  });
}

// checkLedgerStatus fixed (the verb's checkFixed path): the adversarial shapes tests/bin-lib/stage-item/ledger.test.js pins by
// verdict, timed here. Every one is a refusal; the regexes behind them run over an unbounded Resolution.
const REPO = { host: 'github.com', owner: 'thn-inc', repo: 'claude-tweaks' };
const OWN = 'https://github.com/thn-inc/claude-tweaks';
for (const [label, input] of [
  ['200k `a`', 'a'.repeat(200000)],
  ['`a`, 200k spaces, `b`', `a${' '.repeat(200000)}b`],
  ['5000 slashes', '/'.repeat(5000)],
  ['a 200k-character /blob/ ref', `${OWN}/blob/${'a'.repeat(200000)}`],
  ['100k path segments before /blob/', `https://github.com/${'a/'.repeat(100000)}blob/x/y`],
  ['a 200k-character /commit/ hex run', `${OWN}/commit/${'a'.repeat(200000)}`],
]) {
  test(`checkLedgerStatus fixed: ${label} stays linear and is refused`, () => {
    const { value, ms } = timed(() => checkLedgerStatus('fixed', input, { repo: REPO }));
    assert.ok(value.refusal !== null && /a commit sha, file reference, or resolving PR/.test(value.refusal), 'an adversarial Resolution names no sha, file or resolving PR');
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
  });
}

test('checkLedgerStatus deferred (the verb\'s path into namesRecordReference): 50k `item #1 ` repeats stays linear and is refused', () => {
  const { value, ms } = timed(() => checkLedgerStatus('deferred', 'item #1 '.repeat(ITEM_REPEATS)));
  assert.ok(value.refusal !== null && /Defer-reason:/.test(value.refusal), 'a row naming only `item #N` cross-references is incomplete and carries no Defer-reason');
  assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
});
