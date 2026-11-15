# Hook repoInfo Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `wtDetect.repoInfo` asks git once per directory and reuses the answer, inside one process and across hook processes, for as long as a filesystem signature says the answer cannot have changed — with every allow/deny verdict unchanged.

**Architecture:** A new sibling module `plugin/bin/lib/hooks/repo-info-cache.js` owns the signature, the env fingerprint, the per-process memo and the per-user JSON store. `repoInfo` in `worktree-detect.js` consults it before spawning git and records definitive answers after. The signature is computed *before* git runs, so a change racing the spawn leaves a signature that mismatches next time (re-ask), never a stale answer under a fresh signature.

**Tech Stack:** Node 18+ CommonJS, `node:test`, git CLI, `plugin/bin/lib/json-store.js` (atomic tmp+rename write).

**Spec:** `.claude-tweaks/pipelines/2026-11-13T004054-spec-5266-5294/spec-5294/work/5294-spec.md` (record #5294)

Scope keywords: repo-info-cache, CT_HOOKS_REPO_INFO_STORE

(`repoInfo` itself has 20+ call sites across `plugin/bin`; none changes, because the cache sits inside `repoInfo` — every caller benefits with no edit.)

## Global Constraints

- Never cache an indeterminate answer (timeout, spawn failure, no git, unparseable output, realpath failure): #134's retry behaviour is unchanged.
- A call that passes any `opts` key (`timeoutMs`, `env`, …) bypasses the memo and the store entirely, exactly the pre-change path.
- Bypass the store (but keep the in-process memo) when any of `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_CEILING_DIRECTORIES`, `GIT_DISCOVERY_ACROSS_FILESYSTEM` is set (present at all, even empty). Env names compare upper-cased (a plain env object is case-sensitive, git on win32 is not — the same rule `envDefers` in `plugin/bin/claude-tweaks-statusline.js` applies).
- The store is "one small JSON store, atomically replaced, capped by entry count with oldest-first eviction, read and written inside try/catch so a broken store never breaks a session or changes a verdict" (spec, verbatim). Cap: `MAX_STORE_ENTRIES = 200`. Default location `~/.claude-tweaks/repo-info-cache.json` (the per-user `~/.claude-tweaks/` home `plugin/bin/lib/ports/registry.js` already uses); env override `CT_HOOKS_REPO_INFO_STORE` (a file path).
- Store entries are keyed on the env as well as the directory: the runner always sets `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`, and env-carried config is protected config that can carry `safe.directory`, which changes whether git opens a repo. Keying (not bypassing) on `GIT_CONFIG*` keeps the store live under `tools/run-tests.js`, so store tests are not vacuous there.
- `tools/run-tests.js` points `CT_HOOKS_REPO_INFO_STORE` at a file inside its per-run `runRoot`, so fixtures never write the user's home. Test files that exercise the store also set it themselves (a bare `node --test` has no runner).
- Prove every new test under the runner too: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-flow-spec-5266-5294/83882d73-686e-4d78-b6e2-5a3f5a1fdcb9/scratchpad/5294-files.txt"` (one test path per line; write the list with the Write tool), not only bare `node --test`.
- A test that needs git to refuse a repo runs that git child with `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL` set to the null device (GitHub's Ubuntu image has `safe.directory = *` in system config).
- Shell: one plain command per Bash call — no `&&`/`;` chains, no `cd … &&`, no heredoc, no loop, no `$(...)`; use `git -C "<worktree>"`; file content via Write/Edit.
- Every commit message ends with a blank line followed by `Claude-Session: https://claude.ai/code/session_01Ngy9oXUKhrjRB2sLvemdfQ`. Message style `{Verb} {what} — {detail}`.
- Governing skill `windows-checkout-test-parity` (it names win32 path and env rules): "taking `platform`/`env` as parameters, exact-string pins, … `toPosix` at the display-ID producer with native fs paths left alone" — the new module takes `env` (and `platform` where it branches) as parameters; expected paths in tests come from the realpath'd fixtures, never hand-joined strings. Governing skill `suite-slot-test-env` names `tools/run-tests.js` but governs tests that spawn it as a child; this plan's only `run-tests.js` test extends the existing `withSandbox`-based check in `tests/run-tests-isolation.test.js`, which already "strips the same keys inline for `tools/run-tests.js` children" — keep using it.
- Shared reader decision (#5266 hindsight): the signature does **not** reuse `commonDirFromFs` — that reader derives git's *answer* git-faithfully, while the signature only records stats to compare and never derives an answer; sharing would also load the status line module in every hook process.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Review Focus

1. An existing in-process test that mocks `child_process.execFileSync` to make git fail for a path the same process already answered: the memo now answers first. Expected: the test still sees its forced failure — fix by calling `resetMemo()` in that test, never by weakening the cache. Task 1 Step 6 sweeps for these.
2. Inode reuse when a worktree is removed and re-added at the same path: the `.git` file's signature carries `ctimeNs` beside `ino` (bigint stat), so a reused inode number still mismatches (Task 1, AC3.2 test); directories carry no ctime, so ordinary git activity keeps the cache warm (Task 1 test).
3. A different `git` on `PATH` (test fake-git shims, a user's second install) answering differently for the same directory: `PATH` is in the env fingerprint, so one git's answer is never served to another (Task 2 test).
4. A user editing global git config (`safe.directory`) after an answer was cached: the global and system config files' stats are in the signature (Task 1 test with a `GIT_CONFIG_GLOBAL` file).
5. A store entry of the wrong shape (hand-edited, older version, `indeterminate: true`): ignored, git asked, answer unchanged (Task 2 corrupt-store test covers a wrong-shape entry too).

---

### Task 1: Validated per-process memo for repoInfo

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/hooks/repo-info-cache.js`
- Modify: `plugin/bin/lib/hooks/worktree-detect.js:111-141` (`repoInfo`)
- Test: `tests/hooks-repo-info-cache.test.js` (new — a new file so Step 2's red run is real; the spec named `tests/hooks-worktree-detect.test.js`, whose existing tests stay unchanged and must still pass)
- Test (run, unchanged): `tests/hooks-worktree-detect.test.js`

**Interfaces:**
- Produces (from `repo-info-cache.js`):
  - `repoSignature(dir: string, env = process.env, platform = process.platform) -> object | null` — null means "could not compute; do not cache".
  - `signatureMatches(a: object, b: object) -> boolean` — `JSON.stringify` equality (both built in the same key order).
  - `envFingerprint(env) -> string`
  - `lookupRepoInfo(dir: string, env = process.env) -> { answer: {repoRoot, isLinkedWorktree, indeterminate:false} | null, signature: object | null }` — the answer is a fresh copy.
  - `rememberRepoInfo(dir, env, signature, answer) -> void` — no-op when `signature` is null or `answer.indeterminate`.
  - `resetMemo() -> void` (tests only).
- Consumes: nothing from other tasks.

**Signature algorithm** (not determined by the tests — implement as stated):
1. Walk up from `dir`: `fs.statSync(path.join(d, '.git'), { bigint: true })`. ENOENT → parent; any other error → return null; reached the root with nothing → `git: null`.
2. Record `root: { path: d, uid, ino }` for the directory holding `.git` (strings for bigint fields) and `git: { path, kind: 'file'|'dir'|'other', ino, uid }`, plus `ctime` **only when `.git` is a file**. Never record a directory's ctime: it moves on every entry created or renamed inside it (`index.lock`, a new `out.txt`), which would miss the cache after ordinary git activity.
3. `.git` file: record its full `content` (read error → null). Parse with the same `/^gitdir:\s*(.+?)\s*$/m` as `mainCheckoutRoot`; `admin = path.resolve(d, m[1])`. Record `admin: { path, ino }` or `'missing'` on ENOENT (other error → null), and `commondir` = admin's `commondir` file content minus trailing CR/LF, or null on ENOENT. Common dir = `path.resolve(admin, commondir)` when set, else `admin`. `.git` directory: common dir = that directory. Inode reuse on a worktree removed and re-added at one path is caught by the `.git` file's own ino + ctime (git rewrites it on `worktree add`).
4. `configs`: stat key `"{mtimeNs}:{size}:{ino}"` or `'missing'` (ENOENT; other error → null) for, in order: `{common}/config`; `{admin}/config.worktree` when there is an admin dir; global = `GIT_CONFIG_GLOBAL` alone when set, else `$XDG_CONFIG_HOME/git/config` (or `$HOME/.config/git/config`) and `$HOME/.gitconfig` (skip both when `HOME` is unset); system = nothing when `GIT_CONFIG_NOSYSTEM` is set, else `GIT_CONFIG_SYSTEM` or `/etc/gitconfig` (nothing on win32, whose install path is not knowable — document as an accepted divergence in Task 2's docs).

**Memo:** a `Map` keyed on `dir + '\0' + envFingerprint(env)`; at most 500 entries (delete the oldest insertion). `envFingerprint`: every env entry whose upper-cased name starts with `GIT_` or is `PATH`, `HOME`, `XDG_CONFIG_HOME` or `USERPROFILE`, as `NAME=value`, sorted by name, joined with `\0`.

**repoInfo change:** after the existing no-ancestor early return: when `opts` has no own keys, call `lookupRepoInfo(dir, process.env)`; a hit returns it. Otherwise run the existing body unchanged, and before each definitive `return` call `rememberRepoInfo(dir, process.env, signature, result)`. Never call it on an indeterminate return.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-repo-info-cache.test.js`. At the top, before requiring the module: `process.env.CT_HOOKS_REPO_INFO_STORE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ric-store-')), 'store.json')` (harmless now, needed once Task 2 lands). Each test calls `resetMemo()` first and counts rev-parse spawns with `t.mock.method(require('child_process'), 'execFileSync', passthroughCounting)` — git-exec resolves `cp.execFileSync` at call time — counting calls whose args include `'rev-parse'`. Ground truth for "the fresh answer" is `repoInfo(p, { timeoutMs: 10000 })` (the bypass path). Fixtures: `gitRepo`, `linkedWorktreeOf` from `tests/helpers/git-fixtures`.
  - `AC1.1: repeated repoInfo calls on one directory spawn git once` — three calls on a linked worktree: all `deepStrictEqual` `{ repoRoot: wt, isLinkedWorktree: true, indeterminate: false }`, count `=== 1`; a mutation of one returned object does not leak into the next call's result.
  - `AC3.1: a removed linked worktree is re-asked` — warm on `wt`; `git -C main worktree remove --force wt`; `fs.mkdirSync(wt)`; next call: count `=== 2`, result equals ground truth.
  - `AC3.2: a worktree removed and re-added at the same path is re-asked` — warm; remove; `git -C main worktree add -q --detach wt`; next call: count `=== 2`, result equals ground truth.
  - `AC3.3: git init in a directory that was not a repo is re-asked` — mkdtemp dir with no repo above it (assert the first answer is `repoRoot: null, indeterminate: false`); `git init -q dir`; next call: count `=== 2`, `repoRoot === fs.realpathSync(dir)`.
  - `AC3.4: a pruned worktree admin dir with the .git file kept is re-asked` — warm; `fs.rmSync(<main>/.git/worktrees/<name>, { recursive: true, force: true })` (name from the `.git` file's `gitdir:`); next call: count `=== 2`, result equals ground truth.
  - `#5294: an edited global git config is re-asked` — env `GIT_CONFIG_GLOBAL` set (via `process.env`, restored in `finally`) to a temp file; warm; append `[user]\n\tname = x\n` to that file; next call: count `=== 2`.
  - `AC4.1: an indeterminate answer is never cached and the next call answers definitively` — (a) `repoInfo(wt, { timeoutMs: 1 })` then `repoInfo(wt)`: the second is `indeterminate: false` with count `>= 1` for it; (b) mock `execFileSync` to throw `Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' })` for every call while a flag is set (runClassified retries a timeout once) → `indeterminate: true`; clear the flag → next call definitive and spawned.
  - `#5294: a call with opts bypasses the memo` — warm; `repoInfo(wt, { timeoutMs: 10000 })` spawns again.
  - `#5294: ordinary git activity keeps the cache warm` — warm on `wt` and on `main`; create and rename an `index.lock` inside the admin dir and inside `main/.git`, and write a new top-level file in `wt` and in `main`; next calls on both: count unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-repo-info-cache.test.js`
Expected: FAIL (`Cannot find module '../plugin/bin/lib/hooks/repo-info-cache'`)

- [ ] **Step 3: Implement `repo-info-cache.js`** (signature, fingerprint, memo, `lookupRepoInfo`/`rememberRepoInfo` without any store yet) **and the `repoInfo` change** in `worktree-detect.js`, with a header comment naming #5294, the signature fields and why the signature is taken before the spawn.

- [ ] **Step 4: Run the tests to verify they pass**, bare and under the runner (list file holds `tests/hooks-repo-info-cache.test.js` and `tests/hooks-worktree-detect.test.js`).

Run: `node --test tests/hooks-repo-info-cache.test.js tests/hooks-worktree-detect.test.js`
Expected: PASS, and the runner command from Global Constraints: PASS.

- [ ] **Step 5: Prove the invalidation tests red** — temporarily make `signatureMatches` return `true`, run `node --test tests/hooks-repo-info-cache.test.js`, quote the FAIL lines for AC3.1–AC3.4 and the global-config test in the report, then restore the function (`git -C "<worktree>" diff` shows only the intended change).

- [ ] **Step 6: Sweep for tests that force a git failure in-process.** Grep `tests/` for `mock.method(` on `execFileSync` and for direct `cp.execFileSync =` assignments in files that reach `repoInfo` (pre-tool-use, context, session-start, materialize, pr-bookkeeping, run-dir-resolve, friction-events suites); run each such file. A failure caused by the memo is fixed by `resetMemo()` in that test (Review Focus 1). Then run `node --test tests/hooks-pre-tool-use.test.js tests/hooks-gate-coverage.test.js tests/bin-lib/hooks/classify-ownership.test.js` — Expected: PASS (AC6.2: no verdict changes; the #4303 call-count pin wraps the export and keeps counting calls).

- [ ] **Step 7: Commit**

```
git -C "<worktree>" add plugin/bin/lib/hooks/repo-info-cache.js plugin/bin/lib/hooks/worktree-detect.js tests/hooks-repo-info-cache.test.js
git -C "<worktree>" commit -m "Memoize repoInfo per process behind a filesystem signature — #5294" -m "Claude-Session: https://claude.ai/code/session_01Ngy9oXUKhrjRB2sLvemdfQ"
```
(plus any test file Step 6 had to touch, by explicit path)

### Task 2: Cross-process store, runner override, docs

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/repo-info-cache.js`
- Modify: `tools/run-tests.js:685` (child env)
- Modify: `docs/hooks.md` (new `## repoInfo cache (#5294)` section after `## Ownership`)
- Test: `tests/hooks-repo-info-store.test.js` (new), `tests/run-tests-isolation.test.js` (extend the test at ~line 760, `run-tests.js runs the suite under a ct-testrun-* TMPDIR it removes on exit`), `tests/fixtures/run-tests/tmpdir-probe.fixture.js` (record `repoInfoStore: process.env.CT_HOOKS_REPO_INFO_STORE` beside its `tmpdir`, so the assertion has a value to read)
- Create: `tests/helpers/repo-info-cache.js` — `isolateRepoInfoCache(t)`: points `process.env.CT_HOOKS_REPO_INFO_STORE` at a fresh temp file, calls `resetMemo()`, and restores the env in `t.after`
**Interfaces:**
- Consumes: Task 1's `lookupRepoInfo`, `rememberRepoInfo`, `repoSignature`, `signatureMatches`, `envFingerprint`, `resetMemo`.
- Produces: `storePath(env = process.env) -> string` (`CT_HOOKS_REPO_INFO_STORE` when set and non-empty, else `path.join(os.homedir(), '.claude-tweaks', 'repo-info-cache.json')`; read on every call, never captured at load, so a test's env change takes effect); `storeBypassed(env) -> boolean`; `MAX_STORE_ENTRIES = 200`; `isolateRepoInfoCache(t)` in `tests/helpers/repo-info-cache.js`.

**Store behaviour:** format `{ version: 1, entries: { [key]: { answer: { repoRoot: string|null, isLinkedWorktree: boolean }, signature, at: <ms> } } }`, `key` = sha1 hex of `dir + '\0' + envFingerprint(env)`. `lookupRepoInfo`: memo miss and not `storeBypassed` → read the store (`readJsonFile`, inside try/catch), validate version and the entry's shape (anything else is a miss), compare its signature with the current one, and on a match seed the memo and return a copy with `indeterminate: false`. `rememberRepoInfo`: after the memo write, unless bypassed: re-read the store from disk (merge siblings' entries), delete then set the entry (so object insertion order tracks recency), evict lowest `at` while over `MAX_STORE_ENTRIES` with ties broken by insertion order (earliest first — a stable sort), `writeJsonFile` (atomic). Every store error is swallowed; the answer returned is the one git gave.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-repo-info-store.test.js`. Each test gets its own store file under its own mkdtemp dir and runs `repoInfo` in a **fresh child process**: `execFileSync(process.execPath, ['-e', CHILD, modulePath, dir], { env })` where `CHILD` wraps `require('child_process').execFileSync` with a rev-parse counter, requires `worktree-detect`, calls `repoInfo(process.argv[2])` and prints `JSON.stringify({ info, spawns })`. `env` is built explicitly: `{ ...process.env, CT_HOOKS_REPO_INFO_STORE: file }` minus the five discovery variables (delete them), so the result is the same under bare `node --test` and under the runner.
  - `AC2.1: a warm store answers repoInfo in a fresh process with zero git spawns` — child 1 on a linked worktree: `spawns === 1`; child 2: `spawns === 0` and `info` `deepStrictEqual` child 1's `info`.
  - `#5294: the store re-asks git when the signature no longer matches` — warm via child 1; remove the worktree, `mkdirSync(wt)`; child 2: `spawns === 1`, `info.isLinkedWorktree === false`.
  - `AC5.1: a corrupt store leaves repoInfo's answer unchanged` — store file contains `{not json`; then a second case with a valid store whose entry for the key is `{ answer: { repoRoot: 42, isLinkedWorktree: 'yes' }, signature: <copied valid signature>, at: 0 }` (Review Focus 5): both children return the cold answer with `spawns === 1`.
  - `AC5.1: an unreadable store leaves repoInfo's answer unchanged` — `CT_HOOKS_REPO_INFO_STORE` names a directory (EISDIR): answer equals the cold answer, exit 0.
  - `AC5.1: an unwritable store leaves repoInfo's answer unchanged` — the store path's parent is a regular file (ENOTDIR on write; works as root too): answer equals the cold answer, exit 0, and a second child still spawns (nothing was stored).
  - `#5294: a git discovery variable bypasses the store` — for each of the five names, env sets it (`GIT_CEILING_DIRECTORIES` to an unrelated temp dir; the others to values that keep git answering for `dir`, e.g. `GIT_DISCOVERY_ACROSS_FILESYSTEM=1`; for `GIT_DIR`/`GIT_WORK_TREE`/`GIT_COMMON_DIR` use the fixture's own real values): after the child, the store file does not exist.
  - `#5294: a different PATH does not reuse another git's answer` — warm with child 1; child 2 with `PATH` prefixed by an extra empty temp dir: `spawns === 1`.
  - `#5294: the store keeps at most MAX_STORE_ENTRIES entries, evicting the oldest` — in-process: call `rememberRepoInfo` 201 times with distinct dirs (many share one wall-clock ms; the insertion-order tie-break decides); read the file: 200 entries, the first one gone, the 201st present.
  - In `tests/run-tests-isolation.test.js`: assert the runner's child env carries `CT_HOOKS_REPO_INFO_STORE` and that it resolves inside the child's `ct-testrun-*` run root (read it the way the existing TMPDIR assertion reads the child's `TMPDIR`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-repo-info-store.test.js`
Expected: FAIL (AC2.1: `spawns` is 1 on the second child; the eviction test: `rememberRepoInfo` writes no file)

- [ ] **Step 3: Implement the store** in `repo-info-cache.js`, and add `CT_HOOKS_REPO_INFO_STORE: path.join(runRoot, 'repo-info-cache.json')` to the child env object at `tools/run-tests.js:685` (keep the existing keys and order; add it last).

- [ ] **Step 4: Write the `docs/hooks.md` section** — one paragraph per point, no restating code: what is cached and where (memo, store, default path, `CT_HOOKS_REPO_INFO_STORE`, the runner's per-run override); the signature fields and that it is taken before the spawn; never-cached cases (indeterminate, any `opts`); the store bypass on the five discovery variables and the env fingerprint (`GIT_*`, `PATH`, `HOME`, `XDG_CONFIG_HOME`, `USERPROFILE`) with the `GIT_CONFIG*`/`safe.directory` reason; the fail-safe posture; the accepted divergence (win32 system config not in the signature; a `GIT_DIR` target's own changes are not tracked by the in-process memo).

- [ ] **Step 5: Run the tests to verify they pass**, bare and under the runner (list file: `tests/hooks-repo-info-store.test.js`, `tests/hooks-repo-info-cache.test.js`, `tests/hooks-worktree-detect.test.js`, `tests/run-tests-isolation.test.js`).

Run: `node --test tests/hooks-repo-info-store.test.js tests/hooks-repo-info-cache.test.js tests/run-tests-isolation.test.js`
Expected: PASS; the runner command: PASS.

- [ ] **Step 6: Prove the store's signature check red** — temporarily make the store path skip `signatureMatches` (treat any entry as a match), run `node --test tests/hooks-repo-info-store.test.js`, quote the FAIL line for the signature test, restore.

- [ ] **Step 7: Re-run the verdict suites and the Step 6 sweep set** — first add `isolateRepoInfoCache(t)` to every test Task 1 Step 6 fixed (a store answers a forced-failure test from another test's or process's answer once the store exists), then run `node --test tests/hooks-pre-tool-use.test.js tests/hooks-gate-coverage.test.js tests/bin-lib/hooks/classify-ownership.test.js` plus every Step 6 file, bare and under the runner — Expected: PASS (AC6.2).

- [ ] **Step 8: Commit**

```
git -C "<worktree>" add plugin/bin/lib/hooks/repo-info-cache.js tools/run-tests.js docs/hooks.md tests/hooks-repo-info-store.test.js tests/run-tests-isolation.test.js tests/fixtures/run-tests/tmpdir-probe.fixture.js tests/helpers/repo-info-cache.js
git -C "<worktree>" commit -m "Persist validated repoInfo answers per user — #5294 cross-process store" -m "Claude-Session: https://claude.ai/code/session_01Ngy9oXUKhrjRB2sLvemdfQ"
```

## Controller-run after the tasks (not an implementer task)

Measurement (Deliverable 4, AC6.1): run `measure.js` back to back against a detached checkout of the base (`94fdf1a4b`'s plugin dir or the pre-#5294 HEAD) and this branch's `plugin/`, each with an empty and then a warm `CT_HOOKS_REPO_INFO_STORE`, and quote both raw outputs in PR #5298's `<!-- measurements-start -->` block in place of the placeholder sentence. Waived AC6.1 from the task test steps: it is a process-count measurement of real hook runs, done once here, not a committed test. AC7.1 (`npm test` passes) is `/build`'s Common Step 5 and the PR's CI.

## Spec coverage

| Spec item | Where |
|---|---|
| Deliverable 1, AC1.1, AC3.1–AC3.4, AC4.1 | Task 1 |
| Deliverable 2, AC2.1, AC5.1 | Task 2 |
| Deliverable 3 | Task 2 Step 4 |
| Deliverable 4, AC6.1 | Controller measurement |
| AC6.2 | Task 1 Step 6, Task 2 Step 7 |
| AC7.1 | Common Step 5 / CI |
