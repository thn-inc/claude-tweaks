# Open Items — Playwright CLI consumer migration (parts 3a-3e, #2645-#2649)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | test | Pre-flight sweep (baseline, before any spec's edits): `tests/impeccable-plugin-contract.test.js` — 3 failures (`the installed plugin matches the pinned version`, `gatherSignals() executes cleanly...`, `the CLI entrypoint accepts no flags`). Root cause: installed Impeccable plugin versions are 3.0.6/4.2.0/4.2.2/4.3.1, but the test pins 4.0.2, which is not installed. Unrelated to any of #2645-#2649's key files. | open | — |
