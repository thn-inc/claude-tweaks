'use strict';
// #3304: the Claude Code worktree-isolation refusal text lives in one module,
// and both hook consumers derive from it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');
const { gitRepo, harnessWorktreeOf } = require('./helpers/git-fixtures');
const failure = require('../plugin/bin/lib/hooks/post-tool-use-failure');
const ctxLib = require('../plugin/bin/lib/hooks/context');
const { earlyGate } = require('../plugin/bin/lib/hooks/bash-prefilter');
const {
  REFUSAL_FRAGMENTS,
  REFUSAL_SIGNATURES,
  HARNESS_ISOLATION_REFUSAL_RE,
  classifyRefusal,
} = require('../plugin/bin/lib/hooks/harness-refusal');

const HOOKS_DIR = path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks');

test('harness-refusal: the derived regex is the widened #3819 source exactly', () => {
  assert.strictEqual(
    HARNESS_ISOLATION_REFUSAL_RE.source,
    String.raw`(This session|This agent) is isolated in the worktree [\s\S]*?(Refusing to run it|Refusing to run there)`,
  );
  assert.strictEqual(HARNESS_ISOLATION_REFUSAL_RE.flags, '');
});

test('harness-refusal: fragments are the five literals in message order', () => {
  assert.deepStrictEqual(
    [...REFUSAL_FRAGMENTS],
    ['This session', 'This agent', ' is isolated in the worktree ', 'Refusing to run it', 'Refusing to run there'],
  );
  assert.ok(Object.isFrozen(REFUSAL_FRAGMENTS));
  assert.deepStrictEqual([...REFUSAL_SIGNATURES], ['Refusing to run it', 'Refusing to run there']);
  assert.ok(Object.isFrozen(REFUSAL_SIGNATURES));
});

const WT = '/w/.claude/worktrees/agent-a1';
const SESSION_GUARD = `This session is isolated in the worktree ${WT}, but this command runs sed with a value computed at runtime (the variable d) where an option may stand in a plain command, so what it runs cannot be shown not to be git. Refusing to run it — a worktree-isolated session's git operations must target its own worktree. Run the plain command from ${WT}.`;
const AGENT_GUARD = SESSION_GUARD.replace('This session', 'This agent').replace("session's", "agent's");
const AGENT_OTHER_WORKTREE = `This agent is isolated in the worktree ${WT}, but this command's working directory (/w/other) is in a different worktree (/w/other). Refusing to run it there — a worktree-isolated agent's commands must run inside its own worktree. Re-run the command from ${WT}.`;
const GONE_FIXED = `This agent is isolated in the worktree ${WT}, but its working directory "${WT}/sub" no longer exists and the only recovery target is the parent session's shared checkout. Refusing to run there — the isolation worktree appears to have been removed. Report this instead of retrying.`;
const GONE_NOUN = `This session is isolated in the worktree ${WT}, but its working directory "${WT}/sub" no longer exists and the recovery target (/w) is outside that worktree. Refusing to run there. Report this instead of retrying.`;
const FIXTURES = [
  ['SESSION_GUARD', SESSION_GUARD, { actor: 'session', variant: 'guard' }],
  ['AGENT_GUARD', AGENT_GUARD, { actor: 'agent', variant: 'guard' }],
  ['AGENT_OTHER_WORKTREE', AGENT_OTHER_WORKTREE, { actor: 'agent', variant: 'guard' }],
  ['GONE_FIXED', GONE_FIXED, { actor: 'agent', variant: 'worktree-gone' }],
  ['GONE_NOUN', GONE_NOUN, { actor: 'session', variant: 'worktree-gone' }],
];

test('classifyRefusal: each refusal template classifies by noun and signature', () => {
  for (const [name, text, expected] of FIXTURES) {
    assert.deepStrictEqual(classifyRefusal(text), expected, name);
  }
});

test('matcher: HARNESS_ISOLATION_REFUSAL_RE matches every refusal template on its own, apart from actor/variant attribution', () => {
  for (const [name, text] of FIXTURES) {
    assert.ok(HARNESS_ISOLATION_REFUSAL_RE.test(text), name);
  }
});

test('classifyRefusal: non-refusals return null', () => {
  const editToolText = `This agent is isolated in the worktree ${WT}, so its writes are limited to that folder. This path is in a different worktree (/w). Edit the copy of this file under ${WT} instead.`;
  for (const text of ['Exit code 1\nfatal: not a git repository', undefined, 42, editToolText]) {
    assert.strictEqual(classifyRefusal(text), null);
  }
});

