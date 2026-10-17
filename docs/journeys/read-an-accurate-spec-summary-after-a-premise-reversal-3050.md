---
files:
  - plugin/skills/_shared/pr-checklist-refresh.md
  - plugin/skills/_shared/pr-early-run-lifecycle.md
  - plugin/skills/build/SKILL.md
  - plugin/bin/revise-pr-summary.js
  - plugin/bin/lib/flow/pr-body.js
---

# Read an Accurate Spec Summary After a Premise Reversal

**Persona:** a maintainer of a `pr-first` project who opens a run's draft PR to decide whether to merge it, and reads the `### Spec summary` paragraph first because it is the top of the body. The build behind that PR changed a mechanism the record described.
**Goal:** trust that the Spec summary describes the code in the diff, not the record's original plan, and see at a glance which premises the build reversed.
**Entry point:** the draft PR's body on GitHub, after `/claude-tweaks:build`'s phase exit (or any later phase exit) ran `_shared/pr-checklist-refresh.md`'s Phase-checklist update.
**Success state:** a reversed premise shows up as one `Revised during build: {original claim} → {implemented behavior}` line directly above a summary paragraph that matches the implementation. A run with no reversal leaves the Spec summary byte-unchanged. A failed refresh shows up as a logged warning, never as a blocked phase or merge.

## Steps

### 1. The build logs the reversal in one canonical shape
- **URL:** `plugin/skills/build/SKILL.md` Spec Step 3 (`ASSUMPTION — verify at build:` paragraph); `plugin/skills/_shared/pr-checklist-refresh.md` "Premise-reversal decisions (#3050)"
- **Action:** When an assumption probe comes back reversed, or the plan departs from a spec premise, `/build` writes `premise reversed: {original claim} → {implemented behavior}` through `bin/log-decision.js --status AUTO`. The line goes to the run's own `decisions.md`, or to `spec-{id}/decisions.md` in a bundle.
- **Should feel:** Invisible at this point — one audit line, no prompt.
- **Should understand:** Only this exact phrase is read. A free-form "we changed the approach" line in `decisions.md` triggers nothing.
- **Red flags:** A reversal logged with different wording. An `{original claim}` that itself contains ` → `, so the split lands in the wrong place.

### 2. The phase exit re-composes the summary before pushing the body
- **URL:** `plugin/skills/_shared/pr-checklist-refresh.md` Phase-checklist update, "Refresh the Spec summary after a premise reversal (#3050)"
- **Action:** After the checklist-flipped body is written to its temp file, and before the run-id re-read and `gh pr edit`, the update runs `bin/revise-pr-summary.js --run-dir … --body-file …`. A non-empty `uncovered` makes the agent write a one-paragraph summary of this run's diff. Then it re-runs with `--summary-file … --out …`, which rewrites the span from the `### Spec summary` heading to the next heading.
- **Should feel:** Like the checklist flip — part of the same edit, with the PR body changing once rather than twice.
- **Should understand:** The span is found by its heading, which survives both a `gh` and an MCP read, so the same step works on either transport. In a bundle, the run dir passed is the parent holding `manifest.yml`. New entries are `; `-joined onto an existing note, so another spec's entry is never dropped.
- **Red flags:** The unrevised body pushed while the revision sits unused in the temp file. A summary that describes behavior the diff does not show. A sibling spec's `Revised during build:` entry disappearing after this spec's phase exit.

### 3. Later phase exits and the pre-merge refresh leave it alone
- **URL:** `plugin/skills/_shared/pr-checklist-refresh.md` Pre-merge refresh step 2; `plugin/skills/_shared/pr-early-run-lifecycle.md` Step 3 template note; `plugin/bin/lib/flow/pr-body.js` `reviseSpecSummary`
- **Action:** Every later phase exit, and the pre-merge refresh (which re-runs the Phase-checklist update unconditionally), runs the same report. With every reversal already noted (`already-noted`), or none logged (`no-reversals`), it writes the body as composed.
- **Should feel:** Stable — the summary a reviewer read at review time is the one still there at merge.
- **Should understand:** Idempotency is judged per entry: an entry counts as noted only when it appears delimited in the note, so `XA → B` does not mask a distinct `A → B`.
- **Red flags:** The note growing a duplicate entry on every phase exit. A run with no reversal changing the Spec summary at all.

### 4. A failed refresh is a warning, not a stop
- **URL:** `plugin/skills/_shared/pr-checklist-refresh.md` Refresh paragraph, "Best-effort" sentence; `plugin/bin/revise-pr-summary.js` exit codes
- **Action:** A non-zero exit (for example exit 2 for a `--run-dir` that is not a directory), or `changed: false` with a non-empty `uncovered` (for example `no-spec-summary-heading` or `summary-not-one-paragraph`), logs a warning to `decisions.md`. The update then pushes the checklist-only body.
- **Should feel:** Recoverable — the PR still advances, and the stale summary is named in the audit trail for the Review Console to surface.
- **Should understand:** A missing `decisions.md` inside an existing run dir reads as zero reversals (fail-open). A run dir that does not exist at all is an error, so a wrong path is never mistaken for "nothing to revise".
- **Red flags:** A phase exit or merge blocked by this step. A failed refresh with no `decisions.md` warning.

## Origin
- Created during `/claude-tweaks:build` of record #3050 (2026-10-17): build logs a canonical `premise reversed:` decision line, and `pr-checklist-refresh.md`'s Phase-checklist update re-composes the PR's `### Spec summary` through `bin/revise-pr-summary.js`.
- Related: `docs/journeys/stop-a-run-on-its-own-red-pr-check-3013.md` (another pr-first PR-body/merge-gate journey)
