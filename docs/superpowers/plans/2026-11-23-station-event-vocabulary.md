# Station-Event Vocabulary and Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the plan/reason/actor/hold vocabulary to `plugin/bin/lib/station-events/stations.js` and the matching validation to `emit.js`'s `invalidReason`, keeping the line format at version 1 and every event today's callers write still accepted.

**Architecture:** `stations.js` stays the one home of every literal; `emit.js` gains two helpers: `invalidContract(event)`, called from `invalidReason` after the closed-set checks, so a malformed new-contract line is dropped through the existing `drop()` path (one stderr line, never a throw); and `contractPayload(event)`, called from `buildLine`, which normalizes a missing or unknown `reasonCode` to `unspecified` instead of dropping the line. The literal-conformance suite gains a second scan, for reason-code and actor literals.

**Tech Stack:** Node.js (CommonJS), `node:test`, runner `node tools/run-tests.js <file>`.

**Spec:** `.claude-tweaks/pipelines/2026-11-23T161050-record-6146/work/6146-spec.md` (record #6146, task 2 of 8 of the Factory Floor Map emission plan). Its `## Decisions` section (orchestrator, 2026-11-23) answers the earlier plan review's three questions and overrides the Interfaces line where they differ.

Scope keywords: invalidReason, RETIRED_OUTCOMES, REASON_CODES, HOLD_WHYS

Waived docs/reference/station-events.md: read only (Gotchas points at record 1/8's sections, not yet merged); its contract text is record 8/8's (#6152) to change.

## Global Constraints

- "A reason that nothing knows is `unspecified`, counted and shown, never silently dropped, and never blocks the outcome."
- "Four outcomes: `passed`, `sent-back`, `failed`, `stopped`. Held is a state, not an outcome. A skip is a `replanned` event."
- "`skipped` and `abandoned` are retired from the vocabulary; `abandoned` maps to `stopped`; `returned` becomes `sent-back`."
- Every station name, kind, outcome and lane literal lives in `plugin/bin/lib/station-events/stations.js`; `tests/bin-lib/station-events/station-literal-conformance.test.js` scans for violations.
- Emission never blocks or fails a transition (`appendStationEvent` already drops a bad line to stderr and returns). Do not add a throw on any emission path.
- The file stays version 1 (`LINE_VERSION = 1`); no existing line field changes.
- Each of the eight records owns exactly its own Files: no caller of `appendStationEvent` and no doc is edited here (`docs/reference/station-events.md`'s closed-set wording is record 8/8's, #6152).
- **Pre-contract lines (spec Decision 1):** `passed` and `failed` belong to both vocabularies, and today's callers (`release-claim.js`, `driver-mirror.js`, `apply-refine-labels.js`, `accept-park.js`) write them with no `payload.actor` until records 5/8 and 6/8 land. An `exited` line is **new-contract** when its outcome is `sent-back` or `stopped`, or its `payload` has an own `actor` key; only a new-contract line gets the actor/reason/next checks. An actor-less `passed`/`failed` line, and every retired outcome, is accepted unchanged until 8/8.
- **Reason codes (spec Decision 2):** ship the 13 listed codes now; record 1/8 adds no code.
- **Unknown reason (spec Decision 3):** a new-contract non-`passed` `exited` line whose `payload.reasonCode` is missing or not in `REASON_CODES` is **written** with `reasonCode: 'unspecified'`; an unknown original value (non-empty, not a code) is kept in `reasonText`. A `sent-back` whose `next` is missing or not a station is still dropped.
- Governing skill `station-event-producer-addition`, quoted: "| `plugin/bin/lib/station-events/stations.js` | Any new station, kind, lane or outcome, a `LABEL_TRANSITIONS` row, a `DRIVER_STEP_STATIONS` entry, a release-reason pattern. It is the only file under `plugin/bin` that spells a station name. |" Its Producers-row and failure-isolation rows do not apply: this record adds no producer.
- Governing skill `bin-source-scan-conformance`, quoted: "A scan reports `misparsed` and `unparseable` as an offender, with `STRIPPER_VERDICT_MESSAGES[verdict]` as the text." and "Pin the planted mis-parse through each scan that calls the verdict, not only through the helper's own tests." The new scan lives in a suite that already imports the stripper and reads through `readText`, so the callers-twin lists need no change.

## Review Focus

- Two concurrent appends (two sessions) never interleave or lose a line; `withLock` covers every new kind (Task 1, `concurrent appends ...`).
- An `exited` `sent-back` with no `next`, or a `next` that is not a station, is dropped with a stderr reason and `appendStationEvent` returns normally (Task 1).
- A pre-contract `passed`/`failed` line with no actor, exactly as `release-claim.js` writes it today, is still written with its payload unchanged (Task 1, `a failed line with no actor and no reasonCode is written unchanged`).
- An unknown reason never blocks the outcome: it is written as `unspecified`, the caller's payload object is not mutated (Task 1, the two reasonCode tests).
- `payload: null` or a non-object payload on a new-contract kind is dropped with a reason, never a TypeError (Task 1, `a dropped line never throws ...`).
- A `planned` whose `stations` is not an array (a string, absent) is dropped, not iterated character by character (Task 1).

---

### Task 1: Vocabulary in stations.js and validation in emit.js

**Role:** integration
**Review risk:** high (concurrency: the append runs under `withLock`)

**Files:**
- Modify: `plugin/bin/lib/station-events/stations.js` (constants + exports)
- Modify: `plugin/bin/lib/station-events/emit.js` (import, `invalidContract`, call from `invalidReason`)
- Test: `tests/bin-lib/station-events/emit.test.js`
- No-change (classified): `docs/reference/station-events.md` (record 8/8 owns it); `driver-mirror.js` / `release-claim.js` / `apply-refine-labels.js` / `accept-park.js` (readers of `stations.js` exports that are unchanged; their actor-less lines stay accepted); `tests/bin-lib/station-events/stations.test.js` (pins no closed set).

**Interfaces:**
- Produces in `stations.js` (all exported):
  - `KINDS = ['entered','started','exited','session_bound','blockers','planned','replanned','held','released','decided']` (frozen)
  - `OUTCOMES = ['passed','sent-back','failed','stopped']` (frozen); `RETIRED_OUTCOMES = ['returned','skipped','abandoned']` (frozen, still accepted until record 8/8)
  - `REASON_CODES` frozen: `unspecified, default-list, infrastructure, test-failed, spec-wrong, scope-too-big, blocked-by-other, changes-requested, superseded, withdrawn, ceremony-downgrade, documents-only, other` (record 1/8 has not merged; its additions are its own to make)
  - `ACTORS = /^(?:agent|script|person|rule:[^\s:]+)$/` (a matcher; no `g` flag so `.test` is stateless)
  - `HOLD_WHYS = ['blocked','parked','changes-requested','waiting-on-you']` (frozen)
  - `PROCESS = Object.freeze({ id: 'build-a-record', version: 1 })`
- `emit.js`: `invalidReason(event)` accepts an `exited` outcome in `OUTCOMES` or `RETIRED_OUTCOMES`, then returns `invalidContract(event)`'s reason when non-null. `invalidContract` (not exported) returns a string naming the field for: a new-contract `exited` whose `payload.actor` fails `ACTORS`; a `sent-back` whose `payload.next` is not in `STATIONS`; a `held`/`released` whose `payload.why` is not in `HOLD_WHYS`; a `planned`/`replanned` whose `payload.stations` is not an array every element of which is in `STATIONS`. It never rejects on `reasonCode`. A non-object payload reads as `{}`.
- `emit.js`: `contractPayload(event) -> object` (not exported), used by `buildLine` in place of today's `isPlainObject(event.payload) ? event.payload : {}`. For a new-contract `exited` whose outcome is not `passed` and whose `payload.reasonCode` is not in `REASON_CODES`, it returns a shallow copy with `reasonCode: 'unspecified'`; when the original `reasonCode` was present (not `undefined`/`null`/`''`), the copy's `reasonText` is `String(original)` if the payload had no string `reasonText`, else `` `${String(original)}: ${reasonText}` ``. Every other event's payload is returned unchanged (the caller's object is never mutated). `eventKey` does not read the payload, so the key is unaffected.

- [ ] **Step 1: Write the failing tests** in `emit.test.js` (add a `dropped(overrides, fieldRe)` helper asserting `written: false`, `reason` matches `fieldRe`, one stderr line containing `station event dropped`, and no file written):
  - `AC1.1 AC3.1: exited sent-back without next is dropped with a reason` — `{kind:'exited', outcome:'sent-back', payload:{actor:'agent', reasonCode:'test-failed'}}` dropped matching `/next/`; same with `next: 'nowhere'` dropped matching `/next/`; with `next: 'build'` written.
  - `exited failed carrying an actor but no reasonCode is written with reasonCode unspecified` (replaces the spec's original `exited failed without reasonCode is dropped`, per Decision 3) — `{outcome:'failed', payload:{actor:'agent'}}` written, line `payload.reasonCode === 'unspecified'`, no `reasonText` key, one line in the file, zero stderr calls; same for `stopped` with `actor` and no reasonCode; the caller's payload object still has no `reasonCode` key afterwards (not mutated).
  - `an unknown reasonCode is rewritten to unspecified and the original kept in reasonText` — `{outcome:'failed', payload:{actor:'agent', reasonCode:'made-up'}}` written with `reasonCode === 'unspecified'`, `reasonText === 'made-up'`; with `reasonText:'flaky ci'` too, `reasonText === 'made-up: flaky ci'`; a known code `{outcome:'stopped', payload:{actor:'person', reasonCode:'withdrawn'}}` written unchanged.
  - `exited passed with actor script is written` — written, line `payload.actor === 'script'` and no `reasonCode` key added; also `actor:'rule:auto-merge'` written; `actor:'robot'` dropped `/actor/`; `stopped` with no actor dropped `/actor/`.
  - `a passed line with no actor is written unchanged` — `{outcome:'passed', payload:{step:'worker'}}` written; the line's `payload` deep-equals `{step:'worker'}`.
  - `a failed line with no actor and no reasonCode is written unchanged` — `{outcome:'failed', payload:{reason:'failed: test', link:null}}` (release-claim.js's shape) written; the line's `payload` deep-equals the input (no `reasonCode` added).
  - `a sent-back with no actor is dropped` — `{outcome:'sent-back', payload:{reasonCode:'test-failed', next:'build'}}` dropped `/actor/`.
  - `held with an unknown why is dropped` — `{kind:'held', payload:{why:'tired'}}` dropped `/why/`; `{kind:'released', payload:{}}` dropped `/why/`; `{kind:'held', payload:{why:'parked', ref:'#1'}}` written.
  - `planned with an unknown station is dropped` — `stations:['build','nowhere']` dropped `/stations/`; `stations:'build'` dropped `/stations/`; `{kind:'replanned'}` (no payload) dropped `/stations/`; `stations:['build','test']` written.
  - `AC1.6: a legacy returned outcome is still written` — `returned`, `skipped`, `abandoned` each written with an empty payload.
  - `AC3.2: a dropped line never throws and writes a reason to stderr` — `{outcome:'stopped', payload:null}` and `{kind:'held', payload:'x'}`: `assert.doesNotThrow`, `written: false`, exactly one stderr line each.
  - `AC2.1: concurrent appends of a planned and an exited line both land intact` — two `node -e` children (`execFile(process.execPath, [...], { windowsHide: true })`) started together, one appending a valid `planned`, one a valid new-contract `exited passed`, both with `mainRoot` set to one scratch root; await both; the file has exactly two lines, each `JSON.parse`s, kinds sort to `['exited','planned']`, and no `.lock` directory remains.
  - `AC2.2: every new kind appends inside withLock` — with the file's existing `recordingLock` seam, one valid event of each of `planned`, `replanned`, `held`, `released`, `decided` and a new-contract `exited sent-back` each produce one lock call on `${file}.lock` whose callback performed exactly one append.
- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/station-events/emit.test.js`
Expected: FAIL after Step 1 (new kinds/outcomes refused as outside the closed set)
- [ ] **Step 3: Implement** the constants in `stations.js` (with a one-line comment each; the pre-contract rule stated once above `OUTCOMES`) and `invalidContract` + `contractPayload` in `emit.js` (one shared `isNewContract(event)` predicate); update the `invalidReason` outcome check to admit `RETIRED_OUTCOMES`.
- [ ] **Step 4: Run** `node tools/run-tests.js tests/bin-lib/station-events`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: station-event vocabulary for plans, reasons and holds` (body: `refs #6146`).

### Task 2: Reason-code and actor literal conformance scan

**Role:** integration

**Files:**
- Test: `tests/bin-lib/station-events/station-literal-conformance.test.js`

**Interfaces:**
- Consumes: `REASON_CODES` from Task 1 (`require` of `stations.js`); the file's existing `listJs`, `BIN`, `HOME_REL`, `FILE_FLOOR`, `stripComments`, `stripperVerdict`, `STRIPPER_VERDICT_MESSAGES`, `readText`.
- Produces: `vocabSites(raw) -> { sites: [{line, text}], verdict }` and `vocabOffendersIn(files, read)` mirroring `stationSites` / `offendersIn`, with the regex `VOCAB_SITE` matching a `reasonCode` or `actor` key (bare or quoted, `:` or `=` not followed by `=`/`>`) whose value is a quoted literal equal to a `REASON_CODES` entry, `agent`, `script`, `person`, or `rule:<anything>`. Header comment names the recall limits (computed key, value held in a local constant, value assembled from two literals, a comparison read).

- [ ] **Step 1: Write the failing tests:**
  - `vocab scanner flags a reason code or actor literal as a reasonCode/actor value (proves it can go red)` — lines `emit({ reasonCode: 'test-failed' });`, `p.actor = "script";`, `emit({ 'actor': 'rule:auto' });`, `` emit({ reasonCode: `unspecified` }); `` give lines `[1,2,3,4]`.
  - `vocab scanner ignores comments, comparisons, other keys and non-vocabulary values` — `// reasonCode: 'other'`, `if (p.actor === 'agent') {}`, `emit({ reason: 'other' });`, `emit({ actor: ACTOR });`, `emit({ reasonCode: 'failed: test' });` give `[]`.
  - `vocab scanner reports a stripper mis-parse` — the file's existing mis-parse fixture with `emit({ reasonCode: 'other' })` gives verdict `misparsed`.
  - `AC1.9: no call site spells a reason code or actor literal outside stations.js` — walk `listJs(BIN)` (assert `>= FILE_FLOOR` files), `vocabOffendersIn` deep-equals `[]`.
  - `the vocab walk goes red when a call site spells a reason code` — plant `emit({ reasonCode: 'other' });` after the real `release-claim.js`; offenders deep-equal `['release-claim.js:{plantedLine}: emit({ reasonCode: \'other\' });']`, through the same `vocabOffendersIn` the walk test calls.
- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/station-events/station-literal-conformance.test.js`
Expected: FAIL after Step 1 (`vocabSites` is not defined)
- [ ] **Step 3: Implement** `VOCAB_SITE`, `vocabSites`, `vocabOffendersIn` in the test file, built from `REASON_CODES` with regex-escaping as `NAMES` is.
- [ ] **Step 4: Run** `node tools/run-tests.js tests/bin-lib/station-events`. Expected: PASS.
- [ ] **Step 5: Commit** `test: scan for reason code and actor literals outside stations.js` (body: `refs #6146`).

## Spec coverage

| Spec item | Task |
|---|---|
| AC1 (the eight emit tests + the conformance test) | Task 1 Step 1, Task 2 Step 1 |
| AC2.1 concurrent writers, withLock covers new kinds | Task 1 `AC2.1` test |
| AC3.1 sent-back without/with unknown next dropped | Task 1 `AC3.1` test |
| AC3.2 does not stop the transition | Task 1 `AC3.2` test |
| Deliverables: constants | Task 1 Interfaces |
| Decision 1 (actor-less passed/failed accepted) | Task 1 `a passed line with no actor ...`, `a failed line with no actor ...`, `a sent-back with no actor is dropped` |
| Decision 3 (reasonCode normalized, never dropped) | Task 1 the two reasonCode tests |
