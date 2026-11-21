# Shared Transcript Usage Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One exported function in `plugin/bin/lib/timing/transcript.js` owns the "max of each usage field per `message.id`" rule (with the 5-minute / 1-hour cache-write split); `readUsage`, `tools/pipeline-cost-report/spend.js` and `tools/review-replay/score.js` all merge through it.

**Architecture:** The three readers keep their own line filters and scans (spend needs cwd/skill/compaction markers and a corrupt-file check; score works on in-memory text and tracks first/last timestamps; readUsage streams rows), so the shared unit is the per-id merge, not a file reader: `mergeUsage(prev, usage)` is the sibling export the spec allows; it is pure and returns a new running-max object. `readUsage` folds its repeated ids through it and its row shape is unchanged (plan review, spec's Plan Review Clarifications). The two tools load the function from `path.join(pluginRoot, 'bin', 'lib', 'timing', 'transcript.js')`, where `pluginRoot` is a dep defaulting to the checkout's `plugin/` (the pattern `score.js` already uses for `tiebreak.js`).

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-21T181754-spec-5967/work/5967-spec.md`

Scope keywords: readUsage, mergeUsage, transcriptCost, scanTranscript, ephemeral_1h_input_tokens

## Global Constraints

- No change to the fields `readUsage`'s current callers read, and no key added to or removed from a `readUsage` row (`tests/bin-lib/timing/transcript.test.js:216` deep-equals a whole row): every existing key keeps its value on every row.
- The existing `tests/pipeline-cost-report/*.test.js`, `tests/review-replay/*.test.js` and `tests/bin-lib/timing/transcript.test.js` pass **unchanged** — no edit to an existing assertion. One exception, decided by the user at plan review: the `score requires tiebreak.js through deps.pluginRoot` test gains one stub file (Task 3); its assertions stay as they are.
- Nothing under `plugin/` may contain the substring `tools/review-replay` or `tools/pipeline-cost-report` (pinned by `tests/review-replay/no-plugin-reference.test.js` and `tests/pipeline-cost-report/cli.test.js`'s AC9.1, comments included) — describe the consumers generically in `transcript.js` comments ("the maintainer-side cost report and review replay").
- Coercion of a usage value is `Number(v) || 0` (readUsage's existing rule, kept so its callers see no change).

## Review Focus

1. A `message.id` whose line with the largest `cache_creation_input_tokens` has no `cache_creation` object → all of the write counts as 5-minute (`cacheWrite1h` 0, `cacheWrite5m` = the write) — Task 1 test.
2. A later line with a smaller cache write but a larger `ephemeral_1h_input_tokens` → the 1-hour split stays the one read from the largest-write line — Task 1 test.
3. `ephemeral_1h_input_tokens` larger than `cache_creation_input_tokens` → clamped to the write, so `cacheWrite5m` is never negative — Task 1 test.
4. `readUsage` over a repeated `message.id` gives exactly the values it gives today — first row at the per-field max, later rows zeroed, id-less rows unmerged — now through `mergeUsage`; pinned by the existing `#1929 AC2` and `#4029: contextTokens is the per-id max sum` tests (Task 1 Step 4), no new test.
5. `usage` absent or holding non-number values (`null`, missing keys) → `mergeUsage(null, undefined)` is all zeros and never throws — Task 1 test.

---

### Task 1: `mergeUsage` in transcript.js, readUsage folds through it

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/timing/transcript.js` (new `mergeUsage` above `readUsage`; `readUsage`'s row literal and per-id max block ~lines 190-245; the readUsage doc comment ~lines 143-170; `module.exports` line 554)
- Test: `tests/bin-lib/timing/transcript.test.js` (append new tests only)
- Modify: `docs/plugin-structure.md:86` — in the `transcript.js` description, after "the streaming usage reader that feeds `joinTokens` (#1929)", add "; `mergeUsage` — the one max-per-`message.id` usage rule (with the 5-minute / 1-hour cache-write split) that `readUsage` and the maintainer-side cost report and review replay share (#5967)"
- No-change (consumer enumeration — the row set and existing fields are unchanged, each reads only existing keys): `plugin/bin/lib/timing/context-gauge.js` (its comment at ~262 "per-message.id max — readUsage's" stays true), `plugin/bin/lib/timing/run-timing.js`, `plugin/bin/lib/timing/turn-class.js` (comment names readUsage as its caller — still true), `readDispatches` in `transcript.js`, `tests/helpers/close-timing.js`, `tests/bin-lib/reconcile/archive-merged.test.js` (both stub readUsage), `tests/bin-lib/timing/run-timing.test.js`, `tests/bin-lib/timing/at-close.test.js`, `tests/hooks-subagent-stop.test.js`.
- No-change (Check B keyword hits that only quote a scope keyword): transcript fixtures carrying `ephemeral_1h_input_tokens` (`tests/fixtures/context-gauge/*.jsonl`, `tests/fixtures/guard-refusals/store/**`, `tests/bin-lib/driver/fixtures/worker-result*.json`), historical plans `docs/superpowers/plans/2026-11-16-*.md`, `docs/superpowers/specs/2026-11-18-pipeline-economy-baseline.md`, and `docs/reference/dispatch-cost-baseline.md:157` (describes an independent count that deliberately does not use readUsage — still accurate).

**Interfaces:**
- Produces: `mergeUsage(prev: UsageMax | null, usage: object | undefined) -> UsageMax`, exported from `plugin/bin/lib/timing/transcript.js`, where `UsageMax = { input, output, cacheRead, cacheCreate, cacheWrite1h, cacheWrite5m }` (all numbers). Pure: never mutates `prev` or `usage`.
  - `input/output/cacheRead/cacheCreate` = max of `prev`'s value (0 when `prev` is null) and `Number(usage.input_tokens / output_tokens / cache_read_input_tokens / cache_creation_input_tokens) || 0`.
  - `cacheWrite1h`: when `prev` is null or this line's write is strictly greater than `prev.cacheCreate`, `Math.min(write, Number(usage.cache_creation && usage.cache_creation.ephemeral_1h_input_tokens) || 0)`; otherwise `prev.cacheWrite1h`. `cacheWrite5m = cacheCreate - cacheWrite1h`.
- `readUsage`'s rows are unchanged in shape and values; only its per-id max goes through `mergeUsage`.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/timing/transcript.test.js`; require `mergeUsage` alongside the existing imports in a new `require` line in the appended block so the existing import line is untouched)

```js
test('#5967: mergeUsage keeps the max of each field across lines of one message.id', () => {
  let m = mergeUsage(null, { input_tokens: 3, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 });
  m = mergeUsage(m, { output_tokens: 40 });
  m = mergeUsage(m, { output_tokens: 900, input_tokens: 1 });
  assert.deepEqual(m, { input: 3, output: 900, cacheRead: 1000, cacheCreate: 0, cacheWrite1h: 0, cacheWrite5m: 0 });
});
test('#5967 RF1: the largest write with no cache_creation object is all 5-minute', () => {
  assert.deepEqual(mergeUsage(null, { cache_creation_input_tokens: 500 }), { input: 0, output: 0, cacheRead: 0, cacheCreate: 500, cacheWrite1h: 0, cacheWrite5m: 500 });
});
test('#5967 RF2: the 1-hour split is read from the largest-write line only', () => {
  let m = mergeUsage(null, { cache_creation_input_tokens: 800, cache_creation: { ephemeral_1h_input_tokens: 300 } });
  m = mergeUsage(m, { cache_creation_input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 100 } });
  assert.equal(m.cacheWrite1h, 300);
  assert.equal(m.cacheWrite5m, 500);
});
test('#5967 RF3: a 1-hour figure above the write is clamped to the write', () => {
  const m = mergeUsage(null, { cache_creation_input_tokens: 50, cache_creation: { ephemeral_1h_input_tokens: 90 } });
  assert.equal(m.cacheWrite1h, 50);
  assert.equal(m.cacheWrite5m, 0);
});
test('#5967 RF5: absent or non-number usage is all zeros and prev is not mutated', () => {
  const zero = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cacheWrite1h: 0, cacheWrite5m: 0 };
  assert.deepEqual(mergeUsage(null, undefined), zero);
  assert.deepEqual(mergeUsage(null, { output_tokens: null }), zero);
  const prev = { ...zero, output: 7 };
  mergeUsage(prev, { output_tokens: 9 });
  assert.equal(prev.output, 7);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/timing/transcript.test.js`
Expected: FAIL — `mergeUsage is not a function`.

- [ ] **Step 3: Implement `mergeUsage` and route readUsage's per-id max through it**

Add `mergeUsage` per the Interfaces block, with a comment stating the rule once (usage grows while a response streams, so neither the first line nor a per-line sum is right; the 1-hour split comes from the largest-write line). In `readUsage`, leave the row literal and every row key as they are. Keep a `Map` id → `UsageMax` beside `firstRowById`: on an id's first assistant line store `mergeUsage(null, u)`; on a repeat, replace the `Math.max` loop with `merged = mergeUsage(stored, u)`, write `merged.input/output/cacheRead/cacheCreate` onto the first row's `inputTokens/outputTokens/cacheRead/cacheCreate`, and zero those four on this row as today. The first line's row values stay assigned exactly as today (`Number(u.x) || 0`, no 0 floor), so a row never changes value. Add one sentence to the readUsage doc comment saying the per-id max is `mergeUsage`'s. Export `mergeUsage`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/timing/transcript.test.js tests/bin-lib/timing/run-timing.test.js tests/bin-lib/timing/at-close.test.js tests/review-replay/no-plugin-reference.test.js tests/pipeline-cost-report/cli.test.js`
Expected: PASS, 0 failures (existing tests unchanged — AC2.1's timing half).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/timing/transcript.js tests/bin-lib/timing/transcript.test.js docs/plugin-structure.md
git commit -m "Add mergeUsage to transcript.js — one per-message.id usage max with the cache-write split"
```

### Task 2: spend.js reads usage through `mergeUsage`

**Role:** integration

**Files:**
- Modify: `tools/pipeline-cost-report/spend.js` (header comment lines 4-10; `scanTranscript` lines ~105-145; `collectSpend` signature line ~220 and its two `scanTranscript` calls ~294, ~312)
- Modify: `tools/pipeline-cost-report.js:109-117` (pass `pluginRoot: PLUGIN_ROOT` — the constant at line 72 — in `collectSpend`'s deps)
- Test: `tests/pipeline-cost-report/spend.test.js` (no edits — must pass unchanged)

**Interfaces:**
- Consumes: `mergeUsage` from Task 1.
- Produces: `scanTranscript(file, { fsImpl = fs, pluginRoot = PLUGIN_ROOT } = {})` and `collectSpend(opts, { fsImpl = fs, pluginRoot = PLUGIN_ROOT } = {})`, `PLUGIN_ROOT = path.join(__dirname, '..', '..', 'plugin')`; `collectSpend` passes `pluginRoot` to both `scanTranscript` calls. Request objects keep every existing field and value.

- [ ] **Step 1: Confirm the absence-check target exists (control)**

Run: `grep -n -F "Math.max(r.output" tools/pipeline-cost-report/spend.js`
Expected: one match (line 138 at plan time: `r.output = Math.max(r.output, num(usage.output_tokens));`).

- [ ] **Step 2: Replace the per-id max block**

In `scanTranscript`, load `const { mergeUsage } = require(path.join(pluginRoot, 'bin', 'lib', 'timing', 'transcript.js'));` and keep a running `UsageMax` on each request entry (`r.usage`, initially `null`). Replace the `r.input … r.cacheWrite1h` lines (the `Math.max` calls and the `if (write > r.cacheWrite)` block) with `r.usage = mergeUsage(r.usage, usage)`, and read `input/output/cacheRead/cacheWrite(=cacheCreate)/cacheWrite1h/cacheWrite5m` from `r.usage` in the post-pass map (drop its own `r.cacheWrite - r.cacheWrite1h`; the returned Request shape is unchanged and does not include `usage`). Delete `num` only if nothing else in the file uses it. Rewrite the header comment's lines 4-10 to say the per-id max and the split are `mergeUsage`'s (plugin/bin/lib/timing/transcript.js), loaded via the `pluginRoot` dep, and drop the "does not call readUsage" sentence.

- [ ] **Step 3: Thread `pluginRoot`** through `collectSpend` and pass `pluginRoot: PLUGIN_ROOT` from `tools/pipeline-cost-report.js`.

- [ ] **Step 4: Run tests and the absence check**

Run: `node --test tests/pipeline-cost-report/` then `grep -n -F "Math.max(r." tools/pipeline-cost-report/spend.js`
Expected: tests PASS with 0 failures (AC2.1, #5914's AC1.1 test included); grep prints nothing and exits 1 (AC1.1, spend half).

- [ ] **Step 5: Commit**

```bash
git add tools/pipeline-cost-report/spend.js tools/pipeline-cost-report.js
git commit -m "Price transcript requests through mergeUsage — drop spend.js's own per-message.id max"
```

### Task 3: score.js reads usage through `mergeUsage`

**Role:** integration

**Files:**
- Modify: `tools/review-replay/score.js` (`transcriptCost` ~lines 70-95 and its comment at line 70; `identifyAgents` signature line 126 and its two `transcriptCost` calls; `score()` ~line 159 where `deps.pluginRoot` is already used)
- Modify: `tests/review-replay/score.test.js:398-405` — the `score requires tiebreak.js through deps.pluginRoot` test only: after its `tiebreak.js` stub write, also `fs.mkdirSync(path.join(stubRoot, 'bin', 'lib', 'timing'), { recursive: true })` and write `bin/lib/timing/transcript.js` holding `module.exports = require(${JSON.stringify(realTranscriptPath)});\n`, where `realTranscriptPath = path.join(__dirname, '..', '..', 'plugin', 'bin', 'lib', 'timing', 'transcript.js')`. No assertion in it or any other test changes (decided by the user at plan review).

**Interfaces:**
- Consumes: `mergeUsage` from Task 1.
- Produces: `transcriptCost(transcriptText, mergeUsage)` and `identifyAgents(fsImpl, dir, started, slots, mergeUsage)`; `score()` loads `mergeUsage` from `path.join(deps.pluginRoot, 'bin', 'lib', 'timing', 'transcript.js')` beside its existing `tiebreak.js` require and passes it down. The returned cost object shape (`{ requests, output, cacheRead, cacheCreate, seconds }`) is unchanged.

- [ ] **Step 1: Confirm the absence-check target exists (control)**

Run: `grep -n -F "Math.max(p.output" tools/review-replay/score.js`
Expected: one match (line 84 at plan time).

- [ ] **Step 2: Replace the per-id max** in `transcriptCost`: keep the existing filter (`e.type === 'assistant' && e.message && e.message.id && e.message.usage`) and set `messages.set(id, mergeUsage(messages.get(id) || null, e.message.usage))`; sum `output`, `cacheRead`, `cacheCreate` from the merged values. Update the line-70 comment to say the per-id max is `mergeUsage`'s.

- [ ] **Step 3: Run tests and the absence check**

Run: `node --test tests/review-replay/` then `grep -n -F "Math.max(p.output" tools/review-replay/score.js`
Expected: tests PASS with 0 failures (AC2.1); grep prints nothing and exits 1 (AC1.1, score half).

- [ ] **Step 4: Commit**

```bash
git add tools/review-replay/score.js tests/review-replay/score.test.js
git commit -m "Score review-replay cost through mergeUsage — drop score.js's own per-message.id max"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (sibling export `mergeUsage` — the per-`message.id` fold with the split; readUsage rows unchanged) | Task 1 |
| Deliverable 2 (spend.js and score.js via a `pluginRoot` dep, own max code removed) | Tasks 2, 3 |
| AC1.1 (absence greps) | Task 2 Step 4, Task 3 Step 3 (controls: Task 2 Step 1, Task 3 Step 1) |
| AC2.1 (existing suites pass unchanged, #5914's AC1 included) | Task 1 Step 4, Task 2 Step 4, Task 3 Step 3 |
