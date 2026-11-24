# Template the Remaining Per-Test Fixture Builders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the fixed repo-plus-linked-worktree pairs used by `tests/hooks-pre-tool-use.test.js` and the `scopedRepo` / `flakyRepo` / `baselineRepo` builders in `tests/bin-lib/verify/cli-helpers.js` onto `tests/helpers/git-template.js`, so that after one warm-up call no git process starts. Then measure sets A and B before and after.

**Architecture:** Each fixed fixture becomes a `fromTemplate` / `fromTemplateSet` call whose `build` does all the git work once per process. Per-call values that used to come from a git process (branch name, base sha) are read from the copy's `.git` files with `fs`, or computed once in the build and cached in a module-level `Map` keyed by the template key. A pair built against an arbitrary per-test repo (one the test changed before adding the worktree) stays a real `git worktree add`.

**Tech Stack:** Node 18+ `node:test`, git CLI, `tests/helpers/git-template.js` (`fromTemplate`, `fromTemplateSet`).

**Spec:** `.claude-tweaks/pipelines/2026-11-16T232305-record-5324/work/5324-spec.md`

| AC clause | Covered by |
|---|---|
| AC1.1, AC1.2 | Task 1 Step 1, Task 2 Step 1 (trace2 second-call tests) |
| AC2.1 | Task 3 Steps 1-2 (measured totals vs 3,695) |
| AC2.2 | Task 3 Step 2 (shortfall attribution, also put in the PR body) |
| AC3.1 | Waived below (pipeline verification + Windows CI) |

## Global Constraints

