// tests/bin-lib/release-claim/release.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  readClaimBlob, writeTombstone, isAlreadyReleasedError, releaseClaim, removeLabel,
} = require('../../../plugin/bin/lib/release-claim/release');

const NOW = Date.parse('2026-08-16T12:00:00Z');
const OWN = '2026-08-16T100000-spec-999';
const live = (runId) => JSON.stringify({ runId, sessionId: 's', claimedAt: '2026-08-16T11:00:00.000Z', ttlHours: 72, host: 'h' });
const isGet = (a) => a[0] === 'api' && a[1] === 'repos/acme/w/contents/claims/issue-999.json?ref=claims-registry';
const isPut = (a) => a[0] === 'api' && a[1] === '--method' && a[2] === 'PUT' && a[3] === 'repos/acme/w/contents/claims/issue-999.json';
const isComment = (a) => a[0] === 'issue' && a[1] === 'comment' && a[2] === '999';
const isEdit = (a) => a[0] === 'issue' && a[1] === 'edit' && a[2] === '999';
const fieldOf = (a, name) => { for (let k = 0; k < a.length; k++) if (a[k] === '-f' && String(a[k + 1]).startsWith(name + '=')) return a[k + 1].slice(name.length + 1); return undefined; };
function fakeRunner({
  content, sha = 'blobsha1', putThrows, commentThrows, editThrows, contentAfterConflict,
}) {
  const calls = [];
  let getCount = 0;
  const runner = (args) => {
    calls.push(args);
    if (isGet(args)) {
      getCount += 1;
      // A conflicted PUT's own safety net re-reads the blob (claim-store.js's
      // self-write recheck, and releaseClaim's own post-conflict
      // re-verification) — contentAfterConflict lets a test model those
      // later reads returning something different from the FIRST read.
      const c = (getCount > 1 && contentAfterConflict !== undefined) ? contentAfterConflict : content;
      if (c === null) throw new Error('gh: Not Found (HTTP 404)');
      return JSON.stringify({ content: c, sha });
    }
    if (isPut(args)) { if (putThrows) throw new Error(putThrows); return '{"content":{"sha":"newsha"}}'; }
    if (isComment(args)) { if (commentThrows) throw new Error(commentThrows); return ''; }
    if (isEdit(args)) { if (editThrows) throw new Error(editThrows); return ''; }
    throw new Error('unexpected ' + args.join(' '));
  };
  return { runner, calls };
}

test('readClaimBlob: 404 -> absent; otherwise decoded content + sha', () => {
  const absent = fakeRunner({ content: null });
  assert.deepEqual(readClaimBlob({ owner: 'acme', repo: 'w', issueNumber: 999, runner: absent.runner }), { content: null, sha: null, absent: true });
  const present = fakeRunner({ content: live(OWN), sha: 'abc' });
  const r = readClaimBlob({ owner: 'acme', repo: 'w', issueNumber: 999, runner: present.runner });
  assert.equal(r.sha, 'abc');
  assert.equal(JSON.parse(r.content).runId, OWN);
  assert.match(present.calls[0].join(' '), /-q \{content: \(\.content \| @base64d\), sha: \.sha\}/);
});

