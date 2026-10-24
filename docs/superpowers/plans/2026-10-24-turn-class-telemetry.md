# Turn-Class Telemetry and Efficiency Budgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each run's `timing.json` records where its turns went (turn classes, context per turn, model mix, subagents). Per-ceremony-profile budgets checked at wrap-up stage a Review Console finding on breach. A `tools/` report gives weekly medians across the archive.

**Architecture:** A pure classifier (`bin/lib/timing/turn-class.js`) labels every tool call. `readUsage` attaches the labels and per-turn context sizes to its rows. `joinTokens` aggregates them per phase, and `phase-timing.js` writes them into `timing.json` and renders two summary lines. A pure budget evaluator (`bin/lib/timing/budget.js`) runs behind a new `phase-timing.js --check-budgets` flag. It reads six flat integer policy keys and, on breach, stages a Queue-writes record proposal (`efficiency-budget-{run-id}`) through `writeStagedItem`. A standalone `tools/efficiency-report.js` aggregates archived `timing.json` files.

**Tech Stack:** Node 18+ CommonJS, `node --test`, zero runtime deps.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T193455-record-4029/work/4029-spec.md` (record #4029)

Scope keywords: phase-timing, joinTokens, readUsage, efficiency-budget

Premise-refs: plugin/bin/lib/timing/transcript.js, plugin/bin/lib/timing/derive.js, plugin/bin/lib/console/resolve.js, plugin/bin/lib/policy-schema.js, plugin/bin/verify.js

## Global Constraints

- Zero runtime npm deps; CommonJS `'use strict'`; Node 18+ (CI runs Node 20).
- Every change to `timing.json` is additive. No existing key changes meaning or disappears.
- New policy keys are flat kebab-case and use the `-ceiling` suffix (`_shared/policy-key-naming.md`). Each `summary` is 140 chars or fewer and is never duplicated into `policy-schema.md`. Each key's `tier` is `advanced` and its `category` is `housekeeping`.
- A breach never blocks or fails a run. The check exits 0 in every derivable case, matching `phase-timing.js`'s existing exit contract.
- Staged ids must classify into an existing Review Console section (`stage-item`'s unmapped-prefix refusal, #3946).
- Commit messages: `{Verb} {what} — {detail}`, ending with `refs #4029` and the `Claude-Session:` trailer. Never `closes`/`fixes`.

## Review Focus

1. **Orphan tool_result** (its `tool_use_id` never appeared, e.g. a transcript cut mid-turn): it is counted as class `other`, never dropped. The class counts always sum to the number of tool_result blocks. Task 2 pins it.
2. **Parallel calls in one user row:** each call is counted separately, so the class total may exceed `toolRoundTrips`. Task 3's fixture has one such row and asserts calls 11 against round trips 10.
3. **No transcript data:** the round-trip and procedure budgets report `unmeasured`, never `ok`. Verify minutes is still evaluated from events. Task 5 pins it.
4. **`config.yml` with no `ceremony-profile`:** the run is checked against `standard`, and the result carries `profileSource: 'fallback'` plus a note. It is never skipped silently. Task 5 pins it.
5. **Archive with a nested `spec-N/timing.json` and a malformed `timing.json`:** the report reads only `{archive}/{run-id}/timing.json`, skips the malformed file, and counts it in `skipped`. Task 7 pins it.
6. **`--check-budgets` re-run on the same run:** it overwrites `staged/efficiency-budget-{run-id}.md` in place (a plain id, no `--allocate`) and never adds a second staged file. Task 5 pins it.

---

### Task 1: Turn-class classifier

**Files:**
- Create: `plugin/bin/lib/timing/turn-class.js`
- Test: `tests/bin-lib/timing/turn-class.test.js`

**Interfaces:**
- Consumes: `isProcedurePath(filePath, worktree)` from `plugin/bin/lib/timing/transcript.js`. Move it into `turn-class.js` and re-export it from `transcript.js`, so `transcript.js` can require `turn-class.js` without a require cycle.
- Produces:
  - `TURN_CLASSES` (frozen, in this order): `['edit','read','explore','procedure','bookkeeping','orientation','verify','guard-refusal','dispatch','other']`
  - `CEREMONY_CLASSES` (frozen): `['procedure','bookkeeping','orientation','guard-refusal']`
  - `classifyToolCall({ name, input, isError, resultText, worktree }) -> string` (one of `TURN_CLASSES`)
  - `classifyBash(command) -> string`
  - `isProcedurePath` (moved)

