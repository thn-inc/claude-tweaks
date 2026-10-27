'use strict';
// bin/lib/run-liveness/probes.js — the default probes the run-liveness verdict
// module (#3973) calls. Each is a thin wrapper over an existing reader (or, for
// lastCommitAt, over this file's own lastCommitMs, #4420) and keeps that reader's
// raw contract; the verdict module tags every call (ok / threw) so
// "could not ask" never reads as "the answer is no". Wrappers here therefore
// THROW when the question went unanswered, and return null/false only for a real
// answer.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseWorktreeList, findWorktreeEntry, isPidAlive, lockVerdict } = require('../hooks/worktree-reap');
const { mainCheckoutRoot, safeReal } = require('../hooks/worktree-detect');
const { runGit, FAILURE } = require('../hooks/git-exec');
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

// #1737: one read of events.jsonl (via context.js's shared readEventLines)
// answering both questions archive-merged.js's `isAbandonedInterrupted` used to
// ask via two separate reads. `readable` is distinct from `lastOwnMs`'s own
// `null`, which conflates two different things: "the log is readable but has no
// qualifying (non-fallback, parseable-ts) event" and "the log couldn't be read
// in the first place." Only callers that must tell those apart read `readable`
// (archive-merged.js's isAbandonedInterrupted path and `ownEventAt` below; #1673
// F9 review finding): a genuinely unreadable/absent log is UNKNOWN evidence, not
// proof of staleness.
//
// `lastOwnMs` is the newest event this run can actually claim as its own, in
// ms — or null when there are none. Deliberately NOT run-state's `updatedAt`,
// and deliberately excluding `attribution: 'fallback'` lines: a fallback
// event is one ANOTHER session's hook guessed into this run because the run
// had no provable owner (context.js's resolveRun). Those lines advance
// `updatedAt` without this run being alive at all, which is precisely how an
// abandoned run looks perpetually busy and never becomes closeable (#1673
// Deliverable 4).
//
// Deliberately asymmetric with context.js's `scanWrapupEvents` (read by
// `checkRunIntegrity`), which does NOT filter fallback-attributed lines: a
// run whose events.jsonl holds ONLY fallback-attributed lines can therefore
// read as both "abandoned" here (no self-attributed activity) AND "shipped"
// there (>=1 skill_invoked still counts, fallback or not). That combination
// is coherent and intended, not a bug to reconcile: the work shipped, and
// nothing THIS run itself produced has touched it since — a future reader
// should not "fix" the two filters into agreement.
function ownEventRecency(runDir) {
  const lines = readEventLines(runDir);
  if (lines === null) return { readable: false, lastOwnMs: null };
  let newest = null;
  for (const ev of lines) {
    if (!ev || ev.attribution === 'fallback') continue;
    const t = Date.parse(ev.ts);
    if (Number.isNaN(t)) continue;
    if (newest === null || t > newest) newest = t;
  }
  return { readable: true, lastOwnMs: newest };
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

// Positively identifies an unborn HEAD (a repo or orphan branch with no commit
// yet), so `git log` failing for any other reason — a damaged repo that HAS
// commits — is never read as "no commits". All three must hold: HEAD is a
// symbolic ref; that ref is provably absent (`show-ref --verify` exit 1 — a
// corrupt ref or a missing object exits 128, a present ref exits 0); and the
// ref has no reflog (a deleted ref file with history keeps its logs/ entry).
// Locale-independent: exit codes and files only, no git message matching. Every
// other outcome, including any probe failing, is "not provably unborn".
function isUnbornHead(worktree) {
  const sym = runGit(['symbolic-ref', '-q', 'HEAD'], worktree);
  if (sym.failure || !sym.stdout) return false;
  const ref = sym.stdout;
  const shown = runGit(['show-ref', '--verify', '-q', ref], worktree);
  if (shown.failure !== FAILURE.GIT_ERROR || shown.exitCode !== 1) return false;
  const logPath = runGit(['rev-parse', '--git-path', `logs/${ref}`], worktree);
  if (logPath.failure || !logPath.stdout) return false;
  try {
    return fs.statSync(path.resolve(worktree, logPath.stdout)).size === 0;
  } catch (e) {
    return !!e && e.code === 'ENOENT';
  }
}

// Last-commit time of `worktree` in ms, as a raw probe for the run-liveness
// verdict module (#3973): null when the repo has no commit yet, THROWS when the
// answer could not be obtained (not a repo, timeout, unparseable value) so the
// caller can tell "no evidence" from "could not ask".
function lastCommitMs(worktree) {
  const { stdout, failure } = runGit(['log', '-1', '--format=%ct'], worktree);
  if (failure) {
    if (failure === FAILURE.GIT_ERROR && isUnbornHead(worktree)) return null;
    throw new Error(`could not read the last commit time of ${worktree}: git ${failure}`);
  }
  if (!stdout) return null;
  const ms = Number(stdout) * 1000;
  if (!Number.isFinite(ms)) throw new Error(`could not parse the last commit time of ${worktree}: ${stdout}`);
  return ms;
}

const DEFAULT_PROBES = {
  hostname: () => os.hostname(),
  pidAlive: (pid) => isPidAlive(pid),
  pidStartTime: (pid) => pidStartTime(pid),
  lockInUse,
  lastCommitAt: (worktree) => lastCommitMs(worktree),
  ownEventAt,
};

module.exports = { DEFAULT_PROBES, ownEventRecency, lastCommitMs };
