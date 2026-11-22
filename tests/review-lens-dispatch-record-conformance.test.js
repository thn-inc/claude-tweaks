// tests/review-lens-dispatch-record-conformance.test.js — pins #5998: review Step 3 records every agent
// lens's dispatch through `review-coordination.js record-lens-dispatch`, on the Task path and the workflow
// path alike, with the mapping of outcome to --status/--path/--reviewers the lens history's denominator needs.
// The FROZEN_* constants are the pre-change bytes the edits replaced; each helper must throw on them.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { STATUSES, PATHS } = require('../plugin/bin/lib/review-lens/dispatch-record');
const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');

const REVIEW = path.join(__dirname, '..', 'plugin', 'skills', 'review');
const DISPATCH = path.join(REVIEW, 'step3-lens-dispatch.md');
const RECORD = path.join(REVIEW, 'step3-lens-dispatch-record.md');
const WORKFLOW = path.join(REVIEW, 'step3-workflow-dispatch.md');
const POINTER = 'step3-lens-dispatch-record.md';

const FROZEN_DISPATCH = "> **Parallel execution (conditional):** At `medium` and above, when the diff spans 10+ files, dispatch each applicable lens (3a-3g) as a **reproduction pair** — 2 identical agents per lens (up to 14 Task agents total: 7 reproduction lenses × 2, at `high`+ where 3g is in scope — fewer at `medium`, where 3g is not yet in scope). When the diff is smaller, run each lens as a 2-agent reproduction pair sequentially in the main thread. At `low`, dispatch single agents per `step3-tier-variants.md`'s Low-tier single-read rule instead. Lenses 3g-cov, 3h, and 3i are not dispatched as reproduction pairs — they run as single agents (3h) or main-thread procedures (3g-cov, 3i). Dispatch shape: single-assistant-message rule (the composed review-dispatch bundle's, or standalone `_shared/subagent-dispatch-core.md`'s, fan-out section) applies.\n>\n> **Reproduction dispatch (Mode 1 — per lens):** For each lens, dispatch 2 agents in one batch with **byte-identical prompts** (same scope, same Template-A contract, same model profile). Independent runs — no agent sees the other's output. After both return, resolve the pair's paths with one plain call — `node \"${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js\" A=review-{ctx-id}-lens-{LENS}-agentA.json B=review-{ctx-id}-lens-{LENS}-agentB.json H=review-{ctx-id}-lens-{LENS}-hold.json J=review-{ctx-id}-lens-{LENS}-judgment.json` — `Write` each agent's `findings` array to its printed path with the `Write` tool, and call with the literal printed paths as `{path-A}` and `{path-B}` (no shell variable survives across calls):";
const FROZEN_SETTLE = "## Settle\n\n```bash\nnode \"${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js\" settle-lens-replies \"{run-file}\" --ctx-id \"{ctx-id}\" --run \"$PIPELINE_RUN_DIR\" --only confirmed\n```\n\nIt writes every settled lens's `confirmed` pair lines under `## /review` and prints `{settled, needsSession, violations, overflow, skipped}`; each `settled` entry is `{lens, confirmed, unconfirmed, entries, logged}`, the shape a Task pair's `categorise-reproduction` call prints, and `logged: false` is handled as the Task path handles it. Exit 2 is fallback condition 5. Exit 3 means the run directory is unanchored or missing, and is never a fallback condition: the fallback's own `SKIP` write and every Task-path `categorise-reproduction --run` call would exit 3 too. Re-resolve `$PIPELINE_RUN_DIR` per `_shared/pipeline-run-dir.md` and re-run this first call once, and when it exits 3 again, never take the fallback — re-run the call standalone (no `--run`, `--only` or `--hold`; nothing is logged), continue with its output, and name in the review summary that the run directory was unusable and the pair lines were not logged. Then, in this order:\n\n1. Bring every `needsSession` lens to its pair verdict (the next section).\n2. Run the absence-claim ground-truth check and the lens 3f vacuity check over every settled lens (a lens brought to its verdict in step 1 ran them in its Task per-pair steps; a settled lens's findings are its `confirmed` and `unconfirmed` lists in the first call's output), and at `medium` the cross-lens corroboration pass, exactly as `step3-lens-dispatch.md` orders them for a Task pair — its \"An unpaired absence claim gets a ground-truth check\" and \"Lens 3f vacuity findings need execution evidence\" bullets, then `step3-cross-lens-corroboration.md`. A judgment file is resolved per lens with that file's `J=review-{ctx-id}-lens-{LENS}-judgment.json` name.\n3. Make the second call:\n\n```bash\nnode \"${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js\" settle-lens-replies \"{run-file}\" --ctx-id \"{ctx-id}\" --run \"$PIPELINE_RUN_DIR\" --only unconfirmed\n```\n\nAdd `--hold \"{path-H}\"` when the absence check refuted or corroboration promoted a finding of a settled lens: resolve `H=review-{ctx-id}-workflow-hold.json` with `session-tmp-resolve.js`, and `Write` there a JSON array of those whole `unconfirmed` entries from the first call's output, each with its lens added as `lens`. An exit 2 on this second call is never condition 5: the confirmed lines are already logged, so it means the hold file is wrong — an entry that matches no `unconfirmed` finding or two, or names a lens that did not settle. Fix the hold file and re-run this call; never take the fallback here. An exit 3 on this second call is not condition 5 either: re-resolve `$PIPELINE_RUN_DIR` per `_shared/pipeline-run-dir.md` and re-run this call once, and when it exits 3 again, never take the fallback — carry each settled lens's `unconfirmed` list from the first call's output on to Step 3.7 and name the unlogged `--only unconfirmed` lines in the review summary. A lens brought to its verdict through `categorise-reproduction` makes its own `--only unconfirmed` call, as the Task path does.\n\nStandalone (no run directory): one call with neither `--run`, `--only` nor `--hold`; nothing is logged, and `log-reproduction-judgment` is skipped, as on the Task path. Name every `violations` entry (a reply whose status line is misplaced or missing — a contract violation) in the review summary.\n";
const FROZEN_SINGLE = "**`single-reviewer`.** At `low`, apply `step3-tier-variants.md`'s Low-tier single-read rule to the findings at `findingsPath`: every finding enters `unconfirmed`, with that rule's per-finding line, and goes to the tiebreak. Nothing is dispatched again and no `SKIP` line is written. When that one reviewer is unusable, it is handled as `reviewer-unusable` below handles one side (one Task re-dispatch, one `SKIP` line), and the single-read rule applies to the new reply.";
const FROZEN_STATUS = "  - `completed` — the lens reached its pair verdict from two usable replies (its `categorise-reproduction --only confirmed` call ran, or `settle-lens-replies` listed it under `settled`), or a single-reviewer lens (low tier, 3h) returned a usable reply.\n  - `blocked` — a reviewer replied `BLOCKED` or `NEEDS_CONTEXT` and the lens reached no pair verdict.";

