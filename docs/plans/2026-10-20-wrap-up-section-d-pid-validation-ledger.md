# Open Items — wrap-up Section D kills the recorded pid without validating it and has no branch for a port still held after the kill

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Section D step 2's "skip steps 3-4" does not say the rest of step 2 (platform detect + kill bullets) is also skipped for an unprovable record — reword to "skip the rest of this step and steps 3-4. Otherwise, detect the platform..." and adjust the test regex | fixed | Fix-now (deferral-gate): reworded to "skip the rest of this step and steps 3-4. Otherwise, detect the platform first" — commit 5027eca2a |
| 2 | build | No go-red control proves Section D's gate-before-first-kill ordering assertion can fail | fixed | Fix-now: go-red control moving the kill bullets above the gate added — commit 5027eca2a |
| 3 | build | Section D step 4's port-still-held branch assumes the holder is the recorded server; an unrelated process on the port after an "already stopped" pid is still reported as the survivor | open | Fails fix-now: deciding how to tell the recorded server from an unrelated holder (and whether a foreign holder should still keep the record) is a design decision beyond #3664's Deliverables; spec AC treats any held port as the survivor. For /review to rule on. |
