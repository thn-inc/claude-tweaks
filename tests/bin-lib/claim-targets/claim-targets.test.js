// tests/bin-lib/claim-targets/claim-targets.test.js
// Fake ghApi (claim-store contract: never throws, returns {stdout,failure,status})
// and fake gh (generic-runner contract: throws on failure, returns stdout) per
// the gh-api-module-pattern skill — never real `gh`. Record calls inside the
// fakes, assert after `run()` returns.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  run, BOT_IN_PROGRESS, ABORT_REASON, USAGE, FLOW_STEPS, defaultAppendClaimLog,
} = require('../../../plugin/bin/lib/claim-targets/claim-targets');
const { hasClaimLogFor, classifyDecisions } = require('../../../plugin/bin/lib/log-decision/claim-log');
// #787 residual finding (progress.md's parked "expectedContent has zero test
// coverage" item): claim-targets.js requires this same module-level object,
// so spying on it here observes the real call — pins that `run()`'s claim
// write and `releaseClaimedThisRun`'s rollback write both thread
// `expectedContent` from the read that produced the write decision, not a
// value re-derived later. Deleting either `expectedContent: ...` at the call
// site would leave every other test in this file green (none of them supply
// a `gitRunner`, so claim-store.js never consults the field) while silently
// reintroducing the I1/C1 false-contest / lost-update bug in production.
const claimStore = require('../../../plugin/bin/lib/issues/claim-store');
const { composePrEarlyBody, composeExpressBody } = require('../../../plugin/bin/lib/flow/pr-body');

const REPO = 'acme/w';
const NOW = Date.parse('2026-08-17T00:00:00.000Z');

function readPath(issue) {
  return `repos/${REPO}/contents/claims/issue-${issue}.json?ref=claims-registry`;
}
function isRead(args, issue) {
  return args[0] === readPath(issue);
}
function isWrite(args, issue) {
  return args[0] === '--method' && args[1] === 'PUT' && args[2] === `repos/${REPO}/contents/claims/issue-${issue}.json`;
}
function isPrList(args) {
  return args[0] === 'pr' && args[1] === 'list';
}
function fieldOf(args, name) {
  for (let k = 0; k < args.length; k++) {
    if (args[k] === '-f' && String(args[k + 1]).startsWith(`${name}=`)) return args[k + 1].slice(name.length + 1);
  }
  return undefined;
}

function readOk(content, sha) {
  return { stdout: JSON.stringify({ content, sha }), failure: null, status: null };
}
const readAbsent = { stdout: null, failure: null, status: 404 };
const readFail = (failure) => ({ stdout: null, failure, status: null });
const writeOk = { stdout: '{}', failure: null, status: null };
const writeFail = (failure) => ({ stdout: null, failure, status: null });

function liveMarker(runId, claimedAtIso = new Date(NOW).toISOString(), ttlHours = 72) {
  return JSON.stringify({
    runId, sessionId: 's', claimedAt: claimedAtIso, ttlHours, host: 'h',
  });
}
// #4423 — a TTL-expired ('stale') claim blob, 100h old against a 72h ttl.
function staleMarker(runId) {
  return liveMarker(runId, new Date(NOW - 100 * 3600 * 1000).toISOString());
}
function tombstoneMarker(runId) {
  return JSON.stringify({
    released: true, runId, reason: 'x', releasedAt: new Date(NOW).toISOString(),
  });
}
// #315 — a `pr-opened:` tombstone carries a `link` to the PR that build
// produced; `run()` must consult it (via `tombstoneInFlightPr`, now
// exported from claim-store.js — moved there from claim-engine.js, retired
// #787) before treating this like any other reclaimable tombstone.
function prOpenedTombstoneMarker(runId, link) {
  return JSON.stringify({
    released: true, runId, reason: 'pr-opened: spec 272', releasedAt: new Date(NOW).toISOString(), link,
  });
}

// #2073: the post-write verification read `run()` now performs immediately
// after every successful claim write — a fixture's `reads[issue]` queue must
// supply this as the entry AFTER the read that led to the write, or the
// verification (seeing the queue's last entry repeat) sees the pre-write
// content again and the claim reports `unverified` instead of `claimed`.
function confirmRead(runId = 'r1', sha = 'sha-confirm') {
  return readOk(liveMarker(runId), sha);
}

// reads/writes: { [issue]: [response, response, ...] } — consumed in call
// order, last entry repeats once exhausted. Throws on any unhandled argv
// shape so a wrong endpoint fails loudly rather than silently.
function makeGhApi({ reads = {}, writes = {} } = {}) {
  const calls = [];
  const readIdx = {};
  const writeIdx = {};
  function ghApi(args) {
    calls.push(args);
    for (const issue of Object.keys(reads)) {
      if (isRead(args, issue)) {
        const q = reads[issue];
        const i = readIdx[issue] || 0;
        readIdx[issue] = i + 1;
        return q[Math.min(i, q.length - 1)];
      }
    }
    for (const issue of Object.keys(writes)) {
      if (isWrite(args, issue)) {
        const q = writes[issue];
        const i = writeIdx[issue] || 0;
        writeIdx[issue] = i + 1;
        return q[Math.min(i, q.length - 1)];
      }
    }
    throw new Error(`unexpected ghApi ${args.join(' ')}`);
  }
  return { ghApi, calls };
}

// gh: throwing-style generic runner. `fail` names which call classes throw.
function makeGh({
  repoSlug = REPO, labelExists = false, fail = {}, prState = null, openPrs = null,
} = {}) {
  const calls = [];
  function gh(args) {
    calls.push(args);
    if (args[0] === 'repo' && args[1] === 'view') {
      if (fail.repoView) throw new Error('repo view failed');
      return `${repoSlug}\n`;
    }
    if (args[0] === 'label' && args[1] === 'list') return labelExists ? `${BOT_IN_PROGRESS}\n` : '';
    if (args[0] === 'label' && args[1] === 'create') return '';
    if (args[0] === 'issue' && args[1] === 'edit' && args.includes('--add-label')) {
      if (fail.labelAdd) throw new Error('label add failed');
      return '';
    }
    if (args[0] === 'issue' && args[1] === 'edit' && args.includes('--remove-label')) return '';
    if (args[0] === 'issue' && args[1] === 'comment') {
      if (fail.comment) throw new Error('comment failed');
      return '';
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      if (fail.prView) throw new Error('pr view failed');
      return `${prState}\n`;
    }
    if (args[0] === 'pr' && args[1] === 'list') {
      if (fail.prList) throw new Error('pr list failed');
      return JSON.stringify(openPrs || []);
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  }
  return { gh, calls };
}

function makeStdio() {
  const out = []; const err = [];
  return { stdout: (s) => out.push(s), stderr: (s) => err.push(s), out, err };
}

function baseDeps({ ghApi, gh, hostname = 'host1', sessionId = 'sess1' }) {
  const io = makeStdio();
  return {
    deps: {
      // #2329: a no-op default so the post-write-verification retry (which
      // waits between attempts via `deps.sleep || claimStore.defaultSleep`)
      // never falls through to a real, blocking `Atomics.wait` in a test that
      // doesn't care about backoff timing — the same convention
      // claim-store.test.js already uses for every git-CAS retry test.
      // Overridable per test (e.g. to record/assert calls) by reassigning
      // `deps.sleep` after destructuring this return value.
      ghApi, gh, now: () => NOW, stdout: io.stdout, stderr: io.stderr, hostname, sessionId, sleep: () => {},
    },
    io,
  };
}

// (a) two absent targets -> both claimed, create-only PUTs (no sha), label+comment calls made
test('(a) two absent targets: both claimed, create-only writes, label + comment made, exit 0', () => {
  const { ghApi, calls: apiCalls } = makeGhApi({
    reads: { 720: [readAbsent, confirmRead()], 721: [readAbsent, confirmRead()] },
    writes: { 720: [writeOk], 721: [writeOk] },
  });
  const { gh, calls: ghCalls } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720,721'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body, {
    claimed: [720, 721],
    alreadyOwned: [],
    skipped: [],
    labelFailures: [],
    transportByIssue: { 720: 'contents-api', 721: 'contents-api' },
  });
  const w720 = apiCalls.find((a) => isWrite(a, '720'));
  const w721 = apiCalls.find((a) => isWrite(a, '721'));
  assert.equal(fieldOf(w720, 'sha'), undefined, 'create-only write must omit sha');
  assert.equal(fieldOf(w721, 'sha'), undefined, 'create-only write must omit sha');
  assert.ok(ghCalls.some((a) => a[0] === 'issue' && a[1] === 'edit' && a[2] === '720' && a.includes('--add-label')));
  assert.ok(ghCalls.some((a) => a[0] === 'issue' && a[1] === 'edit' && a[2] === '721' && a.includes('--add-label')));
  assert.ok(ghCalls.some((a) => a[0] === 'issue' && a[1] === 'comment' && a[2] === '720'));
  assert.ok(ghCalls.some((a) => a[0] === 'issue' && a[1] === 'comment' && a[2] === '721'));
  assert.ok(ghCalls.some((a) => a[0] === 'label' && a[1] === 'create'), 'label did not exist -> bootstrap create call made');
});

