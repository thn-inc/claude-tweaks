# Open Items — Key the dispatch queue-order cache on every grouping setting, not only the stamp

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 8 commits ahead at run start | fixed | Post-creation catch-up merged origin/main 46e21cbf6c into the worktree branch (docs/plans/specs only, no key-file overlap) |
| 2 | build | eligibilityOptions(policy) in plugin/bin/lib/driver/lane-bounds.js re-reads the six second-call entries, so driver eligibility values are not the single read the fingerprint hashes (plain data with the real resolver; double read predates #6062) | deferred | Defer-reason: pre-existing-outside-diff — final whole-branch review agreed with the deferral |
| 3 | build | SDD ruling — only a throwing resolver call carries the fixed groupingFingerprint({}); non-throwing disabled paths carry the fingerprint of the values read: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
