'use strict';
// #5392 Task 1: plugin/bin/hooks.sh finds a node and execs hooks.js. Every
// test runs once per available shell (sh, dash, bash) and starts with
// `hooks.sh ` so the Windows TAP log can be grepped for it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scratchDir, isolateTmpdir } = require('./helpers/tmp-dir');
isolateTmpdir('ct-iso-hooks-launcher-');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { gitRepo, linkedWorktreeOf, harnessWorktreeOf } = require('./helpers/git-fixtures');
const { fixtureHomeEnv } = require('./helpers/fixture-home');
const { pathWithOnly, findOnPath } = require('./helpers/path-stub');
const { readText } = require('./helpers/read-skill');
const { chmodDenialSkip } = require('./helpers/root');
const { INTERACTION_STYLE_DIRECTIVE } = require('../plugin/bin/lib/hooks/interaction-style');
const { mainCheckoutRoot } = require('../plugin/bin/lib/hooks/worktree-detect');
const { resolveWorktreeAlways } = require('../plugin/bin/lib/policy');

const ROOT = path.resolve(__dirname, '..');
const LAUNCHER_ARG = path.join(ROOT, 'plugin') + '/bin/hooks.sh';
const HOOKS_JS = path.join(ROOT, 'plugin', 'bin', 'hooks.js');

// win32 skips dash even when one is on PATH: the windows-latest runner has a dash
// that cannot exec a Windows-form path such as C:\...\node.exe (exit 127, measured
// in windows-regression run 43647466952). Claude Code runs Windows hooks under Git
// Bash's sh, which the [sh] variant covers.
const WIN32_DASH_SKIP = 'win32: dash cannot exec a Windows-form path (C:\\...\\node.exe), measured in windows-regression run 43647466952; Claude Code runs Windows hooks under Git Bash sh, covered by [sh]';

const SHELLS = [
  { name: 'sh', file: findOnPath('sh') },
  process.platform === 'win32'
    ? { name: 'dash', file: null, skipReason: WIN32_DASH_SKIP }
    : { name: 'dash', file: findOnPath('dash') },
  { name: 'bash', file: findOnPath('bash') },
];

const NOT_ON_PATH = (name) => `${name} not on PATH`;

// One test per shell; sh is required, dash and bash skip by name when missing.
function perShell(title, fn, extra = {}) {
  for (const sh of SHELLS) {
    const missing = !sh.file;
    if (missing && sh.name === 'sh') throw new Error('sh not found on PATH');
    test(`${title} [${sh.name}]`, { skip: (missing && (sh.skipReason || NOT_ON_PATH(sh.name))) || extra.skip }, (t) => fn(sh, t));
  }
}

function bareEnv(home) {
  const env = fixtureHomeEnv(home);
  for (const k of Object.keys(env)) {
    if (/^path$/i.test(k) || k === 'NVM_DIR' || k === 'FNM_DIR' || k === 'CLAUDE_TWEAKS_NODE_CANDIDATES') delete env[k];
  }
  return env;
}

// `awkDir`, when given, goes first on PATH so its `awk` is the one the
// launcher runs (the awk axis below).
function noNodeEnv(home, extra = {}, { awkDir } = {}) {
  const base = pathWithOnly(['sh', 'cat', 'awk'], { exclude: ['node'] });
  const env = {
    ...bareEnv(home),
    PATH: awkDir ? awkDir + path.delimiter + base : base,
    CLAUDE_TWEAKS_NODE_CANDIDATES: '',
    ...extra,
  };
  const probe = spawnSync(findOnPath('sh'), ['-c', 'command -v node'], { env, encoding: 'utf8', windowsHide: true });
  if (probe.status === 0) throw new Error(`noNodeEnv: node still resolves: ${probe.stdout}`);
  return env;
}

function runLauncher(shell, args, { input = '', cwd = os.tmpdir(), env, launcher = LAUNCHER_ARG } = {}) {
  const r = spawnSync(shell.file, [launcher, ...args], { input, cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error };
}

function fakeNode(dir, marker) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'node');
  fs.writeFileSync(f, `#!/bin/sh\nprintf '%s\\n' '${marker}'\ncat >/dev/null\n`);
  fs.chmodSync(f, 0o755); // root-safe
  return f;
}

// Every tmp() dir is removed once the file's tests finish. Best-effort: a
// directory a test left unreadable, or a file Windows still holds open, stays.
const TMP_DIRS = [];
require('node:test').after(() => {
  for (const dir of TMP_DIRS) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // left for the OS to reap
    }
  }
});

function tmp(prefix) {
  const dir = scratchDir(prefix);
  TMP_DIRS.push(dir);
  return dir;
}

function withPathNode() {
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => /^path$/i.test(k)) || 'PATH';
  const cur = env[key] || '';
  for (const k of Object.keys(env)) if (/^path$/i.test(k)) delete env[k];
  env.PATH = path.dirname(process.execPath) + path.delimiter + cur;
  env.PIPELINE_RUN_DIR = '';
  env.CT_HOOKS_TEST_MODE = '1';
  return env;
}

