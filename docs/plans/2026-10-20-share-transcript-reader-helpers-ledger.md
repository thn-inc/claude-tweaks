# Open Items — Share the transcript and plugin-root reader helpers duplicated across the skill-audit CLIs (#3461)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — AC1.2 is satisfied by the single stat-error template in statTranscriptOrThrow; readDispatches' notFound reasons and phase-timing.js's parser keep their `transcript not readable` text: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — pluginRootReader resolves the base realpath lazily (a widening of headSide) so a plugin root deleted before the index build degrades instead of throwing: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | plugin-root-reader.js header says "moved here from headSide" — names a symbol that no longer exists | fixed | Header reworded in `9958d66e8` (Task 2 fix round 1), re-confirmed in `432a18151` |
| 4 | build | plugin-root-reader.js readFile comment says "inside the repository" — base is now generic | fixed | "inside the base" in `9958d66e8`; remaining "outside the repository" phrase fixed in `432a18151` |
| 5 | build | pluginRootReader memoizes realBase after the first successful resolve — stale if the base is recreated at a different target mid-run | deferred | Origin: #3461 Task 2 review (minor). Files: plugin/bin/lib/skill-audit/plugin-root-reader.js. Trigger: revisit if a long-lived caller (not a one-shot CLI) ever reuses one reader across a base replacement; a stale value fails closed (reads return null), never reads outside the base. |
