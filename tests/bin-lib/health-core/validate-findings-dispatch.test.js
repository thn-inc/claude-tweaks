'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { dedupAndDispatch } = require('../../../plugin/bin/lib/health-core/validate-findings-dispatch');

function makeDeps({ decideImpl, cacheContents = {} } = {}) {
  const readCache = () => ({ ...cacheContents });
  const decide = decideImpl || (() => ({ action: 'file' }));
  const toIssuePayload = (finding) => ({ payloadFor: finding.id });
  return { readCache, decide, toIssuePayload };
}

test('dedupAndDispatch reads the cache via the injected readCache(root)', () => {
  let calledWith = null;
  const { decide, toIssuePayload } = makeDeps();
  const readCache = (root) => { calledWith = root; return {}; };
  dedupAndDispatch({
    root: '/some/root', issuesPath: undefined, toolName: 'harness-health', survivors: [],
    readCache, decide, toIssuePayload,
  });
  assert.strictEqual(calledWith, '/some/root');
});

test('dedupAndDispatch passes an injected stderr through to the issue-index diagnostics', () => {
  let err = '';
  const { readCache, decide, toIssuePayload } = makeDeps();
  dedupAndDispatch({
    root: '/r', issuesPath: '/nonexistent/issues.json', toolName: 'harness-health', survivors: [],
    readCache, decide, toIssuePayload, stderr: (t) => { err += t; },
  });
  assert.match(err, /^\[harness-health\] validate-findings: could not read or parse --issues file/);
});

test('dedupAndDispatch skips a finding when decide returns action: "skip"', () => {
  const { readCache, toIssuePayload } = makeDeps({ decideImpl: () => ({ action: 'skip' }) });
  const result = dedupAndDispatch({
    root: '/r', toolName: 't', survivors: [{ id: 'f1' }], readCache, decide: () => ({ action: 'skip' }), toIssuePayload,
  });
  assert.deepStrictEqual(result.payloads, []);
});

test('dedupAndDispatch skips a finding when decide returns action: "suppress"', () => {
  const { readCache, toIssuePayload } = makeDeps();
  const result = dedupAndDispatch({
    root: '/r', toolName: 't', survivors: [{ id: 'f1' }], readCache, decide: () => ({ action: 'suppress' }), toIssuePayload,
  });
  assert.deepStrictEqual(result.payloads, []);
});

test('dedupAndDispatch emits a payload and stages the cache entry when decide returns action: "file"', () => {
  const { readCache, toIssuePayload } = makeDeps();
  const result = dedupAndDispatch({
    root: '/r', toolName: 't', survivors: [{ id: 'f1' }], readCache, decide: () => ({ action: 'file' }), toIssuePayload,
  });
  assert.strictEqual(result.payloads.length, 1);
  assert.deepStrictEqual(result.payloads[0], { payloadFor: 'f1' });
  assert.strictEqual(result.cache.f1.status, 'staged');
});

test('dedupAndDispatch emits a payload and marks the cache entry "regressed" when decide returns action: "reopen"', () => {
  const { readCache, toIssuePayload } = makeDeps();
  const result = dedupAndDispatch({
    root: '/r', toolName: 't', survivors: [{ id: 'f1' }], readCache,
    decide: () => ({ action: 'reopen', issue: 42 }), toIssuePayload,
  });
  assert.strictEqual(result.payloads.length, 1);
  assert.strictEqual(result.cache.f1.status, 'regressed');
  assert.strictEqual(result.cache.f1.issue, 42);
});

test('dedupAndDispatch de-dupes findings sharing the same id within one batch', () => {
  const { readCache, toIssuePayload } = makeDeps();
  const result = dedupAndDispatch({
    root: '/r', toolName: 't', survivors: [{ id: 'dup' }, { id: 'dup' }], readCache,
    decide: () => ({ action: 'file' }), toIssuePayload,
  });
  assert.strictEqual(result.payloads.length, 1, 'the second occurrence of the same id must not emit a second payload');
  assert.deepStrictEqual([...result.seen], ['dup']);
});

test('dedupAndDispatch returns seen as the Set of every processed fingerprint, including skipped ones', () => {
  const { readCache, toIssuePayload } = makeDeps();
  const decide = (finding) => (finding.id === 'skip-me' ? { action: 'skip' } : { action: 'file' });
  const result = dedupAndDispatch({
    root: '/r', toolName: 't', survivors: [{ id: 'skip-me' }, { id: 'keep-me' }], readCache, decide, toIssuePayload,
  });
  assert.deepStrictEqual([...result.seen].sort(), ['keep-me', 'skip-me']);
  assert.strictEqual(result.payloads.length, 1);
});

