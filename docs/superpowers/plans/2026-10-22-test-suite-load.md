# Test-Suite Machine Load Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `npm test` from overloading the dev machine: isolate and clean each run's temp files, cap concurrent suites machine-wide, halve per-suite worker count, and remove the `npx` spawn from every SessionStart.

**Architecture:** `tools/run-tests.js` gains small exported, injectable helpers (concurrency/slot resolution, a lock-file slot semaphore, a per-run temp root with stale sweep) wired into its existing `spawnSync` main block with a `finally` cleanup. `plugin/bin/lib/deps.js` swaps its `npx --no-install playwright-cli --version` probe for a pure PATH lookup.

**Tech Stack:** Node (CommonJS, no deps), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T162117-spec-3969/work/3969-spec.md`

Scope keywords: run-tests, playwrightCliMessage, availableParallelism

## Global Constraints

- Env vars, exact names: `CT_TEST_SUITE_SLOTS` (default 1), `CT_TEST_CONCURRENCY` (default `max(1, floor(os.availableParallelism() / 2))`), `CT_TEST_SUITE_SLOT_DIR` (lock dir override, default `<realTmp>/ct-test-suite-slots`), `CT_TEST_SUITE_SLOT_HELD` (set to `1` in the child env; a run that sees it skips slot acquisition).
- Temp root name: `ct-testrun-<pid>-XXXXXX` under the real `os.tmpdir()` captured before any env override; exported to the child as `TMPDIR`, `TMP`, `TEMP` only — the parent's own `process.env` is not mutated.
- Keep `spawnSync` in `tools/run-tests.js` (the `tests/fixtures/run-tests/win32-node20-preload.js` tripwire depends on it).
- Slot acquisition happens only after `buildTestArgs` succeeds; the win32/Node-20 preload test must still see exit 1, exactly one stderr line, empty stdout.
- `--test-concurrency=<n>` is passed on both `buildTestArgs` branches (CI is Node 20.x, which supports it).
- `deps.js` playwright check spawns no subprocess.
- Every new test is proven red by reverting its change before commit.

## Review Focus

1. A test inside a running suite spawns `tools/run-tests.js` (the preload test does) → it must not wait on the slot its own parent holds. Pinned by Task 4's nested-run test.
2. A suite killed with SIGKILL leaves a lock and a temp root behind → the next run must reclaim both without waiting. Pinned by Task 3's dead-pid reclaim and stale-sweep tests.
3. A lock file that is empty or corrupt (a crash between create and write) → it must not block forever. Pinned by Task 3's unparseable-and-old test.
4. Ctrl-C during a run → the temp root and lock must still be removed. Covered by the `finally` plus the signal handlers in Task 4 (manual check noted in Task 4 Step 6).
5. A project-local `node_modules/.bin/playwright-cli` with nothing on PATH → still reported installed, as `npx --no-install` did. Pinned by Task 1.

## Acceptance-criteria coverage

| AC | Covered by |
|---|---|
| After a full `npm test`, the real `os.tmpdir()` holds no new entries whose names match a test `mkdtemp` prefix, and no `ct-testrun-*` root remains. | Task 4 process-level test (TMPDIR is the run root, removed on exit); confirmed at Common Step 5 by counting `ct-*` entries in the real tmpdir before/after the full run |
| With two concurrent `npm test` invocations, the second waits for the slot and prints the holder's pid. | Task 3 `acquireSlot waits for a live holder, logs once, then acquires` |
| A lock file left by a dead pid is reclaimed, not waited on. | Task 3 `acquireSlot reclaims a dead holder's lock without sleeping` |
| `deps.collect()` spawns no subprocess for the playwright check: a PATH containing a `playwright-cli` executable reports it installed, and a PATH without one returns the install message. | Task 1 tests |
| Unit tests cover the new `run-tests.js` helpers (temp-root lifecycle, slot acquire/reclaim, concurrency default and env override) and the `deps.js` PATH lookup, and each was proven red by reverting the change. | Tasks 1-4, each task's "Prove red by revert" step |
| The full suite is green. | Common Step 5 (`plugin/bin/verify.js`) |

