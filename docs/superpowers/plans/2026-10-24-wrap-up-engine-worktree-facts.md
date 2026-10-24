# wrap-up-engine plan: pin worktree-own references facts (#3925) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin, with a linked-worktree test, that `wrap-up-engine.js plan`'s `references` row (`renamedDeleted`) and its `journeys` row (`changedFiles` × `journeyFiles`) come from the worktree branch's own diff, even after the main checkout has moved on.

**Architecture:** The production fix already landed in 255ec7594 (#3431). `runPlan` passes `resolveFactsRoot(cwd)` (`git rev-parse --show-toplevel`) to `gatherFacts`, and `resolveTelemetryPath` still anchors to the main checkout through `resolveRepoRoot`. The existing #3431 tests pin the `journeys` row only, and their main checkout never moves after the branch point. This plan adds one test in which both sides rename a different file after branching (the observed bug's signature) and asserts that both rows report only the worktree's side. No production code changes.

**Tech Stack:** Node 18+, `node --test`, git CLI fixtures.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T080530-record-3925/work/3925-spec.md`

## Global Constraints

- No production code change: `plugin/bin/wrap-up-engine.js` and `plugin/bin/lib/wrap-up/facts.js` stay byte-identical at the end of the task.
- `resolveTelemetryPath` stays anchored to the main checkout (already pinned by the `AC2: ... telemetry to the main checkout (#3431)` test; leave it untouched).
- `npm test` passes with no new skips.

## Review Focus

- A rename on the main checkout after the branch point must not leak into the worktree's `references` candidates. This is the exact #3918 observation, pinned by Task 1's test.
- A file the main checkout moved (here `docs/journeys/j1.md`) still exists on the worktree branch, so it must stay a `journeys` candidate. Pinned by the same test's journeys assertion.
- The test must go red when `gatherFacts` is handed the common-dir root again. Proven by Task 1 Step 2's revert.

---

### Task 1: Linked-worktree references-row test

**Files:**
- Test: `tests/bin-lib/wrap-up/engine-cli.test.js` (the `withLinkedWorktree` fixture near line 171 plus one new test after the `AC2 ... (#3431)` test near line 234)

**Interfaces:**
- Consumes: `withLinkedWorktree(fn)` → calls `fn({ mainDir, wtDir, baseSha })`; `run(args, { cwd })` → `{ status, stdout, stderr }`; `git(args, cwd)`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the test**

Add `docs/guide.md` (content `'# Guide\n'`) to `withLinkedWorktree`'s base commit, written before the existing `git add .` in `mainDir`. This is additive; the existing three #3431 tests' assertions are unaffected because `docs/guide.md` matches no journey's `files:` list.

New test, named `'AC1.1: plan run from a linked worktree reports only the worktree branch renames after main moves on (#3925)'`. Inside `withLinkedWorktree(({ mainDir, wtDir, baseSha }) => { ... })`:
- In `wtDir`: `git mv docs/guide.md docs/guide-wt.md`, then commit.
- In `mainDir`: `git mv docs/journeys/j1.md docs/journeys/j1-main.md`, then commit. This is main moving on after the branch point.
- Run `plan --run-dir <mkdtemp under mainDir> --base baseSha --dry-run` with `cwd: wtDir` and assert `status === 0`.
- `references` row: `gate === 'open'`, and `scope.candidates` deepStrictEqual `[{ status: 'R', oldPath: 'docs/guide.md', newPath: 'docs/guide-wt.md' }]`.
- `journeys` row: `scope.candidates` deepStrictEqual `['docs/journeys/j1.md', 'docs/journeys/j2.md']`.

- [ ] **Step 2: Prove the test discriminates (revert-to-red) — AC2.1**

Temporarily change `plugin/bin/wrap-up-engine.js` `runPlan`'s `const factsRoot = resolveFactsRoot(cwd);` to `const factsRoot = resolveRepoRoot(cwd);`, then run:

Run: `node --test tests/bin-lib/wrap-up/engine-cli.test.js`
Expected: FAIL, with the new #3925 test red on the `references` candidates (main's `docs/journeys/j1.md` → `j1-main.md` rename appears instead of the worktree's).

Restore the line, then confirm `git diff --stat plugin/bin/` is empty.

- [ ] **Step 3: Run the suite file green**

Run: `node --test tests/bin-lib/wrap-up/engine-cli.test.js`
Expected: PASS (all tests, including the three existing #3431 tests).

Waived AC3.1: `npm test` passes with no new skips is checked by /build Common Step 5's full-suite verification, not by a test step.

- [ ] **Step 4: Commit**

```bash
git add tests/bin-lib/wrap-up/engine-cli.test.js
git commit -m "Pin wrap-up-engine plan worktree-own references facts — linked-worktree test with main moving on (refs #3925)"
```
