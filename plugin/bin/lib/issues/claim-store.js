// bin/lib/issues/claim-store.js
// The one write-path implementation for the claims-registry blob store
// (`claims/issue-{n}.json` on `CLAIMS_BRANCH` — see `_shared/issue-claims.md`
// "The lock"). `readClaimBlob`/`writeClaimBlob` try a **git compare-and-swap**
// first (`./claims-git-cas.js` — fetch the branch tip, commit the blob on
// it, push with `--force-with-lease`), falling back to the contents-API PUT
// implementation below only when git-CAS fails for a transport reason (no
// git push credential — an MCP-only sandbox, for instance) or a secondary
// rate limit (#787's amendment: the contents-API claim writes were the
// fleet's most-contended endpoint; git-protocol operations cost zero API
// budget). Both the claim-side preflight CLI and
// `bin/lib/reconcile/release-merged.js`'s release path delegate their I/O
// here so there is exactly one code path performing this keyspace's writes,
// instead of multiple implementations drifting apart.
//
// The `deps.ghApi` seam is injectable (never real `gh` in tests):
// `ghApi(args)` is invoked as if `gh api ${args.join(' ')}` and returns a
// non-throwing `{stdout, failure, status}` — the same object shape
// release-merged.js's own (pre-extraction) ghApi already used, extended
// with `status` so a 404 can be told apart from a genuine failure.
// `defaultGhApi` below is the real implementation; release-merged.js keeps
// supplying its own ghApi (which never sets `status`) and no `gitRunner`,
// so `readClaimBlob`'s `absent` branch simply never fires there and it stays
// on the contents-API-only path deliberately — see release-merged.js's
// delegation comments for why that is exactly the pre-extraction behavior,
// unchanged. `deps.gitRunner` is optional — omitted, both functions skip
// straight to the contents-API path (the gh-absent/MCP fallback seam).
//
// `writeClaimBlob` also guards content shape (#821): a batch/multi-record
// caller whose payload computation goes wrong (e.g. an array index or lookup
// that silently evaluates to `undefined` for one record while the loop keeps
// going for the others) can otherwise write the literal string "undefined" —
// `JSON.stringify(undefined)` returns the JS value `undefined`, not a string,
// and coerces to that literal the moment it's concatenated or templated —
// into `claims/issue-{n}.json` instead of throwing. Being the one write path
// every caller shares (tests/claims-single-write-path.test.js) is what makes
// a single guard here effective against every caller, present and future,
// rather than chasing the defect at each call site individually.
'use strict';

const { execFileSync } = require('child_process');
const { CLAIMS_BRANCH } = require('./claims');
const { readClaimBlobGit, writeClaimBlobGit } = require('./claims-git-cas');
const { GH_TIMEOUT_MS, escapeRegExp } = require('../shared-primitives');

// How many times `writeClaimBlob` re-leases and re-pushes a git-CAS write
// whose rejection a fresh read proves spurious (#787 final-review finding I1 —
// see that function). Bounded: an unbounded retry against a busy
// `claims-registry` branch would spin, and a rejection that stays spurious
// across every attempt is itself a transient condition, not a contest.
const MAX_CAS_ATTEMPTS = 3;
// Randomized, increasing backoff between git-CAS retry attempts — same
// rationale as health-core/durable-state.js's casBackoffMs (a proven-spurious
// rejection is exactly as likely to collide again on an immediate retry with
// no de-synchronization from other writers on the same busy branch tip).
const CAS_BACKOFF_BASE_MS = 100;
const CAS_BACKOFF_JITTER_MS = 100;

function casBackoffMs(attempt) {
  return attempt * CAS_BACKOFF_BASE_MS + Math.random() * CAS_BACKOFF_JITTER_MS;
}

// Synchronous sleep (matches this module's execFileSync-based style).
// Injectable via deps.sleep so tests substitute a fake instead of blocking.
function defaultSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function claimPath(issueNumber) {
  return `claims/issue-${issueNumber}.json`;
}

