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
const BRIEF = 'wrap-up/verification-brief.md';

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

const CURRENT = '- **`current-branch`**';
const GONE = '- **`evidence-pr`**';
const CLI_LINE = 'node "${CLAUDE_PLUGIN_ROOT}/bin/evidence-route.js" --run "{run-dir}"';

// AC4.1: the routing rules live in bin/evidence-route.js, not in Step 4's prose.
function assertNoRuleRestatement(s) {
  for (const rule of ['^[A-Za-z0-9._/-]+$', 'resolvePrState', 'git rev-parse --show-toplevel', 'bin/pr-merge-state.js" --run', 'git branch --show-current', 'detached HEAD', 'merge.resolution` reads']) {
    assert.ok(!s.includes(rule), `Step 4 restates a routing rule the CLI owns: ${rule}`);
  }
}

// Every routing assertion in one function, so the go-red control below runs the
// exact code the positive test runs.
function assertRouting(s) {
  const local = s.indexOf('**`integration-model: local-merge` or `current-branch` mode** — no PR to read: commit on the current branch with the fence below, with no push and no PR (`_shared/git-discipline.md`: no phase-exit push there).');
  const check = s.indexOf("**Route the commit");
  const commit = s.indexOf('git commit -m "Add demo evidence screenshots');
  assert.ok(local >= 0, 'missing the local-merge / current-branch exception');
  assert.ok(check >= 0, 'missing the PR-state check paragraph');
  assert.ok(check > local, 'the local-merge / current-branch exception must come above the pr-first check');
  assert.ok(commit > check, 'the PR-state check must come before the screenshot commit');

  // AC4.2: the route comes from the CLI, called as its own Bash call.
  assert.ok(s.includes(CLI_LINE), 'missing the evidence-route.js invocation');
  assert.ok(s.includes('```bash\n' + CLI_LINE + '\n```'), 'the invocation is a fenced bash block of its own');
  assert.ok(s.includes('--in-run'));
  assert.ok(s.includes('--leave-open'));
  assert.ok(s.includes('Route on `route` alone'));
  assert.ok(s.includes('A non-zero exit, or output that does not parse as that line, takes the evidence-PR route'));
  assertNoRuleRestatement(s);

  assert.ok(s.includes('_shared/timing-render.md'), 'archive-path rule cited');
  assert.ok(s.includes('$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/'));
  assert.ok(!s.includes('$(git'), 'no git inside a command substitution — refused in a worktree session');
  assert.ok(s.includes('Step 4 never commits to or pushes `{integration-branch}`'), 'integration-branch guard');
  assert.match(s, /also appends its own "Post-push merge-state check" entry to `decisions\.md`, which is expected/);

  const open = bullet(s, CURRENT);
  assert.match(open, /push that commit straight away/);
  assert.ok(open.includes('`git push origin {branch}`'));
  assert.match(open, /If the push fails, compose the brief without embedded screenshots/);

  const gone = bullet(s, GONE);
  assert.ok(gone.includes('`_shared/scratch-worktree.md`'));
  assert.ok(gone.includes('`wrap-up/residue-sweep.md`'));
  assert.ok(gone.includes('demo-evidence/{record}'));
  assert.ok(gone.includes("git ls-remote --heads origin 'demo-evidence/{record}*'"), 'free-name check');
  assert.match(gone, /append `-2`, `-3`/);
  const addAt = gone.indexOf('`git add docs/demo-evidence/{record}/`');
  const pathspecAt = gone.indexOf('git commit -m "Add demo evidence screenshots for #{record}" -- docs/demo-evidence/{record}/');
  assert.ok(addAt >= 0, 'the fresh screenshots are staged — a pathspec commit alone fails on untracked files');
  assert.ok(pathspecAt >= 0, 'pathspec commit');
  assert.ok(addAt < pathspecAt, 'git add comes before the pathspec commit');
  assert.ok(gone.includes('`discard_changes: true`'), 'teardown names the override');
  assert.match(gone, /only after the ls-remote proof/);
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
  assert.ok(gone.includes("`git branch --list 'demo-evidence/{record}*'`"), 'local half of the free-name check');
  assert.match(gone, /when its ancestry check refuses an unpushed commit, leave the worktree/);
  assert.match(gone, /If the push succeeded but the PR create fails, the commit is on `origin`/);
  assert.match(gone, /If the ls-remote proof does not return the recorded SHA .* do not discard/);

  assert.ok(s.includes('mcp__github__create_pull_request'));
  assert.ok(s.includes('_shared/github-write-transport.md'));

  // No in-place switch: the session's branch never moves.
  assert.ok(!s.includes('git switch'), 'no in-place git switch');

  assert.ok(s.includes('--run "{run-dir}" --section "/wrap-up"'), 'routing is logged under /wrap-up with the resolved run dir, not a bare $PIPELINE_RUN_DIR');
  assert.match(s, /name the evidence PR's URL in the brief/);
}

test("AC4.1 AC4.2: Step 4 routes the screenshot commit on bin/evidence-route.js's JSON", () => {
  assertRouting(step4(read(BRIEF)));
});

test('AC4.1 go-red control: restoring a prose rule turns the routing assertions red', () => {
  const s = step4(read(BRIEF));
  assert.throws(() => assertRouting(s + 'A branch name that does not match `^[A-Za-z0-9._/-]+$` takes the evidence-PR route.\n'));
});

test('AC4.2 go-red control: dropping the CLI invocation turns the routing assertions red', () => {
  const s = step4(read(BRIEF));
  assert.ok(s.includes(CLI_LINE), 'control premise: Step 4 carries the invocation');
  assert.throws(() => assertRouting(s.replace(CLI_LINE, 'x')));
});

test('AC6.1: the wrap-up summary carries an evidence-PR row in Actions Performed', () => {
  const doc = read('wrap-up/summary-template.md');
  const table = doc.slice(doc.indexOf('### Actions Performed'));
  assert.ok(table.includes('| Operational | Opened evidence PR #{m} ({url}) for #{n}'), 'missing evidence-PR row');
  assert.ok(table.includes("the run's own branch was not a safe home ({merged \\| closed \\| unavailable})"), 'row reason covers the guard and unreadable cases');
  assert.match(table, /the Verification Brief's evidence PR/);
});

test('AC8.1: removing the evidence-PR route turns the routing assertions red', () => {
  const s = step4(read(BRIEF));
  const gone = bullet(s, GONE);
  assert.throws(() => assertRouting(s.replace(gone, '')));
});

test('AC8.1: dropping one pinned literal from the evidence-PR bullet turns the routing assertions red', () => {
  const s = step4(read(BRIEF));
  const gone = bullet(s, GONE);
  for (const literal of ['`Refs #{record}`', '`git add docs/demo-evidence/{record}/`', '`discard_changes: true`']) {
    assert.ok(gone.includes(literal), `control premise: bullet carries ${literal}`);
    assert.throws(() => assertRouting(s.replace(gone, gone.replace(literal, 'x'))), `dropping ${literal} must fail`);
  }
});
