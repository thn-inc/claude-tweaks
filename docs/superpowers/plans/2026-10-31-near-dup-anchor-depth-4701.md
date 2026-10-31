# Near-Duplicate Anchor-Depth Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank `findNearDuplicates` hits so deep shared-anchor overlap outranks shallow multi-signal overlap, and have `/claude-tweaks:specify` shaping name a deep-overlap candidate as a likely duplicate.

**Architecture:** One sort-key change plus one exported helper (`deepOverlapHits`, `DEEP_OVERLAP_MIN`) in `plugin/bin/lib/issues/near-duplicate.js`; one added sentence in the shaping-mode near-duplicate paragraph. `score` keeps meaning "count of signal kinds fired", so `shapingRefusal` and `isStrongNearDuplicate` are untouched.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T124758-spec-4701/work/4701-spec.md` (record #4701)

Scope keywords: findNearDuplicates, deepOverlapHits

## Global Constraints

- `score` stays the signal-kind count (1-3); `MIN_REFUSAL_SCORE` (2), `STRONG_NEAR_DUPLICATE_MIN` (2), `shapingRefusal` and `isStrongNearDuplicate` are not modified.
- The pinned three-column table header (`| Record | Score | Signals |`, `tests/specify-near-duplicate-prose.test.js:39-41`) and the sentence "A score-1 candidate is surfaced in the table and the `**Related:**` line only" (`:130`) stay byte-identical.
- Open #4702 edits the same paragraph's Related-append sentence: the shaping-mode edit is one new, separate sentence, not a rewrite of an existing one.
- `plugin/skills/specify/shaping-mode.md` is 20301 bytes against a 52500-byte rail; the addition is one sentence.

## Order consumers (enumerated)

`git grep -n findNearDuplicates -- plugin` callers and how each uses result order:

- `plugin/bin/lib/issues/near-duplicate.js` `shapingRefusal` — returns the first qualifying hit in the given order. The order change can change *which* qualifying hit is named when two qualify; a qualifying hit needs title-similarity + score ≥ 2, and the AC requires every existing refusal test to stay green.
- `plugin/bin/lib/dispatch/near-dup-pairs.js` `nearDuplicatePairsAcrossGroups` — dedups pairs by sorted number key; order only changes the append order of `pairs`, and `predictedConflicts` re-sorts by group index.
- `plugin/bin/lib/dispatch/in-flight-neighbours.js` — filters by `isStrongNearDuplicate`, then sorts `nearOnly` by number; order-insensitive.
- `plugin/skills/specify/shaping-mode.md` — renders the table and appends the `**Related:**` line in finder order; this is the consumer the change is for.

Plan-audit Check B's other keyword hits are prose that names `findNearDuplicates` without stating its order — `docs/plugin-structure.md:28`, `plugin/skills/dispatch/SKILL.md:167`, `plugin/skills/dispatch/queue-pull-script.md:681` — and an archived plan (`docs/superpowers/plans/2026-10-28-fenced-heading-skip-4369.md`): no change needed.

## Review Focus

- Ties under the new key (equal `score + sharedAnchors.length`) must still order by score descending, then number ascending — pinned by the renamed existing sort test (expected `[20, 5, 30]`).
- A hit with `sharedAnchors` missing or not an array (malformed shape) must not throw in `deepOverlapHits` and must not be returned — Task 1 test `deepOverlapHits ignores malformed hits`.
- Exactly 3 shared anchors is the boundary: included; 2 is excluded — Task 1 test `deepOverlapHits includes exactly DEEP_OVERLAP_MIN anchors and excludes one fewer`.
- The refusal path must be unaffected by reordering — the existing `shapingRefusal` tests (`tests/bin-lib/issues/near-duplicate.test.js:295-342`) must pass unchanged.
- The prose pin must survive a reflow of the new sentence — wrap-tolerant (`\s+`) regex.

---

### Task 1: Depth-first sort and `deepOverlapHits`

**Files:**
- Modify: `plugin/bin/lib/issues/near-duplicate.js:150-200` (doc comment, sort at :199), `:207-216` region (new constant + helper beside `STRONG_NEAR_DUPLICATE_MIN`), `:267-280` (exports)
- Test: `tests/bin-lib/issues/near-duplicate.test.js`

**Interfaces:**
- Produces: `deepOverlapHits(hits: Array<{sharedAnchors?: string[]}>) -> Array` (same objects, finder order, `sharedAnchors.length >= DEEP_OVERLAP_MIN`); `DEEP_OVERLAP_MIN = 3`; both exported. `findNearDuplicates` return shape unchanged; only its order changes.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/issues/near-duplicate.test.js`

Add `deepOverlapHits` and `DEEP_OVERLAP_MIN` to the require block. Rename the test at :187 to `'sorting: candidates sort by score + shared anchors descending, then score, then number'`, body and expected `[20, 5, 30]` unchanged.

Add, after it:

```js
test('AC1.1: #4093/#3508 shape — a six-anchor score-1 candidate outranks four one-anchor score-2 candidates (#4701)', () => {
  const anchors = ['`parentGateState`', '`gateRow`', '`acceptanceLabeling`', '`resolvedGate`', '`plugin/bin/lib/wrap-up/engine-verify.js`', '`plugin/bin/lib/issues/acceptance.js`'];
  const subject = { number: 4093, title: 'resolved parent false-fails missing demo pending', body: `## Current State\n\n${anchors.join(' ')}\n\n### Key Files\n\n- \`a.js\` — modify\n` };
  const deep = { number: 3508, title: 'gated handling disagrees with procedure', body: `## Current State\n\n${anchors.join(' ')}\n\n### Key Files\n\n- \`q.js\` — modify\n- \`r.js\` — modify\n- \`s.js\` — modify\n` };
  const shallow = [4551, 4603, 4610, 4617].map((n) => ({ number: n, title: `unrelated work ${n} zebra`, body: '## Current State\n\nTouches `parentGateState`.\n\n### Key Files\n\n- `a.js` — modify\n' }));
  const results = findNearDuplicates(subject, [...shallow, deep]);
  assert.deepStrictEqual(results.map((r) => r.number), [3508, 4551, 4603, 4610, 4617]);
  assert.strictEqual(results[0].score, 1);
  assert.strictEqual(results[0].sharedAnchors.length, 6);
  assert.deepStrictEqual(deepOverlapHits(results).map((r) => r.number), [3508]);
});

