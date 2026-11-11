// bin/lib/reconcile/post-merge.js — convergence check: run
// _shared/pr-first-merge-post-merge.md's Step 4.0 (closing-links post-merge
// verification) and Step 4.0b (below-floor parent close) once for a PR GitHub
// merged AFTER its session ended — an armed auto-merge, a merge-queue merge —
// so no session ever ran the steps (#4599). Step 4.0b runs
// lib/issues/below-floor-parent-close.js over lib/issues/parent-gate.js, the
// gate code the prose's bin/parent-gate.js CLI runs. Step 4.0 runs through
// bin/closing-links.js's closingLinks() core, in-process. This file only decides
// WHEN they run and records that they did.
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
// deterministic (3 run dir not anchored, 4 run marker mismatch): those write
// the marker at once.
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
// them stays on. `failure` is `not-github-issues`, `no-remote`, `unknown-host`
// (the origin names a host that is not a known GitHub host, #4933: nothing is sent to gh),
// or `no-pr-states` (the caller passed no usable PR-state resolver: a bug, never
// a transient answer). `unknown-host` adds `detail`, the refusal text naming the
// `GH_HOST=…` opt-in; `postMergeOne`'s entry carries the same `detail`.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSyncTimed } = require('./timing');
const { listRunDirsWithState, readRunState } = require('../hooks/context');
const { mainCheckoutRoot } = require('../hooks/worktree-detect');
const { repoSpecOf } = require('../hooks/git-exec');
const { readWorkBackend } = require('../work-backend');
const { resolvePolicyKeys, POLICY_KEYS } = require('../policy-schema');
const { isAlive: pidAlive } = require('../file-lock');
const { appendEntries, appendEntry, formatEntry, parseEntry } = require('../log-decision/append');
const { GH_TIMEOUT_MS } = require('../shared-primitives');
const { resolveWithin } = require('../path-guard');
const { ghOptions } = require('../repo-resolve');
const { closeBelowFloorParents, DELIBERATE_SKIP_REASONS } = require('../issues/below-floor-parent-close');
const { closingLinks, EXIT_GH_FAILURE, ERR_TEXT_MAX } = require('../../closing-links');

const MARKER_STEP = 'reconcile post-merge';
const PARENT_STEP = 'reconcile post-merge parent-close';
// A transient failure's retry line: a different location from MARKER_STEP, so it is never a marker.
const ATTEMPT_STEP = 'reconcile post-merge attempt';
const MAX_ATTEMPTS = 3;
// A holder whose claim another pass took over (heartbeatClaim found a different token): its entry's `detail`.
// An unreadable own claim (a non-ENOENT read error in heartbeatClaim) is reported with it too: an accepted
// mislabel, the safe stop being the point.
const CLAIM_LOST_DETAIL = 'claim taken over by another pass; stopped before the next gh call or decisions.md write';
// Appended to the location of a decisions.md line a taken-over holder still writes, so the line records the
// GitHub change it made without reading as the run's marker (neither MARKER_STEP nor STEP_4_0B_LOCATION_RE matches).
const SUPERSEDED_LOCATION_SUFFIX = ' (superseded holder)';
// closing-links.js's one transient exit: `gh pr view` / `gh pr edit` failed, or a required read was malformed.
const TRANSIENT_CLOSING_LINKS_EXIT = EXIT_GH_FAILURE;
const TRANSIENT_REASON = 'transient-failure';
const CLOSE_WINDOW_MS = 10 * 60 * 1000;
const MERGE_GRACE_MS = 10 * 60 * 1000;
const CLAIM_STALE_MS = 10 * 60 * 1000;
const CLAIM_FILENAME = '.post-merge.lock';
// The holder refreshes its claim before every `gh` call, so its idle time is at most one call plus seconds of
// non-`gh` work. A call on this path runs once, with no retry, bounded by the 60 s gh-timeout-ms schema ceiling.
// The backstop is at least 2.5x that ceiling (150 s, background-lock.js's ratio), rounded up to 5 minutes:
// reclaiming a live holder costs more than reclaiming a dead one late. A claim whose pid reads live but that
// has sat idle past it belongs to a reused pid or a suspended holder.
const GH_TIMEOUT_CEILING_MS = POLICY_KEYS.find((k) => k.key === 'gh-timeout-ms').max;
const CLAIM_MAX_IDLE_MS = Math.max(5 * 60 * 1000, 2.5 * GH_TIMEOUT_CEILING_MS);
// The bound on a judging pass's rename-to-link-back sequence (a few synchronous fs calls). A `.stale-` aside
// older than this is an orphan, never proof that its content's holder still owns the claim.
const CLAIM_ASIDE_MAX_AGE_MS = 60 * 1000;
// The one prStates failure string worth retrying; every other string is final (see the header).
const TRANSIENT_PR_FAILURE = 'network-failure';
// Step 4.0b skips that are deliberate gate outcomes, not failures: below-floor-parent-close.js's own list,
// owned by the module that emits them. Every other reason — `gh-failed`, `internal-error`, the step-wide
// `unreadable-policy` (this file's policySkipOf) / `invalid-risk-floor`, and any reason added later — is a
// failure, so a new skip surfaces loudly rather than reading as a clean close.
const DELIBERATE_PARENT_SKIPS = new Set(DELIBERATE_SKIP_REASONS);
// The routing of a `postMerge` or `postMergeOne` entry (postMergeOne's `verdict` and `next`, which
// wrap-up/merge-mode.md reads; the verdict hooks.js's background summary and format-summary.js read off a loop
// entry): classified here, never in the prose ([IL-168]). Both lists run in the deny direction, like
// DELIBERATE_PARENT_SKIPS: a Step 4.0 action word not in CLEAN_CLOSING_LINKS — a failure word, the `exit {n}`
// stand-in, a word closing-links.js adds later — is a `failed` run, and a skip reason
// not named below gets `next: none`.
// closing-links.js's post-merge action words a clean run carries.
const CLEAN_CLOSING_LINKS = new Set(['nothing-closed', 'closed', 'reopened', 'no-fixes-span', 'not-merged', 'no-pr']);
// Marker-less skips a re-run retries: no marker is written yet, so the closes run again.
const RERUN_REASONS = new Set(['transient-failure', 'network-failure', 'claim-failed', 'marker-write-failed', 'error']);
// A skip a re-run retries only from an environment that can run the closes.
const RERUN_WHERE_GH_REASONS = new Set(['gh-absent']);

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

