// tests/hooks-post-tool-use-teardown-reanchor.test.js
//
// #703's post-teardown re-anchor backstop: this repo's hooks cannot clear
// the harness's native worktree-isolation pin directly, so once a worktree
// teardown this repo's own gate did not deny has actually completed
// (ExitWorktree action:remove, or the sanctioned Bash `git worktree remove`
// shape), warn the agent to re-anchor to the main checkout before issuing
// any further git-dependent command. Mirrors
// tests/hooks-post-tool-use-worktree-staleness.test.js's own fixture/assert
// pattern for the EnterWorktree staleness backstop.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const post = require('../plugin/bin/lib/hooks/post-tool-use');
const { gitRepo, harnessWorktreeOf } = require('./helpers/git-fixtures');
const { shellQuote } = require('./helpers/shell-quote');

test('warns with a re-anchor pointer after ExitWorktree (action: remove) tears down the worktree', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  // Simulate the real removal ExitWorktree performs — the directory is gone
  // by the time PostToolUse fires, exactly like a real teardown.
  execFileSync('git', ['-C', main, 'worktree', 'remove', '--force', wt]);
  const input = { tool_name: 'ExitWorktree', tool_input: { action: 'remove' }, cwd: wt };
  const out = post.run({ input, cwd: wt });
  assert.ok(out.json && typeof out.json.systemMessage === 'string', 'expected a systemMessage warning');
  assert.match(out.json.systemMessage, /isolation pin/);
  assert.match(out.json.systemMessage, /Re-anchor/);
  assert.match(out.json.systemMessage, new RegExp(main.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('does not fire for ExitWorktree action: keep (non-destructive)', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const input = { tool_name: 'ExitWorktree', tool_input: { action: 'keep' }, cwd: wt };
  const out = post.run({ input, cwd: wt });
  assert.deepStrictEqual(out, {});
});

test('warns after a sanctioned Bash `git worktree remove` of a worktree other than the caller\'s own cwd', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  execFileSync('git', ['-C', main, 'worktree', 'remove', '--force', wt]);
  const command = `git worktree remove ${shellQuote(wt)}`;
  const input = { tool_name: 'Bash', tool_input: { command }, cwd: main };
  const out = post.run({ input, cwd: main });
  assert.ok(out.json && typeof out.json.systemMessage === 'string');
  assert.match(out.json.systemMessage, new RegExp(main.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('does not fire for a tool other than ExitWorktree/Bash', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const out = post.run({ input: { tool_name: 'EnterWorktree', cwd: wt }, cwd: wt });
  assert.deepStrictEqual(out, {});
});

test('does not fire for an ordinary Bash command with no worktree-remove shape', () => {
  const main = gitRepo();
  const input = { tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: main };
  const out = post.run({ input, cwd: main });
  assert.deepStrictEqual(out, {});
});

test('a Bash command with no worktree-remove shape and an unusable cwd never throws — returns {} rather than crashing', () => {
  const input = { tool_name: 'Bash', tool_input: { command: 'git status' } };
  const out = post.run({ input, cwd: '/this/path/does/not/exist/at/all' });
  assert.deepStrictEqual(out, {});
});

test('falls back to a generic re-anchor message when the main checkout root cannot be resolved', () => {
  // A bare tmpdir with no `.git` anywhere in its ancestry (up to the
  // filesystem root) — mainCheckoutRoot's walk-up finds nothing, so the
  // ExitWorktree case (which resolves its target from ctx.cwd directly, no
  // git check) still warns, but with the generic fallback wording rather
  // than a `cd {path}` pointer.
  const orphan = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ct-teardown-orphan-'));
  const input = { tool_name: 'ExitWorktree', tool_input: { action: 'remove' }, cwd: orphan };
  const out = post.run({ input, cwd: orphan });
  assert.ok(out.json && typeof out.json.systemMessage === 'string');
  assert.match(out.json.systemMessage, /could not be auto-resolved/);
  assert.doesNotMatch(out.json.systemMessage, /`cd /);
});
