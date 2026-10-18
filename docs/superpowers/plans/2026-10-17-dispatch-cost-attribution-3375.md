# Per-Dispatch Cost Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `phase-timing.js` attributes model tier, role, wall-clock span and deduped token usage to each subagent dispatch, read after the fact from `{sessionId}/subagents/`, and adds a `dispatches` key to `timing.json` plus a Dispatches table to the `--markdown` output.

**Architecture:** `transcript.js` reads (enumerate `subagents/`, pair `agent-*.jsonl` with `.meta.json`, stream each through the existing deduping `readUsage`). `derive.js` judges (tier resolution, role patterns, aggregation by tier and by role). `phase-timing.js` wires both into the transcript-requested path only and renders. Everything is additive: the no-transcript path is byte-identical.

**Tech Stack:** Node 18+, CommonJS, `node --test`, injectable `fsImpl` seams (the `transcript.js` pattern).

**Spec:** `.claude-tweaks/pipelines/2026-10-17T144508-spec-3375-3380/spec-3375/work/3375-spec.md`

**Scope keywords:** `subagents/`, `readUsage`, `unionMinutes`, `phase-timing.js`

## Global Constraints

- Never read cost from the `SubagentStop` hook; `plugin/bin/lib/hooks/subagent-stop.js` is unchanged (AC9).
- No pricing or dollar values. Tokens, tier and wall-clock only.
- Existing `timing.json` keys and the existing phase table's numbers and columns are unchanged. `dispatches` is the only new key.
- Tier order: meta `model` when it is a `PROFILES` alias (`haiku`→fast, `sonnet`→standard, `opus`→capable, `fable`→frontier). Otherwise the transcript's `message.model` via `^claude-(haiku|sonnet|opus|fable)`. Otherwise `unmapped`, carrying the raw name. Never coerced.
- `profiles.js` is read-only. It does **not** export `profileOfModel`, so resolve aliases by looking up `PROFILES[key].model`.
- Closed role set: `implementer`, `task review`, `re-review`, `whole-branch review`, `plan review`, `lens reviewer`, `unlabelled`. There is no `other`.
- Time columns: `agent-seconds` is the sum of per-dispatch spans with overlap not removed. `elapsed` is the union of spans in minutes via `unionMinutes`. Neither is compared to the phase table's minutes, and the two tables are never summed into a grand total.
- A missing value is printed as `not found`/`null`, never guessed or zero-filled.
- Commit style: `{Verb} {what} — {detail} (refs #3375)`, with the `Claude-Session:` trailer. Use `refs`, never `closes`.

## Review Focus

1. **Synthetic model ids.** A dispatch transcript whose first assistant line carries `"model":"<synthetic>"` before real `claude-sonnet-…` lines should resolve from the real id, not go `unmapped`. Pinned in Task 1 (`transcriptModel` prefers the first `^claude-` id).
2. **Malformed meta.** A `.meta.json` that is not valid JSON should degrade that dispatch to an orphan (description null, role `unlabelled`) instead of throwing and losing the whole table. Pinned in Task 1.
3. **Same session passed twice.** `--transcript X --transcript X`, or `--auto-transcript` plus the same explicit path, must not double-count dispatches. Subagents dirs are deduped by resolved path. Pinned in Task 3.
4. **Dispatch killed before replying.** A transcript with user lines only should report tokens 0 and its span from user-line timestamps, with tier from meta. If neither meta nor transcript names a model, tier is `unmapped` with raw `null`. Pinned in Task 2.
5. **Dispatch straddling the run window.** Rows before the first event are dropped from tokens and span, and a dispatch entirely outside the window is excluded and counted (`excludedOutsideWindow`). It is never silently kept. Pinned in Task 1.

---

## File Map

