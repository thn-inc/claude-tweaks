# Stop browse's argument-hint leaking YAML backslash escapes into the reference card (#2963) Implementation Plan

**Goal:** Rewrite `browse`'s `argument-hint` so it is single-quoted with a plain `"<name>"` instead of a double-quoted string containing a `\"` escape, update the help reference card's `Takes` cell to match, and add a conformance check preventing recurrence.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T212311-record-2963/work/2963-spec.md` (materialized from GitHub issue #2963)

---

### Task 1: Fix browse's argument-hint quoting and add a regression check

**Files:**
- Modify: `plugin/skills/browse/SKILL.md`
- Modify: `plugin/skills/help/reference-card.md`
- Modify: `tests/argument-hint-input.test.js`

- [ ] **Step 1: Failing test** — add a check to `tests/argument-hint-input.test.js` that fails when any skill's `argument-hint` frontmatter value is double-quoted and contains a `\"` backslash escape. Confirm it currently fails against `browse/SKILL.md`.
- [ ] **Step 2: Implement** — rewrite `browse`'s `argument-hint` single-quoted with a plain `"<name>"` (no escape needed inside single quotes), and update the reference card's `Takes` cell for `/claude-tweaks:browse` to the unescaped form.
- [ ] **Step 3: Run** the new check and the full `tests/argument-hint-input.test.js` and `tests/argument-hint-mirrors.test.js` suites — PASS.
