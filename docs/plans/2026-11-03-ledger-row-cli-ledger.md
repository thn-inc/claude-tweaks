# Open Items — Give the open-items ledger a sanctioned append/settle CLI

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence check: origin/main was 21 commits ahead of the resumed branch (flow Step 2.5, held note) | fixed | Caught up by Post-creation catch-up merge `0226b86b6` |
| 2 | ops | Pre-flight branch-divergence check (run 2026-11-03T201815): origin/main was 16 commits ahead of the resumed branch (flow Step 2.5, held note) | fixed | Caught up by Post-creation catch-up merge `455de2f1a` |
| 3 | ops | Shape check (flow Step 2.6, held note): plan Task 3 declares 12 files, over the 5-file hard-fail signal; proceeded under auto (a prose migration whose per-file edits do not depend on each other) | open | — |
| 4 | build | Follow-up record (spec plan-review answer 2): `wrap-up-engine.js finish-console`'s `flipLedgerRow` path writes without `.ledger.lock` and has no terminal-row guard — file one backlog record auditing its legitimate transitions at wrap-up | open | Defer-reason: genuinely-larger — named out of this build's scope by the record's answer 2 |
| 5 | build | Follow-up record (spec plan-review answer 10): sweep every ledger producer's phase, add `docs` (and anything else found) to the Phase Taxonomy's Qualifier set, and make `ledger-row` validate `--phase` against the schema including `ops`'s `reason-not-auto` qualifier — file one backlog record at wrap-up | open | Defer-reason: genuinely-larger — named by the record's answer 10 |
| 6 | build | Follow-up record (build plan review, finding 1): decide whether `/test`'s QA ledger writes (`test/qa-reporting.md` Phase 5.5) and `/flow`'s parallel-wave Ledger fold (`flow/multispec-parallel-waves.md`) move to `hooks.js ledger-row` — both write rows in runs with a run dir, outside Deliverable 3's build/review/wrap-up sites — file one backlog record at wrap-up | open | Defer-reason: needs-human-decision — widening the human-enumerated site list (round-2 answer 3) is the human's call |
| 7 | build | SDD ruling — trailing punctuation trimmed from /pull/N URLs for fixed: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 8 | build | SDD ruling — Task 1 review Minors fixed in fix round 1: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 9 | build | SDD ruling — worktree-copy ledger test fixture carries a decisions.md: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 10 | build | SDD ruling — raw-pipe wording qualified for the standalone no-run-dir path: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 11 | build | SDD ruling — pinned step3-routing pipe sentence kept, run-dir clause added: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 12 | build | SDD ruling — Task 3 review Minors fixed in fix round 1: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 13 | build | SDD ruling — firstStrayArg value-flag skip walk left as is: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 14 | build | SDD ruling — fixed accepts this repo /commit/<sha> and /blob/ URLs: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
