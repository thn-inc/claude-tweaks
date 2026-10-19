// bin/lib/reconcile/release-merged.js — convergence check 3: release claims
// and remove the `bot:in-progress` label when the run's PR merged AND closes
// the claimed issue (a closing reference or a merge-commit closing keyword) or
// the issue itself is closed; a merged PR that does not close it keeps the
// claim until the issue closes or the TTL lapses (#3412). Iterates the
// open claim blobs themselves — `claims/issue-{n}.json` names its issue
// number and `runId`, and `runId` -> this repo's own run-state.json -> branch
// -> PR state IS the branch<->issue join, no naming convention needed (see
// `_shared/issue-claims.md`). Re-derives from claim/run state independently
// every pass, so a partial or interrupted reconcile costs nothing — the next
// pass picks up exactly where this one left off.
'use strict';
const path = require('path');
const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');
const { runGit, repoSlugOf } = require('../hooks/git-exec');
const { parseWorktreeList } = require('../hooks/worktree-reap');
const { readRunState } = require('../hooks/context');
const { fallbackBranch } = require('../hooks/run-integrity');
const { classifyClaimBlob, releasePayload } = require('../issues/claims');
const claimStore = require('../issues/claim-store');
const { resolvePrStateAsync, resolvePrStateByNumberAsync } = require('./pr-state');
const { writeTombstone: writeTombstoneShared, GRANT_LABELS } = require('../release-claim/release');
const { resolveTarget, appendEntry, formatEntry } = require('../log-decision/append');
const { readCache, writeCache } = require('./cache');
const { runWithConcurrency } = require('./gh-pool');
const { CLOSING_KEYWORD_ALTERNATION } = require('../issue-branch-tracking');
const { GH_TIMEOUT_MS, runClassified, runClassifiedAsync } = require('../shared-primitives');

const execFileAsync = promisify(execFile);

// Does a MERGED PR actually close issue `issueNumber` in `repoSlug`? Pure.
// Signals: the PR's `closingIssuesReferences` (matched on number AND
// `owner/name`, case-insensitively as GitHub names are, so a cross-repo
// reference never counts), or a closing-keyword line in the merge commit
// message (the squash/merge body GitHub reads).
//   true      — a closing reference or a closing-keyword line names the issue
//   false     — the references array is present and neither signal matches
//   undefined — no references array (field unavailable): "unknown", never
//               "does not close" and never "closes" — the commit message is
//               not consulted, since without the array the verdict must fail
//               closed (#3412, AC4)
// The regex carries the `g` flag, so iterate `matchAll` — never `.test()` on
// the shared instance, whose stale `lastIndex` would make results order-dependent.
// Whitespace is `[ \t]`, never `\s`: under `/m` `\s` crosses newlines, which is
// quadratic on blank-line runs and lets `Fixes\n#N` match.
// Only the keyword SET is shared with issue-branch-tracking.js's
// ISSUE_REF_SOURCE (CLOSING_KEYWORD_ALTERNATION); the grammar around it
// deliberately differs: line-anchored `^[ \t]*` (the squash body carries one
// `Fixes #n` line per record), an optional `:`, and `[ \t]+` instead of `\s+`.
const CLOSING_KEYWORD_RE = new RegExp('^[ \\t]*' + CLOSING_KEYWORD_ALTERNATION + ':?[ \\t]+#(\\d+)\\b', 'gim');

function prClosesIssue(prState, issueNumber, repoSlug, mergeCommitMessage) {
  if (!prState || !Array.isArray(prState.closingIssuesReferences)) return undefined;
  const slug = String(repoSlug).toLowerCase();
  const referencesIssue = prState.closingIssuesReferences.some((entry) => {
    const owner = entry && entry.repository && entry.repository.owner;
    return Boolean(owner) && Number(entry.number) === issueNumber
      && `${owner.login}/${entry.repository.name}`.toLowerCase() === slug;
  });
  if (referencesIssue) return true;
  if (typeof mergeCommitMessage === 'string') {
    for (const m of mergeCommitMessage.matchAll(CLOSING_KEYWORD_RE)) {
      if (Number(m[1]) === issueNumber) return true;
    }
  }
  return false;
}

