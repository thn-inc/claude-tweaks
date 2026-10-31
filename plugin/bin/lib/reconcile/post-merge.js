// bin/lib/reconcile/post-merge.js — convergence check: run
// _shared/pr-first-merge-post-merge.md's Step 4.0 (closing-links post-merge
// verification) and Step 4.0b (below-floor parent close) once for a PR GitHub
// merged AFTER its session ended — an armed auto-merge, a merge-queue merge —
// so no session ever ran the steps (#4599). Step 4.0 runs bin/closing-links.js;
// Step 4.0b runs lib/issues/below-floor-parent-close.js. Both stay the prose's
// mirrors; this file only decides WHEN they run and records that they did.
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
// Returns { entries, deferred, failure? }. `deferred` lists the run dirs skipped
// for a RETRYABLE reason — archive must not archive them in this pass, or the
// retry never comes (archive-merged.js's `postMergeDeferred`). Exactly four
// reasons are retryable: `merge-grace`, `in-flight`, `claim-failed`, and the
// transient PR lookup failure `network-failure`. Every other skip is NOT
// deferred: `gh-absent`, `dry-run`, `marker-write-failed`, `integration-unknown`
// and the definitive lookup failures (`pr-not-found` — confirmed by pr-state.js
// before it answers, and one of archive's own structurally-stuck reasons —
// `invalid-arguments`, `no-pr-state`), so archive's stuck-run surfacing for
// them stays on. `failure` is `not-github-issues`, `no-remote`, or
// `no-pr-states` (the caller passed no usable PR-state resolver: a bug, never
// a transient answer).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSyncTimed } = require('./timing');
const { listRunDirsWithState } = require('../hooks/context');
const { mainCheckoutRoot } = require('../hooks/worktree-detect');
const { repoSlugOf } = require('../hooks/git-exec');
const { readWorkBackend } = require('../work-backend');
const { resolvePolicyKeys } = require('../policy-schema');
const { appendEntries, formatEntry, parseEntry } = require('../log-decision/append');
const { GH_TIMEOUT_MS } = require('../shared-primitives');
const { closeBelowFloorParents } = require('../issues/below-floor-parent-close');
const { run: closingLinksRun } = require('../../closing-links');

const MARKER_STEP = 'reconcile post-merge';
const PARENT_STEP = 'reconcile post-merge parent-close';
const CLOSE_WINDOW_MS = 10 * 60 * 1000;
const MERGE_GRACE_MS = 10 * 60 * 1000;
const CLAIM_STALE_MS = 10 * 60 * 1000;
const CLAIM_FILENAME = '.post-merge.lock';
// The one prStates failure string worth retrying; every other string is final (see the header).
const TRANSIENT_PR_FAILURE = 'network-failure';

// The merging session's Step 4.0b writes its own marker under this location
// (`spec #N — pr-first-merge Step 4.0b`, or `… (skipped)`); this check writes MARKER_STEP.
const STEP_4_0B_LOCATION_RE = /(?:^|— )pr-first-merge Step 4\.0b\b/;

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

// Pure: the SKIP marker's text for a Step 4.0 that produced no closing set.
function composeSkipText(returned) {
  return oneLine(`condition: Step 4.0 returned ${returned}, no closingSet → fallback: no parent closed; the tidy parent-gate backstop recovers them`);
}

// Pure: the summary marker's text. Names every closed parent's untrusted-comment
// notes, every skip (parent, bare record, or step-wide) and its detail, on one line.
function composeSummaryText({ pr, action, closed, skipped }) {
  let text = `ran Steps 4.0 and 4.0b for PR #${pr}, merged after its session: closing links ${action}; ${closed.length} parent(s) closed`;
  for (const c of closed) {
    if (Array.isArray(c.notes) && c.notes.length) text += `; notes on #${c.parent}: ${c.notes.join(' / ')}`;
  }
  for (const s of skipped) {
    const target = s.parent !== undefined && s.parent !== null ? `#${s.parent}`
      : s.issue !== undefined && s.issue !== null ? `record #${s.issue}`
        : 'step';
    text += `; skipped ${target} (${s.reason}${s.detail ? `: ${s.detail}` : ''})`;
  }
  return oneLine(text);
}

function readDecisions(runDir) {
  try { return fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'); } catch { return ''; }
}

function readPolicyRaw(root) {
  try { return fs.readFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'utf8'); } catch { return null; }
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
    if (hasPostMergeMarker(readDecisions(dir))) continue;
    wanted.add(pr);
  }
  await prStates.prefetch({ numbers: [...wanted] });
}

