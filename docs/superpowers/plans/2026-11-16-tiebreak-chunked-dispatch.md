# Chunked Tiebreak Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:review` Step 3.7 judges its open findings with one fresh agent per chunk of at most 8 findings, and `review-coordination.js resolve-tiebreak` settles a whole chunk in one call, per finding, with the existing resolver.

**Architecture:** `plugin/bin/lib/tiebreak.js` gains a reply splitter keyed on finding id and a chunk resolver that calls the existing `resolveTiebreak` once per entry. `review-coordination.js resolve-tiebreak` takes the chunk form when the entries file holds a JSON array and keeps the legacy single-object form unchanged. `step3-tiebreak.md` keeps its single-finding template (used by retries, the per-finding fallback path and `tidy/console-backfill.md`) and adds a chunk template.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T000458-record-5540/work/5540-spec.md` (record #5540; revised 2026-11-16 for the record's plan-review Decisions Q1 and Q2 and its decision rule)

**Scope keywords:** resolve-tiebreak, step3-tiebreak, resolveTiebreak

## Global Constraints

- Chunk size: at most 8 findings per chunk, chunks formed in entry order; never grouped by lens or by file.
- The one-finding call form (`resolve-tiebreak <finding.json> <reply-file>` with a single JSON object) keeps its output and exit codes byte-for-byte; no removal is planned.
- Every finding's verdict line keeps its present form (`console/resolve.js`, `checkTiebreakCoverage` and `prep-tiebreak.js` parse it).
- The existing expectations in `tests/bin-lib/tiebreak.test.js` and `tests/bin-lib/review-coordination/cli.test.js` are not edited (AC2); new tests are appended.
- Do not add text to `plugin/skills/review/code-mode-steps.md` (one byte under the rail, #5076).
- The judge is given no account of how a finding was reported; independence is from the reporter, not between findings.
- From `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`, verbatim: "**Adding a verb to an existing multi-verb CLI needs the same sweep: every list of the CLI's verbs, and every list of the input files they read, must gain the new entry.**" No verb is added here, but the input shape of `resolve-tiebreak` widens, so `docs/plugin-structure.md`'s `review-coordination.js` line is updated in the same task.
- From the same file, verbatim: "Report a failed append the way the siblings do, as `logged: false`, `logFailed: true` or a `logFailures` element in the envelope plus one stderr line naming the `decisions.md` append, never through the exit code."
- From `.claude/skills/skill-prose-conformance-tests/SKILL.md`, verbatim: "Slice with `tests/helpers/conformance-asserts.js`'s `sectionOf(text, '## Heading')` and `lineStartingWith(text, prefix)` instead of writing another local copy".
- `tests/review-tiebreak-step-conformance.test.js` has failed on Windows before (#4828): build any expected path with forward slashes from the literal text, never `path.join`, and build CRLF inputs from the LF text when a test reads prose (`.claude/skills/windows-checkout-test-parity`).

## Review Focus

1. A finding id quoted inside another block's `Evidence:` line is not a block boundary (only a line-anchored `Id:` header whose id is in the chunk is) — Task 1 test.
2. A reply whose last non-empty line is not a `STATUS:` line: every finding of the chunk resolves could-not-parse (can't-tell), never confirmed — Task 1 test.
3. Text before the first `Id:` header (agent preamble) and an `Id:` header for an id not in the chunk are ignored, never attached to a finding — Task 1 test.
4. A chunk file of 9 entries, an empty array, or one malformed entry exits 2 and writes nothing under `--run` — Task 2 test.
5. A chunk holding two entries with the same id (an identical finding listed twice) is refused: `resolveTiebreakChunk` throws and the CLI exits 2 writing nothing; Step 3.7 forms chunks from distinct ids, since the coverage check lists a repeated id once — Task 1 and Task 2 tests.
6. A chunk entry carrying `vacuity: true` (a lens 3f vacuity finding) has its block's `Verdict: confirmed` line rewritten to `Verdict: cant-tell` in code before resolving, byte-identical to the one-finding call on the same prose-rewritten reply; a `refuted` block resolves as written — Task 1 test.

---

### Task 1: Chunk splitter and resolver in `tiebreak.js`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/tiebreak.js` (add after `resolveTiebreak`, extend the header comment and `module.exports`)
- Test: `tests/bin-lib/tiebreak.test.js` (append only)

