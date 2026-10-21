---
files:
  - plugin/skills/build/dispatch.md
  - plugin/skills/review/code-mode-steps.md
  - plugin/skills/review/review-summary-template.md
---

# See the Plan Steps /build Could Not Run

**Persona:** A claude-tweaks user running a hands-off `/claude-tweaks:flow #N` whose plan ends with a verification task that names a browser check or a manual step. The run has no browser backend or no dev server, so `/build` cannot run that step. The user reads `/review`'s summary to decide whether the change was verified the way the plan said it would be.
**Goal:** Learn from the review summary itself, before the end-of-run Review Console, which plan verification steps no phase ran, and why.
**Entry point:** `/build`'s Common Step 5 reaches a folded verification task with a step it cannot run, or can run only in part.
**Success state:** The review summary carries a "Not run by /build" section with one row per such step: the plan step, `skipped` or `degraded`, and its condition. A run where every named step ran shows no such section, and a clean review keeps the compact PASS form.

## Steps

### 1. Let /build log the step it could not run
- **URL:** `{run-dir}/decisions.md`, under `## /build`.
- **Action:** `/build` writes `- SKIP {time} — {plan task} step "{step}" (skipped): {condition} → not run by /build; surfaced for /review. Reversibility: n/a.` A step that ran only in part (a dev server dying mid-pass) writes the same line with `(degraded)` in place of `(skipped)`, and `{condition}` names what did not run.
- **Should feel:** Like the same Common Step 5 as before. No new prompt, no stop.
- **Should understand:** Only these lines carry the `not run by /build; surfaced for /review` tail. The other `/build` `SKIP` lines in the same section (Spec Step 2.5, Common Step 5.5, and so on) trace skipped pipeline steps, not plan verification.
- **Red flags:** A `(degraded)` line that drops the marker tail, so `/review` never finds it. A step that ran in full logged as `SKIP`.

### 2. Let /review collect those lines at Step 7
- **URL:** `/claude-tweaks:review` Step 7 (Present Review Summary), reading `$PIPELINE_RUN_DIR/decisions.md`.
- **Action:** Before choosing the compact or full summary form, the review collects every line under `## /build` that begins `- SKIP` and carries `not run by /build; surfaced for /review`.
- **Should feel:** Automatic. Nothing to pass in. The dispatched second call reads the same run directory the first call wrote.
- **Should understand:** A standalone `/review` with no run directory collects nothing. A standalone `/build` lists the same step in its own handoff's Skipped steps section instead.
- **Red flags:** Every `/build` `SKIP` line listed, burying the real gap under pipeline-step traces. A `/review` line that merely quotes the marker getting listed.

### 3. Read the "Not run by /build" section
- **URL:** The review summary's `### Not run by /build` section, between Verification and QA Validation.
- **Action:** Read one row per collected line: `{plan task} step "{step}"`, `skipped` or `degraded`, and the condition.
- **Should feel:** Specific. The user knows which check to run by hand, or to accept as a gap, before merging.
- **Should understand:** A row reports a gap. It is not by itself a BLOCKED finding, so the verdict still comes from the review's findings. A summary with such a row never renders the compact clean-PASS form.
- **Red flags:** A clean `PASS (clean)` compact summary on a run whose plan step never ran. The gap appearing only at the end-of-run Review Console.

## Origin
- Created during build of #3767. It made `build/dispatch.md`'s "surfaced for /review" promise true by adding a reader in `/review` Step 7 and the "Not run by /build" summary section.
- Related: #3118 (the Folded verification task rule that writes these lines).
