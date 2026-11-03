# Open Items — Artifact-overwrite check: attribute only the run's own first-parent commits

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 36 commits ahead of the resumed branch | fixed | Post-creation catch-up merged origin/main (440005b7d → ff178b820) before any build task |
| 2 | build | SDD ruling — overwrite-check prose: run the check before run commits reach the integration branch: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build/skill | gh-api-module-pattern's `--end-of-options` bullet could note that a `^{ref}` exclusion token placed after `--end-of-options` is read as a revision by `git log`/`git rev-list` (probed git 2.56; `^` or `^-x` fails "bad revision"), the form #4845's `integrationRef` walk uses | observation | — |
