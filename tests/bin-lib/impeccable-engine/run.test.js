'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { run } = require('../../../plugin/bin/lib/impeccable-engine');
const cli = require('../../../plugin/bin/impeccable-engine.js');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Same shape as resolve.test.js's fakeDeps — a resolved install (user scope,
// launcher present) that always answers the engine probe successfully, so
// tests focus on run()'s own spawn + validator behavior. `spawn` is a
// (cmd, args, options) => stdout function; override per test.
function fakeDeps({ installPath = '/fake/user/install', spawn } = {}) {
  const entries = [{ scope: 'user', installPath, version: '4.4.0' }];
  const data = JSON.stringify({ version: 2, plugins: { 'impeccable@impeccable': entries } });
  let callCount = 0;
  const wrappedSpawn = (cmd, args, options) => {
    callCount += 1;
    // The first call is always resolve()'s own engine-probe.
    if (args[0] === 'engine-probe') return 'impeccable-engine 0.1.11\n';
    return spawn(cmd, args, options);
  };
  const deps = {
    readFile: () => data,
    exists: () => true,
    realpath: (p) => p,
    homedir: () => '/fake-home',
    cwd: () => '/fake-project',
    spawn: wrappedSpawn,
  };
  return { deps, callCount: () => callCount };
}

test('AC6: signals output missing setup.platform -> shape-mismatch naming setup.platform', () => {
  const body = JSON.stringify({
    setup: { hasProduct: false, productPath: null, hasDesign: false, designPath: null, hasCode: false },
    critique: { latest: null },
    git: { isRepo: false },
    devServer: { running: false, ports: [] },
  });
  const { deps } = fakeDeps({ spawn: () => body });
  const out = run('signals', [], {}, deps);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'shape-mismatch');
  assert.strictEqual(out.detail, 'setup.platform');
});

test('AC6: a valid signals output returns {ok:true, value} with the parsed object', () => {
  const parsed = {
    setup: { hasProduct: true, productPath: 'PRODUCT.md', hasDesign: true, designPath: 'DESIGN.md', hasCode: true, platform: 'web' },
    critique: { latest: null },
    git: { isRepo: true, branch: 'main', base: null, changedFiles: [], changedCount: 0 },
    devServer: { running: false, ports: [] },
    scan: { targets: ['.'], via: 'root' },
  };
  const { deps } = fakeDeps({ spawn: () => JSON.stringify(parsed) });
  const out = run('signals', [], {}, deps);
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(out.value, parsed);
});

test('doctor validator: findings array with a non-string severity is shape-mismatch', () => {
  const { deps } = fakeDeps({ spawn: () => JSON.stringify({ findings: [{ severity: 1 }] }) });
  const out = run('doctor', [], {}, deps);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'shape-mismatch');
  assert.strictEqual(out.detail, 'findings[0].severity');
});

test('doctor validator: a valid findings array passes', () => {
  const { deps } = fakeDeps({ spawn: () => JSON.stringify({ findings: [{ severity: 'p1' }] }) });
  const out = run('doctor', [], {}, deps);
  assert.strictEqual(out.ok, true);
});

test('concept-seed validator: a header with a leading scope word is accepted (unanchored regex)', () => {
  const { deps } = fakeDeps({ spawn: () => 'SURFACE CONCEPT SEED (key: abc123)\nmore text\n' });
  const out = run('concept-seed', ['--scope', 'surface'], {}, deps);
  assert.strictEqual(out.ok, true);
});

test('concept-seed validator: no matching header is shape-mismatch', () => {
  const { deps } = fakeDeps({ spawn: () => 'not a concept seed header\n' });
  const out = run('concept-seed', [], {}, deps);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'shape-mismatch');
});

test('concept-seed args are filtered to the allowed flag set before reaching the launcher', () => {
  let seenArgs = null;
  const { deps } = fakeDeps({
    spawn: (_cmd, args) => { seenArgs = args; return 'CONCEPT SEED (key: x)\n'; },
  });
  run('concept-seed', ['--scope', 'surface', '--evil', 'x'], {}, deps);
  assert.deepStrictEqual(seenArgs, ['concept-seed', '--scope', 'surface']);
});

test('surface-brief: text is returned verbatim', () => {
  const { deps } = fakeDeps({ spawn: () => 'raw brief text\n' });
  const out = run('surface-brief', ['target.md'], {}, deps);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.value, 'raw brief text\n');
});

test('exec-failed: a non-timeout, non-127 spawn failure reports exit code plus trailing stderr', () => {
  const { deps } = fakeDeps({
    spawn: () => {
      const err = new Error('boom');
      err.status = 1;
      err.stderr = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
      throw err;
    },
  });
  const out = run('signals', [], {}, deps);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'exec-failed');
  assert.ok(out.detail.startsWith('exit 1:'));
  assert.ok(out.detail.includes('line 29'), 'keeps only the last 20 lines, but the tail must be present');
  assert.ok(!out.detail.includes('line 0'), 'the earliest lines must be dropped beyond the last 20');
});

