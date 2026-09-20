'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/render-tidy-report');
const { lintReport } = require('../../../plugin/bin/lib/tidy-report-lint/rules');

function tmpRunDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rtr-cli-'));
}

function writeSidecar(runDir, name, items) {
  const stagedDir = path.join(runDir, 'staged');
  fs.mkdirSync(stagedDir, { recursive: true });
  fs.writeFileSync(path.join(stagedDir, name), JSON.stringify(items));
}

function fakeDeps() {
  const out = [];
  const err = [];
  return {
    deps: {
      collectStagedItems: require('../../../plugin/bin/lib/render-tidy-report/render').collectStagedItems,
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    },
    out,
    err,
  };
}

test('cli: --help prints usage and exits 0', () => {
  const { deps, out } = fakeDeps();
  const code = run(['--help'], deps);
  assert.equal(code, 0);
  assert.match(out.join(''), /usage: render-tidy-report\.js/);
});

test('cli: missing --run is a malformed invocation (exit 2)', () => {
  const { deps, err } = fakeDeps();
  const code = run([], deps);
  assert.equal(code, 2);
  assert.match(err.join(''), /--run <run-dir> is required/);
});

test('cli: unknown flag is a malformed invocation (exit 2)', () => {
  const { deps, err } = fakeDeps();
  const code = run(['--run', '/tmp/x', '--bogus'], deps);
  assert.equal(code, 2);
  assert.match(err.join(''), /unknown argument/);
});

test('cli: no staged/ directory prints nothing and exits 0', () => {
  const runDir = tmpRunDir();
  const { deps, out } = fakeDeps();
  const code = run(['--run', runDir], deps);
  assert.equal(code, 0);
  assert.equal(out.join(''), '');
});

test('cli: renders the Approve section verbatim to stdout', () => {
  const runDir = tmpRunDir();
  writeSidecar(runDir, 'a.json', [
    { tag: 'claim', record: 1982, title: 'Stale build claim', action: 'Release the stale claim', command: 'node bin/release-claim.js 1982 --sweep' },
  ]);
  const { deps, out } = fakeDeps();
  const code = run(['--run', runDir], deps);
  assert.equal(code, 0);
  const printed = out.join('');
  assert.match(printed, /^\*\*Approve \(1\)\*\*\n```text\n/);
  assert.match(printed, /1 {2}\[claim\] {2}#1982 {2}Stale build claim/);
});

test('cli: a corrupt staged/*.json sidecar fails the render (exit 3), never silently drops items', () => {
  const runDir = tmpRunDir();
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'staged', 'bad.json'), 'not json');
  const { deps, err } = fakeDeps();
  const code = run(['--run', runDir], deps);
  assert.equal(code, 3);
  assert.match(err.join(''), /not valid JSON/);
});

test('renderer output embedded in a full report still passes tidy-report-lint.js --surface=condensed', () => {
  const runDir = tmpRunDir();
  writeSidecar(runDir, 'a.json', [
    { tag: 'claim', record: 1135, title: 'stale issue claim', action: 'Release — reconcile flagged it', command: 'node bin/release-claim.js 1135 --sweep --reason "swept: stale claim"' },
    { tag: 'git', record: null, title: 'Merged remote branch not yet pruned', action: 'Delete the merged, un-pruned remote branch', command: 'git push origin --delete worktree-record-example' },
  ]);
  const { deps, out } = fakeDeps();
  const code = run(['--run', runDir], deps);
  assert.equal(code, 0);
  const approveSection = out.join('');

  const report = [
    '## Tidy Report — 2026-09-20',
    '',
    '**Applied automatically**',
    '```text',
    'removed        —    3 stale worktrees                                                          high',
    '```',
    '',
    approveSection.trimEnd(),
    '',
    '**Clean:**',
    '```text',
    'backlog                                       12 checked',
    '```',
    '',
    'Full decision log: .claude-tweaks/pipelines/2026-09-20T000000-tidy-standalone/decisions.md',
    '',
  ].join('\n');

  const issues = lintReport(report, { surface: 'condensed' });
  assert.deepEqual(issues, []);
});
