# Wrap-up digest findings (#3595) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a run's ledger deletion on the PR branch before the `pr-first` merge, remove the residue ledgers from main, share one closing-keyword alternation, and state which `config.yml` a multi-spec ceremony downgrade writes.

**Architecture:** Prose fixes in two wrap-up skill files (D1) and two ceremony files (D4), each pinned by a conformance test with a go-red proof; a one-line import swap in `engine-verify.js` (D3) pinned through `runVerify`'s carrier-commit row; `git rm` of residue ledgers (D2).

**Tech Stack:** Markdown skill files, Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T124821-spec-3599-3602-3695-3696-3698-3699-3595/spec-3595/work/3595-spec.md`

## Global Constraints

- Root cause (verified): `hooks.js delete-ledger` only unlinks; `wrap-up/review-console.md` "On approval" step 6 runs cleanup items in order, item 4 runs `_shared/pr-first-merge.md`'s `gh pr merge`, and the wrap-up commit + phase-exit push (`execution-and-verification.md`) come after all cleanup — so the unlink is uncommitted at merge time.
- `wrap-up/auto-merge-short-circuit.md` stays unchanged. `flow/multispec-review-console.md` is not edited: its Shared teardown step 0 already commits + pushes before the merge (#3420), and it sits at 48872 B of the 52500 B rail.
- Never delete `docs/plans/2026-10-20-spec-3599-3602-3695-3696-3698-3699-3595-ledger.md` (this run's own ledger).
- `closingKeywordMatches` keeps its grammar: `\\b`, `\\s+`, optional `owner/repo`, whole-reference `#${n}\\b`.
- Every edit to `plugin/skills/**/*.md` is one or two sentences; keep the item-2 table cell on a single line (`tests/multispec-ledger-deletion-order.test.js` pins the row with `[^\n]*?`).
- Commit message `{Verb} {what} — {detail}`, body `refs #3595`, trailer `Claude-Session: https://claude.ai/code/session_01YVBrdUJUP7EjvTUw6e89s9`.

## Review Focus

- A `delete-ledger` `not found` report — the new prose must say there is nothing to commit, not create an empty commit.
- `local-merge` / `current-branch` runs — the push half is `pr-first` only; the commit still happens.
- `Closes: #N` (colon form) — the shared alternation keeps `\\s+`, so it does not match; unchanged behavior, not in scope to widen.
- A multi-spec run where no spec downgraded — the batch pass must keep the run-level value (`fast-lane` stays `fast-lane`).
- The 3 residue ledgers beyond the spec's 8 (premise extension logged in `spec-3595/decisions.md`) — deleted with the 8.

Departure from Key Files: `plugin/skills/wrap-up/review-console.md` is modified (step 6 is where the merge is invoked).

Waived plugin/skills/wrap-up/cleanup-procedures-execution.md: read only
Waived plugin/skills/_shared/pr-first-merge.md: read only
Waived plugin/bin/lib/issue-branch-tracking.js: read only
Waived plugin/skills/flow/multispec-review-console.md: read only

---

### Task 1: Ledger deletion lands before the pr-first merge (D1, D2)

**Files:**
- Create: `tests/wrap-up-ledger-delete-before-merge.test.js`
- Modify: `plugin/skills/wrap-up/cleanup-procedures.md` (item 2 row; new paragraph after "Item 5's two framings")
- Modify: `plugin/skills/wrap-up/review-console.md` ("On approval" step 6)
- Delete: `docs/plans/2026-10-17-spec-3376-3386-ledger.md`
- Delete: `docs/plans/2026-10-18-capture-argument-hint-producer-flags-ledger.md`
- Delete: `docs/plans/2026-10-19-phase-exit-merge-state-check-ledger.md`
- Delete: `docs/plans/2026-10-19-record-2869-friction-fixes-ledger.md`
- Delete: `docs/plans/2026-10-19-review-medium-cross-lens-corroboration-ledger.md`
- Delete: `docs/plans/2026-10-19-spec-3507-3509-ledger.md`
- Delete: `docs/plans/2026-10-20-git-command-empty-c-target-ledger.md`
- Delete: `docs/plans/2026-10-20-ledger-pipe-safe-rows-ledger.md`
- Delete: `docs/plans/2026-10-20-review-console-ask-gate-ledger.md`
- Delete: `docs/plans/2026-10-20-spec-3564-3565-3581-ledger.md`
- Delete: `docs/plans/2026-10-20-verify-new-fixed-counts-ledger.md`

