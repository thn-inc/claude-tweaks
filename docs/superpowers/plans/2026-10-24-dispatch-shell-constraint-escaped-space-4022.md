# dispatch/task-prompt.md: the worktree shell constraint list omits the backslash-escaped-space path shape (#4022) Implementation Plan

**Goal:** The dispatch Task-prompt template's shell-constraint item (`plugin/skills/dispatch/task-prompt.md` item 6) leaves out a path spelled with a backslash-escaped space. `_shared/scratch-worktree.md` §7 already lists that shape as refused, so dispatched agents keep rediscovering it by being refused.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T174538-record-4022/work/4022-spec.md` (materialized from GitHub issue #4022)

---

### Task 1: Add the backslash-escaped-space shape and its double-quoted fix to item 6's avoid-shapes list

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md` (item 6, "Avoid these shapes:" list)
- Test: `tests/scratch-worktree-shell-constraint-table.test.js` (append one test)

Copy survey, done at plan time: `git grep -n "quoted JSON containing"` and `git grep -n "a glob argument"` find the enumerated avoid-shapes list in exactly one live file, `plugin/skills/dispatch/task-prompt.md:38`. The other hits are historical spec and plan files under `.claude-tweaks/pipelines/` and `docs/superpowers/plans/`, which are not live copies. `_shared/subagent-dispatch-core.md` cites §7 rather than restating the list. No test byte-pins the item 6 sentence: `git grep` over `tests/` for its phrases returns nothing. So the "align every other copy" clause has no other copy to edit. The new test is what keeps item 6 and §7 in agreement from here on.

- [ ] **Step 1: Failing test.** Append a test to `tests/scratch-worktree-shell-constraint-table.test.js`. It reads `plugin/skills/dispatch/task-prompt.md`, takes item 6 (from `6. **Worktree shell constraint**` up to `7. **`), and asserts three things:
  - item 6 names a backslash-escaped space in a path (literal `backslash-escaped space`)
  - item 6 gives the double-quoted form as the fix (literal `double-quote`)
  - §7's table still carries a `refused` row whose Shape cell starts `Backslash-escaped space`, so both files agree on the verdict
- [ ] **Step 2: Implement.** In item 6's "Avoid these shapes:" list, add after the `cat "$P/…"` entry: `a path spelled with a backslash-escaped space (e.g. Code\ Workspaces — double-quote the whole path instead, "/Users/…/Code Workspaces/…"; §7's row)`. Edit in place and leave the other list entries untouched.
- [ ] **Step 3: Run** `node --test tests/scratch-worktree-shell-constraint-table.test.js`. Expected result is PASS. Then revert the Step 2 edit and re-run to watch it go red.
- [ ] **Step 4: Commit.** One commit, message drawn from the spec title, `refs #4022`.

---

## Self-review

- **Spec coverage:**
  - Deliverable "add the shape to item 6 with the double-quoted fix, citing §7" is covered by Step 2.
  - Deliverable "check the other copies and align them, and any test that byte-pins the sentence" is covered by the copy survey above (none exist) and the Step 1 agreement test.
  - AC 1 (item 6 names the shape and its fix) is covered by Step 1's assertions.
  - AC 2 (every other copy agrees) is covered by the survey plus the agreement assertion against §7.
  - AC 3 (`npm test` passes) is covered by Common Step 5.
- **Placeholders:** none.
