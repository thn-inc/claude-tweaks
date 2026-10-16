# Open Items — plan-audit: Check E acceptance-criterion clause coverage (#3099)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence: origin/main was 2 commits ahead of local main at run start | fixed | Post-creation catch-up fast-forwarded the worktree to origin/main (11495183) |
| 2 | build | plan-audit Check B flags the plan file itself as unplanned whenever the plan carries a `Scope keywords:` line — its fs-walk includes `docs/superpowers/plans/`, so the plan matches its own keywords (exit 1 on every keyword-bearing plan). Pre-existing, but plan-audit.js is in this build's diff, so it passed the deferral gate's fix-now test | open | Added to the plan as Task 7 (exclude the audited plan file from Check B's planned set) |
