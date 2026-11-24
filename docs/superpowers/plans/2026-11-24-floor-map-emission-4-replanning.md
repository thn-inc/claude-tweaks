# Floor map, emission 4/8: Replanning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write one `replanned` station event whenever the lane or ceremony profile written to a claimed record's run manifest changes that record's stations, with `before` taken from the claim's own latest plan line.

**Architecture:** `replanEvent` (pure, already in `plan.js`, commit 61bc665734) builds the line. A new I/O module `station-events/replan.js` reads the latest `planned`/`replanned` line per record for a run id from the station-events log and emits a `replanned` for each record whose stations differ under the manifest's new lane/profile. `fillRunManifest` — the one writer every lane and profile change already goes through — calls it when its `changed` list holds `lane` or `ceremonyProfile` and its caller passed `deps.stationEvent`. The CLIs (`set-config.js`, `manifesto-write.js`) pass the real sink; libraries only thread it. This replaces the express lane's `replan` option and pre-write-manifest `before` in `set-config/write.js`.

**Tech Stack:** Node.js (CommonJS), `node:test`; run tests with `node tools/run-tests.js <file>`.

**Spec:** `.claude-tweaks/pipelines/2026-11-24T085715-record-6148/work/6148-spec.md`

Scope keywords: replanEvent, replanned, fillRunManifest, setConfigLever

## Global Constraints

- No prose is asked to log; only code that already makes the transition does.
- Every version of a plan is kept with its reason and cause; a plan is never rewritten silently.
- Every station name, kind, outcome and lane literal lives in `plugin/bin/lib/station-events/stations.js`; `tests/bin-lib/station-events/station-literal-conformance.test.js` scans for violations (name codes via `REASON.*`, `KIND.*`, `STATION.*`).
- Emission never blocks or fails a transition: every emit path is wrapped, never throws, and never changes the caller's return value or exit code.
- `replanned` payload: `{ stations: string[], reasonCode: string, reasonText?: string, cause: { kind: 'outcome' | 'decision' | 'config', ref?: string } }`, filed under the station the item is at (`build` for a claimed record before its build exits).
- Reason `ceremony-downgrade` when a station is removed; cause `{ kind: 'config' }`; nothing when the lists are equal.
- The `before` plan is the claim's `planned` event's stations (the latest `planned`/`replanned` for that record and run).

## Review Focus

- No `planned` line for the run (an unclaimed run, a run dir with no log, an unreadable log): writes nothing and never throws — pinned in Task 1.
- A malformed or foreign line in the log (bad JSON, another run id, another record): skipped, never fatal — pinned in Task 1.
- A second change after a replan: `before` is the replanned list, not the original claim's — pinned in Task 1.
- A claim line whose own `lane` is `driver` keeps the driver list whatever the profile becomes (the claim's lane wins over the manifest's, as at the claim) — pinned in Task 1.
- A caller that passes no `stationEvent` (every existing test, every library caller) reads no log and writes nothing — pinned in Task 2.

---

### Already landed (commit 61bc665734, express lane)

