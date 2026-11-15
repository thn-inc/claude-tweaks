const { test } = require('node:test');
const assert = require('node:assert');
const { decide, RISK_RANK } = require('../../../plugin/bin/lib/code-health/dedup');

// issueIndex shape (contract): { "<fingerprint>": { number, state, labels } }
const F = (id, risk = 'high') => ({ id, risk });

test('RISK_RANK orders high as most urgent', () => {
  assert.ok(RISK_RANK.high < RISK_RANK.medium);
  assert.ok(RISK_RANK.medium < RISK_RANK.low);
});

test('open issue with same fingerprint -> skip', () => {
  const index = { 'codehealth-aaa': { number: 7, state: 'open', labels: ['bug'] } };
  assert.deepStrictEqual(decide(F('codehealth-aaa'), index, {}), { action: 'skip', issue: 7 });
});

test('closed non-wontfix issue with same fingerprint -> reopen (regressed)', () => {
  const index = { 'codehealth-bbb': { number: 8, state: 'closed', labels: ['bug'] } };
  const result = decide(F('codehealth-bbb'), index, {});
  assert.strictEqual(result.action, 'reopen');
  assert.strictEqual(result.issue, 8);
  assert.ok(typeof result.note === 'string' && result.note.length > 0, 'note should be a non-empty string');
});

test('wontfix-labelled issue -> suppress (standing decision), tagged reason: wontfix-label so the caller can persist it durably (#171)', () => {
  const index = { 'codehealth-ccc': { number: 9, state: 'open', labels: ['bug', 'wontfix'] } };
  assert.deepStrictEqual(decide(F('codehealth-ccc'), index, {}), { action: 'suppress', issue: 9, reason: 'wontfix-label' });
});

test('wontfix in cache, no issue on record -> suppress with issue: null', () => {
  assert.deepStrictEqual(decide(F('codehealth-ddd'), {}, { 'codehealth-ddd': { status: 'wontfix', issue: null } }),
    { action: 'suppress', issue: null });
});

test('wontfix in cache with a known issue number -> suppress carries that issue number through (regression: the cache-fallback suppress path used to silently drop it, unlike the issueIndex-match suppress path)', () => {
  assert.deepStrictEqual(
    decide(F('codehealth-ddd-2'), {}, { 'codehealth-ddd-2': { status: 'wontfix', issue: 42 } }),
    { action: 'suppress', issue: 42 },
  );
});

test('new finding at/above threshold -> file', () => {
  assert.deepStrictEqual(decide(F('codehealth-eee', 'high'), {}, {}), { action: 'file' });
});

test('new finding below threshold -> remember', () => {
  assert.deepStrictEqual(decide(F('codehealth-fff', 'medium'), {}, {}), { action: 'remember' });
  assert.deepStrictEqual(decide(F('codehealth-fff', 'low'), {}, {}), { action: 'remember' });
});

test('threshold is overridable', () => {
  assert.deepStrictEqual(decide(F('codehealth-ggg', 'medium'), {}, {}, { threshold: 'medium' }), { action: 'file' });
});

test('decide uses finding.id over finding.fingerprint when both are present (regression: finding.id is the derived/trusted key; finding.fingerprint is unvalidated echoed-back input and must not override it)', () => {
  const finding = { id: 'codehealth-hhh', fingerprint: 'wrong-key', risk: 'high' };
  const index = { 'codehealth-hhh': { number: 11, state: 'open', labels: [] } };
  assert.deepStrictEqual(decide(finding, index, {}), { action: 'skip', issue: 11 });
});

test('decide falls back to finding.id when finding.fingerprint is absent', () => {
  const finding = { id: 'codehealth-iii', risk: 'high' };
  const index = { 'codehealth-iii': { number: 12, state: 'open', labels: [] } };
  assert.deepStrictEqual(decide(finding, index, {}), { action: 'skip', issue: 12 });
});

// #171 — durable twin of the cache-level wontfix check: honors a wontfix
// suppression persisted on an earlier firing (health-state branch's
// `declined` slice) even when the local cache is empty (a fresh
// scheduled-Routine container) and no live issueIndex match exists this run.
test('durable declined match, empty local cache, no issueIndex match -> suppress with issue: null', () => {
  const durableDeclined = { 'codehealth-jjj': { lastSeenMs: 123, origin: 'wontfix-label' } };
  assert.deepStrictEqual(
    decide(F('codehealth-jjj'), {}, {}, { durableDeclined }),
    { action: 'suppress', issue: null },
  );
});

test('durable declined is consulted only after the local cache and issueIndex — an issueIndex match still wins', () => {
  const durableDeclined = { 'codehealth-kkk': { lastSeenMs: 123, origin: 'wontfix-label' } };
  const index = { 'codehealth-kkk': { number: 13, state: 'open', labels: [] } };
  assert.deepStrictEqual(
    decide(F('codehealth-kkk'), index, {}, { durableDeclined }),
    { action: 'skip', issue: 13 },
  );
});

test('no durableDeclined match and no cache/issueIndex match -> falls through to threshold logic as before (backward compatible)', () => {
  assert.deepStrictEqual(
    decide(F('codehealth-lll', 'high'), {}, {}, { durableDeclined: {} }),
    { action: 'file' },
  );
});

test('durableDeclined omitted entirely (opts has no durableDeclined key) -> behaves exactly as before this fix', () => {
  assert.deepStrictEqual(decide(F('codehealth-mmm', 'high'), {}, {}, { threshold: 'high' }), { action: 'file' });
});

test('AC4.1: an uppercase CLOSED state with no wontfix label -> reopen', () => {
  const index = { 'codehealth-upper': { number: 8, state: 'CLOSED', labels: [] } };
  const result = decide(F('codehealth-upper'), index, {});
  assert.strictEqual(result.action, 'reopen');
  assert.strictEqual(result.issue, 8);
});
