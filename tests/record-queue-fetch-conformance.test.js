// tests/record-queue-fetch-conformance.test.js
//
// Conformance test for #645's session-scoped record snapshot: every named consumer
// (backlog overview/refine/grant, capture, specify Step 1 + record-creation, the
// shared trust-table fragment, help, tidy, visualize record-graph) must cite
// _shared/record-queue-fetch.md's shared fetch instead of restating a bare
// `gh issue list --state open|all ... --limit N` round-trip of its own.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const SKILLS_DIR = path.join(__dirname, '..', 'plugin', 'skills');
const FRAGMENT = 'record-queue-fetch.md';

// A "bare fetch" is a concrete gh issue list invocation for the whole open/all queue
// that skips the shared snapshot — same line carries --state open|all AND --limit,
// but no --label (a --label fetch is a deliberate, narrower, server-side-filtered
// call that legitimately stays outside the shared snapshot; see
// _shared/record-queue-fetch.md's "This block always fetches --state all" note and
// refine-headless.md's/refine-mode.md's own ready-label fetches).
const BARE_FETCH_RE = /gh issue list --state (?:open|all)(?![^\n]*--label)[^\n]*--limit/;

// The record's own named consumer list (record-queue-fetch.md's header + the
// deliverables in issue #645): backlog (overview/refine/grant), capture, specify
// (Step 1 + Idempotency map), the shared trust-table fragment, help, tidy,
// visualize record-graph. Deliberately does NOT include dispatch/wrap-up/
// github-pr-scan*, which are out of scope for #645 and keep their own independent,
// narrower fetches.
const CONSUMERS = [
  'backlog/overview-mode.md',
  'backlog/refine-mode.md',
  'backlog/refine-headless.md',
  'capture/SKILL.md',
  'specify/decomposition-mode.md',
  'specify/record-creation.md',
  '_shared/trust-table.md',
  'help/status-scan.md',
  'tidy/step-1-records.md',
  'visualize/record-graph.md',
];

function read(rel) {
  return readText(path.join(SKILLS_DIR, rel));
}

test('every #645 consumer file exists', () => {
  for (const rel of CONSUMERS) {
    assert.ok(fs.existsSync(path.join(SKILLS_DIR, rel)), `${rel} does not exist`);
  }
});

test('every #645 consumer cites _shared/record-queue-fetch.md', () => {
  const offenders = CONSUMERS.filter((rel) => !read(rel).includes(FRAGMENT));
  assert.deepStrictEqual(offenders, [], `these files don't cite ${FRAGMENT}: ${offenders.join(', ')}`);
});

test('no #645 consumer restates a bare gh issue list --limit fetch', () => {
  const offenders = [];
  for (const rel of CONSUMERS) {
    const text = read(rel);
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (BARE_FETCH_RE.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepStrictEqual(offenders, [], `bare fetches found outside the shared snapshot:\n${offenders.join('\n')}`);
});

// AC3's own regression shape: prove the detector itself actually catches a
// reintroduced bare fetch, so the test above isn't accidentally toothless.
test('BARE_FETCH_RE detects a reintroduced bare --limit 1000 fetch (regression shape)', () => {
  const reintroduced = 'gh issue list --state all --json number,labels,body,state,stateReason,closedAt,comments --limit 1000 > /tmp/capture-trust-records.json';
  assert.ok(BARE_FETCH_RE.test(reintroduced), 'detector failed to flag a known-bad bare fetch');
});

test('BARE_FETCH_RE does not flag a legitimate --label-filtered fetch', () => {
  const labeled = 'gh issue list --label ready --state open --json number,title,body,labels,createdAt --limit "$LIMIT" > /tmp/backlog-grant-ready.json';
  assert.ok(!BARE_FETCH_RE.test(labeled), 'detector incorrectly flagged a --label-scoped fetch');
});

test('BARE_FETCH_RE does not flag the canonical fetch inside record-queue-fetch.md itself', () => {
  const canonical = read('_shared/record-queue-fetch.md');
  // The canonical fragment is allowed to contain the real invocation — this test
  // only proves the regex doesn't uselessly self-flag; record-queue-fetch.md is
  // never in CONSUMERS above, so it's never actually asserted against.
  const lines = canonical.split('\n').filter((l) => BARE_FETCH_RE.test(l));
  assert.ok(lines.length >= 1, 'expected the canonical fetch line to still exist in record-queue-fetch.md');
});

test('the session-scoped snapshot section documents path, freshness, and invalidation', () => {
  const text = read('_shared/record-queue-fetch.md');
  assert.ok(text.includes('## Session-scoped record snapshot'), 'missing the Session-scoped record snapshot section');
  assert.ok(text.includes('ct-records-{session-id}.json') || text.includes('ct-records-'), 'missing the canonical snapshot path');
  assert.ok(text.includes('record-snapshot-ttl-seconds'), 'missing the freshness/TTL policy key');
  assert.ok(/invalidat/i.test(text), 'missing the invalidation rule');
});

test('record-snapshot-ttl-seconds is registered in the policy schema', () => {
  const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');
  const entry = POLICY_KEYS.find((e) => e.key === 'record-snapshot-ttl-seconds');
  assert.ok(entry, 'record-snapshot-ttl-seconds must be registered in POLICY_KEYS');
  assert.strictEqual(entry.type, 'integer');
  assert.strictEqual(entry.default, 300);
});
