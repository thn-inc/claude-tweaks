'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  FIELDS, computeClosingTally, renderTallyLine,
} = require('../../../plugin/bin/lib/closing-tally/closing-tally');

// #2729: a fixture decisions.md carrying one of each documented
// refine-closing-summary.md write-type line, plus a FAILED line and a
// skipped line — the mechanical count must match a hand-count of this
// fixture exactly.
const FIXTURE_DECISIONS = `## /backlog
- AUTO 10:00:00 — Backlog refine: set priority:high on #1.
- AUTO 10:00:01 — Backlog refine: set priority:medium on #2.
- AUTO 10:00:02 — Backlog refine: updated **Related:** on #3 to reference #4.
- AUTO 10:00:03 — Backlog refine: granted auto:build to #5 (risk:low, size:low). Rationale: small fix.
- AUTO 10:00:04 — Backlog refine: re-authorized #6 — stripped bot:blocked, granted auto:build.
- AUTO 10:00:05 — Backlog refine: flagged back #7 — needs scoring.
- AUTO 10:00:06 — Backlog refine: repaired dependency on #8 — wired native blocked-by referencing #9.
- AUTO 10:00:07 — Backlog refine: stamped needs:decision on #10 — ambiguous RATIONALE.
- AUTO 10:00:08 — Backlog refine: skipped #11 — premise changed since confirmation (lost ready label); dropped without writing.
- FAILED 10:00:09 — Backlog refine: priority write failed on #12: gh exited 1.
`;

test('computeClosingTally: matches a hand-count of the fixture, one of each documented type', () => {
  const { counts, unclassified } = computeClosingTally(FIXTURE_DECISIONS);
  assert.deepEqual(counts, {
    priority: 2,
    related: 1,
    granted: 2, // one "granted auto:build" + one "re-authorized"
    flaggedBack: 1,
    dependencyRepair: 1,
    needsDecision: 1,
    skipped: 1,
    failed: 1,
  });
  assert.deepEqual(unclassified, []);
});

test('computeClosingTally: counts every enumerated field, even at zero', () => {
  const { counts } = computeClosingTally('## /backlog\n');
  for (const field of FIELDS) assert.equal(counts[field], 0, field);
});

test('computeClosingTally: ignores non-Backlog-refine decisions.md lines (claim logs, other sections)', () => {
  const text = '## /flow\n- AUTO 09:00:00 — Step 2.8: claimed #42. Reversibility: high.\n';
  const { counts, unclassified } = computeClosingTally(text);
  for (const field of FIELDS) assert.equal(counts[field], 0, field);
  assert.deepEqual(unclassified, []);
});

test('computeClosingTally: an unrecognized "Backlog refine:" line surfaces as unclassified, never silently dropped or miscounted (AC 2)', () => {
  const text = '## /backlog\n- AUTO 10:00:00 — Backlog refine: collision-reconciled #13 — merged duplicate rows.\n';
  const { counts, unclassified } = computeClosingTally(text);
  for (const field of FIELDS) assert.equal(counts[field], 0, field);
  assert.equal(unclassified.length, 1);
  assert.match(unclassified[0], /collision-reconciled/);
});

test('computeClosingTally: ignores other steps\' own "Backlog refine:"-prefixed narration (batch auto-applied, circuit breaker RESET) rather than flagging it as drift', () => {
  const text = '## /backlog\n'
    + '- AUTO 10:00:00 — Backlog refine: batch auto-applied — 12 rows across 3 lanes, all recommended values.\n'
    + '- AUTO 10:00:01 — Backlog refine: merge-lane circuit breaker RESET by alice (was tripped by #7: too many merges).\n';
  const { counts, unclassified } = computeClosingTally(text);
  for (const field of FIELDS) assert.equal(counts[field], 0, field);
  assert.deepEqual(unclassified, []);
});

test('renderTallyLine: matches refine-closing-summary.md\'s documented tally-line shape', () => {
  const { counts } = computeClosingTally(FIXTURE_DECISIONS);
  assert.equal(
    renderTallyLine(counts),
    '2 priority set · 1 Related updated · 2 granted · 1 flagged back · 1 dependency-repair · 1 needs-decision · 1 skipped · 1 failed',
  );
});

