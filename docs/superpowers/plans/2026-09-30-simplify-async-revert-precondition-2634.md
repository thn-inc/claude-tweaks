# simplify dispatch: caller can observe a still-in-flight async Task write as "done" (#2634) Implementation Plan

**Goal:** Amend `/claude-tweaks:simplify`'s Step 2 file-path-scope paragraph so the diff-and-revert check has an explicit precondition — it runs only after the subagent's final reply (its required `STATUS:` line) has been received, never against an ad hoc `git status` poll taken while the dispatch may still be running.

**Spec:** `.claude-tweaks/pipelines/2026-09-30T121633-record-2634/work/2634-spec.md` (materialized from GitHub issue #2634)

---

### Task 1: Amend the file-path-scope paragraph with an explicit completion precondition

**Files:**
- Modify: `plugin/skills/simplify/SKILL.md`

- [x] **Step 1: Failing test** — prose-only change; the repo's prose-conformance suites (`npm test`) pin skill text and would fail to find the new precondition wording before this edit.
- [x] **Step 2: Implement** — name receipt of the subagent's final `STATUS:`-line reply as the precondition for the diff-and-revert check, and state that a working-tree check taken before that reply is not the agent's final state and must not drive a revert.
- [ ] **Step 3: Run** `npm test` — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #2634`.

---

## Self-review

- **Spec coverage:** Deliverables 1-2 and Acceptance Criteria 1-3 are covered by Task 1's single-file edit — no other `/claude-tweaks:simplify` step changes.
- **Placeholders:** none.
