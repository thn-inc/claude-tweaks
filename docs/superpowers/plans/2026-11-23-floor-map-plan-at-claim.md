# Floor map, emission 3/8: The plan at the claim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a record is claimed, claude-tweaks writes one `planned` station event per record and run, carrying the ordered station list and a reason code.

**Architecture:** A new pure module `plugin/bin/lib/station-events/plan.js` holds the starting lists (`STARTING_LISTS`), the list selection (`planOf`) and the event builder (`planEvent`). The claim path — `plugin/bin/lib/claim-targets/claim-targets.js`, which already writes `session_bound`, `exited release` and `entered build` for each newly claimed record — calls `planEvent` through its existing optional `deps.stationEvent` seam, once per newly claimed record.

**Tech Stack:** Node.js (CommonJS), `node:test`; test runner `node tools/run-tests.js <file.test.js>...`.

**Spec:** `.claude-tweaks/pipelines/2026-11-23T194845-record-6147/work/6147-spec.md` (record #6147, re-materialized with the plan-review decisions).

## Premise reversal (logged in decisions.md, Spec Step 3)

The spec places the call in `plugin/bin/release-claim.js` ("the `deps.stationEvent({...})` call near line 220") and its two claim tests in `tests/bin-lib/release-claim/cli.test.js`. That file is the claim **release** path: its line-220 call writes `exited build`. The claim path that writes the `entered`/`started`-side events ("beside the existing `entered`/`started` events") is `plugin/bin/lib/claim-targets/claim-targets.js` (`emitStation`, `emitInProgressTransition`; `docs/reference/station-events.md`'s Producers table). This plan wires `planned` there and puts the two claim tests, under the spec's exact names, in `tests/bin-lib/claim-targets/claim-targets.test.js`. `release-claim.js` and its tests are not touched (Task 6 of the same source plan modifies `release-claim.js`).

Waived plugin/bin/release-claim.js: read only to establish the premise reversal above; not modified.
Waived tests/bin-lib/release-claim/cli.test.js: the claim tests it names land in tests/bin-lib/claim-targets/claim-targets.test.js (premise reversal above).
Waived plugin/bin/lib/run-manifest/write.js: read only — Task 2's `readRunManifestPlanInputs` reads the `manifest.json` it writes (`lane`, `ceremonyProfile` fields); the writer is unchanged.

## Global Constraints

- "No prose is asked to log; only code that already makes the transition does." Every new line is written from code that already performs the transition.
- "The plan is written by claude-tweaks code at the claim, from the same ceremony profile and lane that already decide which steps a flow runs, and written as `planned`. The hub never computes a plan."
- "A reason that nothing knows is `unspecified`, counted and shown, never silently dropped, and never blocks the outcome."
- "Every version of a plan is kept with its reason and cause." A plan is never rewritten silently.
- Every station name, kind, outcome and lane literal lives in `plugin/bin/lib/station-events/stations.js`; `tests/bin-lib/station-events/station-literal-conformance.test.js` scans for violations.
- Emission never blocks or fails a transition (`appendStationEvent` already drops a bad line to stderr and returns). Do not add a throw on any emission path.
- The station order is the confirmed one from Task 1 (`docs/reference/station-events.md` `## Station order from real moves`): `intake` → `shape` → `authorize` → `release` → `build` → `test` → `review` → `polish` → `wrap-up` → `merge` → `accept` — identical to `STATIONS` in `stations.js`.
- `planned` payload (contract): `{ process: 'build-a-record', processVersion: 1, list: string, stations: string[], reasonCode: string, reasonText?: string }`; `stations` is the full ordered list, including stations already passed. Filed under station `build` at the claim.
- Starting-list precedence (record's Decisions section, from `## Starting lists`): *A lane of `driver` selects the list `driver`; otherwise a ceremony profile of `fast-lane` selects `fast-lane`; otherwise the list is `standard`. An absent or unknown lane with an absent profile is `standard`, and the `planned` event carries reason `default-list`.* The lane `express` follows the same rule. A null `ceremonyProfile` is treated as absent.
- Plan-review decisions (record body, `## Decisions on the plan review`, all Reading A):
  1. `planned` is written at the claim with what is known then. A `/flow` claim usually knows neither profile nor lane, so its plan is usually `standard` / `default-list`; a later `replanned` (emission 4/8, #6148) corrects it. A claim passed a lane, or whose run manifest already holds a profile, selects the list at once. This rule is written into `docs/reference/station-events.md` beside `## Starting lists` (Task 2).
  2. A selected list carries `reasonCode: 'other'` with `reasonText` `lane driver`, `ceremony profile fast-lane` or `ceremony profile standard`; an explicit `standard` profile counts as selected. Only absent lane + absent profile carries `default-list`. No vocabulary change.
  3. The `planned` line's `lane` field is always the passed `--lane`, like the claim's other events; the manifest's lane only chooses the list. Test: `the planned line and the claim's other events carry the same lane field even when the manifest lane differs`.
  The discriminator stays `planned:{runId}`; an `alreadyOwned` re-claim writes nothing; a changed plan is `replanned`'s job.

Governing project skill `.claude/skills/station-event-producer-addition/SKILL.md` (names `stations.js`, `claim-targets.js`, the Producers table), quoted rules:

> 1. **Name stations through `stations.js`.** Use `STATION.*`, `SESSION_BOUND_STATION`, `BLOCKER_SNAPSHOT_STATION`, `PR_OPENED_TRANSITION`, `releaseTransition(reason)` or `transitionsForLabel(label, direction)`. `tests/bin-lib/station-events/station-literal-conformance.test.js` fails on `station: 'build'` anywhere else under `plugin/bin`. Its header lists what it cannot see (a computed key, a name held in a local constant); those shapes are still wrong, just unpoliced.
> 2. **Optional seam, wrapped call.** An absent `deps.stationEvent` means no emission. Every call sits in its own try/catch, so a throwing emitter never changes stdout, the exit code or the CLI's envelope. `appendStationEvent` itself never throws and reports a drop as one stderr line; the wrap guards a fake or a later emitter.
> 3. **The discriminator is a value the caller already holds.** A claim's `claimedAt`, a run id, a driver line's `step@ts`, a PR number with its outcome. Never `Date.now()`: `eventKey` hashes the discriminator, and consumers dedupe on `eventKey`.
> 4. **Emit only on a transition that landed.** ... `claim-targets.js` emits the `bot:in-progress` transition only after the label add succeeded, and not on a `--resume-pr` re-claim, which never left `build`.
> 5. **The lane is passed, never inferred.** Write `'unknown'` unless the caller knows.
> | `docs/reference/station-events.md` | A Producers row (kind, station, outcome, payload keys, discriminator), and the item removed from Coverage gaps. |
> | `tests/bin-lib/station-events/failure-isolation.test.js` | A case for the new CLI. |

`.claude/skills/bin-source-scan-conformance` and `single-source-constant-guard` do not apply: no new source-scan suite and no new shared constant outside `stations.js`.

## Review Focus

1. A record claimed twice in the same run (a retry) writes one `planned`, not two — covered by Task 2's `claiming the same record again in the same run writes no second planned`.
2. A claim with no ceremony profile or lane (both null / `unknown`) writes `planned` with list `standard` and reason `default-list`, never crashes — Task 1 `null lane and null profile gives list standard with reason default-list`, Task 2 claim test with no `--run`.
3. An unreadable, missing or non-JSON `manifest.json` in the run dir reads as both-absent (list `standard`, reason `default-list`) and never changes the claim's exit code or stdout — Task 2 `a corrupt run manifest plans the default list and leaves the claim unchanged`.
4. An unrecognised ceremony profile string (e.g. `'bogus'`) is treated as absent, never selects a list — Task 1 `an unknown ceremony profile is treated as absent`.
5. A `--resume-pr` re-claim writes no `planned` (the record never left `build`; the original claim's plan stands) — Task 2 extends the existing `--resume-pr` station test.

---

### Task 1: `plan.js` — starting lists, `planOf`, `planEvent`

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/station-events/plan.js`
- Test: `tests/bin-lib/station-events/plan.test.js`

**Interfaces:**
- Consumes: from `plugin/bin/lib/station-events/stations.js`: `STATION`, `STATIONS`, `KIND`, `REASON`, `REASON_CODES`, `PROCESS`.
- Produces:
  - `STARTING_LISTS` — frozen object, keys `standard`, `fast-lane`, `driver`, each a frozen array of station ids. `standard` = every station in `STATIONS` order; `fast-lane` and `driver` = `STATIONS` without `STATION.POLISH`. Built from `STATIONS`/`STATION.*`, never station string literals.
  - `planOf({ lane, ceremonyProfile }) -> { list: string, stations: string[], reasonCode: string, reasonText?: string }`. Rules, first match wins: lane `driver` → list `driver`, `reasonCode: REASON.OTHER`, `reasonText: 'lane driver'`; profile `fast-lane` → `fast-lane`, `REASON.OTHER`, `'ceremony profile fast-lane'`; profile `standard` → `standard`, `REASON.OTHER`, `'ceremony profile standard'`; otherwise → `standard`, `REASON.DEFAULT_LIST`, no `reasonText`. Any profile value other than `standard`/`fast-lane` (null, undefined, `'bogus'`) is absent; any lane other than `driver` selects nothing. `stations` is a fresh array copy (caller mutation never reaches `STARTING_LISTS`). Never throws on any input, including a non-object argument (treated as both absent).
  - `planEvent({ repoName, recordNumber, lane, ceremonyProfile, sessionId, runId, listLane }) -> object` — `{ repoName, recordNumber, kind: KIND.PLANNED, station: STATION.BUILD, outcome: null, lane, sessionId, runId, discriminator: \`planned:${runId ?? ''}\`, payload: { process: PROCESS.id, processVersion: PROCESS.version, list, stations, reasonCode, [reasonText] } }` where `list`/`stations`/`reasonCode`/`reasonText` come from `planOf({ lane: listLane ?? lane, ceremonyProfile })`. `listLane` is optional: the lane that chooses the list when it differs from the line's `lane` (decision 3 — the claim passes the manifest's lane there while the line keeps `--lane`). `lane` is passed through to the line as given (the emitter maps null to `unknown`). Pure: no I/O.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/station-events/plan.test.js` (`'use strict'`, `node:test`, `node:assert/strict`; import `plan.js`, `stations.js`, and `buildLine`/`eventKey` from `emit.js`):

```js
test('AC1.1: standard profile gives every station', () => {
  const p = planOf({ lane: 'unknown', ceremonyProfile: 'standard' });
  assert.equal(p.list, 'standard');
  assert.deepEqual(p.stations, [...STATIONS]);
  assert.deepEqual(STARTING_LISTS.standard, [...STATIONS]);
});
test('AC1.2, AC3.1: null lane and null profile gives list standard with reason default-list', () => {
  assert.deepEqual(planOf({ lane: null, ceremonyProfile: null }), { list: 'standard', stations: [...STATIONS], reasonCode: REASON.DEFAULT_LIST });
});
test("AC1.3: each profile in Task 1's table gives its listed stations", () => {
  // table-driven from STARTING_LISTS: one selecting input per list id
  const selectors = { standard: { lane: null, ceremonyProfile: 'standard' }, 'fast-lane': { lane: null, ceremonyProfile: 'fast-lane' }, driver: { lane: 'driver', ceremonyProfile: null } };
  assert.deepEqual(Object.keys(STARTING_LISTS).sort(), Object.keys(selectors).sort());
  for (const [id, input] of Object.entries(selectors)) {
    const p = planOf(input);
    assert.equal(p.list, id);
    assert.deepEqual(p.stations, [...STARTING_LISTS[id]]);
  }
  assert.deepEqual(STARTING_LISTS['fast-lane'], STATIONS.filter((s) => s !== STATION.POLISH));
  assert.deepEqual(STARTING_LISTS.driver, STATIONS.filter((s) => s !== STATION.POLISH));
});
test('AC1.4: planEvent is idempotent for the same record and run', () => {
  const args = { repoName: 'acme/w', recordNumber: 6147, lane: 'unknown', ceremonyProfile: null, sessionId: 's1', runId: 'r1' };
  const a = buildLine(planEvent(args)); const b = buildLine(planEvent({ ...args, sessionId: 's2' }));
  assert.ok(a && b);
  assert.equal(a.eventKey, b.eventKey);
  assert.notEqual(buildLine(planEvent({ ...args, runId: 'r2' })).eventKey, a.eventKey);
  assert.notEqual(buildLine(planEvent({ ...args, recordNumber: 6148 })).eventKey, a.eventKey);
});
```

Plus the record's Decisions tests, each asserting `list` (and `reasonCode` where named):
`lane driver with profile fast-lane gives list driver`; `lane driver with a null profile gives driver`; `lane standard with profile fast-lane gives fast-lane`; `lane express with profile fast-lane gives fast-lane`; `lane unknown with a null profile gives standard with reasonCode default-list`.
And: `an unknown ceremony profile is treated as absent` (`planOf({ lane: 'unknown', ceremonyProfile: 'bogus' })` deep-equals the null/null result); `planOf never throws on a non-object argument` (`planOf(undefined)`, `planOf(null)` both give list `standard`, reason `default-list`); `planEvent builds a line appendStationEvent accepts` (`buildLine(planEvent(args))` is non-null; `kind === 'planned'`, `station === STATION.BUILD`, `outcome === null`, `payload` deep-equals `{ process: 'build-a-record', processVersion: 1, list: 'standard', stations: [...STATIONS], reasonCode: 'default-list' }`); `a known selector carries reason other with its reasonText` (`planOf({ lane: 'driver', ceremonyProfile: null })` has `reasonCode: REASON.OTHER`, `reasonText: 'lane driver'`; `fast-lane` profile gives `'ceremony profile fast-lane'`; explicit `standard` profile gives `REASON.OTHER` with `'ceremony profile standard'`); `planEvent chooses the list by listLane and keeps lane on the line` (`planEvent({ ...args, lane: 'unknown', listLane: 'driver' })` has `lane === 'unknown'` and `payload.list === 'driver'`); `mutating a returned stations array leaves STARTING_LISTS unchanged`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/station-events/plan.test.js`
Expected: FAIL (`Cannot find module '../../../plugin/bin/lib/station-events/plan'`)

- [ ] **Step 3: Implement `plan.js`** with the three exports above. Header comment in the style of `stations.js` naming record #6147 and `docs/reference/station-events.md`'s `## Starting lists`. The list ids and the lane/profile words (`driver`, `fast-lane`, `standard`) are the only string literals; no station literal.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tools/run-tests.js tests/bin-lib/station-events/plan.test.js tests/bin-lib/station-events/station-literal-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/station-events/plan.js tests/bin-lib/station-events/plan.test.js
git commit -m "Add plan.js — starting lists, planOf and planEvent for the planned station event (refs #6147)"
```

### Task 2: Write `planned` at the claim

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (the `#5902` station-event block near lines 560-590, and the per-issue claim loop near lines 792-806)
- Modify: `tests/bin-lib/claim-targets/claim-targets.test.js` (the `#5902: station events` section, lines ~3177-3492)
- Modify: `tests/bin-lib/station-events/failure-isolation.test.js` (`claim-targets` expected event counts, lines ~166 and ~185)
- Modify: `docs/reference/station-events.md` (Transition table `build` row, `### Kinds`, Producers table)

**Interfaces:**
- Consumes: `planEvent` from Task 1.
- Produces: `readRunManifestPlanInputs(runDir: string) -> { lane: string|null, ceremonyProfile: string|null }`, exported from `claim-targets.js` (lib) — reads `{runDir}/manifest.json`, returns its `lane` and `ceremonyProfile` when they are strings, else null for each; any read or parse failure returns `{ lane: null, ceremonyProfile: null }`; never throws.

Behavior: for each **newly claimed** record that has a `claimedAt` (the same gate as `emitSessionBound`), and only when `resumeLink === null` (no `--resume-pr` re-claim), emit one `planEvent({ repoName: stationRepoName, recordNumber: issue, lane: opts.lane, listLane, ceremonyProfile, sessionId: deps.sessionId, runId: opts.runId })` through `deps.stationEvent`, inside its own try/catch (reuse `emitStation`'s guard shape). The line's `lane` is always the passed `opts.lane` — the same lane field as the claim's other events (decision 3, "the lane is passed, never inferred" holds for the line). Emit it **after** the label try/catch block, so a failed label add still writes `planned` (the claim landed) — the event order for a successful claim becomes `session_bound:build`, `exited:release:passed`, `entered:build`, `planned:build`. List-choosing lane (`listLane`, never written to the line): `opts.lane` when it is not `'unknown'`, else the manifest's `lane` (when `--run` given), else `opts.lane`. Ceremony profile: the manifest's `ceremonyProfile` when `--run` is given, else null. Read the manifest once per `run()` call, lazily, only when the first `planned` is about to be emitted. `alreadyOwned`, contested, transient and unverified targets emit nothing (unchanged).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/claim-targets/claim-targets.test.js`'s `#5902` section (use `claimFixture`, `makeGh`, `baseDeps`, `withRecorder`, `kindStation`):

```js
test('AC1.5: a claim writes one planned line carrying the stations and reason', () => {
  const { ghApi } = claimFixture([720]);
  const { deps } = baseDeps({ ghApi, gh: makeGh({}).gh });
  const events = withRecorder(deps);
  assert.equal(run(['--run-id', 'r1', '--targets', '720'], deps), 0);
  const planned = events.filter((e) => e.kind === 'planned');
  assert.equal(planned.length, 1);
  assert.equal(planned[0].station, 'build');
  assert.equal(planned[0].recordNumber, 720);
  assert.equal(planned[0].runId, 'r1');
  assert.deepEqual(planned[0].payload, { process: 'build-a-record', processVersion: 1, list: 'standard', stations: [...STATIONS], reasonCode: 'default-list' });
  assert.ok(buildLine(planned[0]), 'appendStationEvent accepts it');
});
test('AC1.6, AC2.1, AC2.2: claiming the same record again in the same run writes no second planned', () => {
  // first run: claimFixture([720]) -> claimed, events `first`.
  // second run, same --run-id 'r1': makeGhApi({ reads: { 720: [readOk(liveMarker('r1'), 'sha720')] }, writes: {} })
  //   -> alreadyOwned [720], events `second`.
  assert.equal(first.filter((e) => e.kind === 'planned').length, 1);
  assert.equal(second.filter((e) => e.kind === 'planned').length, 0);
});
```

Also add:
- `a claim with --run reads lane and ceremony profile from the run manifest` — temp run dir whose basename equals `--run-id`, `manifest.json` `{ "lane": "driver", "ceremonyProfile": "fast-lane" }`, `deps.appendClaimLog` stubbed; `planned.payload.list === 'driver'` and `planned.payload.reasonText === 'lane driver'`. A second case with `--lane standard` and manifest `{ "lane": "driver", "ceremonyProfile": "fast-lane" }` gives list `fast-lane` (the passed lane wins over the manifest lane).
- `the planned line and the claim's other events carry the same lane field even when the manifest lane differs` — no `--lane` (so `'unknown'`), manifest `{ "lane": "driver", "ceremonyProfile": "standard" }`; `planned.payload.list === 'driver'`, and every event of the claim (`session_bound`, `exited`, `entered`, `planned`) has the same `lane` value (`'unknown'`).
- `a corrupt run manifest plans the default list and leaves the claim unchanged` — `manifest.json` holds `not json{`; list `standard`, reason `default-list`; exit code and stdout equal the same run with no `stationEvent`.
- `readRunManifestPlanInputs returns nulls for a missing dir, a missing file and a non-object JSON` (unit, three cases).

Update the existing tests that pin the full event sequence or count (each currently fails once `planned` is added — that is the expected red for them only after Step 3; change them now so they pin the new sequence):
- `a claim whose label add succeeded records exited release passed and entered build`: sequence `['session_bound:build', 'exited:release:passed', 'entered:build', 'planned:build']`.
- `a failed label add records session_bound only, never the transition`: rename to `a failed label add records session_bound and planned, never the transition`; sequence `['session_bound:build', 'planned:build']`.
- `--lane driver stamps lane driver on every event`: `events.length` 6 → 8.
- `an empty or absent sessionId records the two transition events and no session_bound`: sequence `['exited:release:passed', 'entered:build', 'planned:build']`; rename `...records the transition events and planned, and no session_bound`.
- `a recording stationEvent leaves exit code and stdout identical...`: count 6 → 8.
- `a rolled-back partial claim ...`: `for720` sequence `['session_bound:build', 'exited:release:passed', 'entered:build', 'planned:build', 'exited:build:abandoned']`, and the exit is `for720[4]`.
- `a --resume-pr re-claim records session_bound but no bot:in-progress transition`: unchanged sequence `['session_bound:build']` (this now also pins "no planned on a resume"); rename `...but no bot:in-progress transition and no planned`.
- `tests/bin-lib/station-events/failure-isolation.test.js`: both `['claim-targets', claimOnce, 6]` → `8`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/claim-targets/claim-targets.test.js tests/bin-lib/station-events/failure-isolation.test.js`
Expected: FAIL (no `planned` event is emitted; `readRunManifestPlanInputs` is not exported)

- [ ] **Step 3: Implement** in `plugin/bin/lib/claim-targets/claim-targets.js`: require `planEvent` from `../station-events/plan`; add and export `readRunManifestPlanInputs`; add `emitPlanned(issue, claimedAt)` beside `emitSessionBound` (same `typeof deps.stationEvent` / `claimedAt` guard and try/catch); call it after the label try/catch with `if (resumeLink === null) emitPlanned(issue, claimedAt);`. Then update `docs/reference/station-events.md`: the Transition table's `build` row "kinds emitted today" gains `planned` (the claim, `claim-targets.js:emitPlanned` added to its code cell); `### Kinds` lists `planned`, `replanned`, `held`, `released`, `decided` (the vocabulary already in `stations.js`) and says only `planned` has a producer today; a Producers row: `claim-targets.js`, per newly claimed record (not on a `--resume-pr` re-claim, written even when the label add fails) | `planned` | `build` | none | `process`, `processVersion`, `list`, `stations`, `reasonCode`, `reasonText` (only for a list a lane or profile selected); the line's lane is always `--lane`; the list is chosen by `--lane`, else the run manifest's `lane`, with `ceremonyProfile` from the run manifest | `planned:{runId}` (so a re-emit for the same record and run keys identically). Also add, directly after `## Starting lists`'s precedence paragraph, a paragraph stating decision 1: `planned` is written at the claim with what is known then; a `/flow` claim usually precedes the Config Manifesto, so it usually knows neither profile nor lane and plans `standard` with reason `default-list`, which is a true statement of what was known; a `replanned` event (emission 4/8) corrects it when the Manifesto or ceremony verdict fixes the profile or lane; a claim passed a lane (the driver's claims) or whose run manifest already holds a profile selects the list at once; a selected list carries reason `other` with a `reasonText` (`lane driver`, `ceremony profile fast-lane`, `ceremony profile standard`); the line's `lane` field stays the passed lane.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tools/run-tests.js tests/bin-lib/claim-targets/claim-targets.test.js tests/bin-lib/claim-targets/cli.test.js tests/bin-lib/station-events/failure-isolation.test.js tests/bin-lib/station-events/plan.test.js tests/bin-lib/station-events/transition-table.test.js tests/bin-lib/station-events/station-literal-conformance.test.js tests/bin-lib/station-events/emit.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/claim-targets/claim-targets.js tests/bin-lib/claim-targets/claim-targets.test.js tests/bin-lib/station-events/failure-isolation.test.js docs/reference/station-events.md
git commit -m "Write the plan when a record is claimed — one planned station event per record and run (refs #6147)"
```
