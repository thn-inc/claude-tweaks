# pr-first-merge Step 3 — clean-status auto-merge signature (#3269) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name GitHub's `Pull request is in clean status (enablePullRequestAutoMerge)` arm refusal as a captured literal in `_shared/pr-first-merge.md` Step 3 item 1, and pin it with a conformance test.

**Architecture:** Prose-only contract change plus one conformance test. Most of #3269 already shipped in #3521 (`d49f7baf9`): item 1 already carries the `Protected branch rules not configured for this branch` literal (PR #3450) and the `enablePullRequestAutoMerge`-alone token match, and `tests/pr-first-merge.test.js` already pins both. That token match already routes the clean-status wording to item 1. This plan adds the captured literal itself, which the record's absorbed deliverable asks for: "Add the new wording to the same conformance/unit test."

**Tech Stack:** Markdown skill prose; `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T193800-record-3269/work/3269-spec.md` (materialized from GitHub issue #3269)

## Global Constraints

- The literal must sit inside Step 3 item 1's own text, i.e. the slice between `1. **Command failed with an auto-merge-not-enabled signature**` and `2. **Command failed with a checks-pending`.
- The literal `Pull request is in clean status` must stay on one line in the markdown, because the test uses `String.includes`.
- Keep these existing pinned phrases on single lines and unchanged: `` `enablePullRequestAutoMerge` alone ``, `unless item 3's or item 4's signature is also present`, `` `allow_auto_merge: true` ``, `branch protection or a ruleset`, `Protected branch rules not configured for this branch`, `PR #3450`, `Auto merge is not allowed for this repository`.
- Commit messages say `refs #3269`, never `closes`/`fixes`.

## Review Focus

- An existing #1411/#3521 pin breaks because a line re-wrap splits a pinned phrase. Run the whole `tests/pr-first-merge.test.js` file, not only the new tests.
- The go-red control is vacuous: it has to run the same predicate on the frozen pre-change text and get `false`.
- The frozen `PRE_3269_ITEM_1` must be the byte-exact current lead paragraph (lines 335–349 of `pr-first-merge.md` at base `36c1166e3`), so the control describes a text that really existed.
- Size: `pr-first-merge.md` is 36,950 B at base. +~300 B leaves ~15.2 KB of headroom under `RAIL_BYTES` (52,500).

## Prior-coverage map (Acceptance Criteria → test)

- **AC1.1** (Protected-branch wording → item 1): `#3521 AC1.1 AC1.2` plus `#3521 AC2.1` in `tests/pr-first-merge.test.js`. Already green at base; no new test.
- **AC2.1** (the test fails when the signature is removed): covered for the protected-branch literal by `#3521`'s frozen-text controls. Covered for the new literal by Task 1's control.
- **AC3.1** (clean-status wording → item 1, the `wait` row under `merge-when-green`): Task 1. The routing from item 1 to the `wait` row is pinned by the existing `#1411 ... always degrades` test.

---

### Task 1: Add the PR #3427 clean-status literal to Step 3 item 1

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md` (Step 3 item 1 lead paragraph, lines 335–349)
- Test: `tests/pr-first-merge.test.js` (append after the `#3521: the token-alone match yields to item 3's and item 4's signatures` test)

**Interfaces:**
- Consumes: the existing `item1Body()` helper in `tests/pr-first-merge.test.js`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing test.** Append to `tests/pr-first-merge.test.js`:
  - A comment block: `// #3269: PR #3427 (2026-10-18) captured a third arm-unavailable wording — GitHub refuses to arm a PR it could merge right now. Pin it as a literal in item 1, with a frozen pre-change control.`
  - `const PRE_3269_ITEM_1 = \`...\`;`, the byte-exact current item 1 lead paragraph. It runs from `1. **Command failed with an auto-merge-not-enabled signature** — stderr contains the literal` through `   mechanism):`, with backticks escaped as `\``.
  - `const carriesCleanStatus = (text) => text.includes('Pull request is in clean status') && text.includes('PR #3427');`
  - `test('#3269 AC3.1: Step 3 item 1 carries the PR #3427 clean-status literal', () => { assert.ok(carriesCleanStatus(item1Body())); assert.ok(item1Body().includes('2026-10-18')); });`
  - `test('#3269 AC2.1: the clean-status pin goes red on the pre-change item 1 text', () => { assert.equal(carriesCleanStatus(PRE_3269_ITEM_1), false, '[IL-105]'); assert.ok(PRE_3269_ITEM_1.includes('Protected branch rules not configured for this branch'), 'control text is the post-#3521 paragraph'); });`

- [ ] **Step 2: Run the test to verify it fails.**
  Run: `node --test tests/pr-first-merge.test.js`
  Expected: FAIL. `#3269 AC3.1` fails and `#3269 AC2.1` passes, because the control is already true at base.

- [ ] **Step 3: Implement.** In `plugin/skills/_shared/pr-first-merge.md` Step 3 item 1, replace the clause that ends the second literal's parenthetical, `` branch (enablePullRequestAutoMerge)`), or the looser paraphrase — `auto-merge` and ``, so that a third literal follows the PR #3450 one. Insert it before `or the looser paraphrase`, worded:
  `` or the third literal `Pull request is in clean status` (captured verbatim on this repo, PR #3427, 2026-10-18: `GraphQL: Pull request Pull request is in clean status (enablePullRequestAutoMerge)` — GitHub refuses to arm a PR it could merge right now), ``
  Re-wrap only the lines this insertion touches, to about 100 columns with 3-space continuation indent. Leave every pinned phrase in Global Constraints on a single line.

- [ ] **Step 4: Run the tests to verify they pass.**
  Run: `node --test tests/pr-first-merge.test.js`
  Expected: PASS, every test in the file, including the pre-existing #1411/#3521 tests.
  Run: `wc -c plugin/skills/_shared/pr-first-merge.md`
  Expected: below 52,500.

- [ ] **Step 5: Commit.**
  ```bash
  git add plugin/skills/_shared/pr-first-merge.md tests/pr-first-merge.test.js
  git commit -m "Name the clean-status auto-merge refusal in pr-first-merge Step 3 item 1 — refs #3269"
  ```

---

## Self-review

- **Spec coverage:** Deliverable 1 (Protected-branch signature) shipped in #3521. Deliverable 2 (other classifiers): searched; `dispatch/settle-and-merge.md`'s Auto-merge gate and `tidy/actions-github-issues.md`'s `## Arm ready PR` (which delegates to Step 3) do not classify stderr, and `plugin/bin` has no `gh pr merge` stderr parser (`git grep -n -i -e "auto merge is not allowed" -e "enablePullRequestAutoMerge" -- plugin` hits only `pr-first-merge.md`). Deliverable 3 (test) shipped in #3521. Absorbed deliverables (clean-status signature and test): Task 1.
- **Placeholders:** none.
