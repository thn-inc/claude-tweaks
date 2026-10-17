'use strict';

// path-guard — the one shared filesystem-containment primitive set (#3417).
//
// Three readers each hand-rolled the same four-part answer to "is this path
// really inside that root?" and drifted apart [IL-150], [IL-161]. The four
// inputs every one of them has to survive:
//   1. a symlinked leaf that escapes the root (lexical containment passes,
//      the real target is outside),
//   2. a dangling / looping symlink leaf (realpath throws; "missing" is the
//      wrong answer because the link itself exists),
//   3. an lstat/realpath failure that is not ENOENT (EIO, EACCES: unknown,
//      so fail closed rather than treat as absent),
//   4. a path whose casing differs from the on-disk casing.
//
// The realpath default is `fs.realpathSync.native`, NOT the JS `fs.realpathSync`:
// on a case-insensitive volume the JS form echoes the caller's input casing
// back, so two spellings of one file compare unequal and a containment check
// on them is wrong in both directions (#3380). `.native` asks the OS for the
// canonical casing. `fsImpl` and `realpath` are injectable so tests can model
// each of the four inputs without a real faulty volume.
//
// Every function is fail-closed: anything it cannot positively resolve is
// reported as not-resolved, never as a quiet success.

const fs = require('fs');
const path = require('path');

// lstat classification of the leaf itself (never follows a symlink).
function lstatType(p, { fsImpl = fs } = {}) {
  let st;
  try {
    st = fsImpl.lstatSync(p);
  } catch (err) {
    const code = err && err.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { type: 'missing', code };
    return { type: 'unreadable', code: code || 'EUNKNOWN' };
  }
  if (st.isSymbolicLink()) return { type: 'symlink', code: null };
  if (st.isFile()) return { type: 'file', code: null };
  if (st.isDirectory()) return { type: 'directory', code: null };
  return { type: 'other', code: null };
}

function defaultRealpath(fsImpl) {
  return fsImpl.realpathSync.native || fsImpl.realpathSync;
}

// Canonical (symlink-resolved, OS-cased) path, or null on any failure.
function canonicalRealpath(p, { fsImpl = fs, realpath } = {}) {
  try {
    const resolve = realpath || defaultRealpath(fsImpl);
    return resolve(p);
  } catch (_err) {
    return null;
  }
}

// Distinguishes the ways a leaf can fail to resolve. A symlink that realpath
// cannot resolve (dangling, looping, or unreadable target) is `dangling`; a
// leaf that exists but will not resolve is `unreadable`.
function resolveLeaf(p, { fsImpl = fs, realpath } = {}) {
  let realpathError;
  try {
    const resolve = realpath || defaultRealpath(fsImpl);
    return { state: 'resolved', path: resolve(p) };
  } catch (err) {
    realpathError = err;
  }
  const leaf = lstatType(p, { fsImpl });
  if (leaf.type === 'symlink') return { state: 'dangling' };
  if (leaf.type === 'missing') return { state: 'missing', code: leaf.code };
  if (leaf.type === 'unreadable') return { state: 'unreadable', code: leaf.code };
  return { state: 'unreadable', code: (realpathError && realpathError.code) || 'EUNKNOWN' };
}

// Pure and lexical, for already-canonical absolute paths.
function isAncestorOrSelf(ancestor, candidate, { pathImpl = path } = {}) {
  const rel = pathImpl.relative(ancestor, candidate);
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith('..' + pathImpl.sep) && !pathImpl.isAbsolute(rel);
}

// The leaf's resolved path when it really lies inside `root`, else null.
function resolveWithin(p, root, { fsImpl, realpath, pathImpl } = {}) {
  const rootReal = canonicalRealpath(root, { fsImpl, realpath });
  if (rootReal === null) return null;
  const leaf = resolveLeaf(p, { fsImpl, realpath });
  if (leaf.state !== 'resolved') return null;
  return isAncestorOrSelf(rootReal, leaf.path, { pathImpl }) ? leaf.path : null;
}

module.exports = { lstatType, canonicalRealpath, resolveLeaf, isAncestorOrSelf, resolveWithin };
