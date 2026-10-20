# Multi-Spec — Parallel Waves (`parallel`, #2677)

Loaded by `multi-spec.md`'s Validation step 4b and its Execution section, only when `/flow` was invoked with the opt-in `parallel` token on a multi-record run. Without that token none of this applies, and a multi-spec run is the sequential run `multi-spec.md` describes, unchanged.

**No-op cases.** In each of these, `parallel` changes nothing: the run is the sequential run, and it prints one note in the form `keep-going` uses for its own no-op ("`parallel` has no effect — {reason}").
- `current-branch` mode: there is no shared worktree for members to branch from or merge back into.
- A run the merge-state gate reduced to a single record: no record can run beside it. (A run naming one record never loads this file; `SKILL.md`'s `parallel` row covers it.)
- `interactive` mode: a wave member is a dispatched agent and cannot prompt, so per-skill prompting rules out a concurrent build. `confirm` and `hybrid` gate only the Manifesto and keep `parallel`.
- A step-list resume (`/flow #12,#13 review`): waves are planned only for a run that starts at `build`, so the resumed steps run sequentially.

## Decision

**Chosen — wave-parallel build and test, sequential everything after.** Mutually independent records build and test concurrently, each in an isolated agent worktree (`Agent` with `isolation: "worktree"`) based at the shared branch's tip. Their branches then merge back into the shared branch one at a time, and review, polish and wrap-up run one record at a time in the shared worktree, exactly as a sequential run does. The run keeps one shared branch, one draft PR, one cumulative phase checklist and one consolidated Review Console.

**Rejected — one shared worktree with parallel builds inside it.** One index and one working tree cannot isolate concurrent work. Concurrent commits contend for `index.lock`: run `2026-10-16T172750-spec-2775-2733-2677` hit that repeatedly, once on a lock left stale for nine minutes (its `spec-2677/decisions.md`). Each spec's test run also sees the other spec's half-written files. Upgrading `groupByFileOverlap` from a warning to a gate prevents overlapping *edits*, but not either of those.

**Rejected — a full pipeline per spec in separate worktrees.** It multiplies PRs, phase checklists and Review Consoles, and the consolidated console would then have to reconcile N branches at the end instead of a single merged one.

**Rejected — ordinary Task agents sent into per-spec worktrees the orchestrator creates.** A dispatch with no `isolation` is cwd-pinned to the dispatcher's worktree (`dispatch/sequential-execution.md`, `_shared/fork-worktree-isolation.md` finding 1), so the working-directory hook denies its commits elsewhere.

The decision is derivable from the DAG and the records' Key Files, so the run never calls `AskUserQuestion` for it, in any mode.

## Waves

Validation step 3's `preflight-records.js` call adds `--waves` when `parallel` is set, and the envelope's `waves.waves` is the plan (`plugin/bin/lib/preflight-records/waves.js`):
- Records are assigned longest-path levels over the in-run `blocked-by` DAG.
- Each level is split so that no two file-overlapping records share a wave. Overlap uses `groupByFileOverlap` with hub paths **not** exempt, because a widely shared file is exactly what conflicts at merge-back.
- A record with no `### Key Files`, or with any bare-directory entry (one ending in `/`), gets a wave of its own, because its independence cannot be proven — `groupByFileOverlap` never bridges directory entries.

**The plan covers the merge-gate's `kept` records only.** Intersect each wave in `waves.waves` with `mergeGate.kept` and drop the waves left empty. A record `--merge-gate` deferred took its in-run dependents out of `kept` with it, so no remaining wave waits on a deferred record.

`waves.parallel: false`, as for a strict linear chain, means every wave has one member, and the run is the sequential run. The same holds when the intersection leaves no wave with two members.

**No plan.** If step 3's call exits 1 (a fetch failed), `parallel` falls back to a sequential run: re-run step 3's call without `--waves`, so the sequential path still gets its records, overlap groups and merge-gate result. That re-run is step 3's single retry (`multispec-preflight-failure.md`); if it also exits non-zero, step 3's STOP applies. Exit 2 (malformed, or a `--waves` dependency cycle) never re-runs: dropping `--waves` cannot fix it, so step 3's STOP applies at once. Once the parent run directory exists after the exit-1 fallback, write one `SKIP` entry (`$PIPELINE_RUN_DIR` is the parent here, as in `multispec-merge-gate.md`):
```
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/flow" --status SKIP --step "Step 1 parallel waves (skipped)" --text "condition: preflight-records.js --waves exited non-zero ({stderr reason}) → fallback: sequential run." --reversibility n/a
```

**"Keep my order."** When Dependency-aware ordering's "Keep my order" option was chosen, the waves still follow the DAG only: a parallel run cannot honor a non-topological manual order. Log one `AUTO` line saying so:
```
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/flow" --status AUTO --step "Step 1 parallel waves" --reversibility high --text "kept manual order #{order…} is not topological; parallel waves follow the dependency DAG instead."
```

## Procedure, per wave, in order

1. **One member** — run that record's pipeline in the shared worktree exactly as a sequential run does, its boundary check and scaffold included. No agent worktree is created.
2. **Several members** — first, serially, in the shared worktree:
   - From wave 2 on, run the boundary freshness check (`multispec-freshness.md`) once for the wave. Wave 1 is covered by the shared worktree's creation-time catch-up, as spec 1 is.
   - For each member in run order: scaffold its `spec-{N}/` (config, decisions — `multispec-config-scaffold.md`), then materialize and commit its spec header on the shared branch (`materialize.md`) — the same per-spec steps a sequential run performs before `/build`. Every member's worktree is created from this tip, so each inherits both.
   - Move each member to `running` (see `spec-status` below).

   Then dispatch one `Agent` call per member, all in one message (`_shared/subagent-dispatch-core.md`'s single-assistant-message rule), each with `isolation: "worktree"`, using the member prompt below. Do NOT `git worktree add` anything: the harness creates `.claude/worktrees/agent-{id}` on branch `worktree-agent-{id}` from the dispatcher's HEAD, which is the shared branch's tip (`_shared/fork-worktree-isolation.md`, finding 2's #2677 re-probe). Each `Agent` result carries `worktreePath` and `worktreeBranch` metadata.
3. **Merge back**, after every member of the wave has returned, one `built-tested` member at a time in run order, from the shared worktree — unless a member of this wave failed and `keep-going` is off, in which case no member merges (Failure handling):
   - Run `git -C {shared-worktree} merge --no-ff {worktreeBranch}`, using the branch named in that `Agent` result's `worktreeBranch` metadata (the member's `BRANCH:` line echoes it).
   - Fold the member's ledger (below), and commit. The fold runs before the worktree is removed, because the member's ledger may live inside it.
   - After a clean merge, run `git worktree remove {worktreePath}`, then `git branch -D {worktreeBranch}`. Never `--force`: if the removal is refused (for example, a dependency install left modified or untracked files), leave the worktree and its branch in place, and name the path in the Pipeline Summary for manual cleanup. Log:
     ```
     node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$MULTISPEC_PARENT_DIR" --section "/flow" --status AUTO --step "Parallel waves merge-back" --reversibility high --text "#{N} merged; git worktree remove refused ({reason}); {worktreePath} and {worktreeBranch} left for manual cleanup."
     ```
   - **On a merge conflict:** run `git merge --abort` to restore the clean tree, run `git worktree remove {worktreePath}`, keep the branch, and re-run that record's build and test sequentially in the shared worktree after the rest of the wave has merged. Before the re-run, rename an unfolded `{parent}/spec-{N}/ledger.md` to `ledger.abandoned.md`, so the re-run starts a fresh active ledger rather than reading the abandoned attempt's rows. A passing re-run supersedes the kept branch, so delete it; a failing one keeps it (Failure handling). A Key Files miss is the expected cause, since Key Files are only a proxy for what a build touches. Log:
     ```
     node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$MULTISPEC_PARENT_DIR" --section "/flow" --status AUTO --step "Parallel waves merge-back" --reversibility high --text "#{N} conflicted at merge-back ({paths}); re-run sequentially."
     ```
   - Once the wave's last member has merged, do the phase exit the members skipped: push the shared branch and flip the PR checklist's `build` row (`_shared/git-discipline.md`'s Phase-exit push section, `_shared/pr-checklist-refresh.md`'s Phase-checklist update section). The `test` row flips at step 4, when review re-runs `/claude-tweaks:test` on the merged tree.
4. **Review, polish and wrap-up** run for each merged member one at a time, in run order, in the shared worktree. Phase-exit pushes go to the shared branch only. A `built-tested` member hands review `TEST_PASSED=true`, as the sequential `test` → `review` hand-off does. **The merged tree's re-verification is load-bearing.** A member's tests passed on its own branch, never on the merged tree. Review's Step 1.5 stamp check (`review/code-mode-steps.md`, "In `/claude-tweaks:flow` pipeline") finds that the runner stamp does not verify the merged HEAD, and it re-triggers `/claude-tweaks:test` there before any review. Never bypass that check for a merged member: it is the only verification the merged tree gets.

**`spec-status` is the orchestrator's alone.** `manifest.yml`'s `transitionSpec` (`plugin/bin/lib/flow/manifest.js`) is an unlocked read-modify-write, so the orchestrator makes every `spec-status` call itself, one at a time, and members never call it. Before dispatch, it moves each member to `running` at `build`. As each member returns, it moves that member to `test`, or to `failed` on `hard-gate-failed`. Review, polish and wrap-up then transition one spec at a time, as in a sequential run.

**Ledger fold.** The shared ledger is the run's active ledger per `_shared/ledger-format.md`'s Location section, resolved in the shared worktree. Read the member's `LEDGER:` line:
- `absent` — nothing to fold, and no mapping line is written.
- Otherwise, read the rows from the path that line names. A member's Write and Edit tools are pinned to its own worktree, so that path may be a copy under `{worktreePath}` rather than `{parent}/spec-{N}/ledger.md`, which is why the fold runs before removal. Append each row with the next free shared item number (that file's Item Numbering). If the number of rows read differs from the line's `{k}`, fold what was read and name the mismatch in the mapping line.

