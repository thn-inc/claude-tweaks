// bin/lib/pr-checks/classify.js — pure classifier for a run PR's
// statusCheckRollup at HEAD (#3013). The red/pending/empty/green rules are
// _shared/pr-first-merge.md Step 2.5's, applied in the same order (red
// first); that prose stays the single authority and this module is its code
// twin — tests/pr-check-gate-conformance.test.js pins FAILING_CONCLUSIONS
// against the prose list. Additions the merge gate does not need:
//   - `stale`: the rollup's headRefOid is not local HEAD (the newest commit
//     is not pushed or not yet checked) — nothing is concluded from it.
// Shared with the merge gate:
//   - StatusContext entries ({context, state, targetUrl}) carry no
//     status/conclusion, so they are normalized into that shape first;
//     otherwise a literal reading of "status not COMPLETED → pending" would
//     hold a finished commit status pending forever.
//   - `headRuns` (#3405) — workflow runs for HEAD from
//     `gh run list --commit`, cross-checked alongside the rollup. A rollup that
//     lists only some workflows reads green while others are not yet registered;
//     a run that has not completed (or has a failing conclusion) is what catches
//     that.
//   - `readyRunVerdict` (#5153) — the code twin of Step 2.5's ready-run bullet:
//     a workflow the PR's ready transition must run is `awaiting` until a
//     post-`readySince` PR-event run of it exists, so draft-time skipped jobs
//     never read as green.
// Any failing check is red: statusCheckRollup does not mark which checks are
// required, and the merge gate already treats every failing check as red.
// The base comparison (#3258) is an addition the merge gate does not have: it
// can only demote `red` to `inherited-red` (every failing check also fails on
// the integration-branch tip), and a failed base read leaves `red` — a
// corroborating read's failure only touches verdicts it could change.
'use strict';

const FAILING_CONCLUSIONS = Object.freeze(['FAILURE', 'TIMED_OUT', 'ERROR', 'STARTUP_FAILURE']);

function normalizeEntry(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  if (typeof e.context === 'string' && !('status' in e)) {
    const state = String(e.state || '').toUpperCase();
    const done = state === 'SUCCESS' || state === 'FAILURE' || state === 'ERROR';
    return { name: e.context, url: e.targetUrl || null, status: done ? 'COMPLETED' : 'PENDING', conclusion: done ? state : null };
  }
  return { name: e.name || null, url: e.detailsUrl || null, status: e.status || null, conclusion: e.conclusion || null };
}

// `gh run list --json` rows use lowercase status/conclusion; uppercase them so
// they compare against the same vocabulary as the rollup.
function normalizeHeadRun(row) {
  const r = row && typeof row === 'object' ? row : {};
  return {
    name: r.workflowName || r.name || null,
    url: r.url || r.html_url || null,
    status: r.status ? String(r.status).toUpperCase() : null,
    conclusion: r.conclusion ? String(r.conclusion).toUpperCase() : null,
  };
}

function result(state, headRefOid, extra = {}) {
  return { state, failing: [], pending: [], headRefOid: headRefOid || null, ...extra };
}

const PR_EVENTS = Object.freeze(['pull_request', 'pull_request_target']);

// #5153 — the CI run `gh pr ready` starts. Only a REST `actions/runs` row (it
// carries `path`) can count: a `gh run list` row has none, so a run present in
// both shapes is counted once. A row counts for workflow W when its path is W or
// W plus an `@ref` suffix (a file named `ci@v2.yml` still matches its own runs;
// a pathless or empty path, or an empty W, never does), its event is a PR event, and it was created at or
// after `readySince`; an unparseable date counts for nothing, which leaves the
// workflow awaiting (fail closed). The newest counted row alone decides W.
function readyRunVerdict({ readySince, readyWorkflows, headRuns } = {}) {
  const verdict = { awaiting: [], pending: [], failing: [] };
  const since = Date.parse(readySince);
  const rows = Array.isArray(headRuns) ? headRuns : [];
  const ids = (r) => (Number.isFinite(r.databaseId ?? r.id) ? r.databaseId ?? r.id : -Infinity);
  for (const W of new Set(Array.isArray(readyWorkflows) ? readyWorkflows : [])) {
    let newest = null;
    let newestAt = -Infinity;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const path = typeof row.path === 'string' ? row.path : '';
      if (path === '' || W === '' || (path !== W && !path.startsWith(`${W}@`)) || !PR_EVENTS.includes(row.event)) continue;
      const at = Date.parse(row.createdAt ?? row.created_at);
      if (Number.isNaN(at) || Number.isNaN(since) || at < since) continue;
      if (!newest || at > newestAt || (at === newestAt && ids(row) > ids(newest))) {
        newest = row;
        newestAt = at;
      }
    }
    if (!newest) verdict.awaiting.push(W);
    else if (String(newest.status || '').toUpperCase() !== 'COMPLETED') verdict.pending.push(W);
    else if (FAILING_CONCLUSIONS.includes(String(newest.conclusion || '').toUpperCase())) {
      verdict.failing.push({ name: newest.workflowName || newest.name || W, url: newest.html_url || newest.url || null });
    }
  }
  return verdict;
}

