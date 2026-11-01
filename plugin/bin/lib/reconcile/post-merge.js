// bin/lib/reconcile/post-merge.js — convergence check: run
// _shared/pr-first-merge-post-merge.md's Step 4.0 (closing-links post-merge
// verification) and Step 4.0b (below-floor parent close) once for a PR GitHub
// merged AFTER its session ended — an armed auto-merge, a merge-queue merge —
// so no session ever ran the steps (#4599). Step 4.0b runs
// lib/issues/below-floor-parent-close.js over lib/issues/parent-gate.js, the
// gate code the prose's bin/parent-gate.js CLI runs. Step 4.0 stays a
// bin/closing-links.js run. This file only decides WHEN they run and records
// that they did.
//
// Exactly once per run: a `decisions.md` entry (the marker) is the done-signal,
// whether the merging session's own Step 4.0b wrote it or this check did. Two
// guards keep that true under concurrency: a merge-grace window (the merging
// session itself runs both steps within seconds of `mergedAt`, so the
// reconciler never races it) and a per-run claim file (inline reconcile passes
// do not serialize on background-lock.js). gh-only by design: a Node subprocess
// cannot see an agent session's MCP tools, so a gh-absent environment skips and
// tidy's `parent-gate` backstop stays the recovery for every fail-open path.
//
// The marker may sit in the top-level `decisions.md` or, for a multi-spec run, in
// any `spec-*/decisions.md` (flow/multi-spec.md exports `{parent}/spec-{N}/` as
// PIPELINE_RUN_DIR, so the merging session's Step 4.0b may log there).
//
// Transient failures retry, bounded. Step 4.0's `closing-links` exit 5 (a `gh pr
// view`/`gh pr edit` failure or a malformed read: gh or its transport), and an
// exit-0 envelope carrying `baseUnchecked: true` (the PR's base or the repo's
// default branch could not be read, so Step 4.0 closed nothing and printed no
// closing set, #4549), write an ATTEMPT_STEP line instead of the marker — a
// location the marker rule never matches — and defer the run as
// `transient-failure`. Once MAX_ATTEMPTS attempt lines exist, the next such
// failure writes the marker as any other failure does. Every other exit is
// deterministic (2 malformed invocation, 3 run dir not anchored, 4 pre-merge
// only), as is an unreadable exit-0 envelope: those write the marker at once.
//
// Step 4.0b's after-a-PR-merge rules, from Step 4.0's envelope (#4549): there is
// no default-branch check (on a non-default base Step 4.0 closes the `Fixes`
// records itself and `closingSet` holds only the ones it confirmed closed), and
// a `closeFailed[]` record holds its parent like a `failed[]` one does. A
// policy.yml that exists but cannot be read, or a risk-floor value it rejects,
// skips Step 4.0b's close step-wide (`unreadable-policy`, `invalid-risk-floor`)
// rather than defaulting the floor; Step 4.0 still runs and the marker is written.
//
// The caller may pass `budgetExceeded` (the pass's wall-clock budget, index.js's
// `budget.exceeded`). It is checked before each run's steps, never mid-run; once
// it reads true, every remaining run that would have run skips `budget-exhausted`
// and is deferred to the next pass.
//
// `postMergeOne` runs the same guarded path (marker check, PR state, claim, marker re-check,
// Steps 4.0/4.0b) for ONE named run dir, an `archive/{run-id}` dir included — the
// reconciler never walks `archive/`. Its caller is `bin/post-merge-run.js`, merge mode's
// Already merged section (#4692). It runs inside MERGE_GRACE_MS too, where the loop defers:
// it holds the same per-run claim and writes the same marker, so it and the reconciler
// never run the steps concurrently — a held claim reads `in-flight`, and the in-grace run
// takes the in-session parameters (`closing-links`' default settle poll, `selfInclude: true`).
//
// `postMerge` returns { entries, deferred, failure? }. `deferred` lists the run dirs skipped
// for a RETRYABLE reason — archive must not archive them in this pass, or the
// retry never comes (archive-merged.js's `postMergeDeferred`). Exactly six
// reasons are retryable: `merge-grace`, `in-flight`, `claim-failed`, the
// transient PR lookup failure `network-failure`, `transient-failure` and
// `budget-exhausted`. Every other skip is NOT
// deferred: `gh-absent`, `dry-run`, `marker-write-failed` and the definitive lookup failures (`pr-not-found` — confirmed by pr-state.js
// before it answers, and one of archive's own structurally-stuck reasons —
// `invalid-arguments`, `no-pr-state`), so archive's stuck-run surfacing for
// them stays on. `failure` is `not-github-issues`, `no-remote`, or
// `no-pr-states` (the caller passed no usable PR-state resolver: a bug, never
// a transient answer).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSyncTimed } = require('./timing');
const { listRunDirsWithState, readRunState } = require('../hooks/context');
const { mainCheckoutRoot } = require('../hooks/worktree-detect');
const { repoSpecOf } = require('../hooks/git-exec');
const { readWorkBackend } = require('../work-backend');
const { resolvePolicyKeys } = require('../policy-schema');
const { appendEntries, formatEntry, parseEntry } = require('../log-decision/append');
const { GH_TIMEOUT_MS } = require('../shared-primitives');
const { resolveWithin } = require('../path-guard');
const { ghOptions } = require('../repo-resolve');
const { closeBelowFloorParents } = require('../issues/below-floor-parent-close');
const { run: closingLinksRun, EXIT_GH_FAILURE, ERR_TEXT_MAX } = require('../../closing-links');

