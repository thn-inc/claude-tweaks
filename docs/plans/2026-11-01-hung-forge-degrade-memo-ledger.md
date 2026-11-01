# Open Items — Decide how a hung-forge run avoids paying the forge probe on every hooked call (#4830)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD minor (Task 1): policy-schema.js FORGE_DEGRADE_MEMO_TTL_MS comment stated memo behavior as design intent until Tasks 2-4 wired it — re-check wording at final review | fixed | Final whole-branch review fix wave rewrote the comment (memo answers for the next TTL; concurrent hook processes each probe) — commit a1582135b |
| 2 | build | SDD minor (Task 1): tests/hooks-pre-tool-use.test.js pins the policy-schema TTL literal from the pre-tool-use suite | accepted | Brief-mandated pin; the gate tests cover TTL behavior and the final review triaged it acceptable — a duplicated pin costs nothing |
| 3 | build | SDD ruling — hooks.md memo sentences appended at the bullet's end, not mid-sentence: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | build | SDD ruling — hung git remote probe reads as a definitive local-merge and persists prExempt (route to its own record): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 5 | build | SDD ruling — concurrency-only "nothing to clear" branch left without a committed test: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