test('renderTallyLine: a fully clean run renders every field at 0', () => {
  const { counts } = computeClosingTally('## /backlog\n');
  assert.equal(
    renderTallyLine(counts),
    '0 priority set · 0 Related updated · 0 granted · 0 flagged back · 0 dependency-repair · 0 needs-decision · 0 skipped · 0 failed',
  );
});

test('#2719 concurrent-grant agreed/DIVERGED skip lines count as skipped, never unclassified', () => {
  const text = `## /backlog
- AUTO 10:00:01 — Backlog refine: set priority:high on #20.
- AUTO 10:00:02 — Backlog refine: granted auto:build to #21 (risk:low, size:low). Rationale: narrow fix.
- AUTO 10:00:03 — Backlog refine: skipped #22 — premise changed since confirmation (concurrent grant agreed: live auto:build, this run RECOMMEND_MERGE=false); dropped without writing.
- AUTO 10:00:04 — Backlog refine: skipped #23 — premise changed since confirmation (concurrent grant DIVERGED: live auto:build + auto:merge, this run discarded RECOMMEND_MERGE=false — touches a shared contract); dropped without writing.
- AUTO 10:00:05 — Backlog refine: skipped #24 — premise changed since confirmation (lost ready label); dropped without writing.
`;
  const { counts, unclassified } = computeClosingTally(text);
  assert.equal(counts.skipped, 3);
  assert.equal(counts.priority, 1);
  assert.equal(counts.granted, 1);
  assert.deepEqual(unclassified, []);
});

// #3267: apply-refine-labels.js logs its own per-action lines, by label, not by lane.
const { run: applyRefineLabels } = require('../../../plugin/bin/apply-refine-labels');

