# pr-first-merge Step 3 arm-unavailable signature (#3521) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `_shared/pr-first-merge.md` Step 3 branch 1 recognize GitHub's `Protected branch rules not configured for this branch (enablePullRequestAutoMerge)` failure as the arm-unavailable case, so it degrades to Step 2.5's `wait` row instead of branch 5's park.

**Architecture:** A prose edit to one shared skill file (Step 3 item 1's signature list), pinned by extending the existing #1411 conformance tests in `tests/pr-first-merge.test.js` with a frozen pre-change copy of item 1 as the go-red control.

**Tech Stack:** Markdown skill prose; `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T045241-record-3521/work/3521-spec.md` (materialized from GitHub issue #3521)

## Global Constraints

- New literal, verbatim: `Protected branch rules not configured for this branch (enablePullRequestAutoMerge)` — dated and cited as PR #3450, 2026-10-18, beside the existing PR #1401 (2026-08-24) capture.
- The full captured error line, verbatim, for the citation: `GraphQL: Pull request Protected branch rules not configured for this branch (enablePullRequestAutoMerge)`.
- Byte budget: `plugin/skills/_shared/pr-first-merge.md` is 33,853 B against the shared 51,200 B ceiling; the largest composed `merge` bundle containing it is 47,658 B against plan-audit's 51,200 B composed ceiling (3,542 B headroom; `RAIL_BYTES` is 52,500 B). No file-specific pin exists (`git grep` of `tests/` for the basename next to a byte bound: none). Target addition: under 700 B.
- Commit messages: `{Verb} {what} — {detail}`, `refs #3521`, never `closes`/`fixes`.

## Review Focus

- A future GitHub wording that carries only `enablePullRequestAutoMerge` (neither literal) must still land in item 1 — pinned by the AC2.1 test asserting the token-alone clause.
- The widened match must not swallow item 2-5 signatures: `enablePullRequestAutoMerge` is the arm mutation's name, so a checks/conflict/permission failure on a plain `--squash` call (no `--auto`) never carries it — no test needed beyond the existing item-ordering pin; the reviewer confirms the prose scopes the token to `--auto` failures.
- Item 1's two sub-branches (merge-verification `off` vs `merge-when-green`/`wait`) stay unchanged — existing #1411 test 3 already pins them.

---

### Task 1: Add the PR #3450 signature and the token-alone match to Step 3 item 1

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md:319-324` (Step 3 item 1's lead paragraph)
- Test: `tests/pr-first-merge.test.js` (append after the #1411 block, ~line 246)

**Interfaces:**
- Consumes: the existing `MERGE` constant (live `pr-first-merge.md` text) and the item-1 slicing shape used by the `#1411: the literal signature sits inside Step 3's auto-merge-not-enabled branch` test.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing tests**

Add a frozen constant `PRE_3521_ITEM_1` holding the current item 1 lead paragraph verbatim (lines 319-324 of the base file, from `1. **Command failed with an auto-merge-not-enabled signature**` through `repository setting ("Allow auto-merge") being off:`), and a helper `item1Body()` returning `MERGE` sliced between `1. **Command failed with an auto-merge-not-enabled signature**` and `2. **Command failed with a checks-pending` within the `## Step 3: Attempt auto-merge` → `## Conflict path` span. Tests:

- `test('#3521 AC1.1 AC1.2: Step 3 item 1 carries the PR #3450 literal', …)` — `assert.ok(item1Body().includes('Protected branch rules not configured for this branch'))`; `assert.ok(item1Body().includes('PR #3450'))`; `assert.ok(item1Body().includes('2026-10-18'))`; go-red control: `assert.ok(!PRE_3521_ITEM_1.includes('Protected branch rules not configured for this branch'))`.
- `test('#3521 AC2.1: Step 3 item 1 names enablePullRequestAutoMerge alone as a matching token', …)` — `assert.match(item1Body(), /`enablePullRequestAutoMerge` alone/)`; go-red control: `assert.doesNotMatch(PRE_3521_ITEM_1, /`enablePullRequestAutoMerge` alone/)`.
- `test('#3521: Step 3 item 1 states allow_auto_merge without branch protection still fails to arm', …)` — `assert.match(item1Body(), /`allow_auto_merge: true`/)` and `assert.match(item1Body(), /branch protection or a ruleset/)`; go-red control: `assert.doesNotMatch(PRE_3521_ITEM_1, /`allow_auto_merge: true`/)`.

Waived AC3.1 (`npm test` passes): covered by the full-suite run in Step 4, not by a test.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pr-first-merge.test.js`
Expected: FAIL — the three `#3521` tests fail on their live-file assertions; every other test passes.

- [ ] **Step 3: Edit item 1's lead paragraph in `plugin/skills/_shared/pr-first-merge.md`**

Keep the PR #1401 literal and the `auto-merge` + (`not allowed` | `not enabled`) paraphrase; add, in this order: the second literal `Protected branch rules not configured for this branch` (captured verbatim on this repo, PR #3450, 2026-10-18: `GraphQL: Pull request Protected branch rules not configured for this branch (enablePullRequestAutoMerge)`); the clause that `enablePullRequestAutoMerge` alone in the error text also matches (the arm mutation's name, which GitHub appends to every arm-unavailable failure of an `--auto` call); and one sentence that `allow_auto_merge: true` without branch protection or a ruleset on the base branch still fails this way — the setting alone does not make `--auto` armable (the Step 2.5 "Why `--auto` alone is not a wait" mechanism). Edit in place; do not touch the sub-bullets below the lead paragraph.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/pr-first-merge.test.js` → Expected: PASS (all tests).
Run: `grep -c "Protected branch rules not configured for this branch" plugin/skills/_shared/pr-first-merge.md` → Expected: `1` or more.
Run: `npm test > "{scratchpad}/npm-test-3521.txt" 2>&1; echo exit=$?` (any session scratch path; `.txt`, never `.log`) → Expected: `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge.md tests/pr-first-merge.test.js
git commit -m "Recognize PR #3450's arm-unavailable wording in pr-first-merge Step 3 — enablePullRequestAutoMerge alone now matches item 1 (refs #3521)"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (second dated literal) → Step 3 + AC1.1/AC1.2 test; Deliverable 2 (token-alone paraphrase + allow_auto_merge sentence) → Step 3 + AC2.1 test + allow_auto_merge test; Deliverable 3 (extend the existing pin) → the three tests extend the #1411 block; AC3.1 → Step 4's `npm test`.
- **Placeholders:** none.
- **Proportion:** one task, one prose paragraph, three tests.