**Rules (first match wins):**
1. `isError === true` and `resultText` matches `GUARD_REFUSAL_RE` → `guard-refusal`. The regex alternates `This session is isolated in the worktree`, `PreToolUse:\S+ hook error`, and `Permission to use \S+.*has been denied`. These are the three top refusal texts observed in this machine's transcripts. A plain `Exit code 1` error is not a refusal and classifies by tool as normal.
2. `Edit`/`Write`/`MultiEdit`/`NotebookEdit` → `edit`.
3. `Read` → `procedure` when `isProcedurePath(input.file_path, worktree)`, else `read`.
4. `Skill` → `procedure`.
5. `Grep`/`Glob`/`LS` → `explore`.
6. `Agent`/`Task` → `dispatch`. `SendMessage` falls through to `other`, because it resumes an agent rather than spawning one.
7. `ToolSearch` → `orientation`. `TodoWrite` → `bookkeeping`.
8. `Bash` → `classifyBash(input.command)`.
9. Anything else, including a missing name → `other`.

**`classifyBash`:** strip leading `cd … &&` segments and leading `VAR=value ` assignments, then test in this order:
- **verify:** `npm (run )?test`, `node --test`, `tools/run-tests.js`, `verify.js`, `npx … --test`, `tsc`, `eslint`, `jest`, `vitest`, `pytest`.
- **bookkeeping:** a `node` call whose script path contains `/plugins/cache/` or `CLAUDE_PLUGIN_ROOT`; a head of `gh`; or a git subcommand among `add`/`commit`/`push`/`pull`/`fetch`/`merge`/`tag`/`rebase`/`cherry-pick`/`reset`/`checkout`/`switch`/`stash`, or `worktree add|remove`. Parse git as `git` plus an optional `-C <path>` (quoted or bare) plus the subcommand.
- **orientation:** head `pwd`/`whoami`/`hostname`/`date`/`printenv`/`env`/`which`/`echo`; or git `status`/`rev-parse`/`branch` (without `-d`/`-D`/`-m`)/`worktree list`/`remote`/`config`.
- **explore:** head `grep`/`rg`/`ugrep`/`find`/`ls`/`cat`/`head`/`tail`/`sed`/`awk`/`wc`/`tree`/`jq`/`stat`/`file`/`diff`; or git `log`/`show`/`diff`/`grep`/`blame`/`ls-files`/`ls-tree`/`cat-file`/`ls-remote`.
- **otherwise** `other`.

- [ ] **Step 1: Write the failing test**

Write a table-driven test, `test('turn-class: classifyToolCall maps each tool to its class', …)`, with one row per rule above, plus these:

| Input | Expected |
|---|---|
| `Bash` `cd "/r w" && git -C "/r w" commit -m x` | `bookkeeping` |
| `Bash` `git -C /r status` | `orientation` |
| `Bash` `git log --oneline -3` | `explore` |
| `Bash` `FOO=1 npm test > out.txt 2>&1` | `verify` |
| `Bash` `node "/u/.claude/plugins/cache/m/claude-tweaks/6.145.0/bin/verify.js" --run x` | `verify` (verify beats bookkeeping) |
| `Bash` `node "/u/.claude/plugins/cache/m/claude-tweaks/6.145.0/bin/log-decision.js" --run x` | `bookkeeping` |
| `Bash` `node scratch.js` | `other` |
| `Bash` `git branch -D x` | `bookkeeping` |
| `Read` `/repo/plugin/skills/build/SKILL.md` with worktree `/repo` | `procedure` |
| `Read` `/repo/src/a.js` | `read` |
| `Bash` isError with resultText `This session is isolated in the worktree /r, but …` | `guard-refusal` |
| `Write` isError with `Permission to use Write has been denied because …` | `guard-refusal` |
| `Bash` isError with `PreToolUse:Bash hook error: claude-tweaks: …` | `guard-refusal` |
| `Bash` `grep x` isError with `Exit code 1` | `explore` |
| `SendMessage` | `other` |
| missing name | `other` |

Also add `test('turn-class: TURN_CLASSES order and CEREMONY_CLASSES subset', …)`. It asserts deepStrictEqual on both arrays and that every ceremony class is in `TURN_CLASSES`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/timing/turn-class.test.js`
Expected: FAIL with `Cannot find module`

- [ ] **Step 3: Implement `turn-class.js`, and move `isProcedurePath` into it (re-exported unchanged from `transcript.js`)**

- [ ] **Step 4: Run the new test and the existing transcript tests**

Run: `node --test tests/bin-lib/timing/turn-class.test.js tests/bin-lib/timing/transcript.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `Add turn-class classifier for transcript tool calls — ten classes, guard refusals by result text`

