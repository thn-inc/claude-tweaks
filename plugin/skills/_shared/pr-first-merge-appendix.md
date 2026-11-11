# PR-First Merge — reference appendix (#2546)

Rare-branch content split out of `pr-first-merge.md`'s operative head, read only when the head's
own citation points here.

## Comment ordering

Anything that must land on the PR posts **before** the merge call (Step 3) — the verdict/brief
comments from `_shared/pr-run-comments.md` already do, per their own citing sites' phase-exit
ordering. Anything this procedure itself posts (the conflict/degrade comment) is
**after**-the-fact information about why the merge didn't complete, so it posts once the outcome
is known, never speculatively before.

## Rationale notes

Named rationale and history moved out of `pr-first-merge.md`'s operative head (#5153), each cited from its original place.

- **Header history.** `pr-first-merge.md` supersedes and closes #335 (the two independently-authored auto-merge implementations these three files carried) and #299 (the fast-lane `git -C "$RUN_DIR"` worktree/branch anchoring defect — obsolete once merge needs no checkout at all).
- **Step 1.5 incident.** One occurrence (Dispatch hub run #9, 2026-08-26, group [#251]) reached this merge step with a curation-row commit still pending, landing after the merge instead of before it.
- **Step 1.5, why exit `0` suffices.** This is the exact check Phase 2's own Step 3 already ran once (`curation-engine.md` section 2) — re-running it here is idempotent (`render` performs no writes) and catches a Phase 2 that was skipped, interrupted, or that this merge step is reached ahead of, out of documented order. Exit `0` means every worklist row Phase 2 opened has a recorded result — and, by `curation-engine.md` section 4's own sequencing (the serial-commit pass runs, and every applied finding's commit lands, strictly **before** the `record` call that produces that recorded result), every applied finding's commit has therefore already landed too. Nothing further to check: nothing this procedure could add to a `git status` scan tells it more than `render --strict`'s own exit code already does.
- **Step 2, why the already-ready guard exists.** (Empirically, `gh pr ready` on an already-ready PR is itself a harmless no-op — exit 0, a `! Pull request … is already "ready for review"` warning on stderr, no error — so this guard is not error-avoidance. It exists to keep the decision log accurate: an unconditional call would log "undrafted" every re-entry even when nothing changed.)
- **Bounded watch is fixed, not a policy key.** `merge-when-green` (arming) is the no-wait path, `wait` is its fallback, and a repo where 15 minutes is chronically wrong should enable required checks/auto-merge rather than tune a knob (parent #558's one-lever decision; this paragraph is the timeout's own rationale).
- **Why the `Fixes` lines are restated.** So the message's `Fixes` lines are the PR body's (`_shared/pr-checklist-refresh.md`'s pre-merge refresh), restated here because GitHub closes records from them only when the merge lands on the repo's default branch, and the lines travel with the commit when it is later promoted; on a non-default integration branch they close nothing, and, on a `merged` outcome, `pr-first-merge-post-merge.md`'s Step 4.0 closes those records itself (after an `armed` merge, the reconciler's Step 4.0 does — #4599).
- **Step 3 eval-guard.** Why: the worktree Bash guard refuses `eval` and a `gh` argument computed at runtime, and every pr-first merge runs from a worktree session (#3522).
- **Armed outcome, when cleanup converges.** The reconciler's trigger points (`_shared/pr-run-comments.md`'s consumer table): session-start, dispatch queue-pull, routine kickoffs, tidy, all converge on this eventually.
- **Sequential multi-branch merges.** The invoking session serializes them one at a time. Each later branch's own single update-from-base attempt merges from whichever tip the just-advanced integration branch now has — a genuinely later branch's conflict is checked against real current state, not a stale snapshot from before the earlier branches merged.

## Why `--auto` alone is not a wait

(Task 0, captured on this repo.) On a repository with no required status checks, `gh pr merge --auto --squash` **merges immediately** — exit `0`, empty stdout and stderr, `autoMergeRequest: null`, the PR `MERGED` while its `test` check was still `pending`. There is no distinguishing signature: `--auto`'s success looks identical whether it armed or merged. That is the #540 mechanism itself. So "arm `--auto`" is a genuine wait **only when the state read shows the forge would hold the merge** — `mergeStateStatus: BLOCKED` while checks are pending (required checks / rulesets configured); anywhere else, arming *is* an immediate merge and this gate must not lean on it. That is why the pending column keys on `mergeStateStatus`, not on `--auto`'s exit code.

## Resume-to-merge

`dispatch/SKILL.md`'s "Confirm before resuming" confirmation applies this same lever as a single read-then-decide over both of Step 2.5's reads (the state read and the head-run `gh run list` read; a not-yet-completed head run reads pending, a failing one red) (green → proceed; red → surface in the confirmation; pending with `mergeStateStatus: BLOCKED` → arm `--auto`, since the forge is what holds it; pending with any other `mergeStateStatus` → do **not** arm — on an unprotected repo arming *is* an immediate merge (capture (a)), so the confirmation itself carries the choice: wait for green, or leave parked) — a human is present on resume, so it never runs the bounded watch.

## Signatures (Task 0 captures)

**Signatures (Task 0, captured on this repo — literal, 2026-08-16, probe PR #591 against a throwaway base):**

- (a) `gh pr merge {n} --auto --merge -t … -b …` on this repo (`allow_auto_merge: false`, no branch protection, no rulesets): stdout empty, stderr empty, `exit=0` — and the PR **merged immediately** (`gh pr view … --json state,mergedAt,autoMergeRequest` → `{"autoMergeRequest":null,"mergedAt":"2026-08-16T11:40:57Z","state":"MERGED"}`) while its `test` check was still `pending`. No signature distinguishes "armed" from "merged" — only the follow-up `gh pr view` does (Step 3.6).
- (b) merge rejected by required checks: not captured — this repo has no branch protection or rulesets (`gh api repos/{owner}/{repo}/branches/main/protection` → HTTP 404 "Branch not protected"; `…/rules/branches/main` → `[]`); classification for this path rests on the state read (`mergeStateStatus: BLOCKED` with a green rollup), never on a stderr string.
- (c) `gh pr checks {n} --watch --fail-fast` on a failing check: rows like `test	fail	35s	https://github.com/…/actions/runs/…` (each check name / `pass`|`fail`|`pending`|`skipping` / duration / URL), `exit=1`. (c2) `gh pr checks {n}` while a check is still running: `test	pending	0	https://…`, `exit=8`.
- (d) `gh pr view {n} --json state,mergeStateStatus,statusCheckRollup` — green (open draft PR #588, read-only): `{"mergeStateStatus":"CLEAN","rollup":[{"conclusion":"SUCCESS","name":"label-fix-branch","status":"COMPLETED"},{"conclusion":"SUCCESS","name":"test","status":"COMPLETED"},{"conclusion":"SKIPPED","name":"cleanup-fix-labels","status":"COMPLETED"}],"state":"OPEN"}`; failing rollup entry: `{"conclusion":"FAILURE","name":"test","status":"COMPLETED"}` (observed on #591 after merge, `mergeStateStatus: UNKNOWN` — the value GitHub reports once a PR is `MERGED`); the `mergeStateStatus` value of an *open* PR with failing checks was not captured (the probe merged via (a) before its checks failed) — which is why red is classified from `statusCheckRollup[].conclusion`, not from `mergeStateStatus`.
- (e) PR #3390 (#3316 wrap-up, 2026-10-17): right after a push the rollup and `gh pr checks` held only `label-fix-branch` (`SUCCESS`) and `cleanup-fix-labels` (`SKIPPED`), and `gh pr checks` exited `0`; the `pull_request` `test` run 39042323352 for the same head existed with status `pending` but was not yet in the rollup. Re-captured on PR #3425 (2026-10-17): the rollup listed `test` `IN_PROGRESS` beside those two, and `gh run list --commit {full sha}` listed the `test` run `in_progress` (its `conclusion` empty) next to the completed `push` run; the same command with the abbreviated sha `26d1037664` returned `[]`.
- Also captured: `gh pr merge` against an already-merged PR: stderr `! Pull request {owner}/{repo}#{n} was already merged`, `exit=0` — a no-op, not an error; the state read (`state: MERGED`) catches it first.
- (f) PR #5156 (2026-11-11): the `ReadyForReviewEvent` `createdAt` was `2026-11-11T00:45:28Z`, and the head's only `pull_request` run, `test.yml` run 42931704440, was created `2026-11-11T00:29:06Z`. This repo's bare `pull_request:` (default types) starts no run on ready, so every run on that head predates `readySince`. The ready-event window the gate waits through is the same not-yet-registered shape as capture (e).

## Local-merge fallback

<!-- when: integration-model=local-merge -->
Not this file's concern — `local-merge` projects (`_shared/integration-model.md`) keep each
citing file's own pre-#411 procedure in substance: the branch-switch guard, the `close-run` E1
relief, the push-from-worktree rule, and (for `flow/worktree-merge.md`) the scratch-worktree
conflict procedure. Each citing file keeps a compact section stating this rather than
duplicating the old prose here.
<!-- /when -->
