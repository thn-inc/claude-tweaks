# wrap-up-engine plan: read repo facts from the worktree top-level (#3431) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `wrap-up-engine.js plan` run from a linked worktree reads the worktree branch's own diff and files, so the journeys/references/CLAUDE.md rows stop closing on an empty diff.

**Architecture:** Add a second root resolver, `resolveFactsRoot(cwd)` (`git rev-parse --show-toplevel`, falling back to `cwd`), next to the existing `resolveRepoRoot(cwd)` (common-dir parent, the main checkout). `runPlan` feeds `resolveFactsRoot` to `gatherFacts`/`buildJourneyFrontmatter`; telemetry keeps `resolveRepoRoot`. `runVerifyVerb` is audited and left functionally unchanged (see Task 1 Step 5).

**Tech Stack:** Node 18+ CommonJS, `node:child_process` `execFileSync`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T185805-record-3431/work/3431-spec.md` (materialized from GitHub issue #3431)

## Global Constraints

- Telemetry path stays `{main checkout}/.claude-tweaks/wrap-up-outcomes.tsv` — `resolveTelemetryPath` keeps calling `resolveRepoRoot` (common-dir).
- The #3017 subdirectory case must still pass: `--show-toplevel` from `<checkout>/sub` returns the checkout root.
- Every `execFileSync` git call in this file passes `stdio: ['ignore', 'pipe', 'ignore']` and `windowsHide: true` (match `resolveRepoRoot`).
- Commits reference the record as `refs #3431`, never a closing keyword.

## Review Focus

