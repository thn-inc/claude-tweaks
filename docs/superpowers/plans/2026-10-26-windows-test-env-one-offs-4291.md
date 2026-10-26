# Windows Test-Environment One-Offs (#4291) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove seven test-environment assumptions that make 7 test files fail on `windows-latest` (classes I, J, K, L, M, N, F of #4291), with no change to shipped code.

**Architecture:** Test-only edits. Each task owns one cause in one file (plus a new shared helper for I), so tasks are independent and touch disjoint files. Every fix follows `windows-checkout-test-parity`: no `process.platform` stub, no POSIX literals for real paths, Linux-runnable pins where the cause has a Linux-visible shape, and a `windows-regression.yml` dispatch on the branch as the ground truth.

**Tech Stack:** Node 18+ `node:test`, git CLI, bash.

**Spec:** `.claude-tweaks/pipelines/2026-10-26T131203-spec-4291/work/4291-spec.md`

Scope keywords: fixtureHomeEnv, INSTALLED_JSON, MARKETPLACES_JSON, runTmpDirBlock, LONG_DIR_NAME, jqLines

## Global Constraints

- No shipped code changes: only `tests/**` files change (spec Release Note: "No user-visible change").
- Never stub `process.platform`; K has "No `process.platform` branch" (spec Deliverable K).
- M uses "a temp file, not `os.devNull`" for `GIT_CONFIG_GLOBAL`, plus `GIT_CONFIG_NOSYSTEM=1`, "set and restored around the `post.run` call" (spec Deliverable M).
- `fixtureHomeEnv` "sets `HOME` and `USERPROFILE` and drops `CLAUDE_CONFIG_DIR`" (spec Deliverable I).
- L keeps "the length assertion the test relies on": the long worktree path stays ≥ 240 characters.
- Out of scope (owned elsewhere — do not touch): `install-statusline-wrapper.test.js` tests 1 and 4 (chmod, #4290); `reap-merged.test.js` gh-stub / mode-bit failures (#4285, #4287); the 5 drift-check tests that need the `#!/bin/sh` curl stub (#3315's recorded not-a-bug skip).
- Commit messages: `{Verb} {what} — {detail}`, ending with the line `Claude-Session: https://claude.ai/code/session_018zRL4Wx3c11f1U81UvKmEC`.
- Corrected premise (logged in the run's decisions.md): `git worktree add` cannot create a ≥ 240-char path on Windows — its checkout child runs with `GIT_DIR=<wtPath>/.git`, and git dies `'$GIT_DIR' too big` near `PATH_MAX - 40` (windows-regression run 40323587454, with `core.longpaths true` set globally). L therefore registers the long path without running `git worktree add` at that length.

## Review Focus

1. A frozen pre-change VERDICT body whose `/tmp/cc-*.json` literal was not swapped would silently read a missing file and still "pass" a wrong-reason assertion — `runVerdict` asserts no `/tmp/cc-` substring survives the swap (Task 2).
2. A Windows fixture path (`D:\a\_temp\…`) spliced into JS source unescaped turns `\a` into an escape — the swap inserts `JSON.stringify(path)`, never the raw path (Task 2).
3. An env var set for M that leaks past a throwing `post.run` would poison every later test in the worker — restore in `finally` (Task 4).
4. A relocated worktree whose admin `gitdir` was not repointed would make `git worktree lock`/`list` miss it and the L tests pass for the wrong reason — the fixture asserts `git worktree list --porcelain` names the long path (Task 3).
5. K's directory-exists check against the bash-view path (`/tmp/…` on MSYS) would fail on Windows even after the fix — the existence check uses the native `TMPDIR`, only the stdout comparison uses the bash view (Task 2).

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable I | Task 1 |
| Deliverables J, K | Task 2 |
| Deliverable L | Task 3 |
| Deliverable M, AC3.1, AC3.2, AC3.3 | Task 4 |
| Deliverable N, AC2.1, AC2.2 | Task 5 |
| Deliverable F, AC4.1, AC4.2 | Task 6 |
| AC1.1 | Post-build verification (Linux per-file counts) |
| AC5.1 | Post-build verification (Windows dispatch) |

AC1.1's "same test count per file" is read as "no test removed or newly skipped on Linux": `find-run-comment-cli.test.js` gains exactly one test (AC4's pin, which the spec itself requires); every other listed file keeps its count.

---

### Task 1: Shared fixture home (class I)

**Files:**
- Create: `tests/helpers/fixture-home.js`
- Create: `tests/helpers-fixture-home.test.js` (repo convention: `tests/helpers-{name}.test.js`)
- Modify: `tests/bin-lib/timing/cli.test.js:19-25` (drop the local `fixtureHomeEnv`, require the helper)
- Modify: `tests/install-statusline-wrapper.test.js:24-33` (`runWrapper`'s env)
- Modify: `tests/statusline.test.js:30-41` (`runStatusline`'s env) and `:1056-1066` (stale comment)
- Modify: `tests/bin-lib/path-guard/callers-characterization.test.js:21-23` — comment-only (see next bullet)
- Modify: `tests/bin-lib/timing/transcript.test.js:10-12` — comment-only: this and the previous file each cite "cli.test.js's fixtureHomeEnv", which moves; re-point both to `tests/helpers/fixture-home.js`'s `fixtureHomeEnv` (no code change — both pass `homeDir` directly and need no env helper)

**Interfaces:**
- Produces: `fixtureHomeEnv(home: string, base?: NodeJS.ProcessEnv = process.env) => NodeJS.ProcessEnv` — a new object: `base` minus `CLAUDE_CONFIG_DIR`, plus `HOME: home`, `USERPROFILE: home`. Never mutates `base`. Export: `module.exports = { fixtureHomeEnv }`.

- [ ] **Step 1: Write the failing helper test** in `tests/helpers-fixture-home.test.js`:

```js
test('fixtureHomeEnv sets HOME and USERPROFILE to the fixture home and drops CLAUDE_CONFIG_DIR', () => {
  const base = { PATH: '/bin', HOME: '/real', USERPROFILE: 'C:\\Users\\real', CLAUDE_CONFIG_DIR: '/real/.claude-x' };
  const env = fixtureHomeEnv('/fx', base);
  assert.deepStrictEqual(env, { PATH: '/bin', HOME: '/fx', USERPROFILE: '/fx' });
  assert.strictEqual(base.CLAUDE_CONFIG_DIR, '/real/.claude-x', 'base is not mutated');
});
test('fixtureHomeEnv defaults its base to process.env', () => {
  const env = fixtureHomeEnv('/fx');
  assert.strictEqual(env.PATH, process.env.PATH);
  assert.strictEqual(env.USERPROFILE, '/fx');
  assert.ok(!('CLAUDE_CONFIG_DIR' in env));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/helpers-fixture-home.test.js`
Expected: FAIL with "Cannot find module './helpers/fixture-home'"

- [ ] **Step 3: Implement `fixtureHomeEnv` in `tests/helpers/fixture-home.js`**, moving `tests/bin-lib/timing/cli.test.js`'s comment (why both keys, why drop `CLAUDE_CONFIG_DIR`) onto it. Then switch the three consumers:
  - `timing/cli.test.js`: delete the local function and its comment, `const { fixtureHomeEnv } = require('../../helpers/fixture-home');`.
  - `install-statusline-wrapper.test.js` `runWrapper`: `const env = { ...fixtureHomeEnv(tmpHome), ...extraEnv };` (the explicit `delete env.CLAUDE_CONFIG_DIR` goes; keep the comment's reason, now pointing at the helper).
  - `statusline.test.js` `runStatusline`: `env: { ...fixtureHomeEnv(home), ...env }` (drop the local `CLAUDE_CONFIG_DIR` destructure).
  - `statusline.test.js:1056-1066`: the comment says the HOME-override technique "is already unreliable on this Windows machine" and that the acct end-to-end test "fails the same way". Rewrite the parenthetical so it states the real reason the placement is proven by construction, without the stale claim — e.g. "proven by construction … rather than by an end-to-end subprocess spawn: the ordering is a property of `main()`'s segments array, not of anything a spawned child would add." Keep the sentence about `renderPorts(cwd)` following `renderGit(cwd)`.

- [ ] **Step 4: Run the four files**

Run: `node --test tests/helpers-fixture-home.test.js tests/bin-lib/timing/cli.test.js tests/install-statusline-wrapper.test.js tests/statusline.test.js`
Expected: PASS, with the same per-file test counts as before for the three existing files (`ℹ tests` lines).

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/fixture-home.js tests/helpers-fixture-home.test.js tests/bin-lib/timing/cli.test.js tests/install-statusline-wrapper.test.js tests/statusline.test.js tests/bin-lib/path-guard/callers-characterization.test.js tests/bin-lib/timing/transcript.test.js
git commit -m "Share fixtureHomeEnv across the statusline and timing suites — #4291 class I"
```

---

### Task 2: Drift-check snapshot paths and bash-view TMPDIR (classes J, K)

**Files:**
- Modify: `tests/cloud-setup-drift-check.test.js` (constants at :22-23, `writeFixtures`, `SH_STUB_SKIP` and its comment, `runVerdict`, the 8 VERDICT tests, `runTmpDirBlock`, the 2 session-id guard tests)

**Interfaces:**
- Produces (file-local):
  - `writeFixtures({ pluginId, installedVersion, catalogPlugin, marketplaceName }) => { installedJson: string, marketplacesJson: string }` — writes the two snapshots into a fresh `tmpDir('cloud-setup-snap-')`.
  - `runVerdict(body: string, spec: string, curlDir: string, snapshots: { installedJson, marketplacesJson }) => { installed, expected, status, installPath, stderr }`.
  - `runTmpDirBlock(block, sessionId) => { ...spawnSyncResult, tmpdir: string /* native TMPDIR */, shellTmpdir: string /* bash's own view of it */ }`.

- [ ] **Step 1 (J): Replace the shared `/tmp` snapshot literals.** Delete `INSTALLED_JSON`/`MARKETPLACES_JSON`. `writeFixtures` returns the two per-test paths. `runVerdict` passes them as argv (`['-e', b, spec, installedJson, marketplacesJson]`) and, before spawning, swaps a frozen body's literals:

```js
const b = body
  .split('"/tmp/cc-installed.json"').join(JSON.stringify(snapshots.installedJson))
  .split('"/tmp/cc-marketplaces.json"').join(JSON.stringify(snapshots.marketplacesJson));
assert.ok(!b.includes('/tmp/cc-'), 'a frozen VERDICT body still names a /tmp/cc-*.json literal the swap did not cover');
```

`JSON.stringify` yields a valid JS string literal for a Windows path (escaped backslashes). Every caller does `const snapshots = writeFixtures({...}); runVerdict(body, spec, curlDir, snapshots)`. Update `runVerdict`'s header comment to say the frozen pre-#860 body has its literals swapped to the per-test paths.

- [ ] **Step 2 (J): Narrow `SH_STUB_SKIP` to the curl stub.** Its reason string and comment drop the `/tmp` clause ("A second win32 blocker …" sentence and "and the fixtures use hardcoded /tmp/cc-*.json paths"). Remove `{ skip: SH_STUB_SKIP }` from exactly the three tests that never consult curl:
  - `legacy entry-level version field still compares directly …`
  - `go-red proof: the pre-#860 VERDICT body reports "unversioned"/ok …`
  - `non-github.com catalog source url: skip the raw-manifest fetch …`

  Keep it on the 3 `sha-pinned catalog entry:` tests, `github.com source url: a failed raw-manifest fetch …`, and `go-red proof: the pre-#1779 VERDICT body swallows …`.

- [ ] **Step 3 (K): Derive the expected TMPDIR from bash's own view.** In `runTmpDirBlock`, after building `env`, read `shellTmpdir` from `spawnSync('bash', ['-c', 'printf %s "$TMPDIR"'], { encoding: 'utf8', env, timeout: 5000 }).stdout`; return both `tmpdir: env.TMPDIR` and `shellTmpdir`. Assertions:
  - unset test: `assert.strictEqual(result.stdout.trim(), result.shellTmpdir);`
  - exported test: `assert.strictEqual(result.stdout.trim(), `${result.shellTmpdir}/ct-session-abc123`);` and `assert.ok(fs.existsSync(path.join(result.tmpdir, 'ct-session-abc123')), …)` — existence through the native path, never the bash view.

  No `process.platform` branch. Add a one-line comment naming the cause (MSYS bash rewrites a Windows `TMPDIR` to its own `/tmp/…` view).

- [ ] **Step 4: Run the file**

Run: `node --test tests/cloud-setup-drift-check.test.js`
Expected: PASS — `ℹ tests 13`, `ℹ pass 13`, `ℹ skipped 0` on Linux (same count as before). Windows-only failures; AC5's dispatch is the proof that 3 of the 8 previously skipped tests now run and pass there, and the 2 session-id tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/cloud-setup-drift-check.test.js
git commit -m "Move drift-check snapshots off /tmp and read TMPDIR as bash sees it — #4291 classes J, K"
```

---

### Task 3: Long-path worktree fixture within git's limit (class L)

**Files:**
- Modify: `tests/bin-lib/reconcile/reap-merged.test.js` (`buildReapableFixture` :70-98, `LONG_DIR_NAME` comment :639-643, the two LONG tests :748 and :787)

**Interfaces:**
- Produces (file-local): `relocateWorktree(root: string, fromPath: string, toPath: string) => void` — moves a registered linked worktree on disk and repoints its admin `gitdir`, with no git invocation at `toPath`.
- `buildReapableFixture({ worktreeDirName })` keeps its signature and return `{ root, wtPath, runDir }`.

- [ ] **Step 1: Implement `relocateWorktree`.** Approach, in order: `fs.mkdirSync(path.dirname(toPath), { recursive: true })`; `fs.renameSync(fromPath, toPath)` (Node's `fs` handles a > 260-char target on win32); admin dir = `path.join(root, '.git', 'worktrees', path.basename(fromPath))`; rewrite its `gitdir` file. The new content keeps git's own spelling of the unchanged prefix:

```js
const gitdirFile = path.join(adminDir, 'gitdir');
const old = fs.readFileSync(gitdirFile, 'utf8').trim();          // "<fromPath as git spells it>/.git"
const fromSpelled = old.slice(0, -'/.git'.length);
const rel = path.relative(fromPath, toPath).split(path.sep).join('/');
fs.writeFileSync(gitdirFile, `${path.posix.join(fromSpelled, rel)}/.git\n`);
```

(The worktree's own `.git` file points at the admin dir, which did not move — it needs no edit.) Comment the function with the cause: `git worktree add`'s checkout child runs with `GIT_DIR=<wtPath>/.git`, which git rejects as `'$GIT_DIR' too big` near `PATH_MAX - 40` on Windows (run 40323587454), so a ≥ 240-char path is registered by moving an ordinary-length one.

- [ ] **Step 2: Use it in `buildReapableFixture`.** Always `git worktree add` at `path.join(root, '.claude', 'worktrees', 'issue-1')`; when the requested `wtPath` differs, `relocateWorktree(root, shortPath, wtPath)`. Then assert the registration followed the move:

```js
const listed = git(root, 'worktree', 'list', '--porcelain').replace(/\\/g, '/');
assert.ok(listed.includes(`worktree ${wtPath.replace(/\\/g, '/')}\n`), `git does not list the fixture worktree at ${wtPath}`);
```

- [ ] **Step 3: Pin the length.** In both LONG tests (`attemptLongPathRemoval: on win32, a LONG-path worktree …` and `#2566: a DIRTY worktree at a long path …`), first line after the fixture: `assert.ok(wtPath.length >= 240, `fixture path is ${wtPath.length} chars — the pre-follow-up length gate (>= 240) must have engaged`);`. Update the `LONG_DIR_NAME` comment to say the fixture registers it via `relocateWorktree`.

- [ ] **Step 4: Run the file**

Run: `node --test tests/bin-lib/reconcile/reap-merged.test.js`
Expected: PASS, same `ℹ tests` count as before (35). Windows proof is AC5.

- [ ] **Step 5: Commit**

```bash
git add tests/bin-lib/reconcile/reap-merged.test.js
git commit -m "Register the long-path reap fixture by moving a short worktree — #4291 class L"
```

---

### Task 4: Isolate global and system git config for the "unset" longpaths tests (class M)

**Files:**
- Modify: `tests/hooks-post-tool-use-worktree-staleness.test.js` (`warns on win32 when core.longpaths is unset` :231, `#2476: a real (non-forced) unset key still logs result: unset …` :336; new file-local helpers near them)

**Interfaces:**
- Produces (file-local):
  - `withGitConfigEnv(vars: Record<string,string>, fn: () => T) => T` — sets each var on `process.env`, runs `fn`, restores every prior value (deleting vars that were unset) in `finally`.
  - `isolatedGitConfig(fn)` — `withGitConfigEnv({ GIT_CONFIG_GLOBAL: <new empty temp file>, GIT_CONFIG_NOSYSTEM: '1' }, fn)`. The temp file comes from `fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wlp-gitcfg-'))` + an empty `gitconfig` file. Never `os.devNull` (Global Constraints).
  - `runnerLikeGlobalConfig(fn)` — `withGitConfigEnv({ GIT_CONFIG_GLOBAL: <temp file containing "[core]\n\tlongpaths = true\n"> }, fn)`: reproduces `windows-regression.yml:69`'s global `core.longpaths true` on any host.
  - `assertWarnsWhenUnset(isolate)` and `assertLogsUnset(isolate)` — the two tests' existing bodies, with the `post.run(...)` call written as `runnerLikeGlobalConfig(() => isolate(() => post.run(...)))`. Fixture setup (`setupProject`, `harnessWorktreeOf`) stays outside both wrappers, so commits keep the developer's identity.

- [ ] **Step 1: Refactor the two tests** to `test('warns on win32 when core.longpaths is unset', () => assertWarnsWhenUnset(isolatedGitConfig));` and the same for `assertLogsUnset`. Add one comment line: the runner-like global config is what the Windows runner has, so these tests reproduce its cause on Linux and pass only because of `isolatedGitConfig` (AC3.3).

- [ ] **Step 2: Run the file**

Run: `node --test tests/hooks-post-tool-use-worktree-staleness.test.js`
Expected: PASS, `ℹ tests 19`.

- [ ] **Step 3: Go-red proof (AC3.1, AC3.2) — do not commit the mutation.** Temporarily change both tests to pass `(fn) => fn()` instead of `isolatedGitConfig` and run the file again. Expected: exactly those two tests FAIL (no warning; the `windows-longpaths` event reads `enabled`, not `unset`). Revert the mutation and re-run to PASS. Quote both runs' `not ok` lines in the task report.

- [ ] **Step 4: Commit**

```bash
git add tests/hooks-post-tool-use-worktree-staleness.test.js
git commit -m "Isolate global git config for the longpaths-unset tests — #4291 class M"
```

---

### Task 5: Pipe in an item id without a `|` file on disk (class N)

**Files:**
- Modify: `tests/bin-lib/console/resolve.test.js:347-350` (and its `require` of `../../../plugin/bin/lib/console/resolve` if `renderTable` is not yet imported)

**Interfaces:**
- Consumes: `resolveAll`, `renderTable` (both exported by `plugin/bin/lib/console/resolve.js`).

- [ ] **Step 1: Rewrite the test**, same name:

```js
test('renderTable escapes a pipe in the item id, not only in the reason (#1932 M6)', () => {
  const r = resolveAll({ runDir: fixture({ staged: { 'reflect-1.md': 'x' }, headers: [7] }), policy: 'console-auto', deps: deps() });
  const table = renderTable({ ...r, items: r.items.map((it) => ({ ...it, id: 'reflect-a|b.md' })) });
  assert.match(table, /reflect-a\\\|b\.md/);
});
```

- [ ] **Step 2: Run the file**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: PASS, same `ℹ tests` count (124).

- [ ] **Step 3: Go-red proof (AC2.1, AC2.2) — do not commit the mutation.** Temporarily change `renderRows`' item cell in `plugin/bin/lib/console/resolve.js` from `${cell(it.id)}` to `${it.id}`; re-run; expected: this test FAILS. Revert (confirm `git diff plugin/` is empty) and re-run to PASS. Quote both runs in the report.

- [ ] **Step 4: Commit**

```bash
git add tests/bin-lib/console/resolve.test.js
git commit -m "Test the item-id pipe escape without a | file name — #4291 class N"
```

---

### Task 6: CRLF-tolerant jq line split (class F)

**Files:**
- Modify: `tests/find-run-comment-cli.test.js:120-131` (`jqLines`) plus one new test

**Interfaces:**
- Produces (file-local): `splitJqLines(stdout: string) => string[]` — `stdout.split(/\r?\n/).filter(Boolean)`, defined at file level.

- [ ] **Step 1: Write the failing pin** (new test, placed right before `AC2.1: parity with the documented jq`):

```js
test('AC4.1: splitJqLines drops CRLF line endings from jq output (#4291 class F)', () => {
  assert.deepEqual(splitJqLines('IC_member\r\nIC_x\r\n'), ['IC_member', 'IC_x']);
  assert.deepEqual(splitJqLines('IC_member\nIC_x\n'), ['IC_member', 'IC_x']);
});
```

(AC4.2 is the exact-value assertion on its first line.)

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/find-run-comment-cli.test.js`
Expected: FAIL after Step 1 with "splitJqLines is not defined" (Step 1 appends to an already-passing file)

- [ ] **Step 3: Add `splitJqLines` at file level** and make the parity test's `jqLines` return `splitJqLines(r.stdout)`.

- [ ] **Step 4: Run the file**

Run: `node --test tests/find-run-comment-cli.test.js`
Expected: PASS, `ℹ tests 18` (17 + this pin).

- [ ] **Step 5: Commit**

```bash
git add tests/find-run-comment-cli.test.js
git commit -m "Split jq output on CRLF in the run-comment parity test — #4291 class F"
```

---

## Post-build verification (controller, not a dispatched task)

- **AC1.1:** `node --test tests/install-statusline-wrapper.test.js tests/statusline.test.js tests/cloud-setup-drift-check.test.js tests/bin-lib/reconcile/reap-merged.test.js tests/hooks-post-tool-use-worktree-staleness.test.js tests/bin-lib/console/resolve.test.js tests/find-run-comment-cli.test.js tests/bin-lib/timing/cli.test.js` passes; compare each file's `ℹ tests` count against the merge base (`git show` of the base files run in a scratch copy, or the counts recorded in each task's Step 4).
- **AC5.1:** after the last commit is pushed, `gh workflow run windows-regression.yml --ref worktree-flow-spec-4291`, then read the run's per-file isolated logs (`verify-report` artifact) for these 7 files: 0 failures of classes I, J, K, L, M, N, F, and no file failing that does not fail at the merge base. If the L tests still fail on Windows for a reason the relocation cannot address, give them a stated win32 skip (the spec's Gotchas fallback) and re-dispatch.
