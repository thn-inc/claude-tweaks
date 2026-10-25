---
files:
  - plugin/skills/_shared/pr-checklist-refresh.md
  - plugin/skills/_shared/pr-early-run-lifecycle.md
  - plugin/skills/build/SKILL.md
  - plugin/bin/revise-pr-summary.js
  - plugin/bin/pr-checklist.js
  - plugin/bin/lib/flow/pr-checklist.js
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
- **Should understand:** Only this exact phrase is read, and only when it opens the entry's text. A free-form "we changed the approach" line in `decisions.md` triggers nothing, and neither does a line that merely quotes the marker mid-sentence.
- **Red flags:** A reversal logged with different wording. An `{original claim}` that itself contains ` → `, so the split lands in the wrong place.

### 2. The phase exit re-composes the summary before pushing the body
- **URL:** `plugin/skills/_shared/pr-checklist-refresh.md` Phase-checklist update, "Refresh the Spec summary after a premise reversal (#3050)"
- **Action:** With `gh` present, the phase exit's single `bin/phase-exit.js` call runs `bin/pr-checklist.js` in-process, which runs the reversal check itself and reports it under `summary`, carried as `checklist.summary` in the envelope. A non-empty `checklist.summary.uncovered` makes the agent write a one-paragraph summary of this run's diff and re-run with `--summary-file …`, which `phase-exit.js` forwards to `pr-checklist.js`; the row is already checked, so only the span from the `### Spec summary` heading to the next heading changes. With `gh` absent (MCP), the checklist-flipped body is written to a session temp file and `bin/revise-pr-summary.js --run-dir … --body-file …` runs before the run-id re-read and the MCP write, re-running with `--summary-file … --out …` on a non-empty `uncovered`.
- **Should feel:** Like the checklist flip — part of the same phase-exit step. On the `gh` path a reversal costs one extra call (two body writes); with no reversal the body changes once.
- **Should understand:** The span is found by its heading, which survives both a `gh` and an MCP read, so the same check works on either transport. In a bundle, the run dir passed is the parent holding `manifest.yml`. New entries are `; `-joined onto an existing note, so another spec's entry is never dropped.
- **Red flags:** A non-empty `summary.uncovered` left unanswered, so the unrevised summary ships. A summary that describes behavior the diff does not show. A sibling spec's `Revised during build:` entry disappearing after this spec's phase exit.

### 3. Later phase exits and the pre-merge refresh leave it alone
- **URL:** `plugin/skills/_shared/pr-checklist-refresh.md` Pre-merge refresh step 1; `plugin/skills/_shared/pr-early-run-lifecycle.md` Step 3 template note; `plugin/bin/lib/flow/pr-body.js` `reviseSpecSummary`
- **Action:** Every later phase exit, and the pre-merge refresh (which re-runs the Phase-checklist update unconditionally), runs the same report. With every reversal already noted (`already-noted`), or none logged (`no-reversals`), it writes the body as composed.
- **Should feel:** Stable — the summary a reviewer read at review time is the one still there at merge.
- **Should understand:** Idempotency is judged per entry: an entry counts as noted only when it appears delimited in the note, so `XA → B` does not mask a distinct `A → B`. A `; ` inside a logged claim is written into the note as `, `, because `; ` is the note's own entry separator: kept as-is, an existing `X; Y → Z` entry would make a distinct `Y → Z` read as already noted, and the summary would never be revised for it.
- **Red flags:** The note growing a duplicate entry on every phase exit. A run with no reversal changing the Spec summary at all. A distinct reversal missing from the note because an existing entry's claim contained a `; `.

### 4. A failed refresh is a warning, not a stop
- **URL:** `plugin/skills/_shared/pr-checklist-refresh.md` Refresh paragraph, "Best-effort" sentence; `plugin/bin/pr-checklist.js` `summary` envelope; `plugin/bin/revise-pr-summary.js` exit codes (MCP path)
- **Action:** A re-run whose `summary.changed` is `false` with a non-empty `uncovered` and a `reason` other than `summary-required` (the first call's normal ask for a summary, Step 2) — for example `no-spec-summary-heading` or `summary-not-one-paragraph` — logs a warning to `decisions.md`; the row is still written. On the MCP path, a non-zero `revise-pr-summary.js` exit (for example exit 2 for a `--run-dir` that is not a directory, or that is a worktree-local shadow of the run dir) warns the same way and the checklist-only body is written.
- **Should feel:** Recoverable — the PR still advances, and the stale summary is named in the audit trail for the Review Console to surface.
- **Should understand:** A missing `decisions.md` inside an existing run dir reads as zero reversals (fail-open). A run dir that does not exist at all is an error, so a wrong path is never mistaken for "nothing to revise".
- **Red flags:** A phase exit or merge blocked by this step. A failed refresh with no `decisions.md` warning.

## Origin
- Created during `/claude-tweaks:build` of record #3050 (2026-10-17): build logs a canonical `premise reversed:` decision line, and `pr-checklist-refresh.md`'s Phase-checklist update re-composes the PR's `### Spec summary` through `bin/revise-pr-summary.js`.
- Steps 2 and 4 revised during `/claude-tweaks:build` of record #3263 (2026-10-19): on the `gh` path the reversal check now runs inside `bin/pr-checklist.js`'s single phase-exit call (`--summary-file` applies it); `bin/revise-pr-summary.js` remains the MCP path's step.
- Related: `docs/journeys/flip-a-pr-checklist-row-at-a-phase-exit-3263.md` (the one-call phase-exit update this summary refresh now rides in); `docs/journeys/stop-a-run-on-its-own-red-pr-check-3013.md` (another pr-first PR-body/merge-gate journey)
