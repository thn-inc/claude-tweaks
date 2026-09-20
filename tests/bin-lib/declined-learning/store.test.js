'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const store = require('../../../plugin/bin/lib/declined-learning/store');

// Fake deps are plain objects backed by an in-memory `data` keyed by the path a real fs call
// would use — same convention as tests/bin-lib/transcript-judge/watermark.test.js's makeStore().
function makeStore() {
  const data = {};
  const mkdirSync = () => {};
  const writeFile = (p, content) => { data[p] = content; };
  const rename = (from, to) => { data[to] = data[from]; delete data[from]; };
  const readFile = (p) => {
    if (!(p in data)) { const e = new Error(`ENOENT: no such file, open '${p}'`); e.code = 'ENOENT'; throw e; }
    return data[p];
  };
  return {
    data, mkdirSync, writeFile, rename, readFile,
  };
}

const STORE_REL = path.join('.claude-tweaks', 'declined-learning', 'store.json');

// ---- storePath ---------------------------------------------------------

test('storePath: fixed location under .claude-tweaks/declined-learning/', () => {
  assert.equal(store.storePath(), STORE_REL);
});

// ---- readStore: degrade-open -------------------------------------------

test('readStore: no file -> {}, no throw', () => {
  const { readFile } = makeStore();
  assert.deepEqual(store.readStore({ readFile }), {});
});

test('readStore: corrupt/malformed JSON -> {}, no throw', () => {
  const { data, readFile } = makeStore();
  data[STORE_REL] = '{ this is not valid json ';
  assert.deepEqual(store.readStore({ readFile }), {});
});

test('readStore: valid JSON that is not an object (e.g. an array) -> {}', () => {
  const { data, readFile } = makeStore();
  data[STORE_REL] = '[1,2,3]';
  assert.deepEqual(store.readStore({ readFile }), {});
});

// ---- writeStore ----------------------------------------------------------

test('writeStore: creates the containing directory and writes JSON at the derived path (via an atomic tmp-file rename)', () => {
  const mkdirCalls = [];
  const writeCalls = [];
  const renameCalls = [];
  const mkdirSync = (p, opts) => mkdirCalls.push({ p, opts });
  const writeFile = (p, content) => writeCalls.push({ p, content });
  const rename = (from, to) => renameCalls.push({ from, to });
  const payload = { 'feedback-deadbeef': { declinedAt: '2026-08-20T00:00:00Z', reason: 'not applicable', source: 'feedback' } };

  store.writeStore(payload, { mkdirSync, writeFile, rename });

  assert.equal(mkdirCalls.length, 1);
  assert.equal(mkdirCalls[0].p, path.dirname(STORE_REL));
  assert.deepEqual(mkdirCalls[0].opts, { recursive: true });
  assert.equal(writeCalls.length, 1);
  assert.deepEqual(JSON.parse(writeCalls[0].content), payload);
  assert.equal(renameCalls.length, 1);
  assert.equal(renameCalls[0].from, writeCalls[0].p, 'renamed from the exact tmp path writeFile was called with');
  assert.equal(renameCalls[0].to, STORE_REL);
});

test('writeStore: propagates a real write failure to the caller rather than swallowing it', () => {
  const mkdirSync = () => {};
  const writeFile = () => { throw new Error('ENOSPC: no space left on device'); };
  const rename = () => {};
  assert.throws(() => store.writeStore({}, { mkdirSync, writeFile, rename }), /ENOSPC/);
});

// ---- recordDecline + lookupDecline (annotation lookup) --------------------

test('recordDecline: writes an entry, lookupDecline reads it back', () => {
  const deps = makeStore();
  const entry = store.recordDecline('feedback-deadbeef', { reason: 'stale rubric', source: 'feedback', declinedAt: '2026-08-20T00:00:00Z' }, deps);

  assert.deepEqual(entry, { declinedAt: '2026-08-20T00:00:00Z', reason: 'stale rubric', source: 'feedback' });
  assert.deepEqual(store.lookupDecline('feedback-deadbeef', deps), entry);
});

