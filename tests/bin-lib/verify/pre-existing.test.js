'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { matchPreExisting } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'pre-existing.js'));

const PRE_EXISTING = ['tests/a.test.js', 'tests/b.test.js'];

test('matchPreExisting: every failing file covered by the allowlist is eligible, matched deduped (#3129)', () => {
  const verdict = matchPreExisting({ failingFiles: ['tests/b.test.js', 'tests/a.test.js', 'tests/a.test.js'], preExisting: PRE_EXISTING });
  assert.deepStrictEqual(verdict, { eligible: true, matched: ['tests/b.test.js', 'tests/a.test.js'] });
});

test('matchPreExisting: any uncovered failing file is not eligible, and the reason names every uncovered file (#3129)', () => {
  const verdict = matchPreExisting({ failingFiles: ['tests/a.test.js', 'tests/real.test.js', 'tests/other.test.js'], preExisting: PRE_EXISTING });
  assert.strictEqual(verdict.eligible, false);
  assert.strictEqual(verdict.reason, 'unlisted: [tests/real.test.js, tests/other.test.js]');
  assert.deepStrictEqual(verdict.unmatched, ['tests/real.test.js', 'tests/other.test.js']);
});

test('matchPreExisting: empty failingFiles is no-parse — never adjudicated as covered (#3129)', () => {
  assert.deepStrictEqual(matchPreExisting({ failingFiles: [], preExisting: PRE_EXISTING }), { eligible: false, reason: 'no-parse' });
});

test('matchPreExisting: an empty or absent allowlist is not-declared — never silently waives anything (#3129)', () => {
  assert.deepStrictEqual(matchPreExisting({ failingFiles: ['tests/a.test.js'], preExisting: [] }), { eligible: false, reason: 'not-declared' });
  assert.deepStrictEqual(matchPreExisting({ failingFiles: ['tests/a.test.js'], preExisting: null }), { eligible: false, reason: 'not-declared' });
  assert.deepStrictEqual(matchPreExisting({ failingFiles: ['tests/a.test.js'] }), { eligible: false, reason: 'not-declared' });
});

test('matchPreExisting: entries are globs, reusing the same engine rules[].match/flaky.files use (#3129)', () => {
  // '**' spans path segments.
  const globAllowlist = ['tests/known-shallow/**'];
  const globVerdict = matchPreExisting({ failingFiles: ['tests/known-shallow/new-file.test.js'], preExisting: globAllowlist });
  assert.strictEqual(globVerdict.eligible, true);

  // An entry with no glob metacharacter still matches only itself.
  const exactVerdict = matchPreExisting({ failingFiles: ['tests/a.test.js', 'tests/c.test.js'], preExisting: PRE_EXISTING });
  assert.strictEqual(exactVerdict.eligible, false);
  assert.deepStrictEqual(exactVerdict.unmatched, ['tests/c.test.js']);

  // '*' stays segment-bound — it does not match a nested file.
  const segmentBound = ['tests/*.test.js'];
  const nestedVerdict = matchPreExisting({ failingFiles: ['tests/known-shallow/nested.test.js'], preExisting: segmentBound });
  assert.strictEqual(nestedVerdict.eligible, false);
  assert.deepStrictEqual(nestedVerdict.unmatched, ['tests/known-shallow/nested.test.js']);
});
