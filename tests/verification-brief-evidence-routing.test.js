'use strict';
// #4039: verification-brief Step 4 routes the demo-evidence screenshot commit on
// the run's own PR state, so evidence never lands on an already-merged branch and
// never on the integration branch itself.
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

const OPEN = '- **Run PR open (`conflicting`, `no-conflict`, `unknown`)**';
const GONE = '- **Run PR merged or closed (`not-open`), or the current-branch route unavailable**';
const NONE = '- **No PR recorded (`no-pr`)**';
const UNREADABLE = '- **State unreadable (`gh-absent`, `read-failed`, or any other output)**';

// Every routing assertion in one function, so the go-red control below runs the
// exact code the positive test runs.
function assertRouting(s) {
  const local = s.indexOf('**`integration-model: local-merge` or `current-branch` mode** — no PR to read: commit on the current branch with the fence below, with no push and no PR (`_shared/git-discipline.md`: no phase-exit push there).');
  const check = s.indexOf("**Read the run's own PR before committing");
  const commit = s.indexOf('git commit -m "Add demo evidence screenshots');
  assert.ok(local >= 0, 'missing the local-merge / current-branch exception');
  assert.ok(check >= 0, 'missing the PR-state check paragraph');
  assert.ok(check > local, 'the local-merge / current-branch exception must come above the pr-first check');
  assert.ok(commit > check, 'the PR-state check must come before the screenshot commit');

  // Ruling 1: the run's own PR first, via pr-merge-state.js, surviving branch deletion.
  assert.ok(s.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/pr-merge-state.js" --run "{run-dir}" --phase wrap-up'));
  assert.ok(s.includes('_shared/timing-render.md'), 'archive-path rule cited');
  assert.ok(s.includes('$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/'));
  // Ruling 2: the branch read is the fallback only.
  assert.match(s, /resolvePrState/);
  assert.match(s, /a merged PR wins when the branch has several/);
  assert.ok(s.includes('`git branch --show-current`'), 'branch name read as its own call');
  assert.ok(!s.includes('$(git'), 'no git inside a command substitution — refused in a worktree session');
  // Ruling 3: the integration-branch guard.
  assert.ok(s.includes('Step 4 never commits to or pushes `{integration-branch}`'), 'integration-branch guard');
  assert.match(s, /detached HEAD/);
  assert.match(s, /regardless of what the read returned/);

  const open = bullet(s, OPEN);
  assert.match(open, /push that commit straight away/);
  assert.ok(open.includes('`git push origin {branch}`'));

  const gone = bullet(s, GONE);
  assert.ok(gone.includes('`_shared/scratch-worktree.md`'));
  assert.ok(gone.includes('`wrap-up/residue-sweep.md`'));
  assert.ok(gone.includes('demo-evidence/{record}'));
  assert.ok(gone.includes("git ls-remote --heads origin 'demo-evidence/{record}*'"), 'free-name check');
  assert.match(gone, /append `-2`, `-3`/);
  assert.ok(gone.includes('git commit -m "Add demo evidence screenshots for #{record}" -- docs/demo-evidence/{record}/'), 'pathspec commit');
  assert.ok(gone.includes('`git rev-parse HEAD`'));
  assert.ok(gone.includes('`git push -u origin demo-evidence/{record}`'));
  assert.ok(gone.includes('`gh pr create --base {integration-branch} --head demo-evidence/{record}'));
  assert.ok(gone.includes('`Refs #{record}`'));
  assert.ok(gone.includes('never `Fixes`, `Closes`, or `Resolves`'));
  assert.match(gone, /left open for a human to merge and is never auto-merged/);
  assert.match(gone, /this evidence commit's SHA, never the dead branch's/);
  assert.ok(gone.includes('`ExitWorktree`'));
  assert.ok(gone.includes('git ls-remote --heads origin demo-evidence/{record}'), 'substitute teardown proof');
  assert.match(gone, /say in it why they are missing/);

  const none = bullet(s, NONE);
  assert.match(none, /commit and push as for an open PR/);
  const unreadable = bullet(s, UNREADABLE);
  assert.ok(unreadable.includes('`leave-open`'), 'unreadable state is open only on a leave-open run');
  assert.match(unreadable, /take the evidence-PR route/);
  assert.match(s, /Any other output/);
  assert.ok(s.includes('mcp__github__create_pull_request'));
  assert.ok(s.includes('_shared/github-write-transport.md'));

  // No in-place switch: the session's branch never moves.
  assert.ok(!s.includes('git switch'), 'no in-place git switch');

  assert.ok(s.includes('--run "{run-dir}" --section "/wrap-up"'), 'routing is logged under /wrap-up with the resolved run dir, not a bare $PIPELINE_RUN_DIR');
  assert.match(s, /name the evidence PR's URL in the brief/);
}

test('AC1.1 AC2.1 AC3.1 AC4.1 AC5.1 AC6.1 AC7.1: Step 4 routes the screenshot commit on the run PR state', () => {
  assertRouting(step4(read('wrap-up/verification-brief.md')));
});

test('AC6.1: the wrap-up summary carries an evidence-PR row in Actions Performed', () => {
  const doc = read('wrap-up/summary-template.md');
  const table = doc.slice(doc.indexOf('### Actions Performed'));
  assert.ok(table.includes('| Operational | Opened evidence PR #{m} ({url}) for #{n}'), 'missing evidence-PR row');
  assert.match(table, /the Verification Brief's evidence PR/);
});

test('AC8.1: removing the evidence-PR route turns the routing assertions red', () => {
  const s = step4(read('wrap-up/verification-brief.md'));
  const gone = bullet(s, GONE);
  assert.throws(() => assertRouting(s.replace(gone, '')));
});
