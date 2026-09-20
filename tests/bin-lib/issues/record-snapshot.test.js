'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  UNION_FIELDS,
  snapshotPath,
  gitLogPath,
  subIssuesPath,
  isFresh,
  readSnapshot,
  writeSnapshot,
  invalidateSnapshot,
  mergeOpenIntoUnion,
} = require('../../../plugin/bin/lib/issues/record-snapshot');

test('UNION_FIELDS carries the field set every consumer needs', () => {
  assert.strictEqual(
    UNION_FIELDS,
    'number,title,labels,body,state,stateReason,createdAt,closedAt,comments,updatedAt,milestone',
  );
});

test('snapshotPath is keyed on session id, under the OS tmpdir', () => {
  const p = snapshotPath('sess-abc');
  assert.strictEqual(p, path.join(os.tmpdir(), 'ct-records-sess-abc.json'));
});

test('gitLogPath mirrors snapshotPath for the git-log dump', () => {
  const p = gitLogPath('sess-abc');
  assert.strictEqual(p, path.join(os.tmpdir(), 'ct-gitlog-sess-abc.txt'));
});

test('snapshotPath/gitLogPath return null for an absent or blank session id', () => {
  assert.strictEqual(snapshotPath(undefined), null);
  assert.strictEqual(snapshotPath(''), null);
  assert.strictEqual(snapshotPath('   '), null);
  assert.strictEqual(gitLogPath(undefined), null);
});

test('subIssuesPath mirrors gitLogPath: tmpdir path keyed by session id, null on falsy id', () => {
  assert.strictEqual(subIssuesPath(null), null);
  assert.ok(subIssuesPath('abc').endsWith('ct-subissues-abc.json'));
  assert.strictEqual(subIssuesPath('sess-abc'), path.join(os.tmpdir(), 'ct-subissues-sess-abc.json'));
});

test('isFresh: false for a missing file, no throw', () => {
  assert.strictEqual(isFresh(path.join(os.tmpdir(), 'ct-records-does-not-exist.json'), 300), false);
});

test('isFresh: false for a null path (no session id)', () => {
  assert.strictEqual(isFresh(null, 300), false);
});

test('isFresh: true just inside the TTL window, false just past it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-snapshot-test-'));
  const file = path.join(dir, 'snap.json');
  fs.writeFileSync(file, '[]');
  const stat = fs.statSync(file);
  const now = stat.mtimeMs + 299_000; // 299s later, TTL is 300s
  assert.strictEqual(isFresh(file, 300, now), true);
  const later = stat.mtimeMs + 301_000; // 301s later
  assert.strictEqual(isFresh(file, 300, later), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeSnapshot then readSnapshot round-trips the record array', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-snapshot-test-'));
  const file = path.join(dir, 'snap.json');
  const records = [{ number: 1, title: 'a' }, { number: 2, title: 'b' }];
  writeSnapshot(file, records);
  assert.deepStrictEqual(readSnapshot(file), records);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('invalidateSnapshot deletes both the snapshot and the git-log dump', () => {
  const sessionId = `test-invalidate-${process.pid}`;
  const snap = snapshotPath(sessionId);
  const log = gitLogPath(sessionId);
  fs.writeFileSync(snap, '[]');
  fs.writeFileSync(log, '');
  assert.ok(fs.existsSync(snap));
  assert.ok(fs.existsSync(log));
  invalidateSnapshot(sessionId);
  assert.ok(!fs.existsSync(snap));
  assert.ok(!fs.existsSync(log));
});

test('invalidateSnapshot also removes the sub-issues snapshot', () => {
  const sessionId = `test-invalidate-subissues-${process.pid}`;
  const snap = snapshotPath(sessionId);
  const log = gitLogPath(sessionId);
  const sub = subIssuesPath(sessionId);
  fs.writeFileSync(snap, '[]');
  fs.writeFileSync(log, '');
  fs.writeFileSync(sub, '[]');
  assert.ok(fs.existsSync(sub));
  invalidateSnapshot(sessionId);
  assert.ok(!fs.existsSync(snap));
  assert.ok(!fs.existsSync(log));
  assert.ok(!fs.existsSync(sub));
});

test('invalidateSnapshot tolerates an already-absent snapshot (no throw)', () => {
  const sessionId = `test-invalidate-absent-${process.pid}`;
  assert.doesNotThrow(() => invalidateSnapshot(sessionId));
});

test('invalidateSnapshot no-ops safely for an absent session id', () => {
  assert.doesNotThrow(() => invalidateSnapshot(undefined));
});

test('mergeOpenIntoUnion: capped union (1000 rows, 150 open) completed by 160 open-only rows yields 1010 records with all 160 open numbers present', () => {
  // Union is the newest-first --state all pull, capped at 1000: numbers
  // 100..1099, with the 150 newest (950..1099) still open. The seven (here,
  // ten, for a rounder fixture) oldest open records — numbered 1..10 — are
  // old enough that newer closed records fill every remaining union slot, so
  // they never appear in the union at all.
  const union = [];
  for (let n = 100; n <= 1099; n++) {
    union.push({ number: n, title: `union-${n}`, state: n >= 950 ? 'OPEN' : 'CLOSED' });
  }
  const open = [];
  for (let n = 1; n <= 10; n++) {
    open.push({ number: n, title: `open-${n}`, state: 'OPEN' });
  }
  for (let n = 950; n <= 1099; n++) {
    open.push({ number: n, title: `open-${n}`, state: 'OPEN' });
  }
  assert.strictEqual(open.length, 160);

  const merged = mergeOpenIntoUnion(union, open);

  assert.strictEqual(merged.length, 1010);
  const openNumbers = new Set(
    merged.filter((r) => r.state === 'OPEN').map((r) => r.number),
  );
  assert.strictEqual(openNumbers.size, 160);
  for (let n = 1; n <= 10; n++) {
    assert.ok(openNumbers.has(n), `expected open number ${n} to be present`);
  }
  for (let n = 950; n <= 1099; n++) {
    assert.ok(openNumbers.has(n), `expected open number ${n} to be present`);
  }
});

test('mergeOpenIntoUnion: below-cap union returned unchanged when open is empty', () => {
  const union = [{ number: 1, state: 'OPEN' }, { number: 2, state: 'CLOSED' }];
  const merged = mergeOpenIntoUnion(union, []);
  assert.deepStrictEqual(merged, union);
});

test('mergeOpenIntoUnion: dedups by number, preserving the union row (its full field set) over the open-only duplicate', () => {
  const union = [{ number: 1, title: 'union-1', state: 'OPEN', extra: 'union-field' }];
  const open = [{ number: 1, title: 'open-1', state: 'OPEN' }, { number: 2, title: 'open-2', state: 'OPEN' }];
  const merged = mergeOpenIntoUnion(union, open);
  assert.strictEqual(merged.length, 2);
  assert.deepStrictEqual(merged[0], { number: 1, title: 'union-1', state: 'OPEN', extra: 'union-field' });
  assert.deepStrictEqual(merged[1], { number: 2, title: 'open-2', state: 'OPEN' });
});
