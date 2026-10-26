---
files:
  - plugin/skills/specify/SKILL.md
  - plugin/skills/specify/shaping-mode-readback.md
  - plugin/skills/specify/next-mode.md
  - plugin/skills/_shared/materiality-floor.md
---

# Refuse to Shape the Digest Container

**Persona:** A claude-tweaks maintainer working through a list of issue numbers copied from a sweep summary, who runs `/claude-tweaks:specify #3997,#1426,#2724` without noticing that #1426 is the live `digest` container, the rolling issue where below-floor findings collect.
**Goal:** The digest container is never rewritten into spec shape, scored, or stamped `ready`, so `/dispatch` and `/flow` never see it as buildable. Every other record in the same call still shapes.
**Entry point:** A Claude Code session at the project checkout, `work-backend: github-issues`, and a `#N` reference (alone, in a comma list, in a range, or matched by title) that resolves to an open issue carrying the `digest` label.
**Success state:** The container's body is untouched and its labels carry no `ready`/`risk:*`/`size:*`/`ceremony:*`/`solution:unjustified`. The output names the container and cites `_shared/materiality-floor.md`. In a batch, the container has its own `refused — digest container` row and the other records are shaped.

## Steps

### 1. Reference the digest container on its own — the hard stop
- **URL:** `/claude-tweaks:specify #1426` (an issue carrying the `digest` label)
- **Action:** Pass the container as if it were an ordinary shaping target.
- **Should feel:** An immediate stop with nothing to answer: no prompt, no rewritten body, and a message that says why. The issue is the materiality-floor container, and `_shared/materiality-floor.md` says a digest issue is never shaped, scored, promoted, or closed as a record.
- **Should understand:** The guard runs right after the parent-record guard and before the `needs:definition` check. A digest container that also carries `needs:definition` stops here and never reaches brainstorming. Bare drain never offers the container at all, because `next-mode.md`'s `EXCLUDE` set already drops `digest`. This guard closes the explicit-reference path, and `tests/specify-digest-guard.test.js` pins both so they cannot drift apart. Under `local-files` the container is `specs/digest.md`, which has no record id, so no reference can resolve to it.
- **Red flags:** The container's body rewritten into spec sections; `ready` or scoring stamped on it; an `AskUserQuestion` before the stop; the brainstorming redirect firing on it.

### 2. See mis-shape residue stripped and reported
- **URL:** The same stop message, when the container already carries `ready` or scoring from an earlier incorrect shape
- **Action:** Read the strip report in the guard's output.
- **Should feel:** Repair without ceremony. The wrong labels are gone in one edit, and the output says exactly which ones were removed.
- **Should understand:** The strip covers exactly `ready`, `risk:*`, `size:*`, `ceremony:*`, and `solution:unjustified`. It never touches `type:*`, `priority:*`, `auto:*`, or `bot:*`. It is the same carve-out the parent-record guard has, granted in `_shared/work-record-permission-matrix.md`'s `/specify` row. "Silent" means unprompted, never unreported: the strip is named in the output and logged as an `AUTO` entry when a run directory resolves.
- **Red flags:** A confirmation prompt for the strip; a strip that ran but was not mentioned; `digest`, `type:*`, or `priority:*` removed.

### 3. Include the container in a batch — refused alone, the rest shape
- **URL:** `/claude-tweaks:specify #3997,#1426,#2724` (or a range that spans the container)
- **Action:** Read the Actions Performed table.
- **Should feel:** Only the offender is dropped. #3997 and #2724 are shaped and #1426 is turned away, with no all-or-nothing stop for an element that resolved fine.
- **Should understand:** The digest refusal is the one per-element stop in the batch branch. An unresolvable element, a `needs:definition` element, or a parent element still fails the whole batch. A digest element resolves, is refused alone, and renders as its own `refused — digest container` row. It is a refused row, not a skipped one, so the table still has no `skipped` outcome. A batch made only of digest containers shapes nothing.
- **Red flags:** The whole batch aborted because of the container; the container missing from the table; its row reading `shaped` or `skipped`; the other records left unshaped.

## Origin
- Created for #4142 (digest-container refusal for `/specify`'s explicit-reference shaping entries; incident: `/claude-tweaks:specify #3997,#1426,#2724` on 2026-10-24 resolved the live digest container into the batch unguarded)
- Related: #1071 (the parent-record guard this guard sits beside)
