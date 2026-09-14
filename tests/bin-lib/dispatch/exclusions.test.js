'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  readExclusions, appendExclusion, excludedNumbers, groupIsExcluded,
} = require('../../../plugin/bin/lib/dispatch/exclusions');

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'exclusions-test-')), 'dispatch-exclusions.json');
}

test('readExclusions: absent file returns []', () => {
  const p = tmpFile();
  assert.deepStrictEqual(readExclusions(p), []);
});

test('readExclusions: unreadable/malformed content returns [] rather than throwing', () => {
  const p = tmpFile();
  fs.writeFileSync(p, 'not json');
  assert.deepStrictEqual(readExclusions(p), []);

  const p2 = tmpFile();
  fs.writeFileSync(p2, JSON.stringify({ not: 'an array' }));
  assert.deepStrictEqual(readExclusions(p2), []);
});

test('appendExclusion: creates the file on first call, appends on subsequent calls', () => {
  const p = tmpFile();
  appendExclusion(p, { reason: 'blocked', records: [1], detail: { blockedBy: [2] } });
  assert.deepStrictEqual(readExclusions(p), [{ reason: 'blocked', records: [1], detail: { blockedBy: [2] } }]);

  appendExclusion(p, { reason: 'oversized', records: [3, 4], detail: { size: 11, threshold: 10 } });
  assert.deepStrictEqual(readExclusions(p), [
    { reason: 'blocked', records: [1], detail: { blockedBy: [2] } },
    { reason: 'oversized', records: [3, 4], detail: { size: 11, threshold: 10 } },
  ]);
});

test('excludedNumbers: flattens multiple entries of the requested reasons, ignores other reasons', () => {
  const entries = [
    { reason: 'oversized', records: [1, 2], detail: null },
    { reason: 'firing', records: [3], detail: null },
    { reason: 'firing', records: [4], detail: null },
    { reason: 'blocked', records: [5], detail: null },
  ];
  assert.deepStrictEqual(excludedNumbers(entries, ['oversized', 'firing']), new Set([1, 2, 3, 4]));
  assert.deepStrictEqual(excludedNumbers(entries, ['blocked']), new Set([5]));
  assert.deepStrictEqual(excludedNumbers(entries, ['no-such-reason']), new Set());
});

test('groupIsExcluded: true when ANY bundle member is excluded, not just the first', () => {
  const entries = [{ reason: 'firing', records: [834], detail: null }];
  const bundle = [{ number: 833 }, { number: 834 }];
  assert.equal(groupIsExcluded(bundle, entries, ['firing']), true);
});

test('groupIsExcluded: false when no member is excluded under the requested reasons', () => {
  const entries = [{ reason: 'oversized', records: [100], detail: null }];
  const group = [{ number: 200 }];
  assert.equal(groupIsExcluded(group, entries, ['oversized', 'firing']), false);
});

// AC5: adding a fifth (here: an entirely novel, never-enumerated) reason
// requires no new file or filter logic -- readExclusions returns it
// unconditionally, but excludedNumbers/groupIsExcluded ignore it unless the
// caller explicitly asks for that reason.
test('AC5: an unknown reason round-trips through readExclusions but is only matched when explicitly requested', () => {
  const p = tmpFile();
  appendExclusion(p, { reason: 'future-reason', records: [42], detail: { note: 'not yet a known reason anywhere' } });
  const entries = readExclusions(p);
  assert.deepStrictEqual(entries, [{ reason: 'future-reason', records: [42], detail: { note: 'not yet a known reason anywhere' } }]);

  assert.equal(groupIsExcluded([{ number: 42 }], entries, ['oversized', 'firing']), false);
  assert.equal(groupIsExcluded([{ number: 42 }], entries, ['future-reason']), true);
});
