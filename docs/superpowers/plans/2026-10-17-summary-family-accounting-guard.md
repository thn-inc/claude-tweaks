# Summary-family flaky-retry accounting guard (#3204) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `summary`-family (jest/pytest/vitest) test log never lets the flaky-retry hook retry-and-clear a check, because that family has no failure-accounting guard.

**Architecture:** Deliverable option (b), mirroring `baseline.js`'s `adjudicate` refusal (`output family {family} has no failure-accounting guard`, baseline.js:295). `unattributedFailureCount` stops reporting `0` ("accounted") for a family it cannot account — it returns `null` ("no accounting guard") for every family other than `spec`/`tap`. `planRetry` refuses on `null` with a distinct, routable reason `no-accounting-guard: {family}`, checked after `no-parse` and before `unattributed-failures`. Option (a) — a per-dialect entries-vs-counts cross-check — was rejected: jest prints one `FAIL` line per file while its `Tests:` line counts tests, pytest's collection `ERROR`s and vitest's "Unhandled Errors" sit outside any `FAIL` line, and no single cross-check covers all three dialects without risking a false "accounted".

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T194315-record-3204/work/3204-spec.md`

**Scope keywords:** unattributedFailureCount, no-accounting-guard

## Global Constraints

- Commit messages: `{Verb} {what} — {detail}`, ending with `refs #3204` (never `closes`/`fixes`).
- `planRetry`'s existing reasons (`no-parse`, `unattributed-failures: {N}`, `unlisted: [...]`, `no-template`, `max-retries-0`) keep their exact text and order; the new reason slots between `no-parse` and `unattributed-failures`.
- Run suites with `node --test {file}` from the worktree root.

## Review Focus

- A summary-family log naming **no** failing file must still report `no-parse` (not the new reason) — `verify.js:856`'s stdout clause and the whole-suite route key on `no-parse`. Pinned in Task 1 Step 1 (`planRetry` ordering test).
- A spec/TAP log's behavior is byte-for-byte unchanged (existing `#3066` tests stay green untouched).
- `planRetry` called with no `unattributedCount` (default `0`) keeps today's behavior — existing callers/tests that omit it are not broken.
- An agent reading `report.json` must be routed to the whole-suite re-run for the new reason, not left with an unrouted value (Task 2).

---

### Task 1: Refuse flaky retry for families with no failure-accounting guard

**Files:**
- Modify: `plugin/bin/lib/verify/extract.js:528-552` (`unattributedFailureCount` + its comment)
- Modify: `plugin/bin/lib/verify/flaky.js:12-19` (`planRetry`)
- Modify: `plugin/bin/verify.js:482-485` (pass `family` to `planRetry`)
- Test: `tests/bin-lib/verify/extract.test.js:474-481`, `tests/bin-lib/verify/flaky.test.js`, `tests/bin-lib/verify/cli.test.js` (after line 1458)

**Interfaces:**
- Produces: `unattributedFailureCount(text, family, opts) -> number | null` — `null` for any family other than `spec`/`tap`; spec/tap unchanged.
- Produces: `planRetry({ failingFiles, flaky, retry, suite, unattributedCount = 0, family })` — when `unattributedCount === null` (and failingFiles non-empty) returns `{ retry: false, reason: \`no-accounting-guard: ${family}\` }`.

Shared fixture (use verbatim in both the flaky.test.js and cli.test.js tests) — a jest log: one allowlisted failing file plus one failing suite whose path is no test file, so `extractFailingFiles` drops it:

