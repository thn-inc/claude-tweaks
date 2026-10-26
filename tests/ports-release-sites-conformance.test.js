'use strict';
// Pins #1793's three skill-side "worktree remove" release sites (AC4) —
// a prose test per skill-prose-conformance-tests: each assertion pins a
// literal substring that would go red if the corresponding edit were ever
// reverted.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const RELEASE_CMD = 'node "${CLAUDE_PLUGIN_ROOT}/bin/ports.js" release --path';

function read(relPath) {
  return readText(path.join(__dirname, '..', relPath));
}

test('tidy/scan-procedures.md releases the port lease after the worktree-remove instruction', () => {
  const md = read('plugin/skills/tidy/scan-procedures.md');
  const idx = md.indexOf('worktree remove {path}` for worktrees.');
  assert.notEqual(idx, -1, 'worktree-remove instruction not found');
  const after = md.slice(idx, idx + 400);
  assert.ok(after.includes(RELEASE_CMD), 'no release command after the worktree-remove instruction in scan-procedures.md');
});

test('tidy/SKILL.md releases the port lease after the worktree-remove instruction', () => {
  const md = read('plugin/skills/tidy/SKILL.md');
  const idx = md.indexOf('worktree remove {path}`; delete branches');
  assert.notEqual(idx, -1, 'worktree-remove instruction not found');
  const after = md.slice(idx, idx + 400);
  assert.ok(after.includes(RELEASE_CMD), 'no release command after the worktree-remove instruction in tidy/SKILL.md');
});

test('wrap-up/cleanup-procedures-execution.md Section C releases the own-worktree port lease BEFORE ExitWorktree, with an explicit --path', () => {
  const md = read('plugin/skills/wrap-up/cleanup-procedures-execution.md');
  const releaseIdx = md.indexOf(RELEASE_CMD);
  assert.notEqual(releaseIdx, -1, 'no release command in cleanup-procedures-execution.md');
  const exitWorktreeIdx = md.indexOf('**`ExitWorktree`**');
  assert.notEqual(exitWorktreeIdx, -1, 'no ExitWorktree call found');
  assert.ok(releaseIdx < exitWorktreeIdx, 'the release command must be stated BEFORE the ExitWorktree call, not after');
  assert.match(md, /release before `ExitWorktree`, not after/, 'the release-before-ExitWorktree ordering must be explicitly stated, not just implied by position');
});