### Task 2: `readUsage` emits turn classes and per-turn context

**Files:**
- Modify: `plugin/bin/lib/timing/transcript.js` (`readUsage`)
- Create: `tests/fixtures/timing/turn-classes/events.jsonl`, `tests/fixtures/timing/turn-classes/session.jsonl` — exactly to Task 3's "Fixture (hand count)" spec, which Task 3 reuses. Rendering rules referenced there: `{k}` = `(tokens/1000).toFixed(1)` and `{pct}` = `Math.round(ceremonyShare*100)`.
- Test: `tests/bin-lib/timing/transcript.test.js`. The exact-shape `assert.deepEqual(assistants[0], {…})` near line 177 widens with the three new fields. This is the plan-authoring return-shape-widening hit; no other test deep-equals a usage row (grep `deepEqual(assistants` / `deepEqual(users`).

**Interfaces:**
- Consumes: `classifyToolCall` (Task 1).
- Produces three new fields on every row, all present on every row:
  - `turnClasses: { [class]: count }`. Sparse; `{}` on assistant rows. On a user row it counts that row's tool_result blocks by class.
  - `turnStart: boolean`. `true` on the first assistant row of each `message.id`, and on any assistant row without a string id. `false` otherwise, including all user rows.
  - `contextTokens: number`. On `turnStart` rows: `inputTokens + cacheRead + cacheCreate`, computed after streaming ends so it reflects the per-id max. `0` elsewhere.

Approach: keep a `Map` from tool_use id to `{ name, input }`, filled from assistant rows. On each tool_result block, look up its `tool_use_id`. An unknown id is classified with `name: undefined`, which yields `other`. `resultText` is the block's string content, or its joined `text` parts. Pass `worktree` through.

- [ ] **Step 1: Write the failing test** — `test('#4029 AC1.1: readUsage tags each tool_result with its turn class and marks turn starts', …)`. Use the Task 3 fixture transcript and assert:
  - the summed `turnClasses` across rows deepEqual the hand count in Task 3;
  - the `turnStart` row count is 10;
  - `contextTokens` on the turn-start rows, in order, is `[1010, 2020, …, 10100]`.

  Add `test('#4029: an orphan tool_result counts as other', …)`. It uses an inline temp transcript holding one user tool_result with an unknown id and expects `{ other: 1 }`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/timing/transcript.test.js`. Expected: FAIL (the new fields are undefined).
- [ ] **Step 3: Implement** in `readUsage`, and widen the existing exact-shape assertion.
- [ ] **Step 4: Run** the same command. Expected: PASS
- [ ] **Step 5: Commit** — `Tag transcript rows with turn classes and per-turn context — readUsage feeds #4029's aggregation`

### Task 3: Aggregate per phase into `timing.json` and render it

**Files:**
- Uses: `tests/fixtures/timing/turn-classes/events.jsonl` and `session.jsonl`, created in Task 2 to the fixture spec below
- Modify: `plugin/bin/lib/timing/derive.js` — `joinTokens`, plus `totals.verifyMinutes` in `derivePhases`
- Modify: `plugin/bin/phase-timing.js` — the `timing.totals` copy and the render
- Modify: `tests/fixtures/timing/subagents-golden-auto.md` — regenerate from the CLI; the diff must show only the two new lines
- Modify: `tests/fixtures/timing/subagents-golden-plain.md` — same
- Modify: `plugin/skills/_shared/timing-render.md` — about +600 B on 4,072 B, far under the 52,500 B rail
- Test: `tests/bin-lib/timing/derive.test.js`, `tests/bin-lib/timing/cli.test.js`

