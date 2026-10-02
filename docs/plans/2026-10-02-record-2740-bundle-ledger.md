# Open Items — Bundle #2740,#2724,#2714,#2667,#2550,#2547,#2546,#2544,#2543

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | test | `tests/impeccable-plugin-contract.test.js` fails 3 subtests ("the installed plugin matches the pinned version", "gatherSignals() executes cleanly...", "the CLI entrypoint accepts no flags") against the unmodified base — installed Impeccable plugin versions [3.0.6, 4.2.2, 4.3.1, 4.4.0] do not include the pinned 4.0.2. Confirmed pre-existing via isolated re-run (`node --test tests/impeccable-plugin-contract.test.js`) before any spec's build touched the tree. | accepted | Pre-existing environment pin-drift, unrelated to this bundle's records (none touch Impeccable plugin pinning or contract tests). Accepted as baseline; each spec's own `/test` run cites this entry rather than re-diagnosing. |
