# Git Discipline

Canonical git rules for skills that commit code. Referenced from `/build`, `/review`, `/wrap-up`, `/simplify`, `/journeys`, and any other skill that runs `git commit`.

Code that reads git path lists (`plugin/bin`) follows `_shared/git-path-read.md`: `-z` + NUL split, `--end-of-options` before refs.

For working-directory rules specific to dispatched subagents (anchoring CWD, `git -C "$WORKTREE"`, `pwd` checks before commit), see `subagent-dispatch-core.md` (Working Directory Discipline section) — that contract applies whenever a skill dispatches an agent that runs `git` or `node --test`.

During worktree-mode pipeline runs, the wrong-checkout commit rule is mechanically enforced by the plugin's PreToolUse hook (E1) — a denied commit names the assigned worktree; clear the assignment with `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run` when legitimately finishing the branch. Enforcement is scoped to the session that recorded the worktree: a commit from a different session (e.g. unrelated fix work in the main checkout while the pipeline runs elsewhere) is allowed with a warning, not denied. Run `close-run` only from the session that owns the run or at the merge/finish handoff — closing another session's live run ends its enforcement and event logging mid-flight.

Independent of any pipeline run, a project can opt into `worktree-always: true` in `.claude-tweaks/policy.yml` — when set, the same PreToolUse hook denies any `Edit`, `Write`, `NotebookEdit`, or `git commit` whose target isn't already inside a linked git worktree, even before `/build` or `/flow` has ever run. Unlike E1, this check needs no recorded run state; it fires from the first prompt of a session. `/init` Phase 0 Step 6 offers this opt-in during bootstrap (recommended by default, re-offered on later re-runs if declined) — the flag can also be hand-edited into `policy.yml` directly. Set up the worktree first via `/superpowers:using-git-worktrees`, then follow `_shared/worktree-setup.md`'s post-creation catch-up before any other action, then retry the edit inside it.

**Naming the worktree for what actually lands there.** When a step's own investigation (e.g. a Preflight check, a diagnostic pass) discovers an unplanned, unrelated fix is needed *before* reaching whatever worktree/branch the step's original task would have used, give that fix its own distinctly-named worktree — don't reuse whatever slug the original, now-aborted task already picked. A worktree named after the task that triggered the investigation, holding a commit for something else entirely, is confusing forensics for anyone tracing it later (a `dispatch-42`-named worktree holding a `CLAUDE.md` config fix unrelated to issue #42, say) — pick a name that describes the commit that's actually going in, not the context that surfaced the need for it.

This check is independent of `close-run` — closing a pipeline run's worktree assignment satisfies E1 only, not this gate, since it never reads run state. For exactly what the gate intercepts, read the `worktree-always` coverage block in `_shared/policy-schema-coverage.md`; it is canonical and this file does not restate it.

It matters most at the merge/finish handoff, in two ways. **The merge is fine, the push is not:** `git merge` and `git checkout` are ungated, but `git push` is covered, so it has to run from inside a linked worktree and as a *separate* Bash call (a chained merge-and-push is denied whole). **A merge conflict is worse:** resolving one requires `Edit` + `git commit` in the main checkout, both denied regardless of `close-run`. See `flow/worktree-merge.md`'s conflict branch for the scratch-worktree adaptation (resolve in a throwaway linked worktree, then `git merge --ff-only` the result into the main checkout).

Known consequence of `worktree-always`: entering a worktree mid-session (via `EnterWorktree`/`isolation: "worktree"`) pivots the session's own storage into a project bucket keyed by the worktree's path, so `claude --resume` from the parent project no longer lists that session. This is an upstream Claude Code limitation (closed as known/not-planned upstream), not a claude-tweaks bug — see README's "Worktree sessions and `claude --resume`" section for the full explanation and the manual-worktree workaround.

A sibling lever in the same file, `execution-strategy`, locks `/claude-tweaks:build`'s execution axis when set to a `-only` value (`subagent-only`/`batched-only`) — the other strategy is never offered by the build-strategy prompt and is rejected if passed explicitly (see `/claude-tweaks:build`'s Build Options); plain `subagent`/`batched` set an overridable default, not a lock. Unlike `worktree-always`, the lock has no mechanical `PreToolUse` backstop: there is no interceptable tool call for "which execution strategy did the assistant choose," the way there is for "which directory did this edit land in." Enforcement here is the same as every other lever in the auto-mode-contract system (scope-creep, review-auto-apply-ceiling, etc.) — the assistant reads `.claude-tweaks/policy.yml` and follows it, with no code-level fallback if it doesn't.

