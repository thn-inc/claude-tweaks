// tests/bin-lib/issues/sibling-premise.test.js — #2590: pure scan function
// that detects a closed PR whose body already states the same record's
// premise was disproved by a sibling attempt.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { findSiblingPremiseDisproof, SIBLING_PREMISE_PATTERN } = require('../../../plugin/bin/lib/issues/sibling-premise');

test('findSiblingPremiseDisproof: empty/no-match list returns null', () => {
  assert.strictEqual(findSiblingPremiseDisproof([]), null);
  assert.strictEqual(findSiblingPremiseDisproof(null), null);
  assert.strictEqual(findSiblingPremiseDisproof([{ number: 1, url: 'https://x/1', body: 'unrelated PR body' }]), null);
});

test('findSiblingPremiseDisproof: a PR body stating "premise no longer holds" matches', () => {
  const prs = [
    { number: 1, url: 'https://x/1', body: 'Nothing to see here.' },
    { number: 2560, url: 'https://x/2560', body: 'Conclusion: premise no longer holds — all 9 tests pass.' },
  ];
  const result = findSiblingPremiseDisproof(prs);
  assert.deepStrictEqual(result, { number: 2560, url: 'https://x/2560', matchedPhrase: 'premise no longer holds' });
});

test('findSiblingPremiseDisproof: "premise already resolved"/"already satisfied"/"already disproved" all match, case-insensitively', () => {
  for (const phrase of ['premise already resolved', 'Premise Already Satisfied', 'premise already disproved']) {
    const result = findSiblingPremiseDisproof([{ number: 9, url: 'https://x/9', body: `Text. ${phrase}. More text.` }]);
    assert.ok(result, phrase);
    assert.strictEqual(result.number, 9, phrase);
  }
});

test('findSiblingPremiseDisproof: returns the FIRST matching PR when multiple match', () => {
  const prs = [
    { number: 1, url: 'https://x/1', body: 'premise no longer holds' },
    { number: 2, url: 'https://x/2', body: 'premise already resolved' },
  ];
  assert.strictEqual(findSiblingPremiseDisproof(prs).number, 1);
});

test('findSiblingPremiseDisproof: a PR with a non-string body is skipped, not thrown', () => {
  const prs = [{ number: 1, url: 'https://x/1', body: null }, { number: 2, url: 'https://x/2', body: 'premise no longer holds' }];
  assert.strictEqual(findSiblingPremiseDisproof(prs).number, 2);
});

test('SIBLING_PREMISE_PATTERN is exported as a RegExp', () => {
  assert.ok(SIBLING_PREMISE_PATTERN instanceof RegExp);
});
