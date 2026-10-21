# Merge Mode

Referenced by `skills/wrap-up/SKILL.md`'s Phase 1 ("Identify the work context") — read only when `$ARGUMENTS` is a record reference followed by the literal `merge` token. It replaces Phases 1-4: a same-session merge of a PR a headless run left on `pending-review`.

## What it is

`/claude-tweaks:wrap-up #{n} merge` merges the record's already-open PR now. The typed invocation is the human merge confirmation, so compose-subject's `{tag}` = `human-approved` (the same tag `dispatch/close-out.md` uses). Merge mode never runs `console-resolve.js` and never asks a `"Review Console"`-headed question: the console already rendered when the run parked, and under `consoleAutoResolve` the `pre-tool-use.js` ask gate (#3712) would deny one anyway.

## Resolve the run

Adopt the run dir the way the explicit `/claude-tweaks:wrap-up #{n}` re-entry does (`resume-halted-run.md`'s second paragraph): `_shared/run-dir-resolution.md`'s resolution order, an inherited `PIPELINE_RUN_DIR` first. This is not the `resume` form — a parked `pending-review` run stays `status: active`, so `resume`'s `status: interrupted` precondition never holds for it.

## Token rules

`merge` with no record reference stops, naming the missing `#{n}` — it never falls through to conversation-based work. `merge` with `cleanup-only` is rejected: report both tokens and run neither, because one asks for a merge and the other forbids everything but teardown.

## Preconditions

Each one stops before any merge step, with no cleanup, and reports which failed: the project does not resolve to `integration-model: pr-first` (`_shared/integration-model.md`); `run-state.json` carries no `pr` object; the PR is not `OPEN` (`gh pr view {pr} --json state`).

## Procedure

1. Read the composed merge bundle exactly as `review-console.md` step 13 does: `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step merge "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-first-merge.md" "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-checklist-refresh.md"`, then read `$PIPELINE_RUN_DIR/context/merge.md`. If compose is unavailable, read the two source files.
2. Run `_shared/pr-first-merge.md` Steps 1 through 3: acceptance labeling unconditionally, Step 1.5's curation guard, mark ready, Step 2.5's merge-verification gate, the merge.
3. On `merged`: run Step 4.1. Then run `wrap-up/cleanup-procedures-execution.md` Section C steps 3.6-5.5 (its step 4 carries the squash containment proof) and Section E's claim release. Finish every `decisions.md` write first — Step 4.2's reconcile runs last, because its `archive` check moves the run dir and a later write would recreate it.

## Step 3's branch 5 under merge mode

Before accepting branch 5's `pending-review` (for example `--auto` rejected with "Protected branch rules not configured"), re-read `mergeStateStatus` (`gh pr view {pr} --json mergeStateStatus,statusCheckRollup`) — a sibling merge can turn the PR `DIRTY` after the first read:

- `DIRTY`: take the Conflict path, resolved per the Conflict section below.
- `CLEAN` with a green rollup: take Step 2.5's `wait`-row immediate `--squash`.
- Anything else: accept `pending-review`.

## Outcomes

Report `merged`, `armed`, or `pending-review` in `pr-first-merge.md`'s Outcome vocabulary.

## Conflict