// Pure: a decisions.md entry line -> the same line with SUPERSEDED_LOCATION_SUFFIX on its location (time, status
// and action byte-for-byte); any string parseEntry does not read as an entry comes back unchanged.
function markSuperseded(entry) {
  const parsed = parseEntry(entry);
  return parsed
    ? `- ${parsed.status} ${parsed.time} — ${parsed.location}${SUPERSEDED_LOCATION_SUFFIX}: ${parsed.action}`
    : entry;
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

// Pure: is this claim reclaimable? `content` is the claim file's text, `mtimeMs` its last refresh. A claim
// naming an owner pid (`{pid}-{random}`) is stale once that pid is dead, or once it has sat idle past
// CLAIM_MAX_IDLE_MS (a reused pid, a suspended holder). A claim naming no owner (an empty file: an older
// reconciler's claim, or a new one between its create and its token write; or one whose content could not be
// read) keeps the mtime-only CLAIM_STALE_MS rule.
function claimIsStale(content, mtimeMs, nowMs, isAlive) {
  const m = /^(\d+)-/.exec(content);
  if (!m) return nowMs - mtimeMs >= CLAIM_STALE_MS;
  return !isAlive(Number(m[1])) || nowMs - mtimeMs > CLAIM_MAX_IDLE_MS;
}

// Put a live claim's aside back at the claim path -> true once the claim is there (ours, or a third taker's:
// EEXIST). A link that fails otherwise (a filesystem without hard links) falls back to renaming the aside back.
function restoreAside(aside, lock, fsApi) {
  try {
    fsApi.linkSync(aside, lock);
    return true;
  } catch (e) {
    if (e && e.code === 'EEXIST') return true;
  }
  try {
    fsApi.renameSync(aside, lock);
    return true;
  } catch {
    return false;
  }
}

// Take the per-run claim: `{runDir}/.post-merge.lock`, a plain file created exclusively and holding the
// owner token `{pid}-{random}`. A claim is in flight while its holder is alive and has refreshed it within
// CLAIM_MAX_IDLE_MS (the holder refreshes it before every `gh` call, via heartbeatClaim); a dead holder's
// claim, one idle past that backstop, or one naming no holder past CLAIM_STALE_MS is taken over ATOMICALLY —
// renamed aside first, so of two takeovers only the rename winner goes on to retry the create, once. Returns
// { ok: true, token } | { ok: false, reason: 'in-flight' | 'claim-failed' }; releaseClaim and heartbeatClaim
// act only on a claim that still carries the returned token.
//
// file-lock.js's acquireLock cannot serve here: (a) its reclaim is rm-then-mkdir, so two reclaimers of one
// dead lock can both win — the rename-aside takeover below is what the R3 tests pin; (b) it polls up to
// LOCK_WAIT_MS and returns null both for "held" and for an I/O error, while this pass needs a non-blocking
// take with distinct in-flight / claim-failed reasons that drive archive deferral; (c) its lock is a
// directory with a 5 s ownerless fallback, but older installed reconcilers create and respect
// .post-merge.lock as a plain empty file, so that fallback would steal their live claim after 5 seconds;
// (d) it has no refresh, so a long hold cannot stay fresh to a reader that judges by age. Hence only its
// isAlive probe is reused.
//
// Interop: until every installed build upgrades, an older reconciler still takes over a claim idle past
// CLAIM_STALE_MS by mtime alone and releases unconditionally. The refresh keeps a progressing holder fresh
// to it too.
function takeClaim(runDir, nowMs, fsApi = fs, { isAlive = pidAlive } = {}) {
  const lock = path.join(runDir, CLAIM_FILENAME);
  const token = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  // -> 'ok' | 'exists' | 'failed'. A token that cannot be written leaves no half-made (ownerless) claim behind.
  const create = () => {
    let fd;
    try {
      fd = fsApi.openSync(lock, 'wx');
    } catch (e) {
      return e && e.code === 'EEXIST' ? 'exists' : 'failed';
    }
    try {
      fsApi.writeSync(fd, token);
      fsApi.closeSync(fd);
      return 'ok';
    } catch {
      try { fsApi.closeSync(fd); } catch { /* already closed or never opened */ }
      try { fsApi.unlinkSync(lock); } catch { /* nothing to remove */ }
      return 'failed';
    }
  };
  const created = create();
  if (created === 'ok') return { ok: true, token };
  if (created === 'failed') return { ok: false, reason: 'claim-failed' };
  let mtimeMs;
  try {
    mtimeMs = fsApi.statSync(lock).mtimeMs;
  } catch (e) {
    // The holder released it between our create and this stat: it is in flight, retry next pass.
    return { ok: false, reason: e && e.code === 'ENOENT' ? 'in-flight' : 'claim-failed' };
  }
  // A claim file that exists but cannot be read is ownerless, never claim-failed: it would otherwise be
  // unreclaimable forever.
  let content = '';
  try {
    content = fsApi.readFileSync(lock, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, reason: 'in-flight' }; // released between the stat and the read
  }
  if (!claimIsStale(content, mtimeMs, nowMs, isAlive)) return { ok: false, reason: 'in-flight' };
  const aside = `${lock}.stale-${process.pid}-${Date.now()}`;
  try {
    fsApi.renameSync(lock, aside);
  } catch (e) {
    return { ok: false, reason: e && e.code === 'ENOENT' ? 'in-flight' : 'claim-failed' }; // another taker won the rename
  }
  // The rename moves whatever sits at the path NOW. If another taker finished its whole takeover
  // between our stat and our rename, that is its fresh claim, not the stale one: re-judge the aside's
  // own content and mtime, and put a live one back.
  let asideMtimeMs = mtimeMs;
  let asideContent = content;
  try { asideMtimeMs = fsApi.statSync(aside).mtimeMs; } catch { /* keep the first reading */ }
  try { asideContent = fsApi.readFileSync(aside, 'utf8'); } catch { /* keep the first reading */ }
  if (!claimIsStale(asideContent, asideMtimeMs, nowMs, isAlive)) {
    // Residual window, bounded: the holder may release between our rename and this link, and the link
    // then re-creates a claim that carries the holder's token but that nobody holds. The next pass judges
    // that token's pid: once the holder process has exited it reads dead and is taken over at once; while
    // the process still runs, nothing refreshes the orphan, so it is taken over once idle past
    // CLAIM_MAX_IDLE_MS. An ownerless aside that is linked back keeps the CLAIM_STALE_MS rule.
    // The aside is the only copy of a live holder's claim until it is back at the path, so it is deleted only
    // then; if it cannot be restored, the aside is left for heartbeatClaim to find.
    if (restoreAside(aside, lock, fsApi)) {
      try { fsApi.unlinkSync(aside); } catch { /* orphan left behind, or renamed away: heartbeatClaim ignores it past CLAIM_ASIDE_MAX_AGE_MS */ }
    }
    return { ok: false, reason: 'in-flight' };
  }
  try { fsApi.unlinkSync(aside); } catch { /* orphan left behind: heartbeatClaim ignores it past CLAIM_ASIDE_MAX_AGE_MS */ }
  const retried = create();
  if (retried === 'ok') return { ok: true, token };
  return { ok: false, reason: retried === 'exists' ? 'in-flight' : 'claim-failed' };
}

// Refresh the claim's mtime while it still carries our token -> true when we still own it, else false. A
// falsy token (a `deps.takeClaim` fake's `{ ok: true }`) owns nothing. Never throws; a failed refresh is
// swallowed, ownership still reads true.
//
// A claim missing at its path is not yet a lost one. A pass judging our claim renames it aside
// (`{lock}.stale-{pid}-{ms}`), re-judges the aside, and, finding it live, links it back before unlinking the
// aside: the link-back lands before the aside's unlink, so a live claim is at its path or in an aside. Three
// reads cover that without polling: the claim path (missing), the run dir's young asides, then the claim path
// again (it finds a link-back that finished between the first read and the listing). Only a young aside counts:
// a judger's rename-to-link-back is a few synchronous fs calls, so one more than CLAIM_ASIDE_MAX_AGE_MS from
// `nowMs` in either direction (an old orphan, or a future-dated name) proves nothing. A young aside carrying our
// token is owned only if the judger would find it live on its second look (`claimIsStale`, the same verdict
// takeClaim uses; `isAlive` is the seam): a holder idle past CLAIM_MAX_IDLE_MS has its aside deleted, not
// linked back, and a stat failure on the aside is not owned. No refresh on that path. Residual: a third
// taker's create between the judger's rename and its link-back makes the link-back fail with EEXIST, so a
// live aside can still be deleted; the holder's next check then sees the successor's token.
function heartbeatClaim(runDir, token, nowMs, fsApi = fs, { isAlive = pidAlive } = {}) {
  if (!token) return false;
  const lock = path.join(runDir, CLAIM_FILENAME);
  const refresh = () => {
    try { fsApi.utimesSync(lock, nowMs / 1000, nowMs / 1000); } catch { /* ownership is still ours */ }
  };
  const readClaim = () => {
    try { return { content: fsApi.readFileSync(lock, 'utf8') }; } catch (e) { return { code: e && e.code }; }
  };
  const first = readClaim();
  if (first.content !== undefined) {
    if (first.content !== token) return false;
    refresh();
    return true;
  }
  // Fails closed: an unreadable own claim (not ENOENT) is not owned (the CLAIM_LOST_DETAIL mislabel, accepted).
  if (first.code !== 'ENOENT') return false;
  const asidePrefix = `${CLAIM_FILENAME}.stale-`;
  let names = [];
  try { names = fsApi.readdirSync(runDir); } catch { /* fall through to the re-read */ }
  for (const name of names) {
    if (!name.startsWith(asidePrefix)) continue;
    const m = /^\d+-(\d+)$/.exec(name.slice(asidePrefix.length));
    if (!m || Math.abs(nowMs - Number(m[1])) > CLAIM_ASIDE_MAX_AGE_MS) continue;
    try {
      const asidePath = path.join(runDir, name);
      if (fsApi.readFileSync(asidePath, 'utf8') === token) {
        // The judger's own verdict on this aside: owned only if it would link it back.
        return !claimIsStale(token, fsApi.statSync(asidePath).mtimeMs, nowMs, isAlive);
      }
    } catch { /* gone, or unstattable: the link-back or the unlink finished, or not owned */ }
  }
  const second = readClaim();
  if (second.content !== token) return false;
  refresh();
  return true;
}

// Remove the claim only while it still carries our token, so a holder whose claim was taken over never
// deletes its successor's. A falsy token is a no-op. Never throws. Residual: a holder suspended past
// CLAIM_MAX_IDLE_MS exactly between the read and the unlink is taken over in that gap and still deletes its
// successor's claim.
function releaseClaim(runDir, token, fsApi = fs) {
  if (!token) return;
  const lock = path.join(runDir, CLAIM_FILENAME);
  try {
    if (fsApi.readFileSync(lock, 'utf8') === token) fsApi.unlinkSync(lock);
  } catch { /* already gone, or unreadable: nothing of ours to remove */ }
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
// the merge, with closing-links' default settle poll and the merging PR itself counted (null = option omitted:
// closingLinks()'s own default).
const LATE_MERGE_PARAMS = { settleMs: 0, closeWindowMs: CLOSE_WINDOW_MS, selfInclude: false };
const IN_SESSION_PARAMS = { settleMs: null, closeWindowMs: null, selfInclude: true };

// -> { failure } when this project or caller cannot run the check, else the context both paths share.
function setupContext({ cwd, deps }) {
  const start = cwd || process.cwd();
  const root = mainCheckoutRoot(start) || start;
  if (readWorkBackend(root) !== 'github-issues') return { failure: 'not-github-issues' };
  // The host too: off github.com, Step 4.0b's gh calls name it (`--repo host/owner/repo`, `--hostname`).
  // #4933: an origin on an unknown host is refused before any gh call; `detail` carries the opt-in text.
  const repoSpec = repoSpecOf(root, deps.gateDeps);
  if (!repoSpec) return { failure: 'no-remote' };
  if (repoSpec.refusal) return { failure: 'unknown-host', detail: repoSpec.refusal };
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
  const runClosingLinks = deps.closingLinks || closingLinks;
  const closeParents = deps.closeParents || closeBelowFloorParents;
  const writeEntries = deps.appendEntries || appendEntries;

  return {
    root, owner, repo, host, workLinks, riskFloor, policySkip, timedGh, runClosingLinks, closeParents, writeEntries,
  };
}

// One run through the guards and, when it clears them, Steps 4.0 and 4.0b. Order: recorded PR -> marker ->
// PR state -> MERGED -> grace -> dry-run -> budget -> claim -> marker re-read -> processRun -> release.
// -> { entry, defer }: `entry` null is a silent skip; `defer` says archive must keep the run for a retry.
// `single` (postMergeOne) runs inside the grace under the in-session parameters instead of skipping it,
// skips an unreadable mergedAt as `merged-at-unreadable`, and returns its silent skips (`no-pr`,
// `already-done`, `not-merged`) as entries.
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
  // Single-run: an unreadable mergedAt leaves the merge's age unknown, and the in-session arguments carry no
  // close-window bound (unsafe on a late merge), so it fails closed — no claim, no marker, nothing run. The
  // loop defers the same case as merge-grace below.
  if (single && Number.isNaN(mergedAt)) return { entry: skipped('merged-at-unreadable'), defer: false };
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
    // The ownership check lives on the shared `gh` function and before every decisions.md write, so every loop
    // in Steps 4.0 and 4.0b is covered and a taken-over holder stops before its next call or write. Residual: a
    // `gh` call already in flight when the holder is suspended still completes on wake; the check decides
    // before a call, never during one. A takeover between the write guard's ownership check and `writeEntries`
    // likewise lets that one write through (the accepted guard-to-call window). Step 4.0b posts a parent's close
    // comment and closes it with a separate gh call, so a takeover between them leaves a posted comment with no
    // close and no superseded line; the successor's pass finds it (close-only) and finishes the close. A falsy
    // token (a `deps.takeClaim` fake) never loses.
    const guard = { lost: false };
    const ownsClaim = () => {
      if (!guard.lost && claim.token && !heartbeatClaim(dir, claim.token, now())) guard.lost = true;
      return !guard.lost;
    };
    const runCtx = {
      ...ctx,
      timedGh: (args, input) => {
        if (!ownsClaim()) throw Object.assign(new Error(CLAIM_LOST_DETAIL), { code: 'ECLAIMLOST' });
        return ctx.timedGh(args, input);
      },
    };
    const entry = processRun({
      dir, pr, ...runCtx, ownsClaim, now, params: inGrace ? IN_SESSION_PARAMS : LATE_MERGE_PARAMS, retryHint, includeRecords,
    });
    return { entry, defer: entry.reason === TRANSIENT_REASON || entry.reason === 'in-flight' };
  } catch (e) {
    return { entry: skipped('error', { detail: oneLine(e && e.message ? e.message : e) }), defer: false };
  } finally {
    releaseClaim(dir, claim.token);
  }
}

