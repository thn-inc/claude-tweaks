// tests/tidy-stale-claim-open-pr-conformance.test.js
// Pins /tidy Step 4.7's stale-claim routing (record #4423): a 'stale' claim blob whose run still has an
// open PR carrying the run marker is a Yours Resume no-op naming the PR, never a Release.
// Since #4596 the paragraph calls bin/stale-claim-pr.js for the match and the Resume line instead of
// restating the marker rule and the Resume grammar, so the rule lives once, in code.
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
const COLLECTION_ROUTING = read('plugin/skills/tidy/collection-routing.md');

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

test('AC1.2: the stale-claim paragraph calls the CLI on both transports (#4596)', () => {
  const s = claimAuditSection();
  assert.ok(s.includes('bin/stale-claim-pr.js'), 'calls the one matcher implementation');
  assert.ok(s.includes('--resume'), 'asks it for the validated Resume line');
  assert.ok(s.includes('--repo "{owner}/{repo}"'), 'passes --repo, since an origin shape parseRepo rejects is exit 3 before the gh check');
  assert.ok(s.includes('--listing'), 'hands it the MCP listing when gh is absent');
  assert.ok(s.includes('mcp__github__list_pull_requests'), 'lists open PRs through the MCP tool when gh is absent');
});

test('AC1.1: the stale-claim paragraph restates neither the marker rule nor the Resume grammar (#4596)', () => {
  const flat = claimAuditSection().replace(/\s+/g, ' '); // prose wraps at ~98 columns
  for (const retired of [
    'trimmed line equal to',
    'claude-tweaks-run: {runId}',
    '^\\d{4}-\\d{2}-\\d{2}T\\d{6}-[a-z0-9][a-z0-9-]*$',
    'PIPELINE_RUN_DIR="{dir}/{runId}"',
    '`[a-z][a-z,-]*`',
    'isCrossRepository',
    'head.repo.full_name',
  ]) {
    assert.ok(!flat.includes(retired), `the paragraph must not restate ${retired} — bin/stale-claim-pr.js owns it`);
  }
});

test('a matching PR routes as the Yours Unsettled run no-op, never staged and never released (#4423)', () => {
  const s = claimAuditSection().replace(/\s+/g, ' '); // prose wraps at ~98 columns
  assert.match(s, /`resume`/);
  assert.match(s, /`resolve`/);
  assert.ok(s.includes('Resume open PR #{number} ({url})'), 'the Resume rendering names the PR');
  assert.ok(s.includes('Resolve open PR #{number} ({url})'), 'the Resolve fallback names the PR');
  // Step 4.7's table rows already say "Manual review", so a bare match proves nothing: pin the
  // failed-listing sentence itself.
  assert.match(s, /failed listing[^.]*Manual review[^.]*never an unchecked Release/);
  assert.match(s, /1000-entry listing with no match[^.]*Manual review/);
  assert.match(s, /Manual review[^.]*any other non-zero exit/);
  assert.match(s, /\*\*Unsettled run\*\*/);
  assert.match(s, /Yours/);
  assert.match(s, /never staged/);
  assert.match(s, /never released/i);
});

test('AC1.1: the stale-claim call passes --issue {n} so a gone run dir resumes through dispatch (#4673)', () => {
  const flat = claimAuditSection().replace(/\s+/g, ' '); // prose wraps at ~98 columns
  assert.ok(flat.includes('--resume --issue {n}'), 'the call hands the claim number to the CLI');
  // The dispatch literal sits in the Resume row's own sentence, not merely somewhere in the section.
  const rowAt = flat.indexOf('Resume open PR #{number} ({url}) — {resume}');
  assert.notEqual(rowAt, -1, 'the Resume row is present');
  const archivedAt = flat.indexOf('absent or archived', rowAt);
  assert.notEqual(archivedAt, -1, 'the Resume row names the absent-or-archived condition');
  const sentence = flat.slice(rowAt, archivedAt);
  assert.ok(sentence.includes('`/claude-tweaks:dispatch resume #{n}`'), 'names the dispatch-resume command in the Resume row sentence');
  assert.ok(sentence.includes('`record-{n}`'), 'the dispatch line is for a dispatched run');
  assert.ok(!sentence.includes('. '), 'the slice stays inside one sentence');
});

test('AC2.1: a present run dir still renders the PR body\'s resume line (#4673)', () => {
  const flat = claimAuditSection().replace(/\s+/g, ' '); // prose wraps at ~98 columns
  assert.ok(flat.includes('Resume open PR #{number} ({url}) — {resume}'), 'the Resume row keeps its rendering');
  assert.ok(flat.includes('the PR body\'s resume line'), 'the PR body stays the resume source for a present run dir');
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

test('collection-routing routes a [claim] Resume/Resolve outcome to Yours and supersedes [unsettled] (#4423)', () => {
  const row = findRow(COLLECTION_ROUTING, '| `[backlog]`, `[parked]`');
  assert.ok(row, 'the Approve routing row is present');
  assert.match(row, /`\[claim\]` Resume\/Resolve outcome/);
  assert.match(row, /lands in \*\*Yours \(\{N\}\)\*\* as an Auto no-op, never staged/);
  assert.match(row, /supersedes an `\[unsettled\]` row for the same `#\{n\}`/);
});