**Interfaces:**
- Consumes: Task 2's row fields.
- Produces:
  - Every `joinTokens` bucket (each phase, `unattributed`, `totals`) gains these fields:
    - `turnClasses`: all ten keys, zero-filled.
    - `context: { turns, p50, p90 }`. Nearest-rank percentiles over the bucket's `turnStart` rows' `contextTokens` (`sorted[ceil(q*n)-1]`); `p50`/`p90` are `null` when `turns` is 0.
    - `modelMix: { [model]: turns }`, counted over `turnStart` rows, with a `null` model keyed as `unknown`.
    - `subagents`: equal to `turnClasses.dispatch`.
    - `ceremonyShare`: the summed `CEREMONY_CLASSES` divided by all calls, rounded to 3 dp; `null` when there are 0 calls.
  - `derivePhases` totals gain `verifyMinutes`: the sum of every verify event's `durationMs`, divided by 60000 and rounded to 1 dp.
  - `timing.json` `totals` gains `turnClasses`, `context`, `modelMix`, `subagents` and `ceremonyShare` (only when a transcript was requested, like `tokens`). `verifyMinutes` is always present.
  - The markdown renders two lines after the `Tokens (in/out) sum …` footnote, inside the existing `if (guard)` block, in exactly this form:
    - `Turn classes (tool calls): edit {n} · read {n} · explore {n} · procedure {n} · bookkeeping {n} · orientation {n} · verify {n} · guard-refusal {n} · dispatch {n} · other {n} — ceremony share {pct}%`. Here `{pct}` is `ceremonyShare*100` with 0 dp, or `—` when null.
    - `Context per turn: p50 {k}k · p90 {k}k tokens over {turns} turns · models: {model} ×{n}[, …] · subagents: {n}`. Here `{k}` is tokens/1000 with 1 dp, or `—`; models are sorted by count descending, then by name.

**Fixture (hand count, the AC1.1 oracle):**
- **events.jsonl:**
  - `skill_invoked claude-tweaks:flow` at `2026-10-24T10:00:00Z`
  - `skill_invoked claude-tweaks:build` at `10:01:00Z`
  - `verify` at `10:20:00Z`, `mode: full`, `durationMs: 120000`, `pass: true`
  - `session-end` at `10:30:00Z`
- **session.jsonl:** ten assistant turns, `m1`…`m10`, at `10:02`…`10:11`. Turn *k* has usage `input_tokens: k*10`, `cache_read_input_tokens: k*1000`, `cache_creation_input_tokens: 0`, `output_tokens: 5`. `m3` uses model `claude-sonnet-5`; every other turn uses `claude-opus-5-5`. One extra line repeats `m1`'s id with the same usage, so the dedupe is exercised. Each turn's tool_use is followed by a user tool_result row at +5 s:

| Turn | Tool calls | Class |
|---|---|---|
| m1 | `Read /repo/plugin/skills/build/SKILL.md` | procedure |
| m2 | `Bash pwd` and `Bash git -C /repo status`, both in one user row | orientation ×2 |
| m3 | `Edit /repo/src/a.js` | edit |
| m4 | `Bash node "/u/.claude/plugins/cache/m/claude-tweaks/6.145.0/bin/log-decision.js" --run x` | bookkeeping |
| m5 | `Bash git -C /repo commit -m x`, with `is_error` and the text `This session is isolated in the worktree /repo …` | guard-refusal |
| m6 | `Agent` | dispatch |
| m7 | `Grep` | explore |
| m8 | `Bash npm test` | verify |
| m9 | `Read /repo/src/a.js` | read |
| m10 | `AskUserQuestion` | other |

**Hand count:** `{ edit:1, read:1, explore:1, procedure:1, bookkeeping:1, orientation:2, verify:1, 'guard-refusal':1, dispatch:1, other:1 }`. That is 11 calls over 10 round trips, a ceremony share of 0.455, context `{ turns: 10, p50: 5050, p90: 9090 }`, modelMix `{ 'claude-opus-5-5': 9, 'claude-sonnet-5': 1 }`, subagents 1, and verifyMinutes 2. Every row falls inside `build` (10:01 to 10:20).

- [ ] **Step 1: Write the failing tests**
  - In `derive.test.js`: `test('#4029: joinTokens aggregates turn classes, context percentiles, model mix and ceremony share per phase', …)` builds the rows inline and asserts the hand-count numbers on `build` and `totals`; `test('#4029: an empty bucket has zero-filled classes and null percentiles', …)`.
  - In `cli.test.js`: `test('#4029 AC1.1: timing.json for the turn-classes fixture carries the class breakdown matching the hand count', …)` runs `phase-timing.js --run {tmp copy of fixture dir} --transcript {session.jsonl}` and deepEquals `timing.totals.turnClasses` and the build phase's `turnClasses` against the hand count. It also asserts `totals.toolRoundTrips === 10`, `totals.context`, `totals.ceremonyShare === 0.455` and `totals.verifyMinutes === 2`. A second assertion in the same test checks that `--markdown` stdout contains both lines exactly: `Turn classes (tool calls): edit 1 · read 1 · explore 1 · procedure 1 · bookkeeping 1 · orientation 2 · verify 1 · guard-refusal 1 · dispatch 1 · other 1 — ceremony share 46%` and `Context per turn: p50 5.0k · p90 9.1k tokens over 10 turns · models: claude-opus-5-5 ×9, claude-sonnet-5 ×1 · subagents: 1`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/timing/derive.test.js tests/bin-lib/timing/cli.test.js`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement.** Finalize each bucket so the internal context samples never reach the output. Then regenerate both goldens. Then add one paragraph to `timing-render.md`'s Phase table section saying the two lines render verbatim after the footnote, that per-phase values live in `timing.json`, that the class total counts tool calls (which can exceed Tool RTs when calls are batched), and what the ceremony share is.