const MARKER_STEP = 'reconcile post-merge';
const PARENT_STEP = 'reconcile post-merge parent-close';
// A transient failure's retry line: a different location from MARKER_STEP, so it is never a marker.
const ATTEMPT_STEP = 'reconcile post-merge attempt';
const MAX_ATTEMPTS = 3;
// closing-links.js's one transient exit: `gh pr view` / `gh pr edit` failed, or a required read was malformed.
const TRANSIENT_CLOSING_LINKS_EXIT = EXIT_GH_FAILURE;
const TRANSIENT_REASON = 'transient-failure';
const CLOSE_WINDOW_MS = 10 * 60 * 1000;
const MERGE_GRACE_MS = 10 * 60 * 1000;
const CLAIM_STALE_MS = 10 * 60 * 1000;
const CLAIM_FILENAME = '.post-merge.lock';
// The one prStates failure string worth retrying; every other string is final (see the header).
const TRANSIENT_PR_FAILURE = 'network-failure';
// Step 4.0b skips that are deliberate gate outcomes, not failures: closeBelowFloorParents' own reasons plus
// the parentGateState verdicts its skipReason passes through (`resolved`, `gated`, `incomplete`). Every other
// reason — `gh-failed`, `internal-error`, the step-wide `unreadable-policy` / `invalid-risk-floor`, and any
// reason added later — is a failure, so a new skip surfaces loudly rather than reading as a clean close.
const DELIBERATE_PARENT_SKIPS = new Set([
  'not-parent-issue-labeled', 'needs-label', 'sibling-unsettled', 'resolved', 'gated', 'incomplete',
  'above-floor', 'already-closed', 'reopened-by-human',
]);

// The merging session's Step 4.0b writes its own marker under this location
// (`spec #N — pr-first-merge Step 4.0b`, or `… (skipped)`); this check writes MARKER_STEP.
const STEP_4_0B_LOCATION_RE = /(?:^|— )pr-first-merge Step 4\.0b\b/;
// Any entry at that location counts, the per-parent `closed parent #N …` line included: a build that logged
// no summary line (every released build before #4599) still closed a parent there, so its run is done. The
// cost is a session that died after closing its first parent but before the summary: the reconciler skips
// that run and tidy's parent-gate backstop recovers the rest (the docs/reconcile-checks.md marker rule).

// Pure: does this decisions.md text already hold a post-merge marker? Entries
// are read through parseEntry, so a heading or a hand-written note never matches.
function hasPostMergeMarker(decisionsText) {
  if (typeof decisionsText !== 'string') return false;
  return decisionsText.split('\n').some((line) => {
    const entry = parseEntry(line);
    return Boolean(entry) && (entry.location === MARKER_STEP || STEP_4_0B_LOCATION_RE.test(entry.location));
  });
}

