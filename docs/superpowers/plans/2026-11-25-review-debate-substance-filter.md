# Review Debate Substance Filter (#4747) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only cross-lens overlap pairs that describe the same defect (substance score at or above `SUBSTANCE_SIMILARITY_MIN`) enter `/review` Step 3.5's debate; nearby-but-unrelated pairs are logged once as proximity coincidences and go to Step 3.7 in their own buckets.

**Architecture:** `detectCrossLensOverlap` (pure, `plugin/bin/lib/coordination.js`) gains two additive per-pair fields computed with the existing `substanceSimilarity`: `substanceScore` and `substanceMatch`. The `detect-overlap` CLI verb prints the library result unchanged, so it carries them automatically. Step 3.5 item 2's prose filter reads `substanceMatch` instead of leaving the call to the reviewer's judgment.

**Tech Stack:** Node 18+, `node --test`, markdown skill files.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T075109-record-4747/work/4747-spec.md`

## Global Constraints

- Threshold is the existing `SUBSTANCE_SIMILARITY_MIN` (0.2) — no new constant, no new tolerance.
- Additive output fields only: every existing key of a `detectCrossLensOverlap` pair (`lensA`, `lensB`, `findingA`, `findingB`) keeps its name and value (expand-only — a run in flight on the previous release reads the old shape).
- Missing finding text never counts as a match (`substanceScore: null` → `substanceMatch: false`), the same rule `corroborateCrossLens` applies.
- The new proximity-coincidence log line must NOT match `plugin/bin/lib/console/resolve.js`'s `DEBATE_CONVERGED_RE` (`^- AUTO … — (?:Step …: )?Debate: cross-lens disagreement on P:N converged positive`), or the Review Console would treat it as a converged-positive debate and supersede both findings' STAGED lines.
- `plugin/skills/review/step3-debate-and-refutation.md` is 26,373 B against `RAIL_BYTES` 52,500 — ample headroom; no split needed.

## Review Focus

1. A pair where one finding has no text (`text`/`Finding` absent) — expected `substanceScore: null`, `substanceMatch: false` (pinned in Task 1).
2. A pair whose two texts are identical or one a prefix of the other — `substanceSimilarity` returns 1, so `substanceMatch: true` (covered by the paraphrase test's sibling assertion in Task 1).
3. Findings supplied under the lens JSON's `Finding` key rather than `text` — `normalizeFinding` already maps it; the CLI test fixture (`FINDINGS_A`/`FINDINGS_B`) exercises the CLI path (Task 1).
4. The coincidence log line accidentally parsed as a converged debate by the Review Console — pinned by a regex test in Task 2.
5. The `_shared/multi-agent-coordination.md` Mode 2 Trigger still claiming "no substance gate" after the change — swept and pinned in Task 2.

---

### Task 1: Annotate overlap pairs with substance score

**Files:**
- Modify: `plugin/bin/lib/coordination.js` (`detectCrossLensOverlap`, ~line 426, plus its header comment)
- Modify: `plugin/bin/review-coordination.js` (header comment near line 11 describing `detect-overlap`'s output)
- Test: `tests/multi-agent-coordination.test.js` (new tests beside the existing `detectCrossLensOverlap` tests, ~line 843-878)
- Test: `tests/bin-lib/review-coordination/cli.test.js` (extend `detect-overlap matches the library result exactly`, line 68)

**Interfaces:**
- Produces: `detectCrossLensOverlap(findingsByLens) → Array<{ lensA, lensB, findingA, findingB, substanceScore: number|null, substanceMatch: boolean }>` where `substanceScore = substanceSimilarity(findingA, findingB)` (normalized findings) and `substanceMatch = substanceScore !== null && substanceScore >= SUBSTANCE_SIMILARITY_MIN`.

- [ ] **Step 1: Write the failing tests** in `tests/multi-agent-coordination.test.js`:

```js
// #4747 AC1.1 / AC1.2: a same-location, different-substance pair is marked and excluded from debate.
test('detectCrossLensOverlap: AC1.1 AC1.2 a same-location different-substance pair carries its score and substanceMatch false', () => {
  const overlaps = c.detectCrossLensOverlap({
    security: [{ path: 'src/auth.ts', line: 42, severity: 'high', text: 'token expiry is never checked' }],
    architecture: [{ path: 'src/auth.ts', line: 44, severity: 'low', text: 'variable name shadows the outer loop counter' }],
  });
  assert.strictEqual(overlaps.length, 1);
  assert.strictEqual(typeof overlaps[0].substanceScore, 'number');
  assert.ok(overlaps[0].substanceScore < c.SUBSTANCE_SIMILARITY_MIN);
  assert.strictEqual(overlaps[0].substanceMatch, false);
});

