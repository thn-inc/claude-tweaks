# Open Items — Pin that the committed verify-scope.json stays readable by the previous release's declaration reader

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — keep the AC1.1 control's `rules[n].suites:` prefix match (AC1 requires naming the reader's own error text): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | accepted | ratified at Review Console — AC1 literally requires the failure to name the reader error text, so the exact rules[n].suites: prefix match stays |
| 2 | build | removeReaderDir's cache-key prefix compare is case-sensitive, so a Windows drive-letter case mismatch could leave a require.cache entry — Ruling: code stands; the entry points at a unique, already-deleted temp dir and nothing reads it again | observation | Parked by SDD Task 1 re-review (Minor); no behavior depends on it |
| 3 | review/security | AC3.1's throwaway git repo inherited the user's global/system git config and GIT_CONFIG_* env (a global core.hooksPath would run hooks in it) — low | fixed | TEMP_REPO_ENV pins GIT_CONFIG_GLOBAL/SYSTEM to /dev/null and drops GIT_CONFIG_COUNT/PARAMETERS |
| 4 | review/error | The no-network guarantee depends on GIT_NO_LAZY_FETCH, which git older than 2.44 ignores — low | fixed | The comment names the 2.44 floor |
| 5 | wrap-up | pr — PR #4441 — this run's own pr-first PR; disposition is Phase 4's merge decision | observation | Open by design until Phase 4 decides merge/arm/park |
| 6 | wrap-up | residue sweep: suite probe skipped via --no-suite (a fact pack never re-runs the suite) | observation | Suite state comes from the verify stamp: scoped pass at e8c6688c1 (tests 6712/6712, journeys 79/79); only a ledger row changed after |
