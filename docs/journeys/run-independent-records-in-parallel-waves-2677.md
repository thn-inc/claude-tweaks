---
files:
  - plugin/bin/lib/preflight-records/waves.js
  - plugin/bin/preflight-records.js
  - plugin/skills/flow/multispec-parallel-waves.md
  - plugin/skills/flow/multispec-preflight-failure.md
  - plugin/skills/flow/multi-spec.md
  - plugin/skills/flow/multispec-failure-handling.md
  - plugin/skills/build/worktree-setup.md
---

# Run Independent Records in Parallel Waves

**Persona:** a maintainer/operator running `/claude-tweaks:flow #A,#B,#C parallel` on a multi-record batch in default `auto` mode. Several of the batch's records share only a common upstream prerequisite, not each other, and the operator wants them built side by side instead of paying each record's full build and test time one after another.
**Goal:** get the mutually independent records built and tested concurrently, while dependency order, the single shared branch, the single draft PR, and the single consolidated Review Console all stay exactly as in a sequential run.
**Entry point:** `/flow`'s multi-spec Validation step 4b (`multi-spec.md`), which only applies when the `parallel` token is present.
**Success state:** each multi-member wave's records build and test in their own isolated agent worktrees at the same time. Their branches merge back into the shared branch one at a time, then review, polish and wrap-up run per record in the shared worktree. The run ends at one Review Console on one PR, with no `AskUserQuestion` about concurrency.

## Steps

### 1. Opt in, or don't — the default stays sequential
- **URL:** `plugin/skills/flow/SKILL.md` Arguments table (`parallel` row) and `## Syntax`
- **Action:** The operator appends `parallel` to a multi-record `/flow` invocation (e.g. `/claude-tweaks:flow #12,#13,#14 parallel`). Without it, nothing in this journey happens, and the run is the sequential multi-spec run.
- **Should feel:** Explicit and low-risk — one token, discoverable in the argument hint, that changes nothing unless typed.
- **Should understand:** `parallel` is a no-op, with one printed note, under `current-branch` mode, under `interactive` mode (a wave member is a dispatched agent and cannot prompt; `confirm` and `hybrid` keep `parallel`), for a single-record run (including one the merge-state gate reduced to one record), and for a step-list resume.
- **Red flags:** Any behavior change in a run invoked without `parallel`. `parallel` absent from the argument hint, so the operator can't find it.

### 2. Pre-flight plans the waves — Validation steps 3 and 4b
- **URL:** `plugin/skills/flow/multispec-parallel-waves.md` "Waves"
- **Action:** `/flow` adds `--waves` to the existing `preflight-records.js` call. The envelope's `waves.waves` gives ordered waves: longest-path levels over the in-run `blocked-by` DAG, each split so that no two records sharing a Key Files path share a wave. The plan is then intersected with the merge-gate's `kept` records.
- **Should feel:** Invisible — the plan rides the pre-flight call that already ran, and needs no question.
- **Should understand:** A strict linear chain plans only singleton waves, so the run is unchanged. A record with no Key Files, or with a bare-directory entry like `tests/`, gets a wave of its own because its independence can't be proven. If the call exits 1, the run re-runs it once without `--waves` (that is step 3's single retry), falls back to sequential, and logs one `SKIP` line. Exit 2, a `--waves` dependency cycle included, is a STOP before claiming, never a sequential fallback (`multispec-preflight-failure.md`). Under `work-links: native` with no `gh`, the wave plan is built from body-text `blocked-by` only, so a native-only link can't keep two records out of the same wave; Step 3's `SKIP` line says so.
- **Red flags:** Two records sharing a Key Files file in one wave. A dependent in the same wave as, or earlier than, its blocker. An exit-1 fallback with no `SKIP` line. A `--waves` cycle that drops to a sequential run instead of stopping.

### 3. A multi-member wave builds and tests concurrently
- **URL:** `plugin/skills/flow/multispec-parallel-waves.md` "Procedure, per wave", step 2 and "Member prompt"; the `MULTISPEC_PARALLEL_WAVE` skips in `plugin/skills/build/worktree-setup.md` (Step 4.5 and Step 6)
- **Action:** First, serially in the shared worktree, the orchestrator runs the wave's boundary freshness check, scaffolds and materializes each member's spec, and moves each member to `running`. It then dispatches one `Agent` per member in a single message, each with `isolation: "worktree"`. The harness roots each **member agent** in its own `.claude/worktrees/agent-{id}` on branch `worktree-agent-{id}`, based at the shared branch's tip. Each member runs `/claude-tweaks:build` then `/claude-tweaks:test` under `MULTISPEC_PARALLEL_WAVE=1`.
- **Should feel:** Like real parallelism — the wave's wall-clock is bounded by its slowest member, not their sum.
- **Should understand:** Under the marker, members never restamp the run's worktree, never open a PR or push, and never flip PR checklist rows. Each returns a fixed `MEMBER`/`OUTCOME`/`BRANCH`/`HEAD`/`LEDGER` block plus a trailing `STATUS:` line.
- **Red flags:** A member whose toplevel is the shared worktree, which must return `blocked` and run sequentially instead. Commits from two members landing in the shared worktree's index. A member calling `spec-status` itself.

