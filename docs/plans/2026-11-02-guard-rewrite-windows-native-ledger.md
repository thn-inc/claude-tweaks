# Open Items — Windows: the guard-rewrite normalizer declines a native plugin root and a native cd target

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build/ops | Confirm in a live Windows Claude Code session that the worktree-isolation guard treats a forward-slashed plugin root (`node "D:/…/bin/x.js"`) like a native one; the spec's ASSUMPTION — verify at build could not be probed from this darwin host (reason-not-auto: no-live-windows-session — a refusal there is the same refusal an unrewritten command gets today) | open | — |
| 2 | flow/ops | Pre-flight branch-divergence-check (resumed run 2026-11-03T100346): origin/main was 18 commits ahead of the worktree branch | fixed | Merged by build's Post-creation catch-up before any build task |
| 3 | build/ops | Before merge, replace record #4292's `## Release Note` section with the Plan-review answers item-1 text word for word (`plugin/bin/lib/compose-subject.js` reads the record's own section; the body still carries the unqualified note) (reason-not-auto: plan review never edits the live record) | open | — |
| 4 | build | SDD ruling — rule-2 mutant survivors are pre-existing test gaps, pinned in this build (Task 2 + final fix wave): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 5 | build | SDD ruling — no test for LEADING_CD's redundant backslash-dollar exclusion (duplicates includes($)): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 6 | build | SDD ruling — record #4292 Release Note replacement stays with ledger row 3 for the merge path: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 7 | build/skill | `pretooluse-updatedinput-normalizer` enrichment: a rule's must-decline pin must use an input every other check accepts (rule 2: a shipped `bin/` path), and be shown red with only that check mutated — #4292 found four rule-2 declines (`hasBareUse`, `inDoubt`, `complexParam`) earned by `shippedUnder` or the runner allowlist instead | observation | — |