function classifyRollup({ rollup, headRefOid, localHead, hasPrCi, headRuns, readySince, readyWorkflows } = {}) {
  if (!Array.isArray(rollup) || typeof headRefOid !== 'string' || !headRefOid) {
    return result('read-failed', headRefOid, { reason: 'malformed-rollup' });
  }
  if (headRuns !== undefined && !Array.isArray(headRuns)) {
    return result('read-failed', headRefOid, { reason: 'malformed-head-runs' });
  }
  if (readyWorkflows !== undefined && readyWorkflows !== null
    && (!Array.isArray(readyWorkflows) || readyWorkflows.some((w) => typeof w !== 'string' || w === ''))) {
    return result('read-failed', headRefOid, { reason: 'malformed-ready-workflows' });
  }
  if (readySince !== undefined && readySince !== null && typeof readySince !== 'string') {
    return result('read-failed', headRefOid, { reason: 'malformed-ready-since' });
  }
  const readyActive = typeof readySince === 'string' && readySince !== '' && Array.isArray(readyWorkflows) && readyWorkflows.length > 0;
  if (readyActive && Number.isNaN(Date.parse(readySince))) {
    return result('read-failed', headRefOid, { reason: 'malformed-ready-since' });
  }
  if (typeof localHead !== 'string' || !localHead || headRefOid !== localHead) {
    return result('stale', headRefOid);
  }
  const entries = rollup.map(normalizeEntry);
  const checks = [...entries, ...(headRuns || []).map(normalizeHeadRun)];
  // A workflow can appear in both sources (a rollup job and its head run); name it once — the state is unaffected.
  const failing = [];
  for (const e of checks) {
    if (FAILING_CONCLUSIONS.includes(e.conclusion) && !failing.some((f) => f.name === e.name)) {
      failing.push({ name: e.name, url: e.url });
    }
  }
  if (failing.length > 0) return result('red', headRefOid, { failing });
  const pending = [...new Set(checks.filter((e) => e.status !== 'COMPLETED').map((e) => e.name))];
  const awaiting = readyActive ? readyRunVerdict({ readySince, readyWorkflows, headRuns }).awaiting : [];
  if (pending.length > 0 || awaiting.length > 0) {
    return result('pending', headRefOid, awaiting.length > 0 ? { pending, awaitingReadyRun: awaiting } : { pending });
  }
  if (entries.length === 0) return result(hasPrCi ? 'pending' : 'no-ci', headRefOid);
  return result('green', headRefOid);
}

// Only the newest run of a workflow counts at the base tip: `gh run list --commit`
// returns every run for the sha, so a failure a later run of the same workflow
// superseded would otherwise mark a real PR failure inherited (check-runs and
// statuses are already latest-per-name from the API). A row with no numeric
// `databaseId` cannot be ordered, so it is dropped: at the base tip a counted
// failure can only make the verdict looser (more checks read inherited), and a
// dropped one can only leave it red — the fail-closed direction.
function newestRunPerWorkflow(runs) {
  const newest = new Map();
  for (const r of runs) {
    const key = r && (r.workflowName || r.name);
    if (!key || !Number.isFinite(r.databaseId)) continue;
    const cur = newest.get(key);
    if (!cur || r.databaseId > cur.databaseId) newest.set(key, r);
  }
  return [...newest.values()];
}

// Names failing at the integration-branch tip, from the three REST reads the
// CLI makes there (check-runs, commit statuses, workflow runs). First-seen
// order, de-duplicated; an unnamed row is never a name to match against.
function failingNamesAt({ checkRuns, statuses, runs } = {}) {
  for (const [field, value] of [['checkRuns', checkRuns], ['statuses', statuses], ['runs', runs]]) {
    if (!Array.isArray(value)) throw new Error(`malformed base read: ${field}`);
  }
  const rows = [...checkRuns.map(normalizeHeadRun), ...statuses.map(normalizeEntry), ...newestRunPerWorkflow(runs).map(normalizeHeadRun)];
  return [...new Set(rows.filter((e) => e.name != null && FAILING_CONCLUSIONS.includes(e.conclusion)).map((e) => e.name))];
}

// `base` is { sha, failing } on a successful read, { sha, reason } on a failed
// one. Only a `red` verdict can change: a failed read leaves it plain red.
function applyBaseComparison(verdict, base) {
  if (verdict.state !== 'red') return verdict;
  if (!base || base.reason) {
    return { ...verdict, baseSha: base?.sha ?? null, baseReason: base?.reason || 'base not read' };
  }
  const failing = verdict.failing.map((f) => ({ ...f, inherited: f.name != null && base.failing.includes(f.name) }));
  const state = failing.length > 0 && failing.every((f) => f.inherited) ? 'inherited-red' : 'red';
  return { ...verdict, state, failing, baseSha: base.sha };
}

module.exports = { FAILING_CONCLUSIONS, PR_EVENTS, normalizeEntry, normalizeHeadRun, readyRunVerdict, classifyRollup, failingNamesAt, applyBaseComparison };
