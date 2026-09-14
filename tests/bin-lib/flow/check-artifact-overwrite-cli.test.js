'use strict';
// tests/bin-lib/flow/check-artifact-overwrite-cli.test.js — refs #2014
//
// Pins bin/check-artifact-overwrite.js's argv parsing and exit-code
// vocabulary (0 clean, 1 overwrite detected, 2 malformed invocation).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'check-artifact-overwrite.js');
const { run } = require(CLI);
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'flow', 'artifact-overwrite-check.js');
const { ArtifactOverwriteCheckError } = require(LIB);

function fakeIo() {
  let out = '';
  let err = '';
  return {
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
    out: () => out,
    err: () => err,
  };
}

test('--help prints usage and exits 0', () => {
  const io = fakeIo();
  const code = run(['node', 'check-artifact-overwrite.js', '--help'], io);
  assert.strictEqual(code, 0);
  assert.match(io.out(), /usage: check-artifact-overwrite\.js/);
});

test('missing --base is a malformed invocation (exit 2)', () => {
  const io = fakeIo();
  const code = run(['node', 'check-artifact-overwrite.js'], io);
  assert.strictEqual(code, 2);
  assert.match(io.err(), /--base is required/);
});

test('unknown flag is a malformed invocation (exit 2)', () => {
  const io = fakeIo();
  const code = run(['node', 'check-artifact-overwrite.js', '--base', 'HEAD~1', '--wat', 'x'], io);
  assert.strictEqual(code, 2);
  assert.match(io.err(), /unknown argument/);
});

test('a flag with no value is a malformed invocation (exit 2)', () => {
  const io = fakeIo();
  const code = run(['node', 'check-artifact-overwrite.js', '--base'], io);
  assert.strictEqual(code, 2);
  assert.match(io.err(), /requires a value/);
});

test('clean walk -> exit 0, JSON on stdout', () => {
  const io = fakeIo();
  const code = run(
    ['node', 'check-artifact-overwrite.js', '--base', 'a'],
    { ...io, check: () => ({ clean: true, overwrites: [] }) },
  );
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(JSON.parse(io.out()), { clean: true, overwrites: [] });
});

test('overwrite detected -> exit 1, JSON on stdout names the offender', () => {
  const io = fakeIo();
  const code = run(
    ['node', 'check-artifact-overwrite.js', '--base', 'a', '--path', 'docs/journeys/'],
    { ...io, check: () => ({ clean: false, overwrites: [{ path: 'docs/journeys/x.md', commit: 'deadbeef', reason: 'r' }] }) },
  );
  assert.strictEqual(code, 1);
  assert.strictEqual(JSON.parse(io.out()).overwrites.length, 1);
});

test('a walk failure (unresolvable ref) -> exit 3, stderr names it, nothing on stdout', () => {
  const io = fakeIo();
  const code = run(
    ['node', 'check-artifact-overwrite.js', '--base', 'not-a-ref'],
    { ...io, check: () => { throw new ArtifactOverwriteCheckError('unknown revision or path not in the working tree'); } },
  );
  assert.strictEqual(code, 3);
  assert.match(io.err(), /unknown revision/);
  assert.strictEqual(io.out(), '');
});

test('a bug in the check itself (not an ArtifactOverwriteCheckError) crashes loud, never reported as exit 3', () => {
  const io = fakeIo();
  assert.throws(
    () => run(
      ['node', 'check-artifact-overwrite.js', '--base', 'HEAD~1'],
      { ...io, check: () => { throw new TypeError("Cannot read properties of undefined (reading 'lineNo')"); } },
    ),
    TypeError,
  );
});

test('end-to-end against a real repo (no fake check) — clean walk exits 0', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-check-artifact-overwrite-cli-')));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', timeout: 30000 });
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 'Test');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  fs.mkdirSync(path.join(dir, 'docs', 'journeys'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'journeys', 'demo.md'), '# Demo\nFirst.\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'Add demo journey (refs #10)');

  // checkArtifactOverwrite's own default reads process.cwd(); spawn the real
  // CLI (rather than calling run() in-process) so cwd is honored exactly the
  // way a caller invoking this binary would see it.
  const spawned = execFileSync('node', [CLI, '--base', base, '--path', 'docs/journeys/'], { cwd: dir, encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(spawned), { clean: true, overwrites: [] });
});
