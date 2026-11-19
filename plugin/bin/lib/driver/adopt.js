'use strict';
// The `drive.js #N --run <dir>` guard (#5232): /claude-tweaks:dispatch has already minted the run
// directory and created and entered the group's linked worktree, and the driver adopts both instead
// of minting `drive-{n}` and creating `drive-record-{n}`.
//
//   adoptRun({ runDir, cwd }, deps)
//     -> { ok: true, runDir, runId, wt, branch, mainRoot } | { ok: false, why }
//
// Five checks, in order, each a refusal:
//   1. the run directory resolves under the main checkout by the guard log-decision.js applies
//      (resolveTarget, the copy beside the claim-log writer the run-dir step calls): it exists, and
//      the nearest `.git` above its real path is the main checkout's directory, never a worktree's
//      `.git` file (a worktree-local shadow), another checkout, or none;
//   2. its real path is a direct child of {main}/.claude-tweaks/pipelines, so a dot-segment path or
//      a symlink that lands elsewhere inside the checkout is not a run directory;
//   3. the working directory sits in a linked worktree of that main checkout: the nearest `.git`
//      above it is a file whose gitdir names the same main checkout, and it is not the main
//      checkout itself;
//   4. the pair belongs together: the run directory's run-state.json, which dispatch's bind
//      (`hooks.js record-worktree`) wrote, names that worktree once both are realpath'd;
//   5. that worktree is on a branch (`git branch --show-current` prints one), since the push names it.
// One more refusal belongs to adoption but is not here: that branch must not be the integration
// branch, which this guard cannot see yet. steps.js's policyStep refuses it once it resolves the ref,
// before the claim and any write.
// The run directory's anchor and the worktree's are one main checkout without a further check:
// resolveTarget anchors the run directory to mainCheckoutRoot(cwd), and check 3 requires
// mainCheckoutRoot(top) to equal that same root.
// It refuses before writing anything; its one write is the best-effort `lane: 'driver'` fill of the
// run's manifest.json (#5903).
// Checks 1-4 read the file system directly, as policyStep's mainCheckoutRoot does;
// check 5 is the one call through deps (a read).
const fs = require('node:fs');
const path = require('node:path');
const { resolveTarget } = require('../log-decision/append');
const { mainCheckoutRoot, safeReal } = require('../hooks/worktree-detect');
const { lstatType } = require('../path-guard');

// The nearest directory at or above `start` holding a `.git` entry of any type, with that type; null when none.
function nearestGitEntry(start) {
  let dir = start;
  while (dir) {
    const { type } = lstatType(path.join(dir, '.git'));
    if (type !== 'missing') return { dir, type };
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// Why the run directory's run-state.json does not bind it to worktree `top`, or null when it does.
// One direct read: a missing or unparseable file is caught here, never checked for first.
function runStateMismatch(real, top, platform) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(path.join(real, 'run-state.json'), 'utf8'));
  } catch {
    return 'is unreadable';
  }
  const recorded = state && typeof state === 'object' ? state.worktree : undefined;
  if (typeof recorded !== 'string' || !recorded) return 'names no worktree';
  // record-worktree writes path.resolve of its argument, not a realpath.
  // A Windows path is case-insensitive (drive letter and directories) and fs.realpathSync keeps the
  // spelling it was given, so win32 compares folded; the platform is deps.platform, never process's.
  if (platform === 'win32') {
    const recordedReal = safeReal(recorded) || path.resolve(recorded);
    return recordedReal.toLowerCase() === top.toLowerCase() ? null : 'names a different worktree';
  }
  return safeReal(recorded) === top ? null : 'names a different worktree';
}

function adoptRun({ runDir, cwd }, deps) {
  const target = resolveTarget({ runDir, cwd });
  if (!target.ok) return { ok: false, why: `run directory ${target.reason}` };
  const real = path.dirname(target.file);
  const main = mainCheckoutRoot(cwd);
  if (!main || path.dirname(real) !== path.join(main, '.claude-tweaks', 'pipelines')) {
    return { ok: false, why: 'not a run directory under the main checkout' };
  }
  const found = nearestGitEntry(safeReal(cwd));
  if (!found || found.type !== 'file' || found.dir === main || mainCheckoutRoot(found.dir) !== main) {
    return { ok: false, why: 'working directory is not a linked worktree of the main checkout' };
  }
  const top = found.dir;
  const mismatch = runStateMismatch(real, top, deps.platform);
  if (mismatch) return { ok: false, why: `run-state.json of the run directory ${mismatch}: not bound to this worktree` };
  let branch = '';
  try {
    branch = String(deps.git(['-C', top, 'branch', '--show-current'], { cwd: top })).trim();
  } catch {
    branch = '';
  }
  if (!branch) return { ok: false, why: 'adopted worktree has no branch (detached HEAD or unreadable)' };
  try { require('../run-manifest/write').fillRunManifest(real, { lane: 'driver' }); } catch { /* never changes the adoption */ }
  return { ok: true, runDir: real, runId: path.basename(real), wt: top, branch, mainRoot: main };
}

module.exports = { adoptRun };