// (a5) #1486: a successful contents-API claim is permanently tagged as such
// on the JSON envelope — no extra read, derived from write.commitSha's
// absence on this transport.
test('(a5) successful contents-API claims report transportByIssue: contents-api', () => {
  const { ghApi } = makeGhApi({
    reads: { 720: [readAbsent, confirmRead()] },
    writes: { 720: [writeOk] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.transportByIssue, { 720: 'contents-api' });
});

// (a2) the same absent target, but with a `gitRunner` dep (the real CLI's
// shape — bin/claim-targets.js always supplies one): the create-only claim,
// the fleet's most-contended write, must take the git-CAS path and never
// touch the rate-limited contents-API PUT (#787's amendment — a
// `classified.state !== 'absent'` sha gate previously kept every create-only
// claim off git-CAS entirely).
test('(a2) absent target with a gitRunner: create-only claim goes through git-CAS, contents-API PUT never called', () => {
  const TIP = 'a'.repeat(40);
  const gitCalls = [];
  const gitRunner = (args) => {
    gitCalls.push(args);
    if (args[0] === 'fetch') return '';
    // readClaimBlobGit fetches into a per-call scratch ref rather than
    // FETCH_HEAD (#787 hindsight finding — see claims-git-cas.test.js) —
    // match by shape, not the literal old 'FETCH_HEAD' name.
    if (args[0] === 'rev-parse' && args[1] !== 'FETCH_HEAD') return `${TIP}\n`;
    if (args[0] === 'update-ref' && args[1] === '-d') return '';
    // Post-write verification (#2073) reads back the just-pushed commit
    // ('newcommit') — return the live confirming blob there; the original
    // pre-write read (against TIP) is still genuinely absent.
    if (args[0] === 'show' && args[1] === 'newcommit:claims/issue-720.json') return liveMarker('r1');
    if (args[0] === 'show') throw new Error(`fatal: path 'claims/issue-720.json' does not exist in '${TIP}'`);
    if (args[0] === 'hash-object') return 'deadbeef\n';
    if (args[0] === 'read-tree') return '';
    if (args[0] === 'update-index') return '';
    if (args[0] === 'write-tree') return 'newtree\n';
    if (args[0] === 'commit-tree') return 'newcommit\n';
    if (args[0] === 'push') return '';
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  const ghApi = (args) => { throw new Error(`contents-API must not be called when git-CAS works: ${args.join(' ')}`); };
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  deps.gitRunner = gitRunner;

  const code = run(['--run-id', 'r1', '--targets', '720'], deps);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(io.out[0]).claimed, [720]);
  const push = gitCalls.find((a) => a[0] === 'push');
  assert.ok(push, 'a create-only claim must reach the git-CAS push');
  assert.ok(push.some((a) => String(a).startsWith(`--force-with-lease=refs/heads/claims-registry:${TIP}`)), 'the push must lease against the tip this run read');
});

// (a2b) #1486: the git-CAS counterpart to (a5) — a successful git-CAS claim
// is tagged 'git', derived from write.commitSha being a real string on this
// transport (never present on a contents-API success).
test('(a2b) successful git-CAS claims report transportByIssue: git', () => {
  const TIP = 'a'.repeat(40);
  const gitRunner = (args) => {
    if (args[0] === 'fetch') return '';
    if (args[0] === 'rev-parse' && args[1] !== 'FETCH_HEAD') return `${TIP}\n`;
    if (args[0] === 'update-ref' && args[1] === '-d') return '';
    // Post-write verification (#2073) reads back the just-pushed commit
    // ('newcommit') — return the live confirming blob there; the original
    // pre-write read (against TIP) is still genuinely absent.
    if (args[0] === 'show' && args[1] === 'newcommit:claims/issue-720.json') return liveMarker('r1');
    if (args[0] === 'show') throw new Error(`fatal: path 'claims/issue-720.json' does not exist in '${TIP}'`);
    if (args[0] === 'hash-object') return 'deadbeef\n';
    if (args[0] === 'read-tree') return '';
    if (args[0] === 'update-index') return '';
    if (args[0] === 'write-tree') return 'newtree\n';
    if (args[0] === 'commit-tree') return 'newcommit\n';
    if (args[0] === 'push') return '';
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  const ghApi = (args) => { throw new Error(`contents-API must not be called when git-CAS works: ${args.join(' ')}`); };
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  deps.gitRunner = gitRunner;

  const code = run(['--run-id', 'r1', '--targets', '720'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.transportByIssue, { 720: 'git' });
});

// #1467: a fake git-CAS runner that tracks each call class separately (not
// just a flat log) so a batch test can assert fetch/rev-parse counts
// directly, and so `show`'s sha argument can be inspected to prove the
// SECOND issue's read actually chained off the FIRST issue's write — not
// just that fetch was skipped for some unrelated reason. `commit-tree`
// returns a distinct, incrementing sha per call so that chain is observable.
function makeBatchGitRunner() {
  const fetchCalls = [];
  const revParseCalls = [];
  const showCalls = [];
  const readTreeCalls = [];
  const pushCalls = [];
  let commitCounter = 0;
  // #2073: which issue number each synthetic commit sha actually claimed —
  // derived from the write's own `-m "Claim issue #<n>"` commit-tree message,
  // never hardcoded — so `show`'s post-write verification read can return
  // that issue's own live content while every OTHER issue's read against the
  // same chained commit (its own pre-write absence check) still sees absent.
  const commitOwner = {};
  const runner = (args) => {
    if (args[0] === 'fetch') { fetchCalls.push(args); return ''; }
    if (args[0] === 'rev-parse' && args[1] !== 'FETCH_HEAD') { revParseCalls.push(args); return 'tip0\n'; }
    if (args[0] === 'update-ref' && args[1] === '-d') return '';
    if (args[0] === 'show') {
      showCalls.push(args);
      const [sha, ...pathParts] = String(args[1]).split(':');
      const targetPath = pathParts.join(':');
      const pathMatch = /issue-(\d+)\.json$/.exec(targetPath);
      const issueNum = pathMatch ? Number(pathMatch[1]) : null;
      if (issueNum !== null && commitOwner[sha] === issueNum) return liveMarker('r1');
      throw new Error(`fatal: path '${targetPath}' does not exist in '${sha}'`);
    }
    if (args[0] === 'hash-object') return 'blobsha\n';
    if (args[0] === 'read-tree') { readTreeCalls.push(args); return ''; }
    if (args[0] === 'update-index') return '';
    if (args[0] === 'write-tree') return 'treesha\n';
    if (args[0] === 'commit-tree') {
      commitCounter += 1;
      const commitSha = `commit-${commitCounter}`;
      const msgIdx = args.indexOf('-m');
      const message = msgIdx >= 0 ? args[msgIdx + 1] : '';
      const claimMatch = /Claim issue #(\d+)/.exec(message);
      if (claimMatch) commitOwner[commitSha] = Number(claimMatch[1]);
      return `${commitSha}\n`;
    }
    if (args[0] === 'push') { pushCalls.push(args); return ''; }
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
  return {
    runner, fetchCalls, revParseCalls, showCalls, readTreeCalls, pushCalls,
  };
}

// (a3) #1467's headline AC: a batch of N absent, uncontended targets performs
// a bounded, sub-N number of `git fetch` calls — one for the whole batch,
// not one per issue — because each issue after the first chains its read off
// the PREVIOUS issue's own write, which is the only tip mutation this run
// itself can cause.
test('(a3) #1467: a two-issue no-contention batch performs exactly ONE git fetch, not two — the second read chains off the first write', () => {
  const batch = makeBatchGitRunner();
  const ghApi = (args) => { throw new Error(`contents-API must not be called when git-CAS works: ${args.join(' ')}`); };
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  deps.gitRunner = batch.runner;

  const code = run(['--run-id', 'r1', '--targets', '720,721'], deps);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(io.out[0]).claimed, [720, 721]);
  assert.equal(batch.fetchCalls.length, 1, 'only the FIRST issue fetches — the second must chain off the first write instead of re-fetching');
  assert.equal(batch.revParseCalls.length, 1, 'the scratch-ref rev-parse is paired 1:1 with the fetch it skipped for issue 2');
  // 4, not 2: each issue's own pre-write absence check PLUS its own
  // post-write verification read (#2073) — still zero extra fetches, since
  // every one of these reads chains off a `knownTip` already in hand.
  assert.equal(batch.showCalls.length, 4, 'each issue gets its own absence check AND its own post-write verification read, still without a fetch');
  // showCalls[0] = 720's own pre-write absence check (against the fetched tip).
  const thirdShaQueried = String(batch.showCalls[2][1]).split(':')[0];
  assert.equal(thirdShaQueried, 'commit-1', "issue 721's pre-write read must query the commit issue 720's write just produced, not the original fetched tip");
  assert.ok(batch.showCalls[1][1].startsWith('commit-1:claims/issue-720.json'), "720's own post-write verification must read back the commit its own write just produced");
  assert.ok(batch.showCalls[3][1].startsWith('commit-2:claims/issue-721.json'), "721's own post-write verification must read back the commit its own write just produced");
  const secondReadTreeSha = batch.readTreeCalls[1][1];
  assert.equal(secondReadTreeSha, 'commit-1', "issue 721's write must lease against the chained tip, matching what its own read just used");
});

// (a4) Mixed-outcome correctness (#1467's third AC): issue A's write is
// rejected and verified as a genuine contest, which must discard the tip
// chain — issue B's subsequent read must NOT trust A's now-stale believed
// tip and must fetch fresh instead of trusting a tip that was never actually
// confirmed current. `--keep-going` is required to observe this: a default
// (non-keep-going) run aborts the whole batch on A's contest and never
// reaches B at all.
test('(a4) #1467: issue A rejected mid-batch discards the tip chain — issue B fetches fresh rather than trusting a stale tip', () => {
  const HELD_BY_RIVAL = JSON.stringify({ runId: 'rival' });
  const fetchCalls = [];
  const pushCalls = [];
  let fetchCount = 0;
  // One tip per fetch: A's own read (absent), A's post-rejection write
  // verification (rival landed — a genuine contest), claim-targets.js's own
  // best-effort `holderFromFreshRead` re-read for the contested report
  // (also a fresh fetch — it never threads a knownTip either), then B's read.
  const tips = ['tip0', 'tip1', 'tip2', 'tip3'];
  const runner = (args) => {
    if (args[0] === 'fetch') { fetchCalls.push(args); fetchCount += 1; return ''; }
    if (args[0] === 'rev-parse' && args[1] !== 'FETCH_HEAD') return `${tips[fetchCount - 1]}\n`;
    if (args[0] === 'update-ref' && args[1] === '-d') return '';
    if (args[0] === 'show') {
      const [sha, ...pathParts] = String(args[1]).split(':');
      const targetPath = pathParts.join(':');
      if (sha === 'tip0' && targetPath === 'claims/issue-720.json') {
        throw new Error(`fatal: path '${targetPath}' does not exist in '${sha}'`); // absent — reclaimable
      }
      if ((sha === 'tip1' || sha === 'tip2') && targetPath === 'claims/issue-720.json') {
        return HELD_BY_RIVAL; // a rival genuinely landed — both post-rejection reads see it
      }
      if (sha === 'tip3' && targetPath === 'claims/issue-721.json') {
        throw new Error(`fatal: path '${targetPath}' does not exist in '${sha}'`); // B, on its OWN fresh tip, is genuinely absent
      }
      if (sha === 'commit-x' && targetPath === 'claims/issue-721.json') {
        return liveMarker('r1'); // #2073: B's own post-write verification, chained off its own write's commit
      }
      throw new Error(`unexpected show ${sha}:${targetPath} — issue B must never be read against A's stale/rejected tip`);
    }
    if (args[0] === 'hash-object') return 'blobsha\n';
    if (args[0] === 'read-tree' || args[0] === 'update-index') return '';
    if (args[0] === 'write-tree') return 'treesha\n';
    if (args[0] === 'commit-tree') return 'commit-x\n';
    if (args[0] === 'push') {
      pushCalls.push(args);
      if (pushCalls.length === 1) { // A's push: rejected
        const e = new Error('! [rejected] claims-registry -> claims-registry (stale info)');
        e.stderr = e.message;
        throw e;
      }
      return ''; // B's push: succeeds cleanly
    }
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
  const ghApi = (args) => { throw new Error(`contents-API must not be called: ${args.join(' ')}`); };
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  deps.gitRunner = runner;
  deps.sleep = () => {};

  const code = run(['--run-id', 'r1', '--targets', '720,721', '--keep-going'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, [721]);
  assert.deepEqual(body.skipped, [{ issue: 720, reason: 'contested', holder: { runId: 'rival' } }]);
  // The load-bearing assertion: A's rejection triggers its own fresh fetches
  // (write-rejection verification + the contested report's holder re-read —
  // 3 fetches for A alone), and B — despite following immediately after in
  // the batch — gets its OWN fresh fetch rather than reusing anything from
  // A's now-discarded, proven-wrong tip belief.
  assert.equal(fetchCalls.length, 4, "B must fetch fresh after A's contest discarded the chain — reusing A's tip would be trusting a proven-stale belief");
});

// (b) tombstone target -> conditional PUT with sha
test('(b) tombstone target: conditional write carries the blob sha', () => {
  const { ghApi, calls } = makeGhApi({
    reads: { 722: [readOk(tombstoneMarker('otherRun'), 'sha722'), confirmRead()] },
    writes: { 722: [writeOk] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '722'], deps);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(io.out[0]).claimed, [722]);
  const w = calls.find((a) => isWrite(a, '722'));
  assert.equal(fieldOf(w, 'sha'), 'sha722');
});

// ---- #315: pr-opened tombstone in-flight check -----------------------------
// A `pr-opened:` tombstone whose linked PR is still OPEN means a build for
// this issue already completed and is awaiting merge — `run()` must not
// reclaim/re-write over it. Uses claim-store.js's `tombstoneInFlightPr`
// (moved there from claim-engine.js's `claimOne`, retired #787) — this
// loop has its own inline classify-then-write sequence.

test('(k) pr-opened tombstone, linked PR OPEN, default mode: no reclaim write, exit 3, inFlight envelope', () => {
  const { ghApi, calls } = makeGhApi({
    reads: { 760: [readOk(prOpenedTombstoneMarker('otherRun', 'https://github.com/acme/w/pull/304'), 'sha760')] },
    writes: {},
  });
  const { gh, calls: ghCalls } = makeGh({ prState: 'OPEN' });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '760'], deps);

  assert.equal(code, 3);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.inFlight, [{ issue: 760, link: 'https://github.com/acme/w/pull/304' }]);
  assert.deepEqual(body.released, []);
  assert.ok(!calls.some((a) => isWrite(a, '760')), 'must not write a fresh claim while the linked PR is open');
  assert.ok(ghCalls.some((a) => a[0] === 'pr' && a[1] === 'view' && a[2] === 'https://github.com/acme/w/pull/304'));
});

test('(k2) pr-opened tombstone, linked PR OPEN, --keep-going: skipped with in-flight reason, no write, exit 0', () => {
  const { ghApi, calls } = makeGhApi({
    reads: { 761: [readOk(prOpenedTombstoneMarker('otherRun', 'https://github.com/acme/w/pull/305'), 'sha761')] },
    writes: {},
  });
  const { gh } = makeGh({ prState: 'OPEN' });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '761', '--keep-going'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, []);
  assert.equal(body.skipped.length, 1);
  assert.deepEqual(body.skipped[0], { issue: 761, reason: 'in-flight', link: 'https://github.com/acme/w/pull/305' });
  assert.ok(!calls.some((a) => isWrite(a, '761')), 'must not write a fresh claim while the linked PR is open');
});

test('(k3) pr-opened tombstone, linked PR CLOSED/MERGED: falls through to normal reclaim, exit 0', () => {
  const { ghApi, calls } = makeGhApi({
    reads: { 762: [readOk(prOpenedTombstoneMarker('otherRun', 'https://github.com/acme/w/pull/306'), 'sha762'), confirmRead()] },
    writes: { 762: [writeOk] },
  });
  const { gh } = makeGh({ prState: 'MERGED' });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '762'], deps);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(io.out[0]).claimed, [762]);
  const w = calls.find((a) => isWrite(a, '762'));
  assert.equal(fieldOf(w, 'sha'), 'sha762', 'closed/merged PR must fall through to the ordinary conditional reclaim write');
});

test('(k4) pr-opened tombstone whose gh pr view call itself fails: fails open, reclaims as before', () => {
  const { ghApi } = makeGhApi({
    reads: { 763: [readOk(prOpenedTombstoneMarker('otherRun', 'https://github.com/acme/w/pull/307'), 'sha763'), confirmRead()] },
    writes: { 763: [writeOk] },
  });
  const { gh } = makeGh({ fail: { prView: true } });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '763'], deps);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(io.out[0]).claimed, [763], 'a gh failure on the in-flight check must never wedge the claim path');
});

test('(k5) pr-opened tombstone whose link points at a DIFFERENT repo: falls through to normal reclaim, exit 0', () => {
  const { ghApi, calls } = makeGhApi({
    reads: { 764: [readOk(prOpenedTombstoneMarker('otherRun', 'https://github.com/other-owner/other-repo/pull/308'), 'sha764'), confirmRead()] },
    writes: { 764: [writeOk] },
  });
  const { gh, calls: ghCalls } = makeGh({ prState: 'OPEN' });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '764'], deps);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(io.out[0]).claimed, [764]);
  const w = calls.find((a) => isWrite(a, '764'));
  assert.equal(fieldOf(w, 'sha'), 'sha764', 'a wrong-repo link must fall through to the ordinary conditional reclaim write');
  assert.ok(!ghCalls.some((a) => a[0] === 'pr' && a[1] === 'view'), 'a wrong-repo link must never trigger the PR-state check');
});

// #977: two targets released together from one multi-spec build tombstone
// with the identical `link` — `tombstoneInFlightPr`'s `gh pr view` call must
// be memoized per `$LINK` within this one `run()` invocation, so the second
// target's check is answered from cache instead of a second real call.
test('(k6) two targets sharing the identical in-flight link: only one `gh pr view` call for both', () => {
  const link = 'https://github.com/acme/w/pull/309';
  const { ghApi } = makeGhApi({
    reads: {
      765: [readOk(prOpenedTombstoneMarker('otherRun', link), 'sha765')],
      766: [readOk(prOpenedTombstoneMarker('otherRun', link), 'sha766')],
    },
    writes: {},
  });
  const { gh, calls: ghCalls } = makeGh({ prState: 'OPEN' });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '765,766', '--keep-going'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.skipped, [
    { issue: 765, reason: 'in-flight', link },
    { issue: 766, reason: 'in-flight', link },
  ]);
  const prViewCalls = ghCalls.filter((a) => a[0] === 'pr' && a[1] === 'view');
  assert.equal(prViewCalls.length, 1, 'the second target must reuse the first target\'s cached gh pr view result');
});

// #4423: a TTL-expired ('stale') claim whose run's draft PR is still open is
// in flight, not abandoned — `staleClaimInFlightPr` (claim-store.js) looks for
// the run's `claude-tweaks-run: {runId}` marker on an open same-repo PR, and
// `run()` stops/skips through the same `inFlight` path a `pr-opened:`
// tombstone uses.
const RUN = '2026-10-22T001546-record-3315';
const PR_URL = 'https://github.com/acme/w/pull/3927';
const markedPr = { url: PR_URL, body: `## Spec\n<!-- claude-tweaks-run: ${RUN} -->\n`, isCrossRepository: false };

