# Hold State and Changed-Only Blocker Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write `held` / `released` station events where program code adds or removes a hold label, and append a `blockers` snapshot only when it changed.

**Architecture:** The changed-only snapshot (`blockersChanged`, `lastBlockersPayload`, the `lastPayload` dep in `resolve-blockers.js`) and a first `makeHoldSink` already landed in commit `f92cb72b53` with the five acceptance tests. This plan makes the hold builder pure and clock-free (`holdEvent`, caller-supplied discriminator), then wires it into the code that already performs each hold transition: the driver's event mirror (`settle-label` adds `bot:blocked`; an applied `merge-park` adds `bot:parked`) and `apply-refine-labels.js` (any hold label added or removed by a refine action). `accept:changes-requested` is applied only by skill prose (`docs/reference/station-events.md`), so it gets the `why` mapping but no producer — no prose is asked to log.

**Tech Stack:** Node.js (CommonJS), `node:test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-24T104349-record-6151/work/6151-spec.md` (re-materialized with the record's three plan-review Decisions)

## Global Constraints

- "No prose is asked to log; only code that already makes the transition does."
- "A reason that nothing knows is `unspecified`, counted and shown, never silently dropped, and never blocks the outcome."
- Every station name, kind, outcome and lane literal lives in `plugin/bin/lib/station-events/stations.js`; `tests/bin-lib/station-events/station-literal-conformance.test.js` scans for violations. This plan makes no change to `stations.js`.
- Emission never blocks or fails a transition: no throw on any emission path.
- `held` payload `{ why, ref? }`, `released` payload `{ why }`, `why` one of `HOLD_WHYS` (`blocked`, `parked`, `changes-requested`, `waiting-on-you`); filed under the station the item is at.
- `discriminator` is a stable string the caller already holds, never `Date.now` / `new Date()` (`docs/reference/station-events.md`).
- Plan-review Decision 1: `held` / `released` carry no `actor`; `emit.js` is not changed.
- Plan-review Decision 2: `ref` on `held` names only a blocking record (`#N` or `owner/repo#N`); a hold with no blocking record (a driver stop) omits `ref` — a step name is never written there.
- Plan-review Decision 3: a hold label edited through refine files under `authorize` always; no station is derived from labels.
- Driver hold facts ride structured line fields (`stopStep` on `settle-label`, `parked` on `merge-park`), never a parse of `detail`: `merge.js`'s `stop()` writes `detail` as `{reason}: {lock text}`, so the lock text is not a prefix.

## Review Focus

- A label that is not a hold label (`ready`, `auto:build`) passed to the hold builder → no event.
- A `merge-park` whose label did NOT read back (`parked: false`) → no `held` line (the record is not held by label).
- A `settle-label` line that failed (status `fail`) → no `held` line.
- A `settle-label` stop at the `claim` step → `held` filed under `release` (the record never entered `build`); any other step with no driver station (`check`, `run-dir`) → `build`; never dropped.
- A refine action that removes `bot:blocked` alongside adding `auto:build` → existing authorize events unchanged, plus one `released`.

Test runner: `node tools/run-tests.js <file.test.js> [...]`.

---

### Task 1: Pure, clock-free hold builder

**Files:**
- Modify: `plugin/bin/lib/station-events/blockers.js`
- Test: `tests/bin-lib/station-events/blockers.test.js`
- Already landed (`f92cb72b53`, verify only): `plugin/bin/resolve-blockers.js`, `tests/resolve-blockers-cli.test.js`

The five acceptance tests already exist and must keep passing: `an unchanged snapshot is not appended`; `a changed blocker set is appended`; `the first snapshot for a record is appended`; `adding bot:blocked writes held why blocked with the blocker ref`; `removing it writes released why blocked`.

**Interfaces:**
- Produces: `holdEvent({ label, added, recordNumber, repoName, station, lane, runId, sessionId, ref, discriminator, at }) -> event | null` (`at` optional, default `null` — the emitter then stamps the emit time) — `null` for a label not in the hold map; `kind` `KIND.HELD` when `added`, `KIND.RELEASED` otherwise; payload `{ why, ref }` on `held` when `ref` is a string, else `{ why }`; `lane` defaults to `'unknown'`, `runId`/`sessionId` to `null`. `makeHoldSink({ stationEvent })` → `(args) => void` calls `stationEvent(holdEvent(args))` when non-null, swallows throws, inert without a function. `HOLD_LABEL_WHY` exported (label → why). The args object uses `recordNumber` (rename from the current `number`).

- [ ] **Step 1: Update and add tests** — in the two existing hold tests, pass `recordNumber: 11` and `discriminator: 'd-1'` and assert `events[0].discriminator === 'd-1'`; add:
  - `a non-hold label writes nothing` — `makeHoldSink({ stationEvent })({ label: 'ready', added: true, ... })` → `events` is `[]`; `holdEvent({ label: 'ready', added: true })` is `null`.
  - `every hold label maps into HOLD_WHYS` — every value of `HOLD_LABEL_WHY` is in `HOLD_WHYS`, and its keys are exactly `bot:blocked`, `bot:parked`, `accept:changes-requested`.
  - `bot:parked added writes held why parked with no ref` — payload deep-equals `{ why: 'parked' }`.
- [ ] **Step 2: Run** `node tools/run-tests.js tests/bin-lib/station-events/blockers.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `holdEvent` and rewrite `makeHoldSink` over it; remove the `new Date()` discriminator.
- [ ] **Step 4: Run** the Step 2 command — Expected: PASS.
- [ ] **Step 5: Commit** `feat: build hold events purely, with the caller's discriminator — refs #6151`.

### Task 2: Driver holds — `settle-label` and an applied park

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/station-events/driver-mirror.js`, `plugin/bin/lib/driver/run.js` (`settleStop`'s `emit`), `plugin/bin/lib/driver/merge.js` (`park`'s final `stop` line)
- Test: `tests/bin-lib/station-events/driver-mirror.test.js`, `tests/bin-lib/driver/run.test.js`, `tests/bin-lib/driver/merge.test.js`

**Interfaces:**
- Consumes: `holdEvent` (Task 1).
- Produces: the `settle-label` driver line carries `stopStep` (the stopped step's name, `stopObject(...).step`, `null` when none) as a line field; the `merge-park` line carries `parked` (`true` when `bot:parked` read back, else `false`); `stationEventsFor` maps both. Neither field is parsed out of `detail`.

- [ ] **Step 1: Write failing tests**
  - driver-mirror: `a settle-label ok line writes held why blocked at the stopped step's station` — `line({ step: 'settle-label', status: 'ok', stopStep: 'test' })` → exactly one event, `kind: 'held'`, `station: 'test'`, `lane: 'driver'`, `payload: { why: 'blocked' }` (no `ref`: a driver stop has no blocking record — Decision 2), `discriminator: 'settle-label@' + TS`, and `buildLine(e)` non-null.
  - driver-mirror: `a settle-label stop at a step with no station is held at build` — `stopStep: 'check'` → `station: 'build'`; `stopStep` absent → `station: 'build'`; payload `{ why: 'blocked' }` in both.
  - driver-mirror: `a settle-label after a claim stop is held at release` — `stopStep: 'claim'` → `station: 'release'`.
  - driver-mirror: both hold lines carry `at` equal to the driver line's `ts`.
  - driver-mirror: `a failed settle-label writes no hold` — `status: 'fail'` → `[]`.
  - driver-mirror: `an applied park writes held why parked at merge beside the returned exit` — `line({ step: 'merge-park', status: 'stop', parked: true, detail: 'ci-red: bot:parked applied to record 7' })` → kinds `[['exited','merge','returned'], ['held','merge',undefined]]`, held payload `{ why: 'parked' }`.
  - driver-mirror: keep the existing `merge-park` test (no `parked` field) passing unchanged — only the exit; add `parked: false` → only the exit.
  - merge.test.js: an existing park test whose label reads back asserts the `merge-park` line has `parked: true`; one whose label never reads back asserts `parked: false`.
  - run.test.js: in `AC8.3: an unclassified stop ...`, assert the `settle-label` line's `stopStep === 'test'`.
- [ ] **Step 2: Run** `node tools/run-tests.js tests/bin-lib/station-events/driver-mirror.test.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/merge.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** — `run.js` `settleStop`: `emit` passes `extra: { stopStep: stopObj.step }` for `settle-label` only (name the step through the existing settle step-name source in `events.js`/settle, not a fresh literal if one is exported). `merge.js` `park`: its final `stop(...)` passes `extra: { parked: applied }` (extend `stop` with an optional `extra` it forwards to `emit`). `driver-mirror.js`: before the `DRIVER_STEP_STATIONS` branch, `settle-label` with `status === 'ok'` → `[holdEvent({ label: LABELS.BOT_BLOCKED, added: true, station: stopStep === 'claim' ? STATION.RELEASE : (DRIVER_STEP_STATIONS[stopStep] || STATION.BUILD), at: ts, ...base fields })]` with no `ref` (the `claim` step name through the existing driver step-name source, not a fresh literal, if one is exported); in the merge sub-step branch, when `step === 'merge-park'` and `event.parked === true`, append `holdEvent({ label: LABELS.BOT_PARKED, added: true, station: STATION.MERGE, at: ts, ... })`. Keep the function pure.
- [ ] **Step 4: Run** the Step 2 command — Expected: PASS.
- [ ] **Step 5: Commit** `feat: mirror driver hold labels as held events — refs #6151`.

### Task 3: Refine hold labels, and the reference doc

**Files:**
- Modify: `plugin/bin/apply-refine-labels.js` (`emitLabelTransitions`), `docs/reference/station-events.md`
- Test: `tests/apply-refine-labels.test.js`

**Interfaces:**
- Consumes: `holdEvent` / `HOLD_LABEL_WHY` (Task 1).

- [ ] **Step 1: Write failing tests**
  - `removing bot:blocked writes released why blocked at authorize` — action `{ issue: 118, addLabels: ['auto:build'], removeLabels: ['bot:blocked'] }` → events include exactly one `released` with `station: 'authorize'`, `payload: { why: 'blocked' }`, `discriminator: 'refine:118:removed:bot:blocked:' + suffix`, buildable; the authorize/decided/entered events are unchanged.
  - `adding bot:parked writes held why parked at authorize` — `{ issue: 118, addLabels: ['bot:parked'] }` → one `held`, payload `{ why: 'parked' }`.
  - `a throwing emitter on a hold event never fails the batch` — exit code 0.
  - Update any existing test that pins the exact event list of an action removing or adding a hold label.
- [ ] **Step 2: Run** `node tools/run-tests.js tests/apply-refine-labels.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** — inside the per-edit loop, after the transitions, one `holdEvent` per hold-label edit with `station: STATION.AUTHORIZE` (refine is the authorization gate where a person lifts or sets the hold), the same `discriminator` shape `refine:{issue}:{direction}:{label}:{suffix}`, each `deps.stationEvent` call in its own try. Update `docs/reference/station-events.md`: the "Holds and plan changes" list, the kinds-with-producers sentence, and the "emit nothing" bullet for `bot:blocked` / `bot:parked` — name the three producers (driver mirror `settle-label`, driver mirror applied `merge-park`, `apply-refine-labels.js`), the station each files under, and that `accept:changes-requested` still has no code path; under Coverage gaps, add: "A hold label edited through refine is filed at `authorize`, even when the record is already at a later station." (Decision 3), and that a `drive.js --no-settle` run leaves the `bot:blocked` add to its caller, so no `held` line is written for it; that a hold label removed outside refine (by hand, as `resume-eligibility.js` tells the user to) writes no `released`, and that re-adding a label already present writes another `held`; that a driver hold after a `claim`-step stop files at `release`, any other driver stop with no step station at `build`; define `ref` exactly as Decision 2 gives it: "`ref`: the blocking record, as `#N` or `owner/repo#N`; absent when the hold has no blocking record."; state that `held` / `released` carry no `actor` (Decision 1); add producer-table rows matching the existing table's columns; add that `resolve-blockers.js` appends a `blockers` line only when it differs from the record's last one ignoring `fetchedAt` (bounded 64 KiB tail read).
- [ ] **Step 4: Run** `node tools/run-tests.js tests/apply-refine-labels.test.js tests/bin-lib/station-events/blockers.test.js tests/bin-lib/station-events/driver-mirror.test.js tests/resolve-blockers-cli.test.js tests/bin-lib/station-events/station-literal-conformance.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: write hold events from refine label edits; document hold producers — refs #6151`.
