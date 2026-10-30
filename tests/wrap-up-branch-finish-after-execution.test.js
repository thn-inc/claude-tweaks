'use strict';
// #3813: under pr-first, wrap-up's branch finish (gh pr merge, or leave-open)
// ran at review-console.md's On approval step 13, before Phase 4's execution
// step, so every tree change the execution step made (reference repairs, genre
// convention resolution, cleanup items 1/3/5) and its own commit and
// phase-exit push landed on an already-merged branch. The finish now runs
// once, in execution-and-verification.md's Branch finish paragraph, after
// that step's commit and push and before cleanup item 4 removes the worktree.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (rel) => readText(path.join(SKILLS, rel)).replace(/\s+/g, ' ');

const ORDER_H = '**`integration-model: pr-first` in `worktree` mode — one finish point after the last tree writer (#3813).**';
const FINISH_H = '**Branch finish (`worktree` mode, `integration-model: pr-first`, #3813).**';
const MERGE = "runs `_shared/pr-first-merge.md`'s procedure";

function assertMarksInOrder(text, marks, where) {
  let prev = -1;
  let prevName = 'the start';
  for (const mark of marks) {
    const at = text.indexOf(mark, prev + 1);
    assert.ok(at !== -1 && at > prev, `${where}: "${mark}" must follow ${prevName}`);
    prev = at;
    prevName = `"${mark}"`;
  }
}

function paragraph(text, heading) {
  const start = text.indexOf(heading);
  assert.ok(start !== -1, `paragraph ${heading} not found`);
  const end = text.indexOf(' **', start + heading.length);
  return text.slice(start, end === -1 ? undefined : end);
}

// The order the AC pins: no tree-changing action of execution-and-verification.md, nor
// cleanup items 1, 3 and 5, is ordered after the branch-finish merge.
function assertFinishAfterLastWriter(execText, consoleText) {
  const order = paragraph(execText, ORDER_H);
  assertMarksInOrder(order, ['items 1, 3 and 5', 'apply list', 'commit', 'phase-exit push', 'Branch finish', 'items 4, 6, 7 and 8'], 'ordering paragraph');

  assertMarksInOrder(execText, [
    ORDER_H,
    '- **Reference repairs**',
    '- **Genre convention resolution**',
    'Commit with a message summarizing the wrap-up actions',
    '**Phase exit (any run with a run dir',
    FINISH_H,
    '**Leave-open mergeability re-check',
    '### Verify execution',
  ], 'execution-and-verification.md');

  const finish = paragraph(execText, FINISH_H);
  for (const needle of [MERGE, 'push.state', 'never merge a remote head that lacks', 'MULTISPEC_REVIEW_DEFER=1', 'auto-merge short-circuit', 'Override', 'empty-console fast path', 'items 4, 6, 7 and 8']) {
    assert.ok(finish.includes(needle), `Branch finish must carry ${JSON.stringify(needle)}`);
  }
  assert.ok(finish.indexOf(MERGE) < finish.indexOf('items 4, 6, 7 and 8'), 'items 4, 6, 7 and 8 run after the merge');

  const start = consoleText.indexOf('13. **');
  const end = consoleText.indexOf('14. ', start);
  assert.ok(start !== -1 && end > start, 'review-console.md On approval step 13 must exist');
  const step13 = consoleText.slice(start, end);
  assert.ok(step13.includes('delete-ledger'), 'step 13 keeps cleanup item 2 (after the ledger\'s last writers)');
  assert.ok(!step13.includes('pr-first-merge.md'), 'step 13 must not run the pr-first merge — the execution step\'s Branch finish does');
  assert.ok(!step13.includes('push the branch'), 'step 13 must not push — the execution step\'s phase-exit push carries its commit');
}

test('AC1.1/AC4.1: the pr-first branch finish follows the execution step\'s last tree writer, commit and push', () => {
  assertFinishAfterLastWriter(read('wrap-up/execution-and-verification.md'), read('wrap-up/review-console.md'));
});

test('AC1.2 go-red: the merge moved back into console step 13 fails the pin', () => {
  const exec = read('wrap-up/execution-and-verification.md');
  const consoleText = read('wrap-up/review-console.md');
  const at = consoleText.indexOf('14. ', consoleText.indexOf('13. **'));
  const reverted = consoleText.slice(0, at) + `Then push the branch and route: "Approve all + merge" ${MERGE}. ` + consoleText.slice(at);
  assert.throws(() => assertFinishAfterLastWriter(exec, reverted), /step 13 must not/);
});

test('AC1.2 go-red: the Branch finish moved ahead of the execution commit fails the pin', () => {
  const exec = read('wrap-up/execution-and-verification.md');
  const finishAt = exec.indexOf(FINISH_H);
  const finishEnd = exec.indexOf(' **', finishAt + FINISH_H.length);
  const finish = exec.slice(finishAt, finishEnd);
  const without = exec.slice(0, finishAt) + exec.slice(finishEnd);
  const commitAt = without.indexOf('Commit with a message summarizing the wrap-up actions');
  const moved = without.slice(0, commitAt) + finish + ' ' + without.slice(commitAt);
  assert.notStrictEqual(moved, exec);
  assert.throws(() => assertFinishAfterLastWriter(moved, read('wrap-up/review-console.md')), /must follow/);
});

test('go-red: a Branch finish that merges whatever the push did fails the pin', () => {
  const exec = read('wrap-up/execution-and-verification.md');
  const mutated = exec.split('push.state').join('push result');
  assert.notStrictEqual(mutated, exec);
  assert.throws(() => assertFinishAfterLastWriter(mutated, read('wrap-up/review-console.md')), /push\.state/);
});

test('the finish is reached when the execution step has nothing else to do', () => {
  const skill = read('wrap-up/SKILL.md');
  const at = skill.indexOf('### Execute approved actions');
  const section = skill.slice(at, skill.indexOf('### The phase-trace report', at));
  assert.ok(section.includes('still read the file for its Branch finish'), 'the No-actions skip must still run the pr-first Branch finish');
  const fastPath = read('wrap-up/review-console.md');
  const fp = fastPath.slice(fastPath.indexOf('## Empty-console fast path'));
  assert.ok(fp.includes('Branch finish'), 'the empty-console fast path names the Branch finish it still reaches');
});

test('every other step-13 citation now names the execution step\'s Branch finish', () => {
  const sectionC = read('wrap-up/cleanup-procedures-execution.md');
  assert.ok(!sectionC.includes('"On approval" step 13 ran'), 'Section C step 3 no longer says console step 13 merged');
  assert.ok(sectionC.includes("`execution-and-verification.md`'s Branch finish"), 'Section C step 3 names the Branch finish');
  assert.ok(sectionC.includes('Integration model: pr-first — merge already routed by the Review Console'), 'the FYI line text is unchanged');
  const mergeMode = read('wrap-up/merge-mode.md');
  assert.ok(!mergeMode.includes('`review-console.md` step 13'), 'merge-mode step 1 no longer cites console step 13');
  assert.ok(mergeMode.includes("`execution-and-verification.md`'s Branch finish"), 'merge-mode step 1 cites the Branch finish');
  const cleanup = read('wrap-up/cleanup-procedures.md');
  assert.ok(cleanup.includes("`execution-and-verification.md`'s Branch finish"), 'cleanup-procedures.md names the Branch finish');
  const consoleText = read('wrap-up/review-console.md');
  assert.ok(!consoleText.includes('at "On approval" step 13 after step 12'), 'the auto-resolution merge-half sentence no longer names step 13');
});
