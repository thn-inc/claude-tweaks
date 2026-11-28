// bin/lib/run-dir-guard.js
//
// Shared by resolve-profile.js (--run-dir) and resolve-policy.js (--run) —
// both call worktree-detect.js's checkRunDirAnchoredOrOutside (#1065) and
// then need the identical foreign-checkout-vs-no-repo-root message
// branching; only the flag name differs in the rendered error text. Was
// duplicated inline in both files before #1177 consolidated it here.
//
// Also home of isUnderPipelines (#5830), the one rule for "is this directory
// a pipeline run directory?" shared by the two near-identical resolveTarget
// guards, bin/lib/log-decision/append.js and bin/lib/stage-item/write.js.
// Their .git walk proves the dir sits in the main checkout; this proves it
// sits strictly inside <checkout>/.claude-tweaks/pipelines/, so
// `--run <main>/plugin` cannot turn a config.yml planted there into a run
// config. Archived (`pipelines/archive/<id>`) and nested multi-spec
// (`pipelines/<parent>/spec-<n>`) run dirs sit inside it too and stay accepted.
'use strict';
const path = require('path');
const wtDetect = require('./hooks/worktree-detect');
const { canonicalRealpath } = require('./path-guard');
const { isPathContained } = require('./shared-primitives');

// Returns null when runDir is anchored under the main checkout or resolves
// outside any git checkout (both accepted, per checkRunDirAnchoredOrOutside's
// own contract); otherwise the rendered rejection message for the given
// caller-facing flag name.
function anchoredOrOutsideMessage(runDir, cwd, flag) {
  const anchor = wtDetect.checkRunDirAnchoredOrOutside(runDir, cwd);
  if (anchor.ok) return null;
  return anchor.reason === 'foreign-checkout'
    ? wtDetect.unanchoredRunDirShadowMessage(anchor.resolved, anchor.mainRoot, flag)
    : wtDetect.unanchoredRunDirNoRepoMessage(cwd);
}

// realRunDir: the run dir's real path. gitRoot: the checkout root the caller's
// .git walk found. The pipelines base is realpath'd too, so a checkout whose
// `pipelines` is itself a symlink to another place in the checkout (the layout
// dispatch-resume.js --bound-run accepts) still accepts its run dirs; a
// run dir that is a symlink OUT of pipelines/ is judged by its real path and
// refused. Both sides go through path-guard's canonicalRealpath (OS casing) and
// shared-primitives' isPathContained (path.relative, never a string prefix); the
// pipelines dir itself is not a run dir, so equality is refused.
function isUnderPipelines(realRunDir, gitRoot) {
  const base = path.join(gitRoot, '.claude-tweaks', 'pipelines');
  // canonicalRealpath is null when the path cannot be resolved; the raw spelling then
  // fails closed: a pipelines dir that does not exist contains no existing run dir,
  // and realRunDir is already a real path from the caller.
  const realBase = canonicalRealpath(base) || base;
  const run = canonicalRealpath(realRunDir) || realRunDir;
  return isPathContained(run, realBase);
}

module.exports = { anchoredOrOutsideMessage, isUnderPipelines };
