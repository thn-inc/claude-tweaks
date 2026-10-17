# Open Items — #3351 flow multi-spec: Validation step 3 has no behavior for a failed preflight-records.js call

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check (Step 2.5): origin/main was 9 commits ahead of local main at run start (reason-not-auto: n/a — resolved by build's post-creation catch-up merge) | fixed | Worktree branch merged origin/main 5e1e32a12 before any commit (decisions.md, Post-creation catch-up) |
| 2 | build | `--records-json` accepts a record with missing `labels`/`title` silently (matches gh for an unlabelled issue); the CLI header comment could state both are optional | deferred | SDD Task 1 minor; final review: can wait |
| 3 | build | `--records-json` native degrade is tested only via an explicit `--work-links native`, not via the policy-resolved `resolveWorkLinks()` native path a cloud caller hits | deferred | SDD Task 1 minor; final review: can wait (same shared resolver) |
| 4 | build | `--repo` is accepted and silently ignored on the `--records-json` path | deferred | SDD Task 1 minor; final review: can wait |
| 5 | build | `multi-spec.md` steps 4/5 read "— Exit-0 envelope only — see …" (double dash); a colon would read better | deferred | SDD Task 2 minor; final review: can wait |
| 6 | build | `docs/plugin-structure.md` flow row lists `multispec-preflight-failure.md` without the descriptive clause its siblings carry | deferred | SDD Task 2 minor; final review: can wait |
| 7 | build | `multi-spec.md` step 3's inline usage/envelope text and `docs/plugin-structure.md`'s exit-2 description don't mention `--records-json` input errors / `nativeLinksUnchecked` (the pointer sentence covers it; ~369 B headroom) | deferred | SDD Task 2 minor; final review: can wait |
| 8 | build | AC6.1 conformance assertions are file-wide rather than pinned per branch paragraph; no assertion pins the "never fall back to body text" clause | deferred | SDD Task 2 minor; final review: can wait |
| 9 | build | Fix round 2 dropped a space after a comma on an unchanged assertion (`tests/multispec-preflight-failure-conformance.test.js:71`) | deferred | SDD Task 2 minor; cosmetic |
| 10 | build | AC9.1 regex is narrow by design — "exit code 2 … without `--waves`" or "exits with non-zero … without `--waves`" rewordings would still pass | deferred | SDD Task 2 minor; final review: can wait |
