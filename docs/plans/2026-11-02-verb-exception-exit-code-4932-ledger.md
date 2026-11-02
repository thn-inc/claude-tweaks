# Open Items — hooks.js: an unexpected exception in a VERBS command exits 0 via the entry catch (#4932)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 2 commits ahead of local main at run start (2defc6d05, d8aa7716b). | fixed | Local main and origin/main were both at 7ab86605b by worktree creation; the worktree branched from it, and the post-creation catch-up merges were no-ops |
| 2 | build | re-review residual: a delete-ledger throw after fs.unlinkSync would leave an uncommitted ledger deletion that item 2 does not handle — Ruling: not reachable in practice: the only statement after the unlink is process.stdout.write (hooks.js:1200-1201), whose pipe errors surface asynchronously rather than as a sync throw — cost if wrong: one uncommitted ledger deletion in a worktree torn down after merge | observation | Final whole-branch review triaged it acceptable: a sync throw at the success write is caught by the local catch at hooks.js:1202 first, and the ledger-residue reconcile check already reports leftover ledgers |
