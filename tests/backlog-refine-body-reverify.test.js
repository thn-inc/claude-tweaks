'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const REFINE_MODE_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'backlog', 'refine-mode.md');
const refineModeProse = readText(REFINE_MODE_PATH);

// #842: the label-only pre-write reverify (#764) left the Related-rows and dependency-repair
// body-text writes rewriting a record's full body from a Step 1 fetch that could be hours stale
// by Step 5's write, with nothing re-checking the body itself. This is the pre-change text
// spanning the gap where the new body-reverify paragraph now lives — no body re-fetch, no
// verbatim compare, straight from the label reverify's local-files closer into "General rule."
// Used below to prove each regex actually goes red on the text this change replaces, not just
// green on the new text.
const PRE_CHANGE_STEP_5_MID = `Local-files driver: the equivalent re-read is \`readRecord(path).facets\` immediately before \`writeRecord\` — same skip-on-mismatch rule, since a concurrent session's edit to the tracked file is exactly the same class of stale-premise race as a concurrent GitHub label write; a \`readRecord\` failure (missing/corrupt file) skips the same way — don't write.

**General rule.** Any batch-confirm-then-apply flow with a long-lived \`AskUserQuestion\` gate between building a row's premise and writing it needs this same pre-write reverify.
`;

// Pre-change Related-rows write — no trailing reverify clause.
const PRE_CHANGE_RELATED_ROW = `For every record the \`**Related:**\` decision resolved to apply, replace the existing \`**Related:** {...}\` line in the body (github: \`gh issue edit "$ISSUE" --body-file\`, rewriting the fetched body with the line replaced; local-files, and any \`facets.unsynced === true\` record regardless of driver: \`writeRecord\` with the updated body against the record's \`.path\`, followed by the same \`git add\`/\`git commit\` step).
`;

// Pre-change dependency-repair body-text bullet — no trailing reverify clause.
const PRE_CHANGE_DEP_REPAIR_ROW = `- **\`work-links: body-text\`**: append a canonical line-start \`Blocked by #N\` line to the record body (\`gh issue edit --body-file\` under \`github-issues\`; \`writeRecord\` + \`git add\`/\`git commit\` under \`local-files\`, same as the Related-line path above).
`;

// One claim per call: the pattern must match the shipped prose AND fail against the
// pre-change text, so a green result proves the regex can actually go red [IL-105].
function assertClaimPinned(pattern, preChangeText, missingMessage) {
  assert.match(refineModeProse, pattern, missingMessage);
  assert.doesNotMatch(preChangeText, pattern, 'pattern must NOT match the pre-change text (proves it can go red)');
}

test('Step 5 re-fetches the record\'s live body before a Related-rows or dependency-repair body-text write', () => {
  assertClaimPinned(
    /re-fetch the record's live body/,
    PRE_CHANGE_STEP_5_MID,
    'pre-write live-body re-fetch missing from refine-mode.md Step 5',
  );
});

test('Step 5 compares the live body verbatim against the Step 1-fetched premise', () => {
  assertClaimPinned(
    /compare it verbatim against the Step 1-fetched premise/,
    PRE_CHANGE_STEP_5_MID,
    'verbatim body-premise comparison requirement missing from refine-mode.md Step 5',
  );
});

test('Step 5 skips a body write on mismatch instead of overwriting it', () => {
  assertClaimPinned(
    /Skip the write rather than overwriting it/,
    PRE_CHANGE_STEP_5_MID,
    'skip-on-body-mismatch requirement missing from refine-mode.md Step 5',
  );
});

test('Step 5 reuses the label reverify\'s SKIPPED log line and tally bucket for a body mismatch, rather than a parallel mechanism', () => {
  assertClaimPinned(
    /reuses the label reverify's log line and tally bucket as-is rather than inventing a parallel one/,
    PRE_CHANGE_STEP_5_MID,
    'reuse-not-parallel-mechanism decision missing from refine-mode.md Step 5',
  );
});

test('Step 5 Related-rows write is gated on the body pre-write reverify', () => {
  assertClaimPinned(
    /Run the body pre-write reverify above immediately before this write — a mismatch skips it rather than overwriting\./,
    PRE_CHANGE_RELATED_ROW,
    'body pre-write reverify not wired into the Related-rows write in refine-mode.md Step 5',
  );
});

test('Step 5 dependency-repair body-text write is gated on the body pre-write reverify', () => {
  assertClaimPinned(
    /Run the body pre-write reverify above immediately before this write, the same as the Related-line path — a mismatch skips it\./,
    PRE_CHANGE_DEP_REPAIR_ROW,
    'body pre-write reverify not wired into the dependency-repair body-text write in refine-mode.md Step 5',
  );
});

test('Step 5 dependency-repair native path is explicitly out of scope for the body reverify (writes no body text)', () => {
  assertClaimPinned(
    /work-links: native` path above writes no body text, so it has nothing for this reverify to guard/,
    PRE_CHANGE_DEP_REPAIR_ROW,
    'native-path exclusion note missing from refine-mode.md Step 5',
  );
});