test('releaseClaim happy path: read -> PUT with the read sha -> comment -> bot:in-progress removal (default); exact call order + payloads', () => {
  const f = fakeRunner({ content: live(OWN), sha: 'blobsha1' });
  const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', link: 'https://x/pr/1', runner: f.runner, now: NOW });
  assert.equal(r.outcome, 'released');
  assert.equal(f.calls.length, 4, 'read, PUT, comment, and the default bot:in-progress removal — no removeInProgress flag needed');
  assert.ok(isGet(f.calls[0]));
  assert.ok(isPut(f.calls[1]));
  assert.equal(fieldOf(f.calls[1], 'sha'), 'blobsha1', 'PUT carries the sha from the read');
  assert.equal(fieldOf(f.calls[1], 'branch'), 'claims-registry');
  const tomb = JSON.parse(Buffer.from(fieldOf(f.calls[1], 'content'), 'base64').toString('utf8'));
  assert.equal(tomb.released, true);
  assert.equal(tomb.runId, OWN);
  assert.equal(tomb.reason, 'merged: spec 999');
  assert.equal(tomb.link, 'https://x/pr/1');
  assert.doesNotMatch(f.calls[1].join(' '), /-F /, 'contents-API fields are resolved strings -> -f only');
  assert.ok(isComment(f.calls[2]));
  const body = f.calls[2][f.calls[2].indexOf('--body') + 1];
  assert.match(body, /<!-- agent-claim-release: \{"runId":"2026-08-16T100000-spec-999","reason":"merged: spec 999"/);
  assert.equal(r.commentPosted, true);
  assert.ok(isEdit(f.calls[3]));
  assert.equal(f.calls[3][f.calls[3].indexOf('--remove-label') + 1], 'bot:in-progress');
  assert.deepEqual(r.labelsRemoved, ['bot:in-progress']);
});

// #1631 regression: this is the exact reported shape — a released claim with
// no removeInProgress override at all (a caller passing neither flag, the
// exact way an ad hoc/deviated release invocation reproduced the bug) must
// still strip bot:in-progress, with labelsRemoved reflecting it — not the
// silent labelsRemoved:[]/labelsFailed:[] the issue reported.
test('#1631: a release with no removeInProgress override still strips bot:in-progress', () => {
  const f = fakeRunner({ content: live(OWN) });
  const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged PR #1627', runner: f.runner, now: NOW });
  assert.equal(r.outcome, 'released');
  assert.deepEqual(r.labelsRemoved, ['bot:in-progress']);
  assert.deepEqual(r.labelsFailed, []);
});

test('releaseClaim --remove-grants adds exactly three label removals after the comment; bot:in-progress removed by default; removeInProgress:false suppresses it', () => {
  const f = fakeRunner({ content: live(OWN) });
  const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', removeGrants: true, runner: f.runner, now: NOW });
  assert.equal(r.outcome, 'released');
  const edits = f.calls.filter(isEdit).map((a) => a[a.indexOf('--remove-label') + 1]);
  assert.deepEqual(edits, ['auto:build', 'auto:merge-pending', 'auto:merge', 'bot:in-progress']);
  assert.ok(f.calls.findIndex(isComment) < f.calls.findIndex(isEdit), 'labels come after the comment');
  assert.deepEqual(r.labelsRemoved, ['auto:build', 'auto:merge-pending', 'auto:merge', 'bot:in-progress']);

  const f2 = fakeRunner({ content: live(OWN) });
  const r2 = releaseClaim({
    owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', removeGrants: true, removeInProgress: false, runner: f2.runner, now: NOW,
  });
  assert.deepEqual(r2.labelsRemoved, ['auto:build', 'auto:merge-pending', 'auto:merge'], 'explicit removeInProgress:false is the opt-out');
});

// A 404/422/409 on the PUT, re-verified as a genuine tombstone (the claim
// really was released), stays already-released: comment posted.
test('a 404/422 on the PUT, re-verified as a genuine tombstone, still posts the comment and reports already-released', () => {
  const tombstone = JSON.stringify({ released: true, runId: 'someone-else', reason: 'r', releasedAt: '2026-08-16T11:30:00.000Z' });
  for (const msg of ['gh: Not Found (HTTP 404)', 'gh: sha does not match (HTTP 422)']) {
    const f = fakeRunner({ content: live(OWN), putThrows: msg, contentAfterConflict: tombstone });
    const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', runner: f.runner, now: NOW });
    assert.equal(r.outcome, 'already-released', msg);
    assert.equal(f.calls.filter(isComment).length, 1, 'comment still posted');
    assert.equal(r.commentPosted, true);
  }
  assert.equal(isAlreadyReleasedError(new Error('HTTP 500')), false);
});

// #787 hindsight finding: the same 404/422 PUT rejections, but re-verified as
// STILL held by this run (the fakeRunner default — nothing about the target
// actually changed) — must fail closed, never silently already-released.
test('a 404/422 on the PUT, re-verified as STILL held by this run, fails closed with no comment', () => {
  for (const msg of ['gh: Not Found (HTTP 404)', 'gh: sha does not match (HTTP 422)']) {
    const f = fakeRunner({ content: live(OWN), putThrows: msg });
    const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', runner: f.runner, now: NOW });
    assert.equal(r.outcome, 'failed', msg);
    assert.match(r.error, /still held by this run/, msg);
    assert.equal(f.calls.filter(isComment).length, 0, 'no release comment — the release did not actually happen');
    assert.equal(r.commentPosted, false);
  }
});

test('an absent or tombstoned blob is already-released: no PUT, comment posted, labels still processed', () => {
  const f = fakeRunner({ content: null });
  const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', removeGrants: true, runner: f.runner, now: NOW });
  assert.equal(r.outcome, 'already-released');
  assert.equal(f.calls.filter(isPut).length, 0);
  assert.equal(f.calls.filter(isComment).length, 1);
  assert.equal(f.calls.filter(isEdit).length, 4, '3 grant labels + the default bot:in-progress removal');

  const ownTombstone = JSON.stringify({ released: true, runId: OWN, reason: 'merged: spec 999', releasedAt: '2026-08-16T11:30:00.000Z' });
  const t1 = fakeRunner({ content: ownTombstone, sha: 'tomb1' });
  const r1 = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', removeGrants: true, runner: t1.runner, now: NOW });
  assert.equal(r1.outcome, 'already-released');
  assert.equal(t1.calls.filter(isPut).length, 0);
  assert.equal(t1.calls.filter(isComment).length, 1);
  assert.equal(t1.calls.filter(isEdit).length, 4);

  // A tombstone is not a held lock, so the ownership rule doesn't apply here
  // (see skills/_shared/issue-claims.md's Release triggers "Ownership rule" —
  // it's scoped to a successor that *holds* the lock) — a FOREIGN tombstone
  // gets the same outcome and calls.
  const foreignTombstone = JSON.stringify({ released: true, runId: '2026-08-16T110000-spec-999', reason: 'merged: spec 999', releasedAt: '2026-08-16T11:30:00.000Z' });
  const t2 = fakeRunner({ content: foreignTombstone, sha: 'tomb1' });
  const r2 = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', removeGrants: true, runner: t2.runner, now: NOW });
  assert.equal(r2.outcome, 'already-released');
  assert.equal(t2.calls.filter(isPut).length, 0);
  assert.equal(t2.calls.filter(isComment).length, 1);
  assert.equal(t2.calls.filter(isEdit).length, 4);
});

test('a blob owned by another run exits skipped-not-owner and writes nothing', () => {
  const f = fakeRunner({ content: live('2026-08-16T110000-spec-999') });
  const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', removeGrants: true, runner: f.runner, now: NOW });
  assert.equal(r.outcome, 'skipped-not-owner');
  assert.equal(r.holder, '2026-08-16T110000-spec-999');
  assert.equal(f.calls.length, 1, 'only the read');
});

test('unreadable/corrupt blob gets its own distinct outcome, never conflated with a live competing claim; other PUT failures -> failed with no comment', () => {
  const u = fakeRunner({ content: 'not json' });
  const ur = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'r', runner: u.runner, now: NOW });
  assert.equal(ur.outcome, 'unreadable');
  assert.notEqual(ur.outcome, 'skipped-not-owner', 'must be mechanically distinguishable from a live-held competing claim, not just by message text');
  assert.equal(u.calls.length, 1, 'only the read — nothing written for a corrupt blob');
  const f = fakeRunner({ content: live(OWN), putThrows: 'HTTP 500 boom' });
  const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'r', runner: f.runner, now: NOW });
  assert.equal(r.outcome, 'failed');
  // writeTombstone's ghApi now classifies the raw error (#787 hindsight
  // finding) instead of letting it escape verbatim — an unrecognized status
  // collapses to the same generic 'network-failure' claim-store.js's own
  // defaultGhApi already uses for any other unclassified gh failure.
  assert.match(r.error, /network-failure/);
  assert.equal(f.calls.filter(isComment).length, 0);
});

