# Explicit-list dispatch drops the first-named record when it caps to dispatch-batch-size (#4219) Implementation Plan

**Goal:** `selectGroupsForExplicitList` returns the selected groups in the order the records were named, caps them at `dispatch-batch-size`, and reports the requested records the cap leaves out, so `/claude-tweaks:dispatch #A,#B,...` no longer drops the first-named record silently.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T080726-record-4219/work/4219-spec.md` (materialized from GitHub issue #4219)

**Premise-refs:** plugin/bin/lib/issues/grouping.js

Verified at authoring (worktree HEAD `d92dc95d3`):
- `selectGroupsForExplicitList` sits at `plugin/bin/lib/issues/grouping.js:572` and walks `groups` in pool order (confirmed by read).
- Sole caller: `git grep -n "selectGroupsForExplicitList" -- plugin docs tests` hits only `grouping.js` (definition + export), `plugin/skills/dispatch/SKILL.md:186` (the explicit-list paragraph), `plugin/skills/dispatch/near-duplicate-pairs.md:3` (a pointer), the journey `docs/journeys/dispatch-a-near-duplicate-pair-by-name-3520.md:30` (a pointer), and `tests/bin-lib/issues/grouping.test.js`. No code caller passes a third argument.
- Return-shape widening (`deferredByCap` added): existing tests assert on `result.selectedGroups` / `result.notFound` / `.length` individually, never `deepStrictEqual(result, …)` — no assertion is defanged. `predictedConflicts(pairs, selectedGroups)` (`plugin/bin/lib/dispatch/near-dup-pairs.js:55`) consumes `selectedGroups` as the dispatch order — a pick-all consumer; the new named order is exactly the dispatch order it should announce, and `near-duplicate-pairs.md` step 2's own truncation instruction is replaced by the function's cap.
- Byte headroom: `plugin/skills/dispatch/SKILL.md` is 47,503 B against `RAIL_BYTES` 52,500 (90.5% — nearCeiling); this task adds ≈+350 B, leaving ≈4,650 B. `near-duplicate-pairs.md` is far below the rail.
- Prose pins: `git grep -n -F "still bound by" -- tests plugin` and `git grep -n -F "truncated to" -- tests` hit no test file.

---

### Task 1: Order explicit-list selection by named position, cap it, and report cap-deferred records

**Files:**
- Modify: `plugin/bin/lib/issues/grouping.js`
- Modify: `plugin/skills/dispatch/SKILL.md`
- Modify: `plugin/skills/dispatch/near-duplicate-pairs.md` (scope-creep, add-to-plan: its step 2 truncates `selectedGroups` itself; the function now caps)
- Test: `tests/bin-lib/issues/grouping.test.js`

- [ ] **Step 1: Failing test** — append after the `requesting nothing returns no selected groups and no notFound` test in `tests/bin-lib/issues/grouping.test.js`:

```js
// #4219: selection follows the order the records were named, not pool order.
const g = (...nums) => nums.map((number) => ({ number }));
const nums = (groupList) => groupList.map((group) => group.map((issue) => issue.number));

test('AC1.1: selectedGroups follow the requested order, not pool order', () => {
  const result = selectGroupsForExplicitList([4026, 4028, 4032, 4029], [g(4032), g(4029), g(4028), g(4026)]);
  assert.deepStrictEqual(nums(result.selectedGroups), [[4026], [4028], [4032], [4029]]);
  assert.deepStrictEqual(result.deferredByCap, []);
});

test('AC2.1: a bundle sorts at the earliest requested position any member holds', () => {
  // request [A,B,C,D] = [1,2,3,4]; the bundle holds B and D; pool order is C, bundle, A
  const result = selectGroupsForExplicitList([1, 2, 3, 4], [g(3), g(2, 4), g(1)]);
  assert.deepStrictEqual(nums(result.selectedGroups), [[1], [2, 4], [3]]);
});

test('AC3.1: batchSize caps the ordered list and reports every requested record it leaves out', () => {
  const result = selectGroupsForExplicitList([4026, 4028, 4032, 4029], [g(4032), g(4029), g(4028), g(4026)], 3);
  assert.deepStrictEqual(nums(result.selectedGroups), [[4026], [4028], [4032]]);
  assert.deepStrictEqual(result.deferredByCap, [4029]);
  assert.deepStrictEqual(result.notFound, []);
});

test('deferredByCap names only requested members of a cap-deferred bundle, in requested order', () => {
  const result = selectGroupsForExplicitList([5, 1, 9], [g(1), g(9, 7, 5)], 1);
  assert.deepStrictEqual(nums(result.selectedGroups), [[9, 7, 5]]);
  assert.deepStrictEqual(result.deferredByCap, [1]);
});

test('batchSize larger than the selection defers nothing', () => {
  const result = selectGroupsForExplicitList([2, 1], [g(1), g(2)], 5);
  assert.deepStrictEqual(nums(result.selectedGroups), [[2], [1]]);
  assert.deepStrictEqual(result.deferredByCap, []);
});