async function postMerge({
  cwd, prStates, dryRun = false, now = Date.now, budgetExceeded, deps = {},
} = {}) {
  const entries = [];
  const deferred = [];
  const ctx = setupContext({ cwd, deps });
  if (ctx.failure) return { entries, deferred, failure: ctx.failure, ...(ctx.detail ? { detail: ctx.detail } : {}) };
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

// Pure: a `postMerge` or `postMergeOne` entry -> { verdict, next, failedSteps? }. `verdict`: `clean` (a `ran`
// entry whose Step 4.0 word is clean, with no `step40Failed` and no `parentFailures` element), `already-done`,
// `in-flight`, or `failed` (every other entry). A `failed` `ran` entry adds `failedSteps`, the steps that failed in order:
// `4.0` when `step40Failed` is set or its word is not clean, `4.0b` when `parentFailures` is non-empty —
// so a caller reports only the step that failed. `next`: `rerun` (a marker-less skip a re-run retries),
// `rerun-where-gh`, `rerun-after-stale-claim` (an archived run's `in-flight`: its holder can only be another
// merge-mode invocation, so a re-run takes over a dead holder's claim at once, a live holder's claim it has not
// refreshed for CLAIM_MAX_IDLE_MS, and a claim naming no holder once past CLAIM_STALE_MS), or `none` — a `ran`
// entry's marker is already written, and every other skip fails the same way again.
function classifyEntry(entry, { archived = false } = {}) {
  if (entry.action === 'ran') {
    const step40Failed = entry.step40Failed === true || !CLEAN_CLOSING_LINKS.has(entry.closingLinks);
    const parentFailed = Array.isArray(entry.parentFailures) && entry.parentFailures.length > 0;
    if (!step40Failed && !parentFailed) return { verdict: 'clean', next: 'none' };
    const failedSteps = [...(step40Failed ? ['4.0'] : []), ...(parentFailed ? ['4.0b'] : [])];
    return { verdict: 'failed', next: 'none', failedSteps };
  }
  if (entry.reason === 'already-done') return { verdict: 'already-done', next: 'none' };
  if (entry.reason === 'in-flight') return { verdict: 'in-flight', next: archived ? 'rerun-after-stale-claim' : 'none' };
  if (RERUN_REASONS.has(entry.reason)) return { verdict: 'failed', next: 'rerun' };
  if (RERUN_WHERE_GH_REASONS.has(entry.reason)) return { verdict: 'failed', next: 'rerun-where-gh' };
  return { verdict: 'failed', next: 'none' };
}

// The one rule for "this `ran` entry failed", shared by the background summary, the CLI's failed row and
// failedRecordNumbers so a count and its record list cannot disagree. A `skipped` entry is never a failed run
// here: classifyEntry reads every `skipped` entry as failed, `transient-failure` included.
function isFailedRun(entry) {
  return entry.action === 'ran' && classifyEntry(entry).verdict === 'failed';
}

// Pure: postMerge entries -> the sorted, unique issue numbers across the four `records` lists (Step 4.0's
// `failed`, `closeFailed`, `pendingClose`, `unchecked`) of the failed runs (isFailedRun). A missing `records`,
// or a list that is not an array, contributes nothing.
function failedRecordNumbers(entries) {
  const numbersOf = (e) => {
    const records = e.records || {};
    return [records.failed, records.closeFailed, records.pendingClose, records.unchecked].flatMap((list) => (Array.isArray(list) ? list : []));
  };
  return [...new Set((entries || [])
    .filter(isFailedRun)
    .flatMap(numbersOf))].sort((a, b) => a - b);
}

// Pure: entries -> one `{ pr, ...}` element per element of each entry's array `field`, in entry order, whatever the
// entry's action or verdict. `keys` names the element fields kept; `detail` is never one: it is forge-supplied text
// (a gh error body, a policy path), and these elements become lines in SessionStart's model-facing context, so only
// the fixed `reason` word and the numeric ids travel; the bounded `detail` stays in `decisions.md` and the CLI JSON.
// A missing or non-array input, a non-array field and a non-object element contribute nothing.
function flattenStepFields(entries, field, keys) {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((e) => {
    const items = e && Array.isArray(e[field]) ? e[field] : [];
    return items
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        pr: e.pr,
        ...Object.fromEntries(keys.filter((k) => item[k] !== undefined && item[k] !== null).map((k) => [k, item[k]])),
      }));
  });
}

