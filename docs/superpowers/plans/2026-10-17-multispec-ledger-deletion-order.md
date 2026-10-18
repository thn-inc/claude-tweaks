# Multi-spec Ledger Deletion Order (#3420) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a multi-spec `/flow` run from deleting its shared open-items ledger before `flow/multispec-batch-curation.md`'s batch pass and the consolidated console have read and written it.

**Architecture:** Prose-only contract change across three skill files, plus one conformance test. Under `MULTISPEC_REVIEW_DEFER=1` (the only condition under which the batch pass and the consolidated console exist), wrap-up cleanup item 2 becomes a deferred item like 3/4/6/7/8. The parent `/flow` performs the deletion once, as a new step 0 of `multispec-review-console.md`'s Shared teardown. That step runs after the batch pass and the console, and before step 2 finishes the shared branch, so the deletion commit lands inside the PR or merge. `interactive` multi-spec runs set no defer flag and have no batch pass or console, so their existing final-spec rule stays as it is.

**Tech Stack:** Markdown skill prose; `node --test` conformance suite.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T194201-record-3420/work/3420-spec.md` (materialized from GitHub issue #3420)

## Global Constraints

- Plugin payload is `plugin/` only; the test lives under `tests/`.
- Shipped `_shared`/skill contract: no renumbering of existing Shared teardown steps (1-7 are cited as "step 2", "step 5", "step 6", "step 7" by `multispec-review-console.md` itself, `docs/journeys/multi-spec-review-console.md`, and `tests/bundle-fixes-reconciliation-2015.test.js`). Add the new step as `0.`, matching the existing `0.` step in the same file's "When to run the consolidated console" list.
- The existing 600-char window after `**Finish the shared branch.**` (pinned by `tests/bundle-fixes-reconciliation-2015.test.js`) must stay intact. Insert nothing inside step 2.
- Byte ceiling: `plugin/skills/flow/multispec-review-console.md` is 40,803 bytes against the 51,200 shared ceiling. Growth here is under 2 KB.
- Commit style: `{Verb} {what} — {detail}`, `refs #3420`, never `closes`/`fixes`.

## Review Focus

1. **The ledger still has an `open` row at teardown** (e.g. one the batch reflect pass wrote). The ledger must not be deleted; it stays for the resolve gate, and a `SKIP` line is logged. Pinned in Task 1's test (`AC2.1` asserts the zero-`open` precondition and the skip clause).
2. **`docs/plans/` holds 2+ `*-ledger.md` files** (this repo always does). Bare `delete-ledger` refuses as ambiguous. Step 0 must pass `--ledger {path}` naming the run's own ledger, i.e. the path logged at creation in `{parent}/decisions.md`. Pinned (`AC2.1` asserts `--ledger`).
3. **`pr-first`: the deletion commit must reach the remote before `gh pr merge`.** That command merges the remote head, so step 0 must push. Pinned (`AC2.1` asserts the push clause).
4. **The executing site still deletes under defer.** `wrap-up/execution-and-verification.md`'s MULTISPEC branch currently lists item 2 among the cleanups it *executes*. If it is not updated, the table change is cosmetic. Pinned (`AC1.1` asserts item 2 is in that file's skip list, not its execute list).
5. **Interactive multi-spec runs** (no defer flag) keep the final-spec deletion, since no batch pass or console exists there. Pinned (`AC1.1` asserts the interactive clause survives).

---

### Task 1: Defer multi-spec ledger deletion to /flow's Shared teardown and pin the order

**Files:**
- Modify: `plugin/skills/wrap-up/cleanup-procedures.md` — table row 2's Deferred cell; "Multi-spec defer behavior" opening sentence (`items 3, 4, 6, 7, and 8` → `items 2, 3, 4, 6, 7, and 8`, and `Items 1 and 5 still execute`); "Item 2's multi-spec caveat" paragraph rewrite; the deferred-actions bullet list gains an Item 2 bullet (first, in numeric order)
- Modify: `plugin/skills/wrap-up/execution-and-verification.md:9` — move `2 Open items ledger` from the executed list into the skipped list
- Modify: `plugin/skills/flow/multispec-review-console.md` — Shared teardown: add item `0.` before item `1.`; the section heading's parenthetical gains "ledger"
- Modify: `plugin/skills/flow/multispec-batch-curation.md` — "When to run the batch pass": one sentence stating the shared ledger is still on disk when this pass runs, and why
- Test: `tests/multispec-ledger-deletion-order.test.js`

