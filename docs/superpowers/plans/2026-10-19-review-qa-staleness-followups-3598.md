# Close the #3047 QA-staleness follow-ups (#3598) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five gaps #3047 left in `/claude-tweaks:review`'s post-fix-wave QA re-run and stale-QA qualifier.

**Architecture:** Prose-only change to two review skill files, pinned by the existing conformance suite. Step 3 Routing fix waves join the same single affected-story re-run (one `WAVE_BASE` per review, captured before the first fix of either wave). The capture becomes dirty-tree-safe, the touched-file set gains untracked files, the wider-than-wave selection is stated as accepted, and the template gains a never-run rule.

**Tech Stack:** Markdown skill prose; `node --test` conformance suite.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T201721-record-3598/work/3598-spec.md` (materialized from GitHub issue #3598)

## Global Constraints

- `plugin/skills/review/code-mode-steps.md` must stay at or under `RAIL_BYTES` (52,500 B). Merge-base size is 44,148 B (84%). This plan adds about 1,700 B, so roughly 45,900 B (87%), under the 90% near-ceiling flag.
- Commit messages say `refs #3598`, never `closes`/`fixes`.
- Decision for Deliverable 1, recorded here so the implementer does not re-decide it: **Step 3 Routing fix waves DO re-run affected QA stories.** Narrowing the qualifier to Step 6.7 only would leave a Step-3 UI fix behind a green, pre-wave QA line, which is the false freshness #3047 exists to prevent.

## Review Focus

1. A Step-3-only fix wave where Step 6.7 never runs: the re-run still has to happen, before Step 7. Pinned by `AC1.1 (#3598)`.
2. A clean tree at capture time: `git stash create` prints nothing, so the fallback to `git rev-parse HEAD` must be stated. The record's own suggestion, `git stash create || git rev-parse HEAD`, leaves `WAVE_BASE` empty on a clean tree, because `stash create` exits 0 with empty output. Probed in a scratch repo (see Task 1, Step 3). Pinned by `AC3.1 gap 3`.
3. Pre-wave status `Not run` plus a post-wave re-run that executed: the line must not read `ALL PASSED` over stories that never ran. Pinned by `AC2.1`.
4. An uncommitted Fix-now edit that only creates a new file: it must count toward the intersection. Pinned by `AC3.1 gap 2`.
5. Two waves, one base: Step 6.7 must keep Step 3's earlier SHA rather than recapturing, or Step 3's files drop out of the diff. Pinned by `AC1.1 (#3598)`.

---

### Task 1: Close the five gaps in Step 3 Routing, Step 6.7 and the QA Validation template

**Files:**
- Modify: `plugin/skills/review/code-mode-steps.md` (Step 3 Routing section, about line 265; Step 6.7 opening paragraph, about line 336; Step 6.7 item 4, about line 350)
- Modify: `plugin/skills/review/review-summary-template.md` (QA Validation section, about lines 54-64)
- Test: `tests/review-qa-rerun-after-fix-wave-conformance.test.js`

**Interfaces:**
- Consumes: the existing `step67`, `step7`, `qa` slices in the test file.
- Produces: a new `step3` slice, `steps.slice(steps.indexOf('### Step 3 Routing — Code Review Findings'), steps.indexOf('## Step 4:'))`. Add both headings to the existing anchor-heading assertion loop.

- [ ] **Step 1: Update and add the failing tests**

In `tests/review-qa-rerun-after-fix-wave-conformance.test.js`:

Replace AC1.1's two `WAVE_BASE=$(git rev-parse HEAD)` assertions (the `includes` and the before-item-1 `indexOf` ordering) with the same two assertions over `` '`git stash create`' ``. Keep a separate `includes` for `` '`git rev-parse HEAD`' ``.

Add:

