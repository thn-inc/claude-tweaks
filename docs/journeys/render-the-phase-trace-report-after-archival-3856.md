---
files:
  - plugin/bin/wrap-up-engine.js
  - plugin/bin/lib/wrap-up/engine-verify.js
  - plugin/skills/wrap-up/SKILL.md
---

# Render the Phase-Trace Report After the Run Is Archived

**Persona:** the agent running `/claude-tweaks:wrap-up` Phase 4 for a `/flow` run. It has just finished Execute approved actions, whose cleanup item 8 moved the run directory to `.claude-tweaks/pipelines/archive/{run-id}/`. It still holds only the original `$PIPELINE_RUN_DIR` path.
**Goal:** render the engine's phase-trace table into the wrap-up report using the path it already has, without rebuilding the archive path by hand.
**Entry point:** `node bin/wrap-up-engine.js render --run-dir "$PIPELINE_RUN_DIR" --section trace --strict`, run from the checkout (main or a linked worktree) after cleanup item 8.
**Success state:** the command prints the same table it would have printed before archival, and exits 0 once every worklist row is recorded. The report's Phase 2 table is the engine's own output.

## Steps

### 1. Render with the original run-dir path
- **Action:** The agent runs `render --run-dir {original path} --section trace --strict`. The original path no longer exists, so `render` resolves it through `resolveArchivedRunDir`, the same helper `verify` uses. That helper keys on the repo root from the cwd and checks `archive/{basename}`, or `archive/{parent}/spec-{N}` for a per-spec run. It then reads `engine-state.json` from the archived copy.
- **Should feel:** Uneventful. The same command works before and after archival, so the agent has no extra path to compute.
- **Should understand:** `render` and `verify` now accept the same `--run-dir` and find the same directory. A run dir that still exists is read in place, exactly as before.
- **Red flags:** `wrap-up-engine.js render: could not read engine-state.json from {original path}` for a run whose archived copy exists under `.claude-tweaks/pipelines/archive/{run-id}/`.

### 2. A run found in neither place fails loudly, naming the given path
- **Action:** When the run is neither at the given path nor in the archive, `render` reads the given path. It exits 2 with `could not read engine-state.json from {given path}: …`, the same error as before the fallback existed.
- **Should feel:** Diagnosable. The error names the argument the agent passed.
- **Should understand:** `--strict` still prints the table before exiting 2 when a worklist row has no recorded result. The archive fallback changes where the state is read from. It changes nothing about which rows count as holes.
- **Red flags:** An empty stdout with exit 0 for a run dir that does not exist anywhere. A stack trace instead of the one-line error.

## Origin
- Created during build of #3856 (wrap-up-engine render: resolve an archived run directory like verify does)
- Steps 1-2 built in this session; it replaces the `wrap-up/SKILL.md` sentence that told the agent to pass the archive path itself (#3672's workaround)
- Related journeys: `verify-wrap-ups-closure-checklist-900.md` (the `verify` verb whose archive lookup `render` now shares)