// (#821) Guards every write against the exact defect class a batch/multi-record
// claim-acquisition path can produce: a value that evaluates to `undefined`
// before `JSON.stringify` — which itself returns the actual JS `undefined`,
// not a string, for an `undefined` argument — and is then coerced to the
// literal 9-character string "undefined" the instant it's concatenated or
// templated (`` `${undefined}` `` === `'undefined'`) rather than throwing.
// Fails closed: content that is not a non-empty string, or does not parse as
// a plain JSON object (not an array, not `null`), is never well-formed claim
// content — `writeClaimBlob` below refuses it before either transport is ever
// attempted, so the malformed value never reaches `claims-registry` as a
// commit or a contents-API PUT.
function isWellFormedClaimContent(content) {
  if (typeof content !== 'string' || content === '') return false;
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return false;
  }
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
}

// Pure: classify a caught execFileSync error into {failure, status} — split
// out from defaultGhApi's catch block so the text-matching regexes below are
// unit-testable without touching the real `gh` binary. `defaultGhApi` is the
// only caller.
//
// `_shared/issue-claims.md`'s "The lock" step 1 documents a 404 as a normal
// outcome ("file does not exist"), not an error — gh reports it as
// `gh: Not Found (HTTP 404)` on stderr, so a thrown error whose text
// contains "HTTP 404" or "Not Found" is reported as `{status: 404,
// failure: null}` rather than folded into `network-failure`.
//
// A 422 is the other non-error rejection a claim write can hit: a lost race
// on a create-only write (someone else's landed first) or a sha-mismatch on
// a conditional write. Live-confirmed GitHub wording for the create-race
// case (gh-api-module-pattern skill): `Validation failed: Target issue has
// already been taken`. Accept the HTTP status text ("HTTP 422"), the reason
// phrase ("Unprocessable"), and the observed body text ("Validation
// failed") — any one of the three still classifies as a write-conflict
// (`status: 422`) rather than falling through to a generic
// `network-failure`, which is what `writeClaimBlob` uses to tell a lost
// race apart from a real transient failure (see that function).
//
// A 409 is the Contents API's own rejection for a conditional-write sha
// mismatch — the RECLAIM-path equivalent of the 422 create-race above (a
// stale/tombstone target someone else re-claimed between this read and this
// write). Symmetric with the 422 block: accept the HTTP status text ("HTTP
// 409"), the reason phrase ("Conflict"), or the sha-mismatch body wording
// ("does not match") — any one classifies as `status: 409`, the same
// write-conflict signal `writeClaimBlob` folds into `conflict: true`.
// Without this branch a lost reclaim race fell through to
// `network-failure`, routing `bin/claim-targets.js` to transient (exit 4)
// instead of contested (exit 3) — #723.
//
// ENOENT (no `gh` binary) is reported separately as `gh-absent` so a
// preflight CLI can name the real fallback instead of a generic failure.
//
// A secondary/abuse rate limit (403 + "secondary rate limit" text, an abuse
// detection mechanism message, or a `Retry-After` header) is checked first,
// before every other branch — it must never be misread as a contest or a
// generic network failure (record-697's incident read exactly that way
// before diagnosis; #787's amendment requires this to classify as its own
// distinct, transient outcome).
function classifyGhApiError(e) {
  if (e && e.code === 'ENOENT') return { failure: 'gh-absent', status: null };
  const text = [e && e.message, e && e.stderr, e && e.stdout].filter(Boolean).map(String).join(' ');
  if (/secondary rate limit|abuse detection mechanism|Retry-After/i.test(text)) return { failure: 'secondary-rate-limit', status: 403 };
  if (/HTTP 404|Not Found/.test(text)) return { failure: null, status: 404 };
  if (/HTTP 422|Unprocessable|Validation failed/.test(text)) return { failure: null, status: 422 };
  if (/HTTP 409|Conflict|does not match/i.test(text)) return { failure: null, status: 409 };
  return { failure: 'network-failure', status: null };
}

// The real ghApi.
function defaultGhApi(args) {
  try {
    const stdout = execFileSync('gh', ['api', ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS,
      windowsHide: true,
    });
    return { stdout, failure: null, status: null };
  } catch (e) {
    const { failure, status } = classifyGhApiError(e);
    return { stdout: null, failure, status };
  }
}

