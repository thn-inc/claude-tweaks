'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REVIEWED_TIP_RE,
  DELTA_VERDICT_RE,
  movedLineRe,
  releaseBlock,
  parseReleaseLog,
  advanceText,
} = require('../../../plugin/bin/lib/release-tip/check.js');

// Lines 1, 4, 7, 8 and 9 of the archived
// .claude-tweaks/pipelines/archive/2026-10-24T152958-release-standalone/decisions.md,
// copied verbatim (sed -n), not retyped.
const REAL_LINES = [
  "## /release",
  "- AUTO 17:30:52 — Step 3: whole-branch review starting, base v6.152.0..main at reviewed tip 1813941ecfe019b89307ea75526f2c863ffb5e1e (base: lastTag ok); ## /review marker: 0 existing lines. Tree check passed after two ff (5ea8cb7a4->5dfd55005->1813941ec, #4045 landed mid-check). (marker). Reversibility: n/a.",
  "- AUTO 17:55:41 — Step 5: release PR #4054 checks green (test, label-fix-branch success; head 59af8ba15 runs success), title v6.153.0 — same part as Step 4 (minor). origin/main moved 1813941 → 0ecde18 (5 commits: #4048, #4143, #4024, #4039, #4049) before the merge — move 1 of 2; delta review starting, base 1813941ecfe019b89307ea75526f2c863ffb5e1e..main; ## /review marker: 112 existing lines. Main checkout not pulled: it carries a sibling's unstaged run-dir deletions (pull --rebase would refuse) and one local run-dir-only [reconcile] commit (origin/main...HEAD outside run dirs: empty); delta review + test gate run in detached worktree .claude/worktrees/release-gate-6153 at 0ecde186c (== origin/main). Reversibility: n/a. [lever: release-tip-moves=2 (default)]",
  "- AUTO 18:14:17 — Step 5: delta review base 1813941ecfe019b89307ea75526f2c863ffb5e1e..main: review: findings (12 low, staged). Findings staged at staged/review-17.md..review-28.md; at reviewed tip 0ecde186ccb4a2d176d86f359699b006014852e6. (gate evaluation). Reversibility: n/a.",
  "- AUTO 18:14:53 — Step 5: PR-check gate re-entry after delta: #4054 OPEN, CLEAN/MERGEABLE, head 59af8ba15 runs test + Track issue fixes success (rollup green); title still v6.153.0 (minor). Bump part from arrived commits 1813941ec..0ecde186c: minor (#4024 feat; no ! or BREAKING CHANGE) — title rule stands. PR head rendered on 71a3e0d (#4039); 0ecde186c (#4049) is chore-only, release-please run 40109064440 on it succeeded with no re-render, so changelog complete. origin/main still at reviewed tip 0ecde186c; merging. Reversibility: n/a.",
];

const A = '1111111111111111111111111111111111111111';
const B = '2222222222222222222222222222222222222222';
const step3 = (sha) => `- AUTO 09:00:00 — Step 3: whole-branch review starting, base v1.0.0..main at reviewed tip ${sha} (base: lastTag ok). Reversibility: n/a.`;

test('parses the real 2026-10-24 release block', () => {
  const text = [...REAL_LINES, '## /review', '- origin/main moved aaaaaaa → bbbbbbb'].join('\n');
  assert.deepStrictEqual(parseReleaseLog(text, 'main'), {
    reviewedTip: '0ecde186ccb4a2d176d86f359699b006014852e6',
    step3Tip: '1813941ecfe019b89307ea75526f2c863ffb5e1e',
    priorMoves: 1,
    lastDelta: { base: '1813941ecfe019b89307ea75526f2c863ffb5e1e', tip: '0ecde186ccb4a2d176d86f359699b006014852e6' },
    malformedDelta: null,
  });
});

test('the real delta verdict line (archive line 8) matches DELTA_VERDICT_RE; its marker (line 7) does not', () => {
  const m = DELTA_VERDICT_RE.exec(REAL_LINES[3]);
  assert.ok(m, 'the archived delta verdict line must match');
  assert.strictEqual(m[1], '1813941ecfe019b89307ea75526f2c863ffb5e1e');
  assert.strictEqual(m[2], '0ecde186ccb4a2d176d86f359699b006014852e6');
  assert.strictEqual(DELTA_VERDICT_RE.test(REAL_LINES[2]), false, 'the delta marker is not a verdict');
});

test('lastDelta is the last delta verdict after the Step 3 marker', () => {
  const C = '3333333333333333333333333333333333333333';
  const verdict = (base, tip) => `- AUTO 10:00:00 — Step 5: delta review base ${base}..main: review: clean. Findings staged at none; at reviewed tip ${tip}. Reversibility: n/a (gate evaluation).`;
  const before = ['## /release', verdict(C, B), step3(A)];
  assert.strictEqual(parseReleaseLog(before.join('\n'), 'main').lastDelta, null, 'a verdict before Step 3 is not a delta of this review');
  const text = [...before, verdict(A, B), verdict(B, C)].join('\n');
  assert.deepStrictEqual(parseReleaseLog(text, 'main').lastDelta, { base: B, tip: C });
});