function assertPointerAfterParallelNote(text) {
  const marker = '> **Parallel execution (conditional):**';
  const at = text.indexOf(marker);
  assert.ok(at >= 0, 'Parallel execution note not found');
  const paragraphs = text.slice(at).split('\n>\n');
  assert.ok(paragraphs[1] && paragraphs[1].includes(POINTER), 'the paragraph after the Parallel execution note must name ' + POINTER);
  assert.equal(text.split(POINTER).length - 1, 1, POINTER + ' must appear exactly once');
}

function settleSection(text) {
  const a = text.indexOf('## Settle');
  assert.ok(a >= 0, '## Settle not found');
  const b = text.indexOf('\n## ', a + 5);
  return b < 0 ? text.slice(a) : text.slice(a, b);
}

function assertSettleRecords(text) {
  const settle = settleSection(text);
  assert.ok(settle.includes('record-lens-dispatch'), 'Settle must record through record-lens-dispatch');
  assert.ok(settle.includes('--path workflow'), 'Settle must pass --path workflow');
}

function assertSingleReviewerRecords(text) {
  const single = text.split('\n').find((l) => l.startsWith('**`single-reviewer`.**'));
  assert.ok(single, 'single-reviewer paragraph not found');
  assert.ok(single.includes('--reviewers 1'), 'single-reviewer paragraph must pass --reviewers 1');
}

