# Run Cost in manifest.json Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a run closes, its `manifest.json` gains tokens by model, a list-price cost, the price date, unpriced models, a partial flag, elapsed minutes and the close time (record #6009).

**Architecture:** The price table moves from `tools/pipeline-cost-report/spend.js` into `plugin/bin/lib/pricing/prices.js`. `readUsage` rows gain `messageId` and the cache-write split; `readDispatches` items keep their kept rows internally; `deriveTiming` returns the per-request rows it read. A pure `deriveRunCost` (`plugin/bin/lib/run-manifest/cost.js`) turns rows (session lanes) or `driver-events.jsonl` step lines (driver lane) into the manifest fields, and `at-close.js` fills them through `fillRunManifest` after its timing write.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T081344-record-6009/work/6009-spec.md`

**Scope keywords:** deriveRunCost, priceRequest, familyOf, fillRunManifest, cacheWrite5m

## Build-time corrections to the spec (logged in decisions.md)

1. **`readUsage` rows do not carry the cache-write split.** After #5967 only `mergeUsage` computes `cacheWrite1h`/`cacheWrite5m`; `readUsage`'s rows carry `cacheCreate` and no `message.id`. Task 2 adds `messageId`, `cacheWrite1h` and `cacheWrite5m` to readUsage's assistant rows (additive). `plugin/bin/lib/timing/transcript.js` is therefore modified, not read-only.
2. **No close event exists in `events.jsonl`.** `closeRunState` (close-run, teardown-run Step 1, archiveRunDir) writes `run-state.json` `status: clean` and its `updatedAt`; nothing appends a close event (only the conditional `close-without-wrapup`). `closedAt` is `runWindow(runDir, events, runState).end` (`run-timing.js`: the later of run-state `updatedAt` — stamped by the close's own write — and the last event ts) as ISO, else `null`. Never `Date.now()`.
3. **Driver step events live in `{run-dir}/driver-events.jsonl`** (`driver/run.js`'s sink), not `events.jsonl`. Lines carrying a `usage` key: the `worker` step (also its `fix: true` and relaunch lines) and the `review` step; `model` sits beside it when the launch resolved one.

## Global Constraints

- `MANIFEST_VERSION` stays `1`; `docs/reference/run-manifest.md` Compatibility: "A field is added, never renamed or retyped. A new field is added to the module, to this page and to `tests/bin-lib/run-manifest/write.test.js` in the same change".
- Every manifest write stays best-effort: nothing throws, a failed write is one `claude-tweaks: run-manifest: …` stderr line (`write.js`'s `drop`), no closing path's exit code or timing changes; the fill runs synchronously inside at-close's existing try/catch and within `TIMING_BOUND_MS` (60 s).
- Every new field is fill-only-null except the cost group's one upgrade (partial or null-cost → complete). A `spec-N` child gets no fill from the close path.
- Dollars are list-price equivalents priced per request with `priceRequest`; an unknown model id is listed in `unpricedModels`, never priced; `costUsd` is `null` (never `0`) when no token source was read; rounded once, to cents, after summing.
- Price by each row's `model`, never a dispatch item's `tier`. Never read `timing.json`'s summed tokens for cost; `timing.json`'s written content is unchanged (internal row fields are stripped by `stripInternalFields`).
- Count each transcript once (dedupe paths by real path via `canonicalRealpath`, rows by `messageId` across files; rows with `messageId: null` are all kept).
- `<synthetic>` lines carry zero usage; a row whose five token fields are all 0 is skipped entirely (no `tokensByModel` key, no `unpricedModels` entry) (transcript-payload-verification skill: "decide which tallies such a line belongs in").
- Governing skill (`.claude/skills/transcript-payload-verification/SKILL.md`), quoted: "That rule has one implementation, `mergeUsage` in `plugin/bin/lib/timing/transcript.js` (#5967): `readUsage`, `context-gauge.js`, the cost report and review replay all fold through it, so a new reader calls it rather than re-deriving the max." — the split and the driver `usage` conversion both go through `mergeUsage`.
- Source-scan lint: no bare `fs.existsSync`/`fs.realpathSync` in new `plugin/bin/` code — use `plugin/bin/lib/path-guard` (`lstatType`, `canonicalRealpath`). New code spawns nothing.
- Other governing skills checked (`timing-procedure-read-counting`, `windows-checkout-test-parity`, `shared-contract-extraction`, `regex-scan-linearity`, `pre-tool-use-gate-exemptions`): none of their rules govern the new fields; `timing-procedure-read-counting`'s `procedureFileRows`/`dispatchFileReads` behaviour must stay unchanged (Task 2 adds a sibling internal field only).
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #6009`, then the `Claude-Session:` trailer.

