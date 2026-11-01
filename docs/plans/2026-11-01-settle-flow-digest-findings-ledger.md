# Open Items — Settle 3 digest findings in flow

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — implementer temp-edits pr-early-open.js for go-red proofs, restored via git checkout: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | accepted | ratified at Review Console — allowed for the implementer (sequential dispatch, nothing else in flight, single file it edited itself); reviewers still never mutate the tree |
| 2 | build | SDD ruling — Task 1 recorded-path no-push assert folded into Task 2: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | accepted | ratified at Review Console — same test file, one assertion, covered by Task 2's review |
| 3 | build | SDD ruling — Task 1 go-red probe covers both reuse paths (shared rebind): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | accepted | ratified at Review Console — both reuse paths call the same rebind, so one hoisted-write mutation discriminates both |
| 4 | build | SDD ruling — worktree-merge.md line 48 wording kept as written: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | accepted | ratified at Review Console — reviewer itself judged it reads fine and line 46 directly precedes it |
| 5 | build | SDD ruling — worktree-merge.md line 106 pointer tightened in the fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | accepted | ratified at Review Console — same paragraph block, one prose edit in the fix wave |
| 6 | build | SDD ruling — commit 1858d76 "replaces" subject not rewritten; PR body must not say replaces: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | accepted | ratified at Review Console — never rewrite pushed commits; the PR body and release note must not say the comparison replaces the older pins |
| 7 | wrap-up | pr — PR #4870 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
| 8 | wrap-up | probe — suite — residue suite probe skipped via --no-suite; the run's verification pass stamp (verify.js, scoped e8deca8ce, full f28a84607) is the suite evidence | observation | — |
