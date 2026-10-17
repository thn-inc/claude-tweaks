# Open Items — #3389 console engine item ids (targetPath)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD Task 1 minor: tests/bin-lib/console/resolve.test.js #3389 test does not pin targetPath winning over a legacy target when a finding carries both — swapping the first two operands of the label expression in plugin/bin/lib/console/resolve.js engineItems would still pass. One-assertion fix (a finding with both fields → id uses targetPath). | fixed | Review: added a docs-row finding carrying both targetPath and legacy target; asserts the id uses targetPath. Verified red with the operands swapped, green restored. |
| 2 | build | SDD Task 1 minor: a finding with no targetPath/target on a row with no target still yields rowId:undefined. Outside the spec's three-field fallback; engine-record.js always copies row.target onto the result entry, so unreachable from engine-written state. | observation | Unreachable for engine-written engine-state.json (engine-record.js sets target: row.target); spec scopes the fallback to three fields. |
