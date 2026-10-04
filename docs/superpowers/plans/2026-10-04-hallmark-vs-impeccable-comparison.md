# Hallmark vs. Impeccable comparison note (#2695) — Implementation Plan

**Goal:** Check a short comparison note (overlap/gaps vs. Impeccable) for the third-party
Hallmark design skill into `design-wrapper`'s docs, answering whether Hallmark's `study`
reference-matching is something Impeccable's asset-producer / finish-reviewer roles already do,
partly do, or do not do.

**Constraints:** No third-party skill is installed. Every Hallmark claim traces to its published
source (`Nutlope/hallmark` at commit `13ac0ec7e148655948100b6396439e481361d690`), cited by URL.
The hands-on `study` trial (the record's first Deliverable) is not run; the note says so plainly.

**File placement decision (record Gotcha):** one consolidated third-party file,
`third-party-design-skill-comparisons.md`, one section per skill, with Hallmark as the first
section. The #2690 note stays separate: it is a first-party skill decided on a structural
invocation block, not a feature comparison.

## Task 1: Write the comparison note

**Files:**
- Create: `plugin/skills/design-wrapper/third-party-design-skill-comparisons.md`

- [ ] Read Hallmark's `README.md`, `skills/hallmark/SKILL.md` (verb table + `hallmark study`),
      `references/study.md`, `references/design-md.md`, `package.json`.
- [ ] Read Impeccable's `impeccable-asset-producer` / `impeccable-finish-reviewer` agent
      definitions at the pinned 4.0.2 and at 4.5.0, plus 4.0.2 `init.md`, `visualize.md`,
      `new-work.md`, `extract.md`, `document.md`.
- [ ] Write sections: what was compared vs. not exercised; what Hallmark is; what `study` does;
      capability-by-capability overlap/gap table with a does / partly / does-not verdict;
      why not adopted; decision; availability and stability; revisit-when.

## Task 2: Register the new sub-file

**Files:**
- Modify: `plugin/skills/design-wrapper/SKILL.md` (Reference sub-files list)
- Modify: `docs/plugin-structure.md` (design-wrapper row of the per-skill sub-file table)

- [ ] Add one bullet / one table mention naming the new file as reference-only.

## Verification

Run: `npm test`
Expected: zero failures (prose conformance suites pin sub-file listings and size ceilings).
