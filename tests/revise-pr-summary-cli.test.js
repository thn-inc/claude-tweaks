// tests/revise-pr-summary-cli.test.js — bin/revise-pr-summary.js (#3050).
// In-process via run(argv, deps), plus one real subprocess run against a
// temp run dir so the shipped invocation form is exercised end to end.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { run } = require('../plugin/bin/revise-pr-summary');
const { composePrEarlyBody } = require('../plugin/bin/lib/flow/pr-body');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'revise-pr-summary.js');
const BODY = composePrEarlyBody({ runId: 'r1', specSummary: 'Old mechanism.', target: '#3050', nextStep: 'build', fixesLines: ['Fixes #3050'] });
const REV = '- AUTO 09:35:19 — Spec Step 3: premise reversed: health endpoint → release tag. Reversibility: high.';

function fakeDeps(files, manifest = null) {
  const calls = { stdout: [], stderr: [] };
  return {
    calls, files,
    readFile: (p) => { if (!(p in files)) throw new Error(`ENOENT: ${p}`); return files[p]; },
    writeFile: (p, s) => { files[p] = s; },
    readManifest: () => manifest,
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
  };
}
const out = (deps) => JSON.parse(deps.calls.stdout[0]);

test('report mode: lists uncovered reversals, writes nothing', () => {
  const deps = fakeDeps({ '/rd/decisions.md': REV, '/b.md': BODY });
  assert.equal(run(['--run-dir', '/rd', '--body-file', '/b.md'], deps), 0);
  assert.deepEqual(out(deps), { reversals: 1, uncovered: ['health endpoint → release tag'], changed: false, reason: 'summary-required' });
  assert.deepEqual(Object.keys(deps.files).sort(), ['/b.md', '/rd/decisions.md']);
});

test('no decisions.md at all is fail-open: zero reversals, no-reversals', () => {
  const deps = fakeDeps({ '/b.md': BODY });
  assert.equal(run(['--run-dir', '/rd', '--body-file', '/b.md'], deps), 0);
  assert.equal(out(deps).reason, 'no-reversals');
});

test('apply mode writes the revised body to --out', () => {
  const deps = fakeDeps({ '/rd/decisions.md': REV, '/b.md': BODY, '/s.md': 'Reads the release tag.\n' });
  assert.equal(run(['--run-dir', '/rd', '--body-file', '/b.md', '--summary-file', '/s.md', '--out', '/o.md'], deps), 0);
  const o = out(deps);
  assert.equal(o.changed, true);
  assert.equal(o.out, '/o.md');
  assert.match(deps.files['/o.md'], /Revised during build: health endpoint → release tag\n\nReads the release tag\./);
});

test('apply mode with every reversal already noted writes nothing', () => {
  const noted = BODY.replace('Old mechanism.', 'Revised during build: health endpoint → release tag\n\nReads the release tag.');
  const deps = fakeDeps({ '/rd/decisions.md': REV, '/b.md': noted, '/s.md': 'x' });
  assert.equal(run(['--run-dir', '/rd', '--body-file', '/b.md', '--summary-file', '/s.md', '--out', '/o.md'], deps), 0);
  assert.equal(out(deps).reason, 'already-noted');
  assert.equal('/o.md' in deps.files, false);
});

test('bundle run reads every spec-{id}/decisions.md and unions them', () => {
  const deps = fakeDeps({
    '/rd/spec-1/decisions.md': REV,
    '/rd/spec-2/decisions.md': '- AUTO 10:00:00 — spec #2 — Spec Step 3: premise reversed: C → D. Reversibility: high.',
    '/rd/decisions.md': '- AUTO 10:00:00 — x: premise reversed: parent → ignored. Reversibility: high.',
    '/b.md': BODY,
  }, { multispec: { specs: [{ id: 1 }, { id: 2 }, { id: 3 }] } });
  assert.equal(run(['--run-dir', '/rd', '--body-file', '/b.md'], deps), 0);
  assert.deepEqual(out(deps).uncovered, ['health endpoint → release tag', 'C → D']);
});

test('malformed invocations exit 2 and write nothing', () => {
  const cases = [
    [],
    ['--run-dir', '/rd'],
    ['--body-file', '/b.md'],
    ['--run-dir', '/rd', '--body-file', '/b.md', '--summary-file', '/s.md'],
    ['--run-dir', '/rd', '--body-file', '/b.md', '--out', '/o.md'],
    ['--run-dir', '/rd', '--body-file', '/missing.md'],
    ['--run-dir', '/rd', '--body-file', '/b.md', '--bogus', 'x'],
    ['--run-dir', '--body-file', '/b.md'],
  ];
  for (const argv of cases) {
    const deps = fakeDeps({ '/b.md': BODY, '/s.md': 's' });
    assert.equal(run(argv, deps), 2, argv.join(' '));
    assert.equal('/o.md' in deps.files, false);
  }
});

test('an unreadable --summary-file or unwritable --out is exit 2', () => {
  const deps = fakeDeps({ '/rd/decisions.md': REV, '/b.md': BODY });
  assert.equal(run(['--run-dir', '/rd', '--body-file', '/b.md', '--summary-file', '/nope.md', '--out', '/o.md'], deps), 2);
  const deps2 = fakeDeps({ '/rd/decisions.md': REV, '/b.md': BODY, '/s.md': 'x' });
  deps2.writeFile = () => { throw new Error('EACCES'); };
  assert.equal(run(['--run-dir', '/rd', '--body-file', '/b.md', '--summary-file', '/s.md', '--out', '/o.md'], deps2), 2);
});

test('real subprocess: a temp single-record run dir is revised end to end', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revise-pr-summary-'));
  fs.writeFileSync(path.join(dir, 'decisions.md'), `${REV}\n`);
  fs.writeFileSync(path.join(dir, 'body.md'), BODY);
  fs.writeFileSync(path.join(dir, 'summary.md'), 'Reads the release tag.\n');
  const stdout = execFileSync(process.execPath, [CLI, '--run-dir', dir, '--body-file', path.join(dir, 'body.md'),
    '--summary-file', path.join(dir, 'summary.md'), '--out', path.join(dir, 'out.md')], { encoding: 'utf8' });
  assert.equal(JSON.parse(stdout).changed, true);
  assert.match(fs.readFileSync(path.join(dir, 'out.md'), 'utf8'), /Revised during build: health endpoint → release tag/);
  fs.rmSync(dir, { recursive: true, force: true });
});