// Drive the real apply-refine-labels.js with fake gh/fs and capture exactly the
// decisions.md lines it writes, so the fixture is the producer's output, not a guess.
function applyLines(actions, { failIssue = null } = {}) {
  const entries = [];
  const code = applyRefineLabels(['actions.json', '--run', '/repo/.claude-tweaks/pipelines/x'], {
    gh: (args) => {
      if (failIssue !== null && args[2] === String(failIssue)) throw new Error('gh exited 1');
      return '';
    },
    ghAvailable: () => true,
    remoteUrl: () => 'https://github.com/acme/widgets.git',
    readFile: () => JSON.stringify(actions),
    cwd: () => '/repo',
    mainRoot: () => '/repo',
    isAnchored: () => true,
    now: () => 1700000000000,
    appendEntry: ({ entry }) => { entries.push(entry); },
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(code, 0);
  return `## /backlog\n${entries.join('\n')}\n`;
}

// The incident run (#3267's Current State), verbatim: apply-refine-labels lines
// AND the refine-closing-summary template lines for the same writes.
const REAL_RUN_2026_10_16 = `## /backlog
- AUTO 19:32:41 — refine confirm-gate: Backlog refine: batch auto-applied — 3 rows across 2 lanes, all recommended values. Reversibility: high. [lever: autonomy=unattended (policy)]
- AUTO 19:32:46 — apply-refine-labels: #3226: applied +auto:build. Reversibility: high.
- AUTO 19:32:50 — apply-refine-labels: #3242: applied +auto:build +priority:medium. Reversibility: high.
- AUTO 19:32:55 — apply-refine-labels: #3225: applied +needs:decision. Reversibility: high.
- AUTO 19:32:58 — apply-refine-labels: #3225: comment posted. Reversibility: high.
- AUTO 19:33:16 — refine apply: Backlog refine: granted auto:build to #3226 (risk:low, size:medium). Rationale: well-specified fail-closed repairable classification; edits agent-instruction prose in dispatch two-call-gate.md and sequential-execution.md, so merge stays human. Reversibility: high.
- AUTO 19:33:16 — refine apply: Backlog refine: granted auto:build to #3242 (risk:low, size:low). Rationale: probe-first, structural-field keyed, falls back to today; edits flow steps-and-gates.md, so merge stays human. Blocked by #3225. Reversibility: high.
- AUTO 19:33:17 — refine apply: Backlog refine: set priority:medium on #3242. Reversibility: high.
- AUTO 19:33:17 — refine apply: Backlog refine: stamped needs:decision on #3225 — PreToolUse deny gate spec carries a contradicted ordering premise (materialize commit precedes config.yml in clean first calls); amend before granting. Reversibility: high.
`;

const ZERO = { priority: 0, related: 0, granted: 0, flaggedBack: 0, dependencyRepair: 0, needsDecision: 0, skipped: 0, failed: 0 };

test('#3267 AC1: a decisions.md written only by apply-refine-labels.js reports the true per-type counts', () => {
  const text = applyLines([
    { issue: 31, addLabels: ['auto:build', 'auto:merge'] },
    { issue: 32, addLabels: ['priority:high'] },
    { issue: 33, addLabels: ['needs:decision'], commentFile: 'nd.md' },
    { issue: 34, removeLabels: ['ready'], commentFile: 'fb.md' },
    { issue: 35, addLabels: ['auto:build'], removeLabels: ['bot:blocked'] },
  ]);
  assert.match(text, /#34: comment posted/);
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, { ...ZERO, granted: 2, priority: 1, needsDecision: 1, flaggedBack: 1 });
  assert.deepEqual(unclassified, []);
});

test('#3267 AC1: an apply-refine-labels FAILED line counts as failed, never unclassified', () => {
  const text = applyLines([
    { issue: 41, addLabels: ['priority:low'] },
    { issue: 42, addLabels: ['auto:build'] },
  ], { failIssue: 42 });
  assert.match(text, /- FAILED .*apply-refine-labels: #42: /);
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, { ...ZERO, priority: 1, failed: 1 });
  assert.deepEqual(unclassified, []);
});

test('#3267 AC1 (real input): the incident run\'s apply-only lines report 2 granted, 1 priority, 1 needs-decision', () => {
  const applyOnly = REAL_RUN_2026_10_16.split('\n')
    .filter((l) => !/Backlog refine:/.test(l))
    .join('\n');
  const { counts, unclassified } = computeClosingTally(applyOnly);
  assert.deepEqual(counts, { ...ZERO, granted: 2, priority: 1, needsDecision: 1 });
  assert.deepEqual(unclassified, []);
});

test('#3267 AC2 (real input): apply lines and template lines for the same writes count each write once', () => {
  const { counts, unclassified } = computeClosingTally(REAL_RUN_2026_10_16);
  assert.deepEqual(counts, { ...ZERO, granted: 2, priority: 1, needsDecision: 1 });
  assert.deepEqual(unclassified, []);
});

test('#3267 AC2: a template FAILED line and an apply FAILED line for the same record count one failure', () => {
  const text = `## /backlog
- FAILED 10:00:00 — apply-refine-labels: #50: +priority:high failed: gh exited 1.
- FAILED 10:00:01 — Backlog refine: priority write failed on #50: gh exited 1.
`;
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, { ...ZERO, failed: 1 });
  assert.deepEqual(unclassified, []);
});

test('#3267 AC3: an unknown /backlog AUTO line with no "Backlog refine:" prefix is listed in unclassified', () => {
  const text = `## /backlog
- AUTO 10:00:00 — refine apply: rewired blocked-by on #60 by hand. Reversibility: high.
- SKIP 10:00:01 — refine apply: no Manual Steps. Reversibility: n/a.
## /flow
- AUTO 10:00:02 — Step 2.8: claimed #61. Reversibility: high.
`;
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, ZERO);
  assert.equal(unclassified.length, 1);
  assert.match(unclassified[0], /rewired blocked-by on #60/);
});

test('#3267: known /backlog narration (Resolve-lane "Backlog refine #N:" lines) is not reported as unclassified', () => {
  const text = `## /backlog
- AUTO 10:00:00 — refine #70: Backlog refine #70: keep — no labels changed. Reversibility: high.
`;
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, ZERO);
  assert.deepEqual(unclassified, []);
});