const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim();
// A skip's detail can be a raw gh error with its whole stderr; bounded like closing-links.js's own error text.
const boundDetail = (text) => (text.length > ERR_TEXT_MAX ? `${text.slice(0, ERR_TEXT_MAX)}…` : text);

// Pure: the SKIP marker's text for a Step 4.0 that produced no closing set.
function composeSkipText(returned) {
  return oneLine(`condition: Step 4.0 returned ${returned}, no closingSet → fallback: no parent closed; the tidy parent-gate backstop recovers them`);
}

// Pure: what a skipped entry names — its parent, a bare record, or the whole step.
function skipTarget(skip) {
  if (skip.parent !== undefined && skip.parent !== null) return `#${skip.parent}`;
  if (skip.issue !== undefined && skip.issue !== null) return `record #${skip.issue}`;
  return 'step';
}

// Pure: the summary marker's text. Names every closed parent's untrusted-comment
// notes, every skip (parent, bare record, or step-wide) and its detail, on one line.
function composeSummaryText({ pr, action, closed, skipped }) {
  let text = `ran Steps 4.0 and 4.0b for PR #${pr}, merged after its session: closing links ${action}; ${closed.length} parent(s) closed`;
  for (const c of closed) {
    if (Array.isArray(c.notes) && c.notes.length) text += `; notes on #${c.parent}: ${c.notes.join(' / ')}`;
  }
  for (const s of skipped) {
    text += `; skipped ${skipTarget(s)} (${s.reason}${s.detail ? `: ${boundDetail(oneLine(s.detail))}` : ''})`;
  }
  return oneLine(text);
}

function readDecisions(runDir) {
  try { return fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'); } catch { return ''; }
}

// Is this run done? The top-level decisions.md, then each multi-spec `spec-*/decisions.md` (see the header).
function runHasMarker(runDir) {
  if (hasPostMergeMarker(readDecisions(runDir))) return true;
  let children;
  try { children = fs.readdirSync(runDir, { withFileTypes: true }); } catch { return false; }
  return children.some((c) => c.isDirectory() && c.name.startsWith('spec-')
    && hasPostMergeMarker(readDecisions(path.join(runDir, c.name))));
}

// Pure: how many ATTEMPT_STEP lines this decisions.md text holds.
function countAttempts(decisionsText) {
  return String(decisionsText).split('\n').filter((line) => {
    const entry = parseEntry(line);
    return Boolean(entry) && entry.location === ATTEMPT_STEP;
  }).length;
}

// -> { raw } with the policy file's text, `raw: null` when there is no policy file, or
// { raw: null, error } for any other read error. Read as "no policy", an unreadable file would
// resolve risk-floor to the schema default, looser than a configured medium or low floor.
function readPolicyRaw(root) {
  try {
    return { raw: fs.readFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'utf8') };
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return { raw: null };
    return { raw: null, error: (e && (e.code || e.message)) || String(e) };
  }
}

// Pure: why this pass must not run Step 4.0b's close, or null. An unreadable policy file, or a
// risk-floor value the schema rejects, skips the close instead of defaulting the floor: the default
// (`high`) is looser than a configured medium or low one, and would close a parent below the
// oversight floor with no sign-off. The skip is step-wide, as closeBelowFloorParents' own
// `invalid-risk-floor` is.
function policySkipOf(policyFile, riskFloorEntry, rejectedRiskFloor) {
  if (policyFile.error) return { reason: 'unreadable-policy', detail: `.claude-tweaks/policy.yml: ${policyFile.error}` };
  if (riskFloorEntry && riskFloorEntry.invalid) {
    return { reason: 'invalid-risk-floor', detail: `.claude-tweaks/policy.yml risk-floor: ${JSON.stringify(rejectedRiskFloor)}` };
  }
  return null;
}

