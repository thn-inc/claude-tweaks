'use strict';
// tests/compose-brainstorm-args-cli.test.js — in-process tests for
// bin/compose-brainstorm-args.js's run(argv, deps), mirroring
// tests/resolve-blockers-cli.test.js's deps-injection style (no real
// filesystem I/O; a fake readFile stands in for --input-file).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../plugin/bin/compose-brainstorm-args');
const { CONSOLIDATION_SENTENCE } = require('../plugin/bin/lib/specify/brainstorming-ceremony');

function fakeDeps(overrides = {}) {
  const calls = { stdout: [], stderr: [] };
  return {
    calls,
    readFile: () => 'a bare topic string',
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
    ...overrides,
  };
}

test('--help prints usage, exit 0', () => {
  const deps = fakeDeps();
  const code = run(['--help'], deps);
  assert.equal(code, 0);
  assert.match(deps.calls.stdout.join(''), /usage: compose-brainstorm-args\.js/);
});

test('missing --design-ceremony is malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['--input-file', 'x.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /missing --design-ceremony/);
});

test('missing --input-file is malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['--design-ceremony', 'standard'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /missing --input-file/);
});

test('unknown flag is malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['--bogus'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /unknown argument/);
});

test('an unreadable --input-file is malformed — exit 2', () => {
  const deps = fakeDeps({ readFile: () => { throw new Error('ENOENT: no such file'); } });
  const code = run(['--design-ceremony', 'standard', '--input-file', 'missing.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /could not read --input-file/);
});

test('fast-lane composes the consolidation sentence onto stdout, exit 0', () => {
  const deps = fakeDeps({ readFile: () => 'Record #142: some title\n\nSome body.' });
  const code = run(['--design-ceremony', 'fast-lane', '--input-file', 'spec.txt'], deps);
  assert.equal(code, 0);
  assert.equal(deps.calls.stdout.join(''), `${CONSOLIDATION_SENTENCE}\n\nRecord #142: some title\n\nSome body.`);
});

test('standard passes the input through byte-identical on stdout, exit 0', () => {
  const deps = fakeDeps({ readFile: () => 'a bare topic string' });
  const code = run(['--design-ceremony', 'standard', '--input-file', 'topic.txt'], deps);
  assert.equal(code, 0);
  assert.equal(deps.calls.stdout.join(''), 'a bare topic string');
});

test('an empty --input-file is malformed — exit 2', () => {
  const deps = fakeDeps({ readFile: () => '' });
  const code = run(['--design-ceremony', 'standard', '--input-file', 'empty.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /--input-file is empty or whitespace-only/);
  assert.equal(deps.calls.stdout.join(''), '');
});

test('a whitespace-only --input-file is malformed — exit 2', () => {
  const deps = fakeDeps({ readFile: () => '   \n\t  \n' });
  const code = run(['--design-ceremony', 'standard', '--input-file', 'blank.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /--input-file is empty or whitespace-only/);
  assert.equal(deps.calls.stdout.join(''), '');
});

test('an unrecognized --design-ceremony value warns on stderr but still passes through unchanged, exit 0', () => {
  const deps = fakeDeps({ readFile: () => 'a bare topic string' });
  const code = run(['--design-ceremony', 'bogus-value', '--input-file', 'topic.txt'], deps);
  assert.equal(code, 0);
  assert.equal(deps.calls.stdout.join(''), 'a bare topic string');
  assert.match(deps.calls.stderr.join(''), /warning/);
  assert.match(deps.calls.stderr.join(''), /bogus-value/);
});