test('a batchSize that is not a positive integer throws', () => {
  for (const bad of [0, -1, 1.5, null, 'all', Number.NaN]) {
    assert.throws(() => selectGroupsForExplicitList([1], [g(1)], bad), TypeError);
  }
});
```

- [ ] **Step 2: Run to see it fail** — Run: `node --test tests/bin-lib/issues/grouping.test.js` Expected: FAIL (AC1.1, AC2.1 and AC3.1 fail on the current pool-order implementation; `deferredByCap` is `undefined`).

- [ ] **Step 3: Implement** — replace `selectGroupsForExplicitList` and its header comment in `plugin/bin/lib/issues/grouping.js` with:

```js
// Given a set of requested issue numbers and dispatch Step 2's already-
// computed groups (arrays of full issue objects), returns the deduplicated
// groups containing at least one requested number, plus any requested
// numbers found in none of them (not currently eligible — already claimed,
// grant stripped, or never existed). selectedGroups are in named order: each
// group sits at the earliest position any of its members holds in
// requestedNumbers, ties keeping pool order (#4219). With batchSize (dispatch-
// batch-size), only the first batchSize ordered groups are selected and the
// requested numbers in the rest come back as deferredByCap, in requested order.
function selectGroupsForExplicitList(requestedNumbers, groups, batchSize) {
  if (batchSize !== undefined && !(Number.isInteger(batchSize) && batchSize > 0)) {
    throw new TypeError(`batchSize must be a positive integer, got ${batchSize}`);
  }
  const position = new Map();
  requestedNumbers.forEach((n, i) => { if (!position.has(n)) position.set(n, i); });
  const matched = [];
  const foundNumbers = new Set();
  for (const group of groups) {
    const groupNumbers = group.map((issue) => issue.number);
    const ranks = groupNumbers.filter((n) => position.has(n)).map((n) => position.get(n));
    if (ranks.length > 0) {
      matched.push({ group, rank: Math.min(...ranks) });
      groupNumbers.forEach((n) => foundNumbers.add(n));
    }
  }
  matched.sort((a, b) => a.rank - b.rank); // Array#sort is stable: ties keep pool order
  const ordered = matched.map((m) => m.group);
  const selectedGroups = batchSize === undefined ? ordered : ordered.slice(0, batchSize);
  const deferred = new Set(ordered.slice(selectedGroups.length).flatMap((group) => group.map((issue) => issue.number)));
  const deferredByCap = [...position.keys()].filter((n) => deferred.has(n));
  const notFound = requestedNumbers.filter((n) => !foundNumbers.has(n));
  return { selectedGroups, deferredByCap, notFound };
}
```

  Then in `plugin/skills/dispatch/SKILL.md`'s `**\`#N[,#M,#O...]\`**` paragraph, replacing:

  `Call \`selectGroupsForExplicitList(numbers, groups)\` (same file) against Step 2's already-computed \`groups\` array.`

  with:

  `Call \`selectGroupsForExplicitList(numbers, groups, {batch})\` (same file), \`{batch}\` = \`dispatch-batch-size\`, against Step 2's already-computed \`groups\` array.`

  and replacing:

  `Every group in the returned \`selectedGroups\` proceeds to Step 4, still bound by \`dispatch-batch-size\` (extra groups remain unclaimed in the queue for a later firing to select).`

  with:

  `The returned \`selectedGroups\` are in named order — each group at the earliest position any member holds in the list, ties in pool order — already capped at \`{batch}\`; each proceeds to Step 4 in that order. Report every record in the returned \`deferredByCap\` as \`#{n} deferred by dispatch-batch-size ({batch}) — name it in a later firing\`; it stays unclaimed in the queue.`

  and in the same paragraph's last sentence, replacing `The selection is already explicit — Step 3's ranking never runs for this form.` with `The selection is already explicit — Step 3's ranking never runs for this form; named order stands in for it.`

  Then in `plugin/skills/dispatch/near-duplicate-pairs.md` step 2, replacing:

  `with \`selectedGroups\` truncated to\n   the first \`dispatch-batch-size\` groups (the ones that dispatch this firing).`

  with:

  `with \`selectedGroups\` as returned —\n   already capped at \`dispatch-batch-size\`, the groups that dispatch this firing.`

- [ ] **Step 4: Run** — `node --test tests/bin-lib/issues/grouping.test.js` — PASS. Then prove AC4.1 (the ordering test fails against the current implementation): copy `git show HEAD:plugin/bin/lib/issues/grouping.js` over the working file in a scratch copy of the repo (or restore it temporarily and put it back in the same command), run the test file, and see AC1.1, AC2.1 and AC3.1 fail; restore the new implementation.

- [ ] **Step 5: Commit** — one commit, `Order explicit-list dispatch by named position and report cap-deferred records — refs #4219`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (named order, ties in pool order) → Step 3 code + AC1.1/AC2.1 tests. Deliverable 2 (cap truncates the ordered list; cap-deferred records reported) → `batchSize`/`deferredByCap` + SKILL.md report line + AC3.1 test. Deliverable 3 (SKILL.md states the named-order rule) → Step 3 SKILL.md edit. Deliverable 4 (unit test with differing pool order) → Step 1. AC4.1 → Step 4's revert run.
- **Placeholders:** none.

Waived AC4.1: a property of the test run, not a test — proven by Step 4's revert run against `git show HEAD:plugin/bin/lib/issues/grouping.js`, with its output quoted in the build report.
