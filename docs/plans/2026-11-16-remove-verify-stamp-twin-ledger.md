# Open Items — Remove the bare-SHA verify stamp twin and the --stamp-status legacy key (#5534)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — removed the inert `legacy: true` key from three stamp fixtures (changed-files.test.js ×2, scope.test.js ×1) against the plan constraint to keep them; the spec only requires the tests stay green; if wrong, restoring three object keys undoes it: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build/skill | Skill observation (.claude/skills/removal-condition-execution): extends its "retarget (a pin), never only delete" rule — a retargeted pin keeps the feature it was named for but can drop a second rule the old fixture exercised by accident (the bare stamp had no dirty field, so the retargeted --git-dir test stopped covering "stored dirty must be exactly false"; caught only by the whole-branch review mutation, fixed in 8775229de). Candidate wording: before retargeting, list every assertion the old test made and say where each one lives afterwards. | observation | — |
