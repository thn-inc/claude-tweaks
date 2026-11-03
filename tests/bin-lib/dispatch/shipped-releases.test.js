'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { releasePayload, claimPayload, releaseTimeFromClaim } = require('../../../plugin/bin/lib/issues/claims.js');
const { writeReleaseTimes, readReleaseTimes } = require('../../../plugin/bin/lib/dispatch/shipped-releases.js');

const AT = Date.parse('2026-10-02T13:00:00Z');
const TOMBSTONE = releasePayload({ issueNumber: 7, runId: 'r', reason: 'merged: x', now: AT }).tombstoneContent;
const LIVE = claimPayload({ issueNumber: 8, runId: 'r', sessionId: 's', now: AT }).fileContent;

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipped-releases-'));
  return { dir, file: path.join(dir, 'shipped-releases.json') };
}

const MERGED = { mentions: [{ merged: true, mergedAt: '2026-10-01T00:00:00Z' }] };
const OPEN_ONLY = { mentions: [{ merged: false }] };

test('releaseTimeFromClaim tells released, not released and unreadable apart', () => {
  assert.deepStrictEqual(releaseTimeFromClaim(TOMBSTONE), { releasedAt: '2026-10-02T13:00:00.000Z', unreadable: false });
  assert.deepStrictEqual(releaseTimeFromClaim(LIVE), { releasedAt: null, unreadable: false });
  assert.deepStrictEqual(releaseTimeFromClaim(null), { releasedAt: null, unreadable: false });
  assert.deepStrictEqual(releaseTimeFromClaim('{not json'), { releasedAt: null, unreadable: true });
  assert.deepStrictEqual(releaseTimeFromClaim('[]'), { releasedAt: null, unreadable: true });
  assert.deepStrictEqual(releaseTimeFromClaim('{"released":true}'), { releasedAt: null, unreadable: true });
  assert.deepStrictEqual(releaseTimeFromClaim('{"released":true,"releasedAt":"nope"}'), { releasedAt: null, unreadable: true });
});

test('writeReleaseTimes reads only candidates with a merged mention, and round-trips through readReleaseTimes', () => {
  const { dir, file } = tmpFile();
  const answers = { 7: { content: TOMBSTONE }, 8: { content: LIVE } };
  const reads = [];
  const logged = [];
  const reader = { read: (n) => { reads.push(n); return answers[n]; } };
  const candidates = [{ number: 7 }, { number: 8 }, { number: 9 }, { number: 10 }];
  const linkedPRs = { 7: MERGED, 8: MERGED, 9: OPEN_ONLY };

  const returned = writeReleaseTimes(file, candidates, linkedPRs, { reader, log: (m) => logged.push(m) });

  assert.deepStrictEqual(reads, [7, 8]);
  assert.deepStrictEqual(returned, { 7: '2026-10-02T13:00:00.000Z' });
  assert.deepStrictEqual(readReleaseTimes(file), { 7: '2026-10-02T13:00:00.000Z' });
  assert.deepStrictEqual(logged, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeReleaseTimes builds no reader when no candidate has a merged mention', () => {
  const { dir, file } = tmpFile();
  const deps = {
    log: () => {},
    get reader() { throw new Error('reader must not be built'); },
  };
  const returned = writeReleaseTimes(file, [{ number: 9 }, { number: 10 }], { 9: OPEN_ONLY }, deps);
  assert.deepStrictEqual(returned, {});
  assert.deepStrictEqual(readReleaseTimes(file), {});
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{}');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failed read, a throwing read and a corrupt blob are logged and yield no release time', () => {
  const { dir, file } = tmpFile();
  const reader = {
    read: (n) => {
      if (n === 7) return { failure: 'network-failure' };
      if (n === 8) throw new Error('boom');
      return { content: '{not json' };
    },
  };
  const logged = [];
  const returned = writeReleaseTimes(file, [{ number: 7 }, { number: 8 }, { number: 9 }], { 7: MERGED, 8: MERGED, 9: MERGED }, {
    reader, log: (m) => logged.push(m),
  });
  assert.deepStrictEqual(returned, {});
  assert.strictEqual(logged.length, 1);
  assert.strictEqual(
    logged[0],
    'AUTO — dispatch: shipped-candidate claim read failed for #7 (network-failure), #8 (boom), #9 (corrupt claim blob); release time unknown, no downgrade',
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readReleaseTimes returns {} for a missing, corrupt or non-object file', () => {
  const { dir, file } = tmpFile();
  assert.deepStrictEqual(readReleaseTimes(path.join(dir, 'absent.json')), {});
  fs.writeFileSync(file, '{not json');
  assert.deepStrictEqual(readReleaseTimes(file), {});
  fs.writeFileSync(file, '[1]');
  assert.deepStrictEqual(readReleaseTimes(file), {});
  fs.writeFileSync(file, 'null');
  assert.deepStrictEqual(readReleaseTimes(file), {});
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an unwritable release-times file is logged and the in-memory map still returned', () => {
  const { dir } = tmpFile();
  const blocker = path.join(dir, 'regular-file');
  fs.writeFileSync(blocker, 'x');
  const file = path.join(blocker, 'shipped-releases.json');
  const logged = [];
  const reader = { read: () => ({ content: TOMBSTONE }) };
  const returned = writeReleaseTimes(file, [{ number: 7 }], { 7: MERGED }, { reader, log: (m) => logged.push(m) });
  assert.deepStrictEqual(returned, { 7: '2026-10-02T13:00:00.000Z' });
  assert.strictEqual(logged.length, 1);
  assert.match(logged[0], /shipped-releases\.json/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// A read-only file makes the write fail while the directory stays removable; a
// root user and win32 permission semantics ignore the mode, so those skip.
test('a failed write removes a stale map an earlier pull left, so the second pass reads no release time', {
  skip: process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0),
}, () => {
  const { dir, file } = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ 7: '2026-10-02T13:00:00.000Z' }));
  fs.chmodSync(file, 0o444);
  const logged = [];
  const reader = { read: () => ({ content: TOMBSTONE }) };
  const returned = writeReleaseTimes(file, [{ number: 7 }], { 7: MERGED }, { reader, log: (m) => logged.push(m) });
  assert.deepStrictEqual(returned, { 7: '2026-10-02T13:00:00.000Z' });
  assert.strictEqual(logged.length, 1);
  assert.strictEqual(fs.existsSync(file), false);
  assert.deepStrictEqual(readReleaseTimes(file), {});
  fs.rmSync(dir, { recursive: true, force: true });
});
