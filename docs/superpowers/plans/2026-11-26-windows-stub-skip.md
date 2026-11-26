# Windows Stub-Dependent Test Skips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every test that installs a fake `git`/`gh` on PATH either skips on win32 with `STUB_SKIP` when its assertion depends on the stub running, or carries a comment saying why it holds whatever answers on PATH; single-stub hand-rolled wrappers move onto the shared helper.

**Architecture:** `tests/helpers/path-stub.js` gains a platform-injected `stubSkipFor(platform)` (so the `STUB_SKIP` pin can assert the win32 value without stubbing `process.platform`) and a `writeStubDir(name, script)` primitive that `installStub` is rebuilt on, for tests that inject PATH through an `env` object rather than `process.env`. Each stub-installing test in the record's suites is then judged one at a time.

**Tech Stack:** Node 18+ `node:test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T124758-record-4433/work/4433-spec.md`

Scope: the six suites the record names (as relocated below) plus the four single-stub wrapper files. Other `STUB_SKIP`/`installStub` users across `tests/` are out of scope — they were not part of #4285's audit and are already judged by their own records.

Waived `tests/reconcile.test.js`: read by the Task 5 audit only — its two stub tests already carry `STUB_SKIP` and its other cited groups moved to `tests/reconcile-dispatch.test.js` / `tests/reconcile-archive-residue.test.js`.
Waived `tests/bin-lib/reconcile/archive-merged.test.js`: run by Task 4 Step 3 only — its `installGhWrapper` lives in `archive-merged-helpers.js`, and every test using it already carries `STUB_SKIP`.

## Line drift since filing (read first)

