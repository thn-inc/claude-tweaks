# Settle 2 below-floor digest findings in review (#4649) Implementation Plan

**Goal:** Settle the two below-floor `review` findings promoted from digest #1426: pin the rename-old-path test's merge decision, and close out the filed-path `review-followup-` ledger write-back gap in the PR body.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T214319-record-4649/work/4649-spec.md` (materialized from GitHub issue #4649)

---

### Task 1: Pin the rename-old-path test to the merge outcome it implies

**Files:**
- Test: `tests/bin-lib/pre-review-catchup/cli.test.js`

- [ ] **Step 1: Failing test** — in `test("overlap counts a rename's old path")` (currently line 268), replace `assert.ok(['merged', 'conflict'].includes(r.json.outcome), ...)` with `assert.equal(r.json.outcome, 'merged')`, and add tree evidence that git's rename detection carried the upstream line-5 edit onto the renamed file: `c.txt`'s line 5 reads `O5` in the work checkout and `a.txt` no longer exists there. Before committing, show the new assertions can go red: temporarily make the fixture produce a conflict instead (for example, have the work branch also edit line 5 of `c.txt` before invoking), confirm the test fails on the `outcome` assertion, then revert that probe. Run the unmodified-fixture test 10 times in isolation to confirm `merged` is deterministic.
- [ ] **Step 2: Implement** — no production change. Deliverable 1 is the test above. Deliverable 2 (no ledger write-back when a staged `review-followup-` proposal is filed) is settled by a PR-body close-out under the maintainer's Reading A ruling. The refused-path gap is out of scope and tracked as #4772.
- [ ] **Step 3: Run** `node --test tests/bin-lib/pre-review-catchup/cli.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, `Pin the rename-old-path catch-up test to merged — refs #4649`.
- [ ] **Step 5: PR-body close-out** — write the close-out lines into draft PR #4776's body (the orchestrating session runs this, not the implementer):
  - Deliverable 1: fixed, with the test change above.
  - Deliverable 2, closed out: the filed path needs no write-back. `review/step3-routing.md` already writes the finding's ledger row as terminal `deferred` when the proposal is staged, and that row names `staged/review-followup-{n}.md`. This is the same convention `ledger-record-*` follows under `_shared/ledger-format.md`. Because terminal rows are final, approving the proposal at the console needs no further ledger change: the filed record's number is in the console's `decisions.md` line. The refused-path gap is #4772.
  - AC 2 already holds: both promoted digest lines on #1426 end `→ #4649`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Task 1 Steps 1–4. Deliverable 2 → Task 1 Step 5 (PR-body close-out, per Plan Review Clarifications Q1 Reading A). AC 1 → Steps 1 and 5. AC 2 → verified on #1426 (comments 6476790372 and 6518866799 both end `→ #4649`) and stated in Step 5.
- **Placeholders:** none.
