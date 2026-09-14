# Git Discipline

Canonical git rules for skills that commit code. Referenced from `/build`, `/review`, `/wrap-up`, `/simplify`, `/journeys`, and any other skill that runs `git commit`.

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
| **NEVER force push** | Rewrites shared history. If an alternative to plain `--force` is truly unavoidable, use `--force-with-lease` so the push aborts on unexpected remote movement instead of clobbering it. |
| **Push commits promptly** | Local-only commits are vulnerable to loss. |
| **Stage specific files only** | Never `git add -A` or `git add .`. |
| **Verify commits landed** | Always `git log --oneline -3` after committing. |
| **Never `--no-verify` / `--no-gpg-sign`** | Skipping hooks or signing bypasses safety the user opted into. If a hook fails, fix the underlying issue. |

## Phase-exit push (`integration-model: pr-first` only)

Under `pr-first` (`_shared/integration-model.md`), every pipeline phase that commits — build,
test, review, polish, wrap-up — ends by pushing the branch: `git -C "{worktree-path}" push
origin {branch}`, its own Bash call, never chained onto anything else (same reason as every
other push in this file — the `worktree-always` gate denies a compound command whole). This is
what makes the run's draft PR (`_shared/pr-early-run-lifecycle.md`) show live progress instead
of only the state as of run start, and what keeps the branch durable at every phase boundary
rather than only at finish — see `docs/incident-log.md`'s `[IL-128]` for what "only pushed once,
at the very end" costs when a session never reaches the end.

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
Common Step 7's documented conditional action — write one `SKIP` entry per
`_shared/auto-decision-log.md`'s degrade-trace rule (the existing failure-degrade warning above is
unaffected — that already logs on a genuine push failure, a distinct case from this clean no-op):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP \
  --section "/build" --step "Common Step 7 phase-exit push (skipped)" \
  --text "condition: integration-model=local-merge or current-branch mode → fallback: no phase-exit push, one push at finish" --reversibility n/a
```

Standalone `/build` (no run dir): list the skip in the Step 7 handoff instead (`build/handoff-template.md`'s inline-skip listing).

## Catching a branch up with `main`

A long-running branch has to be realigned with `main` before it merges (`[IL-20]`), and there are two ways to do it. They are not equivalent, and the difference outlives the branch:

- **Rebase onto `main`**, or merge and then let `main` fast-forward. `main`'s first-parent chain stays a straight line of what it actually carried. **Prefer this.**
- **Merge `main` into the branch, then push the branch as `main`.** This *inverts* the topology: the resulting merge's first parent is the branch, its second is the old `main`, so everything `main` carried between the fork point and the merge leaves the first-parent chain permanently.

The second form is not wrong as history — nothing is lost, and `git log` still shows every commit. What it destroys is any tool that reads `--first-parent` as "what `main` reported over time", and it destroys it retroactively and invisibly: the same query answers differently before and after, and versions *leave* the reconstructed set as later merges land (#144, `[IL-95]`). Two releases were written up as never-shipped on that evidence.

`docs/shipped-versions.tsv` now records the release history directly, so a single inverted merge no longer loses a version. Prefer the first form anyway — the record survives it, but nothing else that reads first-parent history does, and the inversion is invisible in review.

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
