# PATH Stand-in Helper (#4285) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give tests one shared way to put a fake binary on `PATH` (`installStub`, skipped on win32 with `STUB_SKIP`) and one to build a PATH that resolves only named real binaries (`pathWithOnly`). Move the 9 failing files and the 4 existing per-file constants onto that helper so Windows reports 0 failures of this class.

**Architecture:** A new test helper, `tests/helpers/path-stub.js`, owns the skip reason, the stub installer and the PATHEXT-aware PATH builder. Each suite swaps its hand-rolled write-plus-prepend for the helper. Symlink-PATH suites switch to `pathWithOnly` and keep running on Windows. Stub suites keep running on POSIX and skip on win32. A scan in the helper's own test file keeps `:`-joined PATHs out of `tests/`.

**Tech Stack:** Node 18+ (`node:test`, `node:fs`, `node:path`, `child_process`). No new dependencies, and no `plugin/` file changes.

**Spec:** `.claude-tweaks/pipelines/2026-10-26T131247-spec-4290-4285-4396/spec-4285/work/4285-spec.md`

## Global Constraints

- `STUB_SKIP`'s reason text is exactly `win32: execFile resolves only .exe/.com on PATH, so a script stub is never spawned`.
- `installStub(name, script)` prepends through `path.delimiter` and returns a restore function.
- `pathWithOnly(names, { exclude })` finds each binary with a `PATHEXT`-aware walk. It uses the binary's own directory, or a temp symlink directory when that directory holds an excluded name.
- AC1: every Key Files suite passes under `node --test` on Linux, with no new skips. `STUB_SKIP` is `false` off win32.
- No production seam and no `plugin/` change. This record is test-only.
- Every `chmodSync(` under `tests/` either calls `chmodDenialSkip(` or carries `// root-safe` on the line: the #4290 conformance scan, `tests/permission-sim-root-skip-conformance.test.js`. The helper's executable-bit chmod is `// root-safe`.
- Line numbers below are at `ea728f9e8`. Identify a test by its title, never by its line number.

## Rulings

