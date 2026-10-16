# Reproduction Wide Band Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two reproduction-pair findings on the same path, 3–5 lines apart, now confirm each other when their text agrees strongly (substance similarity ≥ 0.6). Today they stay unconfirmed.

**Architecture:** `categoriseReproduction`'s candidate gather in `plugin/bin/lib/coordination.js` gains a second tier. A same-path B finding outside ±2 but within ±5 becomes a candidate only when `substanceSimilarity` is known and ≥ 0.6. A finding that misses the floor is simply not a candidate. Everything after the gather is unchanged. The two prose restatements of the match rule, plus one journey, are updated to the two-tier wording, and a test pins the prose numbers to the code constants.

**Tech Stack:** Node 18+, `node:test`, `node:assert` — no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T191903-spec-2955/work/2955-spec.md` (record #2955)

## Global Constraints

- `plugin/bin/lib/coordination.js` stays pure — no I/O, no imports from other `bin/lib/` modules.
- Today's ±2 path is unchanged, including the rule that a `null`-substance pair matches.
- An unknown (`null`) substance never qualifies for the wider band.
- The new bound gets its own constant name (`LINE_TOLERANCE_REPRODUCTION_WIDE`), even though its value equals `LINE_TOLERANCE_DEBATE`.
- `findingsMatch` and its default tolerance stay untouched.
- The existing ±2, #1980 near-location, and #733 severity-contested tests pass unchanged. `tests/bin-lib/review-coordination/cli.test.js` also passes unchanged.
- `npm test` passes in full.

## Calibration (done at plan time, against the real `substanceSimilarity`)

| Pair | Score |
|---|---|
| Same issue, close paraphrase (the reported shape) | 0.696 |
| Same issue, close paraphrase | 0.842 |
| Same issue, loosely worded | 0.467 |
| Unrelated issues inside one statement | 0.000 / 0.074 / 0.176 |

Floor **0.6**: both close paraphrases clear it with margin, and every unrelated pair falls well below it. The loosely worded same-issue pair stays unconfirmed in the wide band but still pairs within ±2. This is the intended trade-off: the wide band costs location evidence, so it demands stronger text evidence. Bound **5** matches the debate tolerance's "same region of code" (`multi-agent-coordination.md:105`).

## Review Focus

1. **A wide-band candidate below the floor.** It must not become a `nearLocation` coincidence; both sides stay plain `unconfirmed` (Task 1, test "different substance").
2. **A mixed case: a different-substance neighbour within ±2, plus a same-substance twin 4 lines away.** A pairs with its twin. The neighbour stays plain `unconfirmed`, with no `nearLocation` (Task 1, test "mixed").
3. **The band edges.** A delta of exactly 5 confirms; a delta of 6 does not (Task 1, test "edges").
4. **A loosely worded same-issue pair** (0.4 ≤ score < 0.6). It confirms within ±2 and stays unconfirmed at 3 lines (Task 1, test "loose").
5. **Prose drift.** The documented ±5 and 0.6 must equal the code constants (Task 2, pin test).

---

### Task 1: Substance-gated wide band in `categoriseReproduction`

**Files:**
- Modify: `plugin/bin/lib/coordination.js:8-26` (constants), `:285-302` (candidate gather), `:441-448` (exports)
- Test: `tests/multi-agent-coordination.test.js` (append after the `#1980` block, i.e. after the `sameSubstance: identical text → true; …` test that ends near line 299)

**Interfaces:**
- Consumes: `sameLocation(na, nb, tolerance)`, `substanceSimilarity(na, nb)` → `number | null`, `sameSubstance(na, nb)` → `true | false | null`, `normalizeFinding(finding)`, all existing in `coordination.js`.
- Produces: exported constants `LINE_TOLERANCE_REPRODUCTION_WIDE` (number, `5`) and `SUBSTANCE_SIMILARITY_WIDE_MIN` (number, `0.6`). `categoriseReproduction(agentAFindings, agentBFindings)` → `{ confirmed, unconfirmed }`, same signature.

