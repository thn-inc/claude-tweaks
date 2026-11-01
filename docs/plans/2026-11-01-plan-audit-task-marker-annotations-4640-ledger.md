# Open Items — plan-audit: --task-markers reads '**Review risk:** high (reason)' as no risk, silently (#4640)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — stderr warning says "that field reads as unmarked", not the spec example "the task": ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — changed the shared runTaskMarkers test helper, not any #3378 case body: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | review | The --task-markers stderr-warning test never printed a value with whitespace, so a regression printing only the leading token passed (plugin/bin/plan-audit.js:122) | fixed | AC4 case now uses `trivial (why)`; mutant printing the leading token goes red — `22d21b2c7` |
| 4 | review | Convention — "— intended," dropped from the override sentence at plugin/skills/build/plan-authoring-checks.md:99 | accepted | Cut to stay inside the skill rail (52497 of 52500 bytes; restoring it would breach); the "since the author sees the full task text" clause still states the reason |
| 5 | review | runTaskMarkers helper switched from execFileSync to spawnSync (tests/bin-lib/plan-audit/cli.test.js:484) | accepted | Info only; the same decision as row 2 (SDD ruling); the change only makes the #3378 cases stricter |
