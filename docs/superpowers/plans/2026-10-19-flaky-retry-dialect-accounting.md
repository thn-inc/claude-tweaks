# Flaky Retry Per-Dialect Failure Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `unattributedFailureCount` returns `0` or a positive count for jest and vitest logs, so runner-owned flaky retry works for those suites again. pytest keeps refusing with `no-accounting-guard: summary`.

**Architecture:** Inside `plugin/bin/lib/verify/extract.js`, the `summary` family gains a dialect sniff (`summaryDialect`): jest (a `Test Suites:` or `Tests:` line) or vitest (a colon-free `Test Files N` line). For each dialect, `unattributedFailureCount` counts the distinct test files named on `FAIL` lines, compares that against the dialect's failed-suite total, and adds every failure signal no file accounts for: vitest's `Errors` block, and a coverage-threshold failure line. pytest, and any log carrying both or neither dialect's markers, still returns `null`. `flaky.js` and `verify.js` are unchanged — they already consume the count.

**Tech Stack:** Node 18+, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T185620-record-3480/work/3480-spec.md`

## Global Constraints

- pytest keeps refusing with exactly `no-accounting-guard: summary` (collection `ERROR`s sit outside every `FAILED` line — captured below).
- A jest or vitest log carrying a failure no named file accounts for refuses with exactly `unattributed-failures: {N}`.
- jest accounting: distinct `FAIL` test files against `Test Suites: N failed`. vitest accounting: distinct `FAIL` test files against `Test Files N failed`, plus a check for an `Errors` block.
- Fail toward refusal: anything unparseable for a detected dialect is unattributed (`1`), never accounted (`0`).
- Scope and edit discipline: touch only what the task requires; match surrounding style; tests sized like neighbouring tests.

## Captured logs (real runner output, already sanitized)

These were captured on 2026-10-19 from jest 29.7.0, vitest 1.6.0 (+ @vitest/coverage-v8 1.6.0) and pytest 8.3.3, with `NO_COLOR=1` and `CI=1`. The only edits: the scratch project's absolute path became `/repo`, and vitest's `Start at` time became `12:00:00`. Source directory (copy byte-for-byte):

`/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/9c4a1761-d3de-416e-898e-09cab2ee2e6c/scratchpad/dialects/fixtures/`

| File | What it is | `unattributedFailureCount` | `extractFailingFiles` |
|---|---|---|---|
| `jest-attributed.txt` | one failing test in `tests/flaky.test.js`; `Test Suites: 1 failed` | `0` | `['tests/flaky.test.js']` |
| `jest-suite-failed-to-run.txt` | `tests/broken.test.js` throws at import + the flaky failure; `Test Suites: 2 failed` | `0` | `['tests/broken.test.js', 'tests/flaky.test.js']` |
| `jest-coverage-threshold.txt` | flaky failure + `Jest: "global" coverage threshold for lines (100%) not met: 66.66%` | `1` | `['tests/flaky.test.js']` |
| `vitest-attributed.txt` | flaky failure; `Test Files  1 failed \| 1 passed (2)` | `0` | `['tests/flaky.test.js']` |
| `vitest-failed-suite.txt` | flaky failure + `Failed Suites 1` block whose line is ` FAIL  tests/broken.test.js [ tests/broken.test.js ]` | `0` | `['tests/flaky.test.js', 'tests/broken.test.js']` |
| `vitest-unhandled-error.txt` | flaky failure + `Unhandled Errors` banner + `     Errors  1 error` | `1` | `['tests/flaky.test.js']` |
| `vitest-coverage-threshold.txt` | flaky failure + `ERROR: Coverage for lines (50%) does not meet global threshold (100%)` | `1` | `['tests/flaky.test.js']` |
| `pytest-attributed.txt` | `FAILED tests/test_flaky.py::test_sometimes_fails` only | `null` | — |
| `pytest-collection-error.txt` | same + `ERROR tests/test_broken.py - RuntimeError…` | `null` | — |

## Review Focus

- A vitest `Failed Suites` line (` FAIL  path [ path ]`): today `SUMMARY_FAIL_RE` swallows the ` [ … ]` suffix into the path. Left that way, a fully attributed vitest log reads as unattributed. Pinned by the `vitest-failed-suite.txt` assertions in Task 1.
- A jest log whose `Test Suites:` line is missing (truncated, or a `Tests:` line only) must be `1`, not `null` and not `0`. Pinned in Task 1.
- jest prints the same `FAIL path` line twice when its "Summary of all failing tests" section renders. Distinct files, never line count. Pinned in Task 1.
- A log carrying both jest and vitest markers is ambiguous and must return `null`. Pinned in Task 1.
- A coverage-threshold failure beside a fully attributed `FAIL` set. The retry would pass the file and clear a check that still fails on coverage. Pinned by both `*-coverage-threshold.txt` fixtures in Task 1.

---

### Task 1: Per-dialect accounting in `unattributedFailureCount`, with captured-log tests

**Files:**
- Create: `tests/fixtures/verify-dialects/` (the nine `.txt` files above, copied byte-for-byte)
- Modify: `plugin/bin/lib/verify/extract.js` (`SUMMARY_FAIL_RE` ~line 199, `unattributedFailureCount` ~lines 563-588, header comment, `module.exports`)
- Test: `tests/bin-lib/verify/extract.test.js`
- Test: `tests/bin-lib/verify/flaky.test.js`
- Test: `tests/bin-lib/verify/cli.test.js`

**Interfaces:**
- Produces: `summaryDialect(text: string) -> 'jest' | 'vitest' | null` (exported from `extract.js`; expects ANSI-stripped text, so callers strip first).
- Produces: `unattributedFailureCount(text, family, { cwd })`: for `family === 'summary'` it returns `number` for jest/vitest and `null` otherwise. spec/tap behaviour is unchanged.

- [ ] **Step 1: Copy the fixtures**

Copy the nine files from the source directory above into `tests/fixtures/verify-dialects/`, keeping the names. Verify: `ls tests/fixtures/verify-dialects | wc -l` prints `9`.

- [ ] **Step 2: Write the failing tests in `tests/bin-lib/verify/extract.test.js`**

Add a `readDialect(name)` helper (`fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'verify-dialects', name), 'utf8')`) and a table-driven test over the nine fixtures, asserting `sniffFamily(log) === 'summary'` and each row's `unattributedFailureCount` and `extractFailingFiles` value (the table above, `deepStrictEqual`). Also add:

```js
test('summaryDialect: jest from Test Suites:/Tests:, vitest from colon-free Test Files, pytest and mixed are null (#3480)', () => {
  assert.strictEqual(summaryDialect(readDialect('jest-attributed.txt')), 'jest');
  assert.strictEqual(summaryDialect(readDialect('vitest-attributed.txt')), 'vitest');
  assert.strictEqual(summaryDialect(readDialect('pytest-collection-error.txt')), null);
  assert.strictEqual(summaryDialect(`${readDialect('jest-attributed.txt')}\n Test Files  1 failed (1)`), null);
  assert.strictEqual(unattributedFailureCount(`${readDialect('jest-attributed.txt')}\n Test Files  1 failed (1)`, 'summary'), null);
});

