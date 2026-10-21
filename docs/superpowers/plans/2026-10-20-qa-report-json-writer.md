# QA report.json Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace QA Phase 5's prose-composed `{RUN_DIR}/report.json` with a deterministic `bin/` writer, so the artifact `bin/qa-stamp.js --write` reads exists whenever the stories ran.

**Architecture:** A pure composer module (`plugin/bin/lib/qa-report/compose.js`) turns a per-story results payload into the documented `report.json` shape. It derives `summary` from the `stories` array, classifies failures, and flattens caveats, recovered locators and page inventories. A thin CLI (`plugin/bin/qa-report.js`, `run(argv, deps)` seam) reads the payload file and writes `report.json` atomically. `qa-reporting.md` Phase 5 then writes the payload with the Write tool and calls the CLI instead of composing JSON in prose.

**Tech Stack:** Node 18+ CommonJS, `node:test`, `plugin/bin/lib/atomic-write.js`'s `writeFileAtomic`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T183733-record-3328/work/3328-spec.md`

## Global Constraints

- No external npm dependencies. CommonJS, `'use strict'`.
- The CLI's `require.main === module` guard sets `process.exitCode = run(...)` and never calls `process.exit` (pinned by `tests/bin-lib/exit-code-conformance.test.js`).
- Exit-code vocabulary is *Payload-1/Invocation-2*, plus a write code: 0 written, 1 results payload unreadable/unparseable/invalid, 2 malformed invocation, 3 `--out` could not be written. State it in the file header and `USAGE`.
- The output shape is exactly `qa-reporting.md` Phase 5's documented `report.json` schema (keys `run_dir`, `timestamp`, `stories_dir`, `filters`, `summary`, `timing`, `findings`, `caveats`, `recovered_locators`, `page_inventories`, `stories`). Existing readers depend on it: `bin/qa-stamp.js` (`stories[].status/id/source_file`, `summary.total/failed/skipped`, `stories_dir`), `bin/lib/journey-health/qa-evidence.js` (`timestamp`, `stories[]`, `findings[].story_id/finding`), the retry path in `qa-procedures.md` (`stories[].status === "FAIL"`), and `/review` plus `/visual-review` (`page_inventories`).
- Keep `qa-reporting.md`'s **QA pass stamp (pipeline runs, #3003)** paragraph byte-unchanged. `tests/test-skill-qa-stamp-conformance.test.js` pins it.
- Scope discipline: commit tests only where the task asks for them. Touch only what each task requires.

## Review Focus

1. A status outside the four-value enum (e.g. lowercase `pass`) must be rejected with exit 1 naming the story, never silently counted. Pinned in Task 1 (`invalid-status`) and Task 2 (exit 1).
2. A results file holding `null`, an array, or invalid JSON must exit 1 cleanly, never throw. Pinned in Task 2.
3. Duplicate story ids would double-count `summary.total` and must be rejected. Pinned in Task 1 (`duplicate-story-id`).
4. A FAIL story with `error: null` still yields one finding (default `code-bug`, fallback finding text), so the failure stays in `findings[]`, which journey-health reads. Pinned in Task 1.
5. A trailing bare `--out`/`--results` flag must exit 2, never reach a path call with `undefined`. Pinned in Task 2.

---

### Task 1: Pure composer — `composeQaReport`

