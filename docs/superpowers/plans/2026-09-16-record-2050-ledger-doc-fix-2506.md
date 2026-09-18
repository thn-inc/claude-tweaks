# Ledger Doc Staleness Fix (#2506) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `docs/plans/2026-09-12-record-2050-ledger.md` rows 2 and 3 so their Status/Resolution text reflects that PR #2293 has since merged and issue #2277 has since closed, instead of describing both as still awaiting a human decision.

**Architecture:** Pure text edit to two table cells in an existing markdown table — no code, no schema, no behavioral surface. The table's `Status` column changes from `open` to `resolved`, and the `Resolution` column's prose is replaced to state the now-closed outcome.

**Tech Stack:** Markdown.

**Spec:** `.claude-tweaks/pipelines/2026-09-16T063048-record-2506/work/2506-spec.md` (materialized from GitHub issue #2506)

## Global Constraints

- No code changes — this is a documentation-only fix.
- Do not touch any row other than rows 2 and 3.
- The exact replacement text for row 2 is given by the spec's "Proposed" block; row 3 needs an analogous rewrite (the spec's Acceptance Criteria describes the required outcome for row 3 but does not give a literal replacement string — compose one following the same shape as row 2's).

---

### Task 1: Update ledger rows 2 and 3

**Files:**
- Modify: `docs/plans/2026-09-12-record-2050-ledger.md` (rows 2 and 3 of the table starting at line 3)

**Interfaces:**
- Consumes: nothing (no prior task).
- Produces: nothing (terminal task).

- [ ] **Step 1: Confirm current state (no test framework applies — this is a doc-only change; verification is a literal-content check instead of a unit test)**

Run: `grep -n '^| 2 \|^| 3 ' "docs/plans/2026-09-12-record-2050-ledger.md"`
Expected: FAIL in the TDD sense — i.e., the two rows currently read `open` with the pre-fix Resolution text (confirms the row hasn't already been fixed):

```
6:| 2 | wrap-up | pr — PR #2293 — ... | open | Residue-sweep finding ... The PR itself stays open by design ... |
7:| 3 | wrap-up | suite — test suite exit 1 ... | open | Residue-sweep finding. Confirmed pre-existing ... Left `open` for the same reason as item #2 ... |
```

- [ ] **Step 2: Edit row 2's Status and Resolution cells**

Change row 2 (line 6) from:

```
| 2 | wrap-up | pr — PR #2293 — `gh pr list --state open --json number,title,headRefName --limit 100` — open, head worktree-record-2050-enterworktree-path-subagent (this work) | open | Residue-sweep finding (`bin/residue.js --scope blast-radius`). Phase 1 fix-exhaust does not apply — "fixing" means merging, which requires the `auto:merge` grant this record does not carry (`_shared/deferral-gate.md`'s fix-now criteria fail: merging requires an approval this record explicitly lacks). Phase 2's per-item drill requires a human decision this headless dispatch has no channel to obtain (no `AskUserQuestion` tool available to this call) — left `open` rather than fabricated. This is the expected shape for a `pending-review` outcome: `dispatch/SKILL.md`'s Reporting section treats an unanswerable Review Console prompt during a headless firing as "not an error, the expected resting state until a human resumes" — the same principle applies here, one phase earlier. The PR itself stays open by design (`review-console.md`'s Ungranted-member carve-out: the Auto-merge gate's merge decision resolves to "leave PR open" with zero grant, even under `consoleAutoResolve`). |
```

to (verbatim from the spec's Proposed block):

```
| 2 | wrap-up | pr — PR #2293 — `gh pr list --state open --json number,title,headRefName --limit 100` — open, head worktree-record-2050-enterworktree-path-subagent (this work) | resolved | PR #2293 merged 2026-09-12T13:29:55Z (superseding the prior residue-sweep finding, which had left it open pending a human merge decision this headless dispatch had no channel to obtain). No further action needed on this row. |
```

- [ ] **Step 3: Edit row 3's Status and Resolution cells**

Change row 3 (line 7) from:

```
| 3 | wrap-up | suite — test suite exit 1 — `not ok 6414 - the installed CLI matches the pinned version` (`tests/impeccable-cli-contract.test.js`) | open | Residue-sweep finding. Confirmed pre-existing and unrelated to this record's diff: `git diff origin/main...HEAD --name-only` does not touch `tests/impeccable-cli-contract.test.js`; already tracked as backlog #2277 (local-machine installed-CLI-version drift). Per `_shared/ledger-format.md`'s Anti-Patterns table, a pre-existing baseline failure takes `accepted` with proof, not `deferred` — but per `_shared/auto-mode-contract.md`'s Never-reversible list, closing a ledger item as `accepted` is auto-FORBIDDEN regardless of mode, and Phase 2's per-item drill requires a human decision this headless dispatch has no channel to obtain. Left `open` for the same reason as item #2 — a human resuming this run (`/claude-tweaks:wrap-up #2050` or `/claude-tweaks:ledger resolve`) can close it as `accepted` in one step using the proof already gathered here. |
```

to:

```
| 3 | wrap-up | suite — test suite exit 1 — `not ok 6414 - the installed CLI matches the pinned version` (`tests/impeccable-cli-contract.test.js`) | resolved | Backlog #2277 (the tracked local-machine installed-CLI-version drift behind this pre-existing, unrelated failure) closed 2026-09-12T15:36:33Z via PR #2309 — superseding the prior residue-sweep finding, which had left this row open pending a human's `accepted` close using the proof gathered here. No further action needed on this row. |
```

- [ ] **Step 4: Verify the edit**

Run: `grep -n '^| 2 \|^| 3 ' "docs/plans/2026-09-12-record-2050-ledger.md"`
Expected: PASS — both rows now show `resolved` in the Status column and the new Resolution text above; no other row changed (`git diff --stat docs/plans/2026-09-12-record-2050-ledger.md` shows exactly this one file, and `git diff docs/plans/2026-09-12-record-2050-ledger.md` shows only lines 6-7 changed).

- [ ] **Step 5: Commit**

```bash
git add docs/plans/2026-09-12-record-2050-ledger.md
git commit -m "Fix stale ledger rows 2/3 in docs/plans/2026-09-12-record-2050-ledger.md — PR #2293 merged, issue #2277 closed

refs #2506"
```

---

## Self-Review

- **Spec coverage:** the spec's single Deliverable (rewrite rows 2 and 3's Status/Resolution) and its single Acceptance Criterion (both rows reflect the now-resolved GitHub state) are both covered by Task 1's Steps 2-3.
- **Placeholders:** none — every replacement string above is the literal final text.
- **Type consistency:** n/a (no code, no interfaces beyond Task 1).
- **Known defect in this plan, recorded post-hoc:** Steps 2-4 above write `resolved` into the ledger's Status column, carried over verbatim from the spec's Proposed block. `resolved` is not a valid status — `plugin/skills/_shared/ledger-format.md` ("The status enum is closed") allows only `open`, `fixed`, `deferred`, `accepted`, `acknowledged`, `observation`, and names `resolved` explicitly as a non-value. For an item settled by a merged PR, that contract's Phase 1 re-check rule prescribes `fixed` with the resolving PR reference. Do not copy these steps' literal strings as a template — the enum word in them is wrong.
