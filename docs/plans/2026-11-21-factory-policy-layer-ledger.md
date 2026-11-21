# Open Items — Add a factory policy layer below the repository's policy.yml

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Test isolation residual: a real ~/.claude-tweaks/factory-policy.yml on a developer machine still reaches spawned CLI tests that inherit HOME; runnerChildEnv strips only the env variable | open | — |
| 2 | build | Dispatch hub ConfigValuesEditor value field is a single-line input, so a multi-line CLAUDE_TWEAKS_FACTORY_POLICY value (two keys or a block key) is settable only via POST /api/config-values (thn-inc/dispatch, outside this repo) | open | — |