**Files:**
- Create: `plugin/bin/lib/qa-report/compose.js`
- Test: `tests/bin-lib/qa-report/compose.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `composeQaReport(input: object, opts?: { now?: () => string }) -> { report: object } | { error: string }`
  - `classifyFailure(error: string | null) -> 'stale-selector' | 'flaky-env' | 'code-bug'`
  - constants `STATUSES` (Set of `PASS`, `PASS_WITH_CAVEATS`, `FAIL`, `SKIPPED`), `CATEGORIES` (Set of `stale-selector`, `code-bug`, `ux-issue`, `flaky-env`, `story-bug`).

Input payload shape (`story-results.json`, written by Phase 5 in Task 3):

```json
{
  "run_dir": "...", "stories_dir": "stories", "timestamp": "ISO-8601 (optional)",
  "filters": { "tag": null, "priority": null, "retry": null, "journey": null },
  "wall_clock_seconds": 42,
  "stories": [{
    "id": "login", "name": "Login", "source_file": "app.yaml",
    "status": "PASS|PASS_WITH_CAVEATS|FAIL|SKIPPED",
    "steps_passed": 2, "steps_total": 2, "elapsed_seconds": 10,
    "error": null, "caveats": ["..."], "trace": null, "screenshot_dir": "...",
    "category": "story-bug (optional, FAIL only)",
    "recovered_locators": [{ "step_index": 0, "original_locator": "...", "recovered_locator": "...", "reason": "..." }],
    "page_inventories": [{ "url": "...", "interactive_elements": {}, "forms": {}, "navigation": {}, "accessibility": {}, "layout": {} }]
  }]
}
```

Composition rules (the decisions the implementer cannot make alone):
- Validation, first failure wins, returned as `{ error }`: `input-not-object` (null, array or non-object), `stories-not-array`, `story-not-object: {index}`, `story-missing-id: {index}` (id not a non-empty string), `duplicate-story-id: {id}`, `invalid-status: {id} {status}`, `invalid-category: {id} {category}` (a present `category` not in `CATEGORIES`).
- `summary`: `total` = stories.length; `passed` = PASS + PASS_WITH_CAVEATS; `pass_with_caveats` = PASS_WITH_CAVEATS; `failed` = FAIL; `skipped` = SKIPPED.
- `timing.wall_clock_seconds` = input value when it is a finite number ≥ 0, else `null`. `timing.parallelism_factor` = (sum of `elapsed_seconds` over non-SKIPPED stories) / wall clock, rounded to one decimal. It is `null` when the wall clock is null or 0.
- `timestamp` = `input.timestamp` when a non-empty string, else `opts.now()` (default `new Date().toISOString()`).
- `filters` = `{tag, priority, retry, journey}`, each from `input.filters` or `null`.
- `classifyFailure`: case-insensitive substring match, first match wins. `locator not found` or `element not found` gives `stale-selector`. `timeout`, `navigation failed` or `net::` gives `flaky-env`. `assertion`, `expected` or `verify failed` gives `code-bug`. Anything else, including null, gives `code-bug`. Rule 4 (`story-bug`) is a judgment and is reachable only through a story's `category`.
- `findings`: one per FAIL story, in stories order: `{story_id, category (story.category ?? classifyFailure(error)), severity, finding (error ?? 'Story failed with no error text'), suggested_fix, trace (story.trace ?? null)}`. Then one `ux-issue` finding per caveat of each PASS_WITH_CAVEATS story: `{story_id, category: 'ux-issue', severity: 'Medium', finding: caveat, suggested_fix: 'Review the observation', trace: null}`.
- Severity: `stale-selector` Low, `code-bug` High, `ux-issue` Medium, `flaky-env` Low, `story-bug` Medium.
- Suggested fix: `stale-selector` `Update locator in story YAML`; `code-bug` `Investigate component behavior`; `flaky-env` `` Re-run: `/test qa retry={run_dir}` ``; `story-bug` `` Regenerate story: `/stories focus={story_id}` ``.
- `caveats`: `{story_id, observation}` for every caveat of every PASS_WITH_CAVEATS story.
- `recovered_locators`: each story's entries, flattened, each prefixed with `story_id` and `source_file`.
- `page_inventories`: each story's entries, flattened, each prefixed with `story_id`.
- `stories`: `{id, name, source_file, status, steps_passed, steps_total, elapsed_seconds, error, caveats, trace, screenshot_dir}`. Missing fields become `null`, except `caveats`, which becomes `[]`. `category`, `recovered_locators` and `page_inventories` are not copied onto the story entry.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/qa-report/compose.test.js`:
  - `summary agrees with the stories array`: four stories, one per status. Assert `summary` deep-equals `{total: 4, passed: 2, pass_with_caveats: 1, failed: 1, skipped: 1}`, and that each count equals `report.stories.filter(...)` for its status.
  - `classifyFailure applies rules 1-3 and defaults to code-bug`: `'Locator "Submit" not found'` → `stale-selector`; `'Navigation failed: net::ERR'` → `flaky-env`; `'Expected "Dashboard" in title'` → `code-bug`; `null` → `code-bug`; `'Element not found after TIMEOUT'` → `stale-selector` (first match wins).
  - `FAIL with null error still yields a finding`: finding `{category: 'code-bug', severity: 'High', finding: 'Story failed with no error text'}`.
  - `category override wins and is validated`: `category: 'story-bug'` → that finding has severity `Medium`; `category: 'bogus'` → `{error: 'invalid-category: s1 bogus'}`.
  - `caveats become ux-issue findings and caveats entries`: one PASS_WITH_CAVEATS story with two caveats gives two `ux-issue` findings and two `caveats` entries `{story_id, observation}`.
  - `recovered locators and page inventories flatten with story ids`: assert the `story_id`/`source_file` prefixing, and that `report.stories[0]` has no `recovered_locators` key.
  - `validation errors`: `null` → `input-not-object`; `[]` → `input-not-object`; `{stories: {}}` → `stories-not-array`; `[null]` stories → `story-not-object: 0`; a lowercase `pass` → `invalid-status: s1 pass`; two `s1` ids → `duplicate-story-id: s1`; `{id: ''}` → `story-missing-id: 0`.
  - `timing and timestamp defaults`: wall clock 20 with elapsed 10+10 (+ a SKIPPED story with elapsed 99) → `parallelism_factor` 1; wall clock missing → both timing fields `null`; no `timestamp` → the injected `now()` value.
