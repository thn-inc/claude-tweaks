# Absence-Grep Control Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make plan authors and spec authors run every "returns nothing" search once against a tree that still holds its target before relying on it.

**Architecture:** Four prose additions to skill guidance, plus one `node --test` prose-pin suite that fails while any of them is missing. The additions are: a new check in `/build`'s plan-authoring checks; one sentence in `/specify`'s AC template; one clause in its Delete + Tombstone section; and one clause in reflect's specShapedBody mapping for tangential findings.

**Tech Stack:** Markdown skill files; `node --test` with `node:assert/strict`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T101343-spec-3571/work/3571-spec.md`

## Global Constraints

- The paragraph's bold lead reads exactly `Absence-grep control check`. `grep -nF "Absence-grep control check" plugin/skills/build/plan-authoring-checks.md` must print exactly one line.
- The new paragraph names `#3536` and the `grep -F` remedy.
- `npm test` passes in full. Baseline at 1ed26d947: 13077 tests, 13070 pass, 0 fail, 7 skipped.
- Test assertions compare against literal expected strings.
- Do not insert after the **Batched-plan marker.** paragraph or after the **Reader-inventory derivation check** paragraph. Sibling draft PR #3578 inserts at both spots.
- `plugin/skills/reflect/SKILL.md` states the rule inline and does not cite `spec-template.md`, which would be an undeclared cross-skill edge.
- Commit messages use `{Verb} {what} — {detail}` with `(refs #3571)` and end with `Claude-Session: https://claude.ai/code/session_01FRS7xFKTt9TrTwCNWGu1WH`.

## Review Focus

1. **A check that duplicates one that already exists.** "Verbatim-command run-once" (line 11) only checks that a command executes. "Go-red control" (line 49) covers test mutations. The new paragraph must ask for something neither of them asks for: a positive control on an absence assertion.
2. **Byte headroom.** `plan-authoring-checks.md` is 36,677 B against the 52,500 B rail, so roughly 1.3 KB of additions leaves ample headroom. Neither `spec-template.md` (24,576 B) nor `reflect/SKILL.md` (23,184 B) is near the rail.
3. **The existing AC-section pin.** `tests/specify-count-relative-ac.test.js` slices `## Acceptance Criteria\n` up to `## Release Note` and pins the count paragraph. The new sentence goes after that paragraph, inside the same section, so that test stays green.
4. **This plan's own AC.** `grep -nF "Absence-grep control check" …` is a *presence* grep, so its control is the reverse: on the pre-change file it must print nothing, and after the change exactly one line. Step 2 runs that control.

---

### Task 1: Add the absence-grep control rule to the four guidance sites

**Files:**
- Modify: `plugin/skills/build/plan-authoring-checks.md`. Insert a new paragraph, separated by blank lines, directly after the line starting `**Go-red control check (extends the Inline self-consistency check):**` (currently line 49).
- Modify: `plugin/skills/specify/spec-template.md`. In `## Acceptance Criteria`, add a new paragraph after the one starting `A criterion that counts something`. In `## Delete + Tombstone Acceptance Criteria`, add a new paragraph after the line starting `Never write a bare "zero matches anywhere" AC`.
- Modify: `plugin/skills/reflect/SKILL.md`. In the tangential mapping (currently line ~157), replace `the observable outcome →\nAcceptance Criteria;`. The line break falls after `→`.
- Test: `tests/absence-grep-control-check-prose.test.js` (create).

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks read.

- [ ] **Step 1: Write the failing test.** Create `tests/absence-grep-control-check-prose.test.js`:
  - It uses the same header shape as `tests/specify-count-relative-ac.test.js`: `'use strict'`, a one-line comment naming #3571, then requires for `node:test`, `node:assert/strict`, `node:fs` and `node:path`.
  - It reads the three files relative to `__dirname`.
  - It re-implements that file's `acSection()` slice (`## Acceptance Criteria\n` up to `## Release Note`). It also adds a `tombstoneSection()` slice, from `## Delete + Tombstone Acceptance Criteria\n` up to the next `\n## `.

  Four tests, all using literal strings:
  - `test('plan-authoring-checks carries the Absence-grep control check exactly once', …)`:
    - `CHECKS.split('Absence-grep control check').length - 1` equals `1`.
    - The paragraph, sliced from `**Absence-grep control check` to the next `\n\n`, includes `#3536`.
    - It includes ``Prefer `grep -F` ``.
    - It includes `run that exact command once against a file or commit that still contains the target and confirm it matches`.
  - `test('the AC template asks for a matching run before any returns-nothing criterion', …)`: `acSection()` includes `names a command its author has run once against a tree that still contains the target and seen match`, and includes ``prefer `grep -F` for literal code text``.
  - `test('the tombstone section treats its scoped grep as an absence grep', …)`: `tombstoneSection()` includes `Either way the scoped grep is an absence grep: run it once against the pre-deletion tree and confirm it matches the symbol`.
  - `test('reflect maps a returns-nothing outcome to a pre-run search', …)`: `REFLECT` includes `an outcome stated as a search that returns nothing is one the author has run against a tree that still holds the target and seen match`.

