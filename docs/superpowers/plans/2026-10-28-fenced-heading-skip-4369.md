# Fenced-Heading Skip in Merge Gate and Near-Duplicate Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `mergeStateDemands` and `extractCurrentStateAnchors` treat heading lines inside fenced code blocks as content, never as section boundaries.

**Architecture:** Both readers mark fenced line indexes with the shared `fencedLineRanges(lines)` helper from `plugin/bin/lib/issues/record-payload.js` (the same fence rule `extractSection` uses since #4169) and skip a heading test on any fenced line. Fenced lines still count as section content; only their heading role is removed.

**Tech Stack:** Node.js CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T192900-record-4369/work/4369-spec.md`

## Global Constraints

- Use the shared `fencedLineRanges` (`plugin/bin/lib/issues/record-payload.js`) — never a second fence regex.
- Touch only `mergeStateDemands` and `extractCurrentStateAnchors` and their suites; no other readers, no reformatting.
- `npm test` passes.

## Review Focus

- An unclosed fence: every line from the opener to the end of the body is fenced (the helper's documented "safer direction"), so a later real heading does not toggle the section. Accepted shared semantics, same as `extractSection`; not separately tested.
- CRLF bodies: `mergeStateDemands` splits on `/\r?\n/`; `fencedLineRanges`'s closer regex tolerates trailing whitespace, so a `\r`-terminated closer still closes. The existing CRLF test in `merge-gate.test.js` keeps passing.
- A fenced `## Current State` line must not start the Current State section for `extractCurrentStateAnchors` (covered in Task 2).
- `record-payload.js` requires only `node:path` and `./record-vocabulary`, so neither new `require` creates a cycle.
- Consumer enumeration: no caller's contract changes (both functions keep their return shapes), so `planMergeGateSplit`, `findNearDuplicates` and `multispec-merge-gate.md`'s "inside the target's `## Deliverables` or `## Prerequisites` section" prose all stay correct as written. No change.

---

### Task 1: `mergeStateDemands` skips fenced heading lines

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/preflight-records/merge-gate.js` (`mergeStateDemands`, ~lines 32-46; add require)
- Test: `tests/bin-lib/preflight-records/merge-gate.test.js`

**Interfaces:**
- Consumes: `fencedLineRanges(lines: string[]) -> Array<[start, end]>` (inclusive line-index ranges) from `../issues/record-payload`.
- Produces: `mergeStateDemands(body, candidates, re)` unchanged signature and return shape.

- [ ] **Step 1: Write the failing tests** (append to `merge-gate.test.js`)

```js
test('AC1.1: mergeStateDemands finds a demand after a fenced ## line inside Deliverables (#4369)', () => {
  const body = ['## Deliverables', '```markdown', '## not heading', '```',
    '- [ ] confirm `#10` is actually merged'].join('\n');
  assert.deepEqual(mergeStateDemands(body, [10]).map((d) => d.requires), [10]);
});

test('AC2.1: a fenced ## Prerequisites line does not open a Prerequisites section (#4369)', () => {
  const body = ['## Current State', '~~~', '## Prerequisites', '~~~',
    '- #10 is actually merged'].join('\n');
  assert.deepEqual(mergeStateDemands(body, [10]), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/preflight-records/merge-gate.test.js`
Expected: FAIL — AC1.1 returns `[]`, AC2.1 returns one demand.

- [ ] **Step 3: Implement** — in `mergeStateDemands`, split the body into `lines` once, build a `fenced` boolean array from `fencedLineRanges(lines)`, and apply the `H2_RE` toggle only when `!fenced[i]`. A fenced line otherwise falls through to the existing in-section demand test unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/preflight-records/merge-gate.test.js`
Expected: PASS (all tests, including the existing CRLF one)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/preflight-records/merge-gate.js tests/bin-lib/preflight-records/merge-gate.test.js
git commit -m "Skip fenced headings in mergeStateDemands — refs #4369"
```

### Task 2: `extractCurrentStateAnchors` skips fenced heading lines

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/near-duplicate.js` (`extractCurrentStateAnchors`, ~lines 119-133; add require)
- Test: `tests/bin-lib/issues/near-duplicate.test.js`

**Interfaces:**
- Consumes: `fencedLineRanges` from `./record-payload`.
- Produces: `extractCurrentStateAnchors(body) -> Set<string>` unchanged.

- [ ] **Step 1: Write the failing tests** (append after the `#3141` anchor tests)

```js
test('AC3.1: extractCurrentStateAnchors keeps anchors after a fenced # comment line inside Current State (#4369)', () => {
  const body = '## Current State\n\n`alpha.js`\n```bash\n# comment\nrun it\n```\n`beta.js`\n\n## Deliverables\n`gamma.js`\n';
  assert.deepStrictEqual([...extractCurrentStateAnchors(body)].sort(), ['alpha.js', 'beta.js']);
});

test('extractCurrentStateAnchors: a fenced ## Current State line does not start the section (#4369)', () => {
  const body = '## Summary\n```\n## Current State\n`fake.js`\n```\n';
  assert.deepStrictEqual([...extractCurrentStateAnchors(body)], []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/near-duplicate.test.js`
Expected: FAIL — AC3.1 returns `['alpha.js']`, the second returns `['fake.js']`.

- [ ] **Step 3: Implement** — build a `fenced` boolean array from `fencedLineRanges(lines)`; the `CURRENT_STATE_HEADING_RE` `findIndex` and the `ANY_HEADING_RE` break both require `!fenced[idx]`. Backtick-span collection on every in-section line is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/near-duplicate.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/near-duplicate.js tests/bin-lib/issues/near-duplicate.test.js
git commit -m "Skip fenced headings in extractCurrentStateAnchors — refs #4369"
```

Waived AC4.1: `npm test` passing is proven by `/build` Common Step 5's verification run, not a task step.
