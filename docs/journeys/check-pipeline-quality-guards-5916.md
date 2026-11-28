---
files:
  - tools/pipeline-cost-report.js
  - tools/pipeline-cost-report/guards.js
  - tools/pipeline-cost-report/runs.js
---

# Check the Pipeline Quality Guards Around a Change

**Persona:** a maintainer who has just made the pipeline cheaper, such as a model re-tier, a lighter lane or a smaller review, and has to show that the output did not get worse. They need the same three quality figures for the runs before and after the change, measured the same way, with what could not be read shown beside each figure.
**Goal:** for the last `n` pipeline runs before a split date and the first `n` on or after it, get:
- the share of whole-branch reviews reporting a Critical or Important issue, with the mean count of each per review;
- the share of implementation tasks that passed with no re-review, overall and per first implementer tier;
- the bug records filed within 14 days of a merge that list a file the merge changed, as a count and per merged PR.

**Entry point:** `node tools/pipeline-cost-report.js --section guards --split <YYYY-MM-DD> [--runs <n>]`, run from the main checkout or any of its worktrees.
**Success state:** exit 0 with a two-column table, Before and After, each headed with its run count and date range. Every figure has its unparsed count beside it. The maintainer pastes the table, or the `--json` object, into the change's PR next to the cost figures.

## Steps

### 1. Pick the split and the column size
- **URL:** `node tools/pipeline-cost-report.js --section guards --split 2026-11-19 --runs 20`
- **Action:** choose the date the change landed as `--split`, and how many runs each column should hold (`--runs`, default 20).
- **Should feel:** like one decision, the date, with a sensible default for the rest.
- **Should understand:**
  - Only pipeline runs count toward `n`: a run whose directory name carries `spec-` or `record-`, or one that holds a `timing.json` and whose name does not end in `-standalone`. Release, adhoc and other standalone runs are in neither column.
  - Runs on one date are ordered by full directory name. A column with fewer than `n` runs prints the runs it has and the actual count.
  - `--section guards` without a valid `--split`, or with `--runs 0`, exits 2. `--section all` without `--split` prints `Guards: not run — --split <YYYY-MM-DD> not given.` and still exits 0.
- **Red flags:**
  - A column header whose date range does not straddle the split as expected.
  - A run count far below `n` when the archive holds that many pipeline runs.

### 2. Read the review guard
- **URL:** the `Whole-branch reviews with a Critical or Important issue` row.
- **Action:** compare `{share} of {n}; mean {c} critical, {i} important; {u} unparsed` across the two columns.
- **Should feel:** like reading the reviewer's own verdicts, counted the same way every time, not re-judged.
- **Should understand:**
  - It counts the issues listed under `#### Critical`, `#### Important` and `#### Minor` in each whole-branch review's report, not the merge verdict word. A `None` or `N/A` line counts zero.
  - Unlabelled dispatches count when their description starts with `final review` or contains `whole-branch`, unless it names a fix wave.
  - A report with no severity heading, a missing transcript, or an `API Error` reply is unparsed and left out of the share.
- **Red flags:**
  - An unparsed count close to `n`: the transcript lookup is missing reports.
  - A share moving sharply while `n` is small.

### 3. Read the task first-pass guard
- **URL:** the `Tasks with no re-review` row and the `First implementer tier` table.
- **Action:** compare the share of tasks whose dispatches include no `re-review`, overall and per tier of each task's earliest implementer.
- **Should feel:** attributable. A drop can be traced to the tier that was changed.
- **Should understand:**
  - A task is keyed by run, parent agent, record number and task number, so the same task number in two runs or two records counts twice.
  - Untasked fix-wave dispatches are left out. Another dispatch with no task number, a review group with no implementer, and an ambiguous record-less group in a multi-spec run count as unparsed.
  - The tier is the implementer's, never the reviewer's.
- **Red flags:**
  - A tier row present in one column and missing from the other, read as a regression.

### 4. Read the post-merge bug guard
- **URL:** the `Bug records within 14 days of a merge touching its Key Files` row.
- **Action:** compare `{count} over {mergedPrs} merged PRs ({perPr} per PR); {u} unparsed`.
- **Should feel:** like a lagging signal. The after column's figure keeps growing for 14 days past its last merge.
- **Should understand:**
  - It reads the forge: PRs merged between the column's first and last run date, and `type:bug` records created in that window plus 14 days. A bug counts once, however many merges it matches.
  - A Key Files path matches a PR's changed file exactly, after stripping backticks, a trailing `:line` and a trailing ` — note`. A bug with no `### Key Files` section is unparsed.
  - A forge failure, or an unresolvable repository when `--repo` is absent, shows `unavailable — {first line}` in this row only and exits 1; the other two guards still print.
- **Red flags:**
  - Exit 0 while this row reads `unavailable`.
  - An after column compared at face value less than 14 days after its last merge.

### 5. Check the columns' coverage, then record
- **URL:** `node tools/pipeline-cost-report.js --section guards --split <date> --runs <n> --json`
- **Action:** read each column's `runCount`, `noTiming`, `from` and `to`, then keep the `guards` object beside the change.
- **Should feel:** paste-ready. The JSON holds the same figures as the Markdown, with shares as fractions from 0 to 1.
- **Should understand:**
  - An archived run whose top-level directory kept only `work/` is read from its `archive/` copy. `noTiming` counts the eligible runs with no `timing.json` anywhere; the Markdown header shows it as `K without timing.json`.
- **Red flags:**
  - A `noTiming` close to `runCount`: the column has little to measure.

## Origin
- Created during the build of #5916 (run `2026-11-19T055619-spec-5914-5916-5925`, PR #5928), beside #5914's spend, funnel and records sections (`measure-pipeline-spend-and-the-driver-funnel-5914.md`). #5925 adds review results by role and tier.
