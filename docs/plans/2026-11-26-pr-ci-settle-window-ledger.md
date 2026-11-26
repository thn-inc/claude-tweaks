# Open Items — A pull_request workflow run not yet created still leaves a partial rollup green at the merge gate

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling (procedural) carried as audit, not staged: pr-check-gate.md settle-window pending line folded into Task 4 (fixed in build with a pin) | observation | — |
| 2 | build | SDD ruling — keep the committer-date read on a red verdict with an empty run list (one discarded gh api call): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | Noticed outside the diff (fix-wave re-review): the merge-gate code twins order red and conflict differently. lib/driver/merge.js checks isConflicting before classifying (:610, :689); lib/learned-skills/drain.js checks red before conflicting. Step 2.5's prose follows the drain's red-first order. Pre-existing; for the digest. | observation | — |
| 4 | build | Noticed outside the diff (fix-wave re-review): the release gate's PR view in plugin/skills/release/execute.md lacks `mergeable`, so it sees a conflict only through mergeStateStatus DIRTY. Step 2.5's own read (pr-first-merge.md:110) includes `mergeable`. Pre-existing; for the digest. | observation | — |
