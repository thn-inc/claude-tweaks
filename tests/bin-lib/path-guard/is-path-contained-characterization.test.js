'use strict';

// Characterization of shared-primitives' isPathContained after it was made a
// thin strict/`orEqual` wrapper over path-guard's isAncestorOrSelf (#3498).
//
// Callers inheriting the change: pre-tool-use.js x2, worktree-reap.js x2,
// reap-merged.js x2, release-bootstrap.js x2, load-delta.js x2,
// skill-load-report.js x1, plus the four hand-rolled sites #3498 migrates.
// Every caller passes realpath / path.resolve'd paths, so on posix the only
// caller-visible differences are the `/` root and unnormalized input; on win32
// hosts, casing and drive. `pathImpl` is passed explicitly (path.posix /
// path.win32) so this file is host-independent.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isPathContained } = require('../../../plugin/bin/lib/shared-primitives');

const P = { pathImpl: path.posix };
const W = { pathImpl: path.win32 };

// Intended changes — each red against the pre-delegation startsWith implementation:
test('AC2.1: a ".." traversal segment no longer reads as contained', () => {
  assert.equal(isPathContained('/a/b/../../etc', '/a', P), false);
});

test('AC2.1: a root with a trailing separator contains its children', () => {
  assert.equal(isPathContained('/a/b', '/a/', P), true);
  assert.equal(isPathContained('/a/', '/a', P), false); // still strict: same directory
});

test('AC2.1: the filesystem root contains every absolute path', () => {
  assert.equal(isPathContained('/x', '/', P), true);
});

test('AC2.1: win32 compares case-insensitively and across drives', () => {
  assert.equal(isPathContained('c:\\repo\\x', 'C:\\Repo', W), true);
  assert.equal(isPathContained('D:\\Repo\\x', 'C:\\Repo', W), false);
  assert.equal(isPathContained('c:\\repo', 'C:\\Repo', W), false);
  assert.equal(isPathContained('c:\\repo', 'C:\\Repo', { ...W, orEqual: true }), true);
});

// Invariants — green before and after:
test('AC2.1: unchanged — a "..foo" child is contained, a prefix sibling is not', () => {
  assert.equal(isPathContained('/a/..foo', '/a', P), true);
  assert.equal(isPathContained('/a/bee', '/a/b', P), false);
  assert.equal(isPathContained('/a', '/a', P), false);
  assert.equal(isPathContained('/a', '/a', { ...P, orEqual: true }), true);
  assert.equal(isPathContained('/a/b', '/a/b/c', P), false); // the parent
});

test('AC1.1: isPathContained has no containment logic of its own — it delegates to path-guard', () => {
  const src = fs.readFileSync(require.resolve('../../../plugin/bin/lib/shared-primitives'), 'utf8');
  const body = src.slice(src.indexOf('function isPathContained'), src.indexOf('\n}\n', src.indexOf('function isPathContained')));
  assert.match(src, /require\('\.\/path-guard'\)/);
  assert.match(body, /isAncestorOrSelf\(/);
  assert.doesNotMatch(body, /startsWith/);
});

// Not a pure string comparison: path.relative resolves a relative argument
// against process.cwd(), so callers must pass absolute, resolved paths.
test('AC2.1: a relative candidate resolves against process.cwd() (callers pass absolute paths)', () => {
  assert.equal(isPathContained('x', process.cwd()), true);
  assert.equal(isPathContained(path.join(process.cwd(), 'x'), process.cwd()), true);
});
