// Not a `*.test.js` on purpose: the real suite must never collect this. tests/test-impact-tracer.test.js
// copies this fixture project into a temp root (renaming `*.fixture.js` to `*.test.js`) and runs
// `node --test` there under tools/test-impact/tracer.js, then reads back what each test file read (#4024).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { once } = require('node:events');
const { spawnSync, fork, execFileSync } = require('child_process');

// A clean, explicit env: no NODE_OPTIONS, so only the tracer's env injection can trace the child.
const cleanEnv = () => ({ PATH: process.env.PATH });

test('child spawned with an explicit env', () => {
  const r = spawnSync(process.execPath, ['bin/child.js', 'lib/y.js'], { env: cleanEnv(), encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
});

test('child forked with an explicit env', async () => {
  const child = fork('bin/child.js', ['docs/forked.md'], { env: cleanEnv(), stdio: 'ignore' });
  const [code] = await once(child, 'exit');
  assert.strictEqual(code, 0);
});

test('git content command with a path argument', () => {
  execFileSync('git', ['ls-files', 'lib'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
});

test('non-node child with path arguments', { skip: process.platform === 'win32' && 'win32: no ls' }, () => {
  execFileSync('ls', ['docs/listed', 'docs/ls-target.md'], { stdio: ['ignore', 'pipe', 'pipe'] });
});