## Review Focus

1. A run whose transcripts include the same Task-call file twice (own path and a dispatch item) — counted once (Task 3 test "dedupes a transcript reached twice").
2. A driver-lane run with no `driver-events.jsonl` at all — `costUsd: null`, not 0 (Task 3 test "driver lane with no step lines").
3. A second close after a complete cost was stored, while a transcript has since grown — manifest unchanged (Task 4 AC8.4 test, Task 5 AC6.3 test).
4. A fill-created manifest (no mint facts) — `minutes` from the first event, not from the fill's `createdAt` (Task 5 AC8.6 test).
5. The archive twin: the token pass runs after archival moved the run — the fill lands at the dir the timing write used (Task 5 test "fills the archive twin").

---

### Task 1: Move the price table into the plugin

**Role:** transcription

**Files:**
- Create: `plugin/bin/lib/pricing/prices.js`
- Modify: `tools/pipeline-cost-report/spend.js:32-76`
- Test: `tests/bin-lib/pricing/prices.test.js`

**Interfaces:**
- Produces: `module.exports = { PRICES, HAIKU_LONG_PROMPT, HAIKU_LONG_MULTIPLIER, familyOf(modelId) -> 'fable'|'opus'|'sonnet'|'haiku'|'unpriced', priceRequest({ model, input, output, cacheRead, cacheWrite5m, cacheWrite1h }) -> { usd, cacheWriteUsd, prompt, family } }` — bodies and values moved verbatim from `spend.js` (PRICES.date `'2026-11-03'`).

- [ ] **Step 1: Write the failing test** `tests/bin-lib/pricing/prices.test.js`: `test('AC1.1: the price table lives in the plugin, dated 2026-11-03')` asserts `PRICES.date === '2026-11-03'`, `PRICES.families.opus` deep-equals `[4, 20, 0.2, 5, 8]`, `familyOf('claude-sonnet-5-5') === 'sonnet'`, `familyOf('<synthetic>') === 'unpriced'`; a Haiku case: `priceRequest({ model: 'claude-haiku-5', input: 100001, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }).usd` equals `100001 * 0.1 * 5 / 1e6`; and that `require('../../../tools/pipeline-cost-report/spend.js').PRICES === require(prices.js).PRICES` (same object, no copy). AC9.1's test is the existing `tests/pipeline-cost-report/*.test.js` suite, run unedited in Step 4.
- [ ] **Step 2: Run** `node --test tests/bin-lib/pricing/prices.test.js` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** — create `prices.js` with a header comment (moved from spend.js; dollars per million tokens; `[input, output, cache read, 5-minute cache write, 1-hour cache write]`). In `spend.js` delete the `PRICES`, `HAIKU_*`, `familyOf`, `priceRequest` definitions and `require('../../plugin/bin/lib/pricing/prices.js')` for them; keep exporting `PRICES`, `familyOf`, `priceRequest` from spend.js (re-export) so `tools/pipeline-cost-report.js` and `spend.test.js` are untouched.
- [ ] **Step 4: Run** `node --test tests/bin-lib/pricing/prices.test.js tests/pipeline-cost-report/` — Expected: PASS, no edit to any `tests/pipeline-cost-report/*.test.js` (AC9.1). Then `git grep -n "fable: \[" -- tools/` prints nothing and `git grep -n "fable: \[" -- plugin/bin/lib/pricing/prices.js` prints one line (AC1.1).
- [ ] **Step 5: Commit** `Move the price table into the plugin — spend.js requires plugin/bin/lib/pricing/prices.js, refs #6009`.

