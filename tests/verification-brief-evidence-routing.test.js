'use strict';
// #4039: verification-brief Step 4 routes the demo-evidence screenshot commit on
// the run PR's state, so evidence never lands on an already-merged branch.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (rel) => readText(path.join(SKILLS, rel));

function step4(doc) {
  const start = doc.indexOf('## Step 4: Compose and post the brief');
  assert.ok(start >= 0, 'missing Step 4 heading');
  const next = doc.indexOf('\n## ', start + 1);
  return doc.slice(start, next < 0 ? undefined : next);
}

// One routing bullet, from its bold opener to the next bullet or blank line.
function bullet(s, opener) {
  const start = s.indexOf(opener);
  assert.ok(start >= 0, `missing routing bullet ${opener}`);
  const ends = ['\n- **', '\n\n'].map((m) => s.indexOf(m, start + 1)).filter((i) => i >= 0);
  return s.slice(start, ends.length ? Math.min(...ends) : undefined);
}

const OPEN = '- **Open PR (`OPEN`)**';
const GONE = '- **Merged or closed PR (`MERGED`/`CLOSED`)**';
const NONE = '- **No PR (`no-pr`)**';
const UNREADABLE = '- **State unreadable (`gh-absent`, `network-failure`)**';

// Every routing assertion in one function, so the go-red control below runs the
// exact code the positive test runs.
function assertRouting(s) {
  const check = s.indexOf("**Check the branch's PR before committing");
  const commit = s.indexOf('git commit -m "Add demo evidence screenshots');
  assert.ok(check >= 0, 'missing the PR-state check paragraph');
  assert.ok(commit > check, 'the PR-state check must come before the screenshot commit');
  assert.match(s, /resolvePrState/);
  assert.match(s, /a merged PR wins when the branch has several/);
  assert.ok(s.includes('`git branch --show-current`'), 'branch name read as its own call');
  assert.ok(!s.includes('$(git'), 'no git inside a command substitution — refused in a worktree session');

  const open = bullet(s, OPEN);
  assert.match(open, /push that commit straight away/);
  assert.ok(open.includes('`git push origin {branch}`'));

  const gone = bullet(s, GONE);
  assert.match(gone, /never commit to the dead branch/);
  assert.ok(gone.includes('`git switch -c demo-evidence/{record} origin/{integration-branch}`'));
  assert.ok(gone.includes('commit only `docs/demo-evidence/{record}/`'));
  assert.ok(gone.includes('`git push -u origin demo-evidence/{record}`'));
  assert.ok(gone.includes('`Refs #{record}`'));
  assert.ok(gone.includes('never `Fixes`, `Closes`, or `Resolves`'));
  assert.match(gone, /left open for a human to merge and is never auto-merged/);
  assert.match(gone, /this evidence commit's SHA, never the dead branch's/);
  assert.match(gone, /already taken/);
  assert.ok(gone.includes('`git switch -`'));
  assert.match(gone, /say in it why they are missing/);

  assert.match(bullet(s, NONE), /commit and push as for an open PR/);
  const unreadable = bullet(s, UNREADABLE);
  assert.match(unreadable, /never commit to it blind/);
  assert.ok(unreadable.includes('mcp__github__create_pull_request'));
  assert.ok(unreadable.includes('_shared/github-write-transport.md'));

  assert.ok(s.includes('--section "/wrap-up"'), 'routing is logged under /wrap-up');
  assert.match(s, /name the evidence PR's URL in the brief/);
  assert.ok(s.includes('**`integration-model: local-merge`** — no PR to read: commit on the current branch as below, with no push and no PR.'));
}

test('AC1.1 AC2.1 AC3.1 AC4.1 AC5.1 AC6.1 AC7.1: Step 4 routes the screenshot commit on the PR state', () => {
  assertRouting(step4(read('wrap-up/verification-brief.md')));
});

test('AC6.1: the wrap-up summary carries an evidence-PR row in Actions Performed', () => {
  const doc = read('wrap-up/summary-template.md');
  const table = doc.slice(doc.indexOf('### Actions Performed'));
  assert.ok(table.includes('| Operational | Opened evidence PR #{m} ({url}) for #{n}'), 'missing evidence-PR row');
  assert.match(table, /the Verification Brief's evidence PR/);
});

test('AC8.1: removing the merged-or-closed route turns the routing assertions red', () => {
  const s = step4(read('wrap-up/verification-brief.md'));
  const gone = bullet(s, GONE);
  assert.throws(() => assertRouting(s.replace(gone, '')));
});
