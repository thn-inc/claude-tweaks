# Step 3 Lens Dispatch Record (#5998) — /claude-tweaks:review

Read from `step3-lens-dispatch.md`'s dispatch-record pointer, and from `step3-workflow-dispatch.md`'s Settle section. It holds the one call that records each agent lens's dispatch, and the values to pass.

The yield file has no entry for a lens that ran and found nothing, so a lens's confirmed-finding rate has no denominator there. `{run}/lens-dispatch.json` is that denominator, read by `bin/lib/review-lens/history.js`. Record on every dispatch path and whatever any lens-selection policy says, so the history builds before anyone opts in.

## When

Once per lens per Step 3 round, when a run directory exists. A standalone review (no run directory) records nothing. Call right after the lens's verdict is known — after its first `categorise-reproduction` or `settle-lens-replies` call, or once its failure is final (after the retry, where the Task path gives one: unavailable and timed-out agents get none).

## Command

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" record-lens-dispatch --run "$PIPELINE_RUN_DIR" --lens {lens} --reviewers {1|2} --path {task|workflow|worker} --status {completed|failed|blocked} --round {n}
```

It prints one JSON line `{path, entry, duplicate}`.

## Values

- `--lens`: the Step 3 id, `3a` to `3h`.
- `--reviewers`: the reviewers dispatched for the lens — `2` for a reproduction pair, `1` for a low-tier single-read agent (`step3-tier-variants.md`) and for 3h.
- `--status`:
  - `completed` — both of a pair's final replies were `DONE` or `DONE_WITH_CONCERNS` and the lens reached its pair verdict (its `categorise-reproduction --only confirmed` call ran, or `settle-lens-replies` listed it under `settled`), or a single-reviewer lens (low tier, 3h) returned a usable reply.
  - `blocked` — either reviewer's final reply was `BLOCKED` or `NEEDS_CONTEXT`, even when `categorise-reproduction` still ran on the pair with the blocked reply as the unreproduced side: a blocked dispatch is not a qualifying run.
  - `failed` — the lens's replies never came: a session limit twice, unavailable, timed out, or the partner-died single-read degrade (`step3-tier-variants.md`).
- `--path`: the path whose replies settled the lens.
  - `workflow` — a lens `settle-lens-replies` settled, and a `needsSession` lens with reason `single-reviewer` whose one workflow reviewer was usable (settled by the low-tier single-read rule, nothing re-dispatched: `--reviewers 1 --status completed`).
  - `worker` — a lens `settle-lens-replies` settled from launcher replies on the worker path, `step3-worker-dispatch.md`.
  - `task` — every Task-path lens, including a workflow lens whose reviewers were re-dispatched as Task agents (`reviewer-unusable`, or a `single-reviewer` lens whose one reviewer was unusable), every lens after the workflow fallback, and every lens the worker path sent to the Task path (3f, a re-dispatched lens, every lens after a worker fallback).
- Lens 3h is always `--path task --reviewers 1`, including when it is dispatched as a Task agent alongside a workflow fan-out: `completed` on a usable reply, else `blocked` or `failed` as above.
- `--round`: `1` on the run's first Step 3. A later Step 3 in the same run directory reads `{run}/lens-dispatch.json` once first and passes one more than its highest `round`. The round never changes the rate, so a doubtful round is harmless; an identical repeat call is a no-op (`duplicate: true`).

## Exits

Exit 2: fix the call — never retry it unchanged. Exit 3: re-resolve `$PIPELINE_RUN_DIR` per `_shared/pipeline-run-dir.md` and retry once, then name the unrecorded lens in the review summary. A failed record never blocks the review.
