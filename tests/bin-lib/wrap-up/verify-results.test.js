'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  FILE_NAME, VERSION, writeVerifyResults, readVerifyResults,
} = require('../../../plugin/bin/lib/wrap-up/verify-results');

function tmpRunDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'verify-results-'));
}

const ROWS = [
  { check: 'acceptance-labeling', result: 'pass', detail: 'labeled' },
  { check: 'memory', result: 'skip', detail: 'none expected' },
];

test('writeVerifyResults round-trips through readVerifyResults', () => {
  const runDir = tmpRunDir();
  const { file, data } = writeVerifyResults({ runDir, rows: ROWS, base: 'abc123', now: () => Date.UTC(2026, 9, 21) });
  assert.equal(file, path.join(runDir, FILE_NAME));
  assert.equal(FILE_NAME, 'verify.json');
  assert.equal(VERSION, 1);
  const read = readVerifyResults(runDir);
  assert.deepEqual(read, data);
  assert.equal(read.version, 1);
  assert.equal(read.base, 'abc123');
  assert.equal(read.writtenAt, '2026-10-21T00:00:00.000Z');
  assert.deepEqual(read.checks, ROWS);
});

test('a second write replaces the first whole, leaving no prior row behind', () => {
  const runDir = tmpRunDir();
  writeVerifyResults({ runDir, rows: ROWS, base: 'a' });
  const second = [{ check: 'issues', result: 'fail', detail: 'open' }];
  writeVerifyResults({ runDir, rows: second, base: 'b' });
  const read = readVerifyResults(runDir);
  assert.deepEqual(read.checks, second);
  assert.equal(read.base, 'b');
});

test('readVerifyResults returns null for a missing, malformed, or wrong-shape file', () => {
  const missing = tmpRunDir();
  assert.equal(readVerifyResults(missing), null);
  for (const body of [
    '{', '[]', 'null', JSON.stringify({ version: 2, checks: [] }), JSON.stringify({ version: 1 }),
    JSON.stringify({ version: 1, checks: [null] }), JSON.stringify({ version: 1, checks: [{ check: 'issues' }] }),
  ]) {
    const runDir = tmpRunDir();
    fs.writeFileSync(path.join(runDir, FILE_NAME), body);
    assert.equal(readVerifyResults(runDir), null, body);
  }
});

test('writeVerifyResults throws when the run dir path runs through a regular file', () => {
  // The up-front statSync guard fails with ENOTDIR before the lock is taken;
  // the unwritable-dir (EACCES) case is covered by verify-json-cli.test.js.
  const blocker = path.join(tmpRunDir(), 'blocker');
  fs.writeFileSync(blocker, 'x');
  const runDir = path.join(blocker, 'run');
  assert.throws(() => writeVerifyResults({ runDir, rows: ROWS, base: 'a' }));
});

test('writeVerifyResults throws on a missing run dir and never recreates it', () => {
  // A reconcile that archived the run dir mid-verify must not see it reborn
  // by the lock's parent-bootstrap mkdir.
  const runDir = path.join(tmpRunDir(), 'archived-away');
  assert.throws(() => writeVerifyResults({ runDir, rows: ROWS, base: 'a' }), /ENOENT/);
  assert.equal(fs.existsSync(runDir), false);
});