- [ ] **Step 1: Write the failing tests**

Append to `tests/multi-agent-coordination.test.js`:

```js
// ------------------------------------------------------------
// #2955: a substance-gated wider line band for reproduction pairing — two
// agents that anchor one finding on different lines of the same multi-line
// statement land 3-5 lines apart, outside the ±2 rule.
// ------------------------------------------------------------

// The reported shape: one value read inside a multi-line call argument after an
// external side effect, worded independently by the two agents.
const WIDE_SAME_A = 'result.id is read inside the multi-line createIssue call argument after the external gh api side effect; if the side effect throws, the read never runs and the error is swallowed';
const WIDE_SAME_B = 'result.id read inside the multi-line createIssue argument after the external gh api side effect — a throw from the side effect skips the read and the error is swallowed';
// A different issue inside the same statement.
const WIDE_DIFFERENT = 'The labels array passed to createIssue is not deduplicated, so a repeated label produces a 422 from the API';
// The same issue, loosely worded: clears SUBSTANCE_SIMILARITY_MIN but not the wide floor.
const LOOSE_A = 'Error from the gh api call is swallowed because the catch returns null without logging';
const LOOSE_B = 'The catch block around the gh api call returns null and drops the error silently';

test('reproduction (#2955): wide-band constants are exported with their own names and the calibrated values', () => {
  assert.strictEqual(c.LINE_TOLERANCE_REPRODUCTION_WIDE, 5);
  assert.strictEqual(c.SUBSTANCE_SIMILARITY_WIDE_MIN, 0.6);
  assert.ok(c.LINE_TOLERANCE_REPRODUCTION_WIDE > c.LINE_TOLERANCE_REPRODUCTION);
  assert.ok(c.SUBSTANCE_SIMILARITY_WIDE_MIN > c.SUBSTANCE_SIMILARITY_MIN);
});

test('reproduction (#2955): calibration fixtures sit on the intended side of the wide floor', () => {
  const at = (text, line) => c.normalizeFinding({ path: 'src/run.js', line, text });
  assert.ok(c.substanceSimilarity(at(WIDE_SAME_A, 120), at(WIDE_SAME_B, 123)) >= c.SUBSTANCE_SIMILARITY_WIDE_MIN);
  assert.ok(c.substanceSimilarity(at(WIDE_SAME_A, 120), at(WIDE_DIFFERENT, 123)) < c.SUBSTANCE_SIMILARITY_MIN);
  const loose = c.substanceSimilarity(at(LOOSE_A, 120), at(LOOSE_B, 123));
  assert.ok(loose >= c.SUBSTANCE_SIMILARITY_MIN && loose < c.SUBSTANCE_SIMILARITY_WIDE_MIN, `loose pair scored ${loose}`);
});

test('AC1.1 AC1.2 reproduction (#2955): same path, 3 lines apart, near-identical text, same bucket → one confirmed, zero unconfirmed', () => {
  const a = [{ path: 'src/run.js', line: 120, severity: 'high', text: WIDE_SAME_A }];
  const b = [{ path: 'src/run.js', line: 123, severity: 'critical', text: WIDE_SAME_B }];
  const { confirmed, unconfirmed } = c.categoriseReproduction(a, b);
  assert.strictEqual(confirmed.length, 1);
  assert.strictEqual(unconfirmed.length, 0);
  assert.strictEqual(confirmed[0].line, 120);
  assert.strictEqual(confirmed[0].severityContested, undefined);
});

test('AC2.1 reproduction (#2955): 3 lines apart, substantively different → both unconfirmed, no nearLocation', () => {
  const a = [{ path: 'src/run.js', line: 120, severity: 'high', text: WIDE_SAME_A }];
  const b = [{ path: 'src/run.js', line: 123, severity: 'high', text: WIDE_DIFFERENT }];
  const { confirmed, unconfirmed } = c.categoriseReproduction(a, b);
  assert.strictEqual(confirmed.length, 0);
  assert.strictEqual(unconfirmed.length, 2);
  assert.ok(unconfirmed.every((f) => f.nearLocation === undefined), 'a wide-band miss is not a #1980 coincidence');
});

test('AC3.1 reproduction (#2955): 3 lines apart, one side missing text → both unconfirmed', () => {
  const a = [{ path: 'src/run.js', line: 120, severity: 'high' }];
  const b = [{ path: 'src/run.js', line: 123, severity: 'high', text: WIDE_SAME_B }];
  const { confirmed, unconfirmed } = c.categoriseReproduction(a, b);
  assert.strictEqual(confirmed.length, 0);
  assert.strictEqual(unconfirmed.length, 2);
  assert.ok(unconfirmed.every((f) => f.nearLocation === undefined));
});

test('reproduction (#2955): band edges — 5 lines apart confirms, 6 lines apart does not', () => {
  const a = [{ path: 'src/run.js', line: 120, severity: 'high', text: WIDE_SAME_A }];
  const atFive = c.categoriseReproduction(a, [{ path: 'src/run.js', line: 115, severity: 'high', text: WIDE_SAME_B }]);
  assert.strictEqual(atFive.confirmed.length, 1);
  assert.strictEqual(atFive.unconfirmed.length, 0);
  const atSix = c.categoriseReproduction(a, [{ path: 'src/run.js', line: 126, severity: 'high', text: WIDE_SAME_B }]);
  assert.strictEqual(atSix.confirmed.length, 0);
  assert.strictEqual(atSix.unconfirmed.length, 2);
});

test('reproduction (#2955): loose same-issue pair confirms within ±2 but not at 3 lines (±2 path unchanged)', () => {
  const a = [{ path: 'src/run.js', line: 120, severity: 'low', text: LOOSE_A }];
  const near = c.categoriseReproduction(a, [{ path: 'src/run.js', line: 122, severity: 'low', text: LOOSE_B }]);
  assert.strictEqual(near.confirmed.length, 1);
  const wide = c.categoriseReproduction(a, [{ path: 'src/run.js', line: 123, severity: 'low', text: LOOSE_B }]);
  assert.strictEqual(wide.confirmed.length, 0);
  assert.strictEqual(wide.unconfirmed.length, 2);
});

test('reproduction (#2955): mixed — different-substance neighbour within ±2 plus a same-substance twin 4 lines away → pairs with the twin', () => {
  const a = [{ path: 'src/run.js', line: 120, severity: 'high', text: WIDE_SAME_A }];
  const b = [
    { path: 'src/run.js', line: 121, severity: 'high', text: WIDE_DIFFERENT },
    { path: 'src/run.js', line: 124, severity: 'high', text: WIDE_SAME_B },
  ];
  const { confirmed, unconfirmed } = c.categoriseReproduction(a, b);
  assert.strictEqual(confirmed.length, 1);
  assert.strictEqual(unconfirmed.length, 1);
  assert.strictEqual(unconfirmed[0].line, 121);
  assert.strictEqual(unconfirmed[0].source, 'B');
  assert.strictEqual(unconfirmed[0].nearLocation, undefined, 'A found its twin, so the neighbour is not a coincidence partner');
});

test('reproduction (#2955): findingsMatch is untouched — identical text 3 lines apart still does not match', () => {
  const a = { path: 'src/run.js', line: 120, severity: 'high', text: WIDE_SAME_A };
  const b = { path: 'src/run.js', line: 123, severity: 'high', text: WIDE_SAME_A };
  assert.strictEqual(c.findingsMatch(a, b), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "#2955" tests/multi-agent-coordination.test.js`
