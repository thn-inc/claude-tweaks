'use strict';
// tests/build-dispatch-status-token-and-tree-immutability.test.js — pins #2740: /build's
// subagent-strategy dispatch procedure (dispatch.md, read by SKILL.md Common Step 2's "subagent"
// branch) directs /superpowers:subagent-driven-development to (1) require the Subagent Contract's
// trailing STATUS: {WORD} line on every per-task implementer/reviewer/re-review reply it composes,
// and (2) forbid in-place worktree mutation during a task-reviewer/re-review discrimination check.
// Before this fix, neither requirement reached SDD's own composed prompts: an SDD reviewer reverted
// a file in a shared worktree in place to prove a test discriminates, and 15 SDD subagent replies
// this run were logged as `contract-violation` events because the templates never asked for the
// trailing status line (`_shared/subagent-output-contract.md`'s Implementer Status Protocol).
// #4556: the scratch-checkout alternative is now the core recipe, cited and pasted through.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const DISPATCH = read('plugin', 'skills', 'build', 'dispatch.md');

test('dispatch.md: directs SDD to require the trailing STATUS: {WORD} line on implementer, task-reviewer, and re-review dispatches', () => {
  assert.match(
    DISPATCH,
    /require that every per-task implementer dispatch, task-reviewer dispatch, and re-review dispatch it composes ends its own reply with the Subagent Contract's required status line/,
    'dispatch.md must direct /superpowers:subagent-driven-development to require the status-token line on every implementer/reviewer/re-review reply it composes (#2740) — otherwise the instruction never reaches SDD\'s own composed prompts.'
  );
});

test('dispatch.md: the status-token directive names the canonical trailing line and cites the Subagent Contract rather than inventing new phrasing', () => {
  assert.match(
    DISPATCH,
    /`STATUS: \{WORD\}`, one of `DONE`\/`DONE_WITH_CONCERNS`\/`NEEDS_CONTEXT`\/`BLOCKED`, the reply's last non-empty line\) per `_shared\/subagent-output-contract\.md`'s Implementer Status Protocol/,
    'dispatch.md must name the canonical trailing STATUS: {WORD} form and cite subagent-output-contract.md\'s Implementer Status Protocol, reusing its wording verbatim rather than inventing new phrasing.'
  );
});

test('dispatch.md: directs SDD to forbid in-place worktree mutation during a task-reviewer/re-review discrimination check', () => {
  assert.match(
    DISPATCH,
    /instruct every task-reviewer and re-review dispatch it composes that it must never mutate the shared worktree in place/,
    'dispatch.md must direct /superpowers:subagent-driven-development to forbid an in-place worktree mutation (e.g. `git checkout --` then restore) during a reviewer/re-review discrimination check (#2740) — a concurrent implementer\'s in-flight edit in the same shared worktree could otherwise be silently lost.'
  );
});

function assert2740(text) {
  assert.match(
    text,
    /runs in a scratch checkout per `_shared\/subagent-dispatch-core\.md`'s \*\*Discrimination checks in a scratch checkout\*\* section/,
    'dispatch.md must cite the core scratch-checkout recipe for a reviewer/re-review discrimination check that needs to revert or edit a file (#4556).'
  );
  assert.ok(
    text.includes('never via `git checkout --` or an in-place edit-then-restore in this shared worktree'),
    'dispatch.md must keep the ban on git checkout -- and in-place edit-then-restore in the shared worktree.'
  );
  assert.match(
    text,
    /paste[s]? (?:its|that section's) steps/,
    'dispatch.md must direct that the recipe steps be pasted into the SDD invocation instruction (#4556).'
  );
  assert.ok(
    text.includes('`/build` fills `{plugin-root}` and `{worktree}`;'),
    'dispatch.md must split placeholder ownership: /build fills plugin-root and worktree (#4556).'
  );
  assert.ok(
    text.includes('SDD fills `{reviewed-sha}`, the commit under review, `{base-sha}`, the task\'s base, and `{id}`, task plus reviewer role plus round, per dispatch'),
    'dispatch.md must give SDD the per-dispatch placeholders: reviewed-sha, base-sha, and id with the round (#4556).'
  );
  assert.ok(
    !text.includes('scratch `git worktree add`'),
    'dispatch.md must not carry a bare scratch `git worktree add` beside the recipe citation (#4556).'
  );
}

test('dispatch.md: the tree-immutability directive cites the core scratch-checkout recipe (#4556)', () => {
  assert2740(DISPATCH);
});

// Frozen: the #2740 sentence as it stood before #4556 (bare `git worktree add`, no recipe cite).
const PRE_4556_2740 =
  'a discrimination check that needs a reverted or edited file (e.g. proving a new test fails against the pre-fix code) runs in a scratch `git worktree add`, never via `git checkout --` or an in-place edit-then-restore in this shared worktree';

test('the #2740 pin goes red on the pre-#4556 sentence (go-red)', () => {
  assert.throws(() => assert2740(PRE_4556_2740));
  assert.throws(() => assert2740(DISPATCH.split('`/build` fills `{plugin-root}`').join('`/build` supplies `{plugin-root}`')));
  // Delete SDD's half of the split, and each placeholder within it.
  const sddHalf = "SDD fills `{reviewed-sha}`, the commit under review, `{base-sha}`, the task's base, and `{id}`, task plus reviewer role plus round, per dispatch";
  assert.ok(DISPATCH.includes(sddHalf), 'live dispatch.md must carry SDD\'s half to mutate');
  assert.throws(() => assert2740(DISPATCH.split(sddHalf).join('SDD fills nothing')));
  assert.throws(() => assert2740(DISPATCH.split('and `{id}`, task plus reviewer role plus round,').join('and `{id}`,')));
  assert.throws(() => assert2740(DISPATCH.split('`{base-sha}`, the task\'s base,').join('')));
  // A bare scratch worktree re-added beside the citation.
  assert.throws(() => assert2740(`${DISPATCH}\nA discrimination check runs in a scratch \`git worktree add\`.\n`));
});
