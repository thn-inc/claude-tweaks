'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #1967: the #1864 review call ran `git stash` / `git stash pop` to compare
// against a baseline and popped a SIBLING worktree's WIP stash — the stash
// stack is repository-wide, shared by every linked worktree of the same main
// checkout. `plugin/bin/lib/hooks/pre-tool-use.js`'s `checkGitStashWarn` gate
// is pinned by tests/hooks-pre-tool-use.test.js, but the actual prose that
// stops a dispatched agent from reaching for stash in the first place — both
// `task-prompt.md` Task() calls and `build/dispatch.md`'s implementer
// instruction — had no test reading it at all. A future edit could drop the
// instruction from either template and nothing would fail. This file is that
// guard.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const TASK_PROMPT = read('plugin', 'skills', 'dispatch', 'task-prompt.md');
const BUILD_DISPATCH = read('plugin', 'skills', 'build', 'dispatch.md');

// Mirrors dispatch-worktree-anchoring.test.js's own region split — each of
// the two Task() calls is checked independently, since a whole-file
// (both-calls-concatenated) check would false-pass if only one call
// regressed while the other still carried the instruction.
function firstCallRegion(text) {
  const start = text.indexOf('## First call');
  assert.notStrictEqual(start, -1, 'skills/dispatch/task-prompt.md no longer has a "## First call" heading — this guard has lost its anchor');
  const end = text.indexOf('## Second call', start);
  assert.notStrictEqual(end, -1, 'skills/dispatch/task-prompt.md no longer has a "## Second call" heading — this guard has lost its anchor');
  return text.slice(start, end);
}

function secondCallRegion(text) {
  const start = text.indexOf('## Second call');
  assert.notStrictEqual(start, -1, 'skills/dispatch/task-prompt.md no longer has a "## Second call" heading — this guard has lost its anchor');
  const end = text.indexOf('None of Templates A/B/C', start);
  assert.notStrictEqual(end, -1, 'the second call is no longer followed by its template note — this guard has lost its anchor');
  return text.slice(start, end);
}

const REGIONS = [
  ['skills/dispatch/task-prompt.md (first call)', firstCallRegion(TASK_PROMPT)],
  ['skills/dispatch/task-prompt.md (second call)', secondCallRegion(TASK_PROMPT)],
];

for (const [name, region] of REGIONS) {
  test(`${name}: forbids git stash and names the non-mutating alternative`, () => {
    assert.match(
      region,
      /Never run `git stash`/,
      `${name} must tell the dispatched agent never to run \`git stash\` — the stash stack is ` +
        'shared repo-wide across every worktree of this checkout, so it can pop or clobber a ' +
        "sibling worktree's in-flight work (#1967, #1864).",
    );
    assert.match(
      region,
      /git show <rev>:<path>/,
      `${name} must point at \`git show <rev>:<path>\` as the non-mutating way to compare ` +
        'against a baseline.',
    );
  });
}

test('build/dispatch.md: instructs subagent-driven-development to forbid git stash in per-task implementer dispatches', () => {
  assert.match(
    BUILD_DISPATCH,
    /Forbid `git stash` in every per-task implementer dispatch/,
    'build/dispatch.md must direct /superpowers:subagent-driven-development to forbid git ' +
      'stash in every per-task implementer dispatch (#1967) — otherwise a per-task implementer ' +
      'never receives the instruction at all, since it is not itself one of task-prompt.md\'s ' +
      'two Task() calls.',
  );
  assert.match(
    BUILD_DISPATCH,
    /_shared\/subagent-dispatch-core\.md`'s no-stash rule/,
    "build/dispatch.md must cite _shared/subagent-dispatch-core.md's no-stash rule (moved from " +
      'subagent-output-contract.md at #2019) rather than re-restating the mechanism text inline.',
  );
});
