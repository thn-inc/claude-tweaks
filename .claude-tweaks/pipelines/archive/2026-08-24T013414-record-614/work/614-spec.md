---
record: 614
origin: capture
risk: low
size: low
ceremony: fast-lane
grants: [build, merge]
surface: backend
---
# 614: Surface the maintainer objectives in CLAUDE.md — the feedback-objectives rubric is loaded only by bare /feedback

Surface: backend

## Current State

The eight maintainer objectives (automation efficiency, context overhead, avoidable interactions, friction, developer joy, trust calibration, instruction efficacy, recovery quality) live in `skills/_shared/feedback-objectives.md` and are read only by `/feedback`'s session judge. CLAUDE.md never mentions them, so a session working in this repo has no ambient statement of what the plugin optimizes for.

## Deliverables

- A `## Objectives` section in CLAUDE.md (~4 lines) naming the eight objectives and pointing at `skills/_shared/feedback-objectives.md` for the full rubric.
- Consider whether `/reflect`'s lenses should cite the same objective names for consistency.

## Acceptance Criteria

- [ ] CLAUDE.md gains a `## Objectives` section naming all eight objectives and citing `skills/_shared/feedback-objectives.md`.
- [ ] `tests/claude-md-budget.test.js`'s 150-line budget still passes after the addition.
- [ ] A decision is recorded (in the section itself or elsewhere) on whether `/reflect`'s lenses now cite the same names.

## Technical Approach

Add a short `## Objectives` section to CLAUDE.md listing the eight objective names (automation efficiency, context overhead, avoidable interactions, friction, developer joy, trust calibration, instruction efficacy, recovery quality) and a one-line pointer to `skills/_shared/feedback-objectives.md` for the full rubric — matching this repo's existing convention of pointing at a canonical file rather than restating its content (see CLAUDE.md's Cross-references section). Check `tests/claude-md-budget.test.js`'s line budget before and after to confirm headroom.

### Key Files

- `CLAUDE.md` — new `## Objectives` section
- `plugin/skills/_shared/feedback-objectives.md` — the rubric being pointed at (unchanged)
- `tests/claude-md-budget.test.js` — the 150-line budget this addition must respect

## Gotchas

- CLAUDE.md is line-budget-gated at 150 lines (`tests/claude-md-budget.test.js`) — per this repo's own "Hard-ceiling headroom check before adding" convention, measure current headroom before writing the section, and keep it to the stated ~4 lines rather than a fuller restatement of the rubric.

## Original request

Surface the maintainer objectives in CLAUDE.md — the feedback-objectives rubric is loaded only by bare /feedback

**Related:** none

Context: The eight objectives (automation efficiency, context overhead, avoidable interactions, friction, developer joy, trust calibration, instruction efficacy, recovery quality) live in skills/_shared/feedback-objectives.md and are read only by /feedback's session judge; CLAUDE.md never mentions them, so a session working in this repo has no ambient statement of what the plugin optimizes for. Raised by the maintainer during a session-evaluation pass.

Scope: a ~4-line "## Objectives" section in CLAUDE.md naming the eight and pointing at the rubric file, budget-checked against tests/claude-md-budget.test.js (150 lines); consider whether /reflect lenses should cite the same names.

