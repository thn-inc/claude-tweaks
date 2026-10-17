'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REFINE_MODE_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'backlog', 'refine-mode.md');
const refineModeProse = fs.readFileSync(REFINE_MODE_PATH, 'utf8');

// #1512 split the closing-summary block (and the log-line templates/close-run call around it)
// out of refine-mode.md into its own sibling file to keep it lean —
// the same headroom-relief split #1488's Task 7 already did for the RECOMMEND_BUILD: false
// branch (grant-lane-decision.md). The claims below now live there; refine-mode.md keeps only
// a citing pointer.
const CLOSING_SUMMARY_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'backlog', 'refine-closing-summary.md');
const closingSummaryProse = fs.readFileSync(CLOSING_SUMMARY_PATH, 'utf8');

// The pre-change Step 5 text (#741) — no closing-summary block, just the AUTO log-line
// templates followed directly by the Concurrency section. Used below to prove each
// regex actually goes red on the text this change replaces, not just green on the new text.
const PRE_CHANGE_STEP_5_TAIL = `AUTO {time} — Backlog refine: flagged back #{n} — {missing sections | needs scoring}.
\`\`\`

## Concurrency
`;

// One claim per call: the pattern must match the shipped prose (now in refine-closing-summary.md,
// #1512) AND fail against the pre-change text, so a green result proves the regex can actually go
// red [IL-105].
function assertClaimPinned(pattern, missingMessage) {
  assert.match(closingSummaryProse, pattern, missingMessage);
  assert.doesNotMatch(PRE_CHANGE_STEP_5_TAIL, pattern, 'pattern must NOT match the pre-change text (proves it can go red)');
}

test('refine-mode.md Step 5 cites refine-closing-summary.md for logging/closing-summary/run-closure (#1512)', () => {
  assert.match(refineModeProse, /refine-closing-summary\.md/, 'Step 5 must cite refine-closing-summary.md after the #1512 split');
});

test('Step 5 requires a closing summary block rendered as assistant text', () => {
  assertClaimPinned(
    /rendered as assistant text — never delegated to tool output/,
    'closing-summary requirement missing from refine-mode.md Step 5',
  );
});

test('Step 5 closing summary requires a per-type tally line with an always-present failed count', () => {
  assertClaimPinned(
    /`failed` always\s+present, even at zero/,
    'per-type tally / always-present failed-count requirement missing',
  );
});

test('Step 5 closing summary requires a paste-ready retry command per failed write', () => {
  assertClaimPinned(
    /followed by a paste-ready retry\s+command on its own line/,
    'paste-ready retry-command requirement missing',
  );
});

test('Step 5 closing summary requires the absolute run-directory path', () => {
  assertClaimPinned(
    /run-directory path, absolute\*\* — never relative/,
    'absolute run-dir path requirement missing',
  );
});

test('Step 5 closing summary requires an explicit 0 failed on a fully clean run', () => {
  assertClaimPinned(
    /fully clean run still renders `0 failed` explicitly/,
    'unconditional 0-failed rendering requirement missing',
  );
});

test('Step 5 closing summary requires a skipped bucket in the per-type tally, always present', () => {
  assertClaimPinned(
    /`skipped` and `failed` always\s+present, even at zero/,
    'always-present skipped-count requirement missing (#764)',
  );
});

test('Step 5 closing summary requires an explicit 0 skipped on a fully clean run', () => {
  assertClaimPinned(
    /explicitly \(and `0 skipped` alongside it\)/,
    'unconditional 0-skipped rendering requirement missing (#764)',
  );
});