## Rules — NON-NEGOTIABLE

These apply in ALL modes. They exist because multiple processes may commit to the same branch simultaneously, and because shared history must not be rewritten.

| Rule | Reason |
|------|--------|
| **NEVER `git reset`** | Other processes may be committing. A reset wipes their work. |
| **NEVER `git checkout .` or `git restore .`** | Same reason — destroys concurrent work. |
| **NEVER force push** | Rewrites shared history. If an alternative to plain `--force` is truly unavoidable, use `--force-with-lease` so the push aborts on unexpected remote movement instead of clobbering it — never on the published integration branch (`_shared/pr-first-merge.md`'s "Never rewrite the integration branch"). |
| **Push commits promptly** | Local-only commits are vulnerable to loss. |
| **Stage specific files only** | Never `git add -A` or `git add .`. |
| **Verify commits landed** | Always `git log --oneline -3` after committing. |
| **Never `--no-verify` / `--no-gpg-sign`** | Skipping hooks or signing bypasses safety the user opted into. If a hook fails, fix the underlying issue. |
| **A transient `index.lock` collision retries, never `rm`s the lock** | A sibling agent's git call or a PostToolUse hook in the same shared checkout can hold the lock for a couple of seconds — a real process, not a stale one. `bin/lib/git-retry.js`'s `withIndexLockRetry` is the shared, bounded (~15 attempts at 2s) implementation every plugin commit call site routes through (#2346); a hand-written `git commit` in a skill's own procedure follows the same rule — retry on the `index.lock`/"another git process seems to be running" signature, never delete the lock file. |

## Phase exit — one `phase-exit.js` call

Under `pr-first` (`_shared/integration-model.md`), every pipeline phase that commits — build,
test, review, polish, wrap-up — ends by pushing the branch. This is what makes the run's draft PR
(`_shared/pr-early-run-lifecycle.md`) show live progress instead of only the state as of run
start, and what keeps the branch durable at every phase boundary rather than only at finish —
see `docs/incident-log.md`'s `[IL-128]` for what "only pushed once, at the very end" costs when a
session never reaches the end. One call does the whole phase exit, as its own Bash call, never
chained onto anything else (the `worktree-always` gate denies a compound command whole):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/phase-exit.js" --run "$PIPELINE_RUN_DIR" --phase {build|test|review|polish|wrap-up} --worktree "{worktree-path}" --fixes {n}[,{m}...]
```

Call it at every phase exit of a run with a run dir — any model or mode; it pushes only under
`pr-first` in `worktree` mode, and resolves the route itself. Its sub-steps, flags, envelope and
exit codes are in `node "${CLAUDE_PLUGIN_ROOT}/bin/phase-exit.js" --help`; an exit 2 or 3 is a bad
call — fix it and re-run. It runs `_shared/pr-checklist-refresh.md`'s Phase-checklist update
(`--fixes`, `--remove` and `--summary-file` pass through) and, after a landed push, the Post-push
merge-state check below, and writes every `decisions.md` line those steps owe itself
(`_shared/auto-decision-log.md`'s CLIs that log their own entries). **Route the envelope** — every
call site cites this list rather than restating it:

- `route` `local-merge` or `current-branch` — nothing more, except a `bookkeeping.worktree:
  'failed'` (below).
- `push.state: 'pushed'` — route `mergeState` per the Post-push merge-state check below.
- `push.state: 'failed'` — nothing: the CLI logged it, and the next phase exit's push retries.
- `push.state: 'skipped'` with a `reason` naming no recorded PR — run
  `_shared/pr-early-run-lifecycle.md`'s push-and-open-draft-PR procedure, then re-run
  `phase-exit.js`. Ignore the `checklist.action: 'no-pr'` that comes with it: this route owns it,
  and the re-run flips the row. Any other `skipped`, and a `refused` push, is already logged:
  continue.
- `bookkeeping.worktree: 'failed'` on a live run dir — run `record-worktree` by hand
  (`build/worktree-setup.md` Step 4.5), then re-run `phase-exit.js`. If that `record-worktree`
  fails too, log one `SKIP` with `log-decision.js` naming the CLI's `bookkeeping.detail` (class (a)
  of `_shared/auto-decision-log.md`'s CLIs that log their own entries).
- `checklist.action: 'no-pr'` with any other push state — `_shared/pr-checklist-refresh.md`'s
  degraded-run recovery; `'gh-absent'` — its MCP branch. Every other `checklist` result routes per
  that section.
- `checklist.exit` or `mergeState.exit` `null` with an `error` (the sub-CLI threw) — proceed: the
  next phase exit re-runs both, and the pre-merge refresh re-flips the row.
- `logFailures` — hand-log each `decision` element (its `status`, `step` and `text`) with
  `log-decision.js`.

Under `MULTISPEC_PARALLEL_WAVE=1` a member never calls it: write one `SKIP` entry naming the
marker instead (`flow/multispec-parallel-waves.md` runs the wave's build phase exit after
merge-back).

Ship at every phase exit, not batched — measured at ≥50× headroom against the GitHub API budget
(spike #405; `git push` itself costs zero REST/GraphQL calls, so per-phase cadence is free
regardless of phase count).

**Failure degrades per-attempt, never persists.** A failed phase-exit push (network, auth, a
rejected non-fast-forward) logs a warning to the run's `decisions.md` and the phase continues —
never a hard stop, never a flag written to `run-state.json` that would suppress the *next*
phase's own push attempt. The next phase exit's push naturally catches up whatever the failed
one didn't, so a single transient failure self-heals without any retry logic of its own.

`local-merge` runs keep today's behavior: no phase-exit push, one push at finish. So does
`current-branch` mode (no worktree branch to push mid-run). Either condition is `build/SKILL.md`
Common Step 7's documented conditional action, and `phase-exit.js --phase build` writes its one
`SKIP` entry per `_shared/auto-decision-log.md`'s degrade-trace rule (the existing failure-degrade warning above is
unaffected — that already logs on a genuine push failure, a distinct case from this clean no-op).

Standalone `/build` (no run dir): list the skip in the Step 7 handoff instead (`build/handoff-template.md`'s inline-skip listing).

### Post-push merge-state check

After every successful phase-exit push — never after a failed one — read the run PR's merge
state. A PR that conflicts with the integration branch gets no `pull_request` workflow runs from
GitHub, so its checks list shows nothing at all, which reads exactly like "CI pending" (#2986);
the cheapest point to learn it is the first phase exit after the base moved, not the merge
decision. `phase-exit.js` runs this read itself and carries its output as `mergeState`; on its own
it is one plain command:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/pr-merge-state.js" --run "$PIPELINE_RUN_DIR" --phase {build|test|review|polish|wrap-up}
```

At wrap-up's exit, pass `--run` the archive path
(`$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/`, `_shared/timing-render.md`'s archive-path
rule) once cleanup item 8 archived the run directory — to `phase-exit.js` and this CLI alike; both
exit 3 on the live path it moved from. It reads `run-state.json`'s `pr.number` and the PR through `bin/lib/reconcile/pr-state.js`'s
`resolvePrStateByNumber` — one resolver call — prints `{state, pr, mergeable, mergeStateStatus, phase,
logged, reason?}`, and exits 0 in every state; exit 2 or 3 is a tooling problem with the read
itself — route it like `read-failed`. `local-merge` and `current-branch` runs never reach this
check (no phase-exit push), and a run with no `pr` in `run-state.json` reads `no-pr`.

- **`conflicting`** (`mergeStateStatus: DIRTY` or `mergeable: CONFLICTING`) — the CLI has
  already written one `AUTO` entry to `decisions.md` naming the PR and the phase (`logged: true`;
  on `logged: false` the append failed — write that entry yourself with `log-decision.js`). Say
  it in the phase output: "PR #{pr} conflicts with `{integration-branch}` at {phase} exit — no
  `pull_request` CI runs until the branch is caught up." Then route on the run's mode
  (`_shared/auto-mode-contract.md`):
  - **`auto`** (and `confirm`, which runs as `auto` once approved) — run the catch-up below
    before the next phase starts.
  - **`interactive` / `hybrid`** — surface that line and the catch-up commands below, and
    continue: no new stop — the next phase starts as it would have.
  - **At wrap-up's exit** there is no next phase, so no catch-up runs there, in any mode — the
    merge path (`_shared/pr-first-merge.md`) owns a conflict from there, unchanged.
    The one exception is a Review Console that resolved leave-open: the merge path never runs, so
    `wrap-up/execution-and-verification.md`'s Leave-open mergeability re-check takes it, in every
    mode — only git's own auto-merge runs; a conflict is reported, never resolved.
- **`no-conflict`**, **`not-open`**, **`no-pr`** — nothing to do, nothing to log. `not-open` is a
  closed or merged PR: whatever its mergeability says, it is no signal for the run.
- **`unknown`**, **`read-failed`**, **`gh-absent`** (and exit 2/3) — fail open: the phase
  proceeds unchanged. `unknown` is GitHub's asynchronous mergeability computation not finished
  yet (common straight after a push): no signal, never read as a conflict, and never re-read —
  this check costs the phase one resolver call and no more. The one exception is an `unknown` at
  wrap-up's exit under a leave-open Review Console: `wrap-up/execution-and-verification.md`'s
  Leave-open mergeability re-check takes one later read of its own. The CLI has already written
  one `SKIP` entry per `_shared/auto-decision-log.md`'s degrade-trace rule, the convention
  `_shared/pr-check-gate.md` applies to its own failed read. Write it yourself only on `logged:
  false` (the append failed) or on exit 2/3, which prints no `state` and writes nothing:
  `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP --section "{/build|/test|/review|/flow|/wrap-up}" --step "Post-push merge-state check" --reversibility n/a --text "condition: pr-merge-state.js {state} → fallback: no merge-state signal this phase"` — in
  `{state}` name what you saw: the printed `state` (with its `reason` when it printed one), or
  `exit 2`/`exit 3` when it printed none.

Like the push itself, this degrades per attempt and never persists — nothing is written to
`run-state.json`, so the next phase exit's check runs regardless.

**Catch-up (`auto`).** Merge the integration branch in; never rebase — the run branch is already
public behind its PR, and a rebase would need the force push the Git Rules forbid. Merging into
a PR branch does not invert `main`'s first-parent chain the way "Catching a branch up with
`main`" below warns about: that happens only when a branch is pushed *as* `main`, and this one
lands through its PR's own merge. Resolve `{integration-branch}` per
`_shared/integration-branch.md`. This is the mid-run counterpart of
`_shared/worktree-setup.md`'s Post-creation catch-up, and unlike the merge path (which never
resolves a conflict headlessly) it may resolve a conflict it can resolve confidently, because
the following phases re-verify the merged tree. One plain command per Bash call. Every
`log-decision.js` call below takes the same `--run "$PIPELINE_RUN_DIR"` and `--section
"{/build|/test|/review|/flow|/wrap-up}"` as step 5's full command, and `--status` as each step names it:

1. `git -C "{worktree-path}" status --porcelain` — any output: do not catch up. Surface the
   conflict line and the commands as `interactive` does, and log one `SKIP` (`--text "condition:
   uncommitted changes in the worktree → fallback: catch-up not run"`).
2. `git -C "{worktree-path}" fetch origin "{integration-branch}"` — branch names go in quoted,
   since git accepts `;` and `$(` in them
3. `git -C "{worktree-path}" rev-parse --short HEAD` — the pre-merge HEAD: the `{before short}`
   of step 5's log line, and what "HEAD is unchanged" in step 5 compares against.
4. `git -C "{worktree-path}" merge --no-edit "origin/{integration-branch}"` — a conflict is
   resolved per "Merge conflict resolution" below (never reset or discard; verify after
   resolving — when the next phase is `test`, its own verification is that run). A resolved
   conflict is committed before step 5: `git -C "{worktree-path}" add` the resolved paths, then
   `git -C "{worktree-path}" commit --no-edit`. Its "ask the user" fallback does not apply in
   `auto`: never ask — that would be a new mid-flow stop. When the conflict cannot be resolved
   confidently, run `git -C "{worktree-path}" merge --abort` (its own Bash call), log one `AUTO`
   entry (`log-decision.js`, `--step "Post-push merge-state check"`, `--reversibility high`,
   `--text "catch-up of PR #{pr}'s branch aborted on a conflict it could not resolve
   confidently — left for the merge path (_shared/pr-first-merge.md) at merge time"`), skip
   step 5 (HEAD is unchanged by the abort, so its "stale forge" line would be false), and let
   the next phase start on the un-merged, clean branch.
5. `git -C "{worktree-path}" rev-parse --short HEAD` — the post-merge HEAD, the `{after short}`
   below. If it equals step 3's `{before short}` (HEAD is unchanged), the forge's conflict state
   was stale and there is nothing to push; log one `AUTO` entry (same `--step`, `--text "local merge brought in nothing — the forge's
   conflict state was stale"`) and stop. Otherwise `git -C "{worktree-path}" push origin
   "{branch}"` — the re-push is what lets GitHub run the PR's `pull_request` workflows — and log:
   `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --section "{/build|/test|/review|/flow|/wrap-up}" --step "Post-push merge-state check" --reversibility high --text-file "{text-file}"`, `{text-file}` holding `caught PR #{pr}'s branch up with origin/{integration-branch} before the next phase ({before short} → {after short}); re-pushed` per `_shared/auto-decision-log.md`'s Text from git or a user paragraph (the integration branch name is git-supplied).

`interactive` and `hybrid` never run this merge themselves — they only surface the commands (except
wrap-up's Leave-open mergeability re-check named above, which runs git's own auto-merge in every mode). A
failed fetch, `rev-parse`, or push here degrades exactly like a failed phase-exit push: log it
and let the next phase start; the next phase exit's check reads the state again. A failed merge
never leaves the tree mid-merge: run `git -C "{worktree-path}" merge --abort` first (a no-op
error when no merge is in progress is fine), then degrade the same way — the next phase never
starts on a worktree with `MERGE_HEAD` set or conflict markers.

## Catching a branch up with `main`

A long-running branch has to be realigned with `main` before it merges (`[IL-20]`), and there are two ways to do it. They are not equivalent, and the difference outlives the branch:

- **Rebase onto `main`**, or merge and then let `main` fast-forward. `main`'s first-parent chain stays a straight line of what it actually carried. **Prefer this.**
- **Merge `main` into the branch, then push the branch as `main`.** This *inverts* the topology: the resulting merge's first parent is the branch, its second is the old `main`, so everything `main` carried between the fork point and the merge leaves the first-parent chain permanently.

The second form is not wrong as history — nothing is lost, and `git log` still shows every commit. What it destroys is any tool that reads `--first-parent` as "what `main` reported over time", and it destroys it retroactively and invisibly: the same query answers differently before and after, and versions *leave* the reconstructed set as later merges land (#144, `[IL-95]`). Two releases were written up as never-shipped on that evidence.

Git tags (created by release-please under `pr-first`, by `bin/release-local.js` under `local-merge`, or — for this repo's own pre-migration history — the one-time retro-tag backfill, #2259) now record the release history directly — a version's tag is anchored to its commit, immune to first-parent inversion entirely. Prefer the first form anyway — nothing else that reads first-parent history is immune, and the inversion is invisible in review.

## Merge conflict resolution

If you encounter a merge conflict, resolve it — do not reset or discard. Read both sides of the conflict, understand the intent of each change, and produce a merged result that preserves both. After resolving, run verification to confirm the resolution didn't break anything. If the conflict is too complex to resolve confidently, present both versions to the user and ask which to keep.

## Commit message style

Imperative voice, no Conventional Commit prefixes (`feat:`, `fix:`, `chore:`). Example: `Tighten auto-mode contract and consolidate cross-skill duplications` — not `chore: tighten auto-mode contract`. The repo's commit log is the style reference.

## When commits land in the wrong place

If `git log` shows the commit on an unexpected branch, do NOT try to undo with `git reset` or `git checkout`. Instead:

1. Check `git rev-parse --show-toplevel` and `git branch --show-current` to confirm where you are.
2. If the commit is on the wrong branch but the work is correct, cherry-pick it to the right branch.
3. If the wrong-branch commit must be removed, surface the problem to the user — never silently rewrite history.

## Realigning a diverged local branch to origin (without `git reset`)

If a local branch (e.g. `main`) has diverged from its remote counterpart — commits landed on both sides, so neither is a fast-forward of the other — and you've confirmed (a) the working tree is clean and (b) the local-only commits' content is already fully present upstream (e.g. an equivalent commit was cherry-picked and pushed separately), realign the local ref without `git reset --hard`:

```bash
git checkout --detach HEAD          # move off the branch first — its ref is untouched
git branch -f main origin/main      # force the (now-unchecked-out) branch ref to match origin
git checkout main                   # switch back; branch now matches origin exactly
```

This only discards the *local branch pointer's* view of those superseded commits — nothing is lost, since their content is already safely on origin, and the orphaned commits remain reachable via `git reflog` until GC. Do not use this when the local-only commits contain content that is NOT already present elsewhere — that is exactly the "wipes concurrent work" case the NEVER-`git reset` rule exists to prevent.
