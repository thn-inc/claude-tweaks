# No wall-clock budgets in tests/ — conformance test (#3491) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `node --test` conformance scan fails `npm test` on any wall-clock timing budget placed under `tests/`, naming `file:line` and pointing at `perf/`.

**Architecture:** Task 1 adds an opt-in `literals: 'blank'` mode to the shared comment stripper (`tests/helpers/strip-comments.js`), so a scan can look for operators without a `<` inside a string, template text or regex reading as code. It reuses the stripper's one scanner and does not add a second tokenizer. Task 2 adds `tests/wall-clock-budget-conformance.test.js`. It walks `tests/**/*.test.js` and taint-tracks identifiers assigned from a wall-clock read. It flags a `<`/`<=`/`>`/`>=` comparison whose one side is wall-clock-derived and whose other side is a pure numeric budget. Every pre-existing offender sits on an exact per-file allow-list with a required reason, in the same shape as `tests/path-guard-conformance.test.js`.

**Tech Stack:** Node 18+, `node:test`, `node:assert/strict`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T061255-record-3491/work/3491-spec.md` (materialized from GitHub issue #3491)

**Premise-refs:** docs/plugin-structure.md, tests/helpers/strip-comments.js, tests/path-guard-conformance.test.js, perf/closing-keyword-linearity.test.js

**Scope keywords:** performance.now, process.hrtime

## Global Constraints

- The scan covers `tests/**/*.test.js` only. `perf/` is never walked (the spec: "A budget assertion under `perf/` does not trip the test").
- Detected wall-clock sources: `performance.now(`, `Date.now(`, `process.hrtime(` and `process.hrtime.bigint(` (the spec's three, plus hrtime's bigint form).
- Every failure line names `{file}:{line}`, says timing budgets belong in `perf/` (`npm run test:perf`), and cites `docs/plugin-structure.md`'s perf/ entry.
- Every allow-list entry carries a non-empty one-line `reason`. An entry without one fails, an entry for a missing file fails, and a count drift in either direction fails.
- Use the shared stripper (`tests/helpers/strip-comments.js`). A file whose `stripperVerdict` is not `ok` is an offender, never a clean zero.
- Commit messages say `refs #3491`, never `closes`/`fixes`.

## Corrected premise (logged in decisions.md as `premise reversed:`)

The spec's Current State says `grep -rl performance.now tests/` returns only #3412's test file, and AC3 expects zero offenders once #3412's patch lands. Probed in this worktree at authoring time:

- #3412's budget already moved to `perf/closing-keyword-linearity.test.js`. `tests/bin-lib/reconcile/release-merged.test.js` has no `performance.now`.
- A prototype of Task 2's matcher, run over the real tree, finds **12 budget assertions in 9 files**:

| File | Lines | Shape |
|---|---|---|
| tests/bin-lib/code-health/candidates-scale-readiness.test.js | 923, 935 | `elapsed < 1000` |
| tests/bin-lib/dream/scan.test.js | 284 | `Date.now() - started < 500` |
| tests/bin-lib/flow/preflight.test.js | 177 | `Date.now() - t0 < 600` |
| tests/bin-lib/gif/palette.test.js | 82 | `elapsedMs < 5000` |
| tests/bin-lib/git-retry.test.js | 110 | `elapsed < 1000` |
| tests/bin-lib/health-core/premise-self-check.test.js | 72 | `Date.now() - start < 4000` |
| tests/bin-lib/model-profiles/session-failures.test.js | 179, 194 | `Date.now() - start < 2000` |
| tests/bin-lib/wrap-up/pack.test.js | 688 | `wall < 600` |
| tests/reconcile.test.js | 2213, 2238 | `elapsed < 2500`, `Date.now() - start < 1000` |

Independent count: a one-line grep (`grep -rn "Date.now()" tests/ | grep -E "[<>]=? *[0-9]"`) independently finds the 7 direct `Date.now() - x < N` sites in this table. The other 5 sites use an intermediate variable (`const elapsed = Date.now() - start`), and the grep cannot see that form. Each was read by hand and confirmed. With the allow-list in place, AC3 ("the existing suite passes with the test in place") is met. Moving these 12 to `perf/` is out of scope for this record (it changes other suites' coverage), and it is recorded as an open ledger item. `palette.test.js:153` (`best.elapsedMs < MAX_RATIO * best.baselineMs`) is deliberately not flagged. Both sides are wall-clock-derived, so it is a load-relative ratio, not a numeric budget (#3246's design).

## Review Focus

1. A `<` inside a string, template text, regex or comment must never form a comparison. Task 1 blanks literals, and Task 2's negative self-tests pin it.
2. A timestamp passed as a call argument (`gitChurn(root, 'pkg', Date.now(), {…}) >= 1`, `tests/bin-lib/code-health/scope.test.js:742`) is not a timing operand. Task 2's call-argument opacity handles it, and a negative self-test pins it.
3. The same variable name in two tests (`start = Date.now()` in one, `start = 5` in another) must not cross-taint. Taint is per top-level statement, and a negative self-test pins it.
4. A budget compared through a numeric constant (`const BUDGET_MS = 200; … elapsed <= BUDGET_MS`), in reversed order (`200 > elapsed`), or split across lines inside `assert.ok(` must still be caught. Each has a positive self-test.
5. Known limit, stated in the file header and not tested as caught: a duration measured inside the code under test and read back as a property (`pack.durationMs < 600`, `tests/bin-lib/wrap-up/pack.test.js:689`) has no wall-clock read in the test body. The scan cannot see it.

---

### Task 1: `literals: 'blank'` mode for the shared comment stripper

**Files:**
- Modify: `tests/helpers/strip-comments.js` (`stripComments`, the header comment)
- Test: `tests/helpers-strip-comments.test.js`

**Interfaces:**
- Produces: `stripComments(src: string, { literals = 'keep' }: { literals?: 'keep' | 'blank' } = {}) -> string`. The default `'keep'` output is byte-identical to today. With `'blank'`, every non-newline character is replaced by a space in: a string literal's body (between its quotes, both quotes kept), a template literal's raw text (backticks, `${`, the closing `}` and all the code inside `${…}` kept), and a regex literal's body (between the slashes; both slashes and the flags kept). Output length and every newline offset equal the input's, as they do for comments today. `stripperVerdict` and `STRIPPER_VERDICT_MESSAGES` are unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/helpers-strip-comments.test.js`:
  - `test("literals: 'blank' empties string, template-text and regex bodies but keeps their code and offsets", …)`. The input lines are `const a = 'x < 1';`, ``const t = `took ${Date.now() - s} < 5`;``, `const r = /a<b/g;`, `live(x < 2);` and `const e = 'it\'s < 3';`. Assertions: the output length equals the input length; `newlineIndices(out)` deep-equals the input's; the output includes `live(x < 2);`, `Date.now() - s` and `/g;`; the output does not include `x < 1`, `took`, `a<b` or `s < 3`; every `'` and `` ` `` sits at the same index as in the input.
  - `test("literals: 'blank' still blanks comments, and an unterminated string blanks to the end of its line", …)`. Input `"live(); // c < 1\nconst u = 'open < 2\nnext();"`. The output includes `live();` and `next();`, and does not include `c < 1` or `open < 2`.
  - `test('the default and literals: keep leave literals verbatim (unchanged behaviour)', …)`. For the first test's input, `stripComments(input)` strictly equals `stripComments(input, { literals: 'keep' })`, and the output includes `x < 1` and `a<b`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/helpers-strip-comments.test.js`
Expected: FAIL — the first two new tests fail (literal text such as `x < 1` survives); the third passes.

- [ ] **Step 3: Implement** the option in `stripComments`. Add `blank(...)` calls at the three literal branches the scanner already has: the string branch (around `scanString`), the regex branch (around `scanRegex`), and `scanTemplate`'s raw-text and escape steps. Update the header comment with one sentence on the option and its purpose (operator scans that must not read literal text as code).

- [ ] **Step 4: Run to verify they pass, and that every existing consumer is unchanged**

Run: `node --test tests/helpers-strip-comments.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/git-status-optional-locks.test.js tests/path-containment-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/strip-comments.js tests/helpers-strip-comments.test.js
git commit -m "Add a literal-blanking mode to the shared comment stripper — operator scans must not read string, template or regex text as code (refs #3491)"
```

### Task 2: `tests/wall-clock-budget-conformance.test.js`

**Files:**
- Create: `tests/wall-clock-budget-conformance.test.js`
- Modify: `docs/plugin-structure.md:73` (the `perf/` line: append one sentence naming the new scan as its enforcement)

**Interfaces:**
- Consumes: `stripComments(src, { literals: 'blank' })`, `stripperVerdict`, `STRIPPER_VERDICT_MESSAGES` from `./helpers/strip-comments` (Task 1).
- Produces (file-local; nothing exported): `findBudgetAssertions(src: string) -> Array<{ line: number, text: string }>` (1-based line of the comparison operator; `text` is the whitespace-collapsed comparison), and `evaluate(files: Record<relPosixPath, string>, allowlist: Record<relPosixPath, { count: number, reason: string }>) -> string[]` (offender lines; `[]` means conformant).

**Matcher (decisions the implementer cannot derive; a scratch prototype of exactly this found the table above with no false positives):**
1. `s = stripComments(src, { literals: 'blank' })`.
2. Split `s` into depth-0 statements. `(`/`[`/`{` raise the depth and the closers lower it. A `;` or newline at depth 0 ends a statement. Each top-level `test(…)`/`describe(…)` call is therefore one statement: the "same test body" scope.
3. Taint. A wall-clock source is `/\b(?:performance\s*\.\s*now|Date\s*\.\s*now|process\s*\.\s*hrtime(?:\s*\.\s*bigint)?)\s*\(/`. An assignment (`const|let|var NAME = expr`, `NAME = expr`, `NAME += expr`; the expression ends at a depth-0 `,`, `;`, newline or unmatched closer) taints `NAME` when its expression is wall-clock-derived. Iterate to a fixpoint, so `elapsed = Date.now() - start` and `best = { elapsedMs }` both taint. A file-level set comes from depth-0 `const|let|var` statements. Each statement's set is the file-level set plus the statement's own assignments.
4. An operand is wall-clock-derived when, after blanking the argument lists of calls, its text contains a wall-clock source or a tainted identifier that does not follow a `.`. A call is a `(` preceded by an identifier, `)` or `]`. Calls to `Number`, `BigInt`, `parseInt`, `parseFloat` and `Math.round|floor|ceil|abs|trunc|max|min`, and the source calls themselves, stay transparent. This makes `gitChurn(…, Date.now(), …)` opaque and keeps `ms(t)` (tainted callee) and `Number(process.hrtime.bigint() - t)` visible.
5. Numeric constants are names bound by `const NAME = expr`, where `expr` is numeric-only (digits, `.`, `e`, `_`, a BigInt `n` suffix, `+ - * / %`, parens). A comma list (`const A = 4, B = 3`) binds each name.
6. Comparisons are `<`, `<=`, `>` and `>=`, never part of `<<`, `>>`, `>>>` or `=>`. An operand extends left and right to a depth-0 `,`, `;`, `?`, `:`, `&&`, `||`, a lone assignment `=`, or an unmatched bracket. A leading `return`/`throw`/`await`/`yield` keyword is dropped.
7. Flag when exactly one side is wall-clock-derived and the other side, with numeric constants replaced by `0`, is numeric-only and contains a digit.

- [ ] **Step 1: Write the failing tests**, built against fixture sources given as single-quoted string arrays joined with `'\n'`, never template literals. Each asserts the exact flagged line numbers:
  - `test('AC1.1: flags a performance.now() budget, direct or through a variable', …)`. Fixture lines: `test('a', () => {`, `  const start = performance.now();`, `  run();`, `  const elapsed = performance.now() - start;`, `  assert.ok(elapsed < 200);`, `  assert.ok(performance.now() - start < 300);`, `});`. Expect lines `[5, 6]`.
  - `test('flags Date.now, process.hrtime.bigint via a helper, a reversed operand, a numeric-const budget and a multi-line assert', …)`. Fixture: a `Date.now() - t0 < 600`; `const ms = (s) => Number(process.hrtime.bigint() - s) / 1e6;` then `assert.ok(ms(t) < 50)`; `assert.ok(200 > elapsed)`; `const BUDGET_MS = 200;` then `elapsed <= BUDGET_MS`; and `assert.ok(` / `  elapsed < 1000,` / `  'msg'` / `);`. Assert each hit's exact line.
  - `test('does not flag a comment, a message string, template text, a ratio of two timings, a timestamp call argument, a timestamp freshness check, a loop bound, or a same-named untainted variable in another test', …)`. Fixture lines: `// elapsed < 200`; `assert.ok(true, 'took < 200ms')`; a template whose raw text holds `< 200`; `elapsedMs < MAX_RATIO * baselineMs` with both tainted; `gitChurn(root, 'pkg', Date.now(), { recursive: false }) >= 1`; `assert.ok(claim.expiresAt > Date.now())`; `for (let i = 0; i < 3; i++) {}`; and test A `const start = Date.now();` beside test B `const start = 5; assert.ok(start < 10);`. Expect `[]`.
  - `test('AC1.1: evaluate names file:line, the perf/ pointer and docs/plugin-structure.md for an un-allow-listed budget', …)`. `evaluate({ 'tests/x.test.js': <the first fixture> }, {})` returns two lines. Each matches `/^tests\/x\.test\.js:(5|6): /`, `/perf\//`, `/npm run test:perf/` and `/docs\/plugin-structure\.md/`.
  - `test('evaluate fails a count drift either way, an entry with no reason, an entry for a missing file, and a non-ok stripper verdict', …)`. Cases: allow-list `count: 1` against 2 hits; allow-list `count: 3` against 2 hits; an entry `{ count: 2, reason: '' }`; an entry for `tests/gone.test.js` absent from `files`; a file `'const a = ;'` (unparseable) with its `STRIPPER_VERDICT_MESSAGES.unparseable` text; a file `"if (x) /'/.test(x); const b = 'p//q';"` (misparsed). One offender each, asserted by `match`.
  - `test('AC1.1, AC3.1: every tests/**/*.test.js passes the scan against ALLOWLIST', …)` walks `tests/` recursively for `*.test.js`, keys files by POSIX path relative to the repo root, and asserts `evaluate(files, ALLOWLIST)` deep-equals `[]`. The assertion message prints the offenders.
  - `test('AC2.1: perf/ budgets are real matches but are never scanned', …)`: (a) the walked file list holds no path starting `perf/`; (b) `findBudgetAssertions` over `perf/closing-keyword-linearity.test.js` returns at least one hit. Part (b) proves the exclusion comes from where the file lives and not from a blind matcher.
  - `test('docs/plugin-structure.md still states the perf/ rule the failure message cites', …)`. The doc matches `/^perf\/\s+→ Wall-clock timing budgets, run via `npm run test:perf`/m`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/wall-clock-budget-conformance.test.js`
Expected: FAIL — the file is new; with `findBudgetAssertions`/`evaluate`/`ALLOWLIST` stubbed to return `[]`/`{}`, the positive self-tests and the live-tree test fail.

- [ ] **Step 3: Implement** `findBudgetAssertions` and `evaluate` per the Matcher section. Write a header comment that states the rule and cites `docs/plugin-structure.md` and #3412/#3491. It also names the known limit (Review Focus 5) and says the exact per-file counts double as the scan's floor: a dead matcher drifts every count. Then build `ALLOWLIST` from the live scan: one entry per file in the Corrected-premise table, with `count` equal to that file's hits. Each entry gets a one-line `reason` judged by reading the site, for example "bounded-wait check: asserts an injected sleep/timeout was skipped, with a generous margin; candidate to move to perf/". If the live scan reports a file or count that differs from the table, stop and report it rather than editing the table to match.

- [ ] **Step 4: Append to `docs/plugin-structure.md:73`** (the `perf/` line), after `(issue #107)`: `; tests/wall-clock-budget-conformance.test.js fails any wall-clock budget placed under tests/ (#3491)`.

- [ ] **Step 5: Run to verify they pass, then prove the gate can go red**

Run: `node --test tests/wall-clock-budget-conformance.test.js tests/helpers-strip-comments.test.js`
Expected: PASS, 0 failures.

Go-red check (AC1.1, scratch only, never committed): write a new file `tests/zz-go-red-scratch.test.js` containing `const { test } = require('node:test'); const assert = require('node:assert'); test('tmp', () => { const t = performance.now(); assert.ok(performance.now() - t < 200); });`. Re-run `node --test tests/wall-clock-budget-conformance.test.js` and expect FAIL with a `tests/zz-go-red-scratch.test.js:1:` line naming `perf/`. Move that file to `perf/zz-go-red-scratch.test.js` and re-run the same command, expecting PASS (AC2.1). Delete the file, then confirm `git status --short` lists only this task's files.

- [ ] **Step 6: Commit**

```bash
git add tests/wall-clock-budget-conformance.test.js docs/plugin-structure.md
git commit -m "Pin the no-wall-clock-budgets-in-tests/ convention with a conformance scan — budgets under tests/ fail npm test with file:line and the perf/ pointer (refs #3491)"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (scan, three sources, numeric budget, `file:line`): Task 2. Deliverable 2 (message cites `docs/plugin-structure.md`): Task 2's `evaluate` test and its doc-pin test. Deliverable 3 (allow-list with a required reason): Task 2's `ALLOWLIST` and its `evaluate` cases. AC1.1: Task 2's AC1.1 tests and the go-red step. AC2.1: Task 2's perf/ test and the go-red step. AC3.1: the live-tree test, with the corrected premise above.
- **Placeholders:** none. The allow-list's reasons are written by reading each site, which is the spec's own requirement ("a required one-line reason").
- **Type consistency:** `findBudgetAssertions` / `evaluate` / `ALLOWLIST` / `stripComments(src, { literals })` match across both tasks.
