# Open Items — wrap-up Section D reads the detached flag as the "fourth field" of ephemeral-server.txt (#3657)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Several secondary assertions in the #3657 test block never individually went red (tests/ephemeral-server-handoff-conformance.test.js:134-148) | deferred | |
| 2 | build | task-prompt.md second-call liveness paragraph tail re-flowed past the ~100-col wrap (two lines 103/104 cols, :343-346) | deferred | |
| 3 | build | Pre-existing spaced `detached: no` prose in task-prompt.md:175 and _shared/dev-url-detection.md:130-131 could be written literally by a Windows agent (record then unparseable; fail-safe skip leaks the server) | deferred | |
| 4 | build | `const fs` require declared mid-file in tests/ephemeral-server-handoff-conformance.test.js:127 | resolved | Fixed by /simplify (Common Step 3): require moved to the file's top imports |
| 5 | build | Corpus sweep is lexical (catches "fourth/third field" only, not "4th token" or `$4`) | deferred | |
