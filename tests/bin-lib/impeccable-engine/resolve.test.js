'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolve, run, defaultDeps, FAILURE_REASONS } = require('../../../plugin/bin/lib/impeccable-engine');

// A minimal fake deps object. `entries` is the array that would normally sit
// at installed_plugins.json's plugins["impeccable@impeccable"] — the JSON
// read/parse itself always succeeds here unless a test overrides `readFile`.
// `exists` defaults to "everything exists" so a test only needs to narrow
// the one path it cares about denying. Never touches the real filesystem or
// a real engine binary.
function fakeDeps({ entries = [], exists = () => true, spawn, readFile, realpath } = {}) {
  const data = JSON.stringify({ version: 2, plugins: { 'impeccable@impeccable': entries } });
  return {
    readFile: readFile || ((p) => {
      if (String(p).endsWith('installed_plugins.json')) return data;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }),
    exists,
    realpath: realpath || ((p) => p),
    homedir: () => '/fake-home',
    cwd: () => '/fake-project',
    spawn: spawn || (() => 'impeccable-engine 0.1.11\n'),
  };
}

const launcherFor = (installPath) =>
  path.join(installPath, 'skills', 'impeccable', 'scripts', process.platform === 'win32' ? 'impeccable.cmd' : 'impeccable');

test('AC1: fake install whose launcher is absent -> upgrade-required', () => {
  const entries = [{ scope: 'user', installPath: '/fake/user/install', version: '4.4.0' }];
  const deps = fakeDeps({ entries, exists: (p) => !p.includes('scripts') });
  const out = resolve({}, deps);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'upgrade-required');
  assert.ok(out.fix.includes(launcherFor('/fake/user/install')));
});

test('AC2: fake launcher that exits 127 under the engine probe -> engine-not-installed, fix names the engine-probe command', () => {
  const entries = [{ scope: 'user', installPath: '/fake/user/install', version: '4.4.0' }];
  const deps = fakeDeps({
    entries,
    spawn: () => {
      const err = new Error('Command failed with exit code 127');
      err.status = 127;
      throw err;
    },
  });
  const out = resolve({}, deps);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'engine-not-installed');
  assert.strictEqual(out.fix, `${launcherFor('/fake/user/install')} engine-probe`);
});

test('AC3a: a project-scope entry listed before the user entry wins (file order)', () => {
  const entries = [
    { scope: 'project', projectPath: '/repo', installPath: '/path/project', version: '4.5.0' },
    { scope: 'user', installPath: '/path/user', version: '4.4.0' },
  ];
  const deps = fakeDeps({ entries });
  const out = resolve({ projectPath: '/repo' }, deps);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.scope, 'project');
  assert.strictEqual(out.pluginRoot, '/path/project');
});

test('AC3b: only a user-scope entry -> user', () => {
  const entries = [{ scope: 'user', installPath: '/path/user', version: '4.4.0' }];
  const deps = fakeDeps({ entries });
  const out = resolve({ projectPath: '/repo' }, deps);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.scope, 'user');
  assert.strictEqual(out.pluginRoot, '/path/user');
});

test('AC3c: a non-matching project-scope entry plus a user-scope entry -> user (/repo-other must not match /repo)', () => {
  const entries = [
    { scope: 'project', projectPath: '/repo-other', installPath: '/path/other', version: '4.5.0' },
    { scope: 'user', installPath: '/path/user', version: '4.4.0' },
  ];
  const deps = fakeDeps({ entries });
  const out = resolve({ projectPath: '/repo' }, deps);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.scope, 'user');
  assert.strictEqual(out.pluginRoot, '/path/user');
});

test('AC3d: a project entry for an ancestor path does not apply below it -> user', () => {
  const entries = [
    { scope: 'project', projectPath: '/repo', installPath: '/path/short', version: '4.5.0' },
    { scope: 'user', installPath: '/path/user', version: '4.4.0' },
  ];
  const out = resolve({ projectPath: '/repo/sub' }, fakeDeps({ entries }));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.pluginRoot, '/path/user');
});

