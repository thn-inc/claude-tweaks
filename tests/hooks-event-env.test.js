'use strict';
// #5377: pre-tool-use reads the environment from the context hooks.js builds (ctx.env), never from
// the real process.env. Every case runs the event through runHookCli, which fails a call that read
// the real process.env.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir, isolateTmpdir } = require('./helpers/tmp-dir');
isolateTmpdir('ct-iso-hooks-event-env-');
const os = require('os');
const path = require('path');
const { runHookCli, hookEnv } = require('./helpers/hook-event');
const { gitRepo, linkedWorktreeOf, fixtureGit, cleanGitEnv } = require('./helpers/git-fixtures');
const { gitRepoWithCommit } = require('./helpers/pre-tool-use');
const { withProcessEnv } = require('./helpers/process-env');

const preToolUse = require('../plugin/bin/lib/hooks/pre-tool-use');

const bashPayload = (command, cwd) => JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd, session_id: 'sess-5377' });
const writePayload = (filePath, cwd) => JSON.stringify({ tool_name: 'Write', tool_input: { file_path: filePath }, cwd, session_id: 'sess-5377' });

function mkRunAt(project, name, worktree) {
  const run = path.join(project, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'active', worktree }));
  return run;
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
  // The expected root is git's own spelling: Git for Windows prints forward slashes, `repo` has backslashes there.
  const root = fixtureGit(['-C', repo, 'rev-parse', '--show-toplevel'], { env: cleanGitEnv(), encoding: 'utf8' }).trim();
  assert.ok(root, 'the fixture repository has a top level');
  assert.strictEqual(preToolUse.toplevel(repo, { env: hookEnv() }), root, 'control: a clean env answers');
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
function ownedProject({ ownerPid, session = SESSION } = {}) {
  const project = gitRepo();
  const run = mkRunAt(project, '2026-11-15T000000-spec-5377', project);
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'active', worktree: project, sessionId: session, ...(ownerPid ? { ownerPid } : {}) }));
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

test('post-tool-use stamps the owner pid and owner block from the injected env, and its marker under the injected tmp dir', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const tmp = scratchDir('ct-env5377-tmp-');
  const injected = String(process.pid);
  // A fresh session id: the non-EnterWorktree ad-hoc check leaves a once-per-session marker under the tmp dir.
  const sessionId = `sess-5377-${process.pid}-${Date.now()}`;
  try {
    await withProcessEnv({ CLAUDE_PID: String(process.ppid) }, async () => {
      const input = eventPayload({ session_id: sessionId, tool_name: 'Write', tool_input: { file_path: path.join(wt, 'a.txt') } }, wt);
      const res = await runHookCli(['post-tool-use'], { input, cwd: wt, env: hookEnv({ CLAUDE_PID: injected, TMPDIR: tmp, TEMP: tmp }) });
      assert.strictEqual(res.code, 0);
    });
    const pipelines = path.join(main, '.claude-tweaks', 'pipelines');
    const dirs = fs.readdirSync(pipelines).filter((n) => n.endsWith('-adhoc-standalone'));
    assert.strictEqual(dirs.length, 1, 'one ad-hoc run dir is minted');
    const state = stateOf(path.join(pipelines, dirs[0]));
    assert.strictEqual(state.ownerPid, Number(injected));
    assert.strictEqual(state.owner.pid, Number(injected), 'the owner block carries the injected pid too');
    assert.ok(fs.existsSync(path.join(tmp, `ct-session-${sessionId}`, 'adhoc-worktree-checked')), 'the once-per-session marker lands under the injected tmp dir');
    assert.ok(!fs.existsSync(path.join(os.tmpdir(), `ct-session-${sessionId}`)), 'and nothing lands under the real tmp dir');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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

test('subagent-stop writes its retry counter under the injected tmp dir', async () => {
  const sessionId = `sess-5377-retry-${process.pid}-${Date.now()}`;
  const { project } = ownedProject({ session: sessionId });
  const tmp = scratchDir('ct-env5377-tmp-');
  const transcript = path.join(project, 'agent.jsonl');
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'task' }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: {} }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Looked into it.\nNot sure yet.\nWill keep digging.' }] } }),
  ].join('\n') + '\n');
  const counter = `ct-contract-retries-${sessionId}.json`;
  try {
    const res = await runHookCli(['subagent-stop'], {
      input: JSON.stringify({ session_id: sessionId, cwd: project, agent_transcript_path: transcript, agent_id: 'a1' }),
      cwd: project,
      env: hookEnv({ TMPDIR: tmp, TEMP: tmp }),
    });
    assert.strictEqual(res.code, 0);
    assert.strictEqual(JSON.parse(res.stdout).decision, 'block', 'the first violation is blocked once');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(tmp, counter), 'utf8')), ['a1']);
    assert.ok(!fs.existsSync(path.join(os.tmpdir(), counter)), 'nothing lands under the real tmp dir');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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