**Interfaces:**
- Produces:
  - `CHUNK_MAX = 8`
  - `splitChunkReply(replyText: string, ids: string[]) -> { status: string|null, blocks: Map<string, { state: 'ok'|'missing'|'duplicate', text: string }> }` — one map entry per distinct id in `ids`.
  - `resolveTiebreakChunk(findings: Finding[], replyText: string, { readFile, now }) -> { results: Array<ResolveResult & { id: string, index: number }>, unsettled: Array<{ id: string, index: number, reason: 'missing'|'duplicated' }> }` — `results` holds one settled result per entry whose block is present exactly once, in entry order; `unsettled` holds every other entry, in entry order, and nothing is resolved for it (Decision Q1).

Reply grammar for a chunk (document it in the header comment): lines trimmed; a block starts at a line matching `/^id\s*:\s*`?([0-9a-f]{12})`?$/i` whose id is in `ids`, and runs to the next such header or to the end of the reply, excluding the reply's final non-empty line when that line matches the existing `STATUS_RE`. `status` is that final line (verbatim, trimmed) or null. A block's `text` is its lines after the header joined with `\n`, then `\n` + `status` when `status` is non-null. An id with no header is `missing` and an id with two or more headers is `duplicated`; both get `text: ''`. Lines before the first header, and headers for ids outside `ids`, belong to no block. `resolveTiebreakChunk` computes `findingId` per entry (throwing a `TypeError` when two entries share an id), splits once, and calls `resolveTiebreak(entry, block.text, opts)` for each `ok` entry only; a `missing`/`duplicated` entry goes to `unsettled` with no resolver call. For an entry with `vacuity: true`, a block line matching `/^verdict\s*:\s*confirmed\s*$/i` is replaced by `Verdict: cant-tell` before the call (the code form of Step 3.7's lens 3f rewrite, so the dispatcher never edits a chunk reply); `vacuity` is not part of `findingId` and the one-finding form ignores it.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/tiebreak.test.js`, reusing that file's existing fixture helpers where they fit)
  - `AC1.1: each chunk verdict line equals the one-finding call on the same entry and block` — three findings on one fixture file (one confirmed reply with verified evidence, one refuted, one cant-tell), one reply with three `Id:` blocks and a trailing `STATUS: DONE`; for each entry assert `chunk.results[i].logLine === resolveTiebreak(entry, bodyLines + '\nSTATUS: DONE', opts).logLine` and the whole result objects are `deepEqual` once `id`/`index` are removed; assert `chunk.unsettled` is `[]`.
  - `AC1.2: a one-finding chunk settles like the one-finding call` — same assertion with a single entry.
  - `AC3.1: a reply missing one id leaves that finding unsettled and settles the others` — two entries, reply carries only the first block; `unsettled` deep-equals `[{ id: id1, index: 1, reason: 'missing' }]`, `results` has one element (index 0, `outcome === 'confirmed'`), and no result carries id1.
  - `AC3.1: a reply repeating one id leaves that finding unsettled and settles the others` — second id's header twice; `unsettled` is `[{ id: id1, index: 1, reason: 'duplicated' }]`; the first finding confirmed.
  - `Review Focus 1: an id quoted inside Evidence is not a block boundary` — first block's `Evidence:` line quotes the second id; both findings settle (`unsettled: []`) and the first is still confirmed.
  - `Review Focus 2: no trailing STATUS line leaves every finding can't-tell` — `split.status === null`; every result `reason === 'could-not-parse'`; none `confirmed`.
  - `Review Focus 3: preamble and foreign ids attach to no finding` — a preamble line `Verdict: refuted` before the first header and a header for an id not in the chunk followed by a `Verdict: confirmed` block; the chunk's findings resolve from their own blocks only.
  - `Review Focus 5: a chunk with two entries of the same id throws` — the same finding twice; `assert.throws(..., TypeError)`.
  - `Review Focus 6: a vacuity entry's confirmed block resolves can't-tell` — one `vacuity: true` entry with a `Verdict: confirmed` block and one plain entry; the vacuity result equals `resolveTiebreak(entry, block with the Verdict line replaced by 'Verdict: cant-tell')` and has `reason === 'verdict:cant-tell'`; the plain entry still confirms; a `vacuity: true` entry with a `refuted` block resolves as refuted.
  - `CHUNK_MAX is 8`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/tiebreak.test.js`
Expected: FAIL — `resolveTiebreakChunk is not a function`

- [ ] **Step 3: Implement `CHUNK_MAX`, `splitChunkReply` and `resolveTiebreakChunk` in `plugin/bin/lib/tiebreak.js`** per the grammar above; no fs, no process (the module's purity note stays true); export all three.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/tiebreak.test.js`
Expected: PASS, with every pre-existing test unchanged (AC2.1)