Then move a folded `{parent}/spec-{N}/ledger.md` to `spec-{N}/ledger.folded.md`: left in place, the Location section's resolution rule would keep reading it as that spec's active ledger during its review and wrap-up. Write one mapping line per folded member, so a `#k` that spec's `decisions.md` or `staged/` cites still resolves:
```
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{parent}/spec-{N}" --section "/flow" --status AUTO --step "Parallel waves ledger fold" --reversibility n/a --text "spec-{N} ledger #k → shared #m[; #k2 → shared #m2 …]"
```

## Member prompt (Subagent Contract)

This is a dispatch site under `_shared/subagent-output-contract.md`. Each member is a fresh agent, never `fork`. Resolve its model once per wave with `node "{plugin-root}/bin/resolve-profile.js" capable`, the profile `dispatch/task-prompt.md`'s first `build,test` call uses, and pass `model` explicitly on every `Agent` call.

Inline the block below verbatim, substituting `{N}`, `{parent}`, `{shared-worktree}`, `{stories-step}` and `{context-pack}`. `{stories-step}` carries `SKILL.md`'s Automatic story generation into the member, which would otherwise skip it: with `no-stories` set it is empty; otherwise it is the line `If that build changed a UI file (the trigger list in frontend-detection.md, in the /claude-tweaks:design-wrapper skill's directory), run PIPELINE_RUN_DIR="{parent}/spec-{N}" MULTISPEC_SHARED_WORKTREE=1 MULTISPEC_PARALLEL_WAVE=1 /claude-tweaks:stories next.` `{parent}` is the parent run directory's absolute path, resolved under `$RUN_ROOT` (`_shared/pipeline-run-dir.md`): a relative path would resolve inside the member's own worktree `[IL-127]`. `{context-pack}` is `dispatch/task-prompt.md`'s Context pack items 1 (the literal plugin root), 6 (the worktree shell constraint) and 7 (async-wait discipline, with its `INTERIM_STATUS` rule), plus that file's `build,test` template's Foreground execution clause, all copied verbatim, with item 1 resolved to this session's own plugin root.

```
Task scope: build and test record #{N} as one member of a /claude-tweaks:flow parallel
wave, inside the isolated worktree the harness created for you. Stop after the test gate;
do not run review, polish, or wrap-up. If you reference #{N} in a commit message, write
"refs #{N}" -- never "closes #{N}" or "fixes #{N}".

