# Jest Trailer Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `summaryUnattributedCount` fail closed on a jest log that does not end with jest's own `Ran all test suites…` trailer, so a crash the enumerated channels cannot name in advance no longer reads as fully accounted.

**Architecture:** One positive-recognition check inside `summaryUnattributedCount` (`plugin/bin/lib/verify/extract.js`), jest dialect only, counted only when no enumerated channel already counted the same crash. vitest keeps its enumerated list (decided from captured logs — see Global Constraints). Two captured fixtures pin the behaviour; three prose sites name the guard.

**Tech Stack:** Node 18+, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T000533-record-3674/work/3674-spec.md` (record #3674)

Scope keywords: Ran all test suites, summaryUnattributedCount, UNATTRIBUTED_LINE_RES

## Global Constraints

- The refusal reason stays `unattributed-failures: {N}` — no new reason string (the spec's AC wording).
- `jest-attributed.txt` must still read `unattributedFailureCount` 0 (it still retries).
- Every existing `DIALECT_ROWS` row keeps its current count and file list.
- jest's trailer, from `@jest/reporters/build/SummaryReporter.js` `_getTestSummary` (jest 29.7.0): always `'Ran all test suites' + testInfo + nameInfo + contextInfo + '.'` — starts with `Ran all test suites`, ends with `.`. Match the trimmed last non-empty ANSI-stripped line against `/^Ran all test suites\b.*\.$/`.
- vitest decision (record Deliverable 2): vitest has **no** equally stable closing marker. It writes its summary (`Test Files`/`Tests`/`Start at`/`Duration`) to stdout and its failure blocks to stderr, and `plugin/bin/lib/verify/run.js` pipes both into one log, so the last line depends on pipe interleave: the committed `vitest-attributed.txt` ends on the stderr `⎯[1/1]⎯` divider, while 20 of 20 fresh captures of the same vitest 1.6.0 run end on the stdout `Duration` line (`vitest-summary-last.txt`). jest writes results, summary and trailer to stderr alone, so its order is fixed. vitest keeps its enumerated list.
- Fixtures are real captures with only the probe path rewritten to `/repo` and the `Start at` clock to `12:00:00`, matching the existing `tests/fixtures/verify-dialects/` convention. Never hand-edit their content.
- Commit messages: `{Verb} {what} — {detail}`, `refs #3674`, never `closes`/`fixes`.

## Review Focus

