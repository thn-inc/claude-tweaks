// bin/lib/residue/probes/pipeline-runs.js — un-archived, already-closed run
// dirs. `iterRunDirsWithState` (bin/lib/hooks/context.js) permanently skips
// any run dir once its run-state.json reaches status: 'clean' — that is
// correct for every OTHER consumer (a clean run has nothing left to reconcile
// against live git/PR state), but it also means a run whose archival step
// got missed (the bug this file's sibling skill-prose fix, #717, addresses)
// becomes invisible to bin/lib/reconcile/archive-merged.js's own sweep
// forever after. This probe deliberately reads .claude-tweaks/pipelines/
// directly instead of going through iterRunDirsWithState, so it catches
// exactly the dirs that blind spot already produced. Findings are attributed
// to the invoking run (#1118): only a run dir the invoking run can claim
// (runId or worktree match) is tagged blast-radius; the rest are observed.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { makeFinding } = require('../finding');
const { mainCheckoutRoot, safeReal } = require('../../hooks/worktree-detect');
const { RUN_ID_RE } = require('../../hooks/context');
const { defaultIsPidAlive, lockedEvidence } = require('./worktrees');

// Realpath both sides of every path comparison: fixture/tmp paths and real
// worktrees routinely sit behind symlinks (macOS /var -> /private/var), and
// a string-compare on unresolved paths silently never matches. worktree-detect's
// exported safeReal returns null for a path that no longer exists, which both
// guards below read as "no match" — an already-removed worktree can't equal the
// live invoking root anyway.
//
// Deliberately duplicates, rather than imports, bin/lib/hooks/context.js's
// unexported worktreeMatches shape (name-or-worktree-realpath match) — that
// helper isn't part of context.js's public surface. `state` is always a
// non-null object here: the caller only reaches this after `state.status`
// tested equal to 'clean'.
function isOwnRun(entryName, state, runId, worktreeRootReal) {
  if (runId && entryName === runId) return true;
  if (worktreeRootReal && typeof state.worktree === 'string' && state.worktree) {
    return safeReal(state.worktree) === worktreeRootReal;
  }
  return false;
}

// Cross-checks a run's recorded `worktree` field against `scope.worktrees`
// (git worktree list --porcelain, already parsed by ../scope.js) to find a
// currently-locked entry — #1328: a `remedy: auto` archival must not fire
// while a live sibling session still holds that run's worktree. Realpaths
// both sides before comparing: `run-state.json`'s `worktree` is stamped via
// `path.resolve(...)` (post-tool-use.js), not necessarily realpath-form,
// and a fixture/tmp path (or a real worktree behind macOS's /var ->
// /private/var symlink) can otherwise never match on a plain string
// compare — the same hazard `isOwnRun` above already guards against.
// Returns the matching locked `scope.worktrees` entry, or null when
// `worktreePath` is empty, `scope`/`scope.worktrees` carries nothing
// (no lock information available), or no locked entry matches.
function findLockedWorktree(worktreePath, scope) {
  if (!worktreePath || !scope || !Array.isArray(scope.worktrees)) return null;
  const real = safeReal(worktreePath);
  if (!real) return null;
  return scope.worktrees.find((wt) => wt && wt.locked && safeReal(wt.path) === real) || null;
}

function probePipelineRuns({ cwd, runId, worktreeRoot, scope } = {}) {
  const start = cwd || process.cwd();
  const root = mainCheckoutRoot(start) || start;
  const worktreeRootReal = worktreeRoot ? safeReal(worktreeRoot) : null;
  const base = path.join(root, '.claude-tweaks', 'pipelines');
  let entries;
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      // No .claude-tweaks/pipelines/ at all is a normal, clean state (a repo
      // that has never run a claude-tweaks pipeline) — not a probe failure.
      return { ran: true, reason: null, findings: [] };
    }
    // Any other readdirSync failure (EACCES, EIO, ...) is a genuine probe
    // failure, not "nothing to report" — match the sibling probes'
    // ran: false / reason contract (probeRelease, probeBranches, probeSuite)
    // instead of silently reporting a clean sweep.
    return { ran: false, reason: `could not read .claude-tweaks/pipelines/ (${err.code || err.message})`, findings: [] };
  }

  const findings = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !RUN_ID_RE.test(entry.name)) continue; // skips archive/ and any non-run sibling
    const dir = path.join(base, entry.name);
    let state = null;
    try {
      state = JSON.parse(fs.readFileSync(path.join(dir, 'run-state.json'), 'utf8'));
    } catch {
      continue; // no readable run-state.json — nothing to classify as closed
    }
    if (!state || state.status !== 'clean') continue;
    // #1328: a status: clean finding is only safe to auto-archive when its
    // recorded worktree isn't still locked by a live sibling session —
    // blindly archiving out from under one corrupts that session's state.
    // Downgrade to the same remedy: 'record' vocabulary probeWorktrees
    // already uses for a locked worktree, so residue-sweep.md's existing
    // "locked worktree a live session still holds" -> blocked-external
    // mapping applies here too, instead of an unsafe auto-archive.
    const lockedWorktree = findLockedWorktree(state.worktree, scope);
    findings.push(makeFinding({
      kind: 'pipeline-run',
      // Attribution (#1118, superseding the #1011 audit that used to keep
      // this unconditionally blast-radius): a clean run dir is only THIS
      // run's own blast radius when the invoking run can claim it — its
      // name equals the invoking run's own id, or its run-state.json
      // `worktree` field resolves to the invoking checkout's toplevel.
      // Everything else is another session's orphan: real, cheap to archive,
      // but not this run's residue — observed live during record #706's
      // wrap-up, where a blast-radius sweep returned 6 other records' dirs.
      // Sibling orphans stay visible under --scope repo (/tidy's sweep),
      // and get compacted by /tidy's own 30-day archival-compaction rule
      // (plugin/skills/tidy/step-6-auto.md) — never by reconcile, which
      // structurally never sees a clean dir (see the header comment above).
      scope: isOwnRun(entry.name, state, runId, worktreeRootReal) ? 'blast-radius' : 'observed',
      subject: path.relative(root, dir),
      remedy: lockedWorktree ? 'record' : 'auto',
      evidence: lockedWorktree
        ? `run-state.json status: clean, but recorded worktree is still locked — ${lockedEvidence(lockedWorktree, defaultIsPidAlive)}`
        : 'run-state.json status: clean, not under .claude-tweaks/pipelines/archive/ — see wrap-up/cleanup-procedures-execution.md Section B for the archival move',
    }));
  }
  return { ran: true, reason: null, findings };
}

module.exports = { probePipelineRuns };
