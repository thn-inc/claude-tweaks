# Workflow Agents in timing.json Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count agents started by a workflow script (`{session}/subagents/workflows/{runId}/agent-{id}.jsonl`) as dispatches and in each phase's `subagents` number, leaving `timing.json` byte-identical for a session with no workflow agents.

**Architecture:** `readDispatches` (transcript.js) scans the `subagents/` directory and then each `workflows/{runId}/` directory with one shared per-directory body; `classifyToolCall` classes `Workflow` as `dispatch`; `readUsage` rows carry `agentCalls`; `joinTokens` (derive.js) takes the workflow agents' start times as a third argument and makes `subagents` = agent calls + workflow agents; `phase-timing.js` computes dispatches before tokens and wires the two together.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T003729-record-5597/work/5597-spec.md`

Scope keywords: readDispatches, subagentsDirFor, joinTokens, agentCalls, dirNotes

## Global Constraints

- `readDispatches` never throws; a symlinked `workflows/` directory, run directory or agent file is never followed (use `lstatType` from `plugin/bin/lib/path-guard`, never `fs.existsSync`/`fs.realpathSync` — the path-guard conformance scan fails those).
- `notFound` keeps its one-string shape and is set only when no agent id was found in any scanned directory. Per-run-directory problems go in a new array key `dirNotes` (always present, `[]` when none).
- A session directory with no `workflows/` entry costs nothing extra: decide on the `readdirSync` listing of `subagents/` already taken (no extra lstat/readdir when `workflows` is not listed).
- `readUsage` keeps streaming; workflow transcripts go through the same `readUsage`.
- With no workflow agent in a run, every number and every byte of `timing.json` is what it is today (AC5, AC8). Task items carry `workflowRunId: null, workflowPhase: null` from `readDispatches`, but `phase-timing.js` drops the two keys from an item when both are null before writing `timing.json`; `joinTokens` internal counters never leave it.
- Existing tests under `tests/bin-lib/timing/` and `tests/bin-lib/path-guard/callers-characterization.test.js` pass with no edit to their expectations (AC5).
- Windows parity (`.claude/skills/windows-checkout-test-parity`, quoted): "Building a test's expected path with `path.join` when the code under test prints the path verbatim…" — build every expected path in a test with `path.join` from the same root the fixture used; "A test reads a tracked text file through `tests/helpers/read-skill.js`'s `readText`, never a raw `fs.readFileSync(p, 'utf8')`"; "Simulating an unreadable file … with `fs.chmodSync(path, 0o000)`" is forbidden without `chmodDenialSkip` — prefer an `fsImpl` fake as the existing unreadable-meta test does.
- Parse-signal discipline (`.claude/skills/parse-signal-discipline`): "no workflows directory" (not listed — silent) must stay distinguishable from "could not read it" (listed but symlink/unreadable — a `dirNotes` string).

## Review Focus

1. A `workflows/` entry that is a plain file, not a directory — expect it skipped silently with no item and no throw (Task 2 test `workflows/ that is a plain file is ignored`).
2. A plain file directly inside `workflows/` beside run directories (e.g. a stray `.DS_Store`) — expect no item, no note (same test, second fixture entry).
3. A workflow run directory's `journal.jsonl` beside agent files — expect it never read as an agent (AC6 "file that is not an agent file").
4. Legacy usage rows with no `agentCalls` field (hand-built rows, or rows from an older reader) — expect `subagents` to fall back to the row's `turnClasses.dispatch` count, so `derive.test.js`'s existing `subagents: 1` expectation holds unedited (Task 3 test `legacy row without agentCalls`).
5. An `Agent` call refused by a guard (`guard-refusal` class) — expect it counts in neither `dispatch` nor `agentCalls`, as today (Task 2 test `guard-refused Agent call adds no agentCalls`).

---

### Task 1: AC8 golden captured from the unchanged code

**Role:** integration

**Files:**
- Create: `tests/fixtures/timing/subagents-golden-timing.json`
- Modify: `tests/bin-lib/timing/golden.test.js`

**Interfaces:**
- Produces: `tests/fixtures/timing/subagents-golden-timing.json` — the normalized `timing.json` the base code writes for the `subagents-session` fixture under `--auto-transcript`.