test('comment failure never changes the outcome; removeLabel never throws', () => {
  const f = fakeRunner({ content: live(OWN), commentThrows: 'HTTP 502' });
  const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'r', runner: f.runner, now: NOW });
  assert.equal(r.outcome, 'released');
  assert.equal(r.commentPosted, false);
  assert.match(r.note, /502/);
  assert.ok(r.error === undefined || r.error === null);
  const e = fakeRunner({ content: live(OWN), editThrows: 'HTTP 404' });
  assert.equal(removeLabel({ owner: 'acme', repo: 'w', issueNumber: 999, label: 'auto:build', runner: e.runner }).ok, false);
});

test('writeTombstone composes the contents-API PUT with -f fields only', () => {
  const f = fakeRunner({ content: live(OWN) });
  writeTombstone({ owner: 'acme', repo: 'w', issueNumber: 999, sha: 's1', tombstoneContent: '{"released":true}', message: 'Release claim on issue #999', runner: f.runner });
  const a = f.calls[0];
  assert.deepEqual(a.slice(0, 4), ['api', '--method', 'PUT', 'repos/acme/w/contents/claims/issue-999.json']);
  assert.equal(fieldOf(a, 'message'), 'Release claim on issue #999');
  assert.equal(Buffer.from(fieldOf(a, 'content'), 'base64').toString('utf8'), '{"released":true}');
  assert.equal(fieldOf(a, 'sha'), 's1');
});