- Modify `plugin/bin/lib/timing/transcript.js`: `readUsage` rows gain `model`; new `subagentsDirFor`, `readDispatches`; header comment updated (the `{sessionId}/` dir is now read).
- Modify `plugin/bin/lib/timing/derive.js`: export `unionMinutes`; new `resolveTier`, `ROLE_PATTERNS`, `roleOf`, `aggregateDispatches`.
- Modify `plugin/bin/phase-timing.js`: `dispatches` key, `renderDispatches`, not-found lines.
- Create `tests/fixtures/timing/subagents-session/` (committed three-dispatch fixture).
- Create `tests/fixtures/timing/dispatch-descriptions.json` (role fixture).
- Modify `tests/bin-lib/timing/transcript.test.js`, `derive.test.js`, `cli.test.js`, `tests/timing-prose-conformance.test.js`.
- Modify `plugin/skills/wrap-up/summary-template.md` (18,556 B), `plugin/skills/flow/summary-template.md` (10,462 B), `plugin/skills/flow/multispec-summary.md` (4,466 B). Byte-pin check: no file-specific or per-skill pin in `tests/` for any of the three, and none is a `compose-context.js` source, so only the shared 51,200 B ceiling binds. Each gets about 500 B, leaving at least 32 KB of headroom.
- Create `docs/reference/dispatch-cost-baseline.md`.

---

### Task 1: Enumerate subagent dispatches in `transcript.js`

**Files:**
- Modify: `plugin/bin/lib/timing/transcript.js`
- Create: `tests/fixtures/timing/subagents-session/sess-1.jsonl`, `tests/fixtures/timing/subagents-session/sess-1/subagents/agent-a1.jsonl`, `agent-a1.meta.json`, `agent-a2.jsonl`, `agent-a2.meta.json`, `agent-a3.jsonl`, `agent-a3.meta.json`
- Test: `tests/bin-lib/timing/transcript.test.js`

