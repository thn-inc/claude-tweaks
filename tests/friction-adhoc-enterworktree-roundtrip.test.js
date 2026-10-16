'use strict';
// tests/friction-adhoc-enterworktree-roundtrip.test.js — record #2783's own repro,
// end to end: an ad-hoc EnterWorktree session in a checkout that already holds
// an unrelated unowned run dir (the fallback-guess shape that hid the bug),
// a harness worktree-isolation refusal inside the worktree, ExitWorktree
// remove, then a wrap-up run dir created from the main checkout. The real
// friction-events.js CLI must return the refusal.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const post = require('../plugin/bin/lib/hooks/post-tool-use');
const failure = require('../plugin/bin/lib/hooks/post-tool-use-failure');
const ctxLib = require('../plugin/bin/lib/hooks/context');
const { gitRepo, harnessWorktreeOf } = require('./helpers/git-fixtures');

const FRICTION_EVENTS = path.join(__dirname, '..', 'plugin', 'bin', 'friction-events.js');

test('#2783 repro: the harness refusal from an ad-hoc EnterWorktree session survives ExitWorktree remove', () => {
  const main = gitRepo();
  const pipelines = path.join(main, '.claude-tweaks', 'pipelines');
  const sibling = path.join(pipelines, '2026-10-01T000000-tidy-standalone');
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, 'decisions.md'), '## /tidy\n');

  const wt = harnessWorktreeOf(main);
  const S = 'sess-2783-roundtrip';
  const atEnter = ctxLib.resolveRun(wt, {}, S);
  assert.strictEqual(atEnter.attribution, 'fallback', 'precondition: the bug\'s shape — only a guessed run resolves');

  post.run({
    input: { tool_name: 'EnterWorktree', tool_response: { content: `Created worktree at ${wt} on branch wt-branch. The session is now working in the worktree.` }, session_id: S, cwd: wt },
    cwd: wt,
    ownedRun: atEnter,
  });
  const afterEnter = ctxLib.resolveRun(wt, {}, S);
  assert.strictEqual(afterEnter.attribution, 'session', 'EnterWorktree must have minted a session-owned ad-hoc dir');

  failure.run({
    input: {
      tool_name: 'Bash', tool_input: { command: 'd=.; sed -n 1,2p $d/README.md' }, session_id: S, cwd: wt,
      error: `This session is isolated in the worktree ${wt}, but this command … cannot be shown not to be git. Refusing to run it — a worktree-isolated session's git operations must target its own worktree.`,
    },
    cwd: wt,
    ownedRun: afterEnter,
  });

  execFileSync('git', ['-C', main, 'worktree', 'remove', '--force', wt]);

  const wrapUpRunDir = path.join(pipelines, '2026-10-03T000000-wrap-up-standalone');
  fs.mkdirSync(wrapUpRunDir);
  const events = JSON.parse(execFileSync('node', [FRICTION_EVENTS, '--run', wrapUpRunDir, '--session', S], { cwd: main, encoding: 'utf8' }));
  const refusals = events.filter((e) => e.type === 'wd-guard-refusal');
  assert.strictEqual(refusals.length, 1, JSON.stringify(events));
  assert.strictEqual(refusals[0]._source, 'adhoc');
  assert.strictEqual(refusals[0].reason, 'harness-worktree-isolation');
  assert.ok(!fs.existsSync(path.join(sibling, 'events.jsonl')), 'nothing may land in the unrelated sibling run');
});

test('#2783 control: without --session (and no env id), the same sequence after removal returns [] — the gap the session lookup closes', () => {
  const main = gitRepo();
  const pipelines = path.join(main, '.claude-tweaks', 'pipelines');
  const wt = harnessWorktreeOf(main);
  const S = 'sess-2783-control';
  post.run({ input: { tool_name: 'EnterWorktree', tool_response: { content: `Created worktree at ${wt} on branch b.` }, session_id: S, cwd: wt }, cwd: wt, ownedRun: ctxLib.resolveRun(wt, {}, S) });
  execFileSync('git', ['-C', main, 'worktree', 'remove', '--force', wt]);
  const wrapUpRunDir = path.join(pipelines, '2026-10-03T000000-wrap-up-standalone');
  fs.mkdirSync(wrapUpRunDir, { recursive: true });
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  const events = JSON.parse(execFileSync('node', [FRICTION_EVENTS, '--run', wrapUpRunDir], { cwd: main, encoding: 'utf8', env }));
  assert.deepStrictEqual(events, []);
});
