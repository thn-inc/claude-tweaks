# Open Items — Add a factory policy layer below the repository's policy.yml

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Test isolation residual: a real ~/.claude-tweaks/factory-policy.yml on a developer machine still reaches spawned CLI tests that inherit HOME; runnerChildEnv strips only the env variable | fixed | runnerChildEnv sets CT_FACTORY_POLICY_FILE to a missing path in the run root, honoured by readFactoryPolicy (plugin/bin/lib/policy-factory.js, tools/run-tests.js) — `bf2b19f92c` |
| 2 | build | Dispatch hub ConfigValuesEditor value field is a single-line input, so a multi-line CLAUDE_TWEAKS_FACTORY_POLICY value (two keys or a block key) is settable only via POST /api/config-values (thn-inc/dispatch, outside this repo) | open | — |
| 3 | build | Test isolation residual (in-process): resolveIntegrationModel and deriveMergeVerification called without opts.env read the real CLAUDE_TWEAKS_FACTORY_POLICY and the real ~/.claude-tweaks/factory-policy.yml, so a developer-machine factory file pinning integration-model would skip detection in existing in-process tests | fixed | the runner drops the variable and its CT_FACTORY_POLICY_FILE reaches in-process callers through process.env, so no file is read (plugin/bin/lib/policy-factory.js, tools/run-tests.js) — `bf2b19f92c` |
