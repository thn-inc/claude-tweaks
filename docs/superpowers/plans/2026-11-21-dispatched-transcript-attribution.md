# Dispatched-Run Transcript Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dispatched run's `timing.json` token totals count its own-slug transcript (when one exists) plus the dispatching and resuming sessions' Task-call transcripts that name its run id, and nothing else; its `dispatches` view lists only those Task calls' own descendants.

**Architecture:** `plugin/bin/lib/timing/transcript.js` gains `locateTaskTranscripts`, which finds a session's depth-1 agent files whose dispatch prompt names exactly one pipeline run id. For a `dispatched: true` run, `plugin/bin/lib/timing/at-close.js`'s `ownTranscripts` returns the own-slug hit (if any) together with those Task-call paths. `deriveTiming` reads them all, still clipping rows to the run window, and scopes `dispatches` to the Task calls' descendant agents (`plugin/bin/lib/timing/run-timing.js`). The one maintainer tool that reads `transcripts[].path` back as a session id learns the agent-path shape.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-21T181802-spec-5647/work/5647-spec.md` (record #5647).

Scope keywords: ownTranscripts, locateTranscripts

## Global Constraints

- Applies only when `run-state.json` has `dispatched: true` (spec, Plan Review Clarifications: decided by the user). A non-dispatched run keeps today's behavior byte for byte: the existing AC9.1 and AC9.2 tests in `tests/bin-lib/timing/at-close.test.js` stay unchanged and green. A dispatched run with no attributed Task call is also unchanged, including its `dispatches` view.
- Nothing in the resolver throws (`at-close.js`: "Nothing here throws: a failure is one SKIP line"). A failure is a reason string.
- Under `plugin/bin/`, filesystem checks go through `plugin/bin/lib/path-guard` (`lstatType`, `resolveLeaf`, `canonicalRealpath`). Never use bare `fs.existsSync` or `fs.realpathSync` (`tests/path-guard-conformance.test.js`). No `child_process`.
- `tools/` does not ship (`docs/decisions/0015-*`): `plugin/` never requires `tools/guard-refusals/transcripts.js`. The plugin's run-id regex lives in `transcript.js`.
- Release Note: no user-visible change.
- Commit style: `{Verb} {what} — {detail}`. The body ends with `refs #5647`, a blank line, then `Claude-Session: https://claude.ai/code/session_01QXpjcTNW8T28kyYPMjkKJZ`.

## Design (the record's Deliverable: "decide whether…")

**Decision: yes, attribute.** A dispatched run's orchestration happens in the dispatching session's Task calls (`build,test`, then `review,polish,wrap-up`, plus continuations). Each one is a `spawnDepth: 1` agent file under `{slug}/{sessionId}/subagents/`, and its first entry (the dispatch prompt) names the run dir. The rule is the subagent-inheritance case of `tools/guard-refusals/transcripts.js`: a subagent's calls belong to the run named when it was dispatched. It is applied per file, not per row, because ownership of a Task call does not change when it later reads a prior attempt's run dir.

