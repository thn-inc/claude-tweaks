# Merge Mode

Referenced by `skills/wrap-up/SKILL.md`'s Phase 1 ("Identify the work context") — read only when `$ARGUMENTS` is only the literal `merge` token, at most one record reference, and this skill's own flags. It replaces Phases 1-4: a same-session merge of a PR a headless run left on `pending-review`.

## What it is

`/claude-tweaks:wrap-up #{n} merge` merges the record's already-open PR now. The typed invocation is the human merge confirmation, so compose-subject's `{tag}` = `human-approved` (the same tag `dispatch/close-out.md` uses). Merge mode never runs `console-resolve.js` and never asks a `"Review Console"`-headed question: the console already rendered when the run parked, and under `consoleAutoResolve` the `pre-tool-use.js` ask gate (#3712) would deny one anyway. The confirmation holds only on a human's own turn: a subagent, a scheduled Routine, or any other headless caller that reaches this file stops and reports `pending-review`, reason `no-human-confirmation`, because no autonomy ceiling stands in for the typed go-ahead (the same rule as `dispatch/close-out.md`'s confirmation gate, which requires a human present by construction).

## Resolve the run

Adopt the run dir the way the explicit `/claude-tweaks:wrap-up #{n}` re-entry does (`resume-halted-run.md`'s second paragraph): `_shared/run-dir-resolution.md`'s resolution order, an inherited `PIPELINE_RUN_DIR` first, else `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --spec-slug "spec-{n}"` with no `--create`. When the live call resolves nothing, merge mode runs `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --archived --spec-slug "spec-{n}"` once (#4677): wrap-up's own Phase 4 closes and archives a pr-first run whose merge it left open, so the parked run is usually under `archive/`. Which closed runs that call adopts, read-only, and when it refuses, is `_shared/pipeline-run-dir.md`'s `--archived` bullet. When nothing resolves, merge mode stops and names the record; it never mints a run dir, because a stray `-standalone` dir could shadow the real run on retry. This is not the `resume` form — a parked run is `active` or already closed (`clean`, often archived), never `interrupted`, so `resume`'s precondition never holds for it.

Then bind the adopted run to the typed record: its `config.yml` `spec:` value must equal `{n}`. An inherited `PIPELINE_RUN_DIR` can name another run (`--spec-slug` itself matches a whole `-`-delimited name segment, so `spec-378` never reaches a `spec-3784` dir, #3865), so a mismatch stops before any merge step and names both records. `{worktree-path}` below is that run's `run-state.json` `worktree`; it falls back to `worktreeAtClose` when `worktree` is null (close-run keeps the prior path there, #4677). An adopted closed run takes every `decisions.md` write at the path it was adopted from until the reconcile call (#4677). Reconcile never re-opens it: an `archive/` run is outside `iterRunDirsWithState`'s top-level walk, and a live `clean` dir that reconcile archives once its PR is merged is still reached, because `_shared/pr-first-merge-post-merge.md` Step 4.2 writes to `archive/{run-id}/` when `$PIPELINE_RUN_DIR` is gone.

## Token rules

`merge` with no record reference stops, naming the missing `#{n}` — it never falls through to conversation-based work. `merge` with `cleanup-only` is rejected: report both tokens and run neither, because one asks for a merge and the other forbids everything but teardown. `merge` with `--dry-run` is rejected: report both tokens and run neither, because Phases 1-4 carry the dry-run guarantee and merge mode replaces them, so a merge under `--dry-run` would be real. `merge` with `resume` is rejected: report both tokens and run neither, because `resume` re-enters a halted Review Console and a parked PR's run is not halted. `--skill-budget` and `--doc-budget` size Phase 3's curation, which merge mode replaces, so they have no effect here and the report says they were ignored.

## Preconditions

Each one stops before any merge step, with no cleanup, and reports which failed: the project does not resolve to `integration-model: pr-first` (`_shared/integration-model.md`); `run-state.json` carries no `pr` object; the PR is neither `OPEN` nor `MERGED` (`gh pr view {pr} --json state`). A `MERGED` PR — an `armed` run's auto-merge, or a merge on GitHub, landing before the human types this — skips Procedure steps 1-2 and runs the Already merged section below.

## Procedure

1. Read the composed merge bundle exactly as `review-console.md` step 13 does: `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step merge "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-first-merge.md" "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-checklist-refresh.md"`, then read `$PIPELINE_RUN_DIR/context/merge.md`. If compose is unavailable, read the two source files.
2. Run `_shared/pr-first-merge.md` Steps 1 through 4, split as below. Steps 1-3 are: acceptance labeling unconditionally, Step 1.5's curation guard, mark ready, Step 2.5's merge-verification gate, the merge.
3. On `merged`: run Step 4.0 (`_shared/pr-first-merge-post-merge.md`), then Step 4.0b (`{pr-number}` = `{pr}`), then Step 4.1. When `{run-dir}/wrap-up-pack.json` is absent, produce it before any teardown — `node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-pack.js" --run "$PIPELINE_RUN_DIR" --only claim`, as Section E's intro requires. Then run `wrap-up/cleanup-procedures-execution.md` Section C steps 3.5-5.5 (step 3.5 is the pre-anchoring copy-out guard; step 4 carries the squash containment proof) and Section E's claim release, with reason `merged: spec {n}` and `$LINK` set to the merge commit sha. Finish every `decisions.md` write first — Step 4.2's reconcile runs last, because its `archive` check moves the run dir and a later write would recreate it.

## Already merged

A `MERGED` PR has no merge left to make, so merge mode finishes what the merge leaves behind: the post-merge closes, then the teardown. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/post-merge-run.js" --run "$PIPELINE_RUN_DIR"` on the adopted run, an `archive/` one included. The CLI runs Step 4.0 and Step 4.0b once under the run's `.post-merge.lock` claim, choosing the in-session or the late-merge arguments by the merge's age; `bin/post-merge-run.js` owns those arguments, so this section does not restate them. It prints one JSON line and exits 0 for every outcome, so route on the line, never the exit code. The line's `action` and `reason` pick one report line:

- A clean `ran` entry — `closingLinks` `nothing-closed`, `closed`, `reopened`, `no-fixes-span`, `not-merged` or `no-pr`, no `step40Failed` — reports `ran` with its `closingLinks` word and `parentsClosed` count.
- `already-done`: a run whose `decisions.md` already holds the post-merge marker prints `already-done` and runs neither step, so report `already done`.
- `in-flight` — a reconcile pass holds the run's claim and is running them now: report `in-flight`, never `ran`.
- A `ran`-shaped failure: a `ran` entry carrying `step40Failed`, or a `closingLinks` of `reopen-failed`, `close-failed`, `close-pending` or `base-unchecked`, is a failure: one `cleanup: post-merge closes failed — {closingLinks}` line naming every record in its `records` lists (`failed`, `closeFailed`, `pendingClose`, `unchecked`). That run's marker is already written, so a re-run prints `already-done` and hides the failure: the line names no `/claude-tweaks:wrap-up` re-run and cites `_shared/pr-first-merge-post-merge.md` Step 4.0's per-list actions for those records, plus `/claude-tweaks:tidy`'s `parent-gate` backstop for a parent a failed record holds open and for any parent Step 4.0b did not reach (`step40Failed`).
- A `skipped` failure: any other `reason` — `gh-absent`, `transient-failure`, `network-failure`, `claim-failed`, `marker-write-failed`, `error`, `not-github-issues`, `no-remote`, `no-pr`, `no-pr-states`, `no-pr-state`, `pr-not-found`, `invalid-arguments` and `not-merged` — adds one `cleanup: post-merge closes failed — {reason}` line. A CLI exit 2 or 3 prints nothing on stdout, so its line reads `cleanup: post-merge closes failed — exit {code}: {first stderr line}`.

The marker-less failures are the `skipped` ones and the exit 2 or 3 line. Those reading `gh-absent`, `transient-failure`, `network-failure`, `claim-failed`, `marker-write-failed` or `error`, and the exit 2 or 3 line, name `/claude-tweaks:wrap-up #{n} merge` as the next step, because with no marker written yet a re-run tries the closes again. Every other `skipped` reason — `not-github-issues`, `no-remote`, and the `no-pr`, `no-pr-states`, `no-pr-state`, `pr-not-found`, `invalid-arguments` and `not-merged` that the Preconditions above and the CLI's own checks make unreachable here — names no next step: a re-run fails the same way, because the project's work backend or remote, not this run, decides the first two.

The teardown does not depend on the closes, so whatever the CLI reported, report its line and then the rest of Procedure step 3 from Step 4.1 on, in its order, with Step 4.2's reconcile call last. Step 4.1's own release-status line is reported as that step defines it: it is none of the per-step words here and never adds a next step. `$LINK` is the PR's `mergeCommit.oid` from `gh pr view {pr} --json mergeCommit,mergedAt,mergedBy`, which also supplies the `mergedAt` and `mergedBy` the report names. A target that is already gone — worktree reaped, branch deleted, claim released — reports `already done`, never `failed`.

## Step 3's branch 5 under merge mode

Before accepting branch 5's `pending-review` for an error branches 1-4 do not recognize (for example a transient `HTTP 502` from the forge), re-read `mergeStateStatus` (`gh pr view {pr} --json mergeStateStatus,statusCheckRollup`) — a sibling merge can turn the PR `DIRTY` after the first read:

- `DIRTY`: take the Conflict path, resolved per the Conflict section below.
- `CLEAN` with a green rollup: re-enter Step 2.5 from the top, so its head-run read (`gh run list --commit`) still runs. This happens once per invocation: a second branch-5 error accepts `pending-review`, so a deterministic forge error never loops.
- Anything else: accept `pending-review`.

## Outcomes

Report `merged`, `armed`, or `pending-review` in `pr-first-merge.md`'s Outcome vocabulary. Any other stop inside `pr-first-merge.md` before the merge — Step 1.5's curation guard, a non-zero `compose-subject` exit — reports `pending-review` naming that step. A cleanup step that fails after `merged` keeps the `merged` outcome and adds one `cleanup: {step} failed — {reason}` line per failure, never a silent success.

An already merged PR (the Already merged section) reports outcome `merged` with a leading `already merged {mergedAt} by {mergedBy} — merge mode ran only the post-merge steps` line, then one line per step: `ran`, `already done`, `in-flight`, or a `cleanup:` failure line. The report names no next step when every line reads `ran`, `already done` or `in-flight`; Step 4.1's release-status line is none of these words and never adds one.

## Conflict

Runs when `pr-first-merge.md`'s Conflict path — its single update-from-base merge, inside the run's own worktree — leaves conflict markers. `pr-first-merge.md` points here; no other caller reads this section. Under merge mode that merge itself first needs `{worktree-path}`: when `{worktree-path}` resolves to nothing (no `worktree` and no `worktreeAtClose`), the path no longer exists, or it resolves to the main checkout rather than a linked worktree, report `pending-review`, reason `no-worktree`, and run no merge in any checkout.

- Resolve a conflict only where both sides' intent can be kept and stated in one line per file; each file's line goes into the commit message and the closing report.
- An incident-number collision (`docs/incident-log.md`'s `IL-{N}`) renumbers the branch's own entry and every citation the branch added, never the integration branch's.
- Stage the result and run the full suite through `verify.js` (`test/verification.md`'s runner) with `--cwd "{worktree-path}"`, so it checks the resolved merge rather than the session's own checkout.
- Green: commit, push (`git -C "{worktree-path}" push origin {branch}`), and re-enter Step 2.5 from the top — the pushed head has its own CI to read before any merge. This re-entry is the Conflict path's one attempt: a second `DIRTY` after the attended push reports `pending-review`, reason `moving-target`, with the PR ready. A failed push reports `pending-review`, reason `push-failed`, leaving the merge commit in the worktree — never reset, never retried here.
- A conflict that needs a judgment between the two sides' intent, or a red suite: run `git merge --abort` in the worktree (`git -C "{worktree-path}"`), leave the PR ready, and report `pending-review` naming the conflicted files and the reason.
