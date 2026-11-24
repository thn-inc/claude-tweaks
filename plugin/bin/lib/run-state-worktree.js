// bin/lib/run-state-worktree.js — the one worktree-precedence rule for a run's
// run-state.json (#5555). A leaf (requires nothing), so the timing writers and the
// reconciler can use it without loading hooks/context.js; context.js re-exports it.
'use strict';

// The worktree a run was bound to — its live `worktree`, else the
// `worktreeAtClose` a close kept — as a non-empty string, else null.
function priorWorktree(state) {
  const usable = (v) => (typeof v === 'string' && v ? v : null);
  const rs = state && typeof state === 'object' ? state : {};
  return usable(rs.worktree) || usable(rs.worktreeAtClose);
}

module.exports = { priorWorktree };