### Task 2: Expose per-request rows from the timing pass

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/timing/transcript.js` (`readUsage` ~358-400, `scanAgentDir` ~696-716)
- Modify: `plugin/bin/lib/timing/run-timing.js` (`stripInternalFields`, `deriveTiming`)
- Test: `tests/bin-lib/timing/transcript.test.js`, `tests/bin-lib/timing/run-timing.test.js`

**Interfaces:**
- Produces: every `readUsage` row gains `messageId: string|null` (the assistant `message.id`, `null` on user rows and id-less rows), `cacheWrite1h: number`, `cacheWrite5m: number` (from `mergeUsage`; on an id's first row they track the merged max exactly as `cacheCreate` does, later rows of that id are zeroed; user rows 0). Each `readDispatches` item with rows gains internal `usageRows` (its kept rows, the same set `d.tokens` sums), stripped by `stripInternalFields` like `procedureFileRows`. `deriveTiming`'s success result gains `costRows: { rows, transcripts, items }` — `rows` the clipped rows of `transcriptPaths`, `transcripts` the same array as `timing.transcripts`, `items` the pre-strip dispatch items (`[]` when none) — and `costRows: null` when tokens were not wanted or the deadline hit.

- [ ] **Step 1: Write failing tests.** transcript.test.js: `test('readUsage rows carry messageId and the cache-write split')` — a transcript with two lines of one id (second line `cache_creation_input_tokens: 300, cache_creation: { ephemeral_1h_input_tokens: 100 }`) gives first row `messageId === 'm1'`, `cacheCreate 300`, `cacheWrite1h 100`, `cacheWrite5m 200`, second row all three 0; an id-less assistant line gives `messageId: null` and `cacheWrite5m === cacheCreate`. `test('readDispatches items keep their kept rows internally')` — an agent transcript gives `items[0].usageRows.length` equal to its row count inside the window. run-timing.test.js: `test('deriveTiming returns costRows and timing.json stays unchanged')` — `d.costRows.rows.length === d.timing.totals.tokens.rows`, `d.costRows.transcripts === d.timing.transcripts`, and no item in `d.timing.dispatches.items` has a `usageRows` key.
- [ ] **Step 2: Run** `node --test tests/bin-lib/timing/transcript.test.js tests/bin-lib/timing/run-timing.test.js` — Expected: the three new tests FAIL.
- [ ] **Step 3: Implement.** In readUsage set `row.messageId`, initialise each assistant row's split from `mergeUsage(null, u)`, and on a repeated id copy `merged.cacheWrite1h`/`cacheWrite5m` onto `firstRow` and zero them on `row` alongside the four existing fields. In scanAgentDir set `d.usageRows = keptRows`. Add `usageRows` to `stripInternalFields`' destructure. In deriveTiming return `costRows`. Return-shape-widening check: grep `tests/` for whole-row `deepEqual`/`deepStrictEqual` on readUsage rows or dispatch items and update any literal that now lacks the new keys (none found at plan time: transcript.test.js compares row fields, not whole rows); `golden.test.js` must stay green unchanged.
- [ ] **Step 4: Run** `node --test tests/bin-lib/timing/` — Expected: PASS.
- [ ] **Step 5: Commit** `Expose per-request usage rows from the timing pass — messageId and cache-write split on readUsage rows, refs #6009`.

