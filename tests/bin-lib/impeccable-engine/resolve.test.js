'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { resolve } = require('../../../plugin/bin/lib/impeccable-engine');

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

const launcherFor = (installPath) => path.join(installPath, 'skills', 'impeccable', 'scripts', 'impeccable');

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
