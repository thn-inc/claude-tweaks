'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  composeQaStamp, decideQaSkip, readQaStamp, writeQaStamp, QA_STAMP_NAME,
} = require('../../../plugin/bin/lib/verify/qa-stamp');

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);

function report(stories, summary) {
  const passed = stories.filter((s) => s.status === 'PASS' || s.status === 'PASS_WITH_CAVEATS').length;
  return {
    stories_dir: 'stories',
    summary: summary || {
      total: stories.length,
      passed,
      pass_with_caveats: stories.filter((s) => s.status === 'PASS_WITH_CAVEATS').length,
      failed: stories.filter((s) => s.status === 'FAIL').length,
      skipped: stories.filter((s) => s.status === 'SKIPPED').length,
    },
    stories,
  };
}
const GREEN = [
  { id: 'login', source_file: 'app.yaml', status: 'PASS' },
  { id: 'checkout', source_file: 'app.yaml', status: 'PASS_WITH_CAVEATS' },
  { id: 'profile', source_file: 'profile.yaml', status: 'PASS' },
];
const HASHES = { 'app.yaml': H1, 'profile.yaml': H2 };
const base = { head: HEAD, dirty: false, storyHashes: HASHES, storiesDir: 'stories', reportPath: '/r/report.json', at: '2026-10-16T00:00:00.000Z' };

test('composeQaStamp: an all-green clean report yields a stamp bound to HEAD and each story file hash', () => {
  const { stamp, error } = composeQaStamp({ ...base, report: report(GREEN) });
  assert.equal(error, undefined);
  assert.deepEqual(stamp, {
    sha: HEAD,
    dirty: false,
    stories: [
      { id: 'login', file: 'app.yaml', sha256: H1 },
      { id: 'checkout', file: 'app.yaml', sha256: H1 },
      { id: 'profile', file: 'profile.yaml', sha256: H2 },
    ],
    storiesDir: 'stories',
    at: '2026-10-16T00:00:00.000Z',
    reportPath: '/r/report.json',
  });
});

test('composeQaStamp: a failed story writes no stamp', () => {
  const r = composeQaStamp({ ...base, report: report([...GREEN, { id: 'x', source_file: 'app.yaml', status: 'FAIL' }]) });
  assert.equal(r.stamp, undefined);
  assert.match(r.error, /^story-not-passed: x FAIL$/);
});

test('composeQaStamp: a partially-skipped run writes no stamp', () => {
  const r = composeQaStamp({ ...base, report: report([...GREEN, { id: 'y', source_file: 'app.yaml', status: 'SKIPPED' }]) });
  assert.equal(r.stamp, undefined);
  assert.match(r.error, /^story-not-passed: y SKIPPED$/);
});

test('composeQaStamp: a summary claiming failures or skips writes no stamp even when every listed story passed (Review Focus 3)', () => {
  const r = composeQaStamp({ ...base, report: report(GREEN, { total: 3, passed: 3, pass_with_caveats: 1, failed: 0, skipped: 1 }) });
  assert.equal(r.error, 'summary-not-clean');
});

test('composeQaStamp: a summary total that disagrees with the stories array writes no stamp', () => {
  const r = composeQaStamp({ ...base, report: report(GREEN, { total: 4, passed: 3, pass_with_caveats: 1, failed: 0, skipped: 0 }) });
  assert.equal(r.error, 'summary-mismatch');
});

test('composeQaStamp: a dirty tree, an unknown dirty state, or no HEAD writes no stamp', () => {
  assert.equal(composeQaStamp({ ...base, dirty: true, report: report(GREEN) }).error, 'dirty-tree');
  assert.equal(composeQaStamp({ ...base, dirty: null, report: report(GREEN) }).error, 'dirty-tree');
  assert.equal(composeQaStamp({ ...base, head: null, report: report(GREEN) }).error, 'no-head');
});

