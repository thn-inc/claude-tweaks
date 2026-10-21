# Teardown Gate Mis-Cased Worktree Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the teardown gate's assigned-run deny match a `git worktree remove` target that differs from the recorded worktree only in letter case, on a case-insensitive volume.

**Architecture:** `findRunByWorktreePath` (`plugin/bin/lib/hooks/context.js`) resolves the target with the JS `fs.realpathSync`, which echoes input casing on a case-insensitive volume, so a mis-cased target misses its run. Switch both sides of that one lookup's comparison to path-guard's `canonicalRealpath` (the `.native`, OS-cased resolver the gate uses everywhere else, #3682), with an injectable `fsImpl` so the existing case-insensitive fake (`tests/helpers/case-insensitive-fs.js`) can drive it. Thread the same `fsImpl` through `checkTeardownGate`'s existence probe and lookup call, and through `shadowPipelineRunDir`.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T215208-record-3769/work/3769-spec.md`

## Global Constraints

- Every realpath in `pre-tool-use.js` goes through path-guard's `canonicalRealpath` / `resolveLeaf` (header comment line 40); keep it that way.
- `tests/path-guard-conformance.test.js`'s `ALLOWLIST` is an exact per-file token count: any change to the number of `realpathSync` tokens in `context.js` must update its entry (count and reason) in the same commit.
- Fail-open fallbacks stay: a path that does not resolve (a torn-down worktree) is compared as given, never treated as a match failure that throws.

## Review Focus

- A recorded worktree that is itself mis-cased while the target is correctly cased: both sides must canonicalize through the same resolver, or the fix only moves the mismatch. Test pinned in Task 1 (`findRunByWorktreePath (#3769): a mis-cased recorded worktree matches the correctly-cased target`).
- A target already gone from disk (`reap-merged.js`'s `resolveOwningRunDir` calls the lookup before removal, but a `canonicalRealpath` null must still fall back to the raw path): covered by the existing `tests/bin-lib/reconcile/reap-merged.test.js` and teardown-gate "gone" tests, which must stay green.
- A symlinked target still matches its canonical recorded assignment: existing test `realpath match (symlinked target) returns the run` in `tests/teardown-gate.test.js` must stay green.
- Callers that pass no `fsImpl` (`plugin/bin/hooks.js:335`, `plugin/bin/lib/reconcile/reap-merged.js:57`) get the real `fs` — `canonicalRealpath`'s `fsImpl = fs` default — so exact-case behavior is unchanged for them.
- On a case-sensitive volume two directories differing only in case are distinct; `.native` returns each one's own path, so no false match. Covered by the Linux CI run of the existing exact-case suites (the fake cannot model this).

---

### Task 1: Case-canonical resolver in `findRunByWorktreePath`, wired through the teardown gate

**Files:**
- Modify: `plugin/bin/lib/hooks/context.js:538-568` (`worktreeMatches`, `findRunByWorktreePath`; add the path-guard require at the top of the file)
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js:600-609` (`checkTeardownGate`'s existence probe and lookup call)
- Modify: `tests/path-guard-conformance.test.js` (the `'lib/hooks/context.js'` `ALLOWLIST` entry)
- Test: `tests/teardown-gate.test.js`

**Interfaces:**
- Produces: `findRunByWorktreePath(cwd, targetPath, opts = {})`, where `opts` gains `fsImpl` (an fs-like object, forwarded to `canonicalRealpath`; omitted → real `fs`). Return shape unchanged: `{ runDir, state } | null`.
- Produces: `worktreeMatches(state, target, targetPath, canonical)`, where the new optional 4th argument `canonical: (p) => string | null` resolves the recorded side. When it is given, `recorded = canonical(state.worktree) || state.worktree`. When it is omitted, keep today's JS `fs.realpathSync` try/catch. `findRunsByWorktreePath` and `classifyOwnership` keep calling it with 3 args (unchanged).

- [ ] **Step 1: Write the failing tests** in `tests/teardown-gate.test.js`, after the existing `findRunByWorktreePath` unit tests. Require `caseInsensitiveFs` from `./helpers/case-insensitive-fs`. Skip on win32 with the same reason string `tests/bin-lib/path-guard/pre-tool-use-identity.test.js` uses (`POSIX_ONLY`). Each test builds `root = fixtureRoot()` and `wt = path.join(root, 'wt-case')` (mkdir), then `fsImpl = caseInsensitiveFs({ [root]: 'dir', [wt]: 'dir' })` and `misCased = path.join(root, 'WT-CASE')`.
  - `AC1.1 (#3769): a mis-cased git worktree remove of an assigned, non-own-cwd worktree is denied`. Write `makeRun(root, JSON.stringify({ status: 'active', worktree: wt, sessionId: 's1' }))`, then call `preToolUse.run({ input: { tool_name: 'Bash', tool_input: { command: \`git worktree remove ${misCased}\` }, session_id: 's1' }, cwd: root, runDir: null, runState: null }, { fsImpl })`. Assert that `out.json.hookSpecificOutput.permissionDecision === 'deny'` and that `permissionDecisionReason` matches `/still assigned to non-terminal pipeline run/` and includes `path.basename(runDir)`.
  - `AC2.1 (#3769): the exact-case removal of the same assigned worktree is denied (control)`. Same setup, with the command naming `wt`, and the same two assertions.
  - `findRunByWorktreePath (#3769): a mis-cased target resolves to its run through an injected case-insensitive fs`. Assert that `findRunByWorktreePath(root, misCased, { fsImpl }).runDir === runDir`.
  - `findRunByWorktreePath (#3769): a mis-cased recorded worktree matches the correctly-cased target`. Run-state `worktree: misCased`; assert that `findRunByWorktreePath(root, wt, { fsImpl }).runDir === runDir`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="3769" tests/teardown-gate.test.js`
Expected: FAIL. `AC1.1` and both `findRunByWorktreePath (#3769)` tests fail. The deny test reads an allow, because the existence probe and the lookup still use the real fs, where `WT-CASE` either does not exist (Linux) or realpaths to its echoed casing (macOS); the two lookup tests return `null`. The control `AC2.1` already PASSES, because the exact-case path resolves on the real fs; it pins that the change keeps it passing.

- [ ] **Step 3: Implement**
  - `context.js`: `const { canonicalRealpath } = require('../path-guard');`. In `findRunByWorktreePath`, build `canonical = (p) => canonicalRealpath(p, { fsImpl: opts.fsImpl })`, then set `target = canonical(targetPath) || targetPath` and pass `canonical` as `worktreeMatches`'s 4th arg. This replaces the `fs.realpathSync` try/catch at line 562. Extend `worktreeMatches` per the Interfaces block, and update its header comment to name the 4th arg.
  - `pre-tool-use.js` `checkTeardownGate`: change the existence probe to `(fsImpl || fs).statSync(target)`, and change the lookup to `ctxLib.findRunByWorktreePath(ctx.cwd, target, { skipAdHoc: true, fsImpl })`.
  - `tests/path-guard-conformance.test.js`: set the `'lib/hooks/context.js'` entry to `realpathSync: 6` (line 562's token is gone). Rewrite the reason so it says that `findRunByWorktreePath` canonicalizes both sides through path-guard's `.native` `canonicalRealpath` (#3769). The remaining realpathSync sites (`worktreeMatches`'s default branch, `findRunsByWorktreePath`, `findAdHocRunsBySessionId`) use the same JS `fs.realpathSync` on both sides of their own comparisons. Keep the existsSync wording.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/teardown-gate.test.js tests/path-guard-conformance.test.js tests/bin-lib/path-guard/pre-tool-use-identity.test.js tests/bin-lib/reconcile/reap-merged.test.js`
Expected: PASS, with 0 failures.

- [ ] **Step 5: Prove the test discriminates** (AC3.1). Temporarily revert only the `context.js` resolver change. Restore line 562's `fs.realpathSync` try/catch and drop the 4th `worktreeMatches` arg, keeping the `pre-tool-use.js` `fsImpl` wiring. Run `node --test --test-name-pattern="AC1.1" tests/teardown-gate.test.js` and confirm it FAILS. Restore the change in the same step, re-run, and confirm it passes. Do not commit the revert.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/context.js plugin/bin/lib/hooks/pre-tool-use.js tests/teardown-gate.test.js tests/path-guard-conformance.test.js
git commit -m "Canonicalize findRunByWorktreePath through path-guard — mis-cased teardown target now denied, refs #3769"
```

### Task 2: Thread `fsImpl` through `shadowPipelineRunDir`

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js:682-744` (`shadowPipelineRunDir`, `checkPipelineShadowGuard`) and `:2130` (its `runInner` call), plus the `runInner` header comment (around line 2120) that lists which gates receive `deps`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `shadowPipelineRunDir(targetPath, { fsImpl } = {})` and `checkPipelineShadowGuard(ctx, deps = {})`. Both are export-compatible: existing 1-arg callers are unchanged.

- [ ] **Step 1: Implement.** In `shadowPipelineRunDir`, pass `{ fsImpl }` to both `canonicalRealpath(repoRoot, { fsImpl })` (line 690) and `realTarget(resolved, { fsImpl })` (line 695), so both operands of the `path.relative` comparison resolve on the same filesystem. `checkPipelineShadowGuard` forwards `deps.fsImpl`, and `runInner` calls `checkPipelineShadowGuard(ctx, deps)`. Add `checkPipelineShadowGuard` to the `runInner` header comment's list of gates `deps` is forwarded to.

- [ ] **Step 2: Run the existing shadow-guard suites**

Run: `node --test tests/hooks-pipeline-shadow-guard.test.js tests/hooks-adopt-run-dir.test.js tests/hooks-bookkeeping-stamps-gate.test.js tests/bin-lib/path-guard/pre-tool-use-identity.test.js`
Expected: PASS, with 0 failures (AC2.1: existing behavior unchanged).

- [ ] **Step 3: Commit**

```bash
git add plugin/bin/lib/hooks/pre-tool-use.js
git commit -m "Thread fsImpl through shadowPipelineRunDir — both operands resolve on one filesystem, refs #3769"
```
