# Windows Stub-Dependent Test Skips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every test that installs a fake `git`/`gh` on PATH either skips on win32 with `STUB_SKIP` when its assertion depends on the stub running, or carries a comment saying why it holds whatever answers on PATH; the single-stub hand-rolled `gh` wrappers in console-execute, timing/cli and hooks-resolve-console move onto the shared helper.

**Architecture:** `tests/helpers/path-stub.js` gains a platform-injected `stubSkipFor(platform)` (so the `STUB_SKIP` pin can assert the win32 value without stubbing `process.platform`) and a `writeStubDir(name, script)` primitive that `installStub` is rebuilt on. `writeStubDir` also returns the ready-made env PATH value (`envPath`), for tests that inject PATH through an `env` object rather than `process.env` (spec Decision 1). Each stub-installing test in the nine audited suites is then judged one at a time.

**Tech Stack:** Node 18+ `node:test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T130438-record-4433/work/4433-spec.md` (read its `## Decisions` section: it overrides the Deliverables and Key Files where they differ)

Scope (spec Decision 3): the six suites named at filing, at their post-split paths (`tests/reconcile.test.js`, `tests/reconcile-dispatch.test.js`, `tests/reconcile-archive-residue.test.js`, `tests/reconcile-preflight-fetch.test.js`, `tests/bin-lib/reconcile/prune-remote.test.js`, `tests/bin-lib/reconcile/reap-merged.test.js`), plus the three files this build moves onto the helper (`tests/console-execute.test.js`, `tests/bin-lib/timing/cli.test.js`, `tests/hooks-resolve-console.test.js`). Other suites that use the stub helpers are out of scope.