test('AC4a: no impeccable@impeccable entry at all -> not-installed with the /plugin install fix', () => {
  const deps = fakeDeps({ entries: [] });
  const out = resolve({ projectPath: '/repo' }, deps);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'not-installed');
  assert.ok(out.fix.startsWith('/plugin install impeccable@impeccable'));
  assert.strictEqual(out.detail, undefined);
});

test('AC4b: malformed installed_plugins.json -> not-installed with the /plugin install fix', () => {
  const deps = fakeDeps({ readFile: () => '{not valid json' });
  const out = resolve({ projectPath: '/repo' }, deps);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'not-installed');
  assert.ok(out.fix.startsWith('/plugin install impeccable@impeccable'));
  assert.ok(out.detail && out.detail.includes('malformed'));
});

test('installed_plugins.json missing entirely -> not-installed, detail names the missing file', () => {
  const deps = fakeDeps({
    readFile: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  });
  const out = resolve({ projectPath: '/repo' }, deps);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'not-installed');
  assert.ok(out.detail.startsWith('not found: '));
});

// Real temp dirs are realpathed first: on macOS os.tmpdir() sits under the
// /var -> /private/var symlink, and the resolver compares canonical paths.
const realTmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-resolve-')));
const readReal = (p) => fs.readFileSync(p, 'utf8');
const pluginsJson = (entries) => JSON.stringify({ version: 2, plugins: { 'impeccable@impeccable': entries } });

test('AC1.1/AC1.2: deps.env.CLAUDE_CONFIG_DIR points at a config dir holding an impeccable user entry; homedir() has no plugins file -> resolve() selects it', () => {
  const cfg = realTmp();
  const emptyHome = realTmp();
  try {
    fs.mkdirSync(path.join(cfg, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'),
      pluginsJson([{ scope: 'user', installPath: '/fake/cfg/install', version: '4.4.0' }]));
    const deps = {
      ...fakeDeps(),
      readFile: readReal,
      homedir: () => emptyHome,
      env: { CLAUDE_CONFIG_DIR: cfg },
    };
    const out = resolve({}, deps);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.pluginRoot, '/fake/cfg/install');
  } finally {
    fs.rmSync(cfg, { recursive: true, force: true });
    fs.rmSync(emptyHome, { recursive: true, force: true });
  }
});