test('a short sha after "at reviewed tip" is not a reviewed tip', () => {
  const text = [
    '## /release',
    step3(A),
    '- AUTO 10:00:00 — Step 5: origin/main still at reviewed tip abc1234; merging. Reversibility: n/a (gate evaluation).',
  ].join('\n');
  assert.strictEqual(parseReleaseLog(text, 'main').reviewedTip, A);
});

test('counts every earlier delta marker whatever short sha it names', () => {
  const text = [
    '## /release',
    '- AUTO 08:00:00 — Step 5: origin/main moved 0000000 → 1111111 before the merge.',
    step3(A),
    '- AUTO 10:00:00 — Step 5: origin/main moved 1111111 → 2222222 before the merge — move 1 of 2.',
    '- AUTO 11:00:00 — Step 5: origin/main moved 2222222 → 3333333 before the merge — move 2 of 2.',
  ].join('\n');
  assert.strictEqual(parseReleaseLog(text, 'main').priorMoves, 2);
});

test('no Step 3 marker → nulls and 0', () => {
  const text = ['## /release', '- AUTO 10:00:00 — Step 1: pack read. Reversibility: n/a.'].join('\n');
  assert.deepStrictEqual(parseReleaseLog(text, 'main'), { reviewedTip: null, step3Tip: null, priorMoves: 0, lastDelta: null, malformedDelta: null });
});

test('no Step 3 marker still returns the last reviewed tip a later line carries', () => {
  const verdict = `- AUTO 10:00:00 — Step 5: delta review base ${A}..main: review: clean. Findings staged at none; at reviewed tip ${B}. Reversibility: n/a (gate evaluation).`;
  assert.deepStrictEqual(parseReleaseLog(['## /release', verdict].join('\n'), 'main'), { reviewedTip: B, step3Tip: null, priorMoves: 0, lastDelta: null, malformedDelta: null });
});

test('no ## /release heading → nulls and 0', () => {
  const text = ['## /review', step3(A), '- origin/main moved 1111111 → 2222222'].join('\n');
  assert.deepStrictEqual(releaseBlock(text), []);
  assert.deepStrictEqual(parseReleaseLog(text, 'main'), { reviewedTip: null, step3Tip: null, priorMoves: 0, lastDelta: null, malformedDelta: null });
});

test('branch is regex-escaped', () => {
  assert.strictEqual(movedLineRe('release/1.x').test('origin/release/1.x moved abc1234 → def5678'), true);
  assert.strictEqual(movedLineRe('release/1.x').test('origin/release/1Xx moved abc1234 → def5678'), false);
});

test('a token that merely ends in origin/{branch} is not a counted move', () => {
  assert.strictEqual(movedLineRe('main').test('xorigin/main moved abc1234 → def5678'), false);
  assert.strictEqual(movedLineRe('main').test('refs/remotes/origin/main moved abc1234 → def5678'), false);
  assert.strictEqual(movedLineRe('main').test('Step 5: origin/main moved abc1234 → def5678'), true);
});

test('the last Step 3 marker wins over an earlier one, and only moves after it count', () => {
  const text = [
    '## /release',
    '- AUTO 08:00:00 — Step 5: origin/main moved 0000000 → 1111111 before the merge.',
    step3(A),
    '- AUTO 09:00:00 — Step 5: origin/main moved 1111111 → 2222222 before the merge — move 1 of 2.',
    step3(B),
    '- AUTO 10:00:00 — Step 5: origin/main moved 2222222 → 3333333 before the merge — move 1 of 2.',
  ].join('\n');
  const parsed = parseReleaseLog(text, 'main');
  assert.strictEqual(parsed.step3Tip, B);
  assert.strictEqual(parsed.priorMoves, 1);
});

test('a delta verdict line that names a base and a reviewed tip but does not parse is reported, not skipped', () => {
  const short = `- AUTO 10:00:00 — Step 5: delta review base ${A.slice(0, 9)}..main: review: clean. Findings staged at none; at reviewed tip ${B}. Reversibility: n/a (gate evaluation).`;
  const held = `- AUTO 10:00:00 — Step 5: delta review base ${A}..main: review: blocking. Findings staged at staged/review-1.md. Reversibility: n/a (gate evaluation).`;
  const bad = parseReleaseLog(['## /release', step3(A), short].join('\n'), 'main');
  assert.strictEqual(bad.lastDelta, null);
  assert.strictEqual(bad.malformedDelta, short);
  const fine = parseReleaseLog(['## /release', step3(A), held].join('\n'), 'main');
  assert.strictEqual(fine.malformedDelta, null, 'a held verdict carries no tip clause and is not a delta of the reviewed tip');
});

test('advance text carries the tip and is not a counted move', () => {
  const line = advanceText({ branch: 'main', from: A, to: B, commits: 3 });
  assert.strictEqual(
    line,
    `origin/main advanced 1111111 → 2222222 by run-dir-only commits (3 commits, nothing outside .claude-tweaks/pipelines); no review, not counted; at reviewed tip ${B}`,
  );
  assert.strictEqual(REVIEWED_TIP_RE.exec(line)[1], B);
  assert.strictEqual(movedLineRe('main').test(line), false);
});
