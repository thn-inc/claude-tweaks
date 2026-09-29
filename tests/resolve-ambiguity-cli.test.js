// tests/resolve-ambiguity-cli.test.js — in-process tests for
// bin/resolve-ambiguity.js's run(argv, deps), mirroring
// tests/resolve-linked-prs-cli.test.js's deps-injection style: real fs calls
// are replaced by fakeDeps so no temp file ever touches disk in this suite.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../plugin/bin/resolve-ambiguity');

function fakeDeps(overrides = {}) {
  const calls = { readFile: [], writeFile: [], stdout: [], stderr: [] };
  const files = { '/body.txt': 'Before. <!-- ambiguity: which store? --> After.' };
  return {
    calls,
    files,
    readFile: (p) => {
      calls.readFile.push(p);
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
    writeFile: (p, s) => {
      calls.writeFile.push([p, s]);
      files[p] = s;
    },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
    ...overrides,
  };
}

// --- argument parsing ---------------------------------------------------

test('missing <body-file> is malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['--marker', 'x', '--resolution', 'y', '--out', '/out.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /<body-file> is required/);
});

test('missing --marker is malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['/body.txt', '--resolution', 'y', '--out', '/out.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /--marker <text> is required/);
});

test('missing --resolution is malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['/body.txt', '--marker', 'x', '--out', '/out.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /--resolution <text> is required/);
});

test('missing --out is malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['/body.txt', '--marker', 'x', '--resolution', 'y'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /--out <body-file> is required/);
});

test('unknown flag is malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['/body.txt', '--bogus'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /unknown argument: --bogus/);
});

test('--help prints usage and exits 0 without touching the filesystem', () => {
  const deps = fakeDeps({
    readFile: () => { throw new Error('should not be called'); },
    writeFile: () => { throw new Error('should not be called'); },
  });
  const code = run(['--help'], deps);
  assert.equal(code, 0);
  assert.match(deps.calls.stdout.join(''), /usage: resolve-ambiguity\.js/);
});

// --- read failure ---------------------------------------------------------

test('unreadable <body-file> — exit 2, no write attempted', () => {
  const deps = fakeDeps();
  const code = run(['/missing.txt', '--marker', 'x', '--resolution', 'y', '--out', '/out.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /could not read <body-file>/);
  assert.deepEqual(deps.calls.writeFile, []);
});

// --- marker not found ------------------------------------------------------

test('marker not found verbatim — exit 3, nothing written', () => {
  const deps = fakeDeps();
  const code = run(['/body.txt', '--marker', 'not present', '--resolution', 'y', '--out', '/out.txt'], deps);
  assert.equal(code, 3);
  assert.match(deps.calls.stderr.join(''), /markerText not found verbatim/);
  assert.deepEqual(deps.calls.writeFile, []);
});

// --- success ----------------------------------------------------------------

test('success: replaces the marker, writes --out, reports readyRestorable true', () => {
  const deps = fakeDeps();
  const code = run(['/body.txt', '--marker', '<!-- ambiguity: which store? -->', '--resolution', 'Uses Redis.', '--out', '/out.txt'], deps);
  assert.equal(code, 0);
  assert.equal(deps.files['/out.txt'], 'Before. Uses Redis. After.');
  const printed = JSON.parse(deps.calls.stdout[0]);
  assert.deepEqual(printed, {
    out: '/out.txt', markersRemaining: 0, openQuestionsRemaining: false, readyRestorable: true,
  });
});

test('success: a second remaining marker reports readyRestorable false', () => {
  const deps = fakeDeps();
  deps.files['/body.txt'] = '<!-- ambiguity: a --> and <!-- ambiguity: b -->';
  const code = run(['/body.txt', '--marker', '<!-- ambiguity: a -->', '--resolution', 'resolved a', '--out', '/out.txt'], deps);
  assert.equal(code, 0);
  const printed = JSON.parse(deps.calls.stdout[0]);
  assert.equal(printed.markersRemaining, 1);
  assert.equal(printed.readyRestorable, false);
});

// --- write failure ------------------------------------------------------

test('--out cannot be written — exit 2', () => {
  const deps = fakeDeps({
    writeFile: () => { throw new Error('EACCES'); },
  });
  const code = run(['/body.txt', '--marker', '<!-- ambiguity: which store? -->', '--resolution', 'x', '--out', '/out.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /could not write --out file/);
});
