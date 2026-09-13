// bin/lib/residue/probes/worktrees.js — leftover git worktrees for the
// residue sweep. Reports every worktree other than the main working tree
// and this run's own (excluded via `scope.headBranch`, mirroring
// `probeBranches`'s self-exclusion) — another session's live worktree, or a
// stale one nobody tore down.
//
// `REAPER_DOMAIN` distinguishes the two permanently separate worktree
// domains from `docs/decisions/0004-worktree-two-domain-convention.md`:
// `.claude/worktrees/` (native `EnterWorktree`, auto-collected by the
// `SessionStart` reaper — `bin/lib/hooks/worktree-reap.js`) versus
// `.worktrees/` (git-fallback `git worktree add`, cleaned up only by
// superpowers' `finishing-a-development-branch`, never by the reaper). A
// finding's evidence line says which domain it's in precisely because that
// determines whether leaving it alone is safe (the reaper will eventually
// collect it) or a real leak (it never will).
//
// Lock handling distinguishes a live session (do not touch) from an
// abandoned lock (a crashed/killed session's leftover) via a real
// liveness probe (`process.kill(pid, 0)`), not just lock presence — a
// locked-but-dead worktree is exactly the case a human needs to see, not
// one this probe should silently treat as "someone's using it."
'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { makeFinding } = require('../finding');

const REAPER_DOMAIN = path.join('.claude', 'worktrees');

// `lockReason` carries the owning pid as free text, e.g.
// "claude session foo (pid 16478 ...)". Extraction fails toward "unknown"
// (null) rather than throwing — a lock reason in an unexpected shape must
// not crash the sweep, it must just leave the pid unreported.
function extractPid(lockReason) {
  if (!lockReason) return null;
  const m = /\bpid (\d+)\b/.exec(lockReason);
  return m ? Number(m[1]) : null;
}

// Real liveness check: signal 0 probes for existence without actually
// sending a signal. ESRCH means no such process (dead). Any other error
// (most commonly EPERM — process exists, owned by someone else) means the
// pid IS live; only ESRCH means it is not.
function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code !== 'ESRCH';
  }
}

// Renders the locked-worktree evidence string, distinguishing a live
// session from a stale/abandoned lock (or one whose pid can't be confirmed
// either way) rather than reporting every lock identically. Exported so
// ./pipeline-runs.js's own locked-worktree cross-check (#1328) can reuse
// the exact same wording/shape instead of re-deriving it.
function lockedEvidence(wt, isPidAlive) {
  const branch = wt.branch || 'unknown';
  const pid = extractPid(wt.lockReason);
  if (pid === null) {
    return `git worktree list --porcelain: locked, branch ${branch}, pid unknown (lock reason: ${wt.lockReason ? JSON.stringify(wt.lockReason) : 'none'})`;
  }
  let alive;
  try {
    alive = isPidAlive(pid);
  } catch {
    // Fail toward "can't confirm" rather than crashing the sweep.
    alive = null;
  }
  if (alive === true) return `git worktree list --porcelain: locked, branch ${branch}, live session (pid ${pid} running)`;
  if (alive === false) return `git worktree list --porcelain: locked, branch ${branch}, abandoned lock (pid ${pid} not running)`;
  return `git worktree list --porcelain: locked, branch ${branch}, pid ${pid} (liveness could not be confirmed)`;
}

// Real dirty check: `git status --porcelain` against the worktree's own
// path. Non-empty output means uncommitted or untracked files are present.
// A read failure (path gone, permission error, some other transient git
// error) returns `null` — "could not confirm" — never `false`: collapsing
// an unreadable check into "clean" is exactly the silent-unsafe-default
// shape this probe exists to avoid (#1424's own root cause was a check
// that was never run at all; a check that fails open on error would just
// relocate the same hazard rather than closing it).
// 10s, matching bin/lib/hooks/git-exec.js's measured ceiling for a git query
// under real multi-worktree contention (#134) — a hang here would otherwise
// block the whole residue sweep indefinitely.
const IS_DIRTY_TIMEOUT_MS = 10000;

