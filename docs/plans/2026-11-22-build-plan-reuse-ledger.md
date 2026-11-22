# Open Items — Reuse a valid specify-time plan in /build and skip Spec Step 3 and plan review

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 13 commits ahead of local HEAD at Step 2.5 (reason-not-auto: informational) | observation | Worktree post-creation catch-up merged origin/main (6adac5c to 834d68e) before any build commit. |
| 2 | build | SDD ruling — Important #1 (plan-mandated) — {spec} is the worktree's committed materialize file .cla...: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — Important #1 (plan-mandated) — the stale-plan route must not re-enter plan-reuse.md for...: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — Important #2 (plan-mandated) — Common Step 1.6 stub's standalone clause is reworded to ...: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — minor #4 — template.changed: true is a precondition that skips reuse (SKIP 'condition: ...: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — the residual Important is real and AC-covered (AC1.1) — not deferred; one targeted fix ...: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | the template-ordering pin's permutation control exercises only its after-absent assertion; its after-## Probe and before-## Checks assertions have no go-red control of their own (tests/build-plan-reuse-conformance.test.js:210) | fixed | review fix ff0cb81cf added a go-red control for the before-## Checks assertion; the after-## Probe assertion is implied by the after-absent one (the absent outcome sits under ## Probe), so it needs no separate control |
| 8 | review/code | plan-reuse.md log-decision.js specs omitted the required --run "$PIPELINE_RUN_DIR" (medium, Convention) | fixed | review fix wave, commit ff0cb81cf |
| 9 | review/code | plan-reuse.md said plan-store.js read prints {path}; it prints {"path": ...} (low, Convention) | fixed | review fix wave, commit ff0cb81cf |
| 10 | review/code | build/SKILL.md Common Step 1.6 On-skip write also fired on the reuse route, double-logging the SKIP (low, Convention) | fixed | review fix wave, commit ff0cb81cf |
| 11 | review/code | plan-reuse.md session-tmp-resolve.js calls had no failure route (low, Error handling) | fixed | review fix wave, commit ff0cb81cf |
| 12 | review/code | plan-reuse.md embedded #6060 plan-time observed outputs in shipped prose (low, Ownability) | fixed | review fix wave, commit ff0cb81cf |
| 13 | review/code | plan-reuse.md probe fence had no narrative for its preamble-only scan and line-file handoff (low, Ownability) | fixed | review fix wave, commit ff0cb81cf |
| 14 | review/code | plan-reuse.md Check 3 read path was never executed by a test; round trip now runs plan-store.js read (medium, Test quality; the commit step is agent prose with no runnable seam) | fixed | review fix wave, commit ff0cb81cf |
| 15 | review/code | plan-review.md:181 nested {commit} hides the outer brace group from the text-file sweep (low) | accepted | tiebreak confirmed, recommended drop: the outer group is a fixed literal list carrying no git or user text |
| 16 | review/code | the "Add the plan reviewed at specify" subject is a four-site string contract (low) | accepted | tiebreak confirmed, recommended drop: conformance FACTS pin every copy, so a reword fails CI |
| 17 | review/code | the AC5 git log --diff-filter=A exclusion command is not executed by a test (low) | accepted | tiebreak confirmed, recommended drop: plain git invocation, prose-pinned; a git-fixture test buys little |
| 18 | review/code | the probe ok:true record-mismatch (ref) branch has no test case (low) | accepted | tiebreak confirmed, recommended drop: the comparison is agent prose judgment, FACTS-pinned, backed by Check 2 ref |
| 19 | review/code | failure routes ref/base/files/plan-audit/premise have no executed case in this suite (low) | accepted | tiebreak confirmed, recommended drop: plan-store check verdicts are executed in tests/bin-lib/plan-store; the rest are prose steps |
| 20 | review/code | tests/build-plan-reuse-conformance.test.js scratch() bypasses tests/helpers/tmp-dir.js (low) | accepted | tiebreak confirmed, recommended drop: t.after removes the dir; only a killed process leaks |
| 21 | review/code | Tiebreak can't-tell (digest owed, Defer-reason: tiebreak-cant-tell): plan-reuse.md:37 an empty git commit (byte-identical stale plan) routes to BLOCKED (low); tests/build-plan-reuse-conformance.test.js:306 size test labelled AC1.1 though the rail is a Gotcha (info) | open | severity=low; digest write not yet made by review — route at wrap-up per _shared/materiality-floor.md |
