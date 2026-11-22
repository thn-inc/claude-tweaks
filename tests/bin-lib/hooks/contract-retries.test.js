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

const ENV = { env: process.env };

function cleanup(sessionId) {
  const p = retriesPath(sessionId, ENV);
  if (p) { try { fs.unlinkSync(p); } catch { /* already absent */ } }
}

test('retriesPath is null for a missing/blank session id, a real path otherwise', () => {
  assert.strictEqual(retriesPath(undefined, ENV), null);
  assert.strictEqual(retriesPath('', ENV), null);
  assert.strictEqual(retriesPath('  ', ENV), null);
  assert.strictEqual(retriesPath('abc-123', ENV), path.join(os.tmpdir(), 'ct-contract-retries-abc-123.json'));
});

test('readRetried returns an empty set when no file exists', () => {
  const id = `cr-test-empty-${process.pid}`;
  cleanup(id);
  assert.deepStrictEqual(readRetried(id, ENV), new Set());
});

test('readRetried degrades to an empty set on malformed JSON, never throws', () => {
  const id = `cr-test-malformed-${process.pid}`;
  fs.writeFileSync(retriesPath(id, ENV), 'not json');
  assert.deepStrictEqual(readRetried(id, ENV), new Set());
  cleanup(id);
});

test('recordRetry then readRetried round-trips one agent id, and returns true on success', () => {
  const id = `cr-test-roundtrip-${process.pid}`;
  cleanup(id);
  assert.strictEqual(recordRetry(id, 'agent-1', ENV), true);
  assert.deepStrictEqual(readRetried(id, ENV), new Set(['agent-1']));
  cleanup(id);
});

test('recordRetry is idempotent — recording the same agent id twice does not duplicate', () => {
  const id = `cr-test-idempotent-${process.pid}`;
  cleanup(id);
  recordRetry(id, 'agent-1', ENV);
  recordRetry(id, 'agent-1', ENV);
  const raw = JSON.parse(fs.readFileSync(retriesPath(id, ENV), 'utf8'));
  assert.strictEqual(raw.length, 1);
  cleanup(id);
});

test('recordRetry keeps distinct agent ids separate within the same session', () => {
  const id = `cr-test-distinct-${process.pid}`;
  cleanup(id);
  recordRetry(id, 'agent-1', ENV);
  recordRetry(id, 'agent-2', ENV);
  assert.deepStrictEqual(readRetried(id, ENV), new Set(['agent-1', 'agent-2']));
  cleanup(id);
});

test('recordRetry returns false and writes nothing for a missing session id', () => {
  assert.strictEqual(recordRetry(undefined, 'agent-1', ENV), false);
  assert.strictEqual(recordRetry('', 'agent-1', ENV), false);
});

test('recordRetry returns false and writes nothing for a missing agent id', () => {
  const id = `cr-test-noagent-${process.pid}`;
  cleanup(id);
  assert.strictEqual(recordRetry(id, undefined, ENV), false);
  assert.strictEqual(fs.existsSync(retriesPath(id, ENV)), false, 'no file should be created without an agent id');
});

test('retriesPath, readRetried and recordRetry throw TypeError without an env (#5377: only SubagentStop calls them)', () => {
  assert.throws(() => retriesPath('abc-123'), TypeError);
  assert.throws(() => readRetried('abc-123'), TypeError);
  assert.throws(() => recordRetry('abc-123', 'agent-1'), TypeError);
});
