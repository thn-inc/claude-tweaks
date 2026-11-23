---
files:
  - tools/pipeline-cost-report.js
  - tools/pipeline-cost-report/spend.js
  - tools/pipeline-cost-report/funnel.js
  - tools/pipeline-cost-report/records.js
  - tools/pipeline-cost-report/runs.js
  - plugin/bin/lib/timing/transcript.js
  - docs/reference/pipeline-economy-baseline.md
---

# Measure Pipeline Spend and the Driver Funnel

**Persona:** a maintainer deciding whether a pipeline-economy change paid off, such as a model re-tier, wider driver admission, or a limit on what a run may file. They need dollar figures and counts measured the same way before and after, not an estimate rebuilt by hand from transcripts.
**Goal:** get, for one UTC day window, the following figures, each comparable with the committed baseline:
- list-price spend by session type, model, agent kind, prompt size and cache-write cause, plus spend per merged PR;
- how many ready, `auto:build` records the driver would admit, and why the rest are refused;
- how many records were created, closed and deferred.

**Entry point:** `node tools/pipeline-cost-report.js --since <YYYY-MM-DD> --until <YYYY-MM-DD>`, run from the main checkout or any of its worktrees.
**Success state:** exit 0 with every section rendered. The maintainer sets the figures beside `docs/reference/pipeline-economy-baseline.md` and pastes them into the change's PR. Files that could not be read are shown under `unreadable` and never folded into a total.

## Steps

### 1. Price the window — `--section spend`
- **URL:** `node tools/pipeline-cost-report.js --section spend --since <date> --until <date> [--match <substring> | --all-projects] [--projects <dir>]...`
- **Action:**
  - Read the main-session and subagent transcripts under every projects root.
  - Price each model request with the dated price table.
  - Print the totals by session type, model, agent kind, prompt-size bucket and cache-write cause, and per merged PR.
- **Should feel:** scoped and fast. A one-day window takes seconds, because subagent files modified before the window are never opened. The `Match:` line states which transcripts were priced.
- **Should understand:**
  - By default only this repository's sessions are priced: the main checkout and its worktrees. `--match` replaces that with a substring of the working-directory path. `--all-projects` prices every project, which inflates the per-merged-PR figure, because merged PRs are this repository's only.
  - A message is counted once, at the maximum of each usage field across its lines.
  - A Haiku request with a prompt over 100,000 tokens costs five times the base rate.
  - `<synthetic>` lines are not priced and are not a "previous model call" when a cache re-write is classed.
  - A model id with no known family is listed as `unpriced`, never priced at a guessed rate.
- **Red flags:**
  - A per-merged-PR figure far above the baseline with no `--all-projects` passed.
  - A `Match:` line naming a scope you did not ask for.
  - A non-zero `unreadable` count with no file named.

### 2. See what the driver would admit — `--section funnel`
- **URL:** `node tools/pipeline-cost-report.js --section funnel [--simulate <reason[,reason...]>]...`
- **Action:** run `drive.js --check` against every open record labelled `ready` and `auto:build`. Count how many it admits, and tally refusal reasons by their key, so that two `protected path:` refusals for different files share one row. Each `--simulate` set reports how many records would be admitted if those reasons stopped refusing.
- **Should feel:** like a what-if for the admission figures, and a measured count for the two activity figures. The tool only reads: no record or label changes.
- **Should understand:**
  - `checked` counts every listed record, including those whose check failed or printed no verdict. Those are `unreadable`: in `checked`, but in neither `admitted` nor `reasons`.
  - The funnel always asks about the current checkout's repository. A `--repo` that names another repository is refused with exit 2.
  - Besides the admission what-if, the funnel counts the driver's activity over the window, so it also honours `--since`/`--until`, and `--projects`/`--match`/`--all-projects` for the dispatch figure.
  - `Driver runs` counts the run directories holding `driver-events.jsonl`: `dispatch-routed` are those whose manifest says lane `driver` and whose name is not `-drive-N`; the rest are `standalone`. It prints the date of the last one.
  - `Dispatch firings` counts main transcripts whose first claude-tweaks skill is dispatch, how many of them reached the driver route (a Bash call that ran `drive.js --check` or logged the `Driver route (skipped)` decision), and the plugin version each ran, in numeric version order with `unknown` last.
  - When records are admitted yet no run in the window was dispatch-routed, a flag line reads `Admitted records were not driven: ...`. It is not printed when either figure is unavailable.
  - The report's `Unreadable:` total is the sum of each section's own figure, so a transcript that both spend and the funnel could not read counts once per section; each section's own `unreadable` in `--json` does not change with `--section`.
- **Red flags:**
  - `admitted` plus the refused records summing to more than `checked`.
  - A simulation admitting fewer records than `admitted`.
  - `admitted` above zero, no dispatch-routed run listed and no `Admitted records were not driven` line: the flag line should have printed.

### 3. Count what runs filed — `--section records`
- **URL:** `node tools/pipeline-cost-report.js --section records --since <date> --until <date>`
- **Action:** count records created, closed and open in the window, and the deferred ones by reason, from the forge.
- **Should feel:** like a ledger of what the pipeline produced alongside what it cost.
- **Should understand:**
  - A created record counts as deferred when any line of its body contains `Defer-reason:`. Its reason is the first word after the first occurrence.
  - The counts come from the search totals. When fewer bodies come back than the total, the reasons are marked `truncated`.
- **Red flags:**
  - Reasons summing to more than the deferred count.
  - A truncated tally presented as complete.

### 4. Record or compare — `--json` and the baseline
- **URL:** `node tools/pipeline-cost-report.js --section all --since <date> --until <date> --json`
- **Action:** print one JSON object holding every section's figures:
  - `window` (including `match`);
  - `priceTableDate`;
  - the spend, funnel and records sections;
  - `guards`, which reads `{ "skipped": "--split not given" }` unless `--split` is passed (`check-pipeline-quality-guards-5916.md`);
  - `reviews` (`read-review-results-by-role-and-tier-5925.md`);
  - `runs`;
  - `unreadable`.

  Compare it with the committed baseline, or with an earlier run of the same window.
- **Should feel:** paste-ready. The JSON holds the same figures as the Markdown, so a before-and-after diff needs no recomputation.
- **Should understand:**
  - A forge read that fails exits 1, and its section prints `unavailable` with the first error line.
  - A malformed flag exits 2.
  - The price table is dated. A figure measured under a newer table is not comparable at face value.
- **Red flags:**
  - Exit 0 while a section printed `unavailable`. One exception is by design: under `--section all` without `--split`, a pipelines directory that cannot be listed prints `reviews: unavailable —` and `Runs: unavailable` and leaves the code at 0.
  - A `priceTableDate` that differs from the baseline's, with no note beside the comparison.

## Origin
- Created during the build of #5914 (run `2026-11-19T055619-spec-5914-5916-5925`, PR #5928). The first measured baseline is committed at `docs/reference/pipeline-economy-baseline.md`. #5916 adds a `guards` section and #5925 a `reviews` section. #6012 (run `2026-11-21T183551-record-6012`, PR #6028) adds the funnel's driver runs, dispatch firings and not-driven flag line to step 2.