// #3267 Important 1: a partial flag-back (the `-ready` edit lands, the
// explanatory comment fails) must count once, under `failed` — never also
// under `flaggedBack`, which the edit's own success would otherwise imply.
// The applyLines() fake can only fail a whole action (its gh stub keys on
// the issue number for both the edit and comment calls, and the edit is
// attempted first, so a failIssue failure never reaches the comment step) —
// so this uses literal lines in the producer's exact format instead.
test('#3267 Important 1: partial flag-back (edit lands, comment fails) counts once under failed, not flaggedBack', () => {
  const text = `## /backlog
- AUTO 19:32:50 — apply-refine-labels: #3225: applied -ready. Reversibility: high.
- FAILED 19:33:00 — apply-refine-labels: #3225: comment failed: gh exited 1.
- FAILED 19:33:01 — Backlog refine: flag-back write failed on #3225: gh exited 1.
`;
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, { ...ZERO, flaggedBack: 0, failed: 1 });
  assert.deepEqual(unclassified, []);
});

test('#3267 Important 1: partial needs-decision (edit lands, comment fails) counts once under failed, not needsDecision', () => {
  const text = `## /backlog
- AUTO 19:32:50 — apply-refine-labels: #3225: applied +needs:decision. Reversibility: high.
- FAILED 19:33:00 — apply-refine-labels: #3225: comment failed: gh exited 1.
- FAILED 19:33:01 — Backlog refine: needs-decision write failed on #3225: gh exited 1.
`;
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, { ...ZERO, needsDecision: 0, failed: 1 });
  assert.deepEqual(unclassified, []);
});

// #3267 Important 2: the whole-file dedup must only collapse a template line
// and the apply-refine-labels line describing the SAME write — not two
// genuinely distinct same-source writes that happen to land on the same
// (field, issue) pair.
test('#3267 Important 2: two distinct same-source "failed" writes on the same record both count', () => {
  const text = `## /backlog
- FAILED 10:00:00 — Backlog refine: priority write failed on #50: gh exited 1.
- FAILED 10:00:01 — Backlog refine: Related write failed on #50: gh exited 1.
`;
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, { ...ZERO, failed: 2 });
  assert.deepEqual(unclassified, []);
});

test('#3267 Important 2: two distinct same-source "skipped" writes on the same record both count', () => {
  const text = `## /backlog
- AUTO 10:00:00 — Backlog refine: skipped #51 — premise changed since confirmation (lost ready label); dropped without writing.
- AUTO 10:00:01 — Backlog refine: skipped #51 — premise changed since confirmation (concurrent grant agreed: live auto:build, this run RECOMMEND_MERGE=false); dropped without writing.
`;
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, { ...ZERO, skipped: 2 });
  assert.deepEqual(unclassified, []);
});

test('#3267 Important 2: a template line and the apply-refine-labels line for the same write still collapse to one', () => {
  const text = `## /backlog
- AUTO 10:00:00 — Backlog refine: granted auto:build to #80 (risk:low, size:low). Rationale: small fix.
- AUTO 10:00:01 — apply-refine-labels: #80: applied +auto:build. Reversibility: high.
`;
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, { ...ZERO, granted: 1 });
  assert.deepEqual(unclassified, []);
});

// #3267 Minor 1: apply-refine-labels only ever writes under `## /backlog` —
// a same-shaped AUTO line in another section is not its output, and must be
// neither counted nor flagged as unclassified drift.
test('#3267 Minor 1: an apply-refine-labels-shaped line outside ## /backlog is not counted or unclassified', () => {
  const text = `## /wrap-up
- AUTO 10:00:00 — apply-refine-labels: #90: applied +auto:build. Reversibility: high.
`;
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, ZERO);
  assert.deepEqual(unclassified, []);
});

// #3267 Minor 2: the anchored APPLY_FAILED_RE must win the issue capture
// from the line's own leading prefix, never from the literal text
// "apply-refine-labels: #99:" appearing inside the error message itself.
test('#3267 Minor 2: a FAILED line whose message contains "apply-refine-labels: #99:" counts the real record only', () => {
  const text = `## /backlog
- FAILED 10:00:00 — apply-refine-labels: #50: +priority:high failed: remote said "apply-refine-labels: #99: +priority:low failed: nested" unexpectedly.
- FAILED 10:00:01 — refine apply: Backlog refine: priority write failed on #50 — gh: remote error.
`;
  // The template line names the same #50 write, so the anchored capture
  // collapses the pair to one failure; a capture of #99 from the message
  // would count a second, phantom record.
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, { ...ZERO, failed: 1 });
  assert.deepEqual(unclassified, []);
});
