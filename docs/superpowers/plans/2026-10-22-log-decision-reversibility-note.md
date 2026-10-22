# Reversibility Note Readers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution:** batched
**Batch:** send every task to one implementer as a single brief; review the combined diff once.

**Goal:** Pin `log-decision.js`'s acceptance of an `enum (note)` reversibility value to the record's literal examples, and make every in-repo `decisions.md` reader that parses the `Reversibility:` field accept that trailing note.

**Architecture:** The writer side already shipped in #2869 (`e91df452c`): `plugin/bin/log-decision.js:18`'s `REVERSIBILITY_RE` accepts `^(?:high|med|low|n/a)( \(.+\))?$` and `formatEntry` renders the value verbatim. The reader side that this plan widens, `merge-verdict.js`'s `PASS_ACTION_RE`, ships `(?: \((?:(?!\)\. ).)+\))?` for the note: it excludes `). ` so a tail behind a note fails closed. This plan adds the record's literal AC values as CLI tests, widens the one reader that still rejects a noted value (`merge-verdict.js`'s `PASS_ACTION_RE`), and pins the calibration classifier's leading-token read.

**Tech Stack:** Node 18+, `node --test`, `node:assert`.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T082253-record-3870/work/3870-spec.md` (record #3870)

## Global Constraints

- Accepted value grammar (the writer's, unchanged): an enum member `high|med|low|n/a`, optionally followed by one literal space and one parenthesized note — `REVERSIBILITY_RE` at `plugin/bin/log-decision.js:18`.
- Rendered form: `Reversibility: low (divergence persists).` — verbatim value, then a period.
- A value whose leading token is not an enum member still fails with the existing usage error: `--reversibility must be one of high|med|low|n/a, optionally followed by " (qualifier)"`, exit 2, nothing written.
- No change to `plugin/bin/log-decision.js` or `plugin/bin/lib/log-decision/append.js` — both already satisfy Deliverables 1-3.

## Reader inventory (AC3.1, AC3.2)

Derived from every `plugin/bin` module that references `decisions.md` (`grep -rln "decisions.md" plugin/bin`, 53 files), narrowed to those that parse the `Reversibility:` field (`grep -rn "Reversibility" plugin/bin/lib plugin/bin/*.js`):

| Reader | Parses | Notes today? | Action |
|---|---|---|---|
| `plugin/bin/lib/dispatch/merge-verdict.js:35` `PASS_ACTION_RE` | value, end-anchored (`[a-z/]+\.`) | **rejects** — a noted pass line reads `unparsed` | Task 2: widen + test |
| `plugin/bin/lib/calibration/decisions-classifier.js:12` `REVERSIBILITY_RE` | leading enum token | accepts | Task 3: pin the value read |
| `plugin/bin/lib/log-decision/claim-log.js:26,60` `ACTION_RE`/`COMPLETE_RE` | value, end-anchored (`[^.\s][^.]*?(?: \(.+\))?\.`, `COMPLETE_RE` only) | rejects a period-bearing note (`COMPLETE_RE`) | fix `COMPLETE_RE` + test (final-review fix wave); `ACTION_RE` unchanged — pinned by `tests/bin-lib/log-decision/claim-log.test.js:78` (#2869); its sole writer, `plugin/bin/lib/claim-targets/claim-targets.js:122`, passes bare `high` |
| `pre-tool-use.js:1342`, `claim-log.js:35` (`\sReversibility:` split), `closing-tally.js:53`, `flow/pr-body.js:179`, `hooks/run-integrity.js`, `hooks/staged-inventory.js` | text **before** `Reversibility:` only | n/a — never read the value | none |

## Review Focus

- A noted pass verdict whose note contains a period (`n/a (see docs/x.md)`) must still confirm — Task 2's test uses a note with a comma and a slash; add the period case there.
- A pass line truncated inside the note (`Reversibility: n/a (a policy re`) must not confirm — Task 2.
- A noted pass line that also carries a `[lever: …]` suffix must confirm — Task 2.
- The classifier must return the bare enum token, not the note, for every enum member — Task 3.
- A non-enum leading token with a well-formed note (`bogus (x)`) and a bare non-enum word (`lowish`) must both be rejected — Task 1.

---

### Task 1: Pin the record's literal values in the log-decision CLI suite

**Files:**
- Test: `tests/bin-lib/log-decision/cli.test.js` (append after the `nested parentheses` test, ~line 191; reuse the file's existing `reversibilityRun(value)` and `streamOf(out, 'err')` helpers)

**Interfaces:**
- Consumes: `reversibilityRun(value) -> { code, out, text }` (defined in this file, ~line 149; writes `--text 'pushed x to origin'` at a fixed clock rendering `09:05:07`).
- Produces: nothing.

- [ ] **Step 1: Write the tests**

```js
test('AC1.1: --reversibility "low (divergence persists)" exits 0 and writes `Reversibility: low (divergence persists).`', () => {
  const r = reversibilityRun('low (divergence persists)');
  assert.equal(r.code, 0);
  assert.equal(r.text, '- AUTO 09:05:07 — log-decision: pushed x to origin. Reversibility: low (divergence persists).\n');
});

test('AC1.1: the Manifesto design-critique template value "n/a (a policy read, not a code mutation)" exits 0 and renders verbatim', () => {
  const r = reversibilityRun('n/a (a policy read, not a code mutation)');
  assert.equal(r.code, 0);
  assert.equal(r.text, '- AUTO 09:05:07 — log-decision: pushed x to origin. Reversibility: n/a (a policy read, not a code mutation).\n');
});

test('AC2.1: "bogus (x)" and "lowish" exit 2 with the existing usage message and write nothing', () => {
  for (const bad of ['bogus (x)', 'lowish']) {
    const r = reversibilityRun(bad);
    assert.equal(r.code, 2, bad);
    assert.equal(r.text, null, `${bad}: decisions.md never created`);
    assert.match(streamOf(r.out, 'err'), /--reversibility must be one of high\|med\|low\|n\/a, optionally followed by " \(qualifier\)"/, bad);
  }
});
```

- [ ] **Step 2: Run the tests**

Run: `node --test tests/bin-lib/log-decision/cli.test.js`
Expected: PASS (pins on shipped behavior — #2869 already implements it; a red result means the premise moved and the task stops for a ruling)

- [ ] **Step 3: Commit**

```bash
git add tests/bin-lib/log-decision/cli.test.js
git commit -m "Pin #3870's literal reversibility values in the log-decision CLI suite — refs #3870"
```

### Task 2: Accept a noted Reversibility on a passing merge-verdict line

**Files:**
- Modify: `plugin/bin/lib/dispatch/merge-verdict.js:31-35` (the `PASS_ACTION_RE` comment and constant)
- Test: `tests/bin-lib/dispatch/merge-verdict.test.js` (append after `a pass line with a lever suffix still confirms`, ~line 108; reuse its `line(step, text, extra)` helper, which forwards `extra` into `formatEntry`)

**Interfaces:**
- Consumes: `formatEntry({ ..., reversibility, lever })` from `plugin/bin/lib/log-decision/append.js`.
- Produces: `confirmPassingVerdicts(content, members)` unchanged in signature; a pass line whose reversibility carries a writer-grammar note now yields `{ confirmed: true, latest: 'auto-merge' }`.

- [ ] **Step 1: Write the failing tests**

```js
test('AC3.1: a pass line whose Reversibility carries a note confirms, with and without a lever suffix', () => {
  for (const reversibility of ['n/a (a policy read, not a code mutation)', 'n/a (see docs/x.md)']) {
    const plain = `${line(VERDICT_STEPS.shortCircuit, verdictText(2941), { reversibility })}\n`;
    assert.deepStrictEqual(confirmPassingVerdicts(plain, [2941]), { 2941: { confirmed: true, latest: 'auto-merge' } }, reversibility);
    const levered = `${line(VERDICT_STEPS.gate, verdictText(5), { reversibility, lever: 'auto-merge-max-lines=40 (default)' })}\n`;
    assert.strictEqual(confirmPassingVerdicts(levered, [5])[5].confirmed, true, reversibility);
  }
});

test('AC3.2: a noted pass line cut off inside the note does not confirm', () => {
  const full = line(VERDICT_STEPS.shortCircuit, verdictText(2941), { reversibility: 'n/a (a policy read, not a code mutation)' });
  const cut = full.slice(0, full.indexOf('policy re') + 'policy re'.length);
  assert.deepStrictEqual(confirmPassingVerdicts(`${cut}\n`, [2941]), { 2941: { confirmed: false, latest: 'unparsed' } });
});
```

- [ ] **Step 2: Run the tests to verify the first fails**

Run: `node --test tests/bin-lib/dispatch/merge-verdict.test.js`
Expected: FAIL after Step 1 — `AC3.1` reports `latest: 'unparsed'` (the `[a-z/]+\.` anchor stops at the space before the note); `AC3.2` already passes

- [ ] **Step 3: Widen `PASS_ACTION_RE` in `plugin/bin/lib/dispatch/merge-verdict.js`**

Replace the reversibility segment `Reversibility: [a-z/]+\.` with `Reversibility: [a-z/]+(?: \((?:(?!\)\. ).)+\))?\.` — the writer's optional-note grammar (`plugin/bin/log-decision.js:18`, `( \(.+\))?`), with one exclusion: the note may not contain `). `, so a tail riding behind a note fails closed as `unparsed`. The anchor still matches the writer's whole emitted action. Extend the comment above it by one clause: the `{r}` may carry one parenthesized note, as `log-decision.js` accepts, except one containing `). ` (#3870).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/merge-verdict.test.js`
Expected: PASS (every test, including the existing tail/truncation/lever cases)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/dispatch/merge-verdict.js tests/bin-lib/dispatch/merge-verdict.test.js
git commit -m "Accept a noted Reversibility on a passing merge-verdict line — refs #3870"
```

### Task 3: Pin the calibration classifier's leading-token read

**Files:**
- Test: `tests/bin-lib/calibration/readers.test.js` (append after `classifyDecisionLine recognizes every entry kind…`, ~line 63)

**Interfaces:**
- Consumes: `classifyDecisionLine(line) -> { kind, reversibility?, terminalDecision?, autoResolved? }` from `plugin/bin/lib/calibration/decisions-classifier.js` (already imported in this file).
- Produces: nothing.

- [ ] **Step 1: Write the test**

```js
test('AC3.2: classifyDecisionLine reads the leading enum token of a noted Reversibility, never the note', () => {
  const cases = [
    ['high', 'high (commit abc1234)'],
    ['med', 'med (staged patch)'],
    ['low', 'low (divergence persists)'],
    ['n/a', 'n/a (a policy read, not a code mutation)'],
  ];
  for (const [token, value] of cases) {
    const line = `- AUTO 10:00:00 — Step 2.5: pre-flight branch-divergence-check. Reversibility: ${value}.`;
    assert.strictEqual(classifyDecisionLine(line).reversibility, token, value);
  }
});
```

- [ ] **Step 2: Run the test**

Run: `node --test tests/bin-lib/calibration/readers.test.js`
Expected: PASS (pin — `REVERSIBILITY_RE` already captures only the leading token)

- [ ] **Step 3: Commit**

```bash
git add tests/bin-lib/calibration/readers.test.js
git commit -m "Pin the calibration classifier's leading-token Reversibility read — refs #3870"
```

### AC coverage

| Clause | Covered by |
|---|---|
| AC1.1 | Task 1 `AC1.1` tests |
| AC2.1 | Task 1 `AC2.1` test |
| AC3.1 | Reader inventory table + Task 2 `AC3.1` test |
| AC3.2 | Task 2 `AC3.2` test, Task 3 `AC3.2` test, claim-log's existing `tests/bin-lib/log-decision/claim-log.test.js:78` |
| AC4.1 | `/build` Common Step 5's full-suite verification (`npm test`) |
