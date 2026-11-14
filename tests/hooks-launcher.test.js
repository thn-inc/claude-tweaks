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
const { gitRepo } = require('./helpers/git-fixtures');
const { fixtureHomeEnv } = require('./helpers/fixture-home');
const { pathWithOnly } = require('./helpers/path-stub');
const { readText } = require('./helpers/read-skill');
const { INTERACTION_STYLE_DIRECTIVE } = require('../plugin/bin/lib/hooks/interaction-style');

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