// --- session-start reads the context and starts its background child through ctx.spawn ---

const sessionStart = require('../plugin/bin/lib/hooks/session-start');
const { fixtureHomeEnv } = require('./helpers/fixture-home');
const { HOOKS } = require('./helpers/hook-event');

const sessionStartPayload = (cwd) => JSON.stringify({ session_id: SESSION, cwd, source: 'startup' });

// A fake for the detached background child: records the call, and answers the two methods the helper uses.
function fakeSpawn() {
  const calls = [];
  const spawn = (file, args, options) => {
    calls.push({ file, args, options });
    return { on() {}, unref() {} };
  };
  return { spawn, calls };
}

// A repo whose background status file is stale (completedAt 1), and a fixture home the env names.
function sessionStartFixture(extraEnv = {}) {
  const repo = gitRepo();
  fs.mkdirSync(path.join(repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude-tweaks', 'reconcile-background-status.json'), JSON.stringify({ completedAt: 1, surfaced: true, summary: {} }));
  const home = scratchDir('ct-env5377-home-');
  return { repo, home, env: fixtureHomeEnv(home, hookEnv(extraEnv)) };
}

// Gives `repo` a bare origin with origin/HEAD set (`setHead`) or left unset, so reconcile resolves an
// integration branch (or has to repair origin/HEAD). Returns the bare repository's path.
function addOrigin(repo, { setHead = true } = {}) {
  const bare = scratchDir('ct-env5377-origin-');
  const git = (args) => fixtureGit(['-C', repo, ...args], { env: cleanGitEnv(), stdio: 'ignore' });
  fixtureGit(['init', '-q', '--bare', '-b', 'main', bare], { env: cleanGitEnv(), stdio: 'ignore' });
  git(['remote', 'add', 'origin', bare]);
  git(['push', '-q', 'origin', 'HEAD:main']);
  git(['fetch', '-q', 'origin']);
  if (setHead) {
    git(['remote', 'set-head', 'origin', 'main']);
  } else {
    // A recent git sets origin/HEAD on fetch; drop it, and tolerate a git that never set it.
    try { git(['symbolic-ref', '--delete', 'refs/remotes/origin/HEAD']); } catch { /* already absent */ }
  }
  return bare;
}

test('session-start reads nothing from process.env', async () => {
  // The rich fixture walks every branch of the event that a plain repo skips: a policy file (worktree-always
  // and port-services), a stale run, and an origin, so reconcile resolves the integration branch and model.
  const { repo, home, env } = sessionStartFixture();
  fs.writeFileSync(path.join(repo, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\nport-services: web\n');
  mkRunAt(repo, '2026-07-01T090000-spec-1', repo);
  // #3977: the banner lists a run only once reconcile cached it as orphaned and its session reads dead,
  // so the run's liveness probes run here too, under the tripwire.
  const { seedOrphan, deadOwner, writeOldEvents } = require('./helpers/orphan-fixture');
  const staleRun = path.join(repo, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.writeFileSync(path.join(staleRun, 'run-state.json'), JSON.stringify({ status: 'interrupted', ...deadOwner() }));
  writeOldEvents(staleRun);
  seedOrphan(repo, staleRun);
  const bare = addOrigin(repo);
  const { spawn } = fakeSpawn();
  try {
    const res = await runHookCli(['session-start'], { input: sessionStartPayload(repo), cwd: repo, env, deps: { spawn } });
    assert.strictEqual(res.code, 0);
    const context = JSON.parse(res.stdout).hookSpecificOutput.additionalContext;
    assert.match(context, /Interaction style/);
    assert.match(context, /orphaned pipeline run/);
    assert.match(context, /worktree-always: ON/);
    assert.match(context, /claude-tweaks: ports \d+-\d+ \(/);
    assert.ok(fs.existsSync(path.join(home, '.claude-tweaks', 'ports.json')), 'the port registry lands under the injected home');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('session-start passes its context to reconcile: the model probe gets the injected env and homeDir', async () => {
  const repo = gitRepo();
  const bare = addOrigin(repo);
  const reconcileLib = require('../plugin/bin/lib/reconcile');
  const env = hookEnv({ CT_5377_SENTINEL: 'from-ctx-env' });
  const homeDir = () => '/injected/home';
  let seen = null;
  try {
    const result = await reconcileLib.reconcile({
      cwd: repo, env, homeDir, checks: ['mirror'],
      resolveIntegrationModel: (root, opts) => { seen = opts; return 'local-merge'; },
    });
    assert.ok(seen, 'the model probe ran');
    assert.strictEqual(seen.env, env);
    assert.strictEqual(seen.homeDir, homeDir);
    assert.ok(result.skipped.some((s) => s.reason === 'local-merge-model'));
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('reconcile runs its integration-branch and origin/HEAD git children under the passed env', async () => {
  const reconcileLib = require('../plugin/bin/lib/reconcile');
  // GIT_DIR names no repository, so a git child that sees it cannot answer.
  const broken = { ...hookEnv(), GIT_DIR: path.join(os.tmpdir(), 'ct-env5377-no-such-git-dir') };
  const reasons = (result) => result.skipped.map((s) => s.reason);

  // origin/HEAD set: a clean env resolves the branch and stops at the model; a broken one finds no remote.
  const set = gitRepo();
  const setBare = addOrigin(set);
  // origin/HEAD unset: a clean env repairs it; a broken one reaches neither the lookup nor the repair.
  const unset = gitRepo();
  const unsetBare = addOrigin(unset, { setHead: false });
  const noModel = () => 'local-merge';
  try {
    // The clean-env cases run with the real process.env broken, so a git child that reads it instead of the
    // passed env fails and the case reads red; the broken-env cases run with a clean process.env.
    const inBrokenProcess = (fn) => withProcessEnv({ GIT_DIR: broken.GIT_DIR }, fn);
    const clean = await inBrokenProcess(() => reconcileLib.reconcile({ cwd: set, env: hookEnv(), checks: ['mirror'], resolveIntegrationModel: noModel }));
    assert.ok(reasons(clean).includes('local-merge-model'), `clean env: ${JSON.stringify(clean.skipped)}`);
    const bad = await reconcileLib.reconcile({ cwd: set, env: broken, checks: ['mirror'], resolveIntegrationModel: noModel });
    assert.ok(reasons(bad).includes('no-remote'), `broken env: ${JSON.stringify(bad.skipped)}`);

    const repaired = await inBrokenProcess(() => reconcileLib.reconcile({ cwd: unset, env: hookEnv(), checks: ['mirror'], resolveIntegrationModel: noModel }));
    assert.deepStrictEqual(repaired.originHeadRepair && repaired.originHeadRepair.outcome, 'repaired', JSON.stringify(repaired));
    // A fresh origin without origin/HEAD, so the repair is attempted again under the broken env.
    const unset2 = gitRepo();
    const unset2Bare = addOrigin(unset2, { setHead: false });
    try {
      const notRepaired = await reconcileLib.reconcile({ cwd: unset2, env: broken, checks: ['mirror'], resolveIntegrationModel: noModel });
      assert.strictEqual(notRepaired.originHeadRepair, undefined, JSON.stringify(notRepaired));
      assert.ok(reasons(notRepaired).includes('no-remote'));
    } finally {
      fs.rmSync(unset2Bare, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(setBare, { recursive: true, force: true });
    fs.rmSync(unsetBare, { recursive: true, force: true });
  }
});

test('reconcile prunes the declined store of its cwd and reads the lock wait from the passed env', async () => {
  const reconcileLib = require('../plugin/bin/lib/reconcile');
  const repo = gitRepo();
  // One decline from the year 2000: the prune removes it, from the store the cwd names (not the process's).
  const storeFile = path.join(repo, '.claude-tweaks', 'declined-learning', 'store.json');
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  fs.writeFileSync(storeFile, JSON.stringify({ fp1: { declinedAt: '2000-01-01T00:00:00.000Z', reason: null, source: 'test' } }));
  // The getter counts reads of the lock-wait knob made through the passed env.
  let knobReads = 0;
  const env = hookEnv();
  Object.defineProperty(env, 'CLAUDE_TWEAKS_LOCK_WAIT_MS', { enumerable: true, get() { knobReads += 1; return '0'; } });
  await reconcileLib.reconcile({ cwd: repo, env, checks: ['mirror'] });
  assert.ok(knobReads >= 1, 'the store lock read its wait from the passed env');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(storeFile, 'utf8')), {}, 'the prune ran against the cwd\'s store');
});

// --- reconcile's pr-first checks (the ones FAST_CHECKS names) run their git and gh children under the passed env ---

// A `gh` stub that logs `$CT_5377_SENTINEL <args>` to `$CT_5377_LOG`, so a call that ran under the passed env
// leaves the injected sentinel behind. Not for Windows (a shell script).
function ghStub(dir) {
  const script = `#!/bin/sh
echo "$CT_5377_SENTINEL $* pwd=$PWD" >> "$CT_5377_LOG"
case "$*" in
  *rate_limit*) echo 100;;
  *"pr view"*) if [ -n "$CT_5377_PR_VIEW" ]; then printf "%s\\n" "$CT_5377_PR_VIEW"; else printf "%s\\n" '{"comments":[{"id":"c1","body":"x"}],"body":""}'; fi;;
  *check-runs*) ;;
  *) echo '{}';;
esac
`;
  fs.writeFileSync(path.join(dir, 'gh'), script, { mode: 0o755 });
  // A git shim that logs the same way, then runs the real git: a git call that ran under the passed env leaves
  // the sentinel behind, one that did not never reaches the shim.
  fs.writeFileSync(path.join(dir, 'git'), `#!/bin/sh
echo "$CT_5377_SENTINEL git $*" >> "$CT_5377_LOG"
exec "$CT_5377_REAL_GIT" "$@"
`, { mode: 0o755 });
}

// The environment a pr-first reconcile runs under: the stub first on the PATH the env already carries (the
// key is found, not spelled: a win32 env keeps it as `Path`), the sentinel and the log it appends to.
function prFirstEnv(stubDir, log, extra = {}) {
  const realGit = require('child_process').execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const env = hookEnv({ CT_5377_SENTINEL: 'from-ctx-env', CT_5377_LOG: log, CT_5377_REAL_GIT: realGit, ...extra });
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  env[key] = stubDir + path.delimiter + env[key];
  return env;
}

// A main checkout with a bare origin, `.claude-tweaks/` excluded (so the mirror reads clean) and one active run
// whose console.json names PR 5, so the console check reaches its gh fetch.
function prFirstRepo() {
  const repo = gitRepo({ branch: 'main' });
  const bare = addOrigin(repo);
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.claude-tweaks/\n');
  const run = mkRunAt(repo, '2026-07-01T090000-spec-1', repo);
  fs.writeFileSync(path.join(run, 'console.json'), JSON.stringify({ prNumber: 5, commentIds: ['c1'], items: [] }));
  return { repo, bare };
}

// Puts one new commit on the bare origin's main, from a throwaway clone.
function advanceOrigin(bare) {
  const clone = scratchDir('ct-env5377-clone-');
  try {
    const git = (args) => fixtureGit(['-C', clone, '-c', 'user.name=T', '-c', 'user.email=t@example.test', ...args], { env: cleanGitEnv(), stdio: 'ignore' });
    fixtureGit(['clone', '-q', bare, clone], { env: cleanGitEnv(), stdio: 'ignore' });
    git(['commit', '--allow-empty', '-q', '-m', 'advance']);
    git(['push', '-q', 'origin', 'HEAD:main']);
  } finally {
    fs.rmSync(clone, { recursive: true, force: true });
  }
}

const headOf = (repo, ref) => fixtureGit(['-C', repo, 'rev-parse', ref], { env: cleanGitEnv(), encoding: 'utf8' }).trim();

test('reconcile FAST_CHECKS under pr-first run their children under the passed env', { skip: process.platform === 'win32' }, async () => {
  const reconcileLib = require('../plugin/bin/lib/reconcile');
  const stubDir = scratchDir('ct-env5377-gh-');
  ghStub(stubDir);
  const log = path.join(stubDir, 'gh.log');
  const brokenGitDir = path.join(os.tmpdir(), 'ct-env5377-no-such-git-dir');
  const bares = [];
  try {
    // 1. origin ahead, main checked out: shared fetch (async), classify, `branch --show-current`, `merge --ff-only`.
    const a = prFirstRepo();
    bares.push(a.bare);
    advanceOrigin(a.bare);
    // The real process.env is broken for git, so any git child that inherits it fails and the result reads red.
    // The pass runs from a subdirectory, so its own cwd and the main checkout (its root) are two different directories.
    const subA = path.join(a.repo, 'sub');
    fs.mkdirSync(subA);
    const ahead = await withProcessEnv({ GIT_DIR: brokenGitDir }, () => reconcileLib.reconcile({
      cwd: subA, env: prFirstEnv(stubDir, log), homeDir: () => os.tmpdir(), checks: ['mirror', 'red-tip', 'console'],
      resolveIntegrationModel: () => 'pr-first',
    }));
    assert.deepStrictEqual(ahead.skipped, [], JSON.stringify(ahead.skipped));
    assert.strictEqual(ahead.mirror.action, 'fast-forwarded', JSON.stringify(ahead.mirror));
    assert.strictEqual(headOf(a.repo, 'main'), headOf(a.repo, 'origin/main'));
    assert.deepStrictEqual(ahead.console.skipped.map((s) => s.reason), ['not-resolved-yet'], JSON.stringify(ahead.console));
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.ok(lines.every((l) => l.startsWith('from-ctx-env ')), `every gh call ran under the passed env: ${lines.join(' | ')}`);
    for (const needle of ['api rate_limit', 'check-runs', 'pr view 5', ' rev-parse origin/main', ' fetch origin main', ' status --porcelain', ' rev-list ', ' branch --show-current', ' merge --ff-only']) {
      assert.ok(lines.some((l) => l.includes(needle)), `a call matching ${needle}: ${lines.join(' | ')}`);
    }
    assert.ok(lines.find((l) => l.includes('api rate_limit')).endsWith(`pwd=${subA}`), 'the preflight gh child ran in the pass\'s own cwd, not the main checkout');

    // 2. origin ahead, another branch checked out: the `fetch origin main:main` update path.
    const b = prFirstRepo();
    bares.push(b.bare);
    fixtureGit(['-C', b.repo, 'checkout', '-q', '-b', 'other'], { env: cleanGitEnv(), stdio: 'ignore' });
    advanceOrigin(b.bare);
    const other = await withProcessEnv({ GIT_DIR: brokenGitDir }, () => reconcileLib.reconcile({
      cwd: b.repo, env: prFirstEnv(stubDir, log), checks: ['mirror'], resolveIntegrationModel: () => 'pr-first',
    }));
    assert.strictEqual(other.mirror.action, 'fast-forwarded', JSON.stringify(other.mirror));
    assert.strictEqual(headOf(b.repo, 'main'), headOf(b.repo, 'origin/main'));

    // 3. a remote-prune pass takes the synchronous preflight and, once the preflight is narrowed away, the sync
    // mirror-only fetch. The preflight is patched (the module object is what reconcile calls) to record its argument.
    const c = prFirstRepo();
    bares.push(c.bare);
    advanceOrigin(c.bare);
    const preflight = require('../plugin/bin/lib/reconcile/preflight');
    const realHealth = preflight.ghHealthCheck;
    let seen = null;
    const env3 = prFirstEnv(stubDir, log);
    preflight.ghHealthCheck = (o) => { seen = o; return { ok: false, reason: 'patched' }; };
    let narrowed;
    const subC = path.join(c.repo, 'sub');
    fs.mkdirSync(subC);
    try {
      narrowed = await withProcessEnv({ GIT_DIR: brokenGitDir }, () => reconcileLib.reconcile({
        cwd: subC, env: env3, homeDir: () => os.tmpdir(), checks: ['mirror', 'remote-prune'], resolveIntegrationModel: () => 'pr-first',
      }));
    } finally {
      preflight.ghHealthCheck = realHealth;
    }
    assert.ok(seen && seen.env === env3 && seen.cwd === subC, `the sync preflight got the passed env and cwd: ${JSON.stringify(seen && Object.keys(seen))}`);
    assert.ok(narrowed.skipped.some((s) => s.reason === 'preflight-patched'));
    assert.strictEqual(narrowed.mirror.action, 'fast-forwarded', JSON.stringify(narrowed.mirror));
  } finally {
    for (const b of bares) fs.rmSync(b, { recursive: true, force: true });
    fs.rmSync(stubDir, { recursive: true, force: true });
  }
});

test('the synchronous preflight and shared fetch run under the passed env', { skip: process.platform === 'win32' }, async () => {
  const { ghHealthCheck } = require('../plugin/bin/lib/reconcile/preflight');
  const { sharedFetch, sharedFetchAsync } = require('../plugin/bin/lib/reconcile/shared-fetch');
  const { mirrorFastForward } = require('../plugin/bin/lib/reconcile/mirror-ff');
  const stubDir = scratchDir('ct-env5377-gh-');
  ghStub(stubDir);
  const log = path.join(stubDir, 'gh.log');
  const { repo, bare } = prFirstRepo();
  const brokenGitDir = path.join(os.tmpdir(), 'ct-env5377-no-such-git-dir');
  try {
    const env = prFirstEnv(stubDir, log);
    await withProcessEnv({ GIT_DIR: brokenGitDir }, async () => {
      assert.deepStrictEqual(ghHealthCheck({ env, cwd: repo }), { ok: true, reason: null });
      assert.strictEqual(sharedFetch(repo, { integration: 'main', mirror: true, env }).failure, null, 'the mirror-only shape');
      assert.strictEqual(sharedFetch(repo, { integration: 'main', mirror: true, remotePrune: true, env }).failure, null, 'the --prune shape');
      assert.strictEqual((await sharedFetchAsync(repo, { integration: 'main', env })).failure, null, 'the async twin');
      // classifyMirror fetches itself when it is not told the caller already did.
      assert.strictEqual(mirrorFastForward(repo, 'main', { env }).state, 'current', 'a mirror that fetches for itself');
    });
    const preflightLine = fs.readFileSync(log, 'utf8').split('\n').find((l) => l.startsWith('from-ctx-env api rate_limit'));
    assert.ok(preflightLine, 'the preflight gh call ran under the passed env');
    assert.ok(preflightLine.endsWith(`pwd=${repo}`), `and in the cwd it was given: ${preflightLine}`);
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(stubDir, { recursive: true, force: true });
  }
});

test('the console check fetches member grants and its veto window under the passed env', { skip: process.platform === 'win32' }, async () => {
  const { consoleExecuteDetect } = require('../plugin/bin/lib/reconcile/console-execute');
  const stubDir = scratchDir('ct-env5377-gh-');
  ghStub(stubDir);
  const log = path.join(stubDir, 'gh.log');
  const { repo, bare } = prFirstRepo();
  // A merge row: the check reads the PR's Fixes members' grants (gh issue view) and the veto window (git).
  fs.writeFileSync(path.join(repo, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1', 'console.json'), JSON.stringify({
    prNumber: 5, commentIds: ['c1'], items: [{ id: 'm1', kind: 'merge', summary: 's', stagedHash: 'h', isMergeRow: true }],
  }));
  const prView = JSON.stringify({ comments: [{ id: 'c1', body: '<!-- console-item: resolve -->\n- [x] resolve' }], body: 'Fixes #7' });
  try {
    const env = prFirstEnv(stubDir, log, { CT_5377_PR_VIEW: prView });
    await withProcessEnv({ GIT_DIR: path.join(os.tmpdir(), 'ct-env5377-no-such-git-dir') }, () => consoleExecuteDetect({ cwd: repo, env }));
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.ok(lines.some((l) => l.startsWith('from-ctx-env issue view 7')), `the member grant fetch ran under the passed env: ${lines.join(' | ')}`);
    assert.ok(lines.some((l) => l === 'from-ctx-env git rev-parse --show-toplevel'), `the veto-window git read ran under the passed env: ${lines.join(' | ')}`);
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(stubDir, { recursive: true, force: true });
  }
});

test('the pr-first checks read gh\'s config dir through the passed homeDir', { skip: process.platform === 'win32' }, async () => {
  const reconcileLib = require('../plugin/bin/lib/reconcile');
  const { ghHealthCheck } = require('../plugin/bin/lib/reconcile/preflight');
  const { redTipCheck } = require('../plugin/bin/lib/reconcile/red-tip');
  const { consoleExecuteDetect } = require('../plugin/bin/lib/reconcile/console-execute');
  const { repo, bare } = prFirstRepo();
  // An origin on a non-github.com host sends ghOptions to gh's hosts file, found under homeDir() when neither
  // GH_CONFIG_DIR nor XDG_CONFIG_HOME names a directory.
  fixtureGit(['-C', repo, 'remote', 'set-url', 'origin', 'https://127.0.0.1:1/o/r.git'], { env: cleanGitEnv(), stdio: 'ignore' });
  const fakeHome = scratchDir('ct-env5377-home-');
  const stubDir = scratchDir('ct-env5377-gh-');
  ghStub(stubDir);
  try {
    const env = prFirstEnv(stubDir, path.join(stubDir, 'gh.log'));
    delete env.GH_CONFIG_DIR;
    delete env.XDG_CONFIG_HOME;
    delete env.GH_HOST;
    let calls = 0;
    const stacks = [];
    const homeDir = () => {
      calls += 1;
      const limit = Error.stackTraceLimit;
      Error.stackTraceLimit = 40;
      stacks.push(new Error().stack);
      Error.stackTraceLimit = limit;
      return fakeHome;
    };
    const count = () => calls;
    const before = count();
    ghHealthCheck({ env, homeDir, cwd: repo });
    assert.ok(count() > before, 'preflight');
    const afterPreflight = count();
    // memoised per env object: a fresh env gives a fresh lookup
    const env2 = { ...env };
    redTipCheck(repo, 'main', { env: env2, homeDir });
    assert.ok(count() > afterPreflight, 'red-tip');
    const afterRedTip = count();
    const env3 = { ...env };
    await consoleExecuteDetect({ cwd: repo, env: env3, homeDir });
    assert.ok(count() > afterRedTip, 'console');
    const afterConsole = count();
    // and reconcile hands its own homeDir to those same checks
    await reconcileLib.reconcile({ cwd: repo, env: { ...env }, homeDir, checks: ['mirror', 'console'], resolveIntegrationModel: () => 'pr-first' });
    assert.ok(count() > afterConsole, 'reconcile');
    // gh's host lookup is memoised per env object and directory, so the first site to ask is the one that
    // reads the home: reconcile's own preflight, through the async twin FAST_CHECKS take.
    assert.ok(stacks.slice(afterConsole).some((s) => s.includes('defaultRunnerAsync')), 'the async preflight');
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(stubDir, { recursive: true, force: true });
  }
});

test('pre-tool-use\'s forge probe reads gh\'s config dir through the context\'s homeDir', { skip: process.platform === 'win32' }, async () => {
  const { RUN_ID, commitMaterializedSpec } = require('./helpers/bookkeeping-stamps-gate');
  const main = gitRepo();
  // An origin on a non-github.com host sends ghOptions to gh's hosts file, found under homeDir() when neither
  // GH_CONFIG_DIR nor XDG_CONFIG_HOME names a directory.
  fixtureGit(['-C', main, 'remote', 'add', 'origin', 'https://127.0.0.1:1/o/r.git'], { env: cleanGitEnv(), stdio: 'ignore' });
  const wt = linkedWorktreeOf(main);
  commitMaterializedSpec(wt, path.join('work', '991-spec.md'));
  mkRunAt(main, RUN_ID, wt);
  const fakeHome = scratchDir('ct-env5377-home-');
  const stubDir = scratchDir('ct-env5377-gh-');
  ghStub(stubDir);
  try {
    const log = path.join(stubDir, 'gh.log');
    const env = prFirstEnv(stubDir, log, { HOME: fakeHome, USERPROFILE: fakeHome });
    delete env.GH_CONFIG_DIR;
    delete env.XDG_CONFIG_HOME;
    delete env.GH_HOST;
    // The probe runs (no `pr` is recorded and no model is pinned); a run that read the real home through
    // os.homedir() is rejected by runCli's home guard, so a resolved call is the proof.
    const res = await runHookCli(['pre-tool-use'], { input: writePayload(path.join(wt, 'src', 'x.js'), wt), cwd: wt, env });
    assert.strictEqual(res.code, 0);
    assert.ok(fs.readFileSync(log, 'utf8').includes('repo view'), 'the forge probe ran its gh call');
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(stubDir, { recursive: true, force: true });
  }
});

test('ports ensure resolves the checkout under the passed env and rejects a missing env or home', async () => {
  const portsEnsure = require('../plugin/bin/lib/ports/ensure');
  const repo = gitRepo();
  const home = scratchDir('ct-env5377-home-');
  const broken = { ...hookEnv(), GIT_DIR: path.join(os.tmpdir(), 'ct-env5377-no-such-git-dir') };
  const probe = async () => true;
  try {
    const clean = await portsEnsure.ensure(repo, { home, env: hookEnv(), policyServices: ['web'], probe });
    assert.strictEqual(clean.active, true, 'control: a clean env resolves the checkout');
    const bad = await portsEnsure.ensure(repo, { home, env: broken, policyServices: ['web'], probe });
    assert.deepStrictEqual(bad, { active: false });
    await assert.rejects(portsEnsure.ensure(repo, { home, policyServices: ['web'] }), TypeError);
    await assert.rejects(portsEnsure.ensure(repo, { env: hookEnv(), policyServices: ['web'] }), TypeError);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('session-start resolves the superpowers install under the injected home', async () => {
  const { repo, home, env } = sessionStartFixture();
  const install = path.join(home, 'sp-install');
  fs.mkdirSync(path.join(install, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(install, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'superpowers', version: '6.3.0' }));
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'superpowers@claude-plugins-official': [{ scope: 'user', installPath: install, lastUpdated: '2026-01-01T00:00:00.000Z' }] },
  }));
  const { spawn } = fakeSpawn();
  try {
    const res = await runHookCli(['session-start'], { input: sessionStartPayload(repo), cwd: repo, env, deps: { spawn } });
    assert.strictEqual(res.code, 0);
    assert.match(JSON.parse(res.stdout).hookSpecificOutput.additionalContext, /superpowers 6\.3\.0 is older than/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('session-start helpers only the event calls throw TypeError when env or home is left out', () => {
  const { effectiveSuperpowersVersion } = require('../plugin/bin/lib/superpowers-version');
  assert.throws(() => sessionStart.saveNodePath({}), { name: 'TypeError', message: /home is required/ });
  assert.throws(() => effectiveSuperpowersVersion(os.tmpdir(), { homedir: () => os.tmpdir() }), TypeError);
  assert.throws(() => effectiveSuperpowersVersion(os.tmpdir(), { env: {} }), TypeError);
});

test('deps.collect reads PATH from the passed env', { skip: process.platform === 'win32' }, () => {
  const { collect } = require('../plugin/bin/lib/deps');
  const bin = scratchDir('ct-env5377-bin-');
  try {
    for (const name of ['git', 'playwright-cli']) fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n', { mode: 0o755 });
    assert.deepStrictEqual(collect({ env: { PATH: bin }, cwd: null }), [], 'both tools are found on the passed PATH');
    const missing = collect({ env: { PATH: path.join(bin, 'nowhere') }, cwd: null });
    assert.ok(missing.some((m) => /git not found/.test(m)), `git is missing from the passed PATH: ${JSON.stringify(missing)}`);
    assert.ok(missing.some((m) => /playwright-cli/.test(m)));
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('session-start starts the background pass through the injected spawn with the injected env', async () => {
  const { repo, home, env } = sessionStartFixture({ CT_5377_SENTINEL: 'from-ctx-env' });
  const { spawn, calls } = fakeSpawn();
  try {
    const res = await runHookCli(['session-start'], { input: sessionStartPayload(repo), cwd: repo, env, deps: { spawn } });
    assert.strictEqual(res.code, 0);
    const bg = calls.filter((c) => c.args[1] === 'reconcile-background');
    assert.strictEqual(bg.length, 1, `one background child: ${JSON.stringify(calls.map((c) => c.args))}`);
    assert.deepStrictEqual(bg[0].args, [HOOKS, 'reconcile-background']);
    assert.strictEqual(bg[0].options.env.CT_5377_SENTINEL, 'from-ctx-env');
    assert.strictEqual(bg[0].options.env.CLAUDE_TWEAKS_SESSION_ID, SESSION);
    assert.strictEqual(bg[0].options.cwd, repo);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('session-start without a spawn fake rejects', async () => {
  const { repo, home, env } = sessionStartFixture();
  try {
    await assert.rejects(runHookCli(['session-start'], { input: sessionStartPayload(repo), cwd: repo, env }), /real spawn reached/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('session-start run throws on a context without env', async () => {
  await assert.rejects(sessionStart.run({ input: {}, cwd: os.tmpdir() }), { name: 'TypeError', message: /hook context has no env/ });
});

test('session-start run throws on a context without homeDir', async () => {
  const ctx = { input: {}, cwd: os.tmpdir(), env: hookEnv() };
  await assert.rejects(sessionStart.run(ctx), { name: 'TypeError', message: /hook context has no homeDir/ });
  await assert.rejects(sessionStart.run({ ...ctx, homeDir: '/tmp' }), { name: 'TypeError', message: /homeDir/ });
});

test('session-start writes the node path under the injected home', async () => {
  const { repo, home, env } = sessionStartFixture();
  const { spawn } = fakeSpawn();
  try {
    const res = await runHookCli(['session-start'], { input: sessionStartPayload(repo), cwd: repo, env, deps: { spawn } });
    assert.strictEqual(res.code, 0);
    assert.strictEqual(fs.readFileSync(path.join(home, '.claude-tweaks', 'node-path'), 'utf8'), process.execPath + '\n');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
