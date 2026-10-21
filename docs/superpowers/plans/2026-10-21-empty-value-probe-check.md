# Empty-Value Probe Check (#3592) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution:** batched
**Batch:** send every task to one implementer as a single brief; review the combined diff once.

**Goal:** Add an "Empty-value probe check" paragraph to `plugin/skills/build/plan-authoring-checks.md` so plan authors run each substituted command once with its resolver's empty value, pinned by a prose test.

**Architecture:** The new paragraph sits immediately after the Derived-value probe check it extends. The file is at 52,358 B against the 52,500 B Read-limit rail (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`; enforced by `tests/bin-lib/skill-audit/context-cost.test.js`'s `rail:` test), so the paragraph cannot fit without a cut. Task 1 moves the two greedy pairing-loop checks — a genuinely lazy section, relevant only to a plan that touches a pairing loop — into their own cited sub-file and leaves a one-paragraph pointer; Task 2 adds the new check and its pin.

**Tech Stack:** Markdown skill prose; `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T053703-record-3592/work/3592-spec.md` (materialized from GitHub issue #3592)

## Global Constraints

- The literal `Empty-value probe check` appears exactly once in `plugin/skills/build/plan-authoring-checks.md` (AC1.1) — the pointer paragraph and the new sub-file must not contain it.
- The new paragraph has one bold lead, the rule, one clause of why, and #3572 as the incident (Deliverable 1).
- The pin test follows `tests/absence-grep-control-check-prose.test.js` and reads the file through `readText` (`tests/helpers/read-skill`) (Deliverable 2).
- `plan-authoring-checks.md` must end under 52,500 B. Projected: 52,358 − ~2,664 (two greedy paragraphs + blank lines) + 397 (pointer) + 897 (new paragraph, measured with its blank line) ≈ 50,990 B, leaving ~1,510 B headroom. Record the measured `wc -c` in the commit message body.
- Every `plugin/skills/build/*.md` sibling must appear in `docs/plugin-structure.md`'s `| build |` row (`tests/build-dispatch-subfile-table-completeness.test.js`).

## Pre-plan findings (plan-authoring checks)

- **Verbatim-command run-once / Behavioral-claim:** `gh pr list --repo thn-inc/claude-tweaks --head "" --state merged --json number --jq length` printed `30` on 2026-10-21; the same command with `--head "worktree-record-3592"` printed `0`. The paragraph's quoted incident output is confirmed, not copied on trust.
- **Moved-prose pin check / Prose-held pin check:** `git grep -n -i -e "Greedy-matcher" -e "Greedy-assignment" -e "categoriseReproduction's line tolerance" -e "augmenting paths" -- tests plugin docs` hits only the two paragraphs themselves, `plugin/bin/lib/coordination.js:457` (a comment citing "Greedy-assignment stranding precedent, #2907" — no path, unaffected by the move), and two docs files citing #2907 by number. No test pins either paragraph, so nothing needs re-pointing.
- **Byte-pin check:** see Global Constraints.

## Review Focus

- A reader of `build/SKILL.md` Spec Step 3 ("run every check in `plan-authoring-checks.md`") must still reach the two greedy checks: the pointer paragraph names the trigger and the sub-file path.
- The pointer paragraph must not reuse the literal `Empty-value probe check`, or AC1.1's grep prints two lines.
- The moved paragraphs keep their "(extends the Greedy-matcher widening check)" and "the widening check above" cross-references, which stay correct only if both move together and in order.
- The pin must go red on the pre-change file (count 0), not merely pass after (AC2.1).

---

### Task 1: Move the greedy pairing-loop checks into a lazy sub-file

**Files:**
- Create: `plugin/skills/build/plan-authoring-pairing-checks.md`
- Modify: `plugin/skills/build/plan-authoring-checks.md` (lines 91 and 93: the **Greedy-matcher widening check:** and **Greedy-assignment stranding check (extends the Greedy-matcher widening check):** paragraphs)
- Modify: `docs/plugin-structure.md:97` (the `| build |` row)

**Interfaces:**
- Produces: the sub-file path `plan-authoring-pairing-checks.md`, which the pointer paragraph cites.

- [ ] **Step 1: Create `plugin/skills/build/plan-authoring-pairing-checks.md`** with this header, followed by the two paragraphs moved byte-for-byte (cut, not copied) from `plan-authoring-checks.md`, in their current order, separated by one blank line:

```markdown
# Plan-Authoring Checks — Pairing Loops

Read from `plan-authoring-checks.md`'s **Pairing-loop checks:** pointer, only when a plan task changes a greedy or order-dependent pairing loop. Same purpose as that file: each check targets a failure that reads as correct to a task-level review comparing plan text against implemented code.
```

- [ ] **Step 2: In `plan-authoring-checks.md`, replace the two moved paragraphs with this one pointer paragraph** at the same position:

```markdown
**Pairing-loop checks:** when a plan task widens a tolerance, threshold, or window inside a greedy or order-dependent pairing loop, or replaces a first-come pairing loop with best-first assignment, read `plan-authoring-pairing-checks.md` in this directory and run both of its checks (Greedy-matcher widening, Greedy-assignment stranding). They live there because most plans touch no pairing loop.
```

- [ ] **Step 3: Add `plan-authoring-pairing-checks.md` to `docs/plugin-structure.md`'s `| build |` row** — insert it in the comma-separated file list right after `plan-authoring-checks.md`, and in the description column after the plan-authoring checks clause add: `; plan-authoring-pairing-checks.md holds the two greedy pairing-loop checks the plan-authoring checks file points to, moved out for Read-rail headroom (#3592)`.

- [ ] **Step 4: Run** `node --test tests/build-dispatch-subfile-table-completeness.test.js` — Expected: PASS.

### Task 2: Add the Empty-value probe check and pin it

**Files:**
- Modify: `plugin/skills/build/plan-authoring-checks.md` (insert after line 49, the **Derived-value probe check** paragraph)
- Test: `tests/empty-value-probe-check-prose.test.js`

**Interfaces:**
- Consumes: Task 1's headroom (the file must have room for the paragraph).

- [ ] **Step 1: Write the failing test** `tests/empty-value-probe-check-prose.test.js` (covers AC1.1; its red-then-green run is AC2.1):

```js
'use strict';
// Plan authoring probes each substituted command once with its resolver's empty value (#3592, after #3572).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const CHECKS = readText(
  path.join(__dirname, '..', 'plugin/skills/build/plan-authoring-checks.md'));

test('AC1.1 (#3592): plan-authoring-checks carries the Empty-value probe check exactly once, citing #3572', () => {
  assert.equal(CHECKS.split('Empty-value probe check').length - 1, 1);
  const start = CHECKS.indexOf('**Empty-value probe check (extends the Derived-value probe check):**');
  assert.ok(start >= 0, 'the bold lead must be present');
  const end = CHECKS.indexOf('\n\n', start);
  const paragraph = CHECKS.slice(start, end);
  assert.ok(paragraph.includes('#3572'), 'the paragraph must cite #3572');
  assert.ok(paragraph.includes('empty or unset'), 'the paragraph must name the degenerate case');
  assert.ok(paragraph.includes('widens the query instead of failing'), 'the paragraph must give the why');
  assert.ok(paragraph.includes('`gh pr list --head "" --state merged --json number --jq length`'), 'the paragraph must quote the incident command');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/empty-value-probe-check-prose.test.js`
Expected: FAIL (count is 0 on the pre-change file) — this is AC2.1's red half.

- [ ] **Step 3: Insert this paragraph into `plan-authoring-checks.md`** directly after the **Derived-value probe check** paragraph, separated by one blank line on each side:

```markdown
**Empty-value probe check (extends the Derived-value probe check):** when a plan has an agent substitute a runtime-resolved value into a command — a branch name, a ref, a path, an id — run that command once with the value the resolver returns in its degenerate case, empty or unset, and record in the plan what it does; a filter that silently drops on an empty value widens the query instead of failing, and every probe with a real value still passes. #3572's plan probed `gh pr list --head {current-branch} --state merged` on three real branches and its git check on five refs, none of them empty. On a detached HEAD `{current-branch}` is empty, and `gh pr list --head "" --state merged --json number --jq length` prints `30` with exit 0, so a clean detached worktree read as merged; the SDD task review missed it too, and only review lens 3c caught it, fixed in a review round (373ae7a00).
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/empty-value-probe-check-prose.test.js`
Expected: PASS — AC2.1's green half.

- [ ] **Step 5: Verify AC1.1's grep and the rail**

Run: `grep -nF "Empty-value probe check" plugin/skills/build/plan-authoring-checks.md` — Expected: exactly one line.
Run: `wc -c plugin/skills/build/plan-authoring-checks.md` — Expected: under 52500.
Run: `node --test tests/bin-lib/skill-audit/context-cost.test.js tests/absence-grep-control-check-prose.test.js tests/ceremony-profile-roster.test.js` — Expected: PASS.

- [ ] **Step 6: Commit** both tasks' files in one commit:

```bash
git add plugin/skills/build/plan-authoring-pairing-checks.md plugin/skills/build/plan-authoring-checks.md docs/plugin-structure.md tests/empty-value-probe-check-prose.test.js
git commit -m "Add an empty-value probe check to plan authoring — probe each substituted command with its resolver's empty value

refs #3592"
```

Waived AC3.1: `npm test` in full is verified centrally by /build Common Step 5 (verify.js run), not by an implementer test step.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Task 2 Step 3; Deliverable 2 → Task 2 Step 1. AC1.1 → Task 2 Step 1 test + Step 5 grep. AC2.1 → Task 2 Steps 2 and 4. AC3.1 → Common Step 5. The rail cut (Task 1) is required for AC3.1, since the rail test is part of `npm test`.
- **Placeholders:** none.
- **Literal-uniqueness:** the pointer paragraph and the new sub-file do not contain `Empty-value probe check`.
