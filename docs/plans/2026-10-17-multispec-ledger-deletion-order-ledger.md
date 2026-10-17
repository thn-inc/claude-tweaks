# Open Items — #3420 Multi-spec ledger deletion runs before the batch curation pass that reads and writes the ledger

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | docs/skill-graph.md:397, plugin/skills/tidy/scan-procedures.md:54, plugin/skills/help/context-flow.md:142 still say ledgers are deleted at /wrap-up's Phase 4 — for a multi-spec auto/hybrid run it is now /flow's Shared teardown step 0; a one-clause pointer would help (SDD task review, minor) | deferred | SDD minor (deferred) — carried forward for review/wrap-up triage |
| 2 | build | cleanup-procedures.md:12 row 2 Condition cell still names the final-spec rule while the Deferred cell defers under MULTISPEC_REVIEW_DEFER=1 (plan kept the Condition cell unchanged; the caveat explains the split) (SDD task review, minor) | deferred | SDD minor (deferred) — carried forward for review/wrap-up triage |
| 3 | build | tests/multispec-ledger-deletion-order.test.js go-red control feeds a hand-typed pre-fix literal rather than git-show pre-fix content; the cross-file order pin rests on phrase presence (SDD task review, minor) | deferred | SDD minor (deferred) — carried forward for review/wrap-up triage |