- [ ] **Step 4: Run** `node --test tests/bin-lib/timing/ tests/timing-prose-conformance.test.js`. Expected: PASS
- [ ] **Step 5: Real-input probe.** Run `node plugin/bin/phase-timing.js --run "{an archived run dir}" --json --transcript "{its archived session transcript if present, else this session's own transcript}"` against a real recorded input. Do an independent count of the same transcript's `tool_result` blocks with a node one-off that never uses `readUsage`, and reconcile it with `sum(totals.turnClasses)`. Record both numbers in the ledger as an `observation` row.
- [ ] **Step 6: Commit** — `Aggregate turn classes, context percentiles and model mix per phase — timing.json and the Timing render gain #4029's breakdown`

### Task 4: Efficiency-budget policy keys

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` — six `POLICY_KEYS` rows after `frontier-run-cap`'s neighbourhood, in their own commented block
- Modify: `plugin/bin/lib/policy.js` — the new reader
- Modify: `plugin/skills/_shared/policy-schema.md` — it is 47,136 B against a 52,500 B rail. Add only a key-list stub section, `## Efficiency budgets` (about 500 B, leaving about 4.8 KB of headroom), plus one mapping row `| Efficiency budgets | \`housekeeping\` |` under `## Metadata fields`.
- Create: `plugin/skills/_shared/policy-schema-efficiency-budgets.md`, holding the full five-column table, following the `policy-schema-model-profiles.md` split precedent.
- Test: `tests/policy-schema.test.js` (or the nearest existing reader test file), `tests/policy-key-naming.test.js` and `tests/policy-schema-metadata.test.js`. The last two should pass unchanged, since they pick up the new rows automatically.

**Interfaces:**
- Produces:
  - **Keys** (`type: 'integer'`, `min: 0`; `0` disables that budget):

    | Key | Default |
    |---|---|
    | `fast-lane-run-round-trip-ceiling` | `420` |
    | `fast-lane-run-procedure-kb-ceiling` | `560` |
    | `fast-lane-run-verify-minutes-ceiling` | `21` |
    | `standard-run-round-trip-ceiling` | `900` |
    | `standard-run-procedure-kb-ceiling` | `580` |
    | `standard-run-verify-minutes-ceiling` | `37` |

    These defaults are the p90 of the 143 archived runs on 2026-10-24, rounded up: fast-lane round trips 412, procedure 557.5 KB, verify 20.1 min; standard 897, 576.3 KB, 36.1 min. The implementer cites that derivation in the split file's prose.
  - **Reader:** `readEfficiencyCeilings(repoRoot, profile) -> { roundTrips, procedureKb, verifyMinutes }` in `policy.js`, via `resolveValue(...)` for each `{profile}-run-…-ceiling`. A profile other than `fast-lane` or `standard` throws a `TypeError`.

- [ ] **Step 1: Write the failing test** — `test('#4029: readEfficiencyCeilings resolves defaults, a policy override, and an invalid value back to default', …)`. Use a temp repo root with `.claude-tweaks/policy.yml` holding `fast-lane-run-round-trip-ceiling: 5` and `standard-run-verify-minutes-ceiling: abc`. Expect fast-lane `{ roundTrips: 5, procedureKb: 560, verifyMinutes: 21 }` and standard `{ roundTrips: 900, procedureKb: 580, verifyMinutes: 37 }`. An unknown profile throws.
- [ ] **Step 2: Run** the test. Expected: FAIL (`readEfficiencyCeilings is not a function`).
- [ ] **Step 3: Implement** the six rows, the reader, the split doc and the stub.
- [ ] **Step 4: Run** `node --test tests/policy-schema.test.js tests/policy-key-naming.test.js tests/policy-schema-metadata.test.js tests/policy.test.js tests/resolve-policy-cli.test.js`. Expected: PASS
- [ ] **Step 5: Commit** — `Add per-ceremony-profile efficiency budget keys — six -ceiling integers defaulted from the archive p90`

