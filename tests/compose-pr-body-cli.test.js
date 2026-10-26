// tests/compose-pr-body-cli.test.js — bin/compose-pr-body.js, the PR-early
// draft-PR body writer (#3120). In-process via run(argv, deps), plus one real
// subprocess run so the Windows multi-line `node -e` failure it replaces is
// covered by the form Step 3 actually ships.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { run } = require('../plugin/bin/compose-pr-body');
const { composePrEarlyBody, composeExpressBody } = require('../plugin/bin/lib/flow/pr-body');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'compose-pr-body.js');
const BASE = ['--run-id', 'r1', '--target', '#12,#13', '--next-step', 'build', '--summary-file', '/s.md', '--fixes', '12,13', '--out', '/o.md'];

function fakeDeps(files = { '/s.md': 'A summary.\n' }) {
  const calls = { stdout: [], stderr: [] };
  return {
    calls, files,
    readFile: (p) => { if (!(p in files)) throw new Error(`ENOENT: ${p}`); return files[p]; },
    writeFile: (p, s) => { files[p] = s; },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
  };
}

test('writes exactly composePrEarlyBody\'s output, one Fixes line per --fixes number', () => {
  const deps = fakeDeps();
  assert.equal(run([...BASE, '--run-dir', '/rd'], deps), 0);
  assert.equal(deps.files['/o.md'], composePrEarlyBody({
    runId: 'r1', specSummary: 'A summary.', target: '#12,#13', nextStep: 'build',
    fixesLines: ['Fixes #12', 'Fixes #13'], runDir: '/rd',
  }));
  assert.equal(JSON.parse(deps.calls.stdout[0]).out, '/o.md');
});

test('every required flag missing is malformed — exit 2, nothing written', () => {
  for (const flag of ['--run-id', '--target', '--next-step', '--summary-file', '--fixes', '--out']) {
    const argv = [...BASE];
    argv.splice(argv.indexOf(flag), 2);
    const deps = fakeDeps();
    assert.equal(run(argv, deps), 2, flag);
    assert.match(deps.calls.stderr.join(''), new RegExp(`${flag} is required`));
    assert.equal(deps.files['/o.md'], undefined);
  }
});

test('--fixes rejects anything but record numbers (a leading # is tolerated)', () => {
  assert.equal(run(BASE.map((a) => (a === '12,13' ? '#12,#13' : a)), fakeDeps()), 0);
  const deps = fakeDeps();
  assert.equal(run(BASE.map((a) => (a === '12,13' ? '12,abc' : a)), deps), 2);
  assert.match(deps.calls.stderr.join(''), /--fixes must be record numbers/);
});

test('an unreadable --summary-file is exit 2 and writes nothing', () => {
  const deps = fakeDeps({});
  assert.equal(run(BASE, deps), 2);
  assert.match(deps.calls.stderr.join(''), /could not read --summary-file/);
  assert.equal(deps.files['/o.md'], undefined);
});

test('an unknown flag or a flag with no value is malformed — exit 2', () => {
  assert.equal(run([...BASE, '--bogus', 'x'], fakeDeps()), 2);
  assert.equal(run(['--run-id'], fakeDeps()), 2);
});

test('an empty or whitespace-only flag value is malformed — exit 2, nothing written', () => {
  for (const value of ['', '   ']) {
    const deps = fakeDeps();
    assert.equal(run([...BASE, '--run-dir', value], deps), 2, JSON.stringify(value));
    assert.match(deps.calls.stderr.join(''), /--run-dir needs a value/);
    assert.equal(deps.files['/o.md'], undefined);
  }
});

test('a bare inherited Object.prototype key is an unknown argument — exit 2', () => {
  for (const token of ['constructor', 'toString']) {
    const deps = fakeDeps();
    assert.equal(run([token, 'x'], deps), 2, token);
    assert.match(deps.calls.stderr.join(''), new RegExp(`unknown argument: ${token}`));
  }
});

test('#4025: --express writes composeExpressBody\'s output without --target or --next-step', () => {
  const deps = fakeDeps();
  assert.equal(run(['--express', '--run-id', 'r1', '--summary-file', '/s.md', '--fixes', '7', '--out', '/o.md'], deps), 0);
  assert.equal(deps.files['/o.md'], composeExpressBody({ runId: 'r1', specSummary: 'A summary.', fixesLines: ['Fixes #7'] }));
  assert.equal(JSON.parse(deps.calls.stdout[0]).out, '/o.md');
});

test('#4025: --express still requires --run-id, --summary-file, --fixes and --out', () => {
  const EXPRESS = ['--express', '--run-id', 'r1', '--summary-file', '/s.md', '--fixes', '7', '--out', '/o.md'];
  for (const flag of ['--run-id', '--summary-file', '--fixes', '--out']) {
    const argv = [...EXPRESS];
    argv.splice(argv.indexOf(flag), 2);
    const deps = fakeDeps();
    assert.equal(run(argv, deps), 2, flag);
    assert.match(deps.calls.stderr.join(''), new RegExp(`${flag} is required`));
    assert.equal(deps.files['/o.md'], undefined);
  }
});

test('#4025: --express takes no value — a following non-flag token is an unknown argument', () => {
  const deps = fakeDeps();
  assert.equal(run(['--express', 'foo', '--run-id', 'r1', '--summary-file', '/s.md', '--fixes', '7', '--out', '/o.md'], deps), 2);
  assert.match(deps.calls.stderr.join(''), /unknown argument: foo/);
  assert.equal(deps.files['/o.md'], undefined);
});

test('a real subprocess run writes a non-empty body starting with the run marker, and shell-hostile summary text arrives verbatim', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-pr-body-'));
  try {
    const summary = path.join(dir, 'summary.md');
    const out = path.join(dir, 'body.md');
    const hostile = 'Runs `$(whoami)` and "quotes" — $HOME stays literal.';
    fs.writeFileSync(summary, `${hostile}\n`);
    execFileSync(process.execPath, [CLI, '--run-id', '2026-10-11T000000-record-1', '--target', '#1', '--next-step', 'build',
      '--summary-file', summary, '--fixes', '1', '--out', out], { stdio: 'pipe' });
    const body = fs.readFileSync(out, 'utf8');
    assert.equal(body.split('\n')[0], '<!-- claude-tweaks-run: 2026-10-11T000000-record-1 -->');
    assert.ok(body.includes(hostile), body);
    assert.ok(body.includes('Fixes #1'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
