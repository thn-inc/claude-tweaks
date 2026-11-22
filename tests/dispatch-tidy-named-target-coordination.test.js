// tests/dispatch-tidy-named-target-coordination.test.js — #1983: pins the coordination this
// record adds between docs-health's filing and tidy's cleanup sweep, so a docs-health-filed
// ledger correction can never target a file tidy is about to (or already did) delete without
// either side noticing:
//   1. the dispatch queue pull excludes a record whose namedTarget is absent at the integration
//      tip, logs an AUTO decision line naming the record and path, and stages one Close (GitHub)
//      proposal per excluded record. #5230: that is the queue-pull module's target-missing pass,
//      whose AUTO line, staged body and id, `git cat-file -e <ref>:<path>` probe and origin/ ref are
//      pinned in tests/bin-lib/dispatch/queue-pull.test.js (the AC2.1 target-missing tests and the
//      integration-branch portability test); this file keeps only the registry row.
//   2. tidy/scan-procedures.md's ledger Delete recommendation runs a mechanical namedTarget/
//      body-text pass over open records before recommending Delete, bundling any referencing
//      record's Close as a row in the same staged proposal, instead of a "quick judgment read".
//
// A frozen pre-#1983 excerpt (this file's own prior state, read immediately before this record's
// commits) proves each scan-procedures pattern can go red — a rewrite that drops the mechanism
// fails this suite instead of silently shipping a mention-only version of the rule
// (skill-prose-conformance-tests).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { PASSES } = require('../plugin/bin/lib/dispatch/queue-pull');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const read = (...p) => readText(path.join(SKILLS, ...p));

const SCAN_PROCEDURES = read('tidy', 'scan-procedures.md');

// Pre-#1983 ledger Delete rule in tidy/scan-procedures.md Step 4 — a "quick
// judgment read", explicitly not a scripted grep. Frozen bytes.
const PRE_CHANGE_LEDGER_RULE = 'Before recommending Delete, also sanity-check that no open work record’s body references the ledger’s filename or feature slug — a quick judgment read, not a scripted grep across every open record (Step 4 stays in the main thread precisely because its rule set is cheap).'
  .replace(/’/g, '\'').replace(/—/g, '—');

function assertPinnedInScanProcedures(pattern, message) {
  assert.match(SCAN_PROCEDURES, pattern, message);
  assert.doesNotMatch(PRE_CHANGE_LEDGER_RULE, pattern, `${message} (must NOT match pre-#1983 text — proves the pattern can go red)`);
}

test('the queue pull carries the target-missing exclusion: a removing reason with no #N bypass, run after the open-PR exclusion', () => {
  const at = PASSES.findIndex((p) => p.reason === 'target-missing');
  assert.ok(at !== -1, 'PASSES has no target-missing row');
  assert.deepEqual(PASSES[at], { ...PASSES[at], kind: 'exclusion', removes: true, bypass: false });
  assert.ok(PASSES.findIndex((p) => p.reason === 'open-pr') < at, 'target-missing runs after the open-PR exclusion');
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
