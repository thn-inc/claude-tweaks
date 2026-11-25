# Open Items — test: the QA pass stamp has no bookkeeping-only exemption, so a ledger commit forces a QA re-run on unchanged code

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Task 1 Minor 1 (null HEAD passes decideQaSkip when bookkeepingDelta is true): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — Task 1 Minor 2 (dirty/stamp:null assertions in AC4.1 test sit before the sha gate): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — Task 1 Minor 3 (OTHER fixture is 'b'.repeat(40), not 'd'): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — Task 2 re-review out-of-scope Minor (selfPath plumbing untested; plan-review clarification unpinned): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — Task 3 Minors (suites: [] assertion lacks a frozen control; PRE_BOOKKEEPING control near-tautological; SKILL.md 'same, but report' phrasing slightly implicit): ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | SDD ruling — final fix-wave residual Minor (empty-commit test comment names the verify.js #5075 difference without its reason): ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 7 | build/skill | verify-scope-rule-kind extends: selectScope now has a second consumer, qa-stamp.js --check --scope (mode none = QA-bookkeeping), so a new rule kind that changes what reads as none also changes when browser QA skips; resolveScopePath/scopeSelfPath now live in lib/verify/declaration.js | observation | — |
