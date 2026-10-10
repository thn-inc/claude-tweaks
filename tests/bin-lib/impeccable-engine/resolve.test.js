'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolve, run, defaultDeps } = require('../../../plugin/bin/lib/impeccable-engine');

// A minimal fake deps object. `entries` is the array that would normally sit
// at installed_plugins.json's plugins["impeccable@impeccable"] — the JSON
// read/parse itself always succeeds here unless a test overrides `readFile`.
// `exists` defaults to "everything exists" so a test only needs to narrow
// the one path it cares about denying. Never touches the real filesystem or
// a real engine binary.
function fakeDeps({ entries = [], exists = () => true, spawn, readFile, realpath } = {}) {
  const data = JSON.stringify({ version: 2, plugins: { 'impeccable@impeccable': entries } });
  return {
    readFile: readFile || (() => data),
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

test('AC3a: a matching project-scope entry plus a user-scope entry -> project wins', () => {
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

test('AC3d: two matching project-scope entries -> the longer projectPath wins', () => {
  const entries = [
    { scope: 'project', projectPath: '/repo', installPath: '/path/short', version: '4.5.0' },
    { scope: 'project', projectPath: '/repo/sub', installPath: '/path/long', version: '4.6.0' },
  ];
  const deps = fakeDeps({ entries });
  const out = resolve({ projectPath: '/repo/sub/deep' }, deps);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.pluginRoot, '/path/long');
  assert.strictEqual(out.pluginVersion, '4.6.0');
});

test('AC4a: no impeccable@impeccable entry at all -> not-installed with the /plugin install fix', () => {
  const deps = fakeDeps({ entries: [] });
  const out = resolve({ projectPath: '/repo' }, deps);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'not-installed');
  assert.ok(out.fix.startsWith('/plugin install impeccable@impeccable'));
});

test('AC4b: malformed installed_plugins.json -> not-installed with the /plugin install fix', () => {
  const deps = fakeDeps({ readFile: () => '{not valid json' });
  const out = resolve({ projectPath: '/repo' }, deps);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'not-installed');
  assert.ok(out.fix.startsWith('/plugin install impeccable@impeccable'));
  assert.ok(out.detail && out.detail.includes('malformed'));
});

test('installed_plugins.json missing entirely -> not-installed (exists() false for that one path)', () => {
  const deps = fakeDeps({ exists: () => false });
  const out = resolve({ projectPath: '/repo' }, deps);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'not-installed');
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