- [ ] **Step 1: Capture the golden from the current (unmodified) CLI.** This task MUST run before any production change. In `golden.test.js` add a helper `subagentsTiming()` that builds the same environment `cli.test.js`'s `subagentRun()` does (tmp run dir with `SUB_EVENTS` copied verbatim from `cli.test.js` line 232, tmp home with `tests/fixtures/timing/subagents-session` copied to `{home}/.claude/projects/-Users-x-Code-repo--claude-worktrees-wt`, `run-state.json` `{ worktree: '/Users/x/Code/repo/.claude/worktrees/wt', sessionId: 'sess-1', status: 'active' }`), spawns `phase-timing.js --run {dir} --markdown --auto-transcript` with `env: fixtureHomeEnv(home)` (`tests/helpers/fixture-home.js`), and returns `normalizeSubagents(timing)`: `normalizeTiming(timing)` with every occurrence of the tmp home path replaced by `<HOME>` (replace on the serialized string, both the native path and its JSON-escaped form). Write that string once to `tests/fixtures/timing/subagents-golden-timing.json` with a scratch one-off call — never hand-typed. Define `const SUB_GOLDEN = path.join(__dirname, '..', '..', 'fixtures', 'timing', 'subagents-golden-timing.json')` and `const { fixtureHomeEnv } = require('../../helpers/fixture-home')` at the top of `golden.test.js` (neither exists there today).

- [ ] **Step 2: Add the test**

```js
test('AC8.1: a session with no workflows/ directory writes timing.json byte-identical to the base commit (subagents-session, --auto-transcript)', () => {
  assert.equal(subagentsTiming(), readText(SUB_GOLDEN));
});
```

- [ ] **Step 3: Run it** — `node --test tests/bin-lib/timing/golden.test.js` → Expected: PASS (characterization at base; it guards Tasks 2–3).

- [ ] **Step 4: Commit** — `git add tests/fixtures/timing/subagents-golden-timing.json tests/bin-lib/timing/golden.test.js` then commit `Pin subagents-session timing.json golden before workflow agents — refs #5597`.

