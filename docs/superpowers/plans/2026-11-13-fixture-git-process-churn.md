# Fixture Git Process Churn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The same tests spawn far fewer processes. Three changes do it: turn off git auto-maintenance for the suite, drop a per-session shell spawn, and copy the reused fixture repos from a once-per-process template instead of rebuilding them with git in every test.

**Architecture:**
- `tools/run-tests.js` adds `maintenance.auto=false` and `gc.auto=0` to the `node --test` child's environment as env-carried git config, which every git process in the run inherits.
- `plugin/bin/lib/deps.js`'s `has()` uses its existing `findOnPath` PATH scan.
- A new `tests/helpers/git-template.js` builds a named fixture once per test process with real git, then hands each caller an `fs.cpSync` copy. Absolute paths in the copy's git metadata are rewritten by plain file edits.
- The repeatedly called fixture builders move onto that helper.

**Tech Stack:** Node 18+ built-ins only (`fs`, `path`, `os`, `child_process`), `node --test`, git ≥ 2.31 (`GIT_CONFIG_COUNT`).

**Spec:** `.claude-tweaks/pipelines/2026-11-13T005056-spec-5297/work/5297-spec.md` (record #5297)

Scope keywords: maintenance.auto, GIT_CONFIG_COUNT, fromTemplate, findOnPath

## Global Constraints

- No new npm dependencies; the plugin ships no runtime npm deps.
- Env-carried config is **appended** after any `GIT_CONFIG_COUNT` entries the caller already exported, never replacing them.
- A template copy must start **zero** git processes. A copy stays independent of its template and of every other copy: a commit, fetch or push in one is never seen by another.
- Every migrated builder keeps the same return shape, the same mkdtemp prefix, the same realpath/non-realpath behaviour, and the same branch, files, commits and remotes as today.
- Copy timestamps are **not** preserved. A copy gets fresh mtimes, exactly as a freshly built repo did, because some tests order worktrees by mtime.
- Windows: the path rewrite must handle native backslash paths, git-config-escaped paths (`\\`) and forward-slash paths (worktree `gitdir` files). The Windows CI job must stay green.
- Commit style: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_016yg3zrGQB1yk3fGi1qfrJ2`.

## Review Focus

- A caller already exporting `GIT_CONFIG_COUNT`, or a malformed value such as `abc`. The caller's entries must survive at their indexes. A malformed count leaves the env untouched rather than producing a count git rejects. Test in Task 1.
- `git` absent from PATH, or present only as a non-executable file. `has('git')` must be false, so SessionStart still prints the "git not found" install hint. Test in Task 2.
- A copied clone must fetch and push against its own copied origin, never the template's origin, which is deleted at process exit. A copied linked worktree must resolve to the copy's main repo (`git -C wt rev-parse --git-common-dir`). Tests in Task 3.
- A template path that is a prefix of another path, e.g. `/T/tpl-1` and `/T/tpl-10`. The rewrite must not corrupt the longer path. Test in Task 3.
- A builder whose output depends on its arguments: load-delta's `baseFiles`, and git-fixtures' `branch`/`parent`. The template key must include them, so two different argument sets never share a template. Tests in Tasks 5 and 7 (git-fixtures `branch` in Task 5).

---

### Task 1: Env-carried git config for the suite's child process

**Files:**
- Modify: `tools/run-tests.js` (the child `spawn` env at ~line 529; the `module.exports` block at ~line 333)
- Test: `tests/run-tests-isolation.test.js`

**Interfaces:**
- Produces: `gitFixtureConfigEnv(env: object) -> object`, exported from `tools/run-tests.js`. It is pure: it returns a new object holding only the `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` keys to merge, never mutates `env`, and returns `{}` when `env.GIT_CONFIG_COUNT` is present but not `/^\d+$/`. The two entries are `maintenance.auto=false` and `gc.auto=0`, in that order, at indexes `N` and `N+1`, where `N` is the inherited count (0 when absent).

- [ ] **Step 1: Write the failing tests** (AC4.1) in `tests/run-tests-isolation.test.js`, importing `gitFixtureConfigEnv`:
  - `gitFixtureConfigEnv({})` deep-equals `{ GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'maintenance.auto', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'gc.auto', GIT_CONFIG_VALUE_1: '0' }`.
  - `gitFixtureConfigEnv({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'true' })` returns count `'3'`, keys at indexes 1 and 2, and no `GIT_CONFIG_KEY_0` key. The caller's index 0 stays untouched once merged.
  - `gitFixtureConfigEnv({ GIT_CONFIG_COUNT: 'abc' })` deep-equals `{}`.
  - The input object is unchanged after each call (deep-equal against a copy).
  - A real-input probe: `execFileSync('git', ['config', '--get', 'maintenance.auto'], { env: { ...process.env, ...gitFixtureConfigEnv(process.env) }, encoding: 'utf8' }).trim()` equals `'false'`.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/run-tests-isolation.test.js`
Expected: FAIL after Step 1, with `gitFixtureConfigEnv is not a function`
- [ ] **Step 3: Implement `gitFixtureConfigEnv`** in `tools/run-tests.js`, add it to `module.exports`, and spread it into the child env: `env: { ...process.env, ...gitFixtureConfigEnv(process.env), TMPDIR: runRoot, ... }`. Add a two-line comment naming the measured cost: 391 `git maintenance run --auto` processes across six heavy files, #5297.
- [ ] **Step 4: Run to see it pass.** Run: `node --test tests/run-tests-isolation.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `tools/run-tests.js tests/run-tests-isolation.test.js` with "Turn off git auto-maintenance for the suite's child env — env-carried config, appended (#5297)".

### Task 2: `deps.has()` by PATH scan, no shell

**Files:**
- Modify: `plugin/bin/lib/deps.js` (`has()`, ~lines 7-20)
- Test: `tests/lib.test.js` (beside the existing `deps: has()` tests, ~line 55)

**Interfaces:**
- Consumes: `findOnPath(name, { env, platform, cwd })` from the same file.
- Produces: `has(cmd: string) -> boolean`. It is `true` for `'node'`, and otherwise `findOnPath(cmd, { env: process.env, platform: process.platform, cwd: null }) !== null`. It never spawns a process.

- [ ] **Step 1: Write the failing tests** (AC5.1, AC2.1) in `tests/lib.test.js`:
  - `deps: has() finds a command on PATH without spawning`. Write an executable stub `git` (`git.cmd` on win32) into a temp dir. Set `process.env.PATH` to that dir, and restore it in `finally`. Stub `child_process.execSync`, `execFileSync` and `spawnSync` to set a `called` flag, the same way the existing `has('node')` test stubs `execSync`. Reload `deps.js` fresh. Assert `has('git') === true` and `called === false`.
  - `deps: has() is false for a non-executable file on PATH` (skip on win32). The same dir holds `git` with mode `0o644`. Assert `has('git') === false`.
  - With `process.env.PATH` set to an empty temp dir, assert `has('git') === false`.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/lib.test.js`
Expected: FAIL after Step 1, on the `called === false` assertion, because `has()` still calls `execSync`
- [ ] **Step 3: Implement** `has()` per the Interfaces block. Replace the `execSync` import if nothing else in the file uses it. The comment should say why there is no shell: `execSync` spawned `/bin/sh -c git --version` plus git on every SessionStart, 2 processes each (#5297).
- [ ] **Step 4: Run to see it pass.** Run: `node --test tests/lib.test.js tests/hooks-session-start.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `plugin/bin/lib/deps.js tests/lib.test.js` with "Answer deps.has() by PATH scan — SessionStart spawned sh + git to check git exists (#5297)".

### Task 3: Template-copy fixture helper

**Files:**
- Create: `tests/helpers/git-template.js`
- Test: `tests/helpers-git-template.test.js` (new; it neighbours `tests/helpers-git-fixtures.test.js`)

**Interfaces:**
- Produces:
  - `fromTemplate(key: string, build: (dir: string) => void, { parent = os.tmpdir(), prefix: string, realpath = false }) -> string`. On the first call for `key` in this process, it makes a template dir, runs `build(dir)` in it, and caches it. Every call then `fs.mkdtempSync(path.join(parent, prefix))`, copies the template's contents into it (`fs.cpSync`, `recursive: true`, timestamps **not** preserved), rewrites template paths (below), and returns the new dir (`fs.realpathSync`'d when `realpath`).
  - `fromTemplateSet(key: string, build: (dirs: Record<string,string>) => void, layout: Record<string, { parent?: string, prefix: string, realpath?: boolean }>) -> Record<string,string>`. The same, for several sibling dirs built together, such as an origin and its clones. Each name in `layout` gets its own mkdtemp dir, and the rewrite maps every template member path to the matching new member path.
  - `rewriteTemplatePaths(root: string, mapping: Array<[from: string, to: string]>) -> void` (exported for tests). It visits only git path-bearing files under `root`: every `config` file inside a `.git` dir or a bare repo dir, every `gitdir` file under `.git/worktrees/*/`, and every `.git` *file* (a linked worktree's pointer). In each one it replaces every occurrence of each `from` with `to`, in four spellings: raw, `fs.realpathSync` form, forward-slash form, and git-config-escaped (`\` → `\\`).
  - `disableReceiveAutoGc(bareDir: string) -> void`. It appends `[receive]\n\tautogc = false\n` to `<bareDir>/config` with `fs.appendFileSync`, starting no process. A push into a local bare origin runs `git-receive-pack`, and git's local transport strips `GIT_CONFIG_*` from that side, so Task 1's env cannot stop the `maintenance run --auto` it starts. The origin's own config has to. Every bare origin a template or a test builds calls this.
- Template dirs live under one `fs.mkdtempSync(path.join(os.tmpdir(), 'ct-git-template-'))` root per process, removed in a `process.on('exit')` handler (best effort, in try/catch).

- [ ] **Step 1: Write the failing tests** in `tests/helpers-git-template.test.js`. Give each git call in `build` an explicit identity env (`GIT_AUTHOR_NAME/EMAIL`, `GIT_COMMITTER_NAME/EMAIL`):
  - `fromTemplate builds once and returns independent copies`. Count `build` calls across three `fromTemplate('k1', build, { prefix: 'ct-gt-' })` calls: expect 1. The three dirs are distinct, start with `ct-gt-`, and each has `HEAD` at the same sha. A commit made in copy 1 leaves copy 2's `git rev-parse HEAD` unchanged.
  - `a copy starts no git process`. After a warm-up call, set `process.env.GIT_TRACE2_EVENT` to an empty temp dir, call `fromTemplate('k1', ...)` twice, restore the env, and assert the trace dir is still empty. Use the same trace2 technique in Tasks 4-7.
  - `fromTemplateSet rewires a clone to its own copied origin`. Build a bare `origin` with `receive.autogc=false`, plus a `work` clone with one pushed commit. In a copy, commit and `git push -q origin HEAD` from `work`. Assert that the copy's origin has the new commit (`git -C copy.origin rev-parse HEAD`), and that the template's origin and a second copy's origin do not.
  - `a copied linked worktree resolves to the copy's main repo`. The template holds a repo plus `git worktree add` at `<repo>/.claude/worktrees/feat`. In the copy, `git -C <copy>/.claude/worktrees/feat rev-parse --git-common-dir` resolves (realpath) to `<copy>/.git`, and `git -C <copy> worktree list --porcelain` names the copied worktree path.
  - `rewriteTemplatePaths does not corrupt a longer sibling path`. Use a temp tree with `.git/config` containing `url = /T/tpl-1/o` and `url = /T/tpl-10/o`, and mapping `[['/T/tpl-1', '/T/new']]`. Expect the first line rewritten and the second unchanged. The rewrite only replaces a `from` that is followed by `/`, `\`, a quote, whitespace or end of line.
  - `realpath: true returns a resolved path`. Expect `fs.realpathSync(result) === result`.
  - `disableReceiveAutoGc stops receive-pack maintenance`. Make a bare origin, call `disableReceiveAutoGc(origin)`, then commit and push into it from a clone with `GIT_TRACE2_EVENT` pointing at an empty dir. No trace file's `start` event argv contains `maintenance`. Without the call, as a control in the same test, one does.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/helpers-git-template.test.js`
Expected: FAIL with `Cannot find module './helpers/git-template'`
- [ ] **Step 3: Implement** `tests/helpers/git-template.js` per the Interfaces block. Its header comment states the #5297 reason (measured per-test init/clone/config/commit/push churn), what is rewritten, and why timestamps are not preserved.
- [ ] **Step 4: Run to see it pass.** Run: `node --test tests/helpers-git-template.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** both files with "Add a template-copy git fixture helper — build once per process, copy per test (#5297)".

### Task 4: Move the pre-tool-use and git-fixtures repo builders onto templates

**Files:**
- Modify: `tests/helpers/pre-tool-use.js` (`gitRepo`, `gitRepoWithCommit`)
- Modify: `tests/helpers/git-fixtures.js` (`gitRepo({ parent, branch })`, `originWithTwoClones(prefix)`)
- Test: `tests/helpers-git-template.test.js` (append)

**Interfaces:**
- Consumes: `fromTemplate`, `fromTemplateSet` (Task 3).
- Produces: unchanged exports and return shapes.
  - `pre-tool-use.gitRepo()`: init only, prefix `ct-e1-`, realpath.
  - `gitRepoWithCommit()`: plus one empty commit `init`, its own template key.
  - `git-fixtures.gitRepo()`: prefix `ct-wtd-`, realpath, one empty commit. Its key includes `branch`, and `parent` is passed through.
  - `originWithTwoClones(prefix)`: one root dir with `origin.git`, `work` and `other`. Key includes nothing caller-specific beyond the shape; `prefix` goes to the copy, not the key. Its `env`, `run`, `commit` and `gitIn` are rebuilt per call against the copied paths, and its bare origin gets `receive.autogc=false`.
- `linkedWorktreeOf`/`harnessWorktreeOf` stay real `git worktree add` calls. A worktree of a per-test repo cannot come from a template.

- [ ] **Step 1: Write the failing tests** (append). For each of `pre-tool-use.gitRepo`, `pre-tool-use.gitRepoWithCommit`, `git-fixtures.gitRepo()`, `git-fixtures.gitRepo({ branch: 'trunk' })` and `originWithTwoClones('ct-gt-otc-')`: after one warm-up call, a second call starts no git process (trace2 technique). For `gitRepo({ branch: 'trunk' })`, also assert `git -C dir symbolic-ref --short HEAD` prints `trunk`.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/helpers-git-template.test.js`
Expected: FAIL after Step 1, on the new "starts no git process" tests

- [ ] **Step 3: Implement** per the Interfaces block, keeping each builder's comments accurate. Build steps inside `build` use the same git calls the builder makes today, so the repo's content is identical.
- [ ] **Step 4: Run to see it pass.** Run: `node --test tests/helpers-git-template.test.js tests/helpers-git-fixtures.test.js tests/hooks-pre-tool-use.test.js tests/hooks-pre-tool-use-forge-memo.test.js tests/hooks-worktree-detect.test.js tests/hooks-dispatcher.test.js tests/bin-lib/worktree/remote-branch-collision.test.js tests/adopted-branch-collision-snippet-fixture.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** with "Copy pre-tool-use and git-fixtures repos from templates (#5297)".

### Task 5: Move the reconcile fixtures onto templates

**Files:**
- Modify: `tests/helpers/reconcile-fixtures.js` (`pairedFixture`, `bareRepoRoot`)
- Test: `tests/helpers-git-template.test.js` (append)

**Interfaces:**
- Consumes: `fromTemplate`, `fromTemplateSet` (Task 3).
- Produces: unchanged.
  - `pairedFixture() -> { originDir, seedDir, mainDir }`: three separate mkdtemp dirs with prefixes `ct-recon-origin-`, `ct-recon-seed-` and `ct-recon-main-`, not realpath'd (as today). The origin is bare on `main` with `receive.autogc=false`. `seedDir` has the pushed `seed` commit, and `mainDir` is a clone of it. Both clones carry `user.email test@example.com` / `user.name Test`.
  - `bareRepoRoot()`: prefix `ct-recon-orphan-`, realpath'd, one `seed` commit with `a.txt`.

- [ ] **Step 1: Write the failing tests** (append):
  - After a warm-up, `pairedFixture()` and `bareRepoRoot()` start no git process.
  - `git -C mainDir remote get-url origin` equals the copy's `originDir`.
  - A `seed` push from the copy's `seedDir`, followed by `git -C mainDir fetch -q origin`, makes `origin/main` in `mainDir` equal `seedDir`'s HEAD.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/helpers-git-template.test.js`
Expected: FAIL after Step 1, on the new "starts no git process" tests

- [ ] **Step 3: Implement** per the Interfaces block.
- [ ] **Step 4: Run to see it pass.** Run: `node --test tests/helpers-git-template.test.js tests/reconcile.test.js tests/reconcile-archive-residue.test.js tests/reconcile-preflight-fetch.test.js tests/reconcile-dispatch.test.js tests/bin-lib/reconcile/reap-merged.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** with "Copy reconcile's paired and orphan fixtures from templates (#5297)".

### Task 6: Move the verify CLI repo builder onto a template

**Files:**
- Modify: `tests/bin-lib/verify/cli-helpers.js` (`tmpGitRepo`)
- Test: `tests/helpers-git-template.test.js` (append)

**Interfaces:**
- Consumes: `fromTemplate` (Task 3).
- Produces: `tmpGitRepo() -> { repo, git, gitDir }`, unchanged. `repo` is realpath'd with prefix `verify-cli-test-`, has one empty `init` commit, and carries the `verify-test@example.invalid` / `verify test` identity in its local config. `git` is rebuilt per call for the copied `repo`.

- [ ] **Step 1: Write the failing test** (append): after a warm-up, `tmpGitRepo()` starts no git process, and `git config user.email` in the copy prints `verify-test@example.invalid`.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/helpers-git-template.test.js`
Expected: FAIL after Step 1, on the new test
- [ ] **Step 3: Implement** per the Interfaces block.
- [ ] **Step 4: Run to see it pass.** Run: `node --test tests/helpers-git-template.test.js tests/bin-lib/verify/cli-baseline.test.js tests/bin-lib/verify/cli-flaky-preexisting.test.js tests/bin-lib/verify/cli-scope-integration.test.js tests/bin-lib/verify/cli-slot-queue.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** with "Copy verify CLI test repos from a template (#5297)".

### Task 7: Move the in-file builders of teardown-run, load-delta and session-start onto templates

**Files:**
- Modify: `tests/hooks-teardown-run.test.js` (`fixtureRepo`, ~lines 24-55)
- Modify: `tests/load-delta-cli.test.js` (`makeRepo`, ~lines 30-40)
- Modify: `tests/hooks-session-start.test.js` (`gitProject`, ~line 323)

**Interfaces:**
- Consumes: `fromTemplate`, `disableReceiveAutoGc` (Task 3).
- Produces: unchanged return shapes.
  - `fixtureRepo()`: realpath'd `ct-td-` root. Its contents are exactly today's: the trunk branch, the `origin` URL `git@github.com:acme/widgets.git`, the `feat-branch` linked worktree at `.claude/worktrees/feat`, the `materialize #9` commit, and the untracked `config.yml`/`decisions.md`. `runId` is fixed.
  - `makeRepo(baseFiles, { origin })`: the key is `JSON.stringify([baseFiles, origin])`, and the prefix is `load-delta-`.
  - `gitProject()`: keeps `tmpProject()`'s prefix and realpath behaviour (read it), init only.
  - The three inline bare origins in `tests/hooks-session-start.test.js` (the `git init --bare` calls at ~lines 439, 907 and 1104) stay inline. Each is built once per process, so a template saves nothing. Each gets `disableReceiveAutoGc(originDir)` right after its `init`.

- [ ] **Step 1: Covered by the existing suites.** These builders are file-local and unexported, so no new test is added. Their own suites are the regression oracle, and the controller's spawn measurement is the evidence of the cut.
- [ ] **Step 2: Implement** per the Interfaces block. Read each file's callers of the builder first. A test that mutates its fixture before asserting keeps working, because each copy is fresh.
- [ ] **Step 3: Run to see it pass.** Run: `node --test tests/hooks-teardown-run.test.js tests/load-delta-cli.test.js tests/hooks-session-start.test.js`. Expected: PASS.
- [ ] **Step 4: Commit** with "Copy teardown-run, load-delta and session-start fixture repos from templates (#5297)".

### Task 8: Measure and report (controller, no commit)

**Files:** none committed. The measuring scripts stay in the session scratchpad and are quoted in the PR body.

- [ ] **Step 1: Verification — measure spawns (AC1.1, AC2.1, AC3.1).** Re-run the baseline harness, unchanged, on this branch. Set A is the six heavy files and set B the four verify CLI files, run with `CT_TEST_CONCURRENCY=6`, counting git processes by `GIT_TRACE2_EVENT` file, non-git children of git, and node processes. Expect:
  - zero `maintenance` argv in any trace file (AC1.1);
  - no `--version` git process with a `sh` parent from the SessionStart path (AC2.1);
  - total git processes across A and B at most 3,695, with 437 tests passing (AC3.1).
- [ ] **Step 2: Verification — report (AC3.2).** Record before/after per set in the PR body. Name any builder left unmigrated, with its reason: the session-start inline origin/seed/main triples are each built once per process, so a template saves nothing. Name any acceptance criterion that falls short, with why.
- [ ] **Step 3: Verification — full suite and Windows (AC6.1).** Build's Common Step 5 runs the full suite through `verify.js`, and a Windows CI run is dispatched after the last code change. Both must be green.

Scope-keyword sweep (Check B): the extra hits for `GIT_CONFIG_COUNT` were each reviewed and need no change:
- `plugin/bin/lib/staged-patch/stack-check.js` and its test strip env-carried config for their own isolated git calls. That stays correct, and those calls are not commits.
- `plugin/bin/lib/hooks/git-command.js` and `tests/hooks-gate-coverage.test.js` scan command text.
- `tests/verify-scope-declaration.test.js` deletes the env config for its own throwaway repo.
- `tests/fixtures/closing-links/pr-4144-body.md` and `docs/journeys/stage-a-patch-that-conflicts-with-an-earlier-one-3290.md` are prose.
