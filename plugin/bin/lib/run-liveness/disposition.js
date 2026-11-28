'use strict';
// bin/lib/run-liveness/disposition.js — what reconcile should do with one
// non-clean run directory (#3977): close it, leave it, or report it as an
// orphan that needs a human. Pure: no I/O and no clock. facts.js gathers the
// inputs; reconcile/archive-merged.js evaluates it in report-only mode.
//
// The rule table (docs/reconcile-checks.md, "Run dispositions in report-only
// mode") is evaluated in order, first match wins, default `leave`. Every fact a
// row reads that is unknown (`pr: 'unknown'`, `uniqueCommits: null`,
// `dirty: null`, a non-boolean ref fact, `quietMs: null`) makes that row not
// match, so an unknown can only ever fall through to `leave` — never close.
// Settle findings aggressively, close runs conservatively.

// Row 12's quiet floor: the existing abandoned-interrupted window
// (reconcile/archive-merged.js's STALE_INTERRUPTED_TTL_MS, 24 h), restated here
// because requiring archive-merged.js from this pure module would invert the
// dependency; a test pins the two equal.
const QUIET_FLOOR_MS = 24 * 60 * 60 * 1000;

const STAGED_OUTCOME_REASON = 'staged items need an outcome';
// Report vocabulary only in this release: the drop becomes real in #3978.
const DROP_REASON = 'run-abandoned';

const CLOSE_REASONS = Object.freeze(new Set(['adhoc-dead', 'standalone-dead', 'pr-closed-unmerged', 'nothing-to-resume']));

const REVIEW_FINDING_RE = /^review-(unconfirmed|contested|debate)-/;

function basename(p) {
  const s = String(p || '');
  const parts = s.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

// A staged entry as archive-merged.js's listStagedItems returns it
// (`staged/{name}` or `spec-N/staged/{name}`). An unreadable-directory entry
// (`staged/ (unreadable: EACCES)`) is never a finding: what it holds is unknown.
function isReviewFinding(entry) {
  if (typeof entry !== 'string' || /\(unreadable:/.test(entry)) return false;
  return REVIEW_FINDING_RE.test(basename(entry));
}

function shapeOf(runDir) {
  const name = basename(runDir);
  if (name.endsWith('-adhoc-standalone')) return 'adhoc';
  if (name.includes('-standalone')) return 'standalone';
  return 'formal';
}

function result(action, reason, facts, dropFindings = []) {
  const { verdict, pr, prNumber, branch, worktree, staged, quietMs } = facts;
  return {
    action,
    reason,
    evidence: {
      verdict: verdict ?? null,
      pr: pr ?? null,
      prNumber: Number.isInteger(prNumber) ? prNumber : null,
      uniqueCommits: branch && Number.isInteger(branch.uniqueCommits) ? branch.uniqueCommits : null,
      dirty: worktree && typeof worktree.dirty === 'boolean' ? worktree.dirty : null,
      staged: Array.isArray(staged) ? staged.length : null,
      quietMs: Number.isFinite(quietMs) ? quietMs : null,
    },
    dropFindings,
  };
}

const isBool = (v) => v === true || v === false;

// -> { action: 'close'|'leave'|'orphan', reason, evidence, dropFindings: string[] }
function disposition(facts) {
  const f = facts && typeof facts === 'object' ? facts : {};
  const { shape, verdict, pr } = f;
  // A staged list that is not an array is unknown — treated as "other staged".
  const stagedKnown = Array.isArray(f.staged);
  const staged = stagedKnown ? f.staged : [];
  const stagedEmpty = stagedKnown && staged.length === 0;
  const stagedOk = stagedKnown && staged.every(isReviewFinding);
  const findings = stagedKnown ? staged.filter(isReviewFinding) : [];

  if (verdict === 'live') return result('leave', 'live', f); // row 1
  if (verdict !== 'dead') return result('leave', 'verdict-unknown', f); // row 2

  if (shape === 'adhoc') {
    if (stagedOk) return result('close', 'adhoc-dead', f); // row 3
    return result('orphan', STAGED_OUTCOME_REASON, f); // row 4
  }
  if (shape === 'standalone') {
    if (stagedEmpty) return result('close', 'standalone-dead', f); // row 5
    return result('leave', 'standalone-staged', f); // row 6
  }
  if (shape !== 'formal') return result('leave', 'default', f);

  if (pr === 'merged') return result('leave', 'pr-merged', f); // row 7
  if (pr === 'closed-unmerged') {
    if (stagedOk) return result('close', 'pr-closed-unmerged', f, findings); // row 8
    return result('orphan', STAGED_OUTCOME_REASON, f); // row 9
  }
  if (pr === 'open') { // row 10
    const n = Number.isInteger(f.prNumber) ? `#${f.prNumber}` : '(unnumbered)';
    return result('orphan', f.prDraft === true ? `draft PR ${n}, session gone` : `PR ${n} open, session gone`, f);
  }
  if (pr !== 'none') return result('leave', 'default', f); // row 14 (pr unknown)

  const branch = f.branch && typeof f.branch === 'object' ? f.branch : {};
  const worktree = f.worktree && typeof f.worktree === 'object' ? f.worktree : {};
  // Row 11: something on disk or on the branch would be lost by a close.
  if (Number.isInteger(branch.uniqueCommits) && branch.uniqueCommits > 0) {
    return result('orphan', `unpushed commits on ${branch.name || '(unnamed branch)'}`, f);
  }
  if (worktree.dirty === true) {
    return result('orphan', `uncommitted changes in ${worktree.path || '(unrecorded worktree)'}`, f);
  }
  // Row 12/13: provably nothing to resume. Every fact must be known.
  const branchGone = isBool(branch.localExists) && isBool(branch.remoteExists)
    && !branch.localExists && !branch.remoteExists;
  const branchEmpty = branch.uniqueCommits === 0;
  const worktreeClear = worktree.exists === false || (worktree.exists === true && worktree.dirty === false);
  const quiet = Number.isFinite(f.quietMs) && f.quietMs > QUIET_FLOOR_MS;
  if ((branchGone || branchEmpty) && worktreeClear && quiet) {
    if (stagedOk) return result('close', 'nothing-to-resume', f, findings); // row 12
    return result('orphan', STAGED_OUTCOME_REASON, f); // row 13
  }
  return result('leave', 'default', f); // row 14
}

module.exports = {
  disposition, shapeOf, isReviewFinding, CLOSE_REASONS, STAGED_OUTCOME_REASON, DROP_REASON, QUIET_FLOOR_MS, REVIEW_FINDING_RE,
};