**Audit notes.** Check B's scope-keyword hits outside this plan (`package.json`, `.github/workflows/windows-regression.yml`, `tests/bin-lib/verify/run.test.js`, `tests/wall-clock-budget-conformance.test.js`, `tests/fixtures/run-tests/win32-node20-preload.js`, `tests/bin-lib/docs-health/commit-fixtures.js`, and three docs/journeys/plans) only mention `run-tests`; none needs a change. Windows: `os.tmpdir()` reads `TEMP`/`TMP`, both exported; `process.kill(pid, 0)` and `Atomics.wait` work there.

---

### Task 1: PATH lookup for playwright-cli in deps.js

**Files:**
- Modify: `plugin/bin/lib/deps.js` (`playwrightCliMessage`, exports)
- Test: `tests/lib.test.js` (next to the existing `deps:` tests)
- Test: `tests/hooks-session-start.test.js` (run unchanged — it must still pass and no longer spawn npx)

**Interfaces:**
- Produces: `findOnPath(name: string, { env, platform, cwd }): string | null` (absolute path of the first hit, or null), exported from `deps.js`; `playwrightCliMessage()` keeps its signature and return values.

- [ ] **Step 1: Write the failing tests** in `tests/lib.test.js`, each building a temp dir under `os.tmpdir()` and removing it in `finally`:
  - `deps: findOnPath finds an executable on PATH` — dir with `playwright-cli` (mode `0o755`); `findOnPath('playwright-cli', { env: { PATH: dir }, platform: 'darwin', cwd: emptyDir })` equals `path.join(dir, 'playwright-cli')`.
  - `deps: findOnPath finds a project-local node_modules/.bin install first` — `cwd/node_modules/.bin/playwright-cli` (0o755), PATH empty → returns that path.
  - `deps: findOnPath ignores a non-executable file on POSIX` — mode `0o644` → `null`.
  - `deps: findOnPath tries PATHEXT on win32` — dir with `playwright-cli.cmd` (mode irrelevant); `{ env: { PATH: dir, PATHEXT: '.EXE;.CMD' }, platform: 'win32' }` → `path.join(dir, 'playwright-cli.cmd')`.
  - `deps: playwrightCliMessage never spawns a subprocess` — mirror the existing `has('node')` guard: replace `execSync`, `execFileSync`, `spawnSync` on `node:child_process` with throwing stubs, re-require `deps` fresh, call `playwrightCliMessage()` (result is a string or null — no throw), restore in `finally`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/lib.test.js`
Expected: FAIL — `findOnPath is not a function`, and the no-subprocess test throws from the stubbed `execSync`.

- [ ] **Step 3: Implement `findOnPath`** in `deps.js`: candidate dirs = `path.join(cwd, 'node_modules', '.bin')` then `env.PATH` (or `env.Path`) split on `path.delimiter` — use `';'` when `platform === 'win32'`, since `path.delimiter` reflects the host; names = `[name]` plus, on win32, `name + ext` for each `PATHEXT` entry (default `.COM;.EXE;.BAT;.CMD`); a hit is `fs.statSync(p).isFile()` and (`platform === 'win32'` or `mode & 0o111`); swallow stat errors. `playwrightCliMessage()` calls `findOnPath('playwright-cli', { env: process.env, platform: process.platform, cwd: process.cwd() })`. Add a one-line why-comment (npx boots a whole npm CLI per SessionStart — ~2 CPU-s). Export `findOnPath`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/lib.test.js tests/hooks-session-start.test.js`
Expected: PASS (both files, 0 fail).

