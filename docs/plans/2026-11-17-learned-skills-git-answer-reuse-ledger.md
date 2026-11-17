# Open Items — Reuse unchanged read-only git answers within one learned-skills capture() or land() call

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 10 commits ahead of local main at run start; worktree caught up by merging origin/main (276db78). | fixed | Post-creation catch-up merged origin/main e1c0beb into the worktree branch before the materialize commit. |
| 2 | build | SDD ruling — inherited local-main reconcile commits disclosed in the PR body, not removed: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build/skill | Extends git-ground-truth-test-env: withReadCache, an in-process per-call cache of git answers invalidated by call classification rather than a filesystem signature, reached its full key (normalized encoding, cwd) and separator-bounded option scan (-- and --end-of-options) one review round at a time — the skill's derive-the-inputs-from-what-git-reads rule applies to argv classification too. | observation | Skill observation for wrap-up's Skills curation row. |
