# Bookkeeping-Stamps Gate Scratch-Worktree Regression Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin, with a regression test, that a scratch worktree with no pipeline run of its own is never denied by `checkBookkeepingStampsGate` on account of an unrelated dangling non-terminal run that has a landed materialize commit but no recorded worktree assignment.

**Architecture:** No production code changes. Empirical investigation (see Current State below) proved `checkBookkeepingStampsGate`'s `hasMaterializeCommit` helper already can't see an unrelated run's materialize commit from a different, unmerged worktree/branch, because `#1674` bounded its pathspec search to `{integration}..HEAD` (this worktree's own unique commits only). A fresh scratch worktree with zero commits of its own therefore already returns `{}` (allow) for exactly the scenario record #1460 describes — proven live via a throwaway probe script, not by re-reading the record's prose. This plan adds one regression test to `tests/hooks-bookkeeping-stamps-gate.test.js` that locks in this already-correct behavior, following the file's own established fixture conventions (`gitRepo()`, `linkedWorktreeOf()`, `commitMaterializedSpec()`, `mkRunDir()`).

**Tech Stack:** Node.js `node --test` (no external test framework), the existing `pre-tool-use.js`/`context.js` hook modules under `plugin/bin/lib/hooks/`.

**Spec:** `.claude-tweaks/pipelines/2026-09-16T234554-record-1460/work/1460-spec.md` (materialized from GitHub issue #1460)

## Global Constraints

- No changes to `plugin/bin/lib/hooks/pre-tool-use.js` or `plugin/bin/lib/hooks/context.js` — the underlying gate behavior is already correct; this plan only adds test coverage.
- New test must use the test file's own existing helpers (`gitRepo`, `linkedWorktreeOf`, `commitMaterializedSpec`, `mkRunDir`, `editInput`) — do not duplicate fixture logic.
- Test must name record #1460 in its title, per the file's existing convention of citing the issue/record number each test traces to (see `#1520`, `#1258`, `#1259` examples already in the file).

## Premise-check finding (read before implementing)

The record's Current State describes a live-reproduced denial: a scratch worktree (per `_shared/scratch-worktree.md`) hitting `checkBookkeepingStampsGate`'s deny while an unrelated dangling run (materialize commit landed, no worktree ever recorded) exists. Two probe scripts run against this checkout's current `plugin/bin/lib/hooks/pre-tool-use.js` (2026-09-17) show:

1. **Reproduction attempt** (dangling run's materialize commit lands in a *separate*, never-merged worktree/branch; a fresh scratch worktree with zero commits of its own then edits a file, with `ctx.runDir` pointed at the dangling run) → result: `{}` (**allow** — not denied).
2. **Positive control** (materialize commit lands *in the same worktree* being edited, no worktree stamp recorded) → result: **deny**, `record-worktree`/`IL-131` message — matching the file's existing `line 97` test exactly, confirming the probe harness itself is sound.

Root cause of the discrepancy with the record's prose: `hasMaterializeCommit(worktreeRoot, runDir)` (`pre-tool-use.js` ~line 967) bounds its pathspec search to `{integration}..HEAD` since `#1674` — commits reachable from this worktree's own `HEAD` but not from the integration branch. A scratch worktree that has made no commits of its own can never match a pathspec scoped to *its own* unique commits, regardless of what unrelated run `ctx.runDir` happens to resolve to. This means `#1674` (and `#1688`'s follow-on local-branch-bound fix) already closed this exact gap as a side effect, before #1460 reached this pipeline run.

**Conclusion:** no production fix is needed. The record's Deliverable #1 ("a way for the gate to recognize a scratch worktree… and skip the gate") is already satisfied by the existing `{integration}..HEAD` bound — it doesn't need a *new*, scratch-worktree-specific mechanism. Deliverable #2 (a regression test reproducing this exact scenario) is still real, unmet work: no existing test in `tests/hooks-bookkeeping-stamps-gate.test.js` or `tests/hooks-pre-tool-use.test.js` covers "unrelated dangling run in a *different* worktree + a fresh scratch worktree." This plan adds exactly that test.

## Task 1: Regression test — unrelated dangling run does not deny a fresh scratch worktree

**Files:**
- Modify: `tests/hooks-bookkeeping-stamps-gate.test.js` (append after the file's last test, currently ending at line 1051)

**Interfaces:**
- Consumes: `gitRepo()`, `linkedWorktreeOf(main)`, `commitMaterializedSpec(wt, tailPath, runId)`, `mkRunDir(project, worktree, sessionId, extra)`, `editInput(filePath)`, `pre.run(ctx, deps)` — all already defined at the top of this test file (lines 1-69); no new helpers needed.
- Produces: nothing consumed by later tasks (this is the only task).

- [ ] **Step 1: Write the failing-first regression test**

Append to `tests/hooks-bookkeeping-stamps-gate.test.js`, immediately after the file's current last line (`});` closing the `#1258` "caught model-resolution exception" test):

```javascript

// --- #1460: an unrelated dangling run must not deny a fresh scratch worktree ---
//
// _shared/scratch-worktree.md's throwaway checkouts (used by /tidy, /wrap-up's
// residue sweep, /init) never call materialize or record-worktree for
// themselves — they have no run-state.json of their own. When such a worktree's
// first Edit/Write resolves ctx.runDir to some OTHER, unrelated non-terminal run
// (bin/hooks.js's resolveRunDir has no session-id filtering and picks the newest
// non-terminal run repo-wide), a dangling run whose materialize commit landed
// elsewhere but was never followed by record-worktree must not have its
// missing-worktree-stamp deny fire against this unrelated scratch worktree.
// hasMaterializeCommit's #1674 range-bound (`{integration}..HEAD`, this
// worktree's own unique commits only) already closes this: a scratch worktree
// with zero commits of its own can never match the dangling run's materialize
// pathspec, regardless of which run ctx.runDir resolves to. This test pins that
// already-correct behavior so a future regression to hasMaterializeCommit's
// bound (e.g. reverting to an unbounded walk) is caught here, not live.
test('bookkeeping-stamps gate (#1460): an unrelated dangling run (materialize commit landed elsewhere, no worktree recorded) does not deny a fresh scratch worktree', () => {
  const main = gitRepo();

  // The dangling run's OWN worktree — a genuine prior /build attempt whose
  // materialize commit landed here, on a branch never merged into main (e.g.
  // its PR is still open, or it was interrupted before merging).
  const victimWt = linkedWorktreeOf(main);
  const runId = '2026-08-23T204821-record-361';
  commitMaterializedSpec(victimWt, path.join('work', '361-spec.md'), runId);

  // The dangling run dir: materialize commit landed (per victimWt above), but
  // record-worktree never ran — no `worktree`/`sessionId` field at all, the
  // exact "interrupted, no worktree ever recorded" shape #1460 describes.
  const project = projectDir();
  const run = path.join(project, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'interrupted' }));

  // A separate scratch worktree, freshly branched from main's current tip —
  // has made zero commits of its own and has never seen victimWt's materialize
  // commit (different branch entirely, never merged).
  const scratchWt = linkedWorktreeOf(main);

  const out = pre.run({
    input: editInput(path.join(scratchWt, 'src', 'x.js')),
    runDir: run,
    runState: { status: 'interrupted' },
    cwd: scratchWt,
  });
  assert.deepStrictEqual(
    out, {},
    'a scratch worktree with no commits of its own must not be denied on account of an unrelated dangling run\'s missing worktree stamp',
  );
});

// Control for the test above: the SAME dangling-run shape (materialize landed,
// no worktree recorded) still denies when the calling worktree IS the one the
// materialize commit actually landed in — proving the allow above comes from
// "this worktree never touched that run," not from a broken fixture or a
// gate that stopped enforcing the record-worktree stamp altogether. This is
// the AC2 case (genuine /build worktree missing its own stamp must still be
// denied) exercised with THIS test's own fixture shape rather than reusing the
// file's line-97 test's fixture — the record-worktree deny AC2 already asks
// for is already covered there, but this control keeps the #1460 scenario's
// own fixtures self-verifying, the same pairing the file's existing I2.1 test
// (line 615) uses.
test('bookkeeping-stamps gate (#1460 control): the same dangling-run shape still denies when the calling worktree IS the one that materialized it', () => {
  const main = gitRepo();
  const ownWt = linkedWorktreeOf(main);
  const runId = '2026-08-23T204821-record-361';
  commitMaterializedSpec(ownWt, path.join('work', '361-spec.md'), runId);

  const project = projectDir();
  const run = path.join(project, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify({ status: 'interrupted' }));

  const out = pre.run({
    input: editInput(path.join(ownWt, 'src', 'x.js')),
    runDir: run,
    runState: { status: 'interrupted' },
    cwd: ownWt,
  });
  assert.ok(out.json && out.json.hookSpecificOutput, 'control: the worktree that actually materialized this run must still be denied for its missing worktree stamp');
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, /record-worktree/);
});
```

- [ ] **Step 2: Run the new tests to verify they pass against current code**

Run: `node --test tests/hooks-bookkeeping-stamps-gate.test.js`
Expected: PASS — all tests in the file green, including the two new ones (`#1460` and `#1460 control`). This is a **pinning** test, not a red-then-green TDD cycle: the premise-check investigation above already proved the behavior is correct on current code, so there is no failing-code stage to drive through. Confirm both new tests actually execute (not skipped) by checking the test-count delta in the runner's summary line against the file's pre-change count (grep `^test(` for a baseline count if needed).

- [ ] **Step 3: Run the full pre-tool-use / bookkeeping-adjacent suites to confirm no collateral break**

Run: `node --test tests/hooks-bookkeeping-stamps-gate.test.js tests/hooks-pre-tool-use.test.js`
Expected: PASS — no change to production code means no other test in these files should be affected, but this confirms the new fixtures (temp dirs, worktrees) don't collide with anything else in the same process.

- [ ] **Step 4: Commit**

```bash
git add tests/hooks-bookkeeping-stamps-gate.test.js
git commit -m "$(cat <<'EOF'
Add regression test: unrelated dangling run does not deny a fresh scratch worktree

Empirical investigation (probe scripts against current pre-tool-use.js) found
the scenario in #1460's Current State no longer reproduces: hasMaterializeCommit's
#1674 range-bound (this worktree's own unique commits only) already means a
scratch worktree with zero commits of its own can never match an unrelated
dangling run's materialize pathspec. No production fix needed — this pins the
already-correct behavior so a future regression to that bound is caught here.

refs #1460
EOF
)"
```