- [ ] **Step 2: Run the test to verify it fails, and run the AC's control.**
  - Run `node --test tests/absence-grep-control-check-prose.test.js`. Expected: FAIL, with `# fail 4`. All four tests are red against the pre-change files, and that red run is the revert-to-red proof for each pin.
  - Run `grep -nF "Absence-grep control check" plugin/skills/build/plan-authoring-checks.md; echo "exit=$?"`. Expected: no line printed and `exit=1`. That is the control for the AC's presence grep.

- [ ] **Step 3: Write the four additions.** Use this text verbatim (the spec fixes the content; the wording below is the approved copy).

  `plan-authoring-checks.md`, the new paragraph:

  ```markdown
  **Absence-grep control check (extends the Go-red control check):** when a plan step or a pinned acceptance criterion asserts that a grep, or any search, returns nothing, run that exact command once against a file or commit that still contains the target and confirm it matches, then record that match in the plan. Prefer `grep -F` (or `git grep -F`) for literal code text: in a basic regex the brackets, backslashes and `*` of a code fragment turn into operators. A search that cannot match its own target exits 1 on the broken tree and the fixed tree alike, so the criterion can never fail and every review that reads it agrees with it. #3536's AC1.1 asserted that a grep for the old block-comment regex returns nothing; #3464's reflect composed it as an escaped JS string and nobody ran it. Under grep's BRE its `\[\s\S\]` is a literal `[`, a whitespace class, a non-whitespace class and a literal `]`, so it exited 1 on the pre-change `tests/bin-lib/exit-code-conformance.test.js` too. The plan copied it into its Global Constraints and Task 2 and plan audit passed it; only the Task 2 implementer caught it at dispatch, where `grep -rnF` matched line 56 of the old file and nothing at HEAD.
  ```

  `spec-template.md`'s `## Acceptance Criteria` section, the new paragraph after the count paragraph:

  ```markdown
  A criterion asserting that a search returns nothing (a grep that "returns nothing", "prints no lines" or "exits 1") names a command its author has run once against a tree that still contains the target and seen match; prefer `grep -F` for literal code text. A search that cannot match its target passes before and after the change, so the criterion can never fail: #3536's AC1.1 was a basic-regex grep whose escapes never matched the literal it named.
  ```

  `spec-template.md`'s `## Delete + Tombstone Acceptance Criteria` section, the new paragraph after the `Never write a bare …` line:

  ```markdown
  Either way the scoped grep is an absence grep: run it once against the pre-deletion tree and confirm it matches the symbol before the criterion relies on it returning zero matches.
  ```

  `reflect/SKILL.md`: change `the observable outcome →\nAcceptance Criteria;` to the following. Keep the existing line break after `→`.

  ```markdown
  the observable outcome →
  Acceptance Criteria, where an outcome stated as a search that returns nothing is one the author has run against a tree that still holds the target and seen match, using `grep -F` for literal code text;
  ```

- [ ] **Step 4: Run the tests to verify they pass.**
  - Run `node --test tests/absence-grep-control-check-prose.test.js tests/specify-count-relative-ac.test.js tests/plan-authoring-reader-inventory-prose.test.js tests/plan-authoring-ac-clause-ids-prose.test.js`. Expected: PASS, with `# fail 0`.
  - Run `grep -nF "Absence-grep control check" plugin/skills/build/plan-authoring-checks.md`. Expected: exactly one line.
  - Run `wc -c plugin/skills/build/plan-authoring-checks.md`. Expected: under 52,500.

- [ ] **Step 5: Commit**

  ```bash
  git add plugin/skills/build/plan-authoring-checks.md plugin/skills/specify/spec-template.md plugin/skills/reflect/SKILL.md tests/absence-grep-control-check-prose.test.js
  git commit -m "Add an absence-grep control check to plan authoring and AC composition — run every returns-nothing search against a tree that still holds its target (refs #3571)" -m "Claude-Session: https://claude.ai/code/session_01FRS7xFKTt9TrTwCNWGu1WH"
  ```
