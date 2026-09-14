'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { composeBrainstormingArgs, CONSOLIDATION_SENTENCE } = require('../../../plugin/bin/lib/specify/brainstorming-ceremony');

test('fast-lane prepends the consolidation sentence, separated by a blank line', () => {
  const result = composeBrainstormingArgs('Record #142: some title\n\nSome body text.', 'fast-lane');
  assert.equal(result, `${CONSOLIDATION_SENTENCE}\n\nRecord #142: some title\n\nSome body text.`);
});

test('standard leaves the input byte-identical', () => {
  const input = 'Record #142: some title\n\nSome body text.';
  assert.equal(composeBrainstormingArgs(input, 'standard'), input);
});

test('an unset/unknown value also leaves the input byte-identical (fail-safe: only the literal fast-lane triggers the prefix)', () => {
  const input = 'a bare topic string';
  assert.equal(composeBrainstormingArgs(input, undefined), input);
  assert.equal(composeBrainstormingArgs(input, ''), input);
  assert.equal(composeBrainstormingArgs(input, 'not-a-real-value'), input);
});

test('CONSOLIDATION_SENTENCE never claims to skip the final approval gate', () => {
  assert.ok(!/skip|remove|bypass/i.test(CONSOLIDATION_SENTENCE), 'consolidation sentence must not claim to skip/remove/bypass any approval gate');
  assert.match(CONSOLIDATION_SENTENCE, /approval/i);
});