```js
test('AC1.1 (#3598): a Step 3 Routing fix wave gets the same affected-story re-run, one base per review', () => {
  assert.ok(step3.includes('**QA after a Step 3 fix wave (#3598).**'));
  assert.ok(step3.includes('once per review, not once per wave'));
  assert.ok(step3.includes('Before Step 3 Routing applies its first fix'));
  assert.ok(step3.includes('When Step 6.7 does not run, run its item 4 on its own, right before Step 7'));
  assert.ok(step67.includes('unless Step 3 Routing already captured it this review'));
  assert.ok(step67.includes('if any fix was applied in either wave (Step 3 Routing or this step)'));
});

test('AC2.1: the template says what the QA line reads when the pre-wave status was Skipped or Not run', () => {
  assert.ok(qa.includes('**Never-run pre-wave status (#3598):**'));
  assert.ok(qa.includes(' — post-wave re-run only ({ids}); no pre-wave QA results'));
  assert.ok(qa.includes('there is no earlier pass to call stale'));
  assert.ok(step67.includes("there is nothing to merge into, and the QA line renders per `review-summary-template.md`'s never-run rule"));
});

test('AC3.1 gap 2: untracked new files from an uncommitted Fix-now edit count toward the intersection', () => {
  assert.ok(step67.includes('`git ls-files --others --exclude-standard`'));
});

test('AC3.1 gap 3: a tree dirty before the wave is captured by git stash create, falling back to HEAD on a clean tree', () => {
  assert.ok(step67.includes('it writes no stash entry and leaves the tree alone'));
  assert.ok(step67.includes('when it prints nothing (a clean tree), run `git rev-parse HEAD` instead'));
});

test('AC3.1 gap 5: the wider-than-wave qa affected selection is stated as accepted', () => {
  assert.ok(step67.includes('accepted (#3598): that set is wider than the wave'));
  assert.ok(step67.includes('never misses a touched story'));
});

test('AC1.1 (#3598): the template qualifier covers both waves from one base', () => {
  assert.ok(qa.includes("Step 3 Routing's, Step 6.7's, or both, all measured from one `{WAVE_BASE}`"));
});
```

- [ ] **Step 2: Run the suite and confirm it fails**

Run: `node --test tests/review-qa-rerun-after-fix-wave-conformance.test.js`
Expected: FAIL. The new tests and the edited AC1.1 fail because the phrases are absent.

- [ ] **Step 3: Edit `plugin/skills/review/code-mode-steps.md`**

(a) After the Step 3 Routing paragraph (the one ending "...per `test/verification.md`'s \"Re-verify scoping\" table (review-fix row)."), add a new paragraph, verbatim:

