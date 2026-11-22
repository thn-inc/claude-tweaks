---
files:
  - plugin/bin/lib/policy-schema.js
  - plugin/bin/resolve-policy.js
  - plugin/skills/specify/planning.md
  - plugin/skills/specify/shaping-mode.md
  - plugin/skills/specify/shaping-mode-stamping.md
  - plugin/skills/specify/shaping-mode-readback.md
  - plugin/skills/_shared/planning-decisions.md
---

# Plan and Review a Record While Shaping It

**Persona:** A developer shaping backlog records with `/claude-tweaks:specify` in a project that wants plan review's questions asked once, while the record's author is still at the keyboard, instead of at `/build` time in an unattended run.
**Goal:** Turn `plan-at-specify: on` on and have a shaped record arrive at `ready` already carrying a reviewed, stored plan. Anything the plan reviewer cannot settle alone should either be asked now or hold the record visibly.
**Entry point:** `.claude-tweaks/policy.yml` with `plan-at-specify: on` and `planning-decisions: asked-classes`, and an unshaped record `#N`.
**Success state:** The record carries `ready`, `## Overview`, `## Planning Decisions` and exactly one `Plan:` line written by `plan-store.js`. Or it is held, with `needs:decision` and a `Held-by: specify-planning` decision comment whose `Proposed:` holds the recommended reading of every question left open.

## Steps

### 1. Turn the gate on — terminal
- **URL:** `node plugin/bin/resolve-policy.js plan-at-specify`
- **Action:** Set `plan-at-specify: on` in `.claude-tweaks/policy.yml` and resolve it.
- **Should feel:** Like flipping one switch. The resolver confirms `on` from `policy`, or names in a single stderr line why it refused.
- **Should understand:** `on` needs `planning-decisions: asked-classes`. Under `ask-all` the key resolves to `off` with a `conflict: planning-decisions` field, and this stderr warning prints in every output mode: `plan-at-specify is on but planning-decisions is ask-all — using "off"; set planning-decisions: asked-classes to plan at /claude-tweaks:specify`. The key is policy-only, so a run config cannot turn it on for one run.
- **Red flags:** A non-zero exit or a thrown error for the conflict. `on` resolved while `planning-decisions` is `ask-all`. The warning missing under `--values`.

### 2. Shape a record — slash command
- **URL:** `/claude-tweaks:specify #N`
- **Action:** Shape the record as usual. Planning runs after Risk flags settles the composed body and before the one record write.
- **Should feel:** Like ordinary shaping with one extra stretch of waiting while a planner and a reviewer run. The record is written exactly once, not once per planning step.
- **Should understand:**
  - A record a plan-less lane takes (driver, express or micro-plan, per `express-lane.js plan-lane`) is not planned. Its Detail reads `not planned: {lane} lane ({reason})`.
  - Otherwise a planner works in a read-only checkout of `origin/{integration-branch}`, `plan-audit.js` checks the plan, and a Capable reviewer reads it with plan review's brief.
  - A record already carrying a `Plan:` line whose stored plan `plan-store.js check` calls valid reuses it. A held record's stored plan is reviewed again before it can reach `ready`.
- **Red flags:** Two writes to the record body. A planner editing tracked files in the checkout. A planned record with no `## Overview`. The checkout left behind after planning ends.

### 3. Answer the asked questions — AskUserQuestion
- **URL:** one batch table (`Record`, `Finding`, `Class`, `Recommended reading`) followed by `AskUserQuestion` calls
- **Action:** Pick a reading per question, or `Leave for later`.
- **Should feel:** Like answering plan review's needs-human questions once, with the recommended reading first in every set, at most four questions per call.
- **Should understand:**
  - Classes `_shared/planning-decisions.md` settles alone become `Settled at planning:` lines without a question.
  - An answer becomes `Decided by the user at planning: {finding} — chose {reading}; not {other reading}`.
  - `auto` alone does not suppress questions. Only a headless run (no human reachable) skips asking and holds instead.
- **Red flags:** A question for a class the policy settles. A question asked twice. More than four questions in one call. A headless run that blocks waiting for an answer.

### 4. Read the outcome — Actions Performed
- **URL:** the shaping run's Actions Performed table
- **Action:** Read the record's row.
- **Should feel:** Unambiguous. The row says planned, not planned or held, and why.
- **Should understand:**
  - A planned record keeps the `shaped` outcome with Detail `planned (Plan: {short commit})`.
  - When the plan store refuses (no ref), the Detail reads `planned, no Plan: line: plan-store exit {code} (…)`. The decisions are kept and the plan is redone at build.
  - A planning failure writes the record as `off` would, with Detail `not planned: {reason}`, and never stops a batch.
- **Red flags:** A `ready` record with an unanswered planning question. A `Plan:` line typed by hand instead of `plan-store.js write`'s `line`. Two `Plan:` lines.

### 5. Pick up a held record later — slash command
- **URL:** `/claude-tweaks:specify #N` (the `Command:` in the decision comment)
- **Action:** Re-shape the held record once you can answer its questions.
- **Should feel:** Like resuming, not restarting. The valid stored plan is reused, and only the review and routing run again.
- **Should understand:**
  - Either signal marks the record held: the `needs:decision` label, or an unresolved `Held-by: specify-planning` comment. A hold-state read that fails counts as held, so the plan is reviewed again rather than reused unchecked.
  - Once every question is answered, the record loses `needs:decision` and gains `ready`.
- **Red flags:** A held record stamped `ready` without a fresh review. The stored plan regenerated from scratch while `check` still calls it valid. `Held-by` missing from the hold comment.

## Origin

Built for record #6056 (planning at `/claude-tweaks:specify` under `plan-at-specify`). It builds on #6052 (the plan store, `store-a-reviewed-plan-beside-its-record-6052.md`) and #6053 (the plan-lane predicate, `ask-whether-a-record-needs-a-plan-6053.md`). #6059 reads the `Held-by: specify-planning` hold this journey's step 5 resumes.
