'use strict';
// #3595 D1: wrap-up's item 2 unlinks the run's open-items ledger but never
// commits it, so under pr-first the deletion reaches the branch only after
// gh pr merge has squashed the remote head. Item 2 (delete, commit) therefore
// runs at review-console.md's On approval step 13 — after the ledger's last
// writers (steps 7 and 11) and step 12's commit. #3813 moved the push and the
// merge out of step 13 into execution-and-verification.md's Branch finish,
// after the execution step's own commit and phase-exit push.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const readRaw = (rel) => readText(path.join(SKILLS, rel));
const read = (rel) => readRaw(rel).replace(/\s+/g, ' ');

const ITEM2_PARA = "**Item 2 lands before item 4's merge (#3595).**";
const STEP11 = '11. Write `verify-expectations.json`';
const STEP12 = '12. Commit with a wrap-up message';
const STEP13 = '13. **Ledger close-out (`pr-first`, #3595).**';
const MERGE = "runs `_shared/pr-first-merge.md`'s procedure";
const FINISH = '**Branch finish (`worktree` mode, `integration-model: pr-first`, #3813).**';
const EXEC_COMMIT = 'Commit with a message summarizing the wrap-up actions';
const EXEC_PUSH = '**Phase exit (any run with a run dir';
const STEP14 = "14. Proceed to Phase 4's execution step, then the phase-trace report";
const COMMIT = 'on `deleted` commit only that tracked `docs/plans/*-ledger.md` path';

function assertLedgerBeforeMerge(consoleText, execText) {
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
    ['step 14', step14At],
  ];
  for (let i = 0; i < marks.length; i++) {
    assert.ok(
      marks[i][1] !== -1 && (i === 0 || marks[i][1] > marks[i - 1][1]),
      `${marks[i][0]} must follow ${i === 0 ? 'the section start' : marks[i - 1][0]} — item 2's delete and commit follow step 12's commit`,
    );
  }

  // #3813: the push that carries step 13's commit, and the merge, run in the execution step.
  const finishAt = execText.indexOf(FINISH);
  const execMarks = [
    ['execution commit', execText.indexOf(EXEC_COMMIT)],
    ['phase-exit push', execText.indexOf(EXEC_PUSH)],
    ['Branch finish', finishAt],
    ['Branch finish merge', finishAt === -1 ? -1 : execText.indexOf(MERGE, finishAt)],
  ];
  for (let i = 0; i < execMarks.length; i++) {
    assert.ok(
      execMarks[i][1] !== -1 && (i === 0 || execMarks[i][1] > execMarks[i - 1][1]),
      `${execMarks[i][0]} must follow ${i === 0 ? 'the file start' : execMarks[i - 1][0]} — the push carrying step 13's commit precedes the pr-first merge`,
    );
  }
  assert.ok(execText.includes('never merge a remote head that lacks'), 'the Branch finish must skip the merge when the push did not land');

  assert.ok(step13.includes('when it survived the Condition filter'), 'step 13 must gate item 2 on its Condition (a non-final interactive multi-spec spec skips it)');
  assert.ok(step13.includes('any `open` row leaves the ledger in place'), 'step 13 must leave a ledger with open rows in place');
  assert.ok(!step13.includes(MERGE), 'step 13 must not run the pr-first merge — the execution step\'s Branch finish does, after its own commit and push');

  const step6 = approval.slice(approval.indexOf('6. Execute cleanup actions'), approval.indexOf('7. `Q#` queue writes'));
  assert.ok(step6.length > 0 && !step6.includes('pr-first-merge.md'), 'step 6 must not run the pr-first merge — it runs at the execution step\'s Branch finish, after the ledger\'s last writers');
}

const EXEC = () => read('wrap-up/execution-and-verification.md');

