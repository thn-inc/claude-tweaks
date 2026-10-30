// tests/tidy-stale-claim-open-pr-conformance.test.js
// Pins /tidy Step 4.7's stale-claim routing (record #4423): a 'stale' claim blob whose run still has an
// open PR carrying the run marker is a Yours Resume no-op naming the PR, never a Release.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');

function read(rel) {
  return readText(path.join(REPO_ROOT, rel));
}

function findRow(text, prefix) {
  return text.split('\n').find((line) => line.startsWith(prefix));
}

const SCAN_PROCEDURES = read('plugin/skills/tidy/scan-procedures.md');
const ACTIONS = read('plugin/skills/tidy/actions-github-issues.md');

function claimAuditSection() {
  const start = SCAN_PROCEDURES.indexOf('## Step 4.7: Audit Issue Claims');
  const end = SCAN_PROCEDURES.indexOf('### Backstops: issue-claim audit-trail integrity checks');
  assert.notEqual(start, -1, 'scan-procedures.md must carry the Step 4.7 heading');
  assert.notEqual(end, -1, 'scan-procedures.md must carry the Backstops heading');
  return SCAN_PROCEDURES.slice(start, end);
}

test('the stale-blob row offers Resume when an open PR carries the run marker (#4423)', () => {
  const row = findRow(claimAuditSection(), '| Blob classified `\'stale\'`');
  assert.ok(row, 'the stale-blob row is present');
  assert.match(row, /open PR/);
  assert.match(row, /Resume/);
});

test('the stale-claim paragraph lists open PRs on both transports and matches the run marker (#4423)', () => {
  const s = claimAuditSection();
  assert.match(s, /gh pr list --state open --json number,url,body/);
  assert.match(s, /mcp__github__list_pull_requests/);
  assert.match(s, /claude-tweaks-run: \{runId\}/);
  assert.ok(
    s.includes('^\\d{4}-\\d{2}-\\d{2}T\\d{6}-[a-z0-9][a-z0-9-]*$'),
    'the run-id shape regex is stated literally',
  );
});

test('a matching PR routes as the Yours Unsettled run no-op, never staged and never released (#4423)', () => {
  const s = claimAuditSection();
  assert.match(s, /`### Resume` line/);
  assert.match(s, /\*\*Unsettled run\*\*/);
  assert.match(s, /Yours/);
  assert.match(s, /never staged/);
  assert.match(s, /never released/i);
});

test('the Collect line carries the PR number and resume command for a Resume recommendation (#4423)', () => {
  const s = claimAuditSection();
  const collect = '→ Collect each as: `[claim] claims/issue-{n}.json — {status} — {recommendation}`';
  const at = s.indexOf(collect);
  assert.notEqual(at, -1, 'Step 4.7 keeps its Collect line');
  assert.match(s.slice(at + collect.length), /^\s*A Resume recommendation[^\n]*PR #\{number\}/);
});

test('the Release claim executor never receives an open-PR stale row (#4423)', () => {
  const start = ACTIONS.indexOf('## Release claim');
  const end = ACTIONS.indexOf('## Sync to GitHub');
  assert.ok(start !== -1 && end > start, 'actions-github-issues.md carries both headings');
  const s = ACTIONS.slice(start, end);
  assert.match(s, /open marked PR/);
  assert.match(s, /never a Release row/);
});
