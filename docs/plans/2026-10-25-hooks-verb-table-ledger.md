# Open Items — hooks.js: table-driven verb dispatch so USAGE keys double as dispatch keys

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD minor (Task 1): unknown-verb stderr printed the old 'known subcommands' hint and then the usageText() listing — verb names twice | fixed | Final-review fix wave, commit 5b1773897 (plugin/bin/hooks.js unknown/missing-verb path) |
| 2 | build | SDD minor (Task 1): spec Release Note 'No user-visible change' vs constructor/toString --help/__proto__ now exiting 1 instead of 0 | accepted | Final-review triage: intended fix of a swallowed-throw bug (old exit 0); release-note wording carried as SDD ruling #7 for the Review Console |
| 3 | build | SDD minor (Task 1): tests/hooks-help-guard.test.js runHook ignores spawnSync r.error | accepted | Final-review triage: a spawn failure yields code:null and fails every code assertion loudly — no false-green path |
| 4 | build | SDD minor (Task 2): hooks-js-verb-registration SKILL.md row 1 said 'apart from row 2' though rows 3 and 8 also land in hooks.js | fixed | Final-review fix wave, commit 5b1773897 (.claude/skills/hooks-js-verb-registration/SKILL.md row 1) |
| 5 | build | SDD minor (Task 2): cli-wrapper-contract.md #1143 history sentence still says 'one USAGE lookup table' | accepted | Final-review triage: accurate as #1143 history; the next sentence states the #4181 VERBS shape |
| 6 | build | SDD ruling — tests/hooks-help-guard.test.js runHook switched to spawnSync so stderr is captured on both exit paths: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 7 | build | SDD ruling — spec Release Note 'No user-visible change' left unchanged despite AC2's new usage listing and prototype-name exit 1; PR/changelog wording left to review/wrap-up: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 8 | build | SDD ruling — deferred minors triaged per final reviewer (runHook r.error and #1143 history sentence left; duplicate-names minor folded into the fix wave): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 9 | build/skill | `.claude/skills/hooks-js-verb-registration` (rows 1/3/8) and `gh-api-module-pattern/cli-wrapper-contract.md` described the old USAGE-map + `cmd ===` branch registration; both were updated in this branch to the VERBS-table shape (commits 6b61bcaf9, 855b2e4d6, 5b1773897) | observation | Skills now match the shipped hooks.js; nothing further for wrap-up beyond confirming |
