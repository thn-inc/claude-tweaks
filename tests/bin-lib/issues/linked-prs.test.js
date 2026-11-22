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
  assert.deepStrictEqual(out.get(1224), { openPR: 1572, mentions: [], hasClosingPRReference: true, issueState: null, lastShapedAt: null });
  assert.deepStrictEqual(out.get(257), { openPR: null, mentions: [], hasClosingPRReference: true, issueState: null, lastShapedAt: null });
});

// #2240: a non-github.com host threads --hostname onto this call — the only
// gh-invoking call resolve-linked-prs.js makes.
test('#2240: fetchLinkedPRs passes --hostname on a non-github.com host, omits it for github.com/unset', () => {
  const response = () => resp({ i1224: { number: 1224, closedByPullRequestsReferences: { nodes: [] } } });
  const ghe = []; const dotcom = []; const unset = [];
  fetchLinkedPRs({
    numbers: [1224], owner: 'o', repo: 'r', host: 'ghe.example.com', runner: (args) => { ghe.push(args); return response(); },
  });
  fetchLinkedPRs({
    numbers: [1224], owner: 'o', repo: 'r', host: 'github.com', runner: (args) => { dotcom.push(args); return response(); },
  });
  fetchLinkedPRs({
    numbers: [1224], owner: 'o', repo: 'r', runner: (args) => { unset.push(args); return response(); },
  });
  assert.deepStrictEqual(ghe[0].slice(-2), ['--hostname', 'ghe.example.com']);
  assert.doesNotMatch(dotcom[0].join(' '), /--hostname/);
  assert.doesNotMatch(unset[0].join(' '), /--hostname/);
});

test('no linked PR at all reports openPR: null', () => {
  const runner = () => resp({ i42: { number: 42, closedByPullRequestsReferences: { nodes: [] } } });
  const out = fetchLinkedPRs({ numbers: [42], owner: 'o', repo: 'r', runner });
  assert.deepStrictEqual(out.get(42), { openPR: null, mentions: [], hasClosingPRReference: false, issueState: null, lastShapedAt: null });
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
  const out = fetchLinkedPRs({ numbers: [9], owner: 'o', repo: 'r', runner });
  assert.deepStrictEqual(out.get(9), { openPR: null, mentions: [], hasClosingPRReference: false, issueState: null, lastShapedAt: null });
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
          { source: { number: 1803, title: 'Fix context.js resolveRun fallback', state: 'MERGED', createdAt: '2026-09-02T00:00:00Z', merged: true, mergedAt: '2026-09-03T00:00:00Z', repository: { nameWithOwner: 'o/r' } } },
        ],
      },
    },
  });
  const out = fetchLinkedPRs({ numbers: [1791], owner: 'o', repo: 'r', runner });
  assert.deepStrictEqual(out.get(1791), {
    openPR: null,
    mentions: [{ number: 1803, title: 'Fix context.js resolveRun fallback', state: 'MERGED', merged: true, mergedAt: '2026-09-03T00:00:00Z', createdAt: '2026-09-02T00:00:00Z' }],
    hasClosingPRReference: false,
    issueState: null,
    lastShapedAt: null,
  });
});

test('AC3.1: #4314 fetchLinkedPRs returns the mentioning PR createdAt on each mention, null when the response lacks it', () => {
  const runner = () => resp({
    i4300: {
      number: 4300,
      closedByPullRequestsReferences: { nodes: [] },
      timelineItems: {
        nodes: [
          { source: { number: 4035, title: 'Earlier PR', state: 'MERGED', createdAt: '2026-10-24T08:24:28Z', merged: true, mergedAt: '2026-10-24T09:00:00Z', repository: { nameWithOwner: 'o/r' } } },
          { source: { number: 4144, title: 'No createdAt', state: 'MERGED', merged: true, mergedAt: '2026-10-24T10:00:00Z', repository: { nameWithOwner: 'o/r' } } },
        ],
      },
    },
  });
  const out = fetchLinkedPRs({ numbers: [4300], owner: 'o', repo: 'r', runner });
  assert.deepStrictEqual(out.get(4300).mentions.map((m) => m.createdAt), ['2026-10-24T08:24:28Z', null]);
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
  assert.deepStrictEqual(fetchLinkedPRs({ numbers: [5], owner: 'o', repo: 'r', runner }).get(5), { openPR: null, mentions: [], hasClosingPRReference: false, issueState: null, lastShapedAt: null });
});

test('#2676: a non-empty closedByPullRequestsReferences connection reports hasClosingPRReference: true regardless of that PR\'s own state', () => {
  const runner = () => resp({ i42: { number: 42, closedByPullRequestsReferences: { nodes: [{ number: 100, state: 'MERGED' }] } } });
  const out = fetchLinkedPRs({ numbers: [42], owner: 'o', repo: 'r', runner });
  assert.equal(out.get(42).hasClosingPRReference, true);
});

