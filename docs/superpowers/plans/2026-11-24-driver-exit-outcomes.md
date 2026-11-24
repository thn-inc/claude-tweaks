# Driver Exits Carry Outcome, Actor and Reason — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The driver mirror writes every driver step `exited` line on the new outcome contract: `stop` maps to `stopped`, every exit carries `payload.actor`, and every non-passing exit carries `payload.reasonCode`.

**Architecture:** `plugin/bin/lib/station-events/stations.js` (the one vocabulary home) gains the status-to-outcome correction, a driver-step-to-actor table and the list of `ci` detail words the driver itself classifies as a failed CI read. `plugin/bin/lib/station-events/driver-mirror.js` (pure mapper, run by `plugin/bin/lib/driver/run.js`'s `mirroredSink`) adds `actor` to every step `exited` payload and `reasonCode` to every non-`passed` one. `run.js` needs no code change; its test file gets one end-to-end proof through the real sink.

**Tech Stack:** Node.js (CommonJS), `node:test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-24T043730-record-6149/work/6149-spec.md`

Scope keywords: DRIVER_STATUS_OUTCOMES, outcomeForDriverStatus, stationEventsFor

## Global Constraints

- "No prose is asked to log; only code that already makes the transition does." — the mirror is that code; no skill text changes.
- "A reason that nothing knows is `unspecified`, counted and shown, never silently dropped, and never blocks the outcome."
- "Four outcomes: `passed`, `sent-back`, `failed`, `stopped`."
- Every station name, kind, outcome and lane literal lives in `plugin/bin/lib/station-events/stations.js`; `tests/bin-lib/station-events/station-literal-conformance.test.js` scans for violations. Name reason codes through `REASON.*`, actors through `ACTOR.*`, kinds through `KIND.*`, outcomes through `OUTCOME.*`.
- Emission never blocks or fails a transition; add no throw on any emission path.
- `actor` is `agent`, `script`, `person` or `rule:<id>`.

## Decisions taken at plan time

- **`stop` → `stopped`.** The spec's `stop: <per Task 1>`: record E1's `docs/reference/station-events.md` names no replacement; E2 (#6146) added `OUTCOME.STOPPED`, and the spec's four-outcome constraint leaves `stopped` as the only fit. `MERGE_SUBSTEP_TRANSITIONS`'s `merge-park` `returned` is not a driver *step status* and stays (record 8/8 migrates retired outcomes).
- **The driver's own CI failure classification.** `plugin/bin/lib/driver/steps.js`'s `ciStep` header names `read-failed`, `gh-absent` and `no-pr` as "a failed read" (the read never saw the checks). Those three words, exactly, are the infrastructure class: `CI_READ_FAILURE_DETAILS`. `timeout`, `no-ci`, `stale` and the check verdicts (`red`, …) are not failed reads and stay `unspecified`.
- **Reachability, stated honestly.** `ciStep` always returns `status: 'ok'` with the state word as `detail`; a `ci` line is `fail` only on a throw (detail = error message) or an interrupt (detail `interrupted by {signal}`), neither of which carries one of the three words today. So the `infrastructure` branch is exercised by the mirror's unit test over a synthetic `fail` line, and a real `ci` failure today writes `unspecified`. Record this in the PR body's notes; changing `ciStep`'s status is out of this record's Files.

## Review Focus

1. A driver step line whose `status` is outside `ok|fail|stop` still writes no `exited` (unchanged behavior) — pinned by the existing mapping test plus Task 1's "unknown status" assertion.
2. A `stop` on any step (not only `ci`) writes `stopped` with `reasonCode: 'unspecified'` and an actor, and the emitter accepts it (a `stopped` exit without an actor is rejected by `emit.js`) — Task 1 test 4.
3. Every `DRIVER_STEP_STATIONS` key has an actor, so no `exited` is written with `actor: undefined` (which `emit.js` would reject and drop) — Task 1 test 5.
4. A passed exit never carries `reasonCode` — Task 1 test 3.
5. An interrupted `ci` step (`detail: 'interrupted by SIGTERM'`) is `unspecified`, not `infrastructure` — Task 1 test 4.

---

### Task 1: Driver exits carry outcome, actor and reason

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/station-events/stations.js` (`DRIVER_STATUS_OUTCOMES`, new `DRIVER_STEP_ACTORS`, new `CI_READ_FAILURE_DETAILS`, exports)
- Modify: `plugin/bin/lib/station-events/driver-mirror.js` (`stationEventsFor`'s step branch, new local `reasonFor`)
- Modify: `docs/reference/station-events.md` (line 35's driver `worker` cell `stop` returned → `stop` stopped; line 166's driver-mirror row: outcome cell `stop` is `stopped`, payload cell `step`, `actor` (`script` for `pr`/`ci`/`merge`, `agent` for `worker`/`test`/`review`), `reasonCode` on every non-`passed` exit (`test-failed` for a failed `test`, `infrastructure` for a non-passing `ci` whose detail is `read-failed`/`gh-absent`/`no-pr`, else `unspecified`)). Behavior-change prose sweep: `git grep -n -i -e "stop. is .returned" -e "stop returned" -e "stop: 'returned'"` lists only these two doc lines, `stations.js:97` and the existing test name — all four change here.
- Modify: `docs/plugin-structure.md:34` (the `driver-mirror.js` clause: add "; since #6149 every step `exited` carries `payload.actor` and, when not `passed`, `payload.reasonCode`")
- Test: `tests/bin-lib/station-events/driver-mirror.test.js`, `tests/bin-lib/driver/run.test.js`, `tests/bin-lib/station-events/stations.test.js` (line 84: `outcomeForDriverStatus('stop')` now `'stopped'`)
- No change (plan audit Check B/F hits, classified): `plugin/bin/lib/driver/run.js` — `mirroredSink` already forwards every mirrored event unchanged; `docs/superpowers/plans/2026-11-23-station-transition-capture.md` — a shipped plan, history.

**Interfaces:**
- Produces (exported from `stations.js`):
  - `DRIVER_STATUS_OUTCOMES = { ok: OUTCOME.PASSED, fail: OUTCOME.FAILED, stop: OUTCOME.STOPPED }` (frozen; `outcomeForDriverStatus` unchanged)
  - `DRIVER_STEP_ACTORS = { worker: ACTOR.AGENT, test: ACTOR.AGENT, review: ACTOR.AGENT, pr: ACTOR.SCRIPT, ci: ACTOR.SCRIPT, merge: ACTOR.SCRIPT }` (frozen)
  - `CI_READ_FAILURE_DETAILS = ['read-failed', 'gh-absent', 'no-pr']` (frozen)
- Consumes: `REASON.TEST_FAILED`, `REASON.INFRASTRUCTURE`, `REASON.UNSPECIFIED`, `KIND.EXITED`, `OUTCOME.PASSED` from `stations.js` (E2, already on main).

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/station-events/driver-mirror.test.js` (reuse its `line`, `ID`, `TS`, `buildLine` helpers; `exitedOf = (over) => stationEventsFor(line(over), ID).find((e) => e.kind === 'exited')`):

1. `AC1.1: a failed test step mirrors to exited failed with reasonCode test-failed and actor agent` — `exitedOf({ step: 'test', status: 'fail' })` → `[outcome, payload.reasonCode, payload.actor]` deep-equals `['failed', 'test-failed', 'agent']`; `buildLine(e)` is truthy (the emitter accepts it).
2. `AC1.1: a failed ci step classified infrastructure mirrors with reasonCode infrastructure` — for each of `read-failed`, `gh-absent`, `no-pr`: `exitedOf({ step: 'ci', status: 'fail', detail })` → `['failed', 'infrastructure', 'script']`; `buildLine` truthy.
3. `AC1.1: an ok step mirrors to exited passed with actor` — for `[['worker','agent'],['test','agent'],['review','agent'],['pr','script'],['ci','script'],['merge','script']]`: outcome `passed`, `payload.actor` as listed, `'reasonCode' in payload` is `false`; also `exitedOf({ step: 'ci', detail: 'read-failed' })` (status ok) has no `reasonCode`.
4. `AC1.1 AC2.1: a step with no known reason mirrors with reasonCode unspecified` — `exitedOf({ step: 'ci', status: 'fail', detail: 'interrupted by SIGTERM' })` → `['failed', 'unspecified']`; `exitedOf({ step: 'ci', status: 'fail', detail: 'timeout' }).payload.reasonCode === 'unspecified'`; `exitedOf({ step: 'worker', status: 'fail' }).payload.reasonCode === 'unspecified'`; `exitedOf({ step: 'pr', status: 'stop' })` → outcome `stopped`, reasonCode `unspecified`, actor `script`, and `buildLine` truthy (the `exited` line is still written).
5. `every driver step station has an actor` — `Object.keys(DRIVER_STEP_STATIONS)` deep-equals `Object.keys(DRIVER_STEP_ACTORS)` (sorted), and every value matches `ACTORS`.
6. Rename the existing `a step status maps to its outcome: fail -> failed, stop -> returned` to `... stop -> stopped` and expect `'stopped'`; add an assertion that `stationEventsFor(line({ status: 'bogus' }), ID)` has no `exited`.
7. Update the existing worker `deepEqual` fixture's `exited` payload to `{ step: 'worker', actor: 'agent' }`.

In `tests/bin-lib/driver/run.test.js`, inside the `#5902` mirror block: `#6149 a red test step mirrors through the real sink as exited test failed, reasonCode test-failed, actor agent` — `const seen = []; const h = harness({ deps: { stationEvent: (e) => seen.push(e) }, script: [[on('node', /verify\.js$/), { code: 1, stdout: '', stderr: '' }]] }); await run(['#7'], h.deps);` assert the driver stopped at `test` with `fail` (`stopOf(h).slice(0, 2)` deep-equals `['test', 'fail']`), then the one `seen` entry with `kind === 'exited' && payload.step === 'test'` has `[station, outcome, payload.reasonCode, payload.actor]` = `['test', 'failed', 'test-failed', 'agent']`. If a red `verify.js` alone does not stop at `test` in this harness, copy the red-run script shape from the existing `AC1.1 (#5454)`/`AC2.1 (#5415)` tests rather than inventing one.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/station-events/driver-mirror.test.js tests/bin-lib/driver/run.test.js`
Expected: FAIL — the new assertions fail on `returned` / missing `payload.actor` / missing `payload.reasonCode`.

- [ ] **Step 3: Implement**

`stations.js`: the three constants above, exported beside `DRIVER_STEP_STATIONS`; replace the "Names are unconfirmed" note on `DRIVER_STATUS_OUTCOMES` only if it no longer applies (the `stopped` choice comes from the four-outcome contract), and give `CI_READ_FAILURE_DETAILS` a one-line comment citing `steps.js`'s `ciStep` "failed read" words.

`driver-mirror.js`: `function reasonFor(step, event)` → `REASON.TEST_FAILED` when `step === 'test'`; `REASON.INFRASTRUCTURE` when `step === 'ci'` and `CI_READ_FAILURE_DETAILS.includes(event.detail)`; else `REASON.UNSPECIFIED`. In the step branch, the `exited` payload is `{ step, actor: DRIVER_STEP_ACTORS[step] }` plus `reasonCode: reasonFor(step, event)` when `outcome !== OUTCOME.PASSED`; spell the kind as `KIND.EXITED`. No other branch changes.

`docs/reference/station-events.md`: the two cells named under Files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tools/run-tests.js tests/bin-lib/station-events/driver-mirror.test.js tests/bin-lib/driver/run.test.js tests/bin-lib/station-events/stations.test.js tests/bin-lib/station-events/station-literal-conformance.test.js tests/bin-lib/station-events/transition-table.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/station-events/stations.js plugin/bin/lib/station-events/driver-mirror.js docs/reference/station-events.md docs/plugin-structure.md tests/bin-lib/station-events/driver-mirror.test.js tests/bin-lib/driver/run.test.js tests/bin-lib/station-events/stations.test.js
git commit -m "feat: driver exits carry outcome, actor and reason — refs #6149"
```