### Task 2: Workflow run directories in readDispatches, Workflow turn class, agentCalls

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/timing/transcript.js` (header comment, `readUsage`, `subagentsDirFor`, `readDispatches`)
- Modify: `plugin/bin/lib/timing/turn-class.js:185` (`classifyToolCall`)
- Test: `tests/bin-lib/timing/transcript.test.js`
- Test: `tests/bin-lib/timing/turn-class.test.js`
- Test: `tests/bin-lib/path-guard/callers-characterization.test.js` (run only, no edit — its `fsImpl` fakes list no `workflows` entry, so the new scan must make no extra fs call for them)
- Test: `tests/multi-agent-coordination.test.js` (run only, no edit — pins that `readDispatches` never throws)

**Interfaces:**
- Produces:
  - `readUsage(...)` user rows (the rows that carry `tool_result` blocks) gain `agentCalls: number`; assistant rows get no such key, because `transcript.test.js:215` deep-equals a whole assistant row and AC5 forbids editing it (Task 3's fallback reads a missing key as `turnClasses.dispatch`, which is `{}` → 0 on assistant rows) — count of `tool_result` blocks on the row whose call was `Agent` or `Task` and classed `dispatch` (so it equals `turnClasses.dispatch` minus `Workflow` calls; a guard-refused call adds none).
  - `classifyToolCall({ name: 'Workflow' })` → `'dispatch'`.
  - `subagentsDirFor(p)`: for `…/subagents/workflows/{runId}/agent-{id}.jsonl` returns the `…/subagents` directory; every other input unchanged.
  - `readDispatches(subagentsDir, { fsImpl, window })` → `{ items, notFound, excludedOutsideWindow, dirNotes }`. Each item gains, after `notFound`, `workflowRunId: string|null` (the run directory's basename) and `workflowPhase: string|null` (meta `workflowPhase` when a string). `dirNotes: string[]`.

- [ ] **Step 1: Write the failing tests** (in `transcript.test.js`, hand-written fixtures in tmp dirs holding only the asserted keys; reuse `aLine`, `tmpSubagents`):
  - `AC1.1: two direct agents and one workflows/{runId}/ holding three agents give five items` — `r.items.length === 5`, `r.notFound === null`, `r.dirNotes` deep-equals `[]`.
  - `AC1.2: the three workflow items carry the run id and their workflowPhase; the two direct items carry null for both` — e.g. run id `wf-run-1`, phases `'review'`.
  - `AC2.1: workflow items take their tier from the meta model alias` — metas `model: 'haiku'|'sonnet'|'opus'` → `aggregateDispatches(r.items).items` tiers `fast|standard|capable`.
  - `AC2.2: a workflow description "lens 3b A" yields the role lens reviewer`.
  - `AC3.1: a symlinked workflows/ directory is not read and is named` — `dirNotes` deep-equals [`workflows/ directory is a symlink (not followed) at ${path.join(dir,'workflows')}`], its agents absent.
  - `AC3.2: a symlinked run directory is not read and is named` — note `workflow run directory is a symlink (not followed) at ${runPath}`.
  - `AC3.3: a symlinked agent file inside a run directory is not read and is named` — item `notFound` `transcript not readable (symlink)` (today's direct-dir wording), `workflowRunId` set.
  - `AC6.1: a run directory with no agent file gives one dirNotes string` — `no agent-* transcripts in ${runPath}`.
  - `AC6.2: an unreadable meta.json in a run directory gives an item with a meta not readable note` — via an `fsImpl` whose `readFileSync` throws `EACCES` for that meta path (as the existing `a meta file that exists but cannot be read` test does); item `workflowPhase === null`, `workflowRunId` set, `notFound` starts `meta not readable (EACCES)`.
  - `AC6.3: a file in a run directory that is not an agent file gives no item and no exception` — `journal.jsonl` beside one agent → one item.
  - `AC10.1: a subagents/ directory holding only workflows/{runId}/ with two agents returns two items and notFound null`.
  - `AC11.1: a run file whose agentCount is 3 beside a run directory with two agents gives one dirNotes string naming 3 and 2` — run file at `path.join(path.dirname(subagentsDir), 'workflows', `${runId}.json`)`; assert `dirNotes.length === 1` and it matches `/\b3\b/` and `/\b2\b/`. `AC11.2: with no run file there is no such note`.
  - `AC12.1: subagentsDirFor maps a workflow agent transcript to the session subagents/ dir` — `subagentsDirFor(path.join('/h','p','sess-1','subagents','workflows','r1','agent-a.jsonl'))` equals `path.join('/h','p','sess-1','subagents')`. `AC12.2: its result for a main transcript is unchanged` — `subagentsDirFor(path.join('/h','p','sess-1.jsonl'))` equals `path.join('/h','p','sess-1','subagents')`.
  - Review Focus 1–2: `workflows/ that is a plain file is ignored` (no item, no note) and `a plain file directly inside workflows/ is ignored`.
  - `window clipping applies to workflow run directories` — a workflow agent wholly outside the window counts in `excludedOutsideWindow`.
  - In `turn-class.test.js`: `AC4 (unit): a Workflow tool call is classed dispatch`.
  - In `transcript.test.js`: `agentCalls counts Agent and Task results and not Workflow` (a user row with three `tool_result`s for an `Agent`, a `Task`, a `Workflow` call → `agentCalls === 2`, `turnClasses.dispatch === 3`), and Review Focus 5: `guard-refused Agent call adds no agentCalls`.

- [ ] **Step 2: Run** — `node --test tests/bin-lib/timing/transcript.test.js tests/bin-lib/timing/turn-class.test.js` → Expected: FAIL (new tests; `workflowRunId` undefined, `dirNotes` undefined, Workflow classed `other`).

- [ ] **Step 3: Implement.**
  - `turn-class.js`: add `'Workflow'` to the `case 'Agent': case 'Task':` arm.
  - `readUsage`: in the user-row (`else`) branch only, set `row.agentCalls = 0` before the `tool_result` loop (never in the shared row literal); in that loop, `if (cls === 'dispatch' && (call.name === 'Agent' || call.name === 'Task')) row.agentCalls += 1`.
  - `subagentsDirFor`: before the existing check, if `/^agent-.+\.jsonl$/` matches the basename, `basename(dirname(dirname(p))) === 'workflows'` and `basename(dirname(dirname(dirname(p)))) === 'subagents'`, return `dirname(dirname(dirname(p)))`.
  - `readDispatches`: extract today's body from the agent-name loop through the per-agent build into `async function scanAgentDir(dir, names, { fsImpl, window, workflowRunId })` → `{ built, ids: number, excluded }` (built entries `{ d, startMs }`; `d.workflowRunId = workflowRunId ?? null`, `d.workflowPhase = workflowRunId && meta && typeof meta.workflowPhase === 'string' ? meta.workflowPhase : null`, both appended after `notFound`). The direct directory keeps its early returns (symlink, unreadable) unchanged except adding `dirNotes: []`. Then, only when `names.includes('workflows')`: `lstatType` it — symlink → note; otherwise `readdirSync` (error → `workflows/ directory not readable (${code}) at ${p}`); for each entry `lstatType`: `symlink` → `workflow run directory is a symlink (not followed) at ${p}`; `missing`/`unreadable` → `workflow run directory not readable (${code}) at ${p}`; not a directory → skip; directory → `readdirSync` (error → `workflow run directory not readable (${code}) at ${p}`), zero agent ids → `no agent-* transcripts in ${p}`, else scan. Cross-check: read `path.join(path.dirname(subagentsDir), 'workflows', `${runId}.json`)` only when `lstatType` says it is a regular file; when it parses to an object whose `agentCount` is a finite number not equal to that run directory's agent-id count, push `workflow run ${runId}: run file agentCount ${n}, ${found} agent(s) found in ${p}`. Any read/parse failure of the run file adds nothing. Combine every `built` list, sort with today's comparator, sum `excluded`. `notFound` is `null` when any scanned directory had ≥1 agent id, else the direct directory's `no agent-* transcripts in ${subagentsDir}`.
  - Header comment: describe both layouts; state the workflow layout was observed on Claude Code CLI 2.1.325, is not documented, and that agents a workflow agent starts itself (`spawnDepth` > 1) are read only when their files sit in the same run directory.

- [ ] **Step 4: Run** — same command → Expected: PASS; then `node --test tests/bin-lib/timing/ tests/bin-lib/path-guard/callers-characterization.test.js tests/multi-agent-coordination.test.js` → PASS with no expectation edited.

- [ ] **Step 5: Commit** — `git add` the four files; commit `Read workflow run directories in readDispatches — refs #5597`.

