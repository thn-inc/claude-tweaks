// Not a `*.test.js` on purpose: the real suite must never collect this. tests/test-impact-tracer.test.js
// copies this fixture project into a temp root (renaming `*.fixture.js` to `*.test.js`) and runs
// `node --test` there under tools/test-impact/tracer.js, then reads back what each test file read (#4024).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const { execFile } = require('child_process');

test('promisified execFile resolves stdout', async () => {
  const r = await util.promisify(execFile)(process.execPath, ['-e', 'console.log(1)']);
  assert.strictEqual(r.stdout, '1\n');
});

// The promisified form goes through execFile's promisify.custom, which calls the unwrapped original —
// these two calls are only visible if the tracer wrapped that custom implementation too.
test('promisified execFile children and git calls are traced', async () => {
  const run = util.promisify(execFile);
  await run(process.execPath, ['bin/child.js', 'docs/promisified.md'], { env: { PATH: process.env.PATH } });
  await run('git', ['ls-files', 'docs'], { cwd: __dirname });
});

// Node caches the cwd until the next chdir: a tracer that called process.cwd() between the chdir and
// the delete would cache it, and the final process.cwd() would then answer instead of throwing.
test('deleted cwd still throws', { skip: process.platform === 'win32' && 'win32: a process cwd cannot be removed' }, () => {
  const origCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-trace-cwd-'));
  try {
    process.chdir(tmp);
    fs.statSync(__filename);
    assert.throws(() => fs.statSync('missing-relative'), { code: 'ENOENT' });
    fs.rmSync(tmp, { recursive: true });
    fs.statSync(__filename);
    assert.throws(() => fs.statSync('missing-relative'), { code: 'ENOENT' });
    assert.throws(() => process.cwd(), 'the fixture must have produced a deleted cwd');
  } finally {
    process.chdir(origCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// The two files are created by the outer test (a newline or tab cannot live in a Windows checkout).
test('paths with a newline and a tab', { skip: process.platform === 'win32' && 'win32: no newline or tab in a file name' }, () => {
  assert.strictEqual(fs.readFileSync(path.join(__dirname, 'docs', 'we\nird.md'), 'utf8'), 'newline\n');
  assert.strictEqual(fs.readFileSync(path.join(__dirname, 'docs', 'ta\tb.md'), 'utf8'), 'tab\n');
});