// #4747 AC2.1: a paraphrased same-defect pair still enters debate.
test('detectCrossLensOverlap: AC2.1 a paraphrased same-defect pair has substanceMatch true', () => {
  const overlaps = c.detectCrossLensOverlap({
    security: [{ path: 'src/auth.ts', line: 42, severity: 'high', text: 'token expiry is never checked before the session is reused' }],
    architecture: [{ path: 'src/auth.ts', line: 43, severity: 'low', text: 'session reuse skips the token expiry check' }],
  });
  assert.strictEqual(overlaps.length, 1);
  assert.ok(overlaps[0].substanceScore >= c.SUBSTANCE_SIMILARITY_MIN);
  assert.strictEqual(overlaps[0].substanceMatch, true);
});

test('detectCrossLensOverlap: a pair with a missing text scores null and never matches', () => {
  const overlaps = c.detectCrossLensOverlap({
    security: [{ path: 'src/auth.ts', line: 42, severity: 'high', text: 'token expiry is never checked' }],
    architecture: [{ path: 'src/auth.ts', line: 42, severity: 'low' }],
  });
  assert.strictEqual(overlaps.length, 1);
  assert.strictEqual(overlaps[0].substanceScore, null);
  assert.strictEqual(overlaps[0].substanceMatch, false);
});
```

And in `tests/bin-lib/review-coordination/cli.test.js`'s `detect-overlap matches the library result exactly`, after the `deepStrictEqual`, assert every printed pair carries both new keys:

```js
  for (const pair of JSON.parse(stdout)) {
    assert.ok('substanceScore' in pair, 'detect-overlap pair lacks substanceScore (#4747 AC1.1)');
    assert.strictEqual(typeof pair.substanceMatch, 'boolean');
  }
```

(If `FINDINGS_A`/`FINDINGS_B` yield zero overlap pairs, also assert `JSON.parse(stdout).length > 0` so the loop is not vacuous; pick fixtures that overlap if they do not.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/multi-agent-coordination.test.js`
Expected: FAIL — the three new `detectCrossLensOverlap` tests (`substanceScore` undefined).

- [ ] **Step 3: Implement** — in `detectCrossLensOverlap`, when `sameLocation(fa, fb, LINE_TOLERANCE_DEBATE)` holds, compute `const substanceScore = substanceSimilarity(fa, fb);` and push `{ lensA, lensB, findingA: fa, findingB: fb, substanceScore, substanceMatch: substanceScore !== null && substanceScore >= SUBSTANCE_SIMILARITY_MIN }`. Add a `// #4747:` comment above the function saying the two fields let review Step 3.5 send only same-defect pairs to debate and that missing text never matches (as `corroborateCrossLens`). Update `review-coordination.js`'s header comment for `detect-overlap` to name the output keys.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/multi-agent-coordination.test.js`
Expected: PASS
Run: `node --test tests/bin-lib/review-coordination/cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/coordination.js plugin/bin/review-coordination.js tests/multi-agent-coordination.test.js tests/bin-lib/review-coordination/cli.test.js
git commit -m "Score detect-overlap pairs by substance — refs #4747"
```

### Task 2: Step 3.5 item 2 filters on the substance threshold

**Files:**
- Modify: `plugin/skills/review/step3-debate-and-refutation.md` (Step 3.5 Cross-Lens Debate items 1, 2 and 5)
- Modify: `plugin/skills/_shared/multi-agent-coordination.md` (Mode 2 `### Trigger` bullet "with no substance gate", and `### Decision-log entry format` block + its "three lines" sentence)
- Test: `tests/multi-agent-coordination.test.js` (conformance; the existing Mode 2 restatement test near line 1118)

**Interfaces:**
- Consumes: Task 1's `substanceScore` / `substanceMatch` pair fields.

- [ ] **Step 1: Write the failing conformance tests** in `tests/multi-agent-coordination.test.js`:

```js
// #4747 AC3.1 / AC3.2: Step 3.5 item 2 names the substance threshold.
test('/review Step 3.5: AC3.1 AC3.2 item 2 filters contradictions on substanceMatch at SUBSTANCE_SIMILARITY_MIN (0.2)', () => {
  const item2 = REVIEW_SKILL.split('\n').find((line) => line.startsWith('2. **Filter to contradictions.**'));
  assert.ok(item2, 'step3-debate-and-refutation.md lost its item 2 "Filter to contradictions." line');
  for (const needle of ['substanceMatch', '`SUBSTANCE_SIMILARITY_MIN`', '0.2', 'proximity coincidence', 'Step 3.7']) {
    assert.ok(item2.includes(needle), `item 2 does not name ${needle}`);
  }
  assert.ok(!REVIEW_SKILL.includes('Avoid running debate on every `Path:Line`'), 'item 5 still carries the judgment-call warning item 2 replaced');
});

test('/review Step 3.5: the proximity-coincidence line is never read as a converged debate', () => {
  const producerLine = REVIEW_SKILL.split('\n').find((line) => line.includes('Debate skipped: proximity coincidence'));
  const template = producerLine.match(/`([^`]*\{HH:MM:SS\}[^`]*)`/)[1];
  const line = `- ${template.replace('{HH:MM:SS}', '14:41:05')}`;
  assert.doesNotMatch(line, /^- AUTO \d{2}:\d{2}:\d{2} — (?:Step [\d.]+: )?Debate: cross-lens disagreement on /);
});

test('Mode 2 trigger states the substance gate', () => {
  assert.ok(!PRIMITIVE_DOC.includes('with no substance gate'), 'Mode 2 Trigger still says debate has no substance gate');
  assert.ok(PRIMITIVE_DOC.includes('SUBSTANCE_SIMILARITY_MIN'), 'Mode 2 Trigger does not name SUBSTANCE_SIMILARITY_MIN');
});
```

Extend the existing `debate: Mode 2 restates the three lines /review writes` test's marker list with `'Debate skipped: proximity coincidence'` (and rename it to "the lines").

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/multi-agent-coordination.test.js`
Expected: FAIL — item 2 lacks `substanceMatch`; Mode 2 still says "with no substance gate"; no coincidence producer line.

- [ ] **Step 3: Edit the prose**
  - Item 1: after "It returns pairs `{lensA, lensB, findingA, findingB}` …", name the two added keys: `substanceScore` (token-Jaccard substance similarity, `null` when either finding has no text) and `substanceMatch` (`true` only at or above `SUBSTANCE_SIMILARITY_MIN`, 0.2).
  - Item 2 (one line, starting `2. **Filter to contradictions.**`): keep a pair only when its two severities differ **and** its `substanceMatch` is `true` — the same `SUBSTANCE_SIMILARITY_MIN` (0.2) bar `categoriseReproduction` uses. A pair whose severities differ but whose `substanceMatch` is `false` (unrelated findings that only sit within ±5 lines, or a finding with no text) is a proximity coincidence: no debate; both findings keep their own buckets and go on to Step 3.7; write one line per such pair: `AUTO {HH:MM:SS} — Debate skipped: proximity coincidence — lens "{lensA}" finding {pathA}:{lineA} and lens "{lensB}" finding {pathB}:{lineB} (substance score {substanceScore, or "unknown" when null} below 0.2); both keep their own buckets for Step 3.7. Reversibility: high.` Pairs whose severities match produce no debate, as before.
  - Item 5: replace the "Avoid running debate on every `Path:Line` where any two lenses touched — that explodes the token budget for no value." sentence with a pointer: the substance filter in item 2 is what keeps debate off every `Path:Line` two lenses touched.
  - `_shared/multi-agent-coordination.md` Mode 2 Trigger: the ±5 bullet drops "and with no substance gate"; add a bullet "**Same substance** — substance score at or above `SUBSTANCE_SIMILARITY_MIN` (0.2; `detect-overlap`'s `substanceMatch`), so nearby but unrelated findings are not debated". Add the coincidence line, byte-identical to item 2's template, to the Decision-log entry format block, and change "three lines" to "four lines".

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/multi-agent-coordination.test.js`
Expected: PASS
Run: `node --test tests/review-tiebreak-step-conformance.test.js tests/bin-lib/console/resolve.test.js tests/session-tmp-placeholder-quoting-conformance.test.js`
Expected: PASS (step3 doc anchors and the frozen detect-overlap fence unchanged)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-debate-and-refutation.md plugin/skills/_shared/multi-agent-coordination.md tests/multi-agent-coordination.test.js
git commit -m "Debate only same-substance overlap pairs in review Step 3.5 — refs #4747"
```