// One claim's classified state + the branch's PR state (+ optionally the
// issue's own state and whether a merged PR closes the issue) -> what to do.
// Pure — no I/O — so the whole decision table is unit-testable without a real
// gh call. `classifiedState` is `classifyClaimBlob(content, now).state`.
// `issueState` is `'OPEN' | 'CLOSED' | undefined`. `closesIssue` is
// `prClosesIssue`'s `true | false | undefined` for a MERGED PR.
//   MERGED + closesIssue true        -> release (merged evidence)
//   MERGED + issue CLOSED            -> release issue-closed — a closed record
//                                       cannot legitimately still be in progress
//   MERGED + closesIssue false       -> skip pr-merged-not-closing
//   MERGED + closesIssue undefined   -> skip pr-merged-closing-unknown
// A merged PR is release evidence only when it closes THIS issue: a PR that
// merely touches the branch's work (a sibling, a partial) leaves the record
// open, and unknown closing data fails closed — never "does not close" and
// never "closes" (#3412). When the PR join alone can't release (no-pr or
// pr-closed-unmerged), a closed issue is likewise independent release evidence.
//   { action: 'release', reason } | { action: 'skip', reason }
function decideRelease(classifiedState, prState, issueState, closesIssue) {
  if (classifiedState !== 'live' && classifiedState !== 'stale') {
    return { action: 'skip', reason: classifiedState }; // absent/tombstone/unreadable — nothing to release
  }
  if (prState === 'gh-absent') return { action: 'skip', reason: 'gh-absent' };
  if (prState === 'network-failure') return { action: 'skip', reason: 'network-failure' };
  if (prState === 'invalid-arguments') return { action: 'skip', reason: 'invalid-arguments' };
  if (prState && prState.state === 'MERGED') {
    if (closesIssue === true) return { action: 'release', reason: `merged: reconciled from PR #${prState.number}` };
    if (issueState === 'CLOSED') return { action: 'release', reason: 'issue-closed' };
    return { action: 'skip', reason: closesIssue === false ? 'pr-merged-not-closing' : 'pr-merged-closing-unknown' };
  }
  if (prState && prState.state === 'OPEN') {
    return { action: 'skip', reason: 'pr-open' }; // open PR means work may be landing — issue-closed evidence never overrides
  }
  // Join yielded no-pr (null) or pr-closed-unmerged: issue-closed evidence applies.
  // A closed record cannot legitimately be in progress, whatever the close reason.
  if (issueState === 'CLOSED') {
    return { action: 'release', reason: 'issue-closed' }; // caller appends ": reconciled from #{n}" — the blob's own issue number is not in this signature
  }
  return { action: 'skip', reason: prState ? 'pr-closed-unmerged' : 'no-pr' };
}

// The joins `decideRelease` cannot settle from PR evidence alone — no PR at
// all, a PR closed unmerged, or a MERGED PR not confirmed to close the issue
// (`closesIssue` false or unknown: the issue's own state is the only remaining
// release evidence, #3412). Everything else (OPEN, MERGED + closesIssue true,
// gh-absent, network-failure) is decided without an issue lookup, so this is
// what gates the extra gh api call at the call site.
function needsIssueEvidence(prState, closesIssue) {
  if (prState === null) return true;
  if (typeof prState !== 'object') return false;
  if (prState.state === 'CLOSED') return true;
  return prState.state === 'MERGED' && closesIssue !== true;
}

// Shared by both Phase 1.5 pools — the by-number pool and the branch pool
// (#3416): pairs each item's issueNumber with its runWithConcurrency result,
// mapping a rejected probe (an Error instance) to the same 'network-failure'
// string every other resolver in this module uses for a transport failure.
function resultsByIssue(items, results) {
  return new Map(items.map((c, i) => [c.issueNumber, results[i] instanceof Error ? 'network-failure' : results[i]]));
}

