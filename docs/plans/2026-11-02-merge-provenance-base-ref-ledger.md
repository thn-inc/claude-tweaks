# Open Items — The merge-provenance own-work filter drops shipping work on a base:{ref} release-gate review

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — first-parent-line exit replaces the plan fork-equals-tip exit: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — no local-ref fallback when origin does not resolve: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | Test gap: no fixture covers `{branch}=HEAD` on a non-integration branch, so a helper changed to treat any checked-out HEAD as the integration branch stays green (`tests/review-merge-provenance-check.test.js:62`; the shipped prose is pinned) | open | Fix-now eligible; the build's fix waves are closed, so left open for review's fix wave |
| 4 | build | Detached `HEAD` and `refs/heads/{integration-branch}` spellings of `{branch}` still reach the exclusion on a pull-merged integration branch (`plugin/skills/review/merge-provenance-check.md:7`); `_shared/scope-resolution.md` spells the branch side only as `HEAD` | open | Fix-now eligible; the build's fix waves are closed, so left open for review's fix wave |
| 5 | build | `plugin/skills/review/code-mode-steps.md:131` gives the `base:{ref}` change set as two-dot `git diff {base}..{branch}` while `:164-165` use three-dot; the two differ only when `{ref}` is not an ancestor of `{branch}` | open | Fix-now eligible in a file this diff touches; not probed by the build, left open for review |
