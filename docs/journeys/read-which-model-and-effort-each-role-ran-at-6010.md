---
files:
  - plugin/bin/lib/run-manifest/roles.js
  - plugin/bin/lib/run-manifest/write.js
  - plugin/bin/lib/timing/at-close.js
  - plugin/bin/lib/timing/transcript.js
  - docs/reference/run-manifest.md
  - tests/bin-lib/run-manifest/roles.test.js
  - tests/bin-lib/run-manifest/write.test.js
  - tests/bin-lib/timing/at-close.test.js
---

# Read Which Model and Effort Each Role Ran At

**Persona:** the claude-tweaks maintainer judging a change to which model or effort a role runs at (the pipeline-economy phases that compare 20 runs per change). A second persona is the Dispatch tooling that copies a closed run's manifest into its records.
**Goal:** answer "which models and efforts did each role in this run actually run at?" from the run's own `manifest.json`, without trusting what policy asked for.
**Entry point:** a closed run directory under `.claude-tweaks/pipelines/` (or its `archive/` twin), after a close that derived the run's cost (`close-run`, `teardown-run`, the reconciler's archive, or the detached token pass).
**Success state:** the maintainer has read `roles` and can say, per role, how many agents ran, on which model ids, and how many turns ran at each effort — and which of those counts are `unknown` because nothing was recorded.

## Steps

### 1. Open the manifest of a closed run
- **URL:** `{pipelines}/{run-id}/manifest.json`, or `{pipelines}/archive/{run-id}/manifest.json` once archived.
- **Action:** Open the file and find the `roles` key beside the cost group, still at `v: 1`.
- **Should feel:** Like the run's crew list stapled to its receipt — the same file that says what the run started under and what it cost.
- **Should understand:** `roles` is filled only on a close that derives cost. A run first closed by an earlier release, or one whose cost group was already complete before this build, keeps `roles` null — that is unknown, not "no agents".
- **Red flags:** Looking for per-role models in `timing.json`'s `byRole` buckets (they carry tokens and time, not efforts). Reading a null `roles` as an empty run.

### 2. Read each role's agents and models
- **URL:** `roles.<role>.agents`, `roles.<role>.models`.
- **Action:** Read the role names — `session`, the dispatch roles `roleOf` names (`implementer`, `task review`, `lens reviewer`, `whole-branch review`, `plan review`, `re-review`, `unlabelled`), or on a driver run `implementer`, `reviewer`, `merge-check`, `acceptance` — and for each the agent count and the model ids those agents ran on.
- **Should feel:** Factual: the model id is the one the transcript recorded (what ran), not the alias the dispatch asked for.
- **Should understand:** `models` counts agents. `session` is one agent — the run's own transcript plus, on a dispatched run, its Task-call transcripts — so its `models` can sum above `agents` when the session switched models. An agent whose transcript could not be read counts under model `unknown`. A run is single-lane: a driver run's `roles` holds only driver role names.
- **Red flags:** One model split across an alias key (`sonnet`) and a full id (`claude-sonnet-5-5`) for the same role. A `""` key. Session turns showing up under `implementer`, or subagent turns inside `session`.

### 3. Read each role's efforts
- **URL:** `roles.<role>.efforts`.
- **Action:** Read the effort levels and their counts; treat `unknown` as "nothing recorded", never as a level.
- **Should feel:** Honest about gaps: a role whose transcripts recorded no effort says `unknown`, never a value inferred from its profile.
- **Should understand:** `efforts` counts turns on session lanes (read from each transcript's `type: "api-request"` lines at `params.output_config.effort`) and launches on the driver lane (the step line's own `effort`). A level outside `low`/`medium`/`high`/`max` is kept as written. A headless lens worker, which records no turns, counts one `unknown`.
- **Red flags:** Efforts present on a role whose agents all show model `unknown` from an unreadable transcript. An effort borrowed from the policy profile.

### 4. Know when the figure can still change
- **URL:** `roles` together with `costPartial`.
- **Action:** Treat `roles` beside `costPartial: true` as provisional; once `costPartial` is `false`, treat `roles` as final.
- **Should feel:** Stable: a figure Dispatch copied changes at most once, alongside the cost.
- **Should understand:** `roles` is written while null, and rewritten only in the one fill that upgrades a partial cost group to a complete one (a transcript that was briefly unreadable is then counted under its real model). After that, closing again changes nothing. A `roles` value that fails the shape check leaves the whole manifest untouched, with one stderr line.
- **Red flags:** `roles` changing after the cost group is complete. A partial close's `unknown` entries surviving a cost upgrade.

### 5. (Dispatch tooling) Copy the roles without guessing
- **URL:** the manifest behind a closed station visit.
- **Action:** **Dispatch tooling** reads `roles` when present, treats absent or `null` as unknown, and ignores role names it does not recognise.
- **Should feel:** Additive — an older reader ignores the key, a newer one reads it.
- **Should understand:** `roles` was added at `v: 1`; renaming a driver role in `plugin/bin/lib/driver/roles.js` changes these keys, so such a rename names this record.
- **Red flags:** A reader failing on the new key, or treating a missing role as zero agents.

## Origin

Built by #6010 (run `2026-11-26T121035-record-6010`): the model-and-effort-per-role half of the pipeline-economy design's Phase 11 (`docs/superpowers/specs/2026-11-18-pipeline-economy-design.md`), extending the cost fields of #6009. Format reference: `docs/reference/run-manifest.md`'s `roles` section.
