// Not a `*.test.js` on purpose: the real suite must never collect this. tests/test-impact-tracer.test.js
// copies this fixture project into a temp root (renaming `*.fixture.js` to `*.test.js`) and runs
// `node --test` there under tools/test-impact/tracer.js, then reads back what each test file read (#4024).
// Every git call here must record something narrower than the root prefix: this file records no `c ''`.
'use strict';
const { test } = require('node:test');
const path = require('path');
const { execFileSync } = require('child_process');

const quiet = (cwd) => ({ cwd, stdio: ['ignore', 'pipe', 'pipe'] });
const skip = { skip: process.platform === 'win32' && 'win32: no bash/sh/env' };

test('bash -o pipefail -c', skip, () => {
  execFileSync('bash', ['-o', 'pipefail', '-c', 'git ls-files'], quiet(path.join(__dirname, 'docs', 'async-list')));
});

test('bash -euo pipefail -c', skip, () => {
  execFileSync('bash', ['-euo', 'pipefail', '-c', 'git ls-files'], quiet(path.join(__dirname, 'docs', 'promise-list')));
});

test('sh +e -c', skip, () => {
  execFileSync('sh', ['+e', '-c', 'git ls-files'], quiet(path.join(__dirname, 'docs', 'copied')));
});

test('env VAR=value cmd', skip, () => {
  execFileSync('env', ['FOO=1', 'git', 'ls-files'], quiet(path.join(__dirname, 'tools')));
});

test('env -u NAME cmd', skip, () => {
  execFileSync('env', ['-u', 'FOO', 'git', 'ls-files'], quiet(path.join(__dirname, 'bin')));
});
