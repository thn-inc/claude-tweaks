'use strict';
// #4620: the staged-pointer -> carried ledger transition. A `deferred` row naming staged/{id} is terminal
// to settleRow today; control mode's carry route needs exactly one legal way out of it.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const { appendRow, settleRow } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'stage-item', 'ledger'));
const pack = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'wrap-up', 'pack'));

const HEAD = '# Open Items — x\n\n| # | Phase | Item | Status | Resolution |\n|---|-------|------|--------|------------|\n';
const STAGED = '→ backlog, staged/ledger-record-1.md';
const CARRIED = 'carried to the acceptance packet as decision:console:ledger-record-1.md';

function fixture(status = 'deferred', resolution = STAGED) {
  const runDir = scratchDir('ledger-carry-');
  const ledgerPath = path.join(runDir, 'ledger.md');
  fs.writeFileSync(ledgerPath, HEAD);
  appendRow({ runDir, ledgerPath, phase: 'build', item: 'a finding', status, resolution });
  return { runDir, ledgerPath };
}
const settle = (fx, status, resolution) => settleRow({ runDir: fx.runDir, ledgerPath: fx.ledgerPath, row: 1, status, resolution });
const text = (fx) => fs.readFileSync(fx.ledgerPath, 'utf8');

test('settleRow moves a staged-pointer deferred row to the carried text', () => {
  const fx = fixture();
  settle(fx, 'deferred', CARRIED);
  assert.match(text(fx), /\| 1 \| build \| a finding \| deferred \| carried to the acceptance packet as decision:console:ledger-record-1\.md \|/);
  assert.ok(!text(fx).includes('staged/'), 'no stale pointer');
});

test('settleRow still refuses the staged-pointer row to any other deferred text, and to fixed', () => {
  const fx = fixture();
  assert.throws(() => settle(fx, 'deferred', 'Defer-reason: needs-human-decision'), /already deferred \(terminal\)/);
  assert.throws(() => settle(fx, 'deferred', 'carried to the acceptance packet as something'), /already deferred \(terminal\)/);
  assert.throws(() => settle(fx, 'fixed', `${CARRIED} plugin/bin/x.js`), /already deferred \(terminal\)/);
  assert.throws(() => settle(fx, 'accepted', CARRIED), /already deferred \(terminal\)/);
  assert.match(text(fx), /staged\/ledger-record-1\.md/, 'the row is unchanged');
});

test('settleRow refuses a row that is not a staged-pointer deferral, carried text or not', () => {
  const fixed = fixture('fixed', 'plugin/bin/x.js:1 done');
  assert.throws(() => settle(fixed, 'deferred', CARRIED), /already fixed \(terminal\)/);
  const carried = fixture('deferred', CARRIED);
  assert.throws(() => settle(carried, 'deferred', `${CARRIED} again`), /already deferred \(terminal\)/);
});

test('parseLedger reports the carried row as neither open nor deferred-unstaged', () => {
  const fx = fixture();
  settle(fx, 'deferred', CARRIED);
  const parsed = pack.parseLedger(text(fx));
  assert.strictEqual(parsed.open, 0);
  assert.strictEqual(parsed.deferredUnstaged, 0);
  assert.deepStrictEqual(parsed.deferredUnstagedItems, []);
  assert.strictEqual(parsed.missingDeferReason, 0, 'a carried build row keeps its reason in the decision fact');
  const bare = pack.parseLedger(`${HEAD}| 1 | build | x | deferred | carried to the acceptance packet as nothing |\n`);
  assert.strictEqual(bare.missingDeferReason, 1, 'a carried text with no decision: id is not a reason');
});

test('a carried text with no decision: id is still unstaged', () => {
  const parsed = pack.parseLedger(`${HEAD}| 1 | build | x | deferred | carried to the acceptance packet as nothing |\n`);
  assert.strictEqual(parsed.deferredUnstaged, 1);
  assert.strictEqual(pack.isDeferredUnstaged('carried to the acceptance packet as decision:', []), true);
  assert.strictEqual(pack.isDeferredUnstaged(CARRIED, []), false);
  assert.match(CARRIED, pack.LEDGER_CARRIED_RE);
});
