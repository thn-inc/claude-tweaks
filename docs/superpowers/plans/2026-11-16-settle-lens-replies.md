# Settle Lens Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure lens-reply parser and a `review-coordination.js settle-lens-replies` verb that reads a whole review lens fan-out's reply texts, gives each reviewer one closed state, pairs the usable lens pairs, and (with `--run`) logs the pair lines — one call instead of hand transcription per pair.

**Architecture:** The two status-line patterns move unchanged from `plugin/bin/lib/hooks/subagent-stop.js` into a new `plugin/bin/lib/status-line.js` that the hook and the parser both require. `plugin/bin/lib/lens-reply.js` is a total, pure function (reply text in, `{ parse, findings, noFindings, overflow, status, statusWord }` out). The verb in `plugin/bin/review-coordination.js` is a loop over lenses around three existing pieces: the parser, `categoriseReproduction` (`lib/coordination.js`), and #5595's `pairEntries` (`lib/reproduction-log.js`) plus the file's own `appendDecisionEntries`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T210449-record-5598/work/5598-spec.md` (record #5598) — executors read it beside this plan.

Scope keywords: settle-lens-replies, lens-reply

## Global Constraints

- Exit codes of the verb: 0 whenever the input was well formed (also when every lens is under `needsSession`); 2 malformed invocation or input; 3 run directory missing or not anchored. (Spec Deliverable 2.)
- Closed reviewer states, exactly six, tested in this fixed order, first fit wins: `failed` (`failed: true`, or `text` null or blank after trimming), `not-done` (status word from the last line or from a misplaced status line is `BLOCKED` or `NEEDS_CONTEXT`), `unparseable` (`parse` is not `ok`), `status-missing`, `status-misplaced`, `ok`. Usable = `status-misplaced` or `ok`. No other state exists. (Spec Deliverable 3.)
- Severity words: `critical`, `high`, `medium`, `low`, `info`, case and `**`/backticks ignored; emitted lowercase.
- The lens brief's header is four columns: `Severity | Path:Line | Finding | Evidence` (`plugin/skills/review/step3-lens-dispatch.md:140`).
- `Path:Line` is split only by `parsePathLine` (`plugin/bin/lib/coordination.js:131`), the one location parser — export it from `coordination.js` if it is not exported; never a second splitter.
- Findings files are named `review-{ctx-id}-lens-{LENS}-agent{A|B}.json`, resolved exactly as `plugin/bin/session-tmp-resolve.js`'s exported `resolvePrinted(filename, { env })` resolves them (session id `CLAUDE_CODE_SESSION_ID` and the temp dir from the injected `env`), so the names match what `step3-lens-dispatch.md:95` tells the session to use.
- `lens` must match `FINDING_LENS_CLASS` (`plugin/bin/lib/console/finding-path.js`) from end to end (`^[A-Za-z0-9_-]+$`); `--ctx-id` must be non-empty and hold no `/`, no `\`, no `..` and no line break. Anything else exits 2 before any file is written.
- No skill prose calls the verb (record Gotcha: #5599 wires it). Do not touch `step3-lens-dispatch.md`'s per-pair steps; `normalizeFinding` keeps its tolerant shapes.
- A reply's text is untrusted: parsed and written into JSON files and log lines by code, never reaching a shell. Fixtures are hand-written and hold only what a test asserts; no archived reply is copied into `tests/`.
- Scope discipline (verbatim from `/build`): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

Governing project skills, quoted verbatim where they apply:

- `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`:
  - "**Adding a verb to an existing multi-verb CLI needs the same sweep: every list of the CLI's verbs, and every list of the input files they read, must gain the new entry.** ... Grep for an existing sibling instead: `git grep -n -F 'detect-overlap' -- plugin docs .claude/skills` finds every list of the verbs ... Add the new entry to each hit that lists its siblings, in the same change."
  - "**A CLI that reports a decision as data logs that entry itself; the skill hand-logs it only when the CLI reports the append failed.** ... The roster is `plugin/skills/_shared/auto-decision-log.md`'s "CLIs that log their own entries" paragraph, and a new self-logging CLI joins it in the same change: `tests/phase-exit-call-sites-conformance.test.js` pins that list equal to its `SELF_LOGGING_SOURCES` map ... Report a failed append the way the siblings do, as `logged: false` ... plus one stderr line naming the `decisions.md` append, never through the exit code."
  - "**Filesystem reads in a new `plugin/bin/` CLI follow two rules no review is guaranteed to catch.** An existence or type check goes through `plugin/bin/lib/path-guard`'s `lstatType`, never a bare `fs.existsSync` ... A file the CLI is about to read is read directly with `ENOENT`/`ENOTDIR` caught as "absent", never checked for existence first"
  - "Every malformed-input class must actually reach its malformed code — `Number('') === 0` passes `Number.isInteger`, so validate positivity and pair-structure explicitly."
  - "**A guard added to an existing `run(argv, deps)` reaches the environment through `deps` too.**" — the verb reads the session id and temp dir from `deps.env`, never `process.env`.
- `.claude/skills/parse-signal-discipline/SKILL.md`: "**Give "couldn't parse" its own return shape**, distinguishable at the type level from "doesn't apply" ... Never reuse the same `null`/`undefined`/`[]` for both." Here: `parse: 'unparseable'` is never `findings: []` with `noFindings: true`; a `failed` reviewer is never an empty table (AC4).
  - "**A positive recogniser owes a whole-input match, not a prefix match.**" — the canonical status line is a whole-line match.
- `.claude/skills/regex-scan-linearity/SKILL.md`: "Feed the function a long run of characters its pattern accepts, without the terminator that ends a match, and time it." / "Wall-clock budgets live in `perf/{name}-linearity.test.js`, run by `npm run test:perf`, never by `npm test`." / "Assert the verdict as well as the time" / "Put a many-lines case (`'git x\n'.repeat(40000)`) beside the one-long-line case." The row splitter is a hand-written single forward scan per line, no regex over a whole row.
- `.claude/skills/prose-code-twin-pin/SKILL.md`: the lens brief's header row and severity scale are a closed vocabulary with a code twin (the parser's exported constants); "Assert set equality both ways" — AC13's test parses the live fence and `deepStrictEqual`s it against the exports, with a go-red control.
- `.claude/skills/windows-checkout-test-parity`: tests build expected findings paths through the same `resolvePrinted` call, never a hand-joined POSIX string; replies with CRLF line endings parse like LF (split on `\n`, strip a trailing `\r`).

## Review Focus

1. A reply with CRLF line endings (a Windows-written transcript) — must parse exactly like its LF twin. Test in Task 2.
2. A severity row whose `Path:Line` cell is empty — a finding at no location cannot be paired or logged; the whole reply is `parse: 'unparseable'` (fail closed, decision recorded in the PR body). Test in Task 2.
3. A `--hold` entry naming a lens that was not settled, or matching zero or several unconfirmed findings of its lens — exit 2, nothing written. Test in Task 3.
4. A malformed input after a valid-looking roster (e.g. duplicate lens in `lenses`) when `--run` is given — no `decisions.md` line and no findings file. Covered by AC5 tests in Task 3.
5. A multi-hundred-kilobyte reply (a runaway reviewer) — the parser stays linear. `perf/` file in Task 2.

---

### Task 1: Move the status-line patterns into `plugin/bin/lib/status-line.js`

**Role:** transcription

**Files:**
- Create: `plugin/bin/lib/status-line.js`
- Modify: `plugin/bin/lib/hooks/subagent-stop.js:169-186`
- Test: `tests/bin-lib/lens-reply.test.js` (created here with the one twin test; Task 2 extends it)

**Interfaces:**
- Produces: `module.exports = { CANONICAL_RE, LENIENT_RE, STATUS_WORDS }` where `CANONICAL_RE` and `LENIENT_RE` are the exact regex literals now at `subagent-stop.js:171` and `:186` (with their comments moved beside them), and `STATUS_WORDS = Object.freeze(['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'])`.

- [ ] **Step 1: Write the failing test** in `tests/bin-lib/lens-reply.test.js`:

```js
test('AC9.1: the hook and the parser share one status-line module (subagent-stop.js keeps no pattern of its own)', () => {
  const sl = require('../../plugin/bin/lib/status-line');
  assert.ok(sl.CANONICAL_RE.test('STATUS: DONE'));
  assert.ok(!sl.CANONICAL_RE.test('STATUS: DONE.'));
  assert.ok(sl.LENIENT_RE.test('- **Status:** BLOCKED'));
  assert.deepStrictEqual([...sl.STATUS_WORDS], ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED']);
  const raw = fs.readFileSync(path.join(ROOT, 'plugin/bin/lib/hooks/subagent-stop.js'), 'utf8');
  const src = stripComments(raw);
  assert.equal(stripperVerdict(raw, src), 'ok');
  assert.match(src, /require\(['"]\.\.\/status-line['"]\)/);
  assert.doesNotMatch(src, /\/\^STATUS: \(DONE/);
});
```

(`stripComments`/`stripperVerdict` from `tests/helpers/strip-comments.js`; `ROOT` the repo root.)

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/lens-reply.test.js`
Expected: FAIL — `Cannot find module '../../plugin/bin/lib/status-line'`.

- [ ] **Step 3: Create `status-line.js` and make `subagent-stop.js` require it** (`const { CANONICAL_RE, LENIENT_RE } = require('../status-line');`). Move the two literals byte-for-byte; `detectStatus` is otherwise unchanged.

- [ ] **Step 4: Run the new test and the existing hook suites unchanged**

Run: `node --test tests/bin-lib/lens-reply.test.js tests/hooks-subagent-stop.test.js tests/hooks-subagent-stop-marker.test.js tests/bin-lib/hooks/contract-retries.test.js`
Expected: PASS, no expectation edited (AC9.1).

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/status-line.js plugin/bin/lib/hooks/subagent-stop.js tests/bin-lib/lens-reply.test.js` then `git commit -m "Move the status-line patterns into one module — refs #5598"`.

---

### Task 2: The lens-reply parser `plugin/bin/lib/lens-reply.js`

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/lens-reply.js`
- Modify: `plugin/bin/lib/coordination.js` (export `parsePathLine` only if not already exported)
- Test: `tests/bin-lib/lens-reply.test.js`
- Create: `perf/lens-reply-linearity.test.js`
- Read only: `plugin/skills/review/step3-lens-dispatch.md` (AC13's live fence)

**Interfaces:**
- Consumes: `CANONICAL_RE`, `LENIENT_RE`, `STATUS_WORDS` from Task 1; `parsePathLine` from `lib/coordination.js`.
- Produces: `parseLensReply(text: string) -> { parse: 'ok'|'unparseable', findings: Array<{severity, path, line?, text, evidence}>, noFindings: boolean, overflow: number, status: 'ok'|'misplaced'|'missing', statusWord: string|null }`; `module.exports = { parseLensReply, SEVERITIES, BRIEF_HEADER }` with `SEVERITIES = Object.freeze(['critical','high','medium','low','info'])` and `BRIEF_HEADER = Object.freeze(['Severity','Path:Line','Finding','Evidence'])`. Never throws: a non-string input is treated as `''`.

Parsing rules (the decisions the spec pins; the implementer writes the bodies):
- Split on `\n`, strip one trailing `\r` per line. A table row is a line whose trimmed form starts with `|`; one leading and one trailing boundary `|` are dropped.
- Cell boundary: a `|` that is not escaped (`\|`) and not inside a backtick span. An unclosed backtick span runs to the end of the row. `\|` becomes `|` in the cell text. Cells are trimmed. One forward scan per row (no regex over the row).
- Header row: the first row whose first cell, lowercased with `**`/backticks removed, is `severity`; its cell names map columns by name (case-insensitive match against `BRIEF_HEADER`). A column whose name is not in `BRIEF_HEADER` is dropped, never folded into Evidence. With no header row, cells are taken in `BRIEF_HEADER` order. A row with more cells than its header (or more than 4 with no header) has the surplus joined onto the Evidence cell with ` | `. A row with fewer cells is still a finding when its first cell is a severity word and its location cell is non-empty; missing cells are `''`.
- Separator row: every cell matches `^:?-+:?$` — skipped.
- Finding row: first mapped cell is a severity word (case, `**`, backticks ignored). `Path:Line` cell (backticks/`**` stripped) goes through `parsePathLine`; a non-numeric or missing line leaves `line` undefined (key absent). A severity row whose location cell is empty after stripping makes the whole reply `parse: 'unparseable'` (Review Focus 2).
- Overflow: a row whose first non-empty cell, or a non-table line, trimmed, matches `^\+\s*(\d+)\s+more$` (case-insensitive) sets `overflow` to that integer; it is not a finding. Default `overflow: 0`.
- No findings: a non-table line matching `^[\s*_`>#"-]*No findings[ \t*_`.!"]*$` (case-insensitive) sets `noFindings: true` — unless the reply also holds finding rows, in which case `findings` are kept and `noFindings: false`.
- `parse` is `ok` when at least one finding row or a no-findings line is present (and Review Focus 2 did not fire), else `unparseable` (an empty string included).
- Status: over non-empty trimmed lines, `ok` when the last one matches `CANONICAL_RE`; else, over the non-empty lines that do not start with `|`, `misplaced` when any of the first three or last three matches `CANONICAL_RE` or `LENIENT_RE` (the window `detectStatus` uses); else `missing`. `statusWord` is the captured word, or `null` for `missing`.

- [ ] **Step 1: Write the failing tests** — one test per AC1 fixture, each asserting the whole returned object with `deepStrictEqual`:
  - `AC1.1: a plain table` — two rows + `STATUS: DONE` → 2 findings `{severity, path, line, text, evidence}`, `parse: 'ok'`, `status: 'ok'`, `statusWord: 'DONE'`, `overflow: 0`, `noFindings: false`.
  - `AC1.2: Evidence holding a || b in backticks stays one cell` — evidence equals ``uses `a || b` here``.
  - `AC1.3: an escaped pipe` — `a \| b` in Finding yields text `a | b`, 1 finding.
  - `AC1.4: a bold severity` — `**HIGH**` → `severity: 'high'`.
  - `AC1.5: No findings.` — `No findings.\n\nSTATUS: DONE` → `findings: []`, `noFindings: true`, `parse: 'ok'`.
  - `AC1.6: a +3 more row` and `AC10.1` parser half — `overflow: 3`, row not a finding.
  - `AC1.7: narration before the table` — findings parsed, `status: 'ok'`.
  - `AC1.8: a status line that is not last` — `STATUS: DONE` then a trailing remark → `status: 'misplaced'`, `statusWord: 'DONE'`.
  - `AC1.9: no status line` — `status: 'missing'`, `statusWord: null`, findings kept.
  - `AC1.10: a BLOCKED reply with a reason` — `cannot read src/x.ts\n\nSTATUS: BLOCKED` → `parse: 'unparseable'`, `statusWord: 'BLOCKED'`, `status: 'ok'`.
  - `AC1.11: an empty string` — `{ parse: 'unparseable', findings: [], noFindings: false, overflow: 0, status: 'missing', statusWord: null }`; also `parseLensReply(null)` returns the same object.
  - `AC1.12: a Path:Line cell reading general` — `path: 'general'`, `line` key absent.
  - `AC1.13: a five-column table with a Suggested resolution header` — that column dropped; evidence is only the Evidence cell.
  - `AC1.14: a row with three cells` — severity + location + finding → evidence `''`.
  - `AC1.15: rows and No findings. together` — findings kept, `noFindings: false`.
  - `Review Focus 1: CRLF replies parse like LF` — the AC1.1 fixture with `\r\n` deep-equals the LF result.
  - `Review Focus 2: an empty location cell makes the reply unparseable`.
  - `AC2.1: categoriseReproduction over the parser's output equals it over a hand-written transcription` — two fixture reply strings (A and B tables, ≥3 rows each with one ±2 pair, one same-location different-substance pair, one unpaired) beside two hand-written JSON arrays of the same rows; `deepStrictEqual(c.categoriseReproduction(parse(A).findings, parse(B).findings), c.categoriseReproduction(handA, handB))`.
  - `AC13.1: the live lens output block parses, and its header and scale equal the parser's constants` — extract the one ```` ```markdown ```` fence under `## Per-lens Calibration + Output template` in `step3-lens-dispatch.md`; take its `| Severity | ...` header row cells and `deepStrictEqual` them with `BRIEF_HEADER`; take the words of its `Severity scale:` line and `deepStrictEqual` with `SEVERITIES`; assert the fence holds the `"+N more"` sentence and the `` `STATUS: {WORD}` `` line; build a reply from the fence's header row, separator row and example rows plus `| +3 more | | | |` and `STATUS: DONE`, and assert 2 findings, `overflow: 3`, `status: 'ok'`. Go-red control in the same test: the header check run over the fence text with `| Severity | Path:Line | Finding | Evidence | Fix |` substituted must fail (call the extraction helper and assert the deepStrictEqual throws).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/lens-reply.test.js`
Expected: FAIL — `Cannot find module '../../plugin/bin/lib/lens-reply'` (Task 1's test still passes).

- [ ] **Step 3: Implement `parseLensReply` in `plugin/bin/lib/lens-reply.js`** per the rules above. Header comment names #5598, the one-location-parser rule, the closed output shape, and what keeps the scan linear.

- [ ] **Step 4: Write `perf/lens-reply-linearity.test.js`** — header names #5598, says it is deliberately not part of `npm test`, gives `Run with: npm run test:perf`. Cases, each asserting the verdict and a generous budget: a 200k-backtick row (`'| high | a.js:1 | ' + '`'.repeat(200000)`), a 200k-pipe row, a 200k `\|` run, 200k spaces before `No findings` text with no match, and a many-lines case (`'| high | a.js:1 | x | y |\n'.repeat(40000)`). Prove one case red by reverting to a naive implementation once (scratch, not committed).

- [ ] **Step 5: Run**

Run: `node --test tests/bin-lib/lens-reply.test.js` then `node --test perf/lens-reply-linearity.test.js`
Expected: PASS both.

- [ ] **Step 6: Commit** — the parser, the tests, the perf file (and `coordination.js` if `parsePathLine` was exported): `git commit -m "Add the lens reply parser — refs #5598"`.

---

### Task 3: The `settle-lens-replies` verb, its docs and the self-logging roster

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/review-coordination.js` (header comment, `USAGE`, `realDeps.env`, new verb)
- Modify: `docs/plugin-structure.md:390` (the `review-coordination.js` command line) and `:55` (the self-logging list)
- Modify: `plugin/skills/_shared/auto-decision-log.md` (the "CLIs that log their own entries" list)
- Modify: `tests/phase-exit-call-sites-conformance.test.js` (`SELF_LOGGING_SOURCES`)
- Modify: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (the self-logging roster count and list)
- Test: `tests/bin-lib/review-coordination/cli.test.js` (new tests appended; no existing expectation edited)
- Read only: `plugin/bin/lib/reproduction-log.js` (`pairEntries`, `holdKey` — used as-is), `plugin/bin/lib/session-tmp.js` (through `resolvePrinted`)

**Interfaces:**
- Consumes: `parseLensReply` (Task 2); `categoriseReproduction` (`lib/coordination.js`); `pairEntries`, `holdKey` (`lib/reproduction-log.js`); `resolvePrinted` (`plugin/bin/session-tmp-resolve.js`); this file's `parseValueFlags`, `readJson`, `anchorRunDir`, `appendDecisionEntries`, `FINDING_LENS_CLASS`.
- Produces: `run(['settle-lens-replies', <result.json>, '--ctx-id', id, ...], deps)`; stdout one JSON line `{ settled: [{ lens, confirmed, unconfirmed, entries?, logged? }], needsSession: [{ lens, reason: 'single-reviewer'|'reviewer-unusable', reviewers: [{ side, state, statusWord, text?, findingsPath? }] }], violations: [{ lens, side, status }], overflow: [{ lens, side, hidden }] }`. `realDeps` gains `get env() { return process.env; }`.

Verb rules (decisions; the implementer writes the bodies):
- Flags via `parseValueFlags(rest, ['--ctx-id','--run','--only','--hold'], deps)`; exactly one positional. `--ctx-id` required. `--only`/`--hold` need `--run`; `--run` needs `--only` (`confirmed`|`unconfirmed`); `--hold` needs `--only unconfirmed`.
- Shape: top-level `reviewers` array → bare; else a top-level `result` object holding a `reviewers` array → wrapped; else exit 2. `lenses` must be a non-empty array of `{ lens, reviewers: 1|2 }` with no lens twice; `reviewers` a non-empty array of `{ lens, side: 'A'|'B', text: string|null, failed: boolean }`. A roster lens with `reviewers: 1` expects side `A` only; `2` expects `A` and `B`. A roster lens or side with no entry, an entry the roster does not name, a lens+side twice, a non-string non-null `text`, or a non-boolean `failed` exits 2. Each exit-2 prints exactly one stderr line naming the fault.
- Order: every validation (flags, ctx-id, shape, roster, entries, hold) → pairing in memory → anchor the run dir (`anchorRunDir(flags.run, deps, 3)`) when `--run` → write findings files → append → print. Nothing is written or created (no session temp root either) before every exit-2 and exit-3 check has passed.
- Per lens: parse each reviewer, assign its state by the Global Constraints order. Single-reviewer roster → `needsSession` `single-reviewer`. Any reviewer `failed`/`not-done`/`unparseable`/`status-missing` → `needsSession` `reviewer-unusable`. In both, each usable reviewer's findings array is written whole to its `review-{ctx-id}-lens-{LENS}-agent{SIDE}.json` path and reported as `findingsPath`; a `not-done` reviewer carries its `text`. Else both usable: both `noFindings` with no findings → settled `{ lens, confirmed: [], unconfirmed: [] }` and no line; otherwise `categoriseReproduction(A.findings, B.findings)`.
- `violations`: every reviewer in state `status-misplaced` or `status-missing`, `status` the parser's value. `overflow`: every reviewer with `parse: 'ok'` and `overflow > 0`, `hidden` the count.
- `--run`: per settled lens `pairEntries(result, { lens, only, hold: holdForLens })`, sectioned `/review`, all lenses' entries appended in one `appendDecisionEntries` call in lens order; each settled lens gets its `entries` and the call's `logged`. `--hold` file: a JSON array of `{ lens, ...finding }`; each entry matches exactly one unconfirmed finding of a settled lens by `holdKey`, else exit 2. No de-duplication across calls (spec Decision).

- [ ] **Step 1: Write the failing tests** (appended to `cli.test.js`, in-process `run(...)` with the file's existing anchored-run-dir and fake-deps helpers; deps gain `env: { CLAUDE_CODE_SESSION_ID: <id>, TMPDIR: <tmp dir under t> }` and expected paths come from `resolvePrinted(name, { env })`):
  - `AC3.1: three lenses (ok pair, one failed, one unparseable) settle the first, log its lines, list the other two under needsSession, write the two usable findings files, exit 0` — asserts `decisions.md`'s new lines equal the `categorise-reproduction` lines for the same arrays.
  - `AC4.1: a text:null reviewer puts its lens under needsSession, never confirmed: []` and `AC4.2: the test fails if a failed reviewer is treated as an empty table` — the partner reply is `No findings.\n\nSTATUS: DONE`; assert the lens is absent from `settled` and present under `needsSession` with state `failed`.
  - `AC5.1`/`AC5.2`: one test per case, each asserting exit 2, exactly one stderr line, no `decisions.md` change, and no session temp root created: no reviewers; lens named twice for one side; side `C`; not the shape (an array); no `lenses`; roster lens with no entry; roster side with no entry; entry the roster does not name; `text: 5`; `failed: 'yes'`; lens `../x`; `--ctx-id a/b`; `--ctx-id ..`; `--ctx-id` with a line break; `--hold` entry matching nothing (Review Focus 3).
  - `AC6.1: a status-misplaced reviewer is paired and listed under violations`; `AC6.2: a status-missing reviewer's lens is under needsSession and not paired`.
  - `AC7.1`/`AC7.2: settled lines are byte-identical to categorise-reproduction --run --lens for the same two arrays` — run both verbs against two anchored run dirs with one injected `now`, compare the two `decisions.md` texts for both `--only confirmed` and `--only unconfirmed`.
  - `AC10.1: a +3 more reviewer is paired and listed under overflow with hidden: 3`.
  - `AC11.1: a BLOCKED reply with no table is not-done` (and carries its `text`).
  - `AC11.2: a BLOCKED on a misplaced status line is not-done`.
  - `AC11.3: failed: true with a full reply is failed`.
  - `AC11.4: a parsed table with no status line is status-missing`.
  - `AC12.1: a roster lens or side with no entry, or an unnamed entry, exits 2` (cases shared with AC5); `AC12.2: a reviewers: 1 lens is under needsSession with reason single-reviewer and its findings file is written`.
  - `wrapped result shape reads like the bare one`; `exit 3 for a missing run dir and for an unanchored one, nothing written`; `--help names settle-lens-replies`.
  - `logged: false with one stderr line when the append throws, exit 0` (inject a throwing `appendDecisions`).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/review-coordination/cli.test.js`
Expected: the new tests FAIL with `unknown command: settle-lens-replies`; every existing test PASSES.

- [ ] **Step 3: Implement the verb** in `review-coordination.js` as a function `settleLensReplies(rest, deps)` dispatched from `run`, per the rules above; extend the header comment and `USAGE` with the verb, its JSON line, and its 0/2/3 codes.

- [ ] **Step 4: Sweep the verb and roster lists** — `git grep -n -F 'detect-overlap' -- plugin docs .claude/skills` and `git grep -n -F 'review-coordination.js log-reproduction-judgment' -- plugin docs .claude/skills tests`; add `settle-lens-replies` (and, for the roster, `review-coordination.js settle-lens-replies --run`) to every hit that lists its siblings: `docs/plugin-structure.md:390` (verb, input shape, output line, exit codes), `docs/plugin-structure.md:55`, `auto-decision-log.md`'s list, `SELF_LOGGING_SOURCES` (`['plugin/bin/review-coordination.js']`), `cli-wrapper-contract.md`'s roster (count goes up by one). Measure `wc -c plugin/skills/_shared/auto-decision-log.md` stays under 52,500.

- [ ] **Step 5: Run**

Run: `node --test tests/bin-lib/review-coordination/cli.test.js tests/multi-agent-coordination.test.js tests/phase-exit-call-sites-conformance.test.js tests/bin-lib/lens-reply.test.js tests/path-guard-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/bin-lib/cli-entry-conformance.test.js`
Expected: PASS, no existing expectation edited (AC9.1).

- [ ] **Step 6: Commit** — the CLI, its tests, the docs, the roster files: `git commit -m "Add review-coordination settle-lens-replies — refs #5598"`.

---

### Task 4: Run the parser over real archived lens replies (AC8)

**Role:** judgment

**Files:**
- Read only: `tools/review-replay/counterfactual.js` (`indexTranscripts`, `lastAssistantText`), `tools/review-replay/archive.js` (`readRun`, `selectRuns`) — the way AC8 says replies are found
- Modify (only if the bound is exceeded): `plugin/bin/lib/lens-reply.js`, `tests/bin-lib/lens-reply.test.js`

**Interfaces:**
- Consumes: `parseLensReply` (Task 2).

- [ ] **Step 1: Write a scratch script outside the repo tree** (the session scratchpad) that, for every archived run under the main checkout's `.claude-tweaks/pipelines/` archive root that `selectRuns`/`readRun` read, takes each `lensAgents` entry with an `agentId`, finds its transcript among this machine's Claude Code project transcripts (`indexTranscripts` over the projects directory for this repo), reads `lastAssistantText`, and runs `parseLensReply`. Reviews read must number at least 20.
- [ ] **Step 2: Run it** (a scratch check — no committed test; Check C has no pre-run for it) with full output redirected to `$PIPELINE_RUN_DIR/evidence/ac8-real-replies.txt` (create the dir with `mkdir -p` first; plain Bash redirect). Report: replies read, share with `parse: 'ok'`, the status split (`ok`/`misplaced`/`missing`), finished replies (status word `DONE`/`DONE_WITH_CONCERNS`), the unparseable count among finished replies, and replies with neither a table nor `No findings.`.
- [ ] **Step 3: Hand-check 20 replies picked every k-th** (k = floor(total/20)): for each, count table rows by eye against `findings.length + (overflow row ? 1 : 0)`; record each pair of numbers in the evidence file.
- [ ] **Step 4: Apply the bound.** If more than 2% of finished replies are `unparseable`, list the shapes; extend the parser for each shape with a hand-written fixture test (no archived text copied), rerun Steps 2-3. If a shape cannot be handled, stop with BLOCKED listing the shapes.
- [ ] **Step 5: Log the evidence** — one line written with the Write tool to a session temp file, then `node "$CLAUDE_PLUGIN_ROOT/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{file}"`: the line names AC8, the command shape, the counts, and the evidence path. The same numbers go in the PR body.
- [ ] **Step 6: Commit** only if Step 4 changed the parser: `git commit -m "Handle real lens reply shapes in the parser — refs #5598"`.

---

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (parser) | 2 |
| Deliverable 2 (verb) | 3 |
| Deliverable 3 (states) | 3 (states), 2 (parse/status inputs) |
| Deliverable 4 (unsettled lenses, findings files) | 3 |
| Deliverable 5 (never clean from nothing) | 3 |
| Deliverable 6 (docs) | 3 |
| Technical Approach: status-line.js move | 1 |
| Technical Approach: `.claude/skills/prose-code-twin-pin` live-block test | 2 (AC13.1) |
| Technical Approach: `session-tmp-resolve.js` path resolution | 3 |
| Technical Approach: `FINDING_LENS_CLASS` (`plugin/bin/lib/console/finding-path.js`) lens check, `anchorRunDir` unchanged | 3 |
| Technical Approach: #5533 shared argument parser not started — hand-written parsing kept | 3 (checked: no such parser in `review-coordination.js`) |
| Gotcha: read `.claude/skills/gh-api-module-pattern`, `.claude/skills/parse-signal-discipline`, `.claude/skills/regex-scan-linearity` | Global Constraints quotes |
| Gotcha: `tools/replay-scratch/counterfactual.js` (now `tools/review-replay/counterfactual.js`) | 4 |
| AC8 | 4 (scratch, evidence in run dir) |
| AC9 | 1, 3 |

Waived `plugin/bin/lib/console/finding-path.js`: read only, `FINDING_LENS_CLASS` is imported in Task 3.
Waived `plugin/bin/lib/reproduction-log.js`: read only, `pairEntries`/`holdKey` are used as-is in Task 3.
Waived `plugin/bin/lib/session-tmp.js`: read only, reached through `session-tmp-resolve.js`'s `resolvePrinted` in Task 3.

AC8 is a one-time validation reported in the PR, not a test (record Gotcha); Task 4 runs it and records evidence in the run directory:
Waived AC8.1: Task 4 Step 1-2 (at least 20 archived reviews, found through `tools/review-replay/counterfactual.js`'s readers).
Waived AC8.2: Task 4 Step 2 and Step 5 (replies read, `parse: ok` share, status split, in the PR body).
Waived AC8.3: Task 4 Step 3 (20 replies every k-th, checked by hand).
Waived AC8.4: Task 4 Step 4 (the 2% bound, shapes listed and handled).
Waived AC8.5: Task 4 Step 2 (bound over `DONE`/`DONE_WITH_CONCERNS` replies; count of replies with neither).
Waived AC8.6: Task 4 Step 4 (BLOCKED listing the shapes when unhandled).