test('(stale-pr) stale claim whose run has an open marked PR, default mode: exit 3, inFlight envelope, no write', () => {
  const { ghApi, calls } = makeGhApi({
    reads: { 770: [readOk(staleMarker(RUN), 'sha770')] },
    writes: {},
  });
  const { gh } = makeGh({ openPrs: [markedPr] });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '770'], deps);

  assert.equal(code, 3);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.inFlight, [{ issue: 770, link: PR_URL }]);
  assert.ok(!calls.some((a) => isWrite(a, '770')), 'must not re-claim a stale claim whose run has an open PR');
});

test('(stale-pr-2) same fixture with --keep-going: skipped in-flight with the PR link, no write, exit 0', () => {
  const { ghApi, calls } = makeGhApi({
    reads: { 771: [readOk(staleMarker(RUN), 'sha771')] },
    writes: {},
  });
  const { gh } = makeGh({ openPrs: [markedPr] });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '771', '--keep-going'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.skipped[0], { issue: 771, reason: 'in-flight', link: PR_URL });
  assert.ok(!calls.some((a) => isWrite(a, '771')), 'must not re-claim a stale claim whose run has an open PR');
});

test('(stale-pr-3) open PR carries a different run id, or only an inline mention of this one: reclaims', () => {
  const { ghApi, calls } = makeGhApi({
    reads: { 772: [readOk(staleMarker(RUN), 'sha772'), confirmRead()] },
    writes: { 772: [writeOk] },
  });
  const { gh } = makeGh({
    openPrs: [
      { url: 'https://github.com/acme/w/pull/3928', body: '<!-- claude-tweaks-run: 2026-10-22T999999-other -->\n', isCrossRepository: false },
      { url: 'https://github.com/acme/w/pull/3929', body: `see claude-tweaks-run: ${RUN} in #12\n`, isCrossRepository: false },
    ],
  });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '772'], deps);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(io.out[0]).claimed, [772]);
  // A listing the normalizer rejected would also reclaim, through the fail-open catch, with a stderr line:
  // no such line means the matcher itself ran and found no marker line.
  assert.ok(!io.err.some((s) => s.includes('#772')), 'the listing is well formed, so the check did not fail open');
  const w = calls.find((a) => isWrite(a, '772'));
  assert.equal(fieldOf(w, 'sha'), 'sha772', 'an unmatched marker must fall through to the ordinary conditional reclaim write');
});

test('(stale-pr-4) the gh pr list call itself fails: fails open, reclaims AND writes one stderr line naming the issue and error', () => {
  const { ghApi } = makeGhApi({
    reads: { 773: [readOk(staleMarker(RUN), 'sha773'), confirmRead()] },
    writes: { 773: [writeOk] },
  });
  const { gh } = makeGh({ fail: { prList: true }, openPrs: [markedPr] });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '773'], deps);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(io.out[0]).claimed, [773], 'a gh failure on the stale in-flight check must never wedge the claim path');
  const lines = io.err.filter((s) => s.includes('#773'));
  assert.equal(lines.length, 1, 'exactly one stderr line names the issue');
  assert.match(lines[0], /^claim-targets: stale-claim open-PR check failed for #773 \(reclaiming\) — pr list failed\n$/);
});

test('(stale-pr-4c) two stale targets and a failing gh pr list: one call, both reclaim, one stderr line each', () => {
  const { ghApi } = makeGhApi({
    reads: {
      777: [readOk(staleMarker(RUN), 'sha777'), confirmRead()],
      778: [readOk(staleMarker(RUN), 'sha778'), confirmRead()],
    },
    writes: { 777: [writeOk], 778: [writeOk] },
  });
  const { gh, calls: ghCalls } = makeGh({ fail: { prList: true } });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '777,778'], deps);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(io.out[0]).claimed, [777, 778]);
  const prListCalls = ghCalls.filter(isPrList);
  assert.equal(prListCalls.length, 1, 'a failed gh pr list is cached too, so a hanging gh costs one timeout per run');
  assert.equal(io.err.filter((s) => s.includes('#777')).length, 1);
  assert.equal(io.err.filter((s) => s.includes('#778')).length, 1);
});

test('staleClaimInFlightPr: onError receives the error of a thrown gh, an unparseable listing, and a non-array result', () => {
  const errors = [];
  const onError = (e) => errors.push(e);
  assert.equal(claimStore.staleClaimInFlightPr(staleMarker(RUN), () => { throw new Error('boom'); }, 'acme', 'w', onError), null);
  assert.equal(claimStore.staleClaimInFlightPr(staleMarker(RUN), () => 'not json', 'acme', 'w', onError), null);
  assert.equal(claimStore.staleClaimInFlightPr(staleMarker(RUN), () => JSON.stringify({}), 'acme', 'w', onError), null);
  // A JSON string is iterable: without an array check it walks characters and returns a clean null.
  assert.equal(claimStore.staleClaimInFlightPr(staleMarker(RUN), () => JSON.stringify('[]'), 'acme', 'w', onError), null);
  assert.equal(errors.length, 4, 'each failure mode reaches onError');
  assert.equal(errors[0].message, 'boom');
  assert.equal(errors[3].message, 'open-PR listing is not an array');
  // A clean no-match, and a non-run-id-shaped runId, are not failures.
  assert.equal(claimStore.staleClaimInFlightPr(staleMarker(RUN), () => '[]', 'acme', 'w', onError), null);
  assert.equal(claimStore.staleClaimInFlightPr(staleMarker('otherRun'), () => '[]', 'acme', 'w', onError), null);
  assert.equal(errors.length, 4, 'a no-match is not reported as a failure');
});

test('staleClaimInFlightPr: a no-match listing at the 1000-entry limit reaches onError; a match inside it still returns', () => {
  const filler = Array.from({ length: 1000 }, (_, i) => (
    { url: `https://github.com/acme/w/pull/${i + 1}`, body: 'unrelated', isCrossRepository: false }));
  const errors = [];
  const onError = (e) => errors.push(e);
  assert.equal(claimStore.staleClaimInFlightPr(staleMarker(RUN), () => JSON.stringify(filler), 'acme', 'w', onError), null);
  assert.equal(errors.length, 1, 'a capped listing may have cut the marked PR off — not a clean no-match');
  assert.match(errors[0].message, /1000-entry limit/);
  const withMatch = [...filler.slice(0, 999), markedPr];
  assert.deepEqual(claimStore.staleClaimInFlightPr(staleMarker(RUN), () => JSON.stringify(withMatch), 'acme', 'w', onError), { link: PR_URL });
  assert.equal(errors.length, 1);
  assert.equal(claimStore.staleClaimInFlightPr(staleMarker(RUN), () => JSON.stringify(filler.slice(0, 999)), 'acme', 'w', onError), null);
  assert.equal(errors.length, 1, 'a no-match listing under the limit is a clean no-match');
});

test('staleClaimInFlightPr: a throwing onError is swallowed — the check still returns null (fail open)', () => {
  const throwingOnError = () => { throw new Error('reporter broke'); };
  assert.equal(
    claimStore.staleClaimInFlightPr(staleMarker(RUN), () => { throw new Error('boom'); }, 'acme', 'w', throwingOnError),
    null,
  );
});

test('(stale-pr-5) stale blob whose runId is not a run-id shape: reclaims and never lists PRs', () => {
  const { ghApi } = makeGhApi({
    reads: { 774: [readOk(staleMarker('otherRun'), 'sha774'), confirmRead()] },
    writes: { 774: [writeOk] },
  });
  const { gh, calls: ghCalls } = makeGh({
    openPrs: [{ url: PR_URL, body: '<!-- claude-tweaks-run: otherRun -->\n', isCrossRepository: false }],
  });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '774'], deps);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(io.out[0]).claimed, [774]);
  assert.ok(!ghCalls.some(isPrList), 'a runId that fails the shape check must never reach gh');
});

test('(stale-pr-6) two stale targets of the same run: both skipped in-flight, only one gh pr list call', () => {
  const { ghApi } = makeGhApi({
    reads: {
      774: [readOk(staleMarker(RUN), 'sha774')],
      775: [readOk(staleMarker(RUN), 'sha775')],
    },
    writes: {},
  });
  const { gh, calls: ghCalls } = makeGh({ openPrs: [markedPr] });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '774,775', '--keep-going'], deps);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(io.out[0]).skipped, [
    { issue: 774, reason: 'in-flight', link: PR_URL },
    { issue: 775, reason: 'in-flight', link: PR_URL },
  ]);
  const prListCalls = ghCalls.filter(isPrList);
  assert.equal(prListCalls.length, 1, 'the second target must reuse the first target\'s cached gh pr list result');
});

test('(stale-pr-7) stale blob owned by THIS run: alreadyOwned, never consults the open-PR check', () => {
  const { ghApi, calls } = makeGhApi({
    reads: { 776: [readOk(staleMarker(RUN), 'sha776')] },
    writes: {},
  });
  const { gh, calls: ghCalls } = makeGh({ openPrs: [markedPr] });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', RUN, '--targets', '776'], deps);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(io.out[0]).alreadyOwned, [776]);
  assert.ok(!ghCalls.some(isPrList), 'a self-owned stale claim is never in flight against itself');
  assert.ok(!calls.some((a) => isWrite(a, '776')));
});

test('staleClaimInFlightPr: an HTML-comment and a plain marker line both match; a cross-repo url or fork PR never returns', () => {
  const prListArgs = ['pr', 'list', '--repo', 'acme/w', '--state', 'open', '--json', 'url,body,isCrossRepository', '--limit', '1000'];
  const seen = [];
  const ghWith = (prs) => (args) => { seen.push(args); return JSON.stringify(prs); };

  assert.deepEqual(
    claimStore.staleClaimInFlightPr(staleMarker(RUN), ghWith([markedPr]), 'acme', 'w'),
    { link: PR_URL },
    'the HTML-comment marker form matches',
  );
  assert.deepEqual(seen[0], prListArgs, 'the gh call is exactly the documented open-PR listing');
  assert.deepEqual(
    claimStore.staleClaimInFlightPr(staleMarker(RUN), ghWith([{ url: PR_URL, body: `intro\n  claude-tweaks-run: ${RUN}  \n`, isCrossRepository: false }]), 'acme', 'w'),
    { link: PR_URL },
    'the plain marker form, trimmed, matches',
  );
  assert.equal(
    claimStore.staleClaimInFlightPr(staleMarker(RUN), () => JSON.stringify({}), 'acme', 'w'),
    null,
    'a non-array pr list result fails open to null',
  );
  assert.equal(
    claimStore.staleClaimInFlightPr(staleMarker(RUN), ghWith([{ url: 'https://github.com/evil/x/pull/1', body: `claude-tweaks-run: ${RUN}\n`, isCrossRepository: false }]), 'acme', 'w'),
    null,
    'a cross-repo PR url never returns',
  );
  assert.equal(
    claimStore.staleClaimInFlightPr(staleMarker(RUN), ghWith([{ ...markedPr, isCrossRepository: true }]), 'acme', 'w'),
    null,
    'a fork PR into this repo never returns, whatever its body carries',
  );
  assert.equal(
    claimStore.staleClaimInFlightPr(staleMarker(RUN), ghWith([{ url: PR_URL, body: markedPr.body }]), 'acme', 'w'),
    null,
    'a PR with no isCrossRepository field is not proven same-repo',
  );
});

// The matcher is a detector over a line pr-body.js composes, so it is pinned against the composer's own
// output, not a hand-typed marker: a reworded marker would otherwise switch the stale check off silently.
test('staleClaimInFlightPr matches the run marker pr-body.js composes, in either form alone', () => {
  const bodies = {
    'PR-early': composePrEarlyBody({ runId: RUN, specSummary: 's', target: '#1', nextStep: 'build', fixesLines: [] }),
    express: composeExpressBody({ runId: RUN, specSummary: 's', fixesLines: [] }),
  };
  const match = (body) => claimStore.staleClaimInFlightPr(
    staleMarker(RUN), () => JSON.stringify([{ url: PR_URL, body, isCrossRepository: false }]), 'acme', 'w');
  for (const [name, body] of Object.entries(bodies)) {
    assert.deepEqual(match(body), { link: PR_URL }, `${name} body`);
    // A gh-absent MCP read strips every HTML comment, leaving the plain companion.
    assert.deepEqual(match(body.replace(/<!--[\s\S]*?-->/g, '')), { link: PR_URL }, `${name} body, HTML comments stripped`);
    const withoutPlain = body.split('\n').filter((l) => !l.startsWith('claude-tweaks-run:')).join('\n');
    assert.notEqual(withoutPlain, body, `${name} body carries the plain marker`);
    assert.deepEqual(match(withoutPlain), { link: PR_URL }, `${name} body, HTML-comment marker alone`);
  }
});

// #4588: `--resume-pr <url>` is the one narrow exception to the stale in-flight
// stop — a 'stale' claim whose in-flight PR link EQUALS the flag re-claims
// through the ordinary conditional write instead of exiting 3. Nothing else
// changes: a mismatched link, a pr-opened tombstone and every other shape keep
// today's behavior, and the envelope gains `resumedPr` only when the flag is passed.
const RESUME_PR = 'https://github.com/acme/w/pull/7';
const resumeMarkedPr = { ...markedPr, url: RESUME_PR };

test('(resume-pr) re-claims a stale blob whose in-flight link equals the flag: exit 0, claimed, resumedPr names it, a claim write happened', () => {
  const { ghApi, calls } = makeGhApi({
    reads: { 780: [readOk(staleMarker(RUN), 'sha780'), confirmRead()] },
    writes: { 780: [writeOk] },
  });
  const { gh } = makeGh({ openPrs: [resumeMarkedPr] });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '780', '--resume-pr', RESUME_PR], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, [780]);
  assert.deepEqual(body.resumedPr, [{ issue: 780, link: RESUME_PR }]);
  const w = calls.find((a) => isWrite(a, '780'));
  assert.ok(w, 'a claim write must have happened');
  assert.equal(fieldOf(w, 'sha'), 'sha780', 'the re-claim is the ordinary conditional write against the stale blob');
});

