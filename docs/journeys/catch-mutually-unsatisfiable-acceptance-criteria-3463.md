---
files:
  - plugin/skills/specify/red-team.md
---

# Catch Mutually Unsatisfiable Acceptance Criteria at Spec Time

**Persona:** A maintainer decomposing a design doc with `/claude-tweaks:specify`, whose sub-issue records carry acceptance criteria written by different people (or different passes) — one demanding a repo-wide negative sweep, another demanding fixture code that the sweep would catch.
**Goal:** A pair of ACs that cannot both be satisfied is flagged while the spec is still being shaped, not discovered mid-build by an implementer who then needs a ruling.
**Entry point:** `/claude-tweaks:specify {design-doc}` reaching Step 5's multi-persona red-team for each sub-issue record.
**Success state:** The sub-issue's body gains one `## Open Questions` row naming both ACs, the sweep pattern and the literal it would catch, and the decision is staged (or asked) per the red-team write-back — before the record is marked `ready`.

## Steps

### 1. The red-team pass runs its deterministic scans before the personas
- **URL:** N/A (skill step: `/specify` Step 5, `specify/red-team.md`)
- **Action:** Before dispatching any persona, the red-team runs the Path/URI/identity-guard scan and the Cross-AC literal check over the sub-issue's composed Acceptance Criteria.
- **Should feel:** Invisible when the ACs are consistent — no row, no prompt, nothing added.
- **Should understand:** The check only fires when some AC carries a negative grep or sweep pattern; a record with none is a no-op.
- **Red flags:** A row appearing on a record with no sweep-bearing AC.

### 2. A sweep pattern is tested against the other ACs' required literals
- **URL:** N/A
- **Action:** For each AC with a negative grep/sweep pattern, the check tests that pattern — as a literal substring and, when it is a regex, as a regex — against every literal string the *other* ACs require to exist (quoted code, fixture text, fenced blocks), never against strings an AC forbids or against the sweep AC's own literals.
- **Should feel:** Precise — the #3311 shape (AC1 sweeps `CEILING_BYTES`, AC3 mandates the fixture `FOO_CEILING_BYTES = 30 * 1024`) is caught; an unrelated literal is not.
- **Should understand:** It compares text only; it does not yet weigh the sweep's pathspec (a `plugin/`-scoped sweep vs a `tests/` fixture can still be flagged — an accepted limitation: the staged row costs a human one quick ruling, and pathspec awareness is revisited only if such a false positive is observed).
- **Red flags:** A hit missed because the literal sat inside a fenced code block.

### 3. The conflict lands as an Open Questions row and is staged or asked
- **URL:** N/A (the sub-issue's GitHub body, `## Open Questions` table)
- **Action:** A hit adds one row naming both ACs, the pattern and the literal, then flows through the red-team write-back: being AC-scope-changing, it is decision-worthy and is staged for the Review Console (auto) or asked (interactive).
- **Should feel:** Like a cheap catch — one row now instead of a mid-build ruling, a review finding and sweep amendments later.
- **Should understand:** The fix is a spec decision (exempt the fixture's file in the sweep pathspec, or change the fixture), so a human rules on it.
- **Red flags:** The conflict reaching `ready` with no Open Questions row.

## Origin
- Created during build of #3463 (cross-AC literal check in `/specify`'s red-team)
- Motivating incident: #3311, whose AC3 fixtures tripped AC1's and AC2's sweeps and surfaced only at implementation
