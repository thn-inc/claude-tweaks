'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  listClaimNames, readClaimBlob, writeClaimBlob, defaultGhApi, classifyGhApiError, tombstoneInFlightPr,
  isWellFormedClaimContent, createClaimReader, resolveRepoSlug, resolveRepoSlugOrThrow,
  ensureClaimsBranch, claimsBranchExists,
} = require('../../../plugin/bin/lib/issues/claim-store');

// Fake ghApi functions mirror release-merged.js's own ghApi shape: a
// non-throwing function returning {stdout, failure, status} — never the
// real `gh`. Branch on the args shape (per the gh-api-module-pattern
// skill); throw on anything unhandled so a wrong endpoint fails loudly.
const isRead = (args, path) => args[0] === `repos/acme/w/contents/${path}?ref=claims-registry`;
const isWrite = (args, path) => args[0] === '--method' && args[1] === 'PUT' && args[2] === `repos/acme/w/contents/${path}`;

function fieldOf(args, name) {
  for (let k = 0; k < args.length; k++) {
    if (args[k] === '-f' && String(args[k + 1]).startsWith(`${name}=`)) return args[k + 1].slice(name.length + 1);
  }
  return undefined;
}

test('readClaimBlob: status 404 -> absent:true, failure:null, never treated as a failure', () => {
  const ghApi = (args) => {
    if (isRead(args, 'claims/issue-42.json')) return { stdout: null, failure: null, status: 404 };
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const r = readClaimBlob({ ghApi }, 'acme/w', 42);
  assert.deepEqual(r, { content: null, sha: null, failure: null, absent: true });
});

test('readClaimBlob: live blob -> content and sha parsed from the -q output', () => {
  const ghApi = (args) => {
    if (isRead(args, 'claims/issue-42.json')) {
      assert.match(args.join(' '), /-q \{content: \(\.content \| @base64d\), sha: \.sha\}/);
      return { stdout: JSON.stringify({ content: '{"runId":"r1"}', sha: 'abc123' }), failure: null, status: null };
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const r = readClaimBlob({ ghApi }, 'acme/w', 42);
  assert.deepEqual(r, { content: '{"runId":"r1"}', sha: 'abc123', failure: null, absent: false });
});

test('readClaimBlob: network failure propagates, absent stays false', () => {
  const ghApi = (args) => {
    if (isRead(args, 'claims/issue-42.json')) return { stdout: null, failure: 'network-failure', status: null };
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const r = readClaimBlob({ ghApi }, 'acme/w', 42);
  assert.deepEqual(r, { content: null, sha: null, failure: 'network-failure', absent: false });
});

test('readClaimBlob: gh-absent propagates, absent stays false (never confused with a 404)', () => {
  const ghApi = (args) => {
    if (isRead(args, 'claims/issue-42.json')) return { stdout: null, failure: 'gh-absent', status: null };
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const r = readClaimBlob({ ghApi }, 'acme/w', 42);
  assert.deepEqual(r, { content: null, sha: null, failure: 'gh-absent', absent: false });
});

test('writeClaimBlob: create-only omits sha from argv', () => {
  const calls = [];
  const ghApi = (args) => {
    calls.push(args);
    if (isWrite(args, 'claims/issue-7.json')) return { stdout: '{}', failure: null, status: null };
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const r = writeClaimBlob({ ghApi }, 'acme/w', 7, { content: '{"a":1}', message: 'Claim issue-7.json' });
  assert.equal(r.ok, true);
  assert.equal(r.failure, null);
  assert.equal(calls.length, 1);
  assert.equal(fieldOf(calls[0], 'sha'), undefined, 'create-only write must never send a sha field');
  assert.equal(fieldOf(calls[0], 'branch'), 'claims-registry');
  assert.equal(fieldOf(calls[0], 'content'), Buffer.from('{"a":1}', 'utf8').toString('base64'));
});

test('writeClaimBlob: sha present -> conditional write sends it in argv', () => {
  const calls = [];
  const ghApi = (args) => {
    calls.push(args);
    if (isWrite(args, 'claims/issue-7.json')) return { stdout: '{}', failure: null, status: null };
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const r = writeClaimBlob({ ghApi }, 'acme/w', 7, { content: '{"a":1}', sha: 'deadbeef', message: 'Release issue-7.json' });
  assert.equal(r.ok, true);
  assert.equal(fieldOf(calls[0], 'sha'), 'deadbeef');
});

test('writeClaimBlob: failure propagates, ok:false', () => {
  const ghApi = (args) => {
    if (isWrite(args, 'claims/issue-7.json')) return { stdout: null, failure: 'network-failure', status: null };
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const r = writeClaimBlob({ ghApi }, 'acme/w', 7, { content: '{}', message: 'x' });
  assert.deepEqual(r, { ok: false, failure: 'network-failure' });
});

// ---- #821 regression: a claim/release write must never land the literal
// string "undefined" (or any other malformed value) in the registry ----
//
// The exact condition: a batch/multi-record caller computes each issue's
// payload into a map or array, then reaches one record whose lookup silently
// resolves to `undefined` (an off-by-one index, a key that never got
// populated) while the loop keeps going for the others. `JSON.stringify`
// itself never throws on that — it returns the JS value `undefined`, not a
// string — but the instant that return value is concatenated or templated
// (a heredoc build, a `` `${...}` `` around it) it coerces to the literal
// 9-character string "undefined", which is what actually reaches the write.

test('isWellFormedClaimContent: the literal string "undefined" (the exact #821 defect shape) is rejected', () => {
  assert.equal(isWellFormedClaimContent('undefined'), false);
});

test('isWellFormedClaimContent: reproduces the exact template-literal coercion that produces "undefined"', () => {
  // Mirrors a batch caller keying a payload map by issue number and missing
  // one entry — `payloadMap[782]` is `undefined`, and templating it (rather
  // than assigning the object directly) coerces it to the literal string.
  const payloadMap = { 781: { runId: 'r', claimedAt: 'x' }, 783: { runId: 'r', claimedAt: 'x' } };
  const missingIssue = 782;
  const content = `${JSON.stringify(payloadMap[missingIssue])}`;
  assert.equal(content, 'undefined', 'precondition: this is genuinely how the literal string arises, not a contrived value');
  assert.equal(isWellFormedClaimContent(content), false);
});

test('isWellFormedClaimContent: undefined itself, unparseable JSON, an array, and null all reject', () => {
  assert.equal(isWellFormedClaimContent(undefined), false);
  assert.equal(isWellFormedClaimContent(''), false);
  assert.equal(isWellFormedClaimContent('not json'), false);
  assert.equal(isWellFormedClaimContent('[1,2,3]'), false);
  assert.equal(isWellFormedClaimContent('null'), false);
  assert.equal(isWellFormedClaimContent(42), false);
});

test('isWellFormedClaimContent: a well-formed claim/tombstone marker accepts', () => {
  assert.equal(isWellFormedClaimContent('{"runId":"r1","claimedAt":"2026-01-01T00:00:00.000Z","ttlHours":72}'), true);
  assert.equal(isWellFormedClaimContent('{"released":true,"runId":"r1","reason":"x","releasedAt":"2026-01-01T00:00:00.000Z"}'), true);
});

test('writeClaimBlob: content "undefined" is refused before EITHER transport is attempted — no git-CAS, no contents-API PUT', () => {
  const gitRunner = () => { throw new Error('git must never be reached for malformed content'); };
  const ghApi = () => { throw new Error('gh api must never be reached for malformed content'); };
  const r = writeClaimBlob({ ghApi, gitRunner }, 'acme/w', 782, {
    content: 'undefined', sha: 'deadbeef', message: 'Claim issue #782',
  });
  assert.deepEqual(r, { ok: false, failure: 'invalid-content' });
});

test('writeClaimBlob: content "undefined" is refused on the create-only path too (no gitRunner/sha)', () => {
  const ghApi = () => { throw new Error('gh api must never be reached for malformed content'); };
  const r = writeClaimBlob({ ghApi }, 'acme/w', 782, {
    content: 'undefined', createOnly: true, message: 'Claim issue #782',
  });
  assert.deepEqual(r, { ok: false, failure: 'invalid-content' });
});

test('writeClaimBlob: content that is not even a string (the caller forgot to serialize) is refused the same way', () => {
  const ghApi = () => { throw new Error('gh api must never be reached for malformed content'); };
  const r = writeClaimBlob({ ghApi }, 'acme/w', 782, { content: undefined, message: 'Claim issue #782' });
  assert.deepEqual(r, { ok: false, failure: 'invalid-content' });
});

test('listClaimNames: happy path extracts names from the {name,sha} entries listClaimEntries returns', () => {
  const ghApi = (args) => {
    // `recursive=1` is a literal query-string segment on the path, never a
    // `-f` field -- `gh api` switches its default method to POST the
    // instant any `-f`/`-F` is present, and this endpoint has no POST
    // route (confirmed live: a `-f recursive=1` call 404s; the identical
    // request with the param folded into the path succeeds).
    assert.equal(args[0], 'repos/acme/w/git/trees/claims-registry?recursive=1');
    assert.ok(!args.includes('-f'), 'must never pass recursive=1 as a -f field -- it flips gh api to POST');
    return {
      stdout: JSON.stringify({
        truncated: false,
        entries: [{ name: 'issue-1.json', sha: 'sha1' }, { name: 'issue-2.json', sha: 'sha2' }],
      }),
      failure: null,
      status: null,
    };
  };
  const r = listClaimNames(ghApi, 'acme/w');
  assert.deepEqual(r, { names: ['issue-1.json', 'issue-2.json'], failure: null });
});

test('listClaimNames: failure -> empty names, failure propagated', () => {
  const ghApi = () => ({ stdout: null, failure: 'gh-absent', status: null });
  const r = listClaimNames(ghApi, 'acme/w');
  assert.deepEqual(r, { names: [], failure: 'gh-absent' });
});

test('defaultGhApi is exported (existence only — no real gh call)', () => {
  assert.equal(typeof defaultGhApi, 'function');
});

// classifyGhApiError is the pure text-matching classifier defaultGhApi's own
// catch block delegates to — tested directly against synthetic error shapes
// so the regexes are pinned without touching the real `gh` binary.

test('classifyGhApiError: ENOENT -> gh-absent', () => {
  const e = { code: 'ENOENT', message: 'spawn gh ENOENT' };
  assert.deepEqual(classifyGhApiError(e), { failure: 'gh-absent', status: null });
});

test('classifyGhApiError: "HTTP 404" / "Not Found" text -> status 404, failure null', () => {
  assert.deepEqual(classifyGhApiError(new Error('gh: Not Found (HTTP 404)')), { failure: null, status: 404 });
});

test('classifyGhApiError: "HTTP 422" status text -> write-conflict, status 422, failure null', () => {
  const e = { message: '', stderr: 'gh: HTTP 422: Unprocessable Entity (...)', stdout: '' };
  assert.deepEqual(classifyGhApiError(e), { failure: null, status: 422 });
});

test('classifyGhApiError: "Unprocessable" reason phrase alone -> status 422', () => {
  const e = { message: '', stderr: 'Unprocessable Entity', stdout: '' };
  assert.deepEqual(classifyGhApiError(e), { failure: null, status: 422 });
});

test('classifyGhApiError: live-confirmed "Validation failed" body wording -> status 422', () => {
  // Live-confirmed wording (gh-api-module-pattern skill) for a lost
  // create-only race: GitHub answers "Validation failed: Target issue has
  // already been taken" — accepted even without the literal "HTTP 422" or
  // "Unprocessable" substrings present.
  const e = new Error('gh: Validation failed: Target issue has already been taken (HTTP 422)');
  assert.deepEqual(classifyGhApiError(e), { failure: null, status: 422 });
});

test('classifyGhApiError: 404 text wins over a coincidental 422 mention', () => {
  const e = new Error('gh: Not Found (HTTP 404) — see HTTP 422 docs');
  assert.deepEqual(classifyGhApiError(e), { failure: null, status: 404 });
});

// A 409 is the Contents API's rejection for a conditional-write sha
// mismatch — someone else's write landed between this read and this write.
// Same write-conflict classification as a 422 (see the 422 block above):
// live-confirmed wording varies ("HTTP 409", the "Conflict" reason phrase,
// or the body's "...does not match..." text), so all three are accepted
// case-insensitively, symmetric with the 422 regex's three-way accept.
test('classifyGhApiError: "HTTP 409" status text -> write-conflict, status 409, failure null', () => {
  const e = { message: '', stderr: 'gh: HTTP 409: Conflict (...)', stdout: '' };
  assert.deepEqual(classifyGhApiError(e), { failure: null, status: 409 });
});

test('classifyGhApiError: "Conflict" reason phrase alone -> status 409', () => {
  const e = { message: '', stderr: 'Conflict', stdout: '' };
  assert.deepEqual(classifyGhApiError(e), { failure: null, status: 409 });
});

test('classifyGhApiError: sha-mismatch body wording ("does not match") -> status 409', () => {
  const e = new Error('gh: sha does not match (HTTP 409)');
  assert.deepEqual(classifyGhApiError(e), { failure: null, status: 409 });
});

test('classifyGhApiError: 404 text wins over a coincidental 409 mention', () => {
  const e = new Error('gh: Not Found (HTTP 404) — see HTTP 409 docs');
  assert.deepEqual(classifyGhApiError(e), { failure: null, status: 404 });
});

test('classifyGhApiError: generic error text -> network-failure, status null', () => {
  assert.deepEqual(classifyGhApiError(new Error('connection reset by peer')), { failure: 'network-failure', status: null });
});

test('writeClaimBlob: write-conflict (status 422) -> ok:false, conflict:true, failure:null (lost race, not a transient failure)', () => {
  const ghApi = (args) => {
    if (isWrite(args, 'claims/issue-7.json')) return { stdout: null, failure: null, status: 422 };
    // The self-write recheck's own re-read (#787 hindsight finding) —
    // reports someone else's content, so this stays a genuine contest.
    if (isRead(args, 'claims/issue-7.json')) return { stdout: JSON.stringify({ content: '{"runId":"rival"}', sha: 'rivalsha' }), failure: null, status: null };
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const r = writeClaimBlob({ ghApi }, 'acme/w', 7, { content: '{}', sha: 'deadbeef', message: 'x' });
  assert.deepEqual(r, { ok: false, conflict: true, failure: null });
});

test('writeClaimBlob: write-conflict (status 409, sha-mismatch) -> ok:false, conflict:true, failure:null — same signal as a 422 (#723)', () => {
  const ghApi = (args) => {
    if (isWrite(args, 'claims/issue-7.json')) return { stdout: null, failure: null, status: 409 };
    if (isRead(args, 'claims/issue-7.json')) return { stdout: JSON.stringify({ content: '{"runId":"rival"}', sha: 'rivalsha' }), failure: null, status: null };
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const r = writeClaimBlob({ ghApi }, 'acme/w', 7, { content: '{}', sha: 'deadbeef', message: 'x' });
  assert.deepEqual(r, { ok: false, conflict: true, failure: null });
});

test('writeClaimBlob: a ghApi that never sets status (release-merged.js\'s own) is unaffected by the 422 branch', () => {
  // Mirrors release-merged.js's own local ghApi, which never sets `status`
  // at all — proves the new `r.status === 422` branch can never fire for
  // that consumer, so its `ok` computation (and release-race logging) stays
  // exactly as it was before this change.
  const ghApi = (args) => {
    if (isWrite(args, 'claims/issue-7.json')) return { stdout: null, failure: 'network-failure' }; // no `status` key
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const r = writeClaimBlob({ ghApi }, 'acme/w', 7, { content: '{}', message: 'x' });
  assert.deepEqual(r, { ok: false, failure: 'network-failure' });
});

test('listClaimEntries: returns name + sha per entry from the same single Git Trees API call listClaimNames already made', () => {
  const { listClaimEntries } = require('../../../plugin/bin/lib/issues/claim-store');
  let seenArgs = null;
  const ghApi = (args) => {
    seenArgs = args;
    return {
      stdout: JSON.stringify({
        truncated: false,
        entries: [{ name: 'issue-7.json', sha: 'sha7' }, { name: 'issue-9.json', sha: 'sha9' }],
      }),
      failure: null,
      status: null,
    };
  };
  const r = listClaimEntries(ghApi, 'acme/w');
  assert.deepEqual(r, { entries: [{ name: 'issue-7.json', sha: 'sha7' }, { name: 'issue-9.json', sha: 'sha9' }], failure: null });
  assert.match(seenArgs[0], /repos\/acme\/w\/git\/trees\/claims-registry\?recursive=1/);
  assert.ok(!seenArgs.includes('-f'), 'must never pass recursive=1 as a -f field -- it flips gh api to POST');
  assert.match(seenArgs.join(' '), /-q .*name.*sha/);
});

test('listClaimNames: still works, now a thin wrapper over listClaimEntries', () => {
  const { listClaimNames } = require('../../../plugin/bin/lib/issues/claim-store');
  const ghApi = () => ({ stdout: JSON.stringify({ truncated: false, entries: [{ name: 'issue-7.json', sha: 'sha7' }] }), failure: null, status: null });
  assert.deepEqual(listClaimNames(ghApi, 'acme/w'), { names: ['issue-7.json'], failure: null });
});

test('listClaimEntries: a tree response reporting more than 1000 blobs under claims/ returns every entry, uncapped (#3098 AC1)', () => {
  const { listClaimEntries } = require('../../../plugin/bin/lib/issues/claim-store');
  const big = [];
  for (let i = 1; i <= 1333; i += 1) big.push({ name: `issue-${i}.json`, sha: `sha${i}` });
  const ghApi = () => ({ stdout: JSON.stringify({ truncated: false, entries: big }), failure: null, status: null });
  const r = listClaimEntries(ghApi, 'acme/w');
  assert.equal(r.failure, null);
  assert.equal(r.entries.length, 1333);
  assert.deepEqual(r.entries[1332], { name: 'issue-1333.json', sha: 'sha1333' });
});

test('listClaimEntries: a truncated tree response surfaces as its own failure, never a silently partial list (#3098 AC3)', () => {
  const { listClaimEntries } = require('../../../plugin/bin/lib/issues/claim-store');
  const ghApi = () => ({
    stdout: JSON.stringify({ truncated: true, entries: [{ name: 'issue-1.json', sha: 'sha1' }] }),
    failure: null,
    status: null,
  });
  const r = listClaimEntries(ghApi, 'acme/w');
  assert.deepEqual(r, { entries: [], failure: 'truncated' });
});

test('listClaimEntries: never passes recursive=1 as a -f/-F field (#3098 regression -- gh api switches GET to POST the instant any -f/-F is present, and git/trees has no POST route; confirmed live: a -f recursive=1 call 404s, the identical request with recursive=1 folded into the path succeeds)', () => {
  const { listClaimEntries } = require('../../../plugin/bin/lib/issues/claim-store');
  let seenArgs = null;
  const ghApi = (args) => {
    seenArgs = args;
    return { stdout: JSON.stringify({ truncated: false, entries: [] }), failure: null, status: null };
  };
  listClaimEntries(ghApi, 'acme/w');
  assert.ok(!seenArgs.includes('-f') && !seenArgs.includes('-F'), `recursive=1 must be a literal query-string segment on the path, never a -f/-F field: ${JSON.stringify(seenArgs)}`);
  assert.match(seenArgs[0], /\?recursive=1\b/);
});

test('classifyGhApiError: secondary rate limit is distinct from network-failure', () => {
  const err = new Error('gh: You have exceeded a secondary rate limit (HTTP 403)');
  err.stderr = 'gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)';
  assert.deepEqual(classifyGhApiError(err), { failure: 'secondary-rate-limit', status: 403 });
});

test('classifyGhApiError: Retry-After signature also reads as secondary rate limit', () => {
  const err = new Error('gh: API rate limit exceeded (HTTP 403)');
  err.stderr = 'gh: API rate limit exceeded (HTTP 403)\nRetry-After: 60';
  assert.deepEqual(classifyGhApiError(err), { failure: 'secondary-rate-limit', status: 403 });
});

test('AC1.1: classifyGhApiError: a plain HTTP 403 (no rate-limit text) -> permission-denied, never network-failure', () => {
  const err = new Error('gh: Resource not accessible by integration (HTTP 403)');
  assert.deepEqual(classifyGhApiError(err), { failure: 'permission-denied', status: 403 });
});

test('AC1.1: classifyGhApiError: HTTP 401 -> permission-denied', () => {
  const err = new Error('gh: Bad credentials (HTTP 401)');
  assert.deepEqual(classifyGhApiError(err), { failure: 'permission-denied', status: 401 });
});

test('AC6.1: classifyGhApiError: a primary rate-limit 403 ("API rate limit exceeded", no Retry-After) is network-failure, never permission-denied', () => {
  const err = new Error('gh: API rate limit exceeded for installation ID 4242. (HTTP 403)');
  assert.deepEqual(classifyGhApiError(err), { failure: 'network-failure', status: null });
});

test('AC6.1: classifyGhApiError: a 403/429 carrying X-RateLimit-Remaining: 0 is network-failure', () => {
  const e403 = new Error('gh: HTTP 403'); e403.stderr = 'HTTP 403\nX-RateLimit-Remaining: 0';
  const e429 = new Error('gh: HTTP 429'); e429.stderr = 'HTTP 429\nX-RateLimit-Remaining: 0';
  assert.deepEqual(classifyGhApiError(e403), { failure: 'network-failure', status: null });
  assert.deepEqual(classifyGhApiError(e429), { failure: 'network-failure', status: null });
});

test('classifyGhApiError: a transport error with no HTTP status stays network-failure', () => {
  assert.deepEqual(classifyGhApiError(new Error('connect ETIMEDOUT 140.82.112.6:443')), { failure: 'network-failure', status: null });
});

// Git-CAS-first, contents-API-fallback behavior (#787's amendment). These
// exercise `readClaimBlob`/`writeClaimBlob`'s new `deps: {ghApi, gitRunner?}`
// shape directly against a fake `gitRunner` — never real `git` (the real
// plumbing sequence is proven in tests/bin-lib/issues/claims-git-cas.test.js).

function fakeGitRunnerAlwaysWorks(tipSha, existingContent) {
  return (args) => {
    // readClaimBlobGit fetches into a per-call scratch ref rather than
    // FETCH_HEAD (#787 hindsight finding — a shared pseudo-ref races a
    // concurrent fetch elsewhere in the same checkout) — match by shape
    // (fetch's 2nd positional arg, rev-parse against whatever ref name was
    // just fetched into) instead of the literal old 'FETCH_HEAD' name.
    if (args[0] === 'fetch') return '';
    if (args[0] === 'rev-parse' && args[1] !== 'FETCH_HEAD') return `${tipSha}\n`;
    if (args[0] === 'update-ref' && args[1] === '-d') return '';
    if (args[0] === 'show') {
      if (existingContent === null) { const e = new Error(`fatal: path does not exist in '${tipSha}'`); throw e; }
      return existingContent;
    }
    if (args[0] === 'hash-object') return 'deadbeef\n';
    if (args[0] === 'read-tree') return '';
    if (args[0] === 'update-index') return '';
    if (args[0] === 'write-tree') return 'newtree\n';
    if (args[0] === 'commit-tree') return 'newcommit\n';
    if (args[0] === 'push') return '';
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
}

function fakeGitRunnerAlwaysFails() {
  return () => { const e = new Error('fatal: unable to access: Could not resolve host'); throw e; };
}

// Drives writeClaimBlob's git-CAS retry loop (#787 final-review finding I1).
// `pushes` is consumed one entry per push attempt ('ok' | 'reject'); `reads`
// one entry per post-rejection verification read ({content, tipSha} — a null
// content means the path is absent on that tip). Records every call so a test
// can assert the number of pushes and which lease each one carried.
function fakeGitCasRunner({ pushes, reads }) {
  const state = { calls: [], pushCount: 0, readCount: 0 };
  const runner = (args) => {
    state.calls.push(args);
    switch (args[0]) {
      case 'hash-object': return 'blobsha\n';
      case 'read-tree': case 'update-index': return '';
      case 'write-tree': return 'treesha\n';
      case 'commit-tree': return 'commitsha\n';
      case 'push': {
        const outcome = pushes[state.pushCount];
        state.pushCount += 1;
        if (outcome === 'ok') return '';
        const e = new Error('! [rejected] claims-registry -> claims-registry (stale info)');
        e.stderr = e.message;
        throw e;
      }
      case 'fetch': return '';
      case 'rev-parse': return `${reads[state.readCount].tipSha}\n`;
      case 'show': {
        const r = reads[state.readCount];
        state.readCount += 1;
        if (r.content === null) throw new Error(`fatal: path 'claims/issue-42.json' does not exist in '${r.tipSha}'`);
        return r.content;
      }
      default: throw new Error(`unexpected git call: ${args.join(' ')}`);
    }
  };
  return { runner, state };
}
const leasesOf = (state) => state.calls.filter((a) => a[0] === 'push').map((a) => String(a[3]).split(':').pop());

const HELD_BY_STALE = '{"runId":"stale-run"}';
const HELD_BY_RIVAL = '{"runId":"rival-run"}';

// (a) A rejected push whose fresh read shows the SAME content this write's
// decision was based on is NOT a contest — the git-CAS lease is on the whole
// `claims-registry` branch tip, so an unrelated agent's commit rejects a push
// that has nothing to do with this claim. Retry on the fresh tip (#787 I1).
test('writeClaimBlob: a git-CAS rejection whose fresh read shows UNCHANGED content is spurious — retried on the fresh lease, then succeeds', () => {
  const { runner, state } = fakeGitCasRunner({
    pushes: ['reject', 'ok'],
    reads: [{ content: HELD_BY_STALE, tipSha: 'b'.repeat(40) }],
  });
  const ghApi = () => { throw new Error('contents-API must not be called — this never left the git transport'); };
  const result = writeClaimBlob({ ghApi, gitRunner: runner, sleep: () => {} }, 'acme/w', 42, {
    content: '{"runId":"me"}', message: 'Claim #42', sha: 'a'.repeat(40), expectedContent: HELD_BY_STALE,
  });
  assert.equal(result.ok, true);
  assert.equal(state.pushCount, 2, 'the spurious rejection must be retried, not reported as a contest');
  assert.deepEqual(leasesOf(state), ['a'.repeat(40), 'b'.repeat(40)], 'the retry leases against the FRESH tip, never the stale one');
});

// (b) The same rejection, but the fresh read shows someone else's claim: a
// genuine contest. Report it immediately — no second push, no fallback.
test('writeClaimBlob: a git-CAS rejection whose fresh read shows DIFFERENT content is a genuine contest — conflict, no retry', () => {
  const { runner, state } = fakeGitCasRunner({
    pushes: ['reject'],
    reads: [{ content: HELD_BY_RIVAL, tipSha: 'b'.repeat(40) }],
  });
  const ghApi = () => { throw new Error('contents-API must not be called on a genuine contest'); };
  const result = writeClaimBlob({ ghApi, gitRunner: runner }, 'acme/w', 42, {
    content: '{"runId":"me"}', message: 'Claim #42', sha: 'a'.repeat(40), expectedContent: HELD_BY_STALE,
  });
  assert.deepEqual(result, { ok: false, conflict: true, failure: null });
  assert.equal(state.pushCount, 1, 'a genuine contest is reported after exactly one verification read — never retried');
  assert.equal(state.readCount, 1);
});

// The retry is bounded. A rejection that verifies as spurious on every attempt
// means the branch is too busy to land the git-CAS write on — it must fall
// through to the contents-API fallback below (the whole reason that fallback
// exists), never report a bare transport-failure while a still-functional
// fallback transport goes untried.
test('writeClaimBlob: a rejection that stays spurious for every git-CAS attempt falls through to the contents-API fallback', () => {
  const { runner, state } = fakeGitCasRunner({
    pushes: ['reject', 'reject', 'reject'],
    reads: [
      { content: HELD_BY_STALE, tipSha: 'b'.repeat(40) },
      { content: HELD_BY_STALE, tipSha: 'c'.repeat(40) },
      { content: HELD_BY_STALE, tipSha: 'd'.repeat(40) },
    ],
  });
  let ghApiCalls = 0;
  const ghApi = (args) => {
    ghApiCalls += 1;
    if (args[0] === '--method') return { stdout: '', failure: null, status: null }; // the fallback PUT succeeds
    return { stdout: JSON.stringify({ content: HELD_BY_STALE, sha: 'fresh-blob-sha' }), failure: null, status: null };
  };
  const result = writeClaimBlob({ ghApi, gitRunner: runner, sleep: () => {} }, 'acme/w', 42, {
    content: '{"runId":"me"}', message: 'Claim #42', sha: 'a'.repeat(40), expectedContent: HELD_BY_STALE,
  });
  assert.deepEqual(result, { ok: true, failure: null });
  assert.equal(state.pushCount, 3, 'exactly MAX_CAS_ATTEMPTS git pushes — bounded, never a spin');
  assert.equal(ghApiCalls, 2, 'falls through to the contents-API fallback (one verification read, one PUT) instead of giving up with git alone');
});

// If the contents-API fallback ALSO can't land it, the caller sees a genuine
// failure from that transport rather than the git-side transport-failure —
// the exhausted git retry is not itself the final answer once a fallback ran.
test('writeClaimBlob: exhausted git-CAS retries, then a contents-API fallback failure, reports the fallback failure', () => {
  const { runner, state } = fakeGitCasRunner({
    pushes: ['reject', 'reject', 'reject'],
    reads: [
      { content: HELD_BY_STALE, tipSha: 'b'.repeat(40) },
      { content: HELD_BY_STALE, tipSha: 'c'.repeat(40) },
      { content: HELD_BY_STALE, tipSha: 'd'.repeat(40) },
    ],
  });
  const ghApi = () => ({ stdout: null, failure: 'network-failure', status: null });
  const result = writeClaimBlob({ ghApi, gitRunner: runner, sleep: () => {} }, 'acme/w', 42, {
    content: '{"runId":"me"}', message: 'Claim #42', sha: 'a'.repeat(40), expectedContent: HELD_BY_STALE,
  });
  assert.deepEqual(result, { ok: false, failure: 'network-failure' });
  assert.equal(state.pushCount, 3);
});

// A rejected PUT (422/409) can mean this exact write already landed via an
// earlier git-CAS attempt whose local ack was lost to the transport failure
// that brought us here — not a real contest against someone else's write.
test('writeClaimBlob: a fallback PUT rejected as a conflict, but whose live content already matches this write, reports success', () => {
  const { runner, state } = fakeGitCasRunner({
    pushes: ['reject', 'reject', 'reject'],
    reads: [
      { content: HELD_BY_STALE, tipSha: 'b'.repeat(40) },
      { content: HELD_BY_STALE, tipSha: 'c'.repeat(40) },
      { content: HELD_BY_STALE, tipSha: 'd'.repeat(40) },
    ],
  });
  const THIS_WRITE_CONTENT = '{"runId":"me"}';
  let ghApiCalls = 0;
  const ghApi = (args) => {
    ghApiCalls += 1;
    // First call: the pre-PUT fallback re-read. Reports the OLD content
    // (matches expectedContent), so the code proceeds to the PUT below.
    if (ghApiCalls === 1) return { stdout: JSON.stringify({ content: HELD_BY_STALE, sha: 'fresh-blob-sha' }), failure: null, status: null };
    // Second call: the PUT itself, rejected as a sha mismatch (someone —
    // really, this run's own earlier git-CAS attempt — already updated it).
    if (ghApiCalls === 2) return { stdout: null, failure: null, status: 409 };
    // Third call: the self-write recheck re-read shows THIS write's own
    // content already live.
    return { stdout: JSON.stringify({ content: THIS_WRITE_CONTENT, sha: 'landed-blob-sha' }), failure: null, status: null };
  };
  const result = writeClaimBlob({ ghApi, gitRunner: runner, sleep: () => {} }, 'acme/w', 42, {
    content: THIS_WRITE_CONTENT, message: 'Claim #42', sha: 'a'.repeat(40), expectedContent: HELD_BY_STALE,
  });
  assert.deepEqual(result, { ok: true, failure: null });
  assert.equal(state.pushCount, 3);
  assert.equal(ghApiCalls, 3);
});

// Same self-write scenario, but the pre-PUT fallback re-read itself already
// shows this write's own content live (the earlier ack-lost write landed
// before the fallback even issued its PUT) — resolved without ever calling PUT.
test('writeClaimBlob: the pre-PUT fallback re-read already shows this write\'s own content live — reports success without a PUT', () => {
  const { runner, state } = fakeGitCasRunner({
    pushes: ['reject', 'reject', 'reject'],
    reads: [
      { content: HELD_BY_STALE, tipSha: 'b'.repeat(40) },
      { content: HELD_BY_STALE, tipSha: 'c'.repeat(40) },
      { content: HELD_BY_STALE, tipSha: 'd'.repeat(40) },
    ],
  });
  const THIS_WRITE_CONTENT = '{"runId":"me"}';
  const ghApi = (args) => {
    if (args[0] === '--method') throw new Error('the PUT must not be attempted — the self-write check already resolved this as a success');
    return { stdout: JSON.stringify({ content: THIS_WRITE_CONTENT, sha: 'landed-blob-sha' }), failure: null, status: null };
  };
  const result = writeClaimBlob({ ghApi, gitRunner: runner, sleep: () => {} }, 'acme/w', 42, {
    content: THIS_WRITE_CONTENT, message: 'Claim #42', sha: 'a'.repeat(40), expectedContent: HELD_BY_STALE,
  });
  assert.deepEqual(result, { ok: true, failure: null });
  assert.equal(state.pushCount, 3);
});

// The git-CAS retry loop now backs off with increasing jitter between
// attempts, mirroring health-core/durable-state.js's casBackoffMs — a
// collision on retry is exactly as likely as the first one with no
// de-synchronization from other writers on the same busy branch.
test('writeClaimBlob: backs off between git-CAS retry attempts, never after the final one', () => {
  const { runner } = fakeGitCasRunner({
    pushes: ['reject', 'reject', 'ok'],
    reads: [
      { content: HELD_BY_STALE, tipSha: 'b'.repeat(40) },
      { content: HELD_BY_STALE, tipSha: 'c'.repeat(40) },
    ],
  });
  const ghApi = () => { throw new Error('contents-API must not be called — this never left the git transport'); };
  const sleepCalls = [];
  const result = writeClaimBlob({ ghApi, gitRunner: runner, sleep: (ms) => sleepCalls.push(ms) }, 'acme/w', 42, {
    content: '{"runId":"me"}', message: 'Claim #42', sha: 'a'.repeat(40), expectedContent: HELD_BY_STALE,
  });
  assert.equal(result.ok, true);
  assert.equal(sleepCalls.length, 2, 'sleeps between attempts 1->2 and 2->3, never after the final successful one');
  for (const ms of sleepCalls) assert.ok(ms > 0, `every wait must be a positive duration, got ${ms}`);
  assert.ok(sleepCalls[1] > sleepCalls[0], `wait must increase across attempts: ${sleepCalls}`);
});

// A create-only write has no prior content to compare, so its verification is
// absence: still absent = the unrelated-activity case (retry); now present =
// someone else's create landed first (a genuine contest).
test('writeClaimBlob: create-only — a rejection whose fresh read still shows the target ABSENT retries', () => {
  const { runner, state } = fakeGitCasRunner({
    pushes: ['reject', 'ok'],
    reads: [{ content: null, tipSha: 'b'.repeat(40) }],
  });
  const ghApi = () => { throw new Error('contents-API must not be called — this never left the git transport'); };
  const result = writeClaimBlob({ ghApi, gitRunner: runner, sleep: () => {} }, 'acme/w', 42, {
    content: '{"runId":"me"}', message: 'Claim #42', sha: 'a'.repeat(40), createOnly: true,
  });
  assert.equal(result.ok, true);
  assert.equal(state.pushCount, 2);
});

test('writeClaimBlob: create-only — a rejection whose fresh read shows a blob now PRESENT is a genuine contest', () => {
  const { runner, state } = fakeGitCasRunner({
    pushes: ['reject'],
    reads: [{ content: HELD_BY_RIVAL, tipSha: 'b'.repeat(40) }],
  });
  const ghApi = () => { throw new Error('contents-API must not be called on a genuine contest'); };
  const result = writeClaimBlob({ ghApi, gitRunner: runner }, 'acme/w', 42, {
    content: '{"runId":"me"}', message: 'Claim #42', sha: 'a'.repeat(40), createOnly: true,
  });
  assert.deepEqual(result, { ok: false, conflict: true, failure: null });
  assert.equal(state.pushCount, 1);
});

test('writeClaimBlob: a rejection whose verification read itself fails is transport-failure — never a guessed contest', () => {
  let pushed = false;
  const gitRunner = (args) => {
    if (args[0] === 'push') {
      pushed = true;
      const e = new Error('! [rejected] (stale info)'); e.stderr = e.message; throw e;
    }
    if (args[0] === 'fetch') throw new Error('fatal: unable to access: Could not resolve host');
    if (args[0] === 'hash-object') return 'blobsha\n';
    if (args[0] === 'write-tree') return 'treesha\n';
    if (args[0] === 'commit-tree') return 'commitsha\n';
    return '';
  };
  const ghApi = () => { throw new Error('contents-API must not be called when the verification read failed'); };
  const result = writeClaimBlob({ ghApi, gitRunner }, 'acme/w', 42, {
    content: '{}', message: 'Claim #42', sha: 'a'.repeat(40), expectedContent: HELD_BY_STALE,
  });
  assert.equal(pushed, true);
  assert.deepEqual(result, { ok: false, failure: 'transport-failure' });
});

test('readClaimBlob: git-CAS succeeds, contents-API never called', () => {
  const gitRunner = fakeGitRunnerAlwaysWorks('a'.repeat(40), null);
  const ghApi = () => { throw new Error('contents-API must not be called when git-CAS succeeds'); };
  const result = readClaimBlob({ ghApi, gitRunner }, 'acme/w', 42);
  assert.equal(result.absent, true);
});

test('readClaimBlob: git-CAS transport failure falls back to contents-API', () => {
  const gitRunner = fakeGitRunnerAlwaysFails();
  const ghApi = (args) => {
    assert.equal(isRead(args, 'claims/issue-42.json'), true);
    return { stdout: JSON.stringify({ content: null, sha: null }), failure: null, status: 404 };
  };
  const result = readClaimBlob({ ghApi, gitRunner }, 'acme/w', 42);
  assert.equal(result.absent, true);
});

test('writeClaimBlob: git-CAS succeeds, contents-API never called', () => {
  const gitRunner = fakeGitRunnerAlwaysWorks('a'.repeat(40), null);
  const ghApi = () => { throw new Error('contents-API must not be called when git-CAS succeeds'); };
  const result = writeClaimBlob({ ghApi, gitRunner }, 'acme/w', 42, { content: '{}', message: 'Claim #42', sha: 'a'.repeat(40) });
  assert.equal(result.ok, true);
});

// A git-CAS contest, once the verification read below confirms the claim's
// content really did change, is reported as-is — never retried against the
// contents API, which would race the same write under two different
// concurrency mechanisms. (The verification itself is #787's I1 fix; before
// it, ANY rejection landed here, including one caused by a commit claiming an
// unrelated issue.)
test('writeClaimBlob: a verified git-CAS contest is reported, not falling back to contents-API', () => {
  const { runner } = fakeGitCasRunner({
    pushes: ['reject'],
    reads: [{ content: HELD_BY_RIVAL, tipSha: 'b'.repeat(40) }],
  });
  const ghApi = () => { throw new Error('contents-API must not be called on a genuine contest'); };
  const result = writeClaimBlob({ ghApi, gitRunner: runner }, 'acme/w', 42, {
    content: '{}', message: 'Claim #42', sha: 'a'.repeat(40), expectedContent: HELD_BY_STALE,
  });
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
});

// (c) The exact C1 lost-update. A git-CAS transport failure falls back to the
// contents API, which re-derives a fresh blob sha — but a fresh lease is valid
// for SOME write, not necessarily the one this caller decided to make. When
// the fresh read shows a DIFFERENT holder's claim landed while git-CAS was
// failing, writing with that lease silently overwrote it: a double-claim.
// It must resolve as a contest instead.
test('writeClaimBlob: fallback fresh-read showing ANOTHER holder\'s content is a genuine contest, never a blind overwrite (#787 C1)', () => {
  const gitRunner = fakeGitRunnerAlwaysFails();
  const calls = [];
  const ghApi = (args) => {
    calls.push(args);
    if (isRead(args, 'claims/issue-42.json')) {
      return { stdout: JSON.stringify({ content: HELD_BY_RIVAL, sha: 'freshblobsha' }), failure: null, status: null };
    }
    throw new Error('the PUT must NOT be attempted — that is the lost update this test pins');
  };
  const result = writeClaimBlob({ ghApi, gitRunner }, 'acme/w', 42, {
    content: '{}', message: 'Claim #42', sha: 'a'.repeat(40), expectedContent: HELD_BY_STALE,
  });
  assert.deepEqual(result, { ok: false, conflict: true, failure: null });
  assert.equal(calls.length, 1, 'the fresh read happens; the write does not');
});

test('writeClaimBlob: git-CAS secondary-rate-limit falls back to contents-API with a FRESH blob sha, never the git tip sha', () => {
  // The git-CAS lease is a *commit* sha; the contents API's `-f sha=` wants a
  // *blob* sha. Reusing the tip sha across the fallback made every fallback
  // write 409/422 — reported as `conflict: true`, i.e. a secondary rate
  // limit misread as contested, the exact record-697 regression #787 exists
  // to prevent. The fallback must re-read through the contents API first —
  // and, since #787's C1 fix, may only proceed when that read shows the
  // content this write's decision was based on (`expectedContent`).
  const gitRunner = () => { const e = new Error('remote: secondary rate limit'); e.stderr = e.message; throw e; };
  const calls = [];
  const ghApi = (args) => {
    calls.push(args);
    if (isRead(args, 'claims/issue-42.json')) {
      return { stdout: JSON.stringify({ content: HELD_BY_STALE, sha: 'freshblobsha' }), failure: null, status: null };
    }
    if (isWrite(args, 'claims/issue-42.json')) return { stdout: '', failure: null, status: null };
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const result = writeClaimBlob({ ghApi, gitRunner }, 'acme/w', 42, {
    content: '{}', message: 'Claim #42', sha: 'a'.repeat(40), expectedContent: HELD_BY_STALE,
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2, 'fallback must re-read once, then write once');
  assert.equal(isRead(calls[0], 'claims/issue-42.json'), true);
  assert.equal(isWrite(calls[1], 'claims/issue-42.json'), true);
  assert.equal(fieldOf(calls[1], 'sha'), 'freshblobsha', 'the PUT must carry the fresh contents-API blob sha, not the stale git tip sha');
  assert.notEqual(fieldOf(calls[1], 'sha'), 'a'.repeat(40));
});

test('writeClaimBlob: fallback fresh-read failure returns that failure — never a spurious conflict', () => {
  const gitRunner = () => { const e = new Error('fatal: unable to access: Could not resolve host'); throw e; };
  const ghApi = (args) => {
    if (isRead(args, 'claims/issue-42.json')) return { stdout: null, failure: 'network-failure', status: null };
    throw new Error('the PUT must not be attempted when the fresh sha read failed');
  };
  const result = writeClaimBlob({ ghApi, gitRunner }, 'acme/w', 42, { content: '{}', message: 'Claim #42', sha: 'a'.repeat(40) });
  assert.deepEqual(result, { ok: false, failure: 'network-failure' });
});

test('writeClaimBlob: fallback fresh-read showing the target now absent is a genuine contest', () => {
  // Released or broken between the git read and this fallback — a real
  // contest, so `conflict: true` here is correct (unlike the tip-sha bug,
  // which manufactured one out of a transport failure).
  const gitRunner = () => { const e = new Error('fatal: unable to access: Could not resolve host'); throw e; };
  const ghApi = (args) => {
    if (isRead(args, 'claims/issue-42.json')) return { stdout: null, failure: null, status: 404 };
    throw new Error('the PUT must not be attempted when the target vanished');
  };
  const result = writeClaimBlob({ ghApi, gitRunner }, 'acme/w', 42, { content: '{}', message: 'Claim #42', sha: 'a'.repeat(40) });
  assert.deepEqual(result, { ok: false, conflict: true, failure: null });
});

test('writeClaimBlob: create-only write WITH a tip-sha lease takes the git-CAS path (the fleet\'s most-contended write moves off the contents API)', () => {
  const gitCalls = [];
  const inner = fakeGitRunnerAlwaysWorks('a'.repeat(40), null);
  const gitRunner = (args, opts) => { gitCalls.push(args); return inner(args, opts); };
  const ghApi = () => { throw new Error('contents-API must not be called when git-CAS succeeds'); };
  const result = writeClaimBlob({ ghApi, gitRunner }, 'acme/w', 42, {
    content: '{}', message: 'Claim #42', sha: 'a'.repeat(40), createOnly: true,
  });
  assert.equal(result.ok, true);
  assert.equal(gitCalls.some((a) => a[0] === 'push'), true, 'a create-only claim must actually reach the git-CAS push');
});

test('writeClaimBlob: create-only git-CAS transport failure falls back to contents-API with NO sha and no fresh read', () => {
  const gitRunner = fakeGitRunnerAlwaysFails();
  const calls = [];
  const ghApi = (args) => {
    calls.push(args);
    if (isWrite(args, 'claims/issue-42.json')) return { stdout: '', failure: null, status: null };
    throw new Error(`unexpected ${args.join(' ')} — a create-only fallback must not re-read`);
  };
  const result = writeClaimBlob({ ghApi, gitRunner }, 'acme/w', 42, {
    content: '{}', message: 'Claim #42', sha: 'a'.repeat(40), createOnly: true,
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1, 'create-only fallback is a single PUT — nothing to re-derive');
  assert.equal(fieldOf(calls[0], 'sha'), undefined, 'a create-only PUT must never carry a sha, git-tip-shaped or otherwise');
});

test('writeClaimBlob: no gitRunner supplied goes straight to contents-API (fallback seam for gh-absent-but-git-also-unavailable environments)', () => {
  const ghApi = (args) => {
    assert.equal(isWrite(args, 'claims/issue-1.json'), true);
    return { stdout: '', failure: null, status: null };
  };
  const result = writeClaimBlob({ ghApi }, 'acme/w', 1, { content: '{}', message: 'Claim #1' });
  assert.equal(result.ok, true);
});

test('writeClaimBlob: create-only write (no sha) skips git-CAS even when gitRunner is supplied — no CAS lease to compare against', () => {
  const gitRunner = () => { throw new Error('git-CAS must not be attempted for a create-only write with no sha lease'); };
  const ghApi = (args) => {
    assert.equal(isWrite(args, 'claims/issue-1.json'), true);
    assert.equal(fieldOf(args, 'sha'), undefined);
    return { stdout: '', failure: null, status: null };
  };
  const result = writeClaimBlob({ ghApi, gitRunner }, 'acme/w', 1, { content: '{}', message: 'Claim #1' });
  assert.equal(result.ok, true);
});

// ---- tombstoneInFlightPr: same-repo link validation (#315 review follow-up) ----
// Migrated verbatim from tests/bin-lib/issues/claim-engine.test.js (#787 —
// claim-engine.js retired, tombstoneInFlightPr moved to claim-store.js).
// `link` is read straight from a claims-registry blob, writable by any
// session with registry-branch access. An unvalidated `link` could point at
// a permanently-open PR in an unrelated repo (or a malformed/non-string
// value) and wedge every future reclaim of the real issue — a stored-DoS on
// the claim path. Every invalid shape must return null WITHOUT ever calling
// `runner` (no `gh pr view`), falling through to ordinary reclaim exactly
// like a missing link.

const TIF_T0 = 1720000000000;

function tifProOpenedTombstone(link) {
  return JSON.stringify({
    released: true, runId: 'run-1', reason: 'pr-opened: spec 272', releasedAt: new Date(TIF_T0).toISOString(), link,
  });
}

function tifRefusesWithoutRunnerCall(link) {
  const calls = [];
  const runner = (args) => { calls.push(args); return 'OPEN\n'; };
  const content = tifProOpenedTombstone(link);
  const result = tombstoneInFlightPr(content, runner, 'acme', 'w');
  assert.equal(result, null);
  assert.equal(calls.length, 0, 'an invalid link must never reach the runner (no gh pr view call)');
}

test('tombstoneInFlightPr: link pointing at a DIFFERENT repo -> null, no runner call', () => {
  tifRefusesWithoutRunnerCall('https://github.com/other-owner/other-repo/pull/304');
});

test('tombstoneInFlightPr: malformed/non-URL link -> null, no runner call', () => {
  tifRefusesWithoutRunnerCall('not-a-url');
});

test('tombstoneInFlightPr: non-string link (a number) -> null, no runner call', () => {
  const calls = [];
  const runner = (args) => { calls.push(args); return 'OPEN\n'; };
  const content = JSON.stringify({
    released: true, runId: 'run-1', reason: 'pr-opened: spec 272', releasedAt: new Date(TIF_T0).toISOString(), link: 304,
  });
  const result = tombstoneInFlightPr(content, runner, 'acme', 'w');
  assert.equal(result, null);
  assert.equal(calls.length, 0, 'a non-string link must never reach the runner');
});

test('tombstoneInFlightPr: a flag-shaped link ("--repo") -> null, no runner call', () => {
  tifRefusesWithoutRunnerCall('--repo');
});

test('tombstoneInFlightPr: same-repo, well-formed, OPEN link -> { link }, one runner call', () => {
  const calls = [];
  const runner = (args) => { calls.push(args); return 'OPEN\n'; };
  const content = tifProOpenedTombstone('https://github.com/acme/w/pull/304');
  const result = tombstoneInFlightPr(content, runner, 'acme', 'w');
  assert.deepEqual(result, { link: 'https://github.com/acme/w/pull/304' });
  assert.equal(calls.length, 1);
});

test('createClaimReader: git hit returns content and chains the git tip (one fetch for two reads)', () => {
  let fetches = 0;
  const base = fakeGitRunnerAlwaysWorks('a'.repeat(40), '{"runId":"r1"}');
  const gitRunner = (args) => { if (args[0] === 'fetch') fetches += 1; return base(args); };
  const ghApi = () => { throw new Error('contents API must not be called on a git hit'); };
  const { read } = createClaimReader({ gitRunner, ghApi, repoSlug: 'acme/w' });
  assert.deepEqual(read(42), { content: '{"runId":"r1"}' });
  assert.deepEqual(read(43), { content: '{"runId":"r1"}' });
  assert.equal(fetches, 1);
});

test('createClaimReader: git hit with unresolved slug still returns the git answer', () => {
  const gitRunner = fakeGitRunnerAlwaysWorks('a'.repeat(40), null);
  const ghApi = () => { throw new Error('contents API must not be called on a git hit'); };
  assert.deepEqual(createClaimReader({ gitRunner, ghApi, repoSlug: null }).read(42), { content: null });
});

test('createClaimReader: contents-API hit when git fails, and the blob sha never becomes the chained tip', () => {
  let fetches = 0;
  const failing = fakeGitRunnerAlwaysFails();
  const gitRunner = (args) => { if (args[0] === 'fetch') fetches += 1; return failing(args); };
  const ghApi = (args) => {
    assert.equal(isRead(args, 'claims/issue-42.json'), true);
    return { stdout: JSON.stringify({ content: '{"runId":"r2"}', sha: 'blobsha' }), failure: null, status: null };
  };
  const { read } = createClaimReader({ gitRunner, ghApi, repoSlug: 'acme/w' });
  assert.deepEqual(read(42), { content: '{"runId":"r2"}' });
  read(42);
  assert.equal(fetches, 2);
});

test('createClaimReader: contents-API 404 reads as absent ({content: null})', () => {
  const ghApi = (args) => { assert.equal(isRead(args, 'claims/issue-42.json'), true); return { stdout: null, failure: null, status: 404 }; };
  assert.deepEqual(createClaimReader({ gitRunner: fakeGitRunnerAlwaysFails(), ghApi, repoSlug: 'acme/w' }).read(42), { content: null });
});

test('AC1.1: createClaimReader: unresolved slug with a failing git read is a failure, never absent, and never asks repos/null', () => {
  const ghApi = (args) => { throw new Error(`contents API must not be called without a slug: ${args[0]}`); };
  const reader = createClaimReader({ gitRunner: fakeGitRunnerAlwaysFails(), ghApi, repoSlug: null });
  assert.equal(reader.repoSlug, null);
  assert.deepEqual(reader.read(42), { failure: 'repo-slug-unresolved' });
});

test('createClaimReader: a contents-API transport failure propagates as {failure}', () => {
  const ghApi = () => ({ stdout: null, failure: 'network-failure', status: null });
  assert.deepEqual(createClaimReader({ gitRunner: fakeGitRunnerAlwaysFails(), ghApi, repoSlug: 'acme/w' }).read(42), { failure: 'network-failure' });
});

test('createClaimReader: resolves the slug through runGh when none is given', () => {
  const runGh = (args) => { assert.deepEqual(args, ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']); return 'acme/w\n'; };
  assert.equal(createClaimReader({ gitRunner: fakeGitRunnerAlwaysFails(), runGh }).repoSlug, 'acme/w');
});

test('resolveRepoSlug: a thrown or empty gh answer resolves to null', () => {
  assert.equal(resolveRepoSlug(() => { throw new Error('gh: not logged in'); }), null);
  assert.equal(resolveRepoSlug(() => '\n'), null);
});

test('resolveRepoSlugOrThrow: trims the slug, null on empty/absent output, rethrows a gh failure unchanged (AC1)', () => {
  const runGh = (args) => { assert.deepEqual(args, ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']); return 'acme/w\n'; };
  assert.equal(resolveRepoSlugOrThrow(runGh), 'acme/w');
  assert.equal(resolveRepoSlugOrThrow(() => '\n'), null);
  assert.equal(resolveRepoSlugOrThrow(() => undefined), null);
  const timeout = Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT' });
  assert.throws(() => resolveRepoSlugOrThrow(() => { throw timeout; }), (e) => e === timeout);
});

// ---- #4596: the injectable stale-claim matcher, split out of staleClaimInFlightPr ----
const SC_RUN = '2026-10-31T005940-record-4596';
const SC_URL = 'https://github.com/acme/w/pull/7';
const scListed = (over) => ({ url: SC_URL, body: `claude-tweaks-run: ${SC_RUN}`, isCrossRepository: false, ...over });
const scFiller = (n) => Array.from({ length: n }, (_, i) => ({
  url: `https://github.com/acme/w/pull/${1000 + i}`, body: 'unrelated', isCrossRepository: false,
}));

test('openPrListArgs builds the gh pr list argv staleClaimInFlightPr uses', () => {
  const { openPrListArgs } = require('../../../plugin/bin/lib/issues/claim-store');
  assert.deepEqual(openPrListArgs('acme', 'w'), [
    'pr', 'list', '--repo', 'acme/w', '--state', 'open', '--json', 'url,body,isCrossRepository', '--limit', '1000',
  ]);
});

test('staleClaimRunId returns a shaped runId, null for a bad shape, and throws on malformed JSON', () => {
  const { staleClaimRunId } = require('../../../plugin/bin/lib/issues/claim-store');
  assert.equal(staleClaimRunId(JSON.stringify({ runId: SC_RUN })), SC_RUN);
  assert.equal(staleClaimRunId(JSON.stringify({ runId: '../x' })), null);
  assert.equal(staleClaimRunId('{}'), null);
  assert.throws(() => staleClaimRunId('not json'));
});

test('matchStaleClaimPr returns the matched entry, null on no match, and throws on a non-array or a capped no-match listing', () => {
  const { matchStaleClaimPr } = require('../../../plugin/bin/lib/issues/claim-store');
  assert.equal(matchStaleClaimPr(SC_RUN, [scListed()], 'acme', 'w').url, SC_URL);
  assert.equal(matchStaleClaimPr(SC_RUN, [scListed({ isCrossRepository: true })], 'acme', 'w'), null);
  assert.equal(matchStaleClaimPr(SC_RUN, [scListed({ body: `see claude-tweaks-run: ${SC_RUN} here` })], 'acme', 'w'), null);
  assert.throws(() => matchStaleClaimPr(SC_RUN, {}, 'acme', 'w'), /open-PR listing is not an array/);
  assert.throws(() => matchStaleClaimPr(SC_RUN, scFiller(1000), 'acme', 'w'), /1000-entry limit/);
  assert.equal(matchStaleClaimPr(SC_RUN, scFiller(999), 'acme', 'w'), null);
});

test('matchStaleClaimPr returns a { url, body } projection, not the raw listing entry', () => {
  const { matchStaleClaimPr } = require('../../../plugin/bin/lib/issues/claim-store');
  const entry = scListed({ extra: 'dropped' });
  assert.deepEqual(matchStaleClaimPr(SC_RUN, [entry], 'acme', 'w'), { url: SC_URL, body: entry.body });
});

test('matchStaleClaimPr rejects a marked non-cross-repo entry whose url is another repo (the url guard alone)', () => {
  const { matchStaleClaimPr } = require('../../../plugin/bin/lib/issues/claim-store');
  assert.equal(matchStaleClaimPr(SC_RUN, [scListed({ url: 'https://github.com/evil/x/pull/1' })], 'acme', 'w'), null);
});

test('staleClaimInFlightPr runs the shared normalizer: a malformed gh listing reaches onError, as the CLI reports it (#4596)', () => {
  const { staleClaimInFlightPr } = require('../../../plugin/bin/lib/issues/claim-store');
  const claim = JSON.stringify({ runId: SC_RUN });
  const errors = [];
  const noBody = [{ url: SC_URL, isCrossRepository: false }];
  assert.equal(staleClaimInFlightPr(claim, () => JSON.stringify(noBody), 'acme', 'w', (e) => errors.push(e)), null);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /entry 0 is not a PR/);
  const mcpShaped = [{ html_url: SC_URL, body: `claude-tweaks-run: ${SC_RUN}`, head: { repo: { full_name: 'acme/w' } } }];
  assert.deepEqual(staleClaimInFlightPr(claim, () => JSON.stringify(mcpShaped), 'acme', 'w'), { link: SC_URL });
});

test('staleClaimInFlightPr: a null-body same-repo PR before the marked one is skipped, not a failed check (the matcher body guard alone)', () => {
  const { staleClaimInFlightPr } = require('../../../plugin/bin/lib/issues/claim-store');
  const claim = JSON.stringify({ runId: SC_RUN });
  const errors = [];
  const listing = [
    { url: 'https://github.com/acme/w/pull/6', body: null, isCrossRepository: false },
    scListed(),
  ];
  assert.deepEqual(staleClaimInFlightPr(claim, () => JSON.stringify(listing), 'acme', 'w', (e) => errors.push(e)), { link: SC_URL });
  assert.deepEqual(errors, []);
});

// ---- #4495: a remote with no claims-registry branch ------------------------
// The fake ghApi never throws and answers by argv, like every other fake in
// this file; the fake gitRunner throws git-shaped errors (message + stderr).

const BRANCHES_ARGS = ['repos/acme/w/branches/claims-registry', '-q', '.name'];
const DEFAULT_BRANCH_ARGS = ['repos/acme/w', '-q', '.default_branch'];
const MAIN_TIP_ARGS = ['repos/acme/w/git/ref/heads/main', '-q', '.object.sha'];
const POST_REFS_ARGS = ['--method', 'POST', 'repos/acme/w/git/refs', '-f', 'ref=refs/heads/claims-registry', '-f', 'sha=abc123'];
const sameArgs = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function gitError(stderr) {
  const e = new Error('Command failed');
  e.stderr = stderr;
  return e;
}

// A contents-API leg that resolves main -> abc123, then answers the POST with `post`
// and the claims-registry branches read with `branches`; records every call.
function bootstrapGhApi(calls, { post, branches }) {
  return (args) => {
    calls.push(args);
    if (sameArgs(args, DEFAULT_BRANCH_ARGS)) return { stdout: 'main\n', failure: null, status: null };
    if (sameArgs(args, MAIN_TIP_ARGS)) return { stdout: 'abc123\n', failure: null, status: null };
    if (sameArgs(args, POST_REFS_ARGS)) return post;
    if (sameArgs(args, BRANCHES_ARGS)) return branches;
    throw new Error(`unexpected ${args.join(' ')}`);
  };
}

test('readClaimBlob: a git read reporting branchMissing passes it through as absent, no contents-API call', () => {
  const ghCalls = [];
  const gitRunner = (args) => { if (args[0] === 'fetch') { throw gitError("fatal: couldn't find remote ref claims-registry"); } return ''; };
  const r = readClaimBlob({ ghApi: (a) => { ghCalls.push(a); return { stdout: null, failure: null, status: 404 }; }, gitRunner }, 'acme/w', 7);
  assert.equal(r.absent, true);
  assert.equal(r.branchMissing, true);
  assert.equal(r.failure, null);
  assert.equal(r.sha, null);
  assert.equal(r.via, 'git');
  assert.equal(ghCalls.length, 0);
});

test('writeClaimBlob: create-only PUT 404 + absent re-read + branches 404 → branchMissing, not conflict', () => {
  const ghApi = (args) => {
    if (args[0] === '--method') return { stdout: null, failure: null, status: 404 };
    if (String(args[0]).startsWith('repos/acme/w/branches/claims-registry')) return { stdout: null, failure: null, status: 404 };
    return { stdout: null, failure: null, status: 404 }; // contents re-read: absent
  };
  const w = writeClaimBlob({ ghApi }, 'acme/w', 7, { content: '{"a":1}', sha: null, createOnly: true, message: 'm' });
  assert.deepEqual(w, { ok: false, branchMissing: true, failure: null });
});

test('writeClaimBlob: create-only PUT 422 + absent re-read on an EXISTING branch stays a conflict (no bootstrap signal)', () => {
  const ghApi = (args) => {
    if (args[0] === '--method') return { stdout: null, failure: null, status: 422 };
    if (String(args[0]).startsWith('repos/acme/w/branches/claims-registry')) return { stdout: 'claims-registry\n', failure: null, status: null };
    return { stdout: null, failure: null, status: 404 };
  };
  const w = writeClaimBlob({ ghApi }, 'acme/w', 7, { content: '{"a":1}', sha: null, createOnly: true, message: 'm' });
  assert.deepEqual(w, { ok: false, conflict: true, failure: null });
});

test('writeClaimBlob: create-only PUT rejected + absent re-read + branches read fails (cannot tell) → network-failure, never conflict', () => {
  const ghApi = (args) => {
    if (args[0] === '--method') return { stdout: null, failure: null, status: 404 };
    if (sameArgs(args, BRANCHES_ARGS)) return { stdout: null, failure: 'network-failure', status: null };
    return { stdout: null, failure: null, status: 404 }; // contents re-read: absent
  };
  const w = writeClaimBlob({ ghApi }, 'acme/w', 7, { content: '{"a":1}', sha: null, createOnly: true, message: 'm' });
  assert.deepEqual(w, { ok: false, failure: 'network-failure' });
});

test('writeClaimBlob: a rejected PUT whose re-read shows ANOTHER holder\'s blob never consults the branches endpoint', () => {
  const calls = [];
  const ghApi = (args) => {
    calls.push(args);
    if (args[0] === '--method') return { stdout: null, failure: null, status: 422 };
    if (isRead(args, 'claims/issue-7.json')) return { stdout: JSON.stringify({ content: '{"other":1}', sha: 's1' }), failure: null, status: null };
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  const w = writeClaimBlob({ ghApi }, 'acme/w', 7, { content: '{"a":1}', sha: null, createOnly: true, message: 'm' });
  assert.deepEqual(w, { ok: false, conflict: true, failure: null });
  assert.equal(calls.some((a) => sameArgs(a, BRANCHES_ARGS)), false);
});

test('defaultGhApi: a failed call carries the thrown error text as `error` (gh absent from PATH → ENOENT, no real gh runs)', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-store-nogh-'));
  const savedPath = process.env.PATH;
  process.env.PATH = emptyDir;
  let r;
  try {
    r = defaultGhApi(['repos/acme/w']);
  } finally {
    process.env.PATH = savedPath;
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
  assert.equal(r.stdout, null);
  assert.equal(r.failure, 'gh-absent');
  assert.equal(r.status, null);
  assert.equal(typeof r.error, 'string');
  assert.match(r.error, /ENOENT/);
});

test('claimsBranchExists: 404 → false, any failure → null, a name → true', () => {
  assert.equal(claimsBranchExists(() => ({ stdout: null, failure: null, status: 404 }), 'acme/w'), false);
  assert.equal(claimsBranchExists(() => ({ stdout: null, failure: 'network-failure', status: null }), 'acme/w'), null);
  assert.equal(claimsBranchExists(() => ({ stdout: null, failure: 'gh-absent', status: null }), 'acme/w'), null);
  assert.equal(claimsBranchExists((args) => { assert.deepEqual(args, BRANCHES_ARGS); return { stdout: 'claims-registry\n', failure: null, status: null }; }, 'acme/w'), true);
});

test('ensureClaimsBranch: git leg succeeds → ok via git, no gh call', () => {
  const ghCalls = [];
  const gitRunner = (args) => (args[0] === 'rev-parse' ? 'abc\n' : '');
  const r = ensureClaimsBranch({ ghApi: (a) => { ghCalls.push(a); return { stdout: null, failure: null, status: null }; }, gitRunner }, 'acme/w');
  assert.deepEqual(r, { ok: true, created: true, via: 'git' });
  assert.equal(ghCalls.length, 0);
});

test('ensureClaimsBranch: git leg fails → contents-API leg reads default_branch, its tip sha, POSTs git/refs → ok via contents-api', () => {
  const calls = [];
  const gitRunner = (args) => { if (args[0] === 'push') throw gitError('remote: Permission to acme/w.git denied'); return args[0] === 'rev-parse' ? 'abc\n' : ''; };
  const ghApi = bootstrapGhApi(calls, { post: { stdout: '{}', failure: null, status: null } });
  const r = ensureClaimsBranch({ ghApi, gitRunner }, 'acme/w');
  assert.deepEqual(r, { ok: true, created: true, via: 'contents-api' });
  assert.deepEqual(calls, [DEFAULT_BRANCH_ARGS, MAIN_TIP_ARGS, POST_REFS_ARGS]);
});

test('ensureClaimsBranch: no gitRunner → straight to the contents-API leg', () => {
  const calls = [];
  const ghApi = bootstrapGhApi(calls, { post: { stdout: '{}', failure: null, status: null } });
  assert.deepEqual(ensureClaimsBranch({ ghApi }, 'acme/w'), { ok: true, created: true, via: 'contents-api' });
  assert.equal(calls.length, 3);
});

test('ensureClaimsBranch: POST git/refs 422 whose branches/claims-registry read now succeeds is a lost race → ok, created:false', () => {
  const ghApi = bootstrapGhApi([], {
    post: { stdout: null, failure: null, status: 422, error: 'HTTP 422: Reference already exists' },
    branches: { stdout: 'claims-registry\n', failure: null, status: null },
  });
  assert.deepEqual(ensureClaimsBranch({ ghApi }, 'acme/w'), { ok: true, created: false, via: 'contents-api' });
});

test('ensureClaimsBranch: POST git/refs 422 from a ruleset while the branch is still absent is a refusal, reason verbatim', () => {
  const ghApi = bootstrapGhApi([], {
    post: { stdout: null, failure: null, status: 422, error: 'HTTP 422: Repository rule violations found\n\nCannot create ref due to creations being restricted.' },
    branches: { stdout: null, failure: null, status: 404 },
  });
  const r = ensureClaimsBranch({ ghApi }, 'acme/w');
  assert.equal(r.ok, false);
  assert.match(r.reason, /Repository rule violations found/);
  assert.match(r.reason, /Cannot create ref/);
});

test('ensureClaimsBranch: POST git/refs 422 with an unreadable branches endpoint is a refusal, never a guessed lost race', () => {
  const ghApi = bootstrapGhApi([], {
    post: { stdout: null, failure: null, status: 422, error: 'HTTP 422: Reference already exists' },
    branches: { stdout: null, failure: 'network-failure', status: null },
  });
  const r = ensureClaimsBranch({ ghApi }, 'acme/w');
  assert.equal(r.ok, false);
  assert.match(r.reason, /Reference already exists/);
});

test('ensureClaimsBranch: POST git/refs 404 (no access) is a refusal, never success', () => {
  const ghApi = bootstrapGhApi([], {
    post: { stdout: null, failure: null, status: 404, error: 'gh: Not Found (HTTP 404)' },
    branches: { stdout: 'claims-registry\n', failure: null, status: null },
  });
  const r = ensureClaimsBranch({ ghApi }, 'acme/w');
  assert.equal(r.ok, false);
  assert.match(r.reason, /HTTP 404/);
});

test('ensureClaimsBranch: a POST result with no error text falls back to the failure, then the status', () => {
  const noText = (post) => ensureClaimsBranch({ ghApi: bootstrapGhApi([], { post, branches: { stdout: null, failure: null, status: 404 } }) }, 'acme/w');
  assert.match(noText({ stdout: null, failure: 'secondary-rate-limit', status: 403 }).reason, /secondary-rate-limit/);
  assert.match(noText({ stdout: null, failure: null, status: 409 }).reason, /HTTP 409/);
});

test('ensureClaimsBranch: an unresolvable default branch is a refusal, no POST', () => {
  const calls = [];
  const ghApi = (args) => { calls.push(args); return { stdout: null, failure: 'network-failure', status: null, error: 'HTTP 502: Bad Gateway' }; };
  const r = ensureClaimsBranch({ ghApi }, 'acme/w');
  assert.equal(r.ok, false);
  assert.match(r.reason, /HTTP 502/);
  assert.equal(calls.length, 1);
});

test('ensureClaimsBranch: both legs refused → ok:false with both reasons verbatim', () => {
  const gitRunner = (args) => { if (args[0] === 'push') throw gitError('remote: Permission to acme/w.git denied'); return args[0] === 'rev-parse' ? 'abc\n' : ''; };
  const ghApi = bootstrapGhApi([], {
    post: { stdout: null, failure: 'network-failure', status: null, error: 'HTTP 403: Resource not accessible by integration' },
  });
  const r = ensureClaimsBranch({ ghApi, gitRunner }, 'acme/w');
  assert.equal(r.ok, false);
  assert.match(r.reason, /Permission to acme\/w\.git denied/);
  assert.match(r.reason, /HTTP 403: Resource not accessible/);
  assert.match(r.reason, /^git: .*; contents-api: /s);
  assert.equal('transient' in r, false, 'a non-rate-limit refusal carries no transient key');
});

test('ensureClaimsBranch: a secondary-rate-limit POST is transient (reason verbatim); a 403 network-failure POST is not', () => {
  const rateLimited = ensureClaimsBranch({
    ghApi: bootstrapGhApi([], { post: { stdout: null, failure: 'secondary-rate-limit', status: 403, error: 'HTTP 403: secondary rate limit' } }),
  }, 'acme/w');
  assert.deepEqual(rateLimited, { ok: false, reason: 'contents-api: HTTP 403: secondary rate limit', transient: true });
  const refused = ensureClaimsBranch({
    ghApi: bootstrapGhApi([], { post: { stdout: null, failure: 'network-failure', status: 403, error: 'HTTP 403: Forbidden' } }),
  }, 'acme/w');
  assert.deepEqual(refused, { ok: false, reason: 'contents-api: HTTP 403: Forbidden' });
});

// (#4495) A git-CAS rejection whose verification read finds the claims-registry
// branch itself gone. That is not a claim someone else took, so it must surface
// as a missing branch (the caller bootstraps it), never as a contest with no
// holder.
test('writeClaimBlob: a git-CAS rejection whose fresh read finds the claims-registry branch gone is branchMissing, never a contest', () => {
  const { runner, state } = fakeGitCasRunner({ pushes: ['reject'], reads: [] });
  const gitRunner = (args) => {
    if (args[0] === 'fetch' && state.pushCount > 0) { const e = new Error("fatal: couldn't find remote ref claims-registry"); e.stderr = e.message; throw e; }
    return runner(args);
  };
  const ghApi = () => { throw new Error('contents-API must not be called — the git re-read already named the missing branch'); };
  const result = writeClaimBlob({ ghApi, gitRunner }, 'acme/w', 42, {
    content: '{"runId":"me"}', message: 'Claim #42', sha: 'a'.repeat(40), expectedContent: HELD_BY_STALE,
  });
  assert.deepEqual(result, { ok: false, branchMissing: true, failure: null });
  assert.equal(state.pushCount, 1, 'no retry against a branch that no longer exists');
});