// Pure: entries -> the parents Step 4.0b left open, `{ pr, parent?, issue?, reason }` per `parentFailures` element.
function parentsLeftOpen(entries) {
  return flattenStepFields(entries, 'parentFailures', ['parent', 'issue', 'reason']);
}

// Pure: entries -> the step-wide skips of Step 4.0b (nothing left to close), `{ pr, reason }` per `stepSkips` element.
function stepSkipsOf(entries) {
  return flattenStepFields(entries, 'stepSkips', ['reason']);
}

// A line item is a non-null object with an integer `pr` and a string `reason`; anything else is skipped.
const isLineItem = (item) => item !== null && typeof item === 'object' && Number.isInteger(item.pr) && typeof item.reason === 'string';

// Who a parentsLeftOpen item names: its parent, the parent of its record, or (naming neither) every parent.
function parentSubject(item) {
  if (Number.isInteger(item.parent)) return `#${item.parent}`;
  if (Number.isInteger(item.issue)) return `the parent of record #${item.issue}`;
  return 'every parent';
}

// Pure: parentsLeftOpen's items -> the one report line, or null when the input is not an array or holds no valid item.
function parentsLeftOpenLine(items) {
  const rendered = (Array.isArray(items) ? items : []).filter(isLineItem)
    .map((item) => `${parentSubject(item)} (${item.reason}, PR #${item.pr})`);
  return rendered.length > 0
    ? `post-merge Step 4.0b left parent record(s) open: ${rendered.join(', ')} — tidy's parent-gate backstop recovers them`
    : null;
}

