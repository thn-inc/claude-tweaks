# Open Items — plan-audit: Check E acceptance-criterion clause coverage (#3099)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence: origin/main was 2 commits ahead of local main at run start | fixed | Post-creation catch-up fast-forwarded the worktree to origin/main (11495183) |
| 2 | build | plan-audit Check B flags the plan file itself as unplanned whenever the plan carries a `Scope keywords:` line — its fs-walk includes `docs/superpowers/plans/`, so the plan matches its own keywords (exit 1 on every keyword-bearing plan). Pre-existing, but plan-audit.js is in this build's diff, so it passed the deferral gate's fix-now test | fixed | Task 7 (4a1fbe0): Check B's planned set now includes the audited plan file itself |
| 3 | review | checks.js module header listed only Checks A/B/C/D and the headroom check, omitting Check E (lens 3a, single-agent) | fixed | Header now names Check E |
| 4 | review | No test exercised Check E's quoted-text fallback via a coverage-map row — only the test-step side was pinned (lens 3f, single-agent) | fixed | Added checks.test.js row-quote test; verified red with the rowQuote disjunct removed |
| 5 | review | Waiver-over-citation precedence reported unpinned (lens 3f, single-agent) | accepted | False positive: the existing "waiver wins even when its line sits inside a test step" test cites AC2.3 in the step text itself, so a citation-first reorder would fail it |
| 6 | review | `--spec <dir>` (EISDIR) has no dedicated test (lens 3c, single-agent) | accepted | Same catch block as the pinned ENOENT case; reviewer confirmed exit 2 manually |
