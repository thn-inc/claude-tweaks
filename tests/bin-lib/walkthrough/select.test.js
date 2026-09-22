'use strict';
// tests/bin-lib/walkthrough/select.test.js — #2758: pure story selection, no gh/fs reads.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectStories } = require('../../../plugin/bin/lib/walkthrough/select');

const STORY_FILES = [
  { path: 'stories/checkout.yaml', stories: [{ id: 'checkout-happy-path', journey: 'checkout', source_files: ['src/checkout.ts'] }] },
  { path: 'stories/profile.yaml', stories: [{ id: 'profile-edit', journey: 'profile', source_files: ['src/profile.ts'] }] },
  { path: 'stories/both.yaml', stories: [{ id: 'both-match', journey: 'checkout', source_files: ['src/checkout.ts'] }] },
];

test('selectStories: zero matches returns an empty list', () => {
  const result = selectStories({ recordKeyFiles: ['src/unrelated.ts'], recordJourneys: [], storyFiles: STORY_FILES });
  assert.deepEqual(result, []);
});

test('selectStories: exactly one match by source_files', () => {
  const result = selectStories({ recordKeyFiles: ['src/profile.ts'], recordJourneys: [], storyFiles: STORY_FILES });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'profile-edit');
  assert.equal(result[0].matchedBy, 'source_files');
});

test('selectStories: exactly one match by journey', () => {
  const result = selectStories({ recordKeyFiles: [], recordJourneys: ['profile'], storyFiles: STORY_FILES });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'profile-edit');
  assert.equal(result[0].matchedBy, 'journey');
});

test('selectStories: two matches (both fields) returns both entries with matchedBy naming the field', () => {
  const result = selectStories({ recordKeyFiles: ['src/checkout.ts'], recordJourneys: [], storyFiles: STORY_FILES });
  const ids = result.map((r) => r.id).sort();
  assert.deepEqual(ids, ['both-match', 'checkout-happy-path']);
  for (const r of result) assert.equal(r.matchedBy, 'source_files');
});

test('selectStories: a story matching by both fields reports matchedBy "source_files+journey"', () => {
  const result = selectStories({ recordKeyFiles: ['src/checkout.ts'], recordJourneys: ['checkout'], storyFiles: STORY_FILES });
  const both = result.find((r) => r.id === 'both-match');
  assert.equal(both.matchedBy, 'source_files+journey');
});

test('selectStories: is pure — the same input called twice returns deep-equal results', () => {
  const args = { recordKeyFiles: ['src/checkout.ts'], recordJourneys: [], storyFiles: STORY_FILES };
  assert.deepEqual(selectStories(args), selectStories(args));
});