// Pure: a claim listing entry + the cached sha last seen for that issue ->
// skip the readClaimBlob call entirely when unchanged (#820, D6). Only ever
// called by releaseMerged's loop below with a cache entry that was recorded
// for a TERMINAL classified state (tombstone/unreadable) — a live/stale
// claim's sha is never cached, because that claim's PR/issue join can still
// change pass-to-pass even when its content hasn't (see the loop's own
// comment). A terminal state, once classified, never un-terminals itself —
// `classifyClaimBlob` is a pure function of content, so a byte-identical
// blob reclassifies identically every time — so a cache hit here means "we
// already know this claim is dead weight, don't re-fetch it."
function shouldSkipClaimRead(entry, cachedSha) {
  if (cachedSha === undefined || cachedSha === null) return false;
  return entry.sha === cachedSha;
}

// Shared by ghApi and ghApiAsync below — delegates to claim-store.js's
// classifyGhApiError (already imported below as `claimStore`) rather than a
// third copy of the same ENOENT-vs-everything-else classification pr-state.js
// and preflight.js also needed (review finding: 5 near-identical copies).
// #2567: ghApi/ghApiAsync below opt in to runClassified/runClassifiedAsync's
// retryOnTimeout — this, and therefore the 'network-failure' classification
// below, is only ever reached AFTER that single retry has also failed (see
// shared-primitives.js). A call that times out once but succeeds on retry
// never reaches this function at all.
function classifyGhExecError(e) {
  return claimStore.classifyGhApiError(e).failure === 'gh-absent' ? 'gh-absent' : 'network-failure';
}

// Shared by both ghApi and ghApiAsync below — defined once so the two
// twins' success/failure shape cannot silently drift (#1652, mirrors
// git-exec.js's runGit/runGitAsync and preflight.js's ghHealthCheck/
// ghHealthCheckAsync consolidation).
function buildSuccess(stdout) {
  return { stdout, failure: null };
}

function buildFailure(e) {
  return { stdout: null, failure: classifyGhExecError(e) };
}

function ghApi(args) {
  return runClassified(
    () => buildSuccess(execFileSync('gh', ['api', ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: GH_TIMEOUT_MS, windowsHide: true,
    })),
    buildFailure,
    { retryOnTimeout: true },
  );
}

// Raw `gh` runner for the shared write path below (ghApi prepends `api` and
// swallows failures; writeTombstoneShared composes its own argv and needs the throw).
function ghRunner(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: GH_TIMEOUT_MS, windowsHide: true });
}

// Both delegate to claim-store.js's one contents-API implementation.
// `api` defaults to this module's own `ghApi`, which never sets `status`
// (unlike claim-store's `defaultGhApi`), so `readClaimBlob`'s `absent: true`
// branch never fires with the default — every failure still surfaces as
// `gh-absent`/`network-failure` exactly as before this extraction (a 404
// mid-iteration is a race with another release pass, indistinguishable from
// any other read failure, and was never distinguished here pre-extraction
// either). `api` is overridable so releaseMerged's own injectable `ghApi`
// param (see below) reaches these calls in tests, mirroring claim-store's
// seam rather than adding a second one.
function listClaims(repoSlug, api = ghApi) {
  return claimStore.listClaimEntries(api, repoSlug);
}

// claim-store.js keys on the issue number, not the blob filename. Callers
// pre-filter `name` on this same regex before calling — see releaseMerged's
// loop below — so the match is always non-null here.
function issueNumberOf(name) {
  return Number(/^issue-(\d+)\.json$/.exec(name)[1]);
}

function readClaim(repoSlug, name, api = ghApi) {
  const r = claimStore.readClaimBlob({ ghApi: api }, repoSlug, issueNumberOf(name));
  return { content: r.content, sha: r.sha, failure: r.failure };
}