Expected: FAIL. The constants test fails (`undefined !== 5`). The 3-line confirm test fails (`0 !== 1` confirmed) against today's ±2-only rule — this run is the AC1.3 red proof; record its output in the task report. The band-edge and mixed tests fail too. The different-substance, missing-text, loose, and findingsMatch tests already pass; they pin behavior the change must keep.

- [ ] **Step 3: Implement**

In `plugin/bin/lib/coordination.js`, after `const LINE_TOLERANCE_DEBATE = 5;` (line 9), add:

```js
// #2955: two reproduction agents can anchor one finding on different lines
// of the same multi-line statement, landing more than
// LINE_TOLERANCE_REPRODUCTION apart. A same-path pair within this wider
// bound still pairs, but only on strong, known substance agreement
// (SUBSTANCE_SIMILARITY_WIDE_MIN). Same value as LINE_TOLERANCE_DEBATE today,
// kept as its own name so the two can diverge.
const LINE_TOLERANCE_REPRODUCTION_WIDE = 5;
```

After `const SUBSTANCE_SIMILARITY_MIN = 0.4;` (line 26), add:

```js
// #2955: the stricter floor the wide band demands, since it has weaker
// location evidence. Calibrated on finding text: close paraphrases of one
// issue scored 0.70-0.84 and unrelated issues inside one statement scored
// 0.00-0.18. A loosely worded same-issue pair (0.47) stays unconfirmed in the
// wide band; it still pairs within ±2.
const SUBSTANCE_SIMILARITY_WIDE_MIN = 0.6;
```

