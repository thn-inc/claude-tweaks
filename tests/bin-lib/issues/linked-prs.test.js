'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { fetchLinkedPRs } = require('../../../plugin/bin/lib/issues/linked-prs');

const resp = (repository) => JSON.stringify({ data: { repository } });

test('fetchLinkedPRs maps each alias to its open linked PR number', () => {
  const runner = () => resp({
    i1224: { number: 1224, closedByPullRequestsReferences: { nodes: [{ number: 1572, state: 'OPEN' }] } },
    i257: { number: 257, closedByPullRequestsReferences: { nodes: [{ number: 900, state: 'MERGED' }] } },
  });
  const out = fetchLinkedPRs({ numbers: [1224, 257], owner: 'o', repo: 'r', runner });
  assert.deepStrictEqual(out.get(1224), { openPR: 1572, mentions: [] });
  assert.deepStrictEqual(out.get(257), { openPR: null, mentions: [] });
});

test('no linked PR at all reports openPR: null', () => {
  const runner = () => resp({ i42: { number: 42, closedByPullRequestsReferences: { nodes: [] } } });
  const out = fetchLinkedPRs({ numbers: [42], owner: 'o', repo: 'r', runner });
  assert.deepStrictEqual(out.get(42), { openPR: null, mentions: [] });
});

test('a missing alias throws rather than returning a partial map', () => {
  const runner = () => resp({ i1224: { number: 1224, closedByPullRequestsReferences: { nodes: [] } } });
  assert.throws(() => fetchLinkedPRs({ numbers: [1224, 257], owner: 'o', repo: 'r', runner }), /missing linked-PR data for #257/);
});

test('null repository throws rather than returning a partial map', () => {
  const runner = () => JSON.stringify({ data: { repository: null }, errors: [{ message: 'boom' }] });
  assert.throws(() => fetchLinkedPRs({ numbers: [5], owner: 'o', repo: 'r', runner }), /boom|missing repository/);
});

test('a malformed nodes array (not an array) degrades to openPR: null rather than throwing', () => {
  const runner = () => resp({ i9: { number: 9, closedByPullRequestsReferences: { nodes: 'not-an-array' } } });
  assert.doesNotThrow(() => fetchLinkedPRs({ numbers: [9], owner: 'o', repo: 'r', runner }));
});

test('empty input returns empty result without calling the runner', () => {
  const out = fetchLinkedPRs({ numbers: [], owner: 'o', repo: 'r', runner: () => { throw new Error('must not run'); } });
  assert.strictEqual(out.size, 0);
});

// ── cross-reference timeline / mentions (#1984) ─────────────────────────────

test('a same-repo PR mention (no closing keyword) is returned in mentions', () => {
  const runner = () => resp({
    i1791: {
      number: 1791,
      closedByPullRequestsReferences: { nodes: [] },
      timelineItems: {
        nodes: [
          { source: { number: 1803, title: 'Fix context.js resolveRun fallback', state: 'MERGED', merged: true, mergedAt: '2026-09-03T00:00:00Z', repository: { nameWithOwner: 'o/r' } } },
        ],
      },
    },
  });
  const out = fetchLinkedPRs({ numbers: [1791], owner: 'o', repo: 'r', runner });
  assert.deepStrictEqual(out.get(1791), {
    openPR: null,
    mentions: [{ number: 1803, title: 'Fix context.js resolveRun fallback', state: 'MERGED', merged: true, mergedAt: '2026-09-03T00:00:00Z' }],
  });
});

test('a cross-repo mention (different nameWithOwner) is filtered out', () => {
  const runner = () => resp({
    i5: {
      number: 5,
      closedByPullRequestsReferences: { nodes: [] },
      timelineItems: { nodes: [{ source: { number: 99, title: 'unrelated fork PR', state: 'MERGED', merged: true, mergedAt: '2026-01-01T00:00:00Z', repository: { nameWithOwner: 'someone-else/fork' } } }] },
    },
  });
  const out = fetchLinkedPRs({ numbers: [5], owner: 'o', repo: 'r', runner });
  assert.deepStrictEqual(out.get(5).mentions, []);
});

test('a non-PR cross-reference source (an Issue, not a PullRequest) resolves to null and is dropped', () => {
  const runner = () => resp({
    i5: {
      number: 5,
      closedByPullRequestsReferences: { nodes: [] },
      timelineItems: { nodes: [{ source: null }] },
    },
  });
  const out = fetchLinkedPRs({ numbers: [5], owner: 'o', repo: 'r', runner });
  assert.deepStrictEqual(out.get(5).mentions, []);
});

test('a missing timelineItems field (older query response shape) degrades to mentions: [] rather than throwing', () => {
  const runner = () => resp({ i5: { number: 5, closedByPullRequestsReferences: { nodes: [] } } });
  assert.deepStrictEqual(fetchLinkedPRs({ numbers: [5], owner: 'o', repo: 'r', runner }).get(5), { openPR: null, mentions: [] });
});
