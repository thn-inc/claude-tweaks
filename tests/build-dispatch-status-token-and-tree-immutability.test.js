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

test('dispatch.md: the tree-immutability directive names the scratch-worktree alternative', () => {
  assert.match(
    DISPATCH,
    /runs in a scratch `git worktree add`, never via `git checkout --` or an in-place edit-then-restore in this shared worktree/,
    'dispatch.md must name the non-mutating alternative — a scratch `git worktree add` — for a reviewer/re-review discrimination check that needs to revert or edit a file.'
  );
});