1. A jest log ending in `Ran all test suites matching /…/i.` / `… with tests matching "x".` / `… in 2 projects.` (pattern, name filter, multi-project) must still count as ending normally — `jest-attributed.txt` already carries the `matching` form; Task 1's trailer-variant test pins the other two.
2. A CRLF jest log must read the same as its LF twin — the trailing `\r` must not break the trailer match (existing CRLF test covers `jest-attributed.txt`; it must stay green).
3. An ANSI-coloured trailer (jest dims each segment separately) must match after `stripAnsi` — Task 1's coloured-trailer assertion.
4. A crash an enumerated channel already counts (`jest-teardown-rejection.txt`'s `Node.js v…` trailer, `jest-global-teardown*.txt`) must not count twice — existing `DIALECT_ROWS` rows at 1 pin this.
5. A jest log with text after a normal trailer that is not a crash (e.g. `Jest did not exit one second after the test run has completed.`) refuses — accepted over-refusal in the safe direction (falls back to the whole-suite re-run); Task 1's open-handle assertion pins it as refusing so the trade-off is deliberate, not accidental.

---

### Task 1: The jest trailer guard

**Files:**
- Modify: `plugin/bin/lib/verify/extract.js` (`summaryUnattributedCount`, ~line 634; its doc comment and `unattributedFailureCount`'s comment ~line 669-691)
- Test: `tests/bin-lib/verify/extract.test.js` (`DIALECT_ROWS` ~line 529, new tests after the `DIALECT_ROWS` loop)
- Test: `tests/bin-lib/verify/flaky.test.js` (new `planRetry` test after the `#3480 AC` jest test, ~line 118; that existing test is AC2.1's evidence and must stay green unchanged)
- Test fixtures (already captured, add to git): `tests/fixtures/verify-dialects/jest-results-processor-crash.txt`, `tests/fixtures/verify-dialects/vitest-summary-last.txt`

**Interfaces:**
- Consumes: `stripAnsi`, `summaryDialect`, `readDialect` (test helper), `unattributedFailureCount(text, family, { cwd })`.
- Produces: no new export. `unattributedFailureCount(log, 'summary')` returns ≥1 for a jest log whose last non-empty line is not the trailer.

- [ ] **Step 1: Write the failing tests**

Add to `DIALECT_ROWS`:

```js
['jest-results-processor-crash.txt', 1, ['tests/flaky.test.js']],
['vitest-summary-last.txt', 0, ['tests/flaky.test.js']],
```

Add after the `DIALECT_ROWS` loop:

```js
test('AC1.1, AC3.1: unattributedFailureCount: a jest log whose last line is not the Ran all test suites trailer is unattributed, though no enumerated channel matches (#3674)', () => {
  const log = readDialect('jest-results-processor-crash.txt');
  // The crash is a plain Error after the summary: no FAIL line, coverage,
  // global-hook, Node.js trailer, or second summary line names it.
  assert.ok(log.includes('Ran all test suites.\nError: results processor could not write the report'));
  assert.strictEqual(unattributedFailureCount(log, 'summary'), 1);
  // The same log cut at the trailer is fully accounted: the guard alone refuses it.
  const cut = log.slice(0, log.indexOf('Ran all test suites.') + 'Ran all test suites.'.length);
  assert.strictEqual(unattributedFailureCount(cut, 'summary'), 0);
});

test('unattributedFailureCount: every jest trailer form, coloured or not, ends a normal run; text after it refuses (#3674)', () => {
  const attributed = readDialect('jest-attributed.txt');
  const trailer = 'Ran all test suites matching /tests\\/flaky|tests\\/ok/i.';
  assert.ok(attributed.includes(trailer));
  for (const form of ['Ran all test suites with tests matching "sometimes".', 'Ran all test suites in 2 projects.',
    '\x1b[2mRan all test suites\x1b[22m\x1b[2m.\x1b[22m']) {
    assert.strictEqual(unattributedFailureCount(attributed.replace(trailer, form), 'summary'), 0, form);
  }
  const openHandle = `${attributed}Jest did not exit one second after the test run has completed.\n`;
  assert.strictEqual(unattributedFailureCount(openHandle, 'summary'), 1);
});

test('vitest has no stable closing line: the same captured run ends on either stream, and both account (#3674)', () => {
  const last = (name) => readDialect(name).split(/\r?\n/).filter((l) => l.trim()).pop();
  assert.match(last('vitest-attributed.txt'), /^⎯+\[1\/1\]⎯$/);
  assert.match(last('vitest-summary-last.txt'), /^ {3}Duration /);
  for (const name of ['vitest-attributed.txt', 'vitest-summary-last.txt']) {
    assert.strictEqual(unattributedFailureCount(readDialect(name), 'summary'), 0, name);
  }
});
```

Add to `tests/bin-lib/verify/flaky.test.js`, after the `#3480 AC` jest-attributed test, in that file's existing shape:

```js
test('AC1.1: planRetry: a jest log that crashed after its trailer refuses retry even when its failing file is allowlisted — unattributed-failures: 1 (#3674)', () => {
  const log = readDialect('jest-results-processor-crash.txt');
  const family = sniffFamily(log);
  const failingFiles = extractFailingFiles(log, family);
  assert.deepStrictEqual(failingFiles, ['tests/flaky.test.js']);
  const plan = planRetry({
    failingFiles, flaky: { files: ['tests/flaky.test.js'], maxRetries: 1 }, retry: RETRY, suite: 'tests',
    unattributedCount: unattributedFailureCount(log, family), family,
  });
  assert.deepStrictEqual(plan, { retry: false, reason: 'unattributed-failures: 1' });
});
```

AC2.1 (`jest-attributed.txt` still retries) is `flaky.test.js`'s existing `planRetry: a fully attributed jest log whose failing file is allowlisted retries that file (#3480 AC)` — do not edit it; it must stay green.

- [ ] **Step 2: Run tests to verify the guard tests fail**

Run: `node --test tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/flaky.test.js`
Expected: FAIL after Step 1 — `captured jest-results-processor-crash.txt` (actual 0, expected 1), the `AC1.1, AC3.1` trailer test (0 vs 1), the trailer-form test's open-handle assertion (0 vs 1), and `flaky.test.js`'s `AC1.1` planRetry test (retry: true vs refusal). The vitest pin test and the `vitest-summary-last.txt` row already pass (they pin a decision, not new code).

- [ ] **Step 3: Implement the guard in `summaryUnattributedCount`**

After the `nonFile` total is complete (after the multi-summary and `interruptedRun` additions, before `if (unmatched + nonFile > 0)`): when `dialect === 'jest'` and `nonFile === 0` and the last non-empty line of `clean` (trimmed, so a CRLF `\r` drops) does not match `/^Ran all test suites\b.*\.$/`, add 1 to `nonFile`. Name the regex as a module constant (e.g. `JEST_TRAILER_RE`) with a comment citing `SummaryReporter._getTestSummary`, the `nonFile === 0` reason (an enumerated channel already counted the same crash — a second count would double one failure), and why vitest has no counterpart (the stream-interleave decision above). Update the `summaryUnattributedCount`/`unattributedFailureCount` doc comments to list the trailer guard.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/flaky.test.js tests/bin-lib/verify/cli.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Prove the guard test goes red when the guard is removed (AC3.1)**

Temporarily delete the guard's `nonFile += 1` line, run `node --test tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/flaky.test.js`, confirm the `AC1.1` tests and the `jest-results-processor-crash.txt` row fail, then restore the line and re-run to green. Do not commit the removal. Quote both runs' pass/fail counts in the report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/verify/extract.js tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/flaky.test.js tests/fixtures/verify-dialects/jest-results-processor-crash.txt tests/fixtures/verify-dialects/vitest-summary-last.txt
git commit -m "Fail closed on a jest log missing its trailer — refs #3674"
```

### Task 2: Name the guard in the three prose sites

**Files:**
- Modify: `plugin/skills/test/verification.md` (`### Flake handling`, ~line 218: "For jest it is also an obsolete-snapshot line or an interrupted `N of M total` run.")
- Modify: `docs/journeys/run-a-deterministic-verification-check.md` (Step 10 **Should understand** ~line 99, same sentence; Step 10 **Red flags** ~line 100; the change-history bullets ~line 203)
- Modify: `.claude/skills/node-test-output-evidence/SKILL.md` (~line 58 jest clause; ~line 86 table row)
- Modify: `docs/plugin-structure.md` (line 54, `extract.js` entry)

**Interfaces:**
- Consumes: Task 1's behaviour (trailer guard, jest only, vitest decision).
- Produces: nothing code-facing.

- [ ] **Step 1: Edit `verification.md`**

Extend the jest sentence to: "For jest it is also an obsolete-snapshot line, an interrupted `N of M total` run, or a log whose last line is not jest's `Ran all test suites…` trailer (a crash after or instead of the summary, #3674)." Add one clause after the vitest sentence: vitest has no such guard, since its summary and failure blocks go to different streams and either can end the log. Headroom (measured at authoring): 51,227 B against `RAIL_BYTES` 52,500 B — 1,273 B left; keep the whole addition under ~300 B, so the file stays ≥ ~970 B under the rail.

- [ ] **Step 2: Edit the journey**

Same jest + vitest wording in Step 10's Should-understand sentence. Red flags: add "a jest check retried and cleared whose log ends on anything but `Ran all test suites…`". Append a change-history bullet: "Step 10 and Step 15 extended by #3674 (`extract.js`'s trailer guard): a jest log whose last line is not `Ran all test suites…` refuses with `unattributed-failures: {N}`; vitest keeps its enumerated list, having no stable closing line."

- [ ] **Step 3: Edit the project skill**

Line ~58: add to the jest clause "or a log whose last non-empty line is not the `Ran all test suites…` trailer — a positive-recognition backstop counted only when no enumerated channel already fired (#3674); vitest has no stable closing line (stdout summary, stderr failure blocks), so it has no such guard". Line ~86 table row: add "a jest log not ending in `Ran all test suites…`" to the signal list.

Also (scope-creep `add-to-plan`, found by grepping the edited sentence repo-wide): `docs/plugin-structure.md` line 54's `extract.js` entry restates the #3480 channel list — append, in that entry's own `#NNNN adds …` style, "#3674 adds the jest trailer guard — a jest log whose last non-empty line is not `Ran all test suites…` is unattributed when no enumerated channel already counted it; vitest has none (no stable closing line)".

Prose pins: `git grep -n -F` over `tests/` for the edited sentences ("interrupted `N of M total` run", "obsolete-snapshot line") found no test pinning them at authoring time; the full suite in Step 4 is still the check.

- [ ] **Step 4: Run prose-pinning suites**

Run: `npm test > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/88e0aea2-51ca-4ac0-9556-f20b60e87f2b/scratchpad/npm-test-task2.txt 2>&1; echo exit=$?`
Expected: `exit=0` (conformance tests pin skill prose; the full suite is the check).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/test/verification.md docs/journeys/run-a-deterministic-verification-check.md .claude/skills/node-test-output-evidence/SKILL.md docs/plugin-structure.md
git commit -m "Name the jest trailer guard in verification prose — refs #3674"
```