// Pure: stepSkipsOf's items -> the one report line, or null likewise.
function stepSkipsLine(items) {
  const rendered = (Array.isArray(items) ? items : []).filter(isLineItem).map((item) => `${item.reason} (PR #${item.pr})`);
  return rendered.length > 0
    ? `post-merge Step 4.0b skipped step-wide, leaving no parent open (nothing left to close): ${rendered.join(', ')}`
    : null;
}

// A holder whose claim another pass took over: the in-flight skip processRun returns with CLAIM_LOST_DETAIL.
const isSupersededEntry = (entry) => !!entry && entry.action === 'skipped' && entry.reason === 'in-flight' && entry.detail === CLAIM_LOST_DETAIL;

// The integer elements of a record list, or null when none remain.
const recordNumbers = (list) => {
  const numbers = Array.isArray(list) ? list.filter(Number.isInteger) : [];
  return numbers.length > 0 ? numbers : null;
};

// Pure: entries -> `{ pr, parentsClosed?, recordsReopened?, recordsClosed? }` per superseded entry that changed
// anything on GitHub, in entry order. Numbers only: the list reaches SessionStart's model-facing context, so no
// forge text travels (the rule flattenStepFields states). A non-array input gives [].
function supersededChanges(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((e) => isSupersededEntry(e) && Number.isInteger(e.pr)).map((e) => {
    const reopened = recordNumbers(e.recordsReopened);
    const closed = recordNumbers(e.recordsClosed);
    return {
      pr: e.pr,
      ...(Number.isInteger(e.parentsClosed) && e.parentsClosed > 0 ? { parentsClosed: e.parentsClosed } : {}),
      ...(reopened ? { recordsReopened: reopened } : {}),
      ...(closed ? { recordsClosed: closed } : {}),
    };
  }).filter((item) => item.parentsClosed !== undefined || item.recordsReopened !== undefined || item.recordsClosed !== undefined);
}