test('AC2.1/AC2.2: deps.env omitted and homedir() holds the plugins file -> resolve() finds the entry, even with CLAUDE_CONFIG_DIR set in process.env', () => {
  const home = realTmp();
  const priorConfigDir = process.env.CLAUDE_CONFIG_DIR;
  try {
    fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
      pluginsJson([{ scope: 'user', installPath: '/fake/home/install', version: '4.4.0' }]));
    process.env.CLAUDE_CONFIG_DIR = path.join(home, 'no-such-config-dir');
    const deps = { ...fakeDeps(), readFile: readReal, homedir: () => home };
    assert.ok(!('env' in deps));
    const out = resolve({}, deps);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.pluginRoot, '/fake/home/install');
  } finally {
    if (priorConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = priorConfigDir;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('AC3.1/AC3.2: a mis-cased projectPath resolves the project-scope entry through defaultDeps().realpath', (t) => {
  const root = realTmp();
  try {
    const proj = path.join(root, 'proj');
    fs.mkdirSync(proj);
    const misCased = proj.toUpperCase();
    if (misCased === proj || !fs.existsSync(misCased)) {
      t.skip('volume is case-sensitive: mis-cased path does not exist');
      return;
    }
    const entries = [
      { scope: 'project', projectPath: proj, installPath: '/p', version: '4.5.0' },
      { scope: 'user', installPath: '/u', version: '4.4.0' },
    ];
    const deps = { ...fakeDeps({ entries }), realpath: defaultDeps().realpath };
    const out = resolve({ projectPath: misCased }, deps);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.pluginRoot, '/p');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC6.1: a home-directory project entry listed after the user entry loses by file order', () => {
  const entries = [
    { scope: 'user', installPath: '/path/user', version: '4.4.0' },
    { scope: 'project', projectPath: '/fake-home', installPath: '/path/home', version: '4.5.0' },
  ];
  const out = resolve({ projectPath: '/fake-home/work' }, fakeDeps({ entries }));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.pluginRoot, '/path/user');
});

test('AC7.1/AC7.2: memenu-app fixture — [user 4.6.0, memenu-app 3.0.6] selects the 4.6.0 install, not upgrade-required', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-first-applicable-'));
  try {
    const cfg = path.join(root, 'cfg');
    fs.mkdirSync(path.join(cfg, 'plugins'), { recursive: true });
    const mkInstall = (name, version) => {
      const dir = path.join(root, name);
      fs.mkdirSync(path.dirname(launcherFor(dir)), { recursive: true });
      fs.writeFileSync(launcherFor(dir), '');
      fs.mkdirSync(path.join(dir, '.claude-plugin'));
      fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ version }));
      return dir;
    };
    const user4_6_0Dir = mkInstall('user-4.6.0', '4.6.0');
    const memenuDir = mkInstall('memenu-3.0.6', '3.0.6');
    const project = path.join(root, 'memenu-app');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: {
        'impeccable@impeccable': [
          { scope: 'user', installPath: user4_6_0Dir, version: '4.6.0' },
          { scope: 'project', projectPath: project, installPath: memenuDir, version: '3.0.6' },
        ],
      },
    }));
    const deps = {
      ...fakeDeps(),
      readFile: (p) => fs.readFileSync(p, 'utf8'),
      exists: fs.existsSync,
      env: { CLAUDE_CONFIG_DIR: cfg },
      realpath: fs.realpathSync,
    };
    const out = resolve({ projectPath: project }, deps);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.pluginRoot, user4_6_0Dir);
    assert.strictEqual(out.pluginVersion, '4.6.0');
    assert.strictEqual(out.scope, 'user');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC8.1: records present but none applies -> not-installed with fix and a detail naming the count', () => {
  const entries = [
    { scope: 'project', projectPath: '/a', installPath: '/path/a', version: '4.5.0' },
    { scope: 'project', projectPath: '/b', installPath: '/path/b', version: '4.5.0' },
    { scope: 'project', projectPath: '/c', installPath: '/path/c', version: '4.5.0' },
  ];
  const out = resolve({ projectPath: '/repo' }, fakeDeps({ entries }));
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'not-installed');
  assert.ok(out.fix.startsWith('/plugin install impeccable@impeccable'));
  assert.match(out.detail, /^3 install records for impeccable@impeccable, none applies to \/repo /);
  assert.ok(out.detail.includes('no user or managed record'));
});

test('AC8.2: FAILURE_REASONS is unchanged', () => {
  assert.deepStrictEqual([...FAILURE_REASONS], ['not-installed', 'upgrade-required', 'engine-not-installed', 'shape-mismatch', 'exec-failed', 'timeout']);
  assert.ok(Object.isFrozen(FAILURE_REASONS));
});

test('defaultDeps() injects the native realpath and process.env', () => {
  const deps = defaultDeps();
  assert.strictEqual(deps.realpath, fs.realpathSync.native);
  assert.strictEqual(deps.env, process.env);
});

test('every spawn resolve() makes carries IMPECCABLE_LAUNCHER_PROBE=1 in its environment', () => {
  let capturedEnv = null;
  const entries = [{ scope: 'user', installPath: '/fake/user/install', version: '4.4.0' }];
  const deps = fakeDeps({
    entries,
    spawn: (_cmd, _args, options) => { capturedEnv = options.env; return 'impeccable-engine 0.1.11\n'; },
  });
  resolve({}, deps);
  assert.strictEqual(capturedEnv.IMPECCABLE_LAUNCHER_PROBE, '1');
});

const USER_ENTRY = [{ scope: 'user', installPath: '/fake/user/install', version: '4.4.0' }];
const probeThrows = (props) => fakeDeps({
  entries: USER_ENTRY,
  spawn: () => { throw Object.assign(new Error(props.message || 'probe failed'), props); },
});

test('#3040: a probe killed by the timeout -> timeout (not engine-not-installed), detail names engine-probe and the code', () => {
  const out = resolve({}, probeThrows({ code: 'ETIMEDOUT', signal: 'SIGTERM', killed: true, status: null }));
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'timeout');
  assert.match(out.detail, /^engine-probe timed out/);
  assert.match(out.detail, /ETIMEDOUT/);
  assert.strictEqual(out.fix, undefined, 'a timeout has no canned fix');
});

