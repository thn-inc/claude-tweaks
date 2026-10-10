// tests/dispatch-named-form-exclusion-reasons.test.js — #3084.
//
// Anchored prose-conformance: dispatch/SKILL.md's `#N` and `#N[,#M,#O...]` bullets must explain a
// record missing from dispatch-groups.json by EVERY reason queue-pull-script.md removes candidates
// for — not only `open-pr`. Before #3084 both bullets filtered dispatch-exclusions.json to
// `reason: 'open-pr'`, so a record #3073's not-spec-shaped pass dropped was misreported as having an
// open PR (or not explained at all). Sibling: tests/dispatch-not-spec-shaped-exclusion-fixture.test.js
// (the queue-pull pass itself).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const DISPATCH = path.join(__dirname, '..', 'plugin', 'skills', 'dispatch');
const SKILL = readText(path.join(DISPATCH, 'SKILL.md'));
const OPEN_PR_REPORT = readText(path.join(DISPATCH, 'open-pr-exclusion-report.md'));
const BLOCKED_REPORT = readText(path.join(DISPATCH, 'blocked-exclusion-report.md'));

// Every reason queue-pull-script.md's passes drop a candidate from dispatch-groups.json for.
const REMOVING_REASONS = ['blocked', 'open-pr', 'not-spec-shaped', 'target-missing', 'shipped'];

function bullet(anchor) {
  const line = SKILL.split('\n').find((l) => l.startsWith(anchor));
  assert.ok(line, `${anchor} bullet not found in dispatch/SKILL.md -- anchor out of sync with the live file`);
  return line;
}

const SINGLE = bullet('**`#N`** — direct.');
const LIST = bullet('**`#N[,#M,#O...]`**');

test('dispatch #N names every removing exclusion reason and reports not-spec-shaped with its own remedy, never as an open PR (#3084 AC1)', () => {
  for (const reason of REMOVING_REASONS) {
    assert.ok(SINGLE.includes(`\`${reason}\``), `#N bullet does not name the \`${reason}\` exclusion`);
  }
  assert.ok(SINGLE.includes('not-spec-shaped-exclusion-report.md'), '#N bullet must cite the not-spec-shaped report for its line and remedy');
  assert.ok(SINGLE.includes('never as an open PR'), '#N bullet must rule out the open-PR misreport explicitly');
  assert.ok(!SINGLE.includes("filtered to `reason: 'open-pr'`"), '#N bullet still filters dispatch-exclusions.json to open-pr only');
  assert.ok(SINGLE.includes('and stop'), '#N bullet must still stop after reporting the reason');
  assert.ok(SINGLE.includes('no entry at all as absent from this firing\'s queue'), '#N bullet must say what to report when no exclusion entry names the record');
});

test('blocked-exclusion-report.md renders the target-missing line the #N form points at (#3084)', () => {
  assert.ok(BLOCKED_REPORT.includes("`reason: 'target-missing'`"), 'blocked-exclusion-report.md does not read target-missing entries');
  assert.ok(BLOCKED_REPORT.includes('no longer exists at the integration tip'), 'blocked-exclusion-report.md has no target-missing report line');
});

test('dispatch #N,#M reports a not-spec-shaped member in notFound by name and keeps the rest of the list (#3084 AC2)', () => {
  for (const reason of REMOVING_REASONS) {
    assert.ok(LIST.includes(`\`${reason}\``), `#N,#M bullet does not name the \`${reason}\` exclusion`);
  }
  assert.ok(!LIST.includes("filtered to `reason: 'open-pr'`"), '#N,#M bullet still filters dispatch-exclusions.json to open-pr only');
  assert.ok(LIST.includes('do not abort the rest of the named set'), '#N,#M bullet must still proceed with the rest of the list');
  assert.ok(LIST.includes('named as the `#N` bullet above names it'), '#N,#M bullet must defer its reason lines to the #N bullet');
});

test('open-pr-exclusion-report.md no longer says the named forms read only open-pr entries, and owns their open-PR line (#3084)', () => {
  assert.ok(
    !OPEN_PR_REPORT.includes("filtered to `reason: 'open-pr'`, to report the specific reason"),
    'open-pr-exclusion-report.md still describes the named forms as open-pr-only',
  );
  assert.ok(
    OPEN_PR_REPORT.includes('`#{N} already has an open PR (#{pr}) — not re-dispatch-eligible until that PR merges or closes`'),
    'open-pr-exclusion-report.md must carry the per-record line the #N form renders for an open-PR exclusion',
  );
});
