# Driver: the push guard misses a same-commit branch switch (#5458) Implementation Plan

**Goal:** The pipeline driver's push guard (`pushStep`) also checks that `refs/heads/{branch}` is the commit `check` verified, so a same-commit branch switch or detached HEAD cannot push a branch missing its latest commit.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T122114-spec-5458/work/5458-spec.md` (materialized from GitHub issue #5458)

---

### Task 1: Add the push guard's branch check, update Worker rights, and test it

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js` (`pushStep`)
- Modify: `docs/driver.md` (`## Worker rights`)
- Test: `tests/bin-lib/driver/run.test.js`

- [ ] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe, and run them before Step 2. A test already green at base proves nothing about this fix: add an assertion that goes red, or say in the report why none can.
  - AC1: over the fake runner, `refs/heads/{branch}` reads a sha other than `check`'s head while `HEAD` itself reads the checked sha → the record stops at the `push` step, and no `git push` call is recorded.
  - AC2: the `refs/heads/{branch}` read fails → the record stops at the `push` step with a fixed detail (no git stderr in it), and no `git push` call is recorded.
  - AC3: on the Phase 1 happy path, the recorded calls differ from before only by the one added `rev-parse --verify --end-of-options refs/heads/{branch}` read, immediately before the push; the event lines are unchanged.
  - AC4: `grep -F "A branch switch is caught only when it changes the commit HEAD points at" docs/driver.md` matches at base and returns nothing after the change, and `## Worker rights` names the push guard's branch check.
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above: in `pushStep`, after the existing HEAD comparison and before `git push`, run `git rev-parse --verify --end-of-options refs/heads/{branch}` and return `{ status: 'stop' }` (the step's pre-push stop class) when it is not `check`'s head, naming the branch and both shas, every value through `neutralize`; a failed read returns a stop with a fixed detail, never git's stderr. Replace the `## Worker rights` same-commit-switch limit sentence with the push guard's branch check.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #5458`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is
  covered by Task 1's Files/Steps above.
- **Placeholders:** none.