The record's line numbers predate a split of `tests/reconcile.test.js`. The groups it names now live in:
- `reconcileWithAsyncMerge` / `withFetchArgvLog` → `tests/helpers/reconcile-fixtures.js`, used by `tests/reconcile-dispatch.test.js`
- `dryRunFixture` (#4180) and `ownerlessFixture` groups → `tests/reconcile-archive-residue.test.js`
- `tests/reconcile.test.js` itself now has no unjudged stub test (its two stub tests already carry `STUB_SKIP`).

A scratch audit (uncommitted; at `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-26T124758-record-4433/evidence/stub-audit.js`, run as `node "{that path}" "{worktree}" {test files...}`) over the six suites lists **41** stub-installing tests with neither `STUB_SKIP` nor a comment: reconcile-dispatch.test.js 21, reconcile-archive-residue.test.js 15, prune-remote.test.js 2, reap-merged.test.js 3. That list, not the record's 22, is the work list. reap-merged's "stub install before a throwing call, outside the try" is now at :306 and :409 (both install the gh wrapper, then run `git worktree lock` before `try`). The record's reap-merged 746/810 are now :766 and :831 (`MID_DELETE_SKIP`). archive-merged's single-stub `installGhWrapper` now lives in `tests/bin-lib/reconcile/archive-merged-helpers.js:86`.

## Global Constraints

- The skip reason string is exactly `win32: execFile resolves only .exe/.com on PATH, so a script stub is never spawned` (`STUB_SKIP_REASON`, unchanged).
- Comment convention for a stub-installing test that keeps running on win32: a line comment starting `// Runs on win32:` inside the test body or on the line directly above `test(`, followed by why its assertions hold whatever answers on PATH. The audit keys on that exact prefix.
- Quoted from `.claude/skills/windows-checkout-test-parity/SKILL.md` (governs every test file here):
  - "A test that writes such a stub skips with `{ skip: STUB_SKIP }` from `tests/helpers/path-stub.js` (#4285), not with a per-file constant, and a new single-stub test installs it with that file's `installStub`. The multi-stub `gh` wrappers in `pr-state`, `release-merged` and `archive-merged` (`tests/bin-lib/reconcile/`) still write theirs by hand; they carry `STUB_SKIP` all the same."
  - "Leave the tests that remove `gh` from `PATH` running: they pass on Windows."
  - "Judge each test by whether it writes a stub and whether its assertion depends on the stub running, not by its title. When a test that already ran on win32 gains a stub only some of its assertions read (a call count, say), keep the test running and guard just those assertions with `if (!STUB_SKIP)`; `{ skip: STUB_SKIP }` is for a test whose subject is the stub running"
  - "Take `platform` and `env` as parameters, never stub `process.platform`" — `process.platform` "is process-global, so the stub leaks into every other test in the same worker."
  - "Check that a skip's reason is true of each test before attaching it."
- `tests/hooks-resolve-console.test.js` is also governed by `.claude/skills/hook-event-in-process-tests` (the event reads only the env its context carries): its stubs must stay reachable **only** through the injected `env.PATH`, never by prepending `process.env.PATH`, or the AC6.1 "starts gh from the injected env PATH" test stops discriminating.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Review Focus

1. A `git` shim from `withFetchArgvLog` that never runs on win32 makes `fetchCalls` come back `[]` — a test asserting `fetchCalls` deep-equals `[]` passes vacuously there; it must skip (or guard that assertion with `if (!STUB_SKIP)` when its other assertions hold).
2. A test whose stub answers `gh` with a canned PR state and asserts an outcome only that state produces (reaped, skipped `own-cwd` after a MERGED lookup) — on win32 real `gh` answers; check whether the outcome still holds (e.g. `own-cwd` is decided before any PR lookup) before choosing a comment over a skip.
3. `MID_DELETE_SKIP` tests on win32: both the chmod and the stub fail there; the skip must name the stub reason when the stub is what fails first.
4. Moving a hand-rolled wrapper whose test injects `env.PATH` onto a helper that also mutates `process.env.PATH` silently weakens an injected-env test (Global Constraints).
5. A moved stub install must still be restored when the call before the `try` throws (reap-merged :306/:409).

---

### Task 1: path-stub helper — `stubSkipFor`, `writeStubDir`, pin gaps

**Role:** integration

**Files:**
- Modify: `tests/helpers/path-stub.js`
- Test: `tests/path-stub-helper.test.js`

**Interfaces:**
- Produces: `stubSkipFor(platform: string): false | string` — `platform === 'win32' && STUB_SKIP_REASON`; `STUB_SKIP = stubSkipFor(process.platform)`.
- Produces: `writeStubDir(name: string, script: string): { dir: string, remove: () => void }` — creates a `scratchDir('ct-stub-')`, writes `name` with mode 0o755, removes the dir on a write failure (current `installStub` behavior) and on `remove()` (idempotent). Does not touch PATH.
- Produces: `installStub(name, script)` — unchanged contract, now built on `writeStubDir`.

- [ ] **Step 1: Write the failing tests** in `tests/path-stub-helper.test.js`:
  - Replace the `STUB_SKIP_REASON is the spec text…` test body so it also asserts `stubSkipFor('win32') === STUB_SKIP_REASON`, `stubSkipFor('linux') === false`, `stubSkipFor('darwin') === false`, keeping the existing `STUB_SKIP === stubSkipFor(process.platform)` line. (AC3.1 win32 `STUB_SKIP` assertion.)
  - `test('writeStubDir writes an executable stub without touching PATH, and remove() deletes the dir', …)`: PATH before === PATH after; `fs.existsSync(path.join(dir, name))`; off win32 `(fs.statSync(file).mode & 0o111) !== 0`; after `remove()` the dir is gone; a second `remove()` does not throw.
  - Retitle `pathWithOnly finds a PATHEXT extension on win32` to `pathWithOnly on win32 resolves only libuv's spawnable names (.com, .exe, bare), case-insensitively, not PATHEXT` (body unchanged — the lookup never consults PATHEXT).
  - `test('AC3.1: on win32 an excluded gh.CMD in the binary dir makes pathWithOnly leave that dir out', { skip: process.platform === 'win32' && 'win32: symlink creation needs privilege' }, …)`: dir `shared` holds `git.EXE` and `gh.CMD`; `pathWithOnly(['git'], { exclude: ['gh'], env: { Path: shared, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, platform: 'win32' })` returns a path `!== shared` whose `readdirSync` is `['git.EXE']`; clean the returned dir in `t.after`. Add a control in the same test: the same call with `gh.CMD` absent returns `shared`.
- [ ] **Step 2: Run** `node --test tests/path-stub-helper.test.js` — Expected: FAIL (`stubSkipFor`/`writeStubDir` not exported).
- [ ] **Step 3: Implement** `stubSkipFor` and `writeStubDir` in `tests/helpers/path-stub.js`, rebuild `installStub` on `writeStubDir` (its `restore()` calls `remove()`), export both, and extend the header comment by one sentence each.
- [ ] **Step 4: Run** `node --test tests/path-stub-helper.test.js` — Expected: PASS. Then revert the `excluded(dir)` symlink branch locally (e.g. make `excluded` return false) and confirm the gh.CMD test goes red; restore.
- [ ] **Step 5: Commit** — `git add tests/helpers/path-stub.js tests/path-stub-helper.test.js`; message `Add stubSkipFor and writeStubDir to the path-stub helper — win32 STUB_SKIP pin, gh.CMD exclude case, refs #4433`.

### Task 2: Judge the reconcile-dispatch and reconcile-archive-residue stub tests

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `tests/reconcile-dispatch.test.js` (21 tests: :256, :269, :284, :289, :304, :309, :316, :327, :342, :362, :368, :374, :382, :389, :398, :1004, :1025, :1034, :1051, :1091, :1104)
- Modify: `tests/reconcile-archive-residue.test.js` (15 tests: :36, :412, :460, :484, :496, :506, :558, :589, :612, :646, :663, :696, :709, :748, :762)
- Read (not modified): `tests/helpers/reconcile-fixtures.js`, to learn that `reconcileWithAsyncMerge` installs only the `withFetchArgvLog` git shim (every other stub there is a module-property replacement that runs on win32).

**Interfaces:**
- Consumes: `STUB_SKIP` from `tests/helpers/path-stub.js` (Task 1 leaves its value unchanged).

For each listed test, decide by the Global Constraints rule:
- An assertion reads something only the stub produces (`fetchCalls`, a gh call log, a canned `gh` answer the outcome depends on) and the test's subject is that → add `{ skip: STUB_SKIP }` to its options.
- Its subject holds whatever answers on PATH, but one or two assertions read the stub (e.g. a `fetchCalls` line in an order test) → keep it running, wrap just those assertions in `if (!STUB_SKIP) { … }`, and add a `// Runs on win32:` comment naming what holds.
- No assertion reads the stub → add a `// Runs on win32:` comment saying why (e.g. "the git shim only logs fetches; these assertions read the module-stub call order").
- For `withBranchCheckStubs` (:1091/:1104) and `dryRunFixture`/`ownerlessFixture`, read the local helper first to see which stub it installs.

- [ ] **Step 1: Re-run the scratch audit** (Task 5 Step 2's command, restricted to these two files) over the two files and confirm it lists the 36 tests above.
- [ ] **Step 2: Apply the per-test decisions.** For every test that gets a skip, record one line in the commit body: `{file}:{line} skip — {assertion that reads the stub}`. For every comment, the comment itself is the record.
- [ ] **Step 3: Prove each skip is needed:** for three of the skipped tests (one per distinct stub kind), replace the stub script body with `exec "$REAL" "$@"`-style pass-through / no-op locally and confirm the test goes red (or, for a `[]` assertion, stays green — which proves the vacuous pass and the need to skip); restore.
- [ ] **Step 4: Run** `node --test tests/reconcile-dispatch.test.js tests/reconcile-archive-residue.test.js` — Expected: PASS, no new skips on darwin/linux.
- [ ] **Step 5: Commit** both files; message `Judge the reconcile stub tests for win32 — STUB_SKIP where the assertion needs the stub, a comment where it holds, refs #4433`.

### Task 3: prune-remote and reap-merged stub tests, reap-merged try placement

**Role:** judgment

**Files:**
- Modify: `tests/bin-lib/reconcile/prune-remote.test.js` (:245, :320)
- Modify: `tests/bin-lib/reconcile/reap-merged.test.js` (:187, :269, :589; :306 and :409 install placement; :766 and :831 skip reason)

**Interfaces:**
- Consumes: `STUB_SKIP` (Task 1).

- [ ] **Step 1: Judge** prune-remote :245/:320 and reap-merged :187/:269/:589 per Task 2's rule. reap-merged :269/:589 assert `own-cwd`: read `plugin/bin/lib/reconcile/reap-merged.js`'s `decideReap` order to see whether `own-cwd` is decided before the PR lookup; if it is, the test holds on win32 → comment; else skip. prune-remote :320 is the batch-fail fallback test → skip unless its assertions hold without the stub.
- [ ] **Step 2: Move the install inside the try** at :306 and :409: install the gh wrapper after the `git worktree lock` / `fs.writeFileSync` setup lines (directly before `try`), so a throwing setup call leaves no stub on PATH.
- [ ] **Step 3: :766 and :831** — change the options to `{ skip: STUB_SKIP || MID_DELETE_SKIP.skip }` (the stub fails first on win32; root still skips on the chmod reason off win32).
- [ ] **Step 4: Run** `node --test tests/bin-lib/reconcile/prune-remote.test.js tests/bin-lib/reconcile/reap-merged.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** both files; message `Judge the prune-remote and reap-merged stub tests for win32 and install reap stubs after throwing setup, refs #4433`.

### Task 4: Move single-stub hand-rolled gh wrappers onto the helper

**Role:** integration

**Files:**
- Modify: `tests/bin-lib/reconcile/archive-merged-helpers.js:86-124` (`installGhWrapper` → `installStub('gh', script)`, still returning `{ restore }`)
- Modify: `tests/console-execute.test.js` (`withFakeGh` :486, the inline wrapper at ~:548, `detectWithFakePr` :689 → `installStub`; every `{ skip: process.platform === 'win32' }` on a test that runs one of them → `{ skip: STUB_SKIP }`)
- Modify: `tests/bin-lib/timing/cli.test.js` (`budgetTree`'s `stub-bin/gh` :674 → `writeStubDir('gh', script)`; `runIn` builds `env.PATH` from that dir; the two `skip: process.platform === 'win32' && '…'` → `{ skip: STUB_SKIP }`)
- Modify: `tests/hooks-resolve-console.test.js` (every `stub-bin/gh` write → `writeStubDir`; `ghStubEnv(dir)` keeps injecting through `env.PATH`; `skip: process.platform === 'win32'` → `STUB_SKIP`; drop the `:147` per-test comment the reason now carries)

**Interfaces:**
- Consumes: `installStub`, `writeStubDir(name, script) → { dir, remove }`, `STUB_SKIP` (Task 1).

Rules: `installStub` only where the code under test reads `process.env.PATH`; `writeStubDir` where the test injects `env.PATH` (timing/cli, hooks-resolve-console) — Global Constraints. Each `remove()`/`restore()` runs in `t.after` or a `finally`.

- [ ] **Step 1: Convert** the wrappers as listed.
- [ ] **Step 2: AC2.1 check** — `git grep -n -E "process\.env\.PATH *=|PATH: *\`\\$\{(wrapperDir|binDir)" -- tests/bin-lib/reconcile/archive-merged-helpers.js tests/console-execute.test.js tests/bin-lib/timing/cli.test.js tests/hooks-resolve-console.test.js` lists only `ghStubEnv`'s/`runIn`'s injected-env lines built from a `writeStubDir` dir, and `git grep -n -E "mkdtemp|scratchDir\('(ct-ce-ghwrap|archive-merged-ghwrap)" --` those files is empty.
- [ ] **Step 3: Run** `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/console-execute.test.js tests/bin-lib/timing/cli.test.js tests/hooks-resolve-console.test.js` — Expected: PASS with the same test count as before.
- [ ] **Step 4: Commit** the four files; message `Move the single-stub gh wrappers onto installStub and writeStubDir — STUB_SKIP reasons, no leaked stub dirs, refs #4433`.

### Task 5: Final audit and evidence (AC1.1, AC2.1)

**Files:** none committed (scratch audit stays scratch).

- [ ] **Step 1:** `$PIPELINE_RUN_DIR/evidence/stub-audit.js` already exists (copied at plan time).
- [ ] **Step 2:** Run `node "$PIPELINE_RUN_DIR/evidence/stub-audit.js" "{worktree}" tests/reconcile.test.js tests/reconcile-dispatch.test.js tests/reconcile-archive-residue.test.js tests/reconcile-preflight-fetch.test.js tests/bin-lib/reconcile/prune-remote.test.js tests/bin-lib/reconcile/reap-merged.test.js > "$PIPELINE_RUN_DIR/evidence/stub-audit.txt"` — Expected: last line `-- 0 stub-installing test(s) with neither STUB_SKIP nor a "Runs on win32:" comment` (AC1.1).
- [ ] **Step 3:** Log one `AUTO` "AC evidence" `decisions.md` entry per the AC-evidence persistence rule, naming AC1.1, the command shape, the count, and the evidence path; and one for AC2.1 with Task 4 Step 2's grep output saved to `$PIPELINE_RUN_DIR/evidence/ac2-1-grep.txt`.

### Task 6: windows-regression run on the branch (AC1.2)

**Files:** none.

- [ ] **Step 1:** After the build's push, `gh workflow run windows-regression.yml --ref worktree-dispatch-record-4433`, then watch it to completion.
- [ ] **Step 2:** Download its `verify-logs` artifact; confirm no newly failing file versus main's latest windows-regression run, and that each test Tasks 2-4 newly skipped reports `# SKIP win32: execFile resolves only .exe/.com on PATH, so a script stub is never spawned` in `verify-logs/tests.log` (AC1.2). Save the relevant lines to `$PIPELINE_RUN_DIR/evidence/ac1-2-windows.txt` and log an "AC evidence" entry. A failing file that also fails on main is not attributable; one that does not is a fix in this build.

## Spec coverage

plan-audit numbers the spec's four AC bullets positionally (AC1.1, AC2.1, AC3.1, AC4.1); the table carries both ids.

| Spec item | plan-audit id | Task |
|---|---|---|
| Deliverable 1, spec AC1.1 | AC1.1 | Tasks 2, 3, 5 |
| spec AC1.2 | AC2.1 | Task 6 |
| Deliverable 2, spec AC2.1 | AC3.1 | Tasks 1, 4, 5 |
| Deliverable 3 | — | Task 3 Step 2 |
| Deliverable 4, spec AC3.1 | AC4.1 | Task 1 |
