'use strict';
// bin/lib/run-liveness/probes.js — the default probes the run-liveness verdict
// module (#3973) calls. Each is a thin wrapper over an existing reader and keeps
// that reader's raw contract; the verdict module tags every call (ok / threw) so
// "could not ask" never reads as "the answer is no". Wrappers here therefore
// THROW when the question went unanswered, and return null/false only for a real
// answer.
const os = require('os');
const { parseWorktreeList, findWorktreeEntry, isPidAlive, lockVerdict } = require('../hooks/worktree-reap');
const { mainCheckoutRoot, safeReal } = require('../hooks/worktree-detect');
const { runGit } = require('../hooks/git-exec');
const { lastCommitMs } = require('../hooks/resume-freshness');
const { readEventLines } = require('../hooks/context');
const { pidStartTime } = require('./process-probe');

// true when a live process holds the worktree lock; false when free or orphaned
// (lock pid dead); throws on an unknown lock (no pid in the reason), when the lock
// state could not be listed, or when the worktree is not among the ones git lists for
// its main checkout (the caller already established the directory exists, so an
// unlisted one is a path git did not match, not a worktree known to be unlocked).
function lockInUse(worktree) {
  const root = mainCheckoutRoot(worktree);
  if (!root) throw new Error(`could not resolve the main checkout of ${worktree}`);
  const { stdout, failure } = runGit(['worktree', 'list', '--porcelain'], root);
  if (failure) throw new Error(`could not list worktrees from ${root}: git ${failure}`);
  const entry = findWorktreeEntry(parseWorktreeList(stdout), safeReal(worktree) || worktree);
  if (!entry) throw new Error(`${worktree} is not listed by git worktree list in ${root}`);
  const verdict = lockVerdict(entry);
  if (verdict === 'in-use') return true;
  if (verdict === 'free' || verdict === 'orphaned') return false;
  throw new Error(`worktree lock state is ${verdict} for ${worktree}`);
}

// { lastOwnMs, lastSessionEndMs } over the run's events.jsonl. Both ignore
// `attribution: 'fallback'` lines (another session's hook guessed them into this
// run). Throws when the log is absent/unreadable — that is unknown evidence, not
// proof of quiet.
// With an `ownerSessionId` (anything but undefined), only `session-end` events
// carrying that exact sessionId count toward lastSessionEndMs — another session
// resolving this run with non-fallback attribution can append one; lastOwnMs is
// unchanged.
function ownEventAt(runDir, ownerSessionId) {
  // Lazy: archive-merged.js is a large module most callers never need.
  const { ownEventRecency } = require('../reconcile/archive-merged');
  const { readable, lastOwnMs } = ownEventRecency(runDir);
  if (!readable) throw new Error(`could not read events.jsonl in ${runDir}`);
  let lastSessionEndMs = null;
  for (const ev of readEventLines(runDir) || []) {
    if (!ev || ev.type !== 'session-end' || ev.attribution === 'fallback') continue;
    if (ownerSessionId !== undefined && ev.sessionId !== ownerSessionId) continue;
    const t = Date.parse(ev.ts);
    if (Number.isNaN(t)) continue;
    if (lastSessionEndMs === null || t > lastSessionEndMs) lastSessionEndMs = t;
  }
  return { lastOwnMs, lastSessionEndMs };
}

const DEFAULT_PROBES = {
  hostname: () => os.hostname(),
  pidAlive: (pid) => isPidAlive(pid),
  pidStartTime: (pid) => pidStartTime(pid),
  lockInUse,
  lastCommitAt: (worktree) => lastCommitMs(worktree),
  ownEventAt,
};

module.exports = { DEFAULT_PROBES };