test('unattributedFailureCount: a jest log with no Test Suites: line fails closed to 1, never null or 0 (#3480)', () => {
  const log = ['FAIL tests/flaky.test.js', '  ● flaky › sometimes fails', 'Tests:       1 failed, 2 passed, 3 total'].join('\n');
  assert.strictEqual(unattributedFailureCount(log, 'summary'), 1);
});

test('unattributedFailureCount: a jest Test Suites count above the distinct FAIL files is unattributed by the difference (#3480)', () => {
  const log = readDialect('jest-attributed.txt').replace('Test Suites: 1 failed', 'Test Suites: 3 failed');
  assert.strictEqual(unattributedFailureCount(log, 'summary'), 2);
});

test('unattributedFailureCount: jest repeating a FAIL line in its failing-tests summary counts the file once (#3480)', () => {
  const log = readDialect('jest-attributed.txt').replace('Test Suites:', 'Summary of all failing tests\nFAIL tests/flaky.test.js\n  ● flaky › sometimes fails\n\nTest Suites:');
  assert.strictEqual(unattributedFailureCount(log, 'summary'), 0);
});

test('unattributedFailureCount: a jest FAIL line naming a non-test file is unattributed (#3480)', () => {
  const log = readDialect('jest-attributed.txt').replace('PASS tests/ok.test.js', 'FAIL src/setup.js\n  ● Test suite failed to run').replace('Test Suites: 1 failed', 'Test Suites: 2 failed');
  assert.strictEqual(unattributedFailureCount(log, 'summary'), 1);
});

