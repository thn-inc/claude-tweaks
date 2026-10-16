# close-run bare run-id basename resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `hooks.js close-run --run <run-id-basename>` resolves the run dir under the main checkout's `.claude-tweaks/pipelines/`, and `close-run` exits 1 when `--run` is rejected.

**Architecture:** One fallback branch in the shared `resolveRunArg` (`plugin/bin/hooks.js`): a separator-free `--run` value whose cwd-relative reading is not a directory is retried as `<mainCheckoutRoot(cwd)>/.claude-tweaks/pipelines/<value>`, used only when that is a directory; every existing anchoring/shape/initialization check then runs unchanged on the resolved path. Separately, `close-run`'s `invalidRunArg` branch returns 1.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T162743-spec-3025/work/3025-spec.md`

Scope keywords: resolveRunArg, run not closed

## Global Constraints

- The cwd-relative reading of `--run` runs first; the pipelines/ fallback triggers only when it is not a directory.
- A value containing a path separator (`/` or `\`) never falls through to the pipelines/ lookup.
- The `[IL-127]` anchoring check still applies to a basename-resolved path.
- Only `close-run`'s rejected-`--run` branch changes exit code; every other verb's `--run path rejected` branch still exits 0.
- No new dependency: use only `isDirectory` and `wtDetect.mainCheckoutRoot`, both already in `plugin/bin/hooks.js`.

## Review Focus

1. A bare basename passed from inside a linked worktree (dispatch's real call site) must resolve to the **main** checkout's pipelines dir, not the worktree's — pinned in Task 1.
2. A cwd-relative directory with the same name as a pipelines run must still win (and be judged on its own merits) — pinned in Task 1.
3. A bare basename naming no run dir must still be rejected with the original value in the message — pinned in Task 2.
4. `--run` with no value must not fall back to closing the newest non-terminal run, and now exits 1 — pinned in Task 2 (existing test, exit code updated).
5. Other verbs sharing `resolveRunArg` keep exit 0 on rejection — pinned in Task 2 (existing loop test, `close-run` special-cased).

---

### Task 1: Basename fallback in `resolveRunArg`

**Files:**
- Modify: `plugin/bin/hooks.js` (`resolveRunArg`, the `const resolved = candidate ? path.resolve(cwd, candidate) : null;` line, ~line 377)
- Modify: `plugin/skills/_shared/pipeline-run-dir.md` ("Pipeline-owned binaries" bullet, ~line 143)
- Test: `tests/hooks-dispatcher.test.js`

**Interfaces:**
- Consumes: `isDirectory(p)` and `wtDetect.mainCheckoutRoot(cwd)` (both already used in `plugin/bin/hooks.js`).
- Produces: `resolveRunArg` returns `{ runDir: <main>/.claude-tweaks/pipelines/<basename>, invalidRunArg: null, ... }` for an initialized run dir named by bare basename.

- [ ] **Step 1: Write the failing tests** — add after the test `'close-run with a non-existent --run path fails loudly instead of falling back'` in `tests/hooks-dispatcher.test.js`:

```js
test('close-run --run accepts a bare run-id basename, resolved under the main checkout\'s pipelines dir (dispatch/SKILL.md\'s $RUN_ID)', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  runHook(['record-worktree', '--run', run, '/tmp/wt-1'], { cwd: project });
  const result = runHook(['close-run', '--run', '2026-07-01T090000-spec-1'], { cwd: project });
  assert.strictEqual(result.code, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /--run path rejected/);
  assert.strictEqual(readRunState(run).status, 'clean');
});

