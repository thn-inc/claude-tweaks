---
files:
  - plugin/skills/build/plan-authoring-checks.md
  - plugin/skills/build/SKILL.md
---

# Derive a Reader Inventory from Read Call Sites

**Persona:** A `/claude-tweaks:build` session (or the maintainer reviewing its plan) authoring a plan for a record whose deliverables say to change behavior "at every reader of" a value — a comment marker, a heading, a label, a file.
**Goal:** Build an inventory of every reader that actually exists, so the whole-branch review does not have to find the ones the plan missed.
**Entry point:** `/claude-tweaks:build` Spec Step 3 (or Design Step 3), while running the checks in `plugin/skills/build/plan-authoring-checks.md` before finalizing the plan.
**Success state:** The plan's task names every reader, classified as reader-of-this-value or not in its Files block, and the list came from the value's read call sites. Greps for the value's literal text only added to it.

## Steps

### 1. Recognize the trigger
- **URL:** the spec's `## Deliverables`, and `plan-authoring-checks.md`'s **Reader-inventory derivation check (extends the Consumer-enumeration check)** paragraph.
- **Action:** Notice that a deliverable applies a rule "at every reader of" some value. That phrase is what triggers the check.
- **Should feel:** Like a known trap, flagged before a single grep runs.
- **Should understand:**
  - A reader inventory is a plan-authoring artifact that a task-level review cannot audit. Reviewers compare the diff against the plan's list, so a reader missing from both looks consistent.
- **Red flags:**
  - A plan that starts its inventory from a grep for the marker literal.

### 2. Enumerate the read call sites first
- **URL:** the repo itself: `git grep` over `plugin/` for the ways the value is read, e.g. `--json comments`, `/comments` REST paths, `issue_read`/`get_comments`, `.comments[]`, `listComments`.
- **Action:** List every place that reads that kind of value, then open each hit and classify it: does it read *this* value (on a marker, a heading, a plain sentence, any prefix)? Record the classification in the task's Files block.
- **Should feel:** Mechanical and complete. The list is bounded by how the data is read, not by guesses at what its text looks like.
- **Should understand:**
  - Readers that match on plain sentences or on prefixes nobody named still sit on one of these call sites.
  - #3358's literal-grep inventory missed six such readers:
    - `tidy/SKILL.md`'s parent-gate re-query
    - `release/bookkeeping.md`'s `Shipped in v…` check
    - `_shared/headless-self-report.md`'s `Resolved build:` check
    - the retry-marker prose callers
    - `health-core/materiality-digest.js`
- **Red flags:**
  - An inventory with no classification column.
  - A call site dropped without a stated reason.

### 3. Supplement with literal greps
- **URL:** the same repo, grepped for the value's literal text.
- **Action:** Grep for the marker or heading text to catch anything the call-site sweep missed, and add any new hits to the classified list.
- **Should feel:** Like a cross-check, not the source of truth.
- **Should understand:**
  - Literal greps are a supplement, never the source. A hit here that the call-site sweep missed is a signal to widen the call-site list, not to stop at the literal grep.
- **Red flags:**
  - An inventory where every row came from the literal grep.

## Origin
- Created during build of #3397, a reflect-hindsight finding from #3358, whose marker-reader inventory missed six readers and cost an extra fix wave, a re-review, and two PR-body inventory rewrites.
- Pinned by `tests/plan-authoring-reader-inventory-prose.test.js`.
- Related: `plan-a-change-to-a-file-near-the-read-rail-3310.md`, another plan-authoring check that `/claude-tweaks:build` applies before a plan is finalized.
