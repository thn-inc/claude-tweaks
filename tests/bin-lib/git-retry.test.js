'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withIndexLockRetry, isIndexLockFailure } = require('../../plugin/bin/lib/git-retry');

const LOCK_ERR_MSG = "fatal: Unable to create '/repo/.git/index.lock': File exists.";

function fakeSleep(calls) {
  return (ms) => calls.push(ms);
}

// #2346 AC1 — retries only on the index.lock signature, both directions.
test('withIndexLockRetry: a throwing runner failing on index.lock twice then succeeding produces one commit and no error', () => {
  let callCount = 0;
  const sleeps = [];
  const runner = () => {
    callCount += 1;
    if (callCount <= 2) {
      const err = new Error('git commit failed');
      err.stderr = LOCK_ERR_MSG;
      throw err;
    }
    return { stdout: 'ok', failure: null, stderr: null };
  };
  const retrying = withIndexLockRetry(runner, { sleep: fakeSleep(sleeps) });
  const result = retrying(['commit', '-m', 'x']);
  assert.deepEqual(result, { stdout: 'ok', failure: null, stderr: null });
  assert.equal(callCount, 3, 'expected exactly one commit call after two lock retries');
  assert.equal(sleeps.length, 2, 'expected exactly two sleeps between the three attempts');
});

test('withIndexLockRetry: a throwing runner failing on an unrelated git error fails on the first attempt', () => {
  let callCount = 0;
  const sleeps = [];
  const runner = () => {
    callCount += 1;
    const err = new Error('git commit failed');
    err.stderr = 'fatal: unable to auto-detect email address';
    throw err;
  };
  const retrying = withIndexLockRetry(runner, { sleep: fakeSleep(sleeps) });
  assert.throws(
    () => retrying(['commit', '-m', 'x']),
    (err) => /unable to auto-detect email address/.test(err.stderr),
  );
  assert.equal(callCount, 1, 'must not retry a non-index.lock failure');
  assert.equal(sleeps.length, 0);
});

// Same two directions, for the non-throwing `{ failure, stderr }` runner
// convention (bin/lib/hooks/git-exec.js's runGit).
test('withIndexLockRetry: a { failure, stderr }-returning runner retries on index.lock and returns the eventual success', () => {
  let callCount = 0;
  const sleeps = [];
  const runner = () => {
    callCount += 1;
    if (callCount <= 2) return { stdout: null, failure: 'git-error', stderr: LOCK_ERR_MSG };
    return { stdout: '', failure: null, stderr: null };
  };
  const retrying = withIndexLockRetry(runner, { sleep: fakeSleep(sleeps) });
  const result = retrying(['commit', '-m', 'x'], '/repo');
  assert.equal(result.failure, null);
  assert.equal(callCount, 3);
  assert.equal(sleeps.length, 2);
});

test('withIndexLockRetry: a { failure, stderr }-returning runner does not retry an unrelated failure and returns it unchanged', () => {
  let callCount = 0;
  const sleeps = [];
  const runner = () => {
    callCount += 1;
    return { stdout: null, failure: 'git-error', stderr: 'fatal: not a git repository' };
  };
  const retrying = withIndexLockRetry(runner, { sleep: fakeSleep(sleeps) });
  const result = retrying(['commit', '-m', 'x'], '/repo');
  assert.equal(result.failure, 'git-error');
  assert.equal(result.stderr, 'fatal: not a git repository');
  assert.equal(callCount, 1);
  assert.equal(sleeps.length, 0);
});

// AC2 — never unlinks a lock file. Asserted directly against the source,
// not merely inferred from absence in the tests above.
test('withIndexLockRetry: the module never references unlinking a lock file', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'bin', 'lib', 'git-retry.js'), 'utf8');
  assert.doesNotMatch(src, /\bunlinkSync\(|\bfs\.unlink\(|\bfs\.rm\(/);
});

// AC3 — bounded, with an injected sleep so the test is instant.
test('withIndexLockRetry: bounded — a runner that always fails on index.lock exits after the configured attempt count with the original error', () => {
  let callCount = 0;
  const sleeps = [];
  const runner = () => {
    callCount += 1;
    const err = new Error('git commit failed');
    err.stderr = LOCK_ERR_MSG;
    throw err;
  };
  const start = Date.now();
  const retrying = withIndexLockRetry(runner, { attempts: 4, sleep: fakeSleep(sleeps) });
  assert.throws(
    () => retrying(['commit', '-m', 'x']),
    (err) => /index\.lock/.test(err.stderr),
  );
  const elapsed = Date.now() - start;
  assert.equal(callCount, 4, 'expected exactly `attempts` calls, no more');
  assert.equal(sleeps.length, 3, 'expected attempts-1 sleeps between attempts');
  assert.ok(elapsed < 1000, `injected sleep must make this instant, took ${elapsed}ms`);
});

test('isIndexLockFailure: matches both documented signatures, rejects an unrelated error', () => {
  assert.equal(isIndexLockFailure(new Error("Unable to create '/x/.git/index.lock': File exists.")), true);
  assert.equal(isIndexLockFailure({ stderr: 'fatal: Unable to create \'/x/.git/index.lock\': File exists.' }), true);
  assert.equal(isIndexLockFailure({ stderr: 'error: another git process seems to be running in this repository' }), true);
  assert.equal(isIndexLockFailure({ stderr: 'fatal: not a git repository (or any of the parent directories)' }), false);
});

// AC4 — each of the three named commit call sites routes through the
// helper; a grep-shaped source scan proves no direct ['commit', …] call
// bypasses it.
test('conformance: every named commit call site routes through withIndexLockRetry', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..', 'plugin');
  const sites = [
    path.join(root, 'bin', 'lib', 'reconcile', 'archive-merged.js'),
    path.join(root, 'bin', 'lib', 'release', 'run.js'),
    path.join(root, 'bin', 'release-local.js'),
  ];
  for (const file of sites) {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /withIndexLockRetry/, `${file} must import/use withIndexLockRetry`);
    // Every line that issues a ['commit', ...] git call must not be a bare
    // runGit(...)/deps.git(...) invocation — it must go through the
    // withIndexLockRetry-wrapped runner (commitGit(...) or an inline
    // withIndexLockRetry(deps.git)(...) call).
    const commitLines = src.split('\n').filter((l) => l.includes("'commit'"));
    assert.ok(commitLines.length > 0, `${file} should still have a commit call site`);
    for (const line of commitLines) {
      assert.ok(
        !/\b(runGit|deps\.git)\(\[/.test(line) || /withIndexLockRetry/.test(line),
        `${file} has a commit call bypassing withIndexLockRetry: ${line.trim()}`,
      );
    }
  }
});