### Task 3: deriveRunCost

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/run-manifest/cost.js`
- Test: `tests/bin-lib/run-manifest/cost.test.js`

**Interfaces:**
- Consumes: Task 1's `PRICES`, `priceRequest`; `mergeUsage` from `plugin/bin/lib/timing/transcript.js`; Task 2's row shape.
- Produces: `deriveRunCost({ rows, sourcesRead, sourcesUnread, events, manifest, closedAt, runStartAt }) -> { tokensByModel, costUsd, priceDate, unpricedModels, costPartial, minutes, closedAt }` and `costRowsFrom(costRows) -> { rows, sourcesRead, sourcesUnread }`.
  - `rows`: readUsage-shaped rows (session lanes). `events`: parsed `driver-events.jsonl` lines (driver lane). `manifest`: the parsed manifest or `null`; lane is `manifest.lane === 'driver'` → driver, else session.
  - Session lane: dedupe rows by `messageId` (first wins; `null` ids all kept); skip rows whose `inputTokens, outputTokens, cacheRead, cacheWrite5m, cacheWrite1h` are all 0; key by `row.model ?? 'unknown'`; `tokensByModel[k] = { input, output, cacheRead, cacheWrite5m, cacheWrite1h }` summed; a row with no split already has `cacheWrite5m === cacheCreate` from mergeUsage. `costPartial = sourcesUnread > 0`; `costUsd = null` when `sourcesRead === 0`.
  - Driver lane: every line with an own `usage` key; `usage` an object → one row via `mergeUsage(null, usage)` keyed `line.model ?? 'unknown'` (launched alias as is); `usage: null` → counts as unread. No such line → `costUsd: null`, all cost fields null.
  - Both: `unpricedModels` = sorted keys whose `familyOf` is `unpriced` (`[]` when none, `null` when costUsd is null); `costUsd = Math.round(sum(priceRequest(row).usd) * 100) / 100` over priced rows; `priceDate = PRICES.date` (null with costUsd null); `costPartial` boolean (null with costUsd null); `tokensByModel` `{}`-or-object (null with costUsd null). `minutes = Math.round((Date.parse(closedAt) - Date.parse(runStartAt)) / 6000) / 10`, `null` when either is missing/unparseable or negative; `closedAt` echoed (null when not a parseable string).
  - `costRowsFrom({ rows, transcripts, items })`: concatenates `rows` and each item's `usageRows` whose `transcriptPath` real path (`canonicalRealpath`, falling back to `path.resolve`) is not one of `transcripts[].path`'s; `sourcesRead` = transcripts with `rows > 0` or no `note` + items with `usageRows`; `sourcesUnread` = transcripts whose `note` starts with `transcript not found` + items whose `notFound` contains `transcript not readable`. `null` input → `{ rows: [], sourcesRead: 0, sourcesUnread: 0 }`.

- [ ] **Step 1: Write failing tests** (expected values computed in the test from `prices.js`'s `priceRequest`, never hard-coded):
  - `AC2.1: two transcripts on opus-5-5 and sonnet-5-5 sum per model and price per request` — rows from a main transcript (`claude-opus-5-5`) and one subagent transcript (`claude-sonnet-5-5`) built by calling the real `readUsage` on fixture files; asserts both keys, summed counts, `costUsd`, `priceDate === PRICES.date`.
  - `AC3.1: an unknown model id is listed and adds nothing`.
  - `AC4.1: no transcript resolved gives costUsd null` (`sourcesRead: 0`); `AC4.2: one readable and one unreadable gives a number and costPartial true`.
  - `AC4.3: a Haiku row over 100k prompt tokens in a subagent transcript takes the long-prompt rate, and a cache write with no split is priced at the 5-minute rate`.
  - `AC5.1: driver lane prices worker step usage keyed by launched model` — two `driver-events.jsonl` lines `{ step: 'worker', model: 'sonnet', usage: {...} }`, `{ step: 'review', model: 'opus', usage: {...} }`; keys `sonnet`, `opus`; a third line with `usage: null` makes `costPartial: true`.
  - `driver lane with no step lines gives costUsd null`; `dedupes a transcript reached twice` (costRowsFrom with an item whose transcriptPath equals a transcripts path, and duplicate messageIds across files); `minutes is elapsed wall-clock to one decimal` (runStartAt 10:00:00Z, closedAt 10:12:30Z → 12.5; missing runStartAt → null); `a synthetic zero-usage row adds no key`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/run-manifest/cost.test.js` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `cost.js` per the Interfaces block (pure; `canonicalRealpath` from `../path-guard`).
- [ ] **Step 4: Run** the test file — Expected: PASS.
- [ ] **Step 5: Real-input probe (scratch, not committed).** Write a scratchpad script that runs `deriveTiming(dir, { transcriptPaths, clipToRunWindow: true, cwd: dir })` with the `transcripts[].path` list from the archived run `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-11-26T051451-record-4337/timing.json`, then `deriveRunCost` over `costRowsFrom(d.costRows)`. Record in the task report: `tokensByModel`, `costUsd`, and the independent count — the number of unique `message.id`s with `"role":"assistant"` in that transcript (a `node -e` over the raw JSONL) — reconciled against the row count kept after dedupe, and `input+output+cacheRead+cacheWrite5m+cacheWrite1h` summed against that `timing.json`'s `totals.tokens` (`input 262, output 57301, cacheRead 24088551, cacheCreate 253638` at plan time; cacheWrite5m+cacheWrite1h must equal cacheCreate). Paste the raw outputs.
- [ ] **Step 6: Commit** `Add deriveRunCost — list-price cost by model from per-request rows or driver step usage, refs #6009`.