// Take the per-run claim: `{runDir}/.post-merge.lock`, created exclusively. A
// live claim (mtime under CLAIM_STALE_MS) is in flight; a stale one is taken over
// ATOMICALLY — renamed aside first, so of two takeovers only the rename winner
// goes on to retry the create, once. Returns { ok: true } | { ok: false, reason }.
function takeClaim(runDir, nowMs, fsApi = fs) {
  const lock = path.join(runDir, CLAIM_FILENAME);
  const create = () => { fsApi.closeSync(fsApi.openSync(lock, 'wx')); };
  try {
    create();
    return { ok: true };
  } catch (e) {
    if (!e || e.code !== 'EEXIST') return { ok: false, reason: 'claim-failed' };
  }
  let mtimeMs;
  try {
    mtimeMs = fsApi.statSync(lock).mtimeMs;
  } catch (e) {
    // The holder released it between our create and this stat: it is in flight, retry next pass.
    return { ok: false, reason: e && e.code === 'ENOENT' ? 'in-flight' : 'claim-failed' };
  }
  if (nowMs - mtimeMs < CLAIM_STALE_MS) return { ok: false, reason: 'in-flight' };
  const aside = `${lock}.stale-${process.pid}-${Date.now()}`;
  try {
    fsApi.renameSync(lock, aside);
  } catch (e) {
    return { ok: false, reason: e && e.code === 'ENOENT' ? 'in-flight' : 'claim-failed' }; // another taker won the rename
  }
  // The rename moves whatever sits at the path NOW. If another taker finished its whole takeover
  // between our stat and our rename, that is its fresh claim, not the stale one: put it back.
  let asideMtimeMs = mtimeMs;
  try { asideMtimeMs = fsApi.statSync(aside).mtimeMs; } catch { /* keep the stale reading */ }
  if (nowMs - asideMtimeMs < CLAIM_STALE_MS) {
    // Residual window, bounded: the holder may release between our rename and this link, and the
    // link then re-creates a lock nobody holds. The run reads `in-flight` and defers until that
    // lock ages past CLAIM_STALE_MS, then the next pass takes it over.
    try { fsApi.linkSync(aside, lock); } catch { /* a third taker already created one */ }
    try { fsApi.unlinkSync(aside); } catch { /* an orphaned .stale- file is harmless */ }
    return { ok: false, reason: 'in-flight' };
  }
  try { fsApi.unlinkSync(aside); } catch { /* an orphaned .stale- file is harmless */ }
  try {
    create();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e && e.code === 'EEXIST' ? 'in-flight' : 'claim-failed' };
  }
}

function releaseClaim(runDir) {
  try { fs.unlinkSync(path.join(runDir, CLAIM_FILENAME)); } catch { /* already gone */ }
}

