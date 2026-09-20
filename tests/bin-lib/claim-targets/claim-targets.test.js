// tests/bin-lib/claim-targets/claim-targets.test.js
// Fake ghApi (claim-store contract: never throws, returns {stdout,failure,status})
// and fake gh (generic-runner contract: throws on failure, returns stdout) per
// the gh-api-module-pattern skill — never real `gh`. Record calls inside the
// fakes, assert after `run()` returns.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  run, BOT_IN_PROGRESS, ABORT_REASON,
} = require('../../../plugin/bin/lib/claim-targets/claim-targets');
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
  repoSlug = REPO, labelExists = false, fail = {}, prState = null,
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
      ghApi, gh, now: () => NOW, stdout: io.stdout, stderr: io.stderr, hostname, sessionId,
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

test('(m4) #2073: one target unverified, a second already confirmed-claimed -> abort releases only the confirmed one', () => {
  const { ghApi, calls } = makeGhApi({
    // 720 claims and verifies cleanly FIRST; 721's write "succeeds" but its
    // read-back never confirms it, triggering the default all-or-abort.
    reads: {
      720: [readAbsent, confirmRead(), readOk('irrelevant', 'sha720-release')], // 2nd = its own verification, 3rd = release's fresh read
      721: [readAbsent], // read-back repeats the same (still-absent) entry
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
  assert.equal(calls.filter((a) => isWrite(a, '721')).length, 1, '721 itself is never tombstoned (no second write) — its write outcome is genuinely unknown, not a confirmed claim to release');
  assert.ok(ghCalls.some((a) => a[0] === 'issue' && a[1] === 'edit' && a[2] === '720' && a.includes('--remove-label')));
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

test('--help short-circuits before any gh call, exit 0', () => {
  const gh = () => { throw new Error('must not be called'); };
  const ghApi = () => { throw new Error('must not be called'); };
  const { deps, io } = baseDeps({ ghApi, gh });

  const code = run(['--help'], deps);

  assert.equal(code, 0);
  assert.ok(io.out[0].includes('usage:'));
});
