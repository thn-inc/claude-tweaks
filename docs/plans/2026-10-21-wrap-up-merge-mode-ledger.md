# Open Items — Make flow's resume-to-merge row workable for an unattended run

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 2 commits ahead of local HEAD (4dea52a99 #3595, 36fff7a2f #3768) | accepted | Continued under auto; the worktree's post-creation catch-up merged origin/main before any build work |
| 2 | build | SDD minor — `merge` with `--dry-run` unspecified (merge mode replaces Phases 1-4); also logged as the PRIORITY line | fixed | Token rules reject `merge` with `--dry-run` (52f3bc520) |
| 3 | build | SDD minor — docs/skill-graph.md said "two merge sites" | fixed | both rows say three and name merge-mode.md (52f3bc520) |
| 4 | build | SDD minor — empty `## Conflict` heading until Task 2 | fixed | Task 2 filled it (aca4b70fd) |
| 5 | build | SDD minor — docs/plugin-structure.md read condition stale after the narrowed router | fixed | narrowed condition stated (52f3bc520) |
| 6 | build | SDD minor — `## Conflict` re-entry had no stated bound | fixed | one-attempt bound, second DIRTY → pending-review moving-target (52f3bc520) |
| 7 | build | SDD minor — rail size test passed pre-change (regression guard, not AC5 go-red evidence) | accepted | final review: can-defer — a budget guard, AC5 go-red does not apply to it |
| 8 | build | SDD minor — Next Actions line "grants consoleAutoResolve" lacked backticks | fixed | backticked and pinned (52f3bc520) |
| 9 | build | SDD ruling — Task 1's MERGE_MODE_FACTS region is `merge-mode.md`'s text before its `## Conflict` heading (assert that heading's index is not -1), not the whole file: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 10 | build | SDD ruling — merge-mode.md names `_shared/pr-first-merge.md` Steps 1 through 4 (spec AC1 wording) instead of the plan's "Steps 1 through 3", keeping the Step 4.1 / Step 4.2-last split: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 11 | build | SDD ruling — route to merge mode only when $ARGUMENTS consists of nothing but the literal `merge` token, at most one record reference (either order), and this skill's own flags: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 12 | build | SDD ruling — final-review Minor 6 (pr-first-merge-post-merge Step 4.2 logs after reconcile archives, all callers) is pre-existing and out of #3784 scope: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 13 | build | SDD ruling — final-review Minor 8 (merge mode skips Section C step 3.5 pre-anchoring guard) left as-is: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | fixed | review reversed the ruling — merge mode runs Section C steps 3.5-5.5 (7786f2ebd) |
| 14 | build | SDD ruling — residual final-review finding (merge-mode.md branch-5 CLEAN-green "re-enter Step 2.5 from the top" has no bound, so a persistent unrecognized merge error loops) is real and load-bearing: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | fixed | review applied it — branch-5 CLEAN-green re-entry happens once per invocation, pinned branch5-once (7786f2ebd) |
| 15 | review | 3b — merge mode adopted a run without binding it to the typed record (inherited PIPELINE_RUN_DIR; --spec-slug substring match) — merge-mode.md:11 | fixed | config.yml spec: must equal {n}, mismatch stops (7786f2ebd) |
| 16 | review | 3b — the typed-confirmation claim had no stop for a headless caller acting on the recommended unattended row — merge-mode.md:7 | fixed | human-turn only, reason no-human-confirmation (7786f2ebd) |
| 17 | review | 3b/3c — the Conflict path assumed the run worktree still exists — merge-mode.md:41 | fixed | no-worktree outcome, no merge in any checkout (7786f2ebd) |
| 18 | review | 3c — the Conflict path ran verify.js in the session cwd — merge-mode.md:45 | fixed | --cwd "{worktree-path}" (7786f2ebd) |
| 19 | review | 3c — no outcome for a failed push after the conflict commit — merge-mode.md:46 | fixed | push-failed outcome, never reset (7786f2ebd) |
| 20 | review | 3c — the not-OPEN precondition gave no next step for a forge-merged PR — merge-mode.md:19 | fixed | names cleanup-only (7786f2ebd) |
| 21 | review | 3c — Section E ran without its reason/$LINK inputs or the wrap-up-pack.json pre-teardown production — merge-mode.md:25 | fixed | reason merged: spec {n}, $LINK merge sha, pack produced before teardown (7786f2ebd) |
| 22 | review | 3c — merge mode skipped Section C step 3.5 copy-out guard — merge-mode.md:25 | fixed | steps 3.5-5.5; reverses ledger row 13 (7786f2ebd) |
| 23 | review | 3c/3a — no outcome for pre-merge stops or post-merge cleanup failures — merge-mode.md:37 | fixed | pending-review naming the step; merged + cleanup failed lines (7786f2ebd) |
| 24 | review | 3c — the summary merge row quoted "{target}", not a #-prefixed record reference — summary-template.md:101 | fixed | renders bare {target} (7786f2ebd); staged/build-deviation-2.md updated |
| 25 | review | 3a — skill-graph lacked the cleanup-procedures and summary-template→merge-mode edges | fixed | both rows added (7786f2ebd) |
| 26 | review | 3a — --skill-budget/--doc-budget silently ignored under merge | fixed | report says they were ignored (7786f2ebd) |
| 27 | review | 3b — attended conflict resolutions shipped without being surfaced — merge-mode.md:43 | fixed | one line per file goes into the commit message and closing report (7786f2ebd) |
| 28 | review | 3f — unpinned clauses (red-suite abort, Green gate, full-suite wording), header slice end anchor, rail error message, predicate identifier | fixed | facts + guards + predicate test (7786f2ebd) |
| 29 | review | known (sdd-ruling-6) — branch-5 CLEAN-green re-entry unbounded | fixed | see row 14 (7786f2ebd) |
| 30 | review | 3a — the pr-first-merge.md pointer bullet is pinned by a 400 B cap (skill-prose-conformance-tests anti-pattern) | open | staged/review-1.patch — test-removal override stages it |
| 31 | review | 3c — two record references plus merge fall through to Phases 1-4 — SKILL.md:51 | open | follows staged/sdd-ruling-3.md (the router-breadth ruling); noted there |
| 32 | review | 3a/3f — five test-shape observations (argument-hint mirror overlap; one grammar test with several asserts; ENOENT-only red on main; whole-sentence doc pins; rail guard green on main) | open | low-confidence (single agent) at the Review Console; reviewer read — don't fix: AC2 needs the token pin the mirror test does not make; each assert carries its own message; per-fact strip proofs are the house pattern for new prose; the doc pins guard final-review stale wording; the rail is a guard (row 7) |