// #2934 — the issue's own `state` (distinct from `mentions[].state`, which is
// a PR's state) passes through from the batched query so the carrier-commit
// fallback can read it instead of running `gh issue view` per issue.
test('#2934: the issue node\'s own state passes through as issueState', () => {
  const runner = () => resp({
    i42: { number: 42, state: 'CLOSED', closedByPullRequestsReferences: { nodes: [{ number: 100, state: 'MERGED' }] } },
  });
  const out = fetchLinkedPRs({ numbers: [42], owner: 'o', repo: 'r', runner });
  assert.equal(out.get(42).issueState, 'CLOSED');
});

test('#2934: a missing issue state on the batched response reports issueState: null', () => {
  const runner = () => resp({ i42: { number: 42, closedByPullRequestsReferences: { nodes: [] } } });
  const out = fetchLinkedPRs({ numbers: [42], owner: 'o', repo: 'r', runner });
  assert.equal(out.get(42).issueState, null);
});

// ── lastShapedAt: the latest ready/auto:build label time (#5722) ─────────────

const labelNode = (events) => ({ number: 7, closedByPullRequestsReferences: { nodes: [] }, labelEvents: { nodes: events } });
const shapedAt = (events) => fetchLinkedPRs({ numbers: [7], owner: 'o', repo: 'r', runner: () => resp({ i7: labelNode(events) }) }).get(7).lastShapedAt;

test('AC1.1: #5689\'s real label timeline gives lastShapedAt 2026-11-16T10:51:03Z', () => {
  assert.strictEqual(shapedAt([
    { createdAt: '2026-11-16T10:50:38Z', label: { name: 'risk:low' } },
    { createdAt: '2026-11-16T10:50:38Z', label: { name: 'ready' } },
    { createdAt: '2026-11-16T10:51:03Z', label: { name: 'auto:build' } },
    { createdAt: '2026-11-16T10:58:00Z', label: { name: 'bot:in-progress' } },
  ]), '2026-11-16T10:51:03Z');
});

test('#5722: lastShapedAt ignores labels other than ready and auto:build', () => {
  assert.strictEqual(shapedAt([
    { createdAt: '2026-11-16T10:58:00Z', label: { name: 'bot:in-progress' } },
    { createdAt: '2026-11-16T10:50:38Z', label: { name: 'risk:low' } },
  ]), null);
});

test('#5722: a null label or unparseable createdAt is skipped', () => {
  assert.strictEqual(shapedAt([
    { createdAt: '2026-11-16T12:00:00Z', label: null },
    { createdAt: 'not-a-date', label: { name: 'ready' } },
    { createdAt: '2026-11-16T09:00:00Z', label: { name: 'auto:build' } },
  ]), '2026-11-16T09:00:00Z');
});

// The unparseable event comes AFTER a valid one, and then alone: an order-dependent or missing
// NaN guard would let it overwrite the valid time, or report it as the answer.
test('#5722: an unparseable createdAt after a valid shaping event never replaces it', () => {
  assert.strictEqual(shapedAt([
    { createdAt: '2026-11-16T09:00:00Z', label: { name: 'auto:build' } },
    { createdAt: 'not-a-date', label: { name: 'ready' } },
  ]), '2026-11-16T09:00:00Z');
});

test('#5722: an unparseable createdAt as the only shaping event gives lastShapedAt null', () => {
  assert.strictEqual(shapedAt([{ createdAt: 'not-a-date', label: { name: 'ready' } }]), null);
});

test('#5722: two shaping events at the same instant keep the first one\'s string', () => {
  assert.strictEqual(shapedAt([
    { createdAt: '2026-11-16T10:51:03Z', label: { name: 'ready' } },
    { createdAt: '2026-11-16T10:51:03.000Z', label: { name: 'auto:build' } },
  ]), '2026-11-16T10:51:03Z');
});

test('#5722: lastShapedAt compares instants, not strings', () => {
  // 13:00+02:00 is 11:00Z — earlier than 12:00Z, though it sorts later as a string.
  assert.strictEqual(shapedAt([
    { createdAt: '2026-11-16T13:00:00+02:00', label: { name: 'ready' } },
    { createdAt: '2026-11-16T12:00:00Z', label: { name: 'auto:build' } },
  ]), '2026-11-16T12:00:00Z');
});

test('#5722: no labelEvents connection gives lastShapedAt null', () => {
  const runner = () => resp({ i7: { number: 7, closedByPullRequestsReferences: { nodes: [] } } });
  assert.strictEqual(fetchLinkedPRs({ numbers: [7], owner: 'o', repo: 'r', runner }).get(7).lastShapedAt, null);
});