// (ghApi, repoSlug) -> { entries: [{name, sha}], failure: null|'gh-absent'|'network-failure' }
// One Contents-API directory listing — the SAME single call this module
// already made — extended to keep each entry's `sha` (previously discarded
// by `-q .[].name`) instead of adding a second Git Trees API call (#820,
// D6). `claims/` is flat and single-level, so the directory listing already
// carries everything a Trees API call would add.
function listClaimEntries(ghApi, repoSlug) {
  const r = ghApi([`repos/${repoSlug}/contents/claims?ref=${CLAIMS_BRANCH}`, '-q', '[.[] | {name, sha}]']);
  if (r.failure) return { entries: [], failure: r.failure };
  try {
    const parsed = JSON.parse(r.stdout || '[]');
    return { entries: Array.isArray(parsed) ? parsed : [], failure: null };
  } catch {
    return { entries: [], failure: 'network-failure' };
  }
}

// Thin wrapper — the only pre-existing consumer (release-merged.js) is
// migrating to listClaimEntries in the same change (see that module), but
// kept exported as-is rather than removed, since a bare rename with no
// remaining caller to prove it is unnecessary churn.
function listClaimNames(ghApi, repoSlug) {
  const { entries, failure } = listClaimEntries(ghApi, repoSlug);
  return { names: entries.map((e) => e.name), failure };
}

// (deps: {ghApi, gitRunner?}, repoSlug, issueNumber, knownTip?) -> { content, sha, failure, absent, via? }
// Tries git-CAS first (no `gitRunner` dep = skip straight to contents-API,
// the gh-absent/MCP-only-sandbox seam #787's amendment requires — see
// `_shared/issue-claims.md`). A git-CAS transport failure (auth, no remote
// access) falls back to contents-API silently — the documented degrade, not
// an error. `sha` doubles as the git-CAS tip sha (a **commit** sha) when this
// read came from git, and is the blob sha when it came from the contents API —
// two different shapes, only distinguishable by which transport produced them.
// `writeClaimBlob` takes it as a compare-and-swap lease for whichever
// transport it tries FIRST, and never carries it across a transport fallback
// (see that function — a git-tip sha is not a valid contents-API `sha`).
// `absent: true` (with `failure: null`) also fires on the contents-API path
// only when the ghApi dep sets `status: 404` — a caller whose ghApi never
// sets `status` (release-merged's own, pre-extraction) simply never sees
// `absent: true` there; every failure still lands as
// `gh-absent`/`network-failure`, exactly as before this extraction.
//
// `knownTip` (#1467) is an optional pre-known git-CAS branch tip, forwarded
// verbatim to `readClaimBlobGit` — see that function's own doc comment for
// why trusting a caller-supplied tip here is safe. Every existing caller
// omits it (defaults to `null`, i.e. "fetch fresh") and is unaffected.
// `via: 'git'` is set ONLY on a genuine git-CAS success, so a batch caller
// (`bin/lib/claim-targets/claim-targets.js`) can tell a chainable git tip
// (`sha` is a commit sha) apart from a contents-API blob sha — which is
// never chainable and must never carry a `via` key, to avoid changing the
// shape of the plain contents-API-only path any existing caller already
// depends on.
function readClaimBlob(deps, repoSlug, issueNumber, knownTip = null) {
  if (deps.gitRunner) {
    const gitResult = readClaimBlobGit({ issueNumber, runner: deps.gitRunner, knownTip });
    if (gitResult.failure === null) {
      return {
        content: gitResult.content, sha: gitResult.tipSha, failure: null, absent: gitResult.absent, via: 'git',
      };
    }
    // fall through to contents-API on a git-side transport failure
  }
  return readClaimBlobContentsApi(deps.ghApi, repoSlug, issueNumber);
}

