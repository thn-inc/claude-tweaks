---
files:
  - tools/pipeline-cost-report.js
  - tools/pipeline-cost-report/reviews.js
  - tools/pipeline-cost-report/guards.js
  - tools/pipeline-cost-report/runs.js
  - tools/review-replay/archive.js
---

# Read What Each Review Returned, by Role and Tier

**Persona:** a maintainer deciding whether a review seat earns its cost. Typical questions: whether task reviews stay, whether the plan review moves into specify, and which lenses a run needs. They need what the reviews that ran actually returned, re-readable after a change and never re-derived by a scratch script. Each figure shows the count it could not read.
**Goal:** for the runs in a date window, get:
- the task-review verdict shares per model tier;
- what plan reviews find and how often they stop for a human;
- lens findings per agent by tier and by lens;
- per-run lens verdicts and where confirmed findings went;
- each lens's confirmed-per-agent yield over its last `n` runs.

**Entry point:** `node tools/pipeline-cost-report.js --section reviews [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] [--runs <n>] [--json]`, run from the main checkout or any of its worktrees.
**Success state:** exit 0 with the `## Reviews` section, which has these subsections:
- Task review
- Plan review
- Lens review by tier
- Lens review by lens
- Lens verdicts
- Lens outcomes
- Lens yield

Every share prints its denominator and unparsed count. The maintainer quotes the figures, or the `--json` `reviews` object, in the design decision they inform.

## Steps

### 1. Pick the window
- **URL:** `node tools/pipeline-cost-report.js --section reviews --since 2026-11-12 --until 2026-11-18`
- **Action:** choose the run dates to read. `--runs` (default 20) only sets the lens yield.
- **Should feel:** like one decision, the dates. The header says what was read: `{runs} runs dated … ({units} run units …); {k} without a timing.json, {u} with an unreadable one.`
- **Should understand:**
  - A run's date is the leading `YYYY-MM-DD` of its directory name.
  - A multi-spec run counts once per spec member for the decision-log figures. Its dispatch figures are read once, from the parent's `timing.json`.
  - A top-level stub left beside an `archive/` copy is read from the archive.
- **Red flags:**
  - A `without a timing.json` count close to the run count: the window holds little dispatch data.

### 2. Read task review per tier
- **URL:** the `### Task review` table.
- **Action:** compare `Approved` and `Needs fixes` per tier, and the `Minor only` column (`{k} of {needs-fixes}`).
- **Should feel:** side by side, not a ranking. The note under the heading says the capable tier reviews the riskier tasks.
- **Should understand:**
  - The verdict is the report's `**Task quality:**` line, bold or not, with any trailing clause.
  - A report with no verdict line, or a missing transcript, is unparsed and in neither share.
  - Re-reviews are counted on a line below the table, never in it.
- **Red flags:**
  - An unparsed count near the review count: the transcript lookup is missing reports.

### 3. Read plan review
- **URL:** the `### Plan review` lines and the kind table.
- **Action:** read reviews, the share with a finding, findings per review, findings by kind, and `Stopped to ask a human: {k} of {m} run units with a plan review ({r} readable, {u} unparsed)`.
- **Should feel:** like the plan reviewer's own table, counted as written.
- **Should understand:**
  - Kinds are read from the findings table's Class cell, with case and hyphens folded. A kind outside the four known ones is `other`, and so is a `+N more` overflow row.
  - A report with no table counts as zero findings only when it says `No findings`.
  - A stop is a `needs-human` Common Step 1.6 line, interactive or posted to the record. A settled gap is not a stop, and a SKIP-only unit is not a plan review.
- **Red flags:**
  - Reading the stop line as a share of all runs. Its denominator is the run units that had a plan review.

### 4. Read lens findings by tier and by lens
- **URL:** the `### Lens review by tier` and `### Lens review by lens` tables.
- **Action:** compare the no-finding share and findings per agent across the lenses that ran: `3a`..`3g`, plus `3h` (UX analysis) in a run that dispatched it.
- **Should feel:** like a lens comparison. The note says each lens runs on one fixed model profile, so the tier table compares lenses, not models.
- **Should understand:**
  - A lens agent is a timing.json dispatch that review-replay's lens pattern matches, and is counted once per agentId.
  - A report opening `No findings.` and continuing in prose is no-finding. A missing transcript is unparsed.
  - A run whose lens dispatches cannot be read is counted on its own line (`{k} runs with unreadable lens dispatches, counted in no lens figure.`), never as zero agents.
- **Red flags:**
  - A non-zero unreadable-dispatch count: a malformed `timing.json` in the window.

### 5. Read verdicts and outcomes
- **URL:** the `### Lens verdicts` tables and the `### Lens outcomes` lines.
- **Action:** per run unit and per lens, read the confirmed (both reviewers or tiebreak), refuted and can't-tell counts. Then read where confirmed locations went: fixed, dismissed, staged or deferred.
- **Should feel:** traceable. Each figure comes from the decision log's own reproduction and routing lines.
- **Should understand:**
  - "Confirmed" is a judge's verdict or a pair's agreement, not ground truth.
  - A lens name written out (`security`, `3b Security`) counts under its id. Any other name is kept verbatim.
  - Outcome shares are over routed confirmed locations. Unrouted ones are printed beside the shares, not in them.
  - A second line divides by every routed location, refuted ones included, the way the 2026-11-18 measurement did.
  - A run unit with no review line, or with an unreadable log or timing.json, is unparsed, never zero.
- **Red flags:**
  - Comparing the first outcome line with the 2026-11-18 figures. The second line is the comparable one.

### 6. Read the per-lens yield, then record
- **URL:** the `### Lens yield` table, then the same command with `--json`.
- **Action:** read confirmed per agent for each lens over its latest `--runs` runs. Then keep the `reviews` object.
- **Should feel:** stable under the window. The yield ignores `--since` and stops at `--until`.
- **Should understand:**
  - A multi-spec run is one slot, readable only when every member is.
  - A run with no recorded verdict line, a fully clean review included, takes no slot and is counted unparsed.
  - In `--json`, shares are fractions from 0 to 1, and `null` when the denominator is 0. The Markdown prints `none`, never `0%`.
- **Red flags:**
  - A lens with fewer runs than `--runs` while the archive holds more. Its earlier runs may be unparsed.

## Origin
- Created during the build of #5925 (run `2026-11-19T055619-spec-5914-5916-5925`, PR #5928). The sibling sections are #5914's spend, funnel and records (`measure-pipeline-spend-and-the-driver-funnel-5914.md`) and #5916's guards (`check-pipeline-quality-guards-5916.md`).
