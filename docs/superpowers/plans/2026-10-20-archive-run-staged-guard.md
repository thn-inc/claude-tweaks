# archive-run staged-items guard (#3668) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `hooks.js archive-run` archiving a terminal fast-lane run whose console never rendered while `staged/` still holds pending proposals, and make reconcile's clean-status sweep escalate that same stuck state.

**Architecture:** `plugin/bin/lib/reconcile/archive-merged.js` gains `listStagedItems(runDir)` (the walk `hasStagedItems` already does, returning names; `hasStagedItems` becomes `listStagedItems(...).length > 0`) and `consoleReplacedByFastLaneFyi(runDir)` (reads `decisions.md` for the fast-lane short-circuit's own log line). `archive-run` refuses when the console is `'none'`, the fast-lane line is present, and items are pending. The clean-status sweep passes an `onSkip` that tracks only `console-never-rendered-staged-pending`.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T124145-record-3668/work/3668-spec.md` (materialized from GitHub issue #3668)

## Global Constraints

- Corrected premise (logged in decisions.md, "premise reversed (supersedes the 14:49:06 line)"): the guard is scoped to runs whose `decisions.md` matches `/(?:Fast-lane|Manifesto-authorized) auto-merge: issue #\d+, assess-agent-autonomy verdict auto-merge/` (the canonical continuation the short-circuit's log template writes — agents reuse the bare phrase in free-form text) and does not contain `Review Console: terminal decision` (a console was presented and resolved). A terminal run with retained `staged/` files and no such line still archives — in-terminal consoles, fleet-approved close proposals and `tidy --approve` runs retain `staged/` by design (261 archived runs in the main checkout have that shape).
- Refusal stdout prefix stays `claude-tweaks: archival refused — ` (every existing refusal uses it); the reason token is `console-never-rendered-staged-pending` (the reason reconcile already uses for the same state).
- Recovery text names the same remedies `escalate-residue.js:92` already gives: apply or delete the files under `staged/` (and any `spec-*/staged/`), or write a resolved `console.json`.
- Dotfiles are never items; a non-ENOENT read failure counts as pending (unchanged `hasStagedItems` semantics).
- Commit subjects: `{Verb} {what} — {detail}`, body line `refs #3668` (never closes/fixes).

## Review Focus

- A `staged/` holding only `.DS_Store` on a fast-lane run → archives (pinned in Task 1, AC2.1).
- Items only under `spec-N/staged/` (multi-spec) → refused, named with their `spec-N/` prefix (Task 1, AC1.2).
- A run whose `decisions.md` has the ledger-deletion line `Fast-lane auto-merge: deleted resolved ledger …` but no `issue #N` line → not treated as fast-lane (Task 1 unit test).
- A terminal run with pending `staged/` and no fast-lane line → still archives exactly as today (Task 1 regression pin).
- Clean-sweep tracking must not widen to other reasons — the existing `no-pr` clean-loop test stays green unchanged in behavior (Task 2).

---

### Task 1: archive-run refuses a fast-lane run with pending staged items

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`hasStagedItems` ~l.411-448, `module.exports` ~l.2197)
- Modify: `plugin/bin/hooks.js:1133-1170` (archive-run block)
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md:34` (one sentence describing the verb's code-enforced refusals)
- Test: `tests/archive-run-verb.test.js`, `tests/bin-lib/reconcile/archive-merged.test.js`

**Interfaces:**
- Produces: `listStagedItems(runDir: string) -> string[]` — run-dir-relative POSIX names, `staged/{name}` then `spec-N/staged/{name}`, spec dirs and names each sorted (readdir order is unspecified); a non-ENOENT read failure yields one entry `{rel}/ (unreadable: {err.code})`. `hasStagedItems(runDir) -> boolean` (now exported, `listStagedItems(runDir).length > 0`). `consoleReplacedByFastLaneFyi(runDir: string) -> boolean` — true iff `{runDir}/decisions.md` reads and matches `/Fast-lane auto-merge: issue #\d+/`; any read failure → false.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/reconcile/archive-merged.test.js` (import the three new exports):
- `listStagedItems: names top-level and spec-N staged items, skips dotfiles, reports an unreadable dir` — fixture with `staged/reflect-1.md`, `staged/.DS_Store`, `spec-3375/staged/review-1.patch`, and `spec-3380/staged` as a plain file; `assert.deepStrictEqual(listStagedItems(dir), ['staged/reflect-1.md', 'spec-3375/staged/review-1.patch', 'spec-3380/staged/ (unreadable: ENOTDIR)'])`.
- `consoleReplacedByFastLaneFyi: true only for the short-circuit's issue line` — decisions.md with `- AUTO 19:26:04 — log-decision: Fast-lane auto-merge: issue #3130, assess-agent-autonomy verdict auto-merge, pr-first-merge outcome merged.` → true; with only `- AUTO 07:38:10 — log-decision: Fast-lane auto-merge: deleted resolved ledger docs/plans/x-ledger.md for #3114 before merge.` → false; no decisions.md → false.

In `tests/archive-run-verb.test.js` (fixture: `runDirFixture('clean')` plus a `decisions.md` holding the #3130-shaped fast-lane line above):
- `AC1.1: archive-run refuses a terminal fast-lane run with no console.json and a pending staged/ item, naming it` — `staged/reflect-1.md` + `staged/wrap-up-skill-1.md`; assert stdout matches `/archival refused — console-never-rendered-staged-pending/`, includes `staged/reflect-1.md` and `staged/wrap-up-skill-1.md`, and `config.yml` still exists.
- `AC1.2: archive-run refuses when the only pending items sit under spec-N/staged/` — `spec-3375/staged/review-1.patch`; stdout includes `spec-3375/staged/review-1.patch`; run dir intact.
- `AC2.1: archive-run still archives a terminal fast-lane run with no console.json and nothing pending` — `staged/.DS_Store` only; stdout has no `archival refused`, run dir gone, `archive/{runId}/config.yml` exists.
- `archive-run archives a terminal run with retained staged/ items and no fast-lane short-circuit line (#3668 scope)` — `staged/shipped-close-3175.md`, decisions.md without the line; archived.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/archive-run-verb.test.js tests/bin-lib/reconcile/archive-merged.test.js`
Expected: FAIL — `listStagedItems`/`consoleReplacedByFastLaneFyi` not exported (TypeError); AC1.1/AC1.2 archive instead of refusing.

- [ ] **Step 3: Implement**

In `archive-merged.js`: add `listStagedItems` beside `hasStagedItems` (same dirs, same ENOENT/dotfile rules; extend the existing #3249/#3416 comment rather than duplicating it), redefine `hasStagedItems` on top of it, add `consoleReplacedByFastLaneFyi` with a comment naming `wrap-up/auto-merge-short-circuit.md` as the line's producer and why only that path is guarded (the 261-run probe). Export all three.

In `hooks.js` archive-run: after the existing `'unresolved'` refusal, when `readConsoleState(runDir) === 'none' && consoleReplacedByFastLaneFyi(runDir)`, compute `listStagedItems(runDir)`; when non-empty write `claude-tweaks: archival refused — console-never-rendered-staged-pending (the fast-lane auto-merge short-circuit rendered no console; pending: {items joined ', '}) — apply or delete the pending staged/ items (and any spec-*/staged/), or write a resolved console.json, then re-run archive-run\n` and `return 0`. Rewrite the #1130 AC4 comment above so it states both gates and why `'none'` without the fast-lane line stays allowed.

In `cleanup-procedures-execution.md:34`, extend the final clause: "…and the archive-run verb below refuses a rendered-but-unresolved console, and a fast-lane short-circuit run whose `staged/` still holds pending items (#3668)."

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/archive-run-verb.test.js tests/bin-lib/reconcile/archive-merged.test.js`
Expected: PASS (including the unchanged sweep-standalone `audit-untracked` test).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/hooks.js plugin/skills/wrap-up/cleanup-procedures-execution.md tests/archive-run-verb.test.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "Refuse archive-run on fast-lane runs with pending staged items — reuse hasStagedItems' walk via listStagedItems"
```

### Task 2: clean-status sweep tracks console-never-rendered-staged-pending

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (clean loop ~l.2159-2177, `iterCleanRunDirs` comment ~l.1705-1707, `archiveMergedRun` comment ~l.1810-1815)
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md:221-223`, `plugin/skills/_shared/pr-first-merge-post-merge.md:97-98` ("only while the run is not yet closed" becomes false)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`

**Interfaces:**
- Consumes: `trackStuckSkip(cacheTarget, repoSlug, dir, reason, { runner })`, `fixtureCleanUnarchivedRun({ runId, consoleResolved: false })`, `installGhWrapper`, `listResidueFailures`, `STRUCTURALLY_STUCK_TTL_MS`.

- [ ] **Step 1: Write the failing test**

`AC3.1: the clean-status sweep tracks a console-never-rendered-staged-pending skip toward structurally-stuck escalation (#3668)` — `fixtureCleanUnarchivedRun({ runId: '2026-10-16T155630-record-3668-clean', consoleResolved: false })`, add `staged/reflect-1.md`, backdate the dir `STRUCTURALLY_STUCK_TTL_MS * 2`, gh wrapper returns `[{ number: 99, state: 'MERGED', mergedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', mergeCommit: { oid: featureSha } }]`; assert the skip reason is `console-never-rendered-staged-pending` and `listResidueFailures(root)` has `{ reason: 'structurally-stuck', path: runDir }`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js --test-name-pattern "AC3.1"`
Expected: FAIL — no structurally-stuck residue entry.

- [ ] **Step 3: Implement**

Pass `onSkip: (reason) => { if (reason === 'console-never-rendered-staged-pending') trackStuckSkip(cacheBatch, repoSlug, dir, reason, { runner }); }` to the clean loop's `archiveMergedRun`. Replace the two comments that point at each other with the stated reason. Other reasons stay untracked because a clean run already finished wrap-up, so their states (`no-pr`, `pr-open`, …) have their own resolution paths or are pre-existing behavior the #1733 test pins. This one reason is tracked because close-run has already run: no later pipeline step will ever render a console or apply those items, and archive-run now refuses the same state, so without tracking the dir freezes silently. Update the `#3503` `iterCleanRunDirs` sentence "this loop has no stuck tracking" to "tracks only console-never-rendered-staged-pending". Update the existing `#1733` clean-loop test's comment and message so they say `no-pr` specifically and no longer claim every clean-loop skip is untracked; keep its assertion. In both skill files, replace "only while the run is not yet closed" / "while the run is not yet closed" with wording that says a closed run escalates the same way (reconcile's clean-status sweep, #3668).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/skills/wrap-up/auto-merge-short-circuit.md plugin/skills/_shared/pr-first-merge-post-merge.md tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "Track staged-pending skips in reconcile's clean-status sweep — closed fast-lane runs escalate instead of freezing"
```