test('close-run --run bare basename from inside a linked worktree resolves to the MAIN checkout\'s pipelines dir', () => {
  const project = tmpProject();
  execFileSync('git', ['-C', project, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const wt = path.join(project, '.claude', 'worktrees', 'wt-a');
  execFileSync('git', ['-C', project, 'worktree', 'add', '-q', '-b', 'wt-a', wt]);
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  runHook(['record-worktree', '--run', run, wt], { cwd: project });
  const result = runHook(['close-run', '--run', '2026-07-01T090000-spec-1'], { cwd: wt });
  assert.doesNotMatch(result.stdout, /--run path rejected/, result.stdout);
  assert.strictEqual(readRunState(run).status, 'clean');
});

test('close-run --run basename: a same-named cwd-relative directory wins over the pipelines/ fallback', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  runHook(['record-worktree', '--run', run, '/tmp/wt-1'], { cwd: project });
  fs.mkdirSync(path.join(project, '2026-07-01T090000-spec-1'));
  const result = runHook(['close-run', '--run', '2026-07-01T090000-spec-1'], { cwd: project });
  assert.match(result.stdout, /--run path rejected/, 'the cwd-relative dir is judged on its own and is not a run dir');
  assert.strictEqual(readRunState(run).status, 'active', 'the pipelines/ run must not be touched when a cwd-relative dir exists');
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test --test-name-pattern="bare run-id basename|bare basename from inside a linked worktree" tests/hooks-dispatcher.test.js`
Expected: FAIL — stdout contains `--run path rejected: 2026-07-01T090000-spec-1 — run not closed`.

- [ ] **Step 3: Implement the fallback** — in `plugin/bin/hooks.js` `resolveRunArg`, replace

```js
  const resolved = candidate ? path.resolve(cwd, candidate) : null;
```

with

```js
  let resolved = candidate ? path.resolve(cwd, candidate) : null;
  // #3025: a bare run-id basename (no path separator) — dispatch/SKILL.md's
  // `$RUN_ID`, the SessionStart notice's `close-run --run <dir>` — names a
  // run dir under the main checkout's .claude-tweaks/pipelines/, not a
  // cwd-relative path. Resolve it there only when the cwd-relative reading is
  // not a directory; every anchoring/shape/initialization check below still
  // runs unchanged against the resolved path.
  if (resolved && !isDirectory(resolved) && !/[\\/]/.test(candidate)) {
    const bareRoot = wtDetect.mainCheckoutRoot(cwd);
    const underPipelines = bareRoot ? path.join(bareRoot, '.claude-tweaks', 'pipelines', candidate) : null;
    if (underPipelines && isDirectory(underPipelines)) resolved = underPipelines;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-dispatcher.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Document the resolution** — in `plugin/skills/_shared/pipeline-run-dir.md`, the "Pipeline-owned binaries" bullet, replace

```
  `resolveRunArg` carries the one narrow exception to this rule — see **Worktree-local `--run`
  fallback (#280)** immediately below.
```

with

```
  `resolveRunArg` carries the one narrow exception to this rule — see **Worktree-local `--run`
  fallback (#280)** immediately below. A bare run id (no path separator) whose cwd-relative
  reading is not a directory is retried as `<main checkout>/.claude-tweaks/pipelines/<value>`
  (#3025) — the form `/claude-tweaks:dispatch`'s `$RUN_ID` and the SessionStart notice pass — and
  the anchoring check above still runs on that resolved path.
```

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/hooks.js tests/hooks-dispatcher.test.js plugin/skills/_shared/pipeline-run-dir.md
git commit -m "Resolve a bare run-id --run under the main checkout's pipelines dir — #3025"
```

### Task 2: `close-run` exits 1 on a rejected `--run`

**Files:**
- Modify: `plugin/bin/hooks.js` (`close-run` handler, the `if (invalidRunArg) { process.stdout.write(\`claude-tweaks: --run path rejected: ${invalidRunArg} — run not closed\n\`); }` branch, ~line 940)
- Test: `tests/hooks-dispatcher.test.js` (tests at ~lines 386, 406, 418, plus one new test)

**Interfaces:**
- Consumes: Task 1's `resolveRunArg` (unchanged signature).
- Produces: `close-run` process exit code 1 whenever `invalidRunArg` is set.

- [ ] **Step 1: Update/add the tests**

In `'record-pr, spec-status, close-run, teardown-run, ... each reject an uninitialized --run target'`, replace

```js
    assert.strictEqual(result.code, 0, `${verb}: unexpected exit code`);
```

with

```js
    // close-run exits non-zero on a rejected --run so a scripted caller
    // (dispatch's drain termination) can tell "not closed" from closed.
    assert.strictEqual(result.code, verb === 'close-run' ? 1 : 0, `${verb}: unexpected exit code`);
```

In `'close-run with a non-existent --run path fails loudly instead of falling back'` and `'close-run --run with no following value fails loudly ...'`, change `assert.strictEqual(result.code, 0);` to `assert.strictEqual(result.code, 1);`.

Add after Task 1's tests:

```js
test('close-run --run with a bare basename naming no run dir is still rejected, non-zero', () => {
  const project = tmpProject();
  const result = runHook(['close-run', '--run', '2026-07-02T090000-spec-9'], { cwd: project });
  assert.strictEqual(result.code, 1);
  assert.match(result.stdout, /--run path rejected: 2026-07-02T090000-spec-9 — run not closed/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node -e "const r=require('child_process').spawnSync('node',['plugin/bin/hooks.js','close-run','--run','2026-07-02T090000-spec-9']);process.exit(r.status===1?0:1)"`
Expected: FAIL — exit 1 (close-run currently exits 0 on the rejection). Then `node --test tests/hooks-dispatcher.test.js` shows the three updated/added `close-run` assertions failing with `0 !== 1`.

- [ ] **Step 3: Implement** — in the `close-run` handler of `plugin/bin/hooks.js`, change

```js
    if (invalidRunArg) {
      process.stdout.write(`claude-tweaks: --run path rejected: ${invalidRunArg} — run not closed\n`);
    } else if (candidates) {
```

to

```js
    if (invalidRunArg) {
      process.stdout.write(`claude-tweaks: --run path rejected: ${invalidRunArg} — run not closed\n`);
      return 1;
    } else if (candidates) {
```

- [ ] **Step 4: Run the affected suites**

Run: `node --test tests/hooks-dispatcher.test.js tests/hooks-help-guard.test.js tests/hooks-spec-status.test.js tests/hooks-worktree-local-fallback-disclosure.test.js`
Expected: PASS. Then `grep -rln "close-run" tests/ | xargs node --test` — PASS (any teardown-gate suite included).

- [ ] **Step 5: Check the dispatch caller** — confirm `plugin/skills/dispatch/SKILL.md`'s `close-run --run "$RUN_ID"` line is not run under `set -e` in a way the new exit 1 would abort; if it is, note it in the PR description (no skill edit — out of scope).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/hooks.js tests/hooks-dispatcher.test.js
git commit -m "Exit 1 from close-run when --run is rejected — #3025"
```
