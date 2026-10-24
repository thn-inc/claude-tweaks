# Open Items — Probe the integration branch before reflect files a skill-gap record (#3987)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Task 1 review Minor: placement assert in tests/reflect-integration-branch-probe.test.js combined existence and order in one assert.ok | fixed | 87c4a18cf — split into four asserts; scoped re-review ADDRESSED |
| 2 | build | Task 1 review Minor: paragraph() slice in tests/reflect-integration-branch-probe.test.js has no guard for a missing trailing blank line | accepted | Unreachable — test 1 asserts the `Number {n}` sentence follows the probe paragraph, so the blank line always exists while the suite passes |
| 3 | build | SDD ruling — minor #1 fixed now rather than deferred (deferral-gate fix-now): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | build | SDD ruling — minor #2 accepted as unreachable: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