### Task 4: fillRunManifest close-out fields

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/run-manifest/write.js`
- Test: `tests/bin-lib/run-manifest/write.test.js`

**Interfaces:**
- Produces: `fillRunManifest(runDir, { closedAt, minutes, cost: { tokensByModel, costUsd, priceDate, unpricedModels, costPartial } }, deps)` — added keys alongside the existing ones; return `{ changed }` lists each written key. Exports add `CLOSE_FIELDS = ['closedAt', 'minutes']`, `COST_GROUP = ['tokensByModel', 'costUsd', 'priceDate', 'unpricedModels', 'costPartial']`.
  - `closedAt` (ISO-8601 string that `Date.parse`s) and `minutes` (finite number ≥ 0) are fill-only-null, each validated like `FILL_VALID`.
  - Cost group validated as a unit (`tokensByModel` object of objects with the five finite ≥0 numbers or null; `costUsd` finite ≥0 or null; `priceDate` string or null; `unpricedModels` string array or null; `costPartial` boolean or null); invalid → ignored. Written when the stored `costUsd` is `null`/absent; replaced when the stored group has `costPartial: true` or `costUsd: null` and the new group has `costPartial: false` and a non-null `costUsd`; otherwise never. Unchanged values write nothing.
  - `blankManifest` and `initRunManifest` unchanged (the mint writes nothing new); `MANIFEST_VERSION` stays `1`.

- [ ] **Step 1: Write failing tests:** `AC8.1: a pre-change nine-field manifest filled at close gains the fields and keeps v 1 and its values` (mint via the real `initRunManifest` with a stubbed `gatherFacts`, then fill); `AC8.2: MANIFEST_VERSION is still 1`; `AC8.3: a stored partial group is replaced by a later complete group`; `AC8.4: a stored complete group is not replaced by a later complete or partial group`; `AC8.5: a stored partial group is not replaced by another partial group`; `closedAt and minutes are fill-only-null`; `an invalid cost group is ignored`; extend the existing key-set pin test so it still pins the nine mint keys exactly.
- [ ] **Step 2: Run** `node --test tests/bin-lib/run-manifest/write.test.js` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** in `write.js` (keep the header comment accurate: name the close-out fill and the one cost-group upgrade).
- [ ] **Step 4: Run** the test file — Expected: PASS.
- [ ] **Step 5: Commit** `Accept close-out fields in fillRunManifest — fill-only-null times, one partial-to-complete cost upgrade, refs #6009`.

