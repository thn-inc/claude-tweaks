# Open Items — verify.js baseline adjudication: serial reruns by default, timeout back-off, stable per-slot scratch path (#5150)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch divergence: origin/main was 14 commits ahead of local main at flow start, and local main carries 1 unpushed reconcile archive commit (8946fd39a) that rides along | fixed | Post-creation catch-up merge brought origin/main (f0d68d551, #5119) into worktree-flow-spec-5150 before any build commit; the archive commit rides along by design for a human-present run |
| 2 | ops | File-overlap warning: #5150 shares verify files with open #4898, #5069, #5075, #5093, #5162, #5167, #5168 (verify.js, verification.md, declaration.js) | acknowledged | Informational at Step 2.8; the run proceeds with #5150 only, and a later record touching the same files rebases on this one |
