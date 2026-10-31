# Open Items — Settle 5 below-floor digest findings in issues

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Task 3: add a leaf pin test for markdown-blocks.js (plan said grep-only): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build/skill | lib-module-split extends: its leaf-module section frames the requires-nothing pin test as the cycle-breaking leaf case (#4153), but #4645 moved primitives to a neutral-home leaf (`plugin/bin/lib/markdown-blocks.js`) with no shim and no cycle motive, and the plan under-applied the pin (grep only) until the task review cited the skill. The skill could say the pin applies to any module whose header or docs claim it requires nothing, and add a no-shim "migrate every importer" variant beside the facade and re-export shapes. Its sweep also missed a project-skill claim outside the moved module (`.claude/skills/gh-api-module-pattern/batching-failure-posture.md`, stale after the builder collapse), which the final review caught | observation | Architecture-alignment skill observation (Common Step 4.5), for /wrap-up's Skills curation row |
