'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const REFINE_MODE_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'backlog', 'refine-mode.md');
const refineModeProse = readText(REFINE_MODE_PATH);

// The pre-change Step 5 opening (#764) — narration-allowance line followed directly by the
// Priority/Related write block, no reverify subsection between them. Used below to prove each
// regex actually goes red on the text this change replaces, not just green on the new text.
const PRE_CHANGE_STEP_5_HEAD = `## Step 5: Apply

*(Narration allowance: no "running"/"passed" line for this step — only the run's one opening line and any failure/degradation line; the closing summary below is the report, not narration.)*

**Priority/Related rows:** For every record the priority decision resolved to apply:
`;

// One claim per call: the pattern must match the shipped prose AND fail against the
// pre-change text, so a green result proves the regex can actually go red [IL-105].
function assertClaimPinned(pattern, missingMessage) {
  assert.match(refineModeProse, pattern, missingMessage);
  assert.doesNotMatch(PRE_CHANGE_STEP_5_HEAD, pattern, 'pattern must NOT match the pre-change text (proves it can go red)');
}

test('Step 5 re-fetches live labels immediately before writing a row', () => {
  assertClaimPinned(
    /re-fetch that record's live labels/,
    'pre-write live-label re-fetch missing from refine-mode.md Step 5',
  );
});

test('Step 5 compares live state against the row\'s Step 1 premise, not a re-derived value', () => {
  assertClaimPinned(
    /compare against the row's own premise/,
    'premise-comparison requirement missing from refine-mode.md Step 5',
  );
});

test('Step 5 drops a row whose premise no longer holds instead of writing it', () => {
  assertClaimPinned(
    /drop it from this write/,
    'drop-on-stale-premise requirement missing from refine-mode.md Step 5',
  );
});

test('Step 5 states this as a general rule for other batch-confirm-then-apply flows', () => {
  assertClaimPinned(
    /[Aa]ny batch-confirm-then-apply flow with a long-lived `AskUserQuestion` gate/,
    'general-rule statement missing from refine-mode.md Step 5',
  );
});

test('Step 5 cross-references tidy\'s existing identical pattern', () => {
  // #843 extracted the shared rationale into skills/_shared/reverify-before-write.md;
  // refine-mode.md now cites that contract instead of restating "already applies the
  // identical rule" inline, but the tidy cross-reference (naming step-6-auto.md as the
  // sibling instance) survives as consumer-owned wording — still pinned here.
  assertClaimPinned(
    /Step 6 auto-apply table[\s\S]{0,150}step-6-auto\.md[\s\S]{0,150}identical rule/,
    'cross-reference to skills/tidy/step-6-auto.md missing from refine-mode.md Step 5',
  );
});

test('Step 5 cites the shared reverify-before-write contract', () => {
  assertClaimPinned(
    /_shared\/reverify-before-write\.md/,
    'citation of _shared/reverify-before-write.md missing from refine-mode.md Step 5',
  );
});
