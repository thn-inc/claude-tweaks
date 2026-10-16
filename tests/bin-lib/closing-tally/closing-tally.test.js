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
  const text = [
    '## /backlog',
    '- AUTO 10:00:01 — Backlog refine: set priority:high on #20.',
    '- AUTO 10:00:02 — Backlog refine: granted auto:build to #21 (risk:low, size:low). Rationale: narrow fix.',
    '- AUTO 10:00:03 — Backlog refine: skipped #22 — premise changed since confirmation (concurrent grant agreed: live auto:build, this run RECOMMEND_MERGE=false); dropped without writing.',
    '- AUTO 10:00:04 — Backlog refine: skipped #23 — premise changed since confirmation (concurrent grant DIVERGED: live auto:build + auto:merge, this run discarded RECOMMEND_MERGE=false — touches a shared contract); dropped without writing.',
    '- AUTO 10:00:05 — Backlog refine: skipped #24 — premise changed since confirmation (lost ready label); dropped without writing.',
  ].join('\n');
  const { counts, unclassified } = computeClosingTally(text);
  assert.strictEqual(counts.skipped, 3);
  assert.strictEqual(counts.priority, 1);
  assert.strictEqual(counts.granted, 1);
  assert.deepStrictEqual(unclassified, []);
});
