// Not a `*.test.js` on purpose: the real suite must never collect this. tests/test-impact-tracer.test.js
// copies this fixture project into a temp root (renaming `*.fixture.js` to `*.test.js`) and runs
// `node --test` there under tools/test-impact/tracer.js, then reads back what each test file read (#4024).
// The async forms of what a.fixture.js and b.fixture.js do synchronously: callback and promise fs calls,
// and an async `spawn` / callback `exec` of a non-node child.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { spawn, exec } = require('child_process');

test('callback readFile and readdir', (t, done) => {
  fs.readFile('docs/async-read.md', 'utf8', (err, text) => {
    assert.ifError(err);
    assert.match(text, /async/);
    fs.readdir('docs/async-list', (err2, names) => {
      assert.ifError(err2);
      assert.deepStrictEqual(names, ['item.md']);
      done();
    });
  });
});

test('fs.promises readFile and readdir', async () => {
  assert.match(await fs.promises.readFile('docs/async-promise.md', 'utf8'), /promise/);
  assert.deepStrictEqual(await fs.promises.readdir('docs/promise-list'), ['item.md']);
});

test('async spawn and callback exec of a non-node child', { skip: process.platform === 'win32' && 'win32: no cat' }, async () => {
  await new Promise((resolve, reject) => {
    const child = spawn('cat', ['docs/async-spawn.md'], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', resolve);
  });
  await new Promise((resolve, reject) => {
    exec('cat docs/async-exec.md', { stdio: 'ignore' }, (err) => (err ? reject(err) : resolve()));
  });
});