- **`STUB_SKIP` is the skip option value, not the bare text.** `STUB_SKIP = process.platform === 'win32' && STUB_SKIP_REASON`, the same shape as today's `PATH_STUB_SKIP`, so `{ skip: STUB_SKIP }` is `false` on POSIX (AC1). `STUB_SKIP_REASON` is exported, and its exact text is pinned.
- **Skip exactly the failing stub tests, not every stub-using test.** The other stub-using tests in these files pass on Windows, because their assertion does not depend on the stub running (for example reap-merged's in-use locked-worktree case). Skipping them would drop coverage that Windows really provides. The 34 skipped tests are the record's 32 (from its Windows run, mapped by title to `ea728f9e8`) plus two that a newer Windows run (40335066805) shows failing. The table is in Task 2.
- **Scope additions (add-to-plan).**
  - `tests/bin-lib/reconcile/archive-merged.test.js:32` also defines `PATH_STUB_SKIP`, and the Deliverable says "replace each per-file `PATH_STUB_SKIP`".
  - `.claude/skills/windows-checkout-test-parity/SKILL.md:179` teaches the per-file `PATH_STUB_SKIP` and names files that will no longer have one. The #4290 final review flagged exactly this kind of stale skill row as Important.
- **`release-merged`/`pr-state` multi-stub helpers stay as they are.** These files are Key Files for the constant swap only (`STUB_SKIP`). Their wrappers write several stubs into one directory, and rewriting those wrappers is not in the Deliverables.

## Review Focus

1. A binary whose own directory also holds an excluded name: Homebrew `/opt/homebrew/bin` and Linux `/usr/bin` both hold `git` and `gh`. Expect a symlink directory with only the named binaries, so `gh` gives ENOENT. Pinned in Task 1 (`pathWithOnly falls back to a symlink dir ...`).
2. A named binary that is not on `PATH`. Expect a throw that names it, never a PATH that silently omits it (a later `git` call would then fail far from the cause). Pinned in Task 1.
3. Win32 resolution: `git.EXE` is found through `PATHEXT` even though `git` itself is absent. Pinned in Task 1 through injected `platform`/`env` and fixture directories.
4. `installStub`'s restore must put back the exact original `PATH` and remove the stub directory, even when a sibling test in the same worker installs another stub first. Pinned in Task 1.
5. Scan false positives: `pathParts.join(':')` in `claim-targets.test.js` is not a PATH and must not be flagged. A doctored `` `${dir}:${process.env.PATH}` `` must be flagged. Pinned in Task 4.

---

### Task 1: The helper and its pins

**Files:**
- Create: `tests/helpers/path-stub.js`
- Create: `tests/path-stub-helper.test.js`

**Interfaces:**
- Produces (exact exports of `tests/helpers/path-stub.js`):
  - `STUB_SKIP_REASON: string` — `'win32: execFile resolves only .exe/.com on PATH, so a script stub is never spawned'`
  - `STUB_SKIP: false | string` — `process.platform === 'win32' && STUB_SKIP_REASON`
  - `installStub(name: string, script: string): () => void` — writes `script` to `{fresh mkdtemp dir}/{name}`, chmods it `0o755` (`// root-safe` on that line), sets `process.env.PATH = dir + path.delimiter + original`, and returns `restore()`. `restore()` sets `PATH` back to the original string and `rmSync`s the dir (`{ recursive: true, force: true }`). It is idempotent.
  - `pathWithOnly(names: string[], { exclude = [], env = process.env, platform = process.platform } = {}): string` — returns a PATH string (directories joined with `path.delimiter`, de-duplicated, in `names` order).
    - Walk `env.PATH` split on `platform === 'win32' ? ';' : ':'`. Read `env.PATH` or `env.Path`, whichever is set, because win32 env keys are case-insensitive.
    - Candidates: on win32, `name` + each extension in `(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')`, and also the name as given. On POSIX, `name` only.
    - The first existing regular file wins.
    - When its directory contains any candidate of any `exclude` name, symlink the found file into one shared `mkdtemp` directory under its own basename, and use that directory instead.
    - A name that resolves nowhere throws `Error('pathWithOnly: {name} not found on PATH')`.

- [ ] **Step 1: Write the failing tests** in `tests/path-stub-helper.test.js`:
  - `'STUB_SKIP_REASON is the spec text, and STUB_SKIP is the reason on win32 only'`: `assert.strictEqual(STUB_SKIP_REASON, 'win32: execFile resolves only .exe/.com on PATH, so a script stub is never spawned')`, then `assert.strictEqual(STUB_SKIP, process.platform === 'win32' && STUB_SKIP_REASON)`.
  - `'installStub prepends a dir holding the stub and restore puts PATH back'`: record `const before = process.env.PATH`. Call `restoreA = installStub('ct-a', '#!/bin/sh\nexit 0\n')`, then `restoreB = installStub('ct-b', ...)`. Assert `process.env.PATH.split(path.delimiter)[0]` holds `ct-b` and the second entry holds `ct-a`. Call `restoreB()`, then `restoreA()`, and assert `process.env.PATH === before` and that both dirs are gone (`fs.existsSync` false). Call `restoreA()` again and assert it does not throw.
  - `'AC2.1: pathWithOnly([git], { exclude: [gh] }) resolves git and not gh'`: `const p = pathWithOnly(['git'], { exclude: ['gh'] })`. `execFileSync('git', ['--version'], { env: { ...process.env, PATH: p } })` does not throw. `assert.throws(() => execFileSync('gh', ['--version'], { env: { ...process.env, PATH: p }, stdio: 'ignore' }), (e) => e.code === 'ENOENT')`.
  - `'pathWithOnly falls back to a symlink dir when the binary dir also holds an excluded name'` (POSIX only: `{ skip: process.platform === 'win32' && 'win32: symlink creation needs privilege' }`):
    - Fixture: one `mkdtemp` dir `shared` holding executable `tool` and `gh` scripts (`// root-safe` on both chmod lines).
    - `p = pathWithOnly(['tool'], { exclude: ['gh'], env: { PATH: shared }, platform: 'linux' })`.
    - Assert `p !== shared`, that `fs.readdirSync(p)` deep-equals `['tool']`, and that `fs.realpathSync(path.join(p, 'tool')) === fs.realpathSync(path.join(shared, 'tool'))`.
  - `'pathWithOnly uses the binary own dir when it holds no excluded name'`: fixture dirs `a` (holds `tool`) and `b` (holds `gh`). `pathWithOnly(['tool'], { exclude: ['gh'], env: { PATH: [a, b].join(':') }, platform: 'linux' })` equals `a`.
  - `'pathWithOnly finds a PATHEXT extension on win32'`: fixture dir holds a file `git.EXE`. `pathWithOnly(['git'], { env: { Path: dir, PATHEXT: '.COM;.EXE' }, platform: 'win32' })` equals `dir`.
  - `'pathWithOnly throws naming a binary that is not on PATH'`: `assert.throws(() => pathWithOnly(['ct-no-such-bin'], { env: { PATH: emptyDir }, platform: 'linux' }), /ct-no-such-bin not found on PATH/)`.

- [ ] **Step 2: Run it.**
  - Run `node --test tests/path-stub-helper.test.js`.
  - Expected: FAIL, `Cannot find module './helpers/path-stub'`.

- [ ] **Step 3: Implement the four exports in `tests/helpers/path-stub.js`** to the Interfaces block. Head the file with a comment, in `root.js`'s style:
  - What fails on win32: libuv tries only `name`, `.com` and `.exe`; a `.cmd` shim is refused with EINVAL without a shell.
  - Why a stub test skips there rather than converting.
  - That `pathWithOnly` keeps a symlink-PATH test running on Windows.

- [ ] **Step 4: Run it again.**
  - Run `node --test tests/path-stub-helper.test.js tests/permission-sim-root-skip-conformance.test.js`.
  - Expected: `# fail 0`. The conformance scan stays green: every `chmodSync(` in the new files is `// root-safe`.

- [ ] **Step 5: Commit.**
  - `git add tests/helpers/path-stub.js tests/path-stub-helper.test.js`
  - `git commit -m "Add the path-stub test helper — STUB_SKIP, installStub, pathWithOnly (refs #4285)"`

### Task 2: Stub suites onto `installStub` + `STUB_SKIP` [batch]

**Files:**
- Modify: `tests/bin-lib/docs-health/freshness.test.js`
- Modify: `tests/bin-lib/harness-health/cli-next-target.test.js`
- Modify: `tests/bin-lib/journey-health/cli-next-target.test.js`
- Modify: `tests/bin-lib/reconcile/prune-remote.test.js`
- Modify: `tests/bin-lib/reconcile/reap-merged.test.js`
- Modify: `tests/reconcile.test.js`

**Interfaces:**
- Consumes: `STUB_SKIP` and `installStub` from Task 1 (`require('{relative}/helpers/path-stub')`).

**Rule for every file.** A local helper or test body that writes a `#!/bin/sh` script, chmods it, and prepends its directory to `PATH` switches to `installStub(name, script)`. Its caller's `finally` calls the returned restore. Log and marker files the script writes move to their own `mkdtemp` path, because the stub directory is owned by `installStub`. A spawn that passed `env: { ...process.env, PATH: \`${dir}:${process.env.PATH}\` }` now installs first and passes `env: { ...process.env }`, and the `:`-join disappears. A helper that writes several stubs calls `installStub` once per name.

**Tests that gain `{ skip: STUB_SKIP }`** (34 failing tests, by title; lines at `ea728f9e8`). Every other test keeps its options unchanged.

| File | Tests |
|---|---|
| freshness | `checkTrackedFreshness spawns exactly one git subprocess for multiple tracked files (regression: previously one spawn per file)` (:161) |
| harness-health cli-next-target | `next-target (default no --target path) fetches durable state exactly once, not twice` (:198); `next-target --kind memory fetches durable state exactly once, not twice` (:217) |
| journey-health cli-next-target | `next-target (default no --target path) fetches durable state exactly once, not twice` (:158) |
| prune-remote | `pruneRemote: multiple prunable branches are deleted with ONE push call, not one per branch` (:373); `pruneRemote: a failed batch push falls back to per-branch deletes, one bad ref does not swallow the rest` (:389); `pruneRemote: a genuine per-branch delete failure still reports delete-failed` (:460) |
| reap-merged | :100 `a merged-PR worktree is removed…`; :122 `#2783 … formal run…`; :140 `a closed-unmerged PR is skipped…`; :161 `#4180 reapMerged: a dry run reports a closed-unmerged skip…`; :204, :219, :233 (the three `#1793` tests); :296 `removal-failed tracks a consecutive-failure streak…`; :333 `removal-failed threads git's real stderr…`; :357 `a pass processing 2 removal-failed worktrees…`; :399 `removal-failed reads git status --porcelain exactly once…`; :419 `a successful removal performs no git status --porcelain read`; :785 `#2566: a DIRTY worktree at a long path on win32 is never force-removed…`; :803 `#2566: a locked worktree on win32 is never force-removed…`; :842 `#2566: the fallback is never attempted on a non-win32 platform…` |
| reconcile | :990 `an archive merged-partial skip carries unclosed…`; :1041 `an archive tiebreak-coverage-missing skip…`; :1330 `red-tip requested alone pulls in mirror's fetch…`; :1550 `AC2 end to end (#3630)…`; :1558 and :1565 (the two `#4202 end to end` tests); :2372 `mirror and remote-prune share one fetch…`; :2468, :2485, :2512, :2522 (the four `sharedFetch`/`sharedFetchAsync` tests); :2566 `a FAST_CHECKS pass…` |

That is 1 + 2 + 1 + 3 + 15 + 12 = 34: the record's 32, plus two reap-merged stub tests that windows-regression run 40335066805 (7649696f1) shows failing at base but that postdate the record's 988cc584d snapshot (:161 `#4180 … dry run`, :785 `#2566 … DIRTY … long path`; both call `installGhWrapper`). Not this class, and left untouched: `attemptLongPathRemoval: on win32, a LONG-path worktree git refused (locked)…` (it writes no stub) and reconcile's `archiveRunDir: the git mv of work/ is committed…`.

**Constants:** delete `PATH_STUB_SKIP` in `reap-merged.test.js:19` and `reconcile.test.js:24`, and point their existing uses (`reap-merged` :876, `reconcile` :2998) at `STUB_SKIP`.

- [ ] **Step 1: Record the baseline.**
  - Run `node --test {the 6 files}`.
  - Write down `# tests`, `# pass` and `# skipped`.
- [ ] **Step 2: Apply the rule, the skip table and the constant swap** to the 6 files.
- [ ] **Step 3: Re-run the same command.**
  - Expected: the same `# tests` and `# pass` as the baseline, `# skipped` unchanged on POSIX, and `# fail 0`.
  - Also run `git grep -n "PATH_STUB_SKIP" -- tests/reconcile.test.js tests/bin-lib/reconcile/reap-merged.test.js`. It should print nothing.
  - And run `git grep -nE "\}:\\$\{process\.env\.PATH" -- tests/bin-lib/harness-health tests/bin-lib/journey-health`. It should print nothing.
- [ ] **Step 4: Commit one file group per commit**, each with the subject form `Move {suite} PATH stubs onto installStub with STUB_SKIP (refs #4285)`.

### Task 3: Symlink-PATH suites onto `pathWithOnly` [batch]

**Files:**
- Modify: `tests/bin-lib/release-preflight/acceptance.test.js:13-27` — `ghAbsentBinDir()` and `BIN_DIR` → `const BIN_PATH = pathWithOnly(['git', 'node'], { exclude: ['gh'] })`. `ENV.PATH = BIN_PATH`.
- Modify: `tests/bin-lib/release-preflight/cli.test.js:14-22` — the same replacement. Its spawn of `'node'` (lines 117-120) keeps resolving through `BIN_PATH`.
- Modify: `tests/integration-model.test.js:22-35` — `ghAbsentPath()` returns `pathWithOnly(['git'], { exclude: ['gh'] })`. Rewrite its comment to describe the helper, keeping the Homebrew shared-directory reason.

**Interfaces:**
- Consumes: `pathWithOnly` from Task 1.

No test here gains a skip. These 8 failing tests (`acceptance` AC 1/2/8, `cli` "the real binary: exit 0 …", and `integration-model` :88, :114, :165, :179) are expected to pass on Windows once `which` and the extensionless symlink are gone.

- [ ] **Step 1: Record the baseline**, `node --test` over the 3 files.
- [ ] **Step 2: Apply the replacements.** Remove the now-unused `execFileSync('which', …)` calls and `symlinkSync` imports where nothing else uses them.
- [ ] **Step 3: Re-run.** Expected: the same `# tests` and `# pass`, `# skipped 0`, `# fail 0`.
- [ ] **Step 4: Commit** `Build the gh-absent PATH with pathWithOnly in release-preflight and integration-model (refs #4285)`.

### Task 4: Constants, the delimiter join, the PATH scan, and the parity skill

**Files:**
- Modify: `tests/bin-lib/reconcile/pr-state.test.js:14` — delete `PATH_STUB_SKIP`, import `STUB_SKIP`, and rename every `{ skip: PATH_STUB_SKIP }` to `{ skip: STUB_SKIP }`.
- Modify: `tests/bin-lib/reconcile/release-merged.test.js:16` — the same swap.
- Modify: `tests/bin-lib/reconcile/archive-merged.test.js:32` — the same swap (a scope addition: see Rulings).
- Modify: `tests/issue-branch-tracking.test.js:240` — `` `${binDir}${path.delimiter}${process.env.PATH}` ``.
- Modify: `tests/path-stub-helper.test.js` — add the scan.
- Modify: `.claude/skills/windows-checkout-test-parity/SKILL.md:179` — the PATH-stub row.

**Interfaces:**
- Consumes: `STUB_SKIP` from Task 1.
- Produces: `findColonPathJoins(text: string): number[]`, exported from `tests/helpers/path-stub.js`. It returns 1-based line numbers whose line matches `/PATH[^\n]*`[^`\n]*\}:\$\{/` (a PATH template literal joining with `:`) or `/PATH[^\n]*\.join\(\s*['"]:['"]\s*\)/`. Both are case-sensitive, so `pathParts.join(':')` never matches.

- [ ] **Step 1: Write the failing tests** in `tests/path-stub-helper.test.js`:
  - `'AC3.1: no test file joins PATH with a literal colon'`: walk `tests/**/*.js` except `node_modules`. Collect `${rel}:${line}` for every `findColonPathJoins` hit, and `assert.deepStrictEqual(hits, [])`.
  - `'AC3.1 self-check: the scan flags a doctored colon join and passes a non-PATH join'`:
    - Build the doctored fixture by concatenation, so this file's own source never contains the pattern: `const bad = 'PATH: `${dir}' + ':' + '${process.env.PATH}`'`.
    - `assert.deepStrictEqual(findColonPathJoins(bad), [1])`.
    - `assert.deepStrictEqual(findColonPathJoins("const targetPath = pathParts.join(':');"), [])`.
    - `assert.deepStrictEqual(findColonPathJoins('PATH: `${dir}${path.delimiter}${process.env.PATH}`'), [])`.
- [ ] **Step 2: Run it** with `node --test tests/path-stub-helper.test.js`. Expected: FAIL. `findColonPathJoins` is not a function, and the AC3 scan names `tests/issue-branch-tracking.test.js:240`.
- [ ] **Step 3: Implement `findColonPathJoins`**, fix the `issue-branch-tracking` join, and swap the three constants.
- [ ] **Step 4: Rewrite the parity skill row at :179.** Keep the cause and the "leave the tests that remove `gh` from `PATH` running" rule, and replace the per-file-constant advice:
  - A test that writes a stub on `PATH` uses `installStub` and `{ skip: STUB_SKIP }` from `tests/helpers/path-stub.js`.
  - A test that needs a PATH holding only real binaries uses `pathWithOnly`, and keeps running on Windows.
  - `tests/path-stub-helper.test.js` keeps `:`-joined PATHs out of `tests/`.
  - Keep "Judge each test by whether it writes a stub, not by its title", amended to "and whether its assertion depends on the stub running".
- [ ] **Step 5: Run the checks.**
  - Run `node --test tests/path-stub-helper.test.js tests/bin-lib/reconcile/pr-state.test.js tests/bin-lib/reconcile/release-merged.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/issue-branch-tracking.test.js`. Expected: `# fail 0`, with pass and skip counts equal to their pre-change baseline.
  - Run `git grep -n "PATH_STUB_SKIP" -- tests .claude`. Expected: no output.
- [ ] **Step 6: Commit** `Share STUB_SKIP across the reconcile suites, join PATH with path.delimiter, and scan for colon joins (refs #4285)`.

### Task 5: Controller verification (not dispatched)

- [ ] AC1.1: run `node --test` over the 14 Key Files plus `tests/bin-lib/reconcile/archive-merged.test.js` and `tests/permission-sim-root-skip-conformance.test.js`. Expect `# fail 0`, and a `# skipped` total equal to the baseline sum.
- [ ] Full `verify.js --cmd tests="npm test"` (build Common Step 5).
- [ ] AC4.1: after the last code change, dispatch `gh workflow run windows-regression.yml --ref flow/spec-4290-4285-4396`. Read `verify-report.json` and each of the 9 files' isolated logs. Expect:
  - 0 failures among the 40 titles.
  - Each stub skip reads `win32: execFile resolves only .exe/.com on PATH, so a script stub is never spawned`.
  - The 8 `pathWithOnly` tests show `ok`.
  - No file in `baselineAdjudicated.new`.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (`path-stub.js` with 3 exports) | 1 |
| Deliverable 2 (symlink tests → `pathWithOnly`; stub tests → `installStub` + `STUB_SKIP`; replace each `PATH_STUB_SKIP`) | 2, 3, 4 |
| Deliverable 3 (`path.delimiter` at `issue-branch-tracking.test.js:240`) | 4 |
| AC1.1 | 2 Step 3, 3 Step 3, 4 Step 5, 5 |
| AC2.1 | 1 |
| AC3.1 | 4 |
| AC4.1 | 5 |
| Gotcha: blocked by #3315 | satisfied: #3315 merged at f5c33d2c0, and `cloud-setup-drift-check.test.js` already uses `path.delimiter` (the Task 4 scan proves it) |
| Gotcha: the `git.exe` assumption | Task 1's symlink fallback covers both outcomes; the AC4 run is the probe |
