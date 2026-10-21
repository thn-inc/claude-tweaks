# Open Items — Group identical fan-out rows in the skill load delta table

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | `plugin/skills/review/review-summary-template.md:21` compact line "{N} entry point(s) moved — largest ΔClosure {signed bytes} on {entry}" is ambiguous now that 3j rows can be grouped (N should sum group counts; "on {entry}" unclear for a grouped row) | fixed | Compact line now counts a grouped row as its {count} and names its first entry + "+{count−1} more" (fix-now, Common Step 6.5) |
| 2 | build | `docs/journeys/read-a-skill-load-delta-at-review-3307.md` lines 28/37/41 describe the ungrouped table | fixed | Journey step 3 updated for grouped rows (Common Step 6) — `8a963e0d5` |
| 3 | build | No test for an exactly-three-member group (the `… +k more` tail absent at n=3) | fixed | Exactly-three-member group added to the `renderText` test (wrap-up Phase 3 fix-exhaust); reverting `> 3` to `>= 3` turns it red (`… +0 more`) |
| 4 | build | Grouped row prints the first member's new-unresolved order while the group key sorts them (harmless, deterministic) | accepted | Members of a group share an identical new-unresolved set by construction (the key sorts it); only display order differs, and it is deterministic (first member's order) — not a defect |
| 5 | build | `step3-skill-load-delta.md` does not state Floor/Closure show a single value when min equals max | fixed | Outcome 3 now says "(one value when every member's is the same)" (fix-now, Common Step 6.5) |
