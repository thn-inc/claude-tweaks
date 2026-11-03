# Open Items — Give the open-items ledger a sanctioned append/settle CLI

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence check: origin/main was 21 commits ahead of the resumed branch (flow Step 2.5, held note) | fixed | Caught up by Post-creation catch-up merge `0226b86b6` |
| 2 | ops | Pre-flight branch-divergence check (run 2026-11-03T201815): origin/main was 16 commits ahead of the resumed branch (flow Step 2.5, held note) | fixed | Caught up by Post-creation catch-up merge `455de2f1a` |
| 3 | ops | Shape check (flow Step 2.6, held note): plan Task 3 declares 12 files, over the 5-file hard-fail signal; proceeded under auto (a prose migration whose per-file edits do not depend on each other) | open | — |
| 4 | build | Follow-up record (spec plan-review answer 2): `wrap-up-engine.js finish-console`'s `flipLedgerRow` path writes without `.ledger.lock` and has no terminal-row guard — file one backlog record auditing its legitimate transitions at wrap-up | open | Defer-reason: genuinely-larger — named out of this build's scope by the record's answer 2 |
| 5 | build | Follow-up record (spec plan-review answer 10): sweep every ledger producer's phase, add `docs` (and anything else found) to the Phase Taxonomy's Qualifier set, and make `ledger-row` validate `--phase` against the schema including `ops`'s `reason-not-auto` qualifier — file one backlog record at wrap-up | open | Defer-reason: genuinely-larger — named by the record's answer 10 |
