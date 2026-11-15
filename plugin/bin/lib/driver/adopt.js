'use strict';
// The `drive.js #N --run <dir>` guard (#5232): /claude-tweaks:dispatch has already minted the run
// directory and created and entered the group's linked worktree, and the driver adopts both instead
// of minting `drive-{n}` and creating `drive-record-{n}`.
//
//   adoptRun({ runDir, cwd }, deps)
//     -> { ok: true, runDir, runId, wt, branch, mainRoot } | { ok: false, why }
//
// Four checks, in order, each a refusal:
//   1. the run directory resolves under the main checkout by the guard log-decision.js applies
//      (resolveTarget, the copy beside the claim-log writer the run-dir step calls): it exists, and
//      the nearest `.git` above its real path is the main checkout's directory, never a worktree's
//      `.git` file (a worktree-local shadow), another checkout, or none;
//   2. its real path is a direct child of {main}/.claude-tweaks/pipelines, so a dot-segment path or
//      a symlink that lands elsewhere inside the checkout is not a run directory;
//   3. the working directory sits in a linked worktree of that main checkout: the nearest `.git`
//      above it is a file whose gitdir names the same main checkout, and it is not the main
//      checkout itself;
//   4. that worktree is on a branch (`git branch --show-current` prints one), since the push names it.
// It writes nothing. Checks 1-3 read the file system directly, as policyStep's mainCheckoutRoot does;
// check 4 is the one call through deps (a read).
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
  let branch = '';
  try {
    branch = String(deps.git(['-C', top, 'branch', '--show-current'], { cwd: top })).trim();
  } catch {
    branch = '';
  }
  if (!branch) return { ok: false, why: 'adopted worktree has no branch (detached HEAD or unreadable)' };
  return { ok: true, runDir: real, runId: path.basename(real), wt: top, branch, mainRoot: main };
}

module.exports = { adoptRun };