test('(resume-pr-2) a mismatched link still stops in-flight: exit 3, the PR found, no write', () => {
  const { ghApi, calls } = makeGhApi({
    reads: { 781: [readOk(staleMarker(RUN), 'sha781')] },
    writes: {},
  });
  const { gh } = makeGh({ openPrs: [resumeMarkedPr] });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '781', '--resume-pr', 'https://github.com/acme/w/pull/8'], deps);

  assert.equal(code, 3);
  const body = JSON.parse(io.out[0]);
  assert.equal(body.inFlight[0].link, RESUME_PR);
  assert.ok(!('resumedPr' in body), 'an in-flight stop envelope never carries resumedPr');
  assert.ok(!calls.some((a) => isWrite(a, '781')), 'a mismatched --resume-pr must not re-claim');
});

test('(resume-pr-2b) near-miss links never match: a trailing slash, a longer PR number, a case change and an http scheme are not the same string', () => {
  for (const flag of [`${RESUME_PR}/`, `${RESUME_PR}0`, RESUME_PR.replace('acme', 'ACME'), RESUME_PR.replace('https', 'http')]) {
    const { ghApi, calls } = makeGhApi({
      reads: { 781: [readOk(staleMarker(RUN), 'sha781')] },
      writes: {},
    });
    const { gh } = makeGh({ openPrs: [resumeMarkedPr] });
    const { deps } = baseDeps({ ghApi, gh });

    assert.equal(run(['--run-id', 'r1', '--targets', '781', '--resume-pr', flag], deps), 3, flag);
    assert.ok(!calls.some((a) => isWrite(a, '781')), flag);
  }
});

test('(resume-pr-2c) --keep-going with a mismatched link: skipped in-flight, no write, resumedPr is []', () => {
  const { ghApi, calls } = makeGhApi({
    reads: { 781: [readOk(staleMarker(RUN), 'sha781')] },
    writes: {},
  });
  const { gh } = makeGh({ openPrs: [resumeMarkedPr] });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '781', '--keep-going', '--resume-pr', 'https://github.com/acme/w/pull/8'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.skipped, [{ issue: 781, reason: 'in-flight', link: RESUME_PR }]);
  assert.deepEqual(body.resumedPr, []);
  assert.ok(!calls.some((a) => isWrite(a, '781')));
});

test('(resume-pr-3) a pr-opened tombstone is never overridden by --resume-pr: exit 3 inFlight, no write', () => {
  const { ghApi, calls } = makeGhApi({
    reads: { 782: [readOk(prOpenedTombstoneMarker(RUN, RESUME_PR), 'sha782')] },
    writes: {},
  });
  const { gh } = makeGh({ prState: 'OPEN' });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '782', '--resume-pr', RESUME_PR], deps);

  assert.equal(code, 3);
  assert.deepEqual(JSON.parse(io.out[0]).inFlight, [{ issue: 782, link: RESUME_PR }]);
  assert.ok(!calls.some((a) => isWrite(a, '782')), 'the tombstone branch is untouched by --resume-pr');
});

test('(resume-pr-4) an abandoned: tombstone re-claims by the ordinary write; resumedPr is [] (the flag was passed, no stale branch ran)', () => {
  const abandoned = JSON.stringify({
    released: true, runId: RUN, reason: 'abandoned: spec 4589', releasedAt: new Date(NOW).toISOString(),
  });
  const { ghApi, calls } = makeGhApi({
    reads: { 783: [readOk(abandoned, 'sha783'), confirmRead()] },
    writes: { 783: [writeOk] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '783', '--resume-pr', RESUME_PR], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, [783]);
  assert.deepEqual(body.resumedPr, []);
  assert.ok(calls.some((a) => isWrite(a, '783')));
});

// issue-claims.md ("swept: stale claim" tombstone shape): an ordinary tombstone
// re-claim that never consults the stale in-flight check. Pins the ordinary tombstone
// re-claim with --resume-pr passed (it was red before the implementation only because
// the flag was unknown, exit 2).
test('(resume-pr-5) a swept: stale claim tombstone re-claims by the ordinary write; resumedPr is []', () => {
  const swept = JSON.stringify({
    released: true, runId: '2026-10-30T010101-sweep', reason: 'swept: stale claim', releasedAt: new Date(NOW).toISOString(), sweptFrom: RUN,
  });
  const { ghApi, calls } = makeGhApi({
    reads: { 784: [readOk(swept, 'sha784'), confirmRead()] },
    writes: { 784: [writeOk] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '784', '--resume-pr', RESUME_PR], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, [784]);
  assert.deepEqual(body.resumedPr, []);
  assert.ok(calls.some((a) => isWrite(a, '784')));
});

test('(resume-pr-6) without --resume-pr the stale in-flight stop is unchanged and the envelope has no resumedPr key', () => {
  const { ghApi, calls } = makeGhApi({
    reads: { 785: [readOk(staleMarker(RUN), 'sha785')] },
    writes: {},
  });
  const { gh } = makeGh({ openPrs: [resumeMarkedPr] });
  const { deps, io } = baseDeps({ ghApi, gh });

  assert.equal(run(['--run-id', 'r1', '--targets', '785'], deps), 3);
  const stopped = JSON.parse(io.out[0]);
  assert.deepEqual(stopped.inFlight, [{ issue: 785, link: RESUME_PR }]);
  assert.ok(!('resumedPr' in stopped));
  assert.ok(!calls.some((a) => isWrite(a, '785')));

  // And a success envelope without the flag carries no resumedPr either.
  const ok = makeGhApi({ reads: { 786: [readAbsent, confirmRead()] }, writes: { 786: [writeOk] } });
  const okDeps = baseDeps({ ghApi: ok.ghApi, gh: makeGh({}).gh });
  assert.equal(run(['--run-id', 'r1', '--targets', '786'], okDeps.deps), 0);
  assert.ok(!('resumedPr' in JSON.parse(okDeps.io.out[0])));
});

test('(resume-pr-7) --resume-pr with no usable value is malformed: exit 2, USAGE on stderr, no gh call', () => {
  const gh = () => { throw new Error('must not be called'); };
  const ghApi = () => { throw new Error('must not be called'); };
  for (const argv of [
    ['--run-id', 'r1', '--targets', '720', '--resume-pr'],
    ['--run-id', 'r1', '--targets', '720', '--resume-pr', ''],
    ['--run-id', 'r1', '--targets', '720', '--resume-pr', '  '],
    ['--run-id', 'r1', '--targets', '720', '--resume-pr', '--keep-going'],
  ]) {
    const { deps, io } = baseDeps({ ghApi, gh });
    assert.equal(run(argv, deps), 2, JSON.stringify(argv));
    assert.equal(io.out.length, 0);
    assert.ok(io.err.join('').includes('--resume-pr <url>'), 'USAGE documents the flag');
  }
});

test('(resume-pr-8) with --run, appendClaimLog receives resumePr for the resumed issue only', () => {
  const { ghApi } = makeGhApi({
    reads: {
      787: [readOk(staleMarker(RUN), 'sha787'), confirmRead()],
      788: [readAbsent, confirmRead()],
    },
    writes: { 787: [writeOk], 788: [writeOk] },
  });
  const { gh } = makeGh({ openPrs: [resumeMarkedPr] });
  const { deps, io } = baseDeps({ ghApi, gh });
  const logCalls = [];
  deps.appendClaimLog = (args) => { logCalls.push(args); };

  const code = run(['--run-id', 'r1', '--targets', '787,788', '--resume-pr', RESUME_PR, '--run', '/some/run/r1'], deps);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(io.out[0]).resumedPr, [{ issue: 787, link: RESUME_PR }]);
  assert.deepEqual(logCalls, [
    { runDir: '/some/run/r1', issue: 787, transport: 'contents-api', resumePr: RESUME_PR },
    { runDir: '/some/run/r1', issue: 788, transport: 'contents-api' },
  ]);
});

test('(resume-pr-8b) a matched stale claim whose write loses the race is skipped, never listed in resumedPr', () => {
  const { ghApi } = makeGhApi({
    reads: { 789: [readOk(staleMarker(RUN), 'sha789')] },
    writes: { 789: [{ stdout: null, failure: null, status: 422 }] },
  });
  const { gh } = makeGh({ openPrs: [resumeMarkedPr] });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '789', '--keep-going', '--resume-pr', RESUME_PR], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, []);
  assert.equal(body.skipped[0].reason, 'contested');
  assert.deepEqual(body.resumedPr, [], 'resumedPr names only claims that actually landed');
});

test('(resume-pr-9) defaultAppendClaimLog with resumePr writes the resume-pr claim line, still claim-log-only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-claim-log-resume-'));
  fs.mkdirSync(path.join(root, '.git'));
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-4588');
  fs.mkdirSync(runDir, { recursive: true });

  const modulePath = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'claim-targets', 'claim-targets');
  const script = [
    `const { defaultAppendClaimLog } = require(${JSON.stringify(modulePath)});`,
    `defaultAppendClaimLog({ runDir: ${JSON.stringify(runDir)}, issue: 4588, transport: 'git', resumePr: ${JSON.stringify(RESUME_PR)} });`,
  ].join('\n');
  execFileSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8' });

  const decisionsText = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.ok(decisionsText.includes(`claimed #4588 (bin/claim-targets.js, transport: git, resume-pr: ${RESUME_PR})`), decisionsText);
  assert.equal(hasClaimLogFor(decisionsText, 4588), true);
  assert.equal(classifyDecisions(decisionsText), 'claim-log-only');
});

// (c) stale target -> conditional PUT (re-claim)
test('(c) stale target: conditional write re-claims with the blob sha', () => {
  const staleClaimedAt = new Date(NOW - 100 * 3600 * 1000).toISOString(); // 100h ago, ttl 72h
  const { ghApi, calls } = makeGhApi({
    reads: { 723: [readOk(liveMarker('otherRun', staleClaimedAt), 'sha723'), confirmRead()] },
    writes: { 723: [writeOk] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '723'], deps);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(io.out[0]).claimed, [723]);
  const w = calls.find((a) => isWrite(a, '723'));
  assert.equal(fieldOf(w, 'sha'), 'sha723');
});

