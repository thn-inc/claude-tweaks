---
files:
  - tests/argument-hint-input.test.js
  - docs/skill-authoring.md
  - plugin/skills/capture/SKILL.md
  - tests/argument-hint-mirrors.test.js
  - plugin/skills/help/reference-card.md
---

# Document a Flag a Person Never Types

**Persona:** A claude-tweaks plugin maintainer adding a flag to a skill's `## Input` section. The flag is passed only by an agent or another skill, such as a producer's Capture route, or a parent skill naming itself with `--source`.
**Goal:** Document the flag without cluttering the `argument-hint` placeholder a person sees in the terminal, and without the hint silently falling out of sync with `## Input`.
**Entry point:** `npm test` (or `node --test tests/argument-hint-input.test.js`) reports `not ok … AC1.1: every --flag an ## Input table row documents is in argument-hint unless marked`.
**Success state:** Each flag documented in `## Input` is in the hint, or its entry carries `(producer-only)` or `(deprecated alias)` and the flag is absent from the hint and its mirrors. Both directions of the check pass.

## Steps

### 1. Read which flag the test caught
- **URL:** the AC1.1 failure in `tests/argument-hint-input.test.js`.
- **Action:** Read the assertion message and its actual-vs-expected arrays.
- **Should feel:** Precise. The message names one skill file, and the actual array lists exactly the flags missing from that skill's hint.
- **Should understand:**
  - The message reads `skills/{skill}/SKILL.md: ## Input documents flags missing from argument-hint — add them to the hint or mark the row (producer-only) / (deprecated alias)`.
  - The check reads `--flag` tokens from two places: the first cell of each `## Input` table row, and the leading code span of each `## Input` bullet.
  - A flag counts as in the hint only as a whole token, so `--batch-size` in the hint does not cover `--batch`.
- **Red flags:**
  - The failure names a flag from another section's table, such as a Workflow table. The check reads only `## Input`.
  - Only the first failing skill is reported. When several skills drift at once, fix one and re-run to see the next.

### 2. Decide: hint, or marker
- **URL:** `docs/skill-authoring.md`'s `argument-hint` bullet under Frontmatter conventions.
- **Action:** Ask whether a person ever types this flag at the prompt.
- **Should feel:** Like a one-question decision, with the rule written down in one place.
- **Should understand:**
  - A flag a person types belongs in the hint and in every row of the Argument-hint mirror surfaces table. Backlog's `--trust` was added for exactly this reason.
  - A flag only an agent or another skill passes is marked `(producer-only)`. A retired spelling is marked `(deprecated alias)`.
  - A marked flag stays out of the hint and its mirrors. The inverse check fails when a marked entry's flag is still in the hint.
- **Red flags:**
  - Marking a flag a person does type, just to make the test pass. The hint is the human-facing grammar.
  - Adding a producer-only flag to every mirror surface because the "Adding a mode or argument" paragraph says to. That paragraph carves marked flags out.

### 3. Mark the entry
- **URL:** the skill's `## Input` section, e.g. `plugin/skills/capture/SKILL.md`'s `--defer-reason=` and `--source` rows.
- **Action:** Append ` (producer-only)` after the code span in the row's first cell, or right after the leading code span of the bullet. Then re-run `node --test tests/argument-hint-input.test.js`.
- **Should feel:** Small and local: one marker, no edit to the hint, the reference card, or any other mirror.
- **Should understand:**
  - The marker must sit in the first cell, or right after the bullet's code span. The same text in the description column does not exempt the row.
  - The AC2.1 test pins `docs/skill-authoring.md` to the same two marker literals the check uses, so the documented rule and the enforced rule cannot drift apart.
- **Red flags:**
  - Putting the marker inside the code span, or after a trailing description.
  - Editing `EXEMPT_MARKERS` without updating the `argument-hint` bullet. AC2.1 then fails.

### 4. Marking a flag that is already in the hint
- **URL:** the `#3504 inverse` failure in `tests/argument-hint-input.test.js`.
- **Action:** Remove the marked flag's bracket group from the hint. Then remove it from every row of the Argument-hint mirror surfaces table: the `$ARGUMENTS` restatement, and the reference card's Takes cell. Re-run `node --test tests/argument-hint-input.test.js tests/argument-hint-mirrors.test.js`.
- **Should feel:** Like finishing the job the marker started. The failure names the skill and the flag, and the mirrors test points at any restatement that still differs.
- **Should understand:**
  - The message reads `skills/{skill}/SKILL.md: ## Input marks flags that still appear in argument-hint — remove them from the hint and its mirrors: {flags}`.
  - This is the converse of Step 1's check. An unmarked flag must be in the hint, and a marked one must not.
  - A test that pinned the old hint by content (for example `tests/sweep-orchestrator.test.js`) goes red too. Re-point it to the `## Input` entry instead.
- **Red flags:**
  - Deleting the marker to make the inverse check pass. That restores a caller-only flag to the grammar a person sees.
  - Removing a flag from the hint but leaving it in the `$ARGUMENTS` line or the Takes cell. The mirrors test byte-compares all three.

## Origin
- Created during build of #2964: capture's `argument-hint` was missing five documented flags (`--defer-reason`, `--risk`, `--size`, `--origin`, `--source`). The record settled that producer-only flags may stay out of the hint when marked, and added the `## Input`→hint direction of the check.
- Updated during build of #3504: five skills (`visual-review`, `design-wrapper`, `visualize`, `tidy`, `specify`) moved their caller-only flags out of their hints, the rule tightened from "may be left out" to "stays out", and the inverse check (`markedHintFlags`) was added. Step 4 was added.
- Related: `tidy-standalone-auto-report.md` (reads skills' `argument-hint` to decide which targets accept batch refs).
