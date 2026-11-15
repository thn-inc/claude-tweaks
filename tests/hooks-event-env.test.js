'use strict';
// #5377: pre-tool-use reads the environment from the context hooks.js builds (ctx.env), never from
// the real process.env. Every case runs the event through runHookCli, which fails a call that read
// the real process.env.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runHookCli, hookEnv } = require('./helpers/hook-event');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');
const { gitRepoWithCommit } = require('./helpers/pre-tool-use');

const preToolUse = require('../plugin/bin/lib/hooks/pre-tool-use');

const bashPayload = (command, cwd) => JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd, session_id: 'sess-5377' });
const writePayload = (filePath, cwd) => JSON.stringify({ tool_name: 'Write', tool_input: { file_path: filePath }, cwd, session_id: 'sess-5377' });

function mkRunAt(project, name, worktree) {
  const run = path.join(project, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'active', worktree }));
  return run;
}

// Sets process.env keys for the body of fn and restores them afterwards.
async function withProcessEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

// CLAUDE_PID absent: the owner-pid fallback walks the ancestry with ps, which must run under the injected env too.
function envWithoutPid(overrides) {
  const env = hookEnv(overrides);
  delete env.CLAUDE_PID;
  return env;
}

function denialReason(res) {
  const out = JSON.parse(res.stdout);
  return out.hookSpecificOutput.permissionDecisionReason;
}

// A new run dir inside a linked worktree: the shadow guard denies it and logs a wd-guard-refusal
// event into the ad-hoc run dir it mints under the main checkout.
function shadowDenialFixture() {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const target = path.join(wt, '.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-1', 'decisions.md');
  return { main, wt, target };
}

function readRefusalEvents(main) {
  const pipelines = path.join(main, '.claude-tweaks', 'pipelines');
  const dirs = fs.readdirSync(pipelines).filter((n) => n.endsWith('-adhoc-standalone'));
  assert.strictEqual(dirs.length, 1, 'one ad-hoc run dir is minted for the denial');
  return fs.readFileSync(path.join(pipelines, dirs[0], 'events.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.type === 'wd-guard-refusal');
}

test('AC2.1: pre-tool-use resolves the run directory from the injected env, not process.env', async () => {
  const main = gitRepoWithCommit();
  const wtOld = linkedWorktreeOf(main);
  const wtA = linkedWorktreeOf(main);
  const wtB = linkedWorktreeOf(main);
  const wtC = linkedWorktreeOf(main);
  // process.env names the OLDEST run: neither the injected run (A) nor the newest-run fallback (C).
  const runOld = mkRunAt(main, '2026-06-01T090000-spec-9', wtOld);
  const runA = mkRunAt(main, '2026-07-01T090000-spec-1', wtA);
  mkRunAt(main, '2026-07-02T090000-spec-2', wtB);
  mkRunAt(main, '2026-07-03T090000-spec-3', wtC);
  const input = bashPayload('git commit -m "x"', main);
  const assigned = (wt) => `assigned worktree is ${wt} `;
  await withProcessEnv({ PIPELINE_RUN_DIR: runOld }, async () => {
    const named = await runHookCli(['pre-tool-use'], { input, cwd: main, env: hookEnv({ PIPELINE_RUN_DIR: runA }), tripwire: false });
    assert.strictEqual(named.code, 0);
    assert.ok(denialReason(named).includes(assigned(wtA)), `the injected run is the assigned one: ${denialReason(named)}`);
    // tripwire off: the assertion itself, not the tripwire, must tell a fallback from a process.env read.
    const unnamed = await runHookCli(['pre-tool-use'], { input, cwd: main, env: hookEnv({ PIPELINE_RUN_DIR: '' }), tripwire: false });
    assert.strictEqual(unnamed.code, 0);
    assert.ok(denialReason(unnamed).includes(assigned(wtC)), `with no run dir in the injected env the newest run (C) is the fallback: ${denialReason(unnamed)}`);
    assert.ok(!denialReason(unnamed).includes(assigned(wtOld)), 'the run process.env names is not read');
  });
});

test('AC3.1: CT_HOOKS_TEST_MODE only in the injected env tags the denial\'s friction event as a test event', async () => {
  const { main, wt, target } = shadowDenialFixture();
  await withProcessEnv({ CT_HOOKS_TEST_MODE: undefined }, async () => {
    assert.ok(!('CT_HOOKS_TEST_MODE' in process.env));
    const res = await runHookCli(['pre-tool-use'], { input: writePayload(target, wt), cwd: wt, env: hookEnv({ CT_HOOKS_TEST_MODE: '1' }) });
    assert.strictEqual(res.code, 0);
    assert.match(denialReason(res), /resolve-run-dir/);
  });
  const events = readRefusalEvents(main);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].test, true);
});

