# PR-Checklist Canonical Phase Rows (#2877) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PR-early body composer always emit all five canonical phase rows, unchecked and in order, regardless of the opening `/flow` call's step list — and pin it with a test.

**Architecture:** `plugin/bin/lib/flow/pr-body.js` (#2997) already owns the PR-early body template. Its `composePhasesBlock(phases)` narrows the checklist to any list it is handed, and both `composePrEarlyBody` and `repairPrBody` forward an optional `phases` — the exact mechanism #2749's two-call dispatch split drifted through. No caller passes it today. Remove the override so the canonical list is the only list, then pin the in-span shape with a test that tries to narrow it.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T204042-record-2877/work/2877-spec.md` (materialized from GitHub issue #2877)

## Global Constraints

- The canonical phase rows are exactly `build`, `test`, `review`, `polish`, `wrap-up`, in that order, each `- [ ] {phase}`.
- Commit messages: `{Verb} {what} — {detail}`, body `Refs #2877` (never Fixes/Closes in a commit).

## Review Focus

- A caller passing `phases: ['build', 'test']` (a step-list-scoped first call) still gets all five rows — covered by Task 1's new compose test.
- `repairPrBody` restoring a missing phases block emits the same five rows, never a narrowed set — covered by Task 1's new repair test.
- Rows appear inside the phases span, in order, with nothing else between the plain-text delimiters — asserted on the extracted span, not anywhere in the body.
- Existing callers (`plugin/bin/compose-pr-body.js`, `tests/compose-pr-body-cli.test.js`, `tests/pr-early-run-lifecycle.test.js`'s byte-identical "Composed shape" fence test) keep passing unchanged — Task 1 Step 4 runs all three suites.
- None further: the module has no other consumers (`git grep -n "DEFAULT_PHASES\|composePhasesBlock" -- plugin tests` finds only pr-body.js itself).

---

### Task 1: Canonical-only phase rows in the PR-early composer

**Files:**
- Modify: `plugin/bin/lib/flow/pr-body.js:9,22-31,49-55,128-136,148,162`
- Modify: `plugin/skills/_shared/pr-early-run-lifecycle.md:284-285`
- Test: `tests/bin-lib/flow/pr-body.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `CANONICAL_PHASES` (exported array, replaces `DEFAULT_PHASES`); `composePhasesBlock()` (no parameters); `composePrEarlyBody({ runId, specSummary, target, nextStep, fixesLines, runDir })`; `repairPrBody({ body, runId, fixesLines })`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/flow/pr-body.test.js`, after the existing `'composePrEarlyBody defaults the phase checklist to the canonical five phases, all unchecked'` test:

```js
// #2877: the rows between the plain-text phase delimiters, as an array of lines.
function phaseRows(body) {
  const match = body.match(/\[claude-tweaks-phases-start\]\n([\s\S]*?)\n\[claude-tweaks-phases-end\]/);
  assert.ok(match, 'phases span present');
  return match[1].split('\n');
}

const CANONICAL_ROWS = ['- [ ] build', '- [ ] test', '- [ ] review', '- [ ] polish', '- [ ] wrap-up'];

test('#2877: a build,test-scoped first call still starts all five phase rows, unchecked, in order', () => {
  const body = composePrEarlyBody({
    runId: 'r1', specSummary: 's', target: '#2749', nextStep: 'build',
    fixesLines: ['Fixes #2749'], phases: ['build', 'test'],
  });
  assert.deepEqual(phaseRows(body), CANONICAL_ROWS);
});

test('#2877: repairPrBody restores the canonical five rows even when handed a narrower list', () => {
  const { body, restored } = repairPrBody({
    body: 'Freeform body with no markers.', runId: 'r1', fixesLines: ['Fixes #2749'], phases: ['build', 'test'],
  });
  assert.ok(restored.includes('phases block'));
  assert.deepEqual(phaseRows(body), CANONICAL_ROWS);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/pr-body.test.js`
Expected: FAIL — both `#2877` tests report a `deepEqual` mismatch (`['- [ ] build', '- [ ] test']` vs the five canonical rows).

- [ ] **Step 3: Implement**

In `plugin/bin/lib/flow/pr-body.js`:

Replace line 9:

```js
// The five canonical phase rows every PR-early body starts with, unchecked
// and in this order — never narrowed to a run's step list (#2877): a skipped
// phase's row is removed at its own would-be exit, never predicted here.
const CANONICAL_PHASES = ['build', 'test', 'review', 'polish', 'wrap-up'];
```

Replace `composePhasesBlock`:

```js
function composePhasesBlock() {
  const rows = CANONICAL_PHASES.map((p) => `- [ ] ${p}`).join('\n');
  return [
    '<!-- phases-start -->',
    '[claude-tweaks-phases-start]',
    rows,
    '[claude-tweaks-phases-end]',
    '<!-- phases-end -->',
  ].join('\n');
}
```

In the `composePrEarlyBody` comment, change `// { runId, specSummary, target, nextStep, fixesLines, phases?, runDir? } ->` to `// { runId, specSummary, target, nextStep, fixesLines, runDir? } ->`; change its signature to `function composePrEarlyBody({ runId, specSummary, target, nextStep, fixesLines, runDir }) {` and its call to `composePhasesBlock(),`.

In the `repairPrBody` comment, change `// { body, runId, fixesLines, phases? } -> { body, restored }` to `// { body, runId, fixesLines } -> { body, restored }`; change its signature to `function repairPrBody({ body, runId, fixesLines }) {` and line 148's call to `composePhasesBlock()`.

In `module.exports`, replace `DEFAULT_PHASES,` with `CANONICAL_PHASES,`.

In `plugin/skills/_shared/pr-early-run-lifecycle.md`, replace:

```
unambiguous, non-overlapping span to replace. Start every row unchecked — `- [ ] {phase}` —
even for steps this run's step-list argument will skip (e.g. `no-polish`); a skipped phase's
```

with:

```
unambiguous, non-overlapping span to replace. Start every row unchecked — `- [ ] {phase}` —
even for steps this run's step-list argument will skip (e.g. `no-polish`) — `composePrEarlyBody`
takes no phase list, so it cannot narrow them (pinned in `tests/bin-lib/flow/pr-body.test.js`,
#2877); a skipped phase's
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/pr-body.test.js tests/pr-early-run-lifecycle.test.js tests/compose-pr-body-cli.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/flow/pr-body.js plugin/skills/_shared/pr-early-run-lifecycle.md tests/bin-lib/flow/pr-body.test.js
git commit -m "Pin the PR-early checklist to the five canonical phase rows — drop the narrowing phases override" -m "Refs #2877"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (deterministic composer + test pinning all five rows regardless of step list) → Task 1 Steps 1-3. The Acceptance Criterion (test simulating a `build,test`-scoped first call, asserting the phases span holds `review`/`polish`/`wrap-up` alongside `build`/`test`, unchecked, in order) → Step 1's first test. Deliverable 2 is the documented alternative to Deliverable 1, not required alongside it.
- **Placeholders:** none.
- **Type consistency:** `CANONICAL_PHASES`, `composePhasesBlock()`, `composePrEarlyBody`, `repairPrBody` match across steps and the Interfaces block.