test('composeQaStamp: an empty or missing stories array, or an unreadable story file, writes no stamp', () => {
  assert.equal(composeQaStamp({ ...base, report: report([]) }).error, 'no-stories');
  assert.equal(composeQaStamp({ ...base, report: { summary: {} } }).error, 'no-stories');
  assert.equal(composeQaStamp({ ...base, storyHashes: { 'app.yaml': H1, 'profile.yaml': null }, report: report(GREEN) }).error, 'story-file-unreadable: profile.yaml');
});

const STAMP = composeQaStamp({ ...base, report: report(GREEN) }).stamp;
const SEL = [{ id: 'login', file: 'app.yaml', sha256: H1 }, { id: 'profile', file: 'profile.yaml', sha256: H2 }];

test('decideQaSkip: a stamp at HEAD on a clean tree covering every selected story skips', () => {
  assert.deepEqual(decideQaSkip({ stamp: STAMP, head: HEAD, dirty: false, storiesDir: 'stories', selected: SEL }), { skip: true, reason: 'covered' });
});

test('decideQaSkip: each mismatch runs QA', () => {
  const d = (over) => decideQaSkip({ stamp: STAMP, head: HEAD, dirty: false, storiesDir: 'stories', selected: SEL, ...over });
  assert.deepEqual(d({ stamp: null }), { skip: false, reason: 'no-stamp' });
  assert.deepEqual(d({ head: OTHER }), { skip: false, reason: 'sha-mismatch' });
  assert.deepEqual(d({ dirty: true }), { skip: false, reason: 'dirty-tree' });
  assert.deepEqual(d({ dirty: null }), { skip: false, reason: 'dirty-tree' });
  assert.deepEqual(d({ storiesDir: 'qa/stories' }), { skip: false, reason: 'stories-dir-mismatch' });
  assert.deepEqual(d({ selected: [] }), { skip: false, reason: 'nothing-selected' });
  assert.deepEqual(d({ selected: [...SEL, { id: 'admin', file: 'admin.yaml', sha256: H1 }] }), { skip: false, reason: 'story-not-covered: admin' });
});

test('decideQaSkip: a stamped id under a different file is not covered (Review Focus 2)', () => {
  const r = decideQaSkip({ stamp: STAMP, head: HEAD, dirty: false, storiesDir: 'stories', selected: [{ id: 'login', file: 'other.yaml', sha256: H1 }] });
  assert.deepEqual(r, { skip: false, reason: 'story-not-covered: login' });
});

test('decideQaSkip: a story file edited since the stamp, or now unreadable, runs QA (Review Focus 1)', () => {
  const d = (sha256) => decideQaSkip({ stamp: STAMP, head: HEAD, dirty: false, storiesDir: 'stories', selected: [{ id: 'login', file: 'app.yaml', sha256 }] });
  assert.deepEqual(d(H2), { skip: false, reason: 'story-changed: login' });
  assert.deepEqual(d(null), { skip: false, reason: 'story-changed: login' });
});

test('writeQaStamp/readQaStamp round-trip in the given git dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-qa-stamp-'));
  try {
    const written = writeQaStamp(dir, STAMP);
    assert.equal(written, path.join(dir, QA_STAMP_NAME));
    assert.deepEqual(readQaStamp(dir), STAMP);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readQaStamp: absent, unparseable, or malformed stamps read as null (Review Focus 5)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-qa-stamp-'));
  const put = (v) => fs.writeFileSync(path.join(dir, QA_STAMP_NAME), typeof v === 'string' ? v : JSON.stringify(v));
  try {
    assert.equal(readQaStamp(dir), null);
    put('{not json');
    assert.equal(readQaStamp(dir), null);
    put({ ...STAMP, sha: 'abc' });
    assert.equal(readQaStamp(dir), null);
    put({ ...STAMP, stories: 'login' });
    assert.equal(readQaStamp(dir), null);
    put({ ...STAMP, stories: [{ id: 'login', file: 'app.yaml', sha256: 'zz' }] });
    assert.equal(readQaStamp(dir), null);
    put({ ...STAMP, dirty: true });
    assert.equal(readQaStamp(dir), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
