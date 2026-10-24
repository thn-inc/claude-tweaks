# Windows Regression Filer Per-Test Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Windows regression issues quote the tests that newly fail, not the first failure in the file, and flag likely renames of tests that were already failing (#3723).

**Architecture:** `baselineAdjudicated` today attributes whole files only. The adjudicator already holds the isolated HEAD run's and the base run's parsed single-file logs, so it gains one additive, fail-open field, `attributedTests`, naming the new tests per attributable file by suite path. The field never feeds the verdict. The filer (`tools/windows-regression/file-issue.js`) reads it and quotes one excerpt per attributed test. When the entry for a file is missing it falls back to the existing first-match excerpt, says which case applies, and adds a possible-rename note from the counts. Rename *detection* stays out of baseline.js, which only reports facts.

**Tech Stack:** Node (CommonJS), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T081430-record-3723/work/3723-spec.md`

**Scope keywords:** attributedTests, excerptFor

## Global Constraints

- The rename-note wording contains the exact phrase `possible rename of an already-failing test`.
- `attributedTests` is report-only. Nothing in `adjudicate()`'s `verdict`, `attributable`, `baselineFailing`, `flakyPassed` or `baselineIsolated` may change.
- Detecting renames inside baseline.js is out of scope (spec Deliverable 2).
- `plugin/skills/test/verification.md` is 52489 bytes against `RAIL_BYTES` 52500. Cut from the same paragraph at least as many bytes as you add there, and confirm with `wc -c` (≤ 52500).
- Commit messages follow `{Verb} {what} — {detail}` and reference `refs #3723` (never `closes`/`fixes`).
- Governing skill `node-test-output-evidence` (verbatim):
  - "Key a failure by the full path of names from the outermost suite down, never by the leaf name alone and never by its `test at <path>:L:C` site."
  - "A caller treats an ill-formed tree as "cannot classify", never as a partial answer."
  - "A consumer that means "inside this failure" must stop at the block's own `yamlClose`. `tools/windows-regression/file-issue.js`'s `ownerAt` does."
  - "Node writes TAP whenever stdout is not a TTY, so every child run `verify.js` spawns is TAP."
  - "Read names byte-for-byte … and never trim them."