- [ ] **Step 5: Prove the guards discriminate** — in a scratch copy only, delete the "id in `ids`" condition of the header match and confirm `Review Focus 3` goes red; delete the duplicate branch and confirm the repeat-id test goes red. Restore.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/tiebreak.js tests/bin-lib/tiebreak.test.js
git commit -m "Add the chunk reply splitter and resolver to tiebreak.js — refs #5540"
```

### Task 2: Chunk form of `review-coordination.js resolve-tiebreak`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/review-coordination.js` (the `resolve-tiebreak` branch and the header comment; `USAGE` stays byte-identical, since `cli.test.js` pins it)
- Modify: `docs/plugin-structure.md` (line 285, the `review-coordination.js` entry: name the chunk form)
- Test: `tests/bin-lib/review-coordination/cli.test.js` (append only)

**Interfaces:**
- Consumes: `resolveTiebreakChunk`, `CHUNK_MAX` from Task 1.
- Produces: when the entries file parses to a JSON array, `resolve-tiebreak <chunk.json> <reply-file> [--root] [--run]` prints one JSON line `{ "chunk": true, "results": [ ...one per settled entry, each the one-finding result object plus "id", "index" and, under --run, "logged" ], "unsettled": [ { "id", "index", "reason": "missing"|"duplicated" } ] }` and exits 0 — an unsettled entry gets no result and no verdict line (Decision Q1). An array that is empty, longer than `CHUNK_MAX`, holding two entries with the same id, or holding an entry `buildFindingsArtifact` rejects exits 2 with one stderr line and writes nothing. Any non-array value takes today's path unchanged (an object is the legacy form; a non-object keeps today's malformed-finding exit 2). Under `--run`, after the anchoring check, each result's verdict line is appended in entry order with the same `formatEntry`/`deps.appendDecision` call the one-finding form uses; a failed append sets that result's `logged: false` and writes one stderr line naming it, never changing the exit code.

