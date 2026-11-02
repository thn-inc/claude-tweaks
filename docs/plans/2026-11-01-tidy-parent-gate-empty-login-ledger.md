# Open Items — Keep tidy's open-parent [parent-gate] rows when the gh api user lookup fails

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — fold the stale 4600 journey into Task 1 fix round 1 (plan Files list omitted it): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | WARNING does not say whether the probe errored or printed blank — reviewer judged "printed no login" accurate for both and gh's own stderr names the error; code stands | observation | — |
| 3 | review | Nothing asserted that a healthy login prints no WARNING (tiebreak:e2dac975c706) | fixed | f30500e64 — AC1.1 asserts no WARNING; proven red with the condition mutated to always warn |
| 4 | review | The WARNING did not say an [acceptance-gap] row can be a false positive (tiebreak:8a3b87c123ac) | fixed | f30500e64 — clause added and pinned in AC2.1 |
| 5 | review | "never suppress either of them" still counted two warnings (tiebreak:94b34f964907) | fixed | f30500e64 — reads "any of them" |
