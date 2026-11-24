# Driver Exits Carry Outcome, Actor and Reason — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The driver mirror writes every driver step `exited` line on the new outcome contract: every exit carries `payload.actor`, every non-passing exit carries `payload.reasonCode`, and the outcome follows the record's plan-review decisions (red tests are `failed`/`test-failed`; any other `stop` is `stopped`/`unspecified` with the driver's words in `reasonText`).

**Architecture:** `plugin/bin/lib/driver/steps.js`'s test step stamps the `verify.js` exit code on its line (`verifyExit`) for the outcomes it decides from that code — the red-tests `stop`, the verdict-less `fail`, and the tree-check `fail` of a verdict-less run — so the mirror classifies them from a structured field rather than free text (a verdict-less detail is `verify.js`'s own stderr first line, which no pattern can recognize). `plugin/bin/lib/station-events/stations.js` (the one vocabulary home) changes only `DRIVER_STATUS_OUTCOMES` (`stop → stopped`). `plugin/bin/lib/station-events/driver-mirror.js` holds, locally, a driver-step-to-actor table (named through `ACTOR.*`) and the `ci` detail words the driver itself calls a failed read, and (pure mapper, run by `plugin/bin/lib/driver/run.js`'s `mirroredSink`) adds `actor`, `reasonCode` and, on a stop, `reasonText`. `run.js` needs no code change; its test file proves the path end to end through the real sink.

**Tech Stack:** Node.js (CommonJS), `node:test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-24T045911-record-6149/work/6149-spec.md` (its "Decisions on the plan review" section governs where it and the Deliverables differ).

Scope keywords: DRIVER_STATUS_OUTCOMES, outcomeForDriverStatus, stationEventsFor, verdictlessDetail

## Global Constraints

- "No prose is asked to log; only code that already makes the transition does." — the mirror and the test step are that code; no skill text changes.
- "A reason that nothing knows is `unspecified`, counted and shown, never silently dropped, and never blocks the outcome."
- "Four outcomes: `passed`, `sent-back`, `failed`, `stopped`."
- Every station name, kind, outcome and lane literal lives in `plugin/bin/lib/station-events/stations.js`; `tests/bin-lib/station-events/station-literal-conformance.test.js` scans for violations. Name reason codes through `REASON.*`, actors through `ACTOR.*`, kinds through `KIND.*`, outcomes through `OUTCOME.*`.
- Emission never blocks or fails a transition; add no throw on any emission path.
- Driver event lines: "Fields are added and never renamed" (`docs/driver.md`). `verifyExit` is an added field.

## Decisions (from the record body, 2026-11-23 — authoritative)

The mapping, per step line (`step`, `status`, `detail`, `verifyExit`):

| Line | `outcome` | `payload.reasonCode` | `payload.reasonText` |
|---|---|---|---|
| any step, `ok` | `passed` | absent | absent |
| `test`, `stop`, `verifyExit: 1` (red tests) | `failed` | `test-failed` | absent |
| `test`, `fail`, `verifyExit` present (any value: `null` or a non-0/1 code — verdict-less) | `failed` | `infrastructure` | absent |
| `test`, `fail`, no `verifyExit` (an interrupt, a throw, a dirty tree after a green run, an index flag) | `failed` | `unspecified` | absent |
| `ci`, `fail` or `stop`, `detail` one of `read-failed`, `gh-absent`, `no-pr` | per status | `infrastructure` | on a stop: the detail |
| any other `fail` | `failed` | `unspecified` | absent |
| any other `stop` | `stopped` | `unspecified` | the detail, when a non-empty string |

`payload.actor`: `agent` for `worker`/`test`/`review`, `script` for `pr`/`ci`/`merge`, on every `exited`. `DRIVER_STATUS_OUTCOMES.stop` is `stopped`; the red-tests line is the one exception, keyed on its structured field.

- **Why `verifyExit`, not the detail.** Decision 1 keys red tests on detail `red tests`, but under `implementer-tier: record` a red line's detail gains `; {relaunch note}` (`withRelaunchNote`, `noRelaunch` path), and a verdict-less detail is `verify.js`'s stderr first line, unrecognizable. One structured field covers both exactly: it is set only on the returns that decide from `r.code` (`steps.js` `if (r.code === 1)`, `if (r.code !== 0)`, and the tree-check composite whose detail carries `verdictlessDetail(r)`). The composite is `infrastructure` (plan-review settlement: verify.js gave no verdict). A red-tests stop that queues a relaunch is still `failed`/`test-failed` (plan-review settlement: Decision 1 as written).
- **`ci` reachability (Decision 2).** `ciStep` always returns `status: 'ok'`; a `ci` line is non-passing only on a throw or an interrupt, neither of which carries one of the three words. The `infrastructure` branch is exercised only by unit-test lines; every real `ci` line is written as the driver gives it (`passed`, actor `script`). State this in the PR description and in `docs/reference/station-events.md` under the driver mapping: "a red CI state is data for the reviewer, not an exit; it is not mirrored as a failure."
- **`steps.js` is outside the record's Files.** Adding `verifyExit` there is the minimum the Decision-1 mapping needs (scope-creep policy `add-to-plan`, settled at plan review; no sibling record owns `steps.js`); it adds one line field and changes no status, detail, or stop. `merge-park`'s `returned` (`MERGE_SUBSTEP_TRANSITIONS`) is not a driver step status and stays (record 8/8 migrates retired outcomes).

## Review Focus

1. A transition whose code path cannot name a reason writes `unspecified` and still writes the `exited` line (the emitter accepts it) — Task 2 tests 3 and 4.
2. A `stop` on any step other than the red-tests case writes `stopped`, `unspecified`, an actor and `reasonText` = detail — Task 2 test 4.
3. Every `DRIVER_STEP_STATIONS` key has an actor, so no `exited` is written with `actor: undefined` (which `emit.js` would reject and drop) — Task 2 test 5.
4. A passed exit never carries `reasonCode` or `reasonText` — Task 2 test 6.
5. `verifyExit` appears on exactly the red-tests stop, the verdict-less fail and the verdict-less tree-check fail lines, never on a green, green-dirty-tree or index-flag line — Task 1.

---

### Task 1: The test step's line carries the verify.js exit code

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js` (`testStep`'s red-tests return and verdict-less return only)
- Test: `tests/bin-lib/driver/run.test.js`

**Interfaces:**
- Produces: the driver `test` step line gains `verifyExit` (`1` on the red-tests `stop`; `r.code` — `null` or a non-0/1 integer — on the verdict-less `fail` and on the tree-check `fail` of a verdict-less run). No other line changes.

- [ ] **Step 1: Write the failing test**

In `tests/bin-lib/driver/run.test.js`, beside `verify exit 1 is the red-tests stop; any other non-zero exit is a fail carrying its own words` (reuse `harness`, `on`, `lastLine`, and `h.lines()` as that file's other tests do): `#6149 the test line carries verifyExit on a red-tests stop and a verdict-less fail, and nowhere else` — for `[[1, 1], [2, 2], [137, 137], [null, null]]` (`{ code, stdout: '', stderr: 'x' }`), the `step === 'test'` line has `verifyExit` equal to the second element (`Object.hasOwn` true); for a green run (default harness) the test line has no own `verifyExit`; a verdict-less run (`code: 2`) whose worktree differs from HEAD afterwards (copy the dirty-tree script shape from the existing `treeDetail` tests near `verify exit 1 is the red-tests stop`) has `verifyExit: 2` and its detail still starts with the tree detail; a green run with a dirty tree has none.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/run-tests.js tests/bin-lib/driver/run.test.js`
Expected: FAIL — `verifyExit` is absent.

- [ ] **Step 3: Implement**

In `testStep`: `if (r.code === 1) return { status: 'stop', reason: 'failing-test', detail: 'red tests', extra: { verifyExit: 1 } };` and `if (r.code !== 0) return { status: 'fail', detail: verdictlessDetail(r), extra: { verifyExit: r.code === undefined ? null : r.code } };`; the composite becomes `{ ...treeStop, detail: …unchanged…, extra: { verifyExit: r.code === undefined ? null : r.code } }`. Extend the comment above the red return by one clause naming `verifyExit` as the station mirror's key (#6149).

- [ ] **Step 4: Run test to verify it passes**

Run: `node tools/run-tests.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/steps.test.js`
Expected: PASS, 0 failures. (If `tests/bin-lib/driver/steps.test.js` does not exist, drop it from the command.)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/steps.js tests/bin-lib/driver/run.test.js
git commit -m "Stamp verify.js's exit code on the driver test line — refs #6149"
```

### Task 2: Driver exits carry outcome, actor and reason

**Role:** integration

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/station-events/stations.js` (`DRIVER_STATUS_OUTCOMES` only)
- Modify: `plugin/bin/lib/station-events/driver-mirror.js` (`stationEventsFor`'s step branch; new local `DRIVER_STEP_ACTORS`, `CI_READ_FAILURE_DETAILS`, `exitPayload`)
- Test: `tests/bin-lib/station-events/driver-mirror.test.js`, `tests/bin-lib/station-events/stations.test.js` (line 84: `outcomeForDriverStatus('stop')` now `'stopped'`), `tests/bin-lib/driver/run.test.js`
- No change: `plugin/bin/lib/driver/run.js` — `mirroredSink` already forwards every mirrored event unchanged.

**Interfaces:**
- Consumes: Task 1's `verifyExit`; `REASON.TEST_FAILED`, `REASON.INFRASTRUCTURE`, `REASON.UNSPECIFIED`, `ACTOR.AGENT`, `ACTOR.SCRIPT`, `KIND.EXITED`, `OUTCOME.*` from `stations.js`.
- Produces: `stations.js` `DRIVER_STATUS_OUTCOMES = { ok: OUTCOME.PASSED, fail: OUTCOME.FAILED, stop: OUTCOME.STOPPED }` (frozen; `outcomeForDriverStatus` unchanged). Local to `driver-mirror.js` (not exported from `stations.js`): `DRIVER_STEP_ACTORS = { worker: ACTOR.AGENT, test: ACTOR.AGENT, review: ACTOR.AGENT, pr: ACTOR.SCRIPT, ci: ACTOR.SCRIPT, merge: ACTOR.SCRIPT }` and `CI_READ_FAILURE_DETAILS = ['read-failed', 'gh-absent', 'no-pr']` (both frozen); export `DRIVER_STEP_ACTORS` from `driver-mirror.js` beside `stationEventsFor` for test 5.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/station-events/driver-mirror.test.js` (reuse `line`, `ID`, `TS`, `buildLine`; add `const exitedOf = (over) => stationEventsFor(line(over), ID).find((e) => e.kind === 'exited');`). Each new-contract assertion also checks `buildLine(e)` is truthy (the emitter accepts it):

1. `AC1.1: a red-tests stop at the test step mirrors to exited failed with reasonCode test-failed and actor agent` — `exitedOf({ step: 'test', status: 'stop', detail: 'red tests', verifyExit: 1 })` → `[outcome, payload.reasonCode, payload.actor]` = `['failed', 'test-failed', 'agent']`, no `reasonText`; the same with `detail: 'red tests; no relaunch: no step-up'` gives the same triple.
2. `AC1.1: a verdictless fail at the test step mirrors to exited failed with reasonCode infrastructure` — for `verifyExit` in `[2, 137, null]`: `exitedOf({ step: 'test', status: 'fail', detail: 'verify exited 2', verifyExit })` → `['failed', 'infrastructure', 'agent']`. And `AC1.1: a failed ci step classified infrastructure mirrors with reasonCode infrastructure` — for each of `read-failed`, `gh-absent`, `no-pr`: `exitedOf({ step: 'ci', status: 'fail', detail })` → `['failed', 'infrastructure', 'script']`; `exitedOf({ step: 'ci', status: 'stop', detail: 'gh-absent' })` → outcome `stopped`, `infrastructure`, `reasonText` `'gh-absent'`.
3. `AC2.1: an interrupted fail at the test step mirrors to exited failed with reasonCode unspecified` — `exitedOf({ step: 'test', status: 'fail', detail: 'interrupted by SIGTERM' })` → `['failed', 'unspecified', 'agent']`; also a dirty-tree fail (`detail: 'the worktree differs from HEAD after the test step on 1 path(s): a.js'`, no `verifyExit`) → `unspecified`; `exitedOf({ step: 'ci', status: 'fail', detail: 'interrupted by SIGTERM' }).payload.reasonCode` and `exitedOf({ step: 'worker', status: 'fail' }).payload.reasonCode` are `unspecified`.
4. `AC2.1: a stop at any other step mirrors to exited stopped with reasonCode unspecified and the driver reason in reasonText` — `exitedOf({ step: 'pr', status: 'stop', detail: 'no changed files' })` → `[outcome, reasonCode, actor, reasonText]` = `['stopped', 'unspecified', 'script', 'no changed files']`; a test-step stop without `verifyExit` (`detail: '.claude-tweaks/verify-scope.json is not a regular file (dir); verify.js was not run'`) → `stopped`, `unspecified`, `agent`, that detail; a stop with no detail has no `reasonText`; a red-tests detail **without** `verifyExit` is `stopped` (the field, not the text, is the key).
5. `every driver step station has an actor` — sorted `Object.keys(DRIVER_STEP_STATIONS)` (from `stations.js`) deep-equals sorted `Object.keys(DRIVER_STEP_ACTORS)` (from `driver-mirror.js`), and every value matches `ACTORS`.
6. `an ok step mirrors to exited passed with actor and no reason` — for `[['worker','agent'],['test','agent'],['review','agent'],['pr','script'],['ci','script'],['merge','script']]`: outcome `passed`, `payload.actor` as listed, no own `reasonCode` or `reasonText`; `exitedOf({ step: 'ci', detail: 'read-failed' })` (status ok) has no `reasonCode`.
7. Rename `a step status maps to its outcome: fail -> failed, stop -> returned` to `... stop -> stopped`, expect `'stopped'`, and add: `stationEventsFor(line({ status: 'bogus' }), ID)` has no `exited`.
8. Update the first test's worker `deepEqual` fixture: the `exited` payload is `{ step: 'worker', actor: 'agent' }`.

In `tests/bin-lib/station-events/stations.test.js` line 84: expect `'stopped'`.

In `tests/bin-lib/driver/run.test.js`, inside the `#5902` mirror block: `#6149 a red test step mirrors through the real sink as exited test failed, reasonCode test-failed, actor agent` — `const seen = []; const h = harness({ deps: { stationEvent: (e) => seen.push(e) }, script: [[on('node', /verify\.js$/), { code: 1, stdout: '', stderr: '' }]] }); await run(['#7'], h.deps);` then the `seen` entry with `kind === 'exited' && payload.step === 'test'` has `[station, outcome, payload.reasonCode, payload.actor]` = `['test', 'failed', 'test-failed', 'agent']`; and `#6149 a verdict-less test run mirrors as infrastructure` — the same with `{ code: 2, stdout: '', stderr: 'boom' }` gives `['test', 'failed', 'infrastructure', 'agent']`. If `harness` does not take `deps.stationEvent` this way, copy the wiring from the `#5902` tests above it rather than inventing one.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/station-events/driver-mirror.test.js tests/bin-lib/station-events/stations.test.js tests/bin-lib/driver/run.test.js`
Expected: FAIL — `returned` / missing `payload.actor` / missing `payload.reasonCode`.

- [ ] **Step 3: Implement**

`stations.js`: `DRIVER_STATUS_OUTCOMES.stop` becomes `OUTCOME.STOPPED`, with a one-line comment naming the red-tests exception (keyed on the line's `verifyExit`, `driver-mirror.js`). `driver-mirror.js`: the two local constants; give `CI_READ_FAILURE_DETAILS` a one-line comment citing `steps.js`'s `ciStep` "failed read" words.

`driver-mirror.js`: `function exitPayload(step, event, outcome)` returns `{ step, actor: DRIVER_STEP_ACTORS[step] }` for `OUTCOME.PASSED`; otherwise adds `reasonCode` per the Decisions table (test + `verifyExit === 1` → `TEST_FAILED`; test + `fail` + own `verifyExit` → `INFRASTRUCTURE`; ci + `CI_READ_FAILURE_DETAILS.includes(event.detail)` → `INFRASTRUCTURE`; else `UNSPECIFIED`) and, when `outcome === OUTCOME.STOPPED` and `detail` is a non-empty string, `reasonText: event.detail`. The outcome is `OUTCOME.FAILED` for the red-tests line, else `outcomeForDriverStatus(status)`. Spell the kind `KIND.EXITED`. No other branch changes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tools/run-tests.js tests/bin-lib/station-events/driver-mirror.test.js tests/bin-lib/driver/run.test.js tests/bin-lib/station-events/stations.test.js tests/bin-lib/station-events/station-literal-conformance.test.js tests/bin-lib/station-events/transition-table.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/station-events/stations.js plugin/bin/lib/station-events/driver-mirror.js tests/bin-lib/station-events/driver-mirror.test.js tests/bin-lib/station-events/stations.test.js tests/bin-lib/driver/run.test.js
git commit -m "feat: driver exits carry outcome, actor and reason — refs #6149"
```

### Task 3: Document the mapping and the new line field

**Role:** integration

**Files:**
- Modify: `docs/reference/station-events.md` (line 35's driver `worker` cell `stop` returned → the new mapping; line 166's driver-mirror row: outcome cell per the Decisions table, payload cell `step`, `actor`, `reasonCode`, `reasonText`; one sentence under the table: "a red CI state is data for the reviewer, not an exit; it is not mirrored as a failure.", and that the `ci` `infrastructure` branch is reached only by a non-passing `ci` line, which the driver writes today only on a throw or an interrupt)
- Modify: `docs/driver.md` (line 99's step-line field list: "the `test` step adds `verifyExit`, `verify.js`'s exit code (`null` when it did not exit), on a red-tests stop and a verdict-less fail (#6149)"; line 138's Station events paragraph: one clause that each `exited` carries an actor and, when not passed, a reason code — mapping in the reference)
- Modify: `docs/plugin-structure.md:34` (the `driver-mirror.js` clause: add "; every step `exited` carries `payload.actor` and, when not `passed`, `payload.reasonCode` (#6149)")

Behavior-change prose sweep: `git grep -n -i -e "stop. is .returned" -e "stop returned" -e "stop: 'returned'"` lists only `docs/reference/station-events.md:35,166`, `stations.js:97` and the old test name — the doc lines change here, the code and test in Task 2.

- [ ] **Step 1: Edit the three files as above.**
- [ ] **Step 2: Run** `node tools/run-tests.js tests/docs` if such a directory exists, else the docs conformance tests `git grep -l "station-events.md\|driver.md" tests` names. Expected: PASS.
- [ ] **Step 3: Commit**

```bash
git add docs/reference/station-events.md docs/driver.md docs/plugin-structure.md
git commit -m "Document driver exit outcomes, actors and reasons — refs #6149"
```
