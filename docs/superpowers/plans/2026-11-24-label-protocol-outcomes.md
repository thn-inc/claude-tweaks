# Label-protocol outcomes (floor map emission 6/8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The release and authorize exits write the new-contract outcome with `payload.actor`, and the authorize exit is followed by a `decided` line. The accept verdict exits are recorded as a coverage gap (plan-review Decision 1).

**Architecture:** Each change passes new `payload` fields into an existing `deps.stationEvent({...})` call; `emit.js` already validates actors and normalizes reason codes. The `decided` line's `outcomeRef` is `eventKey(exitedEvent)` from `plugin/bin/lib/station-events/emit.js`.

**Tech Stack:** Node.js (CommonJS), `node:test`; test runner `node tools/run-tests.js <file>`.

**Spec:** `.claude-tweaks/pipelines/2026-11-24T063819-record-6150/work/6150-spec.md`

Scope keywords: ACTOR.PERSON, KIND.DECIDED

## Global Constraints

- "No prose is asked to log; only code that already makes the transition does." Every new line is written from code that already performs the transition.
- "A reason that nothing knows is `unspecified`, counted and shown, never silently dropped, and never blocks the outcome."
- "Four outcomes: `passed`, `sent-back`, `failed`, `stopped`."
- Every station name, kind, outcome, actor, reason and lane literal is named through `plugin/bin/lib/station-events/stations.js` (`STATION.*`, `KIND.*`, `OUTCOME.*`, `ACTOR.*`, `REASON.*`); `tests/bin-lib/station-events/station-literal-conformance.test.js` scans for violations.
- Emission never blocks or fails a transition: every `deps.stationEvent` call stays in its own try/catch; no throw on any emission path.

## Plan-review decisions (on the record body, 2026-11-24)

- **Decision 1 (Reading B):** this record covers the release exit and the authorize exit only. AC1 keeps its first two tests and drops the two accept tests. `plugin/bin/accept-park.js` and `tests/accept-park-cli.test.js` are not touched (its in-process park release keeps its current payload). No skill text changes. Task 3 states the accept gap under `docs/reference/station-events.md`'s Coverage gaps with the record's exact sentence; a follow-up record owns it.
Waived AC1.3: dropped by plan-review Decision 1 — no program code applies the accept verdict labels; a follow-up record owns it.
Waived AC1.4: dropped by plan-review Decision 1 — no program code applies the accept verdict labels; a follow-up record owns it.
Waived plugin/bin/accept-park.js: removed from this record's Files by plan-review Decision 1; not touched.
Waived tests/accept-park-cli.test.js: removed from this record's Files by plan-review Decision 1; not touched.

