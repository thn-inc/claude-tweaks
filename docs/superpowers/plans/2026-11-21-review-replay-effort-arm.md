# Review-Replay Effort Arm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A review-replay `--arm` can name an `effort`, and `score` refuses to count a replay agent whose transcript shows it ran at any other effort.

**Architecture:** `extract.js`'s `parseArm` accepts one more key and `writeOutputs` writes it into the manifest arm in place of the profile's effort. `score.js` reads the `effort` field on every `type: "assistant"` transcript entry while it identifies agents, tallies it per arm as `recordedEffort`, and adds the not-judged reason `effort-mismatch` beside `no-reply` and `chunk-split`.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-21T173038-spec-5990/work/5990-spec.md` (record #5990)

## Global Constraints

- Effort values accepted, exactly: `low`, `medium`, `high`, `xhigh`, `max`.
- A malformed invocation exits 2. `score` with any `notJudged` exits 3 (`EXIT_NOT_CLEAN`).
- Maintainer-side only: nothing under `plugin/` may name `tools/review-replay` (`tests/review-replay/no-plugin-reference.test.js`).
- Keep the `score.js` change local to agent identification, the slot-settling loop and the per-arm summary. #5632, #5704 and #5967 also edit this file.
- Do not add a `[Effort: …]` sentence to any judge prompt.

## Review Focus

1. A transcript whose assistant entries carry `effort` on some turns and not on others should be `unrecorded`, not take the value of the turns that have one. Pinned in Task 2 (`partial effort is unrecorded`).
2. An agent whose turns disagree (`low`, then `medium`) should be `mixed` and an `effort-mismatch` even when one turn matches the arm. Pinned in Task 2.
3. `effort=` on a `fast` arm, whose profile effort is `null`: the arm's effort applies and is checked. Pinned in Task 1 (manifest) and Task 2 (check).
4. An entry whose `effort` and `perTurnEffort` differ should be reported, never silently resolved. Classification reads `effort`, and the arm counts such agents in `effortFieldsDiffer`. Pinned in Task 2.
5. A slot with no reply stays `no-reply`, not `effort-mismatch`, because a missing reply is checked first. Pinned in Task 2.

---

### Task 1: `effort=` arm key in extract

**Role:** integration

**Files:**
- Modify: `tools/review-replay/extract.js` (`ARM_KEYS_ACCEPTED` line 17, `parseArm` lines 28-48, `writeOutputs` manifest arm line 230)
- Modify: `tools/review-replay.js` (header comment lines 6-7, `USAGE` line 43)
- Modify: `docs/journeys/replay-archived-reviews-to-measure-a-tiebreak-change-5557.md` (step 2, lines 36-38)
- Test: `tests/review-replay/extract.test.js`

**Interfaces:**
- Produces: a manifest arm whose `effort` is the `--arm`'s `effort=` value when given, else `PROFILES[profile].effort`. Same keys in the same order as today: `name, chunk, profile, model, effort, repeat, prompts`. Task 2 reads `arm.effort` from the manifest.

- [ ] **Step 1: Write the failing tests** in `tests/review-replay/extract.test.js`, following the file's existing extract-into-scratch-dir pattern:
  - `test('AC1.1: an arm with effort=low writes model opus and effort low', …)`: extract with `--arm name=lo,chunk=1,profile=capable,repeat=1,effort=low`. Assert the manifest arm `lo` has `model === PROFILES.capable.model` (`'opus'`) and `effort === 'low'`.
  - `test('AC2.1: effort=fast exits 2 and stderr names fast', …)`: `--arm name=x,profile=capable,effort=fast`. Assert exit code `2` and `deps.errs.join('\n')` matches `/fast/`. Also assert that each of `low`, `medium`, `high`, `xhigh` and `max` is accepted (exit 0 per value, fresh out dir).
  - `test('AC3.1: an arm without effort= writes the same manifest arm as before', …)`: extract with `--arm name=s,chunk=1,profile=standard,repeat=1`. Assert `JSON.stringify` of the arm minus `prompts` equals `JSON.stringify({ name: 's', chunk: 1, profile: 'standard', model: PROFILES.standard.model, effort: PROFILES.standard.effort, repeat: 1 })`. That pins key order and values byte for byte.
  - `test('effort= on a fast arm overrides its null effort', …)`: `--arm name=f,profile=fast,effort=medium`. The manifest arm has `effort: 'medium'`.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/review-replay/extract.test.js`
  Expected: FAIL. AC1.1 and the fast-override test exit 2 with `unknown key "effort"`, AC2.1's accepted-values loop fails, and AC3.1 already passes.

