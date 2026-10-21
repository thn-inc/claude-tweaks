# Open Items — plan-audit Check A accepts a regular file as a Create/Test bullet's parent directory (#3493)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | nearestExistingAncestor shared with Modify/Delete missingDetail — a Modify under a regular file now names the enclosing directory; untested | fixed | Fixed in wrap-up of #3493: pin test added in tests/bin-lib/plan-audit/checks.test.js (Modify under a regular file names the enclosing directory); red against main's checks.js, green on the branch. |
| 2 | build | dangling-symlink parent is now rejected by checkA (fail-closed); no test covers it | fixed | Fixed in wrap-up of #3493: pin test added in tests/bin-lib/plan-audit/checks.test.js (dangling-symlink parent reported); red against main's checks.js, green on the branch. |