test('a resolve() failure short-circuits run() and is passed through unchanged', () => {
  const deps = {
    readFile: () => JSON.stringify({ version: 2, plugins: {} }),
    exists: () => true,
    realpath: (p) => p,
    homedir: () => '/fake-home',
    cwd: () => '/fake-project',
    spawn: () => { throw new Error('must never be called'); },
  };
  const out = run('signals', [], {}, deps);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'not-installed');
});

test('AC8: every spawn run() makes for the verb call also carries IMPECCABLE_LAUNCHER_PROBE=1', () => {
  let capturedEnv = null;
  const { deps } = fakeDeps({
    spawn: (_cmd, _args, options) => { capturedEnv = options.env; return '{"findings":[]}'; },
  });
  run('doctor', [], {}, deps);
  assert.strictEqual(capturedEnv.IMPECCABLE_LAUNCHER_PROBE, '1');
});

test('AC5: a fake launcher that sleeps past a 200ms timeoutMs returns {ok:false, reason:"timeout"} (real process, real timeout)', () => {
  const home = tmp('impeccable-engine-home-');
  const install = tmp('impeccable-engine-install-');
  const scriptsDir = path.join(install, 'skills', 'impeccable', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const launcher = path.join(scriptsDir, 'impeccable');
  fs.writeFileSync(launcher, [
    '#!/bin/sh',
    'if [ "$1" = "engine-probe" ]; then',
    '  echo "impeccable-engine 0.1.0"',
    '  exit 0',
    'fi',
    'sleep 2',
    'echo "should never be seen"',
    '',
  ].join('\n'));
  fs.chmodSync(launcher, 0o755); // root-safe — exec-bit setup for a fake launcher script, not a permission-denial simulation
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
    cwd: () => install,
    spawn: (cmd, args, options) => execFileSync(cmd, args, options),
  };
  const out = run('signals', [], { timeoutMs: 200 }, deps);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'timeout');
});

test('AC7: CLI `run doctor --fix` exits 2 with a usage error and never calls run()/spawns anything', () => {
  let runCalled = false;
  let stderrText = '';
  const deps = {
    resolve: () => { throw new Error('must never be called'); },
    run: () => { runCalled = true; throw new Error('must never be called'); },
    stdout: () => {},
    stderr: (s) => { stderrText += s; },
  };
  const code = cli.run(['run', 'doctor', '--fix'], deps);
  assert.strictEqual(code, 2);
  assert.strictEqual(runCalled, false);
  assert.ok(stderrText.includes('usage'));
});

test('CLI `run concept-seed --evil x` (argument outside the allowlist) exits 2 and never spawns', () => {
  let runCalled = false;
  const deps = {
    resolve: () => { throw new Error('must never be called'); },
    run: () => { runCalled = true; },
    stdout: () => {},
    stderr: () => {},
  };
  const code = cli.run(['run', 'concept-seed', '--evil', 'x'], deps);
  assert.strictEqual(code, 2);
  assert.strictEqual(runCalled, false);
});

test('CLI `resolve` with a trailing argument exits 2 (any argument after resolve is a usage error)', () => {
  const deps = { resolve: () => { throw new Error('must never be called'); }, run: () => {}, stdout: () => {}, stderr: () => {} };
  const code = cli.run(['resolve', 'extra'], deps);
  assert.strictEqual(code, 2);
});

test('CLI `run` with an unknown verb exits 2', () => {
  const deps = { resolve: () => {}, run: () => { throw new Error('must never be called'); }, stdout: () => {}, stderr: () => {} };
  const code = cli.run(['run', 'not-a-verb'], deps);
  assert.strictEqual(code, 2);
});

test('CLI `resolve` happy path prints the JSON envelope and exits 0', () => {
  let printed = '';
  const deps = { resolve: () => ({ ok: true, pluginRoot: '/x' }), run: () => {}, stdout: (s) => { printed += s; }, stderr: () => {} };
  const code = cli.run(['resolve'], deps);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(JSON.parse(printed), { ok: true, pluginRoot: '/x' });
});

test('CLI `run signals` happy path prints the JSON envelope and exits 0', () => {
  let printed = '';
  const deps = { resolve: () => {}, run: (verb, args) => { assert.strictEqual(verb, 'signals'); assert.deepStrictEqual(args, []); return { ok: true, value: {} }; }, stdout: (s) => { printed += s; }, stderr: () => {} };
  const code = cli.run(['run', 'signals'], deps);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(JSON.parse(printed), { ok: true, value: {} });
});