### 4. Merge back one member at a time
- **URL:** `plugin/skills/flow/multispec-parallel-waves.md` "Procedure, per wave", step 3 and "Ledger fold"
- **Action:** After every member has returned, the orchestrator first stops any dev server a member recorded at `{parent}/spec-{N}/ephemeral-server.txt` (wrap-up Section D steps 2-4), since members run without `MULTISPEC_PARENT_DIR` and their servers never reach the shared server record. It then merges each `built-tested` member's `worktreeBranch` into the shared branch with `git merge --no-ff`, in run order. It folds that member's `spec-{N}/ledger.md` rows into the shared ledger, then removes the member worktree and deletes its branch. On a merge conflict it aborts the merge and re-runs that record's build and test sequentially, logging one `AUTO` line.
- **Should feel:** Mechanical and quiet — a conflict costs a sequential re-run, never a question.
- **Should understand:** Key Files are only a proxy for what a build touches, so a merge-back conflict is the expected signal of a Key Files miss, not a run failure.
- **Red flags:** A member's ledger rows missing from the shared ledger after the fold. The fold must read the path the member's `LEDGER:` line names, which may be a copy inside its worktree because Write and Edit are pinned there, and it must run before that worktree is removed. A row count that differs from the line's `{k}` with no mismatch named in the mapping line. An `agent-*` worktree or `worktree-agent-*` branch left behind after a clean merge with no Pipeline Summary line naming it for manual cleanup. A member worktree removed while the pid in its `spec-{N}/ephemeral-server.txt` still answers.

### 5. Review, polish and wrap-up run sequentially on the merged tree
- **URL:** `plugin/skills/flow/multispec-parallel-waves.md` "Procedure, per wave", step 4; `review/code-mode-steps.md` Step 1.5
- **Action:** Each merged member runs review, polish and wrap-up one at a time in the shared worktree, exactly as in a sequential run. Review's stamp check sees that the member's test stamp doesn't verify the merged HEAD, and re-runs `/claude-tweaks:test` on the merged tree first.
- **Should feel:** Familiar — from here on the run looks like any multi-spec run, ending at one consolidated Review Console on the one draft PR.
- **Should understand:** That re-verification is the only test run the merged tree ever gets. It is load-bearing and must never be bypassed.
- **Red flags:** A review on a merged member with no fresh `/test` run on the merged HEAD. More than one PR or Review Console for the run.

### 6. When a member fails, its dependents don't build on a missing prerequisite
- **URL:** `plugin/skills/flow/multispec-failure-handling.md` "Parallel waves"; the console's "Not run / Failed" footer
- **Action:** A member that fails its HARD-GATE is never merged. Without `keep-going`, the run stops at the wave boundary. Siblings that passed aren't merged; their worktrees are removed and their branches kept. With `keep-going`, the passing siblings merge, and the failed member's in-run dependents in later waves are dropped, transitively.
- **Should feel:** Safe — nothing ever builds against a prerequisite that never reached the shared branch.
- **Should understand:** The footer names each unmerged member's kept branch as `(branch {name})`, so its work can be picked up later.
- **Red flags:** A dependent of a failed member building in a later wave. An unmerged member's branch deleted, or never named in the footer. `git worktree remove --force`.

## Origin
- Created during #2677's build (multi-spec run 2026-10-16T172750-spec-2775-2733-2677): `waves.js`, `preflight-records.js --waves`, `multispec-parallel-waves.md`, and the `MULTISPEC_PARALLEL_WAVE` consumers in build/test/ledger-format.
- Evidence: the controller's concurrency repro (`spec-2677/decisions.md`, "AC2 concurrency repro"). Two isolated agents dispatched in one message overlapped by 5.58s on branches from the shared tip, and their branches merged cleanly.
- Related: `run-a-batch-whose-record-needs-a-merged-prerequisite-2733.md` (the merge-state gate whose `kept` set the waves are intersected with).
- Updated during #3351's build (run 2026-10-17T095806-spec-3351): step 2's fallback now covers exit 1 only; exit 2 and a `--waves` cycle stop at Step 3 (`multispec-preflight-failure.md`, `handle-a-failed-multispec-preflight-3351.md`).