// Async counterpart of ghApi above, used only for the one remaining
// per-active-claim gh call this module parallelizes (readIssueStateAsync,
// via gh-pool's runWithConcurrency below) — listClaims/readClaim stay on
// the sync ghApi, since Task 7 already showed most entries now cache-skip,
// leaving little to gain there. A real (non-blocking) execFile is what lets
// runWithConcurrency's cap actually run calls concurrently, unlike
// execFileSync, which blocks the whole event loop regardless of how the
// calling code is structured.
async function ghApiAsync(args) {
  return runClassifiedAsync(
    async () => {
      const { stdout } = await execFileAsync('gh', ['api', ...args], { encoding: 'utf8', timeout: GH_TIMEOUT_MS, windowsHide: true });
      return buildSuccess(stdout);
    },
    buildFailure,
    { retryOnTimeout: true },
  );
}

// Issue-state lookup, async — same contract/timeout as the rest of this
// module. Unknown/errored state returns undefined: fail closed, never
// releases on missing evidence. `apiAsync` defaults to the real
// `ghApiAsync` above but accepts an injectable override — releaseMerged
// derives one from its own `ghApi` opt (see `apiAsync` below) so the same
// single injectable-ghApi seam this module already uses for
// listClaims/readClaim covers this call too, rather than adding a second
// override parameter.
async function readIssueStateAsync(repoSlug, issueNumber, apiAsync = ghApiAsync) {
  const r = await apiAsync([`repos/${repoSlug}/issues/${issueNumber}`, '-q', '.state']);
  if (r.failure || !r.stdout) return undefined;
  const s = r.stdout.trim().toUpperCase();
  return s === 'OPEN' || s === 'CLOSED' ? s : undefined;
}

// Pure seam for the released.push shape — the issue-closed path releases with a
// null/non-merged prState, so an unconditional prState.number dereference would
// throw on exactly that path.
function releasedEntry(issueNumber, runId, prState) {
  return { issueNumber, runId, prNumber: prState && typeof prState === 'object' ? prState.number : null };
}

// Conditional-update — sha = the target file's current blob sha from the
// fresh read above, per `_shared/issue-claims.md`'s "The lock" step 4/5. The
// PUT itself is composed by bin/lib/release-claim/release.js's writeTombstone —
// the one write path Section E's CLI and this reconciler share — so a sha
// mismatch (someone else already broke/re-claimed it) surfaces as an ordinary
// throw there and maps to false here; the caller logs it as a release race,
// exactly the posture that file's Failure posture table documents. `runner`
// is injectable for tests; the default keeps this module's 5s gh timeout.
function writeTombstone(repoSlug, name, sha, tombstoneContent, reason, runner = ghRunner) {
  const [owner, repo] = repoSlug.split('/');
  const issueNumber = Number((/^issue-(\d+)\.json$/.exec(name) || [])[1]);
  try {
    writeTombstoneShared({ owner, repo, issueNumber, sha, tombstoneContent, message: `Release claim ${name} — ${reason}`, runner });
    return true;
  } catch {
    return false;
  }
}

// Best-effort in both directions per `_shared/issue-claims.md` — a failed
// add/remove never blocks the claim, the release, or the pipeline.
function removeInProgressLabel(repoSlug, issueNumber, api = ghApi) {
  const r = api(['--method', 'DELETE', `repos/${repoSlug}/issues/${issueNumber}/labels/bot%3Ain-progress`]);
  return r.failure === null;
}

// Best-effort, same posture as removeInProgressLabel above — a failed removal never
// blocks or reverts the release. Strips every GRANT_LABELS entry (imported from
// release-claim/release.js — the same canonical list bin/release-claim.js's own
// --remove-grants path uses, never redefined here) via the DELETE-API shape, one
// call per label, through this module's own injectable `api` seam so tests never
// shell to a real `gh` binary (#1378).
function removeGrantLabels(repoSlug, issueNumber, api = ghApi) {
  for (const label of GRANT_LABELS) {
    api(['--method', 'DELETE', `repos/${repoSlug}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`]);
  }
}

