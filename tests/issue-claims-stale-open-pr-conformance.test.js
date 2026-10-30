// tests/issue-claims-stale-open-pr-conformance.test.js
// Pins _shared/issue-claims.md's "The lock" step 4 (#4423): the manual MCP claim path owes the same
// stale-claim in-flight check bin/claim-targets.js runs through claim-store.js's `staleClaimInFlightPr`
// — a TTL-expired claim whose run's marker sits on an open same-repo PR is in flight, not abandoned.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { readText } = require('./helpers/read-skill');

const ISSUE_CLAIMS = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'issue-claims.md'));

function lockStep4() {
  const start = ISSUE_CLAIMS.indexOf("  4. **`state: 'tombstone'` or `'stale'`**");
  const end = ISSUE_CLAIMS.indexOf("  5. **`state: 'live'`**");
  assert.notEqual(start, -1, 'issue-claims.md must carry The lock step 4');
  assert.notEqual(end, -1, 'issue-claims.md must carry The lock step 5');
  assert.ok(end > start, 'step 5 must follow step 4');
  return ISSUE_CLAIMS.slice(start, end);
}

test('The lock step 4 carries the stale-claim open-PR check for the MCP path (#4423)', () => {
  const step4 = lockStep4();
  assert.match(step4, /`'stale'` blob/, 'the check is keyed on the stale classification');
  assert.ok(step4.includes('staleClaimInFlightPr'), 'names the gh-CLI twin');
  assert.ok(step4.includes('mcp__github__list_pull_requests'), 'lists open PRs through the MCP tool');
  assert.ok(step4.includes('claude-tweaks-run: {runId}'), 'matches the run marker line');
  assert.ok(step4.includes('<!-- claude-tweaks-run: {runId} -->'), 'matches the HTML-comment marker form');
});

test('The lock step 4 stale check fails open: a failed listing falls through to the write (#4423)', () => {
  const step4 = lockStep4();
  assert.match(
    step4,
    /failed or unparseable listing falls through to the write/,
    'a broken listing must never wedge the claim path',
  );
});
