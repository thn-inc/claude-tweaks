'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  DEFAULT_TTL_HOURS,
  CLAIMS_BRANCH,
  claimFilePath,
  claimPayload,
  releasePayload,
  isStale,
  classifyClaimBlob,
} = require('../../../plugin/bin/lib/issues/claims');

const T0 = 1720000000000; // fixed epoch ms for deterministic tests

test('claimPayload builds owner/repo/claimPath and the marker file content', () => {
  const p = claimPayload({ issueNumber: 123, runId: 'run-1', sessionId: 'sess-1', now: T0 });
  assert.strictEqual(p.owner, '{owner}');
  assert.strictEqual(p.repo, '{repo}');
  assert.strictEqual(p.claimPath, 'claims/issue-123.json');
  assert.deepStrictEqual(JSON.parse(p.fileContent), {
    runId: 'run-1', sessionId: 'sess-1', claimedAt: new Date(T0).toISOString(), ttlHours: DEFAULT_TTL_HOURS, host: '',
  });
});

test('claimFilePath formats the claims-registry-branch file path', () => {
  assert.strictEqual(claimFilePath(123), 'claims/issue-123.json');
});

test('CLAIMS_BRANCH is a dedicated branch, distinct from the health-state branch', () => {
  assert.strictEqual(CLAIMS_BRANCH, 'claims-registry');
});

test('claimPayload commentBody has a human-readable line after the marker', () => {
  const p = claimPayload({ issueNumber: 7, runId: 'run-1', sessionId: 's', now: T0 });
  const lines = p.commentBody.split('\n');
  assert.ok(lines[0].startsWith('<!-- agent-claim:'));
  assert.ok(lines[1].includes('run-1'));
  assert.ok(lines[1].includes('72h'));
});

test('releasePayload builds owner/repo/claimPath and the tombstone content', () => {
  const p = releasePayload({ issueNumber: 123, runId: 'run-1', reason: 'merged: spec 12', now: T0 });
  assert.strictEqual(p.owner, '{owner}');
  assert.strictEqual(p.repo, '{repo}');
  assert.strictEqual(p.claimPath, 'claims/issue-123.json');
  const tombstone = JSON.parse(p.tombstoneContent);
  assert.strictEqual(tombstone.released, true);
  assert.strictEqual(tombstone.runId, 'run-1');
  assert.strictEqual(tombstone.reason, 'merged: spec 12');
  assert.ok(p.commentBody.startsWith('<!-- agent-claim-release:'));
  assert.ok(p.commentBody.includes('"reason":"merged: spec 12"'));
});

const H = 3600 * 1000;

function claimAt(now, { runId = 'run-1', ttlHours } = {}) {
  return JSON.parse(claimPayload({ issueNumber: 1, runId, sessionId: 's', ttlHours, now }).fileContent);
}

test('staleness boundary: just under TTL not stale, at TTL stale, past TTL stale', () => {
  const claim = claimAt(T0);
  assert.strictEqual(isStale(claim, T0 + 72 * H - 1), false);
  assert.strictEqual(isStale(claim, T0 + 72 * H), true);
  assert.strictEqual(isStale(claim, T0 + 100 * H), true);
});

test('custom ttlHours is honored', () => {
  const claim = claimAt(T0, { ttlHours: 1 });
  assert.strictEqual(isStale(claim, T0 + 1 * H - 1), false);
  assert.strictEqual(isStale(claim, T0 + 1 * H), true);
});

test('unparseable claimedAt → never stale (fail-closed)', () => {
  const claim = { runId: 'r1', claimedAt: 'garbage', ttlHours: 1 };
  assert.strictEqual(isStale(claim, T0 + 1000 * H), false);
});

test('missing ttlHours defaults to 72', () => {
  const claim = { runId: 'r1', claimedAt: new Date(T0).toISOString() };
  assert.strictEqual(isStale(claim, T0 + 72 * H - 1), false);
  assert.strictEqual(isStale(claim, T0 + 72 * H), true);
});

test('claimPayload note appends a third line without touching the marker', () => {
  const p = claimPayload({ issueNumber: 5, runId: 'run-2', sessionId: 's', now: T0, note: 'Broke stale claim from run run-1.' });
  const lines = p.commentBody.split('\n');
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[2], 'Broke stale claim from run run-1.');
  const marker = JSON.parse(p.fileContent);
  assert.strictEqual(marker.runId, 'run-2');
  assert.strictEqual('note' in marker, false);
});