// (ghApi, repoSlug, issueNumber) -> { content, sha, failure, absent }
// The contents-API half of `readClaimBlob`, split out so `writeClaimBlob`'s
// transport-fallback path can re-derive a contents-API-shaped blob sha
// without re-entering the git-CAS branch. Same return shape (and same single
// `gh api` call) `readClaimBlob` has always produced on this path — a pure
// extraction, no behavior change.
function readClaimBlobContentsApi(ghApi, repoSlug, issueNumber) {
  const r = ghApi([`repos/${repoSlug}/contents/${claimPath(issueNumber)}?ref=${CLAIMS_BRANCH}`, '-q', '{content: (.content | @base64d), sha: .sha}']);
  if (r.status === 404) return { content: null, sha: null, failure: null, absent: true };
  if (r.failure) return { content: null, sha: null, failure: r.failure, absent: false };
  try {
    const parsed = JSON.parse(r.stdout);
    return { content: parsed.content, sha: parsed.sha, failure: null, absent: false };
  } catch {
    return { content: null, sha: null, failure: 'network-failure', absent: false };
  }
}

// (deps: {ghApi, gitRunner?}, repoSlug, issueNumber,
//  {content, sha, createOnly, expectedContent, message})
// -> { ok, conflict?, secondaryRateLimit?, failure }
//
// `expectedContent` is the blob content the decision to make THIS write was
// based on — the `content` the caller's own preceding read returned (`null`/
// omitted for a `createOnly` write, which has no prior content to compare
// against). It is the fix for the two final-review findings on #787, which
// share one root cause — trusting a lease that was re-derived AFTER the write
// decision was made:
//
//   * **C1 (lost update).** The contents-API fallback below used to re-derive
//     a fresh blob sha and write with it unconditionally. If another agent's
//     claim landed while the git-CAS attempt was failing, that write silently
//     clobbered it — a double-claim. The fallback now compares the fresh read
//     against `expectedContent` and reports a genuine contest instead.
//   * **I1 (spurious contest).** `writeClaimBlobGit`'s `--force-with-lease` is
//     leased on the whole `claims-registry` branch tip, not on this claim's
//     file, so ANY concurrent commit to the registry — including one claiming
//     an unrelated issue — rejects the push. Every caller treats a rejection
//     as a per-file contest (aborting a whole group claim, or stranding a live
//     claim whose label the rollback already stripped). A rejection now
//     triggers a fresh git read: content actually changed = a genuine contest,
//     reported as before; content unchanged = unrelated branch activity, so
//     the write retries on the fresh tip, up to `MAX_CAS_ATTEMPTS`. Still
//     spurious on the last attempt = `transport-failure` (transient — the
//     branch is too busy to land on), never a manufactured contest.
//
// Both verifications live strictly inside the `deps.gitRunner && sha` block.
// A caller with no `gitRunner` (or no `sha` lease) — `release-merged.js`'s
// contents-API-only path — reaches the PUT below exactly as it always did:
// no fresh read, and `expectedContent` neither needed nor consulted.
//
// `sha` here is the compare-and-swap lease for the transport tried FIRST —
// the git-CAS branch tip (a **commit** sha) when the preceding read went
// through git, the contents-API blob sha otherwise. The two shapes are never
// interchangeable, so a lease is NEVER carried across a transport fallback:
// handing a git tip sha to the contents API's `-f sha=` would be rejected as
// a 409/422 and misreport a transient git-side failure as a contest — the
// exact secondary-rate-limit-read-as-contested regression #787's amendment
// exists to prevent (record-697). On fallback this re-reads the blob through
// the contents API (`readClaimBlobContentsApi`) to derive a correctly-shaped
// lease AND to verify the content is still what this write's decision was
// based on (C1 above); a failure there returns that failure (never a spurious
// contest), and a now-absent or now-different target IS a genuine contest (the
// claim was released, broken, or re-taken since the git read).
//
// git-CAS is attempted whenever both a `gitRunner` dep AND a `sha` lease are
// present — including a create-only write (`createOnly: true`), which is the
// fleet's most-contended write and the whole reason for moving off the
// contents API: adding a new `claims/issue-{n}.json` is still a commit built
// on the current tip and protected by the same `--force-with-lease`, so the
// tip sha is a valid lease for it. `createOnly` only changes the fallback
// behavior: no fresh read (there is no existing blob to re-derive a sha
// from) and never a `-f sha=` argument on the PUT, so a create-only write
// keeps its create-vs-clobber semantics on either transport; its own
// post-rejection verification is `absent` vs not-absent rather than a content
// comparison, since a create-only write's premise is exactly "nothing is
// there". A git-CAS contest, once a fresh read confirms it is genuine, is
// reported as-is (never silently retried against contents-API — that would
// race the same write twice under two different concurrency mechanisms). A
// git-CAS secondary-rate-limit or transport-failure falls back to
// contents-API once.
//
// `sha` included in the contents-API fallback only when provided and this is
// not a create-only write: omitted = create-only (PUT rejects if the path
// already exists), present = conditional-update (must match the blob's
// current sha) — the create-vs-reclaim split `_shared/issue-claims.md`'s
// "The lock" steps 3-4 document. A `status: 422` or `status: 409` response (see
// `classifyGhApiError`) is a genuine write-conflict — someone else's
// create-only write landed first (422), or a conditional write's sha no
// longer matches because someone else's reclaim landed first (409) — and
// must resolve `ok: false` on its own, not fall through to the generic
// `status !== 404` formula below (422 / 409 !== 404 would otherwise read as
// success). Callers distinguish this from a transient `ghApi` failure via
// `conflict: true` vs a non-null `failure` — `_shared/issue-claims.md`'s
// "the lock" step 3: "a rejection on either transport is contested — same
// handling as `'live'`, not a retry." A consumer supplying its own `ghApi`
// that never sets `status` (e.g. `release-merged.js`) never sees
// `status === 422` or `status === 409` here, so its `ok` computation is
// unchanged by this branch — see that module's delegation comments.
function writeClaimBlob(deps, repoSlug, issueNumber, {
  content, sha, createOnly = false, expectedContent, message,
}) {
  // #821: reject a malformed `content` before either transport is ever
  // attempted — this is the one code path every claim/release writer shares
  // (tests/claims-single-write-path.test.js), so a guard here covers every
  // caller, present and future, regardless of which one computed the bad
  // value. Never classified as `conflict`/`secondaryRateLimit` — a caller bug
  // must surface distinctly, not be retried as if it were contention.
  if (!isWellFormedClaimContent(content)) {
    return { ok: false, failure: 'invalid-content' };
  }
  if (deps.gitRunner && sha) {
    let leaseSha = sha;
    for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt += 1) {
      const gitResult = writeClaimBlobGit({
        issueNumber, content, message, expectedTipSha: leaseSha, runner: deps.gitRunner,
      });
      if (gitResult.ok) return gitResult;
      if (!gitResult.conflict) break; // transport-failure or secondaryRateLimit -> contents-API fallback below
      // A rejected push could mean THIS claim genuinely changed, or that an
      // unrelated commit moved the branch tip (#787 final-review finding I1
      // — the lease is branch-wide, not per-file). Disambiguate with a
      // fresh git read before deciding.
      const freshGit = readClaimBlobGit({ issueNumber, runner: deps.gitRunner });
      if (freshGit.failure) return { ok: false, failure: 'transport-failure' };
      const unchanged = createOnly
        ? freshGit.absent
        : (!freshGit.absent && freshGit.content === expectedContent);
      if (!unchanged) return { ok: false, conflict: true, failure: null }; // genuine contest
      if (attempt === MAX_CAS_ATTEMPTS) break; // proven spurious every time, but couldn't land the CAS on git — fall through to the contents-API fallback below instead of reporting a bare transient failure
      leaseSha = freshGit.tipSha; // unrelated activity — retry with the fresh lease
      (deps.sleep || defaultSleep)(casBackoffMs(attempt));
    }
    // Fell through from a non-conflict git failure (transport-failure or
    // secondaryRateLimit). NEVER reuse the git tip sha as a contents-API
    // lease (wrong shape). NEVER write blind with a freshly re-derived lease
    // either (#787 final-review finding C1 — that was a lost-update: the
    // fresh lease is valid for SOME write, but not necessarily the one this
    // caller decided to make). Verify content before proceeding. A create-only
    // write skips this — it sends no sha at all, so there is nothing to
    // re-derive.
    if (!createOnly) {
      const fresh = readClaimBlobContentsApi(deps.ghApi, repoSlug, issueNumber);
      if (fresh.failure) return { ok: false, failure: fresh.failure };
      // This write's own target content is already the live blob — an
      // earlier git-CAS push landed server-side but its local ack was lost
      // to the transport failure that brought us here. Report the success
      // that already happened instead of a contest against ourselves.
      if (!fresh.absent && fresh.content === content) return { ok: true, failure: null };
      if (fresh.absent || fresh.content !== expectedContent) return { ok: false, conflict: true, failure: null };
      sha = fresh.sha;
    }
  }
  const encoded = Buffer.from(content, 'utf8').toString('base64');
  const args = [
    '--method', 'PUT', `repos/${repoSlug}/contents/${claimPath(issueNumber)}`,
    '-f', `message=${message}`,
    '-f', `content=${encoded}`,
    '-f', `branch=${CLAIMS_BRANCH}`,
  ];
  if (!createOnly && sha) args.push('-f', `sha=${sha}`);
  const r = deps.ghApi(args);
  if (r.failure === 'secondary-rate-limit') return { ok: false, secondaryRateLimit: true, failure: null };
  // A 404 on the PUT joins 422/409 here — release.js's own header comment
  // has always documented all three as "not by itself evidence of
  // already-released" (a 404 there reads as "already swept", but per that
  // same comment still needs the caller's re-verification before believing
  // it) — this is what makes that documented contract actually hold: without
  // it, a caller whose ghApi never sets `status` (release-merged.js) is
  // unaffected (this branch can't fire for it), but one that does — a PUT
  // rejected 404 — used to fall to the generic `{ok:false, failure:null}`
  // below with no `conflict` flag, silently skipping the exact
  // re-verification the header comment already promises.
  if (r.status === 422 || r.status === 409 || r.status === 404) {
    // Same self-write check as the pre-PUT fallback above, for the paths
    // that reach the PUT directly (createOnly skips that block entirely,
    // and a plain contents-API-only caller with no gitRunner either) — a
    // rejection here can mean this exact write already landed via an
    // earlier attempt whose local ack was lost, not a real contest.
    const fresh = readClaimBlobContentsApi(deps.ghApi, repoSlug, issueNumber);
    if (!fresh.failure && !fresh.absent && fresh.content === content) return { ok: true, failure: null };
    return { ok: false, conflict: true, failure: null };
  }
  return { ok: r.failure === null, failure: r.failure };
}

