# Share one close-marker heading test (#4802) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every local-files reader of the below-floor close heading uses the one exported `HEADING_LINE_RE`, so a changed heading cannot silently diverge.

**Architecture:** `HEADING_LINE_RE` already lives in, and is exported from, `plugin/bin/lib/issues/parent-gate.js` (moved there by #4603). The record's premise that it is unexported in `below-floor-parent-close.js` no longer holds, so the two prose fences require it from its owner and `below-floor-parent-close.js` does not change.

**Tech Stack:** Node `node --test`, `node -e` and `js` fences in skill markdown.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T055649-record-4802/work/4802-spec.md`

## Global Constraints

- No user-visible change; the regex's behavior is unchanged.
- From `skill-prose-conformance-tests`, verbatim: "Prove the assertion can go red before trusting its green: negate the prose and assert the regex *fails*, one claim per test."
- From `skill-prose-conformance-tests`, verbatim: "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`." The target test file's `read()` already does this.
- No other project skill names these files.

## Review Focus

- A local-files project has no `gh`: requiring `parent-gate.js` must not need it at load. `AC2.1: Shape 7 prints no row for a #4466-closed or below-floor local parent` runs the live fence in a temp cwd and covers this.
- `HEADING_LINE_RE` carries `/m` and no `/g`, so `.test()` keeps no `lastIndex` across parents. Stated, needs no test.

---

### Task 1: Point both local-files fences at the exported regex

**Role:** transcription

**Files:**
- Modify: `plugin/skills/tidy/step-1-records.md` (Shape 7 fence, line 293)
- Modify: `plugin/skills/wrap-up/verification-brief-parent-gate.md` (step 5 `js` fence, line 493; a second copy of the same literal, found by `git grep -n -F '/^## Closed below the oversight floor' -- plugin`, fix-now per `_shared/deferral-gate.md`)
- Test: `tests/closed-parent-acceptance-backstop.test.js`
- Waived `plugin/bin/lib/issues/below-floor-parent-close.js`: Key Files says modify, but the regex moved to `parent-gate.js` (premise reversal logged in `decisions.md`).

- [ ] **Step 1: Write the failing test** — add after the `AC2.1: Shape 7 prints no row…` test:

```js
// #4802: a local-files reader of the close heading requires the one exported regex. The excerpts
// are the bytes each fence carried before the change, so a green pin is proven able to go red.
const PRE_4802_SHAPE_7 = `  const { TIERS } = require('\${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
      belowFloorClose: /^## Closed below the oversight floor\\s*$/m.test(p.body || ''),`;
const PRE_4802_CLOSE = `const { readRecord, writeRecord, closeRecord } = require('\${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
  if (!/^## Closed below the oversight floor\\s*$/m.test(parentRecord.body)) {`;
const SHARED_REQUIRE = "const { HEADING_LINE_RE } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/parent-gate.js');";

function assertSharedHeadingRe(text, use) {
  assert.ok(!text.includes('/^## Closed below the oversight floor'), 'inline copy of the heading regex');
  assert.ok(text.includes(SHARED_REQUIRE), 'require of the exported regex');
  assert.ok(text.includes(use), 'the fence tests through the exported regex');
}

test('AC1.1: Shape 7 requires the exported heading regex, not a literal', () => {
  const use = "belowFloorClose: HEADING_LINE_RE.test(p.body || ''),";
  assertSharedHeadingRe(LOCAL, use);
  assert.throws(() => assertSharedHeadingRe(PRE_4802_SHAPE_7, use), /inline copy of the heading regex/);
});

test('AC1.1: the local-files close requires the exported heading regex, not a literal', () => {
  const fence = section(read('wrap-up/verification-brief-parent-gate.md'), '**5. `work-backend: local-files`**', 'A parent whose `facets.closed` is already set');
  const use = 'if (!HEADING_LINE_RE.test(parentRecord.body)) {';
  assertSharedHeadingRe(fence, use);
  assert.throws(() => assertSharedHeadingRe(PRE_4802_CLOSE, use), /inline copy of the heading regex/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/closed-parent-acceptance-backstop.test.js`
Expected: FAIL, both `AC1.1` tests with `inline copy of the heading regex`.

- [ ] **Step 3: Edit the two fences**

In `plugin/skills/tidy/step-1-records.md`, add `  const { HEADING_LINE_RE } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/parent-gate.js');` directly after the Shape 7 fence's `TIERS` require, and replace the `belowFloorClose` line with `      belowFloorClose: HEADING_LINE_RE.test(p.body || ''),`.

In `plugin/skills/wrap-up/verification-brief-parent-gate.md`'s step 5 fence, add `const { HEADING_LINE_RE } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/parent-gate.js');` directly after the `local-store.js` require, and replace the `if` line with `  if (!HEADING_LINE_RE.test(parentRecord.body)) {`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test tests/closed-parent-acceptance-backstop.test.js tests/below-floor-parent-close-conformance.test.js`
Expected: PASS, including `AC2.1: Shape 7 prints no row…`, which executes the edited fence.

Run: `grep -n "HEADING_LINE_RE\|Closed below the oversight floor" plugin/skills/tidy/step-1-records.md`
Expected: the require line and the `HEADING_LINE_RE.test` line, no regex literal (AC1.1). At base this grep printed the literal at line 293, so it can match its target.

- [ ] **Step 5: Commit**

Stage the two skill files and the test by name; message `Share the close-heading regex with the local-files fences — refs #4802`, ending with the line `Claude-Session: https://claude.ai/code/session_017vXcAcAW6mTPDrMuyrV1Ay`.

---

## Spec coverage

| Clause | Covered by |
|---|---|
| Deliverable (export and use at the local-files call site) | Task 1 Step 3; the export already exists in `parent-gate.js` |
| AC1.1 | Task 1 Steps 1 and 4 |
| AC2.1 (`npm test` passes) | `/build` Common Step 5, through `verify.js` |
