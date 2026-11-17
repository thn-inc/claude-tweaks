# Archive-Tracked-Shells Template Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tests/archive-tracked-shells.test.js` builds each fixture repository once per test process and hands every test a copy, so the file starts far fewer git processes while every existing test and assertion stays as it is.

**Architecture:** The file's fixture builders (`makeFixture`, `makeLocalOnlyFixture`, the policy test's `git init` directory) call `fromTemplate` from `tests/helpers/git-template.js`: the first call builds the repository with real git, every call returns an `fs.cpSync` copy whose git metadata paths are rewritten. `makeFixture` takes an ordered list of shell options; the three sequences many tests share (`[absent]`, `[identical]`, `[absent, identical]`) are seeded in their own templates. Shells a test adds later, and every git call the CLI under test makes, stay real. The builders stay inline in the test file (the spec allows this; no helper module is created).

**Tech Stack:** Node `node:test`, real `git`, `tests/helpers/git-template.js` (`fromTemplate`, `disableReceiveAutoGc`), `tests/helpers/git-fixtures.js` (`fixtureGit`, `cleanGitEnv`).

**Spec:** `.claude-tweaks/pipelines/2026-11-17T085116-spec-5845/work/5845-spec.md`

## Global Constraints

- Every test in `tests/archive-tracked-shells.test.js` before the change is present after it under the same name and passes. No test is deleted, skipped, renamed, merged or loosened. The count grows only by the two tests this plan adds (56 → 58).
- No assertion is removed or changed. A test's setup may change; its assertions may not.
- Every git operation that is the behaviour under test stays real and per test: each git call the CLI makes, the scratch-worktree `git worktree add` / `git worktree lock` setups, the fake-git interleaving steps, the merged, closed and squash-merged PR simulations, and each git call an assertion reads.
- Only `tests/archive-tracked-shells.test.js` changes. `tests/helpers/git-template.js`, `tests/helpers/git-fixtures.js`, `tools/run-tests.js` and `tests/helpers-git-template.test.js` are being edited by other open PRs (#5771, #5790): call them as they are, change none of them.
- No `git config user.name` / `user.email` spawn: identity stays in the environment (`IDENTITY`).
- Test concurrency is not lowered anywhere.
- New tests are named with a `#5845` prefix, because the file already has tests named `AC2.1`, `AC3.1`, `AC4.1` from an earlier record.
- Project maturity is `established`: the copy-independence test in Task 1 is the characterization test for the fixture behaviour this plan changes; it passes before and after.

## Review Focus

1. A copy that still points at the template's `origin.git`: a push in one test would then change every later test's origin. Pinned by Task 1's copy-independence test.
2. A bare `node --test` run (no runner, so no git template config): a detached `git maintenance run --auto` started by the template build's last commit or push can race the first `fs.cpSync`. The template build runs its git with an environment taken at build time and calls `disableReceiveAutoGc` on the bare origin; Task 1 Step 6 and Task 2 Step 5 run the file bare.
3. A descriptor (`live`, `twinWork`) rooted at the template instead of the copy: tests pass absolute paths from it to `compareWorkTwin` and `fs`. Pinned by Task 2's descriptor assertions in the copy-independence test.
4. A test whose meaning depends on the order of run ids (a leading shell that must sort after a later one): a seeded shell always has the earliest id. Task 2 Step 3 keeps such a test on `addShell`.
5. Windows: the copies rewrite paths in `.git/config`; the remote-URL assertion compares `fs.realpathSync.native` of both sides, never raw strings. The Windows regression job runs after the last code change.

## Spec coverage map

| Clause | Covered by |
|---|---|
| AC1.1, AC1.2, AC1.3 (same tests, count not lower, nothing removed or skipped) | Task 1 Step 6 and Task 2 Step 5 (58 tests pass, 0 skipped); controller check C1 (test-name list before and after) |
| AC2.1 (`git init` / `git clone` at most once per template) | Task 1 Steps 3-5, Task 2 Step 2; controller check C2 (traced run) |
| AC2.2 (PR body lists the templates) | Controller check C2 |
| AC3.1 (warm-call test goes red on a per-call builder) | Task 1 Steps 1-2 (red before the builders are templated); controller check C3 (revert one builder, red output) |
| AC3.2 (PR body quotes the red output) | Controller check C3 |
| AC4.1 (a copy is independent) | Task 1 Step 3 test `#5845 AC4.1` |
| AC5.1, AC5.2 (at most 75% of the before count, or the breakdown) | Controller check C2 |
| AC6.1 (how counts are taken) | Controller check C2 |
| AC7.1 (full suite and Windows job after the last code change) | Controller check C4 |
| AC8.1 (no #5771 / #5790 file changed) | Global Constraints; controller check C5 |

## Controller checks (run by the build controller after Task 2, not dispatched)

Each writes its full output to `$PIPELINE_RUN_DIR/evidence/{name}.txt` and one `AC evidence` entry in `decisions.md`.

- **C1** `test-names`: the sorted list of test names at the merge-base and at HEAD; every base name is in the HEAD list; HEAD has exactly two more.
- **C2** `git-trace`: `GIT_TRACE2_EVENT=<absolute path of an empty directory>` around `node tools/run-tests.js --files-from <list naming the one file>`, at the merge-base and at HEAD, back to back; totals and the `init`, `clone`, `commit`, `push`, `worktree` counts; the list of templates.
- **C3** `warm-call-red`: in a scratch copy of HEAD, one templated builder is put back to building per call; the `#5845 AC3.1` test's red output.
- **C4** PR CI run and the Windows regression workflow on the final head.
- **C5** `git diff --name-only <merge-base>..HEAD` names no file other than this plan's, the ledger, the spec and `tests/archive-tracked-shells.test.js`.

---

### Task 1: Build the base fixtures once per process

**Role:** integration

**Files:**
- Modify: `tests/archive-tracked-shells.test.js`
- Test: `tests/archive-tracked-shells.test.js`

**Interfaces:**
- Consumes: `fromTemplate(key, build, { prefix, realpath })` and `disableReceiveAutoGc(bareDir)` from `./helpers/git-template`; `fixtureGit`, `cleanGitEnv` from `./helpers/git-fixtures` (already imported).
- Produces (Task 2 relies on these names):
  - `fixtureEnv()` → a fresh `{ ...cleanGitEnv(), ...IDENTITY }`, read when called.
  - `writeShell(run, root, id, n, { twin = 'identical', clean = true, push = true } = {})` → `{ id, file, live, twinWork }`. `run(cwd, ...args)` runs git. This is today's `addShell` body with the file number `n` and the git runner passed in.
  - `addShell(root, id, opts)` → unchanged signature and result: `seq += 1; return writeShell(git, root, id, 9000 + seq, opts)`.
  - `makeFixture()` → `{ base, origin, root, shells: [] }`, a copy of template `ats:fixture:[]`.
  - `makeLocalOnlyFixture()` → `{ root }`, a copy of template `ats:local-only`.
  - `policyRepo()` → the realpath'd directory of a copy of template `ats:policy-repo` (an empty `git init -q` repository).
  - `traced(dir, fn)` → runs `fn` with `GIT_TRACE2_EVENT=dir` set on both `process.env` and the module's `ENV` object, restoring both in `finally`.

- [ ] **Step 1: Add the warm-call test as the last test of the file**

It must stay the last test in the file, so every template it touches was already built by an earlier test.

```js
test('#5845 AC3.1: a warm call of each templated fixture builder starts no git process', () => {
  const builders = [() => makeFixture(), () => makeLocalOnlyFixture(), () => policyRepo()];
  for (const build of builders) build(); // warm-up: a first call may build the template
  const trace = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ats-trace-'));
  traced(trace, () => { for (const build of builders) build(); });
  assert.deepEqual(fs.readdirSync(trace), []);
});
```

For this step only, add `traced` as specified above and a temporary `policyRepo` that does what the policy test's `resolveIn` does today for its directory (`fs.realpathSync(fs.mkdtempSync(...'ct-ats-policy-'))` then `fixtureGit(['init', '-q', dir], { env: ENV })`), so the test runs and fails for the right reason.

- [ ] **Step 2: Run the warm-call test and see it fail**

Run: `node --test --test-name-pattern "warm call" tests/archive-tracked-shells.test.js`
Expected: FAIL after Step 1 — `fs.readdirSync(trace)` is not empty, because `makeFixture`, `makeLocalOnlyFixture` and `policyRepo` each start git on every call.

- [ ] **Step 3: Add the copy-independence test, directly above the warm-call test**

```js
test('#5845 AC4.1: a fixture copy has its own origin; a push in one copy leaves another copy unchanged', () => {
  const a = makeFixture();
  const b = makeFixture();
  assert.notEqual(a.base, b.base);
  for (const f of [a, b]) {
    assert.equal(f.origin, path.join(f.base, 'origin.git'));
    assert.equal(f.root, path.join(f.base, 'main'));
    assert.equal(fs.realpathSync.native(git(f.root, 'remote', 'get-url', 'origin')), fs.realpathSync.native(f.origin));
    assert.equal(git(f.root, 'config', 'core.autocrlf'), 'false');
    assert.equal(git(f.root, 'rev-parse', '--abbrev-ref', 'main@{upstream}'), 'origin/main');
    assert.equal(git(f.root, 'log', '--format=%s'), 'seed');
  }
  const before = git(b.origin, 'rev-parse', 'main');
  assert.equal(git(a.origin, 'rev-parse', 'main'), before);
  addShell(a.root, '2026-11-30T000000-record-1', { twin: 'absent' }); // commits and pushes in copy a
  assert.notEqual(git(a.origin, 'rev-parse', 'main'), before);
  assert.equal(git(b.origin, 'rev-parse', 'main'), before);
  assert.equal(git(b.root, 'rev-parse', 'HEAD'), before);
});
```

Run: `node --test --test-name-pattern "AC4.1: a fixture copy" tests/archive-tracked-shells.test.js`
Expected: PASS (it describes what `makeFixture` already guarantees; it must stay green after Step 4).

- [ ] **Step 4: Template the three builders**

- Add `fixtureEnv()` and split `addShell` into `writeShell` + `addShell` as the Interfaces block states. `addShell`'s results and git calls are unchanged.
- `makeFixture()` returns a copy of template key `ats:fixture:[]`: `const base = fromTemplate(key, build, { prefix: 'ct-ats-', realpath: true })`, then `{ base, origin: path.join(base, 'origin.git'), root: path.join(base, 'main'), shells: [] }`.
- The template build receives the template's base directory and does what `makeFixture` does today inside it (`init --bare -b main origin.git`, `clone`, `config core.autocrlf false`, `checkout -B main`, write `.gitignore` and `README.md`, `add`, `commit -m seed`, `push -u origin main`), with two differences: every git call uses `fixtureEnv()` taken inside the build (the build runs with auto-maintenance switched off in `process.env`, and the module's `ENV` was read before that), and it calls `disableReceiveAutoGc(origin)` right after the `init --bare`.
- `makeLocalOnlyFixture()` returns `{ root: path.join(base, 'main') }` from template key `ats:local-only`, prefix `ct-ats-local-`, `realpath: true`; the build is today's body with `fixtureEnv()`.
- `policyRepo()` returns `fromTemplate('ats:policy-repo', build, { prefix: 'ct-ats-policy-', realpath: true })`, the build being `git init -q <dir>` with `fixtureEnv()`. The policy test's `resolveIn` takes its directory from `policyRepo()` and writes `.claude-tweaks/policy.yml` into the copy as it does today.
- No test body changes in this task other than `resolveIn`'s first two lines.

- [ ] **Step 5: Run the two new tests**

Run: `node --test --test-name-pattern "#5845" tests/archive-tracked-shells.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 6: Run the whole file bare**

Run: `node --test tests/archive-tracked-shells.test.js`
Expected: `tests 58`, `pass 58`, `fail 0`, `skipped 0`.

- [ ] **Step 7: Commit**

```bash
git add tests/archive-tracked-shells.test.js
git commit -m "Build the archive-tracked-shells base fixtures once per process — refs #5845"
```

---

### Task 2: Seed the shell sequences many tests share

**Role:** integration

**Files:**
- Modify: `tests/archive-tracked-shells.test.js`
- Test: `tests/archive-tracked-shells.test.js`

**Interfaces:**
- Consumes: Task 1's `fixtureEnv`, `writeShell`, `makeFixture`, `traced`, and the two `#5845` tests.
- Produces:
  - `const ABSENT = { twin: 'absent' };` and `const IDENTICAL = {};`
  - `makeFixture(shells = [])` → `{ base, origin, root, shells: [{ id, file, live, twinWork }, ...] }`. `shells` is an ordered list of `addShell` option objects. Template key: `ats:fixture:` + `JSON.stringify` of the list with each entry normalized to `[twin, clean, push]` (defaults applied), so `{}` and `{ twin: 'identical' }` share one template. Seeded shell `i` (0-based) has id `` `2026-10-01T00000${i}-record-${i + 1}` `` and file number `8001 + i`, written by `writeShell` in the template build after the seed push. The returned descriptors are rebuilt for the copy: `live` and `twinWork` are under the copy's `root`.

- [ ] **Step 1: Extend the two `#5845` tests**

In the warm-call test, the builders list becomes:

```js
const builders = [
  () => makeFixture(), () => makeFixture([ABSENT]), () => makeFixture([IDENTICAL]), () => makeFixture([ABSENT, IDENTICAL]),
  () => makeLocalOnlyFixture(), () => policyRepo(),
];
```

In the copy-independence test, append:

```js
  const v = makeFixture([ABSENT, IDENTICAL]);
  const w = makeFixture([{ twin: 'absent' }, { twin: 'identical' }]); // same template: defaults are normalized
  assert.deepEqual(v.shells.map((s) => s.id), ['2026-10-01T000000-record-1', '2026-10-01T000001-record-2']);
  assert.deepEqual(w.shells.map((s) => s.id), v.shells.map((s) => s.id));
  for (const f of [v, w]) {
    for (const s of f.shells) {
      assert.equal(s.live, path.join(pipelines(f.root), s.id, 'work'));
      assert.equal(s.twinWork, path.join(pipelines(f.root), 'archive', s.id, 'work'));
      assert.ok(fs.existsSync(path.join(s.live, s.file)));
      assert.ok(fs.existsSync(path.join(pipelines(f.root), 'archive', s.id, 'run-state.json')));
    }
    assert.equal(fs.existsSync(f.shells[0].twinWork), false); // absent twin
    assert.ok(fs.existsSync(path.join(f.shells[1].twinWork, f.shells[1].file))); // identical twin
    assert.equal(git(f.root, 'status', '--porcelain'), '');
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), git(f.origin, 'rev-parse', 'main')); // both shells pushed
    assert.deepEqual(findShells(f.root, realDeps).shells.map((s) => s.runId), f.shells.map((s) => s.id));
  }
```

- [ ] **Step 2: Run the two tests and see them fail**

Run: `node --test --test-name-pattern "#5845" tests/archive-tracked-shells.test.js`
Expected: FAIL after Step 1 — `ABSENT` is not defined.

- [ ] **Step 3: Implement the variants and move the tests that qualify**

- Add `ABSENT`, `IDENTICAL` and the `shells` parameter of `makeFixture` as the Interfaces block states.
- Move a test onto a seeded variant only when all of these hold; otherwise leave it exactly as it is (it still gets the templated `makeFixture()` from Task 1):
  1. The `addShell` calls between the test's `makeFixture()` and its first other statement are exactly `[absent]`, `[identical]` (written `{}`, no options, or `{ twin: 'identical' }`) or `[absent, identical]`, all with default `clean` and `push`. Nothing else (no file write, no git call) sits between them.
  2. No assertion, regex or string in the test names the run-id literal of a moved shell. Every use goes through the returned descriptor.
  3. Every run id the test uses later (a later `addShell`, a hand-made directory) sorts after `2026-10-01T00000x`, and the test does not rely on a leading shell sorting after a later one.
- The move replaces only the setup lines: `const { root } = makeFixture(); const a = addShell(root, '<id>', { twin: 'absent' });` becomes `const { root, shells: [a] } = makeFixture([ABSENT]);` (keep the test's own variable names; drop the binding when the test never used the result). A fixture created in a loop moves the same way.
- A test whose leading sequence is anything else (`differs`, `differs-same-length`, `clean: false`, `push: false`, three or more shells, the first test's interleaved file writes, the local-only fixture's two shells) keeps its `addShell` calls unchanged.
- `addShell` calls that come after a test's first CLI call, `findShells` call or other git mutation stay as they are.
- No assertion line changes in any test.

- [ ] **Step 4: Run the two `#5845` tests**

Run: `node --test --test-name-pattern "#5845" tests/archive-tracked-shells.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the whole file bare, twice**

Run: `node --test tests/archive-tracked-shells.test.js`
Expected: `tests 58`, `pass 58`, `fail 0`, `skipped 0`, both times.

- [ ] **Step 6: Commit**

```bash
git add tests/archive-tracked-shells.test.js
git commit -m "Seed the shared shell sequences in the archive-tracked-shells fixture templates — refs #5845"
```
