// bin/lib/reconcile/red-tip.js — convergence check: unconditional, inform-
// tier detection of a failing CI conclusion on the integration branch's tip.
// The only coverage for direct pushes (fast-lane commits, bookkeeping,
// releases) that no merge gate ever sees — deliberately not gated on the
// `merge-verification` policy value. Checks API only (never the legacy
// commit-status API). Pure decision/parsing functions with I/O at the edges,
// matching console-execute.js's and archive-branches.js's split. Never
// throws out of the hook path — every failure mode (no CI, gh absent, API
// error, unparseable response) resolves to null (no finding), matching
// reconcile's existing degrade posture.
'use strict';
const { execFileSyncTimed } = require('./timing');
const { runGit } = require('../hooks/git-exec');

const FETCH_TIMEOUT_MS = 5000;
// Conclusions that count as red. `in_progress`/`queued` are status values,
// not conclusions, so they never appear here — pending is not red.
// `cancelled`/`neutral`/`stale`/`action_required`/`skipped` are deliberately
// excluded (Non-Goals).
const RED_CONCLUSIONS = new Set(['failure', 'timed_out']);
const MAX_SHOWN = 3;

// checkRuns: [{id,name,conclusion}] -> Map<name, newest run (highest id)>.
// A superseded failed run followed by a newer rerun of the same check name
// must not double-count — this is the sole dedup mechanism red-tip relies
// on. GitHub check-run ids are monotonically increasing, so max-id is a
// sufficient "newest" signal without needing to compare timestamps.
function dedupeNewestByName(checkRuns) {
  const byName = new Map();
  for (const run of checkRuns || []) {
    if (!run || typeof run.name !== 'string') continue;
    const existing = byName.get(run.name);
    if (!existing || run.id > existing.id) byName.set(run.name, run);
  }
  return byName;
}

// Strip control characters (including newlines) from a CI-controlled
// check-run name before it flows into SessionStart's additionalContext —
// that string is agent-visible context, not just display text, so a
// malicious or misconfigured CI integration must not be able to inject
// multi-line content via a check name (#561 review finding: reproduced by
// both Security-lens agents as a prompt-injection-adjacent path). Cap length
// so one long name can't crowd out the "+N more" summary.
function sanitizeCheckName(name) {
  const stripped = name.replace(/[\x00-\x1F\x7F]/g, ' ').trim();
  return stripped.length > 60 ? `${stripped.slice(0, 60)}…` : stripped;
}

// Pure: branch + sha + already-fetched (possibly multi-page) check runs ->
// a finding or null. No I/O — the full decision table (AC1-AC3) is
// unit-testable without a live gh call.
function decideRedTip({ branch, sha, checkRuns }) {
  const byName = dedupeNewestByName(checkRuns);
  const failing = [...byName.values()]
    .filter((r) => RED_CONCLUSIONS.has(r.conclusion))
    .map((r) => r.name)
    .sort();
  if (!failing.length) return null;
  const shortSha = sha.slice(0, 7);
  const shown = failing.slice(0, MAX_SHOWN).map(sanitizeCheckName);
  const more = failing.length - shown.length;
  const suffix = more > 0 ? ` +${more} more` : '';
  const message = `CI is red on ${branch} tip at ${shortSha} — ${shown.join(', ')}${suffix}`;
  return { branch, sha, failing, message };
}

// Pure: raw `gh api --paginate -q '...'` stdout (one compact JSON object per
// line per matched check run, across however many pages were fetched) ->
// { ok: true, runs } | { ok: false, reason: 'unparseable-response' }.
// Exercises the pagination path as a parsing concern, independent of
// however many actual HTTP pages produced the lines.
function parseCheckRunLines(stdout) {
  const lines = (stdout || '').split('\n').filter((l) => l.trim().length > 0);
  const runs = [];
  for (const line of lines) {
    try {
      runs.push(JSON.parse(line));
    } catch {
      return { ok: false, reason: 'unparseable-response' };
    }
  }
  return { ok: true, runs };
}

// I/O: one paginated `gh api` call, newest-run-per-check fields only.
function fetchCheckRuns(repoRoot, sha) {
  let stdout;
  try {
    stdout = execFileSyncTimed(
      'gh',
      [
        'api', '--paginate',
        `repos/{owner}/{repo}/commits/${sha}/check-runs`,
        '-q', '.check_runs[] | {id: .id, name: .name, conclusion: .conclusion}',
      ],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: FETCH_TIMEOUT_MS, windowsHide: true },
    );
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, reason: 'gh-absent' };
    return { ok: false, reason: 'network-failure' };
  }
  return parseCheckRunLines(stdout);
}

// repoRoot, already-resolved integration branch name, optional { onSkip } ->
// finding or null. Reads origin/{integration}'s tip sha from the LOCAL ref —
// deliberately no fetch of its own; this check is wired immediately after
// `mirror` in index.js's ALL_CHECKS specifically so it reads the ref the
// shared fetch (shared-fetch.js, #820 D2 — formerly mirror-ff.js's own
// fetch) just refreshed (see index.js's header comment).
// Every failure mode (no such ref, gh absent, API error, unparseable
// response) still degrades the RETURN VALUE to null — silent no-op, never a
// thrown exception out of the hook path, and unchanged from before (#561's
// own AC3). `onSkip(reason)` is a side-channel only: when provided, it's
// invoked with the specific reason so a caller (index.js) can distinguish
// "genuinely green" from "the check itself failed to run" in `result.skipped`
// — a persistent gh/auth failure otherwise reads identically to a green tip
// forever, with zero observable trace anywhere (#561 review finding,
// reproduced by both Error-Handling-lens agents). Callers that don't pass
// `onSkip` see byte-identical behavior to before this fix.
function redTipCheck(repoRoot, integration, { onSkip } = {}) {
  const tip = runGit(['rev-parse', `origin/${integration}`], repoRoot);
  if (tip.failure) {
    if (onSkip) onSkip('no-integration-ref');
    return null;
  }
  const fetch = fetchCheckRuns(repoRoot, tip.stdout);
  if (!fetch.ok) {
    if (onSkip) onSkip(fetch.reason);
    return null;
  }
  return decideRedTip({ branch: integration, sha: tip.stdout, checkRuns: fetch.runs });
}

module.exports = { redTipCheck, decideRedTip, dedupeNewestByName, parseCheckRunLines, RED_CONCLUSIONS };
