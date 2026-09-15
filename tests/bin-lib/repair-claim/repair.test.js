// tests/bin-lib/repair-claim/repair.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { repairClaim } = require('../../../plugin/bin/lib/repair-claim/repair');

const NOW = Date.parse('2026-08-16T12:00:00Z');
const isGet = (a) => a[0] === 'api' && a[1] === 'repos/acme/w/contents/claims/issue-999.json?ref=claims-registry';
const isPut = (a) => a[0] === 'api' && a[1] === '--method' && a[2] === 'PUT' && a[3] === 'repos/acme/w/contents/claims/issue-999.json';
const isComment = (a) => a[0] === 'issue' && a[1] === 'comment' && a[2] === '999';
const fieldOf = (a, name) => { for (let k = 0; k < a.length; k++) if (a[k] === '-f' && String(a[k + 1]).startsWith(name + '=')) return a[k + 1].slice(name.length + 1); return undefined; };

// A fake gh runner serving a contents-API read of claims/issue-999.json (a
// b64d-decoded `content` already, matching what the real `-q` jq filter
// hands back) plus optional PUT/comment responses — mirrors
// release.test.js's fakeRunner idiom rather than inventing a new one.
// `content === null` models the 404/absent path.
function fakeRunner({ content, sha = 'blobsha1', putThrows, commentThrows }) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isGet(args)) {
      if (content === null) throw new Error('gh: Not Found (HTTP 404)');
      return JSON.stringify({ content, sha });
    }
    if (isPut(args)) { if (putThrows) throw new Error(putThrows); return '{"content":{"sha":"newsha"}}'; }
    if (isComment(args)) { if (commentThrows) throw new Error(commentThrows); return ''; }
    throw new Error('unexpected ' + args.join(' '));
  };
  return { runner, calls };
}

// A runner whose read leg fails with a non-404 (network-ish) error — never
// reaches claim-store's absent/404 classification.
function fakeReadFailureRunner(message) {
  return (args) => {
    if (isGet(args)) throw new Error(message);
    throw new Error('unexpected ' + args.join(' '));
  };
}

const base = { owner: 'acme', repo: 'w', issueNumber: 999, runId: 'run-1', now: NOW };

test('refused: a live claim held by another run — no write', () => {
  const content = JSON.stringify({ runId: 'other-run', claimedAt: new Date(NOW).toISOString(), ttlHours: 12 });
  const f = fakeRunner({ content });
  const r = repairClaim({ ...base, mode: 'release', reason: 'r', runner: f.runner });
  assert.equal(r.outcome, 'refused');
  assert.equal(r.state, 'live');
  assert.equal(f.calls.filter(isPut).length, 0);
});

test('refused: a tombstone — no write', () => {
  const content = JSON.stringify({ released: true, runId: 'x' });
  const f = fakeRunner({ content });
  const r = repairClaim({ ...base, mode: 'release', reason: 'r', runner: f.runner });
  assert.equal(r.outcome, 'refused');
  assert.equal(r.state, 'tombstone');
  assert.equal(f.calls.filter(isPut).length, 0);
});

test('refused: a stale claim (past TTL) — no write', () => {
  const claimedAt = new Date(NOW - 100 * 3600 * 1000).toISOString();
  const content = JSON.stringify({ runId: 'other-run', claimedAt, ttlHours: 12 });
  const f = fakeRunner({ content });
  const r = repairClaim({ ...base, mode: 'release', reason: 'r', runner: f.runner });
  assert.equal(r.outcome, 'refused');
  assert.equal(r.state, 'stale');
  assert.equal(f.calls.filter(isPut).length, 0);
});

test('refused: an absent blob — no write', () => {
  const f = fakeRunner({ content: null });
  const r = repairClaim({ ...base, mode: 'release', reason: 'r', runner: f.runner });
  assert.equal(r.outcome, 'refused');
  assert.equal(r.state, 'absent');
  assert.equal(f.calls.filter(isPut).length, 0);
});

test('repaired, release mode: unreadable blob overwritten with releasePayload-shaped tombstone content, carrying the read sha and a repair-override-marked reason', () => {
  const f = fakeRunner({ content: 'not json {{{', sha: 'abc123' });
  const r = repairClaim({ ...base, mode: 'release', reason: 'corrupt blob', runner: f.runner });
  assert.equal(r.outcome, 'repaired');
  assert.equal(r.state, 'unreadable');
  const put = f.calls.find(isPut);
  assert.ok(put, 'a PUT was made');
  assert.equal(fieldOf(put, 'sha'), 'abc123', 'PUT carries the sha captured on the read');
  const written = JSON.parse(Buffer.from(fieldOf(put, 'content'), 'base64').toString('utf8'));
  assert.equal(written.released, true);
  assert.equal(written.runId, base.runId);
  assert.equal(written.reason, 'repair-force-release: corrupt blob', 'tombstone reason is prefixed so it reads as a repair override, not a routine release');
  const comment = f.calls.find(isComment);
  assert.ok(comment, 'a comment was posted');
  const body = comment[comment.indexOf('--body') + 1];
  assert.match(body, /repair-force-release: corrupt blob/, 'the issue comment also reads as a repair override');
});