Waived `tests/reconcile.test.js`: read by the Task 5 audit only — it has no unjudged stub test left (its cited groups moved to `tests/reconcile-dispatch.test.js` / `tests/reconcile-archive-residue.test.js` in the split).
Waived `tests/reconcile-preflight-fetch.test.js`: read by the Task 5 audit only — the audit finds no unjudged stub test in it.
Waived `tests/bin-lib/reconcile/archive-merged.test.js`: out of scope per spec Decision 2 (`installGhWrapper` in `archive-merged-helpers.js` is the multi-stub shape the parity skill names; it stays hand-rolled and the parity skill's sentence is unchanged). Task 4 Step 3 still runs it, as a control that nothing it imports changed.

## Line drift since filing (read first)

The record's line numbers predate a split of `tests/reconcile.test.js`. The groups it names now live in:
- `reconcileWithAsyncMerge` / `withFetchArgvLog` → `tests/helpers/reconcile-fixtures.js`, used by `tests/reconcile-dispatch.test.js` and `tests/reconcile-archive-residue.test.js:36`
- `dryRunFixture` (#4180) and `ownerlessFixture` groups → `tests/reconcile-archive-residue.test.js`

The scratch audit (uncommitted; `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-26T130438-record-4433/evidence/stub-audit.js`, run as `node "{that path}" "{worktree}" {test files...}`; it now ends each test at its own column-0 `});` line, so a helper defined after a test is no longer counted as that test's stub) lists, at plan time, **49** stub-installing tests with neither `STUB_SKIP` nor a `Runs on win32:` comment: reconcile-dispatch 21, reconcile-archive-residue 14, prune-remote 1, reap-merged 3, console-execute 10. The timing/cli and hooks-resolve-console stubs are invisible to it today (they inject `env.PATH`); after Task 4 they install through `writeStubDir`, which the audit counts as an installer, so they join the list Task 5 checks. That list, not the record's 22, is the work list.

reap-merged's "stub install before a throwing call, outside the try" (the record's :287) is now five sites, each installing the gh wrapper and then running `git worktree lock` before `try`: :306, :343, :409, :815, :854. The record's reap-merged 746/810 are now :766 and :831 (`MID_DELETE_SKIP`).

## Global Constraints

- The skip reason string is exactly `win32: execFile resolves only .exe/.com on PATH, so a script stub is never spawned` (`STUB_SKIP_REASON`, unchanged).
- Comment convention for a stub-installing test that keeps running on win32: a line comment starting `// Runs on win32:` inside the test body or on the line directly above `test(`, followed by why its assertions hold whatever answers on PATH. The audit keys on that exact prefix.
- AC2.1 check (spec Decision 1, replacing the `mkdtemp` grep): a grep of the listed single-stub wrapper files (`tests/console-execute.test.js`, `tests/bin-lib/timing/cli.test.js`, `tests/hooks-resolve-console.test.js`) for `process.env.PATH =`, for `${path.delimiter}${process.env.PATH}`, and for `scratchDir`- or `mkdtemp`-made stub dirs comes back empty. Control run at plan time (the absence-grep control): `git grep -n -F -e 'process.env.PATH =' -e '${path.delimiter}${process.env.PATH}' -e "path.join(root, 'stub-bin')" -e "path.join(repo, 'stub-bin')" -e "scratchDir('ct-ce-ghwrap-')" -- tests/console-execute.test.js tests/bin-lib/timing/cli.test.js tests/hooks-resolve-console.test.js` matched 22 lines on the pre-change tree (e.g. `tests/console-execute.test.js:492`, `tests/hooks-resolve-console.test.js:22`, `tests/bin-lib/timing/cli.test.js:687`), so it can fail.
- Quoted from `.claude/skills/windows-checkout-test-parity/SKILL.md` (governs every test file here):
  - "A test that writes such a stub skips with `{ skip: STUB_SKIP }` from `tests/helpers/path-stub.js` (#4285), not with a per-file constant, and a new single-stub test installs it with that file's `installStub`. The multi-stub `gh` wrappers in `pr-state`, `release-merged` and `archive-merged` (`tests/bin-lib/reconcile/`) still write theirs by hand; they carry `STUB_SKIP` all the same."
  - "Leave the tests that remove `gh` from `PATH` running: they pass on Windows."
  - "Judge each test by whether it writes a stub and whether its assertion depends on the stub running, not by its title. When a test that already ran on win32 gains a stub only some of its assertions read (a call count, say), keep the test running and guard just those assertions with `if (!STUB_SKIP)`; `{ skip: STUB_SKIP }` is for a test whose subject is the stub running"
  - "Take `platform` and `env` as parameters, never stub `process.platform`" — `process.platform` "is process-global, so the stub leaks into every other test in the same worker."
  - "Check that a skip's reason is true of each test before attaching it."
- `tests/hooks-resolve-console.test.js` is also governed by `.claude/skills/hook-event-in-process-tests` (the event reads only the env its context carries): its stubs stay reachable **only** through the injected `env.PATH` (the `envPath` value), never by prepending `process.env.PATH`, or the AC6.1 "starts gh from the injected env PATH" test stops discriminating.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Project maturity is `established`: "For any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it — published or external consumers may depend on them." Here the pre-existing behavior is `installStub`'s contract, already pinned by `tests/path-stub-helper.test.js`'s three installStub tests; Task 1 keeps them unchanged and green as that characterization.

## Review Focus

1. A `git` shim from `withFetchArgvLog` that never runs on win32 makes `fetchCalls` come back `[]` — a test asserting `fetchCalls` deep-equals `[]` passes vacuously there; it must skip (or guard that assertion with `if (!STUB_SKIP)` when its other assertions hold).
2. A test whose stub answers `gh` with a canned PR state and asserts an outcome only that state produces (reaped, skipped `own-cwd` after a MERGED lookup) — on win32 real `gh` answers; check whether the outcome still holds (e.g. `own-cwd` is decided before any PR lookup) before choosing a comment over a skip.
3. `MID_DELETE_SKIP` tests on win32: both the chmod and the stub fail there; the skip must name the stub reason when the stub is what fails first.
4. A test that injects PATH through `env` must keep doing so with `writeStubDir`'s `envPath`; switching it to `installStub` (which edits `process.env.PATH`) silently weakens an injected-env test.
5. A moved stub install must still be restored when the call before the `try` throws (the five reap-merged sites).

---

### Task 1: path-stub helper — `stubSkipFor`, `writeStubDir`, pin gaps

**Role:** integration

**Files:**
- Modify: `tests/helpers/path-stub.js`
- Test: `tests/path-stub-helper.test.js`

**Interfaces:**
- Produces: `stubSkipFor(platform: string): false | string` — `platform === 'win32' && STUB_SKIP_REASON`; `STUB_SKIP = stubSkipFor(process.platform)`.
- Produces: `writeStubDir(name: string, script: string): { dir: string, envPath: string, remove: () => void }` — creates a `scratchDir('ct-stub-')`, writes `name` with mode 0o755, removes the dir on a write failure (current `installStub` behavior) and on `remove()` (idempotent). `envPath` is `dir + path.delimiter + process.env.PATH`, or `dir` alone when `process.env.PATH` is undefined, read at call time. Does not touch `process.env.PATH`.
- Produces: `installStub(name, script)` — unchanged contract (returns `restore()`), now built on `writeStubDir`.

- [ ] **Step 1: Write the failing tests** in `tests/path-stub-helper.test.js`:
  - Rename `STUB_SKIP_REASON is the spec text, and STUB_SKIP is the reason on win32 only` to `AC4.1: STUB_SKIP_REASON is the spec text, and stubSkipFor gives the reason on win32 only` and add `stubSkipFor('win32') === STUB_SKIP_REASON`, `stubSkipFor('linux') === false`, `stubSkipFor('darwin') === false`, keeping `STUB_SKIP === stubSkipFor(process.platform)` (spec AC3.1's win32 `STUB_SKIP` assertion).
  - `test('writeStubDir writes an executable stub and its envPath without touching PATH, and remove() deletes the dir', …)`: `process.env.PATH` before === after; `fs.existsSync(path.join(dir, name))`; off win32 `(fs.statSync(file).mode & 0o111) !== 0`; `envPath === dir + path.delimiter + process.env.PATH`; after `remove()` the dir is gone; a second `remove()` does not throw.
  - `test('writeStubDir envPath is the dir alone when PATH is unset', …)`: save and `delete process.env.PATH` (restore in `t.after`), call, assert `envPath === dir`.
  - Retitle `pathWithOnly finds a PATHEXT extension on win32` to `pathWithOnly on win32 resolves only libuv's spawnable names (.com, .exe, bare), case-insensitively, not PATHEXT` (body unchanged — the lookup never consults PATHEXT).
  - `test('AC4.1: on win32 an excluded gh.CMD in the binary dir makes pathWithOnly leave that dir out', { skip: process.platform === 'win32' && 'win32: symlink creation needs privilege' }, …)`: dir `shared` holds `git.EXE` and `gh.CMD`; `pathWithOnly(['git'], { exclude: ['gh'], env: { Path: shared, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, platform: 'win32' })` returns a path `!== shared` whose `readdirSync` is `['git.EXE']`; clean the returned dir in `t.after`. Control in the same test: the same call with `gh.CMD` absent returns `shared`.
- [ ] **Step 2: Run** `node --test tests/path-stub-helper.test.js` — Expected: FAIL (`stubSkipFor`/`writeStubDir` not exported).
- [ ] **Step 3: Implement** `stubSkipFor` and `writeStubDir` in `tests/helpers/path-stub.js`, rebuild `installStub` on `writeStubDir` (its `restore()` calls `remove()`), export both, and extend the header comment by one sentence each (writeStubDir: for a test that hands the stub to the code under test through an injected `env.PATH`).
- [ ] **Step 4: Run** `node --test tests/path-stub-helper.test.js` — Expected: PASS, the three existing installStub tests unchanged and green. Then make `excluded(dir)` return false locally and confirm the gh.CMD test goes red; restore.
- [ ] **Step 5: Commit** — `git add tests/helpers/path-stub.js tests/path-stub-helper.test.js`; message `Add stubSkipFor and writeStubDir to the path-stub helper — win32 STUB_SKIP pin, gh.CMD exclude case, refs #4433`.

### Task 2: Judge the reconcile-dispatch and reconcile-archive-residue stub tests

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `tests/reconcile-dispatch.test.js` (21 tests: :256, :269, :284, :289, :304, :309, :316, :327, :342, :362, :368, :374, :382, :389, :398, :1004, :1025, :1034, :1051, :1091, :1104)
- Modify: `tests/reconcile-archive-residue.test.js` (14 tests: :36, :460, :484, :496, :506, :558, :589, :612, :646, :663, :696, :709, :748, :762)
- Read (not modified): `tests/helpers/reconcile-fixtures.js`, to learn that `reconcileWithAsyncMerge` installs only the `withFetchArgvLog` git shim (every other stub there is a module-property replacement that runs on win32).

**Interfaces:**
- Consumes: `STUB_SKIP` from `tests/helpers/path-stub.js` (Task 1 leaves its value unchanged).

For each listed test, decide by the Global Constraints rule:
- An assertion reads something only the stub produces (`fetchCalls`, a gh call log, a canned `gh` answer the outcome depends on) and the test's subject is that → add `{ skip: STUB_SKIP }` to its options.
- Its subject holds whatever answers on PATH, but one or two assertions read the stub (e.g. a `fetchCalls` line in an order test) → keep it running, wrap just those assertions in `if (!STUB_SKIP) { … }`, and add a `// Runs on win32:` comment naming what holds.
- No assertion reads the stub → add a `// Runs on win32:` comment saying why (e.g. "the git shim only logs fetches; these assertions read the module-stub call order").
- For `withBranchCheckStubs` (:1091/:1104) and `dryRunFixture`/`ownerlessFixture`, read the local helper first to see which stub it installs.

- [ ] **Step 1: Re-run the scratch audit** over the two files and confirm it lists the 35 tests above (line numbers may shift by the lines each edit adds; re-derive, never trust these numbers after the first edit).
- [ ] **Step 2: Apply the per-test decisions.** For every test that gets a skip, record one line in the commit body: `{file}:{line} skip — {assertion that reads the stub}`. For every comment, the comment itself is the record.
- [ ] **Step 3: Prove each skip is needed:** for three of the skipped tests (one per distinct stub kind), replace the stub script body with a pass-through / no-op locally and confirm the test goes red (or, for a `[]` assertion, stays green — which proves the vacuous pass and the need to skip); restore.
- [ ] **Step 4: Run** `node --test tests/reconcile-dispatch.test.js tests/reconcile-archive-residue.test.js` — Expected: PASS, no new skips on darwin/linux.
- [ ] **Step 5: Commit** both files; message `Judge the reconcile stub tests for win32 — STUB_SKIP where the assertion needs the stub, a comment where it holds, refs #4433`.

### Task 3: prune-remote and reap-merged stub tests, reap-merged try placement

**Role:** judgment

**Files:**
- Modify: `tests/bin-lib/reconcile/prune-remote.test.js` (:320)
- Modify: `tests/bin-lib/reconcile/reap-merged.test.js` (:187, :269, :589; install placement at :306, :343, :409, :815, :854; :766 and :831 skip reason)

**Interfaces:**
- Consumes: `STUB_SKIP` (Task 1).

- [ ] **Step 1: Judge** prune-remote :320 and reap-merged :187/:269/:589 per Task 2's rule. reap-merged :269/:589 assert `own-cwd`: read `plugin/bin/lib/reconcile/reap-merged.js`'s `decideReap` order to see whether `own-cwd` is decided before the PR lookup; if it is, the test holds on win32 → comment; else skip. :187 asserts a locked worktree is skipped with no event: same check for the lock verdict's position. prune-remote :320 is the batch-fail fallback test (its `installPushWrapper` git shim fails the batch push) → skip unless its assertions hold without the stub.
- [ ] **Step 2: Move the install directly before `try`** at :306, :343, :409, :815 and :854: install the gh wrapper after the `git worktree lock` / `fs.writeFileSync` / spy setup lines, so a throwing setup call leaves no stub on PATH.
- [ ] **Step 3: :766 and :831** — change the options to `{ skip: STUB_SKIP || MID_DELETE_SKIP.skip }` (the stub fails first on win32; root still skips on the chmod reason off win32). Read `chmodDenialSkip`'s return shape first and keep whatever other option it carries.
- [ ] **Step 4: Run** `node --test tests/bin-lib/reconcile/prune-remote.test.js tests/bin-lib/reconcile/reap-merged.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** both files; message `Judge the prune-remote and reap-merged stub tests for win32 and install reap stubs after throwing setup, refs #4433`.

### Task 4: Move the single-stub hand-rolled gh wrappers onto the helper

**Role:** integration

**Files:**
- Modify: `tests/console-execute.test.js` (`withFakeGh` :486, the inline wrapper in the :530 test at :547, `detectWithFakePr` :689 → `installStub`; the inline wrapper in the :1007 test at :1024, which injects `env.PATH` → `writeStubDir` + `envPath`; every `{ skip: process.platform === 'win32' }` on a test that runs one of them → `{ skip: STUB_SKIP }`)
- Modify: `tests/bin-lib/timing/cli.test.js` (`budgetTree`'s `stub-bin/gh` :674 → `writeStubDir('gh', script)`, returning its `envPath`; `runIn` and the AC9.1 test's `run` call take that `envPath` as `env.PATH`; the two `skip: process.platform === 'win32' && '…'` → `{ skip: STUB_SKIP }`; a `// Runs on win32:` comment on each other `budgetTree` test)
- Modify: `tests/hooks-resolve-console.test.js` (every `stub-bin/gh` write → `writeStubDir`; `ghStubEnv` and `runRefusal`'s `execFileSync` env take its `envPath`; `skip: process.platform === 'win32'` → `STUB_SKIP`; drop the :147 per-test comment the reason now carries)

**Interfaces:**
- Consumes: `installStub(name, script) → restore`, `writeStubDir(name, script) → { dir, envPath, remove }`, `STUB_SKIP` (Task 1).

Rules: `installStub` only where the code under test reads `process.env.PATH`; `writeStubDir` and its `envPath` where the test injects `env.PATH` (the console-execute :1007 test, timing/cli, hooks-resolve-console) — Global Constraints. Each `restore()`/`remove()` runs in `t.after` or a `finally`. console-execute's two `case "$1"` scripts (:547, :1024) answer `pr` and `issue` for one `gh` binary: they move too, because spec Decision 2 is scoped to `archive-merged` (one of the three wrappers the parity skill names) and the AC2.1 check is a file-level grep. timing/cli's `budgetTree` comment (:669-671) is rewritten to say the stub is a `writeStubDir` dir handed through the injected PATH. A kept-running `budgetTree` test's `// Runs on win32:` comment states why it holds when no stub answers (the open-record lookup fails open — the fixture's bare `.git` dir has no remote for a real `gh` to query — and its assertions read only the staged file, `timing.json` and the printed budget line); a test whose assertion does depend on the stub answering `[]` skips instead. The console-execute :801/:822 tests also create symlinks, which fail on win32 before the stub would run; `STUB_SKIP`'s reason is still true of them (the stub is never spawned), so they take it like the rest.

- [ ] **Step 1: Convert** the wrappers as listed.
- [ ] **Step 2: AC3.1 check (spec AC2.1, per Decision 1)** — run the Global Constraints grep and save its output: `git grep -n -F -e 'process.env.PATH =' -e '${path.delimiter}${process.env.PATH}' -e "path.join(root, 'stub-bin')" -e "path.join(repo, 'stub-bin')" -e "path.join(cwd, 'stub-bin')" -e "scratchDir('ct-ce-ghwrap-')" -- tests/console-execute.test.js tests/bin-lib/timing/cli.test.js tests/hooks-resolve-console.test.js` — Expected: no output, exit 1. Then `git grep -n -E "mkdtemp|scratchDir\([^)]*(ghwrap|stub)" -- tests/console-execute.test.js tests/bin-lib/timing/cli.test.js tests/hooks-resolve-console.test.js` — Expected: no output.
- [ ] **Step 3: Run** `node --test tests/console-execute.test.js tests/bin-lib/timing/cli.test.js tests/hooks-resolve-console.test.js tests/bin-lib/reconcile/archive-merged.test.js` — Expected: PASS with the same test count as before. Then point `ghStubEnv` at a PATH without the stub dir locally and confirm the hooks-resolve-console AC6.1 test goes red; restore.
- [ ] **Step 4: Commit** the three files; message `Move the single-stub gh wrappers onto installStub and writeStubDir — STUB_SKIP reasons, no hand-built PATH entries, refs #4433`.

### Task 5: Final audit and evidence (AC1.1, AC3.1)

**Files:** none committed (scratch audit stays scratch).

- [ ] **Step 1:** `mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-26T130438-record-4433/evidence"` (already holds `stub-audit.js`, copied at plan time).
- [ ] **Step 2: AC1.1** — `node "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-26T130438-record-4433/evidence/stub-audit.js" "{worktree}" tests/reconcile.test.js tests/reconcile-dispatch.test.js tests/reconcile-archive-residue.test.js tests/reconcile-preflight-fetch.test.js tests/bin-lib/reconcile/prune-remote.test.js tests/bin-lib/reconcile/reap-merged.test.js tests/console-execute.test.js tests/bin-lib/timing/cli.test.js tests/hooks-resolve-console.test.js > "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-26T130438-record-4433/evidence/stub-audit.txt"` — Expected: last line `-- 0 stub-installing test(s) with neither STUB_SKIP nor a "Runs on win32:" comment`. Also confirm the audit now sees the timing/cli and hooks-resolve-console stubs: run it once with `STUB_SKIP` removed from one hooks-resolve-console test locally and confirm that test is listed; restore.
- [ ] **Step 3:** Save Task 4 Step 2's grep output to `…/evidence/ac3-1-grep.txt`. Log one `AUTO` "AC evidence" `decisions.md` entry for AC1.1 and one for AC3.1 (spec AC2.1), each via `log-decision.js --section "/build" --status AUTO --step "AC evidence" --text-file {one-line file}` naming the criterion, the command shape, the count and the evidence path.

### Task 6: windows-regression run on the branch (AC2.1)

**Files:** none.

- [ ] **Step 1:** After the build's push, `gh workflow run windows-regression.yml --ref worktree-dispatch-record-4433`, then watch it to completion.
- [ ] **Step 2: AC2.1 (spec AC1.2)** — download its `verify-logs` artifact; confirm no newly failing file versus main's latest windows-regression run, and that each test Tasks 2-4 newly skipped reports `# SKIP win32: execFile resolves only .exe/.com on PATH, so a script stub is never spawned` in `verify-logs/tests.log`. Save the relevant lines to `…/evidence/ac2-1-windows.txt` and log an "AC evidence" entry the same way. A failing file that also fails on main is not attributable; one that does not is a fix in this build.

## Spec coverage

plan-audit numbers the spec's four AC bullets positionally (AC1.1, AC2.1, AC3.1, AC4.1); the table carries both ids.

| Spec item | plan-audit id | Task |
|---|---|---|
| Deliverable 1, spec AC1.1, Decision 3 | AC1.1 | Tasks 2, 3, 4 (budgetTree comments), 5 |
| spec AC1.2 | AC2.1 | Task 6 |
| Deliverable 2, spec AC2.1, Decisions 1 and 2 | AC3.1 | Tasks 1, 4, 5 |
| Deliverable 3 | — | Task 3 Step 2 |
| Deliverable 4, spec AC3.1 | AC4.1 | Task 1 |
