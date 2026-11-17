# verify.js git-call dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one `verify.js` invocation ask git each read-only question once, unless the answer may have changed since the last time it asked, while keeping the report, `verify-report.json` fields and exit codes the same.

**Architecture:** A new per-process module, `plugin/bin/lib/verify/git-reads.js`, answers the repo toplevel, git dir, common dir and HEAD with one multi-flag `git rev-parse` per directory and env, and keeps a tree-state read (`sha` + `dirty`) until the next point where the tree may have changed. Callers mark those points with `invalidate()`. `verify.js` routes its own reads through one instance. `baseline.js`'s `realGit` and `changed-files.js`'s `resolveBase` take optional precomputed answers, and impact location uses `checkoutImpactContext`'s existing `locate` seam. Existing exports (`report.js`'s `gitInfo`/`gitDir`/`dirtyFilePaths`, `impact.js`'s `gitLocations`) keep their behavior for their other callers (`qa-stamp.js`, `acceptance-packet.js`, `tools/test-impact.js`, `tools/run-tests.js`).

**Tech Stack:** Node 18+, `node:test`, `child_process.execFileSync`, git.

**Spec:** `.claude-tweaks/pipelines/2026-11-17T033419-record-5773/work/5773-spec.md` (record #5773)

Scope keywords: resolveGitDir, scopeSelfPath

## Global Constraints

- The memo lives for one process only, is keyed on the directory and the git-relevant environment, and is never written to disk (spec Deliverable 3). A read after the suites ran, after a baseline worktree was created or removed, or in another directory asks git again.
- `verify.js` prints the same report, writes the same `verify-report.json` fields and exits with the same codes as before. The existing verify tests pass with changes only to stubbed call shapes, and no test is deleted, skipped, renamed, merged or loosened (spec AC6 and its Decision paragraph). New tests may be added.
- Do not edit `tests/bin-lib/verify/cli-helpers.js`: the open PR #5809 owns it. Import from it freely.
- Never memoize a read across a point where `verify.js`, or a command it spawns (suite, impact fetch, flaky retry, pre-existing rerun, baseline rerun, `git worktree add/remove`), could change the tree or HEAD. Each memoized read gets a test that goes red when the value is served stale.
- Every `execFileSync` call passes a literal `windowsHide: true` key in its own options object, never through a spread (`.claude/skills/gh-api-module-pattern/SKILL.md`, quoted: "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.** The scan reads each `child_process` call's own argument text: it accepts a literal `windowsHide` key there, or a bare identifier as the whole options argument whose own `const X = { … }` literal names it ... A spread — `{ ...QUIET, timeout }` with the flag inside `QUIET` — satisfies neither and fails the full suite").
- A `git status` call passes `--no-optional-locks` (`tests/git-status-optional-locks.test.js`), and a `status --porcelain` call without `-z` carries the line marker `// git-path-read: not a path list (emptiness only)` (`tests/git-path-read-conformance.test.js`).
- Tests that spawn `verify.js` default the child env to `{ ...process.env, CT_TEST_SUITE_SLOT_HELD: '1' }` (`.claude/skills/suite-slot-test-env/SKILL.md`, quoted: "A helper that spawns `verify.js` and is given no env defaults the child to `{ ...process.env, CT_TEST_SUITE_SLOT_HELD: '1' }`, never bare `process.env`"), and bound a child with the spawn's own `timeout`, never a wall-clock assertion.
- A test that asks real git for an expected value is proven under `node tools/run-tests.js --files-from <list>`, not only bare `node --test` (`.claude/skills/git-ground-truth-test-env/SKILL.md` rule 3, quoted: "**Prove both under the runner.** Run `node tools/run-tests.js --files-from <list>`, never only a bare `node --test`: the runner's env is part of the test's input.").
- A path the code compares or prints on Windows: keep `path.resolve(cwd, out)` for git-dir and common-dir, as `report.js`'s `gitDir` and `impact.js`'s `gitLocations` do today, and keep the toplevel string exactly as git prints it (trimmed), as `realGit().repoRoot()` does today.
- Commit trailer on every commit: `Claude-Session: https://claude.ai/code/session_01CcCLFrS3o4arCVCisWXHpW`. Commit subjects follow `{Verb} {what} — {detail}` with `refs #5773`.

## Review Focus

1. **Unborn HEAD** (a fresh `git init`, no commit): `rev-parse ... --verify -q HEAD` exits 1 after printing the three location lines. Locations must still resolve, `head` must be `null`, and the tree state must read `{ sha: null, dirty: null }` exactly as `gitInfo` does today (it never runs `status` when `rev-parse HEAD` fails). Pinned in Task 2.
2. **Outside any checkout, or in a bare repo / inside `.git`**: the combined call fails (exit 128). Fallback must reproduce today's per-question answers: not a repo gives all-null in at most 2 git calls, and a bare repo gives `gitDir` and `head` but a `null` toplevel. Pinned in Task 2.
3. **A suite that dirties or commits the tree**: the end read must see it. `report.json` `dirty: true` for a new untracked file, and no pass stamp when HEAD moved (#3757's `treeMoved`). Pinned in Task 3 (AC3.1).
4. **`--cwd` naming a different checkout**: the #3799 refusal must still fire. Locations are keyed per resolved directory, so `--cwd`'s git dir is asked separately from the process cwd's. Pinned in Task 3.
5. **The `--baseline` adjudication after failing suites.** `verify.js` makes one `adjudicate` call (`verify.js:1108`, every check at once). Its repo-root read (`baseline.js:540`) follows the suites, so it must ask git again rather than reuse the start answer, and `slotWorktree`'s common-dir read (before the `worktree add`) reuses that fresh answer. The end tree read after `adjudicate` asks again. Pinned in Task 4.

---

### Task 1: Git-call recorder and the before trace

**Files:**
- Create: `tests/helpers/git-call-recorder.js`
- Test: `tests/helpers/git-call-recorder.test.js`

**Interfaces:**
- Produces: `tests/helpers/git-call-recorder.js`, loaded with `node --require <path>`. When `process.env.CT_TEST_GIT_CALL_LOG` names a directory, it wraps `child_process.execFileSync`, `execFile`, `spawnSync` and `spawn` before any other module loads, and appends one JSON line per child call to `<dir>/<pid>.jsonl`. The first line is `{ "kind": "argv", "argv": process.argv.slice(2), "cwd": process.cwd() }`. Each later line is either `{ "kind": "git", "args": [...], "cwd": <resolved cwd or process.cwd()>, "env": <envFingerprint(options.env || process.env)> }` for a `git` call, or `{ "kind": "spawn", "cmd": <file or command string> }` for any other command. `envFingerprint` comes from `plugin/bin/lib/hooks/repo-info-cache.js`. Calls pass through unchanged. Without the env var the helper does nothing.
- Produces: `readGitCalls(dir) -> Array<{ pid, argv, events }>`, exported from the same file for tests and the trace script. It is the only export, and requiring the helper for this export does not patch anything unless the env var is set.

- [ ] **Step 1: Write the failing test** `tests/helpers/git-call-recorder.test.js`: spawn `node --require <helper> -e "<script running execFileSync('git',['--version'],{windowsHide:true}) then execFileSync(process.execPath,['-e','0'],{windowsHide:true})>"` with `CT_TEST_GIT_CALL_LOG` set to a fresh temp dir. Assert that `readGitCalls(dir)` returns one process whose events are `[{kind:'git', args:['--version'], ...}, {kind:'spawn', cmd: process.execPath}]`. Add a second test: with the env var unset, nothing is written to the directory.
- [ ] **Step 2: Run** `node --test tests/helpers/git-call-recorder.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement the helper.** Write each line with `fs.appendFileSync` so a process that exits early (`process.exit`) loses nothing. Never throw from the wrapper: a recorder error is swallowed and the real call still runs.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Take the before trace (scratch, not committed).** Write a scratch analyzer under the session scratchpad. It reads `readGitCalls(dir)`, classifies each `verify.js` process by argv: `--baseline` gives baseline; `--scope` whose run used an impact block gives impact-selected (the `impact-cli.test.js` processes); `--scope` with a CI-declared suite gives CI-answered (the `ci-cli.test.js` processes); other `--scope` gives scoped; neither gives whole-suite; `--stamp-status` and `--changed-files` are their own modes. For one representative invocation per mode it prints the ordered git calls and marks each call whose `(args, cwd, env)` equals an earlier one in the same process: `repeat, nothing between` when no `spawn` event lies between them, else `repeat after spawn: <cmd>`. Collect the logs one test file at a time, each into its own empty log dir named after the file, so the dir is the caller tag that the classification and Task 5's per-file attribution read: `NODE_OPTIONS="--require <abs helper path>" CT_TEST_GIT_CALL_LOG=<abs empty dir for this file> node tools/run-tests.js --files-from <one-line list>`, for each of the five files `tests/bin-lib/verify/cli.test.js`, `impact-cli.test.js`, `ci-cli.test.js`, `cli-scope-integration.test.js` and `cli-stamp-discovery.test.js`, plus `cli-baseline.test.js` for the baseline mode. Impact-selected processes come from the `impact-cli.test.js` dir and CI-answered ones from the `ci-cli.test.js` dir. Within a dir, argv still decides the mode. Save the analyzer's output to `$PIPELINE_RUN_DIR/evidence/trace-before.txt` (`mkdir -p` it first; plain Bash redirect, absolute path under `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-17T033419-record-5773/`). Keep the analyzer script in the scratchpad: Task 5 re-runs it.
- [ ] **Step 6: Check the trace against Tasks 2-4.** Every `repeat, nothing between` row must be one this plan removes: toplevel / git-dir / common-dir, start HEAD, `usableAnchor`'s pair called twice in `--scope`, and `--changed-files`'s git-dir and HEAD. A row this plan does not cover is reported in the task's reply as `NEW REPEAT: <args> in <mode>`. The controller adds it to Task 4 before dispatching it.
- [ ] **Step 7: Commit** the helper and its test: `Add a git-call recorder test helper — trace verify.js git calls per process, refs #5773`.

### Task 2: `git-reads.js`, the per-process answers
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/verify/git-reads.js`
- Test: `tests/bin-lib/verify/git-reads.test.js`

**Interfaces:**
- Produces: `createGitReads({ execImpl = execFileSync, env = process.env } = {}) -> GitReads`, where:
  - `locations(cwd: string) -> { toplevel: string|null, gitDir: string|null, commonDir: string|null, head: string|null }`. Memoized under the key `path.resolve(cwd) + '\0' + envFingerprint(env)`. `gitDir` and `commonDir` are `path.resolve(cwd, out)`, `toplevel` is git's own trimmed text, and `head` is the full sha or null. An empty output line means null.
  - `treeState(cwd: string) -> { sha: string|null, dirty: boolean|null }`. Memoized under the same key. `sha` comes from `locations(cwd).head`. When `sha` is null it returns `{ sha: null, dirty: null }` without running status, the same as `gitInfo`. Otherwise it runs `git --no-optional-locks status --porcelain` once in `cwd`: non-empty output means `true`, empty means `false`, and a throw means `null`.
  - `invalidate() -> void`: drops every memoized answer (locations and tree state, every key).
- Uses: `envFingerprint` from `plugin/bin/lib/hooks/repo-info-cache.js`.

The combined call is `execImpl('git', ['rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir', '--verify', '-q', 'HEAD'], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })`. It is probed: in a repo it prints four lines and exits 0; on an unborn HEAD it prints three lines and exits 1. Read the result like this:
- Exit 0 with four lines gives all four values.
- A throw with `err.status === 1` and `String(err.stdout)` holding exactly three non-empty lines means an unborn HEAD: locations from those lines, `head: null`.
- Any other throw is the fallback, whose calls keep today's stdio (no `stdio` option, so git's stderr reaches `verify.js`'s stderr as `report.js`'s `gitDir` and `gitInfo` do now): `rev-parse --git-dir` alone. If that throws, the answer is all-null (2 calls in total). Otherwise ask `rev-parse --show-toplevel`, `rev-parse --git-common-dir` and `rev-parse HEAD`, each in its own try/catch that yields null. This is today's per-question behavior in a bare repo or inside `.git`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/verify/git-reads.test.js`, using a fake `execImpl` that records `(file, args, opts.cwd)` and answers by argv shape, throwing `new Error('unexpected ' + args.join(' '))` on anything unhandled:
  - `locations asks one combined rev-parse per directory`: two `locations('/r')` calls make 1 call, whose args equal the combined argv above. The result is `{ toplevel:'/r', gitDir: path.resolve('/r','.git'), commonDir: path.resolve('/r','.git'), head:'abc' }`.
  - `locations keys on directory and env`: `locations('/r')` then `locations('/r/sub')` makes 2 calls. A second instance with `env: { GIT_DIR: 'x' }` makes its own call. One instance asking `/r` twice makes 1.
  - `treeState reuses the head from locations and runs status once`: after `locations('/r')`, `treeState('/r')` twice adds exactly one `--no-optional-locks status --porcelain` call.
  - `invalidate makes the next read ask git again (stale-read guard)`: the fake answers `head` `aaa` then `bbb` and status `''` then `'?? x\n'`. Before `invalidate()`, `treeState` returns `{ sha:'aaa', dirty:false }` both times. After it, `treeState` returns `{ sha:'bbb', dirty:true }`. Mutation proof: removing the `invalidate` body must turn this test red.
  - `unborn HEAD gives locations and a null tree state without status`: the fake throws `{ status: 1, stdout: '/r\n.git\n.git\n' }`. Expect `head: null`, locations set, `treeState` = `{ sha:null, dirty:null }`, and no status call.
  - `outside a checkout costs two calls and answers null`: the combined call throws `{ status: 128, stdout: '' }` and `--git-dir` throws. Expect all-null, 2 calls in total.
  - `bare repo falls back per question`: the combined call throws 128. `--git-dir` gives `.`, `--show-toplevel` throws, `--git-common-dir` gives `.` and `HEAD` gives `abc`. Expect `toplevel: null`, `gitDir`/`commonDir` resolved, `head:'abc'`.
  - `real git agrees with today's readers` (ground truth): in a temp repo built with `git init` and one commit, `createGitReads().locations(dir)` equals `{ toplevel: realGit(dir).repoRoot(), gitDir: gitDir(execFileSync, dir), commonDir: gitLocations({cwd: dir}).commonDir, head: <git rev-parse HEAD in dir> }`. Run it under `tools/run-tests.js` as well.
- [ ] **Step 2: Run** `node --test tests/bin-lib/verify/git-reads.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `createGitReads`** in `plugin/bin/lib/verify/git-reads.js`. Put a header comment stating the per-process, never-on-disk, invalidate-at-mutation contract and why there is no filesystem signature: every mutation point is inside the one invocation and is named by the caller, unlike #5294's cross-process cache.
- [ ] **Step 4: Run** the test file and `node tools/run-tests.js --files-from <list naming it>`. Expected: PASS both. Also run `node --test tests/windows-hide-spawn-conformance.test.js tests/git-status-optional-locks.test.js tests/git-path-read-conformance.test.js`. Expected: PASS.
- [ ] **Step 5: Commit**: `Add git-reads — answer toplevel, git dir, common dir and HEAD with one rev-parse per invocation, refs #5773`.

### Task 3: Route verify.js's own reads through one `GitReads`
**Review risk:** high

**Files:**
- Modify: `plugin/bin/verify.js` (`checkoutRoot`/`scopeSelfPath` ~L144-169, `stampStatus` ~L266-270, `changedFilesMode` ~L431-456, `main` ~L485-551, the impact call ~L746, the end read ~L1209)
- Modify: `plugin/bin/lib/verify/changed-files.js` (`resolveBase` gains `head` and `anchor` options)
- Test: `tests/bin-lib/verify/cli.test.js` (two new tests), `tests/bin-lib/verify/changed-files.test.js` (two new tests)

Waived `plugin/bin/lib/verify/report.js`: the spec's "reuse the tree-state and git-dir reads" is met inside `verify.js` through `GitReads` (this task). `report.js`'s `gitInfo`/`gitDir` stay unchanged for `qa-stamp.js` and `acceptance-packet.js`. This task's wiring step reads its call shapes.

**Interfaces:**
- Consumes: `createGitReads` (Task 2). The recorder `tests/helpers/git-call-recorder.js` (Task 1).
- Produces: `resolveBase({ ..., head = undefined, anchor = undefined })`. When `head` is a string or `null`, it is used instead of the `rev-parse --verify HEAD` call at ~L74. When `anchor` is not `undefined`, it is used instead of calling `usableAnchor` at ~L63. Both default to today's behavior.

Wiring. One module-level `const reads = createGitReads();` in `verify.js`:
- `checkoutRoot(cwd)` returns `reads.locations(cwd).toplevel ?? cwd`. `scopeSelfPath` uses `reads.locations(scopeCwd).toplevel` and returns null when it is null. This keeps today's catch behavior.
- `stampStatus`: `ownGitDir = reads.locations(process.cwd()).gitDir`, and `git = gitDir ? reads.treeState(process.cwd()) : {sha:null, dirty:null}`.
- `changedFilesMode`: `ownGitDir` and `head` come from `reads.locations(process.cwd())`. Pass `head` into `resolveBase`, and use it for the `warning` check in place of the trailing `gitInfo().sha`. Nothing is spawned in that mode, so the read is valid throughout.
- `main`: `ownGitDir = reads.locations(process.cwd()).gitDir`. The #3799 `--cwd` check uses `reads.locations(path.resolve(parsed.cwd)).gitDir`. `startGit = reads.treeState(process.cwd())`.
- `--scope`: compute `anchorSha = usableAnchor({ stamp: priorStamp })` once, before `resolveBase`, and pass `anchor: anchorSha` into it, so the `merge-base --is-ancestor` / `rev-parse --verify` pair runs once instead of twice. Keep the H4 conflict check reading the same `anchorSha`.
- `checkoutImpactContext` gets `locate: ({ cwd }) => { const l = reads.locations(cwd); return l.toplevel && l.commonDir ? { repoRoot: l.toplevel, commonDir: l.commonDir } : null; }`.
- Call `reads.invalidate()` immediately before `const endGit = ...`, then `endGit = reads.treeState(process.cwd())`. A comment says why: suites, retries, adjudication and impact fetches all ran since the start read.
- `report.js`'s `gitInfo`, `gitDir` and `dirtyFilePaths` stay exported and unchanged. `dirtyFilePaths()` calls in `verify.js` stay as they are: they ask a different question (`-z --untracked-files=all`) and are never repeated with nothing in between.

- [ ] **Step 1: Write the failing pin test** in `tests/bin-lib/verify/cli.test.js`, named `AC2.1: a whole-suite run around a no-op suite makes exactly 4 git calls`. Build a clean committed fixture repo with the existing `cli-helpers.js` builders, with no `.claude-tweaks/verify-scope.json`. Spawn `process.execPath --require <git-call-recorder> <verify.js> --cmd tests="node -e 0" --no-stamp` there, with env `{ ...process.env, CT_TEST_SUITE_SLOT_HELD: '1', CT_TEST_GIT_CALL_LOG: <fresh temp dir> }`, a spawn `timeout` and `killSignal: 'SIGKILL'`. Assert exit 0. Assert the recorded git args, in order, deep-equal: `[combined rev-parse]`, `[--no-optional-locks, status, --porcelain]`, `[combined rev-parse]`, `[--no-optional-locks, status, --porcelain]`. Assert there are 4 of them. Comment: today the same run makes 6 (`--git-dir`, `--show-toplevel`, `HEAD` + `status` at the start, `HEAD` + `status` at the end).
- [ ] **Step 2: Write the failing freshness test** in `tests/bin-lib/verify/cli.test.js`, named `AC3.1: a tree change made while the suites run is seen by the read after them`. Fixture: a clean committed repo. Run 1: suite `node -e "require('fs').writeFileSync('made-by-suite.txt','x')"`. Assert `report.json` `dirty === true` and that no pass stamp was written (`--stamp-status` reads `present: false`). Run 2, in a fresh fixture: the suite commits a file (`git add` + `git commit` through `node -e` with `execFileSync`, `windowsHide: true`). Assert no pass stamp was written. Assert `report.json`'s `sha` is the start sha, not the new HEAD.
- [ ] **Step 3: Write the `resolveBase` option tests** in `tests/bin-lib/verify/changed-files.test.js` with the file's existing fake-exec style. `resolveBase uses a passed head instead of asking`: `requireNonDegenerate` + `integrationBranch` + `head:'abc'` makes no `rev-parse --verify HEAD` call. `resolveBase uses a passed anchor instead of re-deriving it`: `anchor: 'abc'` makes no `merge-base --is-ancestor` call and returns `'abc'`.
- [ ] **Step 4: Run** `node --test tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/changed-files.test.js`. Expected: the AC2.1 test FAILs with 6 calls. The AC3.1 test PASSes already: it pins today's behavior and must stay green after the change. The two `resolveBase` tests FAIL.
- [ ] **Step 5: Implement the wiring above** and the two `resolveBase` options.
- [ ] **Step 6: Run** the two files again. Expected: PASS.
- [ ] **Step 7: Prove the pin goes red (AC2.2).** Temporarily replace `startGit = reads.treeState(process.cwd())` with `startGit = gitInfo()`, which restores the start `rev-parse HEAD` repeat. Re-run the AC2.1 test and save its full output to `$PIPELINE_RUN_DIR/evidence/pin-red.txt` (absolute path, `mkdir -p` first, plain Bash redirect). Revert the change and confirm green. The PR body quotes the red assertion lines (AC2.3, written in Task 5 Step 4). Then do the same with `reads.invalidate()` deleted: the AC3.1 test must go red. Save that output to `$PIPELINE_RUN_DIR/evidence/freshness-red.txt` and revert.
- [ ] **Step 8: Run all verify tests** under the runner: `node tools/run-tests.js --files-from <list of every tests/bin-lib/verify/*.test.js file>`. Expected: PASS. Where a test stubbed git by argv shape and now sees the combined call, update only the stubbed shape, keeping every assertion. List each such edit in the task reply.
- [ ] **Step 9: Commit**: `Route verify.js git reads through git-reads — one rev-parse per directory, tree state re-read after the suites, refs #5773`.

### Task 4: Baseline and remaining trace repeats
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/verify/baseline.js` (`realGit` ~L46-126 gains an optional `locations` provider)
- Modify: `plugin/bin/verify.js` (the `realGit(...)` construction ~L528 and the `adjudicate` call sites ~L1101-1130)
- Test: `tests/bin-lib/verify/baseline.test.js`

Waived `plugin/bin/lib/verify/impact.js`: the spec's "reuse the toplevel and common-dir answers" is met through `checkoutImpactContext`'s existing `locate` parameter (Task 3). `gitLocations` stays as it is for `tools/test-impact.js`. Task 1 Step 6's trace reads this file's calls.

**Interfaces:**
- Consumes: `GitReads.locations`, `GitReads.invalidate` (Task 2).
- Produces: `realGit(cwd, { ..., locations = null })`. When `locations` is a function `(cwd) -> { toplevel, commonDir }`, `repoRoot()` returns `locations(cwd).toplevel` (throwing `new Error('not a git work tree')` when it is null, as the git call would), and `slotWorktree` takes `commonDir` from it instead of its own `rev-parse --git-common-dir`. It applies `canonicalRealpath` to the provider's `commonDir` exactly as it does to git's output today (`baseline.js:93`), and returns `{ reason: 'no-common-dir' }` when that is null, so `slotScratchPath`'s repo key stays byte-identical to the previous release's. Without the option, today's behavior is unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/verify/baseline.test.js`. `realGit with a locations provider asks it, not git, for the repo root`: a provider returning `{ toplevel: dir, commonDir: ... }` against a real temp repo makes `repoRoot()` equal `dir`, and the provider is called. `realGit without a provider keeps asking git`: `repoRoot()` equals `git rev-parse --show-toplevel` output. `realGit slotWorktree canonicalizes a provider commonDir`: a provider returning a symlinked spelling of the repo's common dir (a symlink to the temp repo) yields the same `slotScratchPath` as the no-provider path. Add a `verify.js` CLI test, `the baseline adjudication re-reads the repo root after the suites and reuses it for the slot`. Use an existing `cli-baseline*.test.js` failing-check fixture pattern (imported, never edited in `cli-helpers.js`) with the recorder preload. Assert that the combined rev-parse appears exactly once between the last suite `spawn` event and the first `worktree add`, that no `rev-parse --git-common-dir` or `rev-parse --show-toplevel` call appears in that span, and that a combined rev-parse follows the `worktree remove` (the end read). This is Review Focus 5.
- [ ] **Step 2: Run** the tests. Expected: the provider test FAILs. The CLI test FAILs only if the wiring is missing: write it to pin the post-change shape.
- [ ] **Step 3: Implement.** In `verify.js`, construct `bgit = realGit(cwd, { locations: (d) => reads.locations(d) })`. Call `reads.invalidate()` immediately before and after the one `adjudicate(...)` call, with a comment naming the suites, the worktree add/remove and the reruns as the mutations. Also remove each `NEW REPEAT` the controller added from Task 1 Step 6 the same way: a precomputed value passed through an optional parameter, valid only where no spawn lies between the two reads, each with a red-proven test.
- [ ] **Step 4: Run** `node tools/run-tests.js --files-from <list of every tests/bin-lib/verify/*.test.js file>`. Expected: PASS.
- [ ] **Step 5: Commit**: `Reuse invocation git answers in baseline adjudication — re-read after each worktree add and remove, refs #5773`.

### Task 5: After trace and process counts (AC1, AC4, AC5)

**Files:** none committed. Evidence goes to the run dir, numbers go to the PR body.

- [ ] **Step 1: After trace (AC1.1).** Re-run Task 1 Step 5's collection and analyzer at HEAD and save the result to `$PIPELINE_RUN_DIR/evidence/trace-after.txt`. Every remaining `repeat` row must be `repeat after spawn: <cmd>` (allowed: say what may have changed) or be named with its reason. Any remaining `repeat, nothing between` row is a failure: report it, don't paper over it.
- [ ] **Step 2: Before/after git process counts (AC4.1, AC4.2, AC5.1).** Get the merge-base with `git merge-base HEAD origin/main` (its own call). Extract it with `git archive <merge-base> | tar -x -C <scratch>/base`. The extract needs `git init` plus one snapshot commit for tests that read git: use the `.claude-tweaks/` memory recipe "an oracle suite in an extract needs git init + a plumbing snapshot commit". Then run, back to back on this machine, base first:
  `CT_TEST_CONCURRENCY=6 GIT_TRACE2_EVENT=<abs empty dir A> node tools/run-tests.js --files-from <list of the five files>` in the extract, and the same with `<abs empty dir B>` in the worktree. Count one trace2 file per git process (`ls <dir> | wc -l`) and the per-test-file pass counts. Save both runs' output and counts to `$PIPELINE_RUN_DIR/evidence/git-process-counts.txt`. Target: after is at most 3,571. If it is above, name the shortfall and attribute it per file and per call shape from the trace. Never trade a stale-read risk for the number.
- [ ] **Step 3: Log the AC evidence.** Write one `decisions.md` entry per AC (AC1, AC2.2, AC3, AC4/AC5) with `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.170.0/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "<text file>"`. Each text file holds one line written with the Write tool: the AC id, the command shape, the counts and the evidence path.
- [ ] **Step 4: PR body.** Add a `### Measurements` section to PR #5826 above the fixes block. Include the per-mode trace table (before → after git calls per invocation, repeats and what lies between), the five files' git process counts before/after with the merge-base sha and the per-file test counts, the AC2.2 red output quote, and the literal-vs-aim notes the record's Decision paragraph asks for. Those notes name at least three things. (a) AC2's "through the injectable exec seam" is met by a `--require` preload that wraps `child_process` in the spawned CLI, because `verify.js` runs `main()` at load and has no in-process seam. It counts the whole process. (b) Deliverable 2's "read once per invocation" is met per tree-state epoch. The combined rev-parse re-runs after the suites (and around adjudication), each a named repeat with the spawns between, and costs the same one process the bare `rev-parse HEAD` it replaces did. (c) git's `fatal:` stderr line on an unborn HEAD is no longer printed (the combined call pipes stderr and passes `-q`). Keep the session link `https://claude.ai/code/session_01CcCLFrS3o4arCVCisWXHpW` as the last line.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (trace per mode) | 1 (before), 5 (after) |
| Deliverable 2 (remove repeats) | 2, 3, 4 |
| Deliverable 3 (per-process memo, keyed, invalidated) | 2, 3, 4 |
| Deliverable 4 (seams keep working, stubs updated) | 3 Step 8, 4 Step 4 |
| Deliverable 5 (PR body counts) | 5 |
| AC1.1 | 5 Step 1 |
| AC2.1, AC2.2 | 3 Steps 1, 7 |
| AC2.3 | 3 Step 7 (red output saved), 5 Step 4 (quoted in PR body) |
| AC3.1 | 3 Step 2 |
| AC4.1, AC4.2, AC5.1 | 5 Step 2 |
| AC6.1 | 3 Step 8, 4 Step 4 |
| AC7.1 | full suite + Windows regression job at /build Common Step 5 and the PR's CI |

Proof(stale-tree-read): Task 2's `invalidate makes the next read ask git again` and Task 3's AC3.1 freshness test, each proven red with the invalidation removed (Task 3 Step 7).