async function postMerge({
  cwd, integration, prStates, dryRun = false, now = Date.now, deps = {},
} = {}) {
  const entries = [];
  const deferred = [];
  const start = cwd || process.cwd();
  const root = mainCheckoutRoot(start) || start;
  if (readWorkBackend(root) !== 'github-issues') return { entries, deferred, failure: 'not-github-issues' };
  const slug = repoSlugOf(root);
  if (!slug) return { entries, deferred, failure: 'no-remote' };
  // A missing resolver is a caller bug; the per-run catch below must never relabel it a transient network failure.
  if (!prStates || typeof prStates.byNumberAsync !== 'function') return { entries, deferred, failure: 'no-pr-states' };
  const [owner, repo] = slug.split('/');

  const policy = resolvePolicyKeys(['work-links', 'risk-floor'], { policyRaw: readPolicyRaw(root), runConfigRaw: null });
  const workLinks = policy['work-links'].value;
  const riskFloor = policy['risk-floor'].value;

  const timedGh = deps.gh || ((args, input) => execFileSyncTimed('gh', args, {
    cwd: root, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, windowsHide: true,
  }));
  const runClosingLinks = deps.closingLinksRun || closingLinksRun;
  const closeParents = deps.closeParents || closeBelowFloorParents;
  const writeEntries = deps.appendEntries || appendEntries;

  for (const { dir, state } of candidateRuns(root)) {
    const pr = state && state.pr && state.pr.number;
    if (!Number.isInteger(pr) || pr <= 0) continue;
    if (hasPostMergeMarker(readDecisions(dir))) continue;

    let prState;
    try { prState = await prStates.byNumberAsync(pr); } catch { prState = TRANSIENT_PR_FAILURE; } // a real throw from the lookup is a transport failure
    if (!prState || typeof prState !== 'object') {
      const reason = typeof prState === 'string' ? prState : 'no-pr-state';
      entries.push({ runDir: dir, pr, action: 'skipped', reason });
      if (reason === TRANSIENT_PR_FAILURE) deferred.push(dir);
      continue;
    }
    if (prState.state !== 'MERGED') continue;

    const mergedAt = Date.parse(prState.mergedAt);
    if (Number.isNaN(mergedAt) || now() - mergedAt < MERGE_GRACE_MS) {
      entries.push({ runDir: dir, pr, action: 'skipped', reason: 'merge-grace' });
      deferred.push(dir);
      continue;
    }
    if (!integration) {
      entries.push({ runDir: dir, pr, action: 'skipped', reason: 'integration-unknown' });
      continue;
    }
    if (dryRun) {
      entries.push({ runDir: dir, pr, action: 'skipped', reason: 'dry-run' });
      continue;
    }

    if (deps.beforeClaim) deps.beforeClaim(dir);
    const claim = takeClaim(dir, now());
    if (!claim.ok) {
      entries.push({ runDir: dir, pr, action: 'skipped', reason: claim.reason });
      deferred.push(dir);
      continue;
    }
    try {
      // A pass that finished between the first read and the claim wrote its marker already.
      if (hasPostMergeMarker(readDecisions(dir))) continue;
      entries.push(processRun({
        dir, pr, root, owner, repo, workLinks, riskFloor, integration, timedGh, runClosingLinks, closeParents, writeEntries, now,
      }));
    } catch (e) {
      entries.push({ runDir: dir, pr, action: 'skipped', reason: 'error', detail: oneLine(e && e.message ? e.message : e) });
    } finally {
      releaseClaim(dir);
    }
  }
  return { entries, deferred };
}

// Steps 4.0 and 4.0b for one claimed run; the one place the marker is written.
function processRun({
  dir, pr, root, owner, repo, workLinks, riskFloor, integration, timedGh, runClosingLinks, closeParents, writeEntries, now,
}) {
  let out = '';
  const code = runClosingLinks(
    ['--run', dir, '--mode', 'post-merge', '--settle-ms', '0', '--close-window-ms', String(CLOSE_WINDOW_MS)],
    {
      cwd: () => root, mainRoot: root, ghAvailable: () => true, gh: timedGh, stdout: (s) => { out += s; }, stderr: () => {},
    },
  );
  const envelope = code === 0 ? parseEnvelope(out) : null;
  const stamp = now();
  const write = (items, ran) => {
    try {
      writeEntries({ runDir: dir, items });
    } catch {
      return { runDir: dir, pr, action: 'skipped', reason: 'marker-write-failed' };
    }
    return ran;
  };

  if (!envelope || !Array.isArray(envelope.closingSet)) {
    const returned = code !== 0 ? `exit ${code}` : (envelope && envelope.action) || 'an unreadable envelope';
    const item = { entry: formatEntry({ status: 'SKIP', now: stamp, step: MARKER_STEP, text: composeSkipText(returned), reversibility: 'n/a' }) };
    return write([item], { runDir: dir, pr, action: 'ran', closingLinks: returned, parentsClosed: 0 });
  }

  // A record a human closed after the close window is closed by their hand: it counts by its live
  // state and stateReason (Step 4.0b's gate), never as a closing record of this merge.
  const afterWindow = new Set(numbers(envelope.closedAfterWindow));
  const closingSet = numbers(envelope.closingSet).filter((n) => !afterWindow.has(n));
  const unsettled = [
    ...numbers(envelope.reopened), ...numbers(envelope.pendingClose),
    ...(Array.isArray(envelope.failed) ? envelope.failed : []).map((f) => f && f.issue).filter(Number.isInteger),
  ];
  const { closed, skipped } = closeParents({
    closingSet, unsettled, mergingPr: pr, owner, repo, workLinks, riskFloor, integrationBranch: integration, gh: timedGh,
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
  return write(items, { runDir: dir, pr, action: 'ran', closingLinks: envelope.action, parentsClosed: closed.length });
}

module.exports = {
  postMerge, prefetchPostMergePrStates, hasPostMergeMarker, takeClaim, composeSkipText, composeSummaryText,
  MARKER_STEP, CLOSE_WINDOW_MS, MERGE_GRACE_MS, CLAIM_STALE_MS, CLAIM_FILENAME,
};
