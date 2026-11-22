# Learned-skills fixture templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the git processes the `tests/bin-lib/learned-skills/` suites start, by building their fixtures once per process through `tests/helpers/git-template.js` and copying them per test.

**Architecture:** Each fixture builder becomes a `fromTemplate`/`fromTemplateSet` build keyed by its arguments. Values the old builder computed with git (merge base, host autocrlf) are cached next to the template. Absolute paths that git's own files do not hold (`learned-skills/manifest.json`'s `patch` fields) are rewritten after the copy. Clones and pushes that only arrange state become template variants, or in-origin `commit-tree` + `update-ref`. Product code under `plugin/bin/lib/learned-skills/` is not touched.

**Tech Stack:** Node 18+, `node --test`, git CLI, git trace2 (`GIT_TRACE2_EVENT`).

**Spec:** `.claude-tweaks/pipelines/2026-11-16T183913-record-5770/work/5770-spec.md` (record #5770; re-materialized on resume, carries the record author's Decision paragraph and the plan-review clarifications)

Waived tests/bin-lib/learned-skills/capture.test.js: it gets the templated fixture only through `tests/helpers/learned-skills-capture.js` (Task 1) and is not edited; Task 1 Step 4 and Task 3 Step 4 run it and compare its test names and count.

Waived AC1.1: measured, not unit-tested, in Task 4 Step 4, with evidence in the run dir.
Waived AC1.2: Task 4 Step 6 writes the shortfall attribution into the PR body.
Waived AC2.1: this is the counting method, applied in Task 4 Steps 2-3.
Waived AC5.1: covered by the `/claude-tweaks:test` full suite and the PR's Windows regression job (Task 4 Step 7).

## Global Constraints

- Governing skill `windows-checkout-test-parity` (verbatim row): "Isolating a fixture's git from system config (`GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_SYSTEM=/dev/null`) when the code under test runs git with the host's config | Git for Windows keeps `core.autocrlf=true` in its system config. Dropping it from the fixture alone means the code's git writes CRLF trees that the fixture's git reads with autocrlf off. Every `git apply --check` and status assertion then disagrees, on win32 only: 23 Windows failures in #5290, `windows-regression` run 43399189472. Give the fixture repo a local `core.autocrlf` equal to the value the code's git sees, and add explicit `autocrlf=true` cases so Linux CI pins the Windows behavior (`fixture(t, …, { autocrlf })` and `hostAutocrlf` in `tests/helpers/learned-skills-capture.js`)." The templated build must still pin `core.autocrlf` to `hostAutocrlf()`'s value when no option is given.
- Governing skill `windows-checkout-test-parity` (verbatim row): "Rewriting a file git created inside a copied or linked worktree (its `.git` pointer file) with `fs.writeFileSync` | Git for Windows marks `.git` hidden (`core.hideDotFiles=dotGitOnly`), `fs.cpSync` keeps the attribute, and recreating a hidden file fails with `EPERM` on win32 only. Open the existing file `r+`, `ftruncateSync` it to 0, then `writeSync` (`writeInPlace` in `tests/helpers/git-template.js`, #5297, proven by `windows-regression` run 43361861892)". The manifest rewrite in Task 2 targets a non-hidden file, so plain `writeFileSync` is fine there. Never rewrite a `.git` file that way.
- Governing skill `parse-signal-discipline`: it only names `wrap-up-learned-skills-pr` as a scan entry, and it has no rule for test fixtures. None apply.

- Product code under `plugin/bin/lib/learned-skills/` is not changed by this record.
- Every file in `tests/bin-lib/learned-skills/` reports the same test names and the same number of tests as before, all passing, including the `core.autocrlf=true` variants. No assertion is removed or loosened, no test is deleted, skipped or merged, and test concurrency is unchanged.
- `land()`'s own pushes, fetches and `ls-remote` calls stay real, and so does `gitCalls` recording them.
- `land.test.js` target: at most 1,730 git processes (50% of the 3,460 measured at 8646f7c). If it misses, the PR body names the shortfall and attributes it to fixture setup or to git run by `capture()`/`land()`.
- Counts come from `GIT_TRACE2_EVENT=<absolute path of an empty directory>` around `CT_TEST_CONCURRENCY=6 node tools/run-tests.js --files-from <list>`. Before is taken at the branch's merge-base with main, after at HEAD, back to back on the same machine.
- New spawn tests go in `tests/helpers-git-template.test.js`, never in a `learned-skills/` file (that would change those files' test counts).

## Review Focus

- A copied fixture whose `manifest.json` still names the template's patch paths. `land()`/`stage()` would then read or rename the template's files and leak state across tests. Task 2's fixture asserts after every copy that no file under the copied run dir holds the template root, by plain fs reads.
- A spawn test that cannot go red. `learned-skills-capture.js`'s `ENV` is a load-time snapshot of `process.env`, so a `GIT_TRACE2_EVENT` set later never reaches `sh()`. Task 1 makes `sh()` read the env at call time, and each spawn test is proven red by temporarily reverting to the per-call build.
- The `autocrlf: 'true'` and host-default variants sharing one template. The key must hold the resolved autocrlf value, never the raw option.
- Two `land.test.js` tests that mutate `f.origin` (a pre-receive hook, an `update-ref`) while another test's copy shares it. Each copy holds its own `origin.git`, because the whole `root` dir is the template member.
- `hostAutocrlf()` starts a git process per call. It is resolved once per process, outside the per-copy path.

---

### Task 1: Template the capture helper's `fixture()`

**Review risk:** high

**Files:**
- Modify: `tests/helpers/learned-skills-capture.js:13-60`
- Test: `tests/helpers-git-template.test.js`

**Interfaces:**
- Consumes: `fromTemplate(key, build, { prefix, realpath })` from `tests/helpers/git-template.js`.
- Produces: `fixture(t, extraFiles = {}, { autocrlf } = {}) -> { repo, runDir, mergeBase }`, with the same signature and return shape as today. After one warm-up call per distinct `(extraFiles, resolved autocrlf)`, it starts no git process.

- [ ] **Step 1: Write the failing test** in `tests/helpers-git-template.test.js`:

```js
test('AC3.1: learned-skills capture fixture(): a warm copy starts no git process', (t) => {
  const { fixture } = require('./helpers/learned-skills-capture');
  fixture(t);                       // warm-up
  fixture(t, {}, { autocrlf: 'true' });
  const trace = mk('ct-gt-trace-');
  const [a, b] = withEnv('GIT_TRACE2_EVENT', trace, () => [fixture(t), fixture(t, {}, { autocrlf: 'true' })]);
  assert.deepStrictEqual(fs.readdirSync(trace), []);
  assert.notStrictEqual(a.repo, b.repo);
  assert.ok(fs.statSync(a.runDir).isDirectory());
  assert.strictEqual(a.mergeBase.length, 40);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="learned-skills capture fixture" tests/helpers-git-template.test.js`
Expected: FAIL (the trace dir is not empty), once `sh()` reads `process.env` at call time. If it passes before Step 3, the probe is blind: fix `sh()`'s env first.

- [ ] **Step 3: Implement.** In `learned-skills-capture.js`:
  - Build the git env per `sh()` call from the current `process.env` (keep `ENV` exported with the same keys for existing importers).
  - Memoize `hostAutocrlf` once per process. Resolve it against a throwaway `git init` dir before building the key, because the key needs the resolved `eol`.
  - `fixture()` resolves `eol`, then `fromTemplate(JSON.stringify([eol, extraFiles]), build, { prefix: 'ls-capture-', realpath: true })`. `build(dir)` runs today's init, config, write, add, commit, rm, checkout and run-dir mkdir, and records `rev-parse HEAD` in a module `Map` keyed the same way.
  - Drop `.git/hooks` in the build (as `scenario()` does).
  - The copy path registers `t.after` cleanup, re-creates `runDir` if needed, and returns the cached `mergeBase`.

- [ ] **Step 4: Run tests**

Run: `node --test tests/helpers-git-template.test.js tests/bin-lib/learned-skills/capture.test.js tests/bin-lib/learned-skills/capture-matrix-tracked.test.js tests/bin-lib/learned-skills/capture-matrix-joined-crlf.test.js`
Expected: PASS, with `capture.test.js`'s test count unchanged (compare `# tests` against `git show HEAD~:` baseline run).

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/learned-skills-capture.js tests/helpers-git-template.test.js
git commit -m "Template the learned-skills capture fixture — one build per argument set, refs #5770"
```

### Task 2: Template `land.test.js`'s fixture and drop state-arranging clones and pushes

**Review risk:** high

**Files:**
- Create: `tests/helpers/learned-skills-land.js`
- Modify: `tests/bin-lib/learned-skills/land.test.js` (the fixture at lines 15-67, the clone tests at 299 and 843, the force-pushes at 963, 979 and 1021)
- Test: `tests/helpers-git-template.test.js`

**Interfaces:**
- Consumes: `fromTemplateSet`, `disableReceiveAutoGc` from `tests/helpers/git-template.js`. Also `capture` from `plugin/bin/lib/learned-skills/learned-skills.js`.
- Produces: `tests/helpers/learned-skills-land.js` exports `fixture(t, { capturedTargets = [X, Z], autocrlf, originConflict = false } = {}) -> { root, origin, repo, runDir, mergeBase, mainTip }`, plus the constants `X, Z, BODY, RUN_ID, BRANCH, NOW` that `land.test.js` imports in place of its local copies. `originConflict: true` returns a fixture whose `origin` `main` carries one extra commit: the conflicting X change the two clone tests made, `'# x\n\nline one\nline two\nline three\nline four\nCHANGED five\nCHANGED six\nCHANGED seven\n'` with message `conflicting change`, built once inside the template. `f.mainTip` stays the clone's merge base, as today.

- [ ] **Step 1: Write the failing test** in `tests/helpers-git-template.test.js`:

```js
test('AC3.1: learned-skills land fixture(): a warm copy starts no git process and owns its paths', (t) => {
  const { fixture, X } = require('./helpers/learned-skills-land');
  for (const o of [{}, { autocrlf: 'true' }, { capturedTargets: [X] }, { originConflict: true }]) fixture(t, o);
  const trace = mk('ct-gt-trace-');
  const f = withEnv('GIT_TRACE2_EVENT', trace, () => fixture(t));
  withEnv('GIT_TRACE2_EVENT', trace, () => fixture(t, { originConflict: true }));
  assert.deepStrictEqual(fs.readdirSync(trace), []);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.runDir, 'learned-skills', 'manifest.json'), 'utf8'));
  for (const e of manifest) assert.ok(e.patch.startsWith(f.runDir + path.sep), e.patch);
  assert.strictEqual(git(f.repo, ['remote', 'get-url', 'origin']), f.origin);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="learned-skills land fixture" tests/helpers-git-template.test.js`
Expected: FAIL with `Cannot find module './helpers/learned-skills-land'`

- [ ] **Step 3: Implement.**
  - Move `fixture`, `sh`, `write`, `read` and the constants from `land.test.js` into `learned-skills-land.js`.
    - The helper's own `sh` passes an explicit env: `process.env` read at call time, plus `GIT_AUTHOR_*`/`GIT_COMMITTER_*` = `t`/`t@example.test`, so the build does not depend on which test file loads it.
    - `land.test.js` keeps its `process.env` identity assignment at the top, ahead of the require, because `land()`'s plumbing inherits it.
    - The build `fs.realpathSync`s `dirs.root` before its first git call, as today's fixture does. The manifest rewrite and the run-dir walk use that realpath spelling, falling back to the raw `dirs.root` spelling.
  - Build through `fromTemplateSet(key, build, { root: { prefix: 'ls-land-', realpath: true } })`, with `key = JSON.stringify([capturedTargets, autocrlf || '', originConflict])`. The build runs today's steps inside `dirs.root`, calls `disableReceiveAutoGc(origin)`, and for `originConflict` clones, commits and pushes once, then deletes the clone dir.
  - After the copy, rewrite each manifest entry's `patch` from the template root to the copy root (same relative path) and write `manifest.json` back.
  - Then walk every file under the copied `runDir` and throw if any holds the template root string. That covers `decisions.md` and patch files: rewrite it, or show it does not exist.
  - Cache `mergeBase` per key. Register `t.after` cleanup of the copy root.
  - In `land.test.js`:
    - The two tests at `:299` and `:843` call `fixture(t, { originConflict: true })` and drop their clone/write/commit/push lines.
    - The three force-pushes at `:963`, `:979`, `:1021` become `sh(f.origin, ['commit-tree', tree, '-p', f.mainTip, '-m', <same message>])` plus `sh(f.origin, ['update-ref', \`refs/heads/${BRANCH}\`, sha])`. The `sh(f.repo, ['commit-tree', ...])` call they replace goes away.
    - Every assertion stays byte-identical.

- [ ] **Step 4: Run tests**

Run: `node --test tests/helpers-git-template.test.js tests/bin-lib/learned-skills/land.test.js`
Expected: PASS. `land.test.js` reports `# tests 57`, with the same names as `node --test tests/bin-lib/learned-skills/land.test.js` at the merge base (AC4.1). The diff removes or loosens no `assert.` line (AC4.2): every `assert` line that `git diff -U0 {merge-base} -- tests/bin-lib/learned-skills/land.test.js | grep '^-.*assert'` prints must reappear byte-identical (modulo indentation) as an added line in `tests/helpers/learned-skills-land.js` (the `assert.equal(res.route, 'captured')` the moved fixture carries); any other removed `assert` line fails the check.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/learned-skills-land.js tests/bin-lib/learned-skills/land.test.js tests/helpers-git-template.test.js
git commit -m "Template the learned-skills land fixture and drop state-arranging pushes, refs #5770"
```

### Task 3: Remove doubled read-only helper git calls in the matrix path

**Review risk:** high

**Files:**
- Modify: `tests/helpers/learned-skills-capture.js:62-424`

**Interfaces:**
- Consumes: Task 1's `fixture`.
- Produces: no new exports; `registerMatrix` behavior unchanged.

- [ ] **Step 1: Instrument and trace.**
  - Use trace2 (`GIT_TRACE2_EVENT=<abs empty dir>`) only for totals.
  - Attribute calls with a scratch, uncommitted wrapper. It records argv and the caller (`new Error().stack`) for each call, per combination, around the helper's `sh` and around `faultyDeps().git`'s `realDeps.git` passthrough (which is what `capture()` calls). For `land()`, wrap `deps().git` in `land.test.js`.
  - Run it over `land.test.js` and one matrix file per kind: `capture-matrix-tracked.test.js`, `capture-matrix-untracked.test.js`, `capture-matrix-joined.test.js`.
  - List every helper read-only call made twice for one combination with no state change between.

- [ ] **Step 2: Remove each listed helper repeat** by reusing the first result in the helper. Never change `plugin/bin/lib/learned-skills/`. The `apply --check -R` passthrough in `faultyDeps` stays real (its comment says why).

- [ ] **Step 3: Record product repeats.** Any same-question repeat inside one `capture()`/`land()` call with no state change between the two reads goes on a list kept for the PR body (Deliverable 5), and is filed with `/claude-tweaks:capture` by the controller. List it, do not fix it.

- [ ] **Step 4: Run tests**

Run: `node --test tests/bin-lib/learned-skills/`
Expected: PASS, with every file's `# tests` unchanged. AC4.2 for this task: `git diff -U0 {merge-base} -- tests/helpers/learned-skills-capture.js tests/bin-lib/learned-skills/ | grep '^-.*assert'` prints only lines that reappear as added lines elsewhere in the diff, and for each reused read the trace grouping from Step 1 shows no state-changing git call between the first read and the reuse.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/learned-skills-capture.js
git commit -m "Drop repeated read-only git calls in the learned-skills matrix helper, refs #5770"
```

If Step 1 finds no helper repeat, make no commit and report the trace grouping as evidence.

### Task 4: Measure before and after (controller)

**Files:** none committed. Results go into the PR body.

- [ ] **Step 1:** Write the list file: every `tests/bin-lib/learned-skills/*.test.js`, one per line.
- [ ] **Step 2:** Before count.
  - `git archive` the merge-base into a scratch dir.
  - For each file, run its own one-line list with its own empty trace dir: `GIT_TRACE2_EVENT=<abs empty dir> CT_TEST_CONCURRENCY=6 node tools/run-tests.js --files-from <one-file list>`.
  - No empty-list baseline run: `tools/run-tests.js` rejects an empty list, and on the `--files-from` path the runner starts no git process of its own, so every trace2 `start` event belongs to the file.
- [ ] **Step 3:** After count. Do the same at HEAD, back to back with Step 2.
- [ ] **Step 4:** Count per file (each trace2 `start` event is one process), as is.
  - AC1.1: `land.test.js` is judged against both ≤ 1,730 and ≤ 50% of its re-taken merge-base count (spec Plan Review Clarifications); the PR body reports both and names the one the verdict rests on.
  - AC1.2: otherwise name the shortfall and attribute it to fixture setup or to `capture()`/`land()` git.
  - AC2.1: the counting method, before at the merge base and after at HEAD, back to back.
- [ ] **Step 5:** Record the evidence.
  - Save the full count output to `$PIPELINE_RUN_DIR/evidence/git-process-counts.txt` (absolute run-dir path, plain Bash redirect).
  - Log one `log-decision.js --status AUTO --step "AC evidence" --text-file` entry that names AC1.1, AC1.2 and AC2.1, the command shape, the counts and that path.
- [ ] **Step 5b:** File each product-code repeat Task 3 Step 3 listed with `/claude-tweaks:capture` (spec-shaped body, `### Key Files`), and keep the record numbers for the PR body. None listed → say so in the PR body.
- [ ] **Step 6:** Add the per-file before/after table, the Task 3 findings (with any filed record numbers) and any shortfall attribution to the PR body.
- [ ] **Step 7:** AC4.1, AC4.2 and AC5.1 are checked by `/claude-tweaks:test`'s full suite (verify.js), and by the Windows regression job dispatched on the PR after the last code change. Task 2 Step 4's assertion-diff check also covers AC4.2.
