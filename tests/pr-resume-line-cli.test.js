// tests/pr-resume-line-cli.test.js — in-process tests for bin/pr-resume-line.js's
// run(argv, deps), in tests/stale-claim-pr-cli.test.js's deps-injection style.
// pr-body.js's resumeVerdict has its own suite; this file pins the CLI's own
// decisions — one JSON line per verdict, a Resume line that parseResumeLine
// rejects never printed as `resume`, an unreadable body a failure verdict, and
// the exit code of each malformed invocation (#4659).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { run } = require('../plugin/bin/pr-resume-line');
const { composePrEarlyBody, composeResumeLine } = require('../plugin/bin/lib/flow/pr-body');

const RUN = '2026-10-31T005940-record-4659';
const DIR = `/repo/.claude-tweaks/pipelines/${RUN}`;
const BODY = '/scratch/body.md';
const RESUME = composeResumeLine({ runDir: DIR, target: '#4659', nextStep: 'review,polish,wrap-up' });

function composed(extra = {}) {
  return composePrEarlyBody({
    runId: RUN, specSummary: 's', target: '#4659', nextStep: 'review,polish,wrap-up', runDir: DIR, ...extra,
  });
}

function fakeDeps(files) {
  const calls = { readFile: [], stdout: [], stderr: [] };
  return {
    calls,
    readFile: (p) => {
      calls.readFile.push(p);
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
  };
}

const out = (deps) => deps.calls.stdout.join('');
const verdictOf = (deps) => JSON.parse(out(deps));
const ARGS = ['--body-file', BODY, '--run-id', RUN];

test('AC2.1: a Resume line containing ! yields resolve, never resume', () => {
  const deps = fakeDeps({ [BODY]: composed({ runDir: '/repo/a!b/.claude-tweaks/pipelines/' + RUN }) });
  assert.equal(run(ARGS, deps), 0);
  assert.equal(out(deps), '{"resolve":"resume-line-shape","failure":null}\n');
  assert.equal('resume' in verdictOf(deps), false);
});

test('a composed body yields resume, runDir, target and steps', () => {
  const deps = fakeDeps({ [BODY]: composed() });
  assert.equal(run(ARGS, deps), 0);
  const v = verdictOf(deps);
  assert.deepEqual(v, {
    resume: RESUME,
    runDir: DIR, target: '#4659', steps: 'review,polish,wrap-up', failure: null,
  });
  assert.deepEqual(Object.keys(v), ['resume', 'runDir', 'target', 'steps', 'failure']);
});

test('a body with no Resume heading yields no-resume-line', () => {
  const deps = fakeDeps({ [BODY]: `claude-tweaks-run: ${RUN}\n\n### Spec summary\n` });
  assert.equal(run(ARGS, deps), 0);
  assert.deepEqual(verdictOf(deps), { resolve: 'no-resume-line', failure: null });
});

test('an unreadable body file is a failure verdict, never resume', () => {
  const deps = fakeDeps({});
  assert.equal(run(['--body-file', '/missing', '--run-id', RUN], deps), 0);
  const v = verdictOf(deps);
  assert.equal(v.resolve, null);
  assert.match(v.failure, /ENOENT/);
  assert.equal('resume' in v, false);
});

test('malformed invocations exit 1 with usage on stderr and nothing on stdout', () => {
  const bad = [
    [],
    ['--run-id', RUN],
    ['--body-file', BODY],
    ['--body-file'],
    ['--body-file', '--run-id', RUN],
    ['--body-file', '', '--run-id', RUN],
    ['--body-file', BODY, '--run-id', '  '],
    ['--body-file', BODY, '--run-id', RUN, '--bogus'],
  ];
  for (const argv of bad) {
    const deps = fakeDeps({ [BODY]: composed() });
    assert.equal(run(argv, deps), 1, JSON.stringify(argv));
    assert.match(deps.calls.stderr.join(''), /usage: pr-resume-line\.js/, JSON.stringify(argv));
    assert.equal(out(deps), '', JSON.stringify(argv));
  }
});

test('a --run-id that fails RUN_ID_SHAPE is rejected before the body is read', () => {
  const bad = [
    'not-a-run-id',
    '2026-10-31T005940-Record-4659',
    '2026-10-31-record-4659',
    '../2026-10-31T005940-record-4659',
    `${RUN}\n`,
    `${RUN} `,
  ];
  for (const runId of bad) {
    const label = JSON.stringify(runId);
    const deps = fakeDeps({ [BODY]: composed() });
    assert.equal(run(['--body-file', BODY, '--run-id', runId], deps), 1, label);
    const err = deps.calls.stderr.join('');
    assert.ok(err.startsWith(`pr-resume-line.js: --run-id is not a valid run id: ${label}\n`), label);
    assert.match(err, /usage: pr-resume-line\.js/, label);
    assert.equal(out(deps), '', label);
    assert.equal(deps.calls.readFile.length, 0, label);
  }
});

test('the real process reads a real body file, and a missing one is a failure verdict', () => {
  const cli = path.join(__dirname, '..', 'plugin', 'bin', 'pr-resume-line.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-resume-line-'));
  try {
    const file = path.join(dir, 'body.md');
    fs.writeFileSync(file, composed());
    const ok = spawnSync(process.execPath, [cli, '--body-file', file, '--run-id', RUN], { encoding: 'utf8' });
    assert.equal(ok.status, 0);
    assert.equal(JSON.parse(ok.stdout).resume, RESUME);
    const missing = spawnSync(process.execPath, [cli, '--body-file', path.join(dir, 'missing.md'), '--run-id', RUN], { encoding: 'utf8' });
    assert.equal(missing.status, 0);
    const v = JSON.parse(missing.stdout);
    assert.equal(v.resolve, null);
    assert.match(v.failure, /ENOENT/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--help prints usage to stdout and reads nothing', () => {
  const deps = fakeDeps({ [BODY]: composed() });
  assert.equal(run(['--help'], deps), 0);
  assert.match(out(deps), /usage: pr-resume-line\.js/);
  assert.equal(deps.calls.readFile.length, 0);
});
