// Not a `*.test.js` on purpose: the real suite must never collect this. tests/test-impact-tracer.test.js
// copies this fixture project into a temp root (renaming `*.fixture.js` to `*.test.js`) and runs
// `node --test` there under tools/test-impact/tracer.js, then reads back what each test file read (#4024).
// The require shapes a.fixture.js does not cover: require.resolve with a `paths` option, a directory
// require through package.json `main`, bare specifiers through node_modules (`main` and `exports`), and
// the exact requests `.` / `..` with a `paths` option.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('require.resolve with paths resolves against each path', () => {
  assert.strictEqual(require.resolve('./x', { paths: [path.join(__dirname, 'lib')] }), path.join(__dirname, 'lib', 'x.js'));
});

test('a directory require reads its package.json main', () => {
  assert.strictEqual(require('./lib/pkg').name, 'pkg-entry');
});

test('a bare specifier resolves through node_modules main and exports', () => {
  assert.strictEqual(require.resolve('dep', { paths: [__dirname] }), path.join(__dirname, 'node_modules', 'dep', 'lib', 'main.js'));
  assert.strictEqual(require.resolve('exp', { paths: [__dirname] }), path.join(__dirname, 'node_modules', 'exp', 'src', 'index.js'));
});

test('a scoped package resolves through an exports subpath', () => {
  assert.strictEqual(require.resolve('@sc/pkg/sub', { paths: [__dirname] }), path.join(__dirname, 'node_modules', '@sc', 'pkg', 's.js'));
});

// Node 22 counts the exact request '.' as relative (the given paths are the lookup dirs); Node 20 does not
// (it derives them from a parentless module), so only the tracer's records are pinned, not the result.
test('require.resolve of . with paths', () => {
  try {
    require.resolve('.', { paths: [path.join(__dirname, 'lib', 'dotpkg')] });
  } catch (_) {
    // resolved against the cwd instead, on a Node that does not count '.' as relative
  }
});

test('a require that does not resolve', () => {
  assert.throws(() => require.resolve('./lib/missing'), { code: 'MODULE_NOT_FOUND' });
});

test('a bare specifier with no package.json does not resolve', () => {
  assert.throws(() => require.resolve('nodep/sub', { paths: [__dirname] }), { code: 'MODULE_NOT_FOUND' });
});
