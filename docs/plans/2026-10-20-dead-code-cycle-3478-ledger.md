# Open Items — candidates-dead-code.js loads with circular-dependency warnings when required directly (hub cycle with focus-generators)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Step 2.5 pre-flight branch-divergence-check: origin/main was 1 commit ahead of the dispatch-entered worktree branch (continued under auto) | fixed | Post-creation catch-up fast-forwarded the worktree to origin/main 44b59b5ea |
| 2 | build | candidates-dead-code.js:239 comment says IDENTIFIER_RE accepts it, but IDENTIFIER_RE moved to source-scan.js | fixed | 024644855 (comment now names source-scan.js's IDENTIFIER_RE) |
| 3 | build | source-scan.js listTrackedSourceFiles comment still said 'for this vertical's own dead-export/orphan-file scan' after the move to a shared leaf | fixed | 024644855 |
| 4 | build | .claude/skills/code-health-focus-vertical/SKILL.md:3 frontmatter description still said 'the require-order and anchor rules' | fixed | 1e11c8076 |
| 5 | build | Comments at candidates-abstraction-police.js:14, candidates-test-hygiene.js:14, candidates-security-hardening.js:120 say SOURCE_EXTS is shared via source-scan.js though it is now module-private there | observation | Still accurate as a description of where the constant lives; no consumer imports it (final re-review out-of-scope observation) |
| 6 | build | SDD ruling — T2 Step 2's grep excludes focus-generators.js's registry autoload line (`require('./candidates-dead-code')` is the registry contract, not a sibling import): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 7 | build | SDD ruling — fold Task 1's two stale-comment minors into Task 2's dispatch: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 8 | build | SDD ruling — fix all four final-review minors in one wave, including dropping SOURCE_EXTS from source-scan.js exports despite the plan's Interfaces list: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
