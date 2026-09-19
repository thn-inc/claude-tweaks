# Fix run-dir archival contradiction in task-prompt.md's second-call template (#2598) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile two directly contradictory sentences in `plugin/skills/dispatch/task-prompt.md`'s second-call template so a second-call agent reaching `OUTCOME: merged` under `integration-model: pr-first` has exactly one correct instruction on whether it archives the run directory.

**Architecture:** Prose-only fix to one skill markdown file. No code, no schema, no test runner changes — verification is a grep-based self-check confirming the contradiction is gone and the corrected text matches what `settle-and-merge.md` (the file cited as ground truth) actually documents.

**Tech Stack:** Markdown (plugin skill prose).

**Spec:** `.claude-tweaks/pipelines/2026-09-19T213024-record-2598/work/2598-spec.md` (materialized from GitHub issue #2598)

## Global Constraints

- Governed-corpus ceiling: `plugin/skills/dispatch/task-prompt.md` must stay under the 45 KB shared ceiling (current size ~28,380 bytes; the fix adds ~250 bytes — well within headroom).
- Never restate `settle-and-merge.md`'s procedure inline — cite it, per this repo's cross-reference convention (CLAUDE.md's Cross-references section).
- Commit message: `refs #2598` only — never `closes #2598`/`fixes #2598` (the closing keyword is stamped once, at merge time, per this record's own dispatch context pack).

---

### Task 1: Reconcile the "Working directory" paragraph with the outcome-vocabulary paragraph

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md` (the second-call template's "Working directory" paragraph, currently lines 214-224)

**Interfaces:**
- Consumes: nothing (single self-contained prose fix; no other task in this plan)
- Produces: nothing consumed elsewhere in this plan

**Ground truth already established (do not re-derive — cite it):**

`plugin/skills/dispatch/settle-and-merge.md` lines ~316-328 (the `integration-model: pr-first` branch of the Auto-merge gate's "Both layers pass — merge" section) states unambiguously: on `OUTCOME: merged`, the second Task call "also owes the cleanup a merge unlocks for the two items it can actually run directly — claim release and run-dir archival (wrap-up's Items 7, 8)" via `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile --checks mirror,release,archive` (documented in `plugin/skills/_shared/pr-first-merge-post-merge.md` Step 4.2, which explicitly "releases the claim, and archives the run dir"). Worktree removal is explicitly withheld even on `merged` ("Worktree removal (Item 4) is NOT run directly here, `merged` included") — that part is structural and outcome-independent, since the second call never itself ran `EnterWorktree`.

This confirms `task-prompt.md`'s own outcome-vocabulary paragraph (currently lines 268-278) is the CORRECT one: "`merged` means you also completed claim release and run-dir archival directly (that procedure's Step 4) — but not worktree removal". The "Working directory" paragraph (lines 214-224) is the one that's WRONG: its blanket "do NOT archive the run directory yourself, on any outcome (merged, armed, pending-review, ready-to-merge, failed, or blocked)" incorrectly includes `merged`.

Also confirmed correct to leave unchanged: `ready-to-merge` (local-merge path, settle-and-merge.md lines 330-341: "wrap-up's own Item 7 ... and Item 8 ... stay deferred on this branch") and `failed`/`blocked` (settle-and-merge.md lines 209-212, cited already in task-prompt.md itself: "run-dir archival does not run here — the run stays parked"). So the fix touches only the treatment of `merged`, nothing else in the enumerated outcome list.

- [ ] **Step 1: Confirm current (contradictory) text and no test pins it**

```bash
grep -n "on any outcome (merged" plugin/skills/dispatch/task-prompt.md
grep -rln "on any outcome (merged" tests/
```

Expected: FAIL is not applicable here (this is a prose read-back, not a test run) — the first command should print the current blanket sentence (confirming it's still there to fix); the second should print nothing (no test pins this literal string, so editing it cannot regress a conformance suite).

- [ ] **Step 2: Edit the "Working directory" paragraph**

Replace (exact current text, `plugin/skills/dispatch/task-prompt.md` second-call template, "Working directory:" paragraph):

```
Working directory: the dispatching session is still in this group's worktree (unchanged since
the first call) -- you inherit it. Do NOT create, enter, or switch worktrees, and do not invoke
/superpowers:using-git-worktrees. Worktree removal and run-dir archival are the dispatching
session's responsibility, not yours -- do NOT call `ExitWorktree` or `git worktree remove`,
and do NOT archive the run directory yourself, on any outcome (merged, armed, pending-review,
ready-to-merge, failed, or blocked): this call inherited the worktree without ever entering it
(no `EnterWorktree` of its own), so it structurally cannot tear it down, and the run dir's
fate is settled by whichever integration path your OUTCOME resolves to below, never by an
explicit teardown step here. Echo `pwd` and `git rev-parse --show-toplevel` before any
commit and verify both resolve to that inherited worktree; if they resolve to the main
checkout instead, STOP and report BLOCKED.
```

With:

```
Working directory: the dispatching session is still in this group's worktree (unchanged since
the first call) -- you inherit it. Do NOT create, enter, or switch worktrees, and do not invoke
/superpowers:using-git-worktrees. Worktree removal is the dispatching session's responsibility,
not yours -- do NOT call `ExitWorktree` or `git worktree remove`, on any outcome (merged, armed,
pending-review, ready-to-merge, failed, or blocked): this call inherited the worktree without
ever entering it (no `EnterWorktree` of its own), so it structurally cannot tear it down,
regardless of outcome. Run-dir archival follows that same "not yours" rule with exactly one
exception: `merged` under `integration-model: pr-first`, where you complete claim release and
run-dir archival yourself as part of the merge procedure you run in this same call (see the
`integration-model: pr-first` outcome-vocabulary paragraph below). On every other outcome --
`armed`, `pending-review`, `ready-to-merge`, `failed`, or `blocked` -- do NOT archive the run
directory yourself: its fate is settled by whichever integration path your OUTCOME resolves to
below, never by an explicit teardown step here. Echo `pwd` and `git rev-parse --show-toplevel`
before any commit and verify both resolve to that inherited worktree; if they resolve to the
main checkout instead, STOP and report BLOCKED.
```

- [ ] **Step 2.5: Read the outcome-vocabulary paragraph and confirm no further edit is needed there**

Read `plugin/skills/dispatch/task-prompt.md`'s `integration-model: pr-first` outcome-vocabulary paragraph (currently starting around line 268: "`merged` means you also completed claim release and run-dir archival directly (that procedure's Step 4) — but not worktree removal..."). Confirm it already agrees with `settle-and-merge.md` (Task 1's Ground truth paragraph above already did this verification) and needs no text change — only the "Working directory" paragraph above was wrong. Do not edit this paragraph.

- [ ] **Step 3: Verify the contradiction is gone**

```bash
grep -n "do NOT archive the run directory yourself" plugin/skills/dispatch/task-prompt.md
```

Expected: PASS — exactly one match, and it now reads "On every other outcome -- `armed`, `pending-review`, `ready-to-merge`, `failed`, or `blocked` -- do NOT archive the run directory yourself" (i.e. `merged` is no longer inside the blanket prohibition's outcome list).

```bash
grep -n "one correct action\|exactly one" plugin/skills/dispatch/task-prompt.md
wc -c plugin/skills/dispatch/task-prompt.md
```

Expected: `wc -c` prints a value under 46080 (45 KB ceiling).

- [ ] **Step 4: Run the existing dispatch conformance suites to confirm nothing else in the file broke**

```bash
node --test tests/dispatch-flow-rundir-handoff.test.js tests/dispatch-mechanical-enforcement.test.js tests/dispatch-no-stash-conformance.test.js tests/dispatch-heartbeat-visibility.test.js tests/dispatch-settle-and-merge-lazy-read.test.js
```

Expected: PASS — all suites green (this edit only touches the "Working directory" paragraph's prose, none of the anchors — `## First call`, `## Second call` headings, the Foreground execution clause, the heartbeat citation, or the settle-and-merge.md citation shape — that these suites key on).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/task-prompt.md
git commit -m "Reconcile task-prompt.md's contradictory run-dir archival instructions for OUTCOME: merged

refs #2598"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (reconcile the two paragraphs) — Task 1 Step 2. Deliverable 2 (drop `merged` from the "Working directory" paragraph's blanket list, since the outcome-vocabulary paragraph is the correct one) — Task 1 Step 2. Deliverable 3 (the outcome-vocabulary paragraph needs no change since it was already correct) — Task 1 Step 2.5. Deliverable 4 (cross-check `settle-and-merge.md`) — Task 1's Ground truth paragraph, done before drafting the edit. Acceptance Criteria 1 and 2 — Task 1 Step 3's grep verification.
- **Placeholder scan:** none — every step names the exact file, exact before/after text, and exact commands.
- **Type consistency:** n/a (prose-only change, no code interfaces).