- [ ] **Step 1: Write the failing tests** (append; reuse `run`, `fakeDeps`/`tbDeps`, `tmpDir`, `writeText`, `anchoredRunDir`, `tiebreakInputs`)
  - `AC1.1: the chunk form prints one result per entry, each equal to the one-finding call` — run the chunk form and, for each entry, the legacy form with that entry and its block + `STATUS: DONE`; assert each `results[i]` minus `id`/`index` deep-equals the legacy output, and `unsettled` is `[]`.
  - `AC1.2: a one-element array takes the chunk form` — output has `chunk: true` and one result.
  - `AC1.1: chunk --run appends one verdict line per finding, in entry order` — anchored run dir; the `decisions.md` `## /review` lines equal `results.map(r => '- ' + r.logLine)`; every result `logged: true`.
  - `AC3.1: chunk --run with a missing id and with a repeated id writes no line for that id` — two cases, three entries each; `unsettled` names the one id with reason `missing` / `duplicated`; `decisions.md` holds exactly two verdict lines, neither naming the unsettled finding's `path:line`; exit 0.
  - `the chunk form exits 2 for an empty array, a 9-entry array, a repeated id, or one malformed entry, and appends nothing` — under `--run`; `decisions.md` absent or unchanged afterwards.
  - `chunk --run: a failed append marks only that result logged:false and exits 0` — inject an `appendDecision` that throws for the second entry only.
  - `AC5.1, AC5.2: check-coverage and console/resolve.js read a chunk-settled run unchanged` — `write-findings` a three-finding set (confirmed, refuted-high, cant-tell-medium replies) into an anchored run dir, settle them with one chunk `--run` call, then assert `check-coverage` prints `missing: []`, and that `require('../../../plugin/bin/lib/console/resolve.js').resolveAll({ runDir, policy, deps })` (its real signature, `resolve.js:968`; build `policy`/`deps` the way that module's existing tests do) returns, for the chunk-settled run dir, the same finding items it returns for a second anchored run dir settled by three legacy `--run` calls — compared after removing run-identity fields (run dir, paths, timestamps), or by comparing the per-line `parseTiebreakLine`/`findingItems` output if `resolveAll`'s items prove run-specific.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/review-coordination/cli.test.js`
Expected: FAIL after Step 1 — the chunk form prints a malformed-finding error and exits 2

- [ ] **Step 3: Implement the array branch in `run()`'s `resolve-tiebreak` handler**, ahead of the existing `buildFindingsArtifact([input.value])` check; keep the legacy branch's code path untouched. Update the header comment's `resolve-tiebreak` paragraph and `docs/plugin-structure.md`'s entry.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/review-coordination/cli.test.js tests/bin-lib/tiebreak.test.js tests/phase-exit-call-sites-conformance.test.js`
Expected: PASS, every pre-existing test unchanged (AC2.1)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/review-coordination.js tests/bin-lib/review-coordination/cli.test.js docs/plugin-structure.md
git commit -m "Settle a tiebreak chunk in one resolve-tiebreak call — refs #5540"
```

### Task 3: Step 3.7 prose — chunked dispatch, per-chunk failure handling

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/review/step3-tiebreak.md` (`## Placement` entry-status sentence, `## Dispatch`, `## Resolve and act`, `## Dispatched reviewer`)
- Modify: `plugin/skills/tidy/console-backfill.md:106` (cite "the single-finding template, the first fenced block under its `## Dispatch`")
- Modify: `docs/skill-graph.md:668` (the `/review` row: "inlines `review/step3-tiebreak.md`'s single-finding agent template")
- Modify: `docs/journeys/get-a-verdict-on-every-unverified-review-finding-3947.md:38` (one agent per chunk of up to 8 findings)
- Test: `tests/review-tiebreak-step-conformance.test.js`

**Interfaces:**
- Consumes: the chunk form from Task 2 (array entries file, `results[].logged`, `unsettled[]`); `CHUNK_MAX` from Task 1.

Prose to land (dispatcher voice, matching the file's neighbours):
- `## Placement`: each finding is still judged on its own, with its own verdict line; it shares a chunk agent with up to seven others (keep the existing `each … judged on its own` and `nearLocation` facts).
- `## Dispatch`: group the entry set's distinct ids, in entry order, into chunks of at most **8** findings (never by lens or file; a repeated entry goes in once — the chunk form refuses a repeated id) and dispatch one fresh agent per chunk, in parallel waves of **8** chunk agents. Keep the hung-agent wait rule, the never-reuse rule, the Post-fan-out untracked-file sweep paragraph and the model line. Keep the existing fenced template, unchanged and first, introduced as the single-finding template (a missing-block retry and the per-finding fallback path use it); add a second fenced block, the chunk template: the same `Diff scope:` line once, then one block per finding headed `Id: {id}` (the finding's id from `review-findings.json`) carrying that finding's `Finding:`, `Severity:`, `Location:` and contested-only `Positions:` lines; the reply asks for one block per finding, each opening with its own `Id:` line copied exactly, then the existing `Verdict:`/`Evidence:`/`Severity:`/`Recommendation:` lines, and one trailing status line for the whole reply; the instruction to judge each finding on its own (one being right or wrong says nothing about the next), and every existing instruction (evidence, vacuity, read-only, shell discipline, scratch, model line) carried over verbatim.
- `## Resolve and act`, per chunk: `Write` the chunk's entries (as written to the artifact, `positions` included) as one JSON array to `F` and the agent's reply to `R`, resolved with `F=review-{ctx-id}-tiebreak-chunk-{c}.json R=review-{ctx-id}-tiebreak-chunk-{c}-reply.txt`; keep the existing single-finding `F`/`R`/`T` line for retries and inline verdicts, and per-finding `T` files for `logged: false` results, with `{n}` still the entry's position in the whole set — a chunk result's `index` `i` in chunk `c` (both from 1 for `c`, from 0 for `i`) is position `(c − 1) × 8 + i + 1`, so per-finding paths never collide across chunks. A lens 3f vacuity finding is written to the chunk file with `vacuity: true`; the code rewrites its confirmed block (the dispatcher never edits a chunk reply); the single-finding prose rewrite stays for a single-finding reply. Failure order (Deliverable 4): an empty, failed, timed-out or non-`DONE` chunk reply is re-dispatched once as a fresh chunk agent and its valid blocks are discarded, not settled; a second failure sends each of its findings down the per-finding path: one fresh single-finding agent (this is the finding's third and last judge attempt, so no further re-dispatch), whose failure is passed as an empty reply to the one-finding call; a dispatched reviewer takes the inline rung instead. For an otherwise good reply, run the chunk call once (with `--run` in a pipeline run). Every id in its `unsettled` list (reason `missing` or `duplicated`) gets one single-finding re-dispatch after that call, settled with the one-finding call form; a re-dispatch that fails too resolves as an empty reply does today — passed as an empty reply to the one-finding call, except that a dispatched reviewer takes the inline rung (` Mode: inline.`), as it does today (Decision Q1; settled by plan review after an answered round — no probe call, no splitting in the dispatcher; only code splits a reply). State that a finding gets at most three judge attempts, and that `check-coverage` stays the backstop for an unsettled finding nobody followed up. Keep the lens 3f vacuity rewrite for single-finding replies; for chunk replies it is the `vacuity: true` entry flag above.
- `## Dispatched reviewer`: the ladder is per chunk first, then per finding.

- [ ] **Step 1: Write the failing tests** (append to `tests/review-tiebreak-step-conformance.test.js`; each new pin gets a go-red proof that runs the same predicate on the doctored text, per the file's `missingFactsOf` + `assertEveryMatchGoesRed` pattern)
  - `AC4.1: Dispatch chunks the entry set at the CHUNK_MAX bound` — `## Dispatch` matches `chunks of at most \*{0,2}8\b`, `in entry order`, `one fresh agent per chunk`; and the number in the chunk sentence equals `require('../plugin/bin/lib/tiebreak').CHUNK_MAX`.
  - `AC4.1: the prose reverted to one agent per finding fails` — replace the chunk sentence in `## Dispatch` with the pre-change `One agent per entry, in parallel waves of **8**` sentence (taken from `git show` of the base text, pasted as a literal) and assert the chunk predicate reports its facts missing.
  - `AC4.1: the chunk template carries the id header and the per-finding reply` — the second fenced block of `## Dispatch` holds `Id: {`, every `REPLY_FORMAT` fact, the judge-each-on-its-own instruction, the `[Use: Capable` line, the READ-ONLY REVIEW placeholder and the SCRATCH line; its input lines carry no `evidence`/`reasoning` (reuse `leaksReporterContent`).
  - `Deliverable 4: the per-chunk failure ladder` — `## Resolve and act` states the chunk re-dispatch, that valid blocks of a failed reply are discarded, the single-finding re-dispatch for each `unsettled` id after the chunk call, and at most three judge attempts; a doctored text that moves the re-dispatch before the chunk call, or reintroduces a probe call without `--run`, goes red.
  - The existing first-template pins (`AC2.1`, `AC12.1`, `minor 11`, wave, empty reply, `--text-file`) keep passing on the unchanged first block; `tests/tidy-*` pins on `console-backfill.md` — grep `git grep -n -F 'inline the fenced template' -- tests plugin` and re-point each hit.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/review-tiebreak-step-conformance.test.js`
Expected: FAIL — the AC4.1 chunk facts are missing

- [ ] **Step 3: Edit the four files** per "Prose to land". Measure `wc -c plugin/skills/review/step3-tiebreak.md` before and after (base 13,9xx bytes; rail 52,500 — ample headroom). Behavior-change sweep: `git grep -n -i -e 'one agent per' -e 'agent per finding' -e 'agent per entry' -e "agent template" -- plugin docs .claude/skills ':!docs/superpowers' ':!docs/plans'` — each hit is changed or classified no-change in the commit message.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/review-tiebreak-step-conformance.test.js tests/bin-lib/tiebreak.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-tiebreak.md plugin/skills/tidy/console-backfill.md docs/skill-graph.md docs/journeys/get-a-verdict-on-every-unverified-review-finding-3947.md tests/review-tiebreak-step-conformance.test.js
git commit -m "Dispatch one tiebreak judge per chunk of up to 8 findings — refs #5540"
```

### Task 4 (controller, not dispatched): Replay proof and record link

Run by the controller after Task 3, before Common Step 5. Nothing from it is committed.

- [ ] **Step 1:** `node tools/replay-scratch/baseline.js "{main checkout}" {archived run dirs with review-findings.json}` → `{scratch}/baseline.ndjson`; pick usable runs.
- [ ] **Step 2:** `node tools/replay-scratch/prep-tiebreak.js "{main checkout}" {scratch}/baseline.ndjson {scratch}/tb 8 {run names}` — chunk size 8, entry order; at least 20 reviews and at least 100 findings, including reviews with more than 8 findings.
- [ ] **Step 3:** run `tools/replay-scratch/tiebreak-replay.workflow.js` in a headless `claude -p` worker (it has the Workflow tool) with `root` = `{scratch}/tb` and `runs` built from `{scratch}/tb/manifest.json`, one element per manifest row: `{ run: m.run, chunks: m.chunks.length, singles: <every id in _verdicts/{run}.json> }` — the workflow reads `chunks` as a count and `singles` as finding ids, while the manifest stores file paths, so passing manifest rows through unchanged would dispatch zero chunk agents. The rerun arm covers the same findings.
- [ ] **Step 4:** `node tools/replay-scratch/score-tiebreak.js {scratch}/tb {workflow transcript dir}` → `$PIPELINE_RUN_DIR/evidence/tiebreak-replay.txt`; log one `AC evidence` entry per AC6/AC7 via `log-decision.js --text-file`.
- [ ] **Step 5:** AC6.2 gate: chunked agreement at most 5 percentage points below the rerun arm's, at least 100 findings judged in each arm; a larger shortfall stops the build and reports both numbers. AC7.1 (Decision Q2): scale each review's archived tiebreak total to the findings the replay scored — where an archived tiebreak agent can be matched to its finding (its `timing.json` description names the finding's `path:line`), use that agent's tokens; otherwise the review's mean cache-creation tokens per tiebreak agent times the number of findings scored from it. A scratch script (session scratchpad, not committed) computes both figures per review; chunked-arm cache-creation tokens must be at most half the **scaled** total.
- [ ] **Step 6:** put the table (reviews, findings, agreement per arm, can't-tell counts per arm, tokens per arm, and per review the scaling method used, the unscaled archived total and the scaled figure) in the PR body under `## Replay`; comment on #5148 that its "resolve a wave in one call" request is delivered by #5540 (Deliverable 7).

## Readings taken under the record's decision rule

- The per-finding path after a chunk's two failures is one single-finding agent with no further re-dispatch, so the "at most three judge attempts" bound in Deliverable 4 holds (stated in the PR body).
- An unsettled id's failed single-finding re-dispatch resolves as an empty reply does today: the empty-reply one-finding call, or a dispatched reviewer's inline rung (spec `## Plan Review Clarifications`).
- Lens 3f vacuity rewrite of a chunk reply lives in code (`vacuity: true` entry flag), not in dispatcher prose, since only code splits a reply.
- AC3's "settle the affected finding as can't-tell" is superseded by Decision Q1: the chunk call leaves a missing or duplicated id unsettled and the dispatcher's single-finding retry settles it; a failed retry resolves as an empty reply does today (can't-tell).

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1, AC4.1 | Task 3 |
| Deliverable 2, AC1.1, AC1.2, AC3.1, AC3.2 | Tasks 1, 2 |
| Deliverable 3, AC2.1 | Tasks 1, 2 (append-only test edits; `USAGE` unchanged) |
| Deliverable 4, Deliverable 5 | Task 3 |
| AC5.1, AC5.2 | Task 2 |
| Deliverable 6, AC6.1, AC6.2, AC6.3, AC6.4, AC6.5, AC7.1 | Task 4 |
| Deliverable 7 | Task 4 |

Waived plugin/skills/review/code-mode-steps.md: the Gotchas forbid adding text to it; no task edits it, and Task 3's conformance run keeps its existing Step 3.7 wiring pins green.