function ptufCtx(wt, error, cwd = wt) {
  return {
    input: { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'd=.; sed -n 1,2p $d/README.md' }, error, session_id: 'sess-refusal-1', cwd, is_interrupt: false },
    cwd,
    ownedRun: {},
  };
}
function adhocDirs(main) {
  try { return fs.readdirSync(path.join(main, '.claude-tweaks', 'pipelines')).filter((n) => n.endsWith('-adhoc-standalone')); } catch { return []; }
}

for (const [name, text, expected] of FIXTURES) {
  test(`post-tool-use-failure logs one wd-guard-refusal with actor/variant for ${name}`, () => {
    const main = gitRepo();
    const wt = harnessWorktreeOf(main);
    failure.run(ptufCtx(wt, text.split(WT).join(wt)));
    const dirs = adhocDirs(main);
    assert.strictEqual(dirs.length, 1, name);
    const events = ctxLib.readEventLines(path.join(main, '.claude-tweaks', 'pipelines', dirs[0]));
    const refusals = events.filter((e) => e.type === 'wd-guard-refusal');
    assert.strictEqual(refusals.length, 1, name);
    assert.strictEqual(refusals[0].reason, 'harness-worktree-isolation', name);
    assert.strictEqual(refusals[0].actor, expected.actor, name);
    assert.strictEqual(refusals[0].variant, expected.variant, name);
  });
}

test('a worktree-gone refusal whose cwd no longer exists logs into the session\'s trusted owned run', () => {
  const main = gitRepo();
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-10-28T00-00-00Z-gone');
  fs.mkdirSync(runDir, { recursive: true });
  const removedCwd = path.join(main, '.claude', 'worktrees', 'agent-removed');
  const ctx = ptufCtx(removedCwd, GONE_FIXED, removedCwd);
  ctx.ownedRun = { dir: runDir };
  failure.run(ctx);
  const refusals = ctxLib.readEventLines(runDir).filter((e) => e.type === 'wd-guard-refusal');
  assert.strictEqual(refusals.length, 1);
  assert.strictEqual(refusals[0].actor, 'agent');
  assert.strictEqual(refusals[0].variant, 'worktree-gone');
  assert.deepStrictEqual(adhocDirs(main), []);
});

test('post-tool-use-failure logs nothing for an unrelated Bash failure', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main);
  failure.run(ptufCtx(wt, 'Exit code 128\nfatal: not a git repository (or any of the parent directories): .git'));
  assert.deepStrictEqual(adhocDirs(main), []);
});

test('bash-prefilter earlyGate passes every refusal template to the handler', () => {
  const gate = (text) => earlyGate('post-tool-use-failure', () => JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'x' }, error: text }));
  for (const [name, text] of FIXTURES) {
    assert.strictEqual(gate(text).skip, false, name);
  }
  const escaped = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'x' }, error: GONE_FIXED }).replace('Refusing', '\\u0052efusing');
  assert.ok(escaped.includes('\\u0052efusing'));
  assert.strictEqual(earlyGate('post-tool-use-failure', () => escaped).skip, false);
});

test('harness-refusal: post-tool-use-failure re-exports the same RegExp object', () => {
  assert.strictEqual(
    require('../plugin/bin/lib/hooks/post-tool-use-failure').HARNESS_ISOLATION_REFUSAL_RE,
    HARNESS_ISOLATION_REFUSAL_RE,
  );
});

test('harness-refusal: neither hook module spells the refusal text itself (one-place change)', () => {
  for (const file of ['post-tool-use-failure.js', 'bash-prefilter.js']) {
    const raw = readText(path.join(HOOKS_DIR, file));
    const stripped = stripComments(raw);
    assert.strictEqual(stripperVerdict(raw, stripped), 'ok', `${file}: comment stripper must parse cleanly`);
    // Shorter respellings too: a partial copy ('Refusing to run') must not slip through either.
    for (const literal of ['Refusing to run', 'isolated in the worktree', 'This session', 'This agent']) {
      assert.ok(!stripped.includes(literal), `${file} spells "${literal}" in code instead of deriving it`);
    }
    assert.ok(raw.includes("require('./harness-refusal')"), `${file} must require ./harness-refusal`);
  }
});
