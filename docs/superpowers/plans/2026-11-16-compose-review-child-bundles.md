# Compose Review and SDD Child Bundles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make review-phase skill-file reads measurable per file, deliver `/review`'s code-mode procedure and its lens-dispatch procedure as composed bundles read once, and give review lens children and SDD children a registered, composed bundle for the `_shared` content their prompts cite.

**Architecture:** Measurement first (Tasks 1-5): the timing pipeline (`plugin/bin/lib/timing/`) gains a per-file procedure-read count (Read tool calls plus `cat`/`sed`/`grep`/... Bash reads of skill paths), carried per phase into `timing.json` (subagent reads included, attributed by dispatch start time), and `tools/efficiency-report.js` reports the review phase per file (Task 4) and recounts archived runs from their transcripts, all phases, to give the per-run baseline the spec's Q1 Decision calls for (Task 5). Then the review procedure (Tasks 6-7): Step 6.7's lazily-needed body moves out of `review/code-mode-steps.md` (52,358 B, 142 B under the 52,500 B Read rail) so the file composes comfortably under the rail, and two hand-written `--step` compose lines replace the raw reads of `code-mode-steps.md` and `step3-lens-dispatch.md`. Then (Task 8), two new phases in `plugin/bin/lib/compose-context/phases.js` — `review-lens-child` and `sdd-child` — each with a shipped `--phase` line at its dispatch site. Last (Task 9, controller-run after the final code review), the build runs Task 5's recount over the pre-ship archive, puts the baseline in the PR body, and files the parked measurement record.

