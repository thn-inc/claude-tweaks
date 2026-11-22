---
files:
  - plugin/bin/lib/timing/step-yield.js
  - plugin/bin/lib/timing/pair-lines.js
  - plugin/bin/lib/timing/at-close.js
  - plugin/bin/lib/timing/derive.js
  - plugin/bin/lib/timing/run-timing.js
  - tools/step-yield-report.js
  - docs/reference/step-yield.md
---

# Read What Each Step of a Run Cost and Produced

**Persona:** the maintainer deciding whether `/claude-tweaks:review`'s paired reviewers earn their tokens, who until now answered that by writing a one-off grep over `decisions.md`. The dispatch scoreboard is a second reader: it reads the same file as a contract and must never see a guessed number.
**Goal:** open one file per closed run that joins each step's cost (minutes, tokens, agents) with what the step produced (commits, verify runs, decision lines by status, questions and their wait, and review findings by pair outcome and tiebreak result). Then total the same numbers across the whole archive with one command.
**Entry point:** a run directory that has been closed (`hooks.js close-run`, teardown, or archive), or a pipelines root holding many of them.
**Success state:** `{run-dir}/step-yield.json` exists beside `timing.json`, and `steps[]` is in phase order. The review step carries per-lens `raised` / `both` / `one` and tiebreak counts. Every unrecognised line sits under `unparsed` with up to five samples. `node tools/step-yield-report.js <pipelines-root> [--json]` prints archive totals and the review-step unparsed share, and `--runs [--window N] [--lane-floor M]` adds per-run rows and per-lane step tables.

## Steps

### 1. Close a run and find the yield beside the timing
- **URL:** `{run-dir}/step-yield.json`
- **Action:** Close a run the usual way. The close writes `step-yield.json` in the same pass that writes `timing.json`, as a temporary file and then a rename. Open it.
- **Should feel:** Nothing extra to run, and no new failure mode at close time.
- **Should understand:** The file is derived data, rewritten whole on every close. A failure to write it never fails or stalls the close. Any failure logs exactly one `SKIP` line. When the close's own time bound runs out, its single timing `SKIP` line gains `; no step-yield.json written`. A multi-spec `spec-N` child dir gets none; the parent's yield reads every `spec-*/decisions.md`.
- **Red flags:**
  - A `step-yield.json` inside an archived dir's vacated original path. The write should have followed the archive twin.
  - Two `SKIP` lines for one close.

### 2. Read one step's cost against its output
- **URL:** `steps[i]` in `step-yield.json`
- **Action:** Compare `minutes` and `tokens` with `commits`, `verify.runs`, and `decisions` (counts by status) for the same step.
- **Should feel:** One row per phase where cost and output can be read side by side, with no join to write.
- **Should understand:** Cost fields with no source are `null`, never `0`. A run with no `timing.json` still gets its steps, with only the cost fields null. Lines, events and questions go to the innermost phase span that `derivePhases` computed. An instant exactly at a span's end, such as the merge commit, belongs to the span ending there. Anything outside every span lands in `unattributed`.
- **Red flags:**
  - `tokens: 0` on a run whose transcript was never found. It should be `null`.
  - A merge commit counted under `unattributed.commits`.

### 3. Read the review's findings and tiebreaks per lens
- **URL:** the `review` entry's `review.byLens` and `review.total`
- **Action:** Read how many findings each lens raised, how many both paired reviewers reported, how many one reviewer reported, and the tiebreak results by verdict (`confirmed`, `refuted`, `cant-tell`) and by outcome (`confirmed`, `drop`, `digest`, `console`, `none`).
- **Should feel:** The question "did the second reviewer add anything?" has a number per lens.
- **Should understand:** Each pair-line form adds to exactly one counter, and the mapping table is in `docs/reference/step-yield.md`. A pair line is read only under a writer label measured in the archive. A quoted or carried-forward copy of a pair line (a wrap-up carry, a routing note) is not counted again. A vacuity downgrade relabels a finding and adds no new one.
- **Red flags:** A `both` count higher than `raised`. Lines that should have been pair lines piling up in `unparsed.samples`, which means a template was reworded and its reader pattern was not added.

### 4. See how long each question waited
- **URL:** `steps[i].questions[]`
- **Action:** Read `askedAt`, `answeredAt` and `waitedMinutes` for each question asked during the step.
- **Should feel:** The human wait time a run cost is visible per step, not folded into minutes.
- **Should understand:** Ask time comes from the transcript's tool-use row, recorded into `timing.json`'s `questions` by the token pass. A question with no known ask time, or one asked but never answered, has `waitedMinutes: null`. An unanswered one also has `answeredAt: null`. `askSource` names where the ask time came from.
- **Red flags:** A question visible in the transcript that appears in no step and not in `unattributed.questions`.

### 5. Total the archive
- **URL:** `node tools/step-yield-report.js "<pipelines-root>" [--json]`
- **Action:** Run the report over the pipelines root. It also scans `archive/`. Read the totals, the per-lens table, and the unparsed share.
- **Should feel:** One command answers the question the old grep script answered, using the same reader the close uses, so the two never disagree.
- **Should understand:** A run with no `step-yield.json` is derived in memory and never written under the root. A file whose `schemaVersion` differs from the module's is derived over and counted as `runsFileStale`. A corrupt file is counted as `runsFileUnreadable`. The unparsed share counts review-step decision lines no reader recognised. A second share also includes the `unattributed` bucket, as an upper bound.
- **Red flags:**
  - An unparsed share of 2% or more. AC7's bound is under 2%.
  - `runsFileStale` above zero after a release with no `schemaVersion` bump.

### 6. Compare lanes over a window of recent closed runs
- **URL:** `node tools/step-yield-report.js "<pipelines-root>" --runs --window 100 --lane-floor 20 --json`
- **Action:** Run the report with `--runs`. Read the `runs` rows (run id, `startedAt`, lane, per-step cost and outcome), then `lanes[lane]` for each lane's window and its per-step table: runs the step ran in, confirmed findings, failed verifies, fix commits, and cost medians.
- **Should feel:** The question "how often does this step change the outcome, per lane?" has a rate with its run count beside it, from one command.
- **Should understand:** Runs are ordered by the start time in their run id, not by close time. The lane is `driver` when the run has `driver-events.jsonl`, `express` when a proceed entry has no later escalation of the same record, otherwise `config.yml`'s `ceremony-profile`, otherwise `none`. A lane with fewer than `--lane-floor` runs in the window widens to its own most recent runs. A lane with fewer than that in the whole archive is marked `belowFloor`. A cost with no source is `null`, never summed into `0`, and `driverUnparsed` counts malformed driver lines. Without `--runs`, `--window` or `--lane-floor` the output is exactly what step 5 prints.
- **Red flags:**
  - A token median of `0` read as "this step is free". It is `timing.json`'s per-phase attribution.
  - A rate quoted for a `belowFloor` lane.

## Origin

Record #5556 (step yield per closed run), PR #5684. Step 6: record #5580 (standard-lane run graph design), PR #5834.
