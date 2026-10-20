# Reconcile pending-staged skip reason Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make post-merge reconcile report a MERGED, never-rendered-console run with pending `staged/` items as needing human action, with its own skip reason, instead of as cleanup that converges at the next trigger point.

**Architecture:** `archive-merged.js` gains a distinct skip reason, `console-never-rendered-staged-pending`, emitted wherever a MERGED run with no `console.json` is kept in place *because* `staged/` holds pending items (the `hasStagedPending === true` case). Plain `console-never-rendered` stays for callers that do not know staged state (`hasStagedPending` undefined). The new reason joins `STRUCTURALLY_STUCK_REASONS`, so the existing 7-day-mtime-gated `trackStuckSkip` escalation surfaces it in the consolidated `structurally-stuck` record. Prose in `pr-first-merge-post-merge.md` Step 4.2 tells the agent to log it as needing human action. `auto-merge-short-circuit.md` records why it does not write a `console.json`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, Markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T210849-record-3297/work/3297-spec.md`

Scope keywords: console-never-rendered, STRUCTURALLY_STUCK_REASONS

Check B disposition: `docs/journeys/*` and `docs/superpowers/plans/2026-10-19-stale-stamped-pr-number-3543.md` are historical narrative of earlier records (left as-is, never rewritten). `docs/plans/…-ledger.md` is this run's own ledger.

## Global Constraints

- Reason string, exact: `console-never-rendered-staged-pending`.
- The #657/#1130 protection is unchanged: a run with pending staged items is never archived (only its reason changes).
- A transient gh/network failure is still described as "left for the next trigger point", unchanged (AC2.1).
- Commit style: `{Verb} {what} — {detail}`, ending with `refs #3297` (never `closes`/`fixes`).

## Review Focus

- `decideArchiveCore(prState, 'none')` with no third argument (and `decideArchive`, `tests/reconcile.test.js:337`) must still return plain `console-never-rendered`. If it does not know staged state, it must not claim staged items are pending. Pinned in Task 1 Step 1.
- An unreadable `staged/` (ENOTDIR, top-level or `spec-N/staged`) fails closed as pending, so it now reports the new reason and is still never archived. Pinned by the updated ENOTDIR tests in Task 1.
- A live run (dir mtime fresh) with pending staged items must not start a structurally-stuck residue count. The existing `isStaleDir(STRUCTURALLY_STUCK_TTL_MS)` gate covers this, and the Task 1 tracking test backdates explicitly.
- A CLOSED never-merged PR via the by-number fallback keeps `console-never-rendered-pr-closed`, unchanged. The existing test at `archive-merged.test.js:2507` stays green.
- The clean-status sweep (`iterCleanRunDirs`) emits the new reason, but `trackStuckSkip` stays off there by design (archiveMergedRun's comment). No change, and no test.

---

### Task 1: Distinct skip reason + structurally-stuck escalation

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` — `decideArchiveCore` (~l.347-350), the by-number fallback's `consoleReason` (~l.1929-1957), `STRUCTURALLY_STUCK_REASONS` + its comment (~l.1411-1431)
- Modify: `plugin/bin/lib/reconcile/escalate-residue.js` — `structurallyStuckBody`'s first line (~l.90)
- Modify: `docs/reconcile-checks.md` — the feeding-reasons list (~l.209)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`
- Test: `tests/bin-lib/reconcile/escalate-residue.test.js`
- Test: `tests/reconcile.test.js` (verify-only — its 2-arg `decideArchive` assertion at l.337 must stay plain `console-never-rendered`; no edit)

**Interfaces:**
- Produces: skip reason string `console-never-rendered-staged-pending` in `archiveMerged().skipped[].reason` and `decideArchiveCore(...).reason`. Task 2's prose names it verbatim.
- Consumer enumeration (`grep -rn "console-never-rendered" plugin tests docs`): `escalate-residue.js` body (list-all, extend), `docs/reconcile-checks.md:209` (list-all, extend), `format-summary.js` (generic per-reason aggregation, no change), `tests/reconcile.test.js:337` (2-arg path, stays plain).

- [ ] **Step 1: Update/write the failing tests in `archive-merged.test.js`**
  - `decideArchiveCore: consoleState none + MERGED + hasStagedPending:true skips` (~l.2804): expect `{ action: 'skip', reason: 'console-never-rendered-staged-pending' }`. Rename it `AC1.2: ...`.
  - The 2-arg test (~l.2800) stays unchanged: plain `console-never-rendered`.
  - By-number fallback pending-staged test (~l.2598): rename it `AC3.1: ...`. Expect reason `console-never-rendered-staged-pending`, still not archived. Add: `listResidueFailures(root)` contains `{ reason: 'structurally-stuck', path: runDir }` (its dir is already backdated past `STRUCTURALLY_STUCK_TTL_MS`).
  - Ordinary-path pending test (~l.2693), the ENOTDIR test (~l.2709), AC5.1 (~l.2746), and AC5.1 fail-closed (~l.2763): change the expected reason to `console-never-rendered-staged-pending`. Keep every not-archived assertion.
  - New test `STRUCTURALLY_STUCK_REASONS includes console-never-rendered-staged-pending but not plain console-never-rendered`.
  - In `escalate-residue.test.js` (~l.286), add `'console-never-rendered-staged-pending'` to the reason loop.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/escalate-residue.test.js`
Expected: FAIL after Step 1. Several assertions receive `'console-never-rendered'` where `'console-never-rendered-staged-pending'` was expected, and the escalate body lacks the new reason.

- [ ] **Step 3: Implement**
  - `decideArchiveCore`: in the `consoleState === 'none'` block, `hasStagedPending === true` → `{ action: 'skip', reason: 'console-never-rendered-staged-pending' }`. Any other non-false value keeps plain `console-never-rendered`.
  - By-number fallback: the MERGED reason becomes `console-never-rendered-staged-pending` (reached only when `hasStagedItems(dir)` is true). CLOSED stays `console-never-rendered-pr-closed`. Update the adjacent comments, which today say plain stays untracked.
  - `STRUCTURALLY_STUCK_REASONS`: add the new reason. Rewrite the comment's #3249 sentence: plain `console-never-rendered` stays excluded (staged state unknown), and the staged-pending variant is tracked because no console will ever render for it — the fast-lane short-circuit writes none — so only a human can converge it (#3297).
  - `structurallyStuckBody`: add `` `console-never-rendered-staged-pending` `` to the list. Add one sentence: for such a directory, a merged run left pending `staged/` items with no rendered console, so a human must resolve or discard them.
  - `docs/reconcile-checks.md:209`: add the reason to the same list.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/escalate-residue.test.js tests/reconcile.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/lib/reconcile/escalate-residue.js docs/reconcile-checks.md tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/escalate-residue.test.js
git commit -m "Add console-never-rendered-staged-pending skip reason — escalates as structurally stuck, refs #3297"
```

### Task 2: Step 4.2 reporting + short-circuit decision record

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md` — Step 4.2's "convergent cleanup" paragraph (l.75-83)
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md` — after the pr-first PushNotification paragraph (~l.210-215)
- Test: `tests/pr-first-merge.test.js` (`MERGE_POST_MERGE` and `AUTO_MERGE` are already loaded)

**Interfaces:**
- Consumes: Task 1's reason string `console-never-rendered-staged-pending`, which appears in the reconcile summary's `skipped: … run dir (…)` aggregation (`format-summary.js`).

- [ ] **Step 1: Write failing tests**
  - `AC1.1: Step 4.2 reports a console-never-rendered-staged-pending skip as needing human action, never as converging`: slice the Step 4.2 section (`### Step 4.2: Reconcile` to `## Step 5`). Assert it contains `` `console-never-rendered-staged-pending` ``. Assert it matches `/needs human action/`. Assert it carries an `AUTO {time} — pr-first-merge Step 4.2:` log line naming the reason.
  - `AC2.1: Step 4.2 still leaves a transient failure for the next trigger point`: the same section still matches `/left for the next trigger point/`.
  - `Deliverable 2: auto-merge-short-circuit records why it writes no console.json (#3297)`: `AUTO_MERGE` matches `/console\.json/` and `/#3297/` within the pr-first paragraph region.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/pr-first-merge.test.js`
Expected: FAIL after Step 1 on the AC1.1 and Deliverable 2 tests (AC2.1 passes already, a pin against regression).

- [ ] **Step 3: Edit the prose**
  - Step 4.2: keep the transient sentence ("…logged and left for the next trigger point…"). Replace the #3249 parenthetical's last clause with this: when the reconcile summary's skip line names `console-never-rendered-staged-pending`, the run is not converging. It merged with no rendered console and pending `staged/` items, and a human must resolve or discard them. Log `AUTO {time} — pr-first-merge Step 4.2: {N} run dir(s) skipped console-never-rendered-staged-pending — needs human action (pending staged/ items, no rendered console); not left for the next trigger point. Reversibility: n/a.` and carry "needs human action" into the closing report. Note that reconcile also escalates it through the consolidated `structurally-stuck` record once the dir sits untouched past the 7-day TTL. The outcome is still `merged`.
  - `auto-merge-short-circuit.md`: add one paragraph, "Why no `console.json` (#3297)". It records that writing a minimal `console.json` here was evaluated and rejected. A PushNotification FYI records only that a notification was sent, not that anyone approved or discarded the staged proposals. Marking the console resolved would let reconcile archive those proposals out of the console's sight, which is the #657/#1130 loss. Instead, a run left with pending `staged/` items reports `console-never-rendered-staged-pending` and escalates (`pr-first-merge-post-merge.md` Step 4.2).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/pr-first-merge.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge-post-merge.md plugin/skills/wrap-up/auto-merge-short-circuit.md tests/pr-first-merge.test.js
git commit -m "Report pending-staged reconcile skips as needing human action — Step 4.2 + short-circuit console.json decision, refs #3297"
```
