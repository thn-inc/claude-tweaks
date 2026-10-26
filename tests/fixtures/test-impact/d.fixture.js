// Not a `*.test.js` on purpose: the real suite must never collect this. tests/test-impact-tracer.test.js
// copies this fixture project into a temp root (renaming `*.fixture.js` to `*.test.js`) and runs
// `node --test` there under tools/test-impact/tracer.js, then reads back what each test file read (#4024).
// Every git call here must record something narrower than the root prefix: this file records no `c ''`.
'use strict';
const { test } = require('node:test');
const path = require('path');
const { execFileSync, execSync, spawnSync } = require('child_process');

const quiet = (cwd) => ({ cwd, stdio: ['ignore', 'pipe', 'pipe'] });

test('git glob and magic pathspecs', () => {
  execFileSync('git', ['ls-files', '--', '*.md'], quiet(path.join(__dirname, 'docs', 'listed')));
  execFileSync('git', ['ls-files', '--', ':(glob)docs/*/x.md'], quiet(__dirname));
});

// Nothing is tracked in the fixture repo, so grep exits 1 (no match): the status is not the point.
test('git grep with a pathspec after --', () => {
  spawnSync('git', ['grep', 'TODO', '--', 'tools'], { cwd: __dirname, stdio: 'ignore' });
});

test('git non-content subcommand with -C', () => {
  execFileSync('git', ['-C', __dirname, 'rev-parse', '--show-toplevel'], quiet(__dirname));
});

// cmd.exe has no `NAME=value` prefix, so on win32 the command itself fails. The tracer reads the string
// before the child runs, so the record is the same there and only the command's status differs (#4134).
test('shell string with an env-assignment prefix', () => {
  try {
    execSync('FOO=1 git ls-files', quiet(path.join(__dirname, 'bin')));
  } catch (err) {
    if (process.platform !== 'win32') throw err;
  }
});

test('sh -c script', { skip: process.platform === 'win32' && 'win32: no sh' }, () => {
  execFileSync('sh', ['-c', 'git ls-files'], quiet(path.join(__dirname, 'lib')));
});
