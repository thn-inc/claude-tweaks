---
files:
  - plugin/bin/lib/timing/turn-class.js
  - plugin/bin/lib/timing/transcript.js
  - plugin/bin/lib/timing/derive.js
  - plugin/bin/lib/timing/budget.js
  - plugin/bin/phase-timing.js
  - plugin/bin/lib/policy-schema.js
  - plugin/skills/_shared/policy-schema-efficiency-budgets.md
  - plugin/skills/_shared/timing-render.md
  - plugin/skills/wrap-up/SKILL.md
  - tools/efficiency-report.js
---

# See Where a Run's Turns Went, and Catch Budget Regressions

**Persona:** the maintainer who wants to know whether a run's tool calls went to the work (edits, reads, exploration) or to ceremony (procedure reads, bookkeeping, orientation, guard refusals), and who wants a growing per-run cost to be flagged by the pipeline instead of found later with ad hoc transcript scripts.
**Goal:** read a turn-class breakdown, context-size percentiles, model mix and subagent count for every run, have wrap-up compare the run against its ceremony profile's efficiency budget, and see weekly medians across the archive.
**Entry point:** the Timing command the summary templates already run — `node "${CLAUDE_PLUGIN_ROOT}/bin/phase-timing.js" --run "$PIPELINE_RUN_DIR" --markdown --auto-transcript` — against a run whose transcript can be found.
**Success state:**
- Below the phase table's Tokens footnote, two lines read `Turn classes (tool calls): … — ceremony share {n}%` and `Context per turn: p50 {k}k · p90 {k}k tokens over {n} turn(s) · models: … · subagents: {n}`.
- `timing.json` carries `turnClasses`, `context`, `modelMix`, `subagents` and `ceremonyShare` per phase and in `totals`, plus `totals.verifyMinutes`.
- At wrap-up a `Budget ({profile}): …` line names every metric's value, ceiling and status.
- A breach reaches the Review Console's Queue writes section as one record proposal per profile.
- `node tools/efficiency-report.js` prints a headline of medians plus per-profile and per-week tables.

## Steps

### 1. Read the turn-class and context lines
- **URL:** the two lines under the Timing table's Tokens footnote
- **Action:** Read the ten class counts (always in the same order, so two runs compare column by column) and the ceremony share.
- **Should feel:** A one-glance answer to "how much of this run was overhead?", in counts rather than impressions.
- **Should understand:**
  - Classes count tool calls, not round trips. One user row answering three batched calls adds three.
  - There are ten classes: `edit`, `read`, `explore`, `procedure`, `bookkeeping`, `orientation`, `verify`, `guard-refusal`, `dispatch`, `other`. Every call lands in exactly one.
  - Ceremony share is `procedure + bookkeeping + orientation + guard-refusal` over all calls, rounded from the integer counts.
  - A `Read` of a skill file is `procedure`, not `read`. A refused call is `guard-refusal` whatever tool it was.
  - Context per turn is input plus cache-read plus cache-create tokens on each turn-start row, nearest-rank p50/p90. `subagents` is the `dispatch` count.
  - The summaries paste both lines verbatim, as `_shared/timing-render.md` says. A run whose transcript was not found prints neither.
- **Red flags:**
  - A large `other` count: a common Bash shape the classifier does not recognize yet.
  - Class counts summing to more than the run's tool calls: the transcript's `api-request-blob` snapshot lines were counted, and they must be skipped.

### 2. Find the phase that spent it
- **URL:** `{run-dir}/timing.json`, each phase's `turnClasses` and `context`
- **Action:** Compare a phase's ceremony classes against its `edit`/`read` counts.
- **Should feel:** The overhead has an address, such as "plan read 40 procedure files", not a run-wide average.
- **Should understand:** Rows join phases the same way tokens do, to the innermost phase containing the timestamp. `totals.verifyMinutes` is the summed duration of the run's recorded verify runs, the value the verify-minutes budget reads.
- **Red flags:** Every count on one phase and zeros elsewhere: the run's `events.jsonl` phase windows are missing or collapsed.

### 3. Let wrap-up check the budget
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/phase-timing.js" --run "$PIPELINE_RUN_DIR" --auto-transcript --check-budgets`, run once by wrap-up Phase 3
- **Action:** Read the `Budget ({profile}): round-trips {v}/{c} {status} · procedure-kb … · verify-minutes …` line. Then read the Review Console's Queue writes section.
- **Should feel:** An over-budget run is flagged without stopping anything. The check never blocks and always exits 0.
- **Should understand:**
  - The profile is the run's `ceremony-profile` from `config.yml`, either `fast-lane` or `standard`.
  - A breach stages `staged/efficiency-budget-{run-id}.md`: a record proposal titled `Efficiency budget: {profile} runs over the {metrics} ceiling`, with the work fingerprint `efficiency-budget:{profile}`.
  - When an open record already carries that fingerprint, nothing is staged and `decisions.md` gets an `AUTO` line naming the record. The defaults are p90 ceilings, which breach about one run in five, so one record per profile collects them.
  - A multi-spec run's `spec-N` directory stages one item into the parent run dir.
  - Metrics with no transcript data are `unmeasured`, never `ok`, and the CLI writes its own `SKIP` line for them.
- **Red flags:**
  - A `BREACH` cell with neither a staged file nor an `AUTO … already tracked` line in `decisions.md`: look for the CLI's `SKIP` line and `budget.stageError`.
  - A new backlog record per breaching run: the open-record lookup stopped matching the fingerprint.

### 4. Tune or disable a ceiling
- **URL:** `.claude-tweaks/policy.yml`
- **Action:** Set `{fast-lane|standard}-run-{round-trip|procedure-kb|verify-minutes}-ceiling` to an integer.
- **Should feel:** Six flat keys, each with a measured default and a written derivation.
- **Should understand:** `0` disables that budget, and its cell then reads `disabled`. The defaults (fast-lane 420 / 560 / 21, standard 900 / 580 / 37) are the archive's per-profile p90 rounded up. `_shared/policy-schema-efficiency-budgets.md` shows the derivation.
- **Red flags:** Raising a ceiling to silence a breach without reading the staged record. The record names the run's top three turn classes so the cause can be judged first.

### 5. Watch the trend across runs
- **URL:** `node tools/efficiency-report.js` (maintainer-side; `--archive <dir>` or `--json` optional)
- **Action:** Read the headline medians, then the per-profile and per-ISO-week tables.
- **Should feel:** A regression like "procedure bytes grew four times in six weeks" shows up as a weekly column, not as an investigation.
- **Should understand:**
  - It reads only `{archive}/{run-id}/timing.json`, defaulting to the main checkout's `.claude-tweaks/pipelines/archive`.
  - Runs archived before #4029 have minutes and round trips but no turn classes.
  - On the 143-run archive behind #4029's analysis the headline reads 79 minutes and 407 round trips. The figures move as runs are archived.
- **Red flags:** A non-zero `skipped` count in the headline: an archived `timing.json` was unreadable or malformed, and that run is missing from every median.

## Origin

Built by #4029 (run `2026-10-24T193455-record-4029`). It extends the per-phase token axis from `see-which-phase-spent-the-tokens-1929.md`.
