# Standard-lane run graph design — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write `docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md` — a draft design for a code function that chooses each pipeline run's steps from record facts — from measured per-step cost and yield, adding to `tools/step-yield-report.js` the per-run, per-lane rows that measurement needs.

**Architecture:** Task 1 is the only code: `tools/step-yield-report.js` gains a lane rule, per-run rows, a run window and a per-lane per-step table, behind new flags, with tests in `tests/step-yield-report.test.js`. Tasks 2-7 write the design doc in the order the record's Technical Approach fixes (evidence, vocabulary, function and assertions, loops, roster replacement, phases), each section built from the repository as it is on `main` and from Task 1's output. Task 8 runs the record's mechanical acceptance checks over the finished doc.

**Tech Stack:** Node 18+ (CommonJS, no dependencies), `node --test`, Markdown.

**Spec:** `.claude-tweaks/pipelines/2026-11-17T060227-record-5580/work/5580-spec.md` (record #5580). Read it in full before any task; every AC below is quoted from it by number.

## Global Constraints

- Nothing under `plugin/` changes (AC1). The diff's own-work files are the doc, `tools/step-yield-report.js` and `tests/step-yield-report.test.js` (plus this run's pipeline bookkeeping: the materialized spec, this plan, the ledger).
- Doc path: `docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md`. Status line: `draft for approval`.
- Doc section shape follows `docs/superpowers/specs/2026-11-15-process-efficiency-design.md` and `docs/superpowers/specs/2026-11-11-pipeline-driver-design.md`: Why, Goals, Non-goals, the design, `## Phase N` sections, Left to the builder, Calls made in this document that were not discussed.
- Every number in the doc has the command that produced it beside it; each command is in the repository or printed whole in the doc (AC2).
- The doc never contains `read through a summary`, `TBD`, `TODO` or `to be decided` (AC15, AC16).
- Do not cite arXiv 2603.22386 unless the section number and a sentence quoted from the paper itself, read at the source, are given (AC15). Default: do not cite it.
- Do not invoke `/superpowers:brainstorming`, `/claude-tweaks:specify` or `/claude-tweaks:capture` for a phase; edit none of #3381, #5292, #5262, #4118 (spec, Technical Approach and Gotchas).
- "A model-generated graph per task" is in the process-efficiency design's Not planned table: do not reopen it.
- Decision rule for any gap the record leaves (author, 2026-11-16): take the reading that, in order, keeps a run on the previous plugin release working; puts the rule in code, not prose; stays inside the record's Key Files. State each such choice in a "Gap readings" list the PR body will carry.
- Measurements come from the main checkout's pipelines root: `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines` (the tool reads the root and its `archive/`). In the doc, write the command with the placeholder `<main-checkout>/.claude-tweaks/pipelines`, never the machine path.
- Write in plain declarative sentences, the style of the two cited designs. No emojis.
- Governing project skills (quoted from `.claude/skills/windows-checkout-test-parity/SKILL.md`, which covers any test or code producing a path as an ID): "| A path emitted as an ID in a report, JSON row or glob | `toPosix` at the producer, never on a path later opened with `fs` |" — `runId` is `path.basename(dir)` (no separator, so nothing to convert), and any `dir` field kept in a row is native and never compared as a `/` string in a test. Also from that file: "Define the root once (`RD`) and build every key and every argv value from it with the code's own operation (`path.join(RD, 'decisions.md')`)" — the new tests build every fixture path with `path.join` from one temp root. `.claude/skills/timing-procedure-read-counting` governs `tools/efficiency-report.js`'s read counts only; this plan does not touch them. `.claude/skills/regex-scan-linearity` scopes `plugin/bin/`; the one new regex (`/Express lane check:.*\bproceed\b/`) has a single `.*` and runs per line, so it is linear.
- AC evidence: every scratch (uncommitted) check that verifies an acceptance criterion writes its full output to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-17T060227-record-5580/evidence/{name}.txt` (create the directory first with `mkdir -p`, write with a plain Bash redirect) and logs one `decisions.md` entry: `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.170.0/bin/log-decision.js" --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-17T060227-record-5580" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`, the text file (written with the Write tool) holding one line: the `AC{n}` id, the exact command, the result counts, and the evidence path.

## Review Focus

- A run directory with no `run-state.json`, an unparseable one, or a `config.yml` with no `ceremony-profile`: the tool must still place it (lane `none`, `closed: false`), never throw or drop it silently. Pinned by Task 1's `lane and closed state degrade` test.
- A driver run whose `driver-events.jsonl` has a malformed line or an event with no `usage`: the line counts in `unparsed`, the step's tokens are `null` (never `0`). Pinned by Task 1's `driver steps` test.
- A lane with fewer than `--lane-floor` runs in the whole archive: reported with its count and `belowFloor: true`, never padded or dropped. Pinned by Task 1's `window widening` test.
- A run with `closedAt` null (no events, no `updatedAt`): excluded from the window and counted in `window.undated`, not sorted to either end. Pinned by Task 1's `window widening` test.
- A doc claim that a step is "in every graph" while a fast-lane skip still removes it: Task 4's assertion table must state, for `review-step-1`, `plan-audit` and `plan-review`, whether each is now in every graph (AC8). Checked by Task 8's step 3.

## Spec coverage map

| AC clauses | Covered by |
|---|---|
| AC1.1, AC1.2, AC1.3 | Task 8 Step 1 (Task 1 is the only code; its files are the condition's two) |
| AC2.1, AC2.2, AC2.3, AC2.4, AC2.5, AC2.6 | Task 2 Step 4 (table, date, window ends, per-lane counts, null-cost counts, commands); Task 3 Step 2 (Evidence-row column, "not measured separately") |
| AC3.1, AC3.2, AC3.3, AC3.4, AC3.5, AC3.6, AC3.7, AC3.8, AC3.9, AC3.10, AC3.11 | Task 1 (`laneOf`, `selectWindow`, `driverStepsOf`, the `laneOf` and `window widening` tests); Task 2 Steps 2 and 4 |
| AC4.1, AC4.2, AC4.3, AC4.4, AC4.5, AC4.6 | Task 3 Steps 1-3 and 5 |
| AC5.1, AC5.2, AC5.3, AC5.4, AC5.5, AC5.6, AC5.7, AC5.8, AC5.9 | Task 4 Step 1 |
| AC6.1, AC6.2, AC6.3, AC6.4, AC6.5 | Task 4 Steps 2 and 4 |
| AC7.1, AC7.2, AC7.3, AC7.4, AC7.5 | Task 4 Step 3 |
| AC8.1, AC8.2, AC8.3, AC8.4, AC8.5, AC8.6, AC8.7, AC8.8 | Task 4 Step 5 |
| AC9.1, AC9.2, AC9.3, AC9.4 | Task 5 |
| AC10.1, AC10.2 | Task 6 Step 2 |
| AC11.1, AC11.2, AC11.3, AC11.4, AC11.5, AC11.6, AC11.7 | Task 6 Step 3 |
| AC12.1, AC12.2, AC12.3, AC12.4, AC12.5 | Task 6 Step 1; Task 3 Step 2; Task 4 Step 3b |
| AC13.1, AC13.2, AC13.3, AC13.4, AC13.5, AC13.6, AC13.7 | Task 4 Step 3; Task 3 Step 4; Task 7 Step 3 |
| AC14.1, AC14.2 | Task 7 Step 1; Task 2 Step 3 |
| AC15.1, AC15.2, AC15.3 | Task 8 Step 2 |
| AC16.1, AC16.2, AC16.3 | Task 7 Steps 3-4; Task 8 Step 2 |
| AC17.1, AC17.2, AC17.3, AC17.4 | Task 2 Step 1; Task 7 Steps 2 and 4; Task 6 Step 1 |
| AC18.1, AC18.2 | Task 4 Step 3; Task 7 Step 4 |

Files the build only reads (each named by the step that reads it):

Waived tests/efficiency-report.test.js: Task 1 sizes its new tests against it (read only).
Waived flow/steps-and-gates.md: Task 3 Steps 1 and 4 and Task 5 Step 1 read `plugin/skills/flow/steps-and-gates.md`.
Waived plugin/skills/build/SKILL.md: Task 3 Step 1 reads its step headings; Task 7 Step 4 measures its bytes.
Waived plugin/skills/test/SKILL.md: Task 3 Step 1 and Task 5 Step 1 read it.
Waived plugin/skills/review/code-mode-steps.md: Task 3 Step 1, Task 5 Step 1 and Task 7 Step 4 read it.
Waived plugin/skills/wrap-up/SKILL.md: Task 3 Step 1 reads its step headings.
Waived docs/driver.md: Task 5 Step 1 reads "One fix round".
Waived plugin/bin/lib/driver/steps.js: Task 5 Step 1 reads `CI_WAIT_BOUND_MS` and `VERIFY_TIMEOUT_MS`.
Waived plugin/skills/review/step3-routing.md: Task 5 Step 1 reads its bounds.
Waived plugin/skills/build/dispatch.md: Task 5 Step 1 reads its bounds.
Waived plugin/skills/build/plan-review.md: Task 5 Step 1 reads its round bound.
Waived plugin/skills/_shared/pr-first-merge.md: Task 5 Step 1 reads the CI wait bound.
Waived docs/superpowers/specs/YYYY-MM-DD-standard-lane-run-graph-design.md: the record's placeholder name; Task 2 creates it as `docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md`.
Waived plugin/skills/dispatch/SKILL.md: Task 7 Step 4 measures its bytes.
Waived plugin/skills/flow/SKILL.md: Task 7 Step 4 measures its bytes.
Waived plugin/skills/_shared/auto-mode-contract.md: Task 4 Step 5 reads its HARD-GATE row; Task 7 Step 4 measures its bytes.
Waived tests/ceremony-profile-roster.test.js: Task 6 Step 2 states its disposition (read only).
Waived plugin/bin/drive.js: Task 6 Step 1 reads it for the walker comparison.
Waived docs/reference/step-yield.md: read at plan time to confirm the step-yield assumption (logged in decisions.md).

---

### Task 1: Per-run rows, lane rule and per-lane step table in `tools/step-yield-report.js`

**Review risk:** high

**Files:**
- Modify: `tools/step-yield-report.js`
- Test: `tests/step-yield-report.test.js`

**Interfaces:**
- Consumes: `deriveStepYield`, `STEP_YIELD_FILE`, `SCHEMA_VERSION` (`plugin/bin/lib/timing/step-yield.js`); `parseEntry` (`plugin/bin/lib/log-decision/append.js` — returns `{ location, action, … }` for a log line, `null` otherwise; read-only use, `plugin/` is not edited); `parseFlatLines` (`plugin/bin/lib/policy-schema.js`, as `tools/efficiency-report.js` uses it to read `config.yml`); the existing `yieldOf(dir, deps)` and `listRunDirs`.
- Produces (exported from `tools/step-yield-report.js`, used by Tasks 2-4 through the CLI):
  - `RUN_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{6}-(spec|record|drive)-/`
  - `laneOf(dir, fsImpl) -> { lane: string, source: 'driver-events' | 'express-check' | 'config' | 'none' }`
  - `closedStateOf(dir, fsImpl) -> { closed: boolean, closedAt: string | null }`
  - `driverStepsOf(dir, fsImpl) -> { steps: Array<{ name, count, minutes, tokens: number|null, failed: number }>, unparsed: number } | null`
  - `runRow(dir, deps) -> { runId, closed, closedAt, lane, laneSource, yieldSource, steps: StepRow[], driverSteps }` where `StepRow = { name, ran: boolean, minutes: number, tokens: number|null, agents: number|null, commits: number, fixCommits: number, verifyFail: number, raised: number, confirmed: number }`
  - `selectWindow(rows, { window, laneFloor }) -> { oldest, newest, undated, runs: Row[], lanes: { [lane]: { rows: Row[], inWindow, used, widened, archiveTotal, belowFloor, oldest, newest, nullCost } } }` — `runs` is the window (the N newest); `lanes[lane].rows` is the rows that lane's numbers use (its in-window rows, or its widened set), so `used === rows.length`
  - `stepTable(selection) -> { [lane]: { [step]: { runs, ranRuns, minutes: { median, sum }, tokens: { median, sum, nullRuns }, agents: { median, sum, nullRuns }, outcome: { confirmedRuns, verifyFailRuns, commitRuns, fixCommitRuns, anyRuns } } } }` — reads `selection.lanes[lane].rows`, never `selection.runs`
  - CLI: `node tools/step-yield-report.js <pipelines-root>... [--json] [--runs] [--window <N>] [--lane-floor <M>]`. `--runs` adds `runs` (every row) to the JSON summary; `--window N` adds `window` (from `selectWindow`, `laneFloor` default 20) and `stepTable`; the text render adds one line per lane (`lane {name}: {used} runs ({inWindow} in window{, widened}{, below floor}) {oldest} .. {newest}`) and one line per lane-step. Without the new flags the output is byte-identical to today's (existing tests must pass unchanged).

Rules the code must implement exactly (from AC3's Decided paragraph):
- **Lane:** `driver-events.jsonl` present → `driver` (`driver-events`). Otherwise `express` (`express-check`) when the top-level `decisions.md` holds a proceed entry that no later escalation entry for the same record cancels — the reading `plugin/bin/lib/express/cli.js`'s `hasProceed` applies ("A proceed line counts only when no escalation for the same record follows it"), mirrored here because that function is not exported and `plugin/` is not edited: walk the lines in order through `parseEntry`; an entry with `location === 'Express lane check'` and `action` matching `/^#(\d+) proceed/` sets record N proceeded; one with `location === 'Express lane'` and `action` starting `escalated #N to /flow` clears it; `express` when any record is still proceeded at the end. Otherwise `config.yml`'s `ceremony-profile` value (`config`), or `none` when the file or key is absent or unreadable (`none`).
- **Closed:** `run-state.json` parses and `status === 'clean'`. **closedAt:** the latest parseable `ts` in `events.jsonl`, else `run-state.json`'s `updatedAt`, else `null`.
- **Yield steps:** one `StepRow` per `steps[]` entry of the run's yield; `ran` = `minutes > 0` or any `events`/`decisions` count above 0; `tokens` = sum of `tokens.{input,output,cacheRead,cacheCreate}` or `null` when `tokens` is `null`; `commits` = `commits.commit` only (the yield's other commit actions — `push`, `apply`, `rm`, `mv`, `update-ref` — are not commits); `fixCommits` = `commits` when the phase is not one of `build`, `plan`, `tasks` (whose commits are the run's product), else 0; `raised` = `findings.raised`; `confirmed` = `findings.both + findings.tiebreak.byVerdict.confirmed` (0 when `findings` is null).
- **Driver steps:** group `driver-events.jsonl` lines by `step`, skipping `final` and `budget`; `minutes` = summed `ms` / 60000; `tokens` = summed `usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}`, `null` when no event of the step carries `usage`; `failed` = events whose `status` is neither `ok` nor `skip`; a line that is not a JSON object with a string `step` counts in `unparsed`. Driver rows' `steps` stay the yield's; `driverSteps` holds these.
- **Window:** candidates are rows with `closed` and `RUN_NAME_RE.test(runId)` and a non-null `closedAt` (null `closedAt` counts in `undated`). Sort by `closedAt` descending; the window is the first `N`. A lane with fewer than `laneFloor` runs in the window is widened to its own `laneFloor` most recent candidates (`widened: true`); a lane with fewer than `laneFloor` candidates in total is reported with `archiveTotal` and `belowFloor: true`. `nullCost` = runs in `lanes[lane].rows` whose every step has `tokens === null` — for the `driver` lane, every `driverSteps` entry (its cost source); for every other lane, every yield `steps` entry.
- **stepTable:** per lane, over `lanes[lane].rows`. The driver lane is keyed by `driverSteps` names (`agents` is `null` there, `outcome.verifyFailRuns` counts `failed > 0`, `fixCommitRuns` is 0); every other lane by yield phase names. `outcome.anyRuns` counts runs where the step had `confirmed > 0`, `verifyFail > 0` or `fixCommits > 0` (AC13's "a confirmed finding, a failed gate, a fix commit" as the yield data can count it; a gate stop that exists only as decision-log prose — a plan-audit hard fail, a plan-review gap, a review Step 1 stop — is not counted, and the doc says so wherever a rule would rest on one). Medians over non-null values; `median` is `null` with no values.

- [ ] **Step 1: Write the failing tests** in `tests/step-yield-report.test.js`, reusing its `buildDerivedRun` and the real writers it already imports. Add:
  - `laneOf: driver events win, then an express proceed line, then config.yml, then none` — four dirs; assert `{lane, source}` is `{driver, driver-events}`, `{express, express-check}`, `{fast-lane, config}`, `{none, none}`; a fifth dir whose `decisions.md` has `Express lane check: #1 escalate` and `ceremony-profile: standard` → `{standard, config}`; a sixth dir whose `decisions.md` holds an `Express lane check: #7 proceed — …` entry followed by an `Express lane: escalated #7 to /flow …` entry, with `ceremony-profile: standard` → `{standard, config}` (write the entries with `formatEntry`, `step: 'Express lane check'` / `'Express lane'`). Deleting the escalation branch must turn the sixth case red.
  - `lane and closed state degrade` — a dir with no `run-state.json` and no `config.yml` → `closedStateOf` `{closed: false, closedAt: null}`, `laneOf` `{none, none}`; a dir with `run-state.json` `{"status":"clean","updatedAt":"2026-11-10T00:00:00.000Z"}` and no events → `{closed: true, closedAt: '2026-11-10T00:00:00.000Z'}`; with events, `closedAt` equals the latest event `ts`.
  - `driver steps sum ms and usage per step, tokens null without usage, malformed lines unparsed` — a `driver-events.jsonl` with two `worker` lines (`ms` 60000 and 120000, usage input 1/output 2/cache_read 3/cache_creation 4 on each), one `test` line with no `usage` and `status: 'fail'`, one `final` line, one line `not json` → `worker` `{count: 2, minutes: 3, tokens: 20, failed: 0}`, `test` `{tokens: null, failed: 1}`, no `final` step, `unparsed: 1`.
  - `runRow maps a derived yield to step rows` — the existing derived run with a clean `run-state.json`: the `review` row has `ran: true`, `raised: 3`, `confirmed` equal to `both` plus the confirmed tiebreak count the existing totals test asserts.
  - `commits count the commit action only, and only after the build is a fix` — a yield (deps.derive stubbed to return it) whose `build` step has `commits: { commit: 2, push: 1 }` and whose `review` step has `commits: { commit: 1, push: 1, rm: 1 }` → `build` `{commits: 2, fixCommits: 0}`, `review` `{commits: 1, fixCommits: 1}`.
  - `window widening` — rows built directly (no fs): 6 `standard`, 1 `fast-lane` closed runs with distinct `closedAt`, plus 2 older `fast-lane`, 1 undated, 1 not closed, 1 named `2026-11-01T000000-wrap-up-standalone`; `selectWindow(rows, {window: 5, laneFloor: 3})` → window `runs` has the 5 newest, `lanes['fast-lane']` `{inWindow: 1, used: 3, widened: true, belowFloor: false}` with `rows.length === 3`, `undated: 1`; with `laneFloor: 4`, `fast-lane` is `belowFloor: true, archiveTotal: 3`.
  - `stepTable counts outcome-changing runs per lane and step` — two `standard` rows whose `review` step has `confirmed` 1 and 0 and `verifyFail` 0 → `outcome.confirmedRuns: 1`, `anyRuns: 1`, `runs: 2`; a step whose rows all have `tokens: null` → `tokens.median: null, nullRuns: 2`; a `build` step with `commits: 1, fixCommits: 0` in every row → `anyRuns: 0`.
  - `stepTable reads a widened lane's own rows` — the `window widening` fixture with `laneFloor: 3`: `stepTable(sel)['fast-lane']`'s step `runs` is 3, not 1 (pins that `stepTable` reads `lanes[lane].rows`, not `runs`).
  - `driver nullCost follows driver steps` — a `driver` row whose yield `steps` all have `tokens: null` but whose `driverSteps` carry tokens → not counted in `nullCost`; a `driver` row whose `driverSteps` all have `tokens: null` → counted.
  - `the CLI without the new flags prints exactly what it printed before` — run the existing fixture root with `--json` and assert the parsed object has no `runs`, `window` or `stepTable` keys; with `--runs --window 2 --json` it has all three.
  - `--window takes a positive integer` — `--window 0`, `--window x` and `--lane-floor -1` each exit 2 with a usage line on stderr.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/step-yield-report.test.js`
Expected: FAIL — `laneOf is not a function` (and the CLI tests failing on the missing keys).

- [ ] **Step 3: Implement the functions and flags above in `tools/step-yield-report.js`.** Keep `collect` and `render` unchanged for the no-flag path; build rows in a second pass over `listRunDirs` only when `--runs` or `--window` is given (a run that throws while building its row counts in `runsFailed` with one stderr line, as `collect` does). Update the file's header comment: usage line, the lane and closed rules, and the exit codes (2 also for a malformed flag value).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/step-yield-report.test.js`
Expected: PASS, every test including the nine existing ones.

- [ ] **Step 5: Prove the new tests discriminate.** Temporarily swap the lane order in `laneOf` (config before express) and re-run: the `laneOf` test must fail; restore. Temporarily drop the widening branch in `selectWindow`: the `window widening` test must fail; restore.

- [ ] **Step 6: Real-input probe with an independent count.** Run the finished tool on the real archive:

Run: `node tools/step-yield-report.js "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines" --json --runs > {scratchpad}/runs.json`
Expected: exit 0. Then reconcile against counts the tool did not compute: (a) the number of `runs` rows with `lane: 'driver'` equals the number of run directories holding a `driver-events.jsonl` (`ls -d "<root>"/archive/*/driver-events.jsonl "<root>"/*/driver-events.jsonl | wc -l`); (b) the rows with `lane: 'express'` are exactly the non-driver directories whose `decisions.md` holds `Express lane check: #N proceed` (`grep -l -E "Express lane check: #[0-9]+ proceed" "<root>"/archive/*/decisions.md "<root>"/*/decisions.md` — at plan time this listed 7 directories, 3 of them `drive-`); (c) the row for `archive/2026-11-12T190721-drive-4351` has a `worker` driver step with `count: 1`, `minutes` = 1081739 / 60000 and non-null `tokens`. Record the three reconciliations in the commit message body. A mismatch is a bug to fix before committing.

- [ ] **Step 7: Commit**

```bash
git add tools/step-yield-report.js tests/step-yield-report.test.js
git commit -m "Add per-run lane rows and a per-lane step table to step-yield-report — refs #5580"
```

---

### Task 2: Doc skeleton and Evidence section

**Role:** judgment

**Files:**
- Create: `docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md`

**Interfaces:**
- Consumes: Task 1's CLI.
- Produces: the doc file with these headings, in order, that Tasks 3-7 fill: `# Standard-lane run graph — design`, `## Why`, `## Goals`, `## Non-goals`, `## Evidence`, `## Step vocabulary`, `## Not a step`, `## Today's graph`, `## Inputs`, `## Evaluation points`, `## The selection function`, `## Never skipped`, `## Loops`, `## Who walks the graph`, `## Roster replacement`, `## Mixed-version operation`, `## What this design does not decide`, `## Open records`, `## Phase 0 — Decisions`, `## Phase 1 — …` onward, `## Left to the builder`, `## Calls made in this document that were not discussed`. The Evidence section's per-lane per-step rows carry an id (`E-{lane}-{step}`, e.g. `E-standard-review`, `E-driver-worker`) that Task 3's vocabulary table cites.

- [ ] **Step 1: Record the base commit.** Run `git rev-parse origin/main` (after `git fetch origin main`) and keep the sha; the doc names it as the `main` commit it was written against (AC17).

- [ ] **Step 2: Run the measurement** from the worktree, output to a scratchpad file:

Run: `node tools/step-yield-report.js "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines" --json --runs --window 100 --lane-floor 20 > {scratchpad}/yield.json`
Expected: exit 0; `window.lanes` has at least `standard`; `stepTable` present.

- [ ] **Step 3: Write the header, Why, Goals and Non-goals.** Header block: title, `Status: draft for approval`, date `2026-11-17`, record `#5580`, extends `docs/superpowers/specs/2026-11-11-pipeline-driver-design.md` (Phase 7 of `docs/superpowers/specs/2026-11-15-process-efficiency-design.md`), written against `main` at the Step 1 sha. Why = the record's Current State condensed (four lanes, several selectors, HARD-GATE-inside-a-skip). Goals map to the record's Deliverables 3-7. Non-goals include: this doc builds nothing; no model writes or edits the graph; the prose express lane and the driver's admission and bounds are unchanged; a model-generated graph per task stays not planned.

- [ ] **Step 4: Write `## Evidence`.** State: the date; the command (Step 2's, with `<main-checkout>/.claude-tweaks/pipelines`); the lane rule (AC3's, as the tool applies it); oldest and newest run in the window; run count per lane, which lanes were widened to their own 20 most recent, which are below 20 in the whole archive with their count and the sentence that no rule rests on them; how many runs had `null` cost fields per lane. Then one table per lane: rows `E-{lane}-{step}`, columns runs, ran, median minutes, median tokens, null-token runs, median agents, confirmed-finding runs, verify-fail runs, fix-commit runs, outcome-changing runs. Under the tables, state what "outcome-changing" counts (a confirmed finding, a failed verify, a `commit`-action commit in a step after `build`/`plan`/`tasks`) and what it cannot see (gate stops recorded only as decision-log prose: plan-audit hard fails, plan-review gaps, review Step 1 stops), so no "evidenced" rule rests on those. Driver lane rows are keyed by driver step names and come from `driver-events.jsonl` (`ms`, `usage`). Add the caveat paragraph: numbers come from one machine; cloud routine runs are not in its run directories, and this repository's own development sessions are most of them; consumer projects on older releases are not seen.

- [ ] **Step 5: Verify**

Run: `grep -c "^| E-" docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md`
Expected: a count equal to the number of lane-step entries in `stepTable` of `yield.json`.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md
git commit -m "Start the standard-lane run graph design with its evidence — refs #5580"
```

---

### Task 3: Step vocabulary, Not a step, and Today's graph

**Role:** judgment

**Files:**
- Modify: `docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md` (`## Step vocabulary`, `## Not a step`, `## Today's graph`)

**Interfaces:**
- Consumes: Task 2's `E-{lane}-{step}` row ids.
- Produces: the closed list of vocabulary step names (lower-case, hyphenated, e.g. `plan`, `plan-audit`, `plan-review`, `tasks`, `whole-branch-review`, `simplify`, `verify`, `review-code`, `polish`, `wrap-up`, `merge`) that Tasks 4-7 use verbatim. Choose the final names here; later tasks must not invent new ones.

- [ ] **Step 1: Collect every name to place.** From: `flow/steps-and-gates.md`'s Allowed Steps table; the step headings of `plugin/skills/build/SKILL.md`, `plugin/skills/test/SKILL.md`, `plugin/skills/review/code-mode-steps.md`, `plugin/skills/wrap-up/SKILL.md`; `PHASES` and `NESTED_PARENT` in `plugin/bin/lib/timing/derive.js`; `STEP_NAMES` in `plugin/bin/lib/driver/events.js`; the rows of `## Skips by profile` and `## Never skipped` in `plugin/skills/_shared/ceremony-profile.md` (the ten skip tags include `review-step-1`, `review-step-1.6`, `review-step-4`, `plan-audit`, `plan-review`, `architecture-alignment`, `reflect-light-mode`, `red-team-persona`, `sdd-whole-branch-review`, `polish`). Write the list to a scratchpad file, one name per line with its source.

- [ ] **Step 2: Write `## Step vocabulary`** — one table, headed exactly "Step vocabulary": name, what the step does, performer (program or model), the skill or CLI that is its body today, what it produces, reads (run-directory files and earlier steps' outputs it consumes), today's model profile where one is set (record it, change none — #4030), and Evidence row (an `E-…` id from Task 2, or "not measured separately"). A vocabulary step is the smallest unit the function may include or leave out on its own; anything that always runs with its parent is part of the parent.

- [ ] **Step 3: Write `## Not a step`** — table: name, source, reason (expect `call-1`..`call-N` as dispatch-call containers and `red-team-persona` as a `/claude-tweaks:specify` step that runs before any run; the extra `timing.json` phases `call-3`..`call-6`, `specify`, `visualize`, `dispatch` too). Then a "Placement list" subsection: every name from Step 1, each mapped to a vocabulary step, "part of {step}", or "Not a step". Note under it that the `## Mentions that are not skips` rows are covered by `## Roster replacement`, not here.

- [ ] **Step 4: Write `## Today's graph`** — the steps a run takes today for each combination of profile (`standard`, `fast-lane`, prose express, driver) and the selectors in the record's Current State (UI-changed `stories`, non-frontend `polish` skip, `micro-plan.md` plan-writing skip, review effort, `resolve-profile.js --diff-facts`, `plan-audit.js --count-tasks` single-task whole-branch-review skip, wrap-up's `ceremony-derive.js` narrowing). Each cell cites the file that states it.

- [ ] **Step 5: Verify placement is complete.** For every name in the Step 1 scratchpad list, `grep -F` it in the doc's Placement list; save the result as the "placement list, none unplaced" block the PR body will carry.

Run: `grep -n "^## Step vocabulary\|^## Not a step\|^## Today's graph" docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md`
Expected: three lines.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md
git commit -m "Add the step vocabulary and today's graph to the run graph design — refs #5580"
```

---

### Task 4: Inputs, evaluation points, the function, and Never skipped

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md` (`## Inputs`, `## Evaluation points`, `## The selection function`, `## Never skipped`)

**Interfaces:**
- Consumes: Task 3's vocabulary names; Task 2's Evidence rows.
- Produces: the function's name and signature (e.g. `selectRunGraph(facts, { at, previous }) -> string[]`), the policy value name that gates any rule giving fewer steps than today (Task 7's phases use it), and the assertion ids (`A1`…) Task 6's mixed-version table cites.

- [ ] **Step 1: Write `## Inputs`** — one row each for type, size, risk, surface, changed paths, task count, and any input added (the `ceremony:*` label, `Risk-flags:`, Phase 4 unit 4.2's gate verdict as an input, not a second selector): source (label family or body line, and the function that parses it today — e.g. `parseRecordFacets`, `classifyDiffFiles` in `plugin/bin/lib/issues/blast-radius.js`, `computeDiffFacts` in `plugin/bin/lib/dispatch/ceremony-derive.js`, `plan-audit.js --count-tasks`), when first known (before the run / after the plan / after the build), result when absent, unreadable or outside its vocabulary (`size:small` is the worked example), and the most cautious value (the one returning the most steps). Changed paths enter only as a closed set of classes, with the path-to-class mapping. Task count is an integer against stated thresholds; anything not a non-negative integer counts as absent. State the union rule: a step is in the graph when any input's rule requires it. State that a fact that does not exist yet at an evaluation point is not absent.

- [ ] **Step 2: Write `## Evaluation points`** — the points the function is evaluated (at least: before the run, after the plan, after the build); a later evaluation may add steps to the remainder or leave it unchanged; if it may remove a step, list which and why; an asserted step is never removed.

- [ ] **Step 3: Write `## The selection function`** — signature; output is a list of vocabulary step names; no input is free text; each model-judgment or record-text input (`ceremony:*`, `Risk-flags:`) with its closed value set and a demonstration that no value removes an asserted step; the statement that safety rests on the assertions, not input accuracy, and what corrects a wrong label after a run. Every rule that leaves a step out or shortens one carries exactly one mark — "evidenced" (citing an Evidence rate over at least 20 runs in which the step ran, with the run count), "risk accepted" (with n; also listed in Phase 0), or "unchanged from today" (checked against `## Today's graph`). Each existing selector from the record's Current State is carried over, replaced or dropped, said which. For each evidenced or risk-accepted rule: the policy value that turns it on, that its default reproduces today's graph, and the condition under which the default changes or the value is removed (AC18).

- [ ] **Step 3b: Write the absent-output paragraph** (AC12 second part), now that Step 3 fixed which steps the function can leave out: in `## The selection function`, for every vocabulary step some rule can leave out, name each kept step that reads its output (Task 3's "reads" column) and what that reader does when the output is absent (cite the file that says so).

- [ ] **Step 4: Count today's ready records per graph** (AC6). Write a short Node script, printed whole in the doc, that reads `gh issue list --label ready --state open --limit 1000 --json number,labels,body` from stdin and applies the function's first-evaluation rules; run it, report how many records get each distinct graph, and state the expected effect on #4031's two targets (median wall time of 15 minutes or less, 120 round trips or fewer) as an expectation, including the case where most records keep today's graph.

Run: `gh issue list --repo thn-inc/claude-tweaks --label ready --state open --limit 1000 --json number,labels,body > {scratchpad}/ready.json` then `node {scratchpad}/graph-count.js < {scratchpad}/ready.json`
Expected: counts that sum to the number of records in `ready.json`.

- [ ] **Step 5: Write `## Never skipped`** — every row of the roster's `## Never skipped` table and every stop in `plugin/skills/_shared/auto-mode-contract.md`'s "HARD-GATE / BLOCKED / STOP conditions" row appears, kept or in a dropped list with a reason. Each kept row: id `A{n}`, the assertion as a condition on the function's output, the reason, and the violation handling per AC8's Decided paragraph (first evaluation: refuse the run with one line naming the assertion, nothing written; later evaluation: keep the previous remainder, log one `SKIP` naming the assertion). State for `review-step-1`, `plan-audit` and `plan-review` whether each step is now in every graph. Separate "a step that must be in every graph" from "a stop that must fire when its step is in the graph".

- [ ] **Step 6: Verify**

Run: `grep -c '"evidenced"\|risk accepted\|unchanged from today' docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md`
Expected: at least one per leave-out or shorten rule in `## The selection function`.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md
git commit -m "Add the selection function, its inputs and assertions to the run graph design — refs #5580"
```

---

### Task 5: Loops

**Role:** judgment

**Files:**
- Modify: `docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md` (`## Loops`)

**Interfaces:**
- Consumes: Task 3's vocabulary names.
- Produces: nothing later tasks depend on beyond the section.

- [ ] **Step 1: Find each bound.** Starting points (record's Technical Approach): polish re-verify at most once per run (`flow/steps-and-gates.md`, "Re-verify one-cycle cap"); driver reviewer one fix round (`docs/driver.md`, "One fix round"); `CI_WAIT_BOUND_MS` and `VERIFY_TIMEOUT_MS` in `plugin/bin/lib/driver/steps.js` (30 minutes each); the rest in `plugin/skills/review/step3-routing.md`, `plugin/skills/review/code-mode-steps.md`, `plugin/skills/build/dispatch.md`, `plugin/skills/build/plan-review.md`, `plugin/skills/test/SKILL.md`, `plugin/skills/_shared/pr-first-merge.md`. Read each value from the file; do not copy it from the record.

- [ ] **Step 2: Write `## Loops`** — one table headed "Loops", rows at least: review fix wave, verify retry, plan-review rounds, polish re-verify, driver reviewer fix round, CI wait. Columns: loop, steps it repeats, proposed bound (a count or a time), outcome when the bound is reached, today's bound, file that states today's bound. No row's bound is "until green" or empty. Close with the sentence that the graph has no other cycle, and why.

- [ ] **Step 3: Verify**

Run: `grep -n -i "until green" docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md`
Expected: no line inside the Loops table.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md
git commit -m "Add bounded loops to the run graph design — refs #5580"
```

---

### Task 6: Walker choice, roster replacement and mixed-version operation

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md` (`## Who walks the graph`, `## Roster replacement`, `## Mixed-version operation`)

**Interfaces:**
- Consumes: Task 4's function name, policy value and assertion ids.
- Produces: the walker choice and the old form's removal condition, which Task 7's phases depend on.

- [ ] **Step 1: Write `## Who walks the graph`** — compare at least (a) `drive.js` walking it with model workers for the judgment steps and (b) `/claude-tweaks:flow` calling the function and walking the result; give the choice and its reason; quote each Non-goal and Anti-goal of `docs/superpowers/specs/2026-11-11-pipeline-driver-design.md` the choice changes. State whether the run graph has a prose contract with pinned tests or code as its statement of record with a usage page (AC17), against the driver's no-prose-contract Anti-goal.

- [ ] **Step 2: Write `## Roster replacement`** — what happens to each of: the roster's three tables (`## Skips by profile`, `## Never skipped`, `## Mentions that are not skips`), the `ceremony:*` labels, the `config.yml` `ceremony-profile` key, the `ceremony-check` mode, `plugin/bin/lib/dispatch/ceremony-derive.js`, the wrap-up Ceremony escape hatch, `tests/ceremony-profile-roster.test.js`, and `docs/decisions/0006-ceremony-tiering-owned-by-specify.md`. Each: kept, replaced (by what), or removed (under what condition). Follow process-efficiency Decision 0.1: add, migrate consumers, remove under a recorded condition.

- [ ] **Step 3: Write `## Mixed-version operation`** — a table with at least: a run started on the previous release and continued by the new code at each resume point (the second dispatch call, `/claude-tweaks:flow #N wrap-up`, the close and reconcile paths); a run started on the new release and continued by a previous-release session; a record labelled `ceremony:fast-lane` before the change and built after it. Columns: case, what the reader finds in the run directory, what it does. No row ends in a failed or restarted run. Then the old form's removal condition: the current value of what it counts (measure it with a command printed whole or from Task 1's tool), what drives it to the condition, its data source, and what that source cannot see (cloud routine runs, other machines, consumer projects on an older release).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md
git commit -m "Add walker choice, roster replacement and mixed-version plan to the run graph design — refs #5580"
```

---

### Task 7: Scope, open records, decisions and phases

**Role:** judgment

**Files:**
- Modify: `docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md` (`## What this design does not decide`, `## Open records`, `## Phase 0 — Decisions`, `## Phase N` sections, `## Left to the builder`, `## Calls made in this document that were not discussed`)

**Interfaces:**
- Consumes: Tasks 4 and 6 (policy value, assertion ids, walker, removal condition).
- Produces: the finished doc.

- [ ] **Step 1: Write `## What this design does not decide`** — the doc builds nothing; the prose express lane and the driver's admission and bounds for express-sized records are unchanged; anything else deliberately left open.

- [ ] **Step 2: Write `## Open records`.** Look up each with `gh issue view {n} --json state,title`: #3381, #5292, #5262, #4118, #5232, #5225 (and its open sub-issues: `gh issue list --search "parent:5225"` or the sub-issues API), #4030, and any open record for Phase 4 or Phase 6 of the process-efficiency design (search open issues for "process-efficiency" in the fingerprint line). Table: record, state, title, disposition — superseded by Phase N, waited for by Phase N, or independent — with one line of reason.

- [ ] **Step 3: Write `## Phase 0 — Decisions`** in the form of the process-efficiency design's Phase 0: each maintainer-only decision (every "risk accepted" rule from Task 4 among them) with a recommendation.

- [ ] **Step 4: Write `## Phase 1` onward.** Each phase states what it builds, the files it touches, its done criterion, what it waits for, and what it is expected to move on #4031's targets (as an expectation). The phase that opts this repository in is separate and waits for the release that carries the rule. A phase that adds text to a skill file of 47,250 bytes or more says what it removes from that file — measure each with `wc -c` on the file at the base sha (`plugin/skills/review/code-mode-steps.md`, `plugin/skills/dispatch/SKILL.md`, `plugin/skills/flow/SKILL.md`, `plugin/skills/build/SKILL.md`, `plugin/skills/_shared/auto-mode-contract.md`). A phase that rewords the roster or a citing file says the full suite must pass and names `.claude/skills/skill-prose-conformance-tests` and `.claude/skills/shared-contract-extraction`; one that adds a driver step, a policy key or a removal names `.claude/skills/driver-step-addition`, `.claude/skills/policy-key-addition`, `.claude/skills/removal-condition-execution`. Phases are written so `/claude-tweaks:specify` can decompose them; this record files no record for a phase.

- [ ] **Step 5: Write `## Left to the builder` and `## Calls made in this document that were not discussed`** — the latter lists every choice the doc made under the record's decision rule (the "Gap readings").

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md
git commit -m "Add scope, open records, decisions and phases to the run graph design — refs #5580"
```

---

### Task 8: Acceptance checks over the finished doc

**Role:** integration

**Files:**
- Modify (only if a check fails): `docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md`

**Interfaces:**
- Consumes: every earlier task.
- Produces: the check outputs the PR body quotes.

- [ ] **Step 1: AC1**

Run: `git ls-files 'docs/superpowers/specs/*-standard-lane-run-graph-design.md'`
Expected: one path.
Run: `git diff --name-only origin/main...HEAD -- plugin/`
Expected: no output.

- [ ] **Step 2: AC15 and AC16 greps**

Run: `git grep -n -F "read through a summary" -- 'docs/superpowers/specs/*-standard-lane-run-graph-design.md'`
Expected: no output.
Run: `git grep -n -E "TBD|TODO|to be decided" -- 'docs/superpowers/specs/*-standard-lane-run-graph-design.md'`
Expected: no output.
Run: `git grep -n "2603.22386" -- 'docs/superpowers/specs/*-standard-lane-run-graph-design.md'`
Expected: no output (or, if present, a section number and a quoted sentence beside it).

- [ ] **Step 3: Walk AC2-AC18 against the doc.** For each AC, write one line to a scratchpad checklist: the doc heading that meets it, or the gap. Fix any gap in the doc. Check specifically: every Evidence number has its command; the three fast-lane HARD-GATEs (`review-step-1`, `plan-audit`, `plan-review`) each have an every-graph statement; every leave-out rule has one mark; every Loops row has a numeric bound and a cited file; the mixed-version table has every required row; the doc names the base `main` sha.

- [ ] **Step 3b: Persist the AC evidence.** Write Steps 1-3's outputs (the AC1 commands, the AC15/AC16 greps, the AC2-AC18 checklist, Task 3's placement result for AC4) to `evidence/` files and one `AC evidence` decision entry each, per Global Constraints. Absence-grep controls: before relying on each empty grep, run it once against a file that holds the target (e.g. `printf 'TBD\n' | grep -E "TBD|TODO|to be decided"` and `git grep -n -F "read through a summary" -- docs/superpowers/specs/2026-11-15-process-efficiency-design.md` or a scratch file holding the phrase) and record that it matches.

- [ ] **Step 4: Run the touched test suite**

Run: `node --test tests/step-yield-report.test.js`
Expected: PASS.

- [ ] **Step 5: Commit any fixes**

```bash
git add docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md
git commit -m "Close acceptance gaps in the run graph design — refs #5580"
```
