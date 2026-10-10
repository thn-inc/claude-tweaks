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

const QUEUE_PULL = readText(path.join(DISPATCH, 'queue-pull-script.md'));
const NOT_SPEC_SHAPED_REPORT = readText(path.join(DISPATCH, 'not-spec-shaped-exclusion-report.md'));

// Every reason queue-pull-script.md's passes drop a candidate from dispatch-groups.json for, read from
// its own `- \`reason: '...'\`` bullets (#3087): a bullet whose entries stay IN dispatch-groups.json
// (today `oversized`) is not a removing reason. A reason added to the script is checked here unedited.
const REMOVING_REASONS = QUEUE_PULL.split('\n')
  .map((line) => ({ line, m: line.match(/^- `reason: '([a-z-]+)'`/) }))
  .filter(({ m }) => m)
  .filter(({ line }) => !line.includes('stay IN `dispatch-groups.json`'))
  .map(({ m }) => m[1]);

test('REMOVING_REASONS is derived from queue-pull-script.md, non-empty, and excludes oversized (#3087)', () => {
  assert.ok(REMOVING_REASONS.length >= 5, `derived only ${JSON.stringify(REMOVING_REASONS)} -- the bullet pattern no longer matches queue-pull-script.md`);
  assert.ok(REMOVING_REASONS.includes('not-spec-shaped'));
  assert.ok(!REMOVING_REASONS.includes('oversized'), 'oversized groups stay in dispatch-groups.json; it is not a removing reason');
});

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
  assert.match(SINGLE, /no entry at all/, '#N bullet must say what to report when no exclusion entry names the record');
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

test('not-spec-shaped-exclusion-report.md routes a lone missing Release Note to /claude-tweaks:tidy and anything else to /claude-tweaks:specify #N (#3087)', () => {
  const start = NOT_SPEC_SHAPED_REPORT.indexOf('**Remedy selection:**');
  assert.notStrictEqual(start, -1, 'Remedy selection paragraph not found -- anchor out of sync with the live file');
  const rule = NOT_SPEC_SHAPED_REPORT.slice(start, NOT_SPEC_SHAPED_REPORT.indexOf('\n\n', start)).replace(/\s+/g, ' ');
  assert.match(rule, /when `missing` is exactly `\["Release Note"\]`, the remedy is `` `\/claude-tweaks:tidy` ``/);
  assert.match(rule, /Any other `missing` set .* gets `` `\/claude-tweaks:specify #\{number\}` ``/);
  assert.ok(NOT_SPEC_SHAPED_REPORT.includes('`#{number} excluded — not spec-shaped (missing: {missing, comma-joined}). Run {remedy}.`'),
    'the per-record line the remedy is spliced into is missing');
});
