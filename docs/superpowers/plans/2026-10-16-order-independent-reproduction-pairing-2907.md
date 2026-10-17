# Order-Independent Reproduction Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `categoriseReproduction` confirm a finding both review agents reported, whatever order agent A listed its findings in. Today it can drop that finding when agent A also reported a different issue at the same location.

**Architecture:** `categoriseReproduction` (`plugin/bin/lib/coordination.js`) runs three passes:
1. **±2 pass.** Assigns every same-location (±2), not-known-different pair best-first across all A findings, using a small `assignBestPairs` helper. It does not reserve a different-substance neighbour.
2. **Wide band.** #2955's pass, also assigned best-first, for A findings with no ±2 twin.
3. **Coincidence pass.** Only after both pairing passes, each still-unpaired A finding takes its first unclaimed ±2 neighbour as the #1980 coincidence pair.

Today's code reserves that coincidence partner inside the first pass, in A order. That reservation is the bug.

**Tech Stack:** Node 18+, `node:test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T203248-spec-2907/work/2907-spec.md` (record #2907)

## Global Constraints

- `plugin/bin/lib/coordination.js` stays pure: no I/O, no imports from other `bin/lib/` modules (its own header rule).
- `findingsMatch`, `sameLocation`, `sameSubstance`, `substanceSimilarity`, `reconcileSeverity` and every exported constant stay unchanged; only `categoriseReproduction` changes, plus one new non-exported helper.
- Output shape is unchanged: `{ confirmed, unconfirmed }`. Confirmed entries are `reconcileSeverity(fa, fb)`. Unconfirmed entries carry `source: 'A' | 'B'`, plus `nearLocation: { source, path, line }` for #1980 coincidence pairs.
- Confirmed order stays: ±2 pairs in A-index order, then wide-band pairs in A-index order. This matches today's order: pass-1 pairs in A order, then deferred A findings in A order.
- The existing #1980 different-substance near-location tests still pass (AC2.1), as do all #2955 wide-band tests and `tests/bin-lib/review-coordination/cli.test.js`.

## Review Focus

1. Agent A reports two findings at one location; only the second matches B. B must pair with the matching one, in either A order. This is the #2628 incident fixture, pinned by Task 1's first test.
2. Two A findings both clear the substance check against one B finding. The closer match (higher similarity) must win in either order, not the first one A listed. Pinned by Task 1's second test (the Greedy-matcher widening check: a later item's tight match competing with an earlier item's looser one).
3. One A finding's different-substance ±2 neighbour is another A finding's wide-band twin. The twin pairing must win, and the unrelated A finding surfaces plain, with no `nearLocation`, in either order. Pinned by Task 1's third test.
4. A null element or a finding with no numeric line must still not crash or pair. Covered by the existing "null/undefined finding element does not crash" test; pairs only form after `sameLocation` passes, so `delta` is always a real number.
5. With no wide twin, a ±2 different-substance neighbour still yields the #1980 coincidence pair, and a farther B finding stays plain. Covered by the existing #2955 test "with no wide twin, a ±2 different-substance neighbour still yields the #1980 coincidence pair".

---

### Task 1: Best-first pairing with a deferred coincidence pass

**Files:**
- Modify: `plugin/bin/lib/coordination.js:299-406` (the whole `categoriseReproduction` function, from `function categoriseReproduction(` up to the line before `function detectCrossLensOverlap(`)
- Test: `tests/multi-agent-coordination.test.js` (insert after the test named `reproduction (#2955): with no wide twin, a ±2 different-substance neighbour still yields the #1980 coincidence pair`, i.e. directly before `test('reproduction: one-side-only finding → unconfirmed with STAGED entry matching the documented schema'`)

**Interfaces:**
- Consumes: `normalizeFinding`, `sameLocation(na, nb, tolerance)`, `sameSubstance(na, nb)` (tri-state `true`/`false`/`null`), `substanceSimilarity(na, nb)` (number or `null`), `reconcileSeverity(fa, fb)`, and the constants `LINE_TOLERANCE_REPRODUCTION` (2), `LINE_TOLERANCE_REPRODUCTION_WIDE` (5), `SUBSTANCE_SIMILARITY_WIDE_MIN` (0.6). All already exist in `coordination.js`. The test file's existing constants `WIDE_SAME_A`, `WIDE_SAME_B`, `WIDE_DIFFERENT`, `LOOSE_A`, `LOOSE_B` (declared at its lines 315-321) are reused.
- Produces: `categoriseReproduction(agentAFindings, agentBFindings) → { confirmed, unconfirmed }`, same signature and export as today. New internal helper `assignBestPairs(pairs, aToB, pairedB)`, not exported.

- [ ] **Step 1: Write the failing tests**

Insert this block into `tests/multi-agent-coordination.test.js` at the position named under **Files** (after the #2955 "with no wide twin" test, before the "one-side-only finding" test):

```js
// #2907: pairing must not depend on the order agent A reported its findings.
// Fixture from #2628's review (lens 3b): both agents reported the symlink
// containment gap at one path:line, and agent A also reported a size-cap issue there.
const SIZE_CAP_A = { path: 'plugin/bin/lib/code-health/candidates-app-store-readiness.js', line: 308, severity: 'high', text: 'Bundle size cap is not enforced before reading the archive into memory, so an oversized upload exhausts memory' };
const SYMLINK_A = { path: 'plugin/bin/lib/code-health/candidates-app-store-readiness.js', line: 308, severity: 'high', text: 'Symlink containment gap: a symlink inside the bundle can point outside the extraction root and be read' };
const SYMLINK_B = { path: 'plugin/bin/lib/code-health/candidates-app-store-readiness.js', line: 308, severity: 'high', text: 'Symlink containment gap: a symlink inside the bundle can point outside the extraction root and is read' };

test('AC1.1 reproduction (#2907): a same-substance pair at one location is confirmed whichever order agent A reported it in', () => {
  for (const a of [[SIZE_CAP_A, SYMLINK_A], [SYMLINK_A, SIZE_CAP_A]]) {
    const { confirmed, unconfirmed } = c.categoriseReproduction(a, [SYMLINK_B]);
    assert.deepStrictEqual(confirmed.map((f) => f.text), [SYMLINK_A.text]);
    assert.strictEqual(unconfirmed.length, 1);
    assert.strictEqual(unconfirmed[0].source, 'A');
    assert.strictEqual(unconfirmed[0].text, SIZE_CAP_A.text);
    // B was paired, so it is no coincidence partner for the size-cap finding.
    assert.strictEqual(unconfirmed[0].nearLocation, undefined);
  }
});

test('reproduction (#2907): two A findings that both match one B finding pair it with the closer match, in either A order', () => {
  const loose = { path: 'src/api.js', line: 40, severity: 'low', text: LOOSE_A };
  const exact = { path: 'src/api.js', line: 40, severity: 'low', text: LOOSE_B };
  const b = [{ path: 'src/api.js', line: 40, severity: 'low', text: LOOSE_B }];
  for (const a of [[loose, exact], [exact, loose]]) {
    const { confirmed, unconfirmed } = c.categoriseReproduction(a, b);
    assert.deepStrictEqual(confirmed.map((f) => f.text), [LOOSE_B]);
    assert.deepStrictEqual(unconfirmed.map((f) => `${f.source}:${f.text}`), [`A:${LOOSE_A}`]);
  }
});

test('reproduction (#2907): a different-substance ±2 neighbour is not reserved from another A finding\'s wide-band twin', () => {
  const unrelated = { path: 'src/run.js', line: 100, severity: 'high', text: WIDE_DIFFERENT };
  const twin = { path: 'src/run.js', line: 104, severity: 'high', text: WIDE_SAME_A };
  const b = [{ path: 'src/run.js', line: 101, severity: 'high', text: WIDE_SAME_B }];
  for (const a of [[unrelated, twin], [twin, unrelated]]) {
    const { confirmed, unconfirmed } = c.categoriseReproduction(a, b);
    assert.deepStrictEqual(confirmed.map((f) => f.line), [104]);
    assert.deepStrictEqual(unconfirmed.map((f) => `${f.source}:${f.line}`), ['A:100']);
    assert.strictEqual(unconfirmed[0].nearLocation, undefined);
  }
});
```

The symlink texts are near-identical on purpose: the categoriser is wording-sensitive, and a loose paraphrase can fail `sameSubstance` on its own. That would make the test pass or fail for a reason unrelated to ordering. `LOOSE_A` vs `LOOSE_B` scores about 0.47, which clears `SUBSTANCE_SIMILARITY_MIN` (0.4), so both A findings in the second test are eligible against B. `WIDE_SAME_A` vs `WIDE_SAME_B` clears the 0.6 wide-band floor, and `WIDE_DIFFERENT` vs `WIDE_SAME_B` is a known different substance.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#2907" tests/multi-agent-coordination.test.js`
Expected: FAIL — all three `#2907` tests fail on today's code. Authoring-time probe: the same three tests ran 0 pass / 3 fail against the current `coordination.js`. The incident fixture gives 0 confirmed / 3 unconfirmed in `[size-cap, symlink]` order.

- [ ] **Step 3: Replace `categoriseReproduction`**

In `plugin/bin/lib/coordination.js`, replace everything from `function categoriseReproduction(agentAFindings, agentBFindings) {` through that function's closing `}` (the line before the blank line preceding `function detectCrossLensOverlap(`) with:

```js
// #2907: assigns pairs best-first across every A finding, so which A
// finding a B finding pairs with no longer depends on the order agent A
// reported them in. Ranked by similarity (an unknown/`null` score ranks below
// every known one), then by the smaller line delta, then by A index, then by
// B index, so even a tie resolves the same way on every run.
function assignBestPairs(pairs, aToB, pairedB) {
  const rank = (score) => (score === null ? -1 : score);
  const ordered = [...pairs].sort((x, y) => rank(y.score) - rank(x.score)
    || x.delta - y.delta || x.aIndex - y.aIndex || x.bIndex - y.bIndex);
  for (const pair of ordered) {
    if (aToB.has(pair.aIndex) || pairedB.has(pair.bIndex)) continue;
    aToB.set(pair.aIndex, pair.bIndex);
    pairedB.add(pair.bIndex);
  }
}

function categoriseReproduction(agentAFindings, agentBFindings) {
  const normalizedA = agentAFindings.map((rawFa) => normalizeFinding(rawFa));
  const normalizedB = agentBFindings.map((rawFb) => normalizeFinding(rawFb));
  const ownLine = new Map(); // A index → B index, paired within ±2
  const wideLine = new Map(); // A index → B index, paired in the wide band
  const pairedB = new Set();

  // Pass 1 (#1980 + #2907): every ±2 pair whose substance is not known to
  // differ — `true` and `null` (unknown) both pair, per sameSubstance's
  // contract above — assigned best-first across all A findings. A
  // different-substance neighbour is never reserved here: it may still be
  // another A finding's real twin.
  const ownLinePairs = [];
  normalizedA.forEach((fa, aIndex) => {
    normalizedB.forEach((fb, bIndex) => {
      if (!sameLocation(fa, fb, LINE_TOLERANCE_REPRODUCTION)) return;
      if (sameSubstance(fa, fb) === false) return;
      ownLinePairs.push({ aIndex, bIndex, score: substanceSimilarity(fa, fb), delta: Math.abs(fa.line - fb.line) });
    });
  });
  assignBestPairs(ownLinePairs, ownLine, pairedB);

  // Pass 2 (#2955): the wide band, for A findings with no ±2 twin. A pair
  // 3-5 lines apart counts only on known, strong substance agreement, and it
  // runs after pass 1 so it never takes a B finding another A finding
  // reported on (nearly) the same line.
  const widePairs = [];
  normalizedA.forEach((fa, aIndex) => {
    if (ownLine.has(aIndex)) return;
    normalizedB.forEach((fb, bIndex) => {
      if (pairedB.has(bIndex)) return;
      if (!sameLocation(fa, fb, LINE_TOLERANCE_REPRODUCTION_WIDE)) return;
      const score = substanceSimilarity(fa, fb);
      if (score === null || score < SUBSTANCE_SIMILARITY_WIDE_MIN) return;
      widePairs.push({ aIndex, bIndex, score, delta: Math.abs(fa.line - fb.line) });
    });
  });
  assignBestPairs(widePairs, wideLine, pairedB);

  const confirmed = [];
  for (const pairs of [ownLine, wideLine]) {
    [...pairs.keys()].sort((x, y) => x - y).forEach((aIndex) => {
      confirmed.push(reconcileSeverity(normalizedA[aIndex], normalizedB[pairs.get(aIndex)]));
    });
  }

  // Pass 3 (#1980): an A finding still unpaired takes its first ±2
  // neighbour nobody paired as a coincidence — do NOT merge. Both sides
  // surface in unconfirmed, each pointing at the other via `nearLocation`,
  // so a reviewer sees the coincidence instead of one finding silently
  // vanishing.
  const unconfirmed = [];
  const consumedB = new Set();
  normalizedA.forEach((fa, aIndex) => {
    if (ownLine.has(aIndex) || wideLine.has(aIndex)) return;
    const neighbour = normalizedB.findIndex((fb, bIndex) => !pairedB.has(bIndex) && !consumedB.has(bIndex)
      && sameLocation(fa, fb, LINE_TOLERANCE_REPRODUCTION));
    if (neighbour === -1) {
      unconfirmed.push({ ...fa, source: 'A' });
      return;
    }
    consumedB.add(neighbour);
    const fb = normalizedB[neighbour];
    unconfirmed.push({ ...fa, source: 'A', nearLocation: { source: 'B', path: fb.path, line: fb.line } });
    unconfirmed.push({ ...fb, source: 'B', nearLocation: { source: 'A', path: fa.path, line: fa.line } });
  });

  normalizedB.forEach((fb, bIndex) => {
    if (pairedB.has(bIndex) || consumedB.has(bIndex)) return;
    unconfirmed.push({ ...fb, source: 'B' });
  });

  return { confirmed, unconfirmed };
}
```

Why pass 3's "first unclaimed ±2 neighbour" is always a different-substance one: pass 1 assigns every eligible ±2 pair whose two ends are both still free. So an A finding left unpaired after pass 1 has no free eligible ±2 partner, and pass 2 only removes B findings. The `docs/plugin-structure.md` `nearLocation` sentence stays true as written: a same-location, different-substance pair carries `nearLocation` only when the A finding found no twin.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/multi-agent-coordination.test.js tests/bin-lib/review-coordination/cli.test.js`
Expected: PASS — every test, including the three new `#2907` tests and AC2.1 (the existing #1980 different-substance near-location tests and the #2955 wide-band tests, unchanged). Authoring-time probe: this replacement ran 74/74 existing tests green, plus the three new tests green.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/coordination.js tests/multi-agent-coordination.test.js
git commit -m "Pair reproduction findings best-first across agent A — #2907"
```
