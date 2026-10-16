// bin/lib/pr-checks/classify.js — pure classifier for a run PR's
// statusCheckRollup at HEAD (#3013). The red/pending/empty/green rules are
// _shared/pr-first-merge.md Step 2.5's, applied in the same order (red
// first); that prose stays the single authority and this module is its code
// twin — tests/pr-check-gate-conformance.test.js pins FAILING_CONCLUSIONS
// against the prose list. Two additions the merge gate does not need:
//   - `stale`: the rollup's headRefOid is not local HEAD (the newest commit
//     is not pushed or not yet checked) — nothing is concluded from it.
//   - StatusContext entries ({context, state, targetUrl}) carry no
//     status/conclusion, so they are normalized into that shape first;
//     otherwise a literal reading of "status not COMPLETED → pending" would
//     hold a finished commit status pending forever.
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

function result(state, headRefOid, extra = {}) {
  return { state, failing: [], pending: [], headRefOid: headRefOid || null, ...extra };
}

function classifyRollup({ rollup, headRefOid, localHead, hasPrCi } = {}) {
  if (!Array.isArray(rollup) || typeof headRefOid !== 'string' || !headRefOid) {
    return result('read-failed', headRefOid, { reason: 'malformed-rollup' });
  }
  if (typeof localHead !== 'string' || !localHead || headRefOid !== localHead) {
    return result('stale', headRefOid);
  }
  const entries = rollup.map(normalizeEntry);
  const failing = entries
    .filter((e) => FAILING_CONCLUSIONS.includes(e.conclusion))
    .map((e) => ({ name: e.name, url: e.url }));
  if (failing.length > 0) return result('red', headRefOid, { failing });
  const pending = entries.filter((e) => e.status !== 'COMPLETED').map((e) => e.name);
  if (pending.length > 0) return result('pending', headRefOid, { pending });
  if (entries.length === 0) return result(hasPrCi ? 'pending' : 'no-ci', headRefOid);
  return result('green', headRefOid);
}

module.exports = { FAILING_CONCLUSIONS, normalizeEntry, classifyRollup };
