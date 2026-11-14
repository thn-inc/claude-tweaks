'use strict';
// #5392 Task 1: plugin/bin/hooks.sh finds a node and execs hooks.js. Every
// test runs once per available shell (sh, dash, bash) and starts with
// `hooks.sh ` so the Windows TAP log can be grepped for it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { gitRepo, linkedWorktreeOf, harnessWorktreeOf } = require('./helpers/git-fixtures');
const { fixtureHomeEnv } = require('./helpers/fixture-home');
const { pathWithOnly } = require('./helpers/path-stub');
const { readText } = require('./helpers/read-skill');
const { chmodDenialSkip } = require('./helpers/root');
const { INTERACTION_STYLE_DIRECTIVE } = require('../plugin/bin/lib/hooks/interaction-style');
const { mainCheckoutRoot } = require('../plugin/bin/lib/hooks/worktree-detect');
const { resolveWorktreeAlways } = require('../plugin/bin/lib/policy');

const ROOT = path.resolve(__dirname, '..');
const LAUNCHER_ARG = path.join(ROOT, 'plugin') + '/bin/hooks.sh';
const HOOKS_JS = path.join(ROOT, 'plugin', 'bin', 'hooks.js');

function findOnPath(name) {
  const names = process.platform === 'win32' ? [name, name + '.exe'] : [name];
  for (const dir of (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)) {
    for (const n of names) {
      const f = path.join(dir, n);
      try {
        if (fs.statSync(f).isFile()) return f;
      } catch {
        // not here
      }
    }
  }
  return null;
}

const SHELLS = [
  { name: 'sh', file: findOnPath('sh') },
  { name: 'dash', file: findOnPath('dash') },
  { name: 'bash', file: findOnPath('bash') },
];

const NOT_ON_PATH = (name) => `${name} not on PATH (windows-latest Git Bash ships no dash)`;

// One test per shell; sh is required, dash and bash skip by name when missing.
function perShell(title, fn, extra = {}) {
  for (const sh of SHELLS) {
    const missing = !sh.file;
    if (missing && sh.name === 'sh') throw new Error('sh not found on PATH');
    test(`${title} [${sh.name}]`, { skip: (missing && NOT_ON_PATH(sh.name)) || extra.skip }, () => fn(sh));
  }
}

function bareEnv(home) {
  const env = fixtureHomeEnv(home);
  for (const k of Object.keys(env)) {
    if (/^path$/i.test(k) || k === 'NVM_DIR' || k === 'FNM_DIR' || k === 'CLAUDE_TWEAKS_NODE_CANDIDATES') delete env[k];
  }
  return env;
}

function noNodeEnv(home, extra = {}) {
  const env = {
    ...bareEnv(home),
    PATH: pathWithOnly(['sh', 'cat', 'awk'], { exclude: ['node'] }),
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

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
    { name: 'close-run bad flag', args: ['close-run', '--no-such-flag'], input: '', cwd: os.tmpdir(), nonEmpty: false },
  ];
  for (const c of cases) {
    const viaSh = runLauncher(sh, c.args, { input: c.input, cwd: c.cwd, env });
    const viaNode = nodeRun(c.args, { input: c.input, cwd: c.cwd, env });
    assert.equal(viaSh.stdout, viaNode.stdout, `${c.name}: stdout`);
    assert.equal(viaSh.status, viaNode.status, `${c.name}: status`);
    if (c.nonEmpty) assert.notEqual(viaSh.stdout, '', `${c.name}: expected a deny JSON`);
  }
  const bad = runLauncher(sh, ['close-run', '--no-such-flag'], { env });
  assert.equal(bad.status, 1);
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
});

const FIXED_NODES = ['/opt/homebrew/bin/node', '/usr/local/bin/node'].filter((f) => {
  try {
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
});
perShell('hooks.sh: fnm default alias is tried last', (sh) => {
  const base = tmp('hl-fnm-');
  const home = path.join(base, 'home');
  fs.mkdirSync(home, { recursive: true });
  const fnmDir = path.join(base, 'fnm');
  fakeNode(path.join(fnmDir, 'aliases', 'default', 'bin'), 'fnm');
  const env = noNodeEnv(home, { FNM_DIR: fnmDir });
  delete env.CLAUDE_TWEAKS_NODE_CANDIDATES;
  assert.equal(runLauncher(sh, ['post-tool-use'], { env }).stdout, 'fnm\n');
}, { skip: FIXED_NODES.length > 0 && `${FIXED_NODES.join(', ')} exists: the fixed rungs ahead of fnm are machine state` });

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

function verdictOf(shell, cwd, launcher = LAUNCHER_ARG) {
  const r = runLauncher(shell, ['pre-tool-use'], { input: toolPayload('Bash', { command: 'echo hi' }, cwd), cwd, env: sharedNoNodeEnv(), launcher });
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

function assertPolicyParity(fixtures, launcher = LAUNCHER_ARG) {
  for (const [id, content, expected] of fixtures) {
    const dir = policyDir(content);
    const o = resolveWorktreeAlways(dir).on ? 'on' : 'off';
    if (o !== expected) throw new Error(`oracle drift: ${id}`);
    for (const sh of AVAILABLE_SHELLS) {
      const v = verdictOf(sh, dir, launcher);
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
  }
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

perShell('hooks.sh: tool_name matching', (sh) => {
  const { main } = policyOnMain();
  const env = noNodeEnv(tmp('hl-home-'));
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
});

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

test('hooks.sh AC9: the shell policy check agrees with resolveWorktreeAlways', () => {
  assertPolicyParity(AC9_FIXTURES);
});

test('hooks.sh AC9 go-red: deleting \\r from the whitespace class flips AC9.7', () => {
  const copy = launcherCopy('ws = "([ \\t\\r\\f\\v]|', 'ws = "([ \\t\\f\\v]|');
  assert.throws(() => assertPolicyParity(AC9_FIXTURES, copy), /policy parity: AC9\.7 /);
});

test('hooks.sh: policy edge cases agree with resolveWorktreeAlways', () => {
  assertPolicyParity([
    ['E1', 'worktree-always: true\nworktree-always:\n', 'on'],
    ['E2', 'worktree-always:\ttrue\n', 'on'],
    ['E3', 'worktree-always:true\n', 'on'],
    ['E4', 'worktree-always:\nworktree.always: true\n', 'on'],
    ['E5', 'worktree-always-x: true\n', 'off'],
    ['E6', 'worktree-always: true#x\n', 'on'],
  ]);
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

test('hooks.sh: Unicode whitespace in policy.yml agrees with resolveWorktreeAlways', () => {
  assertPolicyParity(UNICODE_FIXTURES);
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

test('hooks.sh go-red: dropping NBSP from the whitespace class flips U1', () => {
  const copy = launcherCopy('\\302\\240|', '');
  assert.throws(() => assertPolicyParity(UNICODE_FIXTURES, copy), /policy parity: U1 /);
});

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