// #1796: the shared `git status --porcelain` reader — `defaultIsDirty`
// (below) reduces this to a boolean; `reap-merged.js`'s `removal-failed`
// branch needs the raw lines themselves (to carry a dirty-file list on the
// escalation issue, per that record's Deliverable 2), so this is pulled out
// once rather than each caller running its own `execFileSync` against the
// same command. Returns the raw porcelain lines verbatim (never split a
// rename's ` -> ` or trim a status prefix's leading space — both are
// significant), or `null` on a read failure — same fail-toward-"could not
// confirm" contract `defaultIsDirty` already documented before this split.
function readPorcelainStatus(worktreePath) {
  try {
    const out = execFileSync('git', ['-C', worktreePath, 'status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: IS_DIRTY_TIMEOUT_MS });
    const lines = out.split('\n');
    if (lines[lines.length - 1] === '') lines.pop(); // trailing newline's empty tail entry (and the empty-output case)
    return lines;
  } catch {
    return null;
  }
}

function defaultIsDirty(worktreePath) {
  const lines = readPorcelainStatus(worktreePath);
  if (lines === null) return null;
  return lines.length > 0;
}

function probeWorktrees({ scope, isPidAlive = defaultIsPidAlive, isDirty = defaultIsDirty } = {}) {
  if (!scope || !scope.ran) {
    return { ran: false, reason: (scope && scope.reason) || 'scope unresolved', findings: [] };
  }
  const findings = [];
  for (const wt of scope.worktrees) {
    // The first entry of `git worktree list` is the main working tree. It is
    // never residue, and removing it is not a thing that can happen.
    if (wt === scope.worktrees[0]) continue;
    // The worktree this session is standing in right now is always present
    // and always locked at Step 8.5 — reporting it demands a per-item answer
    // for a worktree that is, definitionally, still in active use by this
    // very run. `probeBranches` already excludes the equivalent self
    // reference via `scope.headBranch`; mirror it here.
    // `scope.headBranch` is null under a detached HEAD (`git branch
    // --show-current` returns empty), which would defeat this exclusion —
    // but every plugin-provisioned worktree (native `EnterWorktree` or the
    // git-fallback `git worktree add -b <branch>`) always checks out a named
    // branch, never detaches HEAD, so this gap is unreachable in practice for
    // a worktree this probe could ever be running inside of (#227).
    if (scope.headBranch && wt.branch === scope.headBranch) continue;
    const reaped = wt.path.includes(REAPER_DOMAIN);
    // Only decides remedy for the unlocked branch — a locked worktree is
    // already `remedy: 'record'` regardless of dirty state. `dirty === true`
    // is the one confirmed-bad case this check can report; `null` ("could
    // not confirm") deliberately does NOT flip remedy to `record` — that
    // would read an unrelated git-status failure as proof of uncommitted
    // work, which it isn't. Only a confirmed-clean or confirmed-dirty read
    // changes behavior from today's locked-only gate.
    const dirty = wt.locked ? null : isDirty(wt.path);
    // A live lock means a session is using it; that is a human's call —
    // still true regardless of whether the pid backing that lock turns
    // out to be live or stale. `dedup.decide` (never wired — see #225's
    // Gotchas) is the mechanism that would suppress a recurring
    // known-invariant row; this probe only makes the row informative.
    // A confirmed-dirty unlocked worktree is the other human's-call case
    // (#1424): committed-history merge state says nothing about
    // uncommitted work sitting in the tree, so `dirty: true` routes to
    // `record` exactly like a lock does, never `auto`.
    const remedy = wt.locked || dirty === true ? 'record' : 'auto';
    findings.push(makeFinding({
      kind: 'worktree',
      // Every worktree that reaches here is, by construction, NOT the one
      // holding this run's own headBranch (excluded above) — so it is on a
      // branch this work did not produce: another session's live worktree,
      // or a stale leftover from a prior run. Never this run's own blast
      // radius, so it is never `blast-radius`.
      scope: 'observed',
      subject: wt.path,
      remedy,
      evidence: wt.locked
        ? lockedEvidence(wt, isPidAlive)
        : `git worktree list --porcelain: unlocked, branch ${wt.branch || 'unknown'}, dirty: ${dirty === null ? 'unknown (git status check failed)' : dirty}, ${reaped ? 'in reaper domain' : 'outside reaper domain (no reaper collects it)'}`,
    }));
  }
  return { ran: true, reason: null, findings };
}

module.exports = {
  probeWorktrees, REAPER_DOMAIN, extractPid, defaultIsPidAlive, defaultIsDirty, readPorcelainStatus, lockedEvidence,
};