### Task 5: Budget check behind `phase-timing.js --check-budgets`

**Files:**
- Create: `plugin/bin/lib/timing/budget.js`
- Modify: `plugin/bin/phase-timing.js` — the flag, the USAGE string, the header comment, and the `timing.json` `budget` key
- Modify: `plugin/bin/lib/console/resolve.js` — add the `efficiency-budget` alternative to the Queue-writes `SECTION_MAP` row (line 82), and `'efficiency-budget-'` to `CANONICAL_PREFIXES`. These are the only two sites the review-console-section-addition skill requires when a prefix joins an existing section.
- Test: `tests/bin-lib/timing/budget.test.js`, `tests/bin-lib/timing/cli.test.js`, and `tests/bin-lib/console/resolve.test.js`, which needs one case in its hand-typed "maps every known prefix" table.

**Interfaces:**
- Consumes: `readEfficiencyCeilings` (Task 4); `timing.totals.toolRoundTrips`, `procedureBytes` and `verifyMinutes` (Task 3); `writeStagedItem` from `plugin/bin/lib/stage-item/write.js`, using the same call shape as `verify.js:1084`; `appendEntry`, `formatEntry` and `resolveDecisionTarget` (copy `verify.js`'s imports exactly); `specShapedBody` and `recordPayload` from `plugin/bin/lib/issues/record.js`; `parseFlatLines` from `policy-schema.js`.
- Produces:
  - `evaluateBudgets({ totals, ceilings }) -> checks[]`. Each check is `{ metric, value, ceiling, status }`. `metric` is one of `round-trips`, `procedure-kb` or `verify-minutes`. `status` is:
    - `disabled` when the ceiling is 0;
    - `unmeasured` when the value is not a finite number (no transcript data);
    - `breach` when the value exceeds the ceiling;
    - otherwise `ok`.

    `procedure-kb` is `procedureBytes/1024`, rounded to 1 dp.
  - `formatBudgetLine(profile, checks) -> string`, e.g. `Budget (fast-lane): round-trips 10/5 BREACH · procedure-kb 0.1/560 ok · verify-minutes 2/21 ok`.
  - `budgetProposal({ runId, profile, checks, totals }) -> string`. This is the staged file text: `Title: Efficiency budget breached on run {runId} ({profile})`, `Type: task`, `Labels: {payload labels, or none}`, `Defer-reason: needs-human-decision`, a blank line, then the `specShapedBody` body. The body's Current State lists each breached metric's value against its ceiling, plus the run's top three turn classes by count. Its Deliverables are investigating where the turns went and reducing them, or raising the ceiling in `policy.yml` with a rationale. Its Acceptance Criteria say the next run of the same profile checks within budget, or the ceiling change lands with its derivation. Its Release Note is `No user-visible change.` and `filedBy` is `phase-timing.js --check-budgets`.
  - CLI: with `--check-budgets`:
    1. Read `{runDir}/config.yml`'s `ceremony-profile`. If it is absent or invalid, use `standard`, set `profileSource: 'fallback'`, and emit the note `budget: ceremony-profile absent from config.yml — checked against standard`.
    2. Derive `repoRoot` as the parent of the nearest `.claude-tweaks` path segment of the real path of `runDir`. If none exists, write `timing.json`'s `budget` as `{ skipped: 'no .claude-tweaks ancestor' }` and print the same line to stderr.
    3. Write `timing.json` `budget: { profile, profileSource, checks, staged }`.
    4. Print `formatBudgetLine` on stdout. Under `--markdown`, put it after everything else.
    5. On any breach, stage the item with `writeStagedItem({ runDir, id: 'efficiency-budget-' + basename(runDir), sourcePath: 'proposal.md', content })`, and log `STAGED … — Efficiency budget breached ({profile}): {metrics}. Stage path: staged/efficiency-budget-{runId}.md.` through `appendEntry`.
    6. A staging failure prints to stderr and never changes the exit code (0).

- [ ] **Step 1: Write the failing tests**
  - `budget.test.js`: `test('#4029: evaluateBudgets classifies ok/breach/unmeasured/disabled', …)`, plus `budgetProposal` assertions for its `Title:` line, its `Defer-reason: needs-human-decision` line, and that it carries `## Release Note`.
  - `cli.test.js`: `test('#4029 AC2.1: a budget-breach fixture produces a staged item', …)`. It builds a temp tree `{root}/.claude-tweaks/policy.yml` (`fast-lane-run-round-trip-ceiling: 5`) and `{root}/.claude-tweaks/pipelines/{id}/` (the Task 3 fixture files plus `config.yml` `ceremony-profile: fast-lane`), then runs with `--transcript … --check-budgets`. It asserts that `staged/efficiency-budget-{id}.md` exists and starts with `Title: Efficiency budget breached on run {id} (fast-lane)`, that `decisions.md` holds a `STAGED` line naming that stage path, that `timing.json.budget.checks` shows `round-trips` as `breach`, and that the exit code is 0. A re-run leaves exactly one `staged/efficiency-budget-*` file (Review Focus 6).
  - Two further `cli.test.js` tests:
    - `test('#4029: no transcript leaves round-trip and procedure budgets unmeasured', …)` (Review Focus 3).
    - `test('#4029: a config.yml without ceremony-profile falls back to standard with a note', …)` (Review Focus 4).
  - `resolve.test.js`: a new row `['efficiency-budget-2026-10-24T193455-record-4029.md', 'Queue writes']` in the known-prefix table.
- [ ] **Step 2: Run** `node --test tests/bin-lib/timing/budget.test.js tests/bin-lib/timing/cli.test.js tests/bin-lib/console/resolve.test.js`. Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** the same command, plus `node --test tests/bin-lib/stage-item/`. Expected: PASS
- [ ] **Step 5: Commit** — `Check efficiency budgets at phase-timing time — a breach stages an efficiency-budget Queue write`

### Task 6: Wire the check into wrap-up

**Files:**
- Modify: `plugin/skills/wrap-up/SKILL.md` — it is 39,809 B; this adds about 700 B, leaving about 12 KB under the rail. Add a `### Efficiency budget (#4029)` subsection to Phase 3 SETTLE, after "Leftover work" and before "Nothing left behind", so the staged item exists before Phase 4's Review Console reads `staged/`.
- Modify: `docs/plugin-structure.md` — the `phase-timing.js` CLI line gains `--check-budgets`
- Modify: `docs/hooks.md` — only if it restates `phase-timing.js`'s flags (check with `grep -n "phase-timing" docs/hooks.md`)
- Test: `tests/wrap-up-efficiency-budget-conformance.test.js` (new).

**Text to add (in the wrap-up voice):** "Run `node "${CLAUDE_PLUGIN_ROOT}/bin/phase-timing.js" --run "$PIPELINE_RUN_DIR" --auto-transcript --check-budgets` once. A breach stages `staged/efficiency-budget-{run-id}.md` with its own `STAGED` line, and the Review Console's Queue writes section files it as a backlog record. It never blocks. With no run dir, or a non-zero exit, write one `SKIP` line per `_shared/auto-decision-log.md`'s degrade-trace rule and continue."

- [ ] **Step 1: Write the failing test** — `test('#4029: wrap-up Phase 3 runs the efficiency budget check before the Review Console', …)`. It asserts that the subsection exists, that the literal `--check-budgets` command appears, and that the subsection's index lies between `### Leftover work` and `## Phase 4`. It factors this into one `assertWired(text)` function and adds a go-red control that calls `assertWired` on the text with the subsection removed, expecting a throw.
- [ ] **Step 2: Run** `node --test tests/wrap-up-efficiency-budget-conformance.test.js`. Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** the same test, plus `node --test tests/bin-lib/skill-audit/`. Expected: PASS
- [ ] **Step 5: Commit** — `Run the efficiency budget check in wrap-up's settle phase — breaches reach the Review Console`

### Task 7: Cross-run efficiency report

**Files:**
- Create: `tools/efficiency-report.js`
- Test: `tests/efficiency-report.test.js`, plus fixtures under `tests/fixtures/efficiency-report/archive/`
- Modify: `docs/plugin-structure.md` (list the tool and its command)

**Interfaces:**
- Produces:
  - CLI: `node tools/efficiency-report.js [--archive <dir>] [--json]`. The default `--archive` is `{dirname(git rev-parse --git-common-dir)}/.claude-tweaks/pipelines/archive`, resolved with an absolute git-common-dir. Exit codes: 0 when rendered; 1 when the archive is missing or unreadable; 2 for a malformed invocation.
  - Seam: `run({ argv, deps }) -> exitCode`, with `deps` holding `{ fs, git, log, err }`, following the shape of `tools/test-impact.js`.
  - `collectRuns(archiveDir, fs) -> { runs, skipped }`. It reads only `{archiveDir}/{entry}/timing.json`; a missing file is no run, and a malformed one counts in `skipped`. Each run is:

    ```
    { runId, week, profile, minutes, roundTrips, procedureKb, verifyMinutes, ceremonyShare }
    ```

    - `week` is the ISO-8601 week (`YYYY-Www`) of the run-id's leading `YYYY-MM-DD`, falling back to `generatedAt`.
    - `profile` comes from the sibling `config.yml`'s `ceremony-profile`, or is `null`.
    - `verifyMinutes` is `totals.verifyMinutes`, else the sum of `phases[].verify[].durationMs`.
    - Any field that is absent or non-numeric is `null`.
  - `median(values)`: over numeric values only; the mean of the two middle values when the count is even; `null` when there are none.
  - `summarize(runs) -> { overall, byProfile, byWeek }`. Each group holds `{ runs, medians: { minutes, roundTrips, procedureKb, verifyMinutes, ceremonyShare } }`.
  - Markdown output:
    - the headline: `runs: {n} ({m} with round-trip data, {s} skipped) · median minutes {x} · median round trips {y} · median procedure KB {z} · median verify minutes {v}`
    - a `| Profile | Runs | Minutes | Round trips | Proc. KB | Verify min | Ceremony share |` table
    - a `| Week | Runs | … |` table, sorted ascending

- [ ] **Step 1: Write the failing tests**
  - `test('#4029: efficiency report computes medians, ISO weeks and per-profile groups over a fixture archive', …)`. The fixture has four runs over two weeks and two profiles, plus one `spec-9/timing.json` nested inside a run, which must not be read. One run has malformed JSON (expect `skipped: 1`), and one has no `toolRoundTrips` (expect "3 with round-trip data"). Assert exact medians, including one even-count mean.
  - `test('#4029: missing archive exits 1', …)`.
- [ ] **Step 2: Run** `node --test tests/efficiency-report.test.js`. Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** the same test. Expected: PASS
- [ ] **Step 5: AC3.1 real-archive probe** — `test('#4029 AC3.1 …')` is waived as an automated test, because the archive is machine-local, gitignored state that CI never has. Instead, run `node tools/efficiency-report.js --archive "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive"` once and confirm the headline reads `median minutes 79 · median round trips 407`. The authoring-time independent probe over the same archive printed `count 143 withTokens 137 / median minutes 79 / median rt 407`. Record the printed headline in the ledger as an `observation` row and in the PR body.
- [ ] **Step 6: Commit** — `Add tools/efficiency-report.js — weekly and per-profile medians over archived timing.json`

Waived AC3.1: as an automated test — the archive is machine-local gitignored state. Verified instead by Task 7 Step 5's recorded live run against the real archive.

## Scope sweep (plan audit Check B, `add-to-plan`)

The `phase-timing` keyword also matches the files below. Each was reviewed and needs no change in this plan. Every skill that invokes `phase-timing.js --markdown` renders its stdout verbatim, so the two new lines arrive without a prose edit. The journeys and `docs/REGISTRY.md` are /build Common Steps 6/6.5's job. `CHANGELOG.md` is release-please's.

- Reviewed: `plugin/skills/_shared/pr-run-comments.md`, `plugin/skills/dispatch/reporting.md`, `plugin/skills/flow/multispec-run-dir-layout.md`, `plugin/skills/flow/multispec-summary.md`, `plugin/skills/flow/summary-template.md`, `plugin/skills/test/verification.md`, `plugin/skills/wrap-up/summary-template.md`, `plugin/skills/wrap-up/verification-brief.md`, `docs/reference/dispatch-cost-baseline.md`, `docs/skill-graph.md`, `tests/path-guard-conformance.test.js`, `tests/timing-prose-conformance.test.js` (run in Task 3 Step 4), `docs/journeys/attribute-agent-cost-to-dispatches-3375.md`, `docs/journeys/read-where-a-pipeline-run-spent-its-minutes-1928.md`, `docs/journeys/see-which-phase-spent-the-tokens-1929.md`, `docs/REGISTRY.md`, `CHANGELOG.md`

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1: turn classes, context per turn p50/p90, model mix, subagent count | 1, 2, 3 |
| Deliverable 2: per-profile budgets in policy, checked at wrap-up, breach stages a finding | 4, 5, 6 |
| Deliverable 3: `tools/` cross-run weekly report | 7 |
| AC1.1 | Task 3 (cli test, hand count), Task 2 |
| AC2.1 | Task 5 (cli test) |
| AC3.1 | Task 7 Step 5 (live probe; automated test waived) |