function isSameRepoPrUrl(link, owner, repo) {
  if (typeof link !== 'string') return false;
  if (typeof owner !== 'string' || !owner || typeof repo !== 'string' || !repo) return false;
  const re = new RegExp(`^https://github\\.com/${escapeRegExp(owner)}/${escapeRegExp(repo)}/pull/\\d+$`);
  return re.test(link);
}

// content: the raw tombstone blob text just read. gh: the generic throwing
// gh runner (NOT ghApi — this needs `gh pr view`, not a contents-API call).
// owner/repo: the SAME owner/repo as the issue being claimed. Moved here
// verbatim from the now-retired claim-engine.js (#787 consolidation) — see
// `_shared/issue-claims.md`'s "in-flight detection" section for the full
// #315 rationale: a `pr-opened:` tombstone whose linked PR is still open
// means a build already completed and is awaiting merge, so reclaiming here
// would race that open PR. `link` is untrusted (any session with
// registry-branch write access can set it), so this validates it — a
// well-formed `https://github.com/{owner}/{repo}/pull/{number}` URL for the
// SAME owner/repo as the issue being claimed — before ever calling `gh`.
function tombstoneInFlightPr(content, gh, owner, repo) {
  try {
    const parsed = JSON.parse(content);
    const reason = parsed && parsed.reason;
    const link = parsed && parsed.link;
    if (typeof reason !== 'string' || !reason.startsWith('pr-opened:')) return null;
    if (!isSameRepoPrUrl(link, owner, repo)) return null;
    const state = gh(['pr', 'view', link, '--json', 'state', '--jq', '.state']).trim();
    return state === 'OPEN' ? { link } : null;
  } catch {
    return null; // fail open — a broken check must never block a legitimate reclaim
  }
}

module.exports = {
  listClaimEntries,
  listClaimNames,
  readClaimBlob,
  writeClaimBlob,
  defaultGhApi,
  claimPath,
  classifyGhApiError,
  tombstoneInFlightPr,
  isSameRepoPrUrl,
  casBackoffMs,
  defaultSleep,
  isWellFormedClaimContent,
};
