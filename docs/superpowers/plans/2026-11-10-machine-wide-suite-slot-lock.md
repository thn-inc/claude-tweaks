# Machine-wide Suite Slot Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `tools/run-tests.js`'s cross-process slot lock as `plugin/bin/lib/suite-slot.js`, and make `plugin/bin/verify.js` queue its local checks (subset or full lane) and its baseline adjudication (always full lane) behind it, with the slot count resolved from verify-scope.json, then `--default-suite-slots`, then 1.

**Architecture:** One lock implementation in `plugin/bin/lib/suite-slot.js` (moved verbatim from `tools/run-tests.js`, plus a log label/hint parameter and two small helpers); `tools/run-tests.js` requires and re-exports it. A new pure-ish `plugin/bin/lib/verify/slot.js` holds verify.js's slot logic (count resolution, lane choice, worker cap, and a `holdSlot` that acquires, sets the held-slot env, and frees on every exit path). `verify.js` wraps its `runChecks` call and its `adjudicate()` call each in one hold. The policy key is resolved caller-side (verify.js keeps its no-policy boundary) and passed as `--default-suite-slots`.

**Tech Stack:** Node 18+ CommonJS, `node:test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-10T221228-spec-5119/work/5119-spec.md` (worktree copy)

## Global Constraints

- Shipped code stays stack-agnostic: no Postgres-, vitest- or Node-runner-specific behavior in `plugin/**`. The consumer evidence in the spec is a motivating example only; never name or describe the consumer project in code, comments, commits or docs.
- Run this repo's tests through `tools/run-tests.js` (it holds the slot lock), never a bare `node --test`: other sessions may be running suites on this machine. A targeted run is `node tools/run-tests.js --files-from {list}` where `{list}` is a file naming one repo-relative test path per line (the per-task list files below already exist).
- Do not change the lock dir, the lock/ticket file names (`slot-<i>.lock`, `slot-<i>.reclaim`, `ticket-<seq>.json`, `subset/`) or the ticket JSON shape (`{ pid, startedAt, cwd, slots? }`): sibling worktrees on an older `tools/run-tests.js` share the same dir and must keep interoperating.
- `acquireSlot` keeps returning the lock path as a string (plan departure from the spec's `{ lockPath, index }`: `tests/run-tests-isolation.test.js`'s ~50 slot tests and its `WAITER` child script consume the string; the index comes from the new `slotIndexOf(lockPath)` instead).
- With default arguments, every message `acquireSlot`/`resolveSlots` prints stays byte-identical to today's (`run-tests.js: waiting for a test-suite slot — …; set CT_TEST_SUITE_SLOTS to raise the limit (lock: …)`), since `tests/run-tests-isolation.test.js` pins them.
- `plugin/bin/verify.js` never reads `.claude-tweaks/policy.yml` (its header's Option A boundary): the policy value arrives as `--default-suite-slots <n>`.
- Source-scan suites over `plugin/bin/`: no `fs.existsSync`/`fs.realpathSync` tokens in new `plugin/bin` code (`tests/path-guard-conformance.test.js`); any spawn passes `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`). The moved lock code uses neither.
- Tests that exercise acquisition must delete `CT_TEST_SUITE_SLOT_HELD` from the child env and point `CT_TEST_SUITE_SLOT_DIR` at a fresh temp dir: `tools/run-tests.js` sets `CT_TEST_SUITE_SLOT_HELD=1` for the whole suite, so an inherited env tests nothing (and a missing `CT_TEST_SUITE_SLOT_DIR` would contend on the real machine-wide dir).
- Governing skill `policy-key-addition` (verbatim): "**The `POLICY_KEYS` row.** `key` (flat kebab-case, `tests/policy-key-naming.test.js`), `type` (`boolean`, `enum`, `integer`, `string`, `list` or `map`), `values` for an enum, and `default` unless the default is derived … `summary`, `category` and `tier` are required (`tests/policy-schema-metadata.test.js`)." / "**The tier.** The core tier has an enforced cap of 12 … so a new key is `advanced` unless it replaces a core one." / "**The key count.** `tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit." / "**The doc row** in `_shared/policy-schema.md`. Every key needs a table row there that starts `` | `{key}` | `` (`tests/policy-key-naming.test.js`), and its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`). State the value the resolver returns for unset, set and malformed input, from the code, not from intent. … Measure `wc -c` on `_shared/policy-schema.md` against `RAIL_BYTES` (`plugin/bin/lib/skill-audit/budgets.js`) before writing the row: the file sits within a few hundred bytes of the Read rail, so a long row breaches it. … If the next row does not fit, move another section the same way, taking one with no citers and no byte pins (`shared-contract-extraction`'s headroom-forced split)." / "**A Manifesto-visible lever** also walks `_shared/auto-mode-contract.md`'s "Adding a new policy lever" checklist."
- Governing skill `verify-scope-rule-kind` (verbatim, item 2): "**The committed declaration stays readable by the previous release.** The installed plugin build reads this repo's committed `.claude-tweaks/verify-scope.json` with older code. … Prove it by running the previous reader over the file … Since #4135 `tests/verify-scope-declaration.test.js` runs that check itself". This plan never adds `concurrency` to the committed declaration, so the pin stays green unchanged. Item 1's other sites: `scope.js` (unchanged — the block does not affect selection), `plugin/bin/lib/init/verify-scope-starter.js` (unchanged — `/init` does not offer `concurrency`; a project opts in by hand), the Re-verify scoping table (unchanged — no selection effect).
- Governing skill `lock-race-test-seam` (verbatim): "A two-process "concurrent append" test stays green with the lock deleted. Node startup (tens of milliseconds) dwarfs the read-modify-write window" / "**Prove it goes red** … A race test not run against the lock-removed code has not been shown to test the lock." Here the window is a whole check run (seconds), not microseconds, so a two-process test does discriminate; Task 3's serialization test must still be shown red by deleting the acquisition before it is called done.
- Not a Manifesto lever (decided by the user at plan review): `verify-suite-slots` is a machine-coordination limit every run on the machine must agree on, not a per-run policy choice, so it is not added to the Pipeline Config Manifesto and no Manifesto checklist site changes.
- Lane rule (decided by the user at plan review): the lane follows the commands, not the selection mode. Full lane whenever any local check other than `types`/`lint` runs its full declared or `--cmd` command; subset lane only when every such check runs an impact-subset command or the tool-scoped `{base}` command, or when only `types`/`lint` run.
- Signals (decided by the user at plan review): on SIGINT/SIGTERM/SIGHUP while holding a slot, verify.js kills every running check's process tree before freeing the slot, so no orphaned suite runs outside the bound.
- CI retries (decided by the user at plan review): a CI-answered suite that failed is retried locally under a subset-lane slot; a run whose every suite is answered by CI with no local retry takes no slot.

