// bin/lib/hooks/sibling-sessions.js — is a record already being worked by a
// live sibling session, in a worktree neither branches, claims, nor labels
// can see?
//
// [IL-107]'s actual incident: a nine-task implementation, eleven commits deep
// in an unpushed worktree, was nearly redone from scratch because the only
// remote-facing signals (origin/main, the record's labels, the claim refs) all
// showed the work as untouched. What made it visible was `git worktree list
// --porcelain`'s lock line, which the harness stamps with the owning
// session's pid — the same signal `bin/lib/hooks/worktree-reap.js` already
// parses and probes for liveness to decide whether a worktree is safe to
// remove. This module reuses those primitives (parseWorktreeList, isPidAlive
// via lockVerdict) for a different question: not "is this worktree done?" but
// "is somebody else standing in it right now?"
//
// Every predicate here fails OPEN, deliberately the opposite posture from
// worktree-reap.js's fail-closed reaper. A false negative here just means a
// claim proceeds that a human would have paused — recoverable. A false
// positive (never happens by construction: this module only ever returns a
// match or nothing, never blocks anything itself) would be the dangerous
// direction. See CLAUDE.md's Hooks section, "ambiguity resolves to allow, but
// never silently."
'use strict';
const path = require('path');
const { parseWorktreeList, lockVerdict } = require('./worktree-reap');
const { safeReal } = require('./worktree-detect');
const { runGit } = require('./git-exec');
const ctxLib = require('./context');

// `git worktree list --porcelain` canonicalizes symlinks in its `path` field;
// `record-worktree` stamps `run-state.json`'s `worktree` via a bare
// `path.resolve` (bin/hooks.js), which does not. The same worktree can then
// read as two different strings depending on which side produced them —
// `worktree-reap.js` already solves this the same way (`safeReal` before any
// path comparison, line ~249); reused here rather than re-derived. Falls back
// to `path.resolve` when `safeReal` can't stat the path (e.g. a worktree
// already removed) — normalizing form, not verifying existence.
function normalizePath(p) {
  return safeReal(p) || path.resolve(p);
}

// `-`-or-`/`-delimited segments. A bare substring test would let record `19`
// false-match branch `flow-spec-192-193` (both contain "19"); tokenizing and
// comparing whole segments does not.
function tokenize(s) {
  return String(s || '').split(/[/-]/).filter(Boolean);
}

// True when `needle`'s tokens appear, in order, as a contiguous run inside
// `haystack`'s tokens. A single-token needle (the common case — a bare record
// id like `308`) degenerates to plain membership.
function containsSubsequence(haystack, needle) {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function matchesRecordRef(entry, recordRef) {
  const needle = tokenize(recordRef);
  if (needle.length === 0) return false;
  return containsSubsequence(tokenize(entry.branch), needle) || containsSubsequence(tokenize(entry.path), needle);
}

// Default git invocation: `git worktree list --porcelain` from `cwd`. Returns
// the trimmed stdout, or null on any failure (timeout, no git, git error) —
// callers must treat null exactly like "nothing enumerated", never like "no
// worktrees exist". Tests never exercise this path: they inject `run`
// directly against frozen porcelain fixtures, per [IL-80] — the lock-reason
// format is git's own unversioned implementation detail.
function defaultRun(cwd) {
  return (args) => {
    const { stdout, failure } = runGit(args, cwd);
    return failure ? null : stdout;
  };
}

// Which worktree paths the CALLING session already owns, per run-state.json —
// the exact mechanism `record-worktree` writes and E1 (pre-tool-use.js) reads,
// reused here rather than re-derived. `record-worktree` stamps
// `{ worktree: <path>, sessionId: <CLAUDE_CODE_SESSION_ID> }` onto the run it
// is called for; a worktree recorded under the calling session's own id is
// that session's own claimed record, never a sibling to warn about. An
// `-adhoc-standalone` dir also records a sessionId + worktree, but it is a
// friction placeholder minted on every EnterWorktree — a dispatched subagent's
// included, which shares the parent's session id — never a record claim (#2783).
function ownedWorktreePaths(cwd, sessionId, listRunDirsWithState) {
  const owned = new Set();
  if (!sessionId) return owned;
  for (const { dir, state } of listRunDirsWithState(cwd)) {
    if (ctxLib.isAdHocRunDir(dir)) continue;
    if (state && state.sessionId === sessionId && typeof state.worktree === 'string' && state.worktree) {
      owned.add(normalizePath(state.worktree));
    }
  }
  return owned;
}

// findConflictingSession(recordRef, opts) -> { path, branch, pid } | null
//
// opts:
//   cwd                  — the invoking repo root (never assumed from process
//                           cwd without an explicit anchor — [IL-26]). Falls
//                           back to process.cwd() only when the caller truly
//                           has nothing else, matching every other CLI verb
//                           in this dispatcher.
//   run                  — (args: string[]) => string|null, the git
//                           invocation. Defaults to a real `git -C cwd`.
//                           Tests inject a stub over frozen porcelain output.
//   listRunDirsWithState — (cwd) => [{ dir, state }]. Defaults to
//                           context.js's real implementation. Tests inject a
//                           stub so self-exclusion is tested without touching
//                           the filesystem.
//   sessionId            — the calling session's own identity. Defaults to
//                           CLAUDE_CODE_SESSION_ID, read directly (this runs
//                           as a Bash-invoked CLI subcommand, not a hook, so
//                           unlike pre-tool-use.js's ctx.input.session_id the
//                           env var is reliably present here — the same
//                           distinction bin/hooks.js's own header comment
//                           draws for record-worktree/close-run).
//
// Returns the FIRST in-use, token-matching worktree that is not the calling
// session's own — or null when there is none. A null result covers three
// distinct cases the caller cannot and need not tell apart: no worktrees at
// all, no worktree naming this record, or git/list resolution failing
// outright — every one of them means "nothing to warn about", the fail-open
// posture this whole module exists to keep.
function findConflictingSession(recordRef, opts = {}) {
  if (recordRef === undefined || recordRef === null || recordRef === '') return null;

  const cwd = opts.cwd || process.cwd();
  const run = opts.run || defaultRun(cwd);
  const listRunDirsWithState = opts.listRunDirsWithState || ctxLib.listRunDirsWithState;
  const sessionId = Object.prototype.hasOwnProperty.call(opts, 'sessionId')
    ? opts.sessionId
    : process.env.CLAUDE_CODE_SESSION_ID;

  const porcelain = run(['worktree', 'list', '--porcelain']);
  if (!porcelain) return null;

  const candidates = parseWorktreeList(porcelain)
    .filter((entry) => lockVerdict(entry) === 'in-use')
    .filter((entry) => matchesRecordRef(entry, recordRef));
  if (candidates.length === 0) return null;

  // Lazy: most calls have zero or one candidate, and computing this walks
  // every run dir's run-state.json — no reason to pay for it when there is
  // nothing to exclude.
  let owned = null;
  for (const entry of candidates) {
    if (sessionId) {
      if (owned === null) owned = ownedWorktreePaths(cwd, sessionId, listRunDirsWithState);
      if (owned.has(normalizePath(entry.path))) continue; // this session's own claimed record, not a sibling
    }
    return { path: entry.path, branch: entry.branch, pid: entry.pid };
  }
  return null;
}

module.exports = { findConflictingSession, matchesRecordRef, tokenize };