### Task 3: subagents counts agents; phase-timing wiring; docs

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/timing/derive.js:330-393` (`joinTokens`)
- Modify: `plugin/bin/phase-timing.js` (`collectDispatches`, `run`)
- Modify: `docs/plugin-structure.md:55`
- Test: `tests/bin-lib/timing/derive.test.js`
- Test: `tests/bin-lib/timing/cli.test.js`
- Test: `tests/bin-lib/timing/golden.test.js` (AC8 test from Task 1, unchanged)
- Test: `tests/timing-prose-conformance.test.js` (run only, no edit — pins `docs/plugin-structure.md` line 55)

**Interfaces:**
- Consumes: Task 2's `agentCalls`, `workflowRunId`, `startTs`, `dirNotes`.
- Produces: `joinTokens(phases, usageRows, workflowAgentStarts = [])` — `workflowAgentStarts: string[]` of ISO timestamps. Output shape unchanged; `subagents` per bucket = summed agent calls + workflow agents placed in that bucket.

- [ ] **Step 1: Write the failing tests**
  - `derive.test.js` `AC4.1: one Workflow call and two Agent calls in review with three workflow agents starting in review give subagents 5`; `AC4.2: …and a dispatch turn-class count of 3` — build phases with `derivePhases` over events with a `review` span; rows: one user row `{ turnClasses: { dispatch: 3 }, agentCalls: 2 }` inside review; `workflowAgentStarts` three ts inside review.
  - `AC9.1: a workflow agent starting after the last phase closes gives unattributed.subagents 1`; `AC9.2: …leaves every phase's subagents unchanged`; `AC9.3: …and counts it in totals.subagents`.
  - Review Focus 4: `legacy row without agentCalls falls back to turnClasses.dispatch` (row `{ turnClasses: { dispatch: 2 } }` → `subagents === 2`).
  - `the internal counters never reach the output` — `Object.keys(bucket)` contains neither `agentCalls` nor `workflowAgents`, for a phase, `unattributed` and `totals`.
  - `cli.test.js` `AC9.4: a workflow agent whose transcript has no timestamped row is in dispatches with its note and in no count` — `subagentRun()` plus `sess-1/subagents/workflows/r1/agent-w0.{meta.json,jsonl}` (empty jsonl); `dispatches.items` has `w0` with `notFound` `transcript has no usage rows`; `totals.subagents` equals the value without that agent.
  - `cli.test.js` `workflow agents count in their phase subagents and in dispatches end to end` — `subagentRun()` plus one workflow agent with a timestamped row inside the build span (10:05Z); `totals.subagents` is one more than the `subagentRun()` baseline; the item in `timing.json` has `workflowRunId: 'r1'`; a direct Task item in the same file has no `workflowRunId` key.
  - `cli.test.js` `a run directory problem appears in notFoundDirs` — empty `workflows/r2/` → `dispatches.notFoundDirs` includes `no agent-* transcripts in ${path.join(sub,'workflows','r2')}` and stdout has its `dispatches: subagent transcripts not found (…)` line.

