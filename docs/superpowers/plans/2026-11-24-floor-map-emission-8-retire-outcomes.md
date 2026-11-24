# Floor map, emission 8/8: Retire the old outcomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `exited` station event carries one of `passed | sent-back | failed | stopped` and a `payload.actor`; `returned`, `skipped` and `abandoned` are refused, every emitter that wrote them is migrated, and `docs/reference/station-events.md` publishes the contract.

**Architecture:** `plugin/bin/lib/station-events/stations.js` stays the single vocabulary home: its transition tables and `releaseTransition` now carry the new-contract payload fields (`actor`, `reasonCode`, `next`) in a `payload` object on each exit row, and each call site merges `...t.payload` into its own payload. `emit.js` then drops the pre-contract carve-out: an `exited` without a valid actor, or with an outcome outside `OUTCOMES`, is dropped with its one stderr line.

**Tech Stack:** Node.js (CommonJS), `node:test`; runner `node tools/run-tests.js <files>`.

**Spec:** `.claude-tweaks/pipelines/2026-11-24T143350-record-6152/work/6152-spec.md` (record #6152)

## Global Constraints

- "Four outcomes: `passed`, `sent-back`, `failed`, `stopped`. Held is a state, not an outcome. A skip is a `replanned` event."
- "`skipped` and `abandoned` are retired from the vocabulary; `abandoned` maps to `stopped`; `returned` becomes `sent-back`."
- Every station name, kind, outcome and lane literal lives in `plugin/bin/lib/station-events/stations.js`; `station-literal-conformance.test.js` scans for violations. Actor and reason code are named through `ACTOR.*` / `REASON.*`, never as strings, outside `stations.js`.
- Emission never blocks or fails a transition: `appendStationEvent` drops a bad line to stderr and returns; no throw on any emission path.
- `exited` of any outcome without `payload.actor` is dropped with a stderr reason. A missing or unknown `reasonCode` keeps being normalized to `unspecified` (not dropped).
- `sent-back` requires `payload.next` (a station id).
- The accept verdict exits stay unemitted (a follow-up record owns them); the retired-outcome scan must not treat that as a caller.

Governing project skills (quoted verbatim):

- `station-event-producer-addition` Rule 1: "**Name stations through `stations.js`.** Use `STATION.*`, `SESSION_BOUND_STATION`, `BLOCKER_SNAPSHOT_STATION`, `PR_OPENED_TRANSITION`, `releaseTransition(reason)` or `transitionsForLabel(label, direction)`."
- `station-event-producer-addition` Rule 2: "**Optional seam, wrapped call.** An absent `deps.stationEvent` means no emission. Every call sits in its own try/catch, so a throwing emitter never changes stdout, the exit code or the CLI's envelope."
- `station-event-producer-addition` Rule 4: "**Emit only on a transition that landed.**"
- `station-event-producer-addition` registration row: "`docs/reference/station-events.md` | A Producers row (kind, station, outcome, payload keys, discriminator), and the item removed from Coverage gaps."
- `bin-source-scan-conformance`: "A scan reports `misparsed` and `unparseable` as an offender, with `STRIPPER_VERDICT_MESSAGES[verdict]` as the text."; "`assert.deepEqual(offenders, [])` over the walk also passes when the matcher matches nothing. For a scan that matches compliant and non-compliant sites alike, assert a lower bound on matches across the tree"; "Include negative cases: the convention's token inside a comment; a message string that contains the command"; "Assert the exact flagged line numbers, not just a count, because the right count can come from the wrong lines. Run each new assertion against the code it guards with the guard removed, and watch it go red."

Scope note: the spec's Key Files list names only `stations.js`, `emit.js` and the doc; the spec's own Decisions section requires migrating every caller of a retired value and every no-actor exit, which also touches `driver-mirror.js`, `release-claim.js`, `accept-park.js`, `lib/claim-targets/claim-targets.js` and `apply-refine-labels.js` (plus their tests). That is the expanded file set below.

## Decisions this plan makes

- Release reasons: the former `abandoned` family (`abandoned…`, `never-started…`, `swept:…`, `drive.js settle: refused…`) is `stopped`; any unrecognised reason (`drive.js settle: express-escalated…`, anything else) is `sent-back` with `next: 'release'` (the claim goes back to the authorized-but-unclaimed wait; `build→release` is the commonest observed return). Every release exit: `actor: 'script'`; every non-passed one: `reasonCode: 'unspecified'` (the reason string stays in `payload.reason`).
- `merge-park` is `sent-back` with `next: 'build'` (a red-path park sends the record back for changes, as the accept `changes-requested` verdict does), `actor: 'script'`, `reasonCode: 'unspecified'`, and `reasonText` = the driver line's `detail` when it is a non-empty string. `merge-confirm` `passed` gets `actor: 'script'`.
- Label-transition exits: `intake` and `shape` exits `actor: 'agent'` (shaping is agent work), `authorize` exit `actor: 'person'` (moved into the table from `apply-refine-labels.js`), `release` exit on `bot:in-progress` added `actor: 'script'` (the claim code).
- `RETIRED_OUTCOMES` is deleted from `stations.js` (its only consumer is `emit.js`).

## Review Focus

1. A `transitionsForLabel` / `releaseTransition` result mutated by one caller must not leak into the table or the next call (payload must be a fresh copy) — test in Task 1 and Task 3.
2. An `entered` label row must not gain a `payload` key (callers that spread a row and then set their own payload would otherwise be unaffected, but `claim-targets.js` spreads rows without a payload) — test in Task 1.
3. A `merge-park` line with `status: 'stop'` must still mirror (the old `t.outcome !== 'returned'` guard now keys on `sent-back`) — test in Task 2.
4. An `exited` line whose `payload` is not an object (null, string) must drop with an `actor` reason, never throw — test in Task 4.
5. A caller payload field must never be overwritten by the table's contract fields in a way that loses the caller's `reason`/`link` — test in Task 3 (release-claim payload keeps `reason`, `link`).

---

### Task 1: Label-transition exits carry an actor

**Files:**
- Modify: `plugin/bin/lib/station-events/stations.js` (`LABEL_TRANSITIONS`, `transitionsForLabel`)
- Modify: `plugin/bin/apply-refine-labels.js` (`emitLabelTransitions`)
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (`emitInProgressTransition` — no change needed if it spreads `row`; verify)
- Test: `tests/bin-lib/station-events/stations.test.js`
- Test: `tests/apply-refine-labels.test.js`
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js`

**Interfaces:**
- Produces: every `exited` row of `transitionsForLabel(label, direction)` has `payload: { actor }` (fresh object per call); `entered` rows have no `payload` key.

- [ ] **Step 1: Write failing tests** in `stations.test.js`: `every label-transition exit carries an actor` — for each `[label, direction]` in `LABEL_TRANSITIONS`, every `exited` row has `ACTORS.test(row.payload.actor)`, and the expected values: `needs:definition` removed → intake `agent`; `ready` added → intake `agent`, shape `agent`; `auto:build` added → authorize `person`; `bot:in-progress` added → release `script`; every `entered` row has no own `payload`. `transitionsForLabel returns a fresh payload` — mutating `transitionsForLabel('ready','added')[0].payload.actor` does not change the next call. In `apply-refine-labels.test.js`: `ready added writes intake and shape exits with actor agent`. In `claim-targets.test.js`: the release exit on a successful label add carries `payload: { actor: 'script' }` (update the existing expectation).
- [ ] **Step 2: Run the tests to verify they fail**

  Run: `node tools/run-tests.js tests/bin-lib/station-events/stations.test.js tests/apply-refine-labels.test.js tests/bin-lib/claim-targets/claim-targets.test.js`
  Expected: FAIL on the new assertions.
- [ ] **Step 3: Implement.** Add `payload: Object.freeze({ actor: ACTOR.X })` to each exit row in `LABEL_TRANSITIONS` (move `ACTOR`'s definition above the table if needed); `transitionsForLabel` copies `payload` (`{ ...t, ...(t.payload ? { payload: { ...t.payload } } : {}) }`). In `emitLabelTransitions`, the payload becomes `{ ...t.payload, label, direction }` (drop the `authorizes ? … : …` actor branch; `authorizes` stays for the `decided` line). Use `OUTCOME.PASSED` instead of `'passed'` literals in the table.
- [ ] **Step 4: Run** the Step 2 command — Expected: PASS.
- [ ] **Step 5: Commit** `git add` the files above; `git commit -m "Label-transition exits carry an actor — refs #6152"`.

### Task 2: Merge sub-steps migrate off `returned`

**Files:**
- Modify: `plugin/bin/lib/station-events/stations.js` (`MERGE_SUBSTEP_TRANSITIONS`)
- Modify: `plugin/bin/lib/station-events/driver-mirror.js` (`stationEventsFor` merge branch)
- Test: `tests/bin-lib/station-events/driver-mirror.test.js`
- Test: `tests/bin-lib/station-events/stations.test.js`

**Interfaces:**
- Produces: `MERGE_SUBSTEP_TRANSITIONS['merge-confirm']` `{ kind:'exited', station:'merge', outcome: OUTCOME.PASSED, substep, skipDetailPrefix:'armed', payload:{ actor: ACTOR.SCRIPT } }`; `['merge-park']` `{ kind:'exited', station:'merge', outcome: OUTCOME.SENT_BACK, substep, payload:{ actor: ACTOR.SCRIPT, reasonCode: REASON.UNSPECIFIED, next: STATION.BUILD } }`.

- [ ] **Step 1: Write failing tests** in `driver-mirror.test.js` (update the three `merge-park` expectations from `returned` to `sent-back`): `a merge-park stop mirrors to exited merge sent-back with next build, actor script and the detail as reasonText` — `payload` deep-equals `{ substep: 'merge-park', actor: 'script', reasonCode: 'unspecified', next: 'build', reasonText: 'ci-red: x' }`; a park with no detail has no `reasonText`; `a merge-confirm that merged carries actor script`; every mirrored merge exit passes `buildLine` (non-null).
- [ ] **Step 2: Run the tests to verify they fail**

  Run: `node tools/run-tests.js tests/bin-lib/station-events/driver-mirror.test.js tests/bin-lib/station-events/stations.test.js`
  Expected: FAIL.
- [ ] **Step 3: Implement.** Table as in Interfaces. In `stationEventsFor`: guard `status !== 'ok' && t.outcome !== OUTCOME.SENT_BACK`; payload `{ ...t.payload, substep: t.substep }` plus `reasonText: event.detail` when `t.outcome === OUTCOME.SENT_BACK && nonEmpty(event.detail)`.
- [ ] **Step 4: Run** the Step 2 command — Expected: PASS.
- [ ] **Step 5: Commit** `"Merge sub-steps mirror as sent-back and passed with an actor — refs #6152"`.

### Task 3: Release exits migrate off `abandoned` and `returned`

**Files:**
- Modify: `plugin/bin/lib/station-events/stations.js` (`outcomeForReleaseReason`, `releaseTransition`)
- Modify: `plugin/bin/release-claim.js`
- Modify: `plugin/bin/accept-park.js` (`releaseClaim` step)
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (`emitRollbackExit`)
- Test: `tests/bin-lib/station-events/stations.test.js`
- Test: `tests/bin-lib/release-claim/cli.test.js`
- Test: `tests/accept-park-cli.test.js`
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js`

**Interfaces:**
- Produces: `outcomeForReleaseReason(reason) -> 'passed'|'stopped'|'failed'|'sent-back'`; `releaseTransition(reason) -> null | { kind:'exited', station:'build', outcome, payload }` where `payload` is a fresh `{ actor:'script' }` plus `reasonCode:'unspecified'` when not passed, plus `next:'release'` when `sent-back`.

- [ ] **Step 1: Write failing tests.** `stations.test.js`: update the family table (former `abandoned` → `stopped`, former `returned` → `sent-back`; the settle-word coverage set becomes `['failed','passed','sent-back','stopped']`); `releaseTransition` deep-equals e.g. `releaseTransition(ABORT_REASON)` → `{ kind:'exited', station:'build', outcome:'stopped', payload:{ actor:'script', reasonCode:'unspecified' } }`, `releaseTransition('merged: spec 5902')` → `{ …, outcome:'passed', payload:{ actor:'script' } }`, `releaseTransition('shapedX: 1')` → `{ …, outcome:'sent-back', payload:{ actor:'script', reasonCode:'unspecified', next:'release' } }`; two calls give distinct `payload` objects. `release-claim/cli.test.js`: replace the two retired-outcome tests with `a release with a retired outcome is written as stopped or sent-back with an actor` — `abandoned: spec 999` emits `outcome:'stopped'`, payload `{ reason, link, actor:'script', reasonCode:'unspecified' }`, `buildLine` non-null; `drive.js settle: express-escalated at check` emits `sent-back` with `next:'release'`, `buildLine` non-null; update the reason→outcome table test. `accept-park-cli.test.js`: the in-process release exit payload is `{ reason:'awaiting-local-acceptance', actor:'script' }`. `claim-targets.test.js`: the rollback exit is `stopped` with payload `{ reason: ABORT_REASON, actor:'script', reasonCode:'unspecified' }`.
- [ ] **Step 2: Run the tests to verify they fail**

  Run: `node tools/run-tests.js tests/bin-lib/station-events/stations.test.js tests/bin-lib/release-claim/cli.test.js tests/accept-park-cli.test.js tests/bin-lib/claim-targets/claim-targets.test.js`
  Expected: FAIL.
- [ ] **Step 3: Implement.** In `stations.js` rename `RELEASE_ABANDONED` → `RELEASE_STOPPED`, return `OUTCOME.*` constants, add `RELEASE_SENT_BACK_NEXT = STATION.RELEASE`, build the payload in `releaseTransition`; update the comment above it. Call sites merge: `release-claim.js` `payload = { ...transition.payload, reason, link }` (delete the passed/failed-only actor branch and its comment; drop the now-unused `ACTOR`/`OUTCOME` imports if unused); `accept-park.js` `payload: { ...transition.payload, reason: PARK_REASON }`; `claim-targets.js` `payload: { ...releaseTransition(ABORT_REASON).payload, reason: ABORT_REASON }` (compute the transition once).
- [ ] **Step 4: Run** the Step 2 command — Expected: PASS.
- [ ] **Step 5: Commit** `"Release exits write stopped and sent-back with an actor — refs #6152"`.

### Task 4: The emitter refuses retired outcomes and actor-less exits

**Files:**
- Modify: `plugin/bin/lib/station-events/emit.js` (`isNewContractExit` removed; `invalidReason`, `invalidContract`, `contractPayload` changed)
- Modify: `plugin/bin/lib/station-events/stations.js` (delete `RETIRED_OUTCOMES` and its export; rewrite the comment above `OUTCOME`)
- Test: `tests/bin-lib/station-events/emit.test.js`
- Test: `tests/bin-lib/station-events/station-literal-conformance.test.js`
- Test: `tests/bin-lib/station-events/failure-isolation.test.js`

**Interfaces:**
- Consumes: Tasks 1-3 (no emitter writes a retired value or an actor-less exit).
- Produces: `appendStationEvent` drops `exited` with an outcome outside `OUTCOMES` (reason `outcome outside the closed set: "returned"`) and any `exited` whose `payload.actor` is not valid (reason names `payload.actor`).

- [ ] **Step 1: Write failing tests.** `emit.test.js`: `AC1.1: a retired outcome is dropped with a reason` — one `test` per value `returned`, `skipped`, `abandoned`, each with payload `{ actor: 'agent' }`, `dropped(…, /outcome outside the closed set/)`; `an exited passed without actor is dropped` and `an exited failed without actor is dropped` (`/actor/`); `an exited with a non-object payload is dropped, not thrown` (`payload: null` and `'x'` → `/actor/`). Delete the superseded tests `a retired outcome carrying an actor is written unchanged`, `a passed line with no actor is written unchanged`, `a failed line with no actor and no reasonCode is written unchanged`, `AC1.6: a legacy returned outcome is still written`, and `an own actor key puts an exit on the new contract…` if it only distinguishes the carve-out; give every other `exited` fixture an actor. `station-literal-conformance.test.js`: `AC1.2: no emitter under plugin/bin spells a retired outcome` — the emitter set is every `plugin/bin` `.js` file whose comment-stripped source `require`s a path containing `station-events/`, plus every file under `lib/station-events/` (stations.js included, not exempt); flag any string literal (`'…'`, `"…"`, `` `…` ``) exactly equal to `returned`, `skipped` or `abandoned`; stripper verdict other than `ok` is an offender; floor: at least 15 emitter files; a matcher self-test asserting exact flagged line numbers over planted lines (`'returned'`, `"skipped"`, `` `abandoned` `` and `x === 'returned'` flagged; `// 'returned'` in a comment, `'returned-x'`, `'skipped: foo'`, and a bare identifier `returned` not flagged); a planted stripper mis-parse reported as an offender; plus a go-red test planting `const o = 'abandoned';` into `release-claim.js` and asserting exactly that offender line. `failure-isolation.test.js`: change its two `outcome: 'returned'` fixtures to `'sent-back'` with `payload` carrying `actor`, `reasonCode`, `next` (the built line's payload is the same object).
- [ ] **Step 2: Run the tests to verify they fail**

  Run: `node tools/run-tests.js tests/bin-lib/station-events`
  Expected: FAIL.
- [ ] **Step 3: Implement.** `invalidReason`: `!OUTCOMES.includes(event.outcome)` only. `invalidContract`: every `exited` needs a valid actor; `sent-back` needs a station `next`. `contractPayload`: reason normalization for `planned`/`replanned` and every non-passed `exited`. Remove `RETIRED_OUTCOMES` from `stations.js` and the import.
- [ ] **Step 4: Run** `node tools/run-tests.js tests/bin-lib/station-events tests/bin-lib/driver tests/bin-lib/release-claim tests/bin-lib/claim-targets tests/accept-park-cli.test.js tests/apply-refine-labels.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `"feat: retire returned, skipped and abandoned from station events — refs #6152"`.

### Task 5: Publish the contract in the reference doc

**Files:**
- Modify: `docs/reference/station-events.md`
- Test: `tests/bin-lib/station-events/transition-table.test.js` (must stay green; no new test)

- [ ] **Step 1: Edit the doc.** Add a `## Event contract` section (after `## Line format, v1`'s Kinds/Outcomes, before `## eventKey`) holding the spec's contract table verbatim (kinds `planned`, `replanned`, `held`, `released`, `decided`, `exited` (extended) with station and payload columns) and the `actor` / reason-code sentence. Rewrite `### Outcomes` (four outcomes; the retired three are refused; every `exited` needs `payload.actor`; `sent-back` needs `payload.next`). Update every mention of `abandoned`/`returned`/"until record 8/8"/"pre-contract"/"without `actor`": the build and merge rows of the transition table, the producers rows (claim-targets release exit `{ actor }`, rollback `stopped`, release-claim payload, accept-park release, apply-refine actors, merge sub-steps), the `bot:parked` hold paragraph, the reason-code paragraph's `merge-park` sentence, the `Release reasons to outcomes` table (`stopped`, `sent-back` with `next: release`), `Reading the events` (`merge-park` is `exited` `sent-back`), and the coverage-gap bullet about `accept-park.js` being pre-contract.
- [ ] **Step 2: Verify** `grep -nE "abandoned|returned|8/8|pre-contract" docs/reference/station-events.md` shows only the Outcomes sentence naming the refused values and any release-reason *input* strings (`abandoned…`), and run `node tools/run-tests.js tests/bin-lib/station-events/transition-table.test.js` — Expected: PASS.
- [ ] **Step 3: Commit** `"Publish the station-event contract in the reference doc — refs #6152"`.
