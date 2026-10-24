// Not a `*.test.js` on purpose: the real suite must never collect this. tests/test-impact-tracer.test.js
// copies this fixture project into a temp root (renaming `*.fixture.js` to `*.test.js`) and runs
// `node --test` there under tools/test-impact/tracer.js, then reads back what each test file read (#4024).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const x = require('./lib/x');

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

test('recursive copy of a directory', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-copied-'));
  try {
    fs.cpSync('docs/copied', path.join(dest, 'out'), { recursive: true });
    assert.strictEqual(fs.readFileSync(path.join(dest, 'out', 'inner.md'), 'utf8'), 'copied\n');
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('git content command without a path argument', () => {
  execFileSync('git', ['ls-files'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
});