**Tech Stack:** Node 18+ CommonJS, `node --test`, skill markdown.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T000452-record-4359/work/4359-spec.md`

## Global Constraints

- Every registered phase has a prose `--phase` line, and `composedRailViolations("plugin")` prints `[]` (the `rail:` suite in `tests/bin-lib/skill-audit/context-cost.test.js`).
- The existing conformance suites pass with no added skips.
- RAIL_BYTES = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`) for every raw skill `.md` and every composed bundle.
- Compose source paths in prose are `"${CLAUDE_PLUGIN_ROOT}/skills/..."`, never `plugin/skills/...` (`tests/skill-prose-plugin-root-invocations.test.js`). A compose call stays on one physical line.
- Every compose call site carries, verbatim: *if the compose command is unavailable or exits non-zero, read the named source files directly.*
- A child-prompt citation of a bundle carries `if that bundle is absent, read \`_shared/{file}\` directly` (`tests/dispatch-prompt-bundle-citations.test.js`'s `FALLBACK_RE`), and says whether the bundle is read once whole up front or on demand (`_shared/subagent-output-contract.md:33`).
- No `<!-- when: -->` fences are added in this plan. Fence survey (measured at plan time): `code-mode-steps.md` has about 2.3 KB fenceable on today's six keys (the pr-first verdict-comment paragraph, the gh cherry-pick lookup). Any marker adds an all-`unresolved` row that composes at 52,516 B before Task 6, over the rail. Fencing would also never drop bytes on a default `pr-first` + `gh` run. The ceremony fast-lane branch has no compose key. Record this in the PR body, not as a fence.
- Commit messages: `{Verb} {what} — {detail}`, body line `refs #4359`.
- AC1 baseline (spec Decision, plan review Q1): AC1's 80% fall is measured against a per-run baseline recounted by the new counter over archived pre-ship transcripts, all phases, for at least 20 `/flow` runs, never against #4027's 398 / 342. AC1 is met at build time when that baseline is in the PR body and one parked measurement record carrying the baseline, the counter command and the 80% bound exists.
- Decision rule for an unsettled reading (spec): keep a run on the previous plugin release working; put the rule in code, not skill prose; stay inside the record's Key Files. State each such choice in the PR body.

## Review Focus

1. A Bash read through a quoted path with spaces (`sed -n '1,40p' "/Users/x/Code Workspaces/r/plugin/skills/review/code-mode-steps.md"`) counts as one read of `skills/review/code-mode-steps.md`. Pinned in Task 1.
2. The installed-cache path (`~/.claude/plugins/cache/m/claude-tweaks/6.170.0/skills/review/x.md`) and the repo path (`plugin/skills/review/x.md`) fold to the same key `skills/review/x.md`, so runs from consumers and from this repo aggregate. Pinned in Task 1.
3. Reading a composed bundle (`{run}/context/review-code-mode.md`) is not a skill-file read. It must not be counted, and no skill path may be counted twice for one Read. Pinned in Task 1, and in Task 2's per-row count.
4. A subagent dispatch whose `startTs` falls in no phase lands in `unattributed`, never in `review`. An older `timing.json` with no `procedureFiles` is skipped by the efficiency report's per-file table instead of being counted as zero reads. Pinned in Tasks 3 and 4.
5. A standalone `/review` (no `$PIPELINE_RUN_DIR`) still gets the whole procedure, from the raw files. Pinned in Task 7's prose test.
6. The recount never writes into the archive: an archived run's `timing.json` is byte-identical after `--recount`. A run whose listed transcripts are all gone is skipped and counted in `skipped`, never recounted as zero reads. Pinned in Task 5.

---

### Task 1: Per-file procedure-read keys

**Files:**
- Modify: `plugin/bin/lib/timing/turn-class.js`
- Test: `tests/bin-lib/timing/turn-class.test.js`

**Interfaces:**
- Produces: `procedureFileKey(filePath: string, worktree: string|null, pathImpl = path) -> string|null`. It returns the `skills/…/*.md` key of a procedure path (`isProcedurePath` true): the posix-normalized path from its first `skills/` segment on. Otherwise it returns `null`.
- Produces: `bashProcedureFiles(command: string, worktree: string|null, pathImpl = path) -> string[]`. Read-shaped segments are those whose head is one of `cat head tail sed awk grep rg ugrep wc`. For every non-flag token in such a segment for which `procedureFileKey` is non-null, it returns that key, one entry per path token, in order. Non-read heads (`git`, `node`, `ls`, `find`, …) contribute nothing. It reuses the existing `splitSegments` / `stripPrefixes` / `tokenize`.
- Both are added to `module.exports`.

- [ ] **Step 1: Write the failing tests**
  - `procedureFileKey folds repo, worktree and cache paths to one skills/ key`: `plugin/skills/review/code-mode-steps.md`, `/w/plugin/skills/review/code-mode-steps.md` with worktree `/w`, and `/Users/u/.claude/plugins/cache/m/claude-tweaks/6.170.0/skills/review/code-mode-steps.md` each return `skills/review/code-mode-steps.md`.
  - `procedureFileKey` returns `null` for `/r/.claude-tweaks/pipelines/x/context/review-code-mode.md`, for `src/a.js`, and for `''`.
  - The win32 variant returns `skills/review/x.md` for `C:\w\plugin\skills\review\x.md` with worktree `C:\w`, under `path.win32`.
  - `bashProcedureFiles counts each skill path a read command names`:
    - `sed -n '1,40p' "/U/Code Workspaces/r/plugin/skills/review/code-mode-steps.md"` returns `['skills/review/code-mode-steps.md']`.
    - `grep -n "Step 3" plugin/skills/review/step3-lens-dispatch.md plugin/skills/review/code-mode-steps.md` returns both keys, in order.
    - `cat a.txt && head -5 plugin/skills/_shared/x.md` returns `['skills/_shared/x.md']`.
    - `git show HEAD:plugin/skills/review/code-mode-steps.md` returns `[]`.
    - `node plugin/bin/x.js plugin/skills/a.md` returns `[]`.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/bin-lib/timing/turn-class.test.js`
Expected: FAIL after Step 1 — `procedureFileKey is not a function`.

- [ ] **Step 3: Implement both functions in `turn-class.js`**

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/bin-lib/timing/turn-class.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `Add per-file procedure-read keys — Read and Bash skill-path reads fold to skills/ keys`

### Task 2: Per-file reads in transcript rows and dispatches

**Files:**
- Modify: `plugin/bin/lib/timing/transcript.js` (`readUsage`, `readDispatches`)
- Test: `tests/bin-lib/timing/transcript.test.js`

**Interfaces:**
- Consumes: `procedureFileKey` and `bashProcedureFiles` from Task 1.
- Produces: every `readUsage` row carries `procedureFiles: { [key]: count }` (`{}` when none). It is counted on the assistant row that holds the `tool_use`: a `Read` adds 1 to `procedureFileKey(input.file_path)`, and a `Bash` adds 1 per entry of `bashProcedureFiles(input.command)`.
- Produces: every `readDispatches` item carries `procedureFiles` (`{}` when none, `null` when `tokens` is `null`). It is summed over the same `keptRows` that its tokens sum.
- Produces: every `readDispatches` item also carries `procedureFileRows: [{ ts, procedureFiles }]`, one entry per kept row whose `procedureFiles` is non-empty, in row order (`[]` when none, `null` when `tokens` is `null`). A kept row with no valid timestamp takes the item's `startTs`. Task 3 joins these per row, so an agent spanning several phases books each read to the phase it happened in.
- Produces: every `readDispatches` item carries `transcriptPath`, the `path.join(subagentsDir, 'agent-{id}.jsonl')` it read (also on a `notFound` item).

- [ ] **Step 1: Write the failing tests**
  - `readUsage counts per-file procedure reads on the tool_use row`. The fixture JSONL has one assistant line with a `Read` of `plugin/skills/review/code-mode-steps.md` and a `Bash` `sed -n '1,9p' plugin/skills/review/code-mode-steps.md`, followed by their two tool_result lines. The assistant row's `procedureFiles` deep-equals `{ 'skills/review/code-mode-steps.md': 2 }`. Every other row is `{}`.
  - `readDispatches sums a subagent's per-file reads`. A fixture agent transcript reads `plugin/skills/_shared/a.md` twice, on two rows with different timestamps. The item's `procedureFiles` deep-equals `{ 'skills/_shared/a.md': 2 }`, its `procedureFileRows` has two entries carrying those two rows' `ts`, and its `transcriptPath` ends with `agent-{id}.jsonl`.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/bin-lib/timing/transcript.test.js`
Expected: FAIL after Step 1 — `procedureFiles` is undefined.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/bin-lib/timing/transcript.test.js tests/bin-lib/timing/golden.test.js`
Expected: PASS. If a golden fixture pins row shapes, update it to the new field.

- [ ] **Step 5: Commit** — `Count per-file procedure reads in transcripts — rows and subagent dispatches carry procedureFiles`

### Task 3: Per-phase per-file reads in timing.json

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/timing/derive.js` (`joinTokens`)
- Modify: `plugin/bin/phase-timing.js` (the call that joins usage rows and dispatches)
- Test: `tests/bin-lib/timing/derive.test.js`, `tests/bin-lib/timing/cli.test.js`, golden fixtures under `tests/fixtures/timing/` as the golden test requires

**Interfaces:**
- Consumes: the row and dispatch `procedureFiles` from Task 2.
- Produces: `joinTokens(phases, usageRows, { dispatchFileReads = [] } = {})`, where `dispatchFileReads` is `[{ ts, procedureFiles }]`.
  - Every phase bucket, `unattributed` and `totals` gains `procedureFiles: { [key]: count }`, with keys sorted ascending.
  - Row counts join by the existing innermost-phase rule.
  - A `dispatchFileReads` entry joins the phase containing its `ts` by the same rule, else `unattributed`. It adds only to `procedureFiles`, never to `rows`, tokens or `toolRoundTrips`.
- `phase-timing.js` passes `dispatchFileReads` built per row: the concatenation of every dispatch item's non-null `procedureFileRows` (Task 2), so a dispatch spanning several phases books each read to the phase containing that row's `ts`. An item whose `transcriptPath` resolves (`fs.realpathSync`, `path.resolve` when that throws) to one of this run's own `--transcript` paths, resolved the same way, contributes nothing: those reads are already main rows. Today `run()` calls `joinTokens` (line 366) before `collectDispatches` (line 381), so move the `collectDispatches` call ahead of `joinTokens` and build `dispatchFileReads` from its `items` (`aggregateDispatches` spreads each item, so `procedureFileRows` and `transcriptPath` survive). A `notFound` dispatches result yields `[]`. Its emitted `timing.json` `phases[i].procedureFiles` and `totals.procedureFiles` are what Tasks 4 and 5 read.

- [ ] **Step 1: Write the failing tests**
  - `joinTokens sums per-file reads per phase, keyed and sorted`. Two rows inside phase `review` carry `{ 'skills/b.md': 1 }` and `{ 'skills/a.md': 2, 'skills/b.md': 1 }`. Then `phases[review].procedureFiles` deep-equals `{ 'skills/a.md': 2, 'skills/b.md': 2 }`, and `Object.keys` is in that order.
  - `joinTokens attributes dispatch reads by start ts and never counts them as rows`. One dispatch entry with `ts` inside `review` adds its counts there and leaves `rows` and `toolRoundTrips` unchanged. One entry with `ts` outside every phase lands in `unattributed.procedureFiles`.
  - `totals.procedureFiles` equals the sum of the main-transcript row counts plus every dispatch entry.
  - In `tests/bin-lib/timing/cli.test.js`: `a dispatch spanning two phases books each read to its own phase` (one agent transcript with one read inside `call-1` and one inside `review` adds 1 to each), and `an agent transcript passed as --transcript is not counted again as a dispatch` (a run passing `subagents/agent-x.jsonl` as `--transcript`, which reads one skill file once, gives `totals.procedureFiles` a count of 1, not 2).

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/bin-lib/timing/derive.test.js`
Expected: FAIL after Step 1 — `procedureFiles` is undefined.

- [ ] **Step 3: Implement in `derive.js`, then wire `phase-timing.js`**

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/bin-lib/timing/`
Expected: PASS. Golden and cli fixtures are updated to carry the new field, with no other field changed.

- [ ] **Step 5: Commit** — `Carry per-file procedure reads per phase into timing.json — dispatch reads attributed by start time`

### Task 4: Review-phase per-file reads in the efficiency report

**Files:**
- Modify: `tools/efficiency-report.js`
- Test: `tests/efficiency-report.test.js`, plus new fixture runs under `tests/fixtures/efficiency-report/archive/`

**Interfaces:**
- Consumes: `timing.json` `phases[].phase === 'review'` and `phases[].procedureFiles` (Task 3).
- A **reached** review phase is a `phases[]` row with `phase === 'review'`, a non-null `start` and `source !== 'unattributed'` (`derive.js` emits a row for every `PHASES` name, so a run that never reached review still has a span-less `review` row). Task 5 uses the same rule.
- Produces in `collectRuns`: each run gains `reviewFiles: { [key]: count } | null`. It is the sum over every reached `review` phase's `procedureFiles`, or `null` when no reached `review` phase carries a `procedureFiles` object.
- Produces in `summarize`: the result gains `reviewFileReads: { runs: N, files: { [key]: { median, total } } }`.
  - `runs` counts only runs whose `reviewFiles` is non-null.
  - `median` is taken over those runs, with a run missing the key counted as 0.
  - Keys are sorted by `total` descending, then by key.
- Markdown gains a `## Review-phase skill-file reads` section after `## By week`. It is a table `| File | Median reads/run | Total reads |` preceded by `runs with per-file data: N`. When N is 0, it prints `no run carries per-file read data` instead of the table.
- `--json` output carries `reviewFileReads`.

- [ ] **Step 1: Write the failing tests**
  - Add three fixture runs whose `timing.json` carry `phases: [{ phase: 'review', start, end, source, procedureFiles: … }]`:
    - `2027-01-07T090000-record-6`, a reached review: `{ 'skills/review/code-mode-steps.md': 4, 'skills/review/step3-lens-dispatch.md': 2 }`
    - `2027-01-08T090000-record-7`, a reached review: `{ 'skills/review/code-mode-steps.md': 2 }`
    - `2027-01-09T090000-record-8`, an unreached review (`start: null`, `source: 'unattributed'`, `procedureFiles: {}`)
  - `review-phase per-file reads: median over runs with data, missing key counts as 0`. With `--json`, `reviewFileReads.runs === 2` (record-8 does not count). `files['skills/review/code-mode-steps.md']` deep-equals `{ median: 3, total: 6 }` and `files['skills/review/step3-lens-dispatch.md']` deep-equals `{ median: 1, total: 2 }`. The older fixture runs, which have no `procedureFiles`, do not raise `runs`.
  - The markdown output contains `## Review-phase skill-file reads` and the row `| skills/review/code-mode-steps.md | 3 | 6 |`.
  - Existing assertions keep passing. Update the totals the new fixtures shift (the overall run count and week buckets), recomputed by hand from fixture values.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/efficiency-report.test.js`
Expected: FAIL after Step 1 — `reviewFileReads` is undefined.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/efficiency-report.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `Report review-phase skill-file reads per file — efficiency-report reads timing.json procedureFiles`

### Task 5: Recount archived runs from their transcripts (the AC1 baseline)

**Review risk:** high

**Files:**
- Modify: `plugin/bin/phase-timing.js` (extract the transcript-reading half of `run()` into an exported builder)
- Modify: `tools/efficiency-report.js` (a `--recount` mode and a `--since` filter)
- Test: `tests/bin-lib/timing/cli.test.js`, `tests/efficiency-report.test.js`, a new fixture archive under `tests/fixtures/efficiency-report/recount/`

**Interfaces:**
- Consumes: Task 3's `phases[].procedureFiles` and the `dispatchFileReads` join.
- Produces in `phase-timing.js`: `async buildTiming({ runDir, paths, cwd, worktree }) -> timing`. It does everything `run()` does between reading `events.jsonl` and the `checkBudgets` block, for an explicit transcript `paths` list, and writes nothing. `run()` calls it, so `timing.json` from a normal run is unchanged in shape. Exported next to `run`.
- Produces in `efficiency-report.js`: `--recount` (with the existing `--archive` and `--json`) and `--since <YYYY-MM-DD>`.
  - **Async seam:** `buildTiming` is async (`readUsage` is), so `efficiency-report.js`'s `run({ argv, deps })` becomes `async` and returns `Promise<number>` on every path, the `require.main` block sets `process.exitCode` in a `.then` (and writes the error and exit 1 in a `.catch`), and every existing caller in `tests/efficiency-report.test.js` awaits it. No other file calls it (grep `efficiency-report` under `tests/`, `tools/`, `perf/`, `plugin/` before changing it; any caller found is updated the same way).
  - A run is recounted when it is a direct child of the archive, its `timing.json` lists `transcripts[].path` of which at least one exists, and its recounted timing has a **reached** `review` phase (Task 4's rule: `start` non-null, `source !== 'unattributed'`). A run with existing transcripts but no reached review counts in neither `runs` nor `skipped`; it is reported as `noReview: K`. Existing paths are passed to `buildTiming` with the archived run dir and the run's `run-state.json` `worktree`. Nothing is written into the archive.
  - `--since` keeps only runs whose directory name's leading `YYYY-MM-DD` is on or after the given date. It applies to `--recount` and to the default report.
  - Per recounted run, `reads` is the sum over every `phases[]` bucket's `procedureFiles` (the run's windows, all phases; `unattributed` left out, since a dispatcher's session transcript also holds other runs).
  - The result is `recount: { runs: N, skipped: M, noReview: K, files: { [key]: { median, mean, total } }, perRun: [{ run, reads: { [key]: count } }] }`. `median`/`mean` are over the N runs, a run missing the key counted as 0, `mean` rounded to one decimal. Keys sort by `total` descending, then by key. `skipped` counts runs that had a `transcripts` list but no existing path.
  - Markdown prints `## Recounted skill-file reads per run (all phases)`, a line `runs recounted: N (skipped: M, no review: K)`, then `| File | Median reads/run | Mean reads/run | Total reads |` for the top 20 keys. `--json` carries `recount`.
  - `--recount` with no recountable run prints `no archived run has a readable transcript` and exits 0.

- [ ] **Step 1: Write the failing tests**
  - Fixture archive `tests/fixtures/efficiency-report/recount/`: two run dirs with `events.jsonl` (a `review` phase window), `run-state.json`, and a `timing.json` whose `transcripts[].path` names a JSONL fixture inside the fixture tree (written as a path relative to the test's temp copy, resolved at test time). Run A's transcript reads `plugin/skills/review/code-mode-steps.md` 3 times inside the window and once outside every phase; run B's reads it once and `plugin/skills/review/step3-lens-dispatch.md` twice. A third run dir's `timing.json` lists only a missing transcript path. A fourth run dir has a readable transcript but its `events.jsonl` gives no `review` span.
  - `--recount counts all-phase reads per run, leaving out unattributed`: `--json` gives `recount.runs === 2`, `recount.skipped === 1`, `recount.noReview === 1`, `files['skills/review/code-mode-steps.md']` deep-equals `{ median: 2, mean: 2, total: 4 }`, and `files['skills/review/step3-lens-dispatch.md']` deep-equals `{ median: 1, mean: 1, total: 2 }`.
  - `--recount writes nothing into the archive`: every fixture `timing.json` is byte-identical before and after.
  - `--since keeps runs dated on or after the date`: with `--since` set to run B's date, `recount.runs === 1`.
  - `buildTiming returns what run() writes`: for one fixture run, `buildTiming(...)`'s `phases` deep-equal the `phases` that `run(['--run', dir, '--transcript', p, '--json'])` prints.
  - Discrimination: reverting the `unattributed` exclusion makes run A count 4 and the first assertion fail; prove it once by editing and reverting, never committed.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/efficiency-report.test.js tests/bin-lib/timing/`
Expected: FAIL after Step 1 — `--recount` is an unknown flag and `buildTiming is not a function`.

- [ ] **Step 3: Extract `buildTiming`, then add `--recount` and `--since`**

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/efficiency-report.test.js tests/bin-lib/timing/`
Expected: PASS, with the existing phase-timing golden and CLI fixtures unchanged.

- [ ] **Step 5: Commit** — `Recount archived runs' skill-file reads from transcripts — efficiency-report --recount gives a per-run baseline`

### Task 6: Move Step 6.7's body into its own lazily-read file

**Files:**
- Create: `plugin/skills/review/late-findings-routing.md`
- Modify: `plugin/skills/review/code-mode-steps.md` (lines 356-381; the line-287 cite of item 4; line 360)
- Modify: `plugin/skills/review/step3-routing.md` (lines 128, 130 and 132)
- Modify: `plugin/skills/review/review-summary-template.md` (line 82)
- Modify: `plugin/skills/design-wrapper/modes/polish.md` (line 78)
- Modify: `plugin/skills/review/focus-criterion-passes.md` (only if it cites Step 6.7's body by file)
- Modify: `docs/plugin-structure.md` (the review row of the per-skill sub-file table), `docs/skill-graph.md` (if it lists review's sub-files)
- Test: `tests/review-polish-disposition-conformance.test.js`, `tests/review-qa-rerun-after-fix-wave-conformance.test.js`, `tests/review-fix-ephemeral-server-conformance.test.js`, `tests/code-health-agent-trust-scope-wiring.test.js`, `tests/code-health-app-store-readiness-wiring.test.js`

**Interfaces:**
- Produces: `late-findings-routing.md` holds Step 6.7's whole body, byte-for-byte: the `WAVE_BASE` paragraph, items 1-5 with the Category table, and the trailing paragraph. It opens with a one-paragraph header naming its two readers:
  - `code-mode-steps.md`'s Step 6.7, when that step runs.
  - Step 3 Routing's "When Step 6.7 does not run, run its item 4 on its own", which reads only the `WAVE_BASE` paragraph and item 4.
- `code-mode-steps.md` keeps the heading `## Step 6.7: Late Findings Routing (…)` unchanged. It also keeps the first sentence of the run condition ("Runs **at most once** … AND the user opts to action findings inline."). That sentence is followed by one line: read `late-findings-routing.md` in this skill's directory and follow it, and Step 3 Routing's item-4-alone case reads that file's `WAVE_BASE` paragraph and item 4.
- Every cite of "Step 6.7" stays valid. A cite of "item 4" or `WAVE_BASE` that names `code-mode-steps.md` names `late-findings-routing.md` instead.
- Target size: `code-mode-steps.md` at or below 46,000 B (`wc -c`).

- [ ] **Step 1: Repoint the five conformance tests to the new file.** Each test that slices Step 6.7 out of `code-mode-steps.md` reads `plugin/skills/review/late-findings-routing.md` for that body, with its assertions unchanged. Add to `tests/review-qa-rerun-after-fix-wave-conformance.test.js` a test `code-mode-steps Step 6.7 points at late-findings-routing.md`. It asserts that the Step 6.7 section of `code-mode-steps.md` contains `late-findings-routing.md` and no longer contains `dispositionByReview`.

- [ ] **Step 2: Run them to verify they fail**
Run: `node --test tests/review-polish-disposition-conformance.test.js tests/review-qa-rerun-after-fix-wave-conformance.test.js tests/review-fix-ephemeral-server-conformance.test.js tests/code-health-agent-trust-scope-wiring.test.js tests/code-health-app-store-readiness-wiring.test.js`
Expected: FAIL after Step 1 — (ENOENT for `late-findings-routing.md`).

- [ ] **Step 3: Move the body, write the pointer, repoint the citers and docs rows**

- [ ] **Step 4: Run the suites to verify they pass, then sweep**
Run: `node --test tests/review-polish-disposition-conformance.test.js tests/review-qa-rerun-after-fix-wave-conformance.test.js tests/review-fix-ephemeral-server-conformance.test.js tests/code-health-agent-trust-scope-wiring.test.js tests/code-health-app-store-readiness-wiring.test.js tests/skill-graph-dangling-pointer.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS
  Then run `git grep -n "6.7" -- plugin docs tests`. Every hit that cites Step 6.7's body through `code-mode-steps.md` either still resolves (the heading and run condition stayed) or names the new file.

- [ ] **Step 5: Commit** — `Move Step 6.7's body to late-findings-routing.md — code-mode-steps.md drops under the rail with headroom`

### Task 7: Compose the code-mode and lens-dispatch procedures

**Files:**
- Modify: `plugin/skills/review/SKILL.md:73` (the "In `code` and `full` mode, read `code-mode-steps.md`…" sentence)
- Modify: `plugin/skills/review/code-mode-steps.md:228` (the "read it before dispatching" sentence for `step3-lens-dispatch.md`)
- Modify: `docs/plugin-structure.md` (the review row: the two bundles)
- Test: Create `tests/review-procedure-bundles.test.js`

**Interfaces:**
- `review/SKILL.md` line 73 keeps its procedure summary. Its read instruction becomes the following, on one line:
  `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step review-code-mode "${CLAUDE_PLUGIN_ROOT}/skills/review/code-mode-steps.md"`
  It applies when a pipeline run directory exists. The reviewer then reads `$PIPELINE_RUN_DIR/context/review-code-mode.md` once, whole, with one Read and never piecewise (no `sed`/`grep`/`cat` of the source), and re-reads it whole only if its context was compacted since. Standalone, with no run directory, the reviewer reads `code-mode-steps.md` directly. The paragraph carries the verbatim compose-fallback sentence.
- `code-mode-steps.md` line 228 composes the lens-dispatch procedure the same way:
  `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step review-lens-procedure "${CLAUDE_PLUGIN_ROOT}/skills/review/step3-lens-dispatch.md"`
  The reviewer then reads `$PIPELINE_RUN_DIR/context/review-lens-procedure.md` once, whole, re-reading it whole only if its context was compacted since. Standalone, it reads `step3-lens-dispatch.md` directly. The line carries the verbatim fallback sentence.
- The step names `review-code-mode` and `review-lens-procedure` pass `STEP_RE` and collide with no existing step or phase bundle.

- [ ] **Step 1: Write the failing test** — `tests/review-procedure-bundles.test.js`:
  - `review SKILL.md composes code-mode-steps.md once and reads the bundle whole`: the file contains the exact call line above, `context/review-code-mode.md`, `once, whole`, `compacted since`, and the verbatim fallback sentence. It still names `code-mode-steps.md` for the standalone path.
  - `code-mode-steps.md composes step3-lens-dispatch.md once`: the same assertions with `review-lens-procedure`.
  - `both call sites are measured rail rows`: `findComposeCallSites(REPO)` from `plugin/bin/lib/skill-audit/context-cost.js` yields a row for each step, with `error` and `unparsed` undefined. Each row's `max` is ≤ `RAIL_BYTES` minus 2,000 B of headroom for `review-code-mode`, and ≤ `RAIL_BYTES` for `review-lens-procedure`.
  - Discrimination: the same scanner over a temp root whose `review/SKILL.md` lacks the line yields no `review-code-mode` row.

- [ ] **Step 2: Run it to verify it fails**
Run: `node --test tests/review-procedure-bundles.test.js`
Expected: FAIL (call line absent).

- [ ] **Step 3: Write both prose lines**

- [ ] **Step 4: Run it and the rail suite to verify they pass**
Run: `node --test tests/review-procedure-bundles.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/skill-prose-plugin-root-invocations.test.js tests/review-base-ref-scope.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `Compose review's code-mode and lens-dispatch procedures — one read per bundle instead of piecewise raw reads`

### Task 8: Register and cite the lens-child and SDD-child phases

**Files:**
- Modify: `plugin/bin/lib/compose-context/phases.js`
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (the composed-bundle section near line 23; the Scratch-path paragraph near line 82; lens 3e's `_shared/criteria-architecture-depth.md` cite near line 225)
- Modify: `plugin/skills/build/dispatch.md` (the SDD invocation instruction, lines 14 and 19: one compose line before invoking SDD, and one child-prompt citation sentence)
- Modify: `docs/plugin-structure.md:283` (the `--phase <…>` usage line), and `docs/skill-authoring.md:76` only if it lists the phases by name
- Test: `tests/bin-lib/compose-context/phases.test.js`, `tests/bin-lib/compose-context/cli.test.js`, `tests/dispatch-prompt-bundle-citations.test.js`

**Interfaces:**
- `PHASES` gains two phases:
  - `'review-lens-child'`: `[bundle('lens-child', ['skills/_shared/subagent-output-contract.md', 'skills/_shared/criteria-architecture-depth.md'], 'on-demand')]`
  - `'sdd-child'`: `[bundle('sdd-child', ['skills/_shared/subagent-dispatch-core.md'], 'on-demand')]`
  - The usage text and the unknown-phase error list are derived from `PHASES`.
- `step3-lens-dispatch.md`:
  - Next to the existing `--phase review-lens` line, add a second line of its own: `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --phase review-lens-child`.
  - The Scratch-path paragraph's cite of `_shared/subagent-output-contract.md`'s Scratch rule becomes a child-facing line: `{run}/context/lens-child.md`'s Scratch rule, read on demand, never piecewise (if that bundle is absent, read `_shared/subagent-output-contract.md` directly).
  - Lens 3e's criteria cite becomes the same form for `criteria-architecture-depth.md`.
  - Standalone runs keep the direct `_shared/` paths.
  - Growth is ≤ 800 B, so `step3-lens-dispatch.md` stays under 50,000 B.
- `build/dispatch.md`:
  - When `$PIPELINE_RUN_DIR` is set, the controller composes `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --phase sdd-child` once, before invoking SDD, with the verbatim compose-fallback sentence.
  - It directs SDD to include in each implementer and reviewer prompt one line. The line says that the `_shared` rules the prompt cites (the no-stash rule, the no-name-kill rule, Discrimination checks in a scratch checkout) are in `{run}/context/sdd-child.md`, read on demand where a step sends the child (if that bundle is absent, read `_shared/subagent-dispatch-core.md` directly).
  - The existing restated rules and the pasted discrimination steps stay. They carry the filled-in values.

- [ ] **Step 1: Write the failing tests**
  - `phases.test.js`: the key-set assertion becomes `['first-call', 'review-lens', 'review-lens-child', 'sdd-child', 'second-call']`, and the unknown-phase message lists all five in registry order.
  - `cli.test.js:208,240`: the usage text lists the five phases.
  - `dispatch-prompt-bundle-citations.test.js`:
    - `step3-lens-dispatch.md cites lens-child.md with its fallback`: the file contains the `--phase review-lens-child` line and `context/lens-child.md`, and a line matching `FALLBACK_RE` naming `_shared/subagent-output-contract.md`.
    - `build/dispatch.md composes and cites sdd-child`: the same assertions for the `--phase sdd-child` line, `context/sdd-child.md`, and `_shared/subagent-dispatch-core.md`.
    - The existing every-phase-has-a-line and drop-each-phase proofs cover the two new phases unchanged.

- [ ] **Step 2: Run them to verify they fail**
Run: `node --test tests/bin-lib/compose-context/phases.test.js tests/bin-lib/compose-context/cli.test.js tests/dispatch-prompt-bundle-citations.test.js`
Expected: FAIL after Step 1 — (key set and lines absent).

- [ ] **Step 3: Implement the registry rows and the prose lines**

- [ ] **Step 4: Run them and the rail suite to verify they pass**
Run: `node --test tests/bin-lib/compose-context/ tests/dispatch-prompt-bundle-citations.test.js tests/review-dispatch-composition.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/skill-prose-plugin-root-invocations.test.js`
Expected: PASS. The `rail:` composed test prints `[]`.

- [ ] **Step 5: Commit** — `Register lens-child and sdd-child phases — child prompts cite a composed on-demand bundle`

### Task 9: Record the baseline and file the measurement record (controller, after the final code review)

Run by the `/build` controller, not an SDD implementer: it needs the real archive, the PR and `/claude-tweaks:capture`. It changes no tracked file.

**Files:** none tracked. The recount output goes to a session temp file.

**Interfaces:**
- Consumes: Task 5's `--recount`.

- [ ] **Step 1: Run the recount over the pre-ship archive**
Run: `node tools/efficiency-report.js --recount --json`, output redirected to a session temp file.
Expected: exit 0, `recount.runs >= 20` (runs that never reached review are excluded by Task 5's rule, so they do not count toward the 20). Fewer than 20 → stop and report; never pad with non-`/flow` runs.

- [ ] **Step 2: Put the baseline in the PR body** — a `## AC1 baseline` section with: `runs recounted: N (skipped: M)`, the median and mean reads per run for `skills/review/code-mode-steps.md` and `skills/review/step3-lens-dispatch.md`, the exact counter command, and the 80% bound as two numbers (20% of each median). It also states the Decision-rule choices this build made (Global Constraints).

- [ ] **Step 3: File the parked measurement record** via `/claude-tweaks:capture`, spec-shaped, parked until 10 `/flow` runs have archived after the release that ships this: it carries the baseline numbers, the command `node tools/efficiency-report.js --recount --since {release date} --json`, and the bound (median per run for each of the two files at or below 20% of its baseline median over at least 10 recounted runs).
Expected: the record exists; its number is quoted in the PR body's `## AC1 baseline` section.

## Spec coverage

| AC clause | Covered by |
|---|---|
| AC1.1 | Per the spec's Q1 Decision: met at build time by Task 9 (baseline from Task 5's recount in the PR body, parked measurement record filed). The tests in Tasks 6-8 remove the raw reads, since composed-bundle reads are not skill-file reads (Task 1's `procedureFileKey` returns `null` for them). |
| AC2.1 | Task 8 Step 4 (every phase has a line; the `rail:` composed test prints `[]`) and Task 7 Step 4 |
| AC3.1 | The final verification (Common Step 5) runs the whole suite. No task adds a skip. |

Waived plugin/skills/_shared/subagent-output-contract.md: read only. Line 33 already states the rule that a child prompt cites the composed bundle, which Task 8 applies. Task 8 adds it as a `lens-child` bundle source, and no text change is needed.
