# Open Items — plan-audit Check A accepts a regular file as a Create/Test bullet's parent directory (#3493)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | nearestExistingAncestor shared with Modify/Delete missingDetail — a Modify under a regular file now names the enclosing directory; untested | deferred | Origin: SDD task review of aa378474f (minor). Files: plugin/bin/lib/plan-audit/checks.js, tests/bin-lib/plan-audit/checks.test.js. Trigger: /review of #3493 — candidate fix-now as one pin test; behavior already matches plan-audit.md line 19 ("nearest directory that does exist"). |
| 2 | build | dangling-symlink parent is now rejected by checkA (fail-closed); no test covers it | deferred | Origin: SDD task review of aa378474f (minor). Files: plugin/bin/lib/plan-audit/checks.js, tests/bin-lib/plan-audit/checks.test.js. Trigger: /review of #3493 — candidate fix-now as one pin test. |