- [ ] **Step 5: Prove red by revert** — temporarily restore the npx line by hand (never `git stash`: the stash stack is shared across worktrees), rerun `node --test tests/lib.test.js`, see the no-subprocess test fail, re-apply.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/deps.js tests/lib.test.js
git commit -m "Replace SessionStart's npx playwright-cli probe with a PATH lookup — refs #3969"
```

### Task 2: Concurrency + slot-count resolution, concurrency in buildTestArgs, absolute roots

**Files:**
- Modify: `tools/run-tests.js` (`listTestFiles`, `buildTestArgs`, new helpers, exports)
- Modify: `tests/package-json-test-script.test.js` (existing `buildTestArgs` pins at ~lines 140-177)
- Create: `tests/run-tests-isolation.test.js`

**Interfaces:**
- Produces: `resolveConcurrency(env: object, cpus: number): number`; `resolveSlots(env: object, log: (line) => void): number`; `buildTestArgs(files, roots, { platform, nodeMajor, concurrency })` — returns `['--test', '--test-concurrency=<n>', ...]` on both branches; `listTestFiles(cwd, roots)` resolves each root with `path.resolve(base, root)` so absolute roots work.

- [ ] **Step 1: Write the failing tests** in `tests/run-tests-isolation.test.js`:
  - `resolveConcurrency defaults to half the cores, at least 1` — `({}, 12) === 6`, `({}, 1) === 1`, `({}, 3) === 1`.
  - `resolveConcurrency honors a positive-integer CT_TEST_CONCURRENCY` — `({ CT_TEST_CONCURRENCY: '3' }, 12) === 3`.
  - `resolveConcurrency ignores an invalid CT_TEST_CONCURRENCY` — `'0'`, `'-2'`, `'abc'`, `'2.5'` → `6` for 12 cpus.
  - `resolveSlots defaults to 1` and `honors CT_TEST_SUITE_SLOTS=3`; `an invalid value falls back to 1 and logs one line naming CT_TEST_SUITE_SLOTS` (collect `log` calls; length 1, matches `/CT_TEST_SUITE_SLOTS/`).
  - `listTestFiles accepts an absolute root` — temp dir with `a.test.js` and `b.js`; `listTestFiles(REPO_ROOT, [tmp])` equals `[path.join(tmp, 'a.test.js')]`.
  Update the existing `buildTestArgs` pins in `tests/package-json-test-script.test.js` to pass `concurrency: 4` and expect `'--test-concurrency=4'` as the second element on both the POSIX and win32 branches.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/run-tests-isolation.test.js tests/package-json-test-script.test.js`
Expected: FAIL — `resolveConcurrency is not a function`; the updated pins fail on the missing `--test-concurrency=4`.

- [ ] **Step 3: Implement** the two resolvers (positive integer = `/^[1-9]\d*$/`), add `concurrency` to `buildTestArgs` (validate it is a positive integer, throw otherwise), switch `listTestFiles` to `path.resolve`. Export the new helpers.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/run-tests-isolation.test.js tests/package-json-test-script.test.js tests/wall-clock-budget-conformance.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 5: Prove red by revert** (temporarily drop the `--test-concurrency` element and the `path.resolve` change; the matching tests fail; re-apply).

- [ ] **Step 6: Commit**

```bash
git add tools/run-tests.js tests/run-tests-isolation.test.js tests/package-json-test-script.test.js
git commit -m "Add run-tests.js concurrency and slot resolution — refs #3969"
```

### Task 3: Suite-slot lock and per-run temp root helpers

**Files:**
- Modify: `tools/run-tests.js`
- Test: `tests/run-tests-isolation.test.js`