Replace the candidate gather in `categoriseReproduction` (currently lines 298-302):

```js
    normalizedB.forEach((fb, i) => {
      if (matchedB.has(i) || consumedB.has(i)) return;
      if (!sameLocation(fa, fb, LINE_TOLERANCE_REPRODUCTION)) return;
      candidates.push({ index: i, finding: fb, substance: sameSubstance(fa, fb), score: substanceSimilarity(fa, fb) });
    });
```

with:

```js
    normalizedB.forEach((fb, i) => {
      if (matchedB.has(i) || consumedB.has(i)) return;
      const score = substanceSimilarity(fa, fb);
      if (!sameLocation(fa, fb, LINE_TOLERANCE_REPRODUCTION)) {
        // #2955: the wide band. A pair here is a candidate only on known,
        // strong substance agreement. Anything else is not a candidate at
        // all, so it never becomes a #1980 nearLocation coincidence below.
        if (!sameLocation(fa, fb, LINE_TOLERANCE_REPRODUCTION_WIDE)) return;
        if (score === null || score < SUBSTANCE_SIMILARITY_WIDE_MIN) return;
      }
      candidates.push({ index: i, finding: fb, substance: sameSubstance(fa, fb), score });
    });
```

Also update the comment directly above the gather (`// #1980: gather every same-location B candidate …`) so it reads `// #1980: gather every same-location B candidate (±2, or the #2955 wide band) not already spoken for,`. Keep the rest of that comment as is.

In the `module.exports` block, add the two constants after the existing ones:

```js
  LINE_TOLERANCE_REPRODUCTION,
  LINE_TOLERANCE_REPRODUCTION_WIDE,
  LINE_TOLERANCE_DEBATE,
```

and

```js
  SUBSTANCE_SIMILARITY_MIN,
  SUBSTANCE_SIMILARITY_WIDE_MIN,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/multi-agent-coordination.test.js tests/bin-lib/review-coordination/cli.test.js`
