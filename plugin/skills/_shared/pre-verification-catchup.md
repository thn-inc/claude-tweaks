# Pre-verification Catch-up

A catch-up with the integration branch, run by `/claude-tweaks:build` last before Common Step 5's verification run (#4343), so a base that moved during the build is merged in before the suite runs and `VERIFICATION_SHA` is the post-merge HEAD. The call site is `build/SKILL.md`'s Common Step 5 **Catch up before verifying** paragraph; this file is the procedure, cited rather than restated there.

Left to the build phase exit, the merge would change the tree after the suite, and `/test`'s Skip-if-recent (`test/verification.md`'s Mismatch branch) would run it a second time. Unlike the Pre-review catch-up (`_shared/pre-review-catchup.md`), it is not overlap-gated: Common Step 5 runs the full suite anyway, so the merge adds no run. It runs once, before the first verification run — a re-run after a fix does not repeat it; a base that moves after it is the residual case `_shared/git-discipline.md`'s Post-push merge-state check catches. Every `log-decision.js` call in this file takes `--run "$PIPELINE_RUN_DIR" --section "/build" --step "Pre-verification catch-up"`.

## Scope

Only a `pr-first` worktree run catches up, and never inside a multi-spec run. Resolve the model per `_shared/integration-model.md`:
`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values integration-model --run "$PIPELINE_RUN_DIR"`
(drop `--run` with no run dir). When it exits non-zero or prints nothing, merge nothing and log one `SKIP` (`--reversibility n/a`, `--text "condition: integration-model unresolved → fallback: no pre-verification catch-up"`) — fail open: the verification run follows. Any other run merges nothing, fetches nothing, and logs one `SKIP` (`--reversibility n/a`) naming why:
`--text "condition: integration-model local-merge → fallback: no pre-verification catch-up"`,
`--text "condition: current-branch strategy → fallback: no pre-verification catch-up"`, or, under `MULTISPEC_SHARED_WORKTREE=1` or `MULTISPEC_PARALLEL_WAVE=1`,
`--text "condition: multi-spec shared branch (MULTISPEC_SHARED_WORKTREE=1 or MULTISPEC_PARALLEL_WAVE=1) → fallback: no pre-verification catch-up; flow/multispec-freshness.md's boundary check owns upstream merges"`.
A multi-spec run skips even under `pr-first` because `flow/multispec-freshness.md`'s boundary-freshness escalation is a registered HARD-GATE (`_shared/auto-mode-contract.md`) that must still see the drift: merged in here, upstream commits that landed during the build would read as `BEHIND=0` at the next spec boundary.

## Procedure

A `pr-first` worktree run catches up in every mode — `auto`, `confirm`, `interactive` and `hybrid` alike, and a standalone `/claude-tweaks:build` — and adds no stop. Run `_shared/git-discipline.md`'s Catch-up (`auto`) steps 1-4 (in its Post-push merge-state check) with `{worktree-path}` the build's worktree and `{integration-branch}` resolved at this call site per `_shared/integration-branch.md` — merge, never rebase, with the same conflict resolution and `merge --abort` — with these differences. In this file, "Catch-up step N" is that list's own numbering and "difference N" is this list's.

1. Nothing is pushed: the build phase exit pushes the merged branch.
2. There is no PR conflict line to surface. Catch-up step 1's dirty tree logs `--status SKIP
   --reversibility n/a --text "condition: uncommitted changes in the worktree → fallback: catch-up
   not run; verifying the un-merged tree"`; a failed fetch logs the same with `--text "condition:
   fetch failed → fallback: catch-up not run; verifying the un-merged tree"`. Either way the
   comparison in difference 5 does not run, and the verification run follows.
3. `_shared/git-discipline.md`'s Merge conflict resolution "ask the user" fallback never applies, in any mode. A conflict it
   cannot resolve confidently: run `merge --abort` (its own Bash call), log `--status AUTO
   --reversibility high --text-file "{text-file}"`, `{text-file}` holding
   `pre-verification catch-up with origin/{integration-branch} aborted on a conflict it could not resolve confidently — verifying the un-merged tree`,
   skip the comparison in difference 5, and run the verification on the un-merged tree; the build
   phase exit's Post-push merge-state check and, past it, the merge path own the conflict.
4. A merge that fails without a conflict (git refusing to overwrite untracked working tree
   files, say): run `merge --abort` (its own Bash call; a no-op error when no merge is in
   progress is fine), log `--status SKIP --reversibility n/a --text-file "{text-file}"`,
   `{text-file}` holding
   `condition: merge with origin/{integration-branch} failed ({reason}) → fallback: catch-up not run; verifying the un-merged tree`,
   skip the comparison in difference 5 as well, and run the verification. Never move or delete the
   untracked files to get past it.
5. A resolved conflict is committed before HEAD is compared, as in Catch-up step 4; Common
   Step 5's own run is the verification after resolving. Then compare `git -C "{worktree-path}"
   rev-parse --short HEAD` with Catch-up step 3's `{before short}`. Unchanged: log
   `--status SKIP --reversibility n/a --text-file "{text-file}"`, `{text-file}` holding
   `condition: branch already contains origin/{integration-branch} → fallback: nothing merged`.
   Advanced: log `--status AUTO --reversibility high --text-file "{text-file}"`, `{text-file}`
   holding
   `merged origin/{integration-branch} before the verification run ({before short} → {after short})`.
   A failed `rev-parse` logs `--status SKIP --reversibility n/a --text "condition: rev-parse
   failed → fallback: catch-up outcome not compared; verifying the tree as it stands"`, and the
   verification run follows. A failed Catch-up step 3 `rev-parse` (no `{before short}`) logs that
   same `SKIP` and the merge is not attempted; the verification run follows.

Every `{text-file}` in this file is written per `_shared/auto-decision-log.md`'s Text from git or a user
paragraph (the integration branch name is git-supplied). With no run dir (a design-mode build)
nothing is logged: each `SKIP` goes to the Step 7 handoff's Skipped steps section instead, and
every build names the outcome on its handoff's Verification list.

`_shared/git-discipline.md`'s Post-push merge-state check stays: the base can still move during verification, and a
conflict that arrives then is caught at the build phase exit as before.