- [ ] **Step 2: Run** — `node --test tests/bin-lib/timing/derive.test.js tests/bin-lib/timing/cli.test.js` → Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `joinTokens`: bucket gains `agentCalls: 0, workflowAgents: 0` (after `samples`); `add` does `b.agentCalls += Number.isFinite(r.agentCalls) ? r.agentCalls : (Number(r.turnClasses && r.turnClasses.dispatch) || 0)`; place each valid ts in `workflowAgentStarts` with the same innermost-`[start, end)` rule rows use (factor the span search into one local function both loops call) → `bucket.workflowAgents += 1`, else `unattributed`; every valid ts also increments `totalsAcc.workflowAgents`. `finalize`: destructure `samples, agentCalls, workflowAgents` out of the spread and set `subagents: agentCalls + workflowAgents`. Update the function comment.
  - `phase-timing.js` `run`: when `wantTokens`, compute `const dispatches = await collectDispatches(paths, events.events, cwd)` before `joinTokens`; pass `workflowStarts = (dispatches.items || []).filter((d) => d.workflowRunId != null && d.startTs).map((d) => d.startTs)`; keep `timing.dispatches = dispatches` at its current position in the object so key order is unchanged.
  - `collectDispatches`: push each `r.dirNotes` entry into `reasons` (both the found and not-found branches); before `aggregateDispatches`, drop `workflowRunId`/`workflowPhase` from items where both are null.
  - `docs/plugin-structure.md` line 55: extend the `readDispatches` clause to say it also reads `subagents/workflows/{runId}/` (observed on CLI 2.1.325, undocumented), names per-run-directory problems in `dirNotes`, and that the `dispatch` turn class counts calls (`Agent`, `Task`, `Workflow`), `subagents` counts agents, `dispatches` lists agents whose transcripts were found. Keep `readDispatches` and `aggregateDispatches` on that one line (`tests/timing-prose-conformance.test.js:101`).

- [ ] **Step 4: Run** — `node --test tests/bin-lib/timing/ tests/timing-prose-conformance.test.js` → Expected: PASS, including Task 1's AC8.1 and the existing `golden.test.js` AC6.1 unedited. AC5.1–5.2: also run `git diff --stat {task-1-commit} -- tests/bin-lib/timing/` and confirm only additions in the timing tests (no edited expectation line).

- [ ] **Step 5: Commit** — `git add` the five files; commit `Count workflow agents in each phase's subagents — refs #5597`.

## After the tasks (controller, not dispatched)

Waived AC5.1: no new test — met by Task 2/3 Step 4 running every existing `tests/bin-lib/timing/` suite unedited (the `git diff` check in Task 3 Step 4) plus the existing exact-stdout `--markdown` pins in `cli.test.js` AC8.1 and `golden.test.js` AC6.1.
Waived AC7.1: PR-body content, produced by the controller's reader classification below, not a test.
Waived AC7.2: the PR link to the follow-up record, added by the controller below.
Waived plugin/bin/lib/timing/context-gauge.js: read only by the controller's reader classification below (a `subagentsDirFor` caller passing main transcripts; behaviour unchanged for them).
Waived tools/efficiency-report.js: read only — the controller confirms it names no `toolUseId` key and reads `subagents` with unchanged meaning for runs without workflow agents.

- Real-input probe (Real-input + Independent-count checks): run `readDispatches` on `/Users/thomasholknielsen/.claude/projects/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-design-process-efficiency/d3d40e90-5d04-4522-9530-faf98e6af365/subagents` and compare the workflow item count per run id with an independent count of `agent-*.jsonl` files and with each `workflows/{runId}.json`'s `agentCount`; record both in `decisions.md` as an `AC evidence` entry with the output under `$PIPELINE_RUN_DIR/evidence/`.
- Deliverable 5 / AC7.1: classify the five readers (`plugin/bin/skill-load-report.js`, `plugin/bin/lib/skill-audit/transcript-load.js`, `plugin/bin/lib/timing/context-gauge.js`, `tools/guard-refusals/transcripts.js`, `tools/replay-scratch/counterfactual.js`) plus the two `subagentsDirFor` callers into the PR-body table; file one follow-up via `/claude-tweaks:capture` if any row reads "unchanged, should see them", and link it in the PR.
- PR body: state the `notFound` reading — cleared when any scanned directory had an agent id, so a window that clips every agent keeps today's `items: []`, `notFound: null` (spec's decision rule: keep a run on the previous release working).
- AC5 markdown byte-identity: `phase-timing.js --markdown` over record-1535 — covered by the existing `cli.test.js` AC8.1 exact-stdout test and `golden.test.js`, unedited.