## Review Focus

- A verify.js run killed by SIGINT/SIGTERM while holding a slot must free it (a leaked lock reads live until the pid dies, but a reused pid could wedge the queue) — Task 3 test "a SIGTERM mid-check frees the slot".
- A `--baseline` run whose adjudication installs its own signal handlers (`baseline.js:438`) must still remove its scratch worktree before exiting: verify.js's slot handler must not `process.exit` first — Task 3 test "adjudication's own signal handler still runs".
- A verify.js run nested under a held slot (this repo's own `npm test` → `run-tests.js`) must never wait on itself — Task 3 test "the check child sees CT_TEST_SUITE_SLOT_HELD=1 and a nested acquire does not wait".
- A run that executes nothing locally (selection `none`, every suite from CI) must not queue — Task 2's `chooseLane` cases.
- An invalid declaration (bad `concurrency`) on a run without `--scope` must not fail the run — Task 3 test "an invalid default declaration falls back with one stderr line".

---

### Task 1: Ship the slot-lock module

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/suite-slot.js`
- Modify: `tools/run-tests.js` (lines ~111-463: move the lock primitives out; keep `listTestFiles`, `readFileList`, `resolveConcurrency`, `buildTestArgs`, `subsetFallbackReason`, `createRunRoot`, `sweepStaleRoots` and the main block; the header comment's slot paragraph points at the module)
- Create: `tests/bin-lib/suite-slot/suite-slot.test.js`
- Test: `tests/run-tests-isolation.test.js` (unchanged, must stay green)

**Interfaces:**
- Produces (from `plugin/bin/lib/suite-slot.js`):
  - `acquireSlot({ dir, slots, pid, cwd, isAlive, now, sleep, log, pollMs = 2000, staleUnparseableMs = 600000, staleReclaimMs = 30000, slotsVar = 'CT_TEST_SUITE_SLOTS', label = 'run-tests.js', hint = null }) -> string` (lock path). The wait line becomes `${label}: waiting for a test-suite slot — {held by|queued behind} pid … since …; ${hint ?? \`set ${slotsVar} to raise the limit\`} ({lock|ticket}: …)`.
  - `releaseSlot(lockPath, pid) -> void`, `isPidAlive(pid) -> boolean`, `ensureOwnDir(dir) -> void`, `slotLane(baseDir, subset) -> { dir, slotsVar }`, `resolveSlots(env, log, key = 'CT_TEST_SUITE_SLOTS', label = 'run-tests.js') -> number` — all unchanged in behavior.
  - `slotIndexOf(lockPath) -> number | null` — the `<i>` of a `slot-<i>.lock` basename, null for any other name.
  - `defaultSlotBase(env, tmpdir) -> string` — `env.CT_TEST_SUITE_SLOT_DIR` when it is a non-empty string, else `path.join(tmpdir, 'ct-test-suite-slots')`.
- `tools/run-tests.js` re-exports `isPidAlive, ensureOwnDir, acquireSlot, releaseSlot, slotLane, resolveSlots` from the module (same identities) and uses `defaultSlotBase(process.env, os.tmpdir())` in its main block.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/suite-slot/suite-slot.test.js` (require `../../../plugin/bin/lib/suite-slot`):
  - `AC2.1: run-tests.js re-exports the module's own functions` — for each of `acquireSlot, releaseSlot, isPidAlive, ensureOwnDir, slotLane, resolveSlots`: `assert.strictEqual(require('../../../tools/run-tests.js')[name], mod[name])`.
  - `slotIndexOf reads the slot number` — `slotIndexOf('/x/slot-0.lock') === 0`, `slotIndexOf('/x/subset/slot-12.lock') === 12`, `slotIndexOf('/x/ticket-3.json') === null`, `slotIndexOf('/x/slot-1.reclaim') === null`.
  - `defaultSlotBase prefers CT_TEST_SUITE_SLOT_DIR` — `defaultSlotBase({ CT_TEST_SUITE_SLOT_DIR: '/d' }, '/t') === '/d'`; `defaultSlotBase({}, '/t') === path.join('/t', 'ct-test-suite-slots')`; `defaultSlotBase({ CT_TEST_SUITE_SLOT_DIR: '' }, '/t') === path.join('/t', 'ct-test-suite-slots')`.
  - `acquireSlot names the caller's label and hint in its wait line` — fresh temp dir, pre-write `slot-0.lock` as `{ pid: 424242, startedAt: 'then', cwd: '/elsewhere' }` with `isAlive: (p) => p === 424242` until a fake `sleep` (called once) deletes the lock; `log` captures lines; call with `label: 'verify.js [full lane]', hint: 'raise concurrency.suiteSlots'`. Assert exactly one logged line, that it starts `verify.js [full lane]: waiting for a test-suite slot — held by pid 424242 (cwd /elsewhere)`, contains `raise concurrency.suiteSlots`, and does not contain `CT_TEST_SUITE_SLOTS`; and the return value ends with `slot-0.lock`.
  - `acquireSlot's default wait line is unchanged` — same setup with no `label`/`hint`: the line starts `run-tests.js: waiting for a test-suite slot — held by pid 424242` and contains `set CT_TEST_SUITE_SLOTS to raise the limit (lock: `.

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/task1.txt"`
Expected: FAIL (Cannot find module `plugin/bin/lib/suite-slot`)

- [ ] **Step 3: Move the primitives** — cut `POSITIVE_INT` (keep a copy in run-tests for `resolveConcurrency`, or import it), `resolveSlots`, `slotLane`, `isPidAlive`, `createLock`, `UNKNOWN_HOLDER`, `readHolder`, `unlinkQuiet`, `createMutex`, `reclaimSlot`, `ensureOwnDir`, `listTickets`, `takeTicket`, `ticketsAhead`, `namesPid`, `acquireSlot`, `releaseSlot` with their comments into `plugin/bin/lib/suite-slot.js` unchanged except the `label`/`hint` parameters; add `slotIndexOf` and `defaultSlotBase`. The module's header comment states its two callers (run-tests.js, verify.js) and the do-not-change rule for names and ticket shape from Global Constraints. In `tools/run-tests.js`, require `../plugin/bin/lib/suite-slot` and keep `module.exports` exporting every name it exports today.

- [ ] **Step 4: Run both suites**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/task1-green.txt"`
Expected: PASS (`tests/bin-lib/suite-slot/suite-slot.test.js` and `tests/run-tests-isolation.test.js`, 0 failures) — this run is AC2.2: run-tests.js's existing slot tests stay green against the moved module

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/suite-slot.js tools/run-tests.js tests/bin-lib/suite-slot/suite-slot.test.js`, message `Move the test-suite slot lock into plugin/bin/lib/suite-slot.js — one lock for run-tests.js and verify.js (#5119)`.

### Task 2: Slot count, lane choice and the `concurrency` declaration block

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/verify/slot.js` (pure helpers here; Task 3 adds `holdSlot`)
- Modify: `plugin/bin/lib/verify/declaration.js` (parse and validate the `concurrency` block; `decl.concurrency`)
- Modify: `plugin/bin/lib/verify/args.js` (`--default-suite-slots` in `VALUE_FLAGS`, parsed as `defaultSuiteSlots`; also the `USAGE` text)
- Create: `tests/bin-lib/verify/slot.test.js`
- Test: `tests/bin-lib/verify/declaration.test.js`
- Test: `tests/bin-lib/verify/args.test.js`

**Interfaces:**
- Produces:
  - `decl.concurrency: { suiteSlots: number | null }` — always present on a parsed declaration; `suiteSlots: null` when the block or key is absent. Validation errors (each reported alongside the others, the file's existing "every invalid field" convention): `concurrency: must be an object`, `concurrency: unknown key(s) "{k}" (allowed: suiteSlots)`, `concurrency.suiteSlots: must be a positive integer`. Export `CONCURRENCY_KEYS = ['suiteSlots']` from `declaration.js` (#5150 appends to it).
  - `parsed.defaultSuiteSlots: number | null` from `parseArgs` — a value other than a positive integer (`/^[1-9]\d*$/`) throws `UsageError('--default-suite-slots must be a positive integer, got: {value}')`; the flag is a usage error in the read-only modes (`--stamp-status`, `--changed-files`) like `--cmd-timeout`.
  - From `plugin/bin/lib/verify/slot.js`:
    - `resolveSuiteSlots({ declared, flag }) -> { slots: number, source: 'declaration' | 'flag' | 'default' }` — `declared` (a positive integer or null) wins, then `flag`, then `{ slots: 1, source: 'default' }`.
    - `chooseLane({ localCheckCount, fullSuiteRuns }) -> 'full' | 'subset' | null` — `null` when `localCheckCount === 0`; `'full'` when `fullSuiteRuns` is true; `'subset'` otherwise. verify.js computes `fullSuiteRuns` (Task 3): true when any local check whose name is not `types`/`lint` runs a command other than the impact-subset command and other than the tool-scoped `{base}`-substituted `tests` command.
    - `workerCap(cores, slots) -> number` — `Math.max(1, Math.floor(cores / (2 * slots)))`.

- [ ] **Step 1: Write the failing tests**
  - `tests/bin-lib/verify/slot.test.js`: `resolveSuiteSlots` — `({declared: 2, flag: 3})` → `{slots: 2, source: 'declaration'}`; `({declared: null, flag: 3})` → `{slots: 3, source: 'flag'}`; `({declared: null, flag: null})` → `{slots: 1, source: 'default'}`. `chooseLane` — `({ localCheckCount: 0, fullSuiteRuns: true })` → `null`; `({ localCheckCount: 2, fullSuiteRuns: true })` → `'full'`; `({ localCheckCount: 2, fullSuiteRuns: false })` → `'subset'`. `workerCap(16, 1) === 8`, `workerCap(16, 4) === 2`, `workerCap(3, 2) === 1`, `workerCap(1, 1) === 1`.
  - `tests/bin-lib/verify/declaration.test.js`: `concurrency.suiteSlots: 2 parses`, `absent concurrency gives suiteSlots null`, and one refusal test each for `concurrency: []`, `concurrency: { suiteSlots: 0 }`, `{ suiteSlots: 1.5 }`, `{ suiteSlots: "2" }`, `{ slots: 2 }` (asserting the exact error strings above, the unknown-key one naming `suiteSlots` as allowed).
  - `tests/bin-lib/verify/args.test.js`: `--default-suite-slots 3` → `defaultSuiteSlots === 3`; absent → `null`; `0`, `-1`, `two`, `1.5` each throw a `UsageError` whose message is `--default-suite-slots must be a positive integer, got: {value}`; `--stamp-status --default-suite-slots 2` throws a `UsageError`.

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/task2.txt"`
Expected: FAIL (Cannot find module `plugin/bin/lib/verify/slot`)

- [ ] **Step 3: Implement** the three helpers, the `concurrency` block in `readDeclaration` (same unknown-key idiom as the `impact`/`ci` blocks), and the flag in `args.js` (same shape as `--cmd-timeout`'s positive-integer check). `decl.concurrency` defaults to `{ suiteSlots: null }`.

- [ ] **Step 4: Run to verify it passes** — same command as Step 2. Expected: PASS.

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/verify/slot.js plugin/bin/lib/verify/declaration.js plugin/bin/lib/verify/args.js tests/bin-lib/verify/slot.test.js tests/bin-lib/verify/declaration.test.js tests/bin-lib/verify/args.test.js`, message `Add verify-scope concurrency.suiteSlots, --default-suite-slots and verify's lane rules (#5119)`.

### Task 3: verify.js queues its checks and its adjudication behind a slot

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/verify/slot.js` (add `holdSlot`)
- Modify: `plugin/bin/verify.js` (read `concurrency` without `--scope`; hold around `runChecks` at ~line 814; hold around `adjudicate()` at ~line 863 and pass `slot`; `report.slot` and `baselineAdjudicated.slot`)
- Modify: `plugin/bin/lib/verify/baseline.js` (accept and ignore a `slot` option on `adjudicate()` — #5150 consumes it; one comment line)
- Modify: `plugin/bin/lib/verify/run.js` (`runOne` and `runChecks` accept an optional `track` Set: a tracked child is spawned `detached` on POSIX, so `killTree`'s group kill reaches its descendants, is added to the set on spawn and removed on settle)
- Test: `tests/bin-lib/verify/run.test.js`
- Test: `tests/bin-lib/verify/ci-cli.test.js`
- Test: `tests/bin-lib/verify/slot.test.js`
- Test: `tests/bin-lib/verify/cli.test.js`
- Waived `plugin/bin/lib/file-lock.js`: the spec's Gotchas names it only to say the two locks must not merge; this plan never touches it.
- Waived `plugin/bin/lib/verify/report.js`: the spec lists it, but `report.slot` is set in verify.js after `composeReport`, the same way `report.ci` is, so report.js needs no change.

**Interfaces:**
- Consumes: Task 1's `acquireSlot`, `releaseSlot`, `isPidAlive`, `ensureOwnDir`, `slotLane`, `slotIndexOf`, `defaultSlotBase`; Task 2's `resolveSuiteSlots`, `chooseLane`, `workerCap`, `decl.concurrency`, `parsed.defaultSuiteSlots`.
- Produces:
  - `holdSlot({ lane, slots, source, beforeRelease = () => {}, env = process.env, tmpdir = os.tmpdir(), cores = os.availableParallelism(), pid = process.pid, cwd = process.cwd(), isAlive = isPidAlive, now = Date.now, sleep, log = (l) => process.stderr.write(\`${l}\n\`), proc = process }) -> null | { lane, index, slots, source, waitedMs, release() }` — returns `null` without touching anything when `env.CT_TEST_SUITE_SLOT_HELD === '1'` or `lane === null`. Otherwise: base = `defaultSlotBase(env, tmpdir)`; `ensureOwnDir(base)`; `acquireSlot({ dir: slotLane(base, lane === 'subset').dir, slots, …, label: \`verify.js [${lane} lane]\`, hint: 'raise concurrency.suiteSlots in .claude-tweaks/verify-scope.json, or the verify-suite-slots policy key' })`; then sets `env.CT_TEST_SUITE_SLOT_HELD = '1'` and, when `env.CT_TEST_WORKERS` is unset, `env.CT_TEST_WORKERS = String(workerCap(cores, slots))`, remembering prior values; registers `proc.on('exit', release)` and, for each of SIGINT/SIGTERM/SIGHUP, a handler that first calls `beforeRelease()` (an optional parameter, default no-op; verify.js passes one that runs `killTree` on every child in its `track` set), then `release()`, and then `proc.exit(128 + os.constants.signals[sig])` **only when it is the last listener for that signal** (`proc.listenerCount(sig) === 1`), so `adjudicate()`'s own handler still removes the scratch worktree and exits. `release()` is idempotent: `releaseSlot(lockPath, pid)`, restore the two env vars, remove the listeners it added.
  - `report.slot = { lane, index, waitedMs, slots, source }` for the checks hold (absent when no slot was held); `baselineAdjudicated.slot` with the same shape for the adjudication hold.

- [ ] **Step 1: Write the failing tests**
  - `tests/bin-lib/verify/slot.test.js` (in-process, temp `CT_TEST_SUITE_SLOT_DIR`, injected `env` object and a fake `proc` EventEmitter with `exit` recorded): `holdSlot returns null under CT_TEST_SUITE_SLOT_HELD=1 and creates no lock`; `holdSlot sets CT_TEST_SUITE_SLOT_HELD and CT_TEST_WORKERS while held and restores them on release` (prior `CT_TEST_WORKERS='7'` survives untouched and is restored; `workerCap(16, 2) === '4'` appears when unset); `release is idempotent and removes slot-<index>.lock`; `a signal with no other listener releases and exits 128+n`; `adjudication's own signal handler still runs` (a second SIGTERM listener registered after `holdSlot`: emitting SIGTERM releases the slot, calls the second listener, and `proc.exit` is called only by that listener); `index is the slot taken` (with slot-0 held by a live foreign pid and `slots: 2`, `index === 1`).
  - `tests/bin-lib/verify/cli.test.js` — a helper `slotEnv(dir)` returning `{ ...process.env, CT_TEST_SUITE_SLOT_DIR: dir }` minus `CT_TEST_SUITE_SLOT_HELD` and `CT_TEST_WORKERS`; fixture checks built with the file's `nodeCmd` (they append `start <id> <Date.now()>` / `end <id> <Date.now()>` to an out file argv path and sleep 1500 ms). Tests:
    - `AC1.1: two concurrent full runs in different worktrees serialize on one lock dir` — two `tmpGitRepo()`s, one shared temp slot dir, both `runCli` started together with `--cmd tests=<fixture>`; parse the out file: the later `start` is ≥ the earlier `end`. Both exit 0 and both `report.slot` read `{ lane: 'full', index: 0, slots: 1, source: 'default' }`.
    - `AC2.1: a dead holder's lock is reclaimed` — pre-write `slot-0.lock` naming the pid of a child that has already exited; the run exits 0 within 10 s and leaves no `slot-0.lock`.
    - `AC3.1: run-tests.js and verify.js serialize on one lock dir, both orders` — copy `tests/fixtures/run-tests/sleep-probe.fixture.js`'s pattern into a temp root as a `.test.js`; run `node tools/run-tests.js {root}` (env from `slotEnv`) first and verify.js second, then the reverse; in each order the second's work starts after the first's ends (use the probe's `CT_PROBE_OUT` and the verify fixture's out file).
    - `AC4.1: a subset-lane run does not wait behind a held full-lane slot` — hold `slot-0.lock` in the base lane with this test's own (live) pid; a `--scope` run whose selection is `scoped` (reuse the file's existing scoped-mode fixture: grep it for `mode scoped`) exits within 10 s with `report.slot.lane === 'subset'`.
    - `AC5.1: a --baseline adjudication waits for a full-lane slot` — a scoped failing `--baseline` run (reuse the file's existing `--baseline` git fixture) while this test's pid holds the base-lane `slot-0.lock`; release it after 2 s by deleting the file; assert the first adjudication log (`*-baseline-*.log` or `*-isolated-*.log` in the log dir) has an mtime after the release and `report.baselineAdjudicated.slot.lane === 'full'`.
    - `AC6.1, AC6.2, AC6.3: slot count source, each case read from report.json slot.source` — `--default-suite-slots 3` with no declaration → `report.slot` `{ slots: 3, source: 'flag' }`; a `--scope` declaration with `concurrency.suiteSlots: 2` plus `--default-suite-slots 3` → `{ slots: 2, source: 'declaration' }`; neither → `{ slots: 1, source: 'default' }`. AC6.4 (validation) is covered by Task 2's declaration tests.
    - `an invalid default declaration falls back with one stderr line` — a repo whose `.claude-tweaks/verify-scope.json` has `concurrency: { suiteSlots: 0 }`, run without `--scope`: exits 0, `report.slot.source === 'default'`, stderr has exactly one line containing `concurrency.suiteSlots`.
    - `AC7.1: CT_TEST_SUITE_SLOT_HELD=1 takes no slot` — with the base-lane `slot-0.lock` held by this test's pid and `CT_TEST_SUITE_SLOT_HELD=1` in the env, the run exits within 10 s and `report.slot` is absent.
    - `AC7.2: the check child sees CT_TEST_SUITE_SLOT_HELD=1 and CT_TEST_WORKERS` — the fixture writes both env values to the out file: `'1'` and a string matching `/^[1-9]\d*$/`.
    - `AC8.1: a waiting run prints one line naming the holder` — hold the base-lane `slot-0.lock` with this test's pid and cwd `/holder-cwd`, start the run, delete the lock after 1 s; stderr has exactly one line matching `/^verify\.js \[full lane\]: waiting for a test-suite slot — held by pid \d+ \(cwd \/holder-cwd\)/` that also contains `concurrency.suiteSlots` and `verify-suite-slots`.
    - `a SIGTERM mid-check kills the check and frees the slot` — start a run whose fixture writes its own `process.pid` to the out file and sleeps 30 s; wait for the pid line, `kill(child.pid, 'SIGTERM')`, await exit: the exit code is 143, no `slot-0.lock` remains, and within 5 s `process.kill(fixturePid, 0)` throws `ESRCH` (POSIX only; `skip` on win32 with a reason).
    - `AC4.2: a scoped selection running a full suite command takes the full lane` — a `--scope` run whose selection is `scoped` but whose selected suite runs its declared full command (no impact block): `report.slot.lane === 'full'`.
    - In `tests/bin-lib/verify/ci-cli.test.js` (reuse its `fakeGhEnv` fixture, with the slot env from `slotEnv`): `a green CI suite takes no slot` — `fakeGhEnv('green', …)`: `report.slot` is absent and the slot dir holds no `slot-*.lock` afterwards; `a red CI suite's local flaky retry runs under a held slot` — `fakeGhEnv('red', …)` with the failing file listed in the declaration's `flaky.files` and a `retry.tests` template whose command writes `process.env.CT_TEST_SUITE_SLOT_HELD` to an out file: the out file reads `1`.
  - `tests/bin-lib/verify/run.test.js`: `runOne with track adds the child while it runs and removes it on close`, `a tracked child is spawned detached on POSIX` (the fake `spawnImpl` records `opts.detached === true`; on win32 it is unset).

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/task3.txt"`
Expected: FAIL (`holdSlot is not a function`; the CLI tests fail on missing `report.slot` and overlapping intervals)

- [ ] **Step 3: Implement `holdSlot`** in `slot.js` per the Interfaces block, then wire `verify.js`:
  - Resolve `concurrency`: under `--scope`, `decl.concurrency`; otherwise read the default declaration at the same path `--stamp-status` discovers (`.claude-tweaks/verify-scope.json` under the checkout root, never under a foreign `--git-dir`); a read that fails validation prints one stderr line `verify.js: concurrency ignored — {first error}` and counts as undeclared. Then `const { slots, source } = resolveSuiteSlots({ declared: concurrency.suiteSlots, flag: parsed.defaultSuiteSlots })`.
  - Lane: `chooseLane({ localCheckCount: localCmds.length, fullSuiteRuns })`, where `fullSuiteRuns` is true when any entry of `localCmds` named other than `types`/`lint` has a command that is neither `impactSubset.command` nor the tool-scoped `{base}`-substituted `tests` command.
  - Tracking: one `const track = new Set()` per run, passed to `runChecks` (it forwards it to `runOne`), to the `runOne` wrapper handed to `runRetries` and to `adjudicate()` (`(args) => runOne({ ...args, track })`); both holds get `beforeRelease: () => { for (const c of track) killTree(c); }`.
  - `const checksHold = holdSlot({ lane, slots, source, sleep })` immediately before the `runChecks` call; `checksHold && checksHold.release()` in a `finally` right after it (the CI-answered retry path at ~line 802 runs before it: wrap each of its `retryHook` calls in its own `holdSlot` of the `subset` lane, so a CI-failed suite's local retries are bounded while a run with no local retry takes no slot).
  - Adjudication: `const adjHold = holdSlot({ lane: 'full', slots, source, sleep })` immediately before `adjudicate()`; pass `slot: adjHold ? adjHold.index : null`; release in a `finally`; put `slot: { lane, index, waitedMs, slots, source }` onto the returned `baselineAdjudicated` object when held.
  - After `composeReport`: `if (checksHold) report.slot = { lane, index, waitedMs, slots, source }` (beside `report.ci`).
  - `sleep`: `(ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)`.

- [ ] **Step 4: Run to verify it passes** — same command as Step 2. Expected: PASS, 0 failures.

- [ ] **Step 5: Prove the serialization test discriminates (AC1.2)** — temporarily replace the `holdSlot(...)` before `runChecks` with `null`, re-run only `cli.test.js`: `AC1.1` and `AC3.1` must fail (overlapping intervals). Restore, re-run, PASS. Record both outputs' summary lines in the task report.

- [ ] **Step 6: Commit** — `git add plugin/bin/lib/verify/slot.js plugin/bin/verify.js plugin/bin/lib/verify/baseline.js plugin/bin/lib/verify/run.js tests/bin-lib/verify/slot.test.js tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/run.test.js`, message `Queue verify.js checks and baseline adjudication behind the machine-wide suite slot (#5119)`.

### Task 4: The `verify-suite-slots` policy key

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (`POLICY_KEYS` row)
- Modify: `plugin/skills/_shared/policy-schema.md` (doc row; headroom move if needed)
- Create (only if the row does not fit under `RAIL_BYTES`): the moved section's new home in `plugin/skills/_shared/policy-schema-coverage.md` (or a section appended there), with a one-line pointer stub left behind
- Modify: `tests/policy-schema.test.js` (`POLICY_KEYS.length` 99 → 100)
- Create: `tests/policy-verify-suite-slots.test.js`

**Interfaces:**
- Produces: `node plugin/bin/resolve-policy.js --values verify-suite-slots` prints `1` when unset, the integer when set to a positive integer, and `1` (with `invalid: true` in the full form) when malformed — confirm each against the resolver before writing the doc row.

- [ ] **Step 1: Write the failing test** — create `tests/policy-verify-suite-slots.test.js` with `AC9.1: verify-suite-slots is an advanced integer key, min 1, default 1` (find the row in `POLICY_KEYS` and assert `{ type: 'integer', min: 1, default: 1, tier: 'advanced' }`) and `AC9.1: resolve-policy prints 1 for an unset verify-suite-slots` (spawn `plugin/bin/resolve-policy.js --values verify-suite-slots` in a temp dir with an empty `.claude-tweaks/policy.yml`, `windowsHide: true`; stdout trimmed is `1`). Bump the pin in `tests/policy-schema.test.js` to `100`.

- [ ] **Step 2: Run to verify it fails**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/task4.txt"`
Expected: FAIL (the new file's key assertion fails: no `verify-suite-slots` row)

- [ ] **Step 3: Add the row** — `{ key: 'verify-suite-slots', type: 'integer', min: 1, default: 1, summary: 'Sets how many test suites and baseline adjudications verify.js may run at once on one machine when the project\'s verify-scope.json declares no concurrency.suiteSlots.', category: '{the category the two *-verify-minutes-ceiling keys use}', tier: 'advanced' }`. Measure `wc -c plugin/skills/_shared/policy-schema.md` against `RAIL_BYTES` (`plugin/bin/lib/skill-audit/budgets.js`); if the row would breach it, first move one section with no citers and no byte pins (check both: `git grep -n -F '{section heading}' -- plugin tests docs`) into `_shared/policy-schema-coverage.md`, leaving a pointer stub, per `shared-contract-extraction`. The doc row states the resolver's unset/set/malformed values from Step 1's probe, that the value is passed to verify.js as `--default-suite-slots`, and that a declared `concurrency.suiteSlots` wins over it.

- [ ] **Step 4: Run to verify it passes** — run the Step 2 command again; then the policy suites: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/task4-green.txt"`. Expected: PASS.

- [ ] **Step 5: Commit** — the changed files by path, message `Add the verify-suite-slots policy key (#5119)`.

### Task 5: Docs and the caller-side flag

**Role:** integration

**Files:**
- Create: `plugin/skills/test/suite-slots.md` (the lanes, the resolution order, the held-slot env vars, worker-cap wiring, sizing guidance)
- Modify: `plugin/skills/test/verification.md` (resolve the policy key once and pass `--default-suite-slots {n}` at each run invocation; one pointer sentence to `suite-slots.md`)
- Modify: `plugin/skills/test/flake-handling.md` and every other skill file that runs verify.js in run mode (not the read-only modes), found by the grep `git grep -n -F 'verify.js" --run' -- plugin/skills`; list each hit in the task report as changed or as citing verification.md's form
- Modify: `docs/plugin-structure.md` (the `test` row of the per-skill sub-file table gains `suite-slots.md`; the verify CLI usage line gains `[--default-suite-slots <n>]` and one clause on the slot)
- Test: the conformance suites that pin these files (find them: `git grep -l -F 'verification.md' -- tests` and `git grep -l -F 'plugin-structure.md' -- tests`)

**Interfaces:**
- Consumes: Task 2's flag name and declaration key, Task 3's lane names, the hint text and the `report.slot` shape, Task 4's key name.

- [ ] **Step 1: Write `suite-slots.md`** with exactly these facts:
  - verify.js takes a slot in the **full lane** whenever any local suite runs its full command (a `--cmd` or declared command), and in the **subset lane** when every local suite runs an impact-subset or tool-scoped command, or only `types`/`lint` run. It holds the slot through the checks and their flaky retries, then releases it. A CI-answered suite's local retries take a subset-lane slot; a run with no local check takes none.
  - The declaration block: `{ "concurrency": { "suiteSlots": N } }`, `N` a positive integer; `suiteSlots` is the only allowed key, and anything else fails validation with `concurrency: must be an object`, `concurrency: unknown key(s) "{k}" (allowed: suiteSlots)` or `concurrency.suiteSlots: must be a positive integer`. Without `--scope`, verify.js still reads the block from the default declaration; a declaration that fails validation there prints `verify.js: concurrency ignored — {first error}` and counts as undeclared.
  - On SIGINT/SIGTERM/SIGHUP while holding a slot, verify.js kills each running check's process tree, frees the slot, and exits 128 + the signal number.
  - `--baseline` adjudication always takes its own **full-lane** slot, so its reruns and its base-side full run queue behind every other full-lane holder.
  - The slot count is `concurrency.suiteSlots` in `.claude-tweaks/verify-scope.json`, else the `verify-suite-slots` policy key (passed as `--default-suite-slots`), else 1, and it applies to both lanes.
  - The lock dir is `CT_TEST_SUITE_SLOT_DIR`, else `<os tmpdir>/ct-test-suite-slots`. It is shared with this repo's `tools/run-tests.js`.
  - While it holds a slot, verify.js sets `CT_TEST_SUITE_SLOT_HELD=1` for its children (so a nested runner skips the lock) and `CT_TEST_WORKERS` (`max(1, floor(cores / (2 × slots)))` unless already set).
  - Wiring examples: `node --test --test-concurrency=$CT_TEST_WORKERS`, `go test -p $CT_TEST_WORKERS ./...`, `pytest -n $CT_TEST_WORKERS`.
  - A waiting run prints one stderr line naming the holder. `report.json` records `slot` and `baselineAdjudicated.slot`.
  - **Sizing.** The right `suiteSlots` depends on what the suites share (one database server, one device, a port range, memory), not on core count. Worked example: a 30-minute suite with 9 sessions at 1 slot is a queue of about 4.5 hours, so raise the count until the shared resource, not the queue, is the limit.
  - Keep the facts stack-agnostic and name no consumer project.

- [ ] **Step 2: Wire the flag.** In `verification.md`, add the policy resolution as its own plain command before the run invocation (`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values verify-suite-slots`, pasting the printed integer as `{slots}`; no `$(...)`, per the file's existing worktree-guard note). Append `--default-suite-slots {slots}` to the run invocations at ~lines 39, 87 and 145, add one sentence pointing at `suite-slots.md`, and do the same for each other site the grep found. Measure `wc -c` on each changed skill file against `RAIL_BYTES` and record the headroom in the task report.

- [ ] **Step 3: Update `docs/plugin-structure.md`'s two lines.**

- [ ] **Step 4: Run the pinning suites**

Run: `node tools/run-tests.js --files-from "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/95c066ab-cefe-4794-a401-6b04f3d200dd/scratchpad/lists/task5.txt"` (extend the list with every suite Files' greps found before running; it already holds `tests/verify-scope-declaration.test.js` — AC10.1: the committed declaration stays readable by the latest release's reader — and the verification.md snippet pins that make AC9.1's invocation clause checkable)
Expected: PASS. A red pin that quotes an invocation is updated to the new invocation. Never delete a pin.

- [ ] **Step 5: Commit** — every changed file by path, message `Document verify.js suite slots and pass --default-suite-slots from the verification procedure (#5119)`.

---

Waived AC2.2: proven by Task 1 Step 4's run of the unchanged `tests/run-tests-isolation.test.js` against the moved module; no new test is needed.
Waived AC10.1: proven by the existing `tests/verify-scope-declaration.test.js` previous-reader pin (Task 5's list and the full suite); this plan leaves the committed declaration unchanged, so there is no new test to write.

## Spec coverage map

| Spec item | Task |
|---|---|
| D1 shipped module, run-tests requires it | 1 |
| D2 lanes, hold through checks/retries, release before adjudication, adjudication full lane, signal/exit release, held env, CI-only/none takes no slot | 2 (lane rules), 3 |
| D3 `concurrency.suiteSlots`, unknown-key error, `--default-suite-slots`, policy key, resolution order, no-`--scope` read and fallback | 2, 3, 4, 5 |
| D4 `CT_TEST_WORKERS` + wiring docs | 3, 5 |
| D5 waiting line + `report.json` `slot` | 1 (label/hint), 3 |
| D6 docs (verification.md, policy-schema.md, declaration docs) | 4, 5 |
| AC1 | 3 `AC1.1` (+ Step 5 discrimination) |
| AC2 | 3 `AC2.1`, run-tests-isolation's reclaim tests (Task 1 green run) |
| AC3 | 3 `AC3.1` |
| AC4 | 2 `chooseLane`, 3 `AC4.1`, `AC4.2` |
| AC5 | 3 `AC5.1` |
| AC6 | 3 `AC6.1-AC6.3`, 2 declaration tests (AC6.4) |
| AC7 | 3 `AC7.1`, `AC7.2` |
| AC8 | 3 `AC8.1`, 1 label tests |
| AC9 | 4 |
| AC10 | unchanged committed declaration; `tests/verify-scope-declaration.test.js` in the full suite |