// #787 consolidation: readClaimBlob/writeTombstone now delegate to
// claim-store.js's readClaimBlob/writeClaimBlob (the surviving single
// write-path module) instead of composing their own gh api calls directly.
const claimStore = require('../../../plugin/bin/lib/issues/claim-store');

test('releaseClaim delegates its read/write through claim-store.js, not its own gh api calls', (t) => {
  const readSpy = t.mock.method(claimStore, 'readClaimBlob', () => ({ content: null, sha: null, failure: null, absent: true }));
  const writeSpy = t.mock.method(claimStore, 'writeClaimBlob');
  releaseClaim({
    owner: 'acme', repo: 'w', issueNumber: 7, runId: 'r1', reason: 'test',
    runner: () => { throw new Error('a raw gh runner call means the delegation did not happen'); },
  });
  assert.equal(readSpy.mock.calls.length, 1);
  // absent -> already-released, no write expected; readSpy call proves delegation either way.
  assert.equal(writeSpy.mock.calls.length, 0);
});

// #787 amendment (git-CAS): `gitRunner` must reach claim-store on BOTH legs.
// Silently dropping the forward anywhere in the chain degrades every claim
// write back to the contents API — the exact endpoint this change moved off —
// and no other test in this suite would notice.
test('releaseClaim forwards gitRunner through to claim-store.readClaimBlob AND writeClaimBlob', (t) => {
  const gitRunner = () => { throw new Error('the injected gitRunner is only forwarded here, never invoked'); };
  const readSpy = t.mock.method(claimStore, 'readClaimBlob', () => ({ content: live(OWN), sha: 'tip1', failure: null, absent: false }));
  const writeSpy = t.mock.method(claimStore, 'writeClaimBlob', () => ({ ok: true, failure: null }));
  const runner = (args) => {
    if (args[0] === 'issue' && args[1] === 'comment') return '';
    throw new Error(`unexpected raw gh call: ${args.join(' ')}`);
  };
  const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', runner, gitRunner, now: NOW });
  assert.equal(r.outcome, 'released');
  assert.equal(readSpy.mock.calls.length, 1);
  assert.equal(readSpy.mock.calls[0].arguments[0].gitRunner, gitRunner, 'read leg carries the injected gitRunner, not undefined');
  assert.equal(writeSpy.mock.calls.length, 1);
  assert.equal(writeSpy.mock.calls[0].arguments[0].gitRunner, gitRunner, 'write leg carries the injected gitRunner, not undefined');
});

