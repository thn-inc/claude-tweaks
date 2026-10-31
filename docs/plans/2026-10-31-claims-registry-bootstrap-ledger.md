# Open Items — claim-targets: a missing claims-registry branch is reported as a contested claim (holder null)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of the worktree branch at /flow Step 2.5 (auto: continued) | fixed | Post-creation catch-up merged origin/main into the worktree branch (99fb0d4fd → 746d6de2b, merge commit 746d6de2b) before any build task |
| 2 | build | SDD ruling — ensureClaimsBranch keeps one refusal channel (network blip during bootstrap exits 6, not 4; secondary-rate-limit carved out to exit 4): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — Task 5 also appends exit 6 to docs/plugin-structure.md claim-targets CLI line (mirror of the exit list): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
