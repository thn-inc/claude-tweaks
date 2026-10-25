# Open Items — Close standalone run dirs on every exit, not only on success — beyond release

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD minor (deferred): sweep/SKILL.md Step 4 said "when a parent handed it down", contradicting sweep's Contract (no skill invokes sweep) | fixed | b44743eac — final-review fix wave Minor 2 reworded sweep/init/dream-pass |
| 2 | build | SDD minor (deferred): backlog/refine-closing-summary.md capitalised "An" after a colon, present only to satisfy the P_INHERITED pin | accepted | Cosmetic; final whole-branch review triaged it "leave" (a case-insensitive P_INHERITED could clean it on a later edit) |
| 3 | build | SDD minor (deferred): a dispatch-parked `pending-review` wrap-up run's directory (inherited from /flow) stays open | accepted | By design and outside created-dir scope: a parked pending-review run stays `active` for re-entry via `/claude-tweaks:wrap-up #{n}`, whose item 8 closes it; final review triaged it "leave" |
| 4 | build | SDD minor (deferred): conformance completeness check passed an empty-array PINS entry | fixed | b44743eac — assertEveryMinterPinned requires ≥1 entry, ≥1 pattern, and P_STATEMENT per minter, with go-reds |
| 5 | build | SDD minor (deferred): backlog/SKILL.md Contract paragraph (~line 102) still says the `refine`/`overview`/`attention` resolution is "for logging only", contradicting the branch's new sentence (~line 105) that overview and attention never resolve or write a run directory | fixed | Review fix: backlog/SKILL.md Contract paragraph reworded so only refine resolves a run dir; overview/attention resolve none |
| 6 | build | SDD ruling — batch Tasks 2-5 and 6-9 into two dispatches, each reviewed as one unit: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | |
| 7 | build | SDD ruling — fold Task 1's allowlist empty-parse-floor minor into batch A: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | |
| 8 | build | SDD ruling — fix final-review Important 1 in code (residue probe skips clean tidy/sweep standalone dirs with non-empty staged/; dream excluded): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | |
| 9 | build | SDD ruling — leave deferred minors 2 (capitalised An) and 3 (dispatch-parked inherited dir) per final-review triage: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | |
| 10 | build | SDD ruling — file the wrap-up Stop-and-re-engage resume-gap follow-up via /claude-tweaks:capture from the controller, not the fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | |
| 11 | wrap-up | pr — PR #4302 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | |
| 12 | wrap-up | residue suite probe not run — skipped via --no-suite; suite state taken from the runner stamp (full pass at 009459c37, 17589/17591) | observation | |