// git-CAS leases the whole claims-registry branch tip, so a conflict can come
// from a commit that has nothing to do with THIS issue. Classifying that as
// already-released would post a release comment and strip the grant labels off
// a claim that is still live and still ours.
test('a write conflict whose re-read shows the claim still live under this run is failed, not already-released', (t) => {
  t.mock.method(claimStore, 'readClaimBlob', () => ({ content: live(OWN), sha: 'tip1', failure: null, absent: false }));
  t.mock.method(claimStore, 'writeClaimBlob', () => ({ ok: false, conflict: true, failure: null }));
  const calls = [];
  const runner = (args) => { calls.push(args); return ''; };
  const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', removeGrants: true, removeInProgress: true, runner, gitRunner: () => '', now: NOW });
  assert.equal(r.outcome, 'failed');
  assert.match(r.error, /still held by this run/);
  assert.match(r.error, /HTTP 409\/422/, 'the original conflict text is preserved');
  assert.equal(r.commentPosted, false);
  assert.deepEqual(calls, [], 'no release comment, no label stripping — the release did not happen');
  assert.deepEqual(r.labelsRemoved, []);
});

test('a write conflict whose re-read shows a successor now holds the claim stays already-released', (t) => {
  const SUCCESSOR = '2026-08-16T110000-spec-999';
  let reads = 0;
  t.mock.method(claimStore, 'readClaimBlob', () => {
    reads += 1;
    return { content: live(reads === 1 ? OWN : SUCCESSOR), sha: `tip${reads}`, failure: null, absent: false };
  });
  t.mock.method(claimStore, 'writeClaimBlob', () => ({ ok: false, conflict: true, failure: null }));
  const calls = [];
  const runner = (args) => { calls.push(args); return ''; };
  const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', runner, gitRunner: () => '', now: NOW });
  assert.equal(r.outcome, 'already-released');
  assert.equal(reads, 2, 'the conflict triggered a fresh read');
  assert.equal(r.commentPosted, true);
  assert.equal(calls.filter(isComment).length, 1);
  assert.equal(r.error, undefined);
});

test('a write conflict whose re-read shows the claim gone stays already-released', (t) => {
  let reads = 0;
  t.mock.method(claimStore, 'readClaimBlob', () => {
    reads += 1;
    return reads === 1
      ? { content: live(OWN), sha: 'tip1', failure: null, absent: false }
      : { content: null, sha: null, failure: null, absent: true };
  });
  t.mock.method(claimStore, 'writeClaimBlob', () => ({ ok: false, conflict: true, failure: null }));
  const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', runner: () => '', gitRunner: () => '', now: NOW });
  assert.equal(r.outcome, 'already-released');
  assert.equal(r.commentPosted, true);
});

test('a write conflict whose re-read itself fails is failed (never an unverified already-released)', (t) => {
  let reads = 0;
  t.mock.method(claimStore, 'readClaimBlob', () => {
    reads += 1;
    return reads === 1
      ? { content: live(OWN), sha: 'tip1', failure: null, absent: false }
      : { content: null, sha: null, failure: 'network-failure', absent: false };
  });
  t.mock.method(claimStore, 'writeClaimBlob', () => ({ ok: false, conflict: true, failure: null }));
  const calls = [];
  const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', removeGrants: true, runner: (a) => { calls.push(a); return ''; }, gitRunner: () => '', now: NOW });
  assert.equal(r.outcome, 'failed');
  assert.match(r.error, /HTTP 409\/422/, 'names the original conflict');
  assert.match(r.error, /network-failure/, 'names the re-read failure too');
  assert.deepEqual(calls, [], 'nothing is commented or stripped on an unverifiable release');
});

