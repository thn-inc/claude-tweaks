# Dispatch — Express Lane Task() Prompt Templates (#4025)

Referenced by `skills/dispatch/SKILL.md` Step 5 (the express call) and Step 3's loop termination (the post-merge sample review call). `task-prompt.md`'s template rules bind both templates: inline each fenced block verbatim into its own `Task()` call, never paraphrased and never both in one call. Unlike `task-prompt.md`'s, its placeholders are substituted by hand, since `dispatch-prompt.js` renders only that file (#4735). `{context-pack}` is `task-prompt.md`'s Context pack section, each numbered item resolved as it states (item 3's `{policy-values}`: its command's five values as `key=value`, joined by `, `). Neither of Templates A/B/C fits an agent that runs a procedure rather than returning findings, so these are their own minimal templates, as `task-prompt.md`'s are: minimal input, the literal output format inlined, and the four-value status line.

## Express call

Dispatched for a singleton group whose `express-lane.js gate` verdict is `eligible: true` (`SKILL.md` Step 5, which also routes its return); any other verdict, or any non-zero gate exit, keeps `task-prompt.md`'s two calls. It is the group's first call: dispatch Step 4's minted directory is `{minted-run-dir}`, the session has already entered the group's worktree and bound it without `--dispatch`, `drain-pr-overlap.md`'s Step 5 list write runs once it returns, and `task-prompt.md`'s per-group model log line (#3212) is written after it returns, as for a first call. Substitute `{issue}`, `{minted-run-dir}`, `{plugin-root}` and `{context-pack}`.

**Before substituting this template**, the dispatching session decides whether to add the line `DISPATCH_HEADLESS=1` as its first line, above `Task scope:` — a decision made once, here, never left in the copied text for the dispatched agent to reason about. Add it when this firing came from a scheduled Routine (a bare drain, or its deprecated `next` alias) with nobody present; omit it entirely (no `{headless-marker}` placeholder, no blank line) when a human typed the command directly, in any form — the same discriminator `task-prompt.md` uses for its first-call marker. Settle's claim-contest special case reads it, so a contested claim in a headless firing self-reports instead of failing unseen.

```
Task scope: Run the claude-tweaks express lane for GitHub record #{issue}. Read
`{plugin-root}/skills/_shared/express-lane.md` and run its Procedure section, steps 1-10, with
`{run-dir}` = `{minted-run-dir}` and `{n}` = {issue}, reading every `${CLAUDE_PLUGIN_ROOT}` in it
as `{plugin-root}`; its Escalation section governs every escalation, and its Outcomes section
the outcome you report. You are its /claude-tweaks:dispatch caller: run step 1's claim yourself,
and pass `--tag auto-merge` at step 9's merge. Before step 9's Content judgment, run the
Drain-overlap hold in `{plugin-root}/skills/dispatch/settle-and-merge.md`'s Auto-merge gate for
this one record; a hold stops with outcome `pending-review`. Never invoke /claude-tweaks:flow:
on `express-escalated`, stop -- the dispatching session hands the record to the normal path. If
you reference this issue number in a commit message, write "refs #N" -- never "closes #N" or
"fixes #N".

On outcome `blocked`, before reporting, run Step 6's Settle in
`{plugin-root}/skills/dispatch/settle-and-merge.md` for this record, with `$ISSUE` = {issue} and
`$PIPELINE_RUN_DIR` = `{minted-run-dir}`: after a step-1 claim failure, only its Claim-contest
special case (a `DISPATCH_HEADLESS=1` first line on this prompt is the marker it reads);
otherwise its numbered steps 1-7, with `--reason "failed: express-{step}"`, where `{step}` is the
bold name of the Procedure step that stopped, lowercased and hyphenated (e.g. `check`, `pr`).

{context-pack}

Working directory: the dispatching session has ALREADY entered this group's worktree; you
inherit it. Do NOT create, enter, or switch worktrees, and do not invoke
/superpowers:using-git-worktrees. Echo `pwd` and `git rev-parse --show-toplevel` before any
commit and verify both resolve to that inherited worktree; if they resolve to the main
checkout instead, STOP and report BLOCKED rather than committing.
If your first commit is denied by the working-directory hook even though `pwd` and
`git rev-parse --show-toplevel` both resolve to the worktree above, re-stamp the run's worktree
assignment once with `node "{plugin-root}/bin/hooks.js" record-worktree --run "<RUN_DIR>" "<WORKTREE>"`
and retry the commit. If it is denied a second time, STOP and report BLOCKED.

Either STOP above is outcome `blocked`; every other hook or gate denial up to the push is the
Procedure's `gate-denial` escalation. Do NOT tear the worktree down, run ExitWorktree or
`git worktree remove`, or archive the run directory, on any outcome.

Never run `git stash` in any form -- bare `git stash`/`push`, `save`, `pop`, `drop`, `clear` or
`store`; only the read-only `git stash list` and `git stash show` are allowed. The stash stack is
shared repo-wide across every worktree of this checkout, so any of them can pop, drop or clobber
a sibling worktree's in-flight work. To compare against a baseline without mutating the tree, use
`git show <rev>:<path>`; to set your own work aside, make a temporary WIP commit instead.

Never kill a process by image or name (`taskkill /IM`, `pkill`, `killall`, `Stop-Process -Name`,
a `pgrep`-fed `kill`): the process table is shared machine-wide with sibling sessions. Kill only
a PID you started or your own port's listener (`lsof -nP -iTCP:{port} -sTCP:LISTEN -t`; win32:
`taskkill /PID {pid} /T /F`); otherwise leave the process running and report it.

OUTPUT FORMAT (required) -- return ONLY these lines, no preamble:

GROUP: {issue}
OUTCOME: {merged | armed | pending-review | express-escalated | blocked}
MANIFEST: {absolute path to this group's run-dir decisions.md -- a human-readable trace only;
  the dispatching session already holds this run's identity as {minted-run-dir}}
ISSUE #{issue}: failed:claim-permission-denied -- only when step 1's claim-targets.js exited 7; omit otherwise

Status line (required): on its own trailing line, after everything above -- the reply's last
non-empty line -- write exactly `STATUS: {WORD}`, where {WORD} is one of: DONE /
DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED. `express-escalated` is a clean hand-back
(`STATUS: DONE`); outcome `blocked` is `STATUS: BLOCKED`.

[Use: Capable] -- the first call's profile, on the same #3212 evidence (bypassed /flow in 6 of 10
firings vs 0 of 3 at Standard): this call builds, tests and merges. Resolve via
`node "{plugin-root}/bin/resolve-profile.js" capable` (contract § Model Selection).
```

## Post-merge sample review call

Dispatched from this session at Step 3's loop termination, one sampled PR at a time and never in parallel, running `_shared/express-lane.md`'s Post-merge sampling. A foreground express merge's own-PR check (#4365: `SKILL.md` Step 5's `#N`/`#N,#M` forms, or `/claude-tweaks:flow`'s `express-entry.md`) dispatches it too, for its one PR: there step 1 is `samples --pr {pr}`, and "this firing's report" below is that session's own report (in `/claude-tweaks:flow`, a line after the express note). This session runs that section's step 1 (`express-lane.js samples`, whose exit 1 or 2 means no sweep this firing) and, per sampled PR, step 2's `mergeSha: null` case (name the PR in this firing's report; mint and dispatch nothing) and its mint. The minted sampling run dir is `{minted-run-dir}` here and in the Context pack, resolved for it; `task-prompt.md`'s #3212 model log line is a first-call record and is not written for this call. Substitute `{pr}`, `{merge-sha}`, `{records}` (the entry's `records`, comma-joined), `{minted-run-dir}`, `{run-root}` (the main checkout, `$RUN_ROOT` per `_shared/pipeline-run-dir.md`), `{plugin-root}` and `{context-pack}`. On its return, the `sequential-execution.md` status-line check applies; any reply but `DONE`/`DONE_WITH_CONCERNS` with `OUTCOME: reviewed` names the PR in this firing's report as left for the next sweep, never retried this firing, and a `reviewed` reply's `FINDINGS` line, filed record numbers included, goes into this firing's report. Whatever it reports, this session then runs that section's close-run for `{minted-run-dir}`; a refusal because the call died before logging anything leaves the dir to the reconciler's orphaned-mint sweep.

```
Task scope: Review merged express-lane PR #{pr} (merge commit {merge-sha}; records {records})
after the fact. This is read-only: never edit code, never commit, never push. Read
`{plugin-root}/skills/_shared/express-lane.md` and run its Post-merge sampling section's step 2
for this one PR, from its `git -C "$RUN_ROOT" fetch origin {ref}` bullet on: the dispatching
session already ran step 1 and minted this PR's sampling run dir, `{minted-run-dir}` (that
section's `{run-dir}`). Read `$RUN_ROOT` there as `{run-root}`, `{mergeSha}` as {merge-sha}, and
every `${CLAUDE_PLUGIN_ROOT}` as `{plugin-root}`. File every confirmed finding with
/claude-tweaks:capture as that section says, and write every `SKIP` to `{minted-run-dir}`, as its
last paragraph says.
Of its last bullet, log the posted review's `AUTO` line but do not run `close-run`: the
dispatching session closes the run dir after you report.

{context-pack}

OUTPUT FORMAT (required) -- return ONLY these lines, no preamble:

PR: #{pr}
OUTCOME: reviewed
FINDINGS: {k} (filed as #a, #b)

With no findings the line is `FINDINGS: 0`. Report `reviewed` only once the express-review
comment is posted. A review that did not complete -- a lens that returned BLOCKED or
NEEDS_CONTEXT, a failed capture, or a failed post -- logs its SKIP as that section says, omits
the OUTCOME and FINDINGS lines, and ends `STATUS: BLOCKED`.

Status line (required): on its own trailing line, after everything above -- the reply's last
non-empty line -- write exactly `STATUS: {WORD}`, where {WORD} is one of: DONE /
DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.

[Use: Standard] -- this call drives a review, it does not judge one: the lenses it dispatches
select their own models per `{plugin-root}/skills/review/step3-lens-dispatch.md`. Resolve via
`node "{plugin-root}/bin/resolve-profile.js" standard` (contract § Model Selection).
```