// #2240: `ghHost` (the GitHub Enterprise Server host) is distinct from
// `host` (the claiming machine's os.hostname(), only used inside a reclaim's
// claimPayload) — a non-github.com ghHost threads --hostname onto the read
// and PUT, and repoSlug's host-qualified --repo value onto the comment.
test('#2240: ghHost threads --hostname onto the read + PUT, and repoSlug\'s host-qualified --repo onto the comment', () => {
  const f = fakeRunner({ content: 'not json {{{', sha: 'abc123' });
  const r = repairClaim({
    ...base, mode: 'release', reason: 'corrupt blob', ghHost: 'ghe.example.com', runner: f.runner,
  });
  assert.equal(r.outcome, 'repaired');
  const get = f.calls.find(isGet);
  assert.deepEqual(get.slice(-2), ['--hostname', 'ghe.example.com']);
  const put = f.calls.find(isPut);
  assert.deepEqual(put.slice(-2), ['--hostname', 'ghe.example.com']);
  const comment = f.calls.find(isComment);
  assert.equal(comment[comment.indexOf('--repo') + 1], 'ghe.example.com/acme/w');
});

test('#2240: no ghHost (or github.com) keeps the bare owner/repo --repo slug and no --hostname flag', () => {
  const f = fakeRunner({ content: 'not json {{{', sha: 'abc123' });
  const r = repairClaim({ ...base, mode: 'release', reason: 'corrupt blob', runner: f.runner });
  assert.equal(r.outcome, 'repaired');
  const get = f.calls.find(isGet);
  assert.doesNotMatch(get.join(' '), /--hostname/);
  const comment = f.calls.find(isComment);
  assert.equal(comment[comment.indexOf('--repo') + 1], 'acme/w');
});

test('repaired, reclaim mode: unreadable blob overwritten with claimPayload-shaped claim content', () => {
  const f = fakeRunner({ content: 'not json {{{', sha: 'abc123' });
  const r = repairClaim({
    ...base, mode: 'reclaim', reason: 'reclaim after corrupt blob', sessionId: 'sess-1', host: 'h1', runner: f.runner,
  });
  assert.equal(r.outcome, 'repaired');
  assert.equal(r.state, 'unreadable');
  const put = f.calls.find(isPut);
  assert.ok(put, 'a PUT was made');
  const written = JSON.parse(Buffer.from(fieldOf(put, 'content'), 'base64').toString('utf8'));
  assert.equal(written.released, undefined, 'a reclaim writes a live claim marker, not a tombstone');
  assert.equal(written.runId, base.runId);
  assert.equal(written.sessionId, 'sess-1');
  assert.ok(written.claimedAt, 'carries a claimedAt timestamp');
  assert.equal(typeof written.ttlHours, 'number');
});

test('CAS rejection: exactly one write attempt, never retried blind', () => {
  const f = fakeRunner({ content: 'not json {{{', sha: 'abc123' });
  let writeAttempts = 0;
  const stubWrite = () => {
    writeAttempts += 1;
    throw Object.assign(new Error('HTTP 409/422 sha mismatch'), { conflict: true });
  };
  const r = repairClaim({
    ...base, mode: 'release', reason: 'r', runner: f.runner, writeTombstone: stubWrite,
  });
  assert.equal(r.outcome, 'cas-rejected');
  assert.equal(writeAttempts, 1, 'no blind retry on a CAS rejection');
  assert.equal(f.calls.filter(isComment).length, 0, 'a rejected write never reaches the comment step');
});

test('read failure: outcome failed with a non-empty error', () => {
  const runner = fakeReadFailureRunner('ECONNRESET: network blip');
  const r = repairClaim({ ...base, mode: 'release', reason: 'r', runner });
  assert.equal(r.outcome, 'failed');
  assert.ok(r.error && r.error.length > 0, 'error is non-empty');
});

test('comment is best-effort: a repaired outcome survives a comment-post failure', () => {
  const f = fakeRunner({ content: 'not json {{{', sha: 'abc123', commentThrows: 'HTTP 502' });
  const r = repairClaim({ ...base, mode: 'release', reason: 'r', runner: f.runner });
  assert.equal(r.outcome, 'repaired');
  assert.equal(r.commentPosted, false);
  assert.match(r.note, /502/);
});