- [ ] **Step 3: Implement.** In `extract.js`, add `const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];` and put `'effort'` in `ARM_KEYS_ACCEPTED`. In `parseArm`, a `key === 'effort'` branch: when `!EFFORTS.includes(value)`, return `{ error: \`--arm: effort must be one of ${EFFORTS.join('|')}: "${value}" in "${text}"\` }`, else set `arm.effort = value`. In `writeOutputs`, write `effort: a.effort !== undefined ? a.effort : PROFILES[a.profile].effort`, keeping the key's position. In `tools/review-replay.js`, add `[,effort=<low|medium|high|xhigh|max>]` to the extract `--arm` line in the header comment and in `USAGE`, plus one header sentence: an arm's `effort` replaces its profile's, and `score` checks it. In the journey's step 2 URL line, add `,effort=low` to the example's second arm. In its "Should understand" list, add one bullet: an arm may set `effort=` (`low`, `medium`, `high`, `xhigh`, `max`) to run its judges at another effort than its profile's, and `score` checks the effort each judge recorded (step 4).

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/review-replay/extract.test.js tests/review-replay/no-plugin-reference.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**
  ```bash
  git add tools/review-replay/extract.js tools/review-replay.js tests/review-replay/extract.test.js docs/journeys/replay-archived-reviews-to-measure-a-tiebreak-change-5557.md
  git commit -m "Accept effort= on a review-replay arm — refs #5990"
  ```

### Task 2: `score` reads the recorded effort and refuses a mismatch

**Role:** integration
**Review risk:** high (decision logic: which slots are refused)

**Files:**
- Modify: `tools/review-replay/score.js` (`identifyAgents` lines 126-151, arm summary lines 211-226, slot loop lines 228-256)
- Modify: `tests/review-replay/helpers.js` (`setup().agent`, lines 117-127)
- Modify: `docs/journeys/replay-archived-reviews-to-measure-a-tiebreak-change-5557.md` (step 4, line 61 and its "Should understand" list)
- Test: `tests/review-replay/score.test.js`

**Interfaces:**
- Consumes: manifest `arm.effort` (string or `null`) from Task 1.
- Produces: `transcriptEffort(transcriptText) -> { effort: string | 'mixed' | 'unrecorded', fieldsDiffer: boolean }`, exported from `score.js`. Per arm in score's output, `recordedEffort: { [effortOrMixedOrUnrecorded]: agentCount }` and `effortFieldsDiffer: number`. The not-judged reason is `effort-mismatch`.

- [ ] **Step 1: Extend the fixture writer.** `setup().agent(agentId, label, { …, effort, perTurnEffort })`: when `effort` is a string, every assistant entry gets top-level `effort: effort`. When it is an array, entry `i` gets `effort[i]`, and `undefined` omits the field. `perTurnEffort` works the same way, defaulting to the `effort` value per entry. This is the field shape a real Claude Code transcript writes (top-level `effort` and `perTurnEffort` on each `type: "assistant"` entry, seen on a 2026-11-21 subagent transcript). The writer is the harness, so no in-repo writer exists to call.

- [ ] **Step 2: Write the failing tests** in `score.test.js`. Build each with `setup({ arms: ['--arm', 'name=lo,chunk=1,profile=fast,effort=low'] })` and judges for the four `lo|1|run-*--*` slots, mirroring `fullSet`:
  - `test('AC4.1: a slot of an effort=low arm whose turns all recorded medium is notJudged under effort-mismatch, and score exits 3', …)`: one judge with `effort: 'medium'`, the rest `'low'`. Assert that `arms.lo.notJudgedByReason['effort-mismatch']` equals that slot's finding count, and that `code === 3`.
  - `test('AC4.2: the same slot with turns recording low is scored', …)`: all four `'low'`. Assert `notJudged === 0`, `judged === 4`, `code === 0`, and `recordedEffort` equal to `{ low: 4 }`.
  - `test('AC5.1: a slot whose agent recorded no effort is effort-mismatch and counted unrecorded', …)`: one judge without `effort`. Assert `effort-mismatch` covers that slot's findings and `recordedEffort.unrecorded === 1`.
  - `test('partial effort is unrecorded', …)`: one judge with `effort: ['low', undefined]`. Assert it is `unrecorded` and its findings are `effort-mismatch`.
  - `test('turns that disagree are mixed and a mismatch', …)`: `effort: ['low', 'medium']`. Assert `recordedEffort.mixed === 1` and that its findings are `effort-mismatch`.
  - `test('an entry whose effort and perTurnEffort differ is counted in effortFieldsDiffer', …)`: `effort: 'low', perTurnEffort: 'high'`. Assert `effortFieldsDiffer === 1` and that the slot is scored (classification reads `effort`).
  - `test('a slot with no reply stays no-reply, not effort-mismatch', …)`: a judge with `effort: 'medium'` and no result. Assert its findings are under `no-reply`.
  - `test('an arm with null effort is never checked but still reports recordedEffort', …)`: the default `ARMS` (`profile=fast`, no `effort=`) with `fullSet`. Assert exit 0 and `arms.one.recordedEffort` equal to `{ unrecorded: 4 }`.
  - Update `AC3.1/AC3.2`'s two `deepEqual(r.json.arms.one, …)` / `(…arms.eight, …)` literals: add `recordedEffort: { unrecorded: 4 }` / `{ unrecorded: 2 }` and `effortFieldsDiffer: 0`.