test('AC1.1: cleanup item 2 deletes at On approval step 13 under pr-first, committing only a tracked docs/plans ledger', () => {
  const raw = readRaw('wrap-up/cleanup-procedures.md');
  const text = read('wrap-up/cleanup-procedures.md');
  assert.ok(text.includes(ITEM2_PARA), 'item 2 paragraph must exist');
  assert.ok(text.includes('On approval" step 13'), 'paragraph must name On approval step 13');
  assert.ok(text.includes('only a tracked `docs/plans/*-ledger.md`'), 'commit limited to a tracked docs/plans ledger');
  assert.ok(text.includes('log one `SKIP` line'), 'non-deleted reports log a SKIP line');
  assert.ok(text.includes('The verb logs the `SKIP` line itself for the first four (`condition: delete-ledger reported {report} → fallback: ledger left on disk, nothing committed for item 2`)'), 'the verb-logged reports and their text match hooks.js delete-ledger');
  assert.match(text, /`not found` is a no-op/);
  assert.match(raw, /\| 2 \| Open items ledger \|[^\n]*?then commit only that path/);
});

test('AC1.1: item 2 commits at step 13 after step 12; the push and the pr-first merge follow in the execution step', () => {
  assertLedgerBeforeMerge(read('wrap-up/review-console.md'), EXEC());
});

test('AC1.1: Section C step 3 names the Branch finish as the pr-first merge, not a console step', () => {
  const text = read('wrap-up/cleanup-procedures-execution.md');
  assert.ok(text.includes('Branch finish ran `_shared/pr-first-merge.md` directly'));
  assert.ok(!text.includes('"On approval" step 6 ran `_shared/pr-first-merge.md`'));
  assert.ok(!text.includes('"On approval" step 13 ran `_shared/pr-first-merge.md`'));
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
  assert.throws(() => assertLedgerBeforeMerge(PRE_FIX, EXEC()), /step 13 must follow step 12/);
});

test('go-red proof: step 13 without its ledger commit fails the order pin', () => {
  const live = read('wrap-up/review-console.md');
  assertLedgerBeforeMerge(live, EXEC());
  const dropped = live.replace(COMMIT, 'on `deleted` leave that tracked `docs/plans/*-ledger.md` path');
  assert.notStrictEqual(dropped, live);
  assert.throws(() => assertLedgerBeforeMerge(dropped, EXEC()), /step 13 commit must follow step 13 delete-ledger/);
});

test('go-red proof: the merge re-inserted into step 13 fails the order pin', () => {
  const live = read('wrap-up/review-console.md');
  assertLedgerBeforeMerge(live, EXEC());
  const step14At = live.indexOf(STEP14);
  const reinserted = live.slice(0, step14At) + MERGE + ' ' + live.slice(step14At);
  assert.notStrictEqual(reinserted, live);
  assert.throws(() => assertLedgerBeforeMerge(reinserted, EXEC()), /step 13 must not run the pr-first merge/);
});

test('go-red proof: the Branch finish moved ahead of the phase-exit push fails the order pin', () => {
  const exec = EXEC();
  assertLedgerBeforeMerge(read('wrap-up/review-console.md'), exec);
  const finishAt = exec.indexOf(FINISH);
  const pushAt = exec.indexOf(EXEC_PUSH);
  const leaveOpenAt = exec.indexOf('**Leave-open mergeability re-check');
  assert.ok(pushAt !== -1 && finishAt > pushAt && leaveOpenAt > finishAt);
  const moved = exec.slice(0, pushAt) + exec.slice(finishAt, leaveOpenAt) + exec.slice(pushAt, finishAt) + exec.slice(leaveOpenAt);
  assert.notStrictEqual(moved, exec);
  assert.throws(() => assertLedgerBeforeMerge(read('wrap-up/review-console.md'), moved), /Branch finish must follow phase-exit push/);
});

test('go-red proof: the merge re-inserted into step 6 (step 13 intact) fails the step-6 clause', () => {
  const live = read('wrap-up/review-console.md');
  assertLedgerBeforeMerge(live, EXEC());
  const step6At = live.indexOf('6. Execute cleanup actions');
  const step7At = live.indexOf('7. `Q#` queue writes', step6At);
  assert.ok(step6At !== -1 && step7At > step6At);
  const reinserted = live.slice(0, step7At) + MERGE + ' ' + live.slice(step7At);
  assert.notStrictEqual(reinserted, live);
  assert.throws(() => assertLedgerBeforeMerge(reinserted, EXEC()), /step 6 must not run the pr-first merge/);
});
