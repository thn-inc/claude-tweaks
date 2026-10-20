# Open Items — git-command: empty -C and omitted -C resolve to different targets on Windows

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task review minor: skipGlobalFlags empty -C branch (git-command.js) is a comment-only empty block; an explicit early `i += 2; continue;` would read clearer | deferred | — |
| 2 | build | SDD task review minor: no committed test catches `pathImpl` silently unused on the non-empty -C branches of skipGlobalFlags (AC1.2 is vacuous on posix if pathImpl were ignored; the go-red control covered it once) | deferred | — |
| 3 | review | Lens 3f (low, reproduced): AC1.1 (tests/hooks-git-command.test.js:255-261) stays green on a posix host with the fix reverted | accepted | Inherent: a posix host cannot produce the win32 divergence through the host-bound `path`; the spec-mandated discriminator is AC1.2 (injected `path.win32`), which goes red with the fix reverted (both 3f agents confirmed by executed probe). AC1.1 is kept as the production-flow identity pin. |
| 4 | review | Lens 3f (low, reproduced): unknown-cwd test (tests/hooks-git-command.test.js:275) does not discriminate the fix | accepted | Intentional invariant guard, not a regression pin: it holds the unchanged unknown-cwd behavior (`resolveGitCommand` null = the module's documented unprovable signal) so the empty-`-C` early branch cannot weaken it. Title is accurate to that contract. |
