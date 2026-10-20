'use strict';
// #3595 D1: wrap-up's item 2 unlinks the run's open-items ledger but never
// commits it, so under pr-first the deletion reaches the branch only after
// gh pr merge has squashed the remote head. The pr-first merge therefore runs
// at review-console.md's On approval step 13 — after the ledger's last writers
// (steps 7 and 11) and step 12's commit — and item 2 (delete, commit, push)
// runs immediately before it.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const readRaw = (rel) => fs.readFileSync(path.join(SKILLS, rel), 'utf8');
const read = (rel) => readRaw(rel).replace(/\s+/g, ' ');

const ITEM2_PARA = "**Item 2 lands before item 4's merge (#3595).**";
const STEP11 = '11. Write `verify-expectations.json`';
const STEP12 = '12. Commit with a wrap-up message';
const STEP13 = '13. **Branch finish (`pr-first`, #3595).**';
const MERGE = "runs `_shared/pr-first-merge.md`'s procedure";
const STEP14 = '14. Proceed to the phase-trace report';
const COMMIT = 'on `deleted` commit only that tracked `docs/plans/*-ledger.md` path';

function assertLedgerBeforeMerge(consoleText) {
  const start = consoleText.indexOf('## On approval (option 1)');
  const end = consoleText.indexOf('For "On override"', start);
  assert.ok(start !== -1 && end > start, 'On approval section must exist');
  const approval = consoleText.slice(start, end);

  const step13At = approval.indexOf(STEP13);
  const step14At = approval.indexOf(STEP14);
  const step13 = step13At === -1 || step14At < step13At ? '' : approval.slice(step13At, step14At);
  const marks = [
    ['step 11', approval.indexOf(STEP11)],
    ['step 12', approval.indexOf(STEP12)],
    ['step 13', step13At],
    ['step 13 delete-ledger', step13 === '' ? -1 : step13At + step13.indexOf('delete-ledger')],
    ['step 13 commit', step13 === '' ? -1 : step13At + step13.indexOf(COMMIT)],
    ['step 13 push', step13 === '' ? -1 : step13At + step13.indexOf('push the branch as its own Bash call')],
    ['step 13 merge', step13 === '' ? -1 : step13At + step13.indexOf(MERGE)],
    ['step 14', step14At],
  ];
  for (let i = 0; i < marks.length; i++) {
    assert.ok(
      marks[i][1] !== -1 && (i === 0 || marks[i][1] > marks[i - 1][1]),
      `${marks[i][0]} must follow ${i === 0 ? 'the section start' : marks[i - 1][0]} — item 2 delete, commit and push must precede the pr-first merge, and the merge must follow step 12's commit`,
    );
  }

  assert.ok(step13.includes('when it survived the Condition filter'), 'step 13 must gate item 2 on its Condition (a non-final interactive multi-spec spec skips it)');
  assert.ok(step13.includes('any `open` row leaves the ledger in place'), 'step 13 must leave a ledger with open rows in place');
  assert.ok(step13.includes('A failed push skips the merge'), 'step 13 must skip the merge when the push fails');

  const step6 = approval.slice(approval.indexOf('6. Execute cleanup actions'), approval.indexOf('7. `Q#` queue writes'));
  assert.ok(step6.length > 0 && !step6.includes('pr-first-merge.md'), 'step 6 must not run the pr-first merge — it runs at step 13, after the ledger\'s last writers');
}

test('AC1.1: cleanup item 2 deletes at On approval step 13 under pr-first, committing only a tracked docs/plans ledger', () => {
  const raw = readRaw('wrap-up/cleanup-procedures.md');
  const text = read('wrap-up/cleanup-procedures.md');
  assert.ok(text.includes(ITEM2_PARA), 'item 2 paragraph must exist');
  assert.ok(text.includes('On approval" step 13'), 'paragraph must name On approval step 13');
  assert.ok(text.includes('only a tracked `docs/plans/*-ledger.md`'), 'commit limited to a tracked docs/plans ledger');
  assert.ok(text.includes('log one `SKIP` line'), 'non-deleted reports log a SKIP line');
  assert.match(text, /`not found` is a no-op/);
  assert.match(raw, /\| 2 \| Open items ledger \|[^\n]*?then commit only that path/);
});

