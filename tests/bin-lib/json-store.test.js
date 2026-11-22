'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readJsonFile, writeJsonFile } = require('../../plugin/bin/lib/json-store');

test('readJsonFile: returns the parsed value when the file exists and is valid JSON', () => {
  const readFile = () => '{"a":1}';
  assert.deepEqual(readJsonFile('/x/store.json', { readFile }), { a: 1 });
});

test('readJsonFile: missing file (ENOENT) -> fallback, no throw', () => {
  const readFile = () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; };
  assert.deepEqual(readJsonFile('/x/store.json', { readFile, fallback: {} }), {});
});

test('readJsonFile: corrupt JSON -> fallback, no throw', () => {
  const readFile = () => '{ not json';
  assert.equal(readJsonFile('/x/store.json', { readFile, fallback: null }), null);
});

test('readJsonFile: default fallback is null when omitted', () => {
  const readFile = () => { throw new Error('boom'); };
  assert.equal(readJsonFile('/x/store.json', { readFile }), null);
});

test('writeJsonFile: creates the containing directory, writes to a tmp path, then atomically renames over the real path', () => {
  const mkdirCalls = [];
  const writeCalls = [];
  const renameCalls = [];
  const mkdirSync = (p, opts) => mkdirCalls.push({ p, opts });
  const writeFile = (p, content) => writeCalls.push({ p, content });
  const rename = (from, to) => renameCalls.push({ from, to });

  writeJsonFile('/x/y/store.json', { a: 1 }, {
    mkdirSync, writeFile, rename,
  });

  assert.equal(mkdirCalls.length, 1);
  assert.equal(mkdirCalls[0].p, '/x/y');
  assert.deepEqual(mkdirCalls[0].opts, { recursive: true });
  assert.equal(writeCalls.length, 1);
  assert.notEqual(writeCalls[0].p, '/x/y/store.json', 'writes to a tmp path, not the final path directly');
  assert.deepEqual(JSON.parse(writeCalls[0].content), { a: 1 });
  assert.equal(renameCalls.length, 1);
  assert.equal(renameCalls[0].from, writeCalls[0].p);
  assert.equal(renameCalls[0].to, '/x/y/store.json');
});

test('writeJsonFile: the tmp path is derived from the real path and pid-suffixed (two same-process calls reuse one name)', () => {
  const writes = [];
  const mkdirSync = () => {};
  const writeFile = (p) => writes.push(p);
  const rename = () => {};
  writeJsonFile('/x/store.json', { a: 1 }, { mkdirSync, writeFile, rename });
  writeJsonFile('/x/store.json', { a: 2 }, { mkdirSync, writeFile, rename });
  // Same pid within one process -> same tmp name is fine (rename is atomic per call and the two
  // calls are sequential here); this pins that the tmp path is derived from the real path, not hardcoded.
  assert.ok(writes[0].startsWith(path.join('/x', 'store.json.tmp-')));
  assert.equal(writes[0], writes[1]);
});

test('writeJsonFile: propagates a real write failure to the caller rather than swallowing it', () => {
  const mkdirSync = () => {};
  const writeFile = () => { throw new Error('ENOSPC: no space left on device'); };
  const rename = () => {};
  assert.throws(() => writeJsonFile('/x/store.json', {}, { mkdirSync, writeFile, rename }), /ENOSPC/);
});
