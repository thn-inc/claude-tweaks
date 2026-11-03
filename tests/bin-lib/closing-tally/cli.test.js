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
  assert.equal(envelope.line, '1 priority set · 0 Related updated · 0 granted · 0 flagged back · 0 dependency-repair · 0 needs-decision · 0 resolved · 0 skipped · 0 failed');
  assert.deepEqual(envelope.unclassified, []);
});

test('--run counts two Resolve-lane lines as 2 resolved with nothing unclassified (#4566, real input)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resolved-'));
  fs.writeFileSync(path.join(dir, 'decisions.md'), [
    '## /backlog',
    '- AUTO 05:53:50 — Backlog refine: Backlog refine: resolved decision on #3944 as keep (human-confirmed) — accepted the proposal: the flagged chain line describes this parent\'s sub-issue chain, not a blocker of #3944 — no dependency wire; needs:decision removed; live labels now priority:high. Reversibility: high (Resolved line and label are reversible).',
    '- AUTO 05:53:50 — Backlog refine: Backlog refine: resolved decision on #4456 as keep (human-confirmed) — stays ready as a human-run check; blocked in practice until #3977\'s draft PR #4445 merges (the report-only disposition pass is absent from main, so the dry-run prints no would-close lines yet); needs:decision removed; live labels now ready, priority:low. Reversibility: high (Resolved line and label are reversible).',
    '',
  ].join('\n'));
  const deps = fakeDeps();
  const code = run(['--run', dir], deps);
  assert.equal(code, 0);
  const envelope = JSON.parse(deps.out.join(''));
  assert.equal(envelope.counts.resolved, 2);
  assert.deepEqual(envelope.unclassified, []);
  assert.equal(envelope.line, '0 priority set · 0 Related updated · 0 granted · 0 flagged back · 0 dependency-repair · 0 needs-decision · 2 resolved · 0 skipped · 0 failed');
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
