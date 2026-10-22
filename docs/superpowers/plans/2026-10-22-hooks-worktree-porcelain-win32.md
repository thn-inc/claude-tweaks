# Hooks: Windows-safe porcelain worktree lookup (#3811) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two remaining hook lookups that strictly compare a `git worktree list --porcelain` path against the native `ctx.cwd` match on Windows, by sharing #3695's `findWorktreeEntry` compare key.

**Architecture:** Move `findWorktreeEntry(entries, target, pathImpl = path)` from `teardown-run.js` into `worktree-reap.js`, next to `parseWorktreeList`, and have `teardown-run.js` import and re-export it. Replace `entries.findIndex((e) => e.path === cwd)` at `post-tool-use.js`'s `resolveWorktreePathViaPorcelain` and `context.js`'s `stampAdHocRunDirForDenial` with the helper. `isMain` becomes `entry === entries[0]`. Each site gets an optional `deps = { runGit, pathImpl }` seam so a test can feed it Windows porcelain plus `path.win32` on any host.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T083424-record-3811/work/3811-spec.md` (GitHub issue #3811)

## Global Constraints

- The compare key is #3695's existing helper, unchanged: both sides go through `pathImpl.resolve`; case folds only when `pathImpl.sep === '\\'`; a falsy target returns `null`.
- The return shapes stay the same: `resolveWorktreePathViaPorcelain` returns `{ path, isMain } | null`, where `path` is the porcelain entry's own `path` string, not the cwd. `stampAdHocRunDirForDenial` still keys `worktreePath` on the matched entry's `path`.
- `isMain` is true only for the first porcelain entry.
- After the change, `git grep -nP "\.path\s*===\s*cwd" -- plugin/bin` finds nothing. (The spec's AC3 uses `-E`. `git grep -E` here does not treat `\s` as whitespace, so the `-E` form matches nothing whether or not the compare is gone. Task 4 adds a source-scan test that pins the same check, so it can actually go red.)
- No change to any other `parseWorktreeList` consumer. The realpath-normalized lookups (`isWorktreeLocked`, `resume-freshness.js`, `flow/consolidated-pass.js`, `run-integrity.js`) are out of scope.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Review Focus

- A Windows cwd with a trailing backslash or different drive-letter case (`d:\a\x\feat\`) must still match `D:/a/x/feat`. Covered by the Task 2 and Task 3 pins.
- The main checkout (first porcelain entry) must report `isMain: true`, and a linked worktree must report `false`. A change from index to entry identity must not flip this. Covered by the Task 2 pin.
- A cwd matching no listed worktree must still return `null`, not the main entry. `path.resolve('')` would otherwise collapse onto the process cwd, and the helper's falsy guard is what prevents that. Covered by the Task 2 and Task 3 pins.
- POSIX stays case-sensitive (`/a/X` ≠ `/a/x`). Already pinned in `tests/hooks-teardown-run.test.js`, and that pin keeps running against the moved helper.
- `git worktree list` failure must still return `null`. This is unchanged code, and the existing tests cover it.

---

### Task 1: Move `findWorktreeEntry` into `worktree-reap.js`

**Files:**
- Modify: `plugin/bin/lib/hooks/worktree-reap.js` (add the helper after `parseWorktreeList`, add it to `module.exports`)
- Modify: `plugin/bin/lib/hooks/teardown-run.js:19,75-88,328` (delete the local definition and its comment block, import from `./worktree-reap`, keep it in `module.exports`)
- Test: `tests/hooks-worktree-reap.test.js`

**Interfaces:**
- Produces: `findWorktreeEntry(entries: Array<{path:string}>, target: string|null, pathImpl = require('path')) -> entry | null`, exported from `plugin/bin/lib/hooks/worktree-reap.js`. Its behavior and its #3695 comment are identical to the current `teardown-run.js` copy.

- [ ] **Step 1: Write the failing test** in `tests/hooks-worktree-reap.test.js`. Add `findWorktreeEntry` to the destructured import from `../plugin/bin/lib/hooks/worktree-reap`, then add:

```js
test('#3811: findWorktreeEntry lives beside parseWorktreeList and teardown-run re-exports the same function', () => {
  const entries = parseWorktreeList('worktree D:/a/x\nbranch refs/heads/trunk\n\nworktree D:/a/x/feat\nbranch refs/heads/feat\n\n');
  assert.strictEqual(findWorktreeEntry(entries, 'D:\\a\\x\\feat', path.win32).branch, 'feat');
  assert.strictEqual(require('../plugin/bin/lib/hooks/teardown-run').findWorktreeEntry, findWorktreeEntry);
});
```

(Require `path` at the top of the file if it is not already imported.)

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/hooks-worktree-reap.test.js`
Expected: FAIL (`findWorktreeEntry is not a function`)

