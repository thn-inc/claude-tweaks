# Open Items — bin/ gh calls: GitHub Enterprise host dropped again (regression of #2538) (#4505)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check (run 2026-11-01T023437): origin/main was 16 commits ahead of the branch at run start | fixed | Caught up by merge commit aa2671fca (Post-creation catch-up, `git merge origin/main`) |
| 2 | build | Decision Q2 (Reading A) leaves origin-derived bare `--repo owner/repo` slugs on github.com for a GHE origin: `repoSlugOf` (`plugin/bin/lib/hooks/git-exec.js:207`, host dropped) in `lib/reconcile/` callers, and `lib/issues/claim-store.js:635`. Reading A names this a known limitation; the plan (Spec premise notes) leaves them unchanged | open | Defer-reason: genuinely-larger — `repoSlugOf`'s slug also feeds `repos/${slug}/…` API paths and slug comparisons across the reconcile family, so host-qualifying it spans unrelated systems past the fix-now criteria; route at wrap-up as a follow-up record |
