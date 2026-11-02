# Open Items — Unify the two explicit --repo host-pin mechanisms behind one seam (#4795)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow/ops | Pre-flight branch-divergence check (resumed run 2026-11-02T105113-record-4795): origin/main was 32 commits ahead of the branch | fixed | Post-creation catch-up merged origin/main 02335d0b3 into the branch (merge commit 4f68dfd87); plan's line refs in repo-resolve.js shifted by #4854's upstream edit, semantics unchanged |
| 2 | build/skill | bin-source-scan-conformance extension: a blank-mode scan keyed on an identifier (tests/gh-host-seam-conformance.test.js's GH_HOST_BUILD, #4795) is blind to a quoted or computed key (`{ "GH_HOST": h }`, `env["GH_HOST"] = h`) because blank mode empties string contents — such a scan names that recall limit in its comment, or matches quoted keys over a literal-keeping text | observation | Skill Observation from Common Step 4.5; wrap-up's Skills curation decides |
