// tests/dispatch-tidy-named-target-coordination.test.js — #1983: pins the coordination this
// record adds between docs-health's filing and tidy's cleanup sweep, so a docs-health-filed
// ledger correction can never target a file tidy is about to (or already did) delete without
// either side noticing:
//   1. dispatch/queue-pull-script.md excludes a record whose namedTarget is absent at the
//      integration tip, logs an AUTO decision line naming the record and path, and stages one
//      Close (GitHub) proposal per excluded record.
//   2. tidy/scan-procedures.md's ledger Delete recommendation runs a mechanical namedTarget/
//      body-text pass over open records before recommending Delete, bundling any referencing
//      record's Close as a row in the same staged proposal, instead of a "quick judgment read".
//
// Frozen pre-#1983 excerpts (this file's own prior state, read immediately before this record's
// commits) prove each pattern can go red — a rewrite that drops the mechanism fails this suite
// instead of silently shipping a mention-only version of the rule (skill-prose-conformance-tests).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const read = (...p) => fs.readFileSync(path.join(SKILLS, ...p), 'utf8');

const QUEUE_PULL_SCRIPT = read('dispatch', 'queue-pull-script.md');
const SCAN_PROCEDURES = read('tidy', 'scan-procedures.md');

// Pre-#1983 tail of the open-linked-PR exclusion node -e block in
// queue-pull-script.md, immediately followed by the #1579 cross-PR overlap
// report — no named-target exclusion existed between them. Frozen bytes,
// not a live read — see header comment.
const PRE_CHANGE_QUEUE_PULL_TAIL = `" "$DISPATCH_GROUPS" "$DISPATCH_LINKED_PRS" "$DISPATCH_OPEN_PR_EXCLUDED" > "\${DISPATCH_GROUPS}.tmp" && mv "\${DISPATCH_GROUPS}.tmp" "$DISPATCH_GROUPS"

# #1579: cross-PR root-cause overlap report.`;

// Pre-#1983 ledger Delete rule in tidy/scan-procedures.md Step 4 — a "quick
// judgment read", explicitly not a scripted grep. Frozen bytes.
const PRE_CHANGE_LEDGER_RULE = 'Before recommending Delete, also sanity-check that no open work record’s body references the ledger’s filename or feature slug — a quick judgment read, not a scripted grep across every open record (Step 4 stays in the main thread precisely because its rule set is cheap).'
  .replace(/’/g, '\'').replace(/—/g, '—');

function assertPinnedInQueuePull(pattern, message) {
  assert.match(QUEUE_PULL_SCRIPT, pattern, message);
  assert.doesNotMatch(PRE_CHANGE_QUEUE_PULL_TAIL, pattern, `${message} (must NOT match pre-#1983 text — proves the pattern can go red)`);
}

function assertPinnedInScanProcedures(pattern, message) {
  assert.match(SCAN_PROCEDURES, pattern, message);
  assert.doesNotMatch(PRE_CHANGE_LEDGER_RULE, pattern, `${message} (must NOT match pre-#1983 text — proves the pattern can go red)`);
}

test('queue-pull-script.md excludes a record whose namedTarget is absent at the integration tip', () => {
  assertPinnedInQueuePull(/namedTarget\(c\)/, 'reads namedTarget per candidate');
  assertPinnedInQueuePull(/named-target\.js/, 'imports the named-target module');
  assertPinnedInQueuePull(/\['cat-file', '-e', ref \+ ':' \+ target\.path\]/, 'checks existence via git cat-file -e against the resolved path');
});

test('queue-pull-script.md produces dispatch-target-missing-excluded.json and removes excluded candidates from DISPATCH_GROUPS', () => {
  assertPinnedInQueuePull(/dispatch-target-missing-excluded\.json/, 'names the excluded-targets output file');
  assertPinnedInQueuePull(/missingNums\.has\(c\.number\)/, 'filters excluded candidates out of the groups written back to DISPATCH_GROUPS');
});

test('queue-pull-script.md logs the exact AUTO decision line naming the record and absent path', () => {
  assertPinnedInQueuePull(
    /dispatch: #\$\{NUM\} excluded, named target \$\{TPATH\} absent at \$\{INTEGRATION_REF\}/,
    'AUTO log line names the record, path, and integration ref',
  );
});

test("queue-pull-script.md stages one Close (GitHub) proposal per excluded record via the sanctioned stage-item.js writer", () => {
  assertPinnedInQueuePull(/Staged: Close \(GitHub\)/, 'staged proposal uses the Close (GitHub) heading');
  assertPinnedInQueuePull(/\*\*Finding:\*\*/, 'staged proposal carries a Finding field');
  assertPinnedInQueuePull(/\*\*Proposed:\*\*/, 'staged proposal carries a Proposed field');
  assertPinnedInQueuePull(/gh issue close \$\{NUM\}/, 'staged proposal names the gh issue close command');
  assertPinnedInQueuePull(/bin\/stage-item\.js.*--id "dispatch-target-missing-\$\{NUM\}"/, 'writes through stage-item.js, never a direct heredoc into staged/');
});

test('queue-pull-script.md checks target existence at the resolved integration ref, not the working tree', () => {
  assertPinnedInQueuePull(/INTEGRATION_REF="origin\/\$INTEGRATION_BRANCH"/, 'resolves the integration tip as an origin/ ref');
});

test("tidy/scan-procedures.md's ledger Delete rule runs a mechanical namedTarget/body-text pass, not a judgment read", () => {
  assertPinnedInScanProcedures(/namedTarget\(record\)/, 'reads namedTarget per open record');
  assertPinnedInScanProcedures(/bin\/lib\/issues\/named-target\.js/, 'cites the named-target module');
  assertPinnedInScanProcedures(/referencing record/, 'names the referencing-record concept');
});

test("tidy/scan-procedures.md bundles a referencing record's Close as a row in the same staged Delete proposal", () => {
  assertPinnedInScanProcedures(
    /the same staged proposal additionally lists one Close row per referencing record/,
    'states the bundling rule',
  );
  assertPinnedInScanProcedures(
    /No ledger is ever recommended Delete while a referencing record stays open and unproposed/,
    'states the never-orphan-a-referencing-record invariant',
  );
});
