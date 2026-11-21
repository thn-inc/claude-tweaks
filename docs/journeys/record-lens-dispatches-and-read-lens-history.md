---
files:
  - plugin/bin/lib/review-lens/dispatch-record.js
  - plugin/bin/lib/review-lens/history.js
  - plugin/bin/review-coordination.js
  - plugin/skills/review/step3-lens-dispatch-record.md
  - tools/step-yield-report.js
---

# Record Lens Dispatches and Read Each Lens's History

**Persona:** a `/claude-tweaks:review` session inside a pipeline run that has just reached a Step 3 lens verdict (or a lens failure) on the Task path or the workflow path, and, later, a maintainer or a future lens selector that wants to know how often each lens has actually found something in this repository.
**Goal:** every agent lens dispatch leaves one entry in the run's `lens-dispatch.json`, and `readLensHistory` turns those entries plus each run's `step-yield.json` into a per-lens confirmed-finding rate over the lens's last 20 closed runs, saying plainly when there is not enough history yet.
**Entry point:** a lens whose verdict or final failure is known, a pipeline run directory (`$PIPELINE_RUN_DIR`), and the main checkout's `.claude-tweaks/pipelines/` root.
**Success state:** `lens-dispatch.json` holds one `{lens, reviewers, path, round, status}` entry per lens per round, written only through the CLI; `readLensHistory` returns `{lenses, skipped, errors}` with all eight lenses, each `insufficient: true` until it has 20 qualifying runs, and nothing it could not read is silently dropped.

## Steps

### 1. Record a lens's dispatch — the review session
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" record-lens-dispatch --run "$PIPELINE_RUN_DIR" --lens {lens} --reviewers {1|2} --path {task|workflow} --status {completed|failed|blocked} --round {n}`
- **Action:** run the call once the lens's verdict or failure is known, with the values `step3-lens-dispatch-record.md` maps from what happened: `completed` when both pair replies were `DONE`/`DONE_WITH_CONCERNS` (or a single-reviewer lens's one reply was usable), `blocked` when either reviewer's final reply was `BLOCKED`/`NEEDS_CONTEXT`, `failed` when the replies never came; `--path workflow` for a lens `settle-lens-replies` settled and for a `single-reviewer` workflow lens whose one reviewer was usable (`--reviewers 1`), `task` otherwise; lens 3h is always `--path task --reviewers 1`.
- **Should feel:** one plain command per lens, recorded whatever any lens-selection policy says, with no hand-written JSON.
- **Should understand:**
  - An identical repeat call is a no-op (`duplicate: true`), so a resumed review cannot double-count a lens.
  - Exit 2 means the call is wrong (fix it, never retry unchanged); exit 3 means the run directory is missing or unanchored, the file is malformed, or the lock is held — re-resolve `$PIPELINE_RUN_DIR` and retry once, then name the unrecorded lens in the review summary. A failed record never blocks the review.
  - Standalone (no run directory) records nothing.
- **Red flags:**
  - A `lens-dispatch.json` with entries no CLI call wrote, or a malformed file silently overwritten.
  - A lens outside `3a`–`3h` (`__proto__`, `unknown`) accepted.

### 2. Read each lens's rate — the maintainer or selector
- **URL:** `require('plugin/bin/lib/review-lens/history.js').readLensHistory({ roots: ['{main-checkout}/.claude-tweaks/pipelines'] })`
- **Action:** call it with the pipelines root(s). It walks each root and its `archive/`, keeps one copy of an archived twin, ignores runs with no dispatch record, and for each lens takes the newest 20 closed runs (by the run id's start time) in which the lens has a `completed`, two-reviewer entry, counting `both` plus tiebreak-confirmed findings from that run's `step-yield.json`.
- **Should feel:** a warm-up, not a verdict: on today's archive every lens reads `runs: 0, insufficient: true`, which tells a selector to run every lens.
- **Should understand:**
  - A run that is not closed (no yield and no clean `run-state.json`, or a live owner) is listed in `skipped` as `run not closed`; a closed run with a missing or malformed yield is listed in `errors`. Neither counts as zero findings.
  - A multi-spec parent where two members dispatched the same lens is skipped for that lens (`multi-member dispatch`), since the parent's yield cannot split findings by member.
  - Failed, blocked and single-reviewer dispatches never qualify; a lens dispatched in several rounds counts once.
- **Red flags:**
  - An unreadable root reported as an empty archive.
  - A lens missing from `lenses`, or a run counted from lexical directory order instead of start time.

### 3. Compare with the maintainer report — the maintainer
- **URL:** `node tools/step-yield-report.js "{main-checkout}/.claude-tweaks/pipelines/archive" --window 20`
- **Action:** read the report's per-lens table, whose `both` and `tb-confirmed` columns sum to the history reader's confirmed count, and the `--window` step table, whose `confirmed` outcome runs come from the same shipped `confirmedCount` and whose window is ordered by the same `startedAtOf` the history reader uses.
- **Should feel:** one definition of "confirmed" and of "most recent" across the shipped reader and the maintainer tool.
- **Should understand:** the report totals findings across the archive; only the history reader knows which runs a lens ran in and found nothing.
- **Red flags:** the report's per-lens table changing bytes for the same archive.

## Origin
- Created during the build of #5998 (Phase 10 of the pipeline economy design), which added `plugin/bin/lib/review-lens/dispatch-record.js`, the `review-coordination.js record-lens-dispatch` verb, `plugin/bin/lib/review-lens/history.js`, and the Step 3 recording prose in `plugin/skills/review/step3-lens-dispatch-record.md`. No caller of `readLensHistory` ships yet; the lens selector is a later Phase 10 record.
- Related journeys: `settle-a-lens-fan-out-in-one-call-5598.md` (the workflow settle call whose settled lenses step 1 records) and `run-review-lenses-through-a-workflow-5599.md` (the workflow path).
