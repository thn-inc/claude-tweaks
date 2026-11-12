# Open Items — Probe Grep and Glob for the implementer worker where it has no shell

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Probe script robustness for the next Grep/Glob probe: the permission-error pattern misses the --restricted denial text; non-permission tool errors fall through to contained; an empty-variant verdict prints contained (scratch probe.js, this run's 22 rows verified independently against every transcript) | deferred | Carried into the Linux/Windows host-probe follow-up record, where the probe runs again. Defer-reason: blocked-external |
| 2 | build | Should the darwin implementer also get Grep and Glob? The darwin host probe showed both contained under the implementer flags, but this record covers only platforms without Bash | deferred | A new product question, not a defect of this change; carried into the follow-up record. Defer-reason: needs-human-decision |
