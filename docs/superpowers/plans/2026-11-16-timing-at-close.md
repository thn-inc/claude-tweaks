# Timing at Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every run that closes gets a `timing.json`, written in code by the closing path itself, with no model turn — record #5555.

**Architecture:** The body of `phase-timing.js`'s `run` (events → timing object) moves into `plugin/bin/lib/timing/run-timing.js`, which the CLI keeps calling. A new writer, `plugin/bin/lib/timing/at-close.js`, wraps it for closers: it finds the run's own transcript (`sessionId` + `worktree`/`worktreeAtClose`, never the newest candidate), keeps a file that already has token totals, works inside one exported time bound, and turns every failure into one `SKIP` line in `decisions.md`. `hooks.js close-run` and `hooks.js teardown-run` await the full write (token totals included) before they return; the reconciler's archive path writes phase rows synchronously and spawns a detached `plugin/bin/timing-at-close.js` child for the token totals.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T231043-record-5555/work/5555-spec.md` (this worktree). Design: `docs/superpowers/specs/2026-11-15-process-efficiency-design.md`, Phase 5, unit 5.1.

## Global Constraints

- The bound: `TIMING_BOUND_MS`, exported by `plugin/bin/lib/timing/at-close.js`, value `60000` (at most 60 seconds, half the driver's 120-second `close-run` limit), for the whole timing step across every transcript it reads. The deadline is checked inside the transcript read loop; past it the writer stops and logs the `SKIP`.
- "Has token totals" means `totals.tokens` is present and `input + output + cacheRead + cacheCreate > 0`.
- A replaced file is rewritten whole from the derivation; `budget` is the only key carried forward, as `phase-timing.js` carries it today.
- A failure to derive or write timing is logged as one `SKIP` line per `_shared/auto-decision-log.md`'s Degrade-trace rule (`condition: … → fallback: …`), and the close result (stdout, return value, exit code) is unchanged.
- Closing paths call the library in-process; they never spawn `phase-timing.js`. They never run `--check-budgets`; do not change what `--check-budgets` does or when it runs.
- A multi-record run gets one file, in the top-level run directory, covering the whole run (what `phase-timing.js --run "$MULTISPEC_PARENT_DIR"` writes today). The close writes nothing into a `spec-N` directory; a file already there stays byte-identical.
- History is not backfilled; the AC7 replay runs on copies and commits nothing into the archive.
- A run directory with no `worktreeAtClose` key, or an older `run-state.json`, closes as it does today.
- `readUsage` streams; keep it that way.
- No hook event's own path (`session-start`, `pre-tool-use`, `post-tool-use`, `stop`, `session-end`) reads a transcript because of this change.
- `plugin/bin/hooks.js` is edited by several open records: each of the two verbs gets exactly one added call, nothing else in the file changes.
- Governing skill `bin-source-scan-conformance` (quoted): "`tests/windows-hide-spawn-conformance.test.js`: every `child_process` call passes `windowsHide`." / "`tests/path-guard-conformance.test.js`: no bare `realpathSync`/`existsSync` outside the per-file allowlist." / "`tests/bin-lib/exit-code-conformance.test.js`: an entry point (a `require.main === module` guard …) sets `process.exitCode` and never calls `process.exit(`" / "`tests/bin-lib/reconcile/subprocess-timing-conformance.test.js`: no file under `plugin/bin/lib/reconcile/` calls an exec/spawn function directly or requires `child_process`" / "`tests/bin-lib/cli-entry-conformance.test.js`: every top-level `plugin/bin/*.js` meets the CLI entry contract … it exports `run`, has a `require.main === module` guard, and has no `process.exitCode` or `process.exit(` above its last guard." Use `lstatType` from `plugin/bin/lib/path-guard` instead of `fs.existsSync`. The spawn lives in `lib/timing/at-close.js`, never in `lib/reconcile/`.
- Governing skill `gh-api-module-pattern` / `cli-wrapper-contract.md` (quoted): "Logic lives in an exported `run(argv, deps)`; every side effect … goes through `deps` so tests inject fakes." / "It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one. The script entry is the file's last statement" / "*Sanctioned-writer* … 0 written (the written path echoed to stdout), 2 malformed invocation, 3 the run dir is missing or not anchored under the main checkout, or the target file is unwritable — **no 1 at all**." `timing-at-close.js` uses the Sanctioned-writer family. Because `run` is async, its guard is `if (require.main === module) run(process.argv.slice(2), realDeps).then((c) => { process.exitCode = c; });` like `phase-timing.js`.
- Governing skill `windows-checkout-test-parity` (quoted): "Pointing a spawned child at a fixture home with `HOME` alone … Set both keys to the fixture" — tests point transcript lookup at a fixture with `CLAUDE_CONFIG_DIR` in the injected env, never `HOME`. Expected paths in tests are built with `path.join`, never a literal `/`.
- `tests/helpers/run-cli.js`'s leak guard fails a CLI that reads `process.env` or `os.homedir()`: the writer takes `env` and `homeDir` from its caller (hooks.js passes `deps.env`), and calls `homeDir()` only when `env.CLAUDE_CONFIG_DIR` is unset.
- Scope and edit discipline (verbatim, from `/build`): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Commit subjects: `{Verb} {what} — {detail}`, body line `refs #5555`.

## Review Focus

1. A `timing.json` that exists but does not parse — treated as absent: rewritten, no `budget` to carry, close unaffected (test in Task 2).
2. The run directory vanishes between the state flip and the timing write (a concurrent archive) — the writer never recreates it (no `mkdir`), logs nothing it cannot log, never throws (test in Task 2).
3. Two closers on the same run (`close-run` then `teardown-run`) — the second finds token totals and keeps the file byte-identical; the write is temp-file-then-rename in the run dir, so a reader never sees half a file (test in Task 3).
4. A `sessionId` carrying `/` or `..` — `locateTranscripts` returns `[]`; the writer logs the no-transcript `SKIP`, never widens the search (test in Task 2).
5. `events.jsonl` unreadable at close (a directory named `events.jsonl`) — the CLI keeps its exit 2; a closer logs `SKIP` and returns its normal result (test in Task 2).

---

### Task 1: Timing as a function

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/timing/run-timing.js`
- Modify: `plugin/bin/phase-timing.js`
- Modify: `plugin/bin/lib/timing/transcript.js` (`readUsage` gains an optional `signal`)
- Test: `tests/bin-lib/timing/run-timing.test.js`
- Waived `tests/bin-lib/timing/cli.test.js`: run unchanged in Step 4 (AC6.1), never edited.
- Waived `tests/bin-lib/timing/golden.test.js`: run unchanged in Step 4 (AC6.1), never edited; its fixture is Step 1's input.
- Waived `tests/bin-lib/timing/transcript.test.js`: run unchanged in Step 4 (AC6.1), never edited.
- Waived `plugin/bin/lib/timing/derive.js`: read only — `derivePhases`/`joinTokens` are called as today; the open records editing it (#5013, #5466, #5093, #4259) are rebased on, not touched.

**Interfaces:**
- Produces:
  - `readEvents(file) -> { ok: true, events } | { ok: false, error }` (moved from `phase-timing.js`, same behavior).
  - `derivePhaseTiming(runDir) -> { ok: true, timing, out, events, runState } | { ok: false, error }` — sync; no transcript; `timing` is exactly what `phase-timing.js` writes without a transcript flag, minus `budget`.
  - `async deriveTiming(runDir, { transcriptPaths = [], notes = [], cwd, deadlineAt = null, readUsageImpl } = {}) -> { ok: true, timing, out, tokens, guard, notes, deadlineHit } | { ok: false, error }` — with `transcriptPaths` empty and no auto-transcript it equals `derivePhaseTiming`'s `timing`; otherwise adds `unattributed`, the token totals, `guard`, `transcripts`, `notes`, `dispatches` exactly as `phase-timing.js` does today, keys in today's order. `deadlineAt` (epoch ms) is checked before each transcript read and each read is raced against the remaining time; when it passes, abort the in-flight read through an `AbortController` (`readUsage(p, { worktree, signal })`), stop reading, set `deadlineHit: true`, and return the timing with no token keys at all (phase rows only). A lost race never leaves a stream open: a typed `close-run` process must be able to exit inside the bound. `readUsageImpl` defaults to `require('./transcript').readUsage` looked up at call time. `collectDispatches` honours the same deadline and signal.
  - `readUsage(filePath, { fsImpl, worktree, signal })` (transcript.js) — when `signal` aborts (or is already aborted), close the readline, destroy the stream and reject with an `Error` whose `code` is `'ABORT_ERR'`; without `signal` behavior is unchanged. `readDispatches` passes a given `signal` through to its `readUsage` calls.
  - `collectDispatches(paths, events, cwd, { deadlineAt })` (moved).
  - `hasTokenTotals(timing) -> boolean` (the Global Constraints definition).
  - `writeTimingFile(runDir, timing) -> string` — carries `budget` forward from an existing parseable `timing.json` when `timing` has no own `budget` key, writes `timing.json.tmp-{pid}-{random}` in `runDir` then renames over `timing.json`; returns the path. Throws on failure (callers catch). Never creates `runDir`.
- `phase-timing.js` keeps `parseArgs`, `resolveTranscripts`, the render functions, the budget check and its exports (`run, realDeps, main, parseArgs, renderMarkdown, renderDispatches, renderCiGate`).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/timing/run-timing.test.js`:
  - `AC6.2: deriveTiming over the golden fixture equals the timing.json phase-timing.js writes` — run `phase-timing.js`'s `run` in-process (`runCli` from `tests/helpers/run-cli.js`) over a copy of the golden fixture that `tests/bin-lib/timing/golden.test.js` uses, read the written `timing.json`, call `deriveTiming` on another copy, and `assert.deepStrictEqual` both with `generatedAt` and `runDir` removed.
  - `derivePhaseTiming has no token keys and matches deriveTiming without transcripts`.
  - AC6.1 adds no test here: the existing `tests/bin-lib/timing/*.test.js` suites, unedited, are the test, run in Step 4.
  - `hasTokenTotals: absent totals.tokens, all-zero sum, and positive sum` → `false, false, true`.
  - `writeTimingFile carries budget forward and leaves no temp file` — existing file `{ budget: { profile: 'standard' } }`, write a new timing → result has that `budget`; `fs.readdirSync(runDir)` holds no `timing.json.tmp-` entry.
  - `writeTimingFile throws and creates nothing when runDir is gone`.
  - `deriveTiming with a readUsageImpl that never resolves returns deadlineHit within the deadline` — `deadlineAt: Date.now() + 200`, assert it resolves in under 2000 ms with `deadlineHit: true` and no `totals.tokens`.
  - `readUsage with an aborted signal destroys a real slow stream` — an `fsImpl` whose `createReadStream` returns a real `Readable` that pushes one line every 50 ms and never ends (and a `statSync` reporting a file); abort after 100 ms; assert the promise rejects with `code: 'ABORT_ERR'` and the stream's `destroyed` is `true`.
  - `readUsage without a signal is unchanged` — the existing `tests/bin-lib/timing/transcript.test.js` cases, unedited, cover it.

- [ ] **Step 2: Run** `node --test tests/bin-lib/timing/run-timing.test.js` — Expected: FAIL (`Cannot find module '…/run-timing'`).

- [ ] **Step 3: Implement** `run-timing.js` by moving `readEvents`, `readJsonOrNull`, `collectDispatches` and the body of `run` from `const events = readEvents(...)` through building `timing` (lines 340–382 of today's `phase-timing.js`) into `deriveTiming`; `phase-timing.js`'s `run` then calls `resolveTranscripts`, `deriveTiming(runDir, { transcriptPaths: paths, notes, cwd })`, maps `{ ok: false }` to today's exit 2 message, runs the budget check as today, and writes through `writeTimingFile` (the `--check-budgets` branch sets `timing.budget` first, so the carry-forward applies only without it, as today). Keep the `readUsage(resolveAgainst(cwd, p), { worktree })` call shape.

- [ ] **Step 4: Run** `node --test tests/bin-lib/timing/` — Expected: PASS, every existing file in that directory unedited (`AC6.1: existing timing tests pass unedited`). `golden.test.js` already pins `--markdown` output for the golden fixture byte for byte, so its unedited pass is the AC6.2 proof; never use `git stash` for a before/after.

- [ ] **Step 5: Commit** — `Move phase timing derivation into lib/timing/run-timing.js — phase-timing.js output unchanged`.

### Task 2: The at-close writer

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/timing/at-close.js`
- No change to `locateTranscripts`: `locateTranscripts({ cwd, sessionId, configDir })` already returns only `{configDir}/projects/{slug(cwd)}/{sessionId}.jsonl` (Task 1 owns the `readUsage` `signal` change).
- Test: `tests/bin-lib/timing/at-close.test.js`

**Interfaces:**
- Consumes: Task 1's `derivePhaseTiming`, `deriveTiming`, `hasTokenTotals`, `writeTimingFile`.
- Produces:
  - `TIMING_BOUND_MS = 60000`.
  - `ownTranscripts(runState, { env, homeDir }) -> { paths: string[], reason: string|null }` — `worktree` = `runState.worktree` when a non-empty string, else `runState.worktreeAtClose`; needs both that and a string `sessionId`; `locateTranscripts({ cwd: worktree, sessionId, homeDir: null, configDir })` with `configDir = env.CLAUDE_CONFIG_DIR || path.join(homeDir(), '.claude')`; returns at most that one path. Never a projects-wide or newest-candidate search. `reason` names what was missing (`no worktree or worktreeAtClose in run-state.json`, `no sessionId in run-state.json`, `no {sid}.jsonl under the slug of {worktree}`).
  - `isSpecChildDir(runDir) -> boolean` — basename matches `/^spec-\d+$/` and the parent holds `run-state.json`, `config.yml` or `manifest.yml`.
  - `async writeTimingAtClose(runDir, { tokens = true, env = {}, homeDir = os.homedir, boundMs } = {}) -> { status: 'written'|'kept'|'not-top-level'|'failed', tokens: boolean, skip: string|null }` — never throws. Order: `isSpecChildDir` → `not-top-level`, nothing written; existing parseable `timing.json` with token totals → `kept`, byte-identical; else derive (`deriveTiming` with `ownTranscripts` paths and `deadlineAt = Date.now() + (boundMs ?? module.exports.TIMING_BOUND_MS)` when `tokens` is true; `derivePhaseTiming` otherwise) and `writeTimingFile`. Logs at most one `SKIP` line: no transcript (`ownTranscripts.reason`), deadline hit, derive/write failure. `boundMs` read from `module.exports` at call time so a test can see the real constant.
  - `writePhaseTimingSync(runDir) -> { status, skip }` — the same rules with `tokens: false`, synchronous, for the archive path; never reads a transcript.
  - `logTimingSkip(runDir, text)` — `appendEntry({ runDir, section: '/wrap-up', entry: formatEntry({ status: 'SKIP', now: Date.now(), step: 'timing at close', text }) })` from `plugin/bin/lib/log-decision/append.js`, inside try/catch; skipped when `lstatType(runDir)` is not a directory.
  - `spawnTokenPass(runDir) -> { spawned: boolean, reason: string }` — `require('child_process').spawn` looked up at call time, argv `[process.execPath, path.join(__dirname, '..', '..', 'timing-at-close.js'), '--run', runDir]`, `{ detached: true, stdio: 'ignore', windowsHide: true }`, a no-op `'error'` listener, `unref()`; a throw → `{ spawned: false, reason }` and one `SKIP` (`condition: background token pass could not start ({reason}) → fallback: timing.json keeps its phase rows without token totals`).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/timing/at-close.test.js`. Fixtures: a temp run dir with `events.jsonl` (two phase events) and a `run-state.json` written by the real `closeRunState` from `plugin/bin/lib/hooks/close-run-state.js` (Real-writer fixture rule), and a fixture config dir `{tmp}/cfg/projects/{slugForCwd(worktree)}/{sid}.jsonl` holding two assistant lines with `usage`; `env = { CLAUDE_CONFIG_DIR: cfg }`.
  - `AC2.1: worktree null + worktreeAtClose set, transcripts under two slugs → totals from worktreeAtClose's slug` — the other slug's file is newer (`fs.utimesSync`) and carries different token counts; assert the written `totals.tokens` equal the `worktreeAtClose` slug's counts (`AC2.2`: this goes red against a newest-candidate pick).
  - `AC9.1: one session id, two run dirs bound to two worktree slugs → each run's totals come from its own slug only`.
  - `AC9.2: a run whose slug has no transcript → phase rows, no totals.tokens, one SKIP line naming the reason`.
  - `AC3.1: a timing.json with token totals is byte-identical after writeTimingAtClose` (`fs.readFileSync` buffers equal, status `kept`).
  - `AC3.2: a timing.json with no token totals is replaced and its budget key survives`.
  - `AC10.1: run-state.json with no worktreeAtClose key and worktree null → phase rows, no token totals`.
  - `AC12.1: writeTimingAtClose on a spec-N child writes nothing and leaves an existing spec-N timing.json byte-identical`.
  - `deadline: readUsage stubbed (require('…/transcript').readUsage = () => new Promise(() => {})) → resolves within boundMs + 1000, phase rows written, one SKIP naming the bound` — pass `boundMs: 200`.
  - `TIMING_BOUND_MS is at most 60000` — `assert.ok(TIMING_BOUND_MS <= 60000)`.
  - Review Focus 1, 2, 4, 5: unparseable `timing.json` → rewritten; run dir removed before the call → `failed`, directory still absent, no throw; `sessionId: '../x'` → no-transcript `SKIP`; `events.jsonl` is a directory → `failed`, one `SKIP`.
  - `spawnTokenPass with child_process.spawn stubbed to throw → spawned false and one SKIP`; `with spawn stubbed to record → argv ends with ['--run', runDir] and options carry detached, windowsHide`.
  - `writePhaseTimingSync never calls readUsage or locateTranscripts` — both stubbed to throw (AC8 support).

- [ ] **Step 2: Run** `node --test tests/bin-lib/timing/at-close.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `at-close.js` per the Interfaces block. Every exported function catches its own errors. `SKIP` text shape: `condition: {what failed} → fallback: timing.json phase rows written without token totals` (or `→ fallback: no timing.json written` when nothing could be written).

- [ ] **Step 4: Run** `node --test tests/bin-lib/timing/ tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/bin-lib/exit-code-conformance.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** — `Add the at-close timing writer — own-slug transcripts, kept files, one time bound`.

### Task 3: The background token pass CLI

**Role:** integration

**Files:**
- Create: `plugin/bin/timing-at-close.js`
- Test: `tests/bin-lib/timing/at-close-cli.test.js`

**Interfaces:**
- Consumes: Task 2's `writeTimingAtClose`.
- Produces: `timing-at-close.js --run <dir>` — `run(argv, deps)` and `realDeps` (`stdout`, `stderr`, `cwd`, `env`, `homeDir`); resolves `--run` against `deps.cwd()` (`resolveAgainst` from `plugin/bin/lib/health-core/io`); exit 0 with the written or kept path on stdout, 2 on a malformed invocation (missing `--run`, unknown flag), 3 when the run dir is missing. Calls `writeTimingAtClose(runDir, { tokens: true, env: deps.env, homeDir: deps.homeDir })`. Header comment and `USAGE` state the Sanctioned-writer codes.

- [ ] **Step 1: Write the failing tests** (in-process with `runCli`, plus one `spawnCli` smoke for the script entry): `--run` missing → 2; nonexistent dir → 3; Task 2's fixture with a transcript → 0 and `timing.json` has token totals; `--help` → usage, exit 0 or 2 per the sibling convention (`log-decision.js`).
- [ ] **Step 2: Run** `node --test tests/bin-lib/timing/at-close-cli.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `timing-at-close.js`.
- [ ] **Step 4: Run** `node --test tests/bin-lib/timing/at-close-cli.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `Add timing-at-close.js — the detached token pass for archived runs`.

### Task 4: `close-run` and `teardown-run` write timing before they return

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/hooks.js` (`runCloseRun`, `runTeardownRun` — one added call each)
- Modify: `plugin/bin/lib/hooks/teardown-run.js` (return `closed: boolean` beside `lines`)
- Test: `tests/bin-lib/hooks/close-run-state.test.js`, `tests/hooks-teardown-run.test.js`
- Waived `plugin/bin/lib/hooks/close-run-state.js`: read only; `closeRunState` itself is unchanged (it stays synchronous and timing-free).

**Interfaces:**
- Consumes: Task 2's `writeTimingAtClose`, `TIMING_BOUND_MS`.
- Produces: `teardownRun(...) -> { lines, closed }` where `closed` is `true` exactly when its Step 1 close returned `status: 'closed'` with `writeOk`.

- [ ] **Step 1: Write the failing tests.** Drive each verb in-process through `hooks.js`'s `run(argv, deps)` (`tests/helpers/run-cli.js`'s `runCli`) against a fixture repo whose run dir sits under `.claude-tweaks/pipelines/` (reuse the fixture builders already in `tests/hooks-teardown-run.test.js` / `tests/hooks-dispatcher.test.js`), `env.CLAUDE_CONFIG_DIR` pointing at a fixture transcript:
  - `AC1.1/AC1.2 close-run: events.jsonl and no timing.json → timing.json with a phase row per phase the events show and token totals, present when the call returns`.
  - `AC1.1/AC1.2 teardown-run: same`.
  - `AC4.1 close-run / teardown-run: writeTimingAtClose stubbed to throw (require('…/at-close').writeTimingAtClose = …) → stdout and exit code equal the unstubbed base call's; decisions.md gains one SKIP line` — compare against the same call with timing stubbed to a no-op, since the base commit printed no timing output. The stub-to-throw case is caught at the call site in hooks.js with one `SKIP` via `logTimingSkip`.
  - `AC5.1/AC5.2 close-run / teardown-run: readUsage never resolves → returns within TIMING_BOUND_MS and logs the SKIP` — import `TIMING_BOUND_MS`; use `mock.timers` from `node:test` (`enable({ apis: ['setTimeout', 'Date'] })`, then `tick(TIMING_BOUND_MS)`) so the real constant is exercised without a 60-second wait. If `mock.timers` cannot drive the path on Node 20, set `require('…/at-close').TIMING_BOUND_MS` to 200 for the call and state that substitution in the test's comment.
  - `AC10.2 close-run: run-state.json in the older shape (no worktreeAtClose) → same stdout and exit code as without the change, phase rows, no token totals`.
  - `AC12.2 close-run / teardown-run on a parent with two spec-N children → one timing.json in the parent, none written into spec-N, an existing spec-N file byte-identical`.
  - Review Focus 3: `close-run then teardown-run on the same run → the second keeps the file byte-identical`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/hooks/close-run-state.test.js tests/hooks-teardown-run.test.js` — Expected: the new cases FAIL.
- [ ] **Step 3: Implement.** In `runCloseRun`, after the advisory lines, when `r.status === 'closed' && r.writeOk`: `await require('./lib/timing/at-close').writeTimingAtClose(runDir, { env: deps.env })` inside a try/catch that calls `logTimingSkip`. In `runTeardownRun`, after printing, when `result.closed`, the same call. Prints nothing new.
- [ ] **Step 4: Run** `node --test tests/bin-lib/hooks/ tests/hooks-teardown-run.test.js tests/hooks-dispatcher.test.js tests/archive-run-verb.test.js tests/bin-lib/driver/` — Expected: PASS.
- [ ] **Step 5: Commit** — `Write timing.json when close-run and teardown-run close a run — in-process, inside the bound`.

### Task 5: The reconciler's archive path

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`archiveRunDir` only: its `status: 'clean'` write keeps the prior worktree as `worktreeAtClose`, and it writes timing when the run was not already clean — the one site, which every archive path reaches: abandoned-interrupted, merged-PR, ad-hoc, and `hooks.js archive-run`)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`
- Waived `plugin/bin/lib/reconcile/background-spawn.js`: read only — the token pass is its own detached child (`spawnTokenPass`), not the reconcile-background pass, because `archiveMerged` also runs inline under `hooks.js reconcile`.

**Interfaces:**
- Consumes: Task 2's `writePhaseTimingSync`, `spawnTokenPass`; Task 3's CLI as the child.

- [ ] **Step 1: Write the failing tests:**
  - `AC1.1/AC1.3 reconciler: an abandoned-interrupted run archived by archiveMerged has timing.json phase rows when archiveMerged returns; after the token pass (spawn stubbed to record, then timing-at-close.js run in-process with the recorded argv) it has token totals` — fixture state `status: 'interrupted'` with `worktree` set and no `worktreeAtClose` (written by the real `record-worktree` writer, `context.js`'s `writeRunState`), so the test proves `archiveRunDir` carries the worktree into `worktreeAtClose`.
  - `AC1.1 reconciler, merged-PR path: a non-clean run archived through archiveRunDir gets phase rows and exactly one recorded spawn`.
  - `one pass over an abandoned-interrupted run spawns the token pass exactly once`.
  - `archiveRunDir keeps the prior worktree as worktreeAtClose, and a repeat keeps the first one` (the `close-run-state.js` rule).
  - `AC4.2 reconciler: writePhaseTimingSync stubbed to throw → archiveMerged returns the same archived/skipped lists as with timing stubbed to a no-op, and the archived decisions.md gains one SKIP line`.
  - `AC11.1: spawnTokenPass's spawn stubbed to throw → phase rows kept, no token totals, one SKIP line`.
  - `AC8.1: archiveMerged never calls readUsage` — `transcript.readUsage` stubbed to throw.
  - `archiveRunDir on a run that was already clean writes no timing.json and spawns nothing` (so `hooks.js archive-run` after `close-run` changes nothing).
  - `AC12.3: archiving a multi-record parent writes one timing.json at the archive parent and none into spec-N`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/reconcile/archive-merged.test.js` — Expected: new cases FAIL.
- [ ] **Step 3: Implement.** In `archiveRunDir` only: read the run-state before the move; the clean write becomes `{ status: 'clean', worktree: null, worktreeAtClose: prior }` when `prior` (`prev.worktree` or `prev.worktreeAtClose`, a non-empty string) exists, else today's patch; right after it succeeds, when the pre-move status was not `clean`: `try { const t = require('../timing/at-close'); t.writePhaseTimingSync(archiveDir); t.spawnTokenPass(archiveDir); } catch (err) { /* logTimingSkip */ }`. The abandoned-interrupted branch's own `closeRunState` call is untouched (it runs after `archiveRunDir`, finds `worktreeAtClose` and keeps it).
- [ ] **Step 4: Run** `node --test tests/bin-lib/reconcile/ tests/archive-run-verb.test.js` — Expected: PASS. An existing assertion that lists an archive dir's exact contents may now see `timing.json`; update only that listing, and name each such edit in the commit body.
- [ ] **Step 5: Commit** — `Write timing.json on the reconciler's archive close — phase rows inline, tokens in a detached pass`.

### Task 6: Docs

**Role:** integration

**Files:**
- Modify: `docs/hooks.md` (the run-dir state files paragraph: who writes `timing.json` and when)
- Modify: `docs/plugin-structure.md` (`plugin/bin/lib/timing/` line: `run-timing.js`, `at-close.js`; the CLI list: `timing-at-close.js`)

- [ ] **Step 1:** Add to `docs/hooks.md`: `timing.json` is written by `bin/phase-timing.js` when a step runs it, and in code when a run closes — `hooks.js close-run` and `hooks.js teardown-run` (whole file, token totals included, before they return, inside `TIMING_BOUND_MS`), an archive that closes a not-yet-closed run (`reconcile/archive-merged.js`'s `archiveRunDir`, reached by every reconciler archive path and `hooks.js archive-run`: phase rows inline, token totals from a detached `bin/timing-at-close.js`); `archiveRunDir` now keeps the prior worktree as `worktreeAtClose`; a file that already has token totals is kept; a failure is one `SKIP` line; no hook event reads a transcript.
- [ ] **Step 2:** Update `docs/plugin-structure.md` the same way, one clause each.
- [ ] **Step 3: Run** `node --test tests/docs-*.test.js 2>&1 | tail -5` (whatever doc conformance suites exist) — Expected: PASS.
- [ ] **Step 4: Commit** — `Document who writes timing.json and when — phase-timing.js and every closing path`.

### Task 7: Evidence for the PR (controller, scratch scripts, nothing committed but the PR text)

**Files:**
- Waived `tools/guard-refusals/transcripts.js`: read only, as the second attribution rule the Technical Approach names, checked in Step 2.
- Waived `tools/efficiency-report.js`: read only — confirms it reads only the top-level `timing.json`, the directory the multi-record statement in Step 5 names.
- Waived `docs/reconcile-checks.md`: read only — read before choosing where the reconciler's write happens (Task 5 adds no convergence check, so its registration procedure does not apply).

Waived AC7.1: an evidence criterion, met by Step 3's replay output, not a committed test.
Waived AC7.2: Step 3 runs the writer over the copies.
Waived AC7.3: Step 3 counts files, token totals and the independent `jq` recount.
Waived AC7.4: Step 3 names each run with no totals and why.
Waived AC8.2: Step 4 writes how AC8.1 was checked into the PR.

- [ ] **Step 1 (D1):** Re-derive the cause table over this machine's run directories (`.claude-tweaks/pipelines/` and `archive/`, November `spec-`/`record-` runs): with/without `timing.json`, status split, `dispatched`, `close-without-wrapup`, wrap-up line in `decisions.md`, transcript on disk under the own slug, `worktreeAtClose` vs `worktree`, files with no token totals; plus closed runs whose only close was `archiveRunDir`'s flip (no `close-without-wrapup`, no `close-run` evidence). Independent count: `ls | wc -l` and a `jq` over `run-state.json` for the status split. Output to `$PIPELINE_RUN_DIR/evidence/cause-table.txt`.
- [ ] **Step 2 (Technical Approach verify):** For every dispatched November run, check a transcript `{slug(worktreeAtClose||worktree)}/{sessionId}.jsonl` exists; count the ones where it does not, and compare with `tools/guard-refusals/transcripts.js`'s attribution for a sample. Output to `evidence/dispatched-slug-check.txt`. **Measured at plan time (2026-11-16):** of 94 closed November runs with no `timing.json`, 93 have a `{sessionId}.jsonl` somewhere, but only 20 have it under the run's own worktree slug; for the other 73 the session transcript sits under the main checkout's slug (or another run's worktree slug). The premise "a transcript under the run's own worktree slug" does not hold for most dispatched runs. AC9.1/AC9.2 fix the rule as own-slug only (a run whose slug has no transcript gets phase rows and a `SKIP`), so this build keeps it; the PR states the 20/93 coverage, and the gap (attributing a dispatched run's own Task-call subagent transcripts under the dispatching session's slug by the run id they name, the `tools/guard-refusals/transcripts.js` rule) goes to the ledger as a follow-up record.
- [ ] **Step 3 (AC7, real-input probe):** Copy the November closed runs with no `timing.json` into a scratch dir, run `node plugin/bin/timing-at-close.js --run <copy>` on each, report: copies with ≥1 event that got a file (must be all), copies with an own-slug transcript that got token totals (≥90%), each run that got none and why; for 3 sampled runs, recount tokens independently with `jq` over the transcript (unique `message.id`, max usage per id) and compare. Output to `evidence/replay.txt`.
- [ ] **Step 4 (AC8):** State how it was checked: `git grep` that no module required by `plugin/bin/lib/hooks/{session-start,pre-tool-use,post-tool-use,stop,session-end}.js` requires `at-close`/`run-timing` (the only requirers are `hooks.js`'s two verbs, `archive-merged.js` and `timing-at-close.js`), plus Task 5's `AC8` test, plus `session-start`'s `FAST_CHECKS` not including `archive`. Output to `evidence/ac8.txt`.
- [ ] **Step 5:** One `log-decision.js --status AUTO --step "AC evidence"` entry per step, each with `--text-file`, citing the evidence path and counts; the PR body gets the cause table, the closing-path call-site list, the replay result, the headless-driver-worker statement (a driver run's workers are headless sessions: their `timing.json` has phase rows, and token totals only when the worker's transcript sits under the run's own slug), and the multi-record directory statement.