{context-pack}

Startup (your first act): run `git rev-parse --show-toplevel`. If it fails, or prints
{shared-worktree}, you are not isolated: change nothing, reply with OUTCOME: blocked, and end
with STATUS: BLOCKED. Otherwise run the project's dependency setup the way
/superpowers:using-git-worktrees Step 2 auto-detects it (e.g. `npm install` when
package.json exists).

Then run these invocations, in order:
PIPELINE_RUN_DIR="{parent}/spec-{N}" MULTISPEC_SHARED_WORKTREE=1 MULTISPEC_PARALLEL_WAVE=1 /claude-tweaks:build #{N}
{stories-step}
PIPELINE_RUN_DIR="{parent}/spec-{N}" MULTISPEC_SHARED_WORKTREE=1 MULTISPEC_PARALLEL_WAVE=1 /claude-tweaks:test

Never push, never open or edit a PR, never run `hooks.js record-worktree` or
`hooks.js spec-status`, never run `git stash`. Commit your work in this worktree and leave
the worktree in place -- the orchestrator merges your branch and removes it. Write
open-items ledger rows only to {parent}/spec-{N}/ledger.md. Before replying, run `ls` on that
path and on the same path under your own toplevel; LEDGER names whichever exists.

OUTPUT FORMAT (required) -- return ONLY these lines, no preamble:

