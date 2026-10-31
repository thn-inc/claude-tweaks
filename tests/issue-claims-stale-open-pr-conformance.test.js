// tests/issue-claims-stale-open-pr-conformance.test.js
// Pins _shared/issue-claims.md's "The lock" step 4 (#4423): the manual MCP claim path owes the same
// stale-claim in-flight check bin/claim-targets.js runs through claim-store.js's `staleClaimInFlightPr`
// — a TTL-expired claim whose run's marker sits on an open same-repo PR is in flight, not abandoned.
// Since #4596 step 4 calls bin/stale-claim-pr.js for that verdict instead of restating the marker-match
// rule, so the rule lives once, in code (tests/bin-lib/stale-claim-pr/ pins it).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { readText } = require('./helpers/read-skill');
const { RUN_ID_SHAPE } = require('../plugin/bin/lib/issues/claim-store');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const ISSUE_CLAIMS = readText(path.join(SKILLS, '_shared', 'issue-claims.md'));

function lockStep4() {
  const start = ISSUE_CLAIMS.indexOf("  4. **`state: 'tombstone'` or `'stale'`**");
  const end = ISSUE_CLAIMS.indexOf("  5. **`state: 'live'`**");
  assert.notEqual(start, -1, 'issue-claims.md must carry The lock step 4');
  assert.notEqual(end, -1, 'issue-claims.md must carry The lock step 5');
  assert.ok(end > start, 'step 5 must follow step 4');
  return ISSUE_CLAIMS.slice(start, end);
}

test('AC1.2: The lock step 4 names the stale-claim CLI on the MCP path (#4596)', () => {
  const step4 = lockStep4();
  assert.match(step4, /`'stale'` blob/, 'the check is keyed on the stale classification');
  assert.ok(step4.includes('bin/stale-claim-pr.js'), 'calls the one matcher implementation');
  assert.ok(step4.includes('--claim-file'), 'hands it the stale blob');
  assert.ok(step4.includes('--listing'), 'hands it the agent-fetched MCP listing');
  assert.ok(step4.includes('mcp__github__list_pull_requests'), 'lists open PRs through the MCP tool');
  assert.ok(step4.includes('staleClaimInFlightPr'), 'names the gh-CLI twin');
});

test('AC1.1: The lock step 4 no longer restates the marker-match rule (#4596)', () => {
  const step4 = lockStep4().replace(/\s+/g, ' '); // prose wraps at ~98 columns
  for (const retired of [
    'claude-tweaks-run: {runId}',
    '<!-- claude-tweaks-run: {runId} -->',
    'head.repo.full_name',
    RUN_ID_SHAPE.source,
  ]) {
    assert.ok(!step4.includes(retired), `step 4 must not restate "${retired}" — bin/stale-claim-pr.js owns it`);
  }
});

test('The lock step 4 stale check fails open: a failed check falls through to the write (#4423)', () => {
  const step4 = lockStep4().replace(/\s+/g, ' ');
  assert.match(
    step4,
    /failure[^.]*non-zero exit[^.]*falls through to the write/,
    'a broken listing must never wedge the claim path',
  );
  assert.match(step4, /after one line saying the check failed — never silently/, 'as the gh twin\'s onError warning');
});

test('the run-id shape is restated only in flow/claim-targets.md (#4423, #4596)', () => {
  // bin/stale-claim-pr.js owns the stale-claim match now; the one remaining prose copy validates a run id
  // read from a tombstone's PR for the resume route, so it stays pinned to claim-store.js's RUN_ID_SHAPE.
  assert.ok(
    readText(path.join(SKILLS, 'flow', 'claim-targets.md')).includes(RUN_ID_SHAPE.source),
    'flow/claim-targets.md states RUN_ID_SHAPE verbatim',
  );
  for (const rel of ['_shared/issue-claims.md', 'tidy/scan-procedures.md']) {
    assert.ok(
      !readText(path.join(SKILLS, rel)).includes(RUN_ID_SHAPE.source),
      `${rel} must call bin/stale-claim-pr.js, not restate RUN_ID_SHAPE`,
    );
  }
});