Expected: PASS. Every existing test passes unchanged (±2, the #1980 near-location tests, #733 — AC4.1), `tests/bin-lib/review-coordination/cli.test.js` passes unchanged (AC5.1), and so do all nine #2955 tests.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/coordination.js tests/multi-agent-coordination.test.js
git commit -m "Add a substance-gated wide band to reproduction pairing — #2955"
```

---

### Task 2: Two-tier rule in the prose twins, pinned to the constants

**Files:**
- Modify: `plugin/skills/_shared/multi-agent-coordination.md:49`
- Modify: `plugin/skills/review/step3-lens-dispatch.md:94`, `:95`, `:98`
- Modify: `docs/journeys/confirm-coverage-findings-across-reproduction-pairs-3049.md:26`
- Test: `tests/multi-agent-coordination.test.js` (append after Task 1's tests)

**Interfaces:**
- Consumes: `c.LINE_TOLERANCE_REPRODUCTION`, `c.LINE_TOLERANCE_REPRODUCTION_WIDE`, `c.SUBSTANCE_SIMILARITY_WIDE_MIN` (Task 1). `readSkillFile(...segments)` and `PRIMITIVE_DOC` are already defined at the top of the test file.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing test**

Append to `tests/multi-agent-coordination.test.js`:

```js
test('prose twins state the two-tier line rule with the code\'s own values (#2955)', () => {
  const near = `±${c.LINE_TOLERANCE_REPRODUCTION}`;
  const wide = `±${c.LINE_TOLERANCE_REPRODUCTION_WIDE}`;
  const floor = String(c.SUBSTANCE_SIMILARITY_WIDE_MIN);

  const ruleLine = PRIMITIVE_DOC.split('\n').find((l) => l.startsWith('2. **Line within'));
  assert.ok(ruleLine, 'multi-agent-coordination.md comparison rule item 2 must exist');
  for (const value of [near, wide, floor]) {
    assert.ok(ruleLine.includes(value), `comparison rule item 2 must state ${value}`);
  }

  const dispatch = readSkillFile('review', 'step3-lens-dispatch.md');
  const confirmedBullet = dispatch
    .split('\n')
    .find((l) => l.startsWith("> - Findings present in both agents' outputs, same severity bucket"));
  assert.ok(confirmedBullet, 'step3-lens-dispatch.md confirmed-finding bullet must exist');
  for (const value of [near, wide, floor]) {
    assert.ok(confirmedBullet.includes(value), `confirmed-finding bullet must state ${value}`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern "prose twins state the two-tier" tests/multi-agent-coordination.test.js`
Expected: FAIL with "comparison rule item 2 must state ±5".

- [ ] **Step 3: Update the prose**

`plugin/skills/_shared/multi-agent-coordination.md`, line 49. Replace:

```
2. **Line within ±2** — same finding, slight line-number disagreement is acceptable.
```

with:

```
2. **Line within ±2, or within ±5 on strong text agreement** — same finding, slight line-number disagreement is acceptable. A pair 3-5 lines apart (two agents anchoring one finding on different lines of one multi-line statement) matches only when both findings carry text and their substance similarity is at least 0.6, stricter than the check inside ±2. A pair with missing text never matches in the wider band.
```

`plugin/skills/review/step3-lens-dispatch.md`, line 94. Replace `(path exact, line ±2, matching severity bucket)` with:

```
(path exact, line ±2 — or ±5 when both texts are known and their substance similarity is at least 0.6 — matching severity bucket)
```

Line 95. Replace `(path exact, line ±2, e.g. high vs medium` with:

```
(path exact, line ±2 or the ±5 text-agreement band, e.g. high vs medium
```

Line 98. After the sentence ending `…silently collapse into one finding with the other discarded.`, insert:

```
 A pair 3-5 lines apart whose substance similarity misses the 0.6 floor, or whose text is missing, is not a candidate at all: each side stays plain `unconfirmed`, with no `nearLocation`.
```

`docs/journeys/confirm-coverage-findings-across-reproduction-pairs-3049.md`, line 26. Replace `` `categorise-reproduction` still matches on exact path plus line ±2 and a substance check. `` with:

```
`categorise-reproduction` matches on exact path plus line ±2 and a substance check, or line ±5 when the two findings' text agrees strongly (similarity at least 0.6, #2955).
```

Keep the rest of that bullet unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/multi-agent-coordination.test.js`
Expected: PASS. The pin test passes, and every existing prose assertion in the file (`decisionLogPattern` checks, the `nearLocation` routing-clause test) still passes. Then run `npm test` and confirm it passes in full (AC6.1); a load-only failure in `tests/bin-lib/gif/palette.test.js` or `tests/statusline.test.js` (tracked by #3246/#3261) must be re-run in isolation and reported, never ignored.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/multi-agent-coordination.md plugin/skills/review/step3-lens-dispatch.md docs/journeys/confirm-coverage-findings-across-reproduction-pairs-3049.md tests/multi-agent-coordination.test.js
git commit -m "State the two-tier reproduction line rule in its prose twins — #2955"
```
