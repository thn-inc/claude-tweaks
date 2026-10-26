const { test } = require('node:test');
const assert = require('node:assert');

const color = require('../plugin/bin/lib/color');
const deps = require('../plugin/bin/lib/deps');

test('color: NO_COLOR=1 disables color', () => {
  const orig = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  assert.strictEqual(color.red('x'), 'x');
  if (orig === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = orig;
});

test('color: NO_COLOR=anything disables (per standard)', () => {
  const orig = process.env.NO_COLOR;
  process.env.NO_COLOR = 'true';
  assert.strictEqual(color.colorEnabled(), false);
  process.env.NO_COLOR = '0';
  assert.strictEqual(color.colorEnabled(), false);
  if (orig === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = orig;
});

// Regression: per the NO_COLOR convention (https://no-color.org/), the
// variable's mere *presence* disables color regardless of its value — a
// script/CI harness exporting `NO_COLOR=` (present but empty) must still
// suppress ANSI codes, the same as every other value.
test('color: empty NO_COLOR still disables color (presence, not value, is what matters)', () => {
  const orig = process.env.NO_COLOR;
  process.env.NO_COLOR = '';
  assert.strictEqual(color.colorEnabled(), false);
  assert.strictEqual(color.red('x'), 'x');
  if (orig === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = orig;
});

test('color: unset NO_COLOR enables color', () => {
  const orig = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  assert.strictEqual(color.colorEnabled(), true);
  if (orig !== undefined) process.env.NO_COLOR = orig;
});

test('color: red wraps with ANSI 31 when enabled', () => {
  const orig = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  const out = color.red('text');
  assert.ok(out.includes('\x1b[31m'));
  assert.ok(out.includes('text'));
  assert.ok(out.includes('\x1b[0m'));
  if (orig !== undefined) process.env.NO_COLOR = orig;
});

test('deps: has() returns false for non-existent command', () => {
  assert.strictEqual(deps.has('definitely-not-a-real-command-xyz123'), false);
});

test('deps: has() returns true for node', () => {
  assert.strictEqual(deps.has('node'), true);
});

// Regression: has('node') can only ever run while a Node process is already
// executing, so shelling out to `node --version` to answer "is node
// present" spawns a subprocess purely to re-derive a fact this process
// already has for free.
test('deps: has(\'node\') never shells out to `node --version` (no subprocess)', () => {
  const modulePath = require.resolve('../plugin/bin/lib/deps');
  const childProcess = require('node:child_process');
  const originalExecSync = childProcess.execSync;
  let called = false;
  childProcess.execSync = (...args) => {
    called = true;
    return originalExecSync(...args);
  };
  delete require.cache[modulePath];
  try {
    const freshDeps = require('../plugin/bin/lib/deps');
    assert.strictEqual(freshDeps.has('node'), true);
    assert.strictEqual(called, false, "has('node') must not shell out to `node --version`");
  } finally {
    childProcess.execSync = originalExecSync;
    delete require.cache[modulePath];
  }
});

test('deps: installCommand returns expected mapping', () => {
  assert.strictEqual(deps.installCommand({ name: 'brew' }, 'node'), 'brew install node');
  assert.strictEqual(deps.installCommand({ name: 'winget' }, 'git'), 'winget install Git.Git');
  assert.strictEqual(deps.installCommand({ name: 'unknown' }, 'node'), undefined);
});

test('deps: detectVersionManager derives from process.execPath with no subprocess', () => {
  const path = process.execPath;
  let expected = null;
  if (path.includes('/.nvm/')) expected = 'nvm';
  else if (path.includes('/.fnm/')) expected = 'fnm';
  else if (path.includes('/.volta/')) expected = 'volta';
  else if (path.includes('/.n/')) expected = 'n';
  assert.strictEqual(deps.detectVersionManager(), expected);
});

// findOnPath replaces the `npx --no-install playwright-cli --version` probe:
// npx boots a whole npm CLI per SessionStart (~2 CPU-seconds, 30s+ under load),
// while "is it installed" is only a directory scan.
function withTempDirs(fn) {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-findonpath-'));
  try {
    const dir = path.join(root, 'bin');
    const cwd = path.join(root, 'cwd');
    fs.mkdirSync(dir);
    fs.mkdirSync(cwd);
    return fn({ fs, path, dir, cwd });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('deps: findOnPath finds an executable in a later PATH entry', { skip: process.platform === 'win32' && 'win32: fs.stat reports no execute bits' }, () => {
  withTempDirs(({ fs, path, dir, cwd }) => {
    const file = path.join(dir, 'playwright-cli');
    fs.writeFileSync(file, '#!/bin/sh\n');
    fs.chmodSync(file, 0o755); // root-safe: exec-bit stub, not a permission-denial simulation
    const PATH = [path.join(cwd, 'missing-bin'), dir].join(path.delimiter);
    assert.strictEqual(
      deps.findOnPath('playwright-cli', { env: { PATH }, platform: 'darwin', cwd }),
      file,
    );
  });
});

test('deps: findOnPath finds a project-local node_modules/.bin install first', { skip: process.platform === 'win32' && 'win32: fs.stat reports no execute bits' }, () => {
  withTempDirs(({ fs, path, dir, cwd }) => {
    const binDir = path.join(cwd, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const file = path.join(binDir, 'playwright-cli');
    const onPath = path.join(dir, 'playwright-cli');
    for (const f of [file, onPath]) {
      fs.writeFileSync(f, '#!/bin/sh\n');
      fs.chmodSync(f, 0o755); // root-safe: exec-bit stub, not a permission-denial simulation
    }
    assert.strictEqual(
      deps.findOnPath('playwright-cli', { env: { PATH: dir }, platform: 'darwin', cwd }),
      file,
    );
  });
});

test('deps: findOnPath ignores a non-executable file on POSIX', () => {
  withTempDirs(({ fs, path, dir, cwd }) => {
    const file = path.join(dir, 'playwright-cli');
    fs.writeFileSync(file, 'not executable\n');
    fs.chmodSync(file, 0o644); // root-safe: root does not change the mode bits findOnPath reads
    assert.strictEqual(
      deps.findOnPath('playwright-cli', { env: { PATH: dir }, platform: 'darwin', cwd }),
      null,
    );
  });
});

test('deps: findOnPath returns null when nothing matches', () => {
  withTempDirs(({ cwd }) => {
    assert.strictEqual(
      deps.findOnPath('playwright-cli', { env: { PATH: '' }, platform: 'darwin', cwd }),
      null,
    );
  });
});

test('deps: findOnPath tries PATHEXT on win32', () => {
  withTempDirs(({ fs, path, dir, cwd }) => {
    const file = path.join(dir, 'playwright-cli.cmd');
    fs.writeFileSync(file, '@echo off\r\n');
    assert.strictEqual(
      deps.findOnPath('playwright-cli', { env: { PATH: dir, PATHEXT: '.EXE;.CMD' }, platform: 'win32', cwd }),
      file,
    );
  });
});

// A null cwd (the caller could not resolve one) skips the project-local
// node_modules/.bin and scans PATH only.
test('deps: findOnPath scans PATH only when cwd is null', { skip: process.platform === 'win32' && 'win32: fs.stat reports no execute bits' }, () => {
  withTempDirs(({ fs, path, dir }) => {
    assert.strictEqual(deps.findOnPath('playwright-cli', { env: { PATH: dir }, platform: 'darwin', cwd: null }), null);
    const file = path.join(dir, 'playwright-cli');
    fs.writeFileSync(file, '#!/bin/sh\n');
    fs.chmodSync(file, 0o755); // root-safe: exec-bit stub, not a permission-denial simulation
    assert.strictEqual(deps.findOnPath('playwright-cli', { env: { PATH: dir }, platform: 'darwin', cwd: null }), file);
  });
});

// process.cwd() throws once the cwd was deleted (a reaped worktree); that must not drop
// collect()'s messages. Node caches the cwd until the next chdir, so the test chdirs in,
// deletes the directory, and only then calls: the first process.cwd() after that throws.
test('deps: playwrightCliMessage still answers from PATH when the cwd was deleted', {
  skip: process.platform === 'win32' && 'win32: a process cwd cannot be removed',
}, () => {
  withTempDirs(({ fs, path, dir, cwd }) => {
    const origPath = process.env.PATH;
    const origCwd = process.cwd();
    try {
      process.chdir(cwd);
      fs.rmSync(cwd, { recursive: true });
      assert.throws(() => process.cwd(), 'the fixture must have produced a deleted cwd');
      const shim = path.join(dir, 'playwright-cli');
      fs.writeFileSync(shim, '#!/bin/sh\n');
      fs.chmodSync(shim, 0o755); // root-safe: exec-bit stub, not a permission-denial simulation
      process.env.PATH = dir;
      assert.strictEqual(deps.playwrightCliMessage(), null);
    } finally {
      process.chdir(origCwd);
      if (origPath === undefined) delete process.env.PATH;
      else process.env.PATH = origPath;
    }
  });
});

// Pins the wiring of process.env into findOnPath through playwrightCliMessage: a
// mis-wired argument (e.g. env: {}) would still satisfy the no-subprocess guard
// below, so drive the real PATH instead.
test('deps: playwrightCliMessage reports installed vs missing from the real PATH', () => {
  withTempDirs(({ fs, path, dir, cwd }) => {
    const origPath = process.env.PATH;
    const origCwd = process.cwd();
    try {
      process.chdir(cwd);
      process.env.PATH = dir;
      assert.match(deps.playwrightCliMessage(), /Install: npm install -g @playwright\/cli/);

      const shim = path.join(dir, 'playwright-cli');
      fs.writeFileSync(shim, '#!/bin/sh\n');
      fs.chmodSync(shim, 0o755); // root-safe: exec-bit stub, not a permission-denial simulation
      assert.strictEqual(deps.playwrightCliMessage(), null);
    } finally {
      process.chdir(origCwd);
      if (origPath === undefined) delete process.env.PATH;
      else process.env.PATH = origPath;
    }
  });
});

test('deps: collect probes no package manager when node and git are present', () => {
  const modulePath = require.resolve('../plugin/bin/lib/deps');
  const childProcess = require('node:child_process');
  const original = childProcess.execSync;
  const commands = [];
  // Every probe succeeds, so nothing is missing and no install hint needs a package manager.
  childProcess.execSync = (cmd) => {
    commands.push(cmd);
    return '';
  };
  delete require.cache[modulePath];
  try {
    const freshDeps = require('../plugin/bin/lib/deps');
    freshDeps.collect();
    assert.deepStrictEqual(commands.filter((c) => !/^git /.test(c)), [], 'only git may be probed');
  } finally {
    childProcess.execSync = original;
    delete require.cache[modulePath];
  }
});

test('deps: playwrightCliMessage never spawns a subprocess', () => {
  const modulePath = require.resolve('../plugin/bin/lib/deps');
  const childProcess = require('node:child_process');
  const names = ['execSync', 'execFileSync', 'spawnSync'];
  const originals = Object.fromEntries(names.map((n) => [n, childProcess[n]]));
  // Recorded, not just thrown: the old npx probe wrapped execSync in a
  // try/catch, so a bare throw would be swallowed and the test would pass.
  const called = [];
  for (const n of names) {
    childProcess[n] = () => {
      called.push(n);
      throw new Error(`playwrightCliMessage must not call child_process.${n}`);
    };
  }
  delete require.cache[modulePath];
  try {
    const freshDeps = require('../plugin/bin/lib/deps');
    const msg = freshDeps.playwrightCliMessage();
    assert.ok(msg === null || typeof msg === 'string');
    assert.deepStrictEqual(called, [], 'playwrightCliMessage must not spawn a subprocess');
  } finally {
    for (const n of names) childProcess[n] = originals[n];
    delete require.cache[modulePath];
  }
});