// #787 hindsight finding: a re-read that comes back unreadable after a
// conflict proves neither of the safe outcomes this safety net requires
// (still held by us, or genuinely released) — it must fail closed, exactly
// like an unreadable INITIAL read does (the sibling test above), not fall
// through to the same 'already-released' the live/stale branch reaches.
test('a write conflict whose re-read comes back unreadable is failed, never silently already-released', (t) => {
  let reads = 0;
  t.mock.method(claimStore, 'readClaimBlob', () => {
    reads += 1;
    return reads === 1
      ? { content: live(OWN), sha: 'tip1', failure: null, absent: false }
      : { content: 'not-valid-json{{{', sha: 'tip2', failure: null, absent: false };
  });
  t.mock.method(claimStore, 'writeClaimBlob', () => ({ ok: false, conflict: true, failure: null }));
  const calls = [];
  const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', removeGrants: true, runner: (a) => { calls.push(a); return ''; }, gitRunner: () => '', now: NOW });
  assert.equal(r.outcome, 'failed');
  assert.match(r.error, /unreadable/);
  assert.equal(reads, 2, 'the conflict triggered a fresh read');
  assert.deepEqual(calls, [], 'nothing is commented or stripped when the re-read cannot verify the release');
});

// #787 hindsight finding: writeTombstone's own ghApi closure had no
// try/catch, unlike readClaimBlob's — a genuine PUT rejection propagated as
// a raw throw with `.conflict` unset instead of the classified, conflict-
// tagged shape claim-store.js's contract requires, so releaseClaim's own
// catch block skipped the re-verification safety net entirely (the exact
// case the two tests above exist to require). Exercises the REAL
// claim-store.js (no mocking) through a git-CAS transport failure that
// forces the contents-API fallback, so writeTombstone's ghApi closure is
// the one actually invoked for the rejected PUT.
test('writeTombstone: a genuine PUT rejection through the real contents-API fallback is classified, not thrown raw — the safety net runs instead of being skipped', () => {
  const gitRunner = () => { throw new Error('fatal: unable to access: Could not resolve host'); };
  const runner = (args) => {
    if (isGet(args)) return JSON.stringify({ content: live(OWN), sha: 'freshsha' });
    if (isPut(args)) throw new Error('gh: HTTP 409: Conflict (sha does not match)');
    if (isComment(args)) return '';
    throw new Error('unexpected ' + args.join(' '));
  };
  const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', runner, gitRunner, now: NOW });
  assert.equal(r.outcome, 'failed', 'a genuine conflict must trigger the re-verification safety net, not fall through raw to already-released');
  assert.match(r.error, /still held by this run/);
  assert.equal(r.commentPosted, false, 'no release comment when the claim is still live and the release did not actually happen');
});

// A non-conflict already-released-shaped error (a 404 from the contents-API
// path — the blob was swept) must NOT trigger the re-read: it is a genuine
// already-released, and the pre-git-CAS behavior is unchanged for it.
test('a 404-shaped PUT error still short-circuits to already-released without a second read', (t) => {
  let reads = 0;
  t.mock.method(claimStore, 'readClaimBlob', () => {
    reads += 1;
    return { content: live(OWN), sha: 'tip1', failure: null, absent: false };
  });
  t.mock.method(claimStore, 'writeClaimBlob', () => ({ ok: false, conflict: false, failure: 'gh: Not Found (HTTP 404)' }));
  const r = releaseClaim({ owner: 'acme', repo: 'w', issueNumber: 999, runId: OWN, reason: 'merged: spec 999', runner: () => '', gitRunner: () => '', now: NOW });
  assert.equal(r.outcome, 'already-released');
  assert.equal(reads, 1);
});

