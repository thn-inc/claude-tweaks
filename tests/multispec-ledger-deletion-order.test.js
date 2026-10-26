'use strict';
// #3420: a multi-spec run's shared open-items ledger must outlive the batch
// curation pass that reads and writes it. Item 2's multi-spec deletion defers
// to /flow's Shared teardown step 0, after the batch pass and the consolidated
// console, instead of running on the final spec's wrap-up.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const readRaw = (rel) => readText(path.join(SKILLS, rel));
const read = (rel) => readRaw(rel).replace(/\s+/g, ' ');

// The pre-#3420 caveat tail: the final spec's wrap-up deleted the ledger.
const PRE_FIX_TAIL = /let the final spec's wrap-up \(whose own Phase 3 gate will by then see the run's complete, cross-spec item set\) delete it once nothing remains/;

function assertLedgerOutlivesBatchPass(cleanupText, batchText) {
  assert.match(cleanupText, /deletes it once, in `flow\/multispec-review-console\.md`'s Shared teardown step 0 — after `flow\/multispec-batch-curation\.md`'s batch pass and the consolidated console/);
  assert.match(batchText, /The shared open-items ledger is still on disk when this pass runs/);
  assert.match(batchText, /`wrap-up\/cleanup-procedures\.md` item 2 defers its multi-spec deletion/);
}

test('AC1.1: the final spec\'s wrap-up under MULTISPEC_REVIEW_DEFER=1 no longer deletes the shared ledger', () => {
  const raw = readRaw('wrap-up/cleanup-procedures.md');
  const text = read('wrap-up/cleanup-procedures.md');
  assert.match(raw, /\| 2 \| Open items ledger \|[^\n]*?\| \*\*Yes — defer to parent `\/flow`'s multi-spec finish step\*\*/);
  assert.match(text, /SKIPS state-changing cleanups marked "Yes" in the table above \(items 2, 3, 4, 6, 7, and 8\)/);
  assert.match(text, /- Item 2 \(Open items ledger\) — parent \/flow deletes the shared ledger once/);
  assert.match(text, /no per-spec wrap-up deletes it — the final spec's included/);
  assert.doesNotMatch(text, PRE_FIX_TAIL);
  assert.match(text, /In `interactive` mode .*this is not the final spec — skip item 2/);

  const exec = read('wrap-up/execution-and-verification.md');
  assert.match(exec, /SKIPS the state-changing cleanups marked deferred in `cleanup-procedures\.md` \(items 2 Open items ledger, 3 Design caches/);
  assert.doesNotMatch(exec, /executes the idempotent cleanups \(items 1 Execution plans, 2 Open items ledger/);
});

const STEP0 = '0. **Delete the shared open-items ledger (#3420).**';

function assertFinishOrder(text) {
  const stepAt = text.indexOf(STEP0);
  const finishAt = text.indexOf('**Finish the shared branch.**');
  const teardownAt = text.indexOf('### Shared teardown');
  const batchAt = text.indexOf('0. If `MULTISPEC_CURATION_DEFER=1`, run the batch pass first');
  assert.notStrictEqual(stepAt, -1, 'Shared teardown step 0 must exist');
  assert.notStrictEqual(finishAt, -1, 'Shared teardown step 2 must exist');
  assert.notStrictEqual(teardownAt, -1, 'Shared teardown heading must exist');
  assert.notStrictEqual(batchAt, -1, 'batch-pass step must exist');
  assert.ok(batchAt < teardownAt && teardownAt < stepAt && stepAt < finishAt,
    'order must be batch pass < Shared teardown < step 0 < branch finish');

  const step = text.slice(stepAt, finishAt);
  assert.match(step, /delete-ledger --run "\$MULTISPEC_PARENT_DIR" --ledger/);
  assert.match(step, /zero `open` rows/);
  assert.match(step, /SKIP/);
  assert.match(step, /push/);
}

test('AC2.1: the multi-spec finish step deletes the shared ledger after the consolidated console, before the branch finish', () => {
  assertFinishOrder(read('flow/multispec-review-console.md'));
});

test('go-red proof: step 0 moved below the branch finish fails the AC2.1 order pin on the order assertion', () => {
  const live = read('flow/multispec-review-console.md');
  const permuted = live.replace(STEP0, '0. **(moved)**').replace('**Finish the shared branch.**', `**Finish the shared branch.** ${STEP0}`);
  assert.notStrictEqual(permuted, live);
  assert.throws(() => assertFinishOrder(permuted), /order must be batch pass < Shared teardown < step 0 < branch finish/);
});

test('AC2.2: the cleanup-procedures.md / multispec-batch-curation.md order is pinned', () => {
  assertLedgerOutlivesBatchPass(read('wrap-up/cleanup-procedures.md'), read('flow/multispec-batch-curation.md'));
});

test('go-red proof: the pre-#3420 order (final spec deletes, batch pass after) fails the AC2.2 pin', () => {
  const preFixCleanup = "...and let the final spec's wrap-up (whose own Phase 3 gate will by then see the run's complete, cross-spec item set) delete it once nothing remains.";
  assert.throws(() => assertLedgerOutlivesBatchPass(preFixCleanup, read('flow/multispec-batch-curation.md')));
});