### Task 5: Fill the manifest at close

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/timing/at-close.js` (`writeTimingAtClose`, `writePhaseTimingSync`)
- Modify: `plugin/bin/timing-at-close.js` (header comment only: the token pass also fills manifest.json)
- Test: `tests/bin-lib/timing/at-close.test.js`
- Waived `plugin/bin/lib/timing/run-timing.js`: changed in Task 2; this task only calls its exported `runWindow`/`readEvents`.

**Interfaces:**
- Consumes: Task 2's `costRows`, Task 3's `deriveRunCost`/`costRowsFrom`, Task 4's `fillRunManifest`; `runWindow(runDir, events, runState)` and `readEvents(file)` from run-timing.js (`runWindow` must be exported — it already is).
- Produces: internal `fillManifestAtClose(dir, { base, costRows, withCost })` in at-close.js, called once per close after `write()` (or after the `prepare` short-circuit for `not-top-level`: skipped; `kept`: skipped), at the `dir` the timing write returned (the archive twin when it moved).
  - `closedAt`: `runWindow(dir, base.events, base.runState).end` as ISO when finite, else null.
  - `runStartAt`: the manifest's `createdAt` when the mint wrote it (manifest has a non-null `pluginVersion`, `policyHash` or `baseCommit`, or `run-state.json` `createdAt` within 60 000 ms of it); otherwise the earliest `events.jsonl` ts (`base.events`, ignoring `worktree-reaped`), else null.
  - `withCost` true on the token path when `hasTokenTotals(d.timing)`, or always when `manifest.lane === 'driver'` (driver cost reads `{dir}/driver-events.jsonl` via `readEvents`); on the phase-rows-only path (`writePhaseTimingSync`, or a token path with no token totals and a non-driver lane) only `closedAt` and `minutes` are passed.
  - Every throw inside it is caught: one stderr line via the manifest module's drop rule; the timing result and SKIP lines are unchanged.

- [ ] **Step 1: Write failing tests** (use `tests/helpers/close-timing.js`'s `writeEvents`/`writeTranscript`, the real `initRunManifest` for the mint, the real `closeRunState` to stamp `run-state.json` so `updatedAt` is the writer's):
  - `AC6.1: after a token-total timing write the manifest has v 1, non-null costUsd, tokensByModel, minutes, closedAt, and every pre-existing field's value unchanged`.
  - `AC6.2: closedAt is the close's run-state stamp, not the test's clock` (fix `updatedAt` by writing run-state through the real writer, then mock `Date.now` forward before calling `writeTimingAtClose`).
  - `AC6.3: closing again changes nothing in the manifest` (bytes equal after a second call).
  - `AC7.1: a spec-N child gets no fill, and a fill into a non-object manifest leaves it untouched with one stderr line`.
  - `AC8.6: a fill-created manifest takes minutes from the first event, and minutes null with no events`.
  - `fills the archive twin when the run dir moved`; `phase-rows-only write fills closedAt and minutes only`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/timing/at-close.test.js` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** `fillManifestAtClose` and its two call sites.
- [ ] **Step 4: Run** `node --test tests/bin-lib/timing/ tests/bin-lib/run-manifest/ tests/bin-lib/hooks/close-run-state.test.js tests/hooks-teardown-run.test.js tests/bin-lib/reconcile/archive-merged.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `Fill the run manifest's cost and minutes at close — token pass prices, phase-only writes times, refs #6009`.

### Task 6: Document the added fields

**Role:** integration

**Files:**
- Modify: `docs/reference/run-manifest.md`
- Modify: `docs/plugin-structure.md` (lines 76 and 89: the `run-manifest/` line names cost.js; the `timing/` line notes readUsage's `messageId`/split and `costRows`; add a `plugin/bin/lib/pricing/` line)

**Interfaces:**
- Consumes: Tasks 1-5's names and rules.

- [ ] **Step 1: Write** in run-manifest.md: the intro and "Nine fields" become run-start facts plus close-out fields, still `v: 1`; a field-table row each for `tokensByModel`, `costUsd`, `priceDate`, `unpricedModels`, `costPartial`, `minutes`, `closedAt` (types/meanings from the spec's Data / API Surface, `closedAt` defined per correction 2); a writer-table row "Close path — `fillManifestAtClose` in `plugin/bin/lib/timing/at-close.js` (close-run, teardown-run, archiveRunDir's phase write, the detached token pass)"; rules: `null` never `0`, `costPartial`, the one partial-to-complete upgrade, price date, list-price equivalents priced per request, the 5-minute rate for a row with no cache-write split, the driver lane priced from `driver-events.jsonl` step `usage` (one request per step line), session lanes from transcript rows; update the Example and the first paragraph's file list (`cost.js`, `pricing/prices.js`).

Proof(public-contract): the reader contract in `docs/reference/run-manifest.md` gains the seven fields at `v: 1` with no field renamed or retyped, and `write.test.js`'s nine-key mint pin plus the AC8.1 fill test prove a pre-change manifest keeps every existing key and value.
- [ ] **Step 2: Verify** `node --test tests/bin-lib/run-manifest/ tests/docs-*.test.js` — Expected: PASS (doc conformance suites, if any match, stay green).
- [ ] **Step 3: Commit** `Document the run manifest's close-out fields — cost, minutes and closedAt at v 1, refs #6009`.