test('releaseClaim: a held claim by this run writes the tombstone through claim-store.writeClaimBlob', (t) => {
  const blobContent = JSON.stringify({ runId: 'r1', claimedAt: new Date(0).toISOString(), ttlHours: 72 });
  t.mock.method(claimStore, 'readClaimBlob', () => ({
    content: blobContent,
    sha: 'sha1',
    failure: null,
    absent: false,
  }));
  const writeSpy = t.mock.method(claimStore, 'writeClaimBlob', () => ({ ok: true, failure: null }));
  const runner = (args) => {
    if (args[0] === 'issue' && args[1] === 'comment') return '';
    throw new Error(`unexpected runner call in delegated path: ${args.join(' ')}`);
  };
  const result = releaseClaim({
    owner: 'acme', repo: 'w', issueNumber: 7, runId: 'r1', reason: 'test', runner, now: Date.now(),
  });
  assert.equal(result.outcome, 'released');
  assert.equal(writeSpy.mock.calls.length, 1);
  // #787 residual finding (progress.md's parked "expectedContent has zero
  // test coverage" item): releaseClaim's write must thread expectedContent
  // = the blob content its own read saw, so claim-store.js can tell a
  // genuine contest from a push rejected by unrelated claims-registry
  // activity (I1/C1). Deleting `expectedContent: blob.content` at the call
  // site would leave every other test in this file green (none of the
  // conflict-path tests inspect the write options object) while silently
  // reintroducing the false-contest/lost-update bug in production.
  assert.equal(writeSpy.mock.calls[0].arguments[3].expectedContent, blobContent, "writeTombstone's expectedContent must be the exact content releaseClaim's own read returned");
});

// ---- #2090: --sweep -----------------------------------------------------
// A /tidy sweep's own runId is never the holder's — the ordinary ownership
// check would refuse every one of these releases as skipped-not-owner.
// `sweep` narrows that refusal: a 'stale' foreign claim may always be swept;
// a 'live' foreign claim may only be swept when the caller has independently
// confirmed the issue itself is closed (`sweep.issueClosed`).
const staleForeign = (runId) => JSON.stringify({
  runId, sessionId: 's', claimedAt: '2026-08-12T12:00:00.000Z', ttlHours: 72, host: 'h', // 100h before NOW
});
const SWEEP_RUN = '2026-08-16T120000-tidy-standalone';

test('#2090 sweep releases a STALE foreign blob unconditionally: PUT with the read sha, comment, bot:in-progress removed', () => {
  const HOLDER = '2026-08-10T090000-spec-1';
  const f = fakeRunner({ content: staleForeign(HOLDER), sha: 'stalesha1' });
  const r = releaseClaim({
    owner: 'acme', repo: 'w', issueNumber: 999, runId: SWEEP_RUN, reason: 'swept: stale claim', sweep: { issueClosed: false }, runner: f.runner, now: NOW,
  });
  assert.equal(r.outcome, 'released');
  assert.equal(r.sweptFrom, HOLDER);
  assert.ok(isPut(f.calls[1]));
  assert.equal(fieldOf(f.calls[1], 'sha'), 'stalesha1');
  const tomb = JSON.parse(Buffer.from(fieldOf(f.calls[1], 'content'), 'base64').toString('utf8'));
  assert.equal(tomb.runId, SWEEP_RUN, "the tombstone's own runId is the SWEEP run, never a fake owner");
  assert.equal(tomb.sweptFrom, HOLDER, 'the tombstone names the original holder');
  assert.ok(isComment(f.calls[2]));
  assert.equal(f.calls[3][f.calls[3].indexOf('--remove-label') + 1], 'bot:in-progress');
});