function assertBlockedRule(text) {
  assert.ok(/`blocked` — either reviewer's final reply was `BLOCKED` or `NEEDS_CONTEXT`, even when `categorise-reproduction` still ran/.test(text), 'blocked rule missing');
  assert.ok(/`completed` — both of a pair's final replies were `DONE` or `DONE_WITH_CONCERNS`/.test(text), 'completed rule missing');
}

test('AC8.1: step3-lens-dispatch.md points at the record sub-file', () => {
  assertPointerAfterParallelNote(readText(DISPATCH));
  assert.throws(() => assertPointerAfterParallelNote(FROZEN_DISPATCH));
});

test('AC8.1: the sub-file covers the single-agent shapes', () => {
  const t = readText(RECORD);
  assert.match(t, /3h[^\n]*--path task[^\n]*--reviewers 1/);
  assert.ok(t.includes('step3-tier-variants.md'));
});

test('AC8.1: step3-workflow-dispatch.md records settled lenses through the CLI', () => {
  const live = readText(WORKFLOW);
  assertSettleRecords(live);
  assertSingleReviewerRecords(live);
  // Each assertion goes red on its own: a live-text variant that drops only the verb name, or only `--path workflow`.
  const settle = settleSection(live);
  assert.ok(settle.includes('--path workflow') && settle.includes('record-lens-dispatch'));
  assert.throws(() => assertSettleRecords(live.replace(settle, settle.replaceAll('record-lens-dispatch', ''))), /Settle must record through record-lens-dispatch/);
  assert.throws(() => assertSettleRecords(live.replace(settle, settle.replaceAll('--path workflow', ''))), /Settle must pass --path workflow/);
  assert.throws(() => assertSettleRecords(FROZEN_SETTLE));
  assert.throws(() => assertSingleReviewerRecords(FROZEN_SINGLE));
});

test('the sub-file pins the blocked/completed ruling for a pair with a blocked reviewer', () => {
  const live = readText(RECORD);
  assertBlockedRule(live);
  assert.throws(() => assertBlockedRule(FROZEN_STATUS));
  // Each assertion goes red on its own: a live-text variant that drops only one clause.
  const without = (clause) => { assert.ok(live.includes(clause), clause); return live.replaceAll(clause, ''); };
  assert.throws(() => assertBlockedRule(without("either reviewer's final reply was `BLOCKED` or `NEEDS_CONTEXT`, even when `categorise-reproduction` still ran")), /blocked rule missing/);
  assert.throws(() => assertBlockedRule(without("both of a pair's final replies were `DONE` or `DONE_WITH_CONCERNS`")), /completed rule missing/);
});

test('AC8.1: the sub-file names every status, path and reviewers value and the verb', () => {
  const t = readText(RECORD);
  for (const s of ['record-lens-dispatch', '--status', 'completed', 'failed', 'blocked', 'task', 'workflow', '--reviewers', '--round', '$PIPELINE_RUN_DIR']) {
    assert.ok(t.includes(s), 'missing ' + s);
  }
});

test("the sub-file's flag values are the verb's", () => {
  const t = readText(RECORD);
  const cmd = t.split('\n').find((l) => l.includes('record-lens-dispatch --run'));
  assert.ok(cmd, 'command line not found');
  const listed = (flag) => {
    const m = cmd.match(new RegExp(flag + ' \\{([^}]*)\\}'));
    assert.ok(m, flag + ' placeholder not found');
    return m[1].split('|');
  };
  assert.deepEqual(listed('--status').sort(), [...STATUSES].sort());
  assert.deepEqual(listed('--path').sort(), [...PATHS].sort());
});

test('step3-lens-dispatch.md stays under the read rail', () => {
  assert.ok(fs.statSync(DISPATCH).size <= RAIL_BYTES);
});