// (d) second target live -> first released (tombstone PUT, abort reason), exit 3, holder on stdout
test('(d) second target live: first target released with the abort reason, exit 3, holder JSON', () => {
  const { ghApi, calls } = makeGhApi({
    reads: {
      720: [readAbsent, confirmRead(), readOk('irrelevant', 'sha720-release')], // 2nd = post-write verification, 3rd = release's fresh read
      721: [readOk(liveMarker('otherRun'), 'sha721')],
    },
    writes: {
      720: [writeOk, writeOk], // 1st = claim, 2nd = abort-release tombstone
    },
  });
  const { gh, calls: ghCalls } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720,721'], deps);

  assert.equal(code, 3);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.released, [720]);
  assert.equal(body.contested.length, 1);
  assert.equal(body.contested[0].issue, 721);
  assert.equal(body.contested[0].holder.runId, 'otherRun');
  const releaseWrite = calls.filter((a) => isWrite(a, '720'))[1];
  assert.equal(fieldOf(releaseWrite, 'sha'), 'sha720-release');
  assert.match(fieldOf(releaseWrite, 'message'), new RegExp(ABORT_REASON.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(ghCalls.some((a) => a[0] === 'issue' && a[1] === 'edit' && a[2] === '720' && a.includes('--remove-label')));
});

// (e) same with --keep-going -> no release, contested recorded, exit 0
test('(e) --keep-going: contest recorded in skipped, no release, exit 0', () => {
  const { ghApi, calls } = makeGhApi({
    reads: {
      720: [readAbsent, confirmRead()],
      721: [readOk(liveMarker('otherRun'), 'sha721')],
    },
    writes: { 720: [writeOk] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720,721', '--keep-going'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, [720]);
  assert.equal(body.skipped.length, 1);
  assert.equal(body.skipped[0].issue, 721);
  assert.equal(body.skipped[0].reason, 'contested');
  // Two reads of 720: the claim's own read plus its post-write verification
  // read (#2073) — still no release fresh-read, since 720's claim stands.
  assert.equal(calls.filter((a) => isRead(a, '720')).length, 2);
});

// (f) transient ghApi failure on second read -> first released, exit 4, error named (not holder)
test('(f) transient read failure: first released, exit 4, error named', () => {
  const { ghApi, calls } = makeGhApi({
    reads: {
      720: [readAbsent, confirmRead(), readOk('irrelevant', 'sha720-release')],
      721: [readFail('network-failure')],
    },
    writes: { 720: [writeOk, writeOk] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720,721'], deps);

  assert.equal(code, 4);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.released, [720]);
  assert.deepEqual(body.transient, [{ issue: 721, error: 'network-failure' }]);
  assert.equal(body.transient[0].holder, undefined);
});

// (g) self-owned (blob runId == --run-id) -> skipped as already-owned, no write
test('(g) self-owned target: already-owned, no write attempted', () => {
  const { ghApi, calls } = makeGhApi({
    reads: { 730: [readOk(liveMarker('r1'), 'sha730')] },
    writes: {},
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '730'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, []);
  assert.deepEqual(body.alreadyOwned, [730]);
  assert.ok(!calls.some((a) => isWrite(a, '730')), 'self-owned target must never be re-claimed');
});

// (g2) self-owned, STALE (blob runId == --run-id, but past TTL) -> still
// already-owned, not reclaimed — the self-owned guard covers `live` OR
// `stale` (see run()'s combined `classified.state === 'live' ||
// classified.state === 'stale'` check), but only the `live` case had a test.
test('(g2) self-owned target, stale (past TTL): already-owned, no write attempted', () => {
  const staleClaimedAt = new Date(NOW - 100 * 3600 * 1000).toISOString(); // 100h ago, ttl 72h
  const { ghApi, calls } = makeGhApi({
    reads: { 731: [readOk(liveMarker('r1', staleClaimedAt), 'sha731')] },
    writes: {},
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '731'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, []);
  assert.deepEqual(body.alreadyOwned, [731]);
  assert.ok(!calls.some((a) => isWrite(a, '731')), 'self-owned stale target must never be re-claimed');
});

// (g3) self-owned target: a prior attempt whose write landed but reported a
// transient failure exits 4 before the label step; the retry reads the blob
// as self-owned. The held claim must still end up carrying bot:in-progress,
// and a label failure must be reported (not fatal).
test('(g3) self-owned target: bot:in-progress is re-asserted; a label failure is reported, not fatal', () => {
  const { ghApi } = makeGhApi({ reads: { 732: [readOk(liveMarker('r1'), 'sha732')] }, writes: {} });
  const { gh, calls: ghCalls } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  assert.equal(run(['--run-id', 'r1', '--targets', '732'], deps), 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.alreadyOwned, [732]);
  assert.deepEqual(body.labelFailures, []);
  assert.ok(ghCalls.some((a) => a[0] === 'issue' && a[1] === 'edit' && a[2] === '732' && a.includes('--add-label')));

  const { ghApi: ghApi2 } = makeGhApi({ reads: { 732: [readOk(liveMarker('r1'), 'sha732')] }, writes: {} });
  const { gh: failingGh } = makeGh({ fail: { labelAdd: true } });
  const { deps: deps2, io: io2 } = baseDeps({ ghApi: ghApi2, gh: failingGh });

  assert.equal(run(['--run-id', 'r1', '--targets', '732'], deps2), 0);
  assert.deepEqual(JSON.parse(io2.out[0]).labelFailures, [{ issue: 732, error: 'label add failed' }]);
});

// (h) unreadable blob -> contested (fail-closed)
test('(h) unreadable blob: fails closed to contested, exit 3', () => {
  const { ghApi } = makeGhApi({
    reads: { 740: [readOk('not-valid-json{{{', 'sha740')] },
    writes: {},
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '740'], deps);

  assert.equal(code, 3);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.contested, [{ issue: 740, holder: null }]);
  assert.deepEqual(body.released, []);
});

// (i) malformed invocation -> exit 2, gh/ghApi never called
test('(i) malformed: missing --targets -> exit 2, no gh call', () => {
  const gh = () => { throw new Error('must not be called'); };
  const ghApi = () => { throw new Error('must not be called'); };
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1'], deps);

  assert.equal(code, 2);
  assert.equal(io.out.length, 0);
});

test('(i) malformed: --targets 0,abc -> exit 2, no gh call', () => {
  const gh = () => { throw new Error('must not be called'); };
  const ghApi = () => { throw new Error('must not be called'); };
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '0,abc'], deps);

  assert.equal(code, 2);
  assert.equal(io.out.length, 0);
});

// (j) label add failure -> claim still stands, recorded in labelFailures, exit 0
test('(j) label add failure: claim stands, recorded in labelFailures, exit 0', () => {
  const { ghApi } = makeGhApi({
    reads: { 750: [readAbsent, confirmRead()] },
    writes: { 750: [writeOk] },
  });
  const { gh, calls: ghCalls } = makeGh({ fail: { labelAdd: true } });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '750'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, [750]);
  assert.equal(body.labelFailures.length, 1);
  assert.equal(body.labelFailures[0].issue, 750);
  assert.match(body.labelFailures[0].error, /label add failed/);
  assert.ok(ghCalls.some((a) => a[0] === 'issue' && a[1] === 'comment' && a[2] === '750'), 'comment still attempted after label failure');
});

// ---- #2073: post-write verification -----------------------------------
// A claim write the store reports `ok: true` on is not yet a confirmed
// claim — reproduces the #1973 shape (a write that "succeeds" without
// actually landing) as a runner double: a fake whose write always reports
// success but whose SUBSEQUENT read never shows the confirming content.

test('(m) #2073: write reports success but the read-back stays absent -> claim-unverified, exit 5', () => {
  const { ghApi, calls } = makeGhApi({
    // Only one entry queued for 770 — the read-back after the "successful"
    // write repeats it (still absent), reproducing a write that reported ok
    // without actually landing.
    reads: { 770: [readAbsent] },
    writes: { 770: [writeOk] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '770'], deps);

  assert.equal(code, 5, 'an unconfirmed write must never report success (exit 0)');
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.unverified, [{ issue: 770 }]);
  assert.deepEqual(body.claimed, undefined, 'the default abort envelope carries no claimed list');
  assert.deepEqual(body.released, [], 'nothing else was claimed this run, so nothing to release');
  assert.equal(calls.filter((a) => isWrite(a, '770')).length, 1, 'the unverified target itself is never tombstoned — a second write would be a release attempt, and it might still be this run\'s own slow-to-replicate claim');
});

test('(m2) #2073: write reports success and the read-back confirms it -> claimed, exit 0 (the confirmed counterpart to (m))', () => {
  const { ghApi } = makeGhApi({
    reads: { 771: [readAbsent, confirmRead()] },
    writes: { 771: [writeOk] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '771'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, [771]);
  assert.equal(body.unverified, undefined);
});

test('(m3) #2073 under --keep-going: unverified target recorded in skipped, not claimed, exit 0', () => {
  const { ghApi } = makeGhApi({
    reads: { 772: [readAbsent] }, // read-back repeats the same (still-absent) entry
    writes: { 772: [writeOk] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '772', '--keep-going'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, []);
  assert.deepEqual(body.skipped, [{ issue: 772, reason: 'unverified' }]);
});

test('(m4) #2073/#2329: one target unverified, a second already confirmed-claimed -> abort releases the confirmed target and attempts (but cannot confirm) release of the unverified one', () => {
  const { ghApi, calls } = makeGhApi({
    // 720 claims and verifies cleanly FIRST; 721's write "succeeds" but its
    // read-back never confirms it — not even across the #2329 retry window —
    // triggering the default all-or-abort.
    reads: {
      720: [readAbsent, confirmRead(), readOk('irrelevant', 'sha720-release')], // 2nd = its own verification, 3rd = release's fresh read
      721: [readAbsent], // every read-back (verify retries AND the release fresh read) repeats this same still-absent entry
    },
    writes: {
      720: [writeOk, writeOk], // 1st = claim, 2nd = abort-release tombstone
      721: [writeOk],
    },
  });
  const { gh, calls: ghCalls } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720,721'], deps);

  assert.equal(code, 5);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.unverified, [{ issue: 721 }]);
  assert.deepEqual(body.released, [720], '720 was confirmed claimed by this run, so the all-or-abort release covers it');
  // #2329: 721's own (unconfirmed) write is now ALSO named in the release
  // attempt — abort() no longer releases claimedThisRun alone (the claim-leak
  // fix). Its fresh read still finds the target absent, so it lands in
  // releaseFailed (visible on stdout) rather than silently riding out its
  // TTL unreleased with no bot:in-progress marker pointing at it.
  assert.deepEqual(body.releaseFailed, [{ issue: 721, error: 'absent' }], "721's unverified write is named, not silently dropped, even though the release attempt itself can't confirm it landed");
  assert.equal(calls.filter((a) => isWrite(a, '721')).length, 1, '721 is never tombstoned — the release fresh read still sees it absent, so writeClaimBlob is never called for it (nothing there to safely overwrite)');
  assert.ok(ghCalls.some((a) => a[0] === 'issue' && a[1] === 'edit' && a[2] === '720' && a.includes('--remove-label')));
});

test('(m5) #2329: an unverified target that a later fresh read confirms DID land gets released, not left claimed', () => {
  const { ghApi, calls } = makeGhApi({
    // The post-write verification (and its two retries) all still see the
    // pre-write blob — the eventually-consistent race never resolves within
    // the retry window — but by the time abort()'s own fresh read runs
    // (moments later, a separate read call), the write has finally
    // propagated: a live blob under this run's own identity.
    reads: { 775: [readAbsent, readAbsent, readAbsent, readAbsent, confirmRead('r1', 'sha775-release')] },
    writes: { 775: [writeOk, writeOk] }, // 1st = claim, 2nd = abort-release tombstone
  });
  const { gh, calls: ghCalls } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '775'], deps);

  assert.equal(code, 5, 'still reported unverified — the retry window genuinely expired without confirming it');
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.unverified, [{ issue: 775 }]);
  assert.deepEqual(body.released, [775], "a claim that genuinely landed must be released so a later run can reclaim it — never left silently held under this run's identity");
  assert.deepEqual(body.releaseFailed, []);
  assert.equal(calls.filter((a) => isWrite(a, '775')).length, 2, 'the original claim write, plus exactly one release/tombstone write once the fresh read confirmed it landed');
  assert.ok(ghCalls.some((a) => a[0] === 'issue' && a[1] === 'edit' && a[2] === '775' && a.includes('--remove-label')));
});

test('(m6) #2329: read-back retry recovers from a transient stale read on the contents-API path -> claimed, exit 0', () => {
  const sleepCalls = [];
  const { ghApi } = makeGhApi({
    // index0 = initial pre-write read (absent); index1 = first verification
    // attempt still sees the stale pre-write blob (the eventually-consistent
    // race this record fixes); index2 = second attempt finally sees it live.
    reads: { 776: [readAbsent, readAbsent, confirmRead()] },
    writes: { 776: [writeOk] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  deps.sleep = (ms) => sleepCalls.push(ms);

  const code = run(['--run-id', 'r1', '--targets', '776'], deps);

  assert.equal(code, 0, 'a claim that reads back consistent on retry must never report unverified');
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, [776]);
  assert.equal(body.unverified, undefined);
  assert.equal(sleepCalls.length, 1, 'exactly one backoff wait — between the stale first attempt and the confirming second attempt');
  assert.ok(sleepCalls[0] > 0, 'the wait must be a positive duration, not a busy-loop');
});

test('(m7) #2329: the git-CAS read-back path never retries — one check even when it never confirms, since knownTip already pins it to the exact commit just pushed', () => {
  const showCalls = [];
  const gitRunner = (args) => {
    if (args[0] === 'fetch') return '';
    if (args[0] === 'rev-parse' && args[1] !== 'FETCH_HEAD') return `${'a'.repeat(40)}\n`;
    if (args[0] === 'update-ref' && args[1] === '-d') return '';
    if (args[0] === 'show') {
      showCalls.push(args);
      // Neither the pre-write read (against the fetched tip) nor the
      // post-write verification (against the just-pushed 'newcommit') ever
      // finds a live blob here — this write's outcome genuinely never
      // confirms, on the transport whose read is already pinned to an exact
      // commit and therefore cannot be "eventually" anything.
      throw new Error(`fatal: path 'claims/issue-777.json' does not exist in '${args[1].split(':')[0]}'`);
    }
    if (args[0] === 'hash-object') return 'deadbeef\n';
    if (args[0] === 'read-tree' || args[0] === 'update-index') return '';
    if (args[0] === 'write-tree') return 'newtree\n';
    if (args[0] === 'commit-tree') return 'newcommit\n';
    if (args[0] === 'push') return '';
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
  const ghApi = (args) => { throw new Error(`contents-API must not be called when git-CAS works: ${args.join(' ')}`); };
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  deps.gitRunner = gitRunner;
  const sleepCalls = [];
  deps.sleep = (ms) => sleepCalls.push(ms);

  const code = run(['--run-id', 'r1', '--targets', '777'], deps);

  assert.equal(code, 5, 'a git-CAS write whose own commit never shows a live blob must report unverified');
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.unverified, [{ issue: 777 }]);
  assert.equal(showCalls.filter((a) => a[1] === 'newcommit:claims/issue-777.json').length, 1, 'exactly one post-write read-back check on the git-CAS path — a retry could never see anything different since knownTip already pins the read to the exact commit it just pushed');
  assert.equal(sleepCalls.length, 0, 'the git-CAS path never waits between attempts — there is only ever the one check');
});

// Write-time rejection (lost race) vs write-time transient failure — the
// coordinator's ruling: a genuine write-conflict (claim-store.js's
// `writeClaimBlob` now reports `{ok:false, conflict:true, failure:null}`
// for a 422) is CONTESTED (exit 3), with a best-effort re-read to name the
// winner; a real transient ghApi failure during the write stays TRANSIENT
// (exit 4), same as a transient read failure.

test('write conflict (lost race): contested exit 3, all-or-abort release, holder from a best-effort re-read', () => {
  const { ghApi, calls } = makeGhApi({
    reads: {
      720: [readAbsent, confirmRead(), readOk('irrelevant', 'sha720-release')], // 2nd = post-write verification, 3rd = abort-release fresh read
      721: [readAbsent, readOk(liveMarker('winnerRun'), 'sha721-after')], // 2nd = holder re-read after the lost race
    },
    writes: {
      720: [writeOk, writeOk],
      721: [{
        stdout: null, failure: null, status: 422,
      }],
    },
  });
  const { gh, calls: ghCalls } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720,721'], deps);

  assert.equal(code, 3);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.released, [720]);
  assert.equal(body.contested.length, 1);
  assert.equal(body.contested[0].issue, 721);
  assert.equal(body.contested[0].holder.runId, 'winnerRun');
  // 3, not 2: the initial read, writeClaimBlob's own self-write recheck on
  // the 422/409 rejection (#787 hindsight finding — tells a lost-ack retry
  // of THIS write apart from a genuine rival), and claim-targets.js's own
  // best-effort holder re-read afterward.
  assert.equal(calls.filter((a) => isRead(a, '721')).length, 3, 'expected the initial read, writeClaimBlob\'s self-write recheck, and one best-effort holder re-read');
  assert.ok(ghCalls.some((a) => a[0] === 'issue' && a[1] === 'edit' && a[2] === '720' && a.includes('--remove-label')));
});

test('write conflict (409 sha-mismatch on the conditional write): contested exit 3, same handling as a 422 lost race (#723)', () => {
  const { ghApi, calls } = makeGhApi({
    reads: {
      720: [readAbsent, confirmRead(), readOk('irrelevant', 'sha720-release')], // 2nd = post-write verification, 3rd = abort-release fresh read
      721: [readOk(liveMarker('otherRun', new Date(NOW - 100 * 3600 * 1000).toISOString()), 'sha721'), // stale -> reclaim attempt
        readOk(liveMarker('winnerRun'), 'sha721-after')], // holder re-read after the lost race
    },
    writes: {
      720: [writeOk, writeOk],
      721: [{
        stdout: null, failure: null, status: 409,
      }],
    },
  });
  const { gh, calls: ghCalls } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720,721'], deps);

  assert.equal(code, 3);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.released, [720]);
  assert.equal(body.contested.length, 1);
  assert.equal(body.contested[0].issue, 721);
  assert.equal(body.contested[0].holder.runId, 'winnerRun');
  // 3, not 2: the initial read, writeClaimBlob's own self-write recheck on
  // the 422/409 rejection (#787 hindsight finding — tells a lost-ack retry
  // of THIS write apart from a genuine rival), and claim-targets.js's own
  // best-effort holder re-read afterward.
  assert.equal(calls.filter((a) => isRead(a, '721')).length, 3, 'expected the initial read, writeClaimBlob\'s self-write recheck, and one best-effort holder re-read');
  assert.ok(ghCalls.some((a) => a[0] === 'issue' && a[1] === 'edit' && a[2] === '720' && a.includes('--remove-label')));
});

test('write conflict under --keep-going: recorded in skipped with holder, no release, exit 0', () => {
  const { ghApi } = makeGhApi({
    reads: {
      720: [readAbsent, confirmRead()],
      721: [readAbsent, readOk(liveMarker('winnerRun'), 'sha721-after')],
    },
    writes: {
      720: [writeOk],
      721: [{ stdout: null, failure: null, status: 422 }],
    },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720,721', '--keep-going'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, [720]);
  assert.equal(body.skipped.length, 1);
  assert.equal(body.skipped[0].issue, 721);
  assert.equal(body.skipped[0].reason, 'contested');
  assert.equal(body.skipped[0].holder.runId, 'winnerRun');
});

test('write network failure: transient exit 4, no holder (distinct from a write-conflict)', () => {
  const { ghApi } = makeGhApi({
    reads: { 730: [readAbsent] },
    writes: { 730: [{ stdout: null, failure: 'network-failure', status: null }] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '730'], deps);

  assert.equal(code, 4);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.transient, [{ issue: 730, error: 'network-failure' }]);
  assert.equal(body.transient[0].holder, undefined);
  assert.deepEqual(body.released, []);
});

// AC4's observable behavior, end to end through `run()`: a secondary/abuse
// rate limit on the claim write is TRANSIENT (exit 4), never contested (exit
// 3). claim-store.js's own suite pins that `writeClaimBlob` reports
// `{ok:false, secondaryRateLimit:true, failure:null}` for it, but nothing
// pinned that `run()` routes that shape to the transient branch — and the
// branch reads `write.failure || write.secondaryRateLimit`, so dropping the
// second half would silently send a throttle down the contested path and
// abort a whole group claim on a lie (record-697's incident, exactly).
test('write secondary-rate-limit: transient exit 4 with a `secondary-rate-limit` transient entry, never contested exit 3', () => {
  const { ghApi, calls } = makeGhApi({
    reads: { 740: [readAbsent] },
    writes: { 740: [{ stdout: null, failure: 'secondary-rate-limit', status: 403 }] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '740'], deps);

  assert.equal(code, 4, 'a throttle is transient — exit 4, not the contested exit 3');
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.transient, [{ issue: 740, error: 'secondary-rate-limit' }]);
  assert.equal(body.contested, undefined, 'no contested envelope — a throttle is not another agent holding the claim');
  assert.equal(calls.filter((a) => isRead(a, '740')).length, 1, 'no best-effort holder re-read — that belongs to the contested path only');
});

test('write secondary-rate-limit under --keep-going: skipped as transient, exit 0, never a contested skip', () => {
  const { ghApi } = makeGhApi({
    reads: { 741: [readAbsent] },
    writes: { 741: [{ stdout: null, failure: 'secondary-rate-limit', status: 403 }] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '741', '--keep-going'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, []);
  assert.equal(body.skipped.length, 1);
  assert.equal(body.skipped[0].reason, 'transient');
  assert.equal(body.skipped[0].error, 'secondary-rate-limit');
});

// abort-release write failure: a target the release step can't safely tombstone
// must be named in releaseFailed (not silently dropped from the envelope), and
// the exit code stays the classification's own (3 here) — not a second abort.
test('abort-release write failure: target lands in releaseFailed, not released, exit code unchanged (#723)', () => {
  const { ghApi, calls } = makeGhApi({
    reads: {
      720: [readAbsent, confirmRead(), readOk('irrelevant', 'sha720-release')], // 2nd = post-write verification, 3rd = release's fresh read
      721: [readOk(liveMarker('otherRun'), 'sha721')],
    },
    writes: {
      720: [writeOk, writeFail('network-failure')], // 1st = claim, 2nd = abort-release tombstone fails
    },
  });
  const { gh, calls: ghCalls } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720,721'], deps);

  assert.equal(code, 3);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.released, []);
  assert.deepEqual(body.releaseFailed, [{ issue: 720, error: 'network-failure' }]);
  assert.equal(body.contested.length, 1);
  assert.equal(body.contested[0].issue, 721);
  const releaseWrite = calls.filter((a) => isWrite(a, '720'))[1];
  assert.match(fieldOf(releaseWrite, 'message'), new RegExp(ABORT_REASON.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // best-effort label removal is still attempted even though the release write failed
  assert.ok(ghCalls.some((a) => a[0] === 'issue' && a[1] === 'edit' && a[2] === '720' && a.includes('--remove-label')));
});

// #787 residual finding: pin that `run()`'s claim write threads
// `expectedContent` = the content this same write decision read — `null`
// for a create-only (absent) target, the prior blob's content for a reclaim.
test('claim write threads expectedContent = the content this write decision read, not undefined (#787 residual finding)', (t) => {
  const staleContent = liveMarker('otherRun', new Date(NOW - 100 * 3600 * 1000).toISOString());
  const { ghApi } = makeGhApi({
    reads: { 760: [readAbsent, confirmRead()], 761: [readOk(staleContent, 'sha761'), confirmRead()] },
    writes: { 760: [writeOk], 761: [writeOk] },
  });
  const { gh } = makeGh({});
  const { deps } = baseDeps({ ghApi, gh });
  const writeSpy = t.mock.method(claimStore, 'writeClaimBlob');

  const code = run(['--run-id', 'r1', '--targets', '760,761'], deps);

  assert.equal(code, 0);
  assert.equal(writeSpy.mock.calls.length, 2);
  const opts760 = writeSpy.mock.calls[0].arguments[3];
  const opts761 = writeSpy.mock.calls[1].arguments[3];
  assert.equal(opts760.expectedContent, null, 'create-only (absent) target -> expectedContent null, the absence-based verification case');
  assert.equal(opts761.expectedContent, staleContent, 'reclaim target -> expectedContent is the exact content this write decision read, not re-derived later');
});

// #787 residual finding: pin that the abort-release rollback write
// (`releaseClaimedThisRun`) threads `expectedContent` = the fresh content
// its own re-read saw — the path I1 identified as able to strand a live
// claim with its label already stripped if a spurious git-CAS rejection
// were ever (mis)treated as a genuine contest.
test('abort-release rollback write threads expectedContent = the fresh content releaseClaimedThisRun re-read (#787 residual finding)', (t) => {
  const { ghApi } = makeGhApi({
    reads: {
      720: [readAbsent, confirmRead(), readOk('irrelevant', 'sha720-release')], // 2nd = post-write verification, 3rd = rollback's fresh read
      721: [readOk(liveMarker('otherRun'), 'sha721')],
    },
    writes: {
      720: [writeOk, writeOk],
    },
  });
  const { gh } = makeGh({});
  const { deps } = baseDeps({ ghApi, gh });
  const writeSpy = t.mock.method(claimStore, 'writeClaimBlob');

  const code = run(['--run-id', 'r1', '--targets', '720,721'], deps);

  assert.equal(code, 3);
  assert.equal(writeSpy.mock.calls.length, 2, 'the initial claim write plus the rollback release write');
  const rollbackOpts = writeSpy.mock.calls[1].arguments[3];
  assert.equal(rollbackOpts.expectedContent, 'irrelevant', "rollback write's expectedContent is the fresh read's content, not the original claim read's");
});

// #3065: repo-slug resolution timeout classification. A fake `gh` whose
// `repo view` call throws a timeout-shaped error (`spawnSync`'s own
// ETIMEDOUT shape) a given number of times before succeeding, so each test
// controls whether the CLI's one retry is enough.
function makeTimeoutThenSucceedGh({ timeoutCount, repoSlug = REPO } = {}) {
  let repoViewCalls = 0;
  const calls = [];
  function gh(args) {
    calls.push(args);
    if (args[0] === 'repo' && args[1] === 'view') {
      repoViewCalls += 1;
      if (repoViewCalls <= timeoutCount) {
        const err = new Error('spawnSync gh ETIMEDOUT');
        err.code = 'ETIMEDOUT';
        throw err;
      }
      return `${repoSlug}\n`;
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  }
  return { gh, calls };
}

test('(slug-1) repo-slug timeout that succeeds on retry: claims proceed normally, exit 0', () => {
  const { gh } = makeTimeoutThenSucceedGh({ timeoutCount: 1 });
  const { ghApi } = makeGhApi({ reads: { 740: [readAbsent, confirmRead()] }, writes: { 740: [writeOk] } });
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '740'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, [740]);
});

test('(slug-2) repo-slug timeout on both attempts: exit 4, transient envelope, no USAGE text on stderr', () => {
  const { gh } = makeTimeoutThenSucceedGh({ timeoutCount: 99 });
  const ghApi = () => { throw new Error('must not be called — nothing claimed before slug resolution'); };
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '741,742'], deps);

  assert.equal(code, 4);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.transient.map((t) => t.issue), [741, 742]);
  assert.deepEqual(body.released, []);
  assert.deepEqual(body.releaseFailed, []);
  assert.ok(!io.err.join('').includes(USAGE));
});

test('(slug-3) repo-slug timeout on both attempts under --keep-going: exit 0, every target skipped as transient', () => {
  const { gh } = makeTimeoutThenSucceedGh({ timeoutCount: 99 });
  const ghApi = () => { throw new Error('must not be called — nothing claimed before slug resolution'); };
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '743,744', '--keep-going'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.skipped, [
    { issue: 743, reason: 'transient' },
    { issue: 744, reason: 'transient' },
  ]);
  assert.deepEqual(body.claimed, []);
});

test('(slug-4) repo-slug ENOENT (gh absent): still exit 2, no USAGE text on stderr', () => {
  const gh = (args) => {
    if (args[0] === 'repo' && args[1] === 'view') {
      const err = new Error('spawnSync gh ENOENT');
      err.code = 'ENOENT';
      throw err;
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  const ghApi = () => { throw new Error('must not be called — nothing claimed before slug resolution'); };
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '745'], deps);

  assert.equal(code, 2);
  assert.ok(!io.err.join('').includes(USAGE));
});

test('--help short-circuits before any gh call, exit 0', () => {
  const gh = () => { throw new Error('must not be called'); };
  const ghApi = () => { throw new Error('must not be called'); };
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--help'], deps);

  assert.equal(code, 0);
  assert.ok(io.out[0].includes('usage:'));
});

// ---- #2775: --run writes the Step 2.8 claim-log line itself -------------

test('--run: appendClaimLog is called once per claimed issue with its transport, and the envelope carries claimLogFailures: []', () => {
  const { ghApi } = makeGhApi({
    reads: { 720: [readAbsent, confirmRead()], 721: [readAbsent, confirmRead()] },
    writes: { 720: [writeOk], 721: [writeOk] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  const calls = [];
  deps.appendClaimLog = (args) => { calls.push(args); };

  const code = run(['--run-id', 'r1', '--targets', '720,721', '--run', '/some/run/r1'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimLogFailures, []);
  assert.deepEqual(calls, [
    { runDir: '/some/run/r1', issue: 720, transport: 'contents-api' },
    { runDir: '/some/run/r1', issue: 721, transport: 'contents-api' },
  ]);
});

// #2775 controller ruling: defaultAppendClaimLog must gate on resolveTarget's
// anchoring check ([IL-127]) using PRODUCTION defaults for cwd/mainRoot —
// i.e. the real process.cwd() at call time, not an injected override. Proving
// the "ok" branch therefore needs a real child process whose own cwd sits
// inside a (fake, `.git`-is-a-directory) checkout root — the same technique
// tests/bin-lib/log-decision/append.test.js's concurrent-writers test uses
// (`spawn`/`execFileSync` with an explicit `cwd`, never `process.chdir()` on
// the shared test-runner process, and never a write into the real repo).
test('defaultAppendClaimLog round-trip: an anchored run dir (real child-process cwd inside a fake checkout) ends up claim-log-only, hasClaimLogFor true for both issues', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-claim-log-anchored-'));
  fs.mkdirSync(path.join(root, '.git')); // a real checkout root: mainCheckoutRoot(cwd) anchors here
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-2775');
  fs.mkdirSync(runDir, { recursive: true });

  const modulePath = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'claim-targets', 'claim-targets');
  const script = [
    `const { defaultAppendClaimLog } = require(${JSON.stringify(modulePath)});`,
    `defaultAppendClaimLog({ runDir: ${JSON.stringify(runDir)}, issue: 2775, transport: 'git' });`,
    `defaultAppendClaimLog({ runDir: ${JSON.stringify(runDir)}, issue: 2733, transport: 'contents-api' });`,
  ].join('\n');
  execFileSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8' });

  const decisionsText = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.equal(hasClaimLogFor(decisionsText, 2775), true);
  assert.equal(hasClaimLogFor(decisionsText, 2733), true);
  assert.equal(classifyDecisions(decisionsText), 'claim-log-only', '/flow Step 3 must still treat this dir as a fresh mint');
});

// #2775 controller ruling: an unanchored run dir (no `.git` anywhere above it
// — a worktree-local shadow copy, or just a bare scratch dir) must be refused
// rather than silently written. Needs no cwd trickery: `resolveTarget`'s
// `findGitRoot` walk returns null before ever consulting cwd/mainRoot when
// there is no `.git` anywhere above `runDir`, so this holds under ANY cwd —
// os.tmpdir()'s own ancestry has no `.git` to find.
test('defaultAppendClaimLog on an unanchored run dir (no .git anywhere above it): throws, naming the not-anchored reason', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-claim-log-unanchored-'));

  assert.throws(
    () => defaultAppendClaimLog({ runDir, issue: 2775, transport: 'git' }),
    /not-anchored/,
  );
});

// The same unanchored-dir failure, exercised through run()'s --run plumbing
// with the REAL defaultAppendClaimLog (not a fake): the claim must still
// stand, and claimLogFailures must name the issue and carry the reason.
test('--run pointed at an unanchored dir, with the real defaultAppendClaimLog: claim stands, claimLogFailures names the issue and the not-anchored reason', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-claim-log-unanchored-run-'));
  const runId = path.basename(runDir);
  const { ghApi } = makeGhApi({
    reads: { 752: [readAbsent, confirmRead(runId)] },
    writes: { 752: [writeOk] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  deps.appendClaimLog = defaultAppendClaimLog;

  const code = run(['--run-id', runId, '--targets', '752', '--run', runDir], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, [752]);
  assert.equal(body.claimLogFailures.length, 1);
  assert.equal(body.claimLogFailures[0].issue, 752);
  assert.match(body.claimLogFailures[0].error, /not-anchored/);
});

test('--run whose basename differs from --run-id: exit 2, no gh call', () => {
  const gh = () => { throw new Error('must not be called'); };
  const ghApi = () => { throw new Error('must not be called'); };
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720', '--run', '/some/run/other-id'], deps);

  assert.equal(code, 2);
  assert.equal(io.out.length, 0);
});

test('--run with no value (trailing bare flag, or empty): exit 2 with usage, no gh call', () => {
  const gh = () => { throw new Error('must not be called'); };
  const ghApi = () => { throw new Error('must not be called'); };
  for (const argv of [
    ['--run-id', 'r1', '--targets', '720', '--run'],
    ['--run-id', 'r1', '--targets', '720', '--run', ''],
  ]) {
    const { deps, io } = baseDeps({ ghApi, gh });
    assert.equal(run(argv, deps), 2);
    assert.equal(io.out.length, 0);
  }
});

test('--run: an appendClaimLog that throws never un-claims — claim stands, claimLogFailures names the issue, exit 0', () => {
  const { ghApi } = makeGhApi({
    reads: { 750: [readAbsent, confirmRead()] },
    writes: { 750: [writeOk] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  deps.appendClaimLog = () => { throw new Error('disk full'); };

  const code = run(['--run-id', 'r1', '--targets', '750', '--run', '/some/run/r1'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, [750]);
  assert.deepEqual(body.claimLogFailures, [{ issue: 750, error: 'disk full' }]);
  assert.match(io.err.join(''), /claim-log write failed for #750/);
});

test('without --run: the envelope carries no claimLogFailures key (existing behaviour unchanged)', () => {
  const { ghApi } = makeGhApi({
    reads: { 751: [readAbsent, confirmRead()] },
    writes: { 751: [writeOk] },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '751'], deps);

  assert.equal(code, 0);
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, [751]);
  assert.ok(!('claimLogFailures' in body), 'claimLogFailures must be absent, not merely empty, when --run was never passed');
});

// ---- #4027: --steps skip-guard (flow/claim-targets.md's "neither build nor test" condition) ----

const SKIP_GUARD_ENVELOPE = '{"claimed":[],"alreadyOwned":[],"skipped":[],"skipGuard":"no-build-or-test"}';

// Recording fakes that also throw: a skip-guard exit must reach none of them.
function recordingRefusers() {
  const calls = { ghApi: [], gh: [], gitRunner: [], appendClaimLog: [] };
  const refuse = (name) => (args) => { calls[name].push(args); throw new Error(`${name} must not be called`); };
  return { calls, ghApi: refuse('ghApi'), gh: refuse('gh'), gitRunner: refuse('gitRunner'), appendClaimLog: refuse('appendClaimLog') };
}

test('--steps review,polish,wrap-up: exit 0, skipGuard envelope, zero ghApi/gh/gitRunner calls', () => {
  const r = recordingRefusers();
  const { deps, io } = baseDeps({ ghApi: r.ghApi, gh: r.gh });
  deps.gitRunner = r.gitRunner;

  const code = run(['--run-id', 'r1', '--targets', '720,721', '--steps', 'review,polish,wrap-up'], deps);

  assert.equal(code, 0);
  assert.deepEqual(io.out, [SKIP_GUARD_ENVELOPE]);
  assert.equal(JSON.parse(io.out[0]).skipGuard, 'no-build-or-test');
  assert.deepEqual(r.calls, { ghApi: [], gh: [], gitRunner: [], appendClaimLog: [] });
});

test('--steps wrap-up with --keep-going and --run: same skip envelope, no claim-log write', () => {
  const r = recordingRefusers();
  const { deps, io } = baseDeps({ ghApi: r.ghApi, gh: r.gh });
  deps.gitRunner = r.gitRunner;
  deps.appendClaimLog = r.appendClaimLog;

  const code = run(['--run-id', 'r1', '--targets', '720', '--steps', 'wrap-up', '--keep-going', '--run', '/some/run/r1'], deps);

  assert.equal(code, 0);
  assert.deepEqual(io.out, [SKIP_GUARD_ENVELOPE]);
  assert.deepEqual(r.calls, { ghApi: [], gh: [], gitRunner: [], appendClaimLog: [] });
});

test('--steps containing build or test: the normal claim path runs', () => {
  for (const steps of ['build,test', 'test', 'build', ' review , test ']) {
    const { ghApi, calls: apiCalls } = makeGhApi({
      reads: { 720: [readAbsent, confirmRead()] },
      writes: { 720: [writeOk] },
    });
    const { gh, calls: ghCalls } = makeGh({});
    const { deps, io } = baseDeps({ ghApi, gh });

    const code = run(['--run-id', 'r1', '--targets', '720', '--steps', steps], deps);

    assert.equal(code, 0, `steps=${JSON.stringify(steps)}`);
    const body = JSON.parse(io.out[0]);
    assert.deepEqual(body.claimed, [720], `steps=${JSON.stringify(steps)}`);
    assert.ok(!('skipGuard' in body), `steps=${JSON.stringify(steps)}: a claiming run carries no skipGuard key`);
    assert.ok(apiCalls.some((a) => isWrite(a, '720')), `steps=${JSON.stringify(steps)}: claim write made`);
    assert.ok(ghCalls.some((a) => a[0] === 'repo' && a[1] === 'view'), `steps=${JSON.stringify(steps)}: gh runner called`);
  }
});

test('--steps empty, blank, bare, or with an empty part: exit 2 with usage, no gh call', () => {
  for (const argv of [
    ['--run-id', 'r1', '--targets', '720', '--steps', ''],
    ['--run-id', 'r1', '--targets', '720', '--steps', '  '],
    ['--run-id', 'r1', '--targets', '720', '--steps'],
    ['--run-id', 'r1', '--targets', '720', '--steps', 'review,,wrap-up'],
    ['--run-id', 'r1', '--targets', '720', '--steps', 'build,'],
  ]) {
    const r = recordingRefusers();
    const { deps, io } = baseDeps({ ghApi: r.ghApi, gh: r.gh });
    assert.equal(run(argv, deps), 2, `argv=${JSON.stringify(argv)}`);
    assert.equal(io.out.length, 0);
    assert.ok(io.err.join('').includes(USAGE));
    assert.deepEqual(r.calls.ghApi, []);
    assert.deepEqual(r.calls.gh, []);
  }
});

// Fix round 1: a value-less `--steps` followed by another flag, or a step
// name outside /flow's vocabulary, must fail closed (exit 2), never skip.
for (const [label, argv] of [
  ['--steps --keep-going (flag consumed as the value)', ['--run-id', 'r1', '--targets', '720', '--steps', '--keep-going']],
  ['--steps Build (wrong case)', ['--run-id', 'r1', '--targets', '720', '--steps', 'Build']],
  ['--steps biuld (typo)', ['--run-id', 'r1', '--targets', '720', '--steps', 'biuld']],
]) {
  test(`${label}: exit 2 with usage, no skipGuard envelope, no gh call`, () => {
    const r = recordingRefusers();
    const { deps, io } = baseDeps({ ghApi: r.ghApi, gh: r.gh });
    assert.equal(run(argv, deps), 2);
    assert.equal(io.out.length, 0);
    assert.ok(io.err.join('').includes(USAGE));
    assert.deepEqual(r.calls.ghApi, []);
    assert.deepEqual(r.calls.gh, []);
  });
}

test('FLOW_STEPS is /flow\'s Allowed Steps vocabulary (steps-and-gates.md), re-verify and resume-only review-console included', () => {
  assert.deepEqual([...FLOW_STEPS], ['build', 'stories', 'test', 'review', 'polish', 're-verify', 'wrap-up', 'review-console']);
});

// Fix round 2: `/flow {specs} review-console` is a valid resume invocation
// (steps-and-gates.md's "Resume-only step"), so it must skip, not hard-stop.
test('--steps review-console: exit 0, skipGuard envelope, zero gh/ghApi calls', () => {
  const r = recordingRefusers();
  const { deps, io } = baseDeps({ ghApi: r.ghApi, gh: r.gh });

  assert.equal(run(['--run-id', 'r1', '--targets', '720', '--steps', 'review-console'], deps), 0);
  assert.deepEqual(io.out, [SKIP_GUARD_ENVELOPE]);
  assert.deepEqual(r.calls.ghApi, []);
  assert.deepEqual(r.calls.gh, []);
});

test('--steps review-console beside another step: exit 2 naming the rule, no gh call (steps-and-gates.md: not valid in a list with other steps)', () => {
  for (const steps of ['review-console,wrap-up', 'build,review-console']) {
    const r = recordingRefusers();
    const { deps, io } = baseDeps({ ghApi: r.ghApi, gh: r.gh });
    assert.equal(run(['--run-id', 'r1', '--targets', '720', '--steps', steps], deps), 2, steps);
    assert.equal(io.out.length, 0);
    assert.ok(io.err.join('').includes('"review-console" is resume-only'), io.err.join(''));
    assert.deepEqual(r.calls.ghApi, []);
    assert.deepEqual(r.calls.gh, []);
  }
});

test('--steps with an unknown step: the exit-2 message names the offending entry and lists every accepted name', () => {
  const r = recordingRefusers();
  const { deps, io } = baseDeps({ ghApi: r.ghApi, gh: r.gh });

  assert.equal(run(['--run-id', 'r1', '--targets', '720', '--steps', 'review,biuld'], deps), 2);
  const err = io.err.join('');
  assert.ok(err.includes('"biuld"'), err);
  assert.ok(err.includes(`accepted: ${FLOW_STEPS.join(', ')}`), err);
});

test('every non-build/test FLOW_STEPS member is accepted by --steps (build/test: the claim-path test above)', () => {
  const r = recordingRefusers();
  const { deps, io } = baseDeps({ ghApi: r.ghApi, gh: r.gh });
  assert.equal(run(['--run-id', 'r1', '--targets', '720', '--steps', 'stories,review,polish,re-verify,wrap-up'], deps), 0);
  assert.deepEqual(io.out, [SKIP_GUARD_ENVELOPE]);
});

test('--steps never bypasses argv validation: a skip-shaped step list with malformed --targets still exits 2', () => {
  const r = recordingRefusers();
  const { deps, io } = baseDeps({ ghApi: r.ghApi, gh: r.gh });

  assert.equal(run(['--run-id', 'r1', '--targets', '0,abc', '--steps', 'wrap-up'], deps), 2);
  assert.equal(io.out.length, 0);
});

test('USAGE names the --steps flag', () => {
  assert.match(USAGE, /\[--steps <step,step,\.\.\.>\]/);
});

// ---- #4495: a remote with no claims-registry branch --------------------------
// One fake remote shared by every run in a test: `branchExists` flips true when
// a bootstrap push lands, `created` counts the pushes that actually created it.
function makeBranchlessRemote() {
  return { branchExists: false, created: 0, pushes: [] };
}

// A git-CAS runner over a `makeBranchlessRemote()`. `staleView` makes this
// runner's first claims-registry fetch fail "couldn't find remote ref" even
// when the remote already has the branch (a sibling bootstrapped meanwhile).
// `refuseBootstrapWith` makes the bootstrap push throw that text instead.
// `creationHidden` makes a successful bootstrap invisible to later fetches.
// `claimPushFailsWith` makes every non-bootstrap push throw that text (a
// transport failure, so the store falls back to the contents API).
// The bootstrap's scratch ref resolves to BOOTSTRAP_BASE_SHA, distinct from the
// claims-branch tip, so a test can tell which sha the bootstrap pushed.
const BOOTSTRAP_BASE_SHA = 'basesha0';
function makeBranchlessGitRunner(remote, {
  staleView = false, refuseBootstrapWith = null, creationHidden = false, claimPushFailsWith = null,
} = {}) {
  let staleLeft = staleView ? 1 : 0;
  let commitCounter = 0;
  const commitOwner = {};
  const BOOTSTRAP_LEASE = '--force-with-lease=refs/heads/claims-registry:';
  return (args) => {
    if (args[0] === 'fetch') {
      if (String(args[3]).startsWith('HEAD:')) return '';
      if (staleLeft > 0) { staleLeft -= 1; throw new Error("fatal: couldn't find remote ref claims-registry"); }
      if (!remote.branchExists || creationHidden) throw new Error("fatal: couldn't find remote ref claims-registry");
      return '';
    }
    if (args[0] === 'rev-parse' && args[1] !== 'FETCH_HEAD') {
      return String(args[1]).includes('claims-cas-bootstrap') ? `${BOOTSTRAP_BASE_SHA}\n` : 'tip0\n';
    }
    if (args[0] === 'update-ref' && args[1] === '-d') return '';
    if (args[0] === 'ls-remote') return remote.branchExists ? 'tip0\trefs/heads/claims-registry\n' : '';
    if (args[0] === 'show') {
      const [sha, ...pathParts] = String(args[1]).split(':');
      const targetPath = pathParts.join(':');
      const m = /issue-(\d+)\.json$/.exec(targetPath);
      if (m && commitOwner[sha] === Number(m[1])) return liveMarker('r1');
      throw new Error(`fatal: path '${targetPath}' does not exist in '${sha}'`);
    }
    if (args[0] === 'hash-object') return 'blobsha\n';
    if (args[0] === 'read-tree' || args[0] === 'update-index') return '';
    if (args[0] === 'write-tree') return 'treesha\n';
    if (args[0] === 'commit-tree') {
      commitCounter += 1;
      const commitSha = `commit-${commitCounter}`;
      const claim = /Claim issue #(\d+)/.exec(args[args.indexOf('-m') + 1]);
      if (claim) commitOwner[commitSha] = Number(claim[1]);
      return `${commitSha}\n`;
    }
    if (args[0] === 'push') {
      remote.pushes.push(args);
      if (args.includes(BOOTSTRAP_LEASE)) {
        if (refuseBootstrapWith) { const e = new Error(refuseBootstrapWith); e.stderr = refuseBootstrapWith; throw e; }
        if (remote.branchExists) {
          const e = new Error('! [rejected] HEAD -> claims-registry (stale info)');
          e.stderr = e.message;
          throw e;
        }
        remote.branchExists = true;
        remote.created += 1;
      } else if (claimPushFailsWith) {
        throw new Error(claimPushFailsWith);
      }
      return '';
    }
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
}

const bootstrapPushes = (remote) => remote.pushes.filter((a) => a.includes('--force-with-lease=refs/heads/claims-registry:'));
const refuseAllGhApi = (args) => { throw new Error(`contents-API must not be called: ${args.join(' ')}`); };

test('(bm1) branchless remote, git transport: bootstraps claims-registry from the default-branch tip, retries the target, exit 0, claim recorded', () => {
  const remote = makeBranchlessRemote();
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi: refuseAllGhApi, gh });
  const inner = makeBranchlessGitRunner(remote);
  const gitCalls = [];
  deps.gitRunner = (args) => { gitCalls.push(args); return inner(args); };

  const code = run(['--run-id', 'r1', '--targets', '720'], deps);

  assert.equal(code, 0, io.err.join(''));
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, [720]);
  assert.equal(body.transportByIssue[720], 'git');
  const boot = bootstrapPushes(remote);
  assert.equal(boot.length, 1, 'exactly one bootstrap push');
  assert.ok(gitCalls.some((a) => a[0] === 'fetch' && String(a[3]).startsWith('HEAD:')), 'the base is fetched from the remote HEAD (default branch)');
  assert.equal(boot[0][2], `${BOOTSTRAP_BASE_SHA}:refs/heads/claims-registry`, 'the branch is created at the sha the HEAD fetch resolved to');
  assert.equal(remote.pushes.length, 2, 'the bootstrap push, then the claim push');
});

// A stateful contents-API fake for a repo whose claims-registry branch is absent
// until the git/refs POST flips it. `postResponse` overrides that POST's answer
// (a refusal) and leaves the branch absent.
function makeBranchlessGhApi({ postResponse = null } = {}) {
  const state = { branch: false, blobs: {}, refPosts: 0 };
  const ok = { stdout: '{}', failure: null, status: null };
  const readIssue = (args) => (/^repos\/[^/]+\/[^/]+\/contents\/claims\/issue-(\d+)\.json\?ref=/.exec(args[0]) || [])[1];
  const writeIssue = (args) => (args[0] === '--method' && args[1] === 'PUT'
    ? (/\/contents\/claims\/issue-(\d+)\.json$/.exec(args[2]) || [])[1] : undefined);
  function ghApi(args) {
    const reading = readIssue(args);
    if (reading) {
      return state.branch && state.blobs[reading] ? readOk(state.blobs[reading], 'blob-sha') : readAbsent;
    }
    const writing = writeIssue(args);
    if (writing) {
      if (!state.branch) return readAbsent;
      state.blobs[writing] = Buffer.from(fieldOf(args, 'content'), 'base64').toString('utf8');
      return ok;
    }
    if (args[0] === `repos/${REPO}/branches/claims-registry`) {
      return state.branch ? { stdout: 'claims-registry\n', failure: null, status: null } : readAbsent;
    }
    if (args[0] === `repos/${REPO}` && args[2] === '.default_branch') return { stdout: 'main\n', failure: null, status: null };
    if (args[0] === `repos/${REPO}/git/ref/heads/main`) return { stdout: 'abc123\n', failure: null, status: null };
    if (args[0] === '--method' && args[1] === 'POST' && args[2] === `repos/${REPO}/git/refs`) {
      state.refPosts += 1;
      if (postResponse) return postResponse;
      state.branch = true;
      return ok;
    }
    throw new Error(`unexpected ghApi ${args.join(' ')}`);
  }
  return { ghApi, state };
}

test('(bm2) branchless remote, contents-API transport (no gitRunner): PUT 404 + branches 404 -> POST git/refs, retry, exit 0', () => {
  const { ghApi, state } = makeBranchlessGhApi();
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720'], deps);

  assert.equal(code, 0, io.err.join(''));
  assert.deepEqual(JSON.parse(io.out[0]).claimed, [720]);
  assert.equal(state.refPosts, 1, 'exactly one git/refs POST');
});

test('(bm3) two first claims (different records) against one branchless remote: both exit 0, exactly one branch creation wins, neither contested', () => {
  const remote = makeBranchlessRemote();
  const { gh } = makeGh({});
  const runA = baseDeps({ ghApi: refuseAllGhApi, gh });
  runA.deps.gitRunner = makeBranchlessGitRunner(remote);
  const runB = baseDeps({ ghApi: refuseAllGhApi, gh });
  runB.deps.gitRunner = makeBranchlessGitRunner(remote, { staleView: true });

  const codeA = run(['--run-id', 'r1', '--targets', '11'], runA.deps);
  const codeB = run(['--run-id', 'r1', '--targets', '12'], runB.deps);

  assert.equal(codeA, 0, runA.io.err.join(''));
  assert.equal(codeB, 0, runB.io.err.join(''));
  assert.equal(remote.created, 1, 'exactly one bootstrap creates the branch');
  assert.equal(bootstrapPushes(remote).length, 2, 'the loser still attempted its create-only push');
  assert.ok(!runA.io.out.join('').includes('contested'));
  assert.ok(!runB.io.out.join('').includes('contested'));
  assert.deepEqual(JSON.parse(runB.io.out[0]).claimed, [12]);
});

const REFUSED_SUFFIX = '— create it from the default branch\n';
const REFUSAL_PREFIX = 'claim-targets: claims-registry branch missing on origin and could not be created:';

test('AC3.1: (bm4) bootstrap refused on both legs: exit 6, stderr names the missing branch and the remedy, stdout branchMissing.reason is verbatim, never exit 3', () => {
  const remote = makeBranchlessRemote();
  const { ghApi } = makeBranchlessGhApi({
    postResponse: { stdout: null, failure: 'permission-denied', status: 403, error: 'HTTP 403: Resource not accessible by integration' },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  deps.gitRunner = makeBranchlessGitRunner(remote, { refuseBootstrapWith: 'remote: Permission to acme/w.git denied to bot.' });

  const code = run(['--run-id', 'r1', '--targets', '720'], deps);

  assert.equal(code, 6);
  const stderr = io.err.join('');
  assert.ok(stderr.includes(REFUSAL_PREFIX), stderr);
  assert.ok(stderr.endsWith(REFUSED_SUFFIX), stderr);
  const body = JSON.parse(io.out[0]);
  assert.equal(body.branchMissing.branch, 'claims-registry');
  assert.match(body.branchMissing.reason, /Permission to acme\/w\.git denied to bot\./);
  assert.match(body.branchMissing.reason, /HTTP 403: Resource not accessible by integration/);
  assert.deepEqual(body.released, []);
  assert.deepEqual(body.releaseFailed, []);
});

test('(bm4c) a refusal reason carrying line breaks, control characters and a very long body reaches stderr and the JSON as one bounded line', () => {
  const remote = makeBranchlessRemote();
  const hostile = `remote: denied\n\u001b[31mFORGED claim-targets: exit 0\u001b[0m\r\n${'x'.repeat(2000)}`;
  const { ghApi } = makeBranchlessGhApi({
    postResponse: { stdout: null, failure: 'permission-denied', status: 403, error: hostile },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  deps.gitRunner = makeBranchlessGitRunner(remote, { refuseBootstrapWith: 'remote: Permission denied.' });

  assert.equal(run(['--run-id', 'r1', '--targets', '720'], deps), 6);
  const { reason } = JSON.parse(io.out[0]).branchMissing;
  assert.doesNotMatch(reason, /[\p{Cc}]/u, 'no control characters or line breaks survive');
  assert.ok(reason.length <= 500, `bounded, got ${reason.length}`);
  assert.match(reason, /Permission denied\./, 'the leading, actionable text is still verbatim');
  const stderr = io.err.join('');
  assert.equal(stderr.trimEnd().split('\n').length, 1, 'the refusal is exactly one stderr line');
});

test('(bm4b) ruleset refusal: git push "[remote rejected] ... (push declined due to repository rule violations)", POST git/refs 422, branch still absent: exit 6, never a lost-race success and never exit 4', () => {
  const remote = makeBranchlessRemote();
  const { ghApi } = makeBranchlessGhApi({
    postResponse: {
      stdout: null, failure: null, status: 422, error: 'HTTP 422: Repository rule violations found\n\nCannot create ref due to creations being restricted.',
    },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  deps.gitRunner = makeBranchlessGitRunner(remote, {
    refuseBootstrapWith: '! [remote rejected] HEAD -> claims-registry (push declined due to repository rule violations)',
  });

  const code = run(['--run-id', 'r1', '--targets', '720'], deps);

  assert.equal(code, 6, io.err.join(''));
  assert.match(JSON.parse(io.out[0]).branchMissing.reason, /Repository rule violations found/);
});

test('(bm5) --keep-going with a refused bootstrap still exits 6', () => {
  const remote = makeBranchlessRemote();
  const { ghApi } = makeBranchlessGhApi({
    postResponse: { stdout: null, failure: 'permission-denied', status: 403, error: 'HTTP 403: Resource not accessible by integration' },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  deps.gitRunner = makeBranchlessGitRunner(remote, { refuseBootstrapWith: 'remote: Permission to acme/w.git denied to bot.' });

  const code = run(['--run-id', 'r1', '--targets', '720', '--keep-going'], deps);

  assert.equal(code, 6);
  assert.equal(JSON.parse(io.out[0]).branchMissing.branch, 'claims-registry');
});

test('(bm6) branch still missing after a successful bootstrap: one bootstrap only, transient exit 4', () => {
  const remote = makeBranchlessRemote();
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi: refuseAllGhApi, gh });
  deps.gitRunner = makeBranchlessGitRunner(remote, { creationHidden: true });

  const code = run(['--run-id', 'r1', '--targets', '720'], deps);

  assert.equal(code, 4, io.err.join(''));
  const body = JSON.parse(io.out[0]);
  assert.equal(body.transient[0].error, 'claims-branch-missing');
  assert.equal(bootstrapPushes(remote).length, 1, 'bootstrap is attempted once per run');
});

// The bm1-bm6 cases above all enter through the READ site (a gitRunner whose
// fetch reports the branch missing). These two enter through the WRITE site:
// the contents-API PUT answers 404 and the branch lookup confirms it.
const POST_OK = { stdout: '{}', failure: null, status: null };

test('(bm7) write site, contents-API only (no gitRunner): bootstrap refused -> exit 6, reason verbatim, no git leg named', () => {
  const { ghApi, state } = makeBranchlessGhApi({
    postResponse: { stdout: null, failure: 'permission-denied', status: 403, error: 'HTTP 403: Resource not accessible by integration' },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720'], deps);

  assert.equal(code, 6, io.err.join(''));
  const stderr = io.err.join('');
  assert.ok(stderr.includes(REFUSAL_PREFIX), stderr);
  assert.ok(stderr.endsWith(REFUSED_SUFFIX), stderr);
  const body = JSON.parse(io.out[0]);
  assert.equal(body.branchMissing.branch, 'claims-registry');
  assert.match(body.branchMissing.reason, /HTTP 403: Resource not accessible by integration/);
  assert.ok(!body.branchMissing.reason.includes('git:'), 'no git leg without a gitRunner');
  assert.equal(state.refPosts, 1);
});

test('(bm8) write site, second sighting after a bootstrap that reported success: one bootstrap only, transient exit 4', () => {
  // The POST reports success but the branch never appears.
  const { ghApi, state } = makeBranchlessGhApi({ postResponse: POST_OK });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720'], deps);

  assert.equal(code, 4, io.err.join(''));
  assert.equal(JSON.parse(io.out[0]).transient[0].error, 'claims-branch-missing');
  assert.equal(state.refPosts, 1, 'bootstrap is attempted once per run');
});

test('(bm8b) write site, bootstrap POST hits a secondary rate limit: transient exit 4, never the exit-6 refusal', () => {
  const { ghApi, state } = makeBranchlessGhApi({
    postResponse: { stdout: null, failure: 'secondary-rate-limit', status: 403, error: 'HTTP 403: You have exceeded a secondary rate limit' },
  });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--run-id', 'r1', '--targets', '720'], deps);

  assert.equal(code, 4, io.err.join(''));
  assert.equal(JSON.parse(io.out[0]).transient[0].error, 'claims-branch-bootstrap-rate-limited');
  assert.ok(!io.err.join('').includes(REFUSAL_PREFIX), 'no exit-6 stderr line');
  assert.equal(state.refPosts, 1, 'bootstrap is attempted once per run');
});

test('(bm9) write-site second sighting under --keep-going discards the git tip chain: the next target fetches fresh', () => {
  // Target 720: the git read says the branch is missing -> git bootstrap -> the
  // retried git read succeeds (tip0, which is chainable) -> the git claim push
  // fails at the transport -> contents-API fallback: PUT 404 and the branch
  // lookup 404 -> a second sighting, skipped. Target 721 must NOT inherit
  // 720's tip0: a stale chain would read 721 against it with no fetch.
  const remote = makeBranchlessRemote();
  const { ghApi } = makeBranchlessGhApi({ postResponse: POST_OK });
  const { gh } = makeGh({});
  const { deps, io } = baseDeps({ ghApi, gh });
  const inner = makeBranchlessGitRunner(remote, { claimPushFailsWith: 'fatal: unable to access the remote' });
  const claimsFetches = [];
  deps.gitRunner = (args) => {
    if (args[0] === 'fetch' && !String(args[3]).startsWith('HEAD:')) claimsFetches.push(args);
    return inner(args);
  };

  const code = run(['--run-id', 'r1', '--targets', '720,721', '--keep-going'], deps);

  assert.equal(code, 0, io.err.join(''));
  const body = JSON.parse(io.out[0]);
  assert.deepEqual(body.claimed, []);
  assert.deepEqual(body.skipped, [
    { issue: 720, reason: 'transient', error: 'claims-branch-missing' },
    { issue: 721, reason: 'transient', error: 'claims-branch-missing' },
  ]);
  assert.equal(bootstrapPushes(remote).length, 1, 'bootstrap is attempted once per run');
  assert.equal(claimsFetches.length, 3, '720 fetches twice (missing, then after the bootstrap); 721 fetches fresh instead of reusing 720\'s tip');
});
