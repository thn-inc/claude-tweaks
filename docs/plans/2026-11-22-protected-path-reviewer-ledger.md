# Open Items — Let a protected path require the driver's reviewer instead of refusing

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task 1 minor: tests/policy-schema.test.js DRIVER_KEYS row for express-driver-protected-paths uses other === policyVal === reviewer; final whole-branch review: not a defect, the run-config test still distinguishes default from policy source | observation | — |
| 2 | build | SDD task 2 minors: evaluateDiffBounds protectedPaths dedupe compares raw paths (git paths are canonical, a duplicate only lists a path twice in a note) and eligibility.test.js compares BUILD_TIME_PROTECTED_RES with its own filter (the family loop above does the real check); final whole-branch review: leave, not defects | observation | — |
| 3 | build | SDD task 3 and 5 minors: cli.js protected-path note sits before the runner-stamp clause (both writers agree, no parser reads it); AC9 check half tested at CLI level for one build-time family (eligibility.test.js loops all 8); queue.test.js refuse/build-time cases lack an in-test positive control (sibling reviewer-on test anchors them); final whole-branch review: leave, not defects | observation | — |