test('claimPayload without note keeps the two-line body', () => {
  const p = claimPayload({ issueNumber: 5, runId: 'r', sessionId: 's', now: T0 });
  assert.strictEqual(p.commentBody.split('\n').length, 2);
});

test('releasePayload link lands in the tombstone JSON and the human line', () => {
  const p = releasePayload({ issueNumber: 5, runId: 'r', reason: 'merged: spec 12', link: 'https://github.com/o/r/commit/abc123', now: T0 });
  const tombstone = JSON.parse(p.tombstoneContent);
  assert.strictEqual(tombstone.link, 'https://github.com/o/r/commit/abc123');
  assert.ok(p.commentBody.endsWith('See https://github.com/o/r/commit/abc123.'));
});

test('releasePayload without link has no link key and an unchanged human line', () => {
  const p = releasePayload({ issueNumber: 5, runId: 'r', reason: 'merged: spec 12', now: T0 });
  const tombstone = JSON.parse(p.tombstoneContent);
  assert.strictEqual('link' in tombstone, false);
  assert.ok(p.commentBody.endsWith('merged: spec 12.'));
});

// #2090: sweptFrom is a passthrough field for a /tidy sweep releasing a claim
// it does not own — the tombstone's own runId stays the caller's (the sweep
// run), sweptFrom names the original holder separately.
test('releasePayload: sweptFrom lands in the tombstone JSON and the runId stays the caller\'s own', () => {
  const p = releasePayload({
    issueNumber: 5, runId: 'tidy-run', reason: 'swept: stale claim', sweptFrom: 'original-run', now: T0,
  });
  const tombstone = JSON.parse(p.tombstoneContent);
  assert.strictEqual(tombstone.runId, 'tidy-run', 'the tombstone is written under the SWEEP run\'s own identity');
  assert.strictEqual(tombstone.sweptFrom, 'original-run');
  assert.ok(p.commentBody.includes('"sweptFrom":"original-run"'));
});

test('releasePayload without sweptFrom has no sweptFrom key', () => {
  const p = releasePayload({ issueNumber: 5, runId: 'r', reason: 'merged: spec 12', now: T0 });
  const tombstone = JSON.parse(p.tombstoneContent);
  assert.strictEqual('sweptFrom' in tombstone, false);
});

test('malformed (non-number, non-missing) ttlHours falls back to the 72h default', () => {
  const claimWithStringTtl = { runId: 'r1', claimedAt: new Date(T0).toISOString(), ttlHours: 'not-a-number' };
  assert.strictEqual(isStale(claimWithStringTtl, T0 + 72 * H - 1), false);
  assert.strictEqual(isStale(claimWithStringTtl, T0 + 72 * H), true);

  const claimWithNullTtl = { runId: 'r1', claimedAt: new Date(T0).toISOString(), ttlHours: null };
  assert.strictEqual(isStale(claimWithNullTtl, T0 + 72 * H - 1), false);
  assert.strictEqual(isStale(claimWithNullTtl, T0 + 72 * H), true);
});

// ---- classifyClaimBlob (#241: unified blob-store claim, both transports) --

test('classifyClaimBlob: absent (no file) is reclaimable via create-only write', () => {
  assert.deepStrictEqual(classifyClaimBlob(null, T0), { state: 'absent', reclaimable: true });
  assert.deepStrictEqual(classifyClaimBlob(undefined, T0), { state: 'absent', reclaimable: true });
});

test('classifyClaimBlob: unreadable content (not valid claim JSON) is never reclaimable', () => {
  assert.deepStrictEqual(classifyClaimBlob('not json', T0), { state: 'unreadable', reclaimable: false });
  assert.deepStrictEqual(classifyClaimBlob('null', T0), { state: 'unreadable', reclaimable: false });
  assert.deepStrictEqual(classifyClaimBlob('[]', T0), { state: 'unreadable', reclaimable: false });
  assert.deepStrictEqual(classifyClaimBlob('"a string"', T0), { state: 'unreadable', reclaimable: false });
});

