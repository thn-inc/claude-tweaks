# Open Items — Consolidate the Timing/Dispatches render prose into one cited contract (#3413)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | archive-rule assertion pinned `archive/{run-id}/` but not the ``as `--run` `` clause (SDD Task 1 minor) | fixed | `9861503ef` — regex now requires ``archive\/\{run-id\}\/` as `--run`` |
| 2 | build | `contractRoles` closes on the first `)` after `one by role (` — a parenthesized role name would truncate the parse (set comparison still goes red) (SDD Task 1 minor) | deferred | Origin: SDD Task 1 review; files: `tests/timing-prose-conformance.test.js`; trigger: a `ROLE_PATTERNS` role name gains parentheses |
| 3 | build | `#3413 AC1` Timing-section slice ends at the next `\n### ` — a nested `###` inside the Timing section would shrink it (fails loud, not open) (SDD Task 2 minor) | deferred | Origin: SDD Task 2 review; files: `tests/timing-prose-conformance.test.js`; trigger: a template adds a `###` subheading inside `### Timing` |
| 4 | build | `docs/journeys/see-which-phase-spent-the-tokens-1929.md:25` says `#1928 AC6` pins the command across all three templates — pre-existing inaccuracy, not introduced by #3413 (SDD Task 2 + final-review minor) | deferred | Origin: SDD Task 2 review and final whole-branch review Minor 7; files: `docs/journeys/see-which-phase-spent-the-tokens-1929.md`; trigger: next edit to that journey or the #1929 pins |
| 5 | build | Ruling: Task 1's phase-table skeleton is the full 5-line source table (plan said 4 lines) — byte-identity to the source table is the binding rule — cost if wrong: none | observation | — |
| 6 | build | Ruling: final-review Minor 7 (journey 1929:25) left unfixed — pre-existing and the spec keeps #1929 journey entries as they are — cost if wrong: one stale journey sentence | observation | — |
| 7 | build | Ruling: AC4 go-red tier control and Task 2 Step 6 revert drop `` `capable`, `` instead of the plan's `` `frontier`, `` (frontier is followed by `;`) — cost if wrong: none | observation | — |
