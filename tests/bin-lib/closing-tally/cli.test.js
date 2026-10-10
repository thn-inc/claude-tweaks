'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/closing-tally');

function fakeDeps() {
  const out = []; const err = [];
  return {
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    readFile: fs.readFileSync.bind(fs),
    out,
    err,
  };
}

test('--file reads a fixture and prints the JSON envelope with counts, line, and unclassified', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-'));
  const file = path.join(dir, 'decisions.md');
  fs.writeFileSync(file, '## /backlog\n- AUTO 10:00:00 — Backlog refine: set priority:high on #1.\n');
  const deps = fakeDeps();
  const code = run(['--file', file], deps);
  assert.equal(code, 0);
  const envelope = JSON.parse(deps.out.join(''));
  assert.equal(envelope.counts.priority, 1);
  assert.equal(envelope.line, '1 priority set · 0 Related updated · 0 granted · 0 flagged back · 0 dependency-repair · 0 needs-decision · 0 skipped · 0 failed');
  assert.deepEqual(envelope.unclassified, []);
});

test('--run reads {dir}/decisions.md', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-run-'));
  fs.writeFileSync(path.join(dir, 'decisions.md'), '## /backlog\n- AUTO 10:00:00 — Backlog refine: flagged back #7 — needs scoring.\n');
  const deps = fakeDeps();
  const code = run(['--run', dir], deps);
  assert.equal(code, 0);
  const envelope = JSON.parse(deps.out.join(''));
  assert.equal(envelope.counts.flaggedBack, 1);
});

test('exits 2 when neither --run nor --file is given, or both are', () => {
  const deps1 = fakeDeps();
  assert.equal(run([], deps1), 2);
  const deps2 = fakeDeps();
  assert.equal(run(['--run', 'a', '--file', 'b'], deps2), 2);
});

test('exits 2 on an unknown argument', () => {
  const deps = fakeDeps();
  assert.equal(run(['--bogus'], deps), 2);
});

test('exits 3 when the target file does not exist', () => {
  const deps = fakeDeps();
  const code = run(['--file', '/nonexistent/decisions.md'], deps);
  assert.equal(code, 3);
  assert.match(deps.err.join(''), /could not read/);
});

test('--help prints usage and exits 0', () => {
  const deps = fakeDeps();
  const code = run(['--help'], deps);
  assert.equal(code, 0);
  assert.match(deps.out.join(''), /usage: closing-tally\.js/);
});
