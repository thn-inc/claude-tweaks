# Open Items — Resolve the remaining bare-name citations in the skill load model (#3634)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | rule (f) hit also gated on exists(named) beyond the brief — a no-op for a live listing, keeps stale entries out of the closure | deferred | Origin: SDD Task 1 review (minor). Files: plugin/bin/lib/skill-audit/load.js. Trigger: revisit only if a listFiles source can list files readFile cannot read. |
| 2 | build | walkCitable test lacks a *.md-named directory case and a multi-entry sort-order case | deferred | Origin: SDD Task 1 review (minor). Files: tests/bin-lib/skill-audit/load.test.js. Trigger: the next change to walkCitable. |
| 3 | build | identical readdir wrapper duplicated in load-delta.js and skill-load-report.js | deferred | Origin: SDD Task 2 review + whole-branch review (minor). Files: plugin/bin/load-delta.js, plugin/bin/skill-load-report.js. Trigger: a third CLI needs the same citable-file walker. |
| 4 | build | step-19-emil-skills.md:5 bare `SKILL.md` is generic/external — left unresolved, counted in the PR's per-class figures | deferred | Origin: SDD Task 3 review (minor). Files: plugin/skills/init/bootstrap/step-19-emil-skills.md. Trigger: the citation grammar gains an external-skill class. |
| 5 | build | head walker includes gitignored .md under skills/agents while load-delta's changedFiles excludes them | observation | Ruling: consistent with head readFile reading the working tree; none exist today (whole-branch review Minor #5, parked). |
| 6 | build | SDD ruling — keep the exists(named) gate on rule (f): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 7 | build | SDD ruling — two flagged bare SKILL.md lines are in scope (per-pair counting): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 8 | build | SDD ruling — 3 more owned bare SKILL.md pairs fixed, 6 generic/external left unresolved: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 9 | build | SDD ruling — fix whole-branch findings #1-#4 in one wave, park #5 as observation: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