> **QA after a Step 3 fix wave (#3598).** A Step 3 Routing fix that touches a story's `source_files` leaves QA as stale as a Step 6.7 fix does, so it gets Step 6.7 item 4's affected-story re-run too — once per review, not once per wave. Before Step 3 Routing applies its first fix (AUTO or Fix now), capture `WAVE_BASE` exactly as Step 6.7's opening describes; Step 6.7 then keeps that SHA, and its item 4 covers both waves' files. When Step 6.7 does not run, run its item 4 on its own, right before Step 7, against the same `WAVE_BASE`. A Step 5 simplification edit made after that capture falls inside the same diff and counts the same way.

(b) In the Step 6.7 opening paragraph, replace the sentence `Before item 1, capture `WAVE_BASE=$(git rev-parse HEAD)` — item 4 diffs the fix wave against it.` with:

> Before item 1, capture `WAVE_BASE` — unless Step 3 Routing already captured it this review, in which case keep that earlier SHA so item 4 covers both waves. Run `git stash create` on its own: on a tree already dirty before the wave it prints a commit holding that pre-wave state (it writes no stash entry and leaves the tree alone), so pre-wave edits never count as wave edits; when it prints nothing (a clean tree), run `git rev-parse HEAD` instead. Item 4 diffs the fix wave against it.

Leave the following "Shell state does not persist..." sentence unchanged. Verified in a scratch repo (`probe-wave-base.sh`, 2026-10-19). Clean tree: `stash create` printed nothing and the fallback gave HEAD. Dirty tree: it gave a non-HEAD commit, `git stash list` stayed at 0 entries, `git diff --name-only {base}` listed only the wave's file and not the pre-wave edit, and `git rev-list --count {base}..HEAD` counted the one wave commit.

(c) In item 4, make three in-place edits:
- `if any fix was applied — auto-applied (AUTO) or interactive Fix now alike —` becomes `if any fix was applied in either wave (Step 3 Routing or this step) — auto-applied (AUTO) or interactive Fix now alike —`
- `(`git diff --name-only {WAVE_BASE}`)` becomes ``(`git diff --name-only {WAVE_BASE}`, plus the untracked new files `git ls-files --others --exclude-standard` lists, since an uncommitted Fix-now edit can create one; on a tree dirty before the wave that also counts its pre-wave untracked files, which only ever adds a re-run)``
- After `(it selects by `source_files` ∩ `verify.js --changed-files`, per `test/SKILL.md`'s `qa affected` row)`, insert: `— accepted (#3598): that set is wider than the wave, so the re-run can include stories the wave did not touch; that costs extra runs but never misses a touched story, since a touched story the re-run does not execute gets the qualifier below —`
- After `(re-run stories take their new result, the rest keep theirs)`, insert: `; with no pre-wave per-story results (pre-wave status Skipped or Not run) there is nothing to merge into, and the QA line renders per `review-summary-template.md`'s never-run rule`

Keep every other #3047-pinned phrase in item 4 byte-identical. `node --test` on the suite proves this.

- [ ] **Step 4: Edit `plugin/skills/review/review-summary-template.md`**

(a) In the **Stale-QA qualifier (#3047):** paragraph, replace `when `code-mode-steps.md` Step 6.7 applied a fix wave that touched` with `when the review applied a fix wave — Step 3 Routing's, Step 6.7's, or both, all measured from one `{WAVE_BASE}` (`code-mode-steps.md` Step 3 Routing and Step 6.7) — that touched`.

(b) Add a paragraph right after that one, verbatim:

> **Never-run pre-wave status (#3598):** the qualifier attaches only to a status built from stories that actually ran. When the pre-wave status was `Skipped — no stories`, `Skipped — no dev server`, or `Not run`, there are no pre-wave per-story results to merge into. If the post-wave re-run executed stories, render its status over those stories, followed by ` — post-wave re-run only ({ids}); no pre-wave QA results`. If it executed none, keep the pre-wave status as it was, with no qualifier — there is no earlier pass to call stale.

- [ ] **Step 5: Run the suite and the rail check, and confirm they pass**

Run: `node --test tests/review-qa-rerun-after-fix-wave-conformance.test.js`
Expected: PASS, every test, including AC5.1 (`code-mode-steps.md` under the rail).
Run: `wc -c plugin/skills/review/code-mode-steps.md`
Expected: about 45,900. It must be at most 52,500.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/review/code-mode-steps.md plugin/skills/review/review-summary-template.md tests/review-qa-rerun-after-fix-wave-conformance.test.js
git commit -m "Cover Step 3 Routing fix waves in review's QA re-run and close the #3047 gaps — refs #3598"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 is covered by Step 3(a), 3(b) and 4(a); the decision is in Global Constraints. Deliverable 2 is covered by Step 4(b) and Step 3(c)'s last edit. Deliverable 3 is covered as follows: gap 2 fixed in 3(c), gap 3 fixed in 3(b), gap 5 accepted in 3(c), each pinned in Step 1. AC1 (Step 3 Routing statement) is pinned by `AC1.1 (#3598)`, AC2 (template Skipped/Not run) by `AC2.1`, and AC3 (gaps pinned) by `AC3.1 gap 2/3/5`.
- **Placeholders:** none.
- **Moved-prose pins:** the only #3047 pin this plan changes is AC1.1's `WAVE_BASE=$(git rev-parse HEAD)`, updated in Step 1. A grep of `tests/` and `plugin/` for `WAVE_BASE`, `stale-QA qualifier` and `pre-wave` found no other pin outside this suite. The journey `docs/journeys/trust-the-qa-line-after-a-review-fix-wave-3047.md` describes Step 6.7's capture and is unpinned; `/build` Common Step 6 (journeys) updates it.
