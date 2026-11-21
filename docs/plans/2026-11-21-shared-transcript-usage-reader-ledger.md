# Open Items — Read transcript usage through one shared max-per-message.id reader

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | score.test.js appended late-partial fixture uses an arbitrary 00:00:01 timestamp that could extend seconds; the test never asserts seconds (reviewer: harmless) — observation, no defect | observation | — |
| 2 | build | Minor 2 duplicate PLUGIN_ROOT — Ruling: keep both — scanTranscript direct callers (tests) need the module default and the CLI explicit pluginRoot pass is the plan injection point (mirrors its funnel PLUGIN_ROOT threading) — if wrong, one redundant constant | observation | — |
| 3 | build | pre-existing over-width readUsage comment line ending (#5556) in transcript.js, untouched by this branch — Ruling: leave it — CLAUDE.md Surgical changes forbids reformatting adjacent code — if wrong, one long comment line | observation | — |
| 4 | build | SDD ruling — mergeUsage floors a null prev at 0 while readUsage keeps its raw first-row value: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