- [ ] **Step 2: Run to verify it fails.** Run: `node --test tests/bin-lib/qa-report/compose.test.js`. Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/qa-report/compose'`.
- [ ] **Step 3: Implement** `composeQaReport` and `classifyFailure` in `plugin/bin/lib/qa-report/compose.js`, per the rules above, with a header comment naming #3328 and the Phase 5 schema it produces.
- [ ] **Step 4: Run to verify it passes.** Run: `node --test tests/bin-lib/qa-report/compose.test.js`. Expected: PASS, 0 failures.
- [ ] **Step 5: Commit**: `git add plugin/bin/lib/qa-report/compose.js tests/bin-lib/qa-report/compose.test.js`, then `git commit -m "Add QA report.json composer — summary derived from stories (refs #3328)"`.

### Task 2: CLI — `bin/qa-report.js`

**Files:**
- Create: `plugin/bin/qa-report.js`
- Modify: `docs/plugin-structure.md`. Add a CLI line directly after the `node plugin/bin/qa-stamp.js …` line (~line 183), and a `plugin/bin/lib/qa-report/` line directly after the `plugin/bin/lib/verify/` line (~line 54).
- Test: `tests/bin-lib/qa-report/cli.test.js`

**Interfaces:**
- Consumes: `composeQaReport` from Task 1.
- Produces: `run(argv: string[], deps?: object) -> number` and `parseArgs(argv) -> {results, out} | {error}`. CLI: `node plugin/bin/qa-report.js --results <RUN_DIR/story-results.json> --out <RUN_DIR/report.json>`. On success it prints one JSON line `{"written":true,"path":"<abs out>","summary":{...}}`. On failure, stderr is `qa-report.js: <reason>`.
- `deps`: `{ readFile(p) -> string, writeFile(p, content) (default: writeFileAtomic), now() -> string, stdout(s), stderr(s) }`. Every deps call that can throw is try/caught into the exit vocabulary.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/qa-report/cli.test.js` (tmp-dir fixtures, real fs, injected `now`):
  - `writes report.json whose summary agrees with its stories array` (covers AC1.1): write a results file with a PASS, a PASS_WITH_CAVEATS, a FAIL and a SKIPPED story. Run `run(['--results', p, '--out', out], d)`. Assert exit 0. Read `out` back and assert `summary.total === stories.length`, and each of `passed`, `pass_with_caveats`, `failed` and `skipped` equals the count of `report.stories` with the matching status. Assert the stdout line's `summary` deep-equals the file's.
  - `qa-stamp accepts the written report`: an all-PASS results file → `composeQaStamp` (from `plugin/bin/lib/verify/qa-stamp.js`, fed `{report, head: 'c'.repeat(40), dirty: false, storyHashes: {'app.yaml': 'a'.repeat(64)}, storiesDir: 'stories', reportPath: out, at: 'x'}`) returns a `stamp`, not `summary-mismatch`.
  - `payload errors exit 1`: `null`, `[]`, unparseable text, a missing file, and a lowercase-status story each give exit 1, with stderr containing the composer's error (or `results-unreadable`/`results-unparseable`) and no `out` file created.
  - `malformed invocation exits 2`: `[]`, `['--results', p]` (no `--out`), a trailing bare `['--results', p, '--out']`, `['--out', '']`, and an unknown flag each give exit 2 with `usage:` on stderr.
  - `write failure exits 3`: an `--out` whose parent directory does not exist gives exit 3, with stderr naming the path.
- [ ] **Step 2: Run to verify it fails.** Run: `node --test tests/bin-lib/qa-report/cli.test.js`. Expected: FAIL with `Cannot find module '../../../plugin/bin/qa-report'`.
- [ ] **Step 3: Implement** `plugin/bin/qa-report.js`. Header comment covers the purpose (#3328), the usage and the exit vocabulary. It also states that `--out` is a QA artifact path under `.claude-tweaks/artifacts/`, not a pipeline run dir, so no run-dir anchoring guard applies, and that the write is an overwrite with no lock. `parseArgs` rejects a missing, empty or `--`-prefixed value for either flag. The default `writeFile` is `writeFileAtomic(p, JSON.stringify(report, null, 2) + '\n')` from `./lib/atomic-write`. Add the `require.main === module` guard.
- [ ] **Step 4: Run to verify it passes.** Run: `node --test tests/bin-lib/qa-report/cli.test.js tests/bin-lib/exit-code-conformance.test.js`. Expected: PASS, 0 failures.
- [ ] **Step 5: Add the two `docs/plugin-structure.md` lines.** The CLI line: `node plugin/bin/qa-report.js --results <RUN_DIR/story-results.json> --out <RUN_DIR/report.json>   # QA-report CLI (#3328) — the only writer of a QA run's report.json, called by /claude-tweaks:test QA Phase 5 before qa-stamp.js --write; summary derived from the stories array; exit 0 written, 1 results payload unreadable/invalid, 2 malformed invocation, 3 --out unwritable`. The lib line: `plugin/bin/lib/qa-report/       → compose.js (#3328) — composeQaReport: validates a per-story results payload and composes qa-reporting.md Phase 5's report.json shape (summary derived from stories, findings via classifyFailure's rules 1-3 + default, story-bug only via a story's category, caveats/recovered_locators/page_inventories flattened with story_id); consumed by plugin/bin/qa-report.js`.
- [ ] **Step 6: Commit**: `git add plugin/bin/qa-report.js tests/bin-lib/qa-report/cli.test.js docs/plugin-structure.md`, then `git commit -m "Add qa-report.js CLI — deterministic report.json writer (refs #3328)"`.

