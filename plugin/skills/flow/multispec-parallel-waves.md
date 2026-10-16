# Multi-Spec — Parallel Waves (`parallel`, #2677)

Loaded by `multi-spec.md`'s Validation step 4b and its Execution section, only when `/flow` was invoked with the opt-in `parallel` token on a multi-record run. Without that token none of this applies, and a multi-spec run is the sequential run `multi-spec.md` describes, unchanged.

## Decision

**Chosen — wave-parallel build and test, sequential everything after.** Mutually independent records build and test concurrently, each in its own per-spec worktree branched from the shared branch's tip. Their branches then merge back into the shared branch one at a time, and review, polish and wrap-up run one record at a time in the shared worktree, exactly as a sequential run does. The run keeps one shared branch, one draft PR, one cumulative phase checklist and one consolidated Review Console.

**Rejected — one shared worktree with parallel builds inside it.** One index and one working tree cannot isolate concurrent work. Concurrent commits contend for `index.lock`, and one run that motivated this decision hit that repeatedly, once on a lock left stale for nine minutes. Each spec's test run also sees the other spec's half-written files. Upgrading `groupByFileOverlap` from a warning to a gate prevents overlapping *edits*, but not either of those.

**Rejected — a full pipeline per spec in separate worktrees.** It multiplies PRs, phase checklists and Review Consoles, and the consolidated console would then have to reconcile N branches at the end instead of a single merged one.

The decision is derivable from the DAG and the records' Key Files, so the run never calls `AskUserQuestion` for it, in any mode.

## Waves

Validation step 3's `preflight-records.js` call adds `--waves` when `parallel` is set, and the envelope's `waves.waves` is the plan (`plugin/bin/lib/preflight-records/waves.js`):
- Records are assigned longest-path levels over the in-run `blocked-by` DAG.
- Each level is split so that no two file-overlapping records share a wave. Overlap uses `groupByFileOverlap` with hub paths **not** exempt, because a widely shared file is exactly what conflicts at merge-back.
- A record with no `### Key Files`, or with any bare-directory entry (one ending in `/`), gets a wave of its own, because its independence cannot be proven — `groupByFileOverlap` never bridges directory entries.

`waves.parallel: false`, as for a strict linear chain, means every wave has one member, and the run is the sequential run.

## Procedure, per wave, in order

1. **One member** — run that record's pipeline in the shared worktree exactly as a sequential run does. No per-spec worktree is created.
2. **Several members:**
   - For each member, create a per-spec worktree on a new branch `{shared-branch}-spec-{N}`, based on the shared branch's current tip. Use `_shared/worktree-setup.md`'s adopt-or-create naming. Never `record-worktree` it: the run's worktree stamp stays the shared one.
   - Dispatch one Task agent per member, all in one message. Each agent runs `/claude-tweaks:build #{N}` then `/claude-tweaks:test` inside its own worktree, with `PIPELINE_RUN_DIR` = `{parent}/spec-{N}/`, `MULTISPEC_SHARED_WORKTREE=1` and `MULTISPEC_PARALLEL_WAVE=1`. It writes its open-items rows to `spec-{N}/ledger.md` (the run-dir-scoped ledger, `_shared/ledger-format.md`'s Location rule) rather than the shared `docs/plans/` ledger, and never pushes.
   - Each member's `spec-status` transitions are its own, so several specs can be `running` at once.
3. **Merge back, one member at a time in run order**, from the shared worktree:
   - Run `git -C {shared-worktree} merge --no-ff {shared-branch}-spec-{N}`.
   - Then fold `spec-{N}/ledger.md`'s rows into the shared ledger, renumbering them, and commit.
   - Then remove that per-spec worktree and delete its branch.
   - **On a merge conflict:** run `git merge --abort` to restore the clean tree, keep the member's branch, and re-run that record's build and test sequentially in the shared worktree after the rest of the wave has merged. Log `AUTO {time} — Parallel waves: #{N} conflicted at merge-back ({paths}); re-run sequentially. Reversibility: high.` via `log-decision.js`. A Key Files miss is the expected cause, since Key Files are only a proxy for what a build touches.
4. **Review, polish and wrap-up** run for each merged member one at a time, in run order, in the shared worktree. Phase-exit pushes go to the shared branch only.

**Fallback — never a stop.** If a per-spec worktree cannot be created, or the session's worktree guard refuses work in it, that member runs sequentially in the shared worktree instead. Write one `SKIP` entry (`condition: per-spec worktree unavailable ({reason}) → fallback: sequential`).
