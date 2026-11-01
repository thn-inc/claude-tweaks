# Open Items — Let a project opt out of /init declaring claude-tweaks in its committed settings

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Implementers run targeted suites only; full suite central at Common Step 5: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — Task 1 resolveIn tmpdir leak fixed in Task 2 (fix-now): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — Task 2 minors 1-4 fixed now; 103-col note line kept (cosmetic): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — Task 3 Step 5 test slice ends at Fleet status heading: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — Task 3 fleet opt-out line keyed on the key, not the entry: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | SDD ruling — Task 3 print-line wording kept as ruled: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 7 | build | SDD ruling — Final review minors fixed; kernel self-heal opt-out awareness deferred (tangential): ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 8 | build | SDD ruling — Final fix-wave residual minors fixed via one targeted dispatch: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 9 | build | plan's AC3.1 no-gap bullet mis-attributes which test pins the replaces-first sentence (a separate test pins it) | observation | Parked at Task 3: code stands. The plan is the pre-execution argument and the shipped test file is the record; nothing downstream reads that bullet |
| 10 | build | Routine kernel self-heal (`_shared/routine-template-schema.md`) is unaware of `declare-claude-tweaks: false`: at `false` every fleet firing self-heals via a setup script that no longer installs claude-tweaks, then fails diagnosably at "version unresolved" | deferred | Defer-reason: tangential. A new capability the final review suggested, outside this diff's files; route it to `/claude-tweaks:capture` |
| 11 | build | The installed older plugin build reports `declare-claude-tweaks` (this repo's `.claude-tweaks/policy.yml:15`) as an unrecognized key until a release carrying the key is installed, so `/init` policy review, `/help` policy and `/harness-health` may flag it | observation | No code fix exists (expand-contract gap, precedent #3128); note it in the PR body and close any harness-health issue filed in the gap |
