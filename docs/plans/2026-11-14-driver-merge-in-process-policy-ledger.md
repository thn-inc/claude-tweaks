# Open Items — Resolve policy in-process in driver/merge.js instead of spawning resolve-policy.js

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | review | Medium Test Quality: realDeps.resolvePolicyCore production wiring (plugin/bin/lib/driver/run.js:477) had no test; the real-core test injected resolvePolicy directly | fixed | Fixed in 61bf790e0: merge.test.js real-core test now resolves through run.js realDeps.resolvePolicyCore; breaking the seam turns it red (mutation-verified) |
