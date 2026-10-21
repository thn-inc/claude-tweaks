# Open Items — reconcile does not expand an explicit checks subset with the checks it depends on

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task-review minor: `expandChecks` unit test (tests/reconcile.test.js, `expandChecks (#3630)`) does not pin `['archive','red-tip']` → a single `mirror`, nor `['red-tip','remote-prune']` → not widened | fixed | Both cases pinned in the expandChecks test (review fix). |
| 2 | build | SDD task-review minor: a gh-preflight failure narrows an expanded `['archive']` subset to `['mirror']` (plugin/bin/lib/reconcile/index.js preflight narrowing), so `--checks archive` with gh down now fetches + fast-forwards instead of returning early — harmless, not mentioned in docs/reconcile-checks.md | fixed | Review lens 3c reproduced it: only a caller-named mirror now survives the preflight narrowing; documented in docs/reconcile-checks.md and pinned by two tests. |
| 3 | build | SDD task-review minor: the AC2 test (`AC2 (#3630)`) stubs `archiveMerged` and asserts `localHasMerge` directly — a sound proxy, but real `archiveMerged` is not exercised end-to-end | open | — |
| 4 | review/code | medium (3c, reproduced): an added `mirror` fast-forwarded the main checkout under `--dry-run` (mirror-ff.js ignored dryRun) | fixed | mirror-ff.js honors `dryRun` (reports skipped/dry-run); index.js forwards it; tests pin it. |
| 5 | review/code | medium (3b+3a, direct-verified): `PREREQUISITES[c]` threw TypeError for caller-typed `constructor`/`toString`/`__proto__` in `--checks` | fixed | `Object.hasOwn` guard in expandChecks; test covers all three names. |
| 6 | review/code | medium (3f, direct-verified): the `no-fetch-this-pass` backstop gate lost its only test | fixed | New test deletes the red-tip PREREQUISITES entry and asserts the skip. |
| 7 | review/code | low (3f): red-tip test's `notEqual(r.mirror, null)` passed on a dirty-tree skip; key-set pin coupled the test to the table | fixed | Fixture uses writePolicyViaSeedAndPull and asserts `mirror.state === 'current'`; key-set assertion removed. |
| 8 | review/code | low (3a, direct-verified): journey wording and hooks.js comment described the pre-expansion order/contract | fixed | Journey says expands-to vs executes-as; hooks.js comment names the added prerequisites. |