### Task 3: Phase 5 calls the writer, pinned by a conformance test

**Files:**
- Modify: `plugin/skills/test/qa-reporting.md`, specifically Phase 4's Finding Classification intro (~line 19) and Phase 5 item 25 (~lines 72-77).
- Test: `tests/qa-report-writer-conformance.test.js`

**Interfaces:**
- Consumes: the CLI invocation shape from Task 2.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test** `tests/qa-report-writer-conformance.test.js`, using the `pinned(live, control, pattern)` helper shape from `tests/test-skill-qa-stamp-conformance.test.js` (assert match on live text, doesNotMatch on a frozen pre-change control). The control is the pre-change Phase 5 text, read with `git show HEAD:plugin/skills/test/qa-reporting.md` at authoring time and frozen as a string constant (copy at least item 25's first three lines through the `**Canonical schema.**` sentence). Tests:
  - `Phase 5 invokes the report.json writer` (covers AC2.1): pin `/bin\/qa-report\.js" --results "\{RUN_DIR\}\/story-results\.json" --out "\{RUN_DIR\}\/report\.json"/`.
  - `report.json is never hand-composed`: pin `/never compose or hand-edit `report\.json``/.
  - `the writer runs before the QA pass stamp write`: `indexOf('bin/qa-report.js')` must be less than `indexOf('bin/qa-stamp.js" --write')` in the live text, and both must be ≥ 0.
  - `story-bug is routed through the results payload's category`: pin `/`category`[^\n]{0,200}story-bug|story-bug[^\n]{0,200}`category`/` on the live text, against a frozen Phase 4 classification-paragraph control.
- [ ] **Step 2: Run to verify it fails.** Run: `node --test tests/qa-report-writer-conformance.test.js`. Expected: FAIL. The first live-text assertions do not match yet.
- [ ] **Step 3: Edit `qa-reporting.md` in place.**
  - In item 25, replace the "Write report artifacts to disk:" lead and the `**`{RUN_DIR}/report.json`** — machine-readable:` line. The new text says `report.json` is machine-written by `bin/qa-report.js` (#3328). It instructs writing the Phase 4 per-story results plus run metadata (`run_dir`, `stories_dir`, `filters`, `wall_clock_seconds` from item 24) to `{RUN_DIR}/story-results.json` with the Write tool, then running `` node "${CLAUDE_PLUGIN_ROOT}/bin/qa-report.js" --results "{RUN_DIR}/story-results.json" --out "{RUN_DIR}/report.json" ``. On exit 1, fix the payload the stderr reason names and re-run. On exit 2 or 3, surface stderr verbatim. It adds the sentence "never compose or hand-edit `report.json` — the QA pass stamp below reads only what this writer wrote". Include the payload shape from Task 1 as a short JSON block.
  - Retitle the existing schema block's lead as the shape the writer produces, keeping the `**Canonical schema.**` sentence and the JSON block unchanged (the `page_inventories` byte-sync contract with `agents/qa-agent.md` stands).
  - In Phase 4's Finding Classification intro, add one sentence. The writer applies rules 1-3 and 5 itself. Rule 4 (`story-bug`), and any manual override, is recorded as that story's `category` in `story-results.json`.
  - Leave the **QA pass stamp (pipeline runs, #3003)** paragraph byte-unchanged.
- [ ] **Step 4: Run to verify it passes.** Run: `node --test tests/qa-report-writer-conformance.test.js tests/test-skill-qa-stamp-conformance.test.js tests/qa-artifact-path-conformance.test.js`. Expected: PASS, 0 failures.
  (Go-red proof: Step 1's `pinned` helper asserts `doesNotMatch` against the frozen pre-change control, and Step 2's red run against the unedited file is the second proof.)
- [ ] **Step 5: Commit**: `git add plugin/skills/test/qa-reporting.md tests/qa-report-writer-conformance.test.js`, then `git commit -m "Route QA Phase 5 report.json through bin/qa-report.js (refs #3328)"`.