// Pure: Step 4.0's JSON envelope from the CLI's captured stdout, or null.
function parseEnvelope(stdoutText) {
  const lines = String(stdoutText).split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  try {
    const parsed = JSON.parse(lines[lines.length - 1]);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

const numbers = (values) => (Array.isArray(values) ? values : []).map(Number).filter(Number.isInteger);
const issuesOf = (list) => (Array.isArray(list) ? list : []).map((f) => f && f.issue).filter(Number.isInteger);

function candidateRuns(root) {
  return [...listRunDirsWithState(root), ...listRunDirsWithState(root, { status: 'clean' })];
}

// #4032's batched lookup, for this check: warm the pass's PR-state resolver with the PR number of
// every run postMerge will probe (a recorded PR, no marker yet), so its per-run `byNumberAsync`
// calls hit the memo instead of each paying a live `gh pr view`. Without it the check, which
// dispatches ahead of archive's own warm-up, would make one cold call per active run on every pass
// (OPEN answers are never persisted). Same run selection as postMerge's loop, clean runs included.
// Best-effort: the caller swallows a throw, and a number left unwarmed just costs the live call.
async function prefetchPostMergePrStates(root, prStates) {
  if (!prStates || typeof prStates.prefetch !== 'function') return;
  if (readWorkBackend(root) !== 'github-issues') return; // postMerge skips such a project before any lookup
  const wanted = new Set();
  for (const { dir, state } of candidateRuns(root)) {
    const pr = state && state.pr && state.pr.number;
    if (!Number.isInteger(pr) || pr <= 0) continue;
    if (runHasMarker(dir)) continue;
    wanted.add(pr);
  }
  await prStates.prefetch({ numbers: [...wanted] });
}

// Steps 4.0 / 4.0b parameters. The loop runs more than MERGE_GRACE_MS after the merge, so closing-links
// settles with no poll and a human's later reopen counts (#4599); the in-session run is within seconds of
// the merge, with closing-links' default settle poll and the merging PR itself counted (null = flag omitted).
const LATE_MERGE_PARAMS = { settleMs: '0', closeWindowMs: CLOSE_WINDOW_MS, selfInclude: false };
const IN_SESSION_PARAMS = { settleMs: null, closeWindowMs: null, selfInclude: true };

// -> { failure } when this project or caller cannot run the check, else the context both paths share.
function setupContext({ cwd, deps }) {
  const start = cwd || process.cwd();
  const root = mainCheckoutRoot(start) || start;
  if (readWorkBackend(root) !== 'github-issues') return { failure: 'not-github-issues' };
  // The host too: off github.com, Step 4.0b's gh calls name it (`--repo host/owner/repo`, `--hostname`).
  const repoSpec = repoSpecOf(root);
  if (!repoSpec) return { failure: 'no-remote' };
  const { host, owner, repo } = repoSpec;

  const policyFile = readPolicyRaw(root);
  let rejectedRiskFloor = null;
  const policy = resolvePolicyKeys(['work-links', 'risk-floor'], {
    policyRaw: policyFile.raw,
    runConfigRaw: null,
    onInvalid: (key, raw) => { if (key === 'risk-floor') rejectedRiskFloor = raw; },
  });
  const workLinks = policy['work-links'].value;
  const riskFloor = policy['risk-floor'].value;
  const policySkip = policySkipOf(policyFile, policy['risk-floor'], rejectedRiskFloor);

  const timedGh = deps.gh || ((args, input) => execFileSyncTimed('gh', args, ghOptions(args, {
    cwd: root, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, windowsHide: true,
  })));
  const runClosingLinks = deps.closingLinksRun || closingLinksRun;
  const closeParents = deps.closeParents || closeBelowFloorParents;
  const writeEntries = deps.appendEntries || appendEntries;

  return {
    root, owner, repo, host, workLinks, riskFloor, policySkip, timedGh, runClosingLinks, closeParents, writeEntries,
  };
}

// One run through the guards and, when it clears them, Steps 4.0 and 4.0b. Order: recorded PR -> marker ->
// PR state -> MERGED -> grace -> dry-run -> budget -> claim -> marker re-read -> processRun -> release.
// -> { entry, defer }: `entry` null is a silent skip; `defer` says archive must keep the run for a retry.
// `single` (postMergeOne) runs inside the grace under the in-session parameters instead of skipping it, and
// returns its silent skips (`no-pr`, `already-done`, `not-merged`) as entries.
async function processCandidate({
  dir, state, ctx, prStates, dryRun, now, budgetExceeded, deps, single = false, retryHint, includeRecords = false,
}) {
  const pr = state && state.pr && state.pr.number;
  if (!Number.isInteger(pr) || pr <= 0) {
    return { entry: single ? { runDir: dir, pr: null, action: 'skipped', reason: 'no-pr' } : null, defer: false };
  }
  const skipped = (reason, extra = {}) => ({ runDir: dir, pr, action: 'skipped', reason, ...extra });
  // The reconcile loop drops these outcomes; the single-run path reports them.
  const silentSkip = (reason, extra) => (single ? skipped(reason, extra) : null);
  if (runHasMarker(dir)) return { entry: silentSkip('already-done'), defer: false };

  let prState;
  try { prState = await prStates.byNumberAsync(pr); } catch { prState = TRANSIENT_PR_FAILURE; } // a real throw from the lookup is a transport failure
  if (!prState || typeof prState !== 'object') {
    const reason = typeof prState === 'string' ? prState : 'no-pr-state';
    return { entry: skipped(reason), defer: reason === TRANSIENT_PR_FAILURE };
  }
  if (prState.state !== 'MERGED') return { entry: silentSkip('not-merged', { detail: String(prState.state) }), defer: false };

  const mergedAt = Date.parse(prState.mergedAt);
  // `<=`: a run is processed only strictly past the grace, so strictly past CLOSE_WINDOW_MS too
  // (closing-links settles a still-open will-close record only once the clock is past mergedAt + window).
  const inGrace = Number.isNaN(mergedAt) || now() - mergedAt <= MERGE_GRACE_MS;
  if (inGrace && !single) return { entry: skipped('merge-grace'), defer: true };
  if (dryRun) return { entry: skipped('dry-run'), defer: false };
  // Checked between runs, never mid-run: a run left over is the next pass's, so archive keeps it.
  if (typeof budgetExceeded === 'function' && budgetExceeded()) return { entry: skipped('budget-exhausted'), defer: true };

  if (deps.beforeClaim) deps.beforeClaim(dir);
  const claim = (deps.takeClaim || takeClaim)(dir, now());
  if (!claim.ok) return { entry: skipped(claim.reason), defer: true };
  try {
    // A pass that finished between the first read and the claim wrote its marker already.
    if (runHasMarker(dir)) return { entry: silentSkip('already-done'), defer: false };
    const entry = processRun({
      dir, pr, ...ctx, now, params: inGrace ? IN_SESSION_PARAMS : LATE_MERGE_PARAMS, retryHint, includeRecords,
    });
    return { entry, defer: entry.reason === TRANSIENT_REASON };
  } catch (e) {
    return { entry: skipped('error', { detail: oneLine(e && e.message ? e.message : e) }), defer: false };
  } finally {
    releaseClaim(dir);
  }
}

async function postMerge({
  cwd, prStates, dryRun = false, now = Date.now, budgetExceeded, deps = {},
} = {}) {
  const entries = [];
  const deferred = [];
  const ctx = setupContext({ cwd, deps });
  if (ctx.failure) return { entries, deferred, failure: ctx.failure };
  // A missing resolver is a caller bug; the per-run catch must never relabel it a transient network failure.
  if (!prStates || typeof prStates.byNumberAsync !== 'function') return { entries, deferred, failure: 'no-pr-states' };

  for (const { dir, state } of candidateRuns(ctx.root)) {
    const { entry, defer } = await processCandidate({ dir, state, ctx, prStates, dryRun, now, budgetExceeded, deps });
    if (entry) entries.push(entry);
    if (defer) deferred.push(dir);
  }
  return { entries, deferred };
}

// Is this run dir under `{main checkout}/.claude-tweaks/pipelines/archive/`? Real paths on both sides.
function isArchivedRunDir(runDir, root) {
  return resolveWithin(runDir, path.join(root, '.claude-tweaks', 'pipelines', 'archive')) !== null;
}

// The run's config.yml `spec:` value when it is one record number, else null: an unreadable file or line,
// or a multi-spec value (`1068,1103`, `[1486, 1501]`) that would garble the `#{n}` retry hint.
function readSpecNumber(runDir) {
  let text;
  try { text = fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8'); } catch { return null; }
  const m = /^spec:\s*(\S+)/m.exec(text);
  const value = m ? m[1].replace(/^#/, '') : null;
  return value && /^\d+$/.test(value) ? value : null;
}

// The ATTEMPT_STEP line's retry clause. An archived run is never walked by the reconcile pass, so its retry
// is the next `/claude-tweaks:wrap-up {n} merge`; a live run's is the next reconcile pass.
const RECONCILE_RETRY_HINT = 'the next reconcile pass retries Steps 4.0 and 4.0b';
function archivedRetryHint(runDir) {
  const spec = readSpecNumber(runDir);
  return `the next /claude-tweaks:wrap-up ${spec ? `#${spec} ` : ''}merge retries Steps 4.0 and 4.0b`;
}

// The single-run path (see the header): one named run dir, archived included. -> one entry:
// { runDir, pr, action, reason?, detail?, closingLinks?, parentsClosed?, attempt?, step40Failed?, records?,
//   logFailed?, parentFailures? }.
async function postMergeOne({
  runDir: givenRunDir, cwd, prStates, now = Date.now, deps = {},
} = {}) {
  // One absolute path for every read, the claim file and closing-links' `--run`, whatever the process cwd is.
  const runDir = path.resolve(cwd || process.cwd(), givenRunDir);
  const ctx = setupContext({ cwd, deps });
  if (ctx.failure) return { runDir, pr: null, action: 'skipped', reason: ctx.failure };
  if (!prStates || typeof prStates.byNumberAsync !== 'function') return { runDir, pr: null, action: 'skipped', reason: 'no-pr-states' };
  const retryHint = isArchivedRunDir(runDir, ctx.root) ? archivedRetryHint(runDir) : RECONCILE_RETRY_HINT;
  const { entry } = await processCandidate({
    dir: runDir, state: readRunState(runDir), ctx, prStates, dryRun: false, now, deps, single: true, retryHint, includeRecords: true,
  });
  return entry;
}

// Steps 4.0 and 4.0b for one claimed run; the one place the marker is written.
// `params` is { settleMs, closeWindowMs, selfInclude } (see LATE_MERGE_PARAMS); `retryHint` the retry clause
// of an attempt line; `includeRecords` adds Step 4.0's record lists and `logFailed`, and Step 4.0b's
// `parentFailures`, to a `ran` entry (postMergeOne only).
function processRun({
  dir, pr, root, owner, repo, host, workLinks, riskFloor, policySkip, timedGh, runClosingLinks, closeParents, writeEntries, now,
  params = LATE_MERGE_PARAMS, retryHint = RECONCILE_RETRY_HINT, includeRecords = false,
}) {
  let out = '';
  const code = runClosingLinks(
    [
      '--run', dir, '--mode', 'post-merge',
      ...(params.settleMs !== null ? ['--settle-ms', params.settleMs] : []),
      ...(params.closeWindowMs !== null ? ['--close-window-ms', String(params.closeWindowMs)] : []),
    ],
    {
      cwd: () => root, mainRoot: root, ghAvailable: () => true, gh: timedGh, stdout: (s) => { out += s; }, stderr: () => {},
    },
  );
  const envelope = code === 0 ? parseEnvelope(out) : null;
  // Step 4.0's record lists (issue numbers) and its `logFailed` flag (a decisions.md line it could not
  // append), for a caller that surfaces them; omitted with no envelope.
  const recordsOf = (env) => (includeRecords && env ? {
    records: {
      failed: issuesOf(env.failed),
      closeFailed: issuesOf(env.closeFailed),
      pendingClose: numbers(env.pendingClose),
      unchecked: numbers(env.unchecked),
    },
    ...(env.logFailed === true ? { logFailed: true } : {}),
  } : {});
  const stamp = now();
  // A failed write still reports the parents Step 4.0b closed: they are closed on GitHub either way.
  const write = (items, ran, parentsClosed = 0) => {
    try {
      writeEntries({ runDir: dir, items });
    } catch {
      return { runDir: dir, pr, action: 'skipped', reason: 'marker-write-failed', parentsClosed };
    }
    return ran;
  };
  // A transient failure under the bound: an attempt line (never a marker) and a deferred skip.
  // Returns null once MAX_ATTEMPTS lines exist, so the caller writes the marker instead.
  const retry = (condition) => {
    const attempt = countAttempts(readDecisions(dir)) + 1;
    if (attempt > MAX_ATTEMPTS) return null;
    const text = oneLine(`condition: ${condition} (attempt ${attempt} of ${MAX_ATTEMPTS}) → fallback: ${retryHint}; after ${MAX_ATTEMPTS} attempts the tidy parent-gate backstop recovers the parent`);
    const item = { entry: formatEntry({ status: 'SKIP', now: stamp, step: ATTEMPT_STEP, text, reversibility: 'n/a' }) };
    return write([item], {
      runDir: dir, pr, action: 'skipped', reason: TRANSIENT_REASON, detail: oneLine(condition), attempt,
    });
  };

  if (!envelope || !Array.isArray(envelope.closingSet)) {
    const unreadable = code === 0 && !(envelope && envelope.action);
    let returned;
    if (code !== 0) returned = `exit ${code}`;
    else if (unreadable) returned = 'an unreadable envelope';
    else returned = envelope.action;
    // An unread base or default branch: Step 4.0 closed nothing and carries no closing set (#4549).
    const baseUnchecked = code === 0 && Boolean(envelope && envelope.baseUnchecked === true);
    if (code === TRANSIENT_CLOSING_LINKS_EXIT) {
      const retried = retry(`Step 4.0 returned exit ${code} (a gh failure)`);
      if (retried) return retried;
    }
    if (baseUnchecked) {
      const retried = retry(`Step 4.0 returned ${returned} (the PR's base or the default branch could not be read)`);
      if (retried) return retried;
    }
    const item = { entry: formatEntry({ status: 'SKIP', now: stamp, step: MARKER_STEP, text: composeSkipText(returned), reversibility: 'n/a' }) };
    // `step40Failed` is the structured signal that Step 4.0 itself failed (non-zero exit, an unreadable
    // envelope, or an unread base), as opposed to an envelope that legitimately carries no closing set (`not-merged`, …).
    return write([item], {
      runDir: dir, pr, action: 'ran', closingLinks: returned, parentsClosed: 0, ...(code !== 0 || unreadable || baseUnchecked ? { step40Failed: true } : {}), ...recordsOf(envelope),
    });
  }

  // A record a human closed after the close window is closed by their hand: it counts by its live
  // state and stateReason (Step 4.0b's gate), never as a closing record of this merge.
  const afterWindow = new Set(numbers(envelope.closedAfterWindow));
  const closingSet = numbers(envelope.closingSet).filter((n) => !afterWindow.has(n));
  // A `closeFailed[]` record (non-default base: Step 4.0 could not read or close it) is OPEN or unknown,
  // so it holds its parent the way a `failed[]` one does (#4549).
  const unsettled = [
    ...numbers(envelope.reopened), ...numbers(envelope.pendingClose),
    ...issuesOf(envelope.failed), ...issuesOf(envelope.closeFailed),
  ];
  // selfInclude: false (LATE_MERGE_PARAMS) — this runs more than MERGE_GRACE_MS after the merge, so every
  // closing record's live state is the truth: a sub-issue a human reopened since keeps its parent open (#4599).
  // An unreadable policy or a rejected risk-floor skips the close outright (policySkipOf): no gh call.
  const { closed, skipped } = policySkip ? { closed: [], skipped: [policySkip] } : closeParents({
    closingSet, unsettled, mergingPr: pr, owner, repo, host, workLinks, riskFloor, gh: timedGh,
    selfInclude: params.selfInclude,
  });
  const items = closed.map((c) => ({
    entry: formatEntry({
      status: 'AUTO',
      now: stamp,
      step: PARENT_STEP,
      text: `closed parent #${c.parent} below the oversight floor (risk:${c.maxTier}, risk-floor ${riskFloor})`,
      reversibility: 'high (gh issue reopen)',
    }),
  }));
  items.push({
    entry: formatEntry({
      status: 'AUTO',
      now: stamp,
      step: MARKER_STEP,
      text: composeSummaryText({ pr, action: envelope.action, closed, skipped }),
      reversibility: 'n/a',
    }),
  });
  // Step 4.0b's failed closes, for a caller that must not report them as a clean run (postMergeOne only).
  const parentFailures = includeRecords ? {
    parentFailures: skipped.filter((s) => !DELIBERATE_PARENT_SKIPS.has(s.reason)).map((s) => ({
      ...(s.parent !== undefined && s.parent !== null ? { parent: s.parent } : {}),
      ...(s.issue !== undefined && s.issue !== null ? { issue: s.issue } : {}),
      reason: s.reason,
      ...(s.detail ? { detail: boundDetail(oneLine(s.detail)) } : {}),
    })),
  } : {};
  return write(items, {
    runDir: dir, pr, action: 'ran', closingLinks: envelope.action, parentsClosed: closed.length, ...recordsOf(envelope), ...parentFailures,
  }, closed.length);
}

module.exports = {
  postMerge, postMergeOne, prefetchPostMergePrStates, hasPostMergeMarker, takeClaim, composeSkipText, composeSummaryText, boundDetail,
  MARKER_STEP, ATTEMPT_STEP, MAX_ATTEMPTS, CLOSE_WINDOW_MS, MERGE_GRACE_MS, CLAIM_STALE_MS, CLAIM_FILENAME,
};
