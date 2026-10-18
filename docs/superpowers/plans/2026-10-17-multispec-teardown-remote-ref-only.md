# Multispec pr-first teardown keeps the run directory until archival (#3192) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `flow/multispec-review-console.md`'s Shared teardown step 7 from archiving the multispec parent run directory before the console's own last step (archival) runs.

**Architecture:** Pass `--remote-ref-only` to step 7's `teardown-run` call (the flag #3088 added for `wrap-up/cleanup-procedures-execution.md` Section C step 5.5), so archival stays solely with "On approval" step 9 / "On override" step 7. Rewrite the console's own prose that says archival is reached inside step 7, and generalize `teardown-run.js`'s `--remote-ref-only` skip message/comment, which today names only the single-spec caller.

**Tech Stack:** Markdown skill prose; Node (`plugin/bin/lib/hooks/teardown-run.js`); `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T214316-record-3192/work/3192-spec.md` (materialized from GitHub issue #3192)

## Global Constraints

- Commit messages: `{Verb} {what} — {detail}`, reference the record as `refs #3192` — never `closes`/`fixes`.
- Skill files keep their existing structure; edit in place (surgical — no reformatting of adjacent prose).
- `plugin/skills/flow/multispec-review-console.md` is 40,803 bytes against the 50 KB ceiling — the edits are net-small; do not add new sections.
- Prose tests read live skill text via `tests/helpers/read-skill.js`'s `readText` (already imported in the target test file).

## Review Focus

- `--abandoned` path: step 7's command comment says `# or --abandoned`; `--remote-ref-only` with `--abandoned` must still be harmless (branch/ref steps already skip under `abandoned`, archival skipped) — the prose must not imply `--remote-ref-only` is merged-only.
- Archival still happens exactly once and last: "On approval" step 9 and "On override" step 7 remain the only archival sites; the "When to run" step 6 line must point at them, not at step 7.
- Empty-console fast path ("archive silently") is unaffected — no teardown-run there.
- The `teardown-run.js` skip line must still match AC17's `/archive: skipped — --remote-ref-only/` in `tests/hooks-teardown-run.test.js`.
- Step 7's "Skip when step 6 itself skipped" clause is unchanged — a left-open PR still skips step 7 entirely.

---

### Task 1: Multispec step 7 passes `--remote-ref-only`; archival stays the console's last step

**Files:**
- Modify: `plugin/skills/flow/multispec-review-console.md` — "When to run the consolidated console" step 6 (line 38) and "Shared teardown" step 7 (lines ~184-202)
- Modify: `plugin/bin/lib/hooks/teardown-run.js:235-241` — Step 2 comment + `--remote-ref-only` skip line
- Test: `tests/scratch-worktree-remote-branch-delete.test.js` (append after the existing `#3088` Section C test)

**Interfaces:**
- Consumes: `bin/hooks.js teardown-run --run <dir> [--merged|--abandoned] [--remote-ref-only]` (existing).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests** — append to `tests/scratch-worktree-remote-branch-delete.test.js`, adding `const MULTISPEC_CONSOLE = read('plugin', 'skills', 'flow', 'multispec-review-console.md');` beside the other top-level reads:

```js
test('multispec-review-console.md Shared teardown step 7 passes --remote-ref-only, leaving archival to the console\'s last step (#3192)', () => {
  const start = MULTISPEC_CONSOLE.indexOf('**Branch + remote-ref cleanup, once the shared worktree is gone (#594).**');
  const end = MULTISPEC_CONSOLE.indexOf('### Per-issue label cleanup');
  assert.ok(start > 0 && end > start, 'Shared teardown step 7 must exist and precede Per-issue label cleanup');
  const step7 = MULTISPEC_CONSOLE.slice(start, end);
  assert.match(step7, /teardown-run --run "\$MULTISPEC_PARENT_DIR"[\s\\]*--merged --remote-ref-only/);
  assert.match(step7, /On approval" step 9/);
});

test('multispec-review-console.md "When to run" step 6 no longer routes archival through step 7\'s teardown-run (#3192)', () => {
  const start = MULTISPEC_CONSOLE.indexOf('## When to run the consolidated console');
  const end = MULTISPEC_CONSOLE.indexOf('## Locating the parent run directory');
  const section = MULTISPEC_CONSOLE.slice(start, end);
  assert.doesNotMatch(section, /reaches archival only inside step 7's `teardown-run`/);
  assert.match(section, /--remote-ref-only/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/scratch-worktree-remote-branch-delete.test.js`
Expected: FAIL — both new `#3192` tests fail (step 7 lacks `--remote-ref-only`; step 6 still says "reaches archival only inside step 7's `teardown-run`"); every pre-existing test passes.

- [ ] **Step 3: Implement**
  - `multispec-review-console.md` step 7: command becomes `teardown-run --run "$MULTISPEC_PARENT_DIR" \` / `--merged --remote-ref-only  # or --abandoned --remote-ref-only when the branch was discarded, not merged`. Rewrite the paragraph after it: `teardown-run` here performs the local-branch-delete + remote-branch-delete mechanics only — `--remote-ref-only` skips its archival step (#3088's flag, the same narrowing `cleanup-procedures-execution.md` Section C step 5.5 uses) so the parent run directory stays in place for any Cleanup actions row still running (dev-server teardown may run "any time", "On approval" step 8) and for the run's own archival, "On approval" step 9 / "On override" step 7, which always runs last (`wrap-up/cleanup-procedures.md`'s Ordering rule). Keep the existing "called after step 6", "Skip when step 6 itself skipped", and "registration pruned" sentences.
  - `multispec-review-console.md` "When to run" step 6 (line 38): keep the pointer to "On approval" step 9 / "On override" step 7; replace the parenthetical with: Shared teardown carries no archive row of its own, and its step 7 `teardown-run` passes `--remote-ref-only` so it never archives — this inline action is the run's only archival, and it runs after every Cleanup actions row.
  - `teardown-run.js`: skip line becomes `'archive: skipped — --remote-ref-only (archival is the caller\'s own last cleanup step)'`; comment names both callers (Section C step 5.5 and `flow/multispec-review-console.md` Shared teardown step 7, #3192).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/scratch-worktree-remote-branch-delete.test.js tests/hooks-teardown-run.test.js tests/bundle-fixes-reconciliation-2015.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/multispec-review-console.md plugin/bin/lib/hooks/teardown-run.js tests/scratch-worktree-remote-branch-delete.test.js
git commit -m "Pass --remote-ref-only in multispec Shared teardown step 7 — archival stays the console's last step, refs #3192"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 3 bullet 1; Deliverable 2 (trace archival, invariant holds) → Step 3 bullets 1-2 (archival only at On approval step 9 / On override step 7, after step 8/6) + teardown-run.js message; Deliverable 3 → Step 1 tests in the existing `#3088` sibling file. AC "run directory still present for later cleanup steps" → step 7 no longer archives; AC "`npm test` passes" → Common Step 5 full suite.
- **Placeholders:** none.
