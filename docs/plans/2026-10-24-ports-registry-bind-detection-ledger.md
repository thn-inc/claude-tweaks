# Open Items — ports registry test: bind-detection test collides with the machine lease pool on port 20003

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | registry.test.js's rewritten bind-detection test no longer runs the default blockFree probe or checks that a mid-block taken port disqualifies the whole block. That multi-port check is inherent to the requested decoupling and is plausibly covered by probe.test.js | deferred | SDD task-review Minor (carried from progress.md). The reviewer judged it inherent to the spec's decoupling, not a defect |
| 2 | build | The injected probe in registry.test.js ignores its { size } argument. Harmless for this test | deferred | SDD task-review Minor (carried from progress.md). No action needed |
| 3 | build | Same failure class outside this record's scope: tests/bin-lib/ports/ensure.test.js binds real pool ports via listenOn(first.base), i.e. 20000+, at lines 71, 105, 133, 151, and 200. Under load it can hit the same EADDRINUSE flake #3759 fixed in registry.test.js. Candidate follow-up record | open | — |
