// tests/helpers-git-fixtures.test.js — the shared fixture helpers are test
// infrastructure, but their spawns were unbounded (#134): no `timeout` option
// at all, so under contention a fixture could hang the suite instead of
// failing it. A hung suite reports nothing; a failed one names itself.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');

const HELPER = require.resolve('./helpers/git-fixtures');

// git-fixtures.js destructures execFileSync at module load, so the reference it
// calls is captured before any later patch to `cp.execFileSync` can land. To
// observe its spawns, the patch has to be installed FIRST and the helper then
// loaded fresh — hence the cache eviction on both sides.
function withPatchedExec(fake, fn) {
  const realExec = cp.execFileSync;
  delete require.cache[HELPER];
  cp.execFileSync = fake;
  try {
    return fn(require('./helpers/git-fixtures'));
  } finally {
    cp.execFileSync = realExec;
    delete require.cache[HELPER];
  }
}

test('every fixture git spawn carries a finite timeout', () => {
  // Asserts the bound REACHES the spawn, not merely that a constant is
  // exported — a constant nobody passes to execFileSync bounds nothing.
  const realExec = cp.execFileSync;
  const seen = [];
  const spy = (file, args, opts) => {
    seen.push(opts && opts.timeout);
    return realExec(file, args, opts);
  };
  withPatchedExec(spy, (helpers) => helpers.gitRepo());

  assert.ok(seen.length >= 2, `gitRepo should spawn git at least twice (init + commit), saw ${seen.length}`);
  for (const timeout of seen) {
    assert.strictEqual(typeof timeout, 'number', 'each fixture spawn must pass a numeric timeout');
    assert.ok(Number.isFinite(timeout) && timeout > 0, `timeout must be finite and positive, got ${timeout}`);
  }
});

test('FIXTURE_TIMEOUT_MS leaves real headroom over the worst fixture duration measured under load', () => {
  // #134 measured a single fixture spawn at 2884ms under three concurrent full
  // suites. The bound exists to convert a hang into an error, not to police
  // fixture speed, so it must sit well clear of legitimate slow runs.
  const { FIXTURE_TIMEOUT_MS } = require('./helpers/git-fixtures');
  const PEAK_MEASURED_MS = 2884;
  assert.ok(FIXTURE_TIMEOUT_MS >= PEAK_MEASURED_MS * 5,
    `${FIXTURE_TIMEOUT_MS}ms must be >=5x the ${PEAK_MEASURED_MS}ms peak measured under load`);
});

test('a fixture spawn that blows the bound throws a diagnosable error, not a bare ETIMEDOUT', () => {
  // The point of bounding these is diagnosis. A raw execFileSync timeout gives
  // a future reader an opaque failure naming neither the command nor the cause;
  // this asserts the wrapper explains itself.
  const boom = () => {
    const err = new Error('spawnSync git ETIMEDOUT');
    err.code = 'ETIMEDOUT';
    err.killed = true;
    throw err;
  };
  withPatchedExec(boom, (helpers) => {
    assert.throws(
      () => helpers.fixtureGit(['-C', '/tmp', 'status']),
      (err) => /git-fixtures/.test(err.message)
        && /exceeded \d+ms/.test(err.message)
        && /contended/.test(err.message),
      'the surfaced error must name the helper, the bound, and the likely cause',
    );
  });
});

test('a fixture spawn failing for a non-timeout reason rethrows unchanged', () => {
  // The wrapper must not swallow or relabel a genuine git error as contention —
  // that would be the same conflation #134 is about, one layer up.
  const original = new Error('fatal: not a git repository');
  original.code = 128;
  withPatchedExec(() => { throw original; }, (helpers) => {
    assert.throws(() => helpers.fixtureGit(['-C', '/tmp', 'status']), (err) => err === original);
  });
});

test('a fixture spawn killed for printing past its maxBuffer reports the overflow, not a timeout (#5227)', () => {
  // execFileSync kills a child that overflows maxBuffer with SIGTERM, so the timeout branch (which
  // keys on that signal) used to read it as contention. A real 1 MiB blob through a 1 KiB buffer
  // overflows while git is still writing, which is what sets the signal.
  const fs = require('fs');
  const { fixtureGit, gitRepo } = require('./helpers/git-fixtures');
  const repo = gitRepo();
  try {
    const sha = fixtureGit(['-C', repo, 'hash-object', '-w', '--stdin'], { input: 'x'.repeat(1024 * 1024), encoding: 'utf8' }).trim();
    assert.throws(
      () => fixtureGit(['-C', repo, 'cat-file', '-p', sha], { maxBuffer: 1024 }),
      (err) => err.code === 'ENOBUFS'
        && err.message === `git-fixtures: \`git -C ${repo} cat-file -p ${sha}\` printed more than its maxBuffer (1024 bytes) and was killed. Pass a larger maxBuffer for a real-sized output.`
        && err.cause.signal === 'SIGTERM',
      'the overflow names itself and keeps the spawn error as its cause',
    );
    const whole = fixtureGit(['-C', repo, 'cat-file', '-p', sha], { maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' });
    assert.strictEqual(whole.length, 1024 * 1024, 'a large enough buffer reads it (control)');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('fixtureGit leaves a spawn-level ENOBUFS (no signal: not a maxBuffer overflow) unrelabeled', () => {
  const { fixtureGit } = require('./helpers/git-fixtures');
  const spawnFailure = Object.assign(new Error('spawnSync git ENOBUFS'), { code: 'ENOBUFS' });
  assert.throws(
    () => fixtureGit(['status'], { execFileSync: () => { throw spawnFailure; } }),
    (err) => err === spawnFailure && !/maxBuffer/.test(err.message),
    'rethrown unchanged',
  );
});
