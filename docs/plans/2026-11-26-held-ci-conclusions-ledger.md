# Open Items — Merge-verification classifies a cancelled or action_required CI run as green

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — held checks group by bare check name, not gh name/workflow/event: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — a nameless held check holds, fixed in the shared classifier (fail closed): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling (procedural) carried as audit, not staged: Tasks 5 and 6 share one merge-bundle byte budget (final bundle 52,446 B of 52,500 B) | observation | — |
| 4 | build | pr-checks.js inherited-red decisions line joins failing names without the unnamed mapping, so a nameless failing row would render an empty slot (pre-existing, likely unreachable: red rows come from named failing entries) | observation | — |
| 5 | build/skill | The held-conclusion list now lives in three hand-kept places (classify.js, the Step 2.5 prose bullet, and the github-pr-scan.md fence's FAILURE/HELD literals, which cannot require classify.js under its stub-root test). Each pair is pinned by extracting the live literal. This extends prose-code-twin-pin's three-or-more-places rule with a "fence literal that cannot import its twin" case. | observation | — |
| 6 | review | Release preflight ciTip counted a cancelled, action_required or stale tip run as failure (pack.js, 3e pair); driver merge gate and classify tests had held-rule gaps (3f pair) | fixed | 0e86315af: ciTip reads held as pending, held cases added to the driver merge test, two non-discriminating classify tests replaced |
| 7 | review/hindsight | Build's family-rule sweep missed one conclusion reader (release-preflight pack.js ciTip) that review's 3e lens found by a repo-wide grep; the rest of the approach is sound (no other consolidation or convention drift) | accepted | No further change: the miss is fixed in 0e86315af; the sweep rule already exists in the sweep-and-caller-audit memory, so no new skill entry |