- [ ] **Step 3: Run to verify they fail**
  Run: `node --test tests/review-replay/score.test.js`
  Expected: FAIL. Each new test fails on a missing `recordedEffort` or on exit 0 where 3 is expected, and AC3.1's updated literals fail.

- [ ] **Step 4: Implement** in `score.js`:
  - `transcriptEffort(transcriptText)` over `parseLines`, for `type === 'assistant'` entries only. No such entry, or any one lacking a string `effort`, returns `'unrecorded'`. More than one distinct `effort` returns `'mixed'`. Otherwise it returns the single value. `fieldsDiffer` is true when any entry carries a string `perTurnEffort` that differs from its `effort`.
  - `identifyAgents` stores `{ agentId, effort }` per identified slot agent (keep `slot.agents` as ids; add `slot.efforts`), and returns per-arm effort entries the way it returns `costs`.
  - The arm summary gains `recordedEffort: {}` and `effortFieldsDiffer: 0`, filled from every identified agent of that arm.
  - Slot loop order: `file-absent-in-tree`, then `no-reply` (`text === null`), then `effort-mismatch` (when `slot.arm.effort !== null` and any `slot.efforts` entry `!== slot.arm.effort`), then `chunk-split`, then settle.
  - Export `transcriptEffort`.

- [ ] **Step 5: Run to verify they pass**
  Run: `node --test tests/review-replay/score.test.js tests/review-replay/workflow.test.js tests/review-replay/roundtrip.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 6: AC6.1 go-red proof.** Temporarily remove the `effort-mismatch` branch from the slot loop, run `node --test --test-name-pattern "AC4.1" tests/review-replay/score.test.js`, confirm it FAILS, then restore the branch and re-run to PASS. Save the red run's output under the run directory as `evidence/ac6-red.txt`. For AC6.2, the PR body quotes it. Never commit the mutation.

- [ ] **Step 7: Journey.** Step 4's notJudged reason list gains `effort-mismatch`. Add one "Should understand" bullet: when an arm sets an effort, every judge's turns must have recorded exactly that effort. A judge that recorded another, mixed or none is `effort-mismatch`, and `recordedEffort` per arm shows what was recorded. Add one red flag: an `effort=` arm that exits 0 while its `recordedEffort` shows another effort.

- [ ] **Step 8: Commit**
  ```bash
  git add tools/review-replay/score.js tests/review-replay/helpers.js tests/review-replay/score.test.js docs/journeys/replay-archived-reviews-to-measure-a-tiebreak-change-5557.md
  git commit -m "Refuse to score a review-replay judge that ran at another effort — refs #5990"
  ```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (`effort=` key, exit 2, manifest) / AC1.1, AC2.1, AC3.1 | 1 |
| Deliverable 2 (`recordedEffort`, `mixed`, `unrecorded`) / AC5.1 | 2 |
| Deliverable 3 (`effort-mismatch`, null arm unchecked) / AC4.1, AC4.2 | 2 |
| Deliverable 4 (header, `USAGE`, journey steps 2 and 4) | 1, 2 |
| Deliverable 5 (tests with effort-bearing fixtures) | 1, 2 |
| AC6.1 (revert makes AC4 fail) / AC6.2 (PR quotes the red run) | 2 Step 6 |
| Gotcha: `effort` vs `perTurnEffort` differ → report both | 2 (`effortFieldsDiffer`) |
