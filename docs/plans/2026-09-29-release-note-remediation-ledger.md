# Open Items — Release Note remediation (#2827, #2828)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | test | Pre-flight verify sweep (base 009b3624d): 3 pre-existing failures, all in `tests/impeccable-plugin-contract.test.js` — "the installed plugin matches the pinned version" (breach), "gatherSignals() executes cleanly…" and "the CLI entrypoint accepts no flags" ("could not resolve an installed root at the pin"). Root cause: the locally installed Impeccable plugin does not match the repo's pinned version — an environment state, not code under this run. | open | — |
