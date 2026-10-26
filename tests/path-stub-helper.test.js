'use strict';
// tests/path-stub-helper.test.js — #4285: pins tests/helpers/path-stub.js, the
// shared helper that stub-on-PATH tests use to skip honestly on win32
// (STUB_SKIP / installStub) and that symlink-PATH tests use to build a PATH
// holding one real binary and not another (pathWithOnly).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { STUB_SKIP_REASON, STUB_SKIP, installStub, pathWithOnly, findColonPathJoins } = require('./helpers/path-stub');
const { readText } = require('./helpers/read-skill');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-path-stub-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeExecutable(dir, name) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(file, 0o755); // root-safe: exec-bit fixture, not a denial simulation
  return file;
}

test('STUB_SKIP_REASON is the spec text, and STUB_SKIP is the reason on win32 only', () => {
  assert.strictEqual(STUB_SKIP_REASON, 'win32: execFile resolves only .exe/.com on PATH, so a script stub is never spawned');
  assert.strictEqual(STUB_SKIP, process.platform === 'win32' && STUB_SKIP_REASON);
});

test('installStub prepends a dir holding the stub and restore puts PATH back', (t) => {
  const before = process.env.PATH;
  const restoreA = installStub('ct-a', '#!/bin/sh\nexit 0\n');
  const restoreB = installStub('ct-b', '#!/bin/sh\nexit 0\n');
  t.after(() => { restoreB(); restoreA(); });
  const [dirB, dirA] = process.env.PATH.split(path.delimiter);
  assert.ok(fs.existsSync(path.join(dirB, 'ct-b')), 'first PATH entry holds ct-b');
  assert.ok(fs.existsSync(path.join(dirA, 'ct-a')), 'second PATH entry holds ct-a');
  restoreB();
  restoreA();
  assert.strictEqual(process.env.PATH, before);
  assert.strictEqual(fs.existsSync(dirA), false);
  assert.strictEqual(fs.existsSync(dirB), false);
  assert.doesNotThrow(() => restoreA());
  assert.strictEqual(process.env.PATH, before);
  // A repeat restore is a no-op: it does not clobber a stub installed since.
  const restoreC = installStub('ct-c', '#!/bin/sh\nexit 0\n');
  t.after(restoreC);
  const pathWithC = process.env.PATH;
  restoreA();
  assert.strictEqual(process.env.PATH, pathWithC);
  restoreC();
  assert.strictEqual(process.env.PATH, before);
});

test('installStub restores in any order: the first-installed stub restored first leaves no dangling entry', (t) => {
  const before = process.env.PATH;
  const restoreA = installStub('ct-a', '#!/bin/sh\nexit 0\n');
  const restoreB = installStub('ct-b', '#!/bin/sh\nexit 0\n');
  t.after(() => { restoreA(); restoreB(); });
  const [dirB] = process.env.PATH.split(path.delimiter);
  restoreA();
  assert.strictEqual(process.env.PATH, dirB + path.delimiter + before);
  restoreB();
  assert.strictEqual(process.env.PATH, before);
});

test('installStub with PATH unset leaves PATH unset after restore', (t) => {
  const saved = process.env.PATH;
  t.after(() => { process.env.PATH = saved; });
  delete process.env.PATH;
  const restore = installStub('ct-a', '#!/bin/sh\nexit 0\n');
  assert.strictEqual(fs.existsSync(path.join(process.env.PATH, 'ct-a')), true);
  restore();
  assert.strictEqual(process.env.PATH, undefined);
});