1. Not inside a git repo at all → `resolveFactsRoot` must return `cwd` (no throw), same as `resolveRepoRoot`'s catch. Covered by the shared try/catch shape; no new test (the no-repo path is already exercised by `tests/bin-lib/wrap-up/cli.test.js`'s out-of-repo cases for the facts layer).
2. Plan run from a subdirectory *of a linked worktree* → must still resolve the worktree top-level, not the subdirectory and not the main checkout. Pinned by Task 1's second test.
3. Telemetry written from a worktree run must land in the main checkout, never in the worktree (a worktree-local TSV is lost on teardown). Pinned by Task 1's third test.
4. `--run-dir` anchoring (main checkout) is independent of the facts root — a run dir under the main checkout must still be accepted when cwd is the worktree. Exercised by every Task 1 test (they all pass a main-anchored run dir from a worktree cwd).
5. `runVerifyVerb` diff checks from a worktree — already use raw `cwd` (git resolves the worktree's HEAD from any subdirectory); no behavior change, comment only.

**Dependency-caller enumeration:** `resolveFactsRoot` adds one `git rev-parse` subprocess; its only caller is `runPlan` (`git grep -n "gatherFacts(" -- plugin` → the definition at `lib/wrap-up/facts.js:163` plus the one call at `wrap-up-engine.js:216`; every other hit is a comment).

---

### Task 1: Resolve the facts root from the worktree top-level

**Files:**
- Modify: `plugin/bin/wrap-up-engine.js:111-140` (add `resolveFactsRoot` beside `resolveRepoRoot`; update the header comment at lines 26-28), `:207-217` (`runPlan`), `:511-516` (`runVerifyVerb` comment only)
- Test: `tests/bin-lib/wrap-up/engine-cli.test.js` (append after the #3017 test at line 150-166)

**Interfaces:**
- Produces: `resolveFactsRoot(cwd: string) -> string` — absolute worktree/checkout top-level; returns `cwd` when git fails or prints nothing. Module-private (not exported), like `resolveRepoRoot`.

- [ ] **Step 1: Write the failing tests** in `engine-cli.test.js`, with their own fixture (do not touch the shared `repoDir` fixture): a helper `makeLinkedWorktreeFixture()` that creates a fresh tmp main repo with one `base` commit holding `docs/journeys/j1.md` (frontmatter `files:` listing `src-a.js`) and `CLAUDE.md`, then `git worktree add -q -b wt-branch <tmp-sibling-dir> HEAD`, then in the worktree writes `src-a.js` and commits `wt change`. The main checkout's HEAD stays at `base`. Returns `{ mainDir, wtDir, baseSha }`; clean both dirs (worktree first via `git worktree remove --force`, then `fs.rmSync`) in a `finally`/`after`.

  Tests (run dir = `fs.mkdtempSync(path.join(mainDir, 'rundir-'))`, the main-anchored shape):

  ```js
  test('AC1/AC3: plan run from a linked worktree reports the worktree branch diff in the journeys row (#3431)', () => {
    // cwd: wtDir, args: plan --run-dir <runDir> --base <baseSha> --dry-run
    assert.strictEqual(r.status, 0, r.stderr);
    const journeysRow = JSON.parse(r.stdout).rows.find((row) => row.id === 'journeys');
    assert.deepStrictEqual(journeysRow.scope.candidates, ['docs/journeys/j1.md']);
  });

  test('AC1: plan run from a subdirectory of a linked worktree still resolves the worktree top-level (#3431)', () => {
    // cwd: fs.mkdtempSync(path.join(wtDir, 'sub-')), same args
    assert.deepStrictEqual(journeysRow.scope.candidates, ['docs/journeys/j1.md']);
  });

  test('AC2: plan run from a linked worktree still appends telemetry to the main checkout (#3431)', () => {
    // cwd: wtDir, args WITHOUT --dry-run
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(mainDir, '.claude-tweaks', 'wrap-up-outcomes.tsv')));
    assert.strictEqual(fs.existsSync(path.join(wtDir, '.claude-tweaks', 'wrap-up-outcomes.tsv')), false);
  });
  ```

- [ ] **Step 2: Run tests to verify the two journeys tests fail**

  Run: `node --test --test-name-pattern="3431" tests/bin-lib/wrap-up/engine-cli.test.js`
  Expected: FAIL — both journeys tests report `candidates` `[]` vs `['docs/journeys/j1.md']`; the AC2 telemetry test PASSES already (it guards the unchanged behavior).

- [ ] **Step 3: Implement `resolveFactsRoot(cwd)`** in `wrap-up-engine.js` directly below `resolveRepoRoot`: `execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim()`; empty output or a throw → `cwd`. Comment: common-dir is for telemetry only; repo facts read the worktree being built (#3431). In `runPlan`, replace `const repoRoot = resolveRepoRoot(cwd)` with `const factsRoot = resolveFactsRoot(cwd)` and pass it to `gatherFacts({ cwd: factsRoot, ... })` and `buildJourneyFrontmatter(factsRoot, ...)`; update the #3017 comment above it to say the facts root is the `--show-toplevel` of cwd (subdirectory and linked-worktree cases both). Update the file header comment (lines 26-28) to name `resolveFactsRoot()`. `resolveTelemetryPath` is untouched.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `node --test tests/bin-lib/wrap-up/engine-cli.test.js`
  Expected: PASS, including the #3017 subdirectory test and the existing telemetry test.

- [ ] **Step 5: `runVerifyVerb` audit (comment only).** Its `--base` diff checks (`carrier-commit`, `reference-repairs` in `plugin/bin/lib/wrap-up/engine-verify.js`) already run git with the raw `cwd`, which resolves the worktree's own HEAD; `repoRoot` there feeds only archive lookups (`resolveArchivedRunDir`, `run-dir-archived`) and `resolveRiskFloor`'s `policy.yml` read — both main-checkout-anchored by design. Extend the existing `#3017` comment in `runVerifyVerb` with one sentence recording this audit (#3431). No code change.

- [ ] **Step 6: Go-red control.** Temporarily revert Step 3's `runPlan` change (point `gatherFacts`/`buildJourneyFrontmatter` back at `resolveRepoRoot(cwd)`), re-run Step 2's command, confirm both journeys tests go red, then restore. (AC3: "The new test goes red when `runPlan` is pointed back at the common-dir root.")

- [ ] **Step 7: Commit**

  ```bash
  git add plugin/bin/wrap-up-engine.js tests/bin-lib/wrap-up/engine-cli.test.js
  git commit -m "Fix wrap-up-engine plan facts root inside a linked worktree — read --show-toplevel, keep common-dir for telemetry (refs #3431)"
  ```

---

## Self-review

- **Spec coverage:** Deliverable 1 (second root, common-dir only for telemetry) → Step 3; Deliverable 2 (`gatherFacts`/`buildJourneyFrontmatter` + `runVerifyVerb` audit) → Steps 3 and 5; Deliverable 3 (linked-worktree regression test that fails against common-dir) → Steps 1, 2, 6. AC1 → tests 1-2; AC2 → test 3; AC3 → Step 6.
- **Placeholders:** none.
- **Proportion:** one task, one implementation file, one test file.
