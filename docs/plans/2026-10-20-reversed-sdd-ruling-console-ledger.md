# Open Items — Record a reversed sdd-ruling item as reversed, not declined, in the PR console reply comment

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Task 2 neither-list pin ends at "is recorded `reversed`" (no closing paren): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — console-on-pr.md isRulingRow sentence worded so the plan's pin matches verbatim: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — final-review Important 1 fixed now via additive `resolve-console --reverse-failed <ids>` (reverse-failed outcome, not cleared; unflagged id rejected): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — Minor 6 schema example left as is; no isMergeRow+isRulingRow guard; literal declined-note test kept: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | tickResolveBoxIfAllExecuted name/param stale once reversals count as cleared (console-execute.js) | fixed | Renamed tickResolveBoxIfAllCleared in fix wave commit 5d6fbcfad |
| 6 | build | Existing declined test asserts the literal 'declined, no reason given' rather than DECLINED_NOTE (tests/resolve-console.test.js) | accepted | Final reviewer ruled the literal is the stronger pin (catches an edit to the constant) — kept deliberately |
| 7 | build | An item carrying both isMergeRow and isRulingRow would resolve reversed/cleared when unticked (console-execute.js) | accepted | No producer emits both: the merge row is cleanup item 4, a ruling is a Pending-review staged file — separate by construction (final review triage) |
| 8 | build | AC3.1 physical-line check is wrap-sensitive and would have passed against the old prose (tests/build-sdd-ledger-residue-carryforward.test.js) | fixed | Comment marking it a regression guard only added in fix wave commit 2666eb1d7; positive pins + doesNotMatch are the discriminating checks |
| 9 | build | Stale journey doc docs/journeys/ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md:64-65 | fixed | Rewritten to the new behavior + red flag + #3636 Origin line in fix wave commit 2666eb1d7 |
| 10 | build | Short wrapped lines at plugin/skills/_shared/console-execution.md:24 and :120-121 from the reflow | accepted | Cosmetic; the wrap is constrained by the AC3.1 line check (the line carrying `declined, no reason given` must not contain `ruling`) |
| 11 | build | Spacing typos: console-execute.js `has(item.id)&& (` and tests/resolve-console.test.js runRuling `=ghCalls.find(` | fixed | Spacing fixed by Common Step 3 /claude-tweaks:simplify (commit "Simplify #3636 changes") |
| 12 | build | console-execution.md resolve-console command template (Live-session accelerator) shows only --approve/--decline, not the optional --reverse-failed | open | — |
| 13 | build | A flagged ruling both ratified and named in --reverse-failed silently becomes reverse-failed — contradictory input unpinned by a test (console-execute.js) | open | — |
| 14 | build | Pre-existing: console-execution.md Write order says console.json `resolved: true` is written; code writes `resolved: allCleared` (false on any declined/reverse-failed item) | open | — |