test('lookupDecline: no entry for an unknown fingerprint -> null', () => {
  const deps = makeStore();
  assert.equal(store.lookupDecline('reflect-abc12345', deps), null);
});

test('recordDecline: defaults reason to null and declinedAt to an ISO timestamp when omitted', () => {
  const deps = makeStore();
  const entry = store.recordDecline('reflect-abc12345', { source: 'reflect' }, deps);
  assert.equal(entry.reason, null);
  assert.equal(entry.source, 'reflect');
  assert.match(entry.declinedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('recordDecline: overwrites an existing entry for the same fingerprint', () => {
  const deps = makeStore();
  store.recordDecline('feedback-deadbeef', { reason: 'first', source: 'feedback', declinedAt: 'a' }, deps);
  const second = store.recordDecline('feedback-deadbeef', { reason: 'second', source: 'feedback', declinedAt: 'b' }, deps);

  assert.deepEqual(store.lookupDecline('feedback-deadbeef', deps), second);
});

test('recordDecline: two different fingerprints coexist in the store', () => {
  const deps = makeStore();
  store.recordDecline('feedback-aaa', { source: 'feedback' }, deps);
  store.recordDecline('reflect-bbb', { source: 'reflect' }, deps);

  assert.notEqual(store.lookupDecline('feedback-aaa', deps), null);
  assert.notEqual(store.lookupDecline('reflect-bbb', deps), null);
});

// ---- subject field (#1033) -------------------------------------------------

test('recordDecline: subject is included on the entry when passed', () => {
  const deps = makeStore();
  const entry = store.recordDecline('feedback-deadbeef', {
    reason: 'stale rubric', source: 'feedback', subject: 'watermark: stale rubric text', declinedAt: '2026-08-20T00:00:00Z',
  }, deps);

  assert.deepEqual(entry, {
    declinedAt: '2026-08-20T00:00:00Z', reason: 'stale rubric', source: 'feedback', subject: 'watermark: stale rubric text',
  });
  assert.deepEqual(store.lookupDecline('feedback-deadbeef', deps), entry);
});

test('recordDecline: a subject at or under the length cap is stored verbatim', () => {
  const deps = makeStore();
  const subject = 'x'.repeat(store.MAX_SUBJECT_LENGTH);
  const entry = store.recordDecline('feedback-cap', { source: 'feedback', subject }, deps);

  assert.equal(entry.subject, subject);
});

test('recordDecline: a subject over the length cap is truncated with a visible marker', () => {
  const deps = makeStore();
  const subject = `${'x'.repeat(store.MAX_SUBJECT_LENGTH)}OVERFLOW`;
  const entry = store.recordDecline('feedback-overflow', { source: 'feedback', subject }, deps);

  assert.equal(entry.subject.length, store.MAX_SUBJECT_LENGTH + '… [truncated]'.length);
  assert.ok(entry.subject.startsWith('x'.repeat(store.MAX_SUBJECT_LENGTH)));
  assert.ok(entry.subject.endsWith('… [truncated]'));
  assert.ok(!entry.subject.includes('OVERFLOW'));
});

test('recordDecline: MAX_SUBJECT_LENGTH is a sane positive number (guards against an accidental 0/negative edit)', () => {
  assert.ok(Number.isInteger(store.MAX_SUBJECT_LENGTH) && store.MAX_SUBJECT_LENGTH > 0);
});

test('recordDecline: omitting subject writes the same three-key shape as before (no forced subject: null)', () => {
  const deps = makeStore();
  const entry = store.recordDecline('feedback-deadbeef', { reason: 'stale rubric', source: 'feedback', declinedAt: '2026-08-20T00:00:00Z' }, deps);

  assert.deepEqual(entry, { declinedAt: '2026-08-20T00:00:00Z', reason: 'stale rubric', source: 'feedback' });
  assert.equal(Object.prototype.hasOwnProperty.call(entry, 'subject'), false);
});

// ---- listDeclined (subject scan, #1033) ------------------------------------

test('listDeclined: no filter returns every entry with its fingerprint and subject', () => {
  const deps = makeStore();
  store.recordDecline('feedback-aaa', {
    source: 'feedback', reason: 'r1', subject: 'subject one', declinedAt: '2026-08-20T00:00:00Z',
  }, deps);
  store.recordDecline('reflect-bbb', {
    source: 'reflect', reason: 'r2', subject: 'subject two', declinedAt: '2026-08-21T00:00:00Z',
  }, deps);

  const all = store.listDeclined({}, deps).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  assert.deepEqual(all, [
    {
      fingerprint: 'feedback-aaa', declinedAt: '2026-08-20T00:00:00Z', reason: 'r1', source: 'feedback', subject: 'subject one',
    },
    {
      fingerprint: 'reflect-bbb', declinedAt: '2026-08-21T00:00:00Z', reason: 'r2', source: 'reflect', subject: 'subject two',
    },
  ]);
});

test('listDeclined: filtered by source returns only matching entries', () => {
  const deps = makeStore();
  store.recordDecline('feedback-aaa', { source: 'feedback', subject: 'a' }, deps);
  store.recordDecline('feedback-ccc', { source: 'feedback', subject: 'c' }, deps);
  store.recordDecline('reflect-bbb', { source: 'reflect', subject: 'b' }, deps);

  const feedbackOnly = store.listDeclined({ source: 'feedback' }, deps).map((e) => e.fingerprint).sort();
  assert.deepEqual(feedbackOnly, ['feedback-aaa', 'feedback-ccc']);
});

test('listDeclined: empty store -> []', () => {
  const deps = makeStore();
  assert.deepEqual(store.listDeclined({}, deps), []);
});

test('listDeclined: an entry recorded with no subject omits the key rather than rendering undefined', () => {
  const deps = makeStore();
  store.recordDecline('feedback-aaa', { source: 'feedback', reason: 'no subject given' }, deps);

  const [entry] = store.listDeclined({}, deps);
  assert.equal(Object.prototype.hasOwnProperty.call(entry, 'subject'), false);
});

// ---- listDeclinedFingerprints ---------------------------------------------

test('listDeclinedFingerprints: no filter returns every fingerprint', () => {
  const deps = makeStore();
  store.recordDecline('feedback-aaa', { source: 'feedback' }, deps);
  store.recordDecline('reflect-bbb', { source: 'reflect' }, deps);

  const all = store.listDeclinedFingerprints({}, deps).sort();
  assert.deepEqual(all, ['feedback-aaa', 'reflect-bbb']);
});

test('listDeclinedFingerprints: filtered by source returns only matching fingerprints', () => {
  const deps = makeStore();
  store.recordDecline('feedback-aaa', { source: 'feedback' }, deps);
  store.recordDecline('feedback-ccc', { source: 'feedback' }, deps);
  store.recordDecline('reflect-bbb', { source: 'reflect' }, deps);

  const feedbackOnly = store.listDeclinedFingerprints({ source: 'feedback' }, deps).sort();
  assert.deepEqual(feedbackOnly, ['feedback-aaa', 'feedback-ccc']);
});

test('listDeclinedFingerprints: empty store -> []', () => {
  const deps = makeStore();
  assert.deepEqual(store.listDeclinedFingerprints({}, deps), []);
});

// ---- clearDecline -----------------------------------------------------

test('clearDecline: removes an existing entry and returns true', () => {
  const deps = makeStore();
  store.recordDecline('feedback-aaa', { source: 'feedback' }, deps);

  const removed = store.clearDecline('feedback-aaa', deps);

  assert.equal(removed, true);
  assert.equal(store.lookupDecline('feedback-aaa', deps), null);
});

test('clearDecline: unknown fingerprint -> false, no write', () => {
  const deps = makeStore();
  const writeCallsBefore = Object.keys(deps.data).length;
  const removed = store.clearDecline('feedback-never-existed', deps);

  assert.equal(removed, false);
  assert.equal(Object.keys(deps.data).length, writeCallsBefore);
});

test('clearDecline: leaves sibling entries untouched', () => {
  const deps = makeStore();
  store.recordDecline('feedback-aaa', { source: 'feedback' }, deps);
  store.recordDecline('reflect-bbb', { source: 'reflect' }, deps);

  store.clearDecline('feedback-aaa', deps);

  assert.equal(store.lookupDecline('feedback-aaa', deps), null);
  assert.notEqual(store.lookupDecline('reflect-bbb', deps), null);
});

// ---- pruneDeclines (#1399) ---------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-28T00:00:00Z');

test('pruneDeclines: an entry older than the policy\'s age threshold is removed', () => {
  const deps = makeStore();
  const old = new Date(NOW - 200 * DAY_MS).toISOString();
  store.recordDecline('feedback-old', { source: 'feedback', declinedAt: old }, deps);

  const removed = store.pruneDeclines({ maxAgeDays: 180, now: NOW }, deps);

  assert.equal(removed, 1);
  assert.equal(store.lookupDecline('feedback-old', deps), null);
});

test('pruneDeclines: an entry within the threshold survives', () => {
  const deps = makeStore();
  const recent = new Date(NOW - 10 * DAY_MS).toISOString();
  store.recordDecline('feedback-recent', { source: 'feedback', declinedAt: recent }, deps);

  const removed = store.pruneDeclines({ maxAgeDays: 180, now: NOW }, deps);

  assert.equal(removed, 0);
  assert.notEqual(store.lookupDecline('feedback-recent', deps), null);
});

test('pruneDeclines: an empty store is a no-op (no write, returns 0)', () => {
  const deps = makeStore();
  const writeCallsBefore = Object.keys(deps.data).length;

  const removed = store.pruneDeclines({ maxAgeDays: 180, now: NOW }, deps);

  assert.equal(removed, 0);
  assert.equal(Object.keys(deps.data).length, writeCallsBefore);
});

test('pruneDeclines: leaves a sibling within-threshold entry untouched while removing an old one', () => {
  const deps = makeStore();
  const old = new Date(NOW - 200 * DAY_MS).toISOString();
  const recent = new Date(NOW - 10 * DAY_MS).toISOString();
  store.recordDecline('feedback-old', { source: 'feedback', declinedAt: old }, deps);
  store.recordDecline('feedback-recent', { source: 'feedback', declinedAt: recent }, deps);

  const removed = store.pruneDeclines({ maxAgeDays: 180, now: NOW }, deps);

  assert.equal(removed, 1);
  assert.equal(store.lookupDecline('feedback-old', deps), null);
  assert.notEqual(store.lookupDecline('feedback-recent', deps), null);
});

test('pruneDeclines: an entry with a missing/unparseable declinedAt is kept, not treated as infinitely old', () => {
  const deps = makeStore();
  store.recordDecline('feedback-nodate', { source: 'feedback' }, deps);
  // Overwrite the written entry with a corrupt declinedAt to simulate pre-existing bad data,
  // without going through recordDecline's own default-timestamp behavior.
  const raw = JSON.parse(deps.data[STORE_REL]);
  raw['feedback-nodate'].declinedAt = 'not-a-date';
  deps.data[STORE_REL] = JSON.stringify(raw);

  const removed = store.pruneDeclines({ maxAgeDays: 180, now: NOW }, deps);

  assert.equal(removed, 0);
  assert.notEqual(store.lookupDecline('feedback-nodate', deps), null);
});

test('pruneDeclines: defaults maxAgeDays to DEFAULT_PRUNE_MAX_AGE_DAYS (180) when omitted', () => {
  const deps = makeStore();
  const justOverDefault = new Date(NOW - (store.DEFAULT_PRUNE_MAX_AGE_DAYS + 1) * DAY_MS).toISOString();
  store.recordDecline('feedback-old', { source: 'feedback', declinedAt: justOverDefault }, deps);

  const removed = store.pruneDeclines({ now: NOW }, deps);

  assert.equal(removed, 1);
});
