# Open Items — specify: refuse digest containers passed by explicit reference (#4142)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Task 1 review minor: `plugin/skills/specify/SKILL.md` Anti-Patterns row still says "plus the parent-guard residue strip" — now also the digest-guard strip (stale restatement) | fixed | Anti-Patterns row now names both residue strips — `fe9abf365` |
| 2 | build | Task 1 review minor: `SKILL.md` batch branch lead clause "including the parent-record guard and the `needs:definition` check above, per element" omits the digest-container guard | fixed | batch lead clause now names the digest-container guard — `fe9abf365` |
| 3 | build | Task 1 review minor: `SKILL.md` batch branch all-digest case says "shapes nothing" but not what renders (Next Actions) | fixed | all-digest case states no shaped-record Next Actions row applies; refusal rows render — `fe9abf365` |
| 4 | build | Task 1 review minor: `tests/specify-digest-guard.test.js` test 3 title claims the fail-all exclusion but does not pin "It is not a resolution failure" | fixed | test 3 now pins the not-a-resolution-failure sentence — `fe9abf365` |
| 5 | build | SDD ruling — Task 1 Step 3 discrimination check runs in a scratch `git worktree add`, never the shared worktree: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 6 | build | SDD ruling — Task 1's four Minor findings ledgered `open` (fix-now, in-scope) rather than `deferred`: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 7 | review | 3j Skill load delta: plugin:specify floor +2,308, closure +2,797 on 38 entries; 1 new unresolved citation token `specs/digest.md` (local-files digest container, already cited by tidy/SKILL.md) | observation | Informational per step3-skill-load-delta.md; no action |
| 8 | wrap-up | pr — PR #4320 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | Handled by the Review Console / merge step |
| 9 | wrap-up | suite — residue sweep suite probe not run (fact pack skips it via --no-suite) — suite state taken from the runner pass stamp: full pass at dea1505b7, re-verified before merge | observation | Final verify.js run recorded before merge |
