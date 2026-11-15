'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const { FINDING_LOCATION, readsLocation, parseCoincidence } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'finding-path'));

test('FINDING_LOCATION captures the path in group 1 and the line in group 2', () => {
  const m = new RegExp(FINDING_LOCATION).exec('see [src/a b.ts:4] here');
  assert.deepStrictEqual([m[1], m[2]], ['b.ts', '4']);
  assert.deepStrictEqual(new RegExp(FINDING_LOCATION).exec('at plugin/x.js:12').slice(1, 3), ['plugin/x.js', '12']);
});

test('readsLocation: true exactly when FINDING_PATH reads a {path}:{line}', () => {
  for (const text of ['src/a.js:4', 'a dir/x.ts:3 share a location', 'at [src/a.ts:4]']) assert.strictEqual(readsLocation(text), true, text);
  for (const text of ['src/a:9', ':46', 'x.ts', 'a.js: 4']) assert.strictEqual(readsLocation(text), false, text);
});

test('parseCoincidence: a quoted multi-word lens keys on its first token', () => {
  const text = 'Reproduction: lens "3f Test quality" findings tests/a.test.js:466 / tests/a.test.js:470 share a location but not substance';
  assert.deepStrictEqual(parseCoincidence(text), {
    lens: '3f', first: 'tests/a.test.js:466', second: 'tests/a.test.js:470 share a location', index: 14, length: 90,
  });
});

test('parseCoincidence: a bare lens, any case, and a location holding a space', () => {
  const co = parseCoincidence('Lens 3a Findings a dir/x.ts:3 / b dir/x.ts:3 Share a location');
  assert.deepStrictEqual([co.lens, co.first, co.second], ['3a', 'a dir/x.ts:3', 'b dir/x.ts:3 Share a location']);
});

test('parseCoincidence: index and length cut out exactly the clause', () => {
  const text = 'Reproduction: lens "3a" findings a/b.js:1 / a/b.js:2 share a location but not substance';
  const co = parseCoincidence(text);
  assert.strictEqual(text.slice(co.index, co.index + co.length), 'lens "3a" findings a/b.js:1 / a/b.js:2 share a location');
});

test('parseCoincidence: null when no coincidence clause is present', () => {
  for (const text of [
    'Reproduction: lens "3a" finding a/b.js:1 not reproduced',
    'Reproduction: lens "" findings a/b.js:1 / a/b.js:2 share a location',
    'Reproduction: lens "3a" findings a/b.js:1 / a/b.js:2 not reproduced',
  ]) assert.strictEqual(parseCoincidence(text), null, text);
});

test('parseCoincidence: a location never spans a second finding', () => {
  const co = parseCoincidence('lens "3a" findings a/b.js:1, a/b.js:2 / a/b.js:3 share a location');
  assert.strictEqual(co, null);
});
