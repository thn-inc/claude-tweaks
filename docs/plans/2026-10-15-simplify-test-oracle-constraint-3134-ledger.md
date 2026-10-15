# Open Items — simplify criteria: test-oracle constraint (#3134)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Task 1 added a separate "simplification fragment carries test-oracle constraint" test instead of extending the existing signature-criteria test as the brief said; AC is still met (SDD minor, deferred) | deferred | — |
| 2 | test | Full suite locally: 5 pre-existing failures (verify/cli.test.js x4, wrap-up/engine-verify.test.js x1) also fail at origin/main; verify --baseline breaks on spaced paths. Follow-up staged for capture | deferred | staged/capture-verify-baseline-local-failures.md |