test('deepOverlapHits includes exactly DEEP_OVERLAP_MIN anchors and excludes one fewer', () => {
  assert.strictEqual(DEEP_OVERLAP_MIN, 3);
  const three = { number: 1, sharedAnchors: ['a', 'b', 'c'] };
  const two = { number: 2, sharedAnchors: ['a', 'b'] };
  assert.deepStrictEqual(deepOverlapHits([two, three]), [three]);
});

test('deepOverlapHits ignores malformed hits', () => {
  assert.deepStrictEqual(deepOverlapHits([null, {}, { sharedAnchors: 'abc' }]), []);
  assert.deepStrictEqual(deepOverlapHits(null), []);
});
```

(The four shallow candidates each fire key-files-overlap — one shared path, subject list has one entry — and body-anchor-overlap on `parentGateState`: score 2, key 3. The deep candidate fires body-anchor-overlap only: score 1, key 7.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/near-duplicate.test.js`
Expected: FAIL — `deepOverlapHits is not a function`, and the #4093/#3508 test's order assertion fails (old sort puts 3508 last).

- [ ] **Step 3: Implement in `plugin/bin/lib/issues/near-duplicate.js`**

Sort at :199 becomes key `score + sharedAnchors.length` descending, then `score` descending, then `number` ascending. Update the :152-155 doc comment to state that order and why (a deep-anchor duplicate with a differently worded title scores 1 but is the likeliest true duplicate, #4701). Add `DEEP_OVERLAP_MIN = 3` with a calibration comment (#3417/#3419's conflicting pair shared 3 anchors; #4093/#3508 shared 6; one-anchor hits are routinely noise) and `deepOverlapHits(hits)` — filter, finder order kept, non-array input → `[]`, a hit whose `sharedAnchors` is not an array is skipped. Export both.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/near-duplicate.test.js tests/bin-lib/dispatch/near-dup-pairs.test.js tests/dispatch-near-dup-pairs-script.test.js tests/dispatch-near-dup-neighbour-prose.test.js`
Expected: PASS (all tests, including the unchanged `shapingRefusal` and `isStrongNearDuplicate` ones — AC3.1). `near-dup-pairs.test.js` asserts pair order (`:51`, `:80`); if a fixture there now orders differently, the pairs are a read-only consumer — report it rather than changing the consumer, and adjust only if the new order is the intended depth-first order.

- [ ] **Step 5: Prove discrimination by reverting the sort (AC2.1)**

Temporarily restore `results.sort((a, b) => b.score - a.score || a.number - b.number);` at the sort line, then:

Run: `node --test --test-name-pattern "AC1.1" tests/bin-lib/issues/near-duplicate.test.js`
Expected: FAIL on the order assertion (old sort puts 3508 last). Put the new sort back and re-run: PASS. Never commit the reverted line.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/issues/near-duplicate.js tests/bin-lib/issues/near-duplicate.test.js
git commit -m "Rank near-duplicate hits by shared-anchor depth — add deepOverlapHits (#4701)"
```

### Task 2: Shaping report names deep-overlap candidates

**Files:**
- Modify: `plugin/skills/specify/shaping-mode.md` (Near-duplicate candidate check paragraph, the sentence after the three-column table and its Related-append sentence)
- Test: `tests/specify-near-duplicate-prose.test.js`

**Interfaces:**
- Consumes: `deepOverlapHits`, `DEEP_OVERLAP_MIN` from Task 1.

- [ ] **Step 1: Write the failing test** in `tests/specify-near-duplicate-prose.test.js`

```js
test('shaping-mode.md names deepOverlapHits candidates as likely duplicates before stamping ready (#4701)', () => {
  const start = SHAPING_MODE.indexOf('Near-duplicate candidate check (#1944)');
  const end = SHAPING_MODE.indexOf('### Dependency-narration check', start);
  const section = SHAPING_MODE.slice(start, end);
  assert.match(section, /`deepOverlapHits`/);
  assert.match(section, /likely\s+duplicate/);
  assert.match(section, /before\s+stamping\s+`ready`/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/specify-near-duplicate-prose.test.js`
Expected: FAIL — the section does not mention `deepOverlapHits`.

- [ ] **Step 3: Add one sentence** to `plugin/skills/specify/shaping-mode.md`, as its own sentence after the Related-append sentence ending "…even when shaping proceeds normally.": name each candidate `deepOverlapHits` (`bin/lib/issues/near-duplicate.js`, at least `DEEP_OVERLAP_MIN` shared Current State anchors, #4701) returns on a line above the table as a likely duplicate with its shared-anchor count, and read that record's body before stamping `ready` — the finder ranks such a candidate first even when its score is 1. Leave the table header and every existing sentence unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/specify-near-duplicate-prose.test.js tests/bin-lib/issues/near-duplicate.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/shaping-mode.md tests/specify-near-duplicate-prose.test.js
git commit -m "Name deep-overlap near-duplicates in the shaping report (#4701)"
```