function bashPayload(command, cwd) {
  return JSON.stringify({ session_id: 's', cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
}

function nodeRun(args, { input, cwd, env }) {
  return spawnSync(process.execPath, [HOOKS_JS, ...args], { input, cwd, env, encoding: 'utf8', windowsHide: true });
}

perShell('hooks.sh AC2.1: with node on PATH the output is byte-identical to node hooks.js', (sh) => {
  const env = withPathNode();
  const main = gitRepo();
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\n');
  const cases = [
    { name: 'echo hi', args: ['pre-tool-use'], input: bashPayload('echo hi', os.tmpdir()), cwd: os.tmpdir(), nonEmpty: false },
    { name: 'git commit', args: ['pre-tool-use'], input: bashPayload('git commit -m x', main), cwd: main, nonEmpty: true },
    { name: 'close-run bad flag', args: ['close-run', '--no-such-flag'], input: '', cwd: os.tmpdir(), nonEmpty: false, status: 1 },
  ];
  for (const c of cases) {
    const viaSh = runLauncher(sh, c.args, { input: c.input, cwd: c.cwd, env });
    const viaNode = nodeRun(c.args, { input: c.input, cwd: c.cwd, env });
    assert.equal(viaSh.stdout, viaNode.stdout, `${c.name}: stdout`);
    assert.equal(viaSh.stderr, viaNode.stderr, `${c.name}: stderr`);
    assert.equal(viaSh.status, viaNode.status, `${c.name}: status`);
    if (c.status !== undefined) assert.equal(viaSh.status, c.status, `${c.name}: exit status`);
    if (c.nonEmpty) assert.notEqual(viaSh.stdout, '', `${c.name}: expected a deny JSON`);
  }
});

perShell('hooks.sh AC3.1: a saved node-path is used when PATH has no node', (sh) => {
  const home = path.join(tmp('hl-home-'), 'home with space');
  fs.mkdirSync(path.join(home, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude-tweaks', 'node-path'), process.execPath + '\n');
  const r = runLauncher(sh, ['session-start'], { input: '{"session_id":"s","source":"startup"}', env: noNodeEnv(home) });
  assert.equal(r.status, 0, r.stderr);
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes(INTERACTION_STYLE_DIRECTIVE));
  assert.ok(!ctx.includes('restart Claude Code'));
});

// The well-known-list rung (hooks.sh's candidate loop) must exec the node it
// finds on hooks.js with the event and stdin, as the PATH and saved-path rungs
// do: a real node through the seam, compared byte for byte with node hooks.js.
perShell('hooks.sh: a well-known-list hit runs hooks.js with the event and stdin', (sh) => {
  const main = gitRepo();
  writePolicy(main, 'worktree-always: true\n');
  const env = {
    ...noNodeEnv(tmp('hl-list-home-'), {
      CLAUDE_TWEAKS_NODE_CANDIDATES: process.execPath,
      PATH: pathWithOnly(['sh', 'cat', 'awk', 'git'], { exclude: ['node'] }),
    }),
    PIPELINE_RUN_DIR: '',
    CT_HOOKS_TEST_MODE: '1',
  };
  const input = bashPayload('git commit -m x', main);
  const viaSh = runLauncher(sh, ['pre-tool-use'], { input, cwd: main, env });
  const viaNode = nodeRun(['pre-tool-use'], { input, cwd: main, env });
  assert.equal(viaSh.stdout, viaNode.stdout, 'stdout');
  assert.equal(viaSh.stderr, viaNode.stderr, 'stderr');
  assert.equal(viaSh.status, viaNode.status, 'status');
  assert.notEqual(viaSh.stdout, '', 'expected hooks.js to answer the payload');
  const start = runLauncher(sh, ['session-start'], { input: '{"session_id":"s","source":"startup"}', env });
  assert.equal(start.status, 0, start.stderr);
  assert.ok(JSON.parse(start.stdout).hookSpecificOutput.additionalContext.includes(INTERACTION_STYLE_DIRECTIVE));
});

perShell('hooks.sh: the saved node path is tried before the well-known list', (sh) => {
  const base = tmp('hl-rungs-');
  const home = path.join(base, 'home');
  fs.mkdirSync(path.join(home, '.claude-tweaks'), { recursive: true });
  const saved = fakeNode(path.join(base, 'saved'), 'saved');
  fs.writeFileSync(path.join(home, '.claude-tweaks', 'node-path'), saved + '\n');
  const listed = fakeNode(path.join(base, 'listed'), 'listed');
  const r = runLauncher(sh, ['post-tool-use'], { env: noNodeEnv(home, { CLAUDE_TWEAKS_NODE_CANDIDATES: listed }) });
  assert.equal(r.stdout, 'saved\n');
});

perShell('hooks.sh: a saved path naming a missing file falls through', (sh) => {
  const base = tmp('hl-saved-');
  const home = path.join(base, 'home');
  fs.mkdirSync(path.join(home, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude-tweaks', 'node-path'), path.join(base, 'gone', 'node') + '\n');
  const hit = fakeNode(path.join(base, 'bin'), 'list-hit');
  const r = runLauncher(sh, ['post-tool-use'], { env: noNodeEnv(home, { CLAUDE_TWEAKS_NODE_CANDIDATES: hit }) });
  assert.equal(r.stdout, 'list-hit\n');
});

perShell('hooks.sh: a missing node-path file writes nothing to stderr', (sh) => {
  const base = tmp('hl-nofile-');
  const home = path.join(base, 'home');
  fs.mkdirSync(home, { recursive: true });
  const hit = fakeNode(path.join(base, 'bin'), 'list-hit');
  const r = runLauncher(sh, ['post-tool-use'], { env: noNodeEnv(home, { CLAUDE_TWEAKS_NODE_CANDIDATES: hit }) });
  assert.equal(r.stdout, 'list-hit\n');
  assert.equal(r.stderr, '');
});

perShell('hooks.sh: a missing nvm alias file writes nothing to stderr', (sh) => {
  const home = tmp('hl-noalias-');
  fakeNode(path.join(home, '.volta', 'bin'), 'volta');
  const env = noNodeEnv(home);
  delete env.CLAUDE_TWEAKS_NODE_CANDIDATES;
  const r = runLauncher(sh, ['post-tool-use'], { env });
  assert.equal(r.stdout, 'volta\n');
  assert.equal(r.stderr, '');
});

perShell('hooks.sh: the candidate seam is tried in order, first executable wins', (sh) => {
  const base = tmp('hl-order-');
  const first = fakeNode(path.join(base, 'a'), 'first');
  const second = fakeNode(path.join(base, 'b'), 'second');
  const seam = [path.join(base, 'missing'), first, second].join('\n');
  const r = runLauncher(sh, ['post-tool-use'], { env: noNodeEnv(base, { CLAUDE_TWEAKS_NODE_CANDIDATES: seam }) });
  assert.equal(r.stdout, 'first\n');
});

perShell('hooks.sh: nvm default alias naming a literal version dir wins over volta', (sh) => {
  const home = tmp('hl-nvm-');
  fakeNode(path.join(home, '.nvm', 'versions', 'node', 'v99.0.0', 'bin'), 'nvm');
  fakeNode(path.join(home, '.volta', 'bin'), 'volta');
  const env = noNodeEnv(home);
  delete env.CLAUDE_TWEAKS_NODE_CANDIDATES;
  fs.mkdirSync(path.join(home, '.nvm', 'alias'), { recursive: true });
  const alias = path.join(home, '.nvm', 'alias', 'default');
  for (const [value, want] of [['v99.0.0', 'nvm\n'], ['99.0.0', 'nvm\n'], ['lts/*', 'volta\n'], ['22', 'volta\n']]) {
    fs.writeFileSync(alias, value + '\n');
    assert.equal(runLauncher(sh, ['post-tool-use'], { env }).stdout, want, `alias ${value}`);
  }
  // NVM_DIR replaces ~/.nvm: both name v99.0.0, so only the directory differs.
  fs.writeFileSync(alias, 'v99.0.0\n');
  const nvmDir = path.join(tmp('hl-nvmdir-'), 'nvm');
  fakeNode(path.join(nvmDir, 'versions', 'node', 'v99.0.0', 'bin'), 'nvm-dir');
  fs.mkdirSync(path.join(nvmDir, 'alias'), { recursive: true });
  fs.writeFileSync(path.join(nvmDir, 'alias', 'default'), 'v99.0.0\n');
  assert.equal(runLauncher(sh, ['post-tool-use'], { env: { ...env, NVM_DIR: nvmDir } }).stdout, 'nvm-dir\n', 'NVM_DIR');
});

// The fixed /opt/homebrew and /usr/local rungs ahead of fnm are machine state
// (ubuntu CI has /usr/local/bin/node), so the fnm tests run a launcher copy
// with exactly those two lines removed: the fnm rung runs on every host. The
// fake nodes ignore the copy's missing hooks.js.
const FIXED_RUNGS = "  printf '%s\\n' /opt/homebrew/bin/node\n  printf '%s\\n' /usr/local/bin/node\n";
let noFixedRungs = null;
function launcherWithoutFixedRungs() {
  if (!noFixedRungs) noFixedRungs = launcherCopy(FIXED_RUNGS, '');
  return noFixedRungs;
}

perShell('hooks.sh: fnm default alias is tried last', (sh) => {
  const base = tmp('hl-fnm-');
  const home = path.join(base, 'home');
  fs.mkdirSync(home, { recursive: true });
  const fnmDir = path.join(base, 'fnm');
  fakeNode(path.join(fnmDir, 'aliases', 'default', 'bin'), 'fnm');
  const env = noNodeEnv(home, { FNM_DIR: fnmDir });
  delete env.CLAUDE_TWEAKS_NODE_CANDIDATES;
  assert.equal(runLauncher(sh, ['post-tool-use'], { env, launcher: launcherWithoutFixedRungs() }).stdout, 'fnm\n');
});

perShell('hooks.sh: with FNM_DIR unset, the three fnm default homes are tried in order', (sh) => {
  const home = tmp('hl-fnmhome-');
  const homes = [
    [path.join(home, '.local', 'share', 'fnm'), 'fnm-local-share'],
    [path.join(home, 'Library', 'Application Support', 'fnm'), 'fnm-library'],
    [path.join(home, '.fnm'), 'fnm-dotfnm'],
  ];
  for (const [dir, marker] of homes) fakeNode(path.join(dir, 'aliases', 'default', 'bin'), marker);
  const env = noNodeEnv(home);
  delete env.CLAUDE_TWEAKS_NODE_CANDIDATES;
  assert.equal(env.FNM_DIR, undefined, 'precondition: FNM_DIR is unset');
  const launcher = launcherWithoutFixedRungs();
  for (const [dir, marker] of homes) {
    assert.equal(runLauncher(sh, ['post-tool-use'], { env, launcher }).stdout, marker + '\n', marker);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(runLauncher(sh, ['post-tool-use'], { env, launcher }).stdout, '', 'no fnm home left');
});

perShell('hooks.sh AC8.1 (drain): the no-node branch reads stdin to EOF', (sh) => {
  const home = tmp('hl-drain-');
  const r = runLauncher(sh, ['post-tool-use'], { input: 'x'.repeat(2 * 1024 * 1024), env: noNodeEnv(home) });
  assert.equal(r.error, undefined);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('hooks.sh AC11.1: hooks.sh is checked out LF', () => {
  const r = spawnSync('git', ['-C', ROOT, 'check-attr', 'eol', '--', 'plugin/bin/hooks.sh'], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.stdout.trim(), 'plugin/bin/hooks.sh: eol: lf');
  const buf = fs.readFileSync(path.join(ROOT, 'plugin', 'bin', 'hooks.sh'));
  assert.ok(!buf.includes(13), 'hooks.sh holds a CR byte');
  assert.ok(readText(path.join(ROOT, 'plugin', 'bin', 'hooks.sh')).startsWith('#!/bin/sh\n'));
});

// #5392 Task 2: the no-node branch warns on session-start and
// user-prompt-submit, and under a policy-on main checkout denies the four
// write tools on pre-tool-use. Its policy check is pinned to
// resolveWorktreeAlways and its root walk to mainCheckoutRoot.
const AVAILABLE_SHELLS = SHELLS.filter((s) => s.file);
const WRITE_TOOLS = ['Bash', 'Edit', 'Write', 'NotebookEdit'];
const SILENT_TOOLS = ['AskUserQuestion', 'Agent', 'Task', 'ExitWorktree'];

function writePolicy(root, content) {
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), content);
}

function policyDir(content) {
  const dir = tmp('hl-policy-');
  if (content !== null) writePolicy(dir, content);
  return dir;
}

function toolPayload(tool_name, tool_input = {}, cwd) {
  return JSON.stringify({ tool_name, tool_input, cwd });
}

let sharedEnv = null;
function sharedNoNodeEnv() {
  if (!sharedEnv) sharedEnv = noNodeEnv(tmp('hl-vhome-'));
  return sharedEnv;
}

function verdictOf(shell, cwd, launcher = LAUNCHER_ARG, env = sharedNoNodeEnv()) {
  const r = runLauncher(shell, ['pre-tool-use'], { input: toolPayload('Bash', { command: 'echo hi' }, cwd), cwd, env, launcher });
  if (r.error || r.status !== 0) throw new Error(`verdictOf: status=${r.status} error=${r.error && r.error.message} stderr=${r.stderr}`);
  if (r.stdout === '') return 'off';
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    throw new Error(`verdictOf: stdout is not JSON: ${JSON.stringify(r.stdout)}`);
  }
  if (out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision === 'deny') return 'on';
  throw new Error(`verdictOf: stdout is not a deny: ${JSON.stringify(r.stdout)}`);
}

function assertPolicyParity(fixtures, launcher = LAUNCHER_ARG, shells = AVAILABLE_SHELLS, env = undefined) {
  for (const [id, content, expected] of fixtures) {
    const dir = policyDir(content);
    // A tmpdir inside a git checkout would read that checkout's policy instead.
    assert.equal(mainCheckoutRoot(dir), null, `${id}: precondition: the fixture dir sits outside any repository`);
    const o = resolveWorktreeAlways(dir).on ? 'on' : 'off';
    if (o !== expected) throw new Error(`oracle drift: ${id}`);
    for (const sh of shells) {
      const v = verdictOf(sh, dir, launcher, env);
      if (v !== o) throw new Error(`policy parity: ${id} [${sh.name}] shell=${v} resolveWorktreeAlways=${o}`);
    }
  }
}

let onFixture = null;
function policyOnMain() {
  if (!onFixture) {
    const main = gitRepo();
    writePolicy(main, 'worktree-always: true\n');
    onFixture = { main, wt: linkedWorktreeOf(main) };
  }
  return onFixture;
}

function launcherCopy(from, to) {
  const text = readText(LAUNCHER_ARG);
  assert.equal(text.split(from).length - 1, 1, `the launcher holds ${JSON.stringify(from)} exactly once`);
  const copy = text.replace(from, to);
  assert.notEqual(copy, text);
  const file = path.join(tmp('hl-gored-'), 'hooks.sh');
  fs.writeFileSync(file, copy);
  return file;
}

perShell('hooks.sh AC4.1: no node: session-start and user-prompt-submit print one warning object', (sh) => {
  const env = noNodeEnv(tmp('hl-home-'));
  const contexts = [];
  for (const [event, name] of [['session-start', 'SessionStart'], ['user-prompt-submit', 'UserPromptSubmit']]) {
    const r = runLauncher(sh, [event], { input: 'not json', env });
    assert.equal(r.status, 0, `${event}: ${r.stderr}`);
    assert.equal(r.stdout.trim().split('\n').length, 1, `${event}: one line`);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
    assert.equal(out.hookSpecificOutput.hookEventName, name);
    const ctx = out.hookSpecificOutput.additionalContext;
    for (const phrase of ['restart Claude Code', 'no `node` was found', 'Every claude-tweaks guard is off', 'stop making repository edits']) {
      assert.ok(ctx.includes(phrase), `${event}: additionalContext lacks ${JSON.stringify(phrase)}`);
    }
    // The launcher's own deny still fires in a worktree-always project.
    assert.ok(ctx.includes('in a worktree-always project the launcher instead denies Bash, Edit, Write and NotebookEdit'), `${event}: names the launcher deny`);
    assert.ok(!ctx.includes('the worktree-always deny'), `${event}: does not list the worktree-always deny as off`);
    contexts.push(ctx);
  }
  // hooks.sh spells the warning out once per event: the two copies must not drift.
  assert.equal(contexts[1], contexts[0], 'session-start and user-prompt-submit carry the same warning');
});

perShell('hooks.sh AC5.1: no node + worktree-always: pre-tool-use denies Bash, Edit, Write, NotebookEdit from main and from a linked worktree', (sh) => {
  const { main, wt } = policyOnMain();
  assert.ok(!fs.existsSync(path.join(wt, '.claude-tweaks', 'policy.yml')), 'precondition: the worktree has no policy.yml of its own');
  const env = noNodeEnv(tmp('hl-home-'));
  for (const cwd of [main, wt]) {
    for (const name of WRITE_TOOLS) {
      const label = `${name} from ${cwd === main ? 'main' : 'worktree'}`;
      const r = runLauncher(sh, ['pre-tool-use'], { input: toolPayload(name, {}, cwd), cwd, env });
      assert.equal(r.status, 0, `${label}: ${r.stderr}`);
      const out = JSON.parse(r.stdout).hookSpecificOutput;
      assert.equal(out.permissionDecision, 'deny', label);
      assert.equal(out.hookEventName, 'PreToolUse', label);
      assert.ok(out.permissionDecisionReason.includes('restart Claude Code'), label);
    }
  }
});

perShell('hooks.sh AC6.1: no node + worktree-always: pre-tool-use is silent for AskUserQuestion, Agent, Task, ExitWorktree', (sh) => {
  const { main, wt } = policyOnMain();
  const env = noNodeEnv(tmp('hl-home-'));
  for (const cwd of [main, wt]) {
    for (const name of SILENT_TOOLS) {
      const r = runLauncher(sh, ['pre-tool-use'], { input: toolPayload(name, {}, cwd), cwd, env });
      assert.equal(r.status, 0, `${name}: ${r.stderr}`);
      assert.equal(r.stdout, '', name);
    }
  }
});

function assertToolNameMatching(sh, env) {
  const { main } = policyOnMain();
  const rows = [
    ['pretty', JSON.stringify({ tool_name: 'Bash', tool_input: {} }, null, 2), 'deny'],
    ['nested-string', toolPayload('AskUserQuestion', { q: '{"tool_name":"Bash"}' }, main), 'silent'],
    ['lowercase', toolPayload('bash', {}, main), 'silent'],
    ['prefix', toolPayload('BashX', {}, main), 'silent'],
    ['not-json', 'not json', 'silent'],
    ['empty', '', 'silent'],
    ['big', toolPayload('Write', { content: 'x'.repeat(2 * 1024 * 1024) }, main), 'deny'],
  ];
  for (const [id, input, expected] of rows) {
    const r = runLauncher(sh, ['pre-tool-use'], { input, cwd: main, env });
    assert.equal(r.error, undefined, `${id}: spawn error`);
    assert.equal(r.status, 0, `${id}: ${r.stderr}`);
    if (expected === 'deny') assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny', id);
    else assert.equal(r.stdout, '', id);
  }
}

perShell('hooks.sh: tool_name matching', (sh) => assertToolNameMatching(sh, noNodeEnv(tmp('hl-home-'))));

perShell('hooks.sh AC7.1: no node: pre-tool-use is silent when the policy is absent or false', (sh) => {
  const absent = gitRepo();
  const off = gitRepo();
  writePolicy(off, 'worktree-always: false\n');
  const env = noNodeEnv(tmp('hl-home-'));
  for (const cwd of [absent, off]) {
    const r = runLauncher(sh, ['pre-tool-use'], { input: toolPayload('Bash', { command: 'echo hi' }, cwd), cwd, env });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '', cwd === absent ? 'policy absent' : 'policy false');
  }
});

// Q2 ruling: the policy root comes from the process cwd, never the payload's
// `cwd`. Each row points the two at checkouts with opposite policies.
perShell('hooks.sh: no node: the policy is read from the process cwd, not the payload cwd', (sh) => {
  const { main } = policyOnMain();
  const off = policyDir(null);
  assert.equal(mainCheckoutRoot(off), null, 'precondition: the policy-off dir sits outside any repository');
  const env = sharedNoNodeEnv();
  for (const [id, cwd, payloadCwd, want] of [['process on, payload off', main, off, 'deny'], ['process off, payload on', off, main, 'silent']]) {
    const r = runLauncher(sh, ['pre-tool-use'], { input: toolPayload('Bash', { command: 'echo hi' }, payloadCwd), cwd, env });
    assert.equal(r.status, 0, `${id}: ${r.stderr}`);
    if (want === 'deny') assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny', id);
    else assert.equal(r.stdout, '', id);
  }
});

perShell('hooks.sh AC8.1: no node: the five other events are silent', (sh) => {
  const { main } = policyOnMain();
  const env = noNodeEnv(tmp('hl-home-'));
  for (const event of ['session-end', 'pre-compact', 'post-tool-use', 'post-tool-use-failure', 'subagent-stop']) {
    const r = runLauncher(sh, [event], { input: toolPayload('Bash', {}, main), cwd: main, env });
    assert.equal(r.status, 0, `${event}: ${r.stderr}`);
    assert.equal(r.stdout, '', event);
  }
});

const AC9_FIXTURES = [
  ['AC9.1', 'worktree-always: true\n', 'on'],
  ['AC9.2', 'worktree-always: true  # comment\n', 'on'],
  ['AC9.3', 'worktree-always: false\n', 'off'],
  ['AC9.4', 'worktree-always: true garbage\n', 'off'],
  ['AC9.5', 'worktree-always: "true"\n', 'off'],
  ['AC9.6', '  worktree-always: true\n', 'off'],
  ['AC9.7', '# policy\r\nworktree-always: true\r\n', 'on'],
  ['AC9.8', 'worktree-always: true\nworktree-always: false\n', 'off'],
  ['AC9.9', 'worktree.always: true\n', 'on'],
  ['AC9.10', 'worktree.always: true\nworktree-always: false\n', 'off'],
  ['AC9.11', '', 'off'],
  ['AC9.12', null, 'off'],
];

perShell('hooks.sh AC9: the shell policy check agrees with resolveWorktreeAlways', (sh) => {
  assertPolicyParity(AC9_FIXTURES, LAUNCHER_ARG, [sh]);
});

// win32: the mutant leaves AC9.7 green there on every shell (measured in
// windows-regression run 43647466952), so the CR never reaches the awk program
// and the \r member cannot be discriminated. AC9.7's parity row itself still
// runs and passes on win32.
const WIN32_CR_GO_RED_SKIP = 'win32: dropping \\r leaves AC9.7 green (measured in windows-regression run 43647466952): the CR never reaches the awk program there; AC9.7 parity itself passes on win32';

perShell('hooks.sh AC9 go-red: deleting \\r from the whitespace class flips AC9.7', (sh) => {
  const copy = launcherCopy('ws = "([ \\t\\r\\f\\v]|', 'ws = "([ \\t\\f\\v]|');
  assert.throws(() => assertPolicyParity(AC9_FIXTURES, copy, [sh]), /policy parity: AC9\.7 /);
}, { skip: process.platform === 'win32' && WIN32_CR_GO_RED_SKIP });

const EDGE_FIXTURES = [
  ['E1', 'worktree-always: true\nworktree-always:\n', 'on'],
  ['E2', 'worktree-always:\ttrue\n', 'on'],
  ['E3', 'worktree-always:true\n', 'on'],
  ['E4', 'worktree-always:\nworktree.always: true\n', 'on'],
  ['E5', 'worktree-always-x: true\n', 'off'],
  ['E6', 'worktree-always: true#x\n', 'on'],
];

perShell('hooks.sh: policy edge cases agree with resolveWorktreeAlways', (sh) => {
  assertPolicyParity(EDGE_FIXTURES, LAUNCHER_ARG, [sh]);
});

const UNICODE_FIXTURES = [
  ['U1', 'worktree-always:\u00a0true\n', 'on'],
  ['U2', 'worktree-always: true\u00a0\n', 'on'],
  ['U3', '\u00a0worktree-always: true\n', 'off'],
  ['U4', '\ufeffworktree-always: true\n', 'off'],
  ['U5', 'worktree-always: true\u3000\n', 'on'],
  ['U6', 'worktree-always:\u2003true\n', 'on'],
  ['U7', 'worktree-always: true\u2028\n', 'on'],
  ['U8', 'worktree-always: true\u202f# c\n', 'on'],
  ['U9', 'worktree-always: true\u205f\n', 'on'],
  ['U10', 'worktree-always: true\u1680\n', 'on'],
  ['U11', 'worktree-always: true\u200a\n', 'on'],
  ['U12', 'worktree-always: true\u200b\n', 'off'],
  ['U13', 'worktree-always: tru\u00e9\n', 'off'],
  ['U14', 'worktree-always: true\u0085\n', 'off'],
];

perShell('hooks.sh: Unicode whitespace in policy.yml agrees with resolveWorktreeAlways', (sh) => {
  assertPolicyParity(UNICODE_FIXTURES, LAUNCHER_ARG, [sh]);
});

// The fixtures must stay escapes: a raw invisible character normalized to an
// ASCII space by an editor turns a Unicode row into a passing ASCII duplicate.
function nonAsciiFixtureLines(text) {
  const start = text.indexOf('const UNICODE_FIXTURES = [');
  const end = text.indexOf('];', start);
  if (start === -1 || end === -1) throw new Error('UNICODE_FIXTURES block not found');
  const lines = text.slice(start, end).split('\n');
  if (lines.length !== UNICODE_FIXTURES.length + 2) throw new Error(`UNICODE_FIXTURES block has ${lines.length} lines`);
  return lines.filter((line) => [...line].some((c) => c.codePointAt(0) > 0x7e));
}

test('hooks.sh: the UNICODE_FIXTURES source lines are pure ASCII', () => {
  assert.deepEqual(nonAsciiFixtureLines(readText(__filename)), []);
});

perShell('hooks.sh go-red: dropping NBSP from the whitespace class flips U1', (sh) => {
  const copy = launcherCopy('\\302\\240|', '');
  assert.throws(() => assertPolicyParity(UNICODE_FIXTURES, copy, [sh]), /policy parity: U1 /);
});

// The no-node policy and tool_name decisions run on whichever awk PATH
// resolves: BWK awk on macOS, mawk on Debian and Ubuntu, gawk on Fedora and
// Arch, and gawk shipped as `awk` in Git Bash. Each variant found on PATH gets
// a temp dir holding only an `awk` link to it, first on noNodeEnv's PATH, and
// runs under the default shell; a variant missing from PATH skips by name.
const AWKS = ['awk', 'mawk', 'gawk'].map((name) => ({ name, file: findOnPath(name) }));
const awkEnvs = new Map();
function awkEnv(awk) {
  if (awkEnvs.has(awk.name)) return awkEnvs.get(awk.name);
  const dir = tmp(`hl-awk-${awk.name}-`);
  const link = path.join(dir, path.extname(awk.file) === '.exe' ? 'awk.exe' : 'awk');
  try {
    fs.symlinkSync(awk.file, link);
  } catch (err) {
    if (err.code !== 'EPERM') throw err;
    fs.copyFileSync(awk.file, link); // win32 without the symlink privilege
  }
  const env = noNodeEnv(tmp('hl-awk-home-'), {}, { awkDir: dir });
  const probe = spawnSync(SHELLS[0].file, ['-c', 'command -v awk'], { env, encoding: 'utf8', windowsHide: true });
  assert.equal(probe.status, 0, `awkEnv(${awk.name}): command -v awk failed: ${probe.stderr}`);
  // MSYS prints a POSIX spelling of the Windows path, so only POSIX compares it.
  if (process.platform !== 'win32') assert.equal(probe.stdout.trim(), link, `awkEnv(${awk.name}): the linked awk is first on PATH`);
  awkEnvs.set(awk.name, env);
  return env;
}

function perAwk(title, fn) {
  for (const awk of AWKS) {
    test(`${title} [sh, awk=${awk.name}]`, { skip: !awk.file && `${awk.name} not on PATH` }, () => fn(SHELLS[0], awkEnv(awk)));
  }
}

perAwk('hooks.sh AC9: the shell policy check agrees with resolveWorktreeAlways', (sh, env) => {
  assertPolicyParity(AC9_FIXTURES, LAUNCHER_ARG, [sh], env);
});

perAwk('hooks.sh: policy edge cases agree with resolveWorktreeAlways', (sh, env) => {
  assertPolicyParity(EDGE_FIXTURES, LAUNCHER_ARG, [sh], env);
});

perAwk('hooks.sh: Unicode whitespace in policy.yml agrees with resolveWorktreeAlways', (sh, env) => {
  assertPolicyParity(UNICODE_FIXTURES, LAUNCHER_ARG, [sh], env);
});

perAwk('hooks.sh: tool_name matching', assertToolNameMatching);

function rootVerdict(dir) {
  return resolveWorktreeAlways(mainCheckoutRoot(dir) || dir).on ? 'on' : 'off';
}

function gitdirOf(wt) {
  return /^gitdir:\s*(.+?)\s*$/m.exec(readText(path.join(wt, '.git')))[1];
}

function rewriteInPlace(file, text) {
  const fd = fs.openSync(file, 'r+');
  try {
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, text, 0);
  } finally {
    fs.closeSync(fd);
  }
}

let rootFixtures = null;
function rootParityFixtures() {
  if (rootFixtures) return rootFixtures;
  const main = gitRepo();
  writePolicy(main, 'worktree-always: true\n');
  const mainSub = path.join(main, 'a', 'b');
  fs.mkdirSync(mainSub, { recursive: true });
  const wt = linkedWorktreeOf(main);
  const wtSub = path.join(wt, 'x', 'y');
  fs.mkdirSync(wtSub, { recursive: true });
  const harness = harnessWorktreeOf(main);
  const plain = policyDir('worktree-always: true\n');
  assert.equal(mainCheckoutRoot(plain), null, 'precondition: R6 sits outside any repository');
  const plainSub = path.join(plain, 'sub');
  fs.mkdirSync(plainSub);
  const offMain = gitRepo();
  writePolicy(offMain, 'worktree-always: false\n');
  const offWt = linkedWorktreeOf(offMain);
  writePolicy(offWt, 'worktree-always: true\n');
  const rel = linkedWorktreeOf(main);
  rewriteInPlace(path.join(rel, '.git'), `gitdir: ${path.relative(rel, gitdirOf(rel)).split(path.sep).join('/')}\n`);
  const crlf = linkedWorktreeOf(main);
  rewriteInPlace(path.join(crlf, '.git'), `gitdir: ${gitdirOf(crlf)}\r\n`);
  const second = linkedWorktreeOf(main);
  rewriteInPlace(path.join(second, '.git'), `# note\ngitdir: ${gitdirOf(second)}\n`);
  const link = path.join(tmp('hl-link-'), 'link');
  fs.symlinkSync(wtSub, link, 'junction');
  rootFixtures = {
    main,
    rows: [
      ['R1', main, 'on'],
      ['R2', mainSub, 'on'],
      ['R3', wt, 'on'],
      ['R4', wtSub, 'on'],
      ['R5', harness, 'on'],
      ['R6', plain, 'on'],
      ['R7', plainSub, 'off'],
      ['R8', offWt, 'off'],
      ['R9', rel, 'on'],
      ['R10', crlf, 'on'],
      ['R11', second, 'on'],
      ['R13', link, 'on', fs.realpathSync(link)],
    ],
  };
  return rootFixtures;
}

perShell('hooks.sh: the policy is read from mainCheckoutRoot(cwd) || cwd', (sh) => {
  for (const [id, cwd, expected, oracleDir = cwd] of rootParityFixtures().rows) {
    const oracle = rootVerdict(oracleDir);
    assert.equal(oracle, expected, `${id}: oracle`);
    assert.equal(verdictOf(sh, cwd), oracle, `${id}: shell`);
  }
});

// R12b is a harness worktree inside the policy-on main: only there does a
// walk that steps past the unreadable .git reach a repo (main), so only R12b
// tells "unresolved" from "keep walking".
perShell('hooks.sh: an unreadable worktree .git falls back to the worktree (R12)', (sh) => {
  const { main } = rootParityFixtures();
  for (const [id, wt] of [['R12', linkedWorktreeOf(main)], ['R12b', harnessWorktreeOf(main)]]) {
    const gitFile = path.join(wt, '.git');
    fs.chmodSync(gitFile, 0o000);
    try {
      const oracle = rootVerdict(wt);
      assert.equal(oracle, 'off', `${id}: oracle`);
      assert.equal(verdictOf(sh, wt), oracle, `${id}: shell`);
    } finally {
      fs.chmodSync(gitFile, 0o644);
    }
  }
}, chmodDenialSkip('root reads a mode-000 file'));

// main_root stops at a directory it cannot search: walking past A would reach
// the policy-on main above it and deny. Two rows: the cwd B under A, and the
// cwd A itself. The cd and chmod run inside sh -c, since spawnSync's own chdir
// into B fails once A is unsearchable. The walk is reached only where a fresh
// shell's `pwd -P` still answers under the unsearchable A: Linux (getcwd is a
// syscall) answers for both rows; macOS getcwd fails for both, so there the
// test still checks the verdict and then skips by name.
perShell('hooks.sh: an unsearchable directory above the cwd falls back to the cwd', (sh, t) => {
  const main = gitRepo();
  writePolicy(main, 'worktree-always: true\n');
  const a = path.join(main, 'locked');
  const b = path.join(a, 'b');
  fs.mkdirSync(b, { recursive: true });
  const env = noNodeEnv(tmp('hl-home-'), { PATH: pathWithOnly(['sh', 'cat', 'awk', 'chmod'], { exclude: ['node'] }) });
  const pwdAnswers = (cwd) => {
    try {
      // A fresh process, as the launcher is: a shell that did the cd itself can
      // answer pwd -P from its own record of the path where getcwd fails.
      const p = spawnSync(sh.file, ['-c', 'cd "$1" || exit 9; chmod 0600 "$2"; exec "$3" -c "pwd -P"', 'hooks-sh-test', cwd, a, sh.file], {
        cwd: os.tmpdir(), env, encoding: 'utf8', windowsHide: true,
      });
      return p.status === 0 && p.stdout.trim() !== '';
    } finally {
      fs.chmodSync(a, 0o755);
    }
  };
  let reached = 0;
  for (const [id, cwd] of [['cwd under A', b], ['cwd is A', a]]) {
    if (pwdAnswers(cwd)) reached += 1;
    let r;
    let oracle;
    try {
      r = spawnSync(sh.file, ['-c', 'cd "$1" || exit 9; chmod 0600 "$2"; exec "$3" "$4" pre-tool-use', 'hooks-sh-test', cwd, a, sh.file, LAUNCHER_ARG], {
        input: toolPayload('Bash', { command: 'echo hi' }, cwd), cwd: os.tmpdir(), env, encoding: 'utf8', windowsHide: true,
      });
      assert.equal(mainCheckoutRoot(cwd), null, `${id}: oracle: mainCheckoutRoot is unresolved while A is unsearchable`);
      oracle = resolveWorktreeAlways(cwd).on ? 'on' : 'off';
    } finally {
      fs.chmodSync(a, 0o755);
    }
    assert.equal(r.status, 0, `${id}: status=${r.status} stderr=${r.stderr}`);
    assert.equal(oracle, 'off', `${id}: oracle: the cwd fallback has no policy`);
    assert.equal(r.stdout, '', `${id}: shell: off (silent)`);
  }
  if (reached === 0) t.skip(`${sh.name}: pwd -P fails under an unsearchable directory here (macOS getcwd), so the root walk is never reached`);
}, chmodDenialSkip('root searches a mode-0600 directory'));

const HOOKS_JSON_ROWS = [
  ['SessionStart', null, 'session-start'],
  ['UserPromptSubmit', null, 'user-prompt-submit'],
  ['SessionEnd', null, 'session-end'],
  ['PreCompact', null, 'pre-compact'],
  ...['Bash', 'Edit', 'Write', 'NotebookEdit', 'ExitWorktree', 'AskUserQuestion', 'Agent', 'Task']
    .map((m) => ['PreToolUse', m, 'pre-tool-use']),
  ...['Bash', 'Write', 'Skill', 'AskUserQuestion', 'EnterWorktree', 'ExitWorktree']
    .map((m) => ['PostToolUse', m, 'post-tool-use']),
  ['PostToolUseFailure', 'Bash', 'post-tool-use-failure'],
  ['SubagentStop', null, 'subagent-stop'],
].map(([event, matcher, verb]) => [event, matcher, `sh "\${CLAUDE_PLUGIN_ROOT}/bin/hooks.sh" ${verb}`, ['command', 'type']]);

test('hooks.sh AC1.1: every hooks.json registration is the launcher form with its old event verb', () => {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const rows = [];
  for (const [event, groups] of Object.entries(json.hooks)) {
    for (const group of groups) {
      assert.equal(group.hooks.length, 1, `${event}/${group.matcher}: one hook per group`);
      const [hook] = group.hooks;
      rows.push([event, group.matcher === undefined ? null : group.matcher, hook.command, Object.keys(hook).sort()]);
    }
  }
  assert.deepEqual(rows, HOOKS_JSON_ROWS);
});

// AC10.1: session-start saves process.execPath where the launcher's second
// rung reads it. All runs use a fresh non-repo cwd and a fixture home.
const SESSION_START_INPUT = '{"session_id":"s","source":"startup"}';

function sessionStartRun(env) {
  return nodeRun(['session-start'], { input: SESSION_START_INPUT, cwd: tmp('hl-ss-cwd-'), env });
}

function nodePathFile(home) {
  return path.join(home, '.claude-tweaks', 'node-path');
}

test('hooks.sh AC10.1: session-start writes process.execPath when node-path is absent', () => {
  const home = tmp('hl-ss-home-');
  const r = sessionStartRun(fixtureHomeEnv(home));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(nodePathFile(home), 'utf8'), process.execPath + '\n');
});

test('hooks.sh AC10.1: session-start rewrites a different stored path', () => {
  const home = tmp('hl-ss-home-');
  fs.mkdirSync(path.join(home, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(nodePathFile(home), '/nonexistent/node\n');
  const r = sessionStartRun(fixtureHomeEnv(home));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(nodePathFile(home), 'utf8'), process.execPath + '\n');
});

test('hooks.sh AC10.1: session-start leaves an up-to-date node-path untouched', () => {
  const home = tmp('hl-ss-home-');
  fs.mkdirSync(path.join(home, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(nodePathFile(home), process.execPath + '\n');
  const old = new Date('2001-01-01T00:00:00Z');
  fs.utimesSync(nodePathFile(home), old, old);
  const before = fs.statSync(nodePathFile(home)).mtimeMs;
  const r = sessionStartRun(fixtureHomeEnv(home));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.statSync(nodePathFile(home)).mtimeMs, before);
  assert.equal(fs.readFileSync(nodePathFile(home), 'utf8'), process.execPath + '\n');
});

test('hooks.sh AC10.1: an unwritable ~/.claude-tweaks (a regular file) keeps stdout and exit 0', () => {
  const a = sessionStartRun(fixtureHomeEnv(tmp('hl-ss-home-')));
  const homeB = tmp('hl-ss-home-');
  fs.writeFileSync(path.join(homeB, '.claude-tweaks'), 'not a directory');
  const b = sessionStartRun(fixtureHomeEnv(homeB));
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.ok(a.stdout.length > 0);
  assert.equal(b.stdout, a.stdout);
});

test('hooks.sh AC10.1: an unwritable ~/.claude-tweaks (a 0o500 directory) keeps stdout and exit 0', chmodDenialSkip('root bypasses directory modes'), () => {
  const a = sessionStartRun(fixtureHomeEnv(tmp('hl-ss-home-')));
  const homeB = tmp('hl-ss-home-');
  const dir = path.join(homeB, '.claude-tweaks');
  fs.mkdirSync(dir);
  fs.chmodSync(dir, 0o500);
  try {
    const b = sessionStartRun(fixtureHomeEnv(homeB));
    assert.equal(a.status, 0, a.stderr);
    assert.equal(b.status, 0, b.stderr);
    assert.ok(a.stdout.length > 0);
    assert.equal(b.stdout, a.stdout);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.chmodSync(dir, 0o700);
  }
});

test('hooks.sh AC10.1: session-start writes under HOME when HOME and USERPROFILE differ', () => {
  const a = tmp('hl-ss-home-');
  const b = tmp('hl-ss-other-');
  const env = { ...fixtureHomeEnv(a), USERPROFILE: b };
  const r = sessionStartRun(env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(nodePathFile(a), 'utf8'), process.execPath + '\n');
  assert.ok(!fs.existsSync(nodePathFile(b)));
});

perShell('hooks.sh AC3.1 round trip: the path session-start saves is the one the launcher reads', (sh) => {
  const home = path.join(tmp('hl-ss-rt-'), 'home with space');
  fs.mkdirSync(home, { recursive: true });
  const saved = sessionStartRun(fixtureHomeEnv(home));
  assert.equal(saved.status, 0, saved.stderr);
  const r = runLauncher(sh, ['session-start'], { input: SESSION_START_INPUT, env: noNodeEnv(home) });
  assert.equal(r.status, 0, r.stderr);
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes(INTERACTION_STYLE_DIRECTIVE));
  assert.ok(!ctx.includes('restart Claude Code'));
});

// #5392 Task 5: docs/hooks.md's Node launcher bullet and its sub-bullets.
const { missingFactsOf, assertEachPatternGoesRed } = require('./helpers/conformance-asserts');

const LAUNCHER_DOC_PATTERNS = [
  [/`sh "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.sh" <event>`/, 'registration form'],
  [/`exec`s it on `hooks\.js <event>` with stdin passed through/, 'exec pass-through'],
  [/`command -v node`; the path saved in `~\/\.claude-tweaks\/node-path`/, 'resolution order'],
  [/`lts\/\*`, `node` or a partial version such as `22` is skipped/, 'nvm literal only'],
  [/replaced by `CLAUDE_TWEAKS_NODE_CANDIDATES`/, 'test seam'],
  [/writes `process\.execPath` to `~\/\.claude-tweaks\/node-path`/, 'saved path'],
  [/reads stdin to EOF, always exits 0, and prints only fixed JSON literals/, 'no-node invariant'],
  [/`session-start` and `user-prompt-submit` print one `hookSpecificOutput\.additionalContext`/, 'warn events'],
  [/`pre-tool-use` prints a `permissionDecision: "deny"`/, 'deny event'],
  [/The deny covers Bash, Edit, Write and NotebookEdit only, matched on the payload's `tool_name`/, 'deny tool scope'],
  [/AskUserQuestion, Agent, Task and ExitWorktree get nothing/, 'silent tools'],
  [/never parses `cwd` out of the stdin JSON/, 'process cwd'],
  [/The accepted risk: after a `cd` into a different repository/, 'accepted cwd risk'],
  [/A hit that cannot run `hooks\.js`/, 'unrunnable hit'],
  [/`session-end`, `pre-compact`, `post-tool-use`, `post-tool-use-failure` and `subagent-stop` print nothing/, 'silent events'],
  [/"`sh -c` on macOS and Linux, Git Bash on Windows, or PowerShell when Git Bash isn't installed"/, 'Windows shells'],
  [/code\.claude\.com\/docs\/en\/hooks\.md, "Exec form and shell form"/, 'Windows source'],
  [/Under the PowerShell fallback there is no `sh`/, 'PowerShell consequence'],
];

function launcherBulletOf(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('- **Node launcher (#5392):**'));
  assert.notEqual(start, -1, 'anchor not found: - **Node launcher (#5392):**');
  let end = lines.findIndex((l, i) => i > start && /^- /.test(l));
  if (end === -1) end = lines.length;
  return lines.slice(start, end).join('\n');
}

const HOOKS_DOC = path.join(ROOT, 'docs', 'hooks.md');
const assertLauncherFacts = (slice) => {
  const missing = missingFactsOf(LAUNCHER_DOC_PATTERNS)(slice);
  assert.deepEqual(missing, [], `missing facts: ${missing.join(', ')}`);
};

test('hooks.sh AC11.1 + AC12.1: docs/hooks.md documents the launcher, the saved path, the no-node behavior per event and Windows', () => {
  const slice = launcherBulletOf(readText(HOOKS_DOC));
  assertLauncherFacts(slice);
  assertEachPatternGoesRed(slice, LAUNCHER_DOC_PATTERNS, missingFactsOf(LAUNCHER_DOC_PATTERNS));
});

test('hooks.sh AC11.1 move-out control: the Windows sentence counts only inside the launcher bullet', () => {
  const text = readText(HOOKS_DOC);
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith('  - **Windows:**'));
  assert.notEqual(at, -1, 'anchor not found: **Windows:** sub-bullet');
  const [windowsLine] = lines.splice(at, 1);
  const moved = lines.join('\n') + '\n' + windowsLine;
  assert.notEqual(moved, text);
  assert.throws(() => assertLauncherFacts(launcherBulletOf(moved)), /Windows shells/);
});