- Consequence of those rules: for a file present at base, per-test identity is a suite path (`testTree`'s `failed` entries, JSON name arrays). Only a file absent at base has no base tree and no isolated run, so it uses the full run's leaf names, each as a one-element path.

## Review Focus

1. **A leaf name shared by two suites in one file** (`A > works` attributed, `B > works` pre-existing). The filer quotes the block whose enclosing `# Subtest:` names match the path. Pinned in Task 2.
2. **A test path that occurs twice** (multiset). Each occurrence takes the next unused matching block, and no block is quoted twice. Pinned in Task 2.
3. **An attributed test with no block in any source, or no entry for the file.** The filer falls back to the first-match excerpt and states that per-test attribution is unavailable; it never drops the file. Pinned in Task 2.
4. **A malformed `attributedTests` value** (not an object; `tests` not an array of non-empty string arrays; empty). Treated as unavailable, never a crash. Pinned in Task 2.
5. **A malformed base or isolated tree, or an unaccounted isolated log.** No entry for that file. Per the skill, an ill-formed tree is never a partial answer. Pinned in Task 1.

---

### Task 1: `attributedTests` in the baseline adjudicator

**Files:**
- Modify: `plugin/bin/lib/verify/baseline.js` (the `baseEv` map at ~419-432, the classification loop at ~530-541, the return object at ~580-595)
- Modify: `plugin/skills/test/verification.md` (the `report.json records baselineAdjudicated: {…}` field list, ~line 164)
- Modify: `docs/plugin-structure.md` (the `baseline.js (#3043 — …)` entry in the `plugin/bin/lib/verify/` line)
- Test: `tests/bin-lib/verify/baseline.test.js`

**Interfaces:**
- Produces: `adjudicate()`'s eligible result gains `attributedTests: { [file: string]: { tests: string[][], headFailing: number, baseFailing: number, absentAtBase: string[][] | null } }`.
  - It holds one key per attributable file whose per-test identity is known, and is `{}` when there are none.
  - `tests` is a non-empty multiset of suite paths (each a non-empty array of names, outermost first), in log order.
  - `absentAtBase` is the subset of `tests` whose path occurs nowhere in the base tree's `paths` (`[...tests]` for a file absent at base), or `null` when base existence was not read (the base run exited 0).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/verify/baseline.test.js`. Reuse the helpers already in the file (`fakes`, `logFile`, `tmpl`, `SPEC_NAMED`, `NAMED`, `R`, `isolationCase`, `TREE`). Name each test as below.
  - `#3723 AC1.1: attributedTests names the isolated HEAD failures base does not fail, by suite path`
    - Inputs: `isolationCase` with head `NAMED({ fails: [['x'], ['new']] })`, isolated `NAMED({ fails: [['x'], ['new']] })`, retry the same with code 1, and the default base (`x` failing, `slow` passing).
    - Assert: `r.attributable` deep-equals `[R]`, and `r.attributedTests[R]` deep-equals `{ tests: [['new']], headFailing: 2, baseFailing: 1, absentAtBase: [['new']] }`.
  - `#3723 AC2.1: a renamed already-failing test — same failing count, attributed path absent at base`
    - Inputs: head and isolated `NAMED({ fails: [['renamed']] })`, retry the same with code 1, base `NAMED({ fails: [['original']] })`.
    - Assert: `attributedTests[R]` deep-equals `{ tests: [['renamed']], headFailing: 1, baseFailing: 1, absentAtBase: [['renamed']] }`.
  - `#3723: a path present at base but not failing there is attributed and not absent`
    - Inputs: base `NAMED({ fails: [['x']], passes: ['new'] })`, isolated and retry `NAMED({ fails: [['x'], ['new']] })`.
    - Assert: `absentAtBase` deep-equals `[]`.
  - `#3723: suite paths, not leaf names — base failing B > works never covers A > works`
    - Inputs: use `TREE` to build `▶ A`/`▶ B` suites. Base fails `["B","works"]`; isolated and retry fail both `["A","works"]` and `["B","works"]`.
    - Assert: `tests` deep-equals `[['A','works']]`.
  - `#3723: a file absent at base attributes every full-run failure by leaf name`
    - Inputs: `existsAtBase: () => false`; full run `SPEC_NAMED([['tests/new.test.js','t1'],['tests/new.test.js','t2']])`.
    - Assert: `{ tests: [['t1'],['t2']], headFailing: 2, baseFailing: 0, absentAtBase: [['t1'],['t2']] }`.
  - `#3723: a file passing at base attributes every isolated failure, existence unknown`
    - Inputs: outcomes baseline 0, isolated 1, retry 1, with isolated and retry `NAMED({ fails: [['a'], ['b']] })`.
    - Assert: `{ tests: [['a'],['b']], headFailing: 2, baseFailing: 0, absentAtBase: null }`.
  - `#3723: no entry when per-test identity is unknown`
    - Cases: (a) a base run with exitCode `null`; (b) an isolated log whose tree is malformed (the existing "suite name spanning lines" shape); (c) a base log with an unclosed `▶ suite` opener (`wellFormed: false`); (d) a file absent at base whose full-run name line does not parse (a `null` name).
    - Assert, for each: the file stays in `attributable` and `r.attributedTests` has no key for it.
  - `#3723: attributedTests never touches the verdict`
    - Inputs: the existing AC1 fixture (both files baseline).
    - Assert: `r.attributedTests` deep-equals `{}` and `r.verdict === 'pass'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/verify/baseline.test.js`
Expected: FAIL — `r.attributedTests` is `undefined`.

- [ ] **Step 3: Implement in `plugin/bin/lib/verify/baseline.js`**
  - `baseEv` entries also carry `tree` (the `testTree` result already computed there).
  - Add `function attributedTestsOf({ atBase, headTests, baseRun, ev, isoText, isoFamily }) -> { tests, headFailing, baseFailing, absentAtBase } | null`.
    - **Absent at base:** `headTests` is non-empty with no `null` in it. Return `tests = headTests.map((n) => [n])`, `headFailing = tests.length`, `baseFailing = 0`, `absentAtBase = [...tests]`.
    - **Otherwise:** require a readable isolated HEAD log (`headRuns[k]`'s, the first isolated run) that `accountedFamily` accepts, with a well-formed `testTree` whose `failed` is non-empty. Let `iso` be those `failed` paths, parsed with `JSON.parse`.
      - Base exited 0: return `{ tests: iso, headFailing: iso.length, baseFailing: 0, absentAtBase: null }`.
      - `ev` is present with `ev.tree.wellFormed`: `tests = multisetMinus(isoTree.failed, ev.tree.failed)`, parsed, and an empty result returns `null`. `headFailing = isoTree.failed.length`, `baseFailing = ev.tree.failed.length`, and `absentAtBase` is the tests whose JSON key is absent from `ev.tree.paths`.
      - Any other case returns `null`.
  - In the classification loop, just before `attributable.push(w.file)`, compute the value inside `try { … } catch { /* fail open: no entry */ }`. Store non-null results in `const attributedTests = {}`, and add `attributedTests` to the eligible return object.
  - Add a comment: report-only (#3723), never read by the verdict; identity is the suite path per `testTree`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/verify/baseline.test.js tests/bin-lib/verify/cli.test.js`
Expected: PASS for every test, old and new.

- [ ] **Step 5: Document the field**
  - **verification.md:** add `attributedTests` (one clause: the new tests per attributable file by suite path, plus HEAD/base failing counts and the paths absent at base; report-only) to the field list. Cut equal bytes in that paragraph, and confirm `wc -c plugin/skills/test/verification.md` ≤ 52500.
  - **docs/plugin-structure.md:** append to the baseline.js entry: `; #3723 — an eligible result also carries report-only attributedTests: per attributable file whose per-test identity is known, the isolated HEAD run's failing suite paths that base does not fail (a file absent at base: the full run's leaf names), HEAD/base failing counts, and which of those paths exist nowhere at base (null when the base run passed) — never read by the verdict`.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/verify/baseline.js tests/bin-lib/verify/baseline.test.js plugin/skills/test/verification.md docs/plugin-structure.md
git commit -m "Add attributedTests to baseline adjudication — per-test identity for attributable files (refs #3723)"
```

### Task 2: Per-test excerpts and the possible-rename note in the filer

**Files:**
- Modify: `tools/windows-regression/file-issue.js` (`excerptFor` at ~150-179, `composeIssue` at ~226-261, the header comment)
- Test: `tests/windows-regression-file-issue.test.js`

**Interfaces:**
- Consumes: Task 1's `baselineAdjudicated.attributedTests` shape.
- Produces:
  - `excerptsForTests(file, tests: string[][], source) -> (string|null)[]`: one excerpt per test, in order, with `null` when the test's block is not in this source.
  - `excerptFor(file, source)` keeps its signature and output.

- [ ] **Step 1: Write the failing tests** in `tests/windows-regression-file-issue.test.js`, using `winBlock`, `adjudicated`, `fakeDeps`, `argv`, `created`. `ent(tests, extra)` is a local helper that builds `{ [LEDGER_FILE]: { tests, headFailing: 2, baseFailing: 1, absentAtBase: [], ...extra } }`.
  - `#3723 AC1.1: the attributed test's block is quoted, not the file's first failure`
    - Inputs: region `winBlock(1,'pre-existing failure',LEDGER_FILE,'old-detail')` + `\n` + `winBlock(2,'new regression',LEDGER_FILE,'new-detail')`, with `attributedTests: ent([['new regression']])`.
    - Assert: the body includes `not ok 2 - new regression`, `new-detail` and `attributed as new`, and does not include `old-detail`.
  - `#3723 AC2.1: equal failing counts and every attributed path absent at base → possible-rename note`
    - Inputs: `ent([['new regression']], { headFailing: 1, baseFailing: 1, absentAtBase: [['new regression']] })`.
    - Assert: the body includes `possible rename of an already-failing test`.
    - Counter-cases, each asserting the phrase is absent: `baseFailing: 2`; `absentAtBase: []`; `absentAtBase: null`; `headFailing: 0, baseFailing: 0`.
  - `#3723: suite path picks the right block when two suites share a leaf name`
    - Inputs: TAP region `# Subtest: B`, `    not ok 1 - works` (location LEDGER_FILE, `b-detail`), `not ok 1 - B`, then `# Subtest: A`, `    not ok 1 - works` (`a-detail`), `not ok 2 - A`, with `tests: [['A','works']]`.
    - Assert: `a-detail` is present and `b-detail` is absent.
  - `#3723: no attributedTests entry falls back to the first-match excerpt and says so`
    - Inputs: plain `adjudicated(LEDGER_FILE)` with the two-block region.
    - Assert: the body includes `old-detail` and `per-test attribution unavailable`.
  - `#3723: a repeated path quotes each occurrence's own block`
    - Inputs: blocks 1 and 2 both named `dup`, with details `d1` and `d2`; `tests: [['dup'],['dup']]`.
    - Assert: `d1` and `d2` each appear exactly once.
  - `#3723: an attributed test with no block in any source falls back for that file`
    - Inputs: `tests: [['missing']]`.
    - Assert: `old-detail` and `per-test attribution unavailable` are present.
  - `#3723: a malformed attributedTests value is unavailable, not a crash`
    - Inputs: `attributedTests` values `'x'`, `ent('new regression')`, `ent([])`, `ent([[]])`, `ent([[1]])`, `ent(['new regression'])`.
    - Assert, for each: `run` returns 1 and the body includes `per-test attribution unavailable`.
  - `#3723: a CRLF log still matches the attributed block`
    - Inputs: the AC1.1 region with `\n` replaced by `\r\n`, served via `--log`.
    - Assert: `new-detail` is present.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/windows-regression-file-issue.test.js`
Expected: FAIL — `old-detail` is quoted, no rename note, no case label.

- [ ] **Step 3: Implement in `tools/windows-regression/file-issue.js`**
  - Factor two pieces out of `excerptFor` so both functions share them, leaving `excerptFor`'s output unchanged:
    - the `ownerAt` closure (stopping at the block's own `yamlClose`);
    - the end-of-excerpt walk (from `openIndent` to `lines.slice(start, end)`).
  - `excerptsForTests(file, tests, { lines, normalized, tap })`. A `notOk` line `i` is a block for path `P` when all four hold:
    - its name, the text after `not ok N - ` on the `\r`-stripped line, untrimmed, with any `# SKIP|TODO` directive excluding it, equals `P`'s last element;
    - when `P.length > 1`, the names of its enclosing `# Subtest:` lines (indent strictly less than line `i`'s, still open) equal `P.slice(0, -1)`. Track them with a stack: pop entries at indent ≥ the current line's on each `subtest`/`ok`/`notOk` line, then push on `subtest`;
    - some line `j` with `j === i || ownerAt(j) === i` satisfies `namesFile(normalized[j], slashes(file))`;
    - no earlier test in `tests` already took it.
  - Each test takes the earliest such block. The excerpt opens at `i`, and the end walk uses `tap[i].indent`.
  - `composeIssue`:
    - A file's entry is usable when `report.baselineAdjudicated.attributedTests` is a plain object and the entry's `tests` is a non-empty array of non-empty string arrays.
    - For a usable entry, look up each test across the sources in order (log, then region, as today).
    - If at least one test is found, render `#### \`{file}\``, then `_Excerpts for the {n} test(s) the baseline adjudication attributed as new._`, then one fenced excerpt per found test, then ``- `{path joined by ' > '}`: no log block found`` for each test not found.
    - Otherwise, render the existing first-match excerpt preceded by `_Per-test attribution unavailable — excerpt around the first log line naming this file._`.
  - Bullet note: append ` — possible rename of an already-failing test (base and HEAD both fail {n} test(s) here; no attributed test exists at base)` after the timed-out annotation when all of these hold:
    - the entry is usable;
    - `headFailing` and `baseFailing` are equal integers greater than 0;
    - `Array.isArray(absentAtBase)` and `absentAtBase.length === tests.length`.
  - Header comment: excerpts follow `attributedTests` (#3723), with the first-match fallback.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/windows-regression-file-issue.test.js`
Expected: PASS, all tests (the existing F1/L13/L21/M1 excerpt tests unchanged).

- [ ] **Step 5: Revert-check for AC3.1**
  1. Write `git show HEAD:tools/windows-regression/file-issue.js` to a scratch path and swap it in.
  2. Run the AC1.1 and AC2.1 filer tests and confirm both fail. Restore the file in the same command and confirm `git diff --stat` shows only this task's changes.
  3. Do the same for Task 1's AC1.1/AC2.1 tests against `git show HEAD~1:plugin/bin/lib/verify/baseline.js`.
  4. Record the outcome with `log-decision.js --step "AC evidence"`.

- [ ] **Step 6: Commit**

```bash
git add tools/windows-regression/file-issue.js tests/windows-regression-file-issue.test.js
git commit -m "Quote attributed tests and flag likely renames in the Windows regression filer (refs #3723)"
```

### Task 3: Full suite (folded into Common Step 5)

- [ ] AC3.2: run `npm test` through the build's Common Step 5 verification (`verify.js`). Expected: exit 0, or a baseline-adjudicated pass.