MEMBER: #{N}
OUTCOME: built-tested | hard-gate-failed | blocked
WORKTREE: {toplevel path}
BRANCH: {branch}
HEAD: {sha}
LEDGER: {absolute path of the ledger file} ({k} rows) | absent

Status line (required): on its own trailing line, after everything above -- the reply's last
non-empty line -- write exactly `STATUS: {WORD}`, where {WORD} is one of: DONE /
DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
```

The orchestrator routes on `OUTCOME`: `built-tested` merges back, `hard-gate-failed` goes to Failure handling, and `blocked` goes to the Fallback. A reply that still has no parseable `OUTCOME` line after the contract's one re-prompt counts as `blocked`. `OUTCOME` wins over `STATUS` on the route, with two exceptions: `OUTCOME: built-tested` with `STATUS: BLOCKED` or `NEEDS_CONTEXT` counts as `blocked`, and so does a reply from an agent that made zero tool calls (`_shared/subagent-output-contract.md`'s zero-tool-use rule). Neither is ever merged.

## Failure handling

A member that failed its HARD-GATE is never merged. Under `keep-going`, its in-run dependents in later waves are dropped, transitively. Every member worktree that is not merged is removed and its branch kept. The rules are in `multispec-failure-handling.md`'s "Parallel waves" section. Statuses for the console's "Not run / Failed" footer:
- the failed member is `failed`;
- a passing sibling left unmerged by the default stop is `not-run`, with reason `wave sibling #{M} failed — built and tested, not merged`;
- a dropped dependent is `not-run`, with reason `prerequisite #{M} failed`.

Each unmerged member's row names its kept branch as `(branch {name})`. Never `git worktree remove --force`: a worktree that refuses removal (uncommitted changes) stays in place, and its row names the path instead.

**Fallback — never a stop.** A member runs sequentially in the shared worktree after the rest of its wave has merged when any of these happens:
- the harness refuses `isolation: "worktree"`, or the `Agent` call errors before the member starts;
- the `Agent` result carries no `worktreePath`/`worktreeBranch` metadata;
- the member returns `blocked`, for example because its toplevel equals the shared worktree.

Any worktree such a member did leave is removed, and its branch kept, as for a failed member. With no `worktreePath` metadata, take the path from the member's `WORKTREE:` line. If that is missing too, a `.claude/worktrees/agent-*` entry in `git worktree list` that cannot be attributed to this member is left in place and named in the Pipeline Summary. Before the sequential re-run, rename an unfolded `{parent}/spec-{N}/ledger.md` to `ledger.abandoned.md`, as on a merge conflict. Write one `SKIP` entry per member:
```
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$MULTISPEC_PARENT_DIR" --section "/flow" --status SKIP --step "Parallel waves member #{N}" --text "condition: per-spec worktree unavailable ({reason}) → fallback: sequential" --reversibility n/a
```