test('#3040: a probe that cannot launch (EINVAL, the #3039 Windows bug) -> exec-failed carrying err.code', () => {
  const out = resolve({}, probeThrows({ code: 'EINVAL', message: 'spawnSync impeccable.cmd EINVAL' }));
  assert.strictEqual(out.reason, 'exec-failed');
  assert.match(out.detail, /^engine-probe could not launch \(EINVAL\)/);
  assert.strictEqual(out.fix, undefined);
});

test('#3040: a probe whose launcher is missing at spawn time (ENOENT) -> exec-failed carrying err.code', () => {
  const out = resolve({}, probeThrows({ code: 'ENOENT', message: 'spawnSync /x ENOENT' }));
  assert.strictEqual(out.reason, 'exec-failed');
  assert.match(out.detail, /\(ENOENT\)/);
});

test('#3040: a probe that exits non-zero other than 127 -> exec-failed with the exit code and stderr tail', () => {
  const out = resolve({}, probeThrows({ status: 1, stderr: 'line a\nline b\n' }));
  assert.strictEqual(out.reason, 'exec-failed');
  assert.match(out.detail, /^engine-probe exit 1: /);
  assert.match(out.detail, /line b/);
});

test('#3040: a bare error (no code, no status) still yields a non-empty exec-failed detail', () => {
  const out = resolve({}, probeThrows({ message: 'mystery' }));
  assert.strictEqual(out.reason, 'exec-failed');
  assert.match(out.detail, /^engine-probe could not launch \(unknown\): mystery/);
});

test('#3040: run() passes a probe timeout through unchanged rather than relabelling it', () => {
  const out = run('signals', [], {}, probeThrows({ code: 'ETIMEDOUT', signal: 'SIGTERM', killed: true, status: null }));
  assert.strictEqual(out.reason, 'timeout');
  assert.match(out.detail, /^engine-probe timed out/);
});

test('#3040: a real launcher that hangs on engine-probe -> resolve() returns timeout (real process)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-probe-home-'));
  const install = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-probe-install-'));
  try {
    const scriptsDir = path.join(install, 'skills', 'impeccable', 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    const isWin = process.platform === 'win32';
    const launcher = path.join(scriptsDir, isWin ? 'impeccable.cmd' : 'impeccable');
    const engine = path.join(scriptsDir, 'hang.js');
    fs.writeFileSync(engine, 'setTimeout(() => {}, 3000);\n');
    fs.writeFileSync(launcher, isWin
      ? ['@echo off', `"${process.execPath}" "${engine}" %*`, 'exit /b %errorlevel%', ''].join('\r\n')
      : ['#!/bin/sh', 'sleep 3', ''].join('\n'));
    if (!isWin) fs.chmodSync(launcher, 0o755); // root-safe — exec-bit setup for a fake launcher script, not a permission-denial simulation
    const pluginsDir = path.join(home, '.claude', 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'impeccable@impeccable': [{ scope: 'user', installPath: install, version: '4.4.0' }] } })
    );
    const deps = {
      readFile: (p) => fs.readFileSync(p, 'utf8'),
      exists: (p) => fs.existsSync(p),
      realpath: (p) => fs.realpathSync(p),
      homedir: () => home,
      // Not `install`/`home`: on win32 the timed-out probe's engine child
      // outlives the killed cmd.exe and would hold its cwd, so the cleanup
      // below would fail with EPERM.
      cwd: () => os.tmpdir(),
      spawn: defaultDeps().spawn,
    };
    const out = resolve({ timeoutMs: isWin ? 1500 : 300 }, deps);
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.reason, 'timeout');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(install, { recursive: true, force: true });
  }
});

test('#3040: a probe killed by a non-SIGTERM signal -> exec-failed naming the signal, not "could not launch"', () => {
  const out = resolve({}, probeThrows({ signal: 'SIGSEGV', status: null }));
  assert.strictEqual(out.reason, 'exec-failed');
  assert.strictEqual(out.detail, 'engine-probe killed by SIGSEGV');
});
