# Open Items — Make build's full verify the last tree change before /test (#3060)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Ruling: AC4 size check runs against RAIL_BYTES 52,500 B (budgets.js, tests/bin-lib/skill-audit/context-cost.test.js) — the spec's 46,080 B CEILING_BYTES was decommissioned by #3311; if wrong, a reviewer flags a size rule nobody enforces | observation | SKILL.md 46,888 B after build, under RAIL_BYTES |
| 2 | build | Ruling: fix all three final-review Minors (intro order, Steps 3+4.5 paragraph, re-check before re-running verification) in one fix wave — <100 B prose; if wrong, costs ~100 B of wording | observation | Fixed in c570bcd6b; scoped re-review: all 3 ADDRESSED |
| 3 | review | Step 5 lead-in (SKILL.md:284) claims "the verified tree is the final one" though Step 5.5 Category A fixes can still edit tracked files after verification (3a, both agents) | fixed | Reworded to "includes the journeys and synced docs"; journey doc states the 5.5 exception — `5495bc798` |
| 4 | review | New order-pin test reads SKILL.md with raw fs.readFileSync instead of tests/helpers/read-skill.js `readText` (3a x2, 3f x2) | fixed | Switched to `readText` — `5495bc798` |
| 5 | review | Low-confidence (single agent): re-check clause lacks Model-version checklist note (3a); AC1.2 pins one literal phrase and heading anchors carry a colon (3f) | observation | Direct read: clause is an ordering consequence from the SDD final review; the phrase and colon anchors are the literals the record's AC1 prescribes; staged as low-confidence for the console |
| 6 | review/hindsight | Step 5.5 Category A operational fixes still land after the final verification and can force /test's full re-run; the spec's "5.5 writes ledger rows only" Gotcha is wrong for Category A | deferred | → backlog candidate `staged/reflect-1.md` (Defer-reason: tangential) |
