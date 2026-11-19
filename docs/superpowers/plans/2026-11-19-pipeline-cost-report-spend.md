# Pipeline Cost Report (spend, funnel, records) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only maintainer CLI, `tools/pipeline-cost-report.js`, that prints list-price spend from session transcripts, the driver admission funnel from `drive.js --check`, and filed-record counts from the forge, as Markdown or JSON.

**Architecture:** One CLI over four reader modules under `tools/pipeline-cost-report/` (`spend.js`, `funnel.js`, `records.js`, `runs.js`), each taking an injected `deps` object (fs, a `gh` runner, a `check` runner, a clock, the plugin root) so tests run on temp-dir fixtures and fake runners. The CLI parses arguments, resolves defaults, calls the section readers, and renders one summary object as either Markdown or JSON, so the two outputs cannot disagree.

**Tech Stack:** Node 18+ built-ins (`fs`, `path`, `readline`, `child_process`), `node:test`, the `gh` CLI.

**Spec:** `.claude-tweaks/pipelines/2026-11-19T055619-spec-5914-5916-5925/spec-5914/work/5914-spec.md` (record #5914). Method reference: the design doc `docs/superpowers/specs/2026-11-18-pipeline-economy-design.md` is not on `main` yet — read it with `git show origin/pipeline-economy-design:docs/superpowers/specs/2026-11-18-pipeline-economy-design.md` (PR #5927). The record's comment holds the scratch scripts (`allcost.js`, `mainctx.js`, `coldwrite.js`, `check2.js`, `admit.js`) that produced the design's numbers: `gh issue view 5914 --json comments -q '.comments[].body'`. They describe the method; do not copy them.

## Global Constraints

- No file under `plugin/` changes, and no file under `plugin/` names `tools/pipeline-cost-report` (spec Non-Goals; AC9). The tool only reads — it never writes outside stdout/stderr.
- Dependency direction runs `tools/` → `plugin/` only: reuse `readUsage` through a `pluginRoot` dep, as `tools/review-replay.js:69` does (`pluginRoot: path.join(__dirname, '..', 'plugin')`).
- Price table, dollars per million tokens as `[input, output, cache read, 5-minute cache write, 1-hour cache write]`: Fable `[8, 40, 0.2, 10, 16]`, Opus `[4, 20, 0.2, 5, 8]`, Sonnet `[2, 10, 0.1, 2.5, 4]`, Haiku `[0.1, 0.5, 0.01, 0.125, 0.2]`; dated `2026-11-03`. One exported constant. Haiku's rate is multiplied by 5 — every column — for a request whose prompt exceeds 100,000 tokens. A model id maps to a family by the substring `fable`, `opus`, `sonnet` or `haiku`; an id matching none is `unpriced`: counted (requests and tokens) and printed, never priced.
- Prompt size per request = uncached input + cache read + cache write. Buckets in thousands of tokens: `<50`, `50-100`, `100-150`, `150-200`, `200-300`, `300-400`, `400-500`, `500-700`, `>700` (lower bound inclusive, upper exclusive: 50,000 is `50-100`).
- Usage is the maximum of each usage field per `message.id`, never the first line and never a per-line sum.
- Cache re-write: a request whose cache write is > 40,000 tokens AND > half its prompt. Cause, first match wins: `session start` (first model call of the transcript), `model switch` (previous model call in that transcript used another family), `compaction` (a `compact_boundary` system line or an `isCompactSummary: true` line since the previous model call), `idle` (≥ 1 hour since the previous model call — measured between model calls, never between transcript lines), else `ordinary growth`. A write that is not a re-write is `ordinary growth`.
- Window: UTC, `--since` and `--until` inclusive whole days; a message belongs to the window by its own timestamp (the first line seen for its `message.id`).
- Session type = the first claude-tweaks skill a main session invoked (a typed `<command-name>/claude-tweaks:X</command-name>` in a user line, or a `Skill` tool call whose `input.skill` is `claude-tweaks:X`), prefix stripped; none → `no skill invoked`. Subagent spend takes its parent session's type; a subagent whose parent main transcript is missing → `unattributed`. The output header says session type is the first skill only.
- `--json` shape: `{ window, spend: { total, bySessionType, byModel, byBucket, cacheWrites, perMergedPr }, funnel: { checked, admitted, reasons, simulations }, records: { created, closed, open, deferred, byReason }, unreadable }`. Fields may be added (this plan adds `spend.byAgent`, `spend.unpriced`, `priceTableDate`, `funnel.runDate`, `funnel.pluginVersion`, `runs`); none may be renamed — #5916 and #5925 extend this shape.
- Governing skill `.claude/skills/gh-api-module-pattern/SKILL.md` (it governs `plugin/bin/` modules; its runner rules are adopted here for the `gh` and `node` spawns), verbatim: "The module takes `runner(args)`, invoked as if `gh ${args.join(' ')}`, returning stdout; a throw is a failed call. Export `defaultRunner` = `execFileSync('gh', args, ghOptions(args, { encoding: 'utf8', windowsHide: true }))` — always an argv array, never a shell string (no injection surface, no quoting bugs)." Here `ghOptions` is not importable from `tools/`; pass `{ encoding: 'utf8', windowsHide: true, timeout, maxBuffer }` literally.
- Tests run through `node tools/run-tests.js <file>` (`npm test` wraps it); never a bare `node --test` in a commit message's verification note.

## Review Focus

1. A transcript directory reaped mid-scan (`ENOENT` on a file listed a moment earlier, or a vanished `subagents/` dir) — counted in `unreadable`, scan continues, exit 0. Pinned in Task 2.
2. A model id with no known family (e.g. `<synthetic>`) — counted under `unpriced`, contributes $0, never crashes the bucket or cause tallies. Pinned in Task 1.
3. A `--projects` root given twice through a symlink (`~/.claude-accounts/{account}/projects` → `~/.claude/projects`) — scanned once. Pinned in Task 5.
4. A `drive.js --check` reason that embeds a variable value (`protected path: plugin/hooks/hooks.json`, `typed command not accepted: launcher`) — tallied under its fixed head (`protected path`), so one rule is one row. Pinned in Task 3.
5. A window with more than 1,000 created records — counts stay exact (search `total_count`) and the deferral subset is printed with a `truncated` marker rather than silently under-counting. Pinned in Task 4.

---

### Task 1: Pricing and per-message usage (`spend.js`, part 1)

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tools/pipeline-cost-report/spend.js`
- Test: `tests/pipeline-cost-report/spend.test.js`

**Interfaces:**
- Produces: `PRICES` (`{ date: '2026-11-03', families: { fable: [...], opus: [...], sonnet: [...], haiku: [...] } }`), `familyOf(modelId: string) -> 'fable'|'opus'|'sonnet'|'haiku'|'unpriced'`, `bucketOf(promptTokens: number) -> string`, `priceRequest(u: { model, input, output, cacheRead, cacheWrite5m, cacheWrite1h }) -> { usd: number, cacheWriteUsd: number, prompt: number, family: string }` (`usd` and `cacheWriteUsd` are 0 for `unpriced`), and `scanTranscript(file, { fsImpl }) -> Promise<{ cwd: string|null, firstSkill: string|null, requests: Request[] }>` where `Request = { id, ts, model, family, input, output, cacheRead, cacheWrite, cacheWrite5m, cacheWrite1h, prompt, usd, cacheWriteUsd, cause }` in transcript order.

`scanTranscript` reads the raw lines itself (streaming `readline`) because `readUsage` does not expose the cache-write split, the compaction marker or `message.id` (verified 2026-11-19, `plugin/bin/lib/timing/transcript.js:203-209`; logged as a reversed premise). It keeps `readUsage`'s rule: per `message.id` the maximum of `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`; the split comes from `usage.cache_creation.ephemeral_1h_input_tokens` on the line holding the max total, `cacheWrite5m = cacheWrite - cacheWrite1h` (a line with no split prices all of it at the 5-minute rate). `cause` is assigned per the Global Constraints, tracking the previous model call's family and timestamp across the whole file (calls before the window included). `cwd` is the `cwd` field of the first line that carries one (real main transcripts open with `last-prompt`, `custom-title` and `agent-name` lines that have none); `firstSkill` the first claude-tweaks skill per Global Constraints.

- [ ] **Step 1: Write the failing tests** in `tests/pipeline-cost-report/spend.test.js`, writing fixture JSONL into a `fs.mkdtempSync(path.join(os.tmpdir(), 'pcr-'))` dir:
  - `AC1.1: one message.id on three lines with rising output_tokens is counted once, at the max of each field` — three assistant lines, same `message.id`, `output_tokens` 5, 40, 900, `cache_read_input_tokens` 1000 on the first line only → `requests.length === 1`, `output === 900`, `cacheRead === 1000`.
  - `AC2.1: a 120,000-token Haiku prompt is priced at five times the per-token rate of an 80,000-token one` — two Haiku requests, each all uncached input (120,000 and 80,000) → `(usd120 / 120000) / (usd80 / 80000) === 5` (compare with a 1e-9 tolerance).
  - `AC4.1: a turn writing more than half its prompt and over 40,000 tokens to cache is a re-write; after a call on another family its cause is model switch` — call 1 Opus (small), call 2 Sonnet with `cache_creation_input_tokens: 60000`, `cache_read_input_tokens: 10000` → call 2 `cause === 'model switch'`; call 1 `cause === 'session start'` only if it itself is a re-write, else `'ordinary growth'`.
  - `cause precedence: compaction, then idle` — a `{"type":"system","subtype":"compact_boundary"}` line before a re-write → `compaction`; a re-write 61 minutes after the previous model call with a user line 1 minute before it → `idle`.
  - `split pricing: 1-hour writes take the 1-hour column` — Opus, `cache_creation_input_tokens: 1000000`, `ephemeral_1h_input_tokens: 1000000` → `cacheWriteUsd === 8`.
  - `unpriced: a model id with no known family is counted and priced at zero` — model `<synthetic>` → `family === 'unpriced'`, `usd === 0`.
  - `cwd comes from the first line that carries one` — a fixture opening with `{"type":"last-prompt"}` and `{"type":"custom-title"}` lines (no `cwd`), then a user line with `"cwd":"/w/claude-tweaks"` → `cwd === '/w/claude-tweaks'`.
  - `bucketOf boundaries` — `bucketOf(49999) === '<50'`, `bucketOf(50000) === '50-100'`, `bucketOf(700000) === '>700'`.
  - `firstSkill reads a typed command or a Skill call, whichever comes first` — a user line with `<command-name>/claude-tweaks:dispatch</command-name>` before a `Skill` call to `claude-tweaks:flow` → `firstSkill === 'dispatch'`; a non-claude-tweaks `Skill` call (`superpowers:brainstorming`) is ignored.
- [ ] **Step 2: Run** `node tools/run-tests.js tests/pipeline-cost-report/spend.test.js` — Expected: FAIL, `Cannot find module`.
- [ ] **Step 3: Implement** `PRICES`, `familyOf`, `bucketOf`, `priceRequest`, `scanTranscript` in `tools/pipeline-cost-report/spend.js` (header comment: what it reads, the max-per-id rule, why it does not call `readUsage` for these fields).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add tools/pipeline-cost-report/spend.js tests/pipeline-cost-report/spend.test.js` then `git commit -m "Price transcript requests for the pipeline cost report — #5914"`.

### Task 2: Spend aggregation over transcript roots (`spend.js`, part 2)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tools/pipeline-cost-report/spend.js`
- Test: `tests/pipeline-cost-report/spend.test.js`

**Interfaces:**
- Consumes: Task 1's `scanTranscript`, `priceRequest`, `bucketOf`.
- Produces: `collectSpend({ roots: string[], since: Date, until: Date, match: string|null }, { fsImpl }) -> Promise<{ total, bySessionType, byModel, byAgent: { main, subagent }, byBucket, cacheWrites, unpriced: { requests, tokens }, sessions: number, unreadable: number }>` — every money figure a number of dollars, unrounded.

Layout per root: `{root}/{slug}/{session-id}.jsonl` (main) and `{root}/{slug}/{session-id}/subagents/agent-*.jsonl` and `{root}/{slug}/{session-id}/subagents/workflows/*/agent-*.jsonl` (subagents of that session — Workflow-tool agents, e.g. `review-lens-fanout`, live in the second; ignore any other dir). Skip a file whose `mtime` is before `since` (it cannot hold a message in the window). `match` keeps a transcript when its `cwd` (from `scanTranscript`) contains the substring, falling back to the `{slug}` dir name when the file has no `cwd`. A subagent's session type is its parent main transcript's `firstSkill` (`{slug}/{session-id}.jsonl`, scanned once and cached); parent file absent → `unattributed`. Any `readdir`/`stat`/read error on a file or dir → `unreadable += 1` and continue.

- [ ] **Step 1: Write the failing tests:**
  - `AC3.1: a session whose first claude-tweaks skill is dispatch is reported under dispatch` — main transcript with a typed `/claude-tweaks:dispatch` then a `Skill` call to `claude-tweaks:flow` → `bySessionType.dispatch > 0`, no `flow` key.
  - `AC3.2: a session that invoked no claude-tweaks skill is reported under no skill invoked`.
  - `AC3.3: subagent spend is attributed to its parent session's type` — parent typed `flow`, one subagent file → `bySessionType.flow === parent usd + subagent usd`, `byAgent.subagent === subagent usd`.
  - `AC3.3: a subagent whose parent transcript is missing is reported under unattributed`.
  - `AC3.3: a Workflow-tool agent under subagents/workflows/{id}/ is a subagent of its session` — parent typed `review`, one `subagents/workflows/wf_1/agent-x.jsonl` → its spend lands in `bySessionType.review` and `byAgent.subagent`.
  - `AC8.1: a transcript that disappears during the scan is counted unreadable and the scan continues` — inject `fsImpl` whose `createReadStream`/`statSync` throws `ENOENT` for one listed path → `unreadable === 1`, the other file's spend still counted.
  - `window: a message outside --since/--until is not counted, by its own timestamp` — same file, one message on 2026-11-07T23:59:59Z and one on 2026-11-08T00:00:00Z, `since` 2026-11-08 → only the second counted; one on `until`'s day at 23:59:59Z counted.
  - `match keeps only transcripts whose cwd contains the substring`.
- [ ] **Step 2: Run** `node tools/run-tests.js tests/pipeline-cost-report/spend.test.js` — Expected: the new tests FAIL (`collectSpend is not a function`).
- [ ] **Step 3: Implement** `collectSpend` in `tools/pipeline-cost-report/spend.js`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Aggregate transcript spend by session type, model and cause — #5914"` with the two files staged by path.

### Task 3: Driver admission funnel (`funnel.js`)

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tools/pipeline-cost-report/funnel.js`
- Test: `tests/pipeline-cost-report/funnel.test.js`

**Interfaces:**
- Produces: `reasonKey(text: string) -> string` and `collectFunnel({ repo, simulate: string[][] }, { gh: (args) => string, check: (n: number) => Promise<string>, now: () => Date, pluginVersion: string }) -> Promise<{ checked, admitted, unreadable, reasons: { [key]: count }, simulations: [{ set: string[], admitted }], runDate, pluginVersion }>`.

Records come from `gh issue list --repo {repo} --state open --label ready --label auto:build --limit 1000 --json number` (ran 2026-11-19: 142 records). `check(n)` defaults to `execFile(process.execPath, [path.join(pluginRoot, 'bin', 'drive.js'), '--check', '#' + n], { cwd: repoRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })` resolving its stdout; run at most 4 checks at once. A verdict is the last non-empty stdout line parsed as JSON with a boolean `admitted` and an array `reasons`; a thrown check, a timeout, or anything else → `unreadable`. `reasonKey` cuts a reason at `': '` only for the heads that embed a value — `protected path`, `merge-sensitive path`, `typed command not accepted`, `size ceiling unreadable`, `Key File limit unreadable`, `express-driver value not recognised` — and returns other reasons unchanged (`express-driver split: issue number is odd` stays whole). A record counts once per key. Simulations: each set from `--simulate` (comma-split, keys after `reasonKey`); with no `--simulate`, one set per distinct key taken alone; a record counts as admitted under a set when it is admitted, or every one of its keys is in the set. `runDate` is `now()` as `YYYY-MM-DD`; `pluginVersion` from `{pluginRoot}/.claude-plugin/plugin.json`.

- [ ] **Step 1: Write the failing tests** with a fake `gh` returning `[{"number":1},…,{"number":5}]` and a fake `check` returning fixture verdicts:
  - `AC5.1: funnel prints the admitted count` — two admitted → `admitted === 2`.
  - `AC5.2: one row per distinct refusal reason` — verdict reasons `['size is not low','protected path: a/b.js']`, `['protected path: c/d.js']` → `reasons` equals `{ 'size is not low': 1, 'protected path': 2 }`.
  - `AC5.3: a named set admits every record whose every reason is in the set` — `simulate: [['size is not low','protected path']]` → that set's `admitted` counts the two refused records plus the admitted ones.
  - `default simulations: one per distinct reason taken alone`.
  - `unreadable: a check that throws, times out, or prints no admitted/reasons is unreadable` — three such fakes → `unreadable === 3`, not in `checked`'s admitted or reasons.
- [ ] **Step 2: Run** `node tools/run-tests.js tests/pipeline-cost-report/funnel.test.js` — Expected: FAIL, `Cannot find module`.
- [ ] **Step 3: Implement** `reasonKey` and `collectFunnel` in `tools/pipeline-cost-report/funnel.js`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Tally driver admission reasons and simulated admissions — #5914"`.

### Task 4: Forge counts (`records.js`)

**Role:** integration

**Files:**
- Create: `tools/pipeline-cost-report/records.js`
- Test: `tests/pipeline-cost-report/records.test.js`

**Interfaces:**
- Produces: `deferReasonOf(body: string) -> string|null`, `collectRecords({ repo, since, until }, { gh }) -> { created, closed, open, deferred: { total, open, closed }, byReason: { [reason]: { open, closed } }, truncated: string[] }` and `countMergedPrs({ repo, since, until }, { gh }) -> { count }`.

Counts come from the search API's exact `total_count`, never from a list length: search-backed lists return at most 1,000 rows. `gh` calls (each ran once 2026-11-19 over 2026-11-08..2026-11-18, results in parentheses): created `api "search/issues?q=repo:{repo}+is:issue+created:{since}..{until}&per_page=1" -q .total_count` (597); closed the same with `closed:{since}..{until}` (207); open now the same with `is:open` and no date (812); merged PRs `api "search/issues?q=repo:{repo}+is:pr+is:merged+merged:{since}..{until}&per_page=1" -q .total_count` (202). The deferral subset reads bodies from `issue list --repo {repo} --state all --search "created:{since}..{until}" --limit 1000 --json number,state,body` (597 rows); when that list returns fewer rows than the created `total_count`, `truncated` gets `created` and the deferral figures cover only the rows read. `deferReasonOf` (decided by the user at plan review, AC6 as written): returns the first word after the first `Defer-reason:` anywhere in the body, allowing `**`/`` ` ``/spaces between the colon and the word (`/Defer-reason:[`*]*[ \t]*([A-Za-z][A-Za-z-]*)/`), `unnamed` when no word follows, and `null` when the body has no `Defer-reason:` (measured: 322 bodies in the window contain it). A `gh` throw propagates; the CLI turns it into a section error (Task 5).

- [ ] **Step 1: Write the failing tests** with a fake `gh` keyed on its joined args:
  - `AC6.1: a created record counts as deferred only when its body holds a line matching Defer-reason:` — bodies `"x\nDefer-reason: tangential\n"`, `"- **Defer-reason:** blocked-dependency"`, `"ledger row (\`Defer-reason: tangential\`)"`, `"none"` → `deferred.total === 3`.
  - `AC6.2: one row per reason word, split by open or closed` → `byReason.tangential` (2) and `byReason['blocked-dependency']` (1) with the fixture states.
  - `created, closed and open counts come from search total_count`.
  - `truncated: a body list shorter than the created total_count is marked` — fake `total_count` 1200 and a 1,000-row body list → `created === 1200`, `truncated` includes `created`.
  - `countMergedPrs counts merged pull requests in the window from total_count`.
- [ ] **Step 2: Run** `node tools/run-tests.js tests/pipeline-cost-report/records.test.js` — Expected: FAIL, `Cannot find module`.
- [ ] **Step 3: Implement** `deferReasonOf`, `collectRecords`, `countMergedPrs` in `tools/pipeline-cost-report/records.js`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Count created, closed and deferred records from the forge — #5914"`.

### Task 5: The CLI, run-directory enumeration, and rendering

**Role:** integration

**Files:**
- Create: `tools/pipeline-cost-report.js`
- Create: `tools/pipeline-cost-report/runs.js`
- Test: `tests/pipeline-cost-report/cli.test.js` (not in the record's Key Files — the CLI-level criteria AC7, AC8.2 and AC9 need a home of their own; noted for architecture alignment)

**Interfaces:**
- Consumes: `collectSpend` (Task 2), `collectFunnel` (Task 3), `collectRecords`, `countMergedPrs` (Task 4), `PRICES` (Task 1).
- Produces: `run({ argv, deps }) -> Promise<number>` (exit code) and `module.exports = { run, parseArgs, render, renderMarkdown }` from `tools/pipeline-cost-report.js`; `listRuns(pipelinesDir, fsImpl) -> { runs: [{ name, date: 'YYYY-MM-DD', dir, archived: boolean, members: [{ id: number, dir }] }], unparsed: number, unreadable: number, missing: boolean }` from `tools/pipeline-cost-report/runs.js` — #5916 and #5925 read run directories through it.

Flags: `--since <YYYY-MM-DD>` (default `--until` minus 6 days), `--until <YYYY-MM-DD>` (default today, UTC), `--projects <dir>` (repeatable; default `~/.claude/projects` plus every `~/.claude-accounts/*/projects`), `--pipelines <dir>` (default `{main checkout}/.claude-tweaks/pipelines`, the main checkout resolved as `tools/efficiency-report.js` does from `git rev-parse --path-format=absolute --git-common-dir`), `--match <substring>`, `--section spend|funnel|records|all` (default `all`), `--repo <owner/name>` (default `gh repo view --json nameWithOwner -q .nameWithOwner`), `--simulate <reason[,reason...]>` (repeatable), `--json`. `--projects` roots are deduplicated by `fs.realpathSync` before scanning; a root that does not exist is skipped silently. `listRuns` reads the top level of `pipelinesDir` and `archive/`, keeps a name found at both from the top level, excludes `archive` itself, counts a name with no leading `YYYY-MM-DD` as `unparsed` (undated, not unreadable), lists `spec-{N}` subdirectories as `members`, counts a run dir whose own `readdir` fails (it vanished or moved to `archive/` mid-scan) as `unreadable` and skips it, skips a missing `archive/` silently, and returns `missing: true` with no runs when `pipelinesDir` itself does not exist; the CLI reports `runs: { inWindow, unparsed, unreadable }` (runs dated within the window), printing `not found: {dir}` when `missing`. `spend.perMergedPr` = `{ mergedPrs, total: total / mergedPrs, build: (flow + dispatch) / mergedPrs }` (`null` dollars when `mergedPrs` is 0). Top-level `unreadable` = spend's unreadable + funnel's unreadable + `listRuns`' `unreadable`. A section whose forge read throws prints `{section}: unavailable — {first line of the error}` (JSON: `{ error }`), and the run exits 1; otherwise 0. Malformed invocation → stderr usage, exit 2. Markdown header lines: the window (`2026-11-08 to 2026-11-18, UTC, inclusive`), `Prices dated 2026-11-03`, `Session type is the first claude-tweaks skill a session invoked; a session that did several things is counted once.` Dollars render to the cent; shares to whole percent.

- [ ] **Step 1: Write the failing tests** in `tests/pipeline-cost-report/cli.test.js`, calling `run({ argv, deps })` with fake `gh`, fake `check`, temp-dir `--projects` and `--pipelines`:
  - `AC7.1: --json prints one object holding the same figures as the Markdown output for every section` — run both outputs over one fixture; assert `json.spend.total`, `json.funnel.admitted`, `json.records.deferred.total` each appear, formatted, in the Markdown text, and that `Object.keys(json)` covers `window, spend, funnel, records, unreadable`.
  - `AC8.2: an unreadable transcript is counted in the printed unreadable figure and the run exits 0`.
  - `AC9.1: no file under plugin/ names tools/pipeline-cost-report` — the walk and plain-substring match of `tests/review-replay/no-plugin-reference.test.js` (≥ 500 files walked floor) with needle `tools/pipeline-cost-report`; plus `AC9.1 go-red control` running the same scan function over a temp dir holding one file that contains the needle and asserting it reports that file.
  - `--projects roots are deduplicated by real path` — a temp root and a symlink to it → spend counted once.
  - `listRuns keeps the top-level copy of a run that is also archived, counts undated names unparsed, and lists spec members`.
  - `AC8.2: a run directory that disappears during the scan is counted unreadable and the run exits 0` — inject an `fsImpl` whose `readdirSync` throws `ENOENT` for one listed run dir → `listRuns(...).unreadable === 1`, and through `run()` the printed `unreadable` includes it with exit 0; a missing `archive/` adds nothing.
  - `malformed invocation exits 2` — `--section bogus`, `--since 2026-13-01`.
- [ ] **Step 2: Run** `node tools/run-tests.js tests/pipeline-cost-report/cli.test.js` — Expected: FAIL, `Cannot find module`.
- [ ] **Step 3: Implement** `tools/pipeline-cost-report/runs.js` and `tools/pipeline-cost-report.js` (header comment in the style of `tools/efficiency-report.js:1-35`: usage line, what each section reads, exit codes, the `run({ argv, deps })` seam; `if (require.main === module)` entry).
- [ ] **Step 4: Run** `node tools/run-tests.js tests/pipeline-cost-report/` — Expected: PASS, all four files.
- [ ] **Step 5: Commit** `git commit -m "Add the pipeline cost report CLI — #5914"`.

### Task 6: Committed baseline and a real-input probe

**Role:** judgment

**Files:**
- Create: `docs/superpowers/specs/2026-11-18-pipeline-economy-baseline.md`

**Interfaces:**
- Consumes: the finished CLI.

Real-input probe (plan-authoring Real-input probe check): run `node tools/pipeline-cost-report.js --since 2026-11-08 --until 2026-11-18 --match claude-tweaks` from the worktree root against this machine's transcripts, run directories and the forge; then `--json` for the same window. Inspect for nonsense before committing: any negative figure, a `byModel` total that does not sum to `total` within a cent, an `unpriced` share above 1% of requests, or a funnel `checked` that differs from the `gh issue list` count above. A defect found here is fixed in the owning module with a test that reproduces it, before the baseline is written.

The baseline file: a header (title, run date, the exact command, the window rule, `Prices dated 2026-11-03`, that the funnel section is a point-in-time reading stamped with its run date and plugin version), then a table placing the design's headline figures beside the measured ones — total list-price spend ($18,851), merged pull requests (164), deferral records (317 of 586 created), records closed (207) — with one line per row on why a measured value can differ (records filed after the design was written; the merged-PR count reading every merged pull request in the window), then the tool's full Markdown output verbatim in a fenced block.

- [ ] **Step 1: Run** the probe commands above; record the four headline measured values.
- [ ] **Step 2: Write** `docs/superpowers/specs/2026-11-18-pipeline-economy-baseline.md`.
- [ ] **Step 3: Run** `node tools/run-tests.js tests/pipeline-cost-report/` — Expected: PASS.
- [ ] **Step 4: Commit** `git commit -m "Commit the pipeline economy baseline reading — #5914"`.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (CLI flags, window, `--match`, `--projects` dedupe) | 5 (2 for window/match semantics) |
| Deliverable 2 (`spend` cuts, cache-write cause) | 1, 2 |
| Deliverable 3 (merged PRs, dollars per merged PR) | 4, 5 |
| Deliverable 4 (`funnel`) | 3 |
| Deliverable 5 (`records`) | 4 |
| Deliverable 6 (price table) | 1 |
| Deliverable 7 (baseline file) | 6 |
| Deliverable 8 (tests) | 1–5 |
| AC1.1 | 1 · AC2.1 | 1 · AC3.1–AC3.3 | 2 · AC4.1 | 1 · AC5.1–AC5.3 | 3 · AC6.1–AC6.2 | 4 · AC7.1 | 5 · AC8.1 | 2 · AC8.2 | 5 · AC9.1 | 5 |

Scope keywords: pipeline-cost-report
