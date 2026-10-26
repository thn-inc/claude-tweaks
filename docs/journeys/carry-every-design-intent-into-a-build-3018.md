---
files:
  - plugin/bin/lib/issues/materialize-format.js
  - plugin/bin/materialize.js
  - plugin/skills/flow/materialize.md
  - plugin/skills/flow/manifesto.md
  - plugin/skills/design-wrapper/modes/polish.md
  - plugin/skills/specify/design-pre-steps.md
---

# Carry Every Design Intent from a Record into Its Build

**Persona:** A claude-tweaks maintainer shaping a frontend record who picks two design intents at `/claude-tweaks:specify` (for example quiet and minimal) and then lets `/claude-tweaks:dispatch` build it unattended. They have no chance to notice mid-run that one intent was dropped.
**Goal:** Every intent named on the record's `Design-intent:` line reaches the build's polish phase, and a malformed line stops the run instead of being silently trimmed.
**Entry point:** `PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow #{n}` (dispatched or direct) on a `ready` record whose body's metadata block carries `Design-intent: quiet, minimal`.
**Success state:**
- The committed `work/{n}-spec.md` header reads `design-intent: quiet, minimal`.
- `config.yml`'s `design-intent` lever still holds one enum value.
- Polish dispatches both the `quiet` and the `minimal` commands, in that order.

## Steps

### 1. Pick more than one intent while shaping
- **URL:** `/claude-tweaks:specify #{n}`, design-intent question (Step 2.5a)
- **Action:** Select two intents. If None is also selected alongside them, specify drops `none`. A free-text answer is mapped to one of `bold | quiet | minimal | delightful | onboarding | none` or asked again, and is never written raw.
- **Should feel:** Forgiving at the point of entry. The record body ends up with a line the build will accept.
- **Should understand:** The body line is a comma list (`Design-intent: quiet, minimal`). Order matters because polish dispatches in the declared order.
- **Red flags:** A record body carrying `Design-intent: bold, none` or an off-enum word right after a specify run.

### 2. Read the materialized header
- **URL:** `.claude-tweaks/pipelines/{run-id}/work/{n}-spec.md` on the run's branch
- **Action:** Check the header's `design-intent:` line. Materialization splits the body line on `,`, trims each value, drops empty entries, dedupes, validates each value against the enum, and writes `value, value`.
- **Should feel:** Faithful. What the record says is what the build reads, with spacing tidied (`quiet ,minimal,` becomes `quiet, minimal`).
- **Should understand:** A single value is written exactly as before. A bare `Design-intent:` line with no value, or one holding only commas, lifts nothing.
- **Red flags:** A header reading `design-intent: quiet,` (the pre-#3018 truncation) on a fresh run.

### 3. If the line is malformed, the run stops before anything is written
- **URL:** `/flow`'s failure output; `bin/materialize.js` stderr
- **Action:** Read the stop message. It names the record and the offending value: either `unknown value(s) {value} (allowed: none, bold, quiet, minimal, delightful, onboarding)`, or `"none" cannot be combined with other intents`. It then points at `/claude-tweaks:specify #{n}`.
- **Should feel:** Loud and specific. The run fails on the real problem, which is never quietly dropped.
- **Should understand:**
  - `bin/materialize.js` exits 1 under `work-backend: github-issues`.
  - The inline `local-files` procedure applies the same stop.
  - Matching is case-sensitive, so `Quiet` is rejected.
  - A space-separated line such as `quiet minimal` is rejected as one unknown value.
  - Since #4027 `/flow` runs this same gate at Step 1 item 5 as `bin/materialize.js {n} --check`, which writes nothing and exits 1 on the same malformed line, so the stop comes before Step 2's pre-flight checks, the claim and the Config Manifesto.
- **Red flags:**
  - A `work/{n}-spec.md` file exists after a stop.
  - A run that continued with only the first intent.

### 4. Check the Manifesto lever and the polish dispatch
- **URL:** the `### Pipeline Config (auto)` table and `{run-dir}/config.yml`, then the polish phase's dispatch log in `decisions.md`
- **Action:** Confirm that lever 4 (Design intent) holds a single enum value and not the header list. Then confirm polish invoked one intent command per header value (`quieter`, then `distill`).
- **Should feel:** Unsurprising. The run-level lever and the per-record list never fight.
- **Should understand:**
  - The lever is a single-valued run-level setting that polish never reads.
  - The header list is authoritative per record.
  - A legacy `design-intent: quiet,` header in an old run dir reads as `quiet`.
- **Red flags:**
  - `config.yml` holding `quiet, minimal`, which `set-config.js` rejects.
  - Polish running only the first intent's command.

## Origin
- Created during build of #3018 (a comma-separated `Design-intent:` list was truncated to its first value in the materialized header; polish ran the second intent only because the agent re-read the record body).
- Related: `docs/journeys/run-flow-on-an-unlabeled-record-3160.md` (the same Manifesto/materialize seam for `ceremony:`).
