// bin/lib/reconcile/squash-provenance.js — the second "is this branch
// merged?" proof the two branch checks (prune-remote.js, archive-branches.js)
// evaluate beside `git cherry` patch-id equivalence (#2252). #2251 switched
// the pr-first merge to `gh pr merge --squash`: a squash commit's patch-id
// matches none of the branch's own commits once the branch holds more than
// one, so cherry-equivalence reads every squash-merged multi-commit branch
// as unmerged and both checks would skip it forever.
//
// The proof is three conditions, ALL required: (1) the CONFIRMED per-branch
// PR state says MERGED (a GitHub fact, `resolvePrState`'s `gh pr list --json
// …mergeCommit` — the bulk screen omits mergeCommit, so a screen-shaped
// prState can never satisfy this); (2) that PR's own mergeCommit oid sits on
// the integration branch's first-parent history between the branch's fork
// point and the tip, bounded to `merge-base(integration, branch)..integration`
// — never an unbounded history walk, so a rewritten/force-pushed integration
// tip that no longer carries the oid resolves to false: not-yet-proven,
// never falsely proven; and (3, #2252 review F1) the branch's CURRENT tip
// reproduces the squash commit's tree — recreate the merge of `branch` onto
// the squash commit's own first parent (`{oid}^`, the integration tip as it
// stood at merge time) via `git merge-tree --write-tree`, and require the
// resulting tree to equal the squash commit's own tree. Condition (2) alone
// only proves a merge once happened: a branch that gained a commit AFTER
// that squash merge still satisfies (1) and (2) — cherry false, this oid
// check true — while carrying content the squash commit never saw;
// condition (3) is what ties the proof to the tip as it stands today, not
// merely to a merge that once happened. `merge-tree --write-tree` needs git
// >= 2.38; on an older git the call fails and the proof resolves to false —
// fail-safe (never a false delete), at the cost of recall on old git.
//
// Boolean, never null — unproven and unprovable both mean "skip" at every
// call site, so any git failure anywhere in this proof is simply false (fail
// safe), reported by callers as `not-proven-merged` /
// `merged-pr-without-cherry-equivalence` rather than as a distinct
// `cherry-failed`-style reason of its own — deliberate (#1082's vocabulary
// pin, and the failure is in the safe direction), so a reader of the reasons
// should not expect to distinguish the two. Same oid validation
// archive-merged.js's localHasMerge applies; that helper asks "is the merge
// commit anywhere in local history?" for run-dir archival, this one asks the
// narrower per-branch question the decision tables need.
'use strict';

const { runGit } = require('../hooks/git-exec');

function isSquashMerged(root, integration, branch, prState) {
  if (!prState || typeof prState !== 'object' || prState.state !== 'MERGED') return false;
  const mc = prState.mergeCommit;
  const oid = mc && typeof mc.oid === 'string' && /^[0-9a-f]{40}$/.test(mc.oid) ? mc.oid : null;
  if (!oid) return false;
  const fork = runGit(['merge-base', integration, branch], root);
  // An empty merge-base would degrade the range below to `..{integration}`
  // (= `HEAD..{integration}`), an unbounded scan in the wrong direction — the
  // `!fork.stdout` half of this guard is load-bearing. The `scan.stdout ===
  // null` check below is not: an empty scan is a legitimate empty window.
  if (fork.failure || !fork.stdout) return false;
  const scan = runGit(['rev-list', '--first-parent', `${fork.stdout}..${integration}`], root);
  if (scan.failure || scan.stdout === null) return false;
  if (!scan.stdout.split('\n').some((line) => line.trim() === oid)) return false;

  // Condition (3): the branch's CURRENT tip must reproduce the squash
  // commit's tree. Recreate the squash merge — `branch` onto the squash
  // commit's own first parent (the integration tip at merge time) — and
  // require tree equality. A commit landed on `branch` after the merge
  // changes the recreated tree; a conflicting recreation exits non-zero.
  // Either reads as false here.
  const parent = runGit(['rev-parse', `${oid}^`], root);
  const squashTree = runGit(['rev-parse', `${oid}^{tree}`], root);
  if (parent.failure || !parent.stdout || squashTree.failure || !squashTree.stdout) return false;
  const recreated = runGit(['merge-tree', '--write-tree', parent.stdout, branch], root);
  if (recreated.failure || !recreated.stdout) return false;
  return recreated.stdout === squashTree.stdout;
}

module.exports = { isSquashMerged };