**Files:**
- Modify: `plugin/bin/lib/station-events/plan.js` — `replanEvent` (the spec's Deliverables interface), unchanged by this plan
- Test: `tests/bin-lib/station-events/plan.test.js` — `replanEvent returns null when the stations are unchanged` and `replanEvent for Test and Polish removed carries the after list and reason documents-only` (spec AC 1, first two names) already exist and pass; keep them

Every task below re-runs `node tools/run-tests.js tests/bin-lib/station-events/plan.test.js` in its Step 4 so these stay green.

### Task 1: The replan reader and emitter

**Files:**
- Create: `plugin/bin/lib/station-events/replan.js`
- Test: `tests/bin-lib/station-events/replan.test.js`

**Interfaces:**
- Consumes: `planOf`, `replanEvent` from `plugin/bin/lib/station-events/plan.js`; `stationEventPath` from `emit.js`; `KIND`, `REASON` from `stations.js`; `mainCheckoutRoot` from `../hooks/worktree-detect`.
- Produces:
  - `latestPlans({ mainRoot, runId, fs? }): Map<number, { repoName: string, lane: string|null, stations: string[] }>` — the last `planned` or `replanned` line (file order) per `recordNumber` whose `runId` equals `runId`; `stations` from `payload.stations`. Empty map on a missing/unreadable file or empty `runId`; unparseable lines skipped.
  - `replanFromManifest({ runDir, manifest: { lane, ceremonyProfile }, ref: string, deps: { stationEvent, mainRoot?, sessionId?, now?, fs? } }): number` — the count of events emitted. `runId` is `path.basename(runDir)`; `mainRoot` defaults to `mainCheckoutRoot(runDir)`. For each record in `latestPlans`: list lane = the plan line's `lane` when it is a string other than `unknown`, else `manifest.lane`; `after = planOf({ lane: listLane, ceremonyProfile: manifest.ceremonyProfile })`; `reasonCode = REASON.CEREMONY_DOWNGRADE` when any `before` station is missing from `after`, else `REASON.OTHER` with `after.reasonText` as `reasonText`; `cause = { kind: 'config', ref }`; `lane` on the line = the plan line's lane; `at = (deps.now ?? (() => new Date()))().toISOString()`. Calls `deps.stationEvent(event)` when `replanEvent` returns non-null. Returns 0 without reading anything when `deps.stationEvent` is not a function. Never throws (whole body wrapped; each emit wrapped).

- [ ] **Step 1: Write the failing tests** (temp `mainRoot` via `scratchDir` from `tests/helpers/tmp-dir`; write `.claude-tweaks/station-events.jsonl` lines by hand; `runDir = path.join(mainRoot, '.claude-tweaks', 'pipelines', 'r1')`; pass `mainRoot` in deps)
  - `latestPlans returns the last planned or replanned stations per record for the run` — lines: `planned` r1 #7 standard, `planned` r2 #7 (other run), `replanned` r1 #7 without polish, a line `not json` → map has one entry, #7, stations without `polish`.
  - `replanFromManifest writes nothing when the run has no planned line` → returns 0, sink not called; also with no log file at all.
  - `replanFromManifest after a standard claim and a fast-lane profile writes one replanned without polish, reason ceremony-downgrade, cause config` — assert `kind === KIND.REPLANNED`, `station === STATION.BUILD`, `payload.stations` equals `STARTING_LISTS['fast-lane']`, `payload.cause` deep-equals `{ kind: 'config', ref: 'ceremony-profile' }`, `recordNumber === 7`, `runId === 'r1'`.
  - `replanFromManifest uses the replanned list as before` — log: `planned` standard then `replanned` fast-lane; manifest profile fast-lane → returns 0.
  - `a claim line with lane driver keeps the driver list` — `planned` line `lane: 'driver'` with driver stations; manifest `{ lane: 'standard', ceremonyProfile: 'standard' }` → returns 0.
  - `replanFromManifest without a stationEvent function reads nothing and returns 0` — pass `fs` whose `readFileSync` throws; assert returns 0 and the throwing fs was never called.
  - `a throwing sink never throws out of replanFromManifest`.

- [ ] **Step 2: Run** `node tools/run-tests.js tests/bin-lib/station-events/replan.test.js`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `plugin/bin/lib/station-events/replan.js` per the Interfaces block. Header comment names #6148 and `docs/reference/station-events.md`.

- [ ] **Step 4: Run** the replan tests plus `node tools/run-tests.js tests/bin-lib/station-events/station-literal-conformance.test.js`. Expected: PASS.

- [ ] **Step 5: Commit** `git add` both files by path; message `Add the station-event replan reader — refs #6148`.

### Task 2: `fillRunManifest` emits the replan

**Files:**
- Modify: `plugin/bin/lib/run-manifest/write.js` (`fillRunManifest`)
- Test: `tests/bin-lib/run-manifest/write.test.js`

**Interfaces:**
- Consumes: `replanFromManifest` (Task 1).
- Produces: `fillRunManifest(runDir, fields, deps)` additionally honours `deps.stationEvent`, `deps.mainRoot`, `deps.sessionId`, `deps.now`: after a successful write whose `changed` includes `lane` or `ceremonyProfile`, it calls `replanFromManifest({ runDir, manifest: { lane: manifest.lane, ceremonyProfile: manifest.ceremonyProfile }, ref, deps })` with `ref = 'ceremony-profile'` when `ceremonyProfile` changed, else `'lane'`. Return value unchanged (`{ changed }`). Required lazily, inside its own try/catch. Existing `deps.now` usage in `defaults(deps)` (if any) must keep its type — check before reusing the name; if `now` already means something else there, pass the replan clock as `deps.replanNow`.

- [ ] **Step 1: Write the failing tests** (seed manifest with `initRunManifest`, as the file's existing tests do; temp `mainRoot` with a `planned` line for `runId = basename(runDir)`, #7, standard list, `lane: 'unknown'`)
  - `fixing the profile to fast-lane after a standard claim writes one replanned without polish`
  - `fixing the profile to standard after a standard claim writes nothing`
  - `setting the lane to driver after a standard claim writes one replanned` — `fillRunManifest(runDir, { lane: 'driver' }, deps)` on a manifest with lane `unknown`; assert one event, `payload.stations` equals `STARTING_LISTS.driver`, `payload.cause.ref === 'lane'`.
  - `fillRunManifest without stationEvent writes no event and returns the same changed list`.

- [ ] **Step 2: Run** `node tools/run-tests.js tests/bin-lib/run-manifest/write.test.js`. Expected: FAIL on the three emitting tests.

- [ ] **Step 3: Implement** the hook in `fillRunManifest`.

- [ ] **Step 4: Run** the run-manifest and replan tests. Expected: PASS.

- [ ] **Step 5: Commit** by path; message `Replan from the run-manifest fill when lane or profile changes — refs #6148`.

### Task 3: Thread the real sink from the writers and CLIs; retire the express hook

**Files:**
- Modify: `plugin/bin/lib/set-config/write.js` (remove `replan`, `manifestBefore`, `emitReplan`; `setConfigLever({ runDir, key, value, stationDeps })` passes `stationDeps` (`{ stationEvent, sessionId?, mainRoot? }`, or `{}` when absent) as its `fillRunManifest` deps)
- Modify: `plugin/bin/lib/flow/manifesto-write.js` (`writeManifesto`: build `stationDeps = { stationEvent: deps.stationEvent, sessionId: deps.sessionId, mainRoot: deps.stationMainRoot }` and pass it to each `set({ runDir, key, value, stationDeps })` and as its `fillRunManifest(runDir, { lane: 'standard' }, stationDeps)` deps)
- Modify: `plugin/bin/set-config.js` (`realDeps.stationEvent = (e) => appendStationEvent(e)`; pass `{ stationEvent, sessionId, mainRoot: deps.stationMainRoot }` as `stationDeps` to `setConfigLever` and merged into its own `fillRunManifest(..., { stderr, ...stationDeps })`)
- Modify: `plugin/bin/manifesto-write.js` (`realDeps.stationEvent`, passed in `writeManifesto`'s deps)
- Modify: `docs/reference/station-events.md` (Producers table: a `replanned` row — producer `run-manifest/write.js` `fillRunManifest` via `set-config.js` / `manifesto-write.js`, station `build`, payload keys, discriminator `replanned:{after joined}:{at}`; `### Kinds` sentence "only `planned` has a producer today" → `planned` and `replanned`; Starting lists paragraph's "(emission 4/8)" sentence names the producer)
- Modify: `docs/reference/run-manifest.md` (the "Later, by a fill" bullet: a fill that changes `lane` or `ceremonyProfile` writes a `replanned` station event when its caller passes a sink)
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/run-manifest/` line: same clause, and `station-events/replan.js` named on the station-events line if one exists)
- Test: `tests/bin-lib/set-config/write.test.js`
- Test: `tests/bin-lib/set-config/cli.test.js`
- Test: `tests/bin-lib/flow/manifesto-write.test.js`

**Interfaces:**
- Consumes: Task 2's `fillRunManifest` deps.
- Produces: `setConfigLever({ runDir, key, value, stationDeps? })`; the express `replan` option is removed (no caller passed it). `stationMainRoot` is a test-only CLI/deps override for the log's root (the CLIs' existing `mainRoot` dep anchors run-dir resolution and must not be repurposed); unset means `replanFromManifest`'s default.

`sessionId` for the CLIs: `process.env.CLAUDE_CODE_SESSION_ID || null`, passed alongside `stationEvent` (as `claim-targets.js` does). The station `mainRoot` for the reader is left to `replanFromManifest`'s default (`mainCheckoutRoot(runDir)`), except where a test injects it.

- [ ] **Step 1: Rewrite the two express-added tests in `tests/bin-lib/set-config/write.test.js`** to seed a temp `mainRoot` log with a standard `planned` line for the run and pass `stationDeps: { stationEvent, mainRoot }` to `setConfigLever`: `downgrading the ceremony profile on a claimed record writes one replanned with reason ceremony-downgrade` (keep its assertions) and `fixing the profile to standard after a standard claim writes nothing`. Add to `cli.test.js`: `set-config.js --set ceremony-profile=fast-lane passes its stationEvent sink through` (override `stationEvent` and `stationMainRoot` in `run(argv, overrides)`, assert one `replanned`). Add to `manifesto-write.test.js`: `writeManifesto with a fast-lane ceremony after a standard claim writes one replanned` (`deps.stationEvent` + `deps.stationMainRoot`).

- [ ] **Step 2: Run** `node tools/run-tests.js tests/bin-lib/set-config/write.test.js tests/bin-lib/set-config/cli.test.js tests/bin-lib/flow/manifesto-write.test.js`. Expected: FAIL on the new/rewritten tests.

- [ ] **Step 3: Implement** the threading and the removals listed under Files; update the doc.

- [ ] **Step 4: Run** the three suites above plus `tests/bin-lib/station-events/` and `tests/bin-lib/run-manifest/write.test.js`. Expected: PASS.

- [ ] **Step 5: Commit** by path; message `feat: write replanned when a claimed record's stations change — refs #6148`.

Not in scope (Check B matches, ruled out): `lib/express/cli.js` (its `lane: 'express'` fill selects the same standard list, so it changes no stations; its `ceremony-profile=fast-lane` reaches the manifest through `set-config.js`, covered above) and `lib/driver/adopt.js` (a driver run is claimed with `--lane driver`, so its plan is already the driver list). `emit.js`, `stations.js`, `wrap-up/pack.js`, `docs/hooks.md`, `docs/journeys/…5902.md`, `plugin/skills/reflect/full-mode.md`, the 2026-11-23 plan, `emit.test.js`, `pipeline-cost-report/funnel.test.js` match a scope keyword but need no change: the vocabulary (`KIND.REPLANNED`, `REASON.CEREMONY_DOWNGRADE`) and emitter already exist.