test('AC1.1: review-console On approval runs item 2, a push, then the pr-first merge after step 12\'s commit', () => {
  assertLedgerBeforeMerge(read('wrap-up/review-console.md'));
});

test('AC1.1: Section C step 3 names step 13 as the pr-first merge and no longer says step 6 ran it', () => {
  const text = read('wrap-up/cleanup-procedures-execution.md');
  assert.ok(text.includes('"On approval" step 13 ran `_shared/pr-first-merge.md` directly'));
  assert.ok(!text.includes('"On approval" step 6 ran `_shared/pr-first-merge.md`'));
});

// The pre-fix text (59573429d): item 2 committed in step 6 ahead of the merge
// that also ran in step 6, ahead of steps 7 and 11 — the ledger's last writers.
const PRE_FIX = [
  '## On approval (option 1)',
  "6. Execute cleanup actions (items 18 onward) — Phase 4's execution step picks these up. Item 2's ledger deletion is committed and, under `pr-first`, pushed before the worktree/branch-finish row runs. Under `pr-first`, the worktree/branch-finish row routes on the Approve-all variant chosen: \"Approve all + merge\" runs `_shared/pr-first-merge.md`'s procedure — read as one composed bundle; \"leave PR open\" skips the merge, landing on `pending-review`.",
  '7. `Q#` queue writes: Approve all resolves to the pre-checked `Apply` default.',
  '11. Write `verify-expectations.json` in `$PIPELINE_RUN_DIR`.',
  '12. Commit with a wrap-up message',
  '13. Proceed to the phase-trace report',
  'For "On override" and "On stop"',
].join(' ');

test('go-red proof: the pre-fix text (merge in step 6, no step 13) fails the order pin', () => {
  assert.throws(() => assertLedgerBeforeMerge(PRE_FIX), /step 13 must follow step 12/);
});

test('go-red proof: step 13 without its ledger commit fails the order pin', () => {
  const live = read('wrap-up/review-console.md');
  assertLedgerBeforeMerge(live);
  const dropped = live.replace(COMMIT, 'on `deleted` leave that tracked `docs/plans/*-ledger.md` path');
  assert.notStrictEqual(dropped, live);
  assert.throws(() => assertLedgerBeforeMerge(dropped), /step 13 commit must follow step 13 delete-ledger/);
});

test('go-red proof: the step-13 merge moved ahead of its delete-ledger mention fails the order pin', () => {
  const live = read('wrap-up/review-console.md');
  assertLedgerBeforeMerge(live);
  const start = live.indexOf(STEP13);
  const deleteAt = live.indexOf('delete-ledger', start);
  const mergeAt = live.indexOf(MERGE, start);
  assert.ok(deleteAt !== -1 && mergeAt > deleteAt);
  // Swap the "First cleanup item 2 … " clause with the merge marker: put the merge marker first.
  const permuted = live.slice(0, start) + live.slice(start, deleteAt) + MERGE + ' ' + live.slice(deleteAt, mergeAt) + live.slice(mergeAt + MERGE.length);
  assert.notStrictEqual(permuted, live);
  assert.throws(() => assertLedgerBeforeMerge(permuted), /step 13 merge must follow step 13 push/);
});

test('go-red proof: the merge re-inserted into step 6 (step 13 intact) fails the step-6 clause', () => {
  const live = read('wrap-up/review-console.md');
  assertLedgerBeforeMerge(live);
  const step6At = live.indexOf('6. Execute cleanup actions');
  const step7At = live.indexOf('7. `Q#` queue writes', step6At);
  assert.ok(step6At !== -1 && step7At > step6At);
  const reinserted = live.slice(0, step7At) + MERGE + ' ' + live.slice(step7At);
  assert.notStrictEqual(reinserted, live);
  assert.throws(() => assertLedgerBeforeMerge(reinserted), /step 6 must not run the pr-first merge/);
});
