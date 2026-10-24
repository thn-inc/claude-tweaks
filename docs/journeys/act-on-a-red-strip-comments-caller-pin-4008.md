---
files:
  - tests/strip-comments-callers-twin.test.js
  - tests/helpers/strip-comments.js
  - .claude/skills/parse-signal-discipline/SKILL.md
---

# Act on a Red Strip-Comments Caller Pin

**Persona:** A claude-tweaks plugin maintainer who has just written a new source-scan test under `tests/` that calls the shared comment stripper (`require('./helpers/strip-comments')`), or who has deleted or renamed one that did. They run `npm test` and `tests/strip-comments-callers-twin.test.js` goes red.
**Goal:** Bring the two hand-written caller lists back in line with the tree, so the helper's header and `parse-signal-discipline` item 15 keep naming every test that depends on the stripper.
**Entry point:** `npm test` (or `node --test tests/strip-comments-callers-twin.test.js`) reports one of:
- `not ok … the helper header lists exactly the tree callers`
- `not ok … parse-signal-discipline item 15 lists exactly the tree callers`
- a message containing `the caller list could not be found`, `holds text other than backticked names`, `the caller list is empty`, or `two tree callers map to the stem`
**Success state:** Both lists name exactly the tree's callers by test-file stem, and the twin test passes.

## Steps

### 1. Read the failure message
- **URL:** the failing assertion's message in the test run.
- **Action:** Read the two halves of the message: `Missing from the prose list: …` names callers the tree has that the list lacks, and `Not in the tree: …` names list entries no test requires any more.
- **Should feel:** Pinpointed. The message names the exact stems to add or remove, and which of the two lists is stale.
- **Should understand:**
  - A caller is named by its test-file stem: the basename with `.test.js` dropped, then any trailing `-conformance` dropped (`tests/path-guard-conformance.test.js` → `path-guard`, `tests/bin-lib/console/backfill-cli.test.js` → `backfill-cli`).
  - The tree side counts any `tests/**` `.js` file whose code (lines not starting with `//` or `*`, minus any trailing `// …` comment) has a relative `require(...)` that resolves to `tests/helpers/strip-comments.js`. The helper itself and its own unit suite, `tests/helpers-strip-comments.test.js`, are excluded on purpose.
  - Both lists are checked, and each in both directions, so a fix to one list alone leaves the other test red.
- **Red flags:**
  - Only one of the two tests is red. The other list was already updated, or was edited differently. Make both lists name the same stems.
  - `two tree callers map to the stem "…"`. Two test files share a stem, so the list cannot tell them apart. Rename one test file rather than weakening the stem rule.

### 2. Edit both lists
- **URL:** the header comment at the top of `tests/helpers/strip-comments.js`, and item 15 of `.claude/skills/parse-signal-discipline/SKILL.md`.
- **Action:** In each, find the text after `by test-file stem:` and add or remove the stem, backticked, keeping the comma-and-`and` list shape and the period that ends the list.
- **Should feel:** Like a two-line edit. Alphabetical order keeps the two lists easy to compare by eye, though the test checks only set equality.
- **Should understand:**
  - The parser reads from the anchor `by test-file stem:` to the next `.`, so nothing but backticked names, commas and `and` may sit in between. A note about a caller (for example which ones use `literals: 'blank'` mode) belongs in its own sentence after the period.
  - The anchor must appear exactly once in each location. Quoting it again elsewhere in the header or item 15 makes the list unparseable.
- **Red flags:**
  - `the caller list could not be found` after an edit. The anchor was reworded or duplicated, or the closing period went missing. Restore the anchor, not the test.
  - `holds text other than backticked names, commas and "and"`. A name lost its backticks, or a parenthetical slipped into the list.
  - Silencing the failure by adding the new test to the test's exclusion set. That set is only for the helper and its own unit suite; any other caller belongs in the lists.

### 3. Re-run and confirm
- **URL:** the twin test.
- **Action:** Run `node --test tests/strip-comments-callers-twin.test.js`.
- **Should feel:** Mechanical. All tests pass, including the go-red controls, which prove that a scratch caller, a dropped name and a missing anchor each still fail.
- **Should understand:** The go-red controls run through the same extractor and assertion as the real checks, so a green run means the pin can still catch drift. It is not a vacuous pass.
- **Red flags:** A go-red control now fails. The stem rule, the anchor or the list shape changed in a way the controls no longer exercise. Update the control to match, and do not delete it.

## Origin
- Created during build of #4008. That build added `tests/strip-comments-callers-twin.test.js` and rewrote both caller lists from the eight scans the record named to the eleven callers the tree actually had: the eight plus `raw-markdown-read`, `hooks-harness-refusal` and `backfill-cli`.
- Related: `act-on-a-red-path-guard-lint-3417.md`, `act-on-a-red-path-containment-scan-3498.md` and `act-on-a-red-wall-clock-budget-scan-3491.md` (scans that call the stripper).