**Interfaces:**
- Produces:
  - `readUsage` rows gain `model: string|null` (the assistant line's `message.model`; `null` on user lines). Existing fields are unchanged.
  - `subagentsDirFor(mainTranscriptPath: string) -> string` returns `path.join(mainTranscriptPath minus '.jsonl', 'subagents')`.
  - `readDispatches(subagentsDir: string, { fsImpl = fs, window = null }: { window?: { start: number, end: number } | null }) -> Promise<{ items: Dispatch[], notFound: string|null, excludedOutsideWindow: number }>`
  - `Dispatch = { agentId, description, agentType, metaModel, transcriptModel, parentAgentId, spawnDepth, startTs, endTs, wallClockMs, tokens: { input, output, cacheRead, cacheCreate }, notFound }`
    - Every meta field is `null` when absent.
    - `notFound` is `null`, `'transcript not readable (CODE)'` (meta present, `.jsonl` unreadable: `startTs`/`endTs`/`wallClockMs`/`tokens` are `null`), or `'meta not found'` (orphan transcript: numbers present, meta fields `null`).
    - The missing-`subagents/` case returns `{ items: [], notFound: 'no subagents/ directory at {dir}', excludedOutsideWindow: 0 }`.
    - `transcriptModel` is the first assistant row whose `model` matches `/^claude-/`, else the first non-null `model`, else `null`.
    - Items are sorted by `startTs` (nulls last), then `agentId`.

**Fixture** (committed). Lines use the shape of the existing `cli.test.js` inline lines, plus `"agentId"` and `"message":{"id":…,"model":…}`.
- `agent-a1`: meta `{"agentType":"general-purpose","description":"Implement Task 1: parser","toolUseId":"toolu_1","spawnDepth":1,"model":"sonnet"}`. Lines:
  - user at 10:00:00Z.
  - Two assistant lines at 10:00:05Z, both `id m1`, model `claude-sonnet-5-5`, usage in 10 / out 20 / cacheRead 100 / cacheCreate 5.
  - One assistant line at 10:01:05Z, `id m2`, usage 3/4/0/0.
- `agent-a2`: meta model `sonnet`, description `Review Task 1 (spec + quality)`. Lines: user at 10:02:00Z, assistant at 10:02:30Z `id m3`, usage 7/8/50/0.
- `agent-a3`: meta model `opus`, description `Final whole-branch review #3386`. Lines: user at 10:05:00Z, then two assistant lines at 10:07:00Z, both `id m4`, model `claude-opus-5-5`, usage 20/30/0/10.
- All dates are 2026-10-17. `sess-1.jsonl` holds one assistant line at 09:59:00Z (main session, never counted as a dispatch).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/timing/transcript.test.js`
  - `test('AC1.1: readDispatches returns one record per agent with model, description and wall-clock span', …)`: 3 items. a1 `{metaModel:'sonnet', description:'Implement Task 1: parser', wallClockMs:65000, startTs:'2026-10-17T10:00:00.000Z'}`, a2 `wallClockMs:30000`, a3 `wallClockMs:120000, transcriptModel:'claude-opus-5-5'`.
  - `test('AC1.1: token totals count each message.id once', …)`: a1 `tokens` deepEqual `{input:13,output:24,cacheRead:100,cacheCreate:5}`; a3 `{input:20,output:30,cacheRead:0,cacheCreate:10}`.
  - `test('#3375: subagentsDirFor strips .jsonl and appends subagents/', …)`: `subagentsDirFor('/h/p/sess-1.jsonl') === path.join('/h/p/sess-1','subagents')`.
  - `test('AC4.1: a meta file whose transcript is unreadable yields notFound and null numbers', …)`: tmp dir with `agent-x.meta.json` only. The item has `notFound` matching `/^transcript not readable \(ENOENT\)$/`, and `tokens`, `wallClockMs` and `startTs` are each `null`.
  - `test('AC4.1: no subagents/ directory reports notFound, no items', …)`: `notFound` matches `/^no subagents\/ directory at /`, `items` is `[]`.
  - `test('AC4.1: a transcript with no meta file is an orphan — description null, numbers present', …)`: `description === null`, `notFound === 'meta not found'`, `typeof wallClockMs === 'number'`.
  - `test('#3375 review focus 2: malformed meta JSON degrades to an orphan, never throws', …)`
  - `test('#3375 review focus 1: transcriptModel prefers the first claude- id over <synthetic>', …)`
  - `test('#3375 review focus 5: window drops out-of-window rows and excludes dispatches entirely outside it', …)`: `window` = 10:02:00Z–10:10:00Z over the committed fixture. Expect 2 items (a2, a3), `excludedOutsideWindow === 1`.
  - `test('#3375: readUsage rows carry model on assistant lines and null on user lines', …)` using the existing `TFIX`.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/timing/transcript.test.js`
  Expected: FAIL. `readDispatches is not a function`; the model assertion fails because `undefined !== null`.

- [ ] **Step 3: Implement** `subagentsDirFor` and `readDispatches(subagentsDir, { fsImpl, window })` in `plugin/bin/lib/timing/transcript.js`.
  - Add `model` to `readUsage` rows.
  - List `agent-*.jsonl` / `agent-*.meta.json` with `fsImpl.readdirSync` and pair them by `agentId`. Read each transcript through `readUsage` (its `message.id` dedupe is the one to reuse; do not re-derive it).
  - The span comes from first to last row `ts` after window clipping.
  - Update the file header: the `{sessionId}/subagents/` directory is now read here, its layout was observed on 2026-10-17 (not a documented contract), and a drifted layout must degrade to the not-found path. The same "re-derive, do not loosen the test" rule as the slug applies.

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/bin-lib/timing/transcript.test.js`
  Expected: PASS, all tests.

- [ ] **Step 5: Prove discrimination.** Temporarily delete the `seenMsgIds` zeroing in `readUsage`, re-run, and confirm the AC1.1 token test goes red (a1 input becomes 23). Restore it and confirm green.

- [ ] **Step 6: Commit**
```bash
git add plugin/bin/lib/timing/transcript.js tests/bin-lib/timing/transcript.test.js tests/fixtures/timing/subagents-session
git commit -m "Enumerate subagent dispatches from the session's subagents/ directory — per-dispatch span and deduped tokens (refs #3375)"
```

### Task 2: Tier, role and aggregation in `derive.js`

**Files:**
- Modify: `plugin/bin/lib/timing/derive.js`
- Create: `tests/fixtures/timing/dispatch-descriptions.json`
- Test: `tests/bin-lib/timing/derive.test.js`

**Interfaces:**
- Consumes: `Dispatch` from Task 1.
- Produces:
  - `unionMinutes(spans: {start:number,end:number}[]) -> number`: newly exported, body unchanged.
  - `resolveTier({ metaModel, transcriptModel }) -> { tier: 'fast'|'standard'|'capable'|'frontier'|'unmapped', rawModel: string|null }`. `rawModel` is the value the tier came from; on `unmapped` it is the transcript model, else the meta model, else `null`.
  - `ROLE_PATTERNS: ReadonlyArray<{ role: string, re: RegExp }>`, ordered, first match wins:
    1. `re-review`: `/^re-review\b/i`
    2. `whole-branch review`: `/\bwhole-branch review\b/i`
    3. `plan review`: `/\bplan review\b/i`
    4. `task review`: `/^review task \d+/i`
    5. `lens reviewer`: `/^review lens\b/i`
    6. `implementer`: `/^implement\b/i`
  - `roleOf(description: string|null) -> role` (`unlabelled` when nothing matches, or when the description is null).
  - `aggregateDispatches(items: Dispatch[]) -> { items: (Dispatch & { tier, rawModel, role })[], byTier: { [tier]: Bucket }, byRole: { [role]: Bucket } }`
    - `Bucket = { dispatches, agentSeconds, elapsedMinutes, tokens: { input, output, cacheRead, cacheCreate } }`. On the `unmapped` tier only, also `rawModels: string[]` (sorted, unique, `null` shown as `'null'`).
    - Items with `notFound` set to a transcript-not-readable reason stay in `items` but count in no bucket. Orphans (`'meta not found'`) do count.
    - `agentSeconds` is the sum of `wallClockMs / 1000`, rounded to an integer. `elapsedMinutes` is `unionMinutes` over the bucket's `{start,end}` spans.

- [ ] **Step 1: Write the fixture** `dispatch-descriptions.json` as `[{ "description", "role", "source": "captured"|"synthetic" }]`.
  - Every captured string comes from session `d8cf036e` on 2026-10-17:
    - `Implement Task 2: Ruling carry-forward`, `Implement Task 1: re-pin manifest`, `Implement manifest-init (#3035)` → implementer
    - `Review Task 1 (spec + quality)`, `Review Task 2 (spec + quality)` → task review
    - `Re-review Task 1 fix round 1`, `Re-review final fix wave #3386`, `Re-review #3376 final fix wave` → re-review
    - `Whole-branch review for #3376`, `Final whole-branch review #3386` → whole-branch review
    - `Review lens 3c error handling`, `Review lens 3b security` → lens reviewer
    - `Red-team D as Skeptical Reviewer`, `Simplify #3386 own-work files`, `Fix wave for #3376 final review`, `Final-review fix wave #3386`, `Judge Skills curation row`, `Builder check on design doc`, `Specify Steps 3-9 for #3229 design` → unlabelled
  - Synthetic, because no plan-review dispatch has been captured yet: `Plan review for #3375` → plan review, and `Zork the frobnicator` → unlabelled.

- [ ] **Step 2: Write the failing tests** in `derive.test.js`
  - `test('AC2.1: tier aggregation reports standard 2 and capable 1 for the three-dispatch fixture', …)`: build Dispatch objects matching Task 1's fixture inline. `byTier.standard.dispatches === 2`, `byTier.capable.dispatches === 1`.
  - `test('AC2.2: inherit and absent meta models resolve through the transcript model', …)`: `resolveTier({metaModel:'inherit', transcriptModel:'claude-opus-5-5'}).tier === 'capable'`, and the same for `metaModel:null`.
  - `test('AC2.2: claude-opus-5-5 maps to capable', …)`
  - `test('AC2.3: a model matching no family reports unmapped with its raw name', …)`: `resolveTier({metaModel:'inherit', transcriptModel:'gpt-x'})` deepEquals `{tier:'unmapped', rawModel:'gpt-x'}`. `aggregateDispatches` puts `'gpt-x'` in `byTier.unmapped.rawModels`.
  - `test('AC6.1: overlapping spans — agent-seconds is the sum of spans', …)`: two items, 10:00:00–10:02:00 and 10:01:00–10:03:00. `byTier.standard.agentSeconds === 240`.
  - `test('AC6.1: overlapping spans — elapsed is their union', …)`: `elapsedMinutes === 3`.
  - `test('AC7.1: every captured description classifies to its intended role', …)` over the fixture.
  - `test('AC7.1: an unknown string classifies as unlabelled', …)`: `roleOf('Zork the frobnicator')` and `roleOf(null)` both return `'unlabelled'`.
  - `test('#3375 review focus 4: a dispatch with no assistant rows and no model anywhere is unmapped with raw null', …)`
  - `test('#3375: a transcript-not-readable item stays in items but counts in no bucket', …)`

- [ ] **Step 3: Run to verify they fail**
  Run: `node --test tests/bin-lib/timing/derive.test.js`
  Expected: FAIL, `resolveTier is not a function`.

- [ ] **Step 4: Implement** `resolveTier`, `ROLE_PATTERNS`, `roleOf` and `aggregateDispatches` in `derive.js`, and add `unionMinutes` to `module.exports`. Require `PROFILES` from `../model-profiles/profiles`, and derive the alias map from `PROFILES` (do not hardcode it). Add one comment above `ROLE_PATTERNS`: patterns come from captured descriptions, SDD-composed ones are best-effort, and growth in `unlabelled` is the drift signal.

- [ ] **Step 5: Run to verify pass**
  Run: `node --test tests/bin-lib/timing/derive.test.js`
  Expected: PASS.

- [ ] **Step 6: Prove discrimination.** Swap the order of `re-review` and `task review` in `ROLE_PATTERNS`, re-run, and confirm AC7.1 goes red on `Re-review Task 1 fix round 1`. Restore it.

- [ ] **Step 7: Commit**
```bash
git add plugin/bin/lib/timing/derive.js tests/bin-lib/timing/derive.test.js tests/fixtures/timing/dispatch-descriptions.json
git commit -m "Aggregate dispatches by tier and role — alias-then-transcript tier resolution, ordered description patterns (refs #3375)"
```

### Task 3: Wire `dispatches` into `phase-timing.js`

**Files:**
- Modify: `plugin/bin/phase-timing.js`
- Test: `tests/bin-lib/timing/cli.test.js`

**Interfaces:**
- Consumes: `subagentsDirFor` and `readDispatches` (Task 1); `aggregateDispatches` (Task 2).
- Produces:
  - `timing.json` gains `dispatches`, in one of two shapes:
    - `{ scope: 'run-window'|'whole-session', items, byTier, byRole, excludedOutsideWindow }`
    - `{ notFound: '<reason>' }` when no resolved transcript has a `subagents/` directory. `<reason>` joins every directory's reason with `; `.
  - The key is written only when `wantTokens`.
  - `renderDispatches(dispatches) -> string`, exported.

**Rendering** (printed after everything `renderMarkdown` prints: after the Guard footer in the table path, after the summary lines in the collapsed path).
- In the not-found case, exactly one line: `dispatches: subagent transcripts not found ({reason})`.
- Otherwise:
```
Dispatches ({run window | whole session — no run events}; agent-seconds sum spans with overlap kept, elapsed is their union — not comparable to phase minutes):
| Tier | Dispatches | Agent-seconds | Elapsed (min) | Tokens (in/out) | Cache (read/create) |
|---|---|---|---|---|---|
| {tier}{ (raw: a, b) on unmapped} | {n} | {s} | {m} | {in}/{out} | {read}/{create} |
| Role | Dispatches | Agent-seconds | Elapsed (min) | Tokens (in/out) | Cache (read/create) |
|---|---|---|---|---|---|
| {role} | … |
```
- The table is preceded by a blank line.
- Rows appear in fixed order: tiers `fast, standard, capable, frontier, unmapped`, then the `ROLE_PATTERNS` roles followed by `unlabelled`. Zero-count rows are omitted.
- After the tables, one line per not-found item: `dispatch {agentId}: transcript not found ({code})` or `dispatch {agentId}: meta not found (description null)`. When `excludedOutsideWindow > 0`, also print `dispatches: {n} outside the run window excluded`.
- `scope` is `run-window` when `events.jsonl` has at least one event. The window runs from the earliest to the latest event `ts`, passed as `window` to `readDispatches`.
- Subagents dirs are deduped by `path.resolve`.

- [ ] **Step 0: Capture goldens from the pre-change CLI.** Do this before touching `phase-timing.js`, with the Task 1 fixture session copied under a tmp `HOME` at the slug of `worktree` (as the existing auto-transcript test does) and `events.jsonl`/`manifest.yml` taken from `record-1535`. Save two files:
  - `tests/fixtures/timing/subagents-session/golden-auto.md`: stdout of `--run {dir} --markdown --auto-transcript`.
  - `tests/fixtures/timing/subagents-session/golden-plain.md`: stdout of `--run {dir} --markdown` (no transcript).

  Both are written by the CLI, never by hand. Commit them with this task.
- [ ] **Step 1: Write the failing tests** in `cli.test.js`, using the same tmp-`HOME` setup as Step 0.
  - `test('AC3.1: with --auto-transcript the phase table is byte-identical to before, followed by the dispatch table', …)`: the output `startsWith` the contents of `golden-auto.md`, and the next text is `\nDispatches (`. Assert the `| standard | 2 |` and `| capable | 1 |` rows.
  - `test('AC3.2: with no transcript flag, the whole output and timing.json are byte-identical to before', …)`: stdout equals `golden-plain.md` exactly, and the written `timing.json` has no `dispatches` key. The existing `#1929: without any --transcript…` test stays green unchanged.
  - `test('AC4: a not-found dispatch prints a not-found line and no numeric row for it', …)`: add `agent-x.meta.json` with no transcript to the tmp fixture. Assert `/^dispatch agent-x: transcript not found \(ENOENT\)$/m`, and that `standard` still reads `2`.
  - `test('AC5.1: a transcript-requested run with no subagent data gains exactly one new key, dispatches, with the not-found reason', …)`: diff `Object.keys` of the new `timing.json` against the key set from the same run under the `#1929` behavior (`runDir, generatedAt, phases, totals, unattributed, transcripts`, plus `notes` when present). The only extra key is `dispatches`, and `dispatches.notFound` matches `/^no subagents\/ directory at /`.
  - `test('AC5.2: no existing timing.json key changes', …)`: `totals.tokens` equals the value the existing `#1929 AC4` test asserts for the same inputs.
  - `test('#3375 review focus 3: the same transcript passed twice does not double-count dispatches', …)`: `--transcript P --transcript P` still gives `| standard | 2 |`.
  - `test('#3375: the collapsed no-phase-events path still appends the dispatch table', …)`

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/timing/cli.test.js`
  Expected: FAIL. The new tests fail on missing `Dispatches (`; every pre-existing test still PASSES.

- [ ] **Step 3: Implement.** In `main()`, inside `wantTokens` only, run `readDispatches` → `aggregateDispatches` and set `timing.dispatches`. Add `renderDispatches` and append its output to the stdout of the `--markdown` branch. Update the file header's usage paragraph with one sentence on `dispatches`.

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/bin-lib/timing/`
  Expected: PASS, all three files.

- [ ] **Step 5: Prove discrimination.** Move the dispatch-key write outside the `wantTokens` guard, re-run, and confirm AC3.2/AC5 go red. Restore it.

- [ ] **Step 6: Real-input probe and independent count**, both against session `d8cf036e`:
  - Probe: `node plugin/bin/phase-timing.js --run "{scratch copy of archive/2026-10-17T111000-spec-3376-3386}" --markdown --transcript "$HOME/.claude/projects/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-record-3229/d8cf036e-f1d7-46e4-9af8-9757d070e668.jsonl"`. Copy the archived dir to scratch first, because the CLI writes `timing.json` into `--run`.
  - Independent count, via a separate `node -e` over the raw files that does not import the timing modules:
    1. The number of `agent-*.jsonl` files (47 expected).
    2. For one named agent, the sum of usage over unique `message.id`s.
  - Reconcile both against the printed tables. Record the exact printed tier counts and the reconciliation in this task's report and in the commit body.

- [ ] **Step 7: Commit**
```bash
git add plugin/bin/phase-timing.js tests/bin-lib/timing/cli.test.js tests/fixtures/timing/subagents-session/golden-auto.md tests/fixtures/timing/subagents-session/golden-plain.md
git commit -m "Print a per-dispatch tier and role table from phase-timing.js — additive dispatches key, not-found lines, window clipping (refs #3375)"
```

### Task 4: Document the Dispatches table in the three Timing templates

**Files:**
- Modify: `plugin/skills/wrap-up/summary-template.md:102-112`, `plugin/skills/flow/summary-template.md:33-43`, `plugin/skills/flow/multispec-summary.md:29-39`
- Test: `tests/timing-prose-conformance.test.js`

**Interfaces:**
- Consumes: the rendered shape from Task 3.

- [ ] **Step 1: Write the failing test** `test('AC10.1: every Timing template documents the Dispatches table and its not-found line', …)`, iterating the three files and asserting each:
  - matches `/\| Tier \| Dispatches \| Agent-seconds \| Elapsed \(min\) \| Tokens \(in\/out\) \| Cache \(read\/create\) \|/`
  - matches `/dispatches: subagent transcripts not found/`
  - matches `/not comparable to phase minutes|never summed with the phase table/`

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/timing-prose-conformance.test.js`
  Expected: FAIL on the first file.

- [ ] **Step 3: Edit each template's Timing section**, after its `Guard denials:` line:
  - Add one paragraph saying the CLI appends a Dispatches table under `--auto-transcript`/`--transcript`, rendered verbatim. Cover tier vs role, agent-seconds vs elapsed, the not-found line rendered verbatim, `unmapped` rows carrying raw names, and that it is never summed with the phase table's main-session tokens.
  - Add the two table header skeletons.
  - Use identical wording in all three files (the multi-spec copy passes `$MULTISPEC_PARENT_DIR`; keep its existing command).

- [ ] **Step 4: Run to verify pass, and byte check**
  Run: `node --test tests/timing-prose-conformance.test.js && wc -c plugin/skills/wrap-up/summary-template.md plugin/skills/flow/summary-template.md plugin/skills/flow/multispec-summary.md`
  Expected: PASS, and each file stays under 51,200 B (expected about 19.1k / 11.0k / 5.0k).

- [ ] **Step 5: Commit**
```bash
git add plugin/skills/wrap-up/summary-template.md plugin/skills/flow/summary-template.md plugin/skills/flow/multispec-summary.md tests/timing-prose-conformance.test.js
git commit -m "Document the Dispatches table in the three Timing templates — tier and role tables, not-found line (refs #3375)"
```

### Task 5: Record the pre-change baseline

**Files:**
- Create: `docs/reference/dispatch-cost-baseline.md`

**Interfaces:**
- Consumes: the finished CLI (Tasks 1-3).

- [ ] **Step 1: Find a qualifying run.** All four criteria must hold:
  1. Plan task count ≥ 4 per `node plugin/bin/plan-audit.js {plan} --count-tasks` (field `tasks`).
  2. SDD per-task dispatch (the subagents dir carries `Implement Task N` / `Review Task N` descriptions).
  3. `ceremony-profile: standard` in the run's `config.yml`.
  4. A single session whose main transcript and `subagents/` still exist.

  Already checked at plan time:
  - `archive/2026-10-17T111000-spec-3376-3386` has 2-task plans (fails criterion 1).
  - `2026-10-17T100123-spec-3368-3365`: the #3365 plan has 3 tasks and #3368 has 1 (fails).

  Still to check:
  - `2026-10-17T062549-spec-3307-3308-3306-3309-3310-3311` (84 dispatches; its plans are on `origin/worktree-skill-size-limits-3230`, read them with `git show`).
  - `2026-10-17T110950-record-3316` (35 dispatches; its plan is on `origin/worktree-flow-record-3316`).

  Both are live sibling runs. **Never** pass their run dir as `--run`: copy `events.jsonl`, `manifest.yml`, `run-state.json` and `config.yml` into a scratch dir and run against that. Also confirm single-session: every `sessionId` in the run's `events.jsonl` must equal `run-state.json`'s.

- [ ] **Step 2: Run the CLI** against the qualifier: `node plugin/bin/phase-timing.js --run {scratch} --markdown --transcript {main transcript}`. Paste the output verbatim; never retype it.

- [ ] **Step 3: Write the file.** Record:
  - the exact command
  - the transcript sources enumerated (main path plus subagents dir and its count)
  - the policy and model stance (`model-stance`, the `ceremony-profile` from `config.yml`)
  - the plugin version (`plugin/.claude-plugin/plugin.json` on the branch that ran, plus the installed version that ran it)
  - the per-tier and per-role tables
  - the completeness statement (single session; any dispatches outside the window, or not-found)
  - the comparability rule: a later run is compared only under the same `model-stance` and tier policy, a task count within ±50% of this run's, and SDD per-task dispatch.

  If no run qualifies, write the file with the checks made and their results, no table, and report `DONE_WITH_CONCERNS`.

- [ ] **Step 4: Verify**
  Run: `test -f docs/reference/dispatch-cost-baseline.md && grep -c "^| " docs/reference/dispatch-cost-baseline.md`
  Expected: AC8.1 is satisfied either by a nonzero table-row count, or by the recorded-absence wording with no table.

- [ ] **Step 5: Final checks**
  Run: `git diff --stat origin/main -- plugin/bin/lib/hooks/subagent-stop.js`
  Expected: empty output (AC9.1).
  Run: `npm test > "{your scratchpad}/npm-test-3375.txt" 2>&1; echo exit=$?`
  Expected: `exit=0` (AC10.1). The full suite runs centrally after this task as well.

- [ ] **Step 6: Commit**
```bash
git add docs/reference/dispatch-cost-baseline.md
git commit -m "Record the pre-change dispatch cost baseline — per-tier and per-role tables from the new CLI (refs #3375)"
```

## AC coverage map

| AC clause | Task / test |
|---|---|
| AC1.1 | Task 1 `AC1.1` tests |
| AC2.1-AC2.3 | Task 2 |
| AC3.1, AC3.2 | Task 3 |
| AC4.1 | Task 1 (reader: unreadable transcript, no subagents/ dir, orphan) + Task 3 `AC4` (render) |
| AC5.1, AC5.2 | Task 3 |
| AC6.1 | Task 2 (sum and union, two tests) |
| AC7.1 | Task 2 (captured fixture + unknown string) |
| AC8.1 | Task 5 Step 4 |
| AC8.2 | Task 5 Step 3 (no-qualifier branch: absence recorded with checks, no table, DONE_WITH_CONCERNS) |
| AC8.3 | Task 5 Step 2 (CLI output pasted verbatim, never retyped) |
| AC9.1 | Task 5 Step 5 |
| AC10.1 | Task 5 Step 5 + Task 4 Step 4 byte check + central full suite |

## Revised during build

- The spec's Current State premise ("repeats a turn's cumulative usage on every content-block line") does not hold for subagent transcripts. A subagent turn opens with a streaming snapshot (`stop_reason: null`, a tiny `output_tokens`) and closes with the final count under the same `message.id`; only `output_tokens` differs between the lines (input and cache fields are equal). Main transcripts show no differing ids. Keeping the first line's usage undercounted subagent output tokens roughly 8-9x on the baseline session.
- `readUsage` now takes the max of each usage field per `message.id`, carries it on the first row for that id (phase attribution still uses the first row's timestamp), and zeroes later lines. Main-transcript totals are unchanged (the #1929 tests and the AC3/AC5 goldens stay byte-identical).
