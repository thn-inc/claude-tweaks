# pr-first-merge Step 2.5 DIRTY routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Step 2.5 of `_shared/pr-first-merge.md` routes a PR reporting `mergeStateStatus: DIRTY` (or `mergeable: CONFLICTING`) with an empty status-check rollup straight to the Conflict path, so it never takes the 15-minute bounded watch or parks as `checks-pending-timeout`.

**Architecture:** This is a prose-only change to the one canonical merge procedure, plus pins in its conformance suite (`tests/pr-first-merge.test.js`). The pins use the frozen-pre-change-text style that suite already uses, so each one is proven able to go red. The state read gains the `mergeable` field. The empty-rollup classification bullet checks merge state before it falls through to pending. When the Conflict path is entered from Step 2.5, a clean update-from-base re-enters Step 2.5, not Step 3, so the new head's CI is read before any merge.

**Tech Stack:** Markdown skill prose; `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T062357-record-3607/work/3607-spec.md`

## Global Constraints

- Files: `plugin/skills/_shared/pr-first-merge.md` (Step 2.5 and the Conflict path), its conformance tests.
- A PR with an empty rollup and any other merge state keeps today's pending/watch behavior.
- `npm test` passes.
- Commit style: `{Verb} {what} — {detail}`, `refs #3607` (never `closes`/`fixes`).

## Review Focus

- A DIRTY PR under `merge-verification: off`: the empty rollup would read green and Step 3 would attempt the merge. Route it to the Conflict path regardless of lever, because conflict routing is not a CI wait. The pin asserts that the routing sentence precedes the lever split.
- A clean update-from-base reached from Step 2.5: retrying "from the top of Step 3" would arm `--auto` on a new head whose CI never ran. This is the #540 race. The pin asserts that the Conflict path re-enters Step 2.5 in that case.
- `mergeStateStatus: UNKNOWN` (GitHub still computing mergeability) with an empty rollup: it must keep reading pending, not conflict. The pin asserts that the routing names only `DIRTY` / `CONFLICTING`.
- The parse-failure bullet's field count must match the widened `--json` list (five fields).
- `release/execute.md` restates the state read with its own field list. It is not a Step 2.5 merge site for a conflicting run PR, so it is out of scope and left untouched.

---

### Task 1: Route DIRTY / CONFLICTING empty-rollup PRs to the Conflict path

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md` (Step 2.5 state read at ~141, parse bullet ~156, empty-rollup bullet ~169-174, Conflict path "Clean" bullet ~434-438)
- Test: `tests/pr-first-merge.test.js` (append)

**Interfaces:**
- Consumes: the suite's existing `MERGE` constant (the live file text).
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing tests** (append to `tests/pr-first-merge.test.js`)

Define `PRE_3607_EMPTY_ROLLUP`, the frozen current empty-rollup bullet (lines 169-174 verbatim). Define a helper `step25()` returning `MERGE.slice(indexOf('## Step 2.5: Merge-verification gate'), indexOf('## Step 3:'))`, and a helper `emptyRollupBullet()` returning the step25 slice from `'- An **empty rollup**'` to the next `'\n- Otherwise'`.

Tests:
- `#3607: the Step 2.5 state read fetches mergeable alongside mergeStateStatus`: step25 includes `--json state,mergeStateStatus,mergeable,headRefOid,statusCheckRollup` and `those five fields`.
- `#3607 AC1: an empty rollup with mergeStateStatus DIRTY or mergeable CONFLICTING routes to the Conflict path before any pending read`: the bullet includes `` `mergeStateStatus: DIRTY` ``, `` `mergeable: CONFLICTING` ``, `**Conflict path**`, `checks-pending-timeout`. Index of `DIRTY` < index of `reads as **pending**` < index of `under \`off\``. `PRE_3607_EMPTY_ROLLUP` does not include `DIRTY` (proves red) [IL-105].
- `#3607 AC2: every other merge state with an empty rollup keeps the pending read`: the bullet still includes `reads as **pending**, never green` and `under \`off\` it is` `simply "no CI"`. The bullet does not route `UNKNOWN` (no `UNKNOWN` in the conflict sentence).
- `#3607: a clean update-from-base entered from Step 2.5 re-enters Step 2.5, not Step 3`: the `## Conflict path` section includes `entered from Step 2.5` and `re-enter Step 2.5 from the top`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/pr-first-merge.test.js`
Expected: FAIL on the four `#3607` tests (all other tests pass).

- [ ] **Step 3: Edit `plugin/skills/_shared/pr-first-merge.md`**

- State read: `--json state,mergeStateStatus,mergeable,headRefOid,statusCheckRollup`. In the parse bullet, change "those four fields" to "those five fields".
- The empty-rollup bullet opens with the conflict check: `mergeStateStatus: DIRTY` (or `mergeable: CONFLICTING`) → **conflict**. Take the **Conflict path** now, under every lever value, with no bounded watch: a branch that conflicts with its base gets no `pull_request` workflow runs, so its rollup stays empty, and waiting would only park it as `checks-pending-timeout` (#3607). Then the existing "Otherwise depends on the lever…" text follows, with wording otherwise unchanged.
- Conflict path "Clean" bullet: add that when the path was entered from Step 2.5 (no merge attempt yet), it re-enters Step 2.5 from the top instead of Step 3, because the pushed head has new CI to read first.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/pr-first-merge.test.js tests/merge-verification-gate-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge.md tests/pr-first-merge.test.js
git commit -m "Route a DIRTY empty-rollup PR to the Conflict path at Step 2.5 — no 15-minute watch, refs #3607"
```