test('dedupAndDispatch collects a wontfix-label suppression into wontfixSuppressed', () => {
  const { readCache, toIssuePayload } = makeDeps();
  const result = dedupAndDispatch({
    root: '/r', toolName: 't', survivors: [{ id: 'f1' }], readCache,
    decide: () => ({ action: 'suppress', issue: 7, reason: 'wontfix-label' }), toIssuePayload,
  });
  assert.deepStrictEqual(result.payloads, []);
  assert.deepStrictEqual(result.wontfixSuppressed, ['f1']);
});

test('dedupAndDispatch does NOT collect a declined suppression into wontfixSuppressed', () => {
  // A `declined` suppression already lives durably (it is read back out of the
  // health-state branch), so re-persisting it would be a pointless write. Only
  // the label reading — which exists nowhere but the live issue index — needs
  // the hand-off.
  const { readCache, toIssuePayload } = makeDeps();
  const result = dedupAndDispatch({
    root: '/r', toolName: 't', survivors: [{ id: 'f1' }], readCache,
    decide: () => ({ action: 'suppress', reason: 'declined' }), toIssuePayload,
  });
  assert.deepStrictEqual(result.wontfixSuppressed, []);
});

test('dedupAndDispatch gates wontfixSuppressed on the explicit reason, not on the presence of an issue number', () => {
  // Guards against re-deriving provenance from `issue` being truthy — a
  // suppress carrying an issue number but no reason must not be persisted.
  const { readCache, toIssuePayload } = makeDeps();
  const result = dedupAndDispatch({
    root: '/r', toolName: 't', survivors: [{ id: 'f1' }], readCache,
    decide: () => ({ action: 'suppress', issue: 7 }), toIssuePayload,
  });
  assert.deepStrictEqual(result.wontfixSuppressed, []);
});

test('dedupAndDispatch returns an empty wontfixSuppressed when nothing was suppressed by label', () => {
  const { readCache, toIssuePayload } = makeDeps();
  const result = dedupAndDispatch({
    root: '/r', toolName: 't', survivors: [{ id: 'f1' }], readCache,
    decide: () => ({ action: 'file' }), toIssuePayload,
  });
  assert.deepStrictEqual(result.wontfixSuppressed, []);
});

test('dedupAndDispatch threads verifiedAsOf through to toIssuePayload as its second argument (#117)', () => {
  const { readCache } = makeDeps();
  let receivedSecondArg;
  const toIssuePayload = (finding, verifiedAsOf) => { receivedSecondArg = verifiedAsOf; return { payloadFor: finding.id }; };
  dedupAndDispatch({
    root: '/r', toolName: 't', survivors: [{ id: 'f1' }], readCache,
    decide: () => ({ action: 'file' }), toIssuePayload, verifiedAsOf: 'abc1234',
  });
  assert.strictEqual(receivedSecondArg, 'abc1234');
});

test('dedupAndDispatch passes verifiedAsOf through as undefined when the caller omits it — never re-derives it', () => {
  const { readCache } = makeDeps();
  let receivedSecondArg = 'unset';
  const toIssuePayload = (finding, verifiedAsOf) => { receivedSecondArg = verifiedAsOf; return { payloadFor: finding.id }; };
  dedupAndDispatch({
    root: '/r', toolName: 't', survivors: [{ id: 'f1' }], readCache,
    decide: () => ({ action: 'file' }), toIssuePayload,
  });
  assert.strictEqual(receivedSecondArg, undefined);
});

test('dedupAndDispatch passes issuesPath and toolName through to loadIssueIndex (a malformed --issues file degrades gracefully)', () => {
  const { readCache, toIssuePayload } = makeDeps();
  // loadIssueIndex (bin/lib/health-core/issue-index.js) already degrades a
  // missing/malformed issuesPath to an empty index rather than throwing —
  // this just proves dedupAndDispatch's own plumbing reaches it correctly
  // (a nonexistent path) without dedupAndDispatch itself needing to guard.
  const result = dedupAndDispatch({
    root: '/r', issuesPath: '/nonexistent/issues.json', toolName: 'harness-health',
    survivors: [{ id: 'f1' }], readCache, decide: () => ({ action: 'file' }), toIssuePayload,
  });
  assert.strictEqual(result.payloads.length, 1);
});