- Owned files (record #5324's split; no sibling edits them): `tests/hooks-pre-tool-use.test.js`, `tests/hooks-pre-tool-use-forge-memo.test.js`, `tests/bin-lib/verify/cli-helpers.js`. Also touched: `tests/helpers/pre-tool-use.js` (the fixture module both pre-tool-use test files share) and `tests/helpers-git-template.test.js`. Edits to `tests/helpers-git-template.test.js` must be **additive only**: insert one new block of new lines and change no existing line, because open sibling PRs #5784 and #5780 also edit that file. Do not edit `tests/helpers/git-template.js`, `tools/run-tests.js` or any file another record of the family owns (#5767-#5773).
- Decision (record author, 2026-11-16): "Same tests" means no existing test is deleted, skipped, renamed, merged or loosened. A test count may grow by tests this record adds. Test concurrency is unchanged.
- No fixture in the owned files starts a `git config user.name` or `git config user.email` process. Write the identity into `.git/config` with `fs` in the template build. #5771 has not merged, so its helper and scan-test allowlist are not touched.
- Commits end with the trailer `Claude-Session: https://claude.ai/code/session_01CcCLFrS3o4arCVCisWXHpW`, and their subjects say `refs #5324`, never `closes` or `fixes`.
- Never use `sleep` to wait, and never `git stash`.
- Quoted from `.claude/skills/skill-prose-conformance-tests/advanced-proof-patterns.md`: "The template is cached by `key` alone, so `build` must not read per-test arguments; give each variant its own key, as `gitRepo` keys on `branch`."
- Quoted from `.claude/skills/windows-checkout-test-parity/SKILL.md`: "Rewriting a file git created inside a copied or linked worktree (its `.git` pointer file) with `fs.writeFileSync` | Git for Windows marks `.git` hidden (`core.hideDotFiles=dotGitOnly`), `fs.cpSync` keeps the attribute, and recreating a hidden file fails with `EPERM` on win32 only." Never rewrite a copied `.git` file yourself, since `fromTemplateSet` already does it. Read `.git/HEAD` and ref files with `fs.readFileSync` only.
- Quoted from the same skill: "Build the command with `nodeCmd(script, ...args)` (now in `tests/bin-lib/verify/cli-helpers.js`)". `scopedRepo`'s `unitCmd` keeps `nodeCmd` and is computed per copy, because it embeds the copy's marker path.

## Review Focus

1. A second `linkedWorktreeOf(main)` on a copied main (tests at ~161, ~188, ~1735) must create a working second worktree. Pinned in Task 1 (`second worktree on a copied pair`).
2. Two calls with different arguments must never share a template. `scopedRepo(rulesA)` and `scopedRepo(rulesB)` hold different declarations. Pinned in Task 2.
3. A per-call value read with `fs` must equal what git reports: `scopedRepo().branch` vs `git symbolic-ref`, and `baselineRepo().baseSha` vs `git rev-parse HEAD`. Pinned in Task 2.
4. Copies of the local-main variant must be on branch `main`. Pinned in Task 1.
5. The copied linked worktree must resolve to the copy's own main. `git -C wt rev-parse --git-common-dir` must resolve under `main/.git`, never the template's. Pinned in Task 1.

---

### Task 1: Template the pre-tool-use fixed pairs

**Role:** integration

**Files:**
- Modify: `tests/helpers/pre-tool-use.js`
- Modify: `tests/hooks-pre-tool-use.test.js` (`mainAndWorktree` ~51; `repoOnLocalMain` ~1222; pair sites ~247-250, ~277-279, ~1162-1163, ~1178-1179, ~1192-1193, ~1238-1239, ~1308-1309, ~1316-1317, ~1340-1341, ~1348-1349, ~1362-1363)
- Modify: `tests/hooks-pre-tool-use-forge-memo.test.js` (no change expected: it builds no linked-worktree pair. It benefits through `unpinnedRepoWithOrigin`. Confirm with grep, and leave it untouched if so.)
- Test: `tests/helpers-git-template.test.js` (one new block inserted right after the existing `builders` loop that ends near line 288)

**Interfaces:**
- Produces, in `tests/helpers/pre-tool-use.js`:
  - `mainAndWorktree({ localMain = false } = {}) -> { main: string, wt: string }`. Template key `pre-tool-use:main-wt` or `pre-tool-use:main-wt:local-main`. Layout `{ main: { prefix: 'ct-e1-', realpath: true }, wtparent: { prefix: 'ct-e1-wtparent-', realpath: true } }`, with `wt = path.join(wtparent, 'wt')`. Build: `init -q`, `commit --allow-empty -m init -q`, and for `localMain` also `branch -M main`. Then `git -C main worktree add -q <wtparent>/wt -b wt-branch-ct-e1-wtparent-template`.
  - `gitRepoOnLocalMain() -> string`. Template key `pre-tool-use:init-commit-main`: the same as `gitRepoWithCommit` plus `branch -M main`, with prefix `ct-e1-` and `realpath: true`.
  - `unpinnedRepoWithOrigin()`, now a template (key `pre-tool-use:unpinned-origin`) whose build adds the `https://github.com/o/n.git` origin. The return value is unchanged.
- The test file's local `mainAndWorktree()` is removed and the helper is imported instead. `repoOnLocalMain()` becomes a call to `gitRepoOnLocalMain()`, and the local function goes. `linkedWorktreeOf` in the test file stays exactly as it is, for arbitrary per-test repos.

Site rules:
- A `gitRepoWithCommit()` or `repoOnLocalMain()` immediately followed by `linkedWorktreeOf(main)`, with nothing between that changes `main`, becomes `mainAndWorktree()` or `mainAndWorktree({ localMain: true })`. Keep the original variable names by destructuring: `const { main, wt: ownWt } = mainAndWorktree();`. Any further `linkedWorktreeOf(main)` lines after it stay.
- Anything that commits, writes a policy or renames a branch on `main` before the worktree is added stays a real `linkedWorktreeOf` (for example ~1122-1126, ~1136-1139, ~1229-1231, ~1331-1333 and every `repo = gitRepoWithCommit(); …; linkedWorktreeOf(repo)` site between ~438 and ~1041).

- [ ] **Step 1: Write the failing tests** (new block in `tests/helpers-git-template.test.js`, right after the `builders` loop. Use that file's own `mk`, `scratch`, `withEnv`, `git` helpers.)

```js
// #5324: the pre-tool-use fixed pairs and repos sit on templates too.
const preToolUsePairs = {
  'pre-tool-use mainAndWorktree': [() => preToolUse.mainAndWorktree(), (r) => [r.main, path.dirname(r.wt)]],
  'pre-tool-use mainAndWorktree({ localMain })': [() => preToolUse.mainAndWorktree({ localMain: true }), (r) => [r.main, path.dirname(r.wt)]],
  'pre-tool-use gitRepoOnLocalMain': [() => preToolUse.gitRepoOnLocalMain(), (d) => [d]],
  'pre-tool-use unpinnedRepoWithOrigin': [() => preToolUse.unpinnedRepoWithOrigin(), (d) => [d]],
};
for (const [name, [make, dirsOf]] of Object.entries(preToolUsePairs)) {
  test(`AC1.1 AC1.2: ${name}: a second call starts no git process`, () => { /* same body as the builders loop */ });
}
test('a copied mainAndWorktree pair resolves to its own main, and a second worktree can be added to it', () => {
  // two copies a, b: realpath(git -C a.wt rev-parse --git-common-dir) === realpath(a.main/.git);
  // git -C a.main worktree list --porcelain lists a.wt and not b.wt;
  // git -C a.wt rev-parse --show-toplevel === a.wt; prefixes ct-e1- / ct-e1-wtparent- on basenames;
  // second worktree: git -C a.main worktree add -q <mk('ct-gt-wt2-')>/wt -b extra succeeds, and git -C that dir rev-parse HEAD equals git -C a.main rev-parse HEAD
});
test('mainAndWorktree({ localMain: true }) and gitRepoOnLocalMain copies are on main', () => {
  // git symbolic-ref --short HEAD === 'main' in pair.main and in gitRepoOnLocalMain()
});
test('unpinnedRepoWithOrigin copies carry the GitHub-shaped origin and one commit', () => {
  // git remote get-url origin === 'https://github.com/o/n.git'; git rev-list --count HEAD === '1'
});
```

- [ ] **Step 2: Run, expect FAIL** (`preToolUse.mainAndWorktree is not a function`)

Run: `node --test tests/helpers-git-template.test.js`

- [ ] **Step 3: Implement the three helpers in `tests/helpers/pre-tool-use.js`**, per Interfaces. Use `fromTemplateSet` from `./git-template`, and `execFileSync('git', …)` inside the builds as the file already does.

- [ ] **Step 4: Migrate the sites in `tests/hooks-pre-tool-use.test.js`** per the site rules. Change no test name, assertion or test count.

- [ ] **Step 5: Run, expect PASS**

Run: `node tools/run-tests.js tests/helpers-git-template.test.js tests/hooks-pre-tool-use.test.js tests/hooks-pre-tool-use-forge-memo.test.js`

Expected: all pass, with the same test count for the two pre-tool-use files as `git show HEAD~:<file>` gives (`grep -c "^test("` before and after).

- [ ] **Step 6: Go-red control.** Temporarily make `mainAndWorktree`'s build skip the `worktree add`, and confirm the pair test fails. Revert the change before committing.

- [ ] **Step 7: Commit** `Template the pre-tool-use repo+worktree pairs — refs #5324`

### Task 2: Template the verify scenario builders

**Role:** integration
**Review risk:** high (module-level cache `Map` and argument-derived template keys)

**Files:**
- Modify: `tests/bin-lib/verify/cli-helpers.js`
- Test: `tests/helpers-git-template.test.js` (the same inserted block as Task 1, extended. Still additive.)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces (return shapes unchanged):
  - `initVerifyRepo(dir)` (internal): `git init -q`, then append `[user]\n\temail = verify-test@example.invalid\n\tname = verify test\n` to `dir/.git/config` with `fs.appendFileSync`, then `commit -q --allow-empty -m init`. `tmpGitRepo()`'s build calls it, so no `git config` process remains.
  - `headBranch(gitDir) -> string`: parses `ref: refs/heads/<name>` from `<gitDir>/HEAD`.
  - `scopedRepo(rules, extra = {})`: key `verify-cli:scoped:${JSON.stringify([rules, extra])}`. The build runs `initVerifyRepo`, writes the declaration, then `add` and `commit -m 'declare verify scope'`. Per copy it computes `marker`, `unitCmd` (via `nodeCmd`) and `branch = headBranch(gitDir)`.
  - `flakyRepo(opts)`: normalize to `{ failingFile, retryExit, flaky, extraDecl }` with the existing defaults. The key is `verify-cli:flaky:${JSON.stringify(normalized)}`. The build writes `fail.js`, `retry.js` and the declaration, then runs `add .` and `commit -m 'flaky fixture'`. Per copy, it computes `branch = headBranch(gitDir)` (no git process), and `args`, `marker` and `retryLog` from the copy's own paths.
  - `baselineRepo()`: key `verify-cli:baseline`. The build writes the two test files, runs `add .` and `commit -m base`, and stores `rev-parse HEAD` in a module-level `Map` (`buildMeta`) under the key. Per call, `baseSha` comes from that map. The copied objects hold the same commit.
  - Each copy uses `fromTemplate(key, build, { prefix: 'verify-cli-test-', realpath: true })`, and the result is `{ repo, git: gitIn(repo), gitDir: path.join(repo, '.git') }` spread as today.

- [ ] **Step 1: Write the failing tests** (append inside the Task 1 block):

```js
const verifyHelpers = require('./bin-lib/verify/cli-helpers');
for (const [name, make] of [
  ['verify scopedRepo', () => verifyHelpers.scopedRepo([{ match: 'src/**', suites: ['unit'] }])],
  ['verify flakyRepo()', () => verifyHelpers.flakyRepo()],
  ['verify flakyRepo({ retryExit: 1 })', () => verifyHelpers.flakyRepo({ retryExit: 1 })],
  ['verify baselineRepo', () => verifyHelpers.baselineRepo()],
]) {
  test(`AC1.1 AC1.2: ${name}: a second call starts no git process`, () => { /* builders-loop body; dirsOf = (r) => [r.repo] */ });
}
test('verify builders: per-call values match git, and different arguments never share a template', () => {
  // s = scopedRepo(rulesA): s.branch === git(s.repo, ['symbolic-ref','--short','HEAD']); s.marker under s.gitDir; s.unitCmd includes s.marker
  // scopedRepo(rulesB) declaration file !== scopedRepo(rulesA) declaration file (JSON.parse(...).rules)
  // b = baselineRepo(): b.baseSha === git(b.repo, ['rev-parse','HEAD'])
  // flakyRepo({ retryExit: 1 }) retry.js contains 'process.exit(1)'; flakyRepo() retry.js contains 'process.exit(0)'
});
test('Absorbed AC (identity): a fresh process building every owned fixture starts no git config user.name/user.email process', () => {
  // spawnSync(process.execPath, ['-e', script]) with GIT_TRACE2_EVENT=<mk dir>, cwd = repo root;
  // script requires ./tests/helpers/pre-tool-use and ./tests/bin-lib/verify/cli-helpers and calls each builder once
  // (gitRepo, gitRepoWithCommit, gitRepoOnLocalMain, mainAndWorktree x2 variants, unpinnedRepoWithOrigin, tmpGitRepo, scopedRepo, flakyRepo, baselineRepo).
  // assert status 0; control: tracedArgvs(dir).length > 0;
  // assert no argv has argv[1]==='config' (or after -C <dir>) with 'user.name'/'user.email'
});
```

- [ ] **Step 2: Run, expect FAIL** (the identity test sees `config user.email`, and the second-call tests see git processes)

Run: `node --test tests/helpers-git-template.test.js`

- [ ] **Step 3: Implement per Interfaces in `tests/bin-lib/verify/cli-helpers.js`.**

- [ ] **Step 4: Run, expect PASS**, including every consumer:

Run: `node tools/run-tests.js tests/helpers-git-template.test.js tests/bin-lib/verify/`

Expected: all pass, and each `cli*.test.js` has the same test count as at `HEAD~`.

- [ ] **Step 5: Go-red control.** Temporarily key `scopedRepo` on `'verify-cli:scoped'` alone, and confirm the distinct-arguments assertion fails. Revert the change.

- [ ] **Step 6: Commit** `Template the verify scenario builders — refs #5324`

### Task 3: Measure sets A and B, before and after

**Role:** integration

**Files:**
- Read-only measurement (scratch script in the session scratchpad, never committed). Waived `tests/hooks-session-start.test.js`, `tests/hooks-teardown-run.test.js`, `tests/issue-branch-tracking.test.js`, `tests/reconcile-archive-residue.test.js`, `tests/load-delta-cli.test.js`, `tests/bin-lib/verify/cli-baseline.test.js`, `tests/bin-lib/verify/cli-flaky-preexisting.test.js`, `tests/bin-lib/verify/cli-scope-integration.test.js`, `tests/bin-lib/verify/cli-slot-queue.test.js`: they are only run, as the measurement sets. Step 1 reads them.

- [ ] **Step 1: Measure.** Set A is `tests/hooks-pre-tool-use.test.js tests/hooks-session-start.test.js tests/hooks-teardown-run.test.js tests/issue-branch-tracking.test.js tests/reconcile-archive-residue.test.js tests/load-delta-cli.test.js`. Set B is `tests/bin-lib/verify/cli-baseline.test.js tests/bin-lib/verify/cli-flaky-preexisting.test.js tests/bin-lib/verify/cli-scope-integration.test.js tests/bin-lib/verify/cli-slot-queue.test.js`. Per-file lists are the two pre-tool-use test files, `tests/helpers-git-template.test.js` (its count grows by this record's added tests, which the Decision paragraph allows), and every `tests/bin-lib/verify/cli*.test.js` that requires `cli-helpers`. For each list, run `CT_TEST_CONCURRENCY=6 GIT_TRACE2_EVENT=<fresh absolute empty dir> node tools/run-tests.js --files-from <list>` in a detached worktree at the merge base (`git merge-base HEAD origin/main`), then immediately at HEAD, on the same machine. Count one trace2 file per git process, split by subcommand (the first non-option argv entry after `git` and any `-C <dir>` / `-c k=v`), and count `config user.name` / `config user.email` processes. Remove the detached worktree afterwards with `git worktree remove`.
- [ ] **Step 2: Persist evidence.** Write the full output with a plain Bash redirect to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T232305-record-5324/evidence/git-process-counts.txt` (run `mkdir -p` first). Then write one `log-decision.js --section "/build" --status AUTO --step "AC evidence" --text-file <file>` entry naming AC2.1, the command shape, the before and after totals for A, B and A+B against the 3,695 target, and the evidence path. A total above 3,695 also records the attribution required by AC2.2 (the subcommands the code under test runs).
- [ ] **Step 3: Absorbed AC (same tests).** For each touched test file, compare `grep -c "^test(\|^  test("` and the test-name list at the merge base and at HEAD (`git show <base>:<file>`). Record "same names and counts" (plus the tests this record adds to `tests/helpers-git-template.test.js`) in the same evidence file.
- [ ] **Step 4: PR body (controller).** Add a `### Git process counts` section to PR #5809's body, below the fixes block, keeping the session link line last. It holds the A/B before and after totals against 3,695, the per-file before/after with the split by subcommand, any AC2.2 shortfall attribution, and any aim-over-literal choice made under the Decision paragraph.

Waived AC3.1: the full `npm test` and the Windows CI job are run by the pipeline's own verification (`/claude-tweaks:test`), plus a `windows-regression.yml` dispatch before merge. They are not a plan task.
