// bin/lib/dispatch/stuck-open-pr.js — the two pure functions behind the `stuck:open-pr` row of
// `/claude-tweaks:backlog attention` (#4849): which snapshot records could be stuck behind an open
// PR, and what one stuck record's row says. bin/stuck-open-prs.js does every read; the verdict itself
// is dispatch-resume.js's, so a row's remedy is that verdict's own, never a second reading of it.
'use strict';

// Refusals that mean the record is not stuck: another run or session holds it right now. `live-claim`
// and `live-sibling` are the verdict's; the CLI also hides a record on its own claim and sibling reads,
// before the verdict, since the verdict can refuse a PR it cannot resume before it reads either.
const NO_ROW_REASONS = Object.freeze(['live-claim', 'live-sibling', 'no-pr']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Open, granted (`auto:build`) records carrying no `bot:*` label, in snapshot order. A `bot:*` record is
// owned by the queue (in progress, blocked or parked) and has its own attention row. `state` is absent
// on a record that predates the snapshot's state field, which reads as open.
function stuckCandidates(records) {
  const out = [];
  for (const r of Array.isArray(records) ? records : []) {
    if (!isObject(r) || !Number.isInteger(r.number)) continue;
    if (r.state !== undefined && r.state !== 'OPEN') continue;
    const names = Array.isArray(r.labels) ? r.labels.map((l) => l && l.name).filter((l) => typeof l === 'string') : [];
    if (!names.includes('auto:build') || names.some((l) => l.startsWith('bot:'))) continue;
    out.push(r.number);
  }
  return out;
}

// {number, pr, code, verdict} -> {number, pr, remedy} | null. `verdict` is the parsed stdout of
// `dispatch-resume.js --issue {number}` (null when it printed nothing usable); `code` is its exit code
// and only fills the unreadable message. The branch is on the verdict's data: an eligible verdict
// renders the resume remedy; a refusal renders its own `remedy` unless a live owner (a no-row reason,
// or `liveRun: true`) holds the record; anything else reads as unreadable, which stays a visible row.
function stuckRow({
  number, pr, code, verdict,
}) {
  if (isObject(verdict) && verdict.eligible === true) {
    return { number, pr, remedy: `run /claude-tweaks:dispatch resume #${number} — restarts its stalled PR #${pr}` };
  }
  if (isObject(verdict) && verdict.eligible === false && typeof verdict.reason === 'string') {
    if (NO_ROW_REASONS.includes(verdict.reason) || verdict.liveRun === true) return null;
    if (typeof verdict.remedy === 'string' && verdict.remedy !== '') return { number, pr, remedy: verdict.remedy };
  }
  return {
    number,
    pr,
    remedy: `could not read #${number}'s state (dispatch-resume exit ${code}) — run /claude-tweaks:dispatch resume #${number} to see why`,
  };
}

module.exports = { stuckCandidates, stuckRow, NO_ROW_REASONS };
