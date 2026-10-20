# wrap-up Section D kills the recorded pid without validating it and has no branch for a port still held after the kill (#3664) Implementation Plan

**Goal:** Make wrap-up's Section D (`plugin/skills/wrap-up/cleanup-procedures-execution.md`) validate the `ephemeral-server.txt` record before it signals anything. Also give Step 4 a defined outcome for a port still held after the kill: keep the record and report a cleanup failure, never delete the file.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T124119-record-3664/work/3664-spec.md` (materialized from GitHub issue #3664)

---

### Task 1: Validate the record before Section D acts, and define the port-still-held outcome

**Files:**
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md` (Section D, steps 2 and 4 — keep the 2-4 numbering, since `review/step3-routing.md` and `docs/skill-graph.md` cite "Section D steps 2-4")
- Test: `tests/ephemeral-server-handoff-conformance.test.js` (new Section D assertions plus go-red controls)
- Modify: `tests/review-fix-ephemeral-server-conformance.test.js` (its AC2.1 pins the old step 4 sentence `Confirm the port is free, then delete \`ephemeral-server.txt\``. Keep that sentence's prefix intact so this pin still holds, and add the new branch after it.)

- [ ] **Step 1: Failing test.** Add to `tests/ephemeral-server-handoff-conformance.test.js`:
  - In Section D's body, the record validation (fewer than four fields, a pid or port that is not a positive integer, or no trailing `detached:` token) appears before the first `kill {pid}` / `taskkill`. It is called unprovable, the condition is logged, and the record says to signal nothing.
  - In Section D's body, the step 4 port-still-held branch keeps `ephemeral-server.txt` (does not delete it), logs the condition, and reports a cleanup failure naming the survivor.
  - Go-red controls: removing the validation sentence fails the first predicate, and reverting step 4 to the bare "Confirm the port is free, then delete" line fails the second.
  - Run: `node --test tests/ephemeral-server-handoff-conformance.test.js`. Expected: FAIL (the new predicates are red against the current text).
- [ ] **Step 2: Implement.** Edit Section D step 2 so it opens with the validation gate. An unprovable record means: log `SKIP` via `log-decision.js` naming the condition, leave the file and every process alone, and stop nothing. Edit step 4 to add the port-still-held branch: keep the record, log `SKIP` naming the condition, and report a cleanup failure naming the recorded pid and the port still held, instead of deleting the file.
- [ ] **Step 3: Run** `node --test tests/ephemeral-server-handoff-conformance.test.js tests/review-fix-ephemeral-server-conformance.test.js`. Expected: PASS.
- [ ] **Step 4: Commit** with one commit whose message is drawn from the spec title, `refs #3664`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (validation before step 2 acts) is Step 2's step-2 edit. Deliverable 2 (port-still-held outcome) is Step 2's step-4 edit. Deliverable 3 (a conformance test that goes red against the current text) is Step 1 plus its go-red controls. AC "pid `0`, `-1`, or non-numeric → log, signal nothing" is covered by the positive-integer clause. AC "port still held → file not deleted, report names the survivor" is covered by step 4's branch. AC "`npm test` passes in full" is checked in Common Step 5.
- **Placeholders:** none.