test('AC3.2: CT_HOOKS_TEST_MODE only in process.env leaves the event untagged', async () => {
  const { main, wt, target } = shadowDenialFixture();
  const env = hookEnv();
  delete env.CT_HOOKS_TEST_MODE;
  assert.ok(!('CT_HOOKS_TEST_MODE' in env));
  await withProcessEnv({ CT_HOOKS_TEST_MODE: '1' }, async () => {
    const res = await runHookCli(['pre-tool-use'], { input: writePayload(target, wt), cwd: wt, env });
    assert.strictEqual(res.code, 0);
    assert.match(denialReason(res), /resolve-run-dir/);
  });
  const events = readRefusalEvents(main);
  assert.strictEqual(events.length, 1);
  assert.ok(!('test' in events[0]), `the event carries no test field: ${JSON.stringify(events[0])}`);
});

test('pre-tool-use allow and deny read nothing from process.env', async () => {
  const repo = gitRepoWithCommit();
  const allowed = await runHookCli(['pre-tool-use'], { input: writePayload(path.join(repo, 'a.txt'), repo), cwd: repo, env: hookEnv() });
  assert.strictEqual(allowed.code, 0);
  assert.strictEqual(allowed.stdout, '');

  fs.mkdirSync(path.join(repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\n');
  const denied = await runHookCli(['pre-tool-use'], { input: writePayload(path.join(repo, 'b.txt'), repo), cwd: repo, env: envWithoutPid() });
  assert.strictEqual(denied.code, 0);
  assert.match(denialReason(denied), /requires an isolated worktree/);
});

test('pre-tool-use git helpers run their git child under the passed env', () => {
  const repo = gitRepoWithCommit();
  fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.txt\n');
  const ignored = path.join(repo, 'ignored.txt');
  fs.writeFileSync(ignored, 'x');
  // GIT_DIR names no repository, so a git child that sees it cannot answer.
  const broken = { ...hookEnv(), GIT_DIR: path.join(repo, 'no-such-git-dir') };
  assert.strictEqual(preToolUse.isUntrackedOrIgnored(repo, ignored, { env: hookEnv() }), true, 'control: a clean env answers');
  assert.strictEqual(preToolUse.isUntrackedOrIgnored(repo, ignored, { env: broken }), false);
  assert.strictEqual(preToolUse.toplevel(repo, { env: hookEnv() }), repo, 'control: a clean env answers');
  assert.strictEqual(preToolUse.toplevel(repo, { env: broken }), null);
});

test('pre-tool-use deny text names the injected CLAUDE_PLUGIN_ROOT', async () => {
  const { wt, target } = shadowDenialFixture();
  const named = await runHookCli(['pre-tool-use'], { input: writePayload(target, wt), cwd: wt, env: hookEnv({ CLAUDE_PLUGIN_ROOT: '/opt/injected-root' }) });
  assert.ok(denialReason(named).includes('node "/opt/injected-root/bin/hooks.js" resolve-run-dir'), denialReason(named));
  const bare = hookEnv();
  delete bare.CLAUDE_PLUGIN_ROOT;
  const literal = await runHookCli(['pre-tool-use'], { input: writePayload(target, wt), cwd: wt, env: bare });
  assert.ok(denialReason(literal).includes('node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir'), denialReason(literal));
});

test('pre-tool-use with an empty env resolves to an exit code', async () => {
  const repo = gitRepoWithCommit();
  const res = await runHookCli(['pre-tool-use'], { input: writePayload(path.join(repo, 'a.txt'), repo), cwd: repo, env: {} });
  assert.ok(Number.isInteger(res.code), `exit code is an integer: ${res.code}`);
});

test('pre-tool-use run throws on a context without env', () => {
  const input = { tool_name: 'Write', tool_input: { file_path: path.join(os.tmpdir(), 'x.txt') } };
  assert.throws(() => preToolUse.run({ input, cwd: os.tmpdir() }), TypeError);
});

test('pre-tool-use helpers only a hook event calls throw TypeError when env is left out', () => {
  const abs = path.join(os.tmpdir(), 'x');
  assert.throws(() => preToolUse.isUntrackedOrIgnored(abs, path.join(abs, 'y')), TypeError);
  assert.throws(() => preToolUse.isPolicyOnlyCommit('git commit -m x', abs), TypeError);
  assert.throws(() => preToolUse.toplevel(abs), TypeError);
  assert.throws(() => preToolUse.shadowPipelineRunDir(path.join(abs, 'y')), TypeError);
  assert.throws(() => preToolUse.readConsoleCeiling(abs, abs), TypeError);
});

// --- the six light event modules (post-tool-use, post-tool-use-failure, session-end, pre-compact,
// subagent-stop, user-prompt-submit) read the context too ---

const postToolUse = require('../plugin/bin/lib/hooks/post-tool-use');
const postToolUseFailure = require('../plugin/bin/lib/hooks/post-tool-use-failure');
const sessionEnd = require('../plugin/bin/lib/hooks/session-end');
const preCompact = require('../plugin/bin/lib/hooks/pre-compact');
const subagentStop = require('../plugin/bin/lib/hooks/subagent-stop');
const userPromptSubmit = require('../plugin/bin/lib/hooks/user-prompt-submit');

const SESSION = 'sess-5377';
const eventPayload = (extra, cwd) => JSON.stringify({ session_id: SESSION, cwd, ...extra });

// A project whose one run dir is owned by SESSION (and by ownerPid, when given).
function ownedProject({ ownerPid } = {}) {
  const project = gitRepo();
  const run = mkRunAt(project, '2026-11-15T000000-spec-5377', project);
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'active', worktree: project, sessionId: SESSION, ...(ownerPid ? { ownerPid } : {}) }));
  return { project, run };
}