**Interfaces:**
- Consumes: `resolveSlots` (Task 2).
- Produces:
  - `isPidAlive(pid: number): boolean` — `process.kill(pid, 0)`; `ESRCH` → false, `EPERM` → true.
  - `acquireSlot({ dir, slots, pid, cwd, isAlive, now, sleep, log, pollMs = 2000, staleUnparseableMs = 600000 }): string` — returns the lock path it created. Lock files are `slot-<i>.lock` (i in `0..slots-1`), created with flag `wx`, content `JSON.stringify({ pid, startedAt: new Date(now()).toISOString(), cwd })`. A lock whose JSON names a dead pid, or that is unparseable and has mtime older than `staleUnparseableMs`, is unlinked and retried. When every slot is held by a live pid, it logs once — `run-tests.js: waiting for a test-suite slot — held by pid <pid> (cwd <cwd>) since <startedAt>; set CT_TEST_SUITE_SLOTS to raise the limit` — then calls `sleep(pollMs)` and rescans.
  - `releaseSlot(lockPath: string, pid: number): void` — unlinks only when the file still parses and names `pid`; never throws.
  - `createRunRoot(realTmp: string, pid: number): string` — `fs.mkdtempSync(path.join(realTmp, 'ct-testrun-' + pid + '-'))`.
  - `sweepStaleRoots({ dir, isAlive }): string[]` — removes (`fs.rmSync` recursive, force) every `ct-testrun-<pid>-*` directory in `dir` whose pid is not alive; returns the removed paths; never throws on a single entry.

- [ ] **Step 1: Write the failing tests** (each with its own temp `dir`, cleaned in `finally`; `isAlive` injected as a Set lookup):
  - `acquireSlot takes a free slot` — returns `<dir>/slot-0.lock`; content parses to `{ pid: 111 }`.
  - `acquireSlot reclaims a dead holder's lock without sleeping` — pre-write `slot-0.lock` for pid 222 (not alive); `sleep` stub throws if called; returns `slot-0.lock`, now naming 111.
  - `acquireSlot reclaims an old unparseable lock` — empty `slot-0.lock` with mtime set 11 minutes back (`fs.utimesSync`) → acquired; and `a fresh unparseable lock is waited on, not reclaimed` (mtime now; the `sleep` stub deletes it on first call → acquired after exactly 1 sleep).
  - `acquireSlot waits for a live holder, logs once, then acquires` — `slot-0.lock` for live pid 333; `sleep` stub deletes it on the 2nd call; assert 2 sleeps, `log` called exactly once with the message containing `pid 333`.
  - `acquireSlot uses a second slot when slots=2` — slot-0 held live → returns `slot-1.lock`, no sleep.
  - `releaseSlot leaves another pid's lock alone` — lock names 444; `releaseSlot(path, 111)` → file still exists; `releaseSlot(path, 444)` → gone.
  - `sweepStaleRoots removes dead-pid roots and keeps live ones` — dirs `ct-testrun-555-aaaaaa` (dead), `ct-testrun-666-bbbbbb` (alive), `other-dir` → only the first removed; returned array has 1 entry.
  - `isPidAlive is true for this process and false for an exited child` — spawnSync a `node -e 0`, use its pid.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/run-tests-isolation.test.js`
Expected: FAIL — `acquireSlot is not a function`.

- [ ] **Step 3: Implement** the five helpers in `tools/run-tests.js` per the Interfaces block; `mkdirSync(dir, { recursive: true })` inside `acquireSlot`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/run-tests-isolation.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 5: Prove red by revert** (temporarily make the dead-pid branch not unlink → the reclaim test fails via the throwing `sleep`; re-apply).

- [ ] **Step 6: Commit**

```bash
git add tools/run-tests.js tests/run-tests-isolation.test.js
git commit -m "Add run-tests.js suite-slot lock and per-run temp root helpers — refs #3969"
```

### Task 4: Wire isolation into run-tests.js's main block; docs

**Files:**
- Modify: `tools/run-tests.js` (main block, header comment)
- Modify: `docs/plugin-structure.md` (the `tools/` line and the `npm test` command line)
- Create: `tests/fixtures/run-tests/tmpdir-probe.fixture.js` (not `*.test.js`, so the real suite never collects it)
- Test: `tests/run-tests-isolation.test.js`

**Interfaces:**
- Consumes: everything from Tasks 2-3.

- [ ] **Step 1: Write the failing process-level tests.** The fixture, when run as a test, writes `os.tmpdir()` and `process.env.CT_TEST_SUITE_SLOT_HELD` as JSON to `process.env.CT_PROBE_OUT`, inside one passing `test()`. Each test copies it into a fresh temp root as `probe.test.js`, then spawns `process.execPath tools/run-tests.js <absTempRoot>` from `REPO_ROOT` with env `{ ...process.env, CT_PROBE_OUT, CT_TEST_SUITE_SLOT_DIR: <private temp dir> }` and `CT_TEST_SUITE_SLOT_HELD` deleted:
  - `run-tests.js runs the suite under a ct-testrun-* TMPDIR it removes on exit` — exit 0; recorded tmpdir basename matches `/^ct-testrun-\d+-/`; `fs.existsSync(recorded) === false`; recorded `CT_TEST_SUITE_SLOT_HELD === '1'`; the private slot dir holds no `slot-*.lock`.
  - `a nested run with CT_TEST_SUITE_SLOT_HELD=1 skips the slot` — pre-create `slot-0.lock` in the private dir naming `process.pid` (alive, so it would block); spawn with `CT_TEST_SUITE_SLOT_HELD=1` and a 60 s `timeout`; exit 0 (no wait), and the pre-created lock is untouched.
  - The existing preload test in `tests/package-json-test-script.test.js:179` stays as it is and must still pass.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/run-tests-isolation.test.js`