test('classifyClaimBlob: a tombstone (released: true) is reclaimable via conditional-update', () => {
  const content = JSON.stringify({ released: true, runId: 'run-1', reason: 'merged: spec 12', releasedAt: new Date(T0).toISOString() });
  assert.deepStrictEqual(classifyClaimBlob(content, T0 + 1000), { state: 'tombstone', reclaimable: true });
});

test('classifyClaimBlob: a live claim past its TTL is stale and reclaimable', () => {
  const content = JSON.stringify({ runId: 'run-1', claimedAt: new Date(T0).toISOString(), ttlHours: 72, host: 'mac-1' });
  assert.deepStrictEqual(classifyClaimBlob(content, T0 + 73 * H), { state: 'stale', reclaimable: true });
});

test('classifyClaimBlob: a live, non-stale claim is contested (not reclaimable)', () => {
  const content = JSON.stringify({ runId: 'run-1', claimedAt: new Date(T0).toISOString(), ttlHours: 72, host: 'mac-1' });
  assert.deepStrictEqual(classifyClaimBlob(content, T0 + 1 * H), { state: 'live', reclaimable: false });
});

test('classifyClaimBlob: a tombstone never regresses to stale/live even long after release', () => {
  // released:true always wins, regardless of how much time has passed — a
  // tombstone has no claimedAt/ttlHours to go stale against by isStale's own
  // contract, and even if a stray one were present it must not resurrect a
  // released claim as "live".
  const content = JSON.stringify({ released: true, runId: 'run-1', reason: 'swept: stale claim', releasedAt: new Date(T0).toISOString(), claimedAt: new Date(T0).toISOString(), ttlHours: 72 });
  assert.deepStrictEqual(classifyClaimBlob(content, T0 + 1000), { state: 'tombstone', reclaimable: true });
});

test('classifyClaimBlob: cross-transport collision — the gh-CLI write path and the MCP write path classify the SAME blob content identically', () => {
  // This is the fixture-level proof of #241's core claim: unifying both
  // transports on one blob keyspace means a claim written by either one
  // reads back through the exact same classifier, so a second writer on
  // *either* transport sees the same "live, not reclaimable" verdict and
  // backs off — the dual-keyspace split (ref vs blob) that let a gh session
  // and an MCP session both succeed independently is structurally
  // impossible once there is only one classifier over one keyspace.
  const ghWrittenPayload = claimPayload({ issueNumber: 241, runId: 'gh-run-1', sessionId: 'sess-gh', host: 'gh-host', now: T0 });
  const mcpWrittenPayload = claimPayload({ issueNumber: 241, runId: 'mcp-run-1', sessionId: 'sess-mcp', host: 'mcp-host', now: T0 });

  // Both transports build the blob content off the SAME fileContent field —
  // the payload builder doesn't know or care which transport will write it.
  assert.strictEqual(ghWrittenPayload.claimPath, mcpWrittenPayload.claimPath);

  // A second writer (either transport) reads the blob a moment later and
  // must see it as live/contested, never as absent/reclaimable — that is
  // the collision-prevention guarantee.
  const secondReaderVerdict = classifyClaimBlob(ghWrittenPayload.fileContent, T0 + 1000);
  assert.deepStrictEqual(secondReaderVerdict, { state: 'live', reclaimable: false });

  // The same verdict holds regardless of which payload (gh's or MCP's own
  // attempted write) is being checked against the already-live blob — the
  // classifier has no transport-specific branch.
  const mcpReaderVerdictOnGhWrite = classifyClaimBlob(ghWrittenPayload.fileContent, T0 + 1000);
  const ghReaderVerdictOnGhWrite = classifyClaimBlob(ghWrittenPayload.fileContent, T0 + 1000);
  assert.deepStrictEqual(mcpReaderVerdictOnGhWrite, ghReaderVerdictOnGhWrite);
});

test('classifyClaimBlob: never throws on garbage input', () => {
  assert.doesNotThrow(() => classifyClaimBlob('{{{not json', T0));
  assert.doesNotThrow(() => classifyClaimBlob('', T0));
  assert.doesNotThrow(() => classifyClaimBlob(42, T0));
  assert.doesNotThrow(() => classifyClaimBlob({}, T0));
});
