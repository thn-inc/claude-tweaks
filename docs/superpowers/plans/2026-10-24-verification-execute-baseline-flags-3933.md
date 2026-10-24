# verification.md execute block omits the pipeline-site baseline flags (#3933) Implementation Plan

**Goal:** Make `plugin/skills/test/verification.md`'s "Not skipped — execute" block itself tell a pipeline site (`$PIPELINE_RUN_DIR` set) to append the baseline-adjudication flags, citing the Baseline adjudication section for the exact form.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T064959-record-3933/work/3933-spec.md` (materialized from GitHub issue #3933)

**Byte budget (Byte-pin check):** `verification.md` is 52,380 B against `RAIL_BYTES` 52,500 (`plugin/bin/lib/skill-audit/budgets.js`) — 120 B headroom. The new paragraph is 247 B, so the task also trims three non-pinned parentheticals/rationale clauses in the same Step 2 area (176 B saved, measured with a scratch script against the live file). Final size 52,451 B, 49 B under the rail. Grepped `tests/` for every trimmed phrase (`refuses two of them`, `IL-108`, `1904`, `2688`): no pins.

---

### Task 1: State the pipeline-site baseline flags inside the execute block

**Files:**
- Modify: `plugin/skills/test/verification.md`
- Test: `tests/bin-lib/verify/snippet-conformance.test.js`

- [ ] **Step 1: Failing test** — append to `tests/bin-lib/verify/snippet-conformance.test.js`:

```js
test('AC1.1: the execute block itself tells a pipeline site to append the baseline flags and where the form lives (#3933)', () => {
  const start = DOC.indexOf('**Not skipped — execute.**');
  const end = DOC.indexOf('### Reading the result');
  assert.ok(start !== -1 && end > start, 'execute block bounds must exist');
  const block = DOC.slice(start, end);
  assert.ok(block.includes('With `$PIPELINE_RUN_DIR` set'), 'names the pipeline-site condition');
  assert.ok(block.includes('`--baseline`/`--baseline-cmd`'), 'names both baseline flags');
  assert.ok(block.includes('`retry.{check}` template'), 'names the retry-template precondition');
  assert.ok(block.includes('exact form under Baseline adjudication below'), 'points at the section holding the exact form');
});
```

  Run: `node --test tests/bin-lib/verify/snippet-conformance.test.js`
  Expected: FAIL (the execute block carries none of the four literals today; it mentions `--baseline` and Baseline adjudication only in the fail-fast parenthetical).

- [ ] **Step 2: Implement** — three edits in `plugin/skills/test/verification.md`:

  a. Directly after the fenced canonical invocation (the ```` ```bash ```` block holding `--cmd types="tsc --noEmit" --cmd lint="eslint ." --cmd tests="npm test"`), before the `` `--run` names the pipeline run`` paragraph, insert this paragraph (followed by one blank line):

  ```
  **Pipeline sites add the baseline flags.** With `$PIPELINE_RUN_DIR` set, append `--baseline`/`--baseline-cmd` (and any `--cmd-env`) for each check the declaration gives a `retry.{check}` template — exact form under Baseline adjudication below.
  ```

  b. replacing:
  ```
  This is why the invocation above is one plain command with no `$(...)` substitutions — the worktree Bash-shape guard (`_shared/scratch-worktree.md` §7) refuses two of them in one command.
  ```
  with:
  ```
  Hence no `$(...)` in the invocation above: the worktree Bash-shape guard (`_shared/scratch-worktree.md` §7) refuses two in one command.
  ```

  c. In the **Foreground rule** paragraph, replacing `` (`[IL-108]`'s family: #1904's first call stalled waiting on a background verify child's notification that never arrived) `` with `` (`[IL-108]`; #1904) ``, and replacing `(#2688's wrap-up reflection)` with `(#2688)`.

  Do not touch the fenced canonical invocation itself (`snippet-conformance.test.js` and `verification-skip-before-execute.test.js` pin it byte-for-byte), and add no indented `node ".../bin/verify.js" ... --baseline` line (the Baseline adjudication snippet must stay the only one).

- [ ] **Step 3: Run** `node --test tests/bin-lib/verify/snippet-conformance.test.js tests/verification-skip-before-execute.test.js tests/timing-prose-conformance.test.js tests/test-skill-affected-conformance.test.js tests/verification-flake-handling.test.js` — PASS; `wc -c plugin/skills/test/verification.md` — at most 52,500 (expected 52,451). Go-red: the Step 1 test fails against `git show HEAD:plugin/skills/test/verification.md` (prove it by running the same assertions over that text in a scratch script — never by reverting the file in this shared worktree).

- [ ] **Step 4: Commit** — one commit: `Point verification.md's execute block at the pipeline-site baseline flags — refs #3933`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 2a; Deliverable 2 → Step 3's pin-test run. AC1.1 → the Step 1 test (`AC1.1:` in its name). AC2.1 (`npm test` passes) → Common Step 5's full verification run, not this task.
- **Placeholders:** none.