- **Decision 2 (Reading A):** `actor` is added only to release exits whose outcome is `passed` or `failed`. Releases whose outcome is the retired `abandoned` or `returned` are left exactly as they are (no `actor`); record 8/8 (#6152) migrates them.

## Review Focus

1. A release whose reason maps to `failed` (`failed: test`) now carries `actor`, so it is a new-contract exit: its written line must carry `reasonCode: 'unspecified'`, not be dropped. Test in Task 1.
2. A release whose reason maps to a retired outcome (`abandoned: spec 1`, `never-started: x`, a sweep) carries no `actor` and its payload is byte-identical to before. Test in Task 1.
3. A swept release keeps `sweptBy` / `sweptBySession`; a sweep's outcome is `abandoned`, so it gains no `actor`. Covered by the existing sweep test, unchanged.
4. The `decided` line's `outcomeRef` equals the `eventKey` the written `exited authorize` line gets from `buildLine`, including when `runId` is null. Test in Task 2.
5. One action adding `auto:build` twice (or a replayed batch with a run dir) writes `decided` once per recorded exit, and a throwing emitter on the exit still leaves the batch's stdout and exit code unchanged. `decided` is attempted only when the exit's own `stationEvent` call returned without throwing, so the existing throwing-emitter test's attempt count stays 5; Task 2's test asserts one `decided` per exit.

---

### Task 1: Release exits with a new-contract outcome carry actor `script`

**Review risk:** high

**Files:**
- Modify: `plugin/bin/release-claim.js` (the `deps.stationEvent` call in `run`, near line 213)
- Test: `tests/bin-lib/release-claim/cli.test.js`

**Interfaces:**
- Consumes: `ACTOR`, `OUTCOME` from `plugin/bin/lib/station-events/stations.js` (`ACTOR.SCRIPT === 'script'`); `buildLine` from `plugin/bin/lib/station-events/emit.js`.
- Produces: a claim-release `exited build` event whose `outcome` is `passed` or `failed` carries `payload.actor: 'script'`; one whose outcome is retired (`abandoned`, `returned`) is unchanged.

- [ ] **Step 1: Write failing tests** (AC1.1 — `a claim's release exit is passed with actor script`)

In `tests/bin-lib/release-claim/cli.test.js`, add beside the `#5902` block:

```js
test("a claim's release exit is passed with actor script", () => {
  const runDir = mkRun();
  const { d } = deps({ content: live(RUN_DIR_NAME), out: [], mainRoot: rootOf(runDir) });
  const events = withStationSpy(d);
  assert.equal(run(['999', '--run', runDir, '--reason', 'merged', '--link', 'https://x/1'], d), 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, 'passed');
  assert.equal(events[0].payload.actor, 'script');
  const { buildLine } = require('../../../plugin/bin/lib/station-events/emit');
  assert.ok(buildLine(events[0]), 'the line is accepted on the new contract');
});

test('a failed release carries actor script and is written with reasonCode unspecified', () => {
  const runDir = mkRun();
  const { d } = deps({ content: live(RUN_DIR_NAME), out: [], mainRoot: rootOf(runDir) });
  const events = withStationSpy(d);
  assert.equal(run(['999', '--run', runDir, '--reason', 'failed: test'], d), 0);
  const { buildLine } = require('../../../plugin/bin/lib/station-events/emit');
  const line = buildLine(events[0]);
  assert.equal(line.outcome, 'failed');
  assert.equal(line.payload.actor, 'script');
  assert.equal(line.payload.reasonCode, 'unspecified');
});

test('a retired-outcome release carries no actor and its payload is unchanged', () => {
  const runDir = mkRun();
  const { d } = deps({ content: live(RUN_DIR_NAME), out: [], mainRoot: rootOf(runDir) });
  const events = withStationSpy(d);
  assert.equal(run(['999', '--run', runDir, '--reason', 'abandoned: spec 999'], d), 0);
  assert.equal(events[0].outcome, 'abandoned');
  assert.deepEqual(events[0].payload, { reason: 'abandoned: spec 999', link: null });
  const { buildLine } = require('../../../plugin/bin/lib/station-events/emit');
  assert.equal(buildLine(events[0]).outcome, 'abandoned');
});
```

Update the existing `#5902: a released claim with --reason merged ...` deepEqual's `payload` to `{ reason: 'merged', link: 'https://x/1', actor: 'script' }`, and any other existing release-claim test that deep-equals a `passed`/`failed` release payload (grep the file for `payload: {`) the same way. Tests deep-equaling a retired-outcome payload stay as they are.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/release-claim/cli.test.js`
Expected: FAIL after Step 1 (the first two new tests and the updated deepEqual; no `actor` yet).

- [ ] **Step 3: Implement.** In `release-claim.js`, import `ACTOR` and `OUTCOME` from `./lib/station-events/stations` beside `releaseTransition`, and after building `payload = { reason, link: o.link || null }` add `actor: ACTOR.SCRIPT` only when `transition.outcome === OUTCOME.PASSED || transition.outcome === OUTCOME.FAILED`. No other field changes; the `failed` reason code is left for `emit.js` to normalize to `unspecified`.

Proof(auth): the change adds one `payload.actor` field to station-event lines written after `releaseClaim` returns `released`; the claim blob write, label removal and decisions.md line are untouched, which the unchanged stdout/exit/`logged` byte-identity tests (`#5902: a recording stationEvent leaves stdout, the exit code and stderr byte-identical`) keep pinned.

- [ ] **Step 4: Run** the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit** `git add plugin/bin/release-claim.js tests/bin-lib/release-claim/cli.test.js` then commit `Write actor script on new-contract claim-release exits — refs #6150`.

### Task 2: Authorize exit carries actor `person` and a `decided` line

**Review risk:** high

**Files:**
- Modify: `plugin/bin/apply-refine-labels.js` (`emitLabelTransitions`, near line 120)
- Test: `tests/apply-refine-labels.test.js`

**Interfaces:**
- Consumes: `ACTOR`, `KIND`, `STATION` from `stations.js`; `eventKey` from `plugin/bin/lib/station-events/emit.js` (`eventKey({ repoName, recordNumber, kind, station, outcome, runId, discriminator }) -> string`).
- Produces: adding `auto:build` writes, in order, `exited authorize passed` with `payload: { label, direction, actor: 'person' }`, then `decided` at station `authorize` with `payload: { decision: 'authorize', actor: 'person', via: 'skill', outcomeRef: <eventKey of that exited event> }` and the same `discriminator`, then `entered release`.

- [ ] **Step 1: Write failing test** (AC1.2 — `authorizing writes exited passed actor person and a decided authorize via skill`)

```js
test('authorizing writes exited passed actor person and a decided authorize via skill', () => {
  const { deps, events } = stationDeps([{ issue: 118, addLabels: ['auto:build'] }], { sessionId: 'sess-1' });
  assert.strictEqual(run(['actions.json'], deps), 0);
  assert.deepStrictEqual(events.map(triple), ['exited authorize passed', 'decided authorize', 'entered release']);
  assert.strictEqual(events[0].payload.actor, 'person');
  const { eventKey, buildLine } = require('../plugin/bin/lib/station-events/emit');
  assert.deepStrictEqual(events[1].payload, {
    decision: 'authorize', actor: 'person', via: 'skill', outcomeRef: eventKey(events[0]),
  });
  assert.strictEqual(events[1].payload.outcomeRef, buildLine(events[0]).eventKey, 'outcomeRef is the written exit line key');
  assert.strictEqual(events[1].discriminator, events[0].discriminator);
  assert.ok(buildLine(events[1]), 'the decided line is accepted');
});
```

Update the existing `adding auto:build records exited authorize passed + entered release` test: its triple list becomes `['exited authorize passed', 'decided authorize', 'entered release']`, `events[0].payload` gains `actor: 'person'`, and its `events[1].outcome` assertion moves to `events[2]`. Grep the file for other tests that list `auto:build` triples or index events after an authorize exit (`runId is the run dir basename`, `a comment failure after a successful edit`) and update them the same way. Also update: `a recording stationEvent leaves stdout ...` (`events.length` 5 → 6), `a host-qualified --repo reduces to owner/name` (`events.length` 2 → 3), and `two actions on one issue are not deduped` (insert `'5 decided authorize'` after `'5 exited authorize passed'`). The throwing-emitter test's `attempts, 5` stays 5 (no `decided` after a throwing exit call). Add one assertion that a re-authorize action (`addLabels: ['auto:build'], removeLabels: ['bot:blocked']`) also writes `decision: 'authorize'` (plan-review clarification).

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tools/run-tests.js tests/apply-refine-labels.test.js`
Expected: FAIL after Step 1.

- [ ] **Step 3: Implement.** In `emitLabelTransitions`, when `t.kind === KIND.EXITED && t.station === STATION.AUTHORIZE`, add `actor: ACTOR.PERSON` to that event's payload; after emitting it (its own try), emit the `decided` event — only when the exit's `stationEvent` call returned without throwing — with `kind: KIND.DECIDED, station: STATION.AUTHORIZE`, `decision: 'authorize'` for every `auto:build` add (a re-authorize that also removes `bot:blocked` included), the same `recordNumber`, `repoName`, `lane`, `runId`, `sessionId` and `discriminator`, and `outcomeRef: eventKey(exitedEvent)`, inside its own try/catch. Only the authorize exit changes; intake, shape and release exits are untouched.

Proof(auth): `auto:build` is a grant label; this task changes only the station-event lines written after `gh issue edit` succeeded — the edit argv, the `failed` routing and stdout stay byte-identical, pinned by the existing `a failed edit records nothing` and `a recording stationEvent leaves stdout and exit code byte-identical` tests.

- [ ] **Step 4: Run** the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit** `git add plugin/bin/apply-refine-labels.js tests/apply-refine-labels.test.js` then commit `Write actor person and a decided line at the authorize exit — refs #6150`.

### Task 3: Producers table and the accept coverage gap

**Files:**
- Modify: `docs/reference/station-events.md` (the Producers table rows for `release-claim.js` and `apply-refine-labels.js`; `### Kinds`; `## Coverage gaps`)

- [ ] **Step 1:** Add `actor` (`script`, on a `passed` or `failed` release only; a retired-outcome release carries none until record 8/8) to the payload keys of the `release-claim.js` row; add to the `apply-refine-labels.js` row that the `auto:build` authorize exit carries `actor` (`person`) and is followed by a `decided` line at `authorize` (`decision`, `actor`, `via`, `outcomeRef` = the exit's `eventKey`, same discriminator). In `### Kinds`, `decided` now has a producer. Under `## Coverage gaps`, add the bullet: "The accept verdict exits (`passed` plus `decided accept`; `sent-back` to `build` with `changes-requested`) are not emitted: the verdict labels are applied by skill prose, so they need a code path first." Extend the existing release bullet with: "`accept-park.js`'s in-process release is still written without `actor` (pre-contract)."
- [ ] **Step 2: Run the station-event doc tests**

Run: `node tools/run-tests.js tests/bin-lib/station-events/transition-table.test.js`
Expected: PASS.
- [ ] **Step 3: Commit** `docs/reference/station-events.md` — `Document the release and authorize outcome fields and the accept gap — refs #6150`.
