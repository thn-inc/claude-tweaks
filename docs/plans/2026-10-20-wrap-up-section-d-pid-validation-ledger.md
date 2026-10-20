# Open Items — wrap-up Section D kills the recorded pid without validating it and has no branch for a port still held after the kill

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Section D step 2's "skip steps 3-4" does not say the rest of step 2 (platform detect + kill bullets) is also skipped for an unprovable record — reword to "skip the rest of this step and steps 3-4. Otherwise, detect the platform..." and adjust the test regex | deferred | SDD task review minor (Task 1) |
| 2 | build | No go-red control proves Section D's gate-before-first-kill ordering assertion can fail | deferred | SDD task review minor (Task 1) |
| 3 | build | Section D step 4's port-still-held branch assumes the holder is the recorded server; an unrelated process on the port after an "already stopped" pid is still reported as the survivor | deferred | SDD task review minor (Task 1) |