function eventsOf(run) {
  const file = path.join(run, 'events.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
}

function stateOf(run) {
  return JSON.parse(fs.readFileSync(path.join(run, 'run-state.json'), 'utf8'));
}

test('post-tool-use reads nothing from process.env', async () => {
  const { project, run } = ownedProject();
  const res = await runHookCli(['post-tool-use'], {
    input: eventPayload({ tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'q?', header: 'h', options: [{ label: 'a' }] }] }, tool_response: 'a' }, project),
    cwd: project,
    env: hookEnv(),
  });
  assert.strictEqual(res.code, 0);
  assert.ok(eventsOf(run).length > 0, 'an event reached the owned run');
});

test('post-tool-use runs its git children under the injected env (a commit check)', async () => {
  const { project } = ownedProject();
  const res = await runHookCli(['post-tool-use'], {
    input: eventPayload({ tool_name: 'Bash', tool_input: { command: 'git commit -m "x"' } }, project),
    cwd: project,
    env: hookEnv(),
  });
  assert.strictEqual(res.code, 0);
});

test('post-tool-use stamps the owner pid from the injected env', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const injected = String(process.pid);
  await withProcessEnv({ CLAUDE_PID: String(process.ppid) }, async () => {
    // A fresh session id: the non-EnterWorktree ad-hoc check leaves a once-per-session marker in the tmp dir.
    const input = eventPayload({ session_id: `sess-5377-${process.pid}-${Date.now()}`, tool_name: 'Write', tool_input: { file_path: path.join(wt, 'a.txt') } }, wt);
    const res = await runHookCli(['post-tool-use'], { input, cwd: wt, env: hookEnv({ CLAUDE_PID: injected }) });
    assert.strictEqual(res.code, 0);
  });
  const pipelines = path.join(main, '.claude-tweaks', 'pipelines');
  const dirs = fs.readdirSync(pipelines).filter((n) => n.endsWith('-adhoc-standalone'));
  assert.strictEqual(dirs.length, 1, 'one ad-hoc run dir is minted');
  assert.strictEqual(stateOf(path.join(pipelines, dirs[0])).ownerPid, Number(injected));
});

const REFUSAL = (wt) => `This session is isolated in the worktree ${wt}, but this command … cannot be shown not to be git. Refusing to run it — a worktree-isolated session's git operations must target its own worktree.`;
const refusalPayload = (wt) => eventPayload({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'd=.; sed -n 1,2p $d/README.md' }, error: REFUSAL(wt) }, wt);

