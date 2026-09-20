// tests/bin-lib/hooks/contract-retries.test.js — #1936: the session-scoped
// per-agent one-retry-cap counter backing subagent-stop.js's forced in-run
// retry. Mirrors tests/bin-lib/model-profiles/session-failures.test.js's
// unique-session-id-per-test + cleanup convention, since contract-retries.js
// deliberately mirrors that module's session-scoped blacklist-file shape.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  retriesPath, readRetried, recordRetry,
} = require('../../../plugin/bin/lib/hooks/contract-retries');

function cleanup(sessionId) {
  const p = retriesPath(sessionId);
  if (p) { try { fs.unlinkSync(p); } catch { /* already absent */ } }
}

test('retriesPath is null for a missing/blank session id, a real path otherwise', () => {
  assert.strictEqual(retriesPath(undefined), null);
  assert.strictEqual(retriesPath(''), null);
  assert.strictEqual(retriesPath('  '), null);
  assert.strictEqual(retriesPath('abc-123'), path.join(os.tmpdir(), 'ct-contract-retries-abc-123.json'));
});

test('readRetried returns an empty set when no file exists', () => {
  const id = `cr-test-empty-${process.pid}`;
  cleanup(id);
  assert.deepStrictEqual(readRetried(id), new Set());
});

test('readRetried degrades to an empty set on malformed JSON, never throws', () => {
  const id = `cr-test-malformed-${process.pid}`;
  fs.writeFileSync(retriesPath(id), 'not json');
  assert.deepStrictEqual(readRetried(id), new Set());
  cleanup(id);
});

test('recordRetry then readRetried round-trips one agent id, and returns true on success', () => {
  const id = `cr-test-roundtrip-${process.pid}`;
  cleanup(id);
  assert.strictEqual(recordRetry(id, 'agent-1'), true);
  assert.deepStrictEqual(readRetried(id), new Set(['agent-1']));
  cleanup(id);
});

test('recordRetry is idempotent — recording the same agent id twice does not duplicate', () => {
  const id = `cr-test-idempotent-${process.pid}`;
  cleanup(id);
  recordRetry(id, 'agent-1');
  recordRetry(id, 'agent-1');
  const raw = JSON.parse(fs.readFileSync(retriesPath(id), 'utf8'));
  assert.strictEqual(raw.length, 1);
  cleanup(id);
});

test('recordRetry keeps distinct agent ids separate within the same session', () => {
  const id = `cr-test-distinct-${process.pid}`;
  cleanup(id);
  recordRetry(id, 'agent-1');
  recordRetry(id, 'agent-2');
  assert.deepStrictEqual(readRetried(id), new Set(['agent-1', 'agent-2']));
  cleanup(id);
});

test('recordRetry returns false and writes nothing for a missing session id', () => {
  assert.strictEqual(recordRetry(undefined, 'agent-1'), false);
  assert.strictEqual(recordRetry('', 'agent-1'), false);
});

test('recordRetry returns false and writes nothing for a missing agent id', () => {
  const id = `cr-test-noagent-${process.pid}`;
  cleanup(id);
  assert.strictEqual(recordRetry(id, undefined), false);
  assert.strictEqual(fs.existsSync(retriesPath(id)), false, 'no file should be created without an agent id');
});
