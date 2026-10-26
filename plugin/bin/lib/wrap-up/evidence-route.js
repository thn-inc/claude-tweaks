// bin/lib/wrap-up/evidence-route.js — decide where verification-brief Step 4's
// demo-evidence screenshots go: the current branch, or a dedicated evidence PR
// (#4125, extracted from the prose rules of #4039).
//
// Pure: no git, gh or fs. The CLI (bin/evidence-route.js) gathers the inputs —
// current branch, integration branch, toplevel, the run's recorded worktree, the
// run PR's state — and hands them here, so every rule is a unit-testable
// function of its inputs and the decision cannot drift from the prose.
//
// Rule order is the contract, first match wins: the guards (1-5) come before
// any PR-state rule so a screenshot is never committed to the integration
// branch, to an unsafe-named branch, or from outside the run's worktree.
'use strict';

const SAFE_BRANCH_RE = /^[A-Za-z0-9._/-]+$/;

// The first four are "open" states (the run PR can still take a push);
// gh-absent / read-failed are the unreadable ones.
const STATES = Object.freeze([
  'conflicting', 'no-conflict', 'unknown', 'open', 'not-open', 'no-pr', 'gh-absent', 'read-failed',
]);
const ROUTES = Object.freeze(['current-branch', 'evidence-pr']);
const REASONS = Object.freeze([
  'no-branch', 'integration-branch-unresolved', 'integration-branch', 'unsafe-branch-name',
  'not-run-worktree', 'run-pr-open', 'run-pr-not-open', 'no-pr', 'unreadable-leave-open',
  'unreadable-state',
]);

const OPEN_STATES = new Set(['conflicting', 'no-conflict', 'unknown', 'open']);

function stripTrailingSlash(p) {
  return typeof p === 'string' ? p.replace(/[\\/]+$/, '') : p;
}

// Map a resolvePrState result to a STATES value.
function branchReadState(result) {
  if (result === null) return 'no-pr';
  if (typeof result === 'string') return result === 'gh-absent' ? 'gh-absent' : 'read-failed';
  if (typeof result === 'object') {
    if (result.state === 'OPEN') return 'open';
    if (result.state === 'MERGED' || result.state === 'CLOSED') return 'not-open';
  }
  return 'read-failed';
}

function decideEvidenceRoute({
  currentBranch, integrationBranch, toplevel, worktree, state, inRun, leaveOpen, consoleResolution,
} = {}) {
  const branch = currentBranch || '';
  const normState = STATES.includes(state) ? state : 'read-failed';
  const out = (route, reason) => ({ route, branch, state: normState, reason });

  if (!currentBranch) return out('evidence-pr', 'no-branch');
  if (!integrationBranch) return out('evidence-pr', 'integration-branch-unresolved');
  if (currentBranch === integrationBranch) return out('evidence-pr', 'integration-branch');
  if (!SAFE_BRANCH_RE.test(currentBranch)) return out('evidence-pr', 'unsafe-branch-name');
  // With no worktree recorded the current branch counts as the run's own.
  if (typeof worktree === 'string' && worktree !== ''
      && stripTrailingSlash(toplevel) !== stripTrailingSlash(worktree)) {
    return out('evidence-pr', 'not-run-worktree');
  }
  if (OPEN_STATES.has(normState)) return out('current-branch', 'run-pr-open');
  if (normState === 'not-open') return out('evidence-pr', 'run-pr-not-open');
  if (normState === 'no-pr') return out('current-branch', 'no-pr');
  if (inRun === true && (consoleResolution === 'leave-open' || leaveOpen === true)) {
    return out('current-branch', 'unreadable-leave-open');
  }
  return out('evidence-pr', 'unreadable-state');
}

module.exports = {
  SAFE_BRANCH_RE,
  STATES,
  ROUTES,
  REASONS,
  decideEvidenceRoute,
  branchReadState,
  stripTrailingSlash,
};
