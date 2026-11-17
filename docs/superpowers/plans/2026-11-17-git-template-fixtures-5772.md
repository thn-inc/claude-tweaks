# Git-template fixtures for statusline, archive-merged and stack-check (#5772) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the git processes spent building fixture repos in four heavy test files. Fixed-shape builders come from `tests/helpers/git-template.js` (`fromTemplate`/`fromTemplateSet`), and per-test builders stop spawning `git config`.

**Architecture:** Each builder whose output is fixed (or fixed per argument set) becomes a `fromTemplate`/`fromTemplateSet` call. The key is the builder's name plus its arguments, so the first call in a process builds and every later call is an `fs.cpSync` copy with no git process. A builder whose content differs per test starts from a template copy, or gets its identity from `-c`/the config file, so it spawns no `git config`. Builders the spawn tests must reach move into fixture modules (the #5769 pattern: `tests/bin-lib/issues/claims-git-cas-fixtures.js`), and the spawn tests append to `tests/helpers-git-template.test.js`.

**Tech Stack:** Node 18+, `node:test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-11-17T005046-record-5772/work/5772-spec.md` (record #5772)

## Global Constraints

- Return shapes, directory prefixes and the commit identity stay the same (Deliverable 1).
- "Same tests" means no existing test is deleted, skipped, renamed, merged or loosened. A test count may grow by tests this record adds (the record's Decision paragraph). Test concurrency stays as it is. No assertion is removed or weakened.
- Edits to `tests/helpers-git-template.test.js` are additive only. Append a new block at the end of the file, headed `// #5772:`, and never reorder or rewrite existing tests. Two open PRs (#5784, #5809) also change this file.
- Code that the record's text (`Probed 2026-11-16`) says belongs to the code under test stays as it is: `remote get-url origin` and `worktree list --porcelain` in `archive-merged-record-guards.test.js` come from `archiveMerged` itself, and the `apply` calls in stack-check come from `checkStack`/`rederive`.
- Governing rule, `windows-checkout-test-parity` (quoted verbatim): "| Rewriting a file git created inside a copied or linked worktree (its `.git` pointer file) with `fs.writeFileSync` | Git for Windows marks `.git` hidden (`core.hideDotFiles=dotGitOnly`), `fs.cpSync` keeps the attribute, and recreating a hidden file fails with `EPERM` on win32 only. Open the existing file `r+`, `ftruncateSync` it to 0, then `writeSync` (`writeInPlace` in `tests/helpers/git-template.js`, #5297, proven by `windows-regression` run 43361861892) |"
- Governing rule, `windows-checkout-test-parity` (quoted verbatim): "| Hard-coding a POSIX `file:///Users/…` literal as the expected output of a `pathToFileURL(dir).href` link | On win32, `pathToFileURL` resolves a POSIX-style fixture path against the current drive, so production correctly prints `file:///D:/Users/…` and the literal fails on Windows only (`tests/statusline.test.js`'s two `renderProject` link tests, #3886). Derive the expected link from `pathToFileURL` itself (the file's `linkedName(dir)`) instead of a `process.platform` branch holding two literals, and keep each test's own point as a separate literal check that does not depend on the derivation (`Code%20Workspaces`, a `/` before the BEL) |"
- Governing rule, `git-ground-truth-test-env` (quoted verbatim): "1. **A reader call in a test passes an explicit env.** Build it from `process.env` minus the variables the reader keys on. `READER_ENV` in `tests/statusline.test.js` drops every `GIT_CONFIG*` name; a test of the deferral then passes exactly the variable it is about (`assertFallbackOrigin(dir, { GIT_CONFIG_GLOBAL: '/dev/null' })`)." and "2. **A git child that supplies ground truth about refusal or trust runs hermetic.** Set `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL` to the null device, as `DIFFERENT_OWNER_ENV` in `tests/statusline.test.js` does, so a host `safe.directory` entry cannot change the answer." These envs and reader calls are code under test and stay unchanged.
- Other governing skills that name these files (`merge-shape-landed-proof`, `parse-signal-discipline`, `pre-tool-use-gate-exemptions`, `removal-condition-execution`, `prose-code-twin-pin`) name `plugin/bin/lib/reconcile/archive-merged.js`, which this plan does not touch. None applies.
- `stack-check.js`'s `gitEnv()` drops env-carried config on purpose, so the template build's `withMaintenanceOff` cannot reach git spawned under `FIXTURE_ENV`. The repo's own `.git/config` must carry `maintenance.auto = false` and `gc.auto = 0` (Deliverable 3).
- A bare origin that a fixture pushes into gets `disableReceiveAutoGc(bareDir)` (`git-template.js`): receive-pack strips `GIT_CONFIG_*`.

## Review Focus

1. **A template path survives into a file a test reads but the rewrite does not visit.** `rewriteTemplatePaths` edits only `.git` config, `gitdir` and `.git` pointer files. `withWorktrees` writes `.gitmodules` (absolute `innerUrl`) into the working tree, and a symlink copied with `verbatimSymlinks` still points into the template. Expected: every copy is self-contained. Task 5 recreates the symlink per copy and checks `.gitmodules`.
2. **Two copies of one template share a commit SHA.** A test that built two repos and relied on their histories differing (a SHA inequality, "not an ancestor") now gets identical commits. Expected: each such test still passes for its original reason. Each task's verification compares test names and pass status against the baseline.
3. **Realpath versus raw tmpdir path.** `mergedFeatureBranchRepo`, `fixtureAbandonedShippedRun` and `cloneOfSeededOrigin` return a `realpathSync` root, and `makeRepo` does not. Expected: unchanged. Use the `realpath: true` layout option exactly where the old builder realpath'd.
4. **A fixture mutated after creation** (a worktree's `.git` pointer overwritten, a run-dir backdated) must mutate only its copy. The template must never be handed out directly: always `fromTemplate*`, never the template dir.
5. **mtime-sensitive tests** (`mkDirWithMtime`, the structurally-stuck TTL, worktree ordering by mtime). Copies get fresh mtimes (`preserveTimestamps: false`). Any backdating stays after the copy, never inside a template build.

---

## Shared verification commands

- Per file, test names against the baseline: run the file with `node --test {file} > {log} 2>&1`, then run the scratch name-comparison helper `test-names.js {log} baseline-names-{basename}.txt`. The helper and the baselines were taken at the merge base from the runner's own output; their absolute paths are in the dispatch brief, and none of them is committed. Expected: exit 0, `missing 0`, each listed name `✔` (AC5.1, AC5.2).
- Spawn tests: `node --test tests/helpers-git-template.test.js`. Expected: all pass (AC3.1).

### Task 1: stack-check fixtures on templates, maintenance off in repo config

**Files:**
- Create: `tests/bin-lib/staged-patch/stack-check-fixtures.js`
- Modify: `tests/bin-lib/staged-patch/stack-check.test.js` (`gitFixture` at :20-36, `repoWith` at :408-416, their call sites)
- Test: `tests/helpers-git-template.test.js` (append)

**Interfaces:**
- Produces: `stack-check-fixtures.js` exports `gitFixture(t, content = BASE) -> { dir, git, runOk }`, `repoWith(t, files) -> { dir, git, runOk }`, `BASE`, `FIXTURE_ENV`. The return shapes are byte-identical to today's, with `dir` under `os.tmpdir()` and prefix `stack-check-`. `t` may be `null`, and then no `t.after` cleanup is registered (the spawn tests call it that way and push `dir` to their own scratch list).

- [ ] **Step 1: Write the failing spawn tests (append to `tests/helpers-git-template.test.js`)**

```js
// #5772: stack-check, statusline and archive-merged builders — same shape as above.
const stackFixtures = require('./bin-lib/staged-patch/stack-check-fixtures');
for (const [name, make] of [
  ['stack-check gitFixture(BASE)', () => stackFixtures.gitFixture(null)],
  ['stack-check gitFixture(Latin-1 bytes)', () => stackFixtures.gitFixture(null, Buffer.from('caf\xe9\n', 'latin1'))],
  ['stack-check repoWith(files)', () => stackFixtures.repoWith(null, { 'g.txt': 'one\n', 'bin.dat': Buffer.from([0, 1, 255]) })],
]) {
  test(`AC3.1: ${name}: a second call starts no git process`, () => {
    scratch.push(make().dir);
    const trace = mk('ct-gt-trace-');
    const second = withEnv('GIT_TRACE2_EVENT', trace, make);
    scratch.push(second.dir);
    assert.deepStrictEqual(fs.readdirSync(trace), []);
  });
}

test('AC4.1: a stack-check fixture copy carries maintenance.auto=false and gc.auto=0 in its own config', () => {
  const fx = stackFixtures.gitFixture(null);
  scratch.push(fx.dir);
  assert.strictEqual(fx.git('config', '--local', 'maintenance.auto').stdout.trim(), 'false');
  assert.strictEqual(fx.git('config', '--local', 'gc.auto').stdout.trim(), '0');
  assert.strictEqual(fx.git('config', '--local', 'user.email').stdout.trim(), 'stack-check@example.invalid');
});
```

- [ ] **Step 2: Run it and confirm it fails.** `node --test tests/helpers-git-template.test.js`. Expected: FAIL with `Cannot find module './bin-lib/staged-patch/stack-check-fixtures'`.

- [ ] **Step 3: Implement `stack-check-fixtures.js`.** Move `gitFixture`/`repoWith`/`BASE`/`FIXTURE_ENV` out of the test file and import them back there. Build through `fromTemplate`. The `gitFixture` key is `stack-check:gitFixture:` plus the sha1 of the content bytes. The `repoWith` key is `stack-check:repoWith:` plus the sha1 of a stable serialization of `files` (sorted names, Buffers as base64). Prefix `stack-check-`. The template build runs under `FIXTURE_ENV`: `init -q`, then an `fs.appendFileSync` to `.git/config` of `[user] email/name` (the same values as today), `[maintenance] auto = false` and `[gc] auto = 0`. No `git config` process. Then `add` and `commit` exactly as today (`repoWith` keeps its second `--allow-empty` commit). Rebuild `git`/`runOk` around the copy's `dir`.

- [ ] **Step 4: Run and confirm it passes.** Run the spawn tests (all pass), then run `node --test tests/bin-lib/staged-patch/stack-check.test.js` and compare its names against `baseline-names-stack-check.test.js.txt` (missing 0, 43 tests, all ✔).

- [ ] **Step 5: Commit.** Stage the three files by explicit path. Message: `Template stack-check fixtures and turn maintenance off in their config — refs #5772`, with the `Claude-Session:` trailer.

### Task 2: archive-merged shared builders on templates

**Files:**
- Modify: `tests/bin-lib/reconcile/archive-merged-helpers.js` (`makeRepo` :27-36, `mergedFeatureBranchRepo` :115-126, `fixtureAbandonedShippedRun` :162-193)
- Modify: `tests/bin-lib/reconcile/archive-merged.test.js` (move `cloneOfSeededOrigin` :3224-3239 into the helpers and import it back)
- Test: `tests/helpers-git-template.test.js` (append to the `#5772` block)

**Interfaces:**
- Produces, from `archive-merged-helpers.js`, with unchanged signatures and returns: `makeRepo() -> dir` (non-realpath, prefix `archive-merged-`); `mergedFeatureBranchRepo(branch) -> { root, featureSha }` (realpath root); `fixtureAbandonedShippedRun({ runId, ownerSessionId, extraEventLines }) -> { root, wt, runDir }`; and new `cloneOfSeededOrigin() -> { seed, root }` (root realpath).
- Consumers: `archive-merged.test.js`, `archive-merged-record-guards.test.js`, `tests/bin-lib/hooks/reconcile-background.test.js`. Their behavior must not change.

- [ ] **Step 1: Append failing spawn tests** for `makeRepo()`, `mergedFeatureBranchRepo('feat-x')`, `fixtureAbandonedShippedRun({ runId: '2026-08-01T090000-record-1' })` and `cloneOfSeededOrigin()`. Each is the same warm-up-then-traced-call shape as Task 1, named `AC3.1: archive-merged {builder}: a second call starts no git process`. The traced call covers only the builder: `fixtureAbandonedShippedRun` writes its run dir with fs, which spawns nothing. Also add `test('mergedFeatureBranchRepo copy: feature tip is an ancestor of main and the branch ref exists')`, which asserts `git merge-base --is-ancestor {featureSha} main` exits 0 and `rev-parse feat-x` equals `featureSha` in a second copy.
- [ ] **Step 2: Run it and confirm it fails.** The traced trace dir is non-empty, or `cloneOfSeededOrigin` is not exported.
- [ ] **Step 3: Implement.** `makeRepo` uses `fromTemplate('archive-merged:makeRepo', …, { prefix: 'archive-merged-' })`. `mergedFeatureBranchRepo(branch)` uses `fromTemplate` keyed by branch with `realpath: true`. The template build makes the worktree in a sibling temp dir, then removes it exactly as today. `fixtureAbandonedShippedRun` templates its repo part (with the pinned `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`). After the copy, it mints `wt` per call as a fresh `fs.mkdtempSync(… 'archive-merged-wt-')` that it then removes, so the stamped path is unique and absent as before. Then it writes `policy.yml` and the run dir with fs. `cloneOfSeededOrigin` uses `fromTemplateSet` with layout `{ origin, seed, clone }` and prefixes `archive-merged-origin-`/`-seed-`/`-clone-`, with `realpath: true` on `clone`. It calls `disableReceiveAutoGc(origin)` in the build and returns `{ seed, root: clone }`. Template builds set identity with the build's own `git config` (it runs once per process).
- [ ] **Step 4: Run and confirm it passes.** Run the spawn tests, then both archive-merged files and `tests/bin-lib/hooks/reconcile-background.test.js`. Compare names against the baselines (missing 0, all ✔). `reconcile-background` must pass.
- [ ] **Step 5: Commit**, message `Template archive-merged shared repo builders — refs #5772`.

### Task 3: archive-merged.test.js per-test builders

**Files:**
- Modify: `tests/bin-lib/reconcile/archive-merged.test.js` (the repo construction sites `grep -n "'init'\|'clone'\|'worktree', 'add'\|makeRepo()"` lists, plus `headerMergedRepo3976` :4104, `fixtureAbandonedBehindOrigin` :3304, `timingFixture` :3848, `interruptedRun` :67, `seedRecreatedRun` :460, `mkAdHocRunDir` :1760)

**Interfaces:**
- Consumes: Task 2's exports.

- [ ] **Step 1: Inventory.** For each construction site, record in your report whether its git setup is fixed (or fixed per argument) or differs per test. Read each test's assertions before deciding.
- [ ] **Step 2: Convert.** Move a fixed setup (identical across the tests that share it) into a local `fromTemplate`/`fromTemplateSet` builder keyed by its arguments, with prefixes unchanged. A per-test setup starts from `makeRepo()`/`cloneOfSeededOrigin()` (already configured) instead of `init` plus `config`. Where it must init its own repo, it passes identity as `-c user.email=t@t -c user.name=t` on the commit, or appends `[user]` to `.git/config`, so no `git config` process remains. Leave in place every git call a test makes to exercise or observe the code under test. Any new bare origin that receives a push gets `disableReceiveAutoGc`.
- [ ] **Step 3: Verify.** Run `node --test tests/bin-lib/reconcile/archive-merged.test.js` and compare names against the baseline (missing 0, 175, all ✔). Then run `git grep -n "'config', 'user\." -- tests/bin-lib/reconcile/archive-merged.test.js`: expect hits only inside template build callbacks.
- [ ] **Step 4: Commit**, message `Template archive-merged.test.js per-test repos — refs #5772`.

### Task 4: archive-merged-record-guards.test.js per-test builders

**Files:**
- Modify: `tests/bin-lib/reconcile/archive-merged-record-guards.test.js` (construction sites per the same grep; `multiRunWorktreeFixture` :2253, `ordinaryMergedRunFixture` :2077, `fixtureByNumberMergedRecordRun` :424, `fixtureReusedBranchLiveRun` :831, `makeShell` :1279, `ownerlessFixture` :2313)

**Interfaces:**
- Consumes: Task 2's exports.

- [ ] **Step 1: Inventory**, as in Task 3. Remember that the `remote get-url origin`/`worktree list --porcelain` calls are archiveMerged's own and stay.
- [ ] **Step 2: Convert**, applying Task 3 Step 2's rules. A repo-plus-linked-worktree set with a fixed shape comes from one `fromTemplateSet` layout. A worktree added to an arbitrary per-test repo stays a real `git worktree add` (Deliverable 4). The `worktreeListSpawns` assertions count archiveMerged's own spawns, so their numbers must not change.
- [ ] **Step 3: Verify**: names against the baseline (missing 0, 160, all ✔), and the same `'config', 'user.` grep.
- [ ] **Step 4: Commit**, message `Template archive-merged-record-guards per-test repos — refs #5772`.

### Task 5: statusline fixtures on templates

**Files:**
- Create: `tests/helpers/statusline-fixtures.js`
- Modify: `tests/statusline.test.js` (the inline repo at :71-98, `makeCommittedRepo` :101, `withRepo` :317, the linked-worktree test :358-388, `withWorktrees` :411-453, and the remaining construction sites `grep -n "'init'\|'worktree', 'add'"` lists around :2130-2340)
- Test: `tests/helpers-git-template.test.js` (append to the `#5772` block)

**Interfaces:**
- Produces: `statusline-fixtures.js` exports `committedRepo({ branch = 'main' } = {}) -> repoDir` (prefix `ct-git-`, `file.txt` = `hello\n`, identity `test@example.com`/`Test`); `repoWithOrigin(remoteUrl) -> { base, repoDir }` (`base` prefix `ct-sl-repo-`, `repoDir` = `base/glyph-project`, `README.md` = `hi`, `origin` only when `remoteUrl` is truthy); `worktreeShapes() -> { base, main, wt, relWt, sub, link }` (prefix `ct-sl-shapes-`, the same layout `withWorktrees` documents at :405-410). `makeCommittedRepo`, `withRepo` and `withWorktrees` in the test file become thin wrappers over these, keeping their signatures and their `finally` cleanup. Cleanup is `fs.rmSync(base)` alone: the `git worktree remove` calls go, since a copy has no registration outside its own base.

- [ ] **Step 1: Append failing spawn tests** for `committedRepo()`, `committedRepo({ branch: 'feature/isolated-branch' })`, `repoWithOrigin('git@github.com:owner/repo.git')`, `repoWithOrigin(null)` and `worktreeShapes()`, named `AC3.1: statusline {builder}: a second call starts no git process`. Also add `test('worktreeShapes copy: link points at this copy\'s wt, and wt and sub resolve inside this copy')`. It asserts that `fs.realpathSync(link) === fs.realpathSync(wt)` when `link` is non-null, and that `git rev-parse --git-common-dir` from `wt` resolves under `fs.realpathSync(base)`. When `.gitmodules` exists, it asserts the file holds no path outside `base`.
- [ ] **Step 2: Run it and confirm it fails** (module not found).
- [ ] **Step 3: Implement.** Template keys are `statusline:committed:{branch}`, `statusline:withRepo:{remoteUrl ?? ''}` and `statusline:shapes`. `worktreeShapes` builds `main`, `inner`, `abs-wt`, `rel-main` and `rel-wt` (null when `--relative-paths` is unsupported, recorded in the template), plus the submodule, in the template. It does not build the symlink: each copy calls `trySymlink(wt, link-wt)` after the copy (move `trySymlink` into the module and export it). After the copy, it rewrites the submodule URL in the copy's `main/.gitmodules`, replacing the template's forward-slash inner path with the copy's own inner path. Do this only if `.gitmodules` holds it; the template's inner repo must not be reachable from a copy. Keep the inline `renderGit` test's `realBranch` check against `process.cwd()`, which is code under test. The `READER_ENV`/`DIFFERENT_OWNER_ENV` calls stay unchanged.
- [ ] **Step 4: Verify.** Run the spawn tests, then `node --test tests/statusline.test.js` and compare names against the baseline (missing 0, 204, all ✔). Then run `git grep -n "'config', 'user\." -- tests/statusline.test.js`: expect only template build callbacks, or none.
- [ ] **Step 5: Commit**, message `Template statusline fixtures — refs #5772`.

### Task 6: Before/after git process measurement (orchestrator, not an implementer)

- [ ] **Step 1:** At the merge base (`git merge-base HEAD origin/main`, in a detached worktree or archive extract that has the merge base's `tests/`), run the scratch trace2 measurer (not committed). It runs the same `CT_TEST_CONCURRENCY=6`, `GIT_TRACE2_EVENT=<empty dir>`, `node tools/run-tests.js --files-from <list>` per file). Run it at HEAD right after, on the same machine (AC2.1).
- [ ] **Step 2:** Check that the total at HEAD is at most 3,640 (AC1.1, AC1.2) and that each file's test count equals the baseline (AC5.1, AC5.2). Check that stack-check's `maintenance` count is 0 (AC4.1).
- [ ] **Step 3:** Put a table in the PR body: per file, before/after processes, the per-subcommand split, and the test counts. Attribute any shortfall against 3,640 to fixture setup or to git run by the code under test (Deliverable 6, AC1.1, AC1.2). Note that #5784's runner-wide git template would also cover stack-check's maintenance if it merges first.
- [ ] **Step 4:** AC6.1 (the full suite and the Windows regression job) is proven by `/claude-tweaks:test`'s full verify and by the PR's CI, after the last code change.
