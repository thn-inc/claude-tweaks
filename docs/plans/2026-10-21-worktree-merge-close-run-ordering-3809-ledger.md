# Open Items — flow worktree-merge closes every run before the multi-run merge (#3809)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Step 2.5 pre-flight branch-divergence-check: origin/main was 1 ahead of local main at pre-flight — continued (auto) | observation | Post-creation catch-up merged origin/main (no-op after the pre-creation reconcile and the main fast-forward push of 5a4293816); the worktree starts at the integration tip |
| 2 | build | SDD ruling — accept the E1 finding against the plan text — E1 resolves the newest non-terminal run regardless of owner: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — fold the Resolve-now re-close wording into the same fix round: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | two prose-only clauses unpinned (step 4 re-protect link, Skip bullet never-closed-when-predicted) — Re-protect section enumerates the triggers independently; optional extra pins | open | — |
| 5 | build | pre-check-error skip (stderr, no CONFLICT) has no Post-Merge Summary row — nearest row Skipped (conflict) mislabels it | fixed | Fixed in the final fix wave 9bf6e7af2 — Post-Merge Summary gained "Not merged (pre-merge check failed: {reason}) — run still active" |
| 6 | build | Resolve-now says E1 deny message names the run it checked — it names the assigned worktree path, not the run (wording, worktree-merge.md:126) | fixed | Fixed in the final fix wave 9bf6e7af2 — Resolve-now now says the deny names the assigned worktree; find its run dir and repeat |
| 7 | build | E1 sentence omits that a commit targeting another live run worktree or a foreign repo is allowed — accurate for the conflict-path main-checkout case (worktree-merge.md:44) | open | — |
| 8 | build | SDD ruling — fix final-review Important 1-3 and Minors 4, 5, 6, 8 in one wave (Important 2 via env -u CLAUDE_CODE_SESSION_ID): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 9 | build | SDD ruling — defer the stale close-run rationale in auto-merge-short-circuit.md and local-merge-auto-finish.md to a follow-up record: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 10 | build | SDD ruling — decline the close-after-push design note — spec and suite pin close-before-merge: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 11 | build | SDD ruling — accept every Declined-to-judge line from the final review: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 12 | build | Resolve-now's git commit --no-edit leaves "# Conflicts:" comment lines in the merge commit body (closing keywords intact) — use --no-edit --cleanup=strip | open | — |
| 13 | build | SDD ruling — residual guard-abort-after-close-run gap is load-bearing for AC3 — carried to /review for the fix: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
