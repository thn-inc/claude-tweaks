// tests/pipeline-smoke-test-verify-prose.test.js
//
// Pins record #2069's prose wiring: pipeline-smoke-test/SKILL.md's Step 4 and
// Step 6 each cite their verify function with a full call signature (a named
// prose citation, not a literal `node -e` shell block -- neither sibling
// convention this mirrors, composeFixesBlock/crossReferenceKeyFiles, uses one
// either). Mirrors tests/specify-decomposition-crossref-prose.test.js's
// two-part pattern: citation-string match + module-export assertion.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKILL = fs.readFileSync(path.join(ROOT, 'plugin/skills/pipeline-smoke-test/SKILL.md'), 'utf8');

test('Step 4 cites verifyClaimRaceOutcome with its full call signature', () => {
  assert.match(SKILL, /verifyClaimRaceOutcome\(attemptRunIds, liveClaim, inProgressLabelCount\)/);
});

test('Step 6 cites verifyCleanupTable with its full call signature', () => {
  assert.match(SKILL, /verifyCleanupTable\(rows\)/);
});

test('the cited verify-claim-race module actually exports verifyClaimRaceOutcome', () => {
  const mod = require('../plugin/bin/lib/smoke-test/verify-claim-race');
  assert.strictEqual(typeof mod.verifyClaimRaceOutcome, 'function');
});

test('the cited verify-cleanup module actually exports verifyCleanupTable', () => {
  const mod = require('../plugin/bin/lib/smoke-test/verify-cleanup');
  assert.strictEqual(typeof mod.verifyCleanupTable, 'function');
});
