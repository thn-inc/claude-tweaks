'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #683: scratch-worktree teardown ancestry check + pr-first-merge remote-branch
// delete (Step 5). Prose-as-implementation, same convention as the other
// pr-first sub-issues' test files (tests/pr-first-merge.test.js) — pin the key
// claims against the actual file text rather than restating them elsewhere.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const SCRATCH = read('plugin', 'skills', '_shared', 'scratch-worktree.md');
const SETUP = read('plugin', 'skills', '_shared', 'worktree-setup.md');
const MERGE = read('plugin', 'skills', '_shared', 'pr-first-merge.md');
const MERGE_POST_MERGE = read('plugin', 'skills', '_shared', 'pr-first-merge-post-merge.md');
const CLEANUP = read('plugin', 'skills', 'wrap-up', 'cleanup-procedures.md');
const CLEANUP_PROCEDURES_EXECUTION = read('plugin', 'skills', 'wrap-up', 'cleanup-procedures-execution.md');

// --- 1. scratch-worktree.md §6: ancestry check + both outcomes ---

test('scratch-worktree.md §6 runs the merge-base --is-ancestor ancestry check before ExitWorktree', () => {
  const step6 = SCRATCH.indexOf('## 6. Tearing down');
  const step7 = SCRATCH.indexOf('## 7. Shell constraint');
  assert.ok(step6 > 0 && step7 > step6, 'section 6 must exist and precede section 7');
  const section = SCRATCH.slice(step6, step7);
  assert.match(section, /git fetch origin \{integration-branch\}/);
  assert.match(section, /git merge-base --is-ancestor HEAD origin\/\{integration-branch\}/);
});

