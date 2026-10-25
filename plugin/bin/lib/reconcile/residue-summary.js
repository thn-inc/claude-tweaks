// bin/lib/reconcile/residue-summary.js — the one-line reconcile residue
// summary `/claude-tweaks:flow`'s closing report renders (#644 Deliverable
// 3): `reconcile: {archived} archived, {stuck} stuck (oldest {age}), mirror
// ff {declined-or-ok}`. Sourced entirely from data reconcile() already
// produces: `archiveMerged`'s own `runs` tally (already on the returned
// `result`) and the residue counter cache `archiveMerged`/`reapMerged`
// persist as part of #644 Deliverable 2 — no new git/gh call, no new
// filesystem scan beyond the cache read those two checks already do.
'use strict';
const { listResidueFailures } = require('./cache');

function humanAge(ms) {
  if (!(ms > 0)) return '0m';
  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;
  const minute = 60 * 1000;
  if (ms >= day) return `${Math.floor(ms / day)}d`;
  if (ms >= hour) return `${Math.floor(ms / hour)}h`;
  return `${Math.max(1, Math.floor(ms / minute))}m`;
}

// mirrorFastForward's result shape (mirror-ff.js): { state, action, reason?, warning? }.
function mirrorFfPart(mirror) {
  if (!mirror) return 'n/a';
  if (mirror.state === 'dirty') return `declined — ${mirror.reason || 'dirty'}`;
  if (mirror.action === 'fast-forwarded') return 'ok';
  if (mirror.action === 'none' && mirror.state === 'current') return 'ok';
  if (mirror.action === 'none') return `anomaly — ${mirror.state}`;
  if (mirror.action === 'skipped') return `skipped — ${mirror.reason || 'unknown'}`;
  if (mirror.action === 'failed') return `failed — ${mirror.reason || 'unknown'}`;
  return 'n/a';
}

// A live reconcile() result's own `runs` array -> the archived count, the
// same tally `bin/hooks.js reconcile-background`'s own summary object
// already computes the same way (`(r.runs || []).filter(action==='archived')`)
// — kept as one function so the two call sites (a fresh in-process
// reconcile() result, and the CLI below re-deriving the equivalent from a
// persisted background-status summary) never drift apart.
function archivedCountFromRunsResult(result) {
  return Array.isArray(result && result.runs)
    ? result.runs.filter((r) => r.action === 'archived').length
    : 0;
}

// (root, { archivedCount, mirror }, now?) -> the one-line summary string.
// Decoupled from reconcile()'s exact `result` shape (rather than taking the
// raw result object) so it composes equally from a fresh in-process call
// (`archivedCountFromRunsResult(result)`, `result.mirror`) or from
// `reconcile-background-status.json`'s persisted `summary.archived` plus a
// separate live mirror-only check — see `bin/hooks.js`'s `reconcile-summary`
// subcommand, the actual call site `/claude-tweaks:flow`'s closing report
// shells out to (mirror only ever runs inline at SessionStart today — see
// session-start.js's FAST_CHECKS comment — so a call site with no in-process
// reconcile() result of its own has nothing else to source it from).
function formatReconcileSummary(root, { archivedCount = 0, mirror = null } = {}, now = Date.now()) {
  const stuck = listResidueFailures(root);
  const oldest = stuck.reduce((min, e) => (min === null || e.firstFailedAt < min ? e.firstFailedAt : min), null);
  const stuckPart = oldest === null
    ? `${stuck.length} stuck`
    : `${stuck.length} stuck (oldest ${humanAge(now - oldest)})`;
  // #4180: a failed escalate/resolve rides on its entry (`lastResidueError`, cache.js) — name the
  // count and the latest one here so a swallowed failure is visible at the closing report. With none
  // tracked the line is unchanged.
  const errored = stuck.filter((e) => e.lastResidueError);
  const latest = errored.reduce((best, e) => (best === null || e.lastResidueError.at > best.lastResidueError.at ? e : best), null);
  const errorPart = latest === null
    ? ''
    : `, ${errored.length} residue error(s) (last: ${latest.lastResidueError.op} — ${latest.lastResidueError.reason})`;
  return `reconcile: ${archivedCount} archived, ${stuckPart}, mirror ff ${mirrorFfPart(mirror)}${errorPart}`;
}

// reconcile()'s `residueErrors` list -> its newest entry as `{ op, error }`, or null when empty. A prune
// failure (`at: null`) belongs to the pass that just ran, so it outranks every recorded `at`. Feeds
// the `reconcile-background` status summary (#4180).
function latestResidueError(errors) {
  if (!Array.isArray(errors) || !errors.length) return null;
  const rank = (e) => (typeof e.at === 'number' ? e.at : Infinity);
  const latest = errors.reduce((best, e) => (rank(e) >= rank(best) ? e : best));
  return { op: latest.op, error: latest.error };
}

module.exports = { formatReconcileSummary, latestResidueError, archivedCountFromRunsResult, humanAge, mirrorFfPart };