test('#2090 sweep releases a LIVE foreign blob only when the issue is closed', () => {
  const HOLDER = '2026-08-16T113000-spec-2';
  // issueClosed: false -> still refused, exactly like a non-sweep release.
  const fOpen = fakeRunner({ content: live(HOLDER) });
  const rOpen = releaseClaim({
    owner: 'acme', repo: 'w', issueNumber: 999, runId: SWEEP_RUN, reason: 'swept: issue closed', sweep: { issueClosed: false }, runner: fOpen.runner, now: NOW,
  });
  assert.equal(rOpen.outcome, 'skipped-not-owner', 'a live claim on an OPEN issue is never swept, sweep flag or not');
  assert.equal(rOpen.holder, HOLDER);
  assert.equal(fOpen.calls.length, 1, 'only the read — no PUT attempted');

  // issueClosed: true -> the sweep proceeds.
  const fClosed = fakeRunner({ content: live(HOLDER), sha: 'livesha2' });
  const rClosed = releaseClaim({
    owner: 'acme', repo: 'w', issueNumber: 999, runId: SWEEP_RUN, reason: 'swept: issue closed', sweep: { issueClosed: true }, runner: fClosed.runner, now: NOW,
  });
  assert.equal(rClosed.outcome, 'released');
  assert.equal(rClosed.sweptFrom, HOLDER);
  assert.ok(isPut(fClosed.calls[1]));
  assert.equal(fieldOf(fClosed.calls[1], 'sha'), 'livesha2');
});

test('#2090: without --sweep, the same stale-foreign fixture is still refused as skipped-not-owner — ownership rule unchanged for non-sweep callers', () => {
  const HOLDER = '2026-08-10T090000-spec-1';
  const f = fakeRunner({ content: staleForeign(HOLDER) });
  const r = releaseClaim({
    owner: 'acme', repo: 'w', issueNumber: 999, runId: SWEEP_RUN, reason: 'merged: spec 999', runner: f.runner, now: NOW,
  });
  assert.equal(r.outcome, 'skipped-not-owner', "'stale' is held-and-ownership-checked exactly like 'live' for an ordinary (non-sweep) release — only --sweep narrows that");
  assert.equal(r.holder, HOLDER);
  assert.equal(r.sweptFrom, undefined, 'sweptFrom is never set on a non-sweep release');
  assert.equal(f.calls.length, 1, 'only the read — no PUT attempted');
});

test('#2090: without --sweep, a live foreign blob still refuses as skipped-not-owner (unaffected by the new sweep param existing)', () => {
  const HOLDER = '2026-08-16T113000-spec-2';
  const f = fakeRunner({ content: live(HOLDER) });
  const r = releaseClaim({
    owner: 'acme', repo: 'w', issueNumber: 999, runId: SWEEP_RUN, reason: 'merged: spec 999', runner: f.runner, now: NOW,
  });
  assert.equal(r.outcome, 'skipped-not-owner');
  assert.equal(r.sweptFrom, undefined);
});

// The conflict re-verification safety net extends the same fail-closed
// posture to a sweep: "still held by the ORIGINAL holder" after a rejected
// PUT must fail closed exactly like "still held by this run" does for an
// ordinary release — the tombstone never landed either way.
test('#2090: a sweep write conflict whose re-read shows the ORIGINAL holder still holds it fails closed, never already-released', (t) => {
  const HOLDER = '2026-08-10T090000-spec-1';
  t.mock.method(claimStore, 'readClaimBlob', () => ({ content: staleForeign(HOLDER), sha: 'tip1', failure: null, absent: false }));
  t.mock.method(claimStore, 'writeClaimBlob', () => ({ ok: false, conflict: true, failure: null }));
  const calls = [];
  const r = releaseClaim({
    owner: 'acme', repo: 'w', issueNumber: 999, runId: SWEEP_RUN, reason: 'swept: stale claim', sweep: { issueClosed: false }, runner: (a) => { calls.push(a); return ''; }, gitRunner: () => '', now: NOW,
  });
  assert.equal(r.outcome, 'failed');
  assert.match(r.error, /still held by the original holder/);
  assert.deepEqual(calls, [], 'no release comment — the sweep release did not actually happen');
});
