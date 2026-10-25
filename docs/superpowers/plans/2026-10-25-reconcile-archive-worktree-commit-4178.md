# Pin reconcile archival git calls to the main checkout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reconcile archival run from a process whose cwd is a linked worktree, including one that inherited `GIT_DIR` pointing at that worktree, commits `[reconcile] archive run …` to the main checkout's branch and never to the worktree's branch.

**Architecture:** `archive-merged.js` already resolves `root` via `mainCheckoutRoot(start)` and runs every git call as `git -C <root>`. The one remaining way such a call lands in a linked worktree's repo is the environment: git honours an inherited `GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE` / `GIT_COMMON_DIR` over `-C`'s repository discovery. A probe confirmed it: `GIT_DIR=<main>/.git/worktrees/<wt>` makes `git -C <main> mv … && git -C <main> commit -- …` advance the worktree's branch and leave `main` untouched. `runGit` gains an opt-in `env` option, and a `repoPinnedEnv()` helper drops those four variables. `archive-merged.js` routes every `runGit` call through a local wrapper that passes `repoPinnedEnv()`, so its mv/rm/reset/checkout/commit/ls-files calls all address the same repo.

**Tech Stack:** Node 18+, `node --test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T122409-record-4178/work/4178-spec.md`

**Premise correction (logged in decisions.md as `premise reversed:`):** the spec's incident commit `24ef60e0b` was made on the main checkout's local `main` (`main@{2026-10-24 17:31:12}` in main's reflog). The `worktree-flow+spec-3997-2724` worktree branched from that unpushed local HEAD (`worktree.baseRef: head`). Local `main` was then rebased to `49302ee0a` at 17:53:06, which left `24ef60e0b` reachable only from the feature branch. No archival commit site takes `root` from cwd. Every caller resolves `mainCheckoutRoot`: `archiveMerged` (archive-merged.js:2068), `hooks.js archive-run` (hooks.js:1287), and `sweep-stray-run-dirs.js` (line 177, `--root` override aside). Deliverable 1's call-path search therefore finds the env vector, not a cwd-derived `root`. The ride-along mechanism (an unpushed local-`main` reconcile commit carried into a new worktree) belongs to #3396 / #1780 and is held as a ledger row, not fixed here.

Premise-refs: plugin/bin/lib/reconcile/archive-merged.js
Premise-refs: plugin/bin/lib/hooks/git-exec.js
Premise-refs: plugin/bin/hooks.js
Premise-refs: plugin/bin/sweep-stray-run-dirs.js

## Global Constraints

- Release note (spec, verbatim): "Background reconcile no longer commits run-dir archival into a feature branch's worktree."
- No change to `runGit`'s behaviour for any caller that does not pass `env` (additive option only).
- Dropped variables are exactly `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR` — the same four `bin/lib/staged-patch/stack-check.js`'s `gitEnv` drops. Do not drop config variables: the archival commit needs the user's `user.name`/`user.email`.
- Commit messages: `{Verb} {what} — {detail}`, with `refs #4178` in the body, never `closes`/`fixes`.

## Review Focus

1. Inherited `GIT_DIR` pointing at a linked worktree's admin dir while cwd is that worktree — the archival must land on `main`, the worktree branch must not move (Task 2 test 2).
2. Plain env, cwd inside a linked worktree — the same outcome (Task 2 test 1; this already holds pre-fix and pins it).
3. A caller of `runGit` that passes no `env` must still inherit `process.env` unchanged — e.g. `PATH`, `HOME`, `CT_HOOKS_GIT_TIMEOUT_MS` (Task 1 test asserts `repoPinnedEnv` keeps unrelated keys; existing `tests/hooks-git-exec.test.js` covers the default path).
4. `repoPinnedEnv` must not mutate its input object — `process.env` itself must keep `GIT_DIR` for other code in the same process (Task 1 test).
5. Existing archive tests that stub `cp.execFileSync` and match on `args[2] === 'mv'` (archive-merged.test.js:1017) still see the `['-C', cwd, verb, …]` argv shape — the wrapper only adds `env` to opts.

---

### Task 1: `runGit` env passthrough and `repoPinnedEnv`

**Files:**
- Modify: `plugin/bin/lib/hooks/git-exec.js` (`runGit`, `module.exports`)
- Test: `tests/hooks-git-exec.test.js`

**Interfaces:**
- Produces: `repoPinnedEnv(env = process.env) -> object`: a shallow copy of `env` without `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`. Exported from `plugin/bin/lib/hooks/git-exec.js`.
- Produces: `runGit(args, cwd, opts)` accepts `opts.env`. When it is set, the value is passed as the spawn's `env`. When it is absent, the options object carries no `env` key, so behaviour is unchanged.

- [ ] **Step 1: Write the failing tests** (append to `tests/hooks-git-exec.test.js`; add `repoPinnedEnv` to the existing destructured require on line 10)

```js
test('repoPinnedEnv: drops the four repo-locating vars, keeps the rest, never mutates its input (#4178)', () => {
  const input = { GIT_DIR: '/x/.git/worktrees/w', GIT_WORK_TREE: '/x', GIT_INDEX_FILE: '/x/i', GIT_COMMON_DIR: '/x/.git', PATH: '/bin', GIT_AUTHOR_NAME: 'a' };
  const out = repoPinnedEnv(input);
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) assert.ok(!(k in out), `${k} must be dropped`);
  assert.strictEqual(out.PATH, '/bin');
  assert.strictEqual(out.GIT_AUTHOR_NAME, 'a');
  assert.strictEqual(input.GIT_DIR, '/x/.git/worktrees/w', 'input must not be mutated');
});

test('runGit: opts.env is the spawn environment — a pinned env restores -C repo discovery (#4178)', () => {
  const a = gitRepo();
  const b = gitRepo();
  const foreign = { ...process.env, GIT_DIR: path.join(b, '.git') };
  const redirected = runGit(['rev-parse', '--absolute-git-dir'], a, { env: foreign });
  assert.strictEqual(redirected.stdout, fs.realpathSync(path.join(b, '.git')), 'opts.env must reach the child');
  const pinned = runGit(['rev-parse', '--absolute-git-dir'], a, { env: repoPinnedEnv(foreign) });
  assert.strictEqual(pinned.stdout, fs.realpathSync(path.join(a, '.git')));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/hooks-git-exec.test.js`
Expected: FAIL — `repoPinnedEnv is not a function`.

- [ ] **Step 3: Implement** — in `runGit`, spread `...(opts.env ? { env: opts.env } : {})` into the `execFileSyncTimed` options; add `repoPinnedEnv` with a one-line comment naming why (an inherited `GIT_DIR` overrides `-C`, #4178) and export it. Leave `runGitAsync` unchanged (no caller needs it).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/hooks-git-exec.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/git-exec.js tests/hooks-git-exec.test.js
git commit -m "Add runGit env passthrough and repoPinnedEnv — an inherited GIT_DIR overrides -C discovery" -m "refs #4178"
```

### Task 2: Pin archive-merged.js's git calls, and the linked-worktree test

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js:10` (the `runGit` import) and `:205` (`commitGit` wraps the pinned runner — unchanged text, it already wraps `runGit`)
- Create: `tests/bin-lib/reconcile/archive-merged-linked-worktree.test.js` (sized like its sibling `archive-merged-work-boundary.test.js`, ~50-90 lines, own `git`/`makeRepo`/`commitPath` helpers copied from that sibling)

**Interfaces:**
- Consumes: `repoPinnedEnv`, `runGit(args, cwd, { env })` from Task 1.
- Produces: nothing new is exported. Inside archive-merged.js, the module-local name `runGit` becomes `(args, cwd, opts = {}) => runGitInherited(args, cwd, { ...opts, env: repoPinnedEnv() })`. Every existing call site keeps its text, and `commitGit = withIndexLockRetry(runGit)` picks the wrapper up.

- [ ] **Step 1: Write the failing tests.** Both share one fixture builder and one assertion function:

Fixture (`setup()`): `root = fs.realpathSync(makeRepo())`; `runId = '2026-01-01T000000-record-4178'`; `commitPath(root, `.claude-tweaks/pipelines/${runId}/work/4178-spec.md`, '# 4178\n')`. Then `wt` is a fresh `fs.mkdtempSync` sibling path (not inside `root`): `git(root, 'worktree', 'add', '-b', 'feat', wt)`. Backdate the run dir after the worktree exists: `fs.utimesSync(runDir, old, old)` with `old = new Date(Date.now() - ORPHAN_MINT_TTL_MS * 2)`, so `archiveMerged`'s orphaned-mint branch routes it to `archiveRunDir` (tracked content, #2227). Capture `mainBefore = git(root, 'rev-parse', 'main')` and `featBefore = git(wt, 'rev-parse', 'HEAD')`.

`assertLandsOnMain({ root, wt, runDir, runId, mainBefore, featBefore, result })`:
```js
assert.strictEqual(git(wt, 'rev-parse', 'HEAD').trim(), featBefore.trim(), 'AC1.1: the linked worktree branch HEAD must not move');
assert.ok(result.archived.includes(runDir), `AC2.2: never silently dropped — got ${JSON.stringify(result)}`);
assert.notStrictEqual(git(root, 'rev-parse', 'main').trim(), mainBefore.trim(), 'AC2.1: the archival commit lands on main');
assert.match(git(root, 'log', '-1', '--format=%s', 'main'), /^\[reconcile\] archive run 2026-01-01T000000-record-4178/);
assert.ok(git(root, 'ls-files').split('\n').includes(`.claude-tweaks/pipelines/archive/${runId}/work/4178-spec.md`));
```

Tests:
- `test('AC1.1/AC2.1/AC2.2: archiveMerged from a linked-worktree cwd commits the archival to main, never the worktree branch', …)`: `result = archiveMerged({ cwd: wt })`, then `assertLandsOnMain`.
- `test('AC3.1: an inherited GIT_DIR naming the linked worktree does not redirect the archival commit onto its branch', …)`: `admin = git(wt, 'rev-parse', '--absolute-git-dir').trim()`. Save `prior = process.env.GIT_DIR`, set `process.env.GIT_DIR = admin`, call `archiveMerged({ cwd: wt })` inside `try`. In `finally`, restore: delete it when `prior === undefined`, otherwise reassign. Then `assertLandsOnMain`. The fixture's own `git()` calls run only outside that window.

- [ ] **Step 2: Run to verify the GIT_DIR test fails pre-fix**

Run: `node --test tests/bin-lib/reconcile/archive-merged-linked-worktree.test.js`
Expected: FAIL — the AC3.1 test fails on `AC1.1: the linked worktree branch HEAD must not move` (the commit lands on `feat`). The plain-env test passes, which pins current behaviour.

- [ ] **Step 3: Implement** — archive-merged.js line 10 becomes `const { runGit: runGitInherited, repoPinnedEnv } = require('../hooks/git-exec');`, then the wrapper defined as `runGit`, plus a comment (#4178: every call here addresses `root` via `-C`; an inherited GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_COMMON_DIR would silently override that and commit to whatever repo it names, e.g. a linked worktree's branch).

- [ ] **Step 4: Run to verify pass, and the neighbours stay green**

Run: `node --test tests/bin-lib/reconcile/archive-merged-linked-worktree.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/archive-merged-work-boundary.test.js tests/hooks-git-exec.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Prove discrimination (AC3.1)** — revert only archive-merged.js's line-10 change in the working tree (`git show HEAD:plugin/bin/lib/reconcile/archive-merged.js > plugin/bin/lib/reconcile/archive-merged.js` before committing Step 3's edit, or restore the import by hand). Re-run the new test file and confirm the AC3.1 test fails. Then re-apply the change and confirm it passes. Quote both outputs in the task report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js tests/bin-lib/reconcile/archive-merged-linked-worktree.test.js
git commit -m "Pin archive-merged's git calls to the main checkout — an inherited GIT_DIR no longer commits archival onto a worktree branch" -m "refs #4178"
```

## Spec coverage map

| Spec item | Covered by |
|---|---|
| Deliverable 1 (find the call path) | Premise correction above: no `root`-from-cwd site exists. The env vector is the call path, and the reflog evidence is logged in decisions.md |
| Deliverable 2 (route to main, or refuse and log) | Task 2 Step 3: routes to main |
| Deliverable 3 (linked-worktree test asserting no commit on the worktree branch) | Task 2 tests |
| AC1.1 | Task 2 both tests (`AC1.1` assertion) |
| AC2.1 | Task 2 both tests (`AC2.1` assertion) |
| AC2.2 | Task 2 both tests (`AC2.2` assertion) |
| AC3.1 | Task 2 Step 2 + Step 5 |