- **Union (decided by the user at plan review):** for a dispatched run, `paths` = the own-slug hit of `sessionId` (today's lookup, when it finds one) ∪ the Task-call files below. They are separate files, so no row is read twice. This changes the totals of the dispatched runs that have an own-slug transcript (41 of 240 November runs): today those count only the dispatcher's own main rows.
- **Session ids:** the distinct strings among run-state `dispatchSessionId` and `sessionId`. `dispatchSessionId` is stamped only by `hooks.js record-worktree --dispatch` (`plugin/bin/hooks.js` ~746). A human resume overwrites `sessionId` but leaves it intact, so both sessions' Task calls count.
- **Where:** `{sid}.jsonl` under any slug of `{configDir}/projects` (`locateTranscripts({ sessionId, cwd: null, homeDir: null, configDir })`, realpath-contained and sid-validated). Every hit's `subagentsDirFor(hit)` is scanned, and results are deduped by real path. A symlinked directory or file is never followed, and `subagents/workflows/` is not scanned.
- **`dispatches` scope:** when ≥1 Task-call file is attributed, `deriveTiming` keeps a `dispatches` item only when its `parentAgentId` chain (followed through the items read) reaches an attributed Task-call agent. The attributed agents themselves are dropped from `dispatches`, since their rows are in `totals.tokens`. So another run's agents in the same session and window never appear. Probed: all 297 nested agents in two real dispatched sessions chain to a depth-1 agent. A run with no attributed Task call keeps today's window view.
- **Known edge (stated in the header):** a resuming session's depth-1 agents that do not name the run, and the resumer's main rows when its transcript is not under the own slug, are not counted. The second is the same gap as ledger row 1 (non-dispatched runs launched from the main checkout).
- **Which files:** `agent-{id}.jsonl` counts when `agent-{id}.meta.json` parses with `spawnDepth === 1` exactly, and the file's first line (read at most `FIRST_ENTRY_CAP` = 1 MiB) parses as a `type: "user"` entry whose JSON text names exactly one run id, equal to `path.basename(runDir)`.
- **Run id naming:** `/\.claude-tweaks[\\/]+pipelines[\\/]+(\d{4}-\d{2}-\d{2}T\d{6}-[a-z0-9][a-z0-9-]*)/g` over the line's raw text. A Windows path inside JSON text shows up as `\\`.
- **Why depth 1 only:** nested agents (depth ≥ 2) appear in `timing.json`'s `dispatches` view, the same way an own-slug run's nested agents do. `totals.tokens` keeps meaning "the orchestrating transcripts' rows" for both kinds of run.
- **Evidence (probed 2026-11-21 over `~/.claude/projects`):** of 240 dispatched November runs, 41 have an own-slug transcript. Of the 199 whose session transcript sits elsewhere, 197 have ≥1 depth-1 agent whose first line names exactly that run, and 0 depth-1 agents name more than one run. Whole-file mentions are unusable: retries name their prior attempt's run dir, and many nested agents name no run.
- **Reason when nothing is found at all** (no own-slug hit, no Task call): `no {sid}.jsonl under the slug of {worktree}, and no Task-call transcript of session(s) {ids comma-joined} names run {runId}`. When `locateTaskTranscripts` returned `notes`, they follow as `({notes joined by '; '})`. A partial result (some paths) logs nothing extra.
- **Reason when the files read have no rows in the window:** at-close's third SKIP branch reads `own and Task-call transcripts yielded no token totals (…)` when Task-call paths were attributed, and keeps today's `own transcript yielded no token totals (…)` otherwise.

## Review Focus

1. A dispatch prompt naming the run dir with Windows separators (`C:\\…\\.claude-tweaks\\pipelines\\{id}` in JSON text) is attributed. Task 1 pins this.
2. A first line longer than the 1 MiB cap is not attributed and nothing throws. Task 1 pins this.
3. An agent file whose `meta.json` is missing, malformed, or has no `spawnDepth` (an agent still being written, or a drifted layout) is not attributed. Task 1 pins this.
4. A run resumed by a human (`sessionId` ≠ `dispatchSessionId`), with the resumer's own-slug transcript present, counts that transcript plus the dispatching session's Task calls. Task 2 pins this.
5. A token pass over the archive twin (`pipelines/archive/{id}`) attributes by the same basename. Task 2 pins this.

---

### Task 1: `locateTaskTranscripts` in transcript.js

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/timing/transcript.js` (header layout notes at lines 15-29; new exports beside `locateTranscripts`; `module.exports` at line 554)
- Test: `tests/bin-lib/timing/transcript.test.js`

**Interfaces:**
- Produces: `locateTaskTranscripts({ sessionIds: string[], runId: string, configDir: string, fsImpl?: fs }) -> { paths: string[], notes: string[] }`. `paths` are sorted and deduped by real path, across every slug's hit for each session id. `notes` holds one plain-text line per session id that yielded nothing (no `{sid}.jsonl`, no `subagents/` directory, a symlinked `subagents/`, or an invalid sid). Task 2 appends `notes` to its empty-result reason. It never throws.
- Produces: `runIdsNamed(text: string) -> string[]` (distinct, in first-seen order) and `FIRST_ENTRY_CAP = 1048576`, both exported.
- Consumes: the existing `locateTranscripts`, `subagentsDirFor`, `readMeta`, `lstatType`.

- [ ] **Step 1: Write the failing tests**

Add a fixture builder in the test file: `taskSession(cfg, slug, sid, agents)` writes `{cfg}/projects/{slug}/{sid}.jsonl` (one assistant line) plus, per agent `{ id, depth, prompt, meta }`, `subagents/agent-{id}.meta.json` (default `{ spawnDepth: depth, description: id }`; `meta: null` omits the file; a string writes it raw) and `agent-{id}.jsonl`. Its first line is `{"type":"user","message":{"role":"user","content":prompt}}`, followed by one assistant usage line. Define `RUN = '2026-11-16T100000-record-1'`, `OTHER_RUN = '2026-11-16T100000-record-2'`, and `named(id) = '/m/.claude-tweaks/pipelines/' + id`. Name each test `locateTaskTranscripts: …`. Next to each guard, the comment says which test goes red if the guard is deleted.

- `attributes a depth-1 agent whose prompt names exactly this run`: paths equal `[…/agent-t1.jsonl]`.
- `depth-2 agent naming the run is excluded` (spawnDepth guard): only the depth-1 sibling is returned.
- `meta without spawnDepth, malformed meta, missing meta: each excluded`.
- `prompt naming this run and another run is excluded` (exactly-one guard).
- `prompt naming only another run is excluded` (equality guard).
- `first line not a user entry, or unparseable: excluded` (type guard).
- `first line over FIRST_ENTRY_CAP: excluded, no throw`: the prompt is padded past 1 MiB.
- `Windows-separator run dir in the prompt is attributed`: the prompt is `'C:\\r\\.claude-tweaks\\pipelines\\' + RUN`, and the file is written via `JSON.stringify` so the text carries `\\`.
- `symlinked agent file is not followed` and `symlinked subagents/ directory is not followed` (lstat guards). Skip on win32 the way the existing `[IL-150]` symlink test does.
- `two session ids each contribute; paths sorted and deduped` (passing the same sid twice yields no duplicate).
- `one session id under two slugs: both subagents/ dirs are scanned`: the same `{sid}.jsonl` sits under two slugs, each with one depth-1 agent naming RUN. Both paths are returned.
- `an invalid session id ('../x') contributes nothing and no other slug is scanned`: a valid agent for RUN exists under a different sid. `paths` is `[]` and `notes` has one entry.
- `workflow agents under subagents/workflows/ are not candidates`.
- `runIdsNamed returns distinct ids in order, both separators`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "locateTaskTranscripts|runIdsNamed" tests/bin-lib/timing/transcript.test.js`
Expected: FAIL after Step 1 — `TypeError: locateTaskTranscripts is not a function`

- [ ] **Step 3: Implement `locateTaskTranscripts`, `runIdsNamed`, `FIRST_ENTRY_CAP` in `plugin/bin/lib/timing/transcript.js`**

Read the first line with `fsImpl.openSync`/`readSync` in 64 KiB chunks until a `\n` or the cap. Wrap each session id's work in its own try/catch that adds a note, so one bad session never hides another. Extend the header's layout notes with the rule from the Design section, in one paragraph.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/timing/transcript.test.js`
Expected: PASS (the whole file, existing tests included)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/timing/transcript.js tests/bin-lib/timing/transcript.test.js
git commit -m "Add locateTaskTranscripts — a session's depth-1 agent files whose prompt names one run"
```

### Task 2: dispatched fallback in `ownTranscripts`, and the contract prose

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/timing/at-close.js` (header lines 6-9; `ownTranscripts` lines 44-61; its call at lines 277-281; the third SKIP branch at line 289)
- Modify: `plugin/bin/lib/timing/run-timing.js` (`collectDispatches` lines 116-149 and `deriveTiming` lines 208-247: the `scopeDispatchesTo` option)
- Test: `tests/bin-lib/timing/run-timing.test.js` (the scope filter, unit level)
- Modify: `plugin/bin/timing-at-close.js:5` (comment: "from the run's own transcript" → own transcript, or a dispatched run's Task-call transcripts naming it)
- Modify: `docs/plugin-structure.md:281` (same one-clause change)
- Modify: `docs/journeys/read-where-a-pipeline-run-spent-its-minutes-1928.md:62` (the sentence "Tokens come only from the run's own `{sessionId}.jsonl` under its own worktree slug…" gains the dispatched case)
- No change: `docs/hooks.md` ("Who writes `timing.json`" never states the own-slug rule; it says "the run's transcript"). `docs/superpowers/plans/2026-11-16-timing-at-close.md`, `docs/superpowers/plans/2026-11-16-typed-dispatch-build-authority-5584.md` and `CHANGELOG.md` are history.
- No change (Check B, other callers of the unchanged `locateTranscripts`): `plugin/bin/phase-timing.js:261` (`--auto-transcript`, a mid-run view; the at-close writer recomputes any file without token totals), `plugin/bin/lib/timing/context-gauge.js:204,221` and `plugin/bin/lib/issues/typed-command.js:238` (already look a session up by id across every slug — the precedent this design follows), `tools/typed-command-probe.js`, `tests/bin-lib/path-guard/callers-characterization.test.js`, `tests/bin-lib/driver/fixtures/merge-check-verdicts.json` (fixture text).
- Test: `tests/bin-lib/timing/at-close.test.js`

**Interfaces:**
- Consumes: `locateTaskTranscripts` (Task 1), looked up at call time through `require('./transcript')` like the existing `locateTranscripts` call, so a test can stub it.
- Produces: `ownTranscripts(runState, { env?, homeDir?, runId? }) -> { paths, taskCalls, reason }`. `paths` is the own-slug hit (if any) followed by `taskCalls`, which holds the attributed Task-call paths (`[]` for a non-dispatched run, or when `runId` is not a string). `reason` is null whenever `paths` is non-empty.
- Produces: `deriveTiming(runDir, { …, scopeDispatchesTo?: string[] })` and `collectDispatches(paths, events, cwd, { …, scopeDispatchesTo })`. When `scopeDispatchesTo` is a non-empty array, `dispatches.items` keeps an item only when its `parentAgentId` chain (followed through the items read, at most 10 hops) reaches an item whose `transcriptPath` is in `scopeDispatchesTo`. The items in `scopeDispatchesTo` are dropped, and `byTier`/`byRole` are aggregated after the filter. When it is absent or empty, today's output is unchanged.

- [ ] **Step 1: Write the failing tests**

Fixture `dispatchedRun(root, id, { sid, resumeSid })`: `root = gitRepo()` (already imported). `runDir = {root}/.claude-tweaks/pipelines/{id}`, mkdir, then `writeEvents(runDir)`. Stamp it with the real writer: `runCli(HOOKS_JS, ['record-worktree', '--run', runDir, wt, '--dispatch'], { cwd: root, env: { CLAUDE_CODE_SESSION_ID: sid, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1' } })` must exit 0. With `resumeSid`, a second `record-worktree` without `--dispatch` follows under that session id (the real resume path). Then `closeRunState(runDir, { explicit: true })`. Session transcripts go under a slug other than `slugForCwd(wt)`, for example `slugForCwd(root)`, the main checkout. Agent files are written with Task 1's shape, with assistant rows stamped 10:01 and 10:09. Ids: `RUN_1 = '2026-11-16T100000-record-1'`, `RUN_2 = '2026-11-16T100000-record-2'`.

- `AC1.1: a dispatched run whose session transcript sits only under the main checkout slug gets token totals from the Task-call transcript that names its run id`: one session holds a depth-1 agent `t1` naming RUN_1 (usage A), a depth-1 agent `t2` naming RUN_2 (usage B), a depth-2 agent `c1` with `parentAgentId: 't1'`, and a depth-2 agent `c2` with `parentAgentId: 't2'`, across two run dirs. RUN_1's `totals.tokens` equal A's agent rows only and RUN_2's equal B's (`pickTokens` against the exact sums). RUN_1's `dispatches.items.map(d => d.agentId)` deep-equals `['c1']` and RUN_2's equals `['c2']`. No SKIP lines.
- `AC1.1: a dispatched run whose Task-call transcripts name a different run id gets none`: only an agent naming RUN_2 exists, so RUN_1 gets phase rows and no `totals.tokens` (`assertPhaseRows`, `Object.hasOwn(...,'tokens') === false`). It gets one SKIP that contains `and no Task-call transcript of session(s) {sid} names run 2026-11-16T100000-record-1`.
- `AC1.1 gate: a non-dispatched run with a Task-call transcript naming it still gets none`: same files, stamped by `record-worktree` without `--dispatch`. The SKIP equals today's reason (`no {sid}.jsonl under the slug of {wt}`) with no "Task-call" clause. Deleting the `dispatched === true` check turns this red.
- `AC1.1 union: a dispatched run with an own-slug transcript counts it plus its Task calls`: `writeTranscript(cfg, wt, [A, B], sid)` plus a depth-1 agent of the same session naming the run with usage OTHER (two rows). Totals equal `sum(A, B)` plus both OTHER rows.
- `AC1.1 resume: a resumed dispatched run counts the resumer's own-slug transcript and the dispatching session's Task calls`: `sid` = 'S1' with a depth-1 agent naming RUN_1 (usage A), and `resumeSid` = 'S2' with `writeTranscript(cfg, wt, [B, B], 'S2')` under the own slug. Totals equal both agent rows of A plus both B rows. A second case gives S2 a depth-1 agent naming RUN_1 in place of the own-slug transcript and expects the sum of both sessions' agent rows.
- `AC1.1 no rows in window: the SKIP names the Task-call transcripts`: one depth-1 agent naming RUN_1 whose rows are stamped 2026-11-15. The run gets phase rows, no `totals.tokens`, and one SKIP containing `own and Task-call transcripts yielded no token totals`.
- `AC1.1 notes: an empty result carries the lookup notes`: a dispatched run whose `dispatchSessionId` has no `{sid}.jsonl` anywhere. The SKIP contains the extended reason followed by `(` and Task 1's note for that session.
- `AC1.1 archive twin: attribution keys on the basename`: run `writeTimingAtClose` on a run dir moved to `{pipelines}/archive/{RUN_1}` (`fs.renameSync` after close). Totals as in the first test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "AC1\.1|scopeDispatchesTo" tests/bin-lib/timing/at-close.test.js tests/bin-lib/timing/run-timing.test.js`
Expected: FAIL after Step 1 — the positive test reports `totals.tokens` missing (the run got phase rows only); the gate test may already pass.

- [ ] **Step 3: Implement the fallback in `ownTranscripts` and pass `runId: path.basename(runDir)` at the call**

Keep the existing early returns (no worktree, no `sessionId`). Run the own-slug lookup. When `rs.dispatched === true` and `runId` is a string, also call `locateTaskTranscripts` with the distinct strings of `[rs.dispatchSessionId, rs.sessionId]`. `paths` = own hit (if any) followed by `taskCalls`. A non-empty `paths` returns `reason: null`. An empty one returns today's reason for a non-dispatched run, or the extended reason plus notes (Design section) for a dispatched one. At the call site, pass `scopeDispatchesTo: own.taskCalls` to `deriveTiming`, and pick the third SKIP branch's wording by `own.taskCalls.length`. In `collectDispatches`, apply the scope filter (Interfaces) before `aggregateDispatches`. Add a unit test in `run-timing.test.js`, `scopeDispatchesTo keeps only descendants of the scoped agents`, that drives `collectDispatches` over a subagents dir holding t1 (scoped), c1 (parent t1), g1 (parent c1), t2, and c2 (parent t2), and expects `['c1', 'g1']`. A second unit test expects an empty scope to return all five. Rewrite the header's lines 6-9 contract to say the same thing in two sentences, including the known resume edge. Then make the three prose edits listed in Files.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/timing/at-close.test.js tests/bin-lib/timing/at-close-cli.test.js tests/bin-lib/timing/run-timing.test.js tests/path-guard-conformance.test.js`
Expected: PASS (AC9.1 and AC9.2 unchanged)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/timing/at-close.js plugin/bin/lib/timing/run-timing.js plugin/bin/timing-at-close.js tests/bin-lib/timing/at-close.test.js tests/bin-lib/timing/run-timing.test.js docs/plugin-structure.md docs/journeys/read-where-a-pipeline-run-spent-its-minutes-1928.md
git commit -m "Attribute a dispatched run's Task-call transcripts at close — the run id the prompt names"
```

### Task 3: session id from an agent transcript path in the cost report

**Role:** integration

**Files:**
- Modify: `tools/pipeline-cost-report/guards.js:103-122` (`readTiming`'s `sessions`)
- Test: `tests/pipeline-cost-report/guards.test.js`
- Reader inventory of `timing.json` `transcripts`, from `grep -rn "\.transcripts\b\|transcripts\[" plugin tools perf tests`:
  - `guards.js readTiming` is a list-all reader: it turns each path into a session id. Changes here.
  - `tools/pipeline-cost-report/reviews.js:213-229` consumes `readTiming(...).sessions`. Fixed by this task; no edit.
  - `tools/efficiency-report.js:306-331` reads the archived at-close `timing.json`, takes `transcripts[].path` and rebuilds through `buildTiming` with no clip. No change: an attributed Task-call file belongs wholly to its run, so an unclipped read of it counts only that run's rows. The rebuilt `dispatches` is the unscoped window view, which is today's behavior for every run. It reads only per-phase `procedureFiles`.
  - `plugin/bin/phase-timing.js:77,250,300` is its own `--transcript` argv. No change.
  - `plugin/bin/lib/timing/run-timing.js:262` is the writer. No change.
  - `tests/bin-lib/timing/{cli,run-timing}.test.js` and `tests/wait-polls/cli.test.js` assert their own fixtures. No change.

**Interfaces:**
- Produces: `readTiming(runDir)` keeps returning `{ items, sessions }`. A path `…/{sid}/subagents/agent-{id}.jsonl` yields `{sid}`, any other path yields its `.jsonl` basename as today, and `sessions` is deduped in first-seen order.

- [ ] **Step 1: Write the failing test**

`readTiming: an agent transcript path yields its session id, deduped`. The test writes a `timing.json` whose `transcripts` are `[{ path: 'p/slug/s1/subagents/agent-a1.jsonl' }, { path: 'p/slug/s1/subagents/agent-a2.jsonl' }, { path: 'p/slug/s2.jsonl' }]` and asserts `sessions` deep-equals `['s1', 's2']`. A second assertion: `readReport({ roots, sessions, agentId })` finds a report written by the existing `writeReport(projects, 's1', 'a1', …)`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern "agent transcript path" tests/pipeline-cost-report/guards.test.js`
Expected: FAIL after Step 1 — `sessions` is `['agent-a1', 'agent-a2', 's2']`.

- [ ] **Step 3: Implement the agent-path case in `readTiming`**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/pipeline-cost-report/guards.test.js tests/pipeline-cost-report/reviews.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/pipeline-cost-report/guards.js tests/pipeline-cost-report/guards.test.js
git commit -m "Read a session id from an agent transcript path in the cost report — dispatched runs' timing.json"
```

## Verification: real-input probe and independent count (controller-run, before the whole-branch review; no committed code)

Covers AC1.1 on real data. `EV="/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-21T181802-spec-5647/evidence"`; run `mkdir -p` on it first.

1. Pick ≥5 closed dispatched run dirs under the main checkout's `.claude-tweaks/pipelines/` and `archive/`. Each must have no own-slug transcript and no `timing.json` with token totals, and must include one resumed run (`sessionId` ≠ `dispatchSessionId`) if any exists. Copy each with `cp -Rp` into a scratch `…/scratchpad/replay/.claude-tweaks/pipelines/` inside a `git init` root, since the CLI refuses an unanchored run dir.
2. For each copy, run `node plugin/bin/timing-at-close.js --run <copy>` from the worktree, with `CLAUDE_CONFIG_DIR` unset so it reads `~/.claude`, and record the exit code and `totals.tokens`.
3. Independent recount, using code that is not `readUsage`: over the depth-1 agent files whose first line names exactly that run id, take unique `message.id`, the max of each usage field per id (one line per content block repeats the turn's usage), and keep rows inside `[min(runIdTs, createdAt, firstEvent), max(updatedAt, lastEvent)]`. Compare with step 2. They must be equal, or each difference must be explained by name.
4. Negative control: one copy's run id renamed (directory basename changed) gets no token totals and one SKIP naming the extended reason.

Write the full output with a plain Bash redirect to `"$EV/dispatched-attribution-replay.txt"`. Then add one `log-decision.js --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-21T181802-spec-5647" --section "/build" --status AUTO --step "AC evidence" --text-file {file}` entry whose single line names `AC1.1`, the command shape, the per-run match counts, and the evidence path.
