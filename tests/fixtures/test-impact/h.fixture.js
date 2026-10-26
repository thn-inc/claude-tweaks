// Not a `*.test.js` on purpose: the real suite must never collect this. tests/test-impact-tracer.test.js
// copies this fixture project into a temp root (renaming `*.fixture.js` to `*.test.js`) and runs
// `node --test` there under tools/test-impact/tracer.js, then reads back what each test file read (#4024).
// Every git call here must record something narrower than the root prefix: this file records no `c ''`
// (the node children whose env drops the trace, which do, are in i.fixture.js).
'use strict';
const { test } = require('node:test');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

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

// `env -C <dir>` runs its command in <dir>: the directory is read like a non-node child's path argument.
// macOS's env has no -C, so the status is ignored: the tracer records before the spawn, and `ls` runs nowhere.
test('env -C dir cmd', skip, () => {
  spawnSync('env', ['-C', 'docs/listed', 'ls'], quiet(__dirname));
});

// `env --chdir=<dir>` is the long form of -C (same macOS caveat, same ignored status).
test('env --chdir=dir cmd', skip, () => {
  spawnSync('env', ['--chdir=lib', 'ls'], quiet(__dirname));
});

// `--` ends env's options, so the command after it is still read.
test('env -- cmd', skip, () => {
  execFileSync('env', ['--', 'git', 'ls-files'], quiet(path.join(__dirname, 'docs')));
});

// `-uNAME` is -u with its value attached; FOO is not a trace variable, so the command is read the same way.
test('env -uNAME cmd', skip, () => {
  execFileSync('env', ['-uFOO', 'git', 'ls-files'], quiet(path.join(__dirname, 'lib', 'pkg')));
});

// Unsetting a variable that does not carry the trace leaves a node child self-tracing: no fail-closed `c ''`.
test('env -u FOO node', skip, () => {
  execFileSync('env', ['-u', 'FOO', process.execPath, '-e', '0'], quiet(__dirname));
});