// Best-effort bookkeeping only — a decisions.md write failure never blocks or
// reverts the label removal or the release itself. A merged claim's run dir is
// commonly already archived by this same reconcile pass (the mirror fast-forward
// step runs earlier), so a resolveTarget miss (missing/not-anchored) is expected,
// not a failure to surface (#1378).
function logGrantRemoval(runDir, root, reason) {
  let target;
  try { target = resolveTarget({ runDir, cwd: root }); } catch { return; }
  if (!target.ok) return;
  const entry = formatEntry({
    status: 'AUTO',
    now: Date.now(),
    step: 'reconcile',
    text: `stripped auto:build/auto:merge grants on convergent release (${reason})`,
    reversibility: 'high',
  });
  try { appendEntry({ runDir, entry }); } catch { /* best-effort, never gates the release */ }
}

// opts: { cwd?, ghApi? } — `ghApi` is an injectable override for this
// module's own gh-api calls (listing, per-claim reads, issue-state, label
// removal), mirroring claim-store.js's seam, so tests never shell to the
// real `gh` binary. Defaults to the module-level `ghApi` above.
//
// Runs in five phases (#820, D5 — parallelizing every per-active-claim gh
// call, PR-state AND issue-state reads, through gh-pool's concurrency-capped
// `runWithConcurrency`; PR-state was left serial in an earlier pass of this
// diff — #820 review — since it fires for every active claim with a
// resolvable branch, a superset of the candidates that also need issue
// evidence, it is the more universally-triggered of the two and is now
// pooled the same way):
//   Phase 1 (sync) — read/classify/join every claim not cache-skipped,
//     collecting active (live/stale) candidates with their branch join
//     (PR-state deferred to Phase 1.5).
//   Phase 1.5 (parallel, #3416) — one runWithConcurrency batch of by-number
//     PR-state probes for every candidate stamping pr.number, then one batch
//     of branch-join fetches for the joinable candidates those probes did not
//     settle.
//   Phase 1.75 (parallel, #3412) — one runWithConcurrency batch fetching the
//     merge commit message of each MERGED candidate whose PR references don't
//     already name its issue, then each candidate's closesIssue verdict
//     (prClosesIssue: references and/or a closing keyword in that message).
//   Phase 2 (parallel) — one runWithConcurrency batch resolving every
//     candidate's issue-state fetch (only for candidates PR evidence alone
//     can't decide — see needsIssueEvidence, now evaluated against Phase
//     1.5's resolved prState and Phase 1.75's closesIssue).
//   Phase 3 (sync) — decide + write. Writes stay serial: each is its own
//     conditional-update with its own sha, so there's no benefit to
//     parallelizing them, and serial writes keep this module's existing
//     one-write-at-a-time posture.
async function releaseMerged({ cwd, ghApi: ghApiOverride } = {}) {
  const released = [];
  const skipped = [];
  const root = cwd || process.cwd();
  const repoSlug = repoSlugOf(root);
  if (!repoSlug) return { released, skipped, failure: 'no-remote' };

  const api = ghApiOverride || ghApi;
  // Async-compatible counterpart of `api` for Phase 2's readIssueStateAsync
  // calls — reuses the same single injectable `ghApi` opt rather than
  // adding a second override parameter. A sync test fake's return value is
  // simply wrapped in an already-resolved promise; production defaults to
  // the real (non-blocking) ghApiAsync.
  const apiAsync = ghApiOverride ? (args) => Promise.resolve(ghApiOverride(args)) : ghApiAsync;

  const { entries, failure } = listClaims(repoSlug, api);
  if (failure) return { released, skipped, failure };

  const cache = readCache(root);
  const nextClaimShas = {};

  const wtList = runGit(['worktree', 'list', '--porcelain'], root);
  const worktrees = wtList.failure ? [] : parseWorktreeList(wtList.stdout);

  // Phase 1: synchronous read/classify/join for every claim not cache-skipped.
  const candidates = [];
  for (const entry of entries) {
    const m = /^issue-(\d+)\.json$/.exec(entry.name);
    if (!m) continue;
    const issueNumber = Number(m[1]);

    // A cache hit here only ever fires for a sha last recorded below with a
    // TERMINAL classified state (tombstone/unreadable) — see the `!isActive`
    // branch. A live/stale claim's sha is never written to the cache, so
    // this can never skip re-reading (and rejoining) an active candidate;
    // it only skips re-fetching content this module already knows is dead
    // weight, since `classifyClaimBlob` is a pure function of content and a
    // terminal state never un-terminals itself (#820, D6). Re-propagating
    // `entry.sha` here (rather than re-deriving claim.sha, which we don't
    // have — the whole point of this branch is skipping that read) is safe:
    // a cache HIT means this exact sha was already proven terminal by a
    // real read+classify on a PRIOR pass (see the `!isActive` branch below,
    // which caches `claim.sha` — the two are equal for a quiescent claim
    // since a listing sha and a blob-content sha are the same git blob sha).
    if (shouldSkipClaimRead(entry, cache.claimShas[issueNumber])) {
      nextClaimShas[issueNumber] = entry.sha; // still terminal, still cached
      continue; // matches the `if (!isActive) continue;` no-log behavior below
    }

    const claim = readClaim(repoSlug, entry.name, api);
    if (claim.failure) { skipped.push({ issueNumber, reason: claim.failure }); continue; }

    const classified = classifyClaimBlob(claim.content, Date.now());
    const isActive = classified.state === 'live' || classified.state === 'stale';
    if (!isActive) {
      // Cache the sha of the content actually classified (claim.sha, from
      // THIS fresh read), never the listing's entry.sha (from the earlier
      // directory-listing call) — the two can diverge under a race where
      // another agent released the claim between the listing and this read
      // (#820 review). claim.sha is also what writeTombstone already treats
      // as the authoritative sha for a conditional write, so this matches
      // the rest of the module. A null claim.sha (e.g. a 404-race/no-content
      // misread that classifyClaimBlob(null, ...) reports as 'absent') is
      // self-disarming: shouldSkipClaimRead's cachedSha === null guard never
      // treats it as a cache hit, so that claim simply stays un-cached and
      // is re-read (and can self-heal) on the next pass.
      nextClaimShas[issueNumber] = claim.sha; // terminal — cacheable, see the skip branch above
      continue; // absent/tombstone/unreadable — not worth logging as a skip
    }

    let runId = null;
    try { runId = JSON.parse(claim.content).runId || null; } catch { /* falls through to no-run-id below */ }
    if (!runId) {
      skipped.push({ issueNumber, reason: 'no-run-id' });
      continue;
    }

    let joinFailure = null; // 'no-run-state' | 'no-branch' — preserved as the skip reason when no evidence releases
    const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
    const runState = readRunState(runDir);
    const wtEntry = runState && runState.worktree
      ? worktrees.find((w) => path.resolve(w.path) === path.resolve(runState.worktree))
      : null;
    // #3249: a live worktree entry wins; when it's gone (the ordinary
    // post-merge-teardown timing, not an edge case under `integration-model:
    // pr-first`), fallbackBranch recovers the branch name from
    // run-state.json's pr.branch (stamped once, live, by hooks.js
    // record-pr) or decisions.md, as long as that branch ref still
    // resolves — mirrors archive-merged.js's identical fallback for this
    // exact shape (#1962/#1684).
    const branch = (wtEntry && wtEntry.branch) || fallbackBranch(root, runDir, runState);
    // Surviving evidence when BOTH the worktree and the branch itself are
    // gone (e.g. pr-first-merge-post-merge.md Step 5 already deleted the
    // remote ref) — run-state.json's pr.number, stamped once at
    // PR-early-lifecycle time and never cleared.
    const prNumber = runState && runState.pr && runState.pr.number ? runState.pr.number : null;
    // Gated on `!branch` first: an unstamped worktree whose branch
    // fallbackBranch still recovered joins normally — mirrors
    // archive-merged.js, which reports no-worktree only when the fallback
    // also fails (#1684/#2228). The skip-reason vocabulary is unchanged.
    if (!branch) {
      // 'no-run-state': archived/gone run dir (or one never stamped with a
      // worktree) — issue-closed evidence below may still release.
      joinFailure = (!runState || !runState.worktree) ? 'no-run-state' : 'no-branch';
    }
    // prState is resolved in Phase 1.5 below (deferred so the per-active-claim
    // `gh pr list` call goes through the pool, not this sync loop) — null here
    // is a placeholder, never a "no PR" result; joinFailure gates whether
    // Phase 1.5 attempts the fetch at all.

    // `sha` here is claim.sha (this fresh read's blob sha, NOT the earlier
    // listing's entry.sha) — the same sha writeTombstone below treats as
    // authoritative for its conditional write, and the same distinction
    // the `!isActive` cache-write above draws for exactly the same reason.
    candidates.push({
      issueNumber, runId, name: entry.name, sha: claim.sha, classifiedState: classified.state, prState: null, joinFailure, branch, prNumber, runDir,
      closesIssue: undefined,
    });
  }

  // Phase 1.5: PR-state fetches, capped. A candidate that stamps pr.number
  // (run-state.json) resolves BY NUMBER first (#3416): the stamped PR is this
  // run's own PR, while its branch name can be reused by a later run and then
  // names an unrelated (possibly merged) PR. Only a null answer falls through
  // to the branch pool below. Deliberate asymmetry, do not align: a branchless
  // candidate whose by-number probe fails keeps prState null so the #3249
  // issue-closed release path still applies, while a branch-resolved candidate
  // whose probe fails skips on the failure string (never releases via the
  // branch's PR, #3416).
  const byNumberCands = candidates.filter((c) => c.prNumber);
  const prStatesByNumber = await runWithConcurrency(
    byNumberCands,
    (c) => resolvePrStateByNumberAsync(root, c.prNumber),
  );
  const prStateByNumberByIssue = resultsByIssue(byNumberCands, prStatesByNumber);
  for (const c of byNumberCands) {
    const byNumber = prStateByNumberByIssue.get(c.issueNumber);
    if (byNumber === null) continue; // no answer — the branch join decides below
    if (byNumber && typeof byNumber === 'object') {
      // Real evidence — this candidate now behaves like an ordinary
      // branch-joined one, and Phase 2 gates its issue-evidence fetch on it.
      c.prState = byNumber;
      c.joinFailure = null;
    } else if (c.joinFailure === null) {
      // Branch resolved, but the stamped PR's probe failed: that failure is the
      // verdict (decideRelease skips), never a release via the branch's PR.
      c.prState = byNumber;
    }
    // Otherwise (no branch resolved AND a failed probe): leave prState null and
    // joinFailure set, so Phase 2 still tries issue-closed evidence (#3249 —
    // recording the failure here would make needsIssueEvidence false).
  }

  // Then the branch join for every joinable candidate the by-number probe did
  // not settle: no stamped number, or a by-number null. Candidates whose
  // prState is already set (object or failure string) are not re-probed.
  const needPrState = candidates.filter((c) => c.joinFailure === null && c.prState === null);
  const prStates = await runWithConcurrency(
    needPrState,
    (c) => resolvePrStateAsync(root, c.branch),
  );
  const prStateByIssue = resultsByIssue(needPrState, prStates);
  for (const c of needPrState) c.prState = prStateByIssue.get(c.issueNumber);

  // Phase 1.75 (#3412): the merge commit's message, fetched only where the PR's
  // closingIssuesReferences don't already settle that it closes this issue (a
  // squash body's `Fixes #N` line is the second closing signal prClosesIssue
  // reads). A failed or empty fetch leaves mergeCommitMessage undefined — the
  // verdict then rests on the references alone, never on a guess. closesIssue
  // is computed for EVERY candidate here, before Phase 2: needsIssueEvidence
  // gates the issue-state fetch on it.
  const isMerged = (c) => c.prState && typeof c.prState === 'object' && c.prState.state === 'MERGED';
  const needCommit = candidates.filter((c) => isMerged(c)
    && Array.isArray(c.prState.closingIssuesReferences)
    && prClosesIssue(c.prState, c.issueNumber, repoSlug) !== true
    && c.prState.mergeCommit && c.prState.mergeCommit.oid);
  const commitReads = await runWithConcurrency(
    needCommit,
    (c) => apiAsync([`repos/${repoSlug}/commits/${c.prState.mergeCommit.oid}`, '-q', '.commit.message']),
  );
  const commitByIssue = resultsByIssue(needCommit, commitReads);
  for (const c of candidates) {
    const r = commitByIssue.get(c.issueNumber);
    const mergeCommitMessage = r && typeof r === 'object' && !r.failure && typeof r.stdout === 'string' ? r.stdout : undefined;
    c.closesIssue = isMerged(c)
      ? prClosesIssue(c.prState, c.issueNumber, repoSlug, mergeCommitMessage)
      : undefined;
  }

  // Phase 2: parallel issue-state fetches, capped, only for candidates that
  // need one (needsIssueEvidence) — gated the same way the prior serial
  // loop gated its per-candidate fetch, so non-candidates cost nothing.
  const needIssue = candidates.filter((c) => needsIssueEvidence(c.prState, c.closesIssue));
  const issueStates = await runWithConcurrency(
    needIssue,
    (c) => readIssueStateAsync(repoSlug, c.issueNumber, apiAsync),
  );
  const issueStateByIssue = new Map(
    needIssue.map((c, i) => [c.issueNumber, issueStates[i] instanceof Error ? undefined : issueStates[i]]),
  );

  // Phase 3: decide + write, synchronous (writes stay serial — see header comment).
  for (const c of candidates) {
    const issueState = issueStateByIssue.get(c.issueNumber);
    const decision = decideRelease(c.classifiedState, c.prState, issueState, c.closesIssue);
    if (decision.action === 'skip') {
      // No nextClaimShas write here: an active (live/stale) claim's PR/issue
      // join can change pass-to-pass even when its content hasn't, so it
      // must never be cached/skipped — only the two TERMINAL-state
      // continue branches in Phase 1 above ever populate nextClaimShas.
      skipped.push({ issueNumber: c.issueNumber, runId: c.runId, reason: c.joinFailure || decision.reason });
      continue;
    }

    const reason = decision.reason === 'issue-closed'
      ? `issue-closed: reconciled from #${c.issueNumber}`
      : decision.reason;
    const payload = releasePayload({ issueNumber: c.issueNumber, runId: c.runId, reason, now: Date.now() });
    const ok = writeTombstone(repoSlug, c.name, c.sha, payload.tombstoneContent, reason);
    if (!ok) { skipped.push({ issueNumber: c.issueNumber, runId: c.runId, reason: 'release-write-failed' }); continue; }
    removeInProgressLabel(repoSlug, c.issueNumber, api); // best-effort, never gates the release
    if (reason.startsWith('merged:')) {
      removeGrantLabels(repoSlug, c.issueNumber, api); // best-effort, never gates the release
      logGrantRemoval(c.runDir, root, reason);
    }
    released.push(releasedEntry(c.issueNumber, c.runId, c.prState));
  }

  // Re-read immediately before writing rather than reusing the `cache`
  // snapshot captured at function entry (before Phase 1.5/2's async gh-pool
  // network calls, which can take real wall-clock seconds): under this
  // repo's normal concurrent-worktree-session usage, a concurrent
  // reconcile() process can write a fresher `lastRunAt` inside that window,
  // and writing back the stale entry-time snapshot would silently revert it
  // — index.js's own final cache write already reads and writes back-to-back
  // for exactly this reason (#820 review). `claimShas: nextClaimShas` stays a
  // full replacement, not a merge — this pass's own listing-driven rebuild is
  // already a complete, self-consistent claimShas set for what it observed.
  writeCache(root, { ...readCache(root), claimShas: nextClaimShas });
  return { released, skipped };
}

module.exports = {
  releaseMerged, decideRelease, releasedEntry, repoSlugOf, writeTombstone, shouldSkipClaimRead,
  prClosesIssue, needsIssueEvidence,
};