```js
const JEST_UNATTRIBUTED = [
  'FAIL tests/flaky.test.js',
  '  ● flaky › sometimes fails',
  'FAIL src/setup.js',
  '  ● Test suite failed to run',
  'Tests:       2 failed, 3 passed, 5 total',
].join('\n');
```

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/verify/extract.test.js`, change the two family assertions at lines 479-480 (in the test titled `...and every non-spec/tap family is 0 (#3066)`) to `null`, and retitle it `... and every non-spec/tap family is null — no accounting guard (#3066, #3204)`:

```js
assert.strictEqual(unattributedFailureCount(PYTEST_FIXTURE, 'summary'), null);
assert.strictEqual(unattributedFailureCount(GENERIC_FIXTURE, 'generic'), null);
```

In `tests/bin-lib/verify/flaky.test.js`, add after the `#3066 AC1` test:

```js
test('planRetry: a summary-family log with an allowlisted failing file plus an unattributed failure refuses retry — no-accounting-guard (#3204 AC)', () => {
  const family = sniffFamily(JEST_UNATTRIBUTED);
  assert.strictEqual(family, 'summary');
  const failingFiles = extractFailingFiles(JEST_UNATTRIBUTED, family);
  assert.deepStrictEqual(failingFiles, ['tests/flaky.test.js']);
  const unattributedCount = unattributedFailureCount(JEST_UNATTRIBUTED, family);
  assert.strictEqual(unattributedCount, null);
  const plan = planRetry({
    failingFiles, flaky: { files: ['tests/flaky.test.js'], maxRetries: 1 }, retry: RETRY, suite: 'tests', unattributedCount, family,
  });
  assert.deepStrictEqual(plan, { retry: false, reason: 'no-accounting-guard: summary' });
});

test('planRetry: no-parse still wins over no-accounting-guard when no failing file is named (#3204)', () => {
  assert.deepStrictEqual(
    planRetry({ failingFiles: [], flaky: FLAKY, retry: RETRY, suite: 'tests', unattributedCount: null, family: 'summary' }),
    { retry: false, reason: 'no-parse' });
});
```

In `tests/bin-lib/verify/cli.test.js`, add after the `#3066` CLI test (line 1458) a test titled `flaky retry: a summary-family failure refuses retry even when every named file is allowlisted, through the real CLI wiring (#3204)` — same body as the `#3066` test at 1425-1458, but `fail.js` prints `JEST_UNATTRIBUTED` (define the constant locally in the test) instead of the TAP log, and the final reason assertion is:

```js
assert.deepStrictEqual(report.checks.tests.retryDecision, { retry: false, reason: 'no-accounting-guard: summary' });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/flaky.test.js tests/bin-lib/verify/cli.test.js`
Expected: FAIL — extract asserts `0 !== null`; the flaky AC test gets `{ retry: true, ... }`; the CLI test finds `retry.marker` written (the bug: the summary log retried and cleared).

- [ ] **Step 3: Implement**

- `extract.js` `unattributedFailureCount`: `if (family !== 'spec' && family !== 'tap') return null;`. Rewrite the comment's last sentence: every other family returns `null` — no failure-accounting guard exists for it (the same refusal `baseline.js`'s `adjudicate` applies), so a caller must never read it as accounted (#3204).
- `flaky.js` `planRetry`: add `family` to the destructured params; after the `no-parse` line insert `if (unattributedCount === null) return { retry: false, reason: \`no-accounting-guard: ${family}\` };` with a one-line `#3204` comment.
- `verify.js` retryHook: pass `family` in the `planRetry({...})` call.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/flaky.test.js tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/baseline.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/extract.js plugin/bin/lib/verify/flaky.js plugin/bin/verify.js tests/bin-lib/verify/extract.test.js tests/bin-lib/verify/flaky.test.js tests/bin-lib/verify/cli.test.js
git commit -m "Refuse flaky retry for summary-family logs — no failure-accounting guard exists for them, refs #3204"
```

---

### Task 2: Route and document the `no-accounting-guard` reason

**Files:**
- Modify: `plugin/skills/test/verification.md` (Flake handling paragraphs at ~lines 207, 209, 219)
- Modify: `docs/journeys/run-a-deterministic-verification-check.md` (Step 10 "Should understand" ~line 96, "Red flags" ~line 97, changelog list ~line 181)
- Modify: `docs/plugin-structure.md:52` (the `#3066 adds unattributedFailureCount ... 0 for every family other than spec/tap` clause and the `flaky.js (#1925 ...` clause)
- Test: `tests/verification-flake-handling.test.js`

**Interfaces:**
- Consumes: Task 1's reason string `no-accounting-guard: {family}` (e.g. `no-accounting-guard: summary`).

- [ ] **Step 1: Write the failing test**

Add to the `#2026` test in `tests/verification-flake-handling.test.js`:

```js
assert.ok(text.includes('a `no-accounting-guard: {family}` reason (#3204'), 'the fourth retryDecision.reason value is documented and routed to the whole-suite re-run');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/verification-flake-handling.test.js`
Expected: FAIL on the new assertion.

- [ ] **Step 3: Edit the prose**

- `verification.md` line ~209: extend the whole-suite selector list with `, or a `no-accounting-guard: {family}` reason (#3204 — the log's output family, e.g. `summary` for jest/pytest/vitest, has no failure-accounting guard, so its named-file list can never be trusted as complete)`. Line ~219: add the same reason alongside `unattributed-failures` in the "When no file can be named …" opener. Line ~207: in the "An unlisted failing file, a log with no parseable test file, …" list add "a summary-family (jest/pytest/vitest) log, whose failing-file list has no accounting guard".
- Journey Step 10: state that a summary-family log refuses with `no-accounting-guard: summary` (never retries), routed to the whole-suite re-run; add a Red flag "a summary-family check retried and cleared"; add a changelog bullet for #3204.
- `plugin-structure.md:52`: replace "0 for every family other than spec/tap" with "null for every family other than spec/tap (#3204 — no accounting guard)", and in the flaky.js clause add "and since #3204 no retry when that count is null — reason `no-accounting-guard: {family}`".

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/verification-flake-handling.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/test/verification.md docs/journeys/run-a-deterministic-verification-check.md docs/plugin-structure.md tests/verification-flake-handling.test.js
git commit -m "Route the no-accounting-guard retry reason to the whole-suite re-run — document it beside unattributed-failures, refs #3204"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (decide behavior) → Architecture + Task 1 Step 3; Deliverable 2 (pinning test with summary log + allowlisted file + unattributed failure) → Task 1 Step 1 (unit + CLI); AC (no silent retry-and-clear) → Task 1 CLI test asserts no `retry.marker`.
- **Placeholders:** none.
- **Type consistency:** `unattributedFailureCount -> number | null`; `planRetry({..., unattributedCount, family})`; reason `no-accounting-guard: {family}` used identically in Tasks 1 and 2.
