# Open Items — 4600: Backstop hand-closed above-floor parents that carry no acceptance disposition

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — closedParentGap passes no hasParent (nested parent reported as gap): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — SINCE computed inline per closed fetch and LOGIN read from a session-scoped file instead of exported vars: apply or decline at the Review Console (staged/build-deviation-1.md) | open | — |
| 3 | build | SDD ruling — github-pr-scan-acceptance.md at 52,439 B (61 B under the 52,500 rail) misses the plan's 52,000 B target; do not split the Fallback subsection (the dispatcher inlines scope sections whole, so a split hides the exit-4 path from the scan agent), instead trim the new prose and code to reach <= 52,000 B in the fix round: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — Fallback composer checked by text match only: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — isParent clause reads '(a hand-closed one: parent-gate below)' rather than the brief's fuller wording: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — implementer sorted the merged open+closed parent list by id: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — local warning line names a local-files remedy (sub-issue records' parent facet) instead of the GitHub-only work-links/backlog-fetch-limit: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build | SDD ruling — local Shape 7 keeps its needsDefinition filter ahead of the closed branch, diverging from the GitHub twin: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 9 | build/skill | `skill-prose-conformance-tests` extension: a fence that substitutes a `gh`-fed shell variable (`SINCE=…`, `LOGIN=$(gh api user …)`) trips `skill-fence-guard-shapes`' `gh-computed-input` refusal, so a plan's fence design should compute dates inline (`$(node -p …)`) and land `gh` output in a file the node block reads | observation | — |
