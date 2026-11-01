# Open Items — Reject a malformed --run-id in pr-resume-line.js before it reaches resumeVerdict

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | claim-store.js comment near line 625 notes flow/claim-targets.md restates the run-id shape in prose (re-review out-of-scope observation; a prose twin of RUN_ID_SHAPE outside this diff) | accepted | Not a defect, so nothing to route (Defer-reason was pre-existing-outside-diff, but the build row named no staged path or record, so it read as an incomplete deferral). The twin is intentional and already pinned on main: claim-store.js's comment above RUN_ID_SHAPE names flow/claim-targets.md as the one remaining prose copy, and tests/issue-claims-stale-open-pr-conformance.test.js ("the run-id shape is restated only in flow/claim-targets.md") fails if it drifts or spreads. Corrected at wrap-up Phase 1 re-check. |
| 2 | build | SDD ruling — header --run-id note names RUN_ID_SHAPE, USAGE synopsis left unchanged: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | wrap-up | pr — PR #4874 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
| 4 | wrap-up | unknown — residue suite probe skipped via --no-suite; suite state taken from the verify stamp (full, baseline-adjudicated, verifies HEAD c5bf69b48) | observation | — |