test('unattributedFailureCount: an ANSI-coloured vitest log is accounted the same as its plain twin (#3480)', () => {
  const plain = readDialect('vitest-attributed.txt');
  const coloured = plain.replace(' FAIL ', ' \x1b[31mFAIL\x1b[39m ').replace(' Test Files ', '\x1b[2m Test Files \x1b[22m');
  assert.strictEqual(unattributedFailureCount(coloured, 'summary'), 0);
});
```

Retitle the existing `unattributedFailureCount: TAP with a stack frame naming no retryable file …` test so it no longer claims every non-spec/tap family is null. It now covers "a pytest summary log and a generic log are null (#3204, #3480)", and its `PYTEST_FIXTURE`/`GENERIC_FIXTURE` assertions stay as they are.

- [ ] **Step 3: Run to verify they fail**

Run: `node --test tests/bin-lib/verify/extract.test.js`
Expected: FAIL. `summaryDialect` is not a function, and the jest/vitest rows return `null`.

- [ ] **Step 4: Implement in `plugin/bin/lib/verify/extract.js`**

- `SUMMARY_FAIL_RE`: add `\s\[` to the terminator lookahead (`(?=\s>\s|\s\(|\s\[|::|$)`). That is vitest's `Failed Suites` ` [ path ]` suffix; update the comment above it to name the bracket terminator.
- `summaryDialect(text)`: jest when `/^Test Suites:/m` or `/^Tests:/m` matches, vitest when `/^\s*Test Files\s+\d+/m` matches; `null` when neither or both.
- `unattributedFailureCount`: for `family === 'summary'`, strip ANSI and resolve the dialect; `null` dialect → `null`. Otherwise:
  1. Over lines matching `/^\s*FAIL\s/`, apply `SUMMARY_FAIL_RE`, relativize with `cwd`, and keep a `Set` of paths passing `isRetryableFile`. Count every other `FAIL` line (no capture, or not a test file) as `unmatched`.
  2. `nonFile` = the count of coverage-threshold lines (`/^Jest: .*coverage threshold for .* not met/m` and `/^ERROR: Coverage for .* does not meet .*threshold/m`, global matches), plus for vitest `max(Errors count from /^\s*Errors\s+(\d+) errors?\b/m, 1 if /^⎯+ Unhandled Errors? ⎯+/m matches else 0)`.
  3. `unmatched + nonFile > 0` → return that sum.
  4. Failed-suite total: jest reads the `^Test Suites:.*$` line (absent → return `1`) and its `(\d+) failed` (absent → `0`); vitest does the same on the `^\s*Test Files\s.*$` line.
  5. Return `Math.abs(set.size - failedSuites)`.
- Rewrite the comment above `unattributedFailureCount`, and the header's family line, to state the jest/vitest accounting and that pytest (collection `ERROR`s outside every `FAILED` line) and an ambiguous summary log return `null`.
- Export `summaryDialect`.

- [ ] **Step 5: Run to verify they pass**

Run: `node --test tests/bin-lib/verify/extract.test.js`
Expected: PASS (0 failures).

- [ ] **Step 6: Update the planRetry and CLI tests the new accounting changes**

In `tests/bin-lib/verify/flaky.test.js`:
- The existing `planRetry: a summary-family log … no-accounting-guard (#3204 AC)` test: `JEST_UNATTRIBUTED` (its `FAIL src/setup.js` names no test file) now yields `unattributedCount === 1` and `{ retry: false, reason: 'unattributed-failures: 1' }`. Retitle: `planRetry: a jest log with an allowlisted failing file plus a failing suite no test file accounts for refuses retry — unattributed-failures (#3480)`.
- Add `planRetry: a fully attributed jest log whose failing file is allowlisted retries that file (#3480 AC)`: `jest-attributed.txt` → `failingFiles ['tests/flaky.test.js']`, `unattributedCount 0`, `plan.retry === true`, `plan.files` deep-equal to `['tests/flaky.test.js']`.
- Add `planRetry: a vitest log with an unhandled error refuses retry even when its failing file is allowlisted — unattributed-failures: 1 (#3480 AC)` on `vitest-unhandled-error.txt`.
- Add `planRetry: a pytest log still refuses — no-accounting-guard: summary, with or without a collection error (#3480 AC)`: run both pytest fixtures through `sniffFamily`/`extractFailingFiles`/`unattributedFailureCount`/`planRetry` with `flaky: { files: ['tests/test_flaky.py'], maxRetries: 1 }`. Expected reason `no-accounting-guard: summary` for both.

In `tests/bin-lib/verify/cli.test.js`:
- `flaky retry: a summary-family failure refuses retry … (#3204)`: expected `retryDecision` becomes `{ retry: false, reason: 'unattributed-failures: 1' }`. Retitle it to name a jest log and `#3480`, and update its comment and `assert.ok` message.
- Add `flaky retry: a fully attributed jest log whose failing file is allowlisted retries it through the real CLI wiring (#3480 AC)`. Model it on that test, with `fail.js` printing `jest-attributed.txt`'s content (read from the fixture at test time and embedded via `JSON.stringify`), `flaky: { files: ['tests/flaky.test.js'] }`, and `retry.js` writing `retry.marker` and exiting 0. Expect exit code `0`, `retry.marker` containing `tests/flaky.test.js`, `report.checks.tests.retryDecision` deep-equal to `{ retry: true, files: ['tests/flaky.test.js'] }`, and stdout matching `/flaky-retried: tests\/flaky\.test\.js/`.
- `AC2.1 preExisting: a summary-family log …`: the log becomes pytest-shaped, `['FAILED tests/known-shallow.test.js::test_known - assert 1 == 2', '========================= 1 failed, 3 passed in 0.02s ========================='].join('\n')`, still refused with `no-accounting-guard: summary`. Retitle: `AC2.1 preExisting: a pytest summary log is never adjudicated through preExisting — no-accounting-guard: summary (#3481, #3480)`.

- [ ] **Step 7: Run the three suites**

Run: `node --test tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/flaky.test.js tests/bin-lib/verify/cli.test.js`
Expected: PASS (0 failures).

- [ ] **Step 8: Prove discrimination**

Temporarily make `unattributedFailureCount`'s summary branch `return null` (an in-place edit — never `git stash`), re-run Step 7's command, and confirm the new jest/vitest assertions fail. Then restore the implementation and re-run until green.

- [ ] **Step 9: Commit**

```bash
git add tests/fixtures/verify-dialects plugin/bin/lib/verify/extract.js tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/flaky.test.js tests/bin-lib/verify/cli.test.js
git commit -m "Account jest and vitest failures per dialect — flaky retry fires again for fully attributed logs"
```

(Body: `refs #3480`, then the session trailer.)

### Task 2: Prose — name the dialects that retry and the one that does not

**Files:**
- Modify: `plugin/skills/test/verification.md` (preExisting paragraph ~line 163; Flake handling ~lines 207-209)
- Modify: `docs/journeys/run-a-deterministic-verification-check.md` (Step 10 URL/Should understand/Red flags; Step 15 URL/Red flags; history list)
- Modify: `.claude/skills/node-test-output-evidence/SKILL.md` (Overview line 10; the `unattributedFailureCount` bullets ~line 58; Decision Framework row "A family other than spec or tap"; Common Mistakes row ~line 108)
- Modify: `docs/plugin-structure.md` (line 53's "null for every family other than spec/tap (#3204 …)" clause)
- Test: `tests/verification-flake-handling.test.js` (must stay green — it pins `a \`no-accounting-guard: {family}\` reason (#3204`)

**Interfaces:**
- Consumes: Task 1's behaviour — jest (distinct `FAIL` test files vs `Test Suites: N failed`) and vitest (vs `Test Files N failed`, plus the `Errors` block) are accounted. A coverage-threshold failure line counts as unattributed. pytest returns `null`, because its collection `ERROR`s sit outside every `FAILED` line.

- [ ] **Step 1: Edit the four documents**

Every place that today says the summary family (jest/pytest/vitest) never retries, or always refuses with `no-accounting-guard: summary`, must instead say three things. jest and vitest retry when their failures fully account (state each dialect's check, with `#3480`). A jest/vitest log with a failure no named file accounts for refuses with `unattributed-failures: {N}`. pytest still refuses with `no-accounting-guard: summary`, and the reason is that its collection `ERROR`s sit outside every `FAILED` line. The same change applies to the `preExisting` guard (verification.md line 163, journey Step 15), which reuses the count: an accounted jest/vitest log can now be adjudicated, and pytest still refuses. Add one journey history bullet: `- Step 10 and Step 15 extended by #3480 (…)`, in the existing bullets' style. Keep every existing `#3204`/`#3066` citation, keep each edit in place, and touch no other text.

- [ ] **Step 2: Verify**

Run: `node --test tests/verification-flake-handling.test.js`
Expected: PASS.
Run: `git grep -n -e "jest/pytest/vitest" -e "jest/vitest/pytest" -- plugin/skills/test/verification.md docs/journeys/run-a-deterministic-verification-check.md .claude/skills/node-test-output-evidence/SKILL.md docs/plugin-structure.md`
Expected: every remaining hit says pytest refuses and jest/vitest are accounted. No hit may claim the whole family refuses.

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/test/verification.md docs/journeys/run-a-deterministic-verification-check.md .claude/skills/node-test-output-evidence/SKILL.md docs/plugin-structure.md
git commit -m "Name the dialects flaky retry accounts for — jest and vitest retry, pytest still refuses"
```

(Body: `refs #3480`, then the session trailer.)

## As-built deviations (Common Step 4.5, classified Beneficial)

1. **More unattributed signals than the spec named.** The spec named jest `FAIL` files vs `Test Suites: N failed` and vitest's `Errors` block. The whole-branch review enumerated each runner's exit channels from source. As a result, `summaryUnattributedCount` also counts coverage-failure lines, global setup/teardown errors, jest obsolete-snapshot lines, a post-summary Node crash trailer, interrupted runs (jest: failed+skipped+passed < M; vitest: any skipped file), and logs carrying more than one summary line. `SUMMARY_FAIL_RE` also stops at ` [`. The spec's own acceptance criterion requires this: "a failure no named file accounts for refuses". The one residual channel the SDD final review left open, vitest's post-summary `Unhandled Rejection` banner (ledger item 13), was closed in the review phase with a captured fixture.
2. **preExisting adjudication widened.** `verify.js`'s declared-`preExisting` guard (#3481) reads the same count, so it now adjudicates a fully accounted jest/vitest log. A CLI test pins this, and the prose names it.
3. **vitest skipped files refuse.** vitest 1.6 prints no bail marker, and `describe.skip` has the same shape. Any vitest log with a skipped test file therefore falls back to the whole-suite re-run (ruling staged as `sdd-ruling-2`).
