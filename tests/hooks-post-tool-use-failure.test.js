'use strict';
// tests/hooks-post-tool-use-failure.test.js — #2783 Deliverable 2. Claude Code's
// own worktree-isolation Bash guard is invisible to PreToolUse/PostToolUse
// consumers; measured 2026-10-16, it fires PostToolUseFailure with the full
// refusal text in `error`. An ordinary non-zero exit fires the same event, so
// classification is by the refusal-text signature only.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const failure = require('../plugin/bin/lib/hooks/post-tool-use-failure');
const ctxLib = require('../plugin/bin/lib/hooks/context');
const { gitRepo, harnessWorktreeOf } = require('./helpers/git-fixtures');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

function refusal(wt) {
  return `This session is isolated in the worktree ${wt}, but this command runs sed with a value computed at runtime (the variable d) where an option may stand in a plain command, so what it runs cannot be shown not to be git. Refusing to run it — a worktree-isolated session's git operations must target its own worktree. Run the plain command from ${wt}.`;
}
function adhocDirs(main) {
  try { return fs.readdirSync(path.join(main, '.claude-tweaks', 'pipelines')).filter((n) => n.endsWith('-adhoc-standalone')); } catch { return []; }
}
function failureCtx(wt, error, { sessionId = 'sess-ptuf-1', toolName = 'Bash' } = {}) {
  return {
    input: { hook_event_name: 'PostToolUseFailure', tool_name: toolName, tool_input: { command: 'd=.; sed -n 1,2p $d/README.md' }, error, session_id: sessionId, cwd: wt, is_interrupt: false },
    cwd: wt,
    ownedRun: {},
  };
}

test('a harness worktree-isolation refusal is logged as wd-guard-refusal into a freshly minted ad-hoc dir', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  assert.deepStrictEqual(failure.run(failureCtx(wt, refusal(wt))), {});
  const dirs = adhocDirs(main);
  assert.strictEqual(dirs.length, 1);
  const events = ctxLib.readEventLines(path.join(main, '.claude-tweaks', 'pipelines', dirs[0]));
  const refusals = events.filter((e) => e.type === 'wd-guard-refusal');
  assert.strictEqual(refusals.length, 1);
  assert.strictEqual(refusals[0].reason, 'harness-worktree-isolation');
  assert.strictEqual(refusals[0].tool, 'Bash');
  assert.strictEqual(refusals[0].command, 'd=.; sed -n 1,2p $d/README.md');
});

test('an ordinary failing Bash command is NOT a guard refusal — nothing logged, nothing minted', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  failure.run(failureCtx(wt, 'Exit code 128\nfatal: not a git repository (or any of the parent directories): .git'));
  assert.deepStrictEqual(adhocDirs(main), []);
});

test('a non-Bash tool failure is ignored even if its text matches', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  failure.run(failureCtx(wt, refusal(wt), { toolName: 'Edit' }));
  assert.deepStrictEqual(adhocDirs(main), []);
});

test('the command excerpt is capped at 200 characters', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const ctx = failureCtx(wt, refusal(wt));
  ctx.input.tool_input.command = 'x'.repeat(500);
  failure.run(ctx);
  const dir = path.join(main, '.claude-tweaks', 'pipelines', adhocDirs(main)[0]);
  assert.strictEqual(ctxLib.readEventLines(dir).find((e) => e.type === 'wd-guard-refusal').command.length, 200);
});

test('hooks.json registers PostToolUseFailure for Bash, routed to the post-tool-use-failure event', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const group = (cfg.hooks.PostToolUseFailure || []).find((g) => g.matcher === 'Bash');
  assert.ok(group, 'PostToolUseFailure has no Bash matcher group');
  assert.match(group.hooks[0].command, /hooks\.js" post-tool-use-failure$/);
});

test('dispatcher end-to-end: hooks.js post-tool-use-failure logs the refusal and exits 0', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  const input = JSON.stringify(failureCtx(wt, refusal(wt), { sessionId: 'sess-ptuf-e2e' }).input);
  const out = execFileSync('node', [HOOKS, 'post-tool-use-failure'], { input, cwd: wt, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '' } });
  assert.strictEqual(out.trim(), '');
  const dirs = adhocDirs(main);
  assert.strictEqual(dirs.length, 1);
  const events = ctxLib.readEventLines(path.join(main, '.claude-tweaks', 'pipelines', dirs[0]));
  assert.ok(events.some((e) => e.type === 'wd-guard-refusal' && e.reason === 'harness-worktree-isolation'));
});
