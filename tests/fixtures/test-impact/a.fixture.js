// Not a `*.test.js` on purpose: the real suite must never collect this. tests/test-impact-tracer.test.js
// copies this fixture project into a temp root (renaming `*.fixture.js` to `*.test.js`) and runs
// `node --test` there under tools/test-impact/tracer.js, then reads back what each test file read (#4024).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { execFileSync } = require('child_process');
const x = require('./lib/x.js');

test('module load and file read', () => {
  assert.strictEqual(x.name, 'x');
  assert.match(fs.readFileSync('docs/note.md', 'utf8'), /note/);
});

test('readdir, exists and stat', () => {
  assert.deepStrictEqual(fs.readdirSync('docs/listed'), ['item.md']);
  assert.strictEqual(fs.existsSync('docs/probe.md'), true);
  assert.strictEqual(fs.existsSync('.git/HEAD'), true);
  assert.ok(fs.statSync('docs/stat.md').isFile());
});

test('git content command without a path argument', () => {
  execFileSync('git', ['ls-files'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
});
