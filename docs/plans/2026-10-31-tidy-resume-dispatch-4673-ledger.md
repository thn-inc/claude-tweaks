# Open Items — Point /tidy's Resume open PR offer at dispatch resume when the stalled run dir is gone

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead of the run branch | fixed | Post-creation catch-up merged origin/main (8731be3d5 → 457bfa15a) |
| 2 | build | SDD ruling — decline a runDir gone/present/unknown field in the stale-claim-pr.js verdict: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | accepted | ratified at Review Console — the plan Global Constraints fix the verdict keys (match, link, resume\|resolve, failure; no new keys) and the could-not-tell fallback is byte-identical to pre-#4673 behavior, so no consumer is misled |
| 3 | review | runDirGone in stale-claim-pr.js:146 re-implements dispatch-resume.js's classifyPriorRun archived/absent rule; the copies can drift (medium, Convention) | fixed | Exported classifyPriorRun, added a parity test over one world matrix (mutant on the archiving marker goes red) — 42fb95beb |
| 4 | review | RUN_ID_PREFIX_LENGTH in stale-claim-pr.js:138 duplicates resume-eligibility.js's private constant (low, Convention) | fixed | Exported from resume-eligibility.js and imported — 42fb95beb |
| 5 | review | tests/stale-claim-pr-cli.test.js:394 named for a root work/ stub but its fixture holds a root run-state.json (low, Test quality) | fixed | Renamed to match the fixture — 42fb95beb |
| 6 | review | stale-claim-pr.js:169 record-{n} slug gate narrows the record's AC1.1 wording (an archived run dir renders the dispatch resume line) for direct spec-{n} runs; tiebreak-confirmed, both verdicts recommend drop (info/low) | accepted | Intentional: dispatch resume only finds record-{n} runs (selectResumePr), so the gate prevents printing a command that refuses; documented in the CLI header and scan-procedures.md and pinned by the slug test |
| 7 | wrap-up | pr — PR #4739 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
| 8 | wrap-up | residue sweep suite probe not run (pack-fed, `--no-suite`); suite state taken from the runner's pass stamp at HEAD fa66c402d (tests 20469, pass 20465, fail 0) | observation | — |
