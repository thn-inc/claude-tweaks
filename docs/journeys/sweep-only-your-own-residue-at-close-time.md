---
files:
  - plugin/bin/residue.js
  - plugin/bin/lib/residue/probes/pipeline-runs.js
  - plugin/bin/lib/residue/probes/branches.js
  - plugin/bin/lib/residue/probes/worktrees.js
  - plugin/bin/lib/residue/scope-filter.js
  - plugin/skills/wrap-up/residue-sweep.md
---

# Sweep Only Your Own Residue at Close Time

**Persona:** claude-tweaks maintainer (or the `/claude-tweaks:wrap-up` Phase 3 preamble acting for them) closing out one run in a repo where many concurrent sessions leave merged branches and clean-but-unarchived pipeline run dirs behind.
**Goal:** See `bin/residue.js --scope blast-radius` report only the invoking run's own leftovers — and prove a sibling session's clean run dir no longer lands on this run's ledger, while `--scope repo` still surfaces everything for `/tidy`.
**Entry point:** A terminal inside a run's worktree at wrap-up time, with `PIPELINE_RUN_DIR` exported (the pipeline threads it), in a repo whose `.claude-tweaks/pipelines/` holds other sessions' orphans.
**Success state:** The blast-radius sweep's pipeline-run findings name this run's own dir at most; sibling orphans appear only under `--scope repo`.

## Steps

### 1. Run the close-time sweep the wrap-up preamble runs
- **URL:** `node plugin/bin/residue.js --base <merge-base> --integration-branch origin/main --scope blast-radius --no-suite`
- **Action:** Run from inside the run's worktree with `PIPELINE_RUN_DIR` set — exactly `plugin/skills/wrap-up/residue-sweep.md`'s invocation.
- **Should feel:** Quiet — the report is about *this* run's work, not the repo's backlog of other sessions' housekeeping.
- **Should understand:** A `pipeline-run` finding is tagged `blast-radius` only when the CLI can attribute the dir to this invocation — its name equals `basename($PIPELINE_RUN_DIR)`, or its `run-state.json` `worktree` field realpaths to this checkout's toplevel (`probePipelineRuns`'s `isOwnRun`, #1118). Merged branches behave the same way: `probeBranches` tags survivors `observed` (#499). Sibling worktrees are always `observed`, so under `blast-radius` `probeWorktrees` reports `ran: true` with no findings and skips its per-worktree `git status` dirty check entirely — that check cost ~15 s at 60 worktrees and its output was discarded by the scope filter anyway, so the sweep now takes a second or two regardless of worktree count (#3479).
- **Red flags:** Another record's run dir (a different `…-record-N` name, a `worktree` pointing elsewhere) listed in blast-radius output — that is the pre-#1118 defect where record #706's wrap-up drilled on 6 unrelated orphans. A blast-radius sweep whose wall clock grows with `git worktree list` length — the pre-#3479 shape that put the wrap-up pack's residue probe 0.5 s inside its 30 s timeout.

### 2. Prove the sibling orphan is excluded, not lost
- **URL:** `node plugin/bin/residue.js --base <merge-base> --integration-branch origin/main --scope repo --no-suite --json`
- **Action:** Re-run with `--scope repo` (the CLI default) and compare: the sibling's clean run dir and merged branches reappear, tagged `observed`.
- **Should feel:** Reassuring — narrowing the close-time sweep dropped nothing from the repo-wide view.
- **Should understand:** `scope-filter.js` filters only under `blast-radius`; `repo` passes every finding through untouched, and `probeWorktrees` still runs its per-worktree dirty check there, so each sibling worktree's finding keeps its `dirty:` evidence. Cross-session housekeeping is `/tidy`'s job (its Step 4.5 pass runs `--scope repo`), and clean-but-unarchived dirs older than 30 days fall to `/tidy`'s archival compaction — except a dir whose recorded `worktree` is still a locked entry in `git worktree list`, which carries `remedy: record` plus the shared locked-worktree evidence (`lockedEvidence`, reused from `probeWorktrees`) instead of `remedy: auto`, so nothing archives out from under a live sibling session (#1328).
- **Red flags:** A finding present under `blast-radius` but missing under `repo` — structurally impossible if the filter is intact; a sibling's clean run dir whose worktree is still locked offered as `remedy: auto`; a change to *which* findings `--scope repo` reports (as distinct from the `remedy`/`evidence` a single finding carries, which #1328 does change for the locked case).

### 3. Sweep from a context with no run identity
- **URL:** `env -u PIPELINE_RUN_DIR node plugin/bin/residue.js --base <merge-base> --integration-branch origin/main --scope blast-radius --no-suite`
- **Action:** Run without `PIPELINE_RUN_DIR` from a checkout whose toplevel no run-state.json names.
- **Should feel:** Fail-safe — with nothing to attribute against, no pipeline-run finding claims to be yours.
- **Should understand:** Attribution has no guess path: unattributable means `observed`, so an identity-less invocation reports zero pipeline-run findings under `blast-radius` rather than someone else's.
- **Red flags:** Any pipeline-run finding tagged `blast-radius` with neither identity signal available.
