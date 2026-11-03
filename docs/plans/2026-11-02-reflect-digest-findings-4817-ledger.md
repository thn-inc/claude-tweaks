# Open Items — Settle 3 digest findings in reflect (#4817)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Step 2.5 pre-flight branch-divergence-check: origin/main was 22 commits ahead of the worktree branch | fixed | Common Step 1 catch-up merged origin/main (327e20400) into the branch |
| 2 | ops | Step 2.5 pre-flight branch-divergence-check (run 2026-11-03T085046): origin/main was 26 commits ahead of the worktree branch | fixed | Common Step 1 catch-up merged origin/main (399908890) into the branch at f8776315c |
| 3 | ops | Step 2.5 pre-flight branch-divergence-check (run 2026-11-03T175949): origin/main was 24 commits ahead of the worktree branch | fixed | Common Step 1 catch-up merged origin/main (5edceca8c) into the branch at 59e741bbf |
| 4 | ops | Step 2.6 shape check (run 2026-11-03T175949): Task 1 touches 6 files (> 5) — one exit-code contract sweep (closing-links.js, post-merge.js, reconcile-checks.md, plugin-structure.md, pr-first-merge-post-merge.md, closing-links-cli.test.js) | observation | auto mode proceeded anyway; the files are one contract change the cli-wrapper-contract sweep rule requires to land together |
| 5 | build | SDD ruling — residual reconcile-checks.md:671 re-wrap fixed under the residual override (ba3f02ab6): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 6 | review | Low, Error handling: the post-merge exit-4 SKIP carried only fixed text, no run ids (closing-links.js:244) | fixed | SKIP now reads `(body names run {found\|none}, expected {runId})`, found capped at 80 chars — `c77cc397d` |
| 7 | review | Low, Ownability: the 7c comment did not state why default and unreadable bases stay unproven (closing-links.js:389) | fixed | Comment now states the Reading A scope and the do-not-widen warning — `c77cc397d` |
| 8 | review | Low, Test quality: the reconciler's deterministic handling of a post-merge exit 4 was unpinned (post-merge.js:32, :566) | fixed | M7 loops over exits 2, 3 and 4; mutant (exit 4 made transient) goes red — `c77cc397d` |
| 9 | review | Low, Test quality: the Step 4.0 exit-4 caller instruction had no prose pin (pr-first-merge-post-merge.md:32) | fixed | `tests/closing-links-prose-conformance.test.js` AC1 pins it with two go-red controls — `c77cc397d` |
| 10 | review | Low, Ownability: the round-3 accepted limit (a superseded unarchived run's post-merge exit 4 reads as an ordinary failure) was recorded nowhere that ships (reconcile-checks.md:666) | fixed | Sentence added to the transient-failures bullet in `docs/reconcile-checks.md` — `c77cc397d` |
| 11 | review | Low, Test quality: no test for a foreign-owner non-default-base run with nothing to reopen or close (closing-links.js:395) | accepted | Tiebreak recommended drop: the refusal is unconditional by design and AC1.1 already asserts no issue read |
