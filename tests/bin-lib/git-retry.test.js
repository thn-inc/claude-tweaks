'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withIndexLockRetry, isIndexLockFailure } = require('../../plugin/bin/lib/git-retry');

// #2346 Acceptance Criteria 1 — retries on an index.lock stderr signature,
// never on any other git failure.

test('isIndexLockFailure: matches both known index.lock stderr shapes', () => {
  assert.equal(isIndexLockFailure({ stderr: "fatal: Unable to create '/repo/.git/index.lock': File exists." }), true);
  assert.equal(isIndexLockFailure({ stderr: 'fatal: Unable to create index.lock: another git process seems to be running in this repository.' }), true);
  assert.equal(isIndexLockFailure(new Error("Unable to create '/repo/.git/index.lock': File exists.")), true);
});

test('isIndexLockFailure: an unrelated git error does not match', () => {
  assert.equal(isIndexLockFailure(new Error('fatal: not a git repository (or any of the parent directories): .git')), false);
  assert.equal(isIndexLockFailure({ stderr: 'error: pathspec did not match any files' }), false);
});

test('withIndexLockRetry: a fake runner failing on index.lock twice then succeeding produces one commit and no error', () => {
  let calls = 0;
  const runner = (args) => {
    calls++;
    if (calls <= 2) {
      const err = new Error("fatal: Unable to create '/repo/.git/index.lock': File exists.");
      err.stderr = err.message;
      throw err;
    }
    return `committed ${args.join(' ')}`;
  };
  const sleeps = [];
  const wrapped = withIndexLockRetry(runner, { sleep: (ms) => sleeps.push(ms) });
  const result = wrapped(['commit', '-m', 'x']);
  assert.equal(result, 'committed commit -m x');
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [2000, 2000]);
});

test('withIndexLockRetry: a fake runner failing on an unrelated git error fails on the first attempt', () => {
  let calls = 0;
  const runner = () => { calls++; throw new Error('fatal: pathspec did not match any files'); };
  const sleeps = [];
  const wrapped = withIndexLockRetry(runner, { sleep: (ms) => sleeps.push(ms) });
  assert.throws(() => wrapped(['commit', '-m', 'x']), /pathspec/);
  assert.equal(calls, 1, 'must not retry a non-index.lock failure');
  assert.equal(sleeps.length, 0);
});

// #2346 Acceptance Criteria 2 — the helper never unlinks a lock file.
// Asserted directly against a real file on disk: a fake runner that always
// fails on the index.lock signature exhausts every retry attempt while a
// real lock file sits at a known path, and that file must still exist,
// byte-for-byte unchanged, once the helper gives up and rethrows.

test('withIndexLockRetry: an exhausted retry never deletes or modifies a real lock file on disk', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-retry-lockfile-'));
  const lockPath = path.join(dir, 'index.lock');
  const lockContents = 'pid-12345\n';
  fs.writeFileSync(lockPath, lockContents);

  const runner = () => {
    const err = new Error(`fatal: Unable to create '${lockPath}': File exists.`);
    err.stderr = err.message;
    throw err;
  };
  const wrapped = withIndexLockRetry(runner, { attempts: 3, sleep: () => {} });
  assert.throws(() => wrapped(['commit', '-m', 'x']), /index\.lock/);

  assert.ok(fs.existsSync(lockPath), 'the lock file must still exist after every retry attempt is exhausted');
  assert.equal(fs.readFileSync(lockPath, 'utf8'), lockContents, 'the lock file must be byte-for-byte unchanged');
});

// #2346 Acceptance Criteria 3 — retries are bounded; the injected sleep makes
// the test instant.

test('withIndexLockRetry: bounded — an always-failing runner exits after the configured attempt count with the original error', () => {
  let calls = 0;
  const runner = () => {
    calls++;
    const err = new Error("fatal: Unable to create '/repo/.git/index.lock': File exists.");
    err.stderr = err.message;
    throw err;
  };
  const sleeps = [];
  const start = Date.now();
  const wrapped = withIndexLockRetry(runner, { attempts: 4, waitMs: 2000, sleep: (ms) => sleeps.push(ms) });
  assert.throws(() => wrapped(['commit', '-m', 'x']), /index\.lock/);
  assert.equal(calls, 4, 'must stop retrying at the configured attempt count');
  assert.deepEqual(sleeps, [2000, 2000, 2000], 'sleeps once between each pair of attempts, never after the last');
  assert.ok(Date.now() - start < 1000, 'the injected sleep must make the test instant — no real waiting');
});

test('withIndexLockRetry: default attempts/waitMs are 15 and 2000ms', () => {
  let calls = 0;
  const runner = () => {
    calls++;
    const err = new Error("fatal: Unable to create '/repo/.git/index.lock': File exists.");
    err.stderr = err.message;
    throw err;
  };
  const sleeps = [];
  const wrapped = withIndexLockRetry(runner, { sleep: (ms) => sleeps.push(ms) });
  assert.throws(() => wrapped(['commit']), /index\.lock/);
  assert.equal(calls, 15);
  assert.equal(sleeps.length, 14);
  assert.ok(sleeps.every((ms) => ms === 2000));
});
