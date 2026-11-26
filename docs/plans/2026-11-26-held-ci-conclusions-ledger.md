# Open Items — Merge-verification classifies a cancelled or action_required CI run as green

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — held checks group by bare check name, not gh name/workflow/event: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — a nameless held check holds, fixed in the shared classifier (fail closed): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling (procedural) carried as audit, not staged: Tasks 5 and 6 share one merge-bundle byte budget (final bundle 52,446 B of 52,500 B) | observation | — |
| 4 | build | pr-checks.js inherited-red decisions line joins failing names without the unnamed mapping, so a nameless failing row would render an empty slot (pre-existing, likely unreachable: red rows come from named failing entries) | observation | — |
| 5 | build/skill | The held-conclusion list now lives in three hand-kept places (classify.js, the Step 2.5 prose bullet, and the github-pr-scan.md fence's FAILURE/HELD literals, which cannot require classify.js under its stub-root test). Each pair is pinned by extracting the live literal. This extends prose-code-twin-pin's three-or-more-places rule with a "fence literal that cannot import its twin" case. | observation | — |
