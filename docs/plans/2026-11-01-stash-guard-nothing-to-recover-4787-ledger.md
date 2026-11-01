# Open Items — Stash guard: report a store that wrote nothing without a recover command (#4787)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | stash-guard.js `otherCommand`'s `x.failed.command !== null` clause is dead (null outcomes are created after it is computed) | deferred | Defer-reason: needs-human-decision — fix-now eligible, surfaced by the residual fix's scoped re-review after the one authorized fix dispatch was spent |
| 2 | build | FAILED decisions.md line for the "run it after the other recover commands" error is not pinned by a test (JSON + stderr are) | deferred | Defer-reason: needs-human-decision — fix-now eligible, surfaced by the residual fix's scoped re-review after the one authorized fix dispatch was spent |
| 3 | build | When the only other recover command is for another copy of the same on-top sha, the "run it after" command also writes nothing (exotic stack shape) | deferred | Defer-reason: needs-human-decision — fix-now eligible, surfaced by the residual fix's scoped re-review after the one authorized fix dispatch was spent |
