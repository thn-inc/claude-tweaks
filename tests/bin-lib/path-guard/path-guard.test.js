'use strict';

// Unit tests for plugin/bin/lib/path-guard (#3417). One table of cases, each
// run twice: AC1.1 against the real primitive, AC1.2 against the naive
// stand-in that models the hazard (the control must go red through the SAME
// `run`, so the case can actually fail).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  lstatType, canonicalRealpath, resolveLeaf, isAncestorOrSelf, resolveWithin,
} = require('../../../plugin/bin/lib/path-guard');
const { isPathContained } = require('../../../plugin/bin/lib/shared-primitives');
const { caseInsensitiveFs } = require('../../helpers/case-insensitive-fs');

// --- Fixture 1: real tmp tree -------------------------------------------------
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'path-guard-')));
fs.mkdirSync(path.join(root, 'in'));
fs.mkdirSync(path.join(root, 'out'));
fs.writeFileSync(path.join(root, 'in', 'target.txt'), 'in');
fs.writeFileSync(path.join(root, 'out', 'secret.txt'), 'secret');
fs.symlinkSync(path.join(root, 'out', 'secret.txt'), path.join(root, 'in', 'link'));
fs.symlinkSync(path.join(root, 'in', 'nowhere'), path.join(root, 'in', 'dangling'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const inDir = path.join(root, 'in');
const target = path.join(inDir, 'target.txt');
const link = path.join(inDir, 'link');
const dangling = path.join(inDir, 'dangling');
const realSecret = fs.realpathSync.native(path.join(root, 'out', 'secret.txt'));

// --- Fixture 2: lstat-failure fsImpl --------------------------------------------
function eioError() {
  return Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
}
const eio = (() => {
  const realpathSync = (p, ...rest) => {
    if (p === target) throw eioError();
    return fs.realpathSync(p, ...rest);
  };
  realpathSync.native = (p, ...rest) => {
    if (p === target) throw eioError();
    return fs.realpathSync.native(p, ...rest);
  };
  const lstatSync = (p, ...rest) => {
    if (p === target) throw eioError();
    return fs.lstatSync(p, ...rest);
  };
  return { ...fs, lstatSync, realpathSync };
})();

// --- Fixture 3: case-insensitive volume (posix-only fake, tests/helpers/case-insensitive-fs.js)
const vol = caseInsensitiveFs({
  '/Vol/Root': 'dir',
  '/Vol/Root/Notes.txt': 'file',
  '/Vol/Root/Sub': 'dir',
});

// --- Naive stand-ins (the hazard each case must catch) --------------------------
const naiveType = (p, { fsImpl = fs } = {}) => ({ type: fsImpl.existsSync(p) ? 'file' : 'missing', code: null });
const naiveRealpath = (p, { fsImpl = fs } = {}) => fsImpl.realpathSync(p);
const naiveLiteral = (p, { fsImpl = fs } = {}) => (fsImpl.existsSync(p) ? p : null);
const naiveLeaf = (p, { fsImpl = fs } = {}) => (
  fsImpl.existsSync(p) ? { state: 'resolved', path: p } : { state: 'missing', code: 'ENOENT' }
);
const naiveWithin = (p, r) => (
  isPathContained(path.resolve(p), path.resolve(r), { orEqual: true }) ? path.resolve(p) : null
);

// --- The table -------------------------------------------------------------------
const cases = [
  {
    id: 'lstatType symlinked leaf', primitive: lstatType, naive: naiveType,
    run: (fn) => assert.deepEqual(fn(link), { type: 'symlink', code: null }),
  },
  {
    id: 'lstatType dangling leaf', primitive: lstatType, naive: naiveType,
    run: (fn) => assert.deepEqual(fn(dangling), { type: 'symlink', code: null }),
  },
  {
    id: 'lstatType lstat failure', primitive: lstatType, naive: naiveType,
    run: (fn) => assert.deepEqual(fn(target, { fsImpl: eio }), { type: 'unreadable', code: 'EIO' }),
  },
  {
    id: 'lstatType mis-cased path', primitive: lstatType, naive: naiveType,
    run: (fn) => assert.deepEqual(fn('/vol/root/sub', { fsImpl: vol }), { type: 'directory', code: null }),
  },
  {
    id: 'canonicalRealpath symlinked leaf', primitive: canonicalRealpath, naive: naiveLiteral,
    run: (fn) => assert.equal(fn(link), realSecret),
  },
  {
    id: 'canonicalRealpath dangling leaf', primitive: canonicalRealpath, naive: naiveRealpath,
    run: (fn) => assert.equal(fn(dangling), null),
  },
  {
    id: 'canonicalRealpath lstat failure', primitive: canonicalRealpath, naive: naiveRealpath,
    run: (fn) => assert.equal(fn(target, { fsImpl: eio }), null),
  },
  {
    id: 'canonicalRealpath mis-cased path', primitive: canonicalRealpath, naive: naiveRealpath,
    run: (fn) => assert.equal(fn('/vol/root/notes.txt', { fsImpl: vol }), '/Vol/Root/Notes.txt'),
  },
  {
    id: 'resolveLeaf symlinked leaf', primitive: resolveLeaf, naive: naiveLeaf,
    run: (fn) => assert.deepEqual(fn(link), { state: 'resolved', path: realSecret }),
  },
  {
    id: 'resolveLeaf dangling leaf', primitive: resolveLeaf, naive: naiveLeaf,
    run: (fn) => assert.deepEqual(fn(dangling), { state: 'dangling' }),
  },
  {
    id: 'resolveLeaf lstat failure', primitive: resolveLeaf, naive: naiveLeaf,
    run: (fn) => assert.deepEqual(fn(target, { fsImpl: eio }), { state: 'unreadable', code: 'EIO' }),
  },
  {
    id: 'resolveLeaf mis-cased path', primitive: resolveLeaf, naive: naiveLeaf,
    run: (fn) => assert.deepEqual(
      fn('/vol/root/notes.txt', { fsImpl: vol }),
      { state: 'resolved', path: '/Vol/Root/Notes.txt' },
    ),
  },
  {
    id: 'resolveWithin symlinked leaf', primitive: resolveWithin, naive: naiveWithin,
    run: (fn) => assert.equal(fn(link, inDir), null), // link escapes in/
  },
  {
    id: 'resolveWithin dangling leaf', primitive: resolveWithin, naive: naiveWithin,
    run: (fn) => assert.equal(fn(dangling, inDir), null),
  },
  {
    id: 'resolveWithin lstat failure', primitive: resolveWithin, naive: naiveWithin,
    run: (fn) => assert.equal(fn(target, inDir, { fsImpl: eio }), null),
  },
  {
    id: 'resolveWithin mis-cased path', primitive: resolveWithin, naive: naiveWithin,
    run: (fn) => assert.equal(
      fn('/vol/root/notes.txt', '/Vol/Root', { fsImpl: vol, pathImpl: path.posix }),
      '/Vol/Root/Notes.txt',
    ),
  },
];

for (const { id, primitive, run, naive } of cases) {
  test(`AC1.1: ${id}`, () => run(primitive));
  test(`AC1.2: ${id} is red against ${naive.name}`, () => {
    assert.throws(() => run(naive));
  });
}

// --- Extra plain tests -------------------------------------------------------------
test('resolveLeaf on a non-existent path is missing/ENOENT', () => {
  assert.deepEqual(resolveLeaf(path.join(inDir, 'absent.txt')), { state: 'missing', code: 'ENOENT' });
});

test('resolveLeaf is unreadable/EIO when lstat succeeds on a file but realpath throws EIO', () => {
  const realpathSync = () => { throw eioError(); };
  realpathSync.native = () => { throw eioError(); };
  const fsImpl = { ...fs, realpathSync };
  assert.deepEqual(resolveLeaf(target, { fsImpl }), { state: 'unreadable', code: 'EIO' });
});

test('canonicalRealpath falls back to fsImpl.realpathSync when .native is absent', () => {
  const seen = [];
  const realpathSync = (p) => { seen.push(p); return '/fallback'; };
  assert.equal(canonicalRealpath('/x', { fsImpl: { realpathSync } }), '/fallback');
  assert.deepEqual(seen, ['/x']);
});

test('canonicalRealpath calls an injected realpath', () => {
  const seen = [];
  const realpath = (p) => { seen.push(p); return '/injected'; };
  assert.equal(canonicalRealpath('/x', { realpath }), '/injected');
  assert.deepEqual(seen, ['/x']);
});

test('canonicalRealpath fails closed (null) when fsImpl has no realpathSync at all', () => {
  assert.equal(canonicalRealpath('/x', { fsImpl: {} }), null);
});

test('resolveLeaf treats a missing realpathSync like a realpath failure and falls through to lstat classification', () => {
  const fsImpl = { lstatSync: fs.lstatSync };
  assert.deepEqual(resolveLeaf(target, { fsImpl }), { state: 'unreadable', code: 'EUNKNOWN' });
});

test('resolveWithin returns the resolved path for a real file inside the root, and for the root itself', () => {
  assert.equal(resolveWithin(target, inDir), fs.realpathSync.native(target));
  assert.equal(resolveWithin(inDir, inDir), fs.realpathSync.native(inDir));
});

test('resolveWithin is null when the root itself does not resolve', () => {
  assert.equal(resolveWithin(target, path.join(root, 'no-such-root')), null);
});

test('isAncestorOrSelf lexical cases (posix)', () => {
  const opts = { pathImpl: path.posix };
  assert.equal(isAncestorOrSelf('/a/b', '/a/b', opts), true);
  assert.equal(isAncestorOrSelf('/a/b', '/a/b/c', opts), true);
  assert.equal(isAncestorOrSelf('/a/b', '/a/bc', opts), false); // sibling prefix
  assert.equal(isAncestorOrSelf('/a', '/a/..foo', opts), true); // `..foo` is a child, not `..`
  assert.equal(isAncestorOrSelf('/a/b', '/a', opts), false); // the parent
});

test('isAncestorOrSelf lexical cases (win32)', () => {
  const opts = { pathImpl: path.win32 };
  assert.equal(isAncestorOrSelf('C:\\Repo', 'c:\\repo\\x', opts), true);
  assert.equal(isAncestorOrSelf('C:\\Repo', 'D:\\x', opts), false); // cross-drive
});

// Waived AC1.1 for isAncestorOrSelf: it is a pure string function that never
// touches the filesystem, so the four filesystem inputs (symlinked leaf,
// dangling leaf, lstat failure, mis-cased path) do not apply to it.
// resolveWithin carries them instead.
