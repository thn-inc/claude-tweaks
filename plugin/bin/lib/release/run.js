'use strict';

// Reused by bin/release-local.js (#2254): the branch/clean-tree guard, and the
// fetch → ancestry re-check → push ordering. `onDiverged` is the caller's own
// partial-state message (the commit/tag already exist locally — do NOT re-run).
function guardReleasableTree(deps, { branch = 'main' } = {}) {
  const current = deps.git(['branch', '--show-current']).trim();
  if (current !== branch) throw new Error(`releases run from ${branch}; current branch is "${current}"`);
  if (deps.git(['status', '--porcelain', '--untracked-files=no']).trim() !== '') {
    throw new Error('working tree has tracked modifications — commit or restore them first');
  }
}

// `remoteBranchExists: false` — the branch is not on origin yet (release-local's
// first release into a fresh remote, #2254): there is no origin/<branch> to fetch
// or compare against, so the fetch would die with "couldn't find remote ref" and
// the ancestry check would have nothing to check. Push straight out.
function pushAfterAncestryCheck(deps, { branch = 'main', refs = [branch], onDiverged, remoteBranchExists = true }) {
  if (!remoteBranchExists) { deps.git(['push', 'origin', ...refs]); return; }
  deps.git(['fetch', 'origin', branch]);
  try {
    deps.git(['merge-base', '--is-ancestor', `origin/${branch}`, 'HEAD']);
  } catch {
    throw new Error(onDiverged);
  }
  deps.git(['push', 'origin', ...refs]);
}

module.exports = { guardReleasableTree, pushAfterAncestryCheck };