test('scratch-worktree.md §6 exit-0 outcome discards with a stated reason via ExitWorktree', () => {
  const step6 = SCRATCH.slice(SCRATCH.indexOf('## 6. Tearing down'), SCRATCH.indexOf('## 7. Shell constraint'));
  assert.match(step6, /\*\*Exit 0\*\* — every commit on this worktree's branch is already upstream/);
  assert.match(step6, /`ExitWorktree` with `discard_changes: true` and state the one-line reason/);
  assert.match(step6, /Never invoke the override\s*\n?\s*without running this check first/);
});

test('scratch-worktree.md §6 non-zero outcome stops and surfaces via git log, never overrides the guard', () => {
  const step6 = SCRATCH.slice(SCRATCH.indexOf('## 6. Tearing down'), SCRATCH.indexOf('## 7. Shell constraint'));
  assert.match(step6, /\*\*Non-zero\*\* — stop and surface: run `git log origin\/\{integration-branch\}\.\.HEAD --oneline`/);
  assert.match(step6, /Never override the guard on a non-zero result/);
});

test('scratch-worktree.md §6 hands off to pr-first-merge.md Step 5 rather than restating it', () => {
  const step6 = SCRATCH.slice(SCRATCH.indexOf('## 6. Tearing down'), SCRATCH.indexOf('## 7. Shell constraint'));
  assert.match(
    step6,
    /pr-first-merge-post-merge\.md`'s `## Step 5: Delete the remote branch \(after worktree teardown\)`/,
  );
});

// --- 2. Pre-creation reconcile: scratch-worktree.md §2 and worktree-setup.md ---

test('scratch-worktree.md §2 calls bin/hooks.js reconcile before worktree creation', () => {
  const step2 = SCRATCH.indexOf('## 2. Creating it');
  const step3 = SCRATCH.indexOf('## 3. First action inside');
  assert.ok(step2 > 0 && step3 > step2, 'section 2 must exist and precede section 3');
  const section = SCRATCH.slice(step2, step3);
  assert.match(section, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.js" reconcile/);
  assert.match(section, /worktree-setup\.md`'s `## Pre-creation reconcile`/);
});

test('worktree-setup.md has a Pre-creation reconcile section that calls bin/hooks.js reconcile', () => {
  const anchor = SETUP.indexOf('## Pre-creation reconcile');
  const next = SETUP.indexOf('## Post-creation catch-up');
  assert.ok(anchor > 0 && next > anchor, 'Pre-creation reconcile section must exist and precede Post-creation catch-up');
  const section = SETUP.slice(anchor, next);
  assert.match(section, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.js" reconcile/);
});

test('worktree-setup.md states never git checkout / git pull in the shared checkout for this purpose', () => {
  const anchor = SETUP.indexOf('## Pre-creation reconcile');
  const next = SETUP.indexOf('## Post-creation catch-up');
  const section = SETUP.slice(anchor, next);
  assert.match(section, /Never `git\s*\n?\s*checkout` or `git pull` in the shared checkout to accomplish this fast-forward/);
});

test('scratch-worktree.md §2 also states never git checkout / git pull in the shared checkout', () => {
  const step2 = SCRATCH.slice(SCRATCH.indexOf('## 2. Creating it'), SCRATCH.indexOf('## 3. First action inside'));
  assert.match(step2, /Never `git\s*\n?\s*checkout` or `git pull` in the shared checkout to accomplish this/);
});

// --- 3. pr-first-merge.md Step 5: exactly one gh api -X DELETE, never --delete-branch, guard ---

test('pr-first-merge.md Step 5 exists and contains exactly one gh api -X DELETE call', () => {
  const step5 = MERGE_POST_MERGE.indexOf('## Step 5: Delete the remote branch');
  assert.ok(step5 > 0, 'Step 5 must exist');
  const matches = MERGE_POST_MERGE.match(/gh api -X DELETE/g) || [];
  assert.strictEqual(matches.length, 1, `expected exactly one "gh api -X DELETE" statement, found ${matches.length}`);
  const section = MERGE_POST_MERGE.slice(step5);
  assert.match(section, /gh api -X DELETE "repos\/\{owner\}\/\{repo\}\/git\/refs\/heads\/\{branch\}"/);
});

test('pr-first-merge.md Step 5 names never `gh pr merge --delete-branch`', () => {
  const step5 = MERGE_POST_MERGE.slice(MERGE_POST_MERGE.indexOf('## Step 5: Delete the remote branch'));
  assert.match(step5, /Never `gh pr merge\s*\n?\s*--delete-branch` either/);
});

test('pr-first-merge.md Step 5 guards against deleting {integration-branch} itself', () => {
  const step5 = MERGE_POST_MERGE.slice(MERGE_POST_MERGE.indexOf('## Step 5: Delete the remote branch'));
  assert.match(step5, /Guard: never delete `\{integration-branch\}` itself/);
});

test('pr-first-merge.md Step 5 also never uses git push origin --delete, and tolerates an already-deleted ref', () => {
  const step5 = MERGE_POST_MERGE.slice(MERGE_POST_MERGE.indexOf('## Step 5: Delete the remote branch'));
  assert.match(step5, /Never `git push origin --delete \{branch\}`/);
  assert.match(step5, /Tolerate "reference\s*\n?\s*does not exist"/);
});

// --- 4. cleanup-procedures.md Section C steps 5-6: route through teardown-run, never
// duplicate the delete command inline (#594 folded these into `bin/hooks.js teardown-run`,
// which implements pr-first-merge-post-merge.md's Step 5 mechanism internally) ---

test('cleanup-procedures.md Section C steps 5-6 invoke teardown-run rather than duplicating the delete command', () => {
  const sectionC = CLEANUP_PROCEDURES_EXECUTION.indexOf('## C. Git Worktree');
  const sectionD = CLEANUP_PROCEDURES_EXECUTION.indexOf('## D. Ephemeral dev server');
  assert.ok(sectionC > 0 && sectionD > sectionC, 'Section C must exist and precede Section D');
  const section = CLEANUP_PROCEDURES_EXECUTION.slice(sectionC, sectionD);
  assert.match(section, /bin\/hooks\.js"\s+teardown-run --run "\$RUN_DIR"/);
  assert.doesNotMatch(
    section,
    /git\/refs\/heads/,
    'Section C must delegate to teardown-run, never duplicate its literal gh api ref-delete command',
  );
});

test('the literal git/refs/heads ref-delete command is stated exactly once, canonically, in pr-first-merge-post-merge.md', () => {
  // Sweeps all files touched by #683 (plus #851's split of pr-first-merge.md
  // and cleanup-procedures.md) — the citation discipline this record's prose
  // asserts (CLAUDE.md's "state once" rule) should hold structurally, not
  // just by the one Section C check above.
  const files = { SCRATCH, SETUP, MERGE, MERGE_POST_MERGE, CLEANUP, CLEANUP_PROCEDURES_EXECUTION };
  const hits = Object.entries(files).filter(([, text]) => /git\/refs\/heads/.test(text)).map(([name]) => name);
  assert.deepStrictEqual(hits, ['MERGE_POST_MERGE'], `git/refs/heads must appear only in pr-first-merge-post-merge.md, found in: ${hits.join(', ')}`);
});
