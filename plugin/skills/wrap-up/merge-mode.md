# Merge Mode

Referenced by `skills/wrap-up/SKILL.md`'s Phase 1 ("Identify the work context") — read only when `$ARGUMENTS` is only the literal `merge` token, at most one record reference, and this skill's own flags. It replaces Phases 1-4: a same-session merge of a PR a headless run left on `pending-review`.

## What it is

`/claude-tweaks:wrap-up #{n} merge` merges the record's already-open PR now. The typed invocation is the human merge confirmation, so compose-subject's `{tag}` = `human-approved` (the same tag `dispatch/close-out.md` uses). Merge mode never runs `console-resolve.js` and never asks a `"Review Console"`-headed question: the console already rendered when the run parked, and under `consoleAutoResolve` the `pre-tool-use.js` ask gate (#3712) would deny one anyway.

## Resolve the run

Adopt the run dir the way the explicit `/claude-tweaks:wrap-up #{n}` re-entry does (`resume-halted-run.md`'s second paragraph): `_shared/run-dir-resolution.md`'s resolution order, an inherited `PIPELINE_RUN_DIR` first, else `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --spec-slug "spec-{n}"` with no `--create`. When nothing resolves, merge mode stops and names the record; it never mints a run dir, because a stray `-standalone` dir could shadow the real run on retry. This is not the `resume` form — a parked `pending-review` run stays `status: active`, so `resume`'s `status: interrupted` precondition never holds for it.

## Token rules

`merge` with no record reference stops, naming the missing `#{n}` — it never falls through to conversation-based work. `merge` with `cleanup-only` is rejected: report both tokens and run neither, because one asks for a merge and the other forbids everything but teardown. `merge` with `--dry-run` is rejected: report both tokens and run neither, because Phases 1-4 carry the dry-run guarantee and merge mode replaces them, so a merge under `--dry-run` would be real. `merge` with `resume` is rejected: report both tokens and run neither, because `resume` re-enters a halted Review Console and a parked PR's run is not halted.

## Preconditions

Each one stops before any merge step, with no cleanup, and reports which failed: the project does not resolve to `integration-model: pr-first` (`_shared/integration-model.md`); `run-state.json` carries no `pr` object; the PR is not `OPEN` (`gh pr view {pr} --json state`).

## Procedure

1. Read the composed merge bundle exactly as `review-console.md` step 13 does: `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step merge "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-first-merge.md" "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-checklist-refresh.md"`, then read `$PIPELINE_RUN_DIR/context/merge.md`. If compose is unavailable, read the two source files.
2. Run `_shared/pr-first-merge.md` Steps 1 through 4, split as below. Steps 1-3 are: acceptance labeling unconditionally, Step 1.5's curation guard, mark ready, Step 2.5's merge-verification gate, the merge.
3. On `merged`: run Step 4.1. Then run `wrap-up/cleanup-procedures-execution.md` Section C steps 3.6-5.5 (its step 4 carries the squash containment proof) and Section E's claim release. Finish every `decisions.md` write first — Step 4.2's reconcile runs last, because its `archive` check moves the run dir and a later write would recreate it.

## Step 3's branch 5 under merge mode

Before accepting branch 5's `pending-review` for an error branches 1-4 do not recognize (for example a transient `HTTP 502` from the forge), re-read `mergeStateStatus` (`gh pr view {pr} --json mergeStateStatus,statusCheckRollup`) — a sibling merge can turn the PR `DIRTY` after the first read:

- `DIRTY`: take the Conflict path, resolved per the Conflict section below.
- `CLEAN` with a green rollup: re-enter Step 2.5 from the top, so its head-run read (`gh run list --commit`) still runs.
- Anything else: accept `pending-review`.

## Outcomes

Report `merged`, `armed`, or `pending-review` in `pr-first-merge.md`'s Outcome vocabulary.

## Conflict

Runs when `pr-first-merge.md`'s Conflict path — its single update-from-base merge, inside the run's own worktree — leaves conflict markers. `pr-first-merge.md` points here; no other caller reads this section.

- Resolve a conflict only where both sides' intent can be kept and stated in one line per file.
- An incident-number collision (`docs/incident-log.md`'s `IL-{N}`) renumbers the branch's own entry and every citation the branch added, never the integration branch's.
- Stage the result and run the full suite through `verify.js` (`test/verification.md`'s runner).
- Green: commit, push (`git -C "{worktree-path}" push origin {branch}`), and re-enter Step 2.5 from the top — the pushed head has its own CI to read before any merge. This re-entry is the Conflict path's one attempt: a second `DIRTY` after the attended push reports `pending-review`, reason `moving-target`, with the PR ready.
- A conflict that needs a judgment between the two sides' intent, or a red suite: run `git merge --abort` in the worktree (`git -C "{worktree-path}"`), leave the PR ready, and report `pending-review` naming the conflicted files and the reason.
