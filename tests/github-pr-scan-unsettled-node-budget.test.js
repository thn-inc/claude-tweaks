// tests/github-pr-scan-unsettled-node-budget.test.js
//
// Pins #2853's fix: plugin/skills/_shared/github-pr-scan.md's item 10 (Unsettled run)
// used to fetch `gh pr list --state all --json ...,comments,commits --limit 200` in one
// bulk call. `comments`/`commits` are each a nested GraphQL connection GitHub prices at
// ~10,000 nodes per PR — requesting both together, bulk, across `--state all --limit 200`
// exceeds GitHub's 500,000-node ceiling above roughly 50 PRs (reproduced live against this
// repo's 2900+ PRs, confirmed in the record's Current State). The fix drops `comments`/
// `commits` from the bulk `--state all` fetch and fetches progress per matched candidate
// only (a `gh pr view` call, bounded by candidate count, not PR count).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'github-pr-scan.md');
const content = fs.readFileSync(FILE, 'utf8');

// A "bulk over-budget fetch" is any `gh pr list` invocation combining `--state all`
// with a `--json` field list that names both `comments` and `commits` — the exact
// shape that reproduced the node-limit GraphQL error. Scoped to a single logical
// line (shell `\` continuations count as one line for this purpose), matching how
// the fetch is actually written in this file.
function hasOverBudgetBulkFetch(text) {
  const joined = text.replace(/\\\r?\n\s*/g, ' ');
  const lines = joined.split('\n');
  return lines.some((line) => {
    if (!/gh pr list\b/.test(line)) return false;
    if (!/--state all\b/.test(line)) return false;
    const jsonMatch = line.match(/--json\s+(\S+)/);
    if (!jsonMatch) return false;
    const fields = jsonMatch[1].split(',');
    return fields.includes('comments') && fields.includes('commits');
  });
}

test('item 10 (Unsettled run) exists', () => {
  assert.match(content, /10\. \*\*Unsettled run\*\*/);
});

test('github-pr-scan.md carries no bulk --state all gh pr list fetch combining comments and commits', () => {
  assert.equal(
    hasOverBudgetBulkFetch(content),
    false,
    'found a bulk `gh pr list --state all ... --json ...comments...commits...` fetch — this is the exact shape that exceeded GitHub\'s 500k GraphQL node limit above ~50 PRs (#2853)'
  );
});

test('detector itself flags the original over-budget fetch (regression shape)', () => {
  const reintroduced = [
    'gh pr list --state all --json number,url,closingIssuesReferences,comments,commits --limit 200 \\',
    '  > "$PR_SCAN_UNSETTLED_PRS"',
  ].join('\n');
  assert.equal(hasOverBudgetBulkFetch(reintroduced), true, 'detector failed to flag a known-bad bulk fetch');
});

test('detector does not flag the fixed bulk fetch (no comments/commits)', () => {
  const fixed = [
    'gh pr list --state all --json number,url,closingIssuesReferences --limit 200 \\',
    '  > "$PR_SCAN_UNSETTLED_PRS"',
  ].join('\n');
  assert.equal(hasOverBudgetBulkFetch(fixed), false, 'detector incorrectly flagged the fixed bulk fetch');
});

test('item 10 still fetches per-candidate progress via gh pr view with comments,commits', () => {
  assert.match(content, /gh',\s*\[\s*'pr',\s*'view'/);
  assert.match(content, /'comments,commits'/);
});
