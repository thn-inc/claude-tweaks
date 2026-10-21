# Merge Mode

Referenced by `skills/wrap-up/SKILL.md`'s Phase 1 ("Identify the work context") — read only when `$ARGUMENTS` is only the literal `merge` token, at most one record reference, and this skill's own flags. It replaces Phases 1-4: a same-session merge of a PR a headless run left on `pending-review`.

## What it is

`/claude-tweaks:wrap-up #{n} merge` merges the record's already-open PR now. The typed invocation is the human merge confirmation, so compose-subject's `{tag}` = `human-approved` (the same tag `dispatch/close-out.md` uses). Merge mode never runs `console-resolve.js` and never asks a `"Review Console"`-headed question: the console already rendered when the run parked, and under `consoleAutoResolve` the `pre-tool-use.js` ask gate (#3712) would deny one anyway. The confirmation holds only on a human's own turn: a subagent, a scheduled Routine, or any other headless caller that reaches this file stops and reports `pending-review`, reason `no-human-confirmation`, because no autonomy ceiling stands in for the typed go-ahead (the same rule as `dispatch/close-out.md`'s confirmation gate, which requires a human present by construction).

## Resolve the run

Adopt the run dir the way the explicit `/claude-tweaks:wrap-up #{n}` re-entry does (`resume-halted-run.md`'s second paragraph): `_shared/run-dir-resolution.md`'s resolution order, an inherited `PIPELINE_RUN_DIR` first, else `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --spec-slug "spec-{n}"` with no `--create`. When nothing resolves, merge mode stops and names the record; it never mints a run dir, because a stray `-standalone` dir could shadow the real run on retry. This is not the `resume` form — a parked `pending-review` run stays `status: active`, so `resume`'s `status: interrupted` precondition never holds for it.

Then bind the adopted run to the typed record: its `config.yml` `spec:` value must equal `{n}`. An inherited `PIPELINE_RUN_DIR` can name another run, and `--spec-slug` matches by substring (`spec-378` also matches a `spec-3784` dir), so a mismatch stops before any merge step and names both records. `{worktree-path}` below is that run's `run-state.json` `worktree`.

## Token rules

`merge` with no record reference stops, naming the missing `#{n}` — it never falls through to conversation-based work. `merge` with `cleanup-only` is rejected: report both tokens and run neither, because one asks for a merge and the other forbids everything but teardown. `merge` with `--dry-run` is rejected: report both tokens and run neither, because Phases 1-4 carry the dry-run guarantee and merge mode replaces them, so a merge under `--dry-run` would be real. `merge` with `resume` is rejected: report both tokens and run neither, because `resume` re-enters a halted Review Console and a parked PR's run is not halted. `--skill-budget` and `--doc-budget` size Phase 3's curation, which merge mode replaces, so they have no effect here and the report says they were ignored.

## Preconditions

Each one stops before any merge step, with no cleanup, and reports which failed: the project does not resolve to `integration-model: pr-first` (`_shared/integration-model.md`); `run-state.json` carries no `pr` object; the PR is not `OPEN` (`gh pr view {pr} --json state`). For a `MERGED` PR — an `armed` run's auto-merge can land before the human types this — the report names `/claude-tweaks:wrap-up #{n} cleanup-only` as the next step, since only the teardown is left.

## Procedure

1. Read the composed merge bundle exactly as `review-console.md` step 13 does: `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step merge "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-first-merge.md" "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-checklist-refresh.md"`, then read `$PIPELINE_RUN_DIR/context/merge.md`. If compose is unavailable, read the two source files.
2. Run `_shared/pr-first-merge.md` Steps 1 through 4, split as below. Steps 1-3 are: acceptance labeling unconditionally, Step 1.5's curation guard, mark ready, Step 2.5's merge-verification gate, the merge.
3. On `merged`: run Step 4.1. When `{run-dir}/wrap-up-pack.json` is absent, produce it before any teardown — `node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-pack.js" --run "$PIPELINE_RUN_DIR" --only claim`, as Section E's intro requires. Then run `wrap-up/cleanup-procedures-execution.md` Section C steps 3.5-5.5 (step 3.5 is the pre-anchoring copy-out guard; step 4 carries the squash containment proof) and Section E's claim release, with reason `merged: spec {n}` and `$LINK` set to the merge commit sha. Finish every `decisions.md` write first — Step 4.2's reconcile runs last, because its `archive` check moves the run dir and a later write would recreate it.

## Step 3's branch 5 under merge mode

Before accepting branch 5's `pending-review` for an error branches 1-4 do not recognize (for example a transient `HTTP 502` from the forge), re-read `mergeStateStatus` (`gh pr view {pr} --json mergeStateStatus,statusCheckRollup`) — a sibling merge can turn the PR `DIRTY` after the first read:

- `DIRTY`: take the Conflict path, resolved per the Conflict section below.
- `CLEAN` with a green rollup: re-enter Step 2.5 from the top, so its head-run read (`gh run list --commit`) still runs. This happens once per invocation: a second branch-5 error accepts `pending-review`, so a deterministic forge error never loops.
- Anything else: accept `pending-review`.

## Outcomes

Report `merged`, `armed`, or `pending-review` in `pr-first-merge.md`'s Outcome vocabulary. Any other stop inside `pr-first-merge.md` before the merge — Step 1.5's curation guard, a non-zero `compose-subject` exit — reports `pending-review` naming that step. A cleanup step that fails after `merged` keeps the `merged` outcome and adds one `cleanup: {step} failed — {reason}` line per failure, never a silent success.

## Conflict

Runs when `pr-first-merge.md`'s Conflict path — its single update-from-base merge, inside the run's own worktree — leaves conflict markers. `pr-first-merge.md` points here; no other caller reads this section. Under merge mode that merge itself first needs `{worktree-path}`: when `run-state.json` carries no `worktree`, the path no longer exists, or it resolves to the main checkout rather than a linked worktree, report `pending-review`, reason `no-worktree`, and run no merge in any checkout.

- Resolve a conflict only where both sides' intent can be kept and stated in one line per file; each file's line goes into the commit message and the closing report.
- An incident-number collision (`docs/incident-log.md`'s `IL-{N}`) renumbers the branch's own entry and every citation the branch added, never the integration branch's.
- Stage the result and run the full suite through `verify.js` (`test/verification.md`'s runner) with `--cwd "{worktree-path}"`, so it checks the resolved merge rather than the session's own checkout.
- Green: commit, push (`git -C "{worktree-path}" push origin {branch}`), and re-enter Step 2.5 from the top — the pushed head has its own CI to read before any merge. This re-entry is the Conflict path's one attempt: a second `DIRTY` after the attended push reports `pending-review`, reason `moving-target`, with the PR ready. A failed push reports `pending-review`, reason `push-failed`, leaving the merge commit in the worktree — never reset, never retried here.
- A conflict that needs a judgment between the two sides' intent, or a red suite: run `git merge --abort` in the worktree (`git -C "{worktree-path}"`), leave the PR ready, and report `pending-review` naming the conflicted files and the reason.
