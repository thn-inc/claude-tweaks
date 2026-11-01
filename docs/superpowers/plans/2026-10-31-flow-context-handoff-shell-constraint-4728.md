# flow: carry the worktree shell constraint into the context-handoff continuation template (#4728) Implementation Plan

**Goal:** Give `plugin/skills/flow/context-handoff.md`'s continuation template the worktree shell-constraint item it lacks, so a /flow context-handoff child is told the harness's Bash limits up front.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T162459-record-4728/work/4728-spec.md` (materialized from GitHub issue #4728)

---

### Task 1: Add the worktree shell-constraint item to the continuation template and pin it

**Files:**
Modify: `plugin/skills/flow/context-handoff.md`
Test: `tests/flow-context-handoff-conformance.test.js`

- [ ] **Step 1: Failing test** — extend `tests/flow-context-handoff-conformance.test.js` with a test asserting the fenced continuation template contains a worktree shell-constraint item that cites `_shared/scratch-worktree.md` §7 and `subagent-dispatch-core.md`'s "One plain command per Bash call", and tells the child to forward it to any agent it dispatches; plus a go-red check showing the assertion fails on the template with that item removed.
- [ ] **Step 2: Implement** — add the item to the template (between the Working directory and Plugin root paragraphs), citing rather than restating the refusal table, as `dispatch/task-prompt.md` item 6 does.
- [ ] **Step 3: Run** `node --test tests/flow-context-handoff-conformance.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4728`.

---

## Self-review

- **Spec coverage:** Deliverable 1 and AC 1 → Step 2; Deliverable 2 and AC 2 → Step 1; AC 3 (`npm test` passes) → Common Step 5.
- **Placeholders:** none.