test('post-tool-use-failure reads nothing from process.env', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const res = await runHookCli(['post-tool-use-failure'], { input: refusalPayload(wt), cwd: wt, env: hookEnv() });
  assert.strictEqual(res.code, 0);
  assert.strictEqual(readRefusalEvents(main).length, 1);
});

test('post-tool-use-failure tags its event from the injected CT_HOOKS_TEST_MODE only', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  await withProcessEnv({ CT_HOOKS_TEST_MODE: undefined }, async () => {
    await runHookCli(['post-tool-use-failure'], { input: refusalPayload(wt), cwd: wt, env: hookEnv({ CT_HOOKS_TEST_MODE: '1' }) });
  });
  assert.strictEqual(readRefusalEvents(main)[0].test, true);

  const main2 = gitRepo();
  const wt2 = linkedWorktreeOf(main2);
  const bare = hookEnv();
  delete bare.CT_HOOKS_TEST_MODE;
  await withProcessEnv({ CT_HOOKS_TEST_MODE: '1' }, async () => {
    await runHookCli(['post-tool-use-failure'], { input: refusalPayload(wt2), cwd: wt2, env: bare });
  });
  assert.ok(!('test' in readRefusalEvents(main2)[0]), 'process.env alone does not tag the event');
});

test('session-end reads nothing from process.env', async () => {
  const { project, run } = ownedProject();
  const res = await runHookCli(['session-end'], { input: eventPayload({ reason: 'exit' }, project), cwd: project, env: hookEnv() });
  assert.strictEqual(res.code, 0);
  assert.strictEqual(stateOf(run).status, 'interrupted');
  assert.ok(eventsOf(run).some((e) => e.type === 'session-end'));
});

test('session-end treats a nested session by the injected CLAUDE_PID', async () => {
  const { project, run } = ownedProject({ ownerPid: process.pid });
  const input = eventPayload({ reason: 'other' }, project);
  // process.env names the owner's pid; the injected env names another process, so the run is a nested session's.
  await withProcessEnv({ CLAUDE_PID: String(process.pid) }, async () => {
    await runHookCli(['session-end'], { input, cwd: project, env: hookEnv({ CLAUDE_PID: String(process.pid + 1) }) });
  });
  assert.strictEqual(stateOf(run).status, 'active', 'a nested process ending must not stamp the parent run');
  await withProcessEnv({ CLAUDE_PID: String(process.pid + 1) }, async () => {
    await runHookCli(['session-end'], { input, cwd: project, env: hookEnv({ CLAUDE_PID: String(process.pid) }) });
  });
  assert.strictEqual(stateOf(run).status, 'interrupted', 'the owner process ending still stamps interrupted');
});

test('pre-compact reads nothing from process.env', async () => {
  const { project, run } = ownedProject();
  const res = await runHookCli(['pre-compact'], { input: eventPayload({ trigger: 'auto' }, project), cwd: project, env: hookEnv() });
  assert.strictEqual(res.code, 0);
  assert.strictEqual(stateOf(run).lastEvent, 'pre-compact');
  assert.ok(eventsOf(run).some((e) => e.type === 'pre-compact'));
});

test('subagent-stop reads nothing from process.env', async () => {
  const { project, run } = ownedProject();
  const transcript = path.join(project, 'agent.jsonl');
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'task' }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: {} }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'All done.\n\nSTATUS: DONE' }] } }),
  ].join('\n') + '\n');
  const res = await runHookCli(['subagent-stop'], { input: eventPayload({ agent_transcript_path: transcript, agent_id: 'a1' }, project), cwd: project, env: hookEnv() });
  assert.strictEqual(res.code, 0);
  assert.deepStrictEqual(eventsOf(run).filter((e) => e.type === 'contract-violation'), []);
});

test('user-prompt-submit reads nothing from process.env', async () => {
  const { project, run } = ownedProject();
  const res = await runHookCli(['user-prompt-submit'], { input: eventPayload({ prompt: '/claude-tweaks:help' }, project), cwd: project, env: hookEnv() });
  assert.strictEqual(res.code, 0);
  assert.ok(eventsOf(run).some((e) => e.type === 'skill_invoked' && e.source === 'user'));
});

test('the six light event modules throw TypeError on a context without env', () => {
  const ctx = { input: {}, ownedRun: {}, cwd: os.tmpdir() };
  for (const mod of [postToolUse, postToolUseFailure, sessionEnd, preCompact, subagentStop, userPromptSubmit]) {
    assert.throws(() => mod.run(ctx), TypeError);
  }
});