**Interfaces:**
- Consumes: `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" delete-ledger --run <dir> [--ledger <path>]` (existing verb; `--ledger` must name a `*-ledger.md` under the run dir or the run's recorded worktree).
- Produces: the anchor text the test pins:
  - cleanup-procedures.md row 2 Deferred cell starts with `**Yes — defer to parent `/flow`'s multi-spec finish step**`
  - multispec-review-console.md Shared teardown item starts with `0. **Delete the shared open-items ledger (#3420).**`
  - multispec-batch-curation.md sentence contains `The shared open-items ledger is still on disk when this pass runs`

- [ ] **Step 1: Write the failing test** `tests/multispec-ledger-deletion-order.test.js` (style: `tests/flow-ledger-creation-timing-conformance.test.js`, whitespace-normalized `read(rel)` over `plugin/skills`). Tests:
  - `AC1.1: the final spec's wrap-up under MULTISPEC_REVIEW_DEFER=1 no longer deletes the shared ledger`
    - cleanup-procedures.md: the row matching `/\| 2 \| Open items ledger \|[^\n]*?\| \*\*Yes — defer to parent `\/flow`'s multi-spec finish step\*\*/`, run against the raw (non-normalized) text so the row is one line
    - the defer sentence matches `/SKIPS state-changing cleanups marked "Yes" in the table above \(items 2, 3, 4, 6, 7, and 8\)/`
    - the deferred bullet list matches `/- Item 2 \(Open items ledger\) — parent \/flow deletes the shared ledger once/`
    - the caveat asserts `/no per-spec wrap-up deletes it — the final spec's included/`, and `doesNotMatch` the pre-fix tail `/let the final spec's wrap-up \(whose own Phase 3 gate will by then see the run's complete, cross-spec item set\) delete it once nothing remains/`
    - the interactive clause survives: `/In `interactive` mode .*this is not the final spec — skip item 2/`
    - execution-and-verification.md matches `/SKIPS the state-changing cleanups marked deferred in `cleanup-procedures\.md` \(items 2 Open items ledger, 3 Design caches/` and `doesNotMatch` `/executes the idempotent cleanups \(items 1 Execution plans, 2 Open items ledger/`
  - `AC2.1: the multi-spec finish step deletes the shared ledger after the consolidated console, before the branch finish`
    - multispec-review-console.md: `stepAt = indexOf('0. **Delete the shared open-items ledger (#3420).**')`, `finishAt = indexOf('**Finish the shared branch.**')`, `teardownAt = indexOf('### Shared teardown')`, `batchAt = indexOf('0. If `MULTISPEC_CURATION_DEFER=1`, run the batch pass first')`; all !== -1; `batchAt < teardownAt < stepAt < finishAt`
    - the step's window (stepAt to finishAt) matches `/delete-ledger --run "\$MULTISPEC_PARENT_DIR" --ledger/`, `/zero `open` rows/`, `/SKIP/`, and `/push/`
  - `AC2.2: the cleanup-procedures.md / multispec-batch-curation.md order is pinned — reversed order fails`
    - helper `assertLedgerOutlivesBatchPass(cleanupText, batchText)`: cleanupText matches `/deletes it once, in `flow\/multispec-review-console\.md`'s Shared teardown step 0 — after `flow\/multispec-batch-curation\.md`'s batch pass and the consolidated console/`; batchText matches `/The shared open-items ledger is still on disk when this pass runs/` and `/`wrap-up\/cleanup-procedures\.md` item 2 defers its multi-spec deletion/`
    - positive: helper passes on the live files
  - `go-red: the pre-#3420 order (final spec deletes, batch pass after) fails the AC2.2 pin`. Pass a literal copy of the pre-fix caveat's last sentence (`…and let the final spec's wrap-up (whose own Phase 3 gate will by then see the run's complete, cross-spec item set) delete it once nothing remains.`) plus the live batch text, and run `assert.throws` around the helper.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multispec-ledger-deletion-order.test.js`
Expected: FAIL on AC1.1, AC2.1 and AC2.2. The go-red test passes even now, because it asserts a throw on literal pre-fix text.

- [ ] **Step 3: Edit the four skill files** to produce exactly the anchor text in Interfaces/Step 1:
  - **cleanup-procedures.md row 2 Deferred cell:** `**Yes — defer to parent `/flow`'s multi-spec finish step** (`flow/multispec-review-console.md`'s Shared teardown step 0 — after the batch curation pass and the consolidated console); `interactive` multi-spec keeps the final-spec rule — see the multi-spec caveat below`. Condition cell unchanged.
  - **Caveat paragraph:** keep its first two sentences (shared-ledger explanation). Then state that after the final spec's wrap-up, `flow/multispec-batch-curation.md`'s batch reflect pass still writes to the ledger (ledger phase `wrap-up`) and its Skills row (`skill-curation.md` 7.1) seeds from the ledger's `[skill: …]` rows. So under `MULTISPEC_REVIEW_DEFER=1`, no per-spec wrap-up deletes it — the final spec's included. Skip item 2 on every spec. The parent `/flow` deletes it once, in `flow/multispec-review-console.md`'s Shared teardown step 0 — after `flow/multispec-batch-curation.md`'s batch pass and the consolidated console, before the shared branch is finished (#3420). Then add an "In `interactive` mode (no defer flag — no batch pass, no consolidated console)" sentence that carries the existing manifest.yml `pending`/`running` check verbatim, ending "this is not the final spec — skip item 2; the final spec's wrap-up deletes it once its own Phase 3 gate has seen the run's complete, cross-spec item set."
  - **execution-and-verification.md:9:** the skipped list becomes `(items 2 Open items ledger, 3 Design caches, 4 Git worktree, 6 Ephemeral dev server, 7 Issue claim release, 8 Pipeline run dir archival)`; the executed list becomes `(items 1 Execution plans, 5 Record/spec lifecycle)`.
  - **multispec-review-console.md Shared teardown:** heading parenthetical `(ledger, dev server, branch finish, claim release, grants, worktree removal)`. Insert a new item before `1.`: `0. **Delete the shared open-items ledger (#3420).**` It is not a Cleanup actions row (like the parent run-dir archive, there is nothing to decide). It runs after both triggers, because the batch pass (When to run step 0) and the console are the ledger's last reader and writer, and before step 2, so the commit lands inside the PR or merge. Precondition: zero `open` rows (`_shared/ledger-format.md`'s Resolve Gate). Otherwise leave the ledger in place and write one `SKIP` via `log-decision.js` naming the open rows. Mechanics: `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" delete-ledger --run "$MULTISPEC_PARENT_DIR" --ledger "{path}"`, where `{path}` is the path the run's creation line logged in `{parent}/decisions.md` (`--ledger` is required, because `docs/plans/` routinely holds other runs' ledgers and the bare verb refuses as ambiguous). Then commit only that path in the shared worktree. Under `pr-first`, push the branch as its own Bash call before step 2, since `gh pr merge` merges the remote head. A `not found` report (already gone) is a no-op. Log one `AUTO` line to the parent `decisions.md`.
  - **multispec-batch-curation.md, end of "When to run the batch pass":** `The shared open-items ledger is still on disk when this pass runs: `wrap-up/cleanup-procedures.md` item 2 defers its multi-spec deletion to `multispec-review-console.md`'s Shared teardown step 0, after this pass and the consolidated console (#3420).`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/multispec-ledger-deletion-order.test.js tests/bundle-fixes-reconciliation-2015.test.js tests/multispec-review-console-render-not-skip.test.js tests/auto-merge-short-circuit-ledger-deletion.test.js tests/delete-ledger-verb.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add tests/multispec-ledger-deletion-order.test.js plugin/skills/wrap-up/cleanup-procedures.md plugin/skills/wrap-up/execution-and-verification.md plugin/skills/flow/multispec-review-console.md plugin/skills/flow/multispec-batch-curation.md
git commit -m "Defer multi-spec ledger deletion to /flow's Shared teardown — refs #3420"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (move item 2's multi-spec deletion into `/flow`'s finish step, after the batch pass and console) is covered by the Step 3 bullets for cleanup-procedures.md, execution-and-verification.md and multispec-review-console.md. Deliverable 2 (conformance test across `cleanup-procedures.md` and `multispec-batch-curation.md` pinning the order) is AC2.2 plus its go-red. AC1 maps to AC1.1 and AC2 to AC2.1/AC2.2.
- **Placeholders:** none.
- **Moved-prose pins:** `git grep` for the caveat's and row's distinctive phrases found no test pins. `bundle-fixes-reconciliation-2015.test.js`'s step-2 window is untouched.
