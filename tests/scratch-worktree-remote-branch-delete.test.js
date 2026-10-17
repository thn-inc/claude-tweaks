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
const MULTISPEC_CONSOLE = read('plugin', 'skills', 'flow', 'multispec-review-console.md');

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

test('cleanup-procedures-execution.md Section C no longer claims the ancestry check holds for squash/rebase merges, and gives pr-first its own proof', () => {
  const sectionC = CLEANUP_PROCEDURES_EXECUTION.indexOf('## C. Git Worktree');
  const sectionD = CLEANUP_PROCEDURES_EXECUTION.indexOf('## D. Ephemeral dev server');
  assert.ok(sectionC > 0 && sectionD > sectionC, 'Section C must exist and precede Section D');
  const section = CLEANUP_PROCEDURES_EXECUTION.slice(sectionC, sectionD);
  assert.doesNotMatch(section, /holds for `--no-ff`, fast-forward, and squash\/rebase merges alike/);
  assert.doesNotMatch(section, /strictly stronger/);
  assert.match(section, /integration-model: local-merge/);
  assert.match(section, /integration-model: pr-first/);
  assert.match(section, /gh pr view \{number\} --repo \{owner\}\/\{repo\} --json mergeCommit/);
  assert.match(section, /git diff HEAD \{merge-commit\}/);
});

test('cleanup-procedures-execution.md Section C uses a merge-tree containment proof for pr-first, not a plain diff, and stops when the PR has no merge commit yet', () => {
  const sectionC = CLEANUP_PROCEDURES_EXECUTION.indexOf('## C. Git Worktree');
  const sectionD = CLEANUP_PROCEDURES_EXECUTION.indexOf('## D. Ephemeral dev server');
  const section = CLEANUP_PROCEDURES_EXECUTION.slice(sectionC, sectionD);
  assert.match(section, /git merge-tree --write-tree \{merge-commit\} HEAD/);
  assert.match(section, /No\s*`mergeCommit`/);
  assert.doesNotMatch(section, /\*\*Empty\*\* authorizes `discard_changes: true`/, 'the old empty-diff authorization wording must be gone, not left alongside the new merge-tree check');
});

test('scratch-worktree.md §6 states why its ancestry check does not need Section C\'s squash-merge correction', () => {
  const step6 = SCRATCH.slice(SCRATCH.indexOf('## 6. Tearing down'), SCRATCH.indexOf('## 7. Shell constraint'));
  assert.match(step6, /Cross-caller `pr-first` check/);
  assert.match(step6, /cleanup-procedures-execution\.md`'s Section C/);
});

test('cleanup-procedures-execution.md Section C has an own-worktree remote-branch-delete step after ExitWorktree (#3088)', () => {
  const sectionC = CLEANUP_PROCEDURES_EXECUTION.indexOf('## C. Git Worktree');
  const sectionD = CLEANUP_PROCEDURES_EXECUTION.indexOf('## D. Ephemeral dev server');
  const section = CLEANUP_PROCEDURES_EXECUTION.slice(sectionC, sectionD);
  assert.match(section, /Own-worktree remote-branch delete \(#3088\)/);
  assert.match(section, /pr\.branch/);
  assert.match(section, /--remote-ref-only/);
  assert.match(section, /Only when step 4 actually proceeded past its/);
});

test("multispec-review-console.md Shared teardown step 7 passes --remote-ref-only, leaving archival to the console's last step (#3192)", () => {
  const start = MULTISPEC_CONSOLE.indexOf('**Branch + remote-ref cleanup, once the shared worktree is gone (#594).**');
  const end = MULTISPEC_CONSOLE.indexOf('### Per-issue label cleanup');
  assert.ok(start > 0 && end > start, 'Shared teardown step 7 must exist and precede Per-issue label cleanup');
  const step7 = MULTISPEC_CONSOLE.slice(start, end);
  assert.match(step7, /teardown-run --run "\$MULTISPEC_PARENT_DIR"[\s\\]*--merged --remote-ref-only/);
  assert.match(step7, /On approval" step 9/);
  assert.match(MULTISPEC_CONSOLE, /^9\. Archive the parent run dir/m, 'the "On approval" step 9 that step 7 points at must be the archive action');
});

test('multispec-review-console.md "When to run" step 6 no longer routes archival through step 7\'s teardown-run (#3192)', () => {
  const start = MULTISPEC_CONSOLE.indexOf('## When to run the consolidated console');
  const end = MULTISPEC_CONSOLE.indexOf('## Locating the parent run directory');
  const section = MULTISPEC_CONSOLE.slice(start, end);
  assert.doesNotMatch(section, /reaches archival only inside step 7's `teardown-run`/);
  assert.match(section, /--remote-ref-only/);
});