Expected: FAIL — the recorded tmpdir is the real tmpdir, not `ct-testrun-*`.

- [ ] **Step 3: Implement the main block**, in this order after `buildTestArgs` succeeds: capture `realTmp = os.tmpdir()`; `sweepStaleRoots({ dir: realTmp, isAlive: isPidAlive })`; unless `process.env.CT_TEST_SUITE_SLOT_HELD === '1'`, `acquireSlot({ dir: env.CT_TEST_SUITE_SLOT_DIR || path.join(realTmp, 'ct-test-suite-slots'), slots: resolveSlots(process.env, console.error), pid: process.pid, cwd: REPO_ROOT, isAlive: isPidAlive, now: Date.now, sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms), log: console.error })`; `runRoot = createRunRoot(realTmp, process.pid)`; install `SIGINT`/`SIGTERM`/`SIGHUP` handlers that record the signal (no exit); `spawnSync(process.execPath, testArgs, { cwd: REPO_ROOT, stdio: 'inherit', env: { ...process.env, TMPDIR: runRoot, TMP: runRoot, TEMP: runRoot, CT_TEST_SUITE_SLOT_HELD: '1' } })`; in `finally`, `fs.rmSync(runRoot, { recursive: true, force: true })` (catch and print one line on failure) and `releaseSlot`. Exit: recorded signal → `128 + os.constants.signals[sig]`; otherwise the existing status rule. Pass `concurrency: resolveConcurrency(process.env, os.availableParallelism())` into `buildTestArgs`. Rewrite the file's header comment to add one paragraph on why: concurrent suites and leaked fixtures made the dev machine unusable (#3969); name the four env vars.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/run-tests-isolation.test.js tests/package-json-test-script.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 5: Prove red by revert** (temporarily drop `TMPDIR` from the child env → the first test fails; drop the HELD check → the nested test times out; re-apply).

- [ ] **Step 6: Manual Ctrl-C check** (not committed): run `node tools/run-tests.js <absTempRoot with a test that sleeps 30s>`, press Ctrl-C, confirm with `ls "$(node -p 'require(\"os\").tmpdir()')" | grep ct-testrun-` that no root for that pid remains, and no lock remains in the slot dir.

- [ ] **Step 7: Docs** — in `docs/plugin-structure.md`, extend the `tools/` line's `run-tests.js` description and the `npm test` command comment with one sentence each: per-run `TMPDIR` removed on exit, one suite at a time machine-wide (`CT_TEST_SUITE_SLOTS`), `--test-concurrency` half the cores (`CT_TEST_CONCURRENCY`).

- [ ] **Step 8: Commit**

```bash
git add tools/run-tests.js tests/run-tests-isolation.test.js tests/fixtures/run-tests/tmpdir-probe.fixture.js docs/plugin-structure.md
git commit -m "Run each test suite in its own TMPDIR behind a machine-wide slot — refs #3969"
```
