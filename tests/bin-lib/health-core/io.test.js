'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { DEFAULT_IO, makeExec, resolveAgainst, fsPath, cwdOrUndefined } = require('../../../plugin/bin/lib/health-core/io');

const THROWING = { cwd: () => { throw Object.assign(new Error('ENOENT: process.cwd failed'), { code: 'ENOENT' }); } };

test('resolveAgainst leaves a win32 drive-relative path unchanged (fs resolves it per drive)', () => {
  assert.strictEqual(resolveAgainst('D:\\work', 'C:foo', path.win32), 'C:foo');
  assert.strictEqual(resolveAgainst('D:\\work', 'C:\\abs\\x', path.win32), 'C:\\abs\\x');
  assert.strictEqual(resolveAgainst('D:\\work', '\\rooted', path.win32), '\\rooted');
  assert.strictEqual(resolveAgainst('D:\\work', 'rel\\x', path.win32), 'D:\\work\\rel\\x');
});

test('resolveAgainst joins a POSIX relative path without normalizing it', () => {
  assert.strictEqual(resolveAgainst('/work', 'a/../b/', path.posix), '/work/a/../b/');
  assert.strictEqual(resolveAgainst('/work', '/abs/x', path.posix), '/abs/x');
});

test('fsPath never reads cwd for a path with a root, and joins a relative one unnormalized', () => {
  const abs = path.join(os.tmpdir(), 'x');
  assert.strictEqual(fsPath(THROWING, abs), abs);
  assert.strictEqual(fsPath({ cwd: () => '/work' }, 'a/../b'), `/work${path.sep}a/../b`);
  assert.throws(() => fsPath(THROWING, 'rel'), /process\.cwd failed/);
});

test('cwdOrUndefined returns the injected cwd, or undefined when it throws', () => {
  assert.strictEqual(cwdOrUndefined({ cwd: () => '/work' }), '/work');
  assert.strictEqual(cwdOrUndefined(THROWING), undefined);
});

test('makeExec writes a failing child\'s stderr to the injected stderr, never to process.stderr', () => {
  const dir = scratchDir('health-core-io-');
  let err = '';
  const exec = makeExec({ env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) }, stderr: (t) => { err += t; } });
  const realWrite = process.stderr.write;
  const leaked = [];
  process.stderr.write = (...a) => { leaked.push(a[0]); return true; };
  try {
    assert.throws(() => exec('git', ['-C', dir, 'rev-parse', 'HEAD']), (e) => typeof e.status === 'number' && e.status !== 0);
  } finally {
    process.stderr.write = realWrite;
  }
  assert.match(err, /not a git repository/i);
  assert.deepStrictEqual(leaked, [], 'nothing may reach process.stderr');
});

test('makeExec thrown error carries execFileSync-shaped status, stdout, stderr and message', () => {
  const dir = scratchDir('health-core-io-');
  const exec = makeExec({ env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) }, stderr: () => {} });
  let caught;
  try { exec('git', ['-C', dir, 'rev-parse', 'HEAD']); } catch (e) { caught = e; }
  assert.ok(caught, 'must throw');
  assert.strictEqual(caught.status, 128);
  assert.strictEqual(typeof caught.stdout, 'string');
  assert.match(caught.stderr, /not a git repository/i);
  assert.match(caught.message, /^Command failed: git -C /);
  assert.match(caught.message, /not a git repository/i);
});

test('makeExec forwards a successful child\'s stderr to the injected stderr', () => {
  let err = '';
  const exec = makeExec({ stderr: (t) => { err += t; } });
  const out = exec(process.execPath, ['-e', 'process.stderr.write("warn"); process.stdout.write("ok")']);
  assert.strictEqual(out, 'ok');
  assert.strictEqual(err, 'warn');
});

test('makeExec honours an explicit stdio whose third entry is ignore (nothing forwarded)', () => {
  let err = '';
  const exec = makeExec({ stderr: (t) => { err += t; } });
  const out = exec(process.execPath, ['-e', 'process.stderr.write("warn"); process.stdout.write("ok")'], { stdio: ['ignore', 'pipe', 'ignore'] });
  assert.strictEqual(out, 'ok');
  assert.strictEqual(err, '');
});

test('makeExec passes env to the child', () => {
  const exec = makeExec({ env: { ...process.env, CT_MARK: 'x' }, stderr: () => {} });
  assert.strictEqual(exec(process.execPath, ['-e', 'process.stdout.write(process.env.CT_MARK || "")']), 'x');
});

test('makeExec with no env inherits the parent environment', () => {
  const exec = makeExec({ stderr: () => {} });
  process.env.CT_IO_INHERIT = 'y';
  try {
    assert.strictEqual(exec(process.execPath, ['-e', 'process.stdout.write(process.env.CT_IO_INHERIT || "")']), 'y');
  } finally {
    delete process.env.CT_IO_INHERIT;
  }
});

test('makeExec forwards input to stdin', () => {
  const exec = makeExec({ stderr: () => {} });
  assert.strictEqual(exec(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'abc' }), 'abc');
});

test('makeExec passes a timeout through and throws when the child exceeds it', () => {
  const exec = makeExec({ stderr: () => {} });
  assert.throws(() => exec(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeout: 100 }), (e) => e.code === 'ETIMEDOUT');
});

test('DEFAULT_IO exposes stdout/stderr writers and a cwd reader', () => {
  assert.strictEqual(typeof DEFAULT_IO.stdout, 'function');
  assert.strictEqual(typeof DEFAULT_IO.stderr, 'function');
  assert.strictEqual(DEFAULT_IO.cwd(), process.cwd());
});
