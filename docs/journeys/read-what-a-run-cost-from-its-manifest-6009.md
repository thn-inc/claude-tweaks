---
files:
  - plugin/bin/lib/run-manifest/cost.js
  - plugin/bin/lib/run-manifest/write.js
  - plugin/bin/lib/timing/at-close.js
  - plugin/bin/lib/pricing/prices.js
  - plugin/bin/lib/driver/judgments.js
  - plugin/bin/lib/driver/acceptance.js
  - tools/pipeline-cost-report/spend.js
  - docs/reference/run-manifest.md
  - tests/bin-lib/run-manifest/cost.test.js
  - tests/bin-lib/run-manifest/write.test.js
  - tests/bin-lib/timing/at-close.test.js
---

# Read What a Run Cost From Its Manifest

**Persona:** the claude-tweaks maintainer comparing what pipeline runs cost and how long they took, across lanes and plugin versions. A second persona is the Dispatch tooling that copies a closed run's manifest into its records.
**Goal:** answer "what did this run cost, in which models, and how long did it take?" from the run's own `manifest.json`, and know whether that figure is complete, partial or unknown.
**Entry point:** a closed run directory under `.claude-tweaks/pipelines/` (or its `archive/` twin), after `hooks.js close-run`, `teardown-run`, the reconciler's archive, or the detached token pass has run.
**Success state:** the run's `tokensByModel`, `costUsd`, `priceDate`, `unpricedModels`, `costPartial`, `minutes` and `closedAt` have been read; the maintainer can say what the run cost in list-price dollars, which models drove it, whether any spend went unread, and how many wall-clock minutes it took from start to close.

## Steps

### 1. Open the manifest of a closed run
- **URL:** `{pipelines}/{run-id}/manifest.json`, or `{pipelines}/archive/{run-id}/manifest.json` once archived.
- **Action:** Open the file after the run closed. The close-out fields sit beside the nine run-start fields, still at `v: 1`.
- **Should feel:** Like reading a receipt stapled to the run label — one file, the same one that says what the run started under.
- **Should understand:** The close path writes these fields, not the mint. The token pass runs detached after close and may land after archival; it fills the manifest wherever the timing write landed, so the archive twin carries the cost. A `spec-N` child never gets its own.
- **Red flags:** Looking for cost in `timing.json` (it has phase token sums, no model key and no price). Treating a manifest with no close-out fields as broken — a run still open, or one closed by an older build, simply has none yet.

### 2. Read the cost and what it covers
- **URL:** `tokensByModel`, `costUsd`, `priceDate`, `unpricedModels`, `costPartial`.
- **Action:** Read `tokensByModel` per model id (or the launched alias on the driver lane), `costUsd` as list-price dollars rounded to cents, and `priceDate` as the date of the price table used.
- **Should feel:** A comparable unit, not an invoice: two runs priced on the same `priceDate` can be compared directly.
- **Should understand:** Dollars are list-price equivalents of recorded tokens, never Claude Code's `total_cost_usd`. Transcript rows are priced per request (Haiku's long-prompt rate applies per request over 100k prompt tokens); whole-session aggregates — a driver step's `usage`, a headless lens worker's `tokens` — are priced at base rates, so Haiku cost from them is a lower bound. A model id the table does not know is counted in `tokensByModel`, listed in `unpricedModels`, and left out of `costUsd`.
- **Red flags:** `costUsd: 0` on a run that read no tokens (unknown is `null`, never `0`). An unknown model silently priced at a guessed rate. A transcript reached twice counted twice.

### 3. Judge whether the figure is complete
- **URL:** `costPartial` and `costUsd`.
- **Action:** Treat `costPartial: false` with a number as complete, `costPartial: true` as a floor (some token source could not be read — a missing transcript, a driver launch with no recorded usage), and an all-`null` group as "nothing was read".
- **Should feel:** Honest: a figure never reads as complete when a source was dropped.
- **Should understand:** A partial or unread group may be replaced once, by a later close that reads every source (for example after a briefly missing transcript reappears); a complete group is never rewritten, so a figure Dispatch copied changes at most from partial to complete. The kept-close re-derive runs under its own cap inside the close's time bound; past it, the group stays partial and a later close retries.
- **Red flags:** A complete group changing on a later close. A driver run reaching merge-check reading partial although its judge's `usage` was recorded on the step line.

### 4. Read how long the run took
- **URL:** `minutes` and `closedAt`.
- **Action:** Read `closedAt` as the run's own close time and `minutes` as elapsed wall-clock from the run's start to that close, to one decimal.
- **Should feel:** Time to close, not effort: a run that idled overnight shows it.
- **Should understand:** `closedAt` is `run-state.json`'s `updatedAt` once its status is `clean`, else the last event timestamp, never the clock of the process that filled it. The start is the manifest's mint `createdAt`, or the run's first event for a manifest a fill created. These two fields are never written as `null`: absent means unknown. `timing.totals.minutes` is a different number (the union of phase spans).
- **Red flags:** `closedAt` equal to the detached token pass's own clock. `minutes` taken from `timing.totals.minutes`.

### 5. (Dispatch tooling) Copy the cost without guessing
- **URL:** the manifest behind a closed station visit.
- **Action:** **Dispatch tooling** reads the seven fields when present, treats absent or `null` as unknown, and ignores keys it does not recognise.
- **Should feel:** Additive and stable — an older reader ignores the new fields, a newer reader reads them.
- **Should understand:** The fields were added at `v: 1` per the manifest's Compatibility rule; none was renamed or retyped. Reading `costUsd` is a change in thn-inc/dispatch's own parser.
- **Red flags:** A reader failing on the new keys, or recording `null` cost as zero spend.

## Origin

Built by #6009 (run `2026-11-26T083055-record-6009`): the cost half of the pipeline-economy design's Phase 11 (`docs/superpowers/specs/2026-11-18-pipeline-economy-design.md`, Goal 7), beside the run-start manifest of #5903. Format reference: `docs/reference/run-manifest.md`.
