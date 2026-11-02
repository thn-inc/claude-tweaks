# Run below-floor-parent-close parent-level skip gates before the per-sibling reads (#4799) Implementation Plan

**Goal:** `closeBelowFloorParents` evaluates the parent-level skip gates (`not-parent-issue-labeled`, `needs-label`, `sibling-unsettled`) before any per-sibling `gh issue view`, so a skipped parent costs no per-sibling reads.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T205251-record-4799/work/4799-spec.md` (materialized from GitHub issue #4799)

**Premise note:** the spec's Key Files name only `below-floor-parent-close.js`, but since #4603 the gather lives in the shared core `plugin/bin/lib/issues/parent-gate.js` (`gatherGateFacts`: resolve -> enumerate (shape 3/4) -> per-sibling reads (shape 5) -> parent labels (shape 6)). To reorder without duplicating shape 5's validation, extract the shape-5 and shape-6 reads into exported helpers in `parent-gate.js`; `gatherGateFacts` keeps its existing call order (bin/parent-gate.js and `tests/bin-lib/issues/parent-gate.test.js`'s "makes the call shapes in order" pin are unaffected).

---

### Task 1: Gate the parent before enumerating and reading its sub-issues

**Files:**
- Modify: `plugin/bin/lib/issues/parent-gate.js` — extract `readSubIssueFacts({ num, slug, caller })` (shape 5, the per-sub-issue `issue view ... --json state,stateReason,labels,title,closedByPullRequestsReferences` read plus its `closedByPullRequestsReferences` validation, returning `{ number, title, state, stateReason, labels, closedBy }`) and `readParentLabels({ parent, slug, caller })` (shape 6, returning the normalized label names) out of `gatherGateFacts`, which then calls them with its call order and outputs byte-identical; add both to `module.exports`. Pure move — no behavior change for `gatherGateFacts`.
- Modify: `plugin/bin/lib/issues/below-floor-parent-close.js` — replace the `gatherGateFacts` call with, in order: (1) `readParentLabels` (shape 6); (2) a parent-level screen over a labels-only verdict (`evaluateParentGate` with `subIssues: []`) — `not-parent-issue-labeled` / `needs-label` skip here, with no enumeration and no per-sibling read; (3) `enumerateSubIssues` (shape 3/4); (4) the same screen over a numbers-only verdict (`subIssues: numbers.map((number) => ({ number }))`) — `sibling-unsettled` skips here, with no per-sibling read; (5) `readSubIssueFacts` per number, ascending; (6) the full `evaluateParentGate` + `skipReason` as today. Factor the three parent-level checks out of `skipReason` into one `parentLevelSkip(verdict)` that `skipReason` calls first, so the order and reason strings have one source. Update the file header comment to state the new read order and why (#4799: REST core-limit exhaustion on 2026-10-31). Keep `require('./parent-gate')` the only issues-core require (the `parent-gate.test.js` "composes the shared core" test forbids `./acceptance`, `./oversight-floor`, `./native-dependencies`, `./comment-trust`, and the literal `sub_issues`).
- Test: `tests/bin-lib/issues/below-floor-parent-close.test.js` — add tests using the existing `makeGh` fake (it records every call in `calls`).

- [ ] **Step 1: Failing test** — add three tests in `tests/bin-lib/issues/below-floor-parent-close.test.js`, each asserting that no per-sibling read ran: no call whose argv joined matches `/^issue view \d+ --repo o\/r --json state,stateReason,labels,title,closedByPullRequestsReferences$/`:
  1. A parent that fails the parent-label gate (`parentLabels: { 10: ['enhancement'] }`): skipped `not-parent-issue-labeled`, no per-sibling read, and no enumeration either (no `subIssues(first:100)` GraphQL page, no `sub_issues` REST read, no `__type` probe), with the calls counted exactly: under `workLinks: 'native'`, exactly 2 calls (the parent-resolution GraphQL read and the parent-label read).
  2. A parent carrying `needs:decision`: skipped `needs-label`, no per-sibling read, no enumeration.
  3. `unsettled: [12]` on an otherwise happy world: skipped `sibling-unsettled`, no per-sibling read (enumeration is allowed: the gate needs the sub-issue numbers).
  Run them before Step 2, `node --test tests/bin-lib/issues/below-floor-parent-close.test.js`, and confirm all three are RED on the current code (it reads both siblings before the label read).
- [ ] **Step 2: Implement** — the two Modify entries above.
- [ ] **Step 3: Run** — `node --test tests/bin-lib/issues/below-floor-parent-close.test.js tests/bin-lib/issues/parent-gate.test.js tests/below-floor-parent-close-conformance.test.js tests/bin-lib/reconcile/post-merge.test.js tests/parent-gate-cli.test.js`: all PASS (the existing tests, the one checking that a failing sibling read reports `gh-failed` included, must stay green unchanged).
- [ ] **Step 4: Commit** — one commit: `Run below-floor-parent-close parent-level skip gates before the per-sibling reads — no sibling reads for a skipped parent, refs #4799`.

---

## Self-review

- **Spec coverage:** the Deliverable (gates before sibling enumeration; a skipped parent costs no per-sibling reads) is Step 2; the AC's fake-`gh` call-counting test for a parent failing the parent-label gate is Step 1's test 1; `npm test` passes is Common Step 5's verification.
- **Placeholders:** none.