**Interfaces:** none consumed or produced.

- [ ] **Step 1: Write the failing test `tests/wrap-up-ledger-delete-before-merge.test.js` (AC1.1)**

Model on `tests/multispec-ledger-deletion-order.test.js` (`read = rel => readRaw(rel).replace(/\s+/g, ' ')`). Exact copy the tests pin:

- `ITEM2_PARA = "**Item 2 lands before item 4's merge (#3595).**"`
- `STEP6_LEDGER = "Item 2's ledger deletion is committed and, under `pr-first`, pushed before the worktree/branch-finish row runs"`
- `STEP6_MERGE = "runs `_shared/pr-first-merge.md`'s procedure"`

Helper `assertLedgerBeforeMerge(consoleText)`: slice from `'6. Execute cleanup actions'` to `'7. `Q#` queue writes'`; assert both markers present and `indexOf(STEP6_LEDGER) < indexOf(STEP6_MERGE)`, else throw with message `item 2 commit+push must precede the pr-first merge`.

Tests:
1. `AC1.1: cleanup item 2 commits the ledger path alone and pushes before item 4's merge` — `cleanup-procedures.md` normalized contains `ITEM2_PARA`, matches `/commit the ledger path alone/`, `/under `pr-first` push the branch as its own Bash call before item 4 runs/`, `/`not found` report is a no-op/`; the raw item-2 row matches `/\| 2 \| Open items ledger \|[^\n]*?then commit only that path/`.
2. `AC1.1: review-console On approval step 6 orders the ledger commit+push before the merge` — `assertLedgerBeforeMerge(read('wrap-up/review-console.md'))`.
3. `go-red proof: the ledger sentence moved after the merge fails the AC1.1 order pin` — permute the live text (remove `STEP6_LEDGER`, re-insert it after `STEP6_MERGE`), assert the permuted text differs and `assert.throws(() => assertLedgerBeforeMerge(permuted), /must precede the pr-first merge/)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/wrap-up-ledger-delete-before-merge.test.js`

Expected: FAIL

(tests 1 and 2 fail — the prose does not exist yet; test 3 throws on the missing marker before the permutation.)

- [ ] **Step 3: Edit `plugin/skills/wrap-up/cleanup-procedures.md`**

Item 2 row, Procedure cell: append after "…confirms zero open items" — `; then commit only that path and, under `pr-first`, push before item 4 — see "Item 2 lands before item 4's merge" below`. After the "Item 5's two framings" paragraph, add:

