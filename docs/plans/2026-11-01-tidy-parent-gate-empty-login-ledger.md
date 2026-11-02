# Open Items — Keep tidy's open-parent [parent-gate] rows when the gh api user lookup fails

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — fold the stale 4600 journey into Task 1 fix round 1 (plan Files list omitted it): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | accepted | Ratified at the Review Console (auto-resolved at unattended); the journey fix stays in this branch |
| 2 | build | WARNING does not say whether the probe errored or printed blank — reviewer judged "printed no login" accurate for both and gh's own stderr names the error; code stands | observation | — |
| 3 | review | Nothing asserted that a healthy login prints no WARNING (tiebreak:e2dac975c706) | fixed | f30500e64 — AC1.1 asserts no WARNING; proven red with the condition mutated to always warn |
| 4 | review | The WARNING did not say an [acceptance-gap] row can be a false positive (tiebreak:8a3b87c123ac) | fixed | f30500e64 — clause added and pinned in AC2.1 |
| 5 | review | "never suppress either of them" still counted two warnings (tiebreak:94b34f964907) | fixed | f30500e64 — reads "any of them" |
| 6 | wrap-up | The micro-plan path skips the size-headroom check | fixed | plugin/skills/build/micro-plan.md — Size headroom paragraph added (reflect-1) |
| 7 | wrap-up | Tiebreak info severity has no routing path | deferred | #4937 — origin reflect light; plugin/bin/review-routing-line.js; revisit when that record is built. Defer-reason: pre-existing-outside-diff |