// Pure: supersededChanges' items -> the one report line, or null when the input is not an array or no element
// carries an integer `pr` and at least one change. Shared by the reconcile CLI summary and SessionStart.
function supersededChangesLine(items) {
  const rendered = (Array.isArray(items) ? items : []).filter((item) => item !== null && typeof item === 'object' && Number.isInteger(item.pr)).map((item) => {
    const reopened = recordNumbers(item.recordsReopened);
    const closed = recordNumbers(item.recordsClosed);
    const parts = [
      ...(Number.isInteger(item.parentsClosed) && item.parentsClosed > 0 ? [`closed ${item.parentsClosed} parent record(s) below the oversight floor`] : []),
      ...(reopened ? [`reopened ${reopened.map((n) => `#${n}`).join(', ')}`] : []),
      ...(closed ? [`closed ${closed.map((n) => `#${n}`).join(', ')}`] : []),
    ];
    return parts.length > 0 ? `PR #${item.pr} ${parts.join(', ')}` : null;
  }).filter(Boolean);
  return rendered.length > 0
    ? `post-merge steps in run(s) whose claim another pass took over had already changed GitHub: ${rendered.join('; ')}`
    : null;
}

// The single-run path (see the header): one named run dir, archived included. -> one entry:
// { runDir, pr, action, reason?, detail?, closingLinks?, parentsClosed?, recordsReopened?, recordsClosed?,
//   attempt?, step40Failed?, records?, logFailed?, parentFailures?, stepSkips?, verdict, next }
//   (classifyEntry's two fields close every entry).
async function postMergeOne({
  runDir: givenRunDir, cwd, prStates, now = Date.now, deps = {},
} = {}) {
  // One absolute path for every read, the claim file and closing-links' `--run`, whatever the process cwd is.
  const runDir = path.resolve(cwd || process.cwd(), givenRunDir);
  const classified = (entry, archived = false) => ({ ...entry, ...classifyEntry(entry, { archived }) });
  const ctx = setupContext({ cwd, deps });
  if (ctx.failure) {
    return classified({
      runDir, pr: null, action: 'skipped', reason: ctx.failure, ...(ctx.detail ? { detail: ctx.detail } : {}),
    });
  }
  if (!prStates || typeof prStates.byNumberAsync !== 'function') return classified({ runDir, pr: null, action: 'skipped', reason: 'no-pr-states' });
  const archived = isArchivedRunDir(runDir, ctx.root);
  const retryHint = archived ? archivedRetryHint(runDir) : RECONCILE_RETRY_HINT;
  const { entry } = await processCandidate({
    dir: runDir, state: readRunState(runDir), ctx, prStates, dryRun: false, now, deps, single: true, retryHint, includeRecords: true,
  });
  return classified(entry, archived);
}

// Steps 4.0 and 4.0b for one claimed run; the one place the marker is written.
// `params` is { settleMs, closeWindowMs, selfInclude } (see LATE_MERGE_PARAMS); `retryHint` the retry clause
// of an attempt line; `includeRecords` adds Step 4.0's record lists and `logFailed` to a `ran` entry, and makes
// its `parentFailures` always present on an entry that reached Step 4.0b (postMergeOne only). A loop `ran` entry
// whose Step 4.0 word is not clean carries the record lists and `logFailed` too (#4897); a clean one keeps its
// short shape. Step 4.0b's `parentFailures` rides on a loop entry whenever it is non-empty, and `stepSkips` on
// either path when non-empty.
function processRun({
  dir, pr, root, owner, repo, host, workLinks, riskFloor, policySkip, timedGh, runClosingLinks, closeParents, writeEntries, now,
  params = LATE_MERGE_PARAMS, retryHint = RECONCILE_RETRY_HINT, includeRecords = false,
  ownsClaim = () => true, appendDecision = appendEntry,
}) {
  // A holder whose claim another pass took over: in-flight and deferred (the successor owns the run). The entry
  // names what this pass already changed on GitHub, so no report reads it as a no-op: Step 4.0b's closed
  // parents, and Step 4.0's reopened / (non-default base) closed records from its envelope.
  const lostEntry = (parentsClosed, env) => {
    const reopened = numbers(env && env.reopened);
    const closedRecords = numbers(env && env.closed);
    return {
      runDir: dir,
      pr,
      action: 'skipped',
      reason: 'in-flight',
      detail: CLAIM_LOST_DETAIL,
      ...(parentsClosed > 0 ? { parentsClosed } : {}),
      ...(reopened.length > 0 ? { recordsReopened: reopened } : {}),
      ...(closedRecords.length > 0 ? { recordsClosed: closedRecords } : {}),
    };
  };
  const { code, envelope } = runClosingLinks(
    {
      run: dir, mode: 'post-merge',
      ...(params.settleMs !== null ? { settleMs: params.settleMs } : {}),
      ...(params.closeWindowMs !== null ? { closeWindowMs: params.closeWindowMs } : {}),
    },
    {
      cwd: () => root,
      mainRoot: root,
      ghAvailable: () => true,
      gh: timedGh,
      stderr: () => {},
      // In post-merge mode closing-links.js writes an `AUTO` line only for a GitHub change it made; its `SKIP`
      // lines are the degraded / unchecked trace, which belong to the successor's run once ours is taken over.
      appendDecision: (args) => {
        if (ownsClaim()) return appendDecision(args);
        const e = parseEntry(args.entry);
        if (e && e.status === 'AUTO') return appendDecision({ ...args, entry: markSuperseded(args.entry) });
        return undefined;
      },
    },
  );
  if (!ownsClaim()) return lostEntry(0, envelope);
  // Step 4.0's record lists (issue numbers) and its `logFailed` flag (a decisions.md line it could not
  // append), for a caller that surfaces them. Emitted when the caller asked (`includeRecords`: any
  // envelope) or when the envelope's word is not clean, so the background summary can name the records a
  // failed close left (#4897); omitted with no envelope (a non-zero exit).
  const wantsRecords = (env) => includeRecords || (env.action && !CLEAN_CLOSING_LINKS.has(env.action));
  const recordsOf = (env) => (env && wantsRecords(env) ? {
    records: {
      failed: issuesOf(env.failed),
      closeFailed: issuesOf(env.closeFailed),
      pendingClose: numbers(env.pendingClose),
      unchecked: numbers(env.unchecked),
    },
    ...(env.logFailed === true ? { logFailed: true } : {}),
  } : {});
  const stamp = now();
  // A failed write still reports the parents Step 4.0b closed (they are closed on GitHub either way) and keeps
  // its `extra` fields (parentFailures, stepSkips): the failure is real whether or not the marker landed (#4798).
  // `githubChanges`: the items that record a GitHub change this pass made; a taken-over holder still logs
  // those (marked superseded), and nothing else, so the successor owns the marker and every trace line.
  const write = (items, ran, parentsClosed = 0, extra = {}, githubChanges = []) => {
    if (!ownsClaim()) {
      if (githubChanges.length > 0) {
        try {
          writeEntries({ runDir: dir, items: githubChanges.map((i) => ({ ...i, entry: markSuperseded(i.entry) })) });
        } catch { /* the returned entry still reports the changes */ }
      }
      return lostEntry(parentsClosed, envelope);
    }
    try {
      writeEntries({ runDir: dir, items });
    } catch {
      return { runDir: dir, pr, action: 'skipped', reason: 'marker-write-failed', parentsClosed, ...extra };
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
    const returned = code !== 0 ? `exit ${code}` : envelope.action;
    // An unread base or default branch: Step 4.0 closed nothing and carries no closing set (#4549).
    const baseUnchecked = code === 0 && envelope.baseUnchecked === true;
    if (code === TRANSIENT_CLOSING_LINKS_EXIT) {
      const retried = retry(`Step 4.0 returned exit ${code} (a gh failure)`);
      if (retried) return retried;
    }
    if (baseUnchecked) {
      const retried = retry(`Step 4.0 returned ${returned} (the PR's base or the default branch could not be read)`);
      if (retried) return retried;
    }
    const item = { entry: formatEntry({ status: 'SKIP', now: stamp, step: MARKER_STEP, text: composeSkipText(returned), reversibility: 'n/a' }) };
    // `step40Failed` is the structured signal that Step 4.0 itself failed (non-zero exit or an unread base),
    // as opposed to an envelope that legitimately carries no closing set (`not-merged`, …).
    return write([item], {
      runDir: dir, pr, action: 'ran', closingLinks: returned, parentsClosed: 0, ...(code !== 0 || baseUnchecked ? { step40Failed: true } : {}), ...recordsOf(envelope),
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
  // Step 4.0b's failed closes, for a caller that must not report them as a clean run. With an empty effective
  // closing set there is no parent to leave open, so a failure naming neither `parent` nor `issue` (a step-wide
  // skip, whatever its reason) is a `stepSkips` element instead; every other failure is a `parentFailures` one.
  // `parentFailures` rides on a loop entry only when non-empty (always present under `includeRecords`);
  // `stepSkips` only when non-empty. Both ride on the `marker-write-failed` entry and on the error entry below.
  const failures = skipped.filter((s) => !DELIBERATE_PARENT_SKIPS.has(s.reason)).map((s) => ({
    ...(s.parent !== undefined && s.parent !== null ? { parent: s.parent } : {}),
    ...(s.issue !== undefined && s.issue !== null ? { issue: s.issue } : {}),
    reason: s.reason,
    ...(s.detail ? { detail: boundDetail(oneLine(s.detail)) } : {}),
  }));
  const isStepWide = (f) => closingSet.length === 0 && !('parent' in f) && !('issue' in f);
  const parentFailures = failures.filter((f) => !isStepWide(f));
  const stepSkips = failures.filter(isStepWide).map((f) => ({ reason: f.reason, ...('detail' in f ? { detail: f.detail } : {}) }));
  const stepFields = {
    ...(includeRecords || parentFailures.length > 0 ? { parentFailures } : {}),
    ...(stepSkips.length > 0 ? { stepSkips } : {}),
  };
  try {
    const parentItems = closed.map((c) => ({
      entry: formatEntry({
        status: 'AUTO',
        now: stamp,
        step: PARENT_STEP,
        text: `closed parent #${c.parent} below the oversight floor (risk:${c.maxTier}, risk-floor ${riskFloor})`,
        reversibility: 'high (gh issue reopen)',
      }),
    }));
    const markerItem = {
      entry: formatEntry({
        status: 'AUTO',
        now: stamp,
        step: MARKER_STEP,
        text: composeSummaryText({ pr, action: envelope.action, closed, skipped }),
        reversibility: 'n/a',
      }),
    };
    return write([...parentItems, markerItem], {
      runDir: dir, pr, action: 'ran', closingLinks: envelope.action, parentsClosed: closed.length, ...recordsOf(envelope), ...stepFields,
    }, closed.length, stepFields, parentItems);
  } catch (e) {
    // A throw after closeParents returned must not drop the split fields: processCandidate's catch would (#4798 Decision Q5).
    // The closes already happened on GitHub, so the entry still reports them.
    return {
      runDir: dir, pr, action: 'skipped', reason: 'error', detail: oneLine(e && e.message ? e.message : e), parentsClosed: closed.length, ...stepFields,
    };
  }
}

module.exports = {
  postMerge, postMergeOne, classifyEntry, markSuperseded, isFailedRun, failedRecordNumbers, parentsLeftOpen, stepSkipsOf, parentsLeftOpenLine, stepSkipsLine, isSupersededEntry, supersededChanges, supersededChangesLine, prefetchPostMergePrStates, hasPostMergeMarker, takeClaim, heartbeatClaim, releaseClaim,
  composeSkipText, composeSummaryText, boundDetail, oneLine,
  CLEAN_CLOSING_LINKS, RERUN_REASONS, RERUN_WHERE_GH_REASONS,
  MARKER_STEP, ATTEMPT_STEP, MAX_ATTEMPTS, CLOSE_WINDOW_MS, MERGE_GRACE_MS, CLAIM_STALE_MS, CLAIM_FILENAME,
  CLAIM_MAX_IDLE_MS, GH_TIMEOUT_CEILING_MS, CLAIM_ASIDE_MAX_AGE_MS, CLAIM_LOST_DETAIL, SUPERSEDED_LOCATION_SUFFIX,
};