test('AC2.1: pathWithOnly([git], { exclude: [gh] }) resolves git and not gh', (t) => {
  const p = pathWithOnly(['git'], { exclude: ['gh'] });
  // Remove only a symlink dir pathWithOnly made, never a real binary dir.
  if (path.basename(p).startsWith('ct-path-only-')) t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  assert.doesNotThrow(() => execFileSync('git', ['--version'], { env: { ...process.env, PATH: p }, stdio: 'ignore' }));
  // On a host with no gh the ENOENT below holds for any PATH, so it proves the
  // exclusion only where gh exists; the symlink-fallback test pins the rule itself.
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' });
  } catch {
    t.diagnostic('gh is not on this host PATH: the gh half of AC2.1 is not discriminating here');
  }
  assert.throws(
    () => execFileSync('gh', ['--version'], { env: { ...process.env, PATH: p }, stdio: 'ignore' }),
    (e) => e.code === 'ENOENT',
  );
});

test('pathWithOnly falls back to a symlink dir when the binary dir also holds an excluded name', { skip: process.platform === 'win32' && 'win32: symlink creation needs privilege' }, (t) => {
  const shared = tmpDir(t);
  writeExecutable(shared, 'tool');
  writeExecutable(shared, 'gh');
  const p = pathWithOnly(['tool'], { exclude: ['gh'], env: { PATH: shared }, platform: 'linux' });
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  assert.notStrictEqual(p, shared);
  assert.deepStrictEqual(fs.readdirSync(p), ['tool']);
  assert.strictEqual(fs.realpathSync(path.join(p, 'tool')), fs.realpathSync(path.join(shared, 'tool')));
});

test('pathWithOnly uses the binary own dir when it holds no excluded name', (t) => {
  const a = tmpDir(t);
  const b = tmpDir(t);
  writeExecutable(a, 'tool');
  writeExecutable(b, 'gh');
  assert.strictEqual(pathWithOnly(['tool'], { exclude: ['gh'], env: { PATH: [a, b].join(path.delimiter) }, platform: process.platform }), a);
});

test('pathWithOnly finds a PATHEXT extension on win32', (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'git.EXE'), '');
  assert.strictEqual(pathWithOnly(['git'], { env: { Path: dir, PATHEXT: '.COM;.EXE' }, platform: 'win32' }), dir);
  // libuv spawns only .com/.exe/bare, so a git.CMD earlier on PATH is passed over.
  const a = tmpDir(t);
  const b = tmpDir(t);
  fs.writeFileSync(path.join(a, 'git.CMD'), '');
  fs.writeFileSync(path.join(b, 'git.EXE'), '');
  const Path = `${a};${b}`;
  assert.strictEqual(pathWithOnly(['git'], { env: { Path, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, platform: 'win32' }), b);
});

test('pathWithOnly throws naming a binary that is not on PATH', (t) => {
  const emptyDir = tmpDir(t);
  assert.throws(() => pathWithOnly(['ct-no-such-bin'], { env: { PATH: emptyDir }, platform: 'linux' }), /ct-no-such-bin not found on PATH \(searched \d+ dirs: /);
});

function walkJs(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(full, acc);
    else if (e.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

test('AC3.1: no test file joins PATH with a literal colon', () => {
  const root = path.join(__dirname, '..');
  const hits = [];
  for (const file of walkJs(__dirname)) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    for (const line of findColonPathJoins(readText(file))) hits.push(`${rel}:${line}`);
  }
  assert.deepStrictEqual(hits, []);
});

test('AC3.1 self-check: the scan flags a doctored colon join and passes a non-PATH join', () => {
  const bad = 'PATH: `${dir}' + ':' + '${process.env.PATH}`';
  assert.deepStrictEqual(findColonPathJoins(bad), [1]);
  assert.deepStrictEqual(findColonPathJoins("env.PATH = [dir, base].join('" + ':' + "');"), [1]);
  assert.deepStrictEqual(findColonPathJoins("const targetPath = pathParts.join(':');"), []);
  assert.deepStrictEqual(findColonPathJoins('PATH: `${dir}${path.delimiter}${process.env.PATH}`'), []);
  assert.deepStrictEqual(findColonPathJoins('const v = CWD_VS_PATH.test(line) && `${rel}' + ':' + '${i + 1}`;'), []);
});
