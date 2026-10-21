# Open Items — reconcile does not expand an explicit checks subset with the checks it depends on

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task-review minor: `expandChecks` unit test (tests/reconcile.test.js, `expandChecks (#3630)`) does not pin `['archive','red-tip']` → a single `mirror`, nor `['red-tip','remote-prune']` → not widened | open | — |
| 2 | build | SDD task-review minor: a gh-preflight failure narrows an expanded `['archive']` subset to `['mirror']` (plugin/bin/lib/reconcile/index.js preflight narrowing), so `--checks archive` with gh down now fetches + fast-forwards instead of returning early — harmless, not mentioned in docs/reconcile-checks.md | open | — |
| 3 | build | SDD task-review minor: the AC2 test (`AC2 (#3630)`) stubs `archiveMerged` and asserts `localHasMerge` directly — a sound proxy, but real `archiveMerged` is not exercised end-to-end | open | — |
