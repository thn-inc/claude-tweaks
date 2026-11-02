# Pin the below-floor parent-close skip rules across the prose gate and its Node mirror (#4800) Implementation Plan

**Goal:** A skip rule added to only one of Step 4.0b's prose gate and `closeBelowFloorParents` turns a conformance test red.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T063857-record-4800/work/4800-spec.md` (materialized from GitHub issue #4800)

---

### Task 1: Add the Step 4.0b skip-rule conformance test

**Files:**
- Modify: `plugin/bin/lib/issues/below-floor-parent-close.js` (one header-comment sentence naming the pin; no behavior change)
- Test: `tests/below-floor-parent-close-conformance.test.js`

Append a new `// ---- #4800: ... ----` block at the end of the test file, reusing its existing helpers (`read`, `section`, `collapse`, `closeSection`, `closeStep1`, `POST_MERGE_REL`, `STEP_40B`, `GATE_REL`).

**Prose side: three enumerators, each reading the live skill text.**

1. *Step 4.0b's skip sentences.* Take `section(read(POST_MERGE_REL), STEP_40B, '### Step 4.1')`, drop fenced code blocks, `collapse`, split with `/(?<=[.:;])\s+(?=[A-Z`*$])/`, and keep each sentence matching `/\b(skips?|skipped|no-op)\b/i`. Classify every kept sentence against an ordered table of `[anchor literal, disposition]`. A kept sentence matching no anchor fails naming the sentence and what to do (add a row, and implement the rule in `closeBelowFloorParents` if it skips a parent); an anchor matching no sentence fails too. Dispositions:

   | Anchor | Disposition |
   |---|---|
   | ``Under `local-files` `` | outside the mirror: the module is github-issues only |
   | `After a no-PR local merge it is a no-op unless` | outside the mirror: its caller only sees PR merges |
   | ``A `failed[]` or `pendingClose[]` record's live state`` | reason `sibling-unsettled` |
   | ``A `closeFailed[]` record holds its parent`` | reason `sibling-unsettled` |
   | ``After a PR merge, when `closingSet[]` is absent`` | outside the mirror: decided by the caller before the module runs |
   | ``A parent whose labels lack `parent-issue` `` | reason `not-parent-issue-labeled` |
   | ``Skip a parent whose verdict lists `needs` `` | reason `needs-label` |
   | ``A non-empty `held` skips the parent`` | reason `sibling-unsettled` |
   | ``With `gh` absent, every call`` | outside the mirror: transport, no skip of a parent |
   | `Every other outcome is a no-op` | the catch-all: enumerators 2 and 3 expand it, plus reason `above-floor` |
   | `Evaluate each parent once` | no reason: the module's `handled` set, silently |
   | ``how it skips on a failing `gh` call`` | failure `gh-failed`, not a deliberate skip |
   | `Then write one summary line` | outside the mirror: logging |
   | ``On the no-`closingSet[]` path above`` | outside the mirror: logging |

2. *The gate's no-op states.* From `section(read(GATE_REL), '## Evaluate the gate', '**Oversight-floor check')`, take each top-level `- ` bullet, read its backticked state names, and keep those whose bullet says `No-op`. This must yield `incomplete`, `gated`, `resolved` (a pass-through of the state name as the reason).

3. *The idempotence no-ops.* From `closeStep1(read(GATE_REL))`, take each ``- `value`:`` bullet whose text says `no-op`, and map it through `{ 'already-closed': 'already-closed', reopened: 'reopened-by-human' }`. A value with no map entry fails loudly.

The prose set is the union of the reasons from all three.

**Code side.** The deliberate set is `DELIBERATE_SKIP_REASONS` unioned with every reason literal in the module's comment-stripped source (`/\breason:\s*'([a-z-]+)'/g` and `/\breturn '([a-z-]+)'/g`) minus `gh-failed`, `internal-error` and `invalid-risk-floor`. Use the repo's shared comment stripper rather than a hand-rolled one. `tests/bin-lib/issues/below-floor-parent-close.test.js`'s `DELIBERATE_SKIP_REASONS is exactly the non-failure skips the module emits` already runs a world per reason, so this list is what `closeBelowFloorParents` emits; the test's comment cites it rather than restating its fake `gh`.

**Assertion.** The sorted prose set deep-equals the sorted code set; `gh-failed` appears in the source scan's failure literals, so the failing-`gh` disposition is real.

**Go-red controls, in the same file, on doctored in-memory text** (the file's existing convention):
- a Step 4.0b body with an added sentence ``Skip a parent whose verdict lists `blocked`.`` fails as an unclassified skip sentence;
- a Step 4.0b body with the `needs` sentence removed fails (the anchor no longer matches);
- a code set with one added reason fails the set comparison, and so does one with a reason removed.

Structure the enumerators and the comparison as functions taking text and sets as parameters so these controls run the real code.

- [ ] **Step 1: Failing test** — write the test above and run `node --test tests/below-floor-parent-close-conformance.test.js`. The new test should pass against the live text, since both sides agree today (the spec says so); its go-red controls are the assertions that prove it can fail. Report that, per the plan's Step 3.
- [ ] **Step 2: Implement** — add one sentence to `below-floor-parent-close.js`'s header comment naming `tests/below-floor-parent-close-conformance.test.js`'s #4800 block as the pin on the skip reasons. No behavior change.
- [ ] **Step 3: Temporary-edit proof (the spec's acceptance criterion)** — in a scratch copy, never in this worktree: (a) add a new `skipped.push({ parent, reason: 'new-rule' })` line to the module and see the new test red; (b) add a new skip sentence to Step 4.0b's prose and see it red. Quote both raw failure lines in the report.
- [ ] **Step 4: Run** `node --test tests/below-floor-parent-close-conformance.test.js tests/bin-lib/issues/below-floor-parent-close.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js` — PASS.
- [ ] **Step 5: Commit** — one commit, `Pin the below-floor parent-close skip rules across prose and code — refs #4800`.

---

## Self-review

- **Spec coverage:** the Deliverable is Task 1's test. The Acceptance Criterion's temporary edit is Step 3; `npm test` runs in `/build`'s Common Step 5.
- **Placeholders:** none.
