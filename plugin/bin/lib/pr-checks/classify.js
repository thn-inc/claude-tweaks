// bin/lib/pr-checks/classify.js — pure classifier for a run PR's
// statusCheckRollup at HEAD (#3013). The red/pending/empty/green rules are
// _shared/pr-first-merge.md Step 2.5's, applied in the same order (red
// first); that prose stays the single authority and this module is its code
// twin — tests/pr-check-gate-conformance.test.js pins FAILING_CONCLUSIONS
// against the prose list. Additions the merge gate does not need:
//   - `stale`: the rollup's headRefOid is not local HEAD (the newest commit
//     is not pushed or not yet checked) — nothing is concluded from it.
//   - StatusContext entries ({context, state, targetUrl}) carry no
//     status/conclusion, so they are normalized into that shape first;
//     otherwise a literal reading of "status not COMPLETED → pending" would
//     hold a finished commit status pending forever.
// Shared with the merge gate: `headRuns` (#3405) — workflow runs for HEAD from
// `gh run list --commit`, cross-checked alongside the rollup. A rollup that
// lists only some workflows reads green while others are not yet registered;
// a run that has not completed (or has a failing conclusion) is what catches
// that.
// Any failing check is red: statusCheckRollup does not mark which checks are
// required, and the merge gate already treats every failing check as red.
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
    url: r.url || null,
    status: r.status ? String(r.status).toUpperCase() : null,
    conclusion: r.conclusion ? String(r.conclusion).toUpperCase() : null,
  };
}

function result(state, headRefOid, extra = {}) {
  return { state, failing: [], pending: [], headRefOid: headRefOid || null, ...extra };
}

function classifyRollup({ rollup, headRefOid, localHead, hasPrCi, headRuns } = {}) {
  if (!Array.isArray(rollup) || typeof headRefOid !== 'string' || !headRefOid) {
    return result('read-failed', headRefOid, { reason: 'malformed-rollup' });
  }
  if (headRuns !== undefined && !Array.isArray(headRuns)) {
    return result('read-failed', headRefOid, { reason: 'malformed-head-runs' });
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
  if (pending.length > 0) return result('pending', headRefOid, { pending });
  if (entries.length === 0) return result(hasPrCi ? 'pending' : 'no-ci', headRefOid);
  return result('green', headRefOid);
}

module.exports = { FAILING_CONCLUSIONS, normalizeEntry, normalizeHeadRun, classifyRollup };
