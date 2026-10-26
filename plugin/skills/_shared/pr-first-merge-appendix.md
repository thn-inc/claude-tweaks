# PR-First Merge — reference appendix (#2546)

Rare-branch content split out of `pr-first-merge.md`'s operative head, read only when the head's
own citation points here.

## Comment ordering

Anything that must land on the PR posts **before** the merge call (Step 3) — the verdict/brief
comments from `_shared/pr-run-comments.md` already do, per their own citing sites' phase-exit
ordering. Anything this procedure itself posts (the conflict/degrade comment) is
**after**-the-fact information about why the merge didn't complete, so it posts once the outcome
is known, never speculatively before.

## Signatures (Task 0 captures)

**Signatures (Task 0, captured on this repo — literal, 2026-08-16, probe PR #591 against a throwaway base):**

- (a) `gh pr merge {n} --auto --merge -t … -b …` on this repo (`allow_auto_merge: false`, no branch protection, no rulesets): stdout empty, stderr empty, `exit=0` — and the PR **merged immediately** (`gh pr view … --json state,mergedAt,autoMergeRequest` → `{"autoMergeRequest":null,"mergedAt":"2026-08-16T11:40:57Z","state":"MERGED"}`) while its `test` check was still `pending`. No signature distinguishes "armed" from "merged" — only the follow-up `gh pr view` does (Step 3.6).
- (b) merge rejected by required checks: not captured — this repo has no branch protection or rulesets (`gh api repos/{owner}/{repo}/branches/main/protection` → HTTP 404 "Branch not protected"; `…/rules/branches/main` → `[]`); classification for this path rests on the state read (`mergeStateStatus: BLOCKED` with a green rollup), never on a stderr string.
- (c) `gh pr checks {n} --watch --fail-fast` on a failing check: rows like `test	fail	35s	https://github.com/…/actions/runs/…` (each check name / `pass`|`fail`|`pending`|`skipping` / duration / URL), `exit=1`. (c2) `gh pr checks {n}` while a check is still running: `test	pending	0	https://…`, `exit=8`.
- (d) `gh pr view {n} --json state,mergeStateStatus,statusCheckRollup` — green (open draft PR #588, read-only): `{"mergeStateStatus":"CLEAN","rollup":[{"conclusion":"SUCCESS","name":"label-fix-branch","status":"COMPLETED"},{"conclusion":"SUCCESS","name":"test","status":"COMPLETED"},{"conclusion":"SKIPPED","name":"cleanup-fix-labels","status":"COMPLETED"}],"state":"OPEN"}`; failing rollup entry: `{"conclusion":"FAILURE","name":"test","status":"COMPLETED"}` (observed on #591 after merge, `mergeStateStatus: UNKNOWN` — the value GitHub reports once a PR is `MERGED`); the `mergeStateStatus` value of an *open* PR with failing checks was not captured (the probe merged via (a) before its checks failed) — which is why red is classified from `statusCheckRollup[].conclusion`, not from `mergeStateStatus`.
- (e) PR #3390 (#3316 wrap-up, 2026-10-17): right after a push the rollup and `gh pr checks` held only `label-fix-branch` (`SUCCESS`) and `cleanup-fix-labels` (`SKIPPED`), and `gh pr checks` exited `0`; the `pull_request` `test` run 39042323352 for the same head existed with status `pending` but was not yet in the rollup. Re-captured on PR #3425 (2026-10-17): the rollup listed `test` `IN_PROGRESS` beside those two, and `gh run list --commit {full sha}` listed the `test` run `in_progress` (its `conclusion` empty) next to the completed `push` run; the same command with the abbreviated sha `26d1037664` returned `[]`.
- Also captured: `gh pr merge` against an already-merged PR: stderr `! Pull request {owner}/{repo}#{n} was already merged`, `exit=0` — a no-op, not an error; the state read (`state: MERGED`) catches it first.

## Local-merge fallback

<!-- when: integration-model=local-merge -->
Not this file's concern — `local-merge` projects (`_shared/integration-model.md`) keep each
citing file's own pre-#411 procedure in substance: the branch-switch guard, the `close-run` E1
relief, the push-from-worktree rule, and (for `flow/worktree-merge.md`) the scratch-worktree
conflict procedure. Each citing file keeps a compact section stating this rather than
duplicating the old prose here.
<!-- /when -->
