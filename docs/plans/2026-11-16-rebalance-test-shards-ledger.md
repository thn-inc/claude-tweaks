# Open Items — Even out the test shards (#5756)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight: origin/main was 5 commits ahead of local main, which carried 10 unpushed reconcile archive commits; continued, and the worktree branch was reset to origin/main so none ride into this PR | acknowledged | Continued under auto; the 10 archive commits stay on local main for the maintainer to push. |
| 2 | build | SDD ruling: durations map recorded on the CI runner, not locally (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling: AC4.2 per family takes option A (other family from its expectation table) (staged/sdd-ruling-2.md) | open | — |
| 4 | review | Test name AC4.3 [files] (queue-pull-parity-ac7.test.js:124) claimed F-corrupt/F-groups stop checks its body never makes | fixed | Renamed to describe its tail-row check; the stops stay in AC4.3 [gh] (commit 6c92c3f46d) |
| 5 | review | Test title at queue-pull-parity-ac4.test.js:33 names the gh and files rows and D1 in one pool; this file's pool now holds the gh rows only | accepted | Intentional: the spec keeps every test name byte-identical except AC4.2/AC4.3 so the test-impact map and #5227 references resolve; the comment at ac4:31-32 states the name is kept |
| 6 | review | Describe titles AC4 fetch failures (ac4, ac7) and AC7.2 files inputs (ac7, d1) repeat across files | accepted | Intentional: follows from the approved per-family split under the byte-identical names rule; node --test reports each file separately, so nothing collides |
| 7 | review | Helper module queue-pull-helpers.js sits beside the queue-pull fixtures, not under tests/helpers/ as Deliverable 2 worded it | accepted | Intentional: the spec's Technical Approach and Key Files name tests/bin-lib/dispatch/queue-pull-helpers.js, beside queue-pull-fixtures.js and queue-pull-oracle.js |
| 8 | review | Real-map guard's sizeOf (run-tests-shard.test.js:145) throws on a vanished file instead of returning null | accepted | False positive as a defect: listTestFiles walks the disk just before, and a file deleted mid-run fails the test loudly, which is the wanted behavior |
| 9 | review | DURATIONS_SIZE_FLOOR_BYTES and DURATIONS_CEILING_MS exported from tools/run-tests.js with no outside reader | accepted | Intentional: the plan's stated interface, matching the module's exported tuning constants PER_FILE_OVERHEAD_MS and DEFAULT_FILE_MS; the tests pin the thresholds with literals on purpose |
| 10 | review/hindsight | Refreshing tools/test-durations.json on CI needs a temporary workflow pushed and removed each time (done twice on this branch) | deferred | Defer-reason: tangential; staged as a born-ready record proposal at staged/reflect-1.md for the Review Console's Queue writes gate |
| 11 | wrap-up | pr — PR #5763 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | — |
