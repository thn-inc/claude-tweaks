# Review Lens Pair Anchoring and Substance Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop two-agent review lens pairs from losing findings that agree on substance. Two changes do it: the lens prompt names which line to anchor on, and `categoriseReproduction` pairs findings anywhere in the ±5 band on one recalibrated substance threshold.

**Architecture:** `plugin/bin/lib/coordination.js` keeps its token-Jaccard `substanceSimilarity` score and its two passes: ±2 first, then 3-5 lines, so a tight twin is never stolen by a wide one. Both passes now gate on that score against one named constant, `SUBSTANCE_SIMILARITY_MIN`, recalibrated from 0.4 to 0.2. `SUBSTANCE_SIMILARITY_WIDE_MIN` (0.6) is retired. Missing text still pairs only inside ±2. Separately, a dispatcher-voice note in `plugin/skills/review/step3-lens-dispatch.md` tells each lens agent which line to anchor a finding on.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T194318-record-3418/work/3418-spec.md`

## Global Constraints

- The threshold is a named constant (spec Deliverables). It keeps the existing exported name `SUBSTANCE_SIMILARITY_MIN`, which `plugin/bin/lib/issues/near-duplicate.js`'s #2331 comment already cites. Its value is `0.2`.
- The existing ±5-line band (`LINE_TOLERANCE_REPRODUCTION_WIDE = 5`) and the ±2 tight band (`LINE_TOLERANCE_REPRODUCTION = 2`) are unchanged.
- Anchor rule wording (spec Deliverables): "Use the defect's own line; when the defect spans several copies, use the first occurrence."
- Commit messages use `{Verb} {what} — {detail}` and `refs #3418`, never `closes`/`fixes`.

## Calibration evidence (already gathered, Spec Step 3)

The current `substanceSimilarity` was run over every same-path pair within ±5 lines in 41 archived review runs' lens-pair JSON (`.claude-tweaks/pipelines/archive/**/review-ctx/lens-*-agent{A,B}.json`, 73 pairs). The 14 hand-labelled different-defect pairs score 0.00-0.15. The 59 same-defect pairs score 0.11-1.00, and 54 of them score at least 0.20. Today's rules (0.4 inside ±2, 0.6 for 3-5) reject about half of the same-defect pairs. #3375's own misses score readdirSync :238/:237 = 0.27 and collectDispatches :299/:300 = 0.21. Stemming, overlap coefficient, Dice, and identifier-weighted Jaccard separated the two groups no better than plain Jaccard. The score therefore stays as it is, and only the threshold moves. Two of #3375's misses, transcript.js :249/:238 (d=11) and TIER_ORDER :153/:176 (d=23), lie outside any band. Task 2's anchor rule addresses them; the matcher cannot.

## Review Focus

1. A same-location pair describing two different defects whose wording overlaps just under the threshold (0.12-0.15) must stay unconfirmed, with `nearLocation` on both sides. Task 1's AC2.1 test uses a real 0.12 pair.
2. Inside the wide band (3-5 lines), a pair where either side has no text must still never pair. This is the existing #2955 AC3.1 test, which must stay green unchanged.
3. Inside ±2, a pair where one side has no text must still pair, as it did before #1980. The existing `missing text` tests must stay green unchanged.
4. A lower threshold must not let a wide-band paraphrase take the B finding that a later A finding reports on the same line. The existing test `a wide-band pair never takes a B finding another A finding reported on the same line` must stay green, and Task 1 adds a paraphrase variant.
5. The lower threshold must not strand a finding through best-first assignment. The existing #2907 stranding and augmenting-path tests must stay green unchanged.

---

### Task 1: Recalibrate `categoriseReproduction` to one substance threshold across the ±5 band

**Files:**
- Modify: `plugin/bin/lib/coordination.js` — `SUBSTANCE_SIMILARITY_MIN` value and comment (lines ~20-40), delete `SUBSTANCE_SIMILARITY_WIDE_MIN` (lines ~35-40) and its export, update the `LINE_TOLERANCE_REPRODUCTION_WIDE` comment (lines ~10-16), and change `categoriseReproduction` passes 1-2 (lines ~351-381)
- Modify: `plugin/skills/_shared/multi-agent-coordination.md` — Comparison rule item 2 (line ~49)
- Modify: `plugin/skills/review/step3-lens-dispatch.md` — the three Reproduction bullets at lines ~94, ~95, and ~98 that state the band and floor
- Test: `tests/multi-agent-coordination.test.js`

**Interfaces:**
- Consumes: nothing from Task 2.
- Produces: `SUBSTANCE_SIMILARITY_MIN === 0.2`, exported. `SUBSTANCE_SIMILARITY_WIDE_MIN` is no longer exported. `categoriseReproduction(a, b) -> { confirmed, unconfirmed }` keeps its signature.
- Consumer enumeration: `SUBSTANCE_SIMILARITY_WIDE_MIN` is read only by `tests/multi-agent-coordination.test.js` (`git grep` shows no `plugin/` reader). `sameSubstance` and `findingsMatch` read `SUBSTANCE_SIMILARITY_MIN` and are exercised only by tests. `findingsMatch` gets the new floor too, which is intended, since one constant now defines "same substance".

- [ ] **Step 1: Write the failing tests**

In `tests/multi-agent-coordination.test.js`, add these after the #2955 block:

```js
// #3418: real #3375 lens-pair paraphrases (review run 2026-10-17T144508-spec-3375-3380).
const READDIR_A = 'readdirSync failure reason discarded: EACCES/ENOTDIR reported as no subagents/ directory';
const READDIR_B = 'readdirSync catch folds every failure into no subagents/ directory; error code dropped';
const UNGUARDED_A = 'await collectDispatches unguarded in main; exit-0 contract rests on readDispatches never throwing';
const UNGUARDED_B = 'await collectDispatches unguarded in main; an unexpected throw exits 2 and skips timing.json write';
// Two different defects one archived pair reported on the same line (scan.js:124, scored 0.12).
const NO_CACHE = 'No caching/watermark: every run fully re-reads and re-parses every transcript in the 14-day window even if already scanned';
const NO_SIZE_CAP = 'Whole transcript files read fully into memory with no size cap across a date-bounded but size-unbounded window';

test('AC1.1 reproduction (#3418): one defect cited at its definition and use lines, paraphrased → confirmed', () => {
  for (const [textA, textB, lineA, lineB] of [
    [READDIR_A, READDIR_B, 234, 238], // definition / use, 4 lines apart (wide band)
    [UNGUARDED_A, UNGUARDED_B, 299, 300], // ±2
  ]) {
    const { confirmed, unconfirmed } = c.categoriseReproduction(
      [{ path: 'src/t.js', line: lineA, severity: 'medium', text: textA }],
      [{ path: 'src/t.js', line: lineB, severity: 'medium', text: textB }],
    );
    assert.strictEqual(confirmed.length, 1, `${lineA}/${lineB} should reproduce`);
    assert.strictEqual(unconfirmed.length, 0);
  }
});

test('AC2.1 reproduction (#3418): same location, two different defects → both unconfirmed with nearLocation', () => {
  const { confirmed, unconfirmed } = c.categoriseReproduction(
    [{ path: 'src/scan.js', line: 124, severity: 'medium', text: NO_CACHE }],
    [{ path: 'src/scan.js', line: 124, severity: 'medium', text: NO_SIZE_CAP }],
  );
  assert.strictEqual(confirmed.length, 0);
  assert.strictEqual(unconfirmed.length, 2);
  assert.ok(unconfirmed.every((f) => f.nearLocation !== undefined));
});

test('reproduction (#3418): one named substance threshold, calibrated at 0.2, the wide floor retired', () => {
  assert.strictEqual(c.SUBSTANCE_SIMILARITY_MIN, 0.2);
  assert.strictEqual(c.SUBSTANCE_SIMILARITY_WIDE_MIN, undefined);
});

test('reproduction (#3418): a paraphrased wide-band twin never takes a B finding another A finding reported on the same line', () => {
  const a = [
    { path: 'src/t.js', line: 234, severity: 'medium', text: READDIR_A },
    { path: 'src/t.js', line: 238, severity: 'medium', text: READDIR_B },
  ];
  const b = [{ path: 'src/t.js', line: 238, severity: 'medium', text: READDIR_B }];
  const { confirmed, unconfirmed } = c.categoriseReproduction(a, b);
  assert.deepStrictEqual(confirmed.map((f) => f.line), [238]);
  assert.deepStrictEqual(unconfirmed.map((f) => `${f.source}:${f.line}`), ['A:234']);
});
```

Update the existing #2955 tests that pin the retired behaviour:
- `wide-band constants are exported with their own names and the calibrated values`: keep the `LINE_TOLERANCE_REPRODUCTION_WIDE === 5` and `WIDE > REPRODUCTION` assertions, and drop the two `SUBSTANCE_SIMILARITY_WIDE_MIN` assertions. The new #3418 constant test above covers them.
- `calibration fixtures sit on the intended side of the wide floor`: rename it to `... sit on the intended side of the substance threshold`. Assert `WIDE_SAME` scores `>= c.SUBSTANCE_SIMILARITY_MIN`, `WIDE_DIFFERENT` scores `< c.SUBSTANCE_SIMILARITY_MIN`, and `loose` scores `>= c.SUBSTANCE_SIMILARITY_MIN`.
- `loose same-issue pair confirms within ±2 but not at 3 lines (±2 path unchanged)`: rename it to `loose same-issue pair confirms within ±2 and at 3 lines (#3418: one threshold across the band)`. Make the 3-line case expect `confirmed.length === 1`.
- `prose twins state the two-tier line rule with the code's own values (#2955)`: set `const floor = String(c.SUBSTANCE_SIMILARITY_MIN);`. All four bullets keep their prefixes and value lists.
- Remove the stale `LOOSE_A`/`LOOSE_B` comment "clears SUBSTANCE_SIMILARITY_MIN but not the wide floor" and reword it as "loosely worded; clears the substance threshold".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/multi-agent-coordination.test.js`
Expected: FAIL. The AC1.1 test fails because 0.27 < 0.6 and 0.21 < 0.4. The constant test fails because the value is still 0.4. The rewritten loose-at-3-lines and calibration tests also fail. The paraphrase-variant test is a guard that passes before and after the change. AC2.1 also passes before, at 0.12 < 0.4; it pins that the lower threshold does not merge it.

- [ ] **Step 3: Implement in `plugin/bin/lib/coordination.js`**

- Set `SUBSTANCE_SIMILARITY_MIN = 0.2`. Replace its comment's rationale with the calibration evidence above: 73 archived pairs, different defects at 0.00-0.15, and 54 of 59 same-defect pairs at or above 0.20. Say it is one threshold for the whole ±5 band (#3418, superseding #2955's separate 0.6 wide floor). Keep the #2331 paragraph.
- Delete `SUBSTANCE_SIMILARITY_WIDE_MIN` and its export, and reword the `LINE_TOLERANCE_REPRODUCTION_WIDE` comment so it says a 3-5 line pair needs known text scoring at least `SUBSTANCE_SIMILARITY_MIN`.
- In `categoriseReproduction`, compute `const score = substanceSimilarity(fa, fb)` once per candidate in both passes. Pass 1 (±2) skips when `score !== null && score < SUBSTANCE_SIMILARITY_MIN`, because unknown text still pairs. Pass 2 (3-5) skips when `score === null || score < SUBSTANCE_SIMILARITY_MIN`. Push `score` into the pair record instead of recomputing it. Keep the two-pass order and `assignBestPairs` unchanged, and update the pass comments to match.
- `sameSubstance` stays as it is, since it serves `findingsMatch` and reads the same constant.

- [ ] **Step 4: Update the prose twins**

- `plugin/skills/_shared/multi-agent-coordination.md` item 2: keep the prefix `2. **Line within`. State ±2, ±5, and `0.2`: a 3-5 line pair matches only when both findings carry text and their substance similarity is at least 0.2, the same threshold that applies inside ±2. A pair with missing text never matches in the wider band.
- `plugin/skills/review/step3-lens-dispatch.md` line ~94 (confirmed bullet): change `at least 0.6` to `at least 0.2 (the same threshold as inside ±2)`. Line ~98 (coincidence bullet): name the score test `categoriseReproduction`'s substance score on the `text`/`Finding` column, which falls below `SUBSTANCE_SIMILARITY_MIN` (0.2), instead of "`sameSubstance` check comes back `false`". Also change its closing sentence's `(substance similarity at least 0.6)` / `misses the 0.6 floor` to 0.2. Line ~95 (severity-straddle bullet) keeps ±2 and ±5 and needs no value change.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/multi-agent-coordination.test.js tests/bin-lib/review-coordination/cli.test.js`
Expected: PASS, with 0 failures.

- [ ] **Step 6: Real-input probe (Real-input probe check)**

Run both scratch probe scripts against the archived lens-pair data, comparing `categoriseReproduction` confirmed counts before (`git show HEAD~1:plugin/bin/lib/coordination.js` written to a scratch file) and after:
`node {scratchpad}/probe-pairs.js "$PWD/plugin/bin/lib/coordination.js" "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-10-17T144508-spec-3375-3380/spec-3375/review-ctx"`
Expected: lens-3c's confirmed count rises from 1 to 3, picking up readdirSync :238/:237 and collectDispatches :299/:300. Record the before/after totals across all 41 archived dirs in `decisions.md`, and check that no hand-labelled different-defect pair (max 0.15) became confirmed.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/coordination.js plugin/skills/_shared/multi-agent-coordination.md plugin/skills/review/step3-lens-dispatch.md tests/multi-agent-coordination.test.js
git commit -m "Match reproduction pairs on one substance threshold across the ±5 band — refs #3418"
```

### Task 2: Name the finding anchor in the lens prompt, pinned by a conformance test

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md` — insert one dispatcher-voice note after the `> **\`Path:Line\` must be file-native, never bundle-relative.**` note (line ~76) and before `> **Coverage findings anchor at the code under test.**` (line ~78)
- Create: `tests/review-defect-anchor-conformance.test.js`

**Interfaces:**
- Consumes: nothing from Task 1. Task 1's edits to lines ~94-98 sit below this insertion, so neither task's anchors move the other's.
- Produces: the note heading `> **Anchor a finding on the defect's own line.**`, which the new test pins.

Byte budget: `step3-lens-dispatch.md` is 44,920 bytes against the shared 51,200-byte ceiling. That leaves about 6.2 KB of headroom; the note is about 700 bytes. No file-specific byte pin exists (`git grep step3-lens-dispatch -- tests`). The composed-bytes gate at its call site is checked by `npm test` in Task 1's and Task 2's full-suite run.

Placement constraints (Prose-held pin check): `tests/review-coverage-anchor-conformance.test.js` slices from the Coverage note to `> **Scratch path`. That is why the new note goes *before* the Coverage note, outside that slice. `tests/review-lens-no-suites-conformance.test.js` slices from `**Pre-dispatch listing` to `**\`Path:Line\` must be file-`, and the note goes after that end anchor. The note must stay outside the byte-identical Calibration block.

- [ ] **Step 1: Write the failing test**

`tests/review-defect-anchor-conformance.test.js`, in the style of `review-coverage-anchor-conformance.test.js`. It uses a `between()` helper that asserts both anchors, and one assertion function shared by the positive test and the go-red control (Go-red control check):

```js
const NOTE = "> **Anchor a finding on the defect's own line.**";
function assertAnchorRule(text) {
  const sec = between(text, NOTE, '> **Coverage findings anchor at the code under test.**');
  assert.match(sec, /Tell each dispatched agent explicitly/);
  assert.match(sec, /the defect's own line/);
  assert.match(sec, /several copies/);
  assert.match(sec, /first occurrence/);
  assert.match(sec, /dispatch prompt/);
}
test('AC3.1: the lens prompt carries the defect-anchor rule (defect line; first occurrence across copies)', () => {
  assertAnchorRule(read('review', 'step3-lens-dispatch.md'));
});
test('AC3.1 go-red: dropping the first-occurrence clause fails the same assertions', () => {
  const mutated = read('review', 'step3-lens-dispatch.md').replace(/first occurrence/g, 'some occurrence');
  assert.throws(() => assertAnchorRule(mutated));
});
test('the anchor note sits after the Path:Line note, before the Coverage note, outside the Calibration block', () => {
  // indexOf ordering: Path:Line note < NOTE < Coverage note < 'CALIBRATION (required):';
  // the Calibration block ('CALIBRATION (required):' .. 'Self-check before sending') does not contain "defect's own line".
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/review-defect-anchor-conformance.test.js`
Expected: FAIL with "missing start anchor: > **Anchor a finding on the defect's own line.**"

- [ ] **Step 3: Insert the note (Dispatcher-voice check)**

This is the exact copy, which the spec's rule fixes, written in the neighbouring notes' voice:

> **Anchor a finding on the defect's own line.** Tell each dispatched agent explicitly: report a finding's `Path:Line` at the line where the defect itself is — not a caller, a use site, or the first line of the enclosing block — and when the defect spans several copies (a duplicated block, a value restated in more than one place), at its first occurrence: the earliest line in the first file the review bundle lists. Two agents of one reproduction pair that anchor the same defect on different lines (a definition and its use, or two copies of one block) land outside `categorise-reproduction`'s line band and are scored as two different findings, recoverable only through the Direct-verification override (#3418: #3375's medium-tier review lost 11 of 13 two-agent findings this way). This rule goes in the dispatch prompt alongside the scope and the `Path:Line` instruction, outside the byte-identical Calibration/Output-template block below.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/review-defect-anchor-conformance.test.js tests/review-coverage-anchor-conformance.test.js tests/review-lens-no-suites-conformance.test.js tests/code-health-misc/criteria-fragments.test.js tests/review-dispatch-composition.test.js`
Expected: PASS, with 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-lens-dispatch.md tests/review-defect-anchor-conformance.test.js
git commit -m "Name the finding anchor in the review lens prompt — refs #3418"
```
