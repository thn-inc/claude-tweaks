// bin/lib/wrap-up/ledger-ownership.js — which docs/plans/ files belong to the
// current branch (#2887, #3566). A file the branch's diff against the merge base
// names, or that sits untracked in the worktree, is this run's; a file inherited
// from the base was written by another run. One definition shared by pack.js's
// ledger probe (read: which ledgers to count) and ledger-write.js's
// resolveLedgerPath (write: which ledger to flip or delete), so the two can't
// disagree about whose ledger a file is.
'use strict';

const PLANS_PREFIX = 'docs/plans/';

// The names of the files directly under docs/plans/ in a `-z` git path list.
function plansFileNames(nulSeparatedPaths) {
  return nulSeparatedPaths.split('\0')
    .filter((p) => p.startsWith(PLANS_PREFIX) && !p.slice(PLANS_PREFIX.length).includes('/'))
    .map((p) => p.slice(PLANS_PREFIX.length));
}

// The basenames under docs/plans/ this branch owns: added or changed against
// `base`, or untracked. Throws when `base` is missing or git fails — ownership
// cannot be guessed from a filename, so a caller fails closed on the throw.
function ownedPlansFiles({ worktree, base, git }) {
  if (!base) throw new Error('merge base unavailable — cannot attribute docs/plans ledgers to this run');
  const gitOptions = { cwd: worktree };
  return new Set([
    ...plansFileNames(git(['diff', '--name-only', '-z', '--relative', '--end-of-options', base, '--', PLANS_PREFIX], gitOptions)),
    ...plansFileNames(git(['ls-files', '--others', '--exclude-standard', '-z', '--', PLANS_PREFIX], gitOptions)),
  ]);
}

module.exports = { ownedPlansFiles };
