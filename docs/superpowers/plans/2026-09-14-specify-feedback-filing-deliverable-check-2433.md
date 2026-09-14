# specify: never emit a /claude-tweaks:feedback-filing deliverable for a component the spec places outside the plugin (#2433) Implementation Plan

**Goal:** `/claude-tweaks:specify`'s shaping-mode composition must never emit a Deliverable/Acceptance
Criterion directing `/claude-tweaks:feedback` to file upstream when the spec's own Current State
already places the affected component outside the plugin.

**Spec:** `.claude-tweaks/pipelines/2026-09-14T194909-record-2433/work/2433-spec.md` (materialized from GitHub issue #2433)

---

### Task 1: Add the classification check at composition time and as a read-back safety net

**Files:**
- Modify: `plugin/skills/specify/shaping-mode.md`
- Modify: `plugin/skills/specify/shaping-mode-stamping.md`

- [ ] **Step 1:** In `shaping-mode.md`'s "Edit the body into spec shape" section, after the
  "Absorb the record's existing content..." paragraph, add a subsection instructing: before
  composing any Deliverable or Acceptance Criterion that directs `/claude-tweaks:feedback` to
  file upstream, run `_shared/learning-routing.md`'s classifier rule 1 against the record's own
  (already-drafted) `## Current State` / `## Technical Approach` — does it name a
  `/claude-tweaks:*` skill, a `skills/_shared/*` contract, or a `bin/*.js` behavior as the
  affected component? If yes, the Deliverable may proceed. If no (the spec's own analysis places
  the subject outside the plugin — a third-party dependency, the harness, or a corrected
  mis-attribution), never emit that Deliverable/AC — route the concern instead per
  `learning-routing.md`'s Non-claude-tweaks-upstream paragraph ("Report it to the user, name the
  owner, and stop") when the subject is a live third-party dependency, or drop it as out of this
  record's scope with a one-line note in Gotchas when it doesn't warrant separate action.
- [ ] **Step 2:** In `shaping-mode-stamping.md`'s "Read-back verification" section, add an
  assertion mirroring the existing bullet list's shape: when the re-fetched `## Current State` /
  `## Technical Approach` places the affected component outside the plugin (no
  `/claude-tweaks:*` skill, `skills/_shared/*` contract, or `bin/*.js` behavior named as
  affected), the re-fetched `## Deliverables/## Acceptance Criteria` must not direct
  `/claude-tweaks:feedback` to file against that component — the mechanical safety net Step 1's
  composition-time instruction can miss.
- [ ] **Step 3:** Run `node --test tests/skill-prose/specify.test.js` (or the repo's existing
  specify prose-conformance suite, whichever file covers `shaping-mode.md`) plus the full
  `npm test` gate — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #2433`.

---

## Self-review

- **Spec coverage:** both Deliverables items (composition-time check, read-back safety net) are
  covered by Task 1's two edits. All three Acceptance Criteria (never emit the deliverable when
  Current State places the subject outside the plugin; specify's own validation catches it before
  `ready`; regression case re-runnable against a record shaped like #1785) are addressed by the
  combination of Step 1 (prevents emission) and Step 2 (catches it if it slips through).
- **Placeholders:** none.