- [ ] **Step 3: Move the helper.** Cut the definition and its `// #3695:` comment from `teardown-run.js` into `worktree-reap.js`, directly after `parseWorktreeList`. `worktree-reap.js` already requires `path`. Add `findWorktreeEntry` to `worktree-reap.js`'s exports. In `teardown-run.js`, add `findWorktreeEntry` to the existing `require('./worktree-reap')` destructure and keep it in `module.exports`.

- [ ] **Step 4: Run both suites and confirm they pass**

Run: `node --test tests/hooks-worktree-reap.test.js tests/hooks-teardown-run.test.js`
Expected: PASS, including the existing `#3695 AC3` source scan. It still finds ≥3 `findWorktreeEntry(` occurrences: two call sites, plus the `module.exports` key. If that count drops below 3 (the exports line has no `(`), the test is checking call sites, and there are only 2 left. In that case update the assertion to `>= 2` and keep its `doesNotMatch(/\.path\s*[!=]==?/)` half unchanged.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/worktree-reap.js plugin/bin/lib/hooks/teardown-run.js tests/hooks-worktree-reap.test.js
git commit -m "Move findWorktreeEntry beside parseWorktreeList — refs #3811"
```

### Task 2: `post-tool-use.js` — `resolveWorktreePathViaPorcelain` uses the shared compare

**Files:**
- Modify: `plugin/bin/lib/hooks/post-tool-use.js:26` (import), `:237-246` (function), `:722` (exports)
- Test: `tests/hooks-post-tool-use-worktree-staleness.test.js`

**Interfaces:**
- Consumes: `findWorktreeEntry` from Task 1.
- Produces: `resolveWorktreePathViaPorcelain(ctx, deps = {}) -> { path: string, isMain: boolean } | null`, now exported from `post-tool-use.js` (`module.exports = { run, resolveWorktreePathViaPorcelain }`). `deps.runGit` defaults to the module's `runGit`, and `deps.pathImpl` defaults to `path`. Existing callers pass no `deps`.

- [ ] **Step 1: Write the failing test** in `tests/hooks-post-tool-use-worktree-staleness.test.js`:

```js
test('#3811: resolveWorktreePathViaPorcelain matches win32 forward-slash porcelain against a backslash cwd', () => {
  const porcelain = 'worktree D:/a/x\nbranch refs/heads/trunk\n\nworktree D:/a/x/feat\nbranch refs/heads/feat\n\n';
  const deps = { runGit: () => ({ stdout: porcelain, failure: null }), pathImpl: path.win32 };
  assert.deepStrictEqual(post.resolveWorktreePathViaPorcelain({ cwd: 'D:\\a\\x\\feat' }, deps), { path: 'D:/a/x/feat', isMain: false });
  assert.deepStrictEqual(post.resolveWorktreePathViaPorcelain({ cwd: 'd:\\a\\x\\feat\\' }, deps), { path: 'D:/a/x/feat', isMain: false });
  assert.deepStrictEqual(post.resolveWorktreePathViaPorcelain({ cwd: 'D:\\a\\x' }, deps), { path: 'D:/a/x', isMain: true });
  assert.strictEqual(post.resolveWorktreePathViaPorcelain({ cwd: 'D:\\elsewhere' }, deps), null);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/hooks-post-tool-use-worktree-staleness.test.js`
Expected: FAIL (`post.resolveWorktreePathViaPorcelain is not a function`)

- [ ] **Step 3: Implement.** Add the `deps` parameter. Call `(deps.runGit || runGit)(['worktree', 'list', '--porcelain'], cwd)`, then `const entry = findWorktreeEntry(entries, cwd, deps.pathImpl || path)`. Return `null` when there is no entry, otherwise `{ path: entry.path, isMain: entry === entries[0] }`. Add `findWorktreeEntry` to the line-26 `require('./worktree-reap')` destructure, and add the function to `module.exports`. Keep the function's leading comment and its `{ path, isMain }` contract sentence accurate.

- [ ] **Step 4: Run the suite and confirm it passes**

Run: `node --test tests/hooks-post-tool-use-worktree-staleness.test.js`
Expected: PASS

- [ ] **Step 5: Prove the pin discriminates.** Temporarily restore `entries.findIndex((e) => e.path === cwd)` at this site, re-run Step 4's command, and confirm FAIL. Then restore the fix and re-run to confirm PASS. This is a scratch check: do not commit the reverted state.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/post-tool-use.js tests/hooks-post-tool-use-worktree-staleness.test.js
git commit -m "Match porcelain worktree paths Windows-safely in post-tool-use — refs #3811"
```

### Task 3: `context.js` — `stampAdHocRunDirForDenial`'s lookup uses the shared compare

**Files:**
- Modify: `plugin/bin/lib/hooks/context.js:8` (import), `:785-812` (extract the lookup), `:885-888` (exports)
- Test: `tests/hooks-denial-run-dir.test.js`

**Interfaces:**
- Consumes: `findWorktreeEntry` from Task 1.
- Produces: `listedWorktreeForCwd(cwd: string, deps = {}) -> { path: string, isMain: boolean } | null`, exported from `context.js`. It is the porcelain-lookup half of `stampAdHocRunDirForDenial`, split out so the compare is testable without minting a run dir. `deps.runGit` defaults to `runGit`, and `deps.pathImpl` defaults to `path`. It returns `null` for a falsy or non-string cwd, a failed `git worktree list`, or no matching entry. `stampAdHocRunDirForDenial` replaces its inline `runGit` / `parseWorktreeList` / `findIndex` / `worktreePath` lines with `const wt = listedWorktreeForCwd(cwd); if (!wt) return null; const worktreePath = wt.path;`, inside its existing `try`. Its behavior is otherwise unchanged.

- [ ] **Step 1: Write the failing test** in `tests/hooks-denial-run-dir.test.js`:

```js
test('#3811: listedWorktreeForCwd matches win32 forward-slash porcelain against a backslash cwd', () => {
  const porcelain = 'worktree D:/a/x\nbranch refs/heads/trunk\n\nworktree D:/a/x/feat\nbranch refs/heads/feat\n\n';
  const deps = { runGit: () => ({ stdout: porcelain, failure: null }), pathImpl: path.win32 };
  assert.deepStrictEqual(ctxLib.listedWorktreeForCwd('D:\\a\\x\\feat', deps), { path: 'D:/a/x/feat', isMain: false });
  assert.deepStrictEqual(ctxLib.listedWorktreeForCwd('D:\\a\\x', deps), { path: 'D:/a/x', isMain: true });
  assert.strictEqual(ctxLib.listedWorktreeForCwd('D:\\elsewhere', deps), null);
  assert.strictEqual(ctxLib.listedWorktreeForCwd('', deps), null);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/hooks-denial-run-dir.test.js`
Expected: FAIL (`ctxLib.listedWorktreeForCwd is not a function`)

- [ ] **Step 3: Implement** per the Interfaces block. Add `findWorktreeEntry` to the line-8 `require('./worktree-reap')` destructure, and add `listedWorktreeForCwd` to `module.exports`.

- [ ] **Step 4: Run the suite and confirm it passes**

Run: `node --test tests/hooks-denial-run-dir.test.js tests/friction-main-checkout-denial-coverage.test.js tests/teardown-gate.test.js`
Expected: PASS. The existing real-git `stampAdHocRunDirForDenial` tests still mint.

- [ ] **Step 5: Prove the pin discriminates.** Temporarily put a strict `entries.findIndex((e) => e.path === cwd)` compare back into `listedWorktreeForCwd`, re-run `node --test tests/hooks-denial-run-dir.test.js`, and confirm FAIL. Restore the fix and confirm PASS. This is a scratch check only.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/context.js tests/hooks-denial-run-dir.test.js
git commit -m "Match porcelain worktree paths Windows-safely in denial run-dir stamping — refs #3811"
```

### Task 4: Pin AC3 — no strict porcelain-vs-cwd compare left in `plugin/bin`

**Files:**
- Test: `tests/hooks-worktree-reap.test.js`

**Interfaces:**
- Consumes: Tasks 2 and 3 having removed both compares.

- [ ] **Step 1: Write the test.** It walks `plugin/bin` recursively for `*.js` files (`fs.readdirSync(dir, { recursive: true })` is available on Node 18.17+; otherwise use a small manual recursion) and asserts that no file's source matches `/\.path\s*===\s*cwd\b/`. On failure, it names each offending file.

```js
test('#3811 AC3: no plugin/bin module compares a porcelain entry path strictly against cwd', () => {
  const offenders = /* every plugin/bin/**/*.js whose source matches /\.path\s*===\s*cwd\b/ */;
  assert.deepStrictEqual(offenders, []);
});
```

- [ ] **Step 2: Run the test and confirm it passes, then prove that it can fail.** Run `node --test tests/hooks-worktree-reap.test.js` and expect PASS. Then temporarily restore one site's strict compare and confirm FAIL, naming that file. Restore the fix.

- [ ] **Step 3: Verify the grep form**

Run: `git grep -nP "\.path\s*===\s*cwd" -- plugin/bin`
Expected: no output (exit 1)

- [ ] **Step 4: Commit**

```bash
git add tests/hooks-worktree-reap.test.js
git commit -m "Pin no strict porcelain-vs-cwd compare in plugin/bin — refs #3811"
```