> **Item 2 lands before item 4's merge (#3595).** `delete-ledger` only unlinks the file, and the execution step's wrap-up commit and phase-exit push run after every cleanup item — so a deletion left for that commit reaches the branch only after item 4's `gh pr merge` has squashed the remote head, leaving the ledger on the integration branch. Right after the unlink, commit the ledger path alone, and under `pr-first` push the branch as its own Bash call before item 4 runs — the order `auto-merge-short-circuit.md` (#939) and `flow/multispec-review-console.md`'s Shared teardown step 0 (#3420) already follow. A `not found` report is a no-op: nothing to commit.

- [ ] **Step 4: Edit `plugin/skills/wrap-up/review-console.md` step 6**

After "Phase 4's execution step picks these up." insert: `Item 2's ledger deletion is committed and, under `pr-first`, pushed before the worktree/branch-finish row runs (`cleanup-procedures.md`'s "Item 2 lands before item 4's merge").`

- [ ] **Step 5: Run test to verify it passes (AC1.1)**

Run: `node --test tests/wrap-up-ledger-delete-before-merge.test.js tests/multispec-ledger-deletion-order.test.js`

Expected: PASS (all tests in both files)

- [ ] **Step 6: Remove the residue ledgers (D2)**

Remove (`git rm`) exactly the 11 `Delete:` paths in this task's Files block — never the run's own `docs/plans/2026-10-20-spec-3599-3602-3695-3696-3698-3699-3595-ledger.md`.

- [ ] **Step 7: Verify the residue is gone (AC2.1)**

Run: `git ls-tree --name-only HEAD docs/plans/`

Expected: the only `*-ledger.md` listed is `docs/plans/2026-10-20-spec-3599-3602-3695-3696-3698-3699-3595-ledger.md`.

- [ ] **Step 8: Commit**

`git add` the test file and the two skill files (the deletions are already staged by `git rm`); message `Land the ledger deletion before the pr-first merge — commit + push item 2 ahead of item 4, drop 11 residue ledgers`, body `refs #3595`, trailer above.

### Task 2: engine-verify shares the closing-keyword alternation (D3)

**Files:**
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js`
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js:462-476`

**Interfaces:** Consumes `CLOSING_KEYWORD_ALTERNATION` from `plugin/bin/lib/issue-branch-tracking.js` (`'(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)'`, already grouped).

- [ ] **Step 1: Append the failing test to `tests/bin-lib/wrap-up/engine-verify.test.js` (AC3.1)**

Test `#3595 AC3.1: carrier-commit matches Fixes/Closes and rejects Refs through the shared CLOSING_KEYWORD_ALTERNATION`, using the file's existing `makeTmpDir` + `writeSpecFile(runDir, '900', 900)` + `runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: () => '' } })`:
- log `'x\n\nFixes #900\n'` → carrier-commit row `result === 'pass'`
- log `'x\n\nCloses #900\n'` → `'pass'`
- log `'x\n\nRefs #900\n'` → `'fail'`
- source of `plugin/bin/lib/wrap-up/engine-verify.js` matches `/\{[^}]*\bCLOSING_KEYWORD_ALTERNATION\b[^}]*\}\s*=\s*require\('\.\.\/issue-branch-tracking'\)/` and does not match `/CLOSING_KEYWORDS_PATTERN/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js`

Expected: FAIL after Step 1

(only the appended test fails, on the source assertion.)

- [ ] **Step 3: Swap the constant for the import in `plugin/bin/lib/wrap-up/engine-verify.js`**

Add `const { CLOSING_KEYWORD_ALTERNATION } = require('../issue-branch-tracking');` with the file's other requires; delete `CLOSING_KEYWORDS_PATTERN`; the regex becomes `` `\\b${CLOSING_KEYWORD_ALTERNATION}\\s+(?:[\\w.-]+/[\\w.-]+)?#${n}\\b` ``. Reword the #2676 comment's "Built once" sentence to say the keyword set is `issue-branch-tracking.js`'s shared `CLOSING_KEYWORD_ALTERNATION` (#3595).

- [ ] **Step 4: Run test to verify it passes (AC3.1)**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js`

Expected: PASS; and `grep -n CLOSING_KEYWORDS_PATTERN plugin/bin/lib/wrap-up/engine-verify.js` prints nothing.

- [ ] **Step 5: Verify the narrower-pattern revert goes red (AC3.1, AC3.2)**

In a scratch worktree (`git worktree add --detach <scratchpad>/wt-3595 HEAD`; never edit the shared worktree), replace `${CLOSING_KEYWORD_ALTERNATION}` in the regex with `(?:fix(?:e[sd])?)`, run `node --test tests/bin-lib/wrap-up/engine-verify.test.js` there.

Expected: the new AC3.1 test fails on the `Closes #900` assertion (the pre-existing "Closes #N" test also fails). Then `git worktree remove --force <scratchpad>/wt-3595`.

- [ ] **Step 6: Commit**

Message `Import the shared closing-keyword alternation in engine-verify — drop the last independent copy`, body `refs #3595`, trailer above.

### Task 3: Multi-spec ceremony downgrade ruling (D4)

**Files:**
- Create: `tests/multispec-ceremony-downgrade-ruling.test.js`
- Modify: `plugin/skills/wrap-up/SKILL.md` (Ceremony escape hatch, after the `set-config.js` line)
- Modify: `plugin/skills/flow/multispec-batch-curation.md` (new paragraph before "## Batch-scope reflect pass"; reflect step 5; registry pass `--ceremony`)

**Interfaces:** none.

- [ ] **Step 1: Write the failing test `tests/multispec-ceremony-downgrade-ruling.test.js` (AC4.1)**

Whitespace-normalized reads. Test `AC4.1: both files name the spec-level config.yml and one downgraded spec runs the batch pass at standard`:
- `wrap-up/SKILL.md` matches `/the downgrade writes the spec-level `config\.yml` only — never the parent run dir's/`
- `flow/multispec-batch-curation.md` matches `/\*\*Batch ceremony \(#3595\)\.\*\*/`, `/its own spec-level `config\.yml` only/`, `/runs at `standard` when any `spec-\{N\}\/config\.yml` reads `ceremony-profile: standard`/`, `/--ceremony "\{batch ceremony\}"/`; does not match `/already uniform across every spec/` nor `/\{ceremony-profile from config\.yml\}/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multispec-ceremony-downgrade-ruling.test.js`

Expected: FAIL

- [ ] **Step 3: Edit `plugin/skills/wrap-up/SKILL.md`**

After the `set-config.js … --value standard` line, add: `In a multi-spec run `$PIPELINE_RUN_DIR` is the spec's own `spec-{N}/` directory, so the downgrade writes the spec-level `config.yml` only — never the parent run dir's; `flow/multispec-batch-curation.md`'s batch pass reads every spec's value (#3595).`

- [ ] **Step 4: Edit `plugin/skills/flow/multispec-batch-curation.md`**

Before "## Batch-scope reflect pass", add:

> **Batch ceremony (#3595).** A spec's Ceremony escape hatch (`wrap-up/SKILL.md`) downgrades its own spec-level `config.yml` only, so the run-level value stops being uniform once one spec downgraded. The batch pass covers every spec's diff, the downgraded one included: it runs at `standard` when any `spec-{N}/config.yml` reads `ceremony-profile: standard`, and at the parent `config.yml`'s value only when no spec downgraded.

Reflect step 5 becomes: `**Mode** — the batch ceremony above: `light` under `fast-lane`, `full` otherwise.` Registry pass: `--ceremony "{ceremony-profile from config.yml}"` → `--ceremony "{batch ceremony}"`.

- [ ] **Step 5: Run test to verify it passes (AC4.1)**

Run: `node --test tests/multispec-ceremony-downgrade-ruling.test.js tests/fast-lane-digest.test.js tests/ceremony-profile-roster.test.js`

Expected: PASS

- [ ] **Step 6: Commit**

Message `Rule the multi-spec ceremony downgrade target — spec-level config.yml, batch pass at standard when any spec downgraded`, body `refs #3595`, trailer above.

### Task 4: Verify the full suite (AC5.1)

- [ ] **Step 1: Verify `npm test` passes (AC5.1)**

Run: `npm test > <scratchpad>/npm-test-3595.txt 2>&1; echo "exit=$?"`

Expected: `exit=0`, `# fail 0`. Per CLAUDE.md, a failure count that varies run-to-run is load — re-run the failing file alone with `node --test <file>` before concluding.
