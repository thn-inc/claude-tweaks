# Governing-Skill Quote Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/claude-tweaks:build`'s plan-authoring checks require each plan to quote the governing `.claude/skills/` rules for every file it creates or modifies, and pin that check with a conformance test.

**Architecture:** `plugin/skills/build/plan-authoring-checks.md` already ends with a `**Governing-skill quote check:**` paragraph (added in #3789) that covers only a skill whose *description* names the file and has no "say why none apply" escape and no pin. Rewrite that one paragraph's first sentence in place to carry Deliverable 1's clauses, and add one new prose-conformance suite that pins it and proves it can go red.

**Tech Stack:** Markdown skill prose; `node --test` (built-in) with `tests/helpers/read-skill.js`.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T163219-record-3763/work/3763-spec.md` (record #3763)

## Global Constraints

- The edited file must stay at or under `RAIL_BYTES` (52,500 B, `plugin/bin/lib/skill-audit/budgets.js`). Base is 52,330 B (`wc -c` at `ef979662e`); the replacement paragraph below brings it to 52,385 B, leaving 115 B headroom. Do not add any other prose to this file.
- Only the paragraph beginning `**Governing-skill quote check:**` changes; every other paragraph of `plan-authoring-checks.md` stays byte-identical.
- Governing project skills for this plan's files (Governing-skill quote check, dogfooded). `tests/plan-authoring-governing-skill-quote-prose.test.js` is governed by `.claude/skills/skill-prose-conformance-tests/SKILL.md` (its description: "Use when adding or changing a `node --test` suite that pins the prose in `plugin/skills/**/*.md`"). Its applicable rules, verbatim:
  - "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
  - "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** — `assert.throws(() => assertBlock(mutated), { message }, …)` — preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
  - "Write the assertion as a predicate that returns the facts whose pattern no longer matches (`missingFactsOf(patterns)`), and assert it returns `[]` on the live region. Then, per pattern, strip only that pattern's match from the live text and assert the same predicate returns exactly `[fact]`."
  - "When the assertion and the prose it pins are authored in the same change — a plan that inserts both, a build that writes the test before the edit lands — copy the pinned literal out of the edit's own replacement text, never from memory of what that edit says."
  - "Assert `end !== -1` before slicing, or for the `split` form that `split(end)` yields more than one element. When \"rest of file\" is a deliberate fallback, such as a section helper whose last section has no following heading, write that branch out explicitly (`next === -1 ? rest : …`)."
  - "`tests/foreground-execution-instruction.test.js` (#1965) replaced that shape with a blank-line paragraph split (`text.split(/\r?\n\r?\n/)`) filtered on the anchor, guarded by an exact removed-paragraph count (`paragraphs.length - kept.length === 2`) rather than a same-string inequality"
  - Anti-pattern: "Proving a prose pin discriminates by mutating the tree (revert the fix, delete the pinned sentence) and re-running" — all mutation happens on in-memory strings.
- `plugin/skills/build/plan-authoring-checks.md`: no project skill governs it — `git grep -n "plan-authoring-checks" -- .claude/skills` prints nothing, and the descriptions of the four skills whose body mentions prose conformance (`bin-source-scan-conformance`, `code-health-focus-vertical`, `prose-code-twin-pin`, `run-directory-fact-packs`) name `plugin/bin/**/*.js` scans, `/code-health` verticals, prose/code table twins, and fact packs — none covers a plan-authoring check paragraph.
- Commit messages: `{Verb} {what} — {detail}` style, and reference the record as `refs #3763` — never `closes`/`fixes`.

## Review Focus

- The paragraph is the file's last one: the test's paragraph slicer must treat a missing `\n\n` terminator as "rest of file" deliberately, not by accident (covered: `paragraph()`'s explicit `end === -1` branch).
- A fact that also occurs earlier in the file would let a non-global `replace` strip the wrong copy: the per-fact control strips inside the paragraph only (covered by Task 1's third test).
- A CRLF checkout must read the same: the read goes through `readText()` (covered by the Global Constraint above).
- The paragraph lead appearing twice would let one copy satisfy the pin: `paragraph()` asserts the lead occurs exactly once.
- The rewrite must not push the file over `RAIL_BYTES`: covered by the existing `rail:` suites in `npm test` (Task 1 Step 5).

---

### Task 1: Rewrite the governing-skill quote check and pin it

**Role:** transcription

**Files:**
- Modify: `plugin/skills/build/plan-authoring-checks.md:101` (the `**Governing-skill quote check:**` paragraph, the file's last)
- Create: `tests/plan-authoring-governing-skill-quote-prose.test.js`

**Interfaces:**
- Consumes: `readText(absPath)` from `tests/helpers/read-skill.js`
- Produces: nothing other tasks use

- [ ] **Step 1: Write the failing test** — create `tests/plan-authoring-governing-skill-quote-prose.test.js` with exactly this content:

```js
'use strict';
// The governing-skill quote check: a plan quotes the project-skill rules that govern its files (#3763, after #3712).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const CHECKS = readText(path.join(__dirname, '..', 'plugin/skills/build/plan-authoring-checks.md'));
const LEAD = '**Governing-skill quote check:**';
const FACTS = [
  '`.claude/skills/`',
  'for each file the plan creates or modifies',
  'whose description or body names that file or its module',
  "quote their applicable rule bullets verbatim into the plan's Global Constraints",
  'or say there why none apply',
  '#3712',
];

// The paragraph runs from its lead to the next blank line; it may be the file's
// last paragraph, so a missing terminator deliberately means "rest of file".
function paragraph(text) {
  const start = text.indexOf(LEAD);
  assert.ok(start >= 0, `missing lead: ${LEAD}`);
  assert.equal(text.indexOf(LEAD, start + 1), -1, `lead appears more than once: ${LEAD}`);
  const end = text.indexOf('\n\n', start);
  return end === -1 ? text.slice(start) : text.slice(start, end);
}

function missingFacts(text) {
  const p = paragraph(text);
  return FACTS.filter((fact) => !p.includes(fact));
}

test('AC1.1 (#3763): plan-authoring-checks.md carries the governing-skill quote check', () => {
  assert.deepEqual(missingFacts(CHECKS), []);
});

test('AC2.1 (#3763): the pin goes red when the check paragraph is removed', () => {
  const paragraphs = CHECKS.split(/\n\n/);
  const kept = paragraphs.filter((p) => !p.startsWith(LEAD));
  assert.equal(paragraphs.length - kept.length, 1, 'exactly one paragraph must carry the lead');
  const removed = kept.join('\n\n');
  assert.notEqual(removed, CHECKS);
  assert.throws(() => missingFacts(removed), { message: /missing lead/ });
});

test('AC2.1 (#3763): each fact goes red on its own when stripped', () => {
  const live = paragraph(CHECKS);
  for (const fact of FACTS) {
    const mutated = CHECKS.replace(live, live.replace(fact, ''));
    assert.notEqual(mutated, CHECKS, `fact not found to strip: ${fact}`);
    assert.deepEqual(missingFacts(mutated), [fact]);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plan-authoring-governing-skill-quote-prose.test.js`
Expected: FAIL — `# pass 1`, `# fail 2` (AC1.1 and the per-fact test fail against the old paragraph; the paragraph-removal test passes because the old paragraph still carries the lead).

- [ ] **Step 3: Replace the paragraph's first sentence** in `plugin/skills/build/plan-authoring-checks.md`. Replace exactly:

`**Governing-skill quote check:** when a plan touches a file that a project skill governs — a `.claude/skills/*/SKILL.md` whose description names that file — quote the skill's applicable rules verbatim into the plan's Global Constraints, never a paraphrase.`

with exactly:

`**Governing-skill quote check:** for each file the plan creates or modifies, find the project skills under `.claude/skills/` whose description or body names that file or its module, and quote their applicable rule bullets verbatim into the plan's Global Constraints, never a paraphrase, or say there why none apply.`

The rest of the paragraph (from `A dispatched implementer sees only its brief` to `three new tests.`) is unchanged.

- [ ] **Step 4: Run test to verify it passes, and measure the file**

Run: `node --test tests/plan-authoring-governing-skill-quote-prose.test.js`
Expected: PASS — `# pass 3`, `# fail 0`.

Run: `wc -c plugin/skills/build/plan-authoring-checks.md`
Expected: `52385` (at or under `RAIL_BYTES` 52,500).

- [ ] **Step 5: Run the suites that read this file**

Run: `node --test tests/plan-authoring-inserted-guard-reprove-prose.test.js tests/ceremony-profile-roster.test.js tests/plan-task-markers-conformance.test.js tests/plan-audit-check-f-prose.test.js`
Expected: PASS, `# fail 0`.

Waived AC3.1: `npm test` passing is /build's Common Step 5 full-suite verification, not a task test step.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/build/plan-authoring-checks.md tests/plan-authoring-governing-skill-quote-prose.test.js
git commit -m "Widen the governing-skill quote check and pin it — refs #3763"
```

## Verification notes (plan authoring)

- Inline self-consistency (plan-authoring-checks' check): the Step 1 test was run in a scratch tree against the Step 3 replacement — `# pass 3 # fail 0`; against the base paragraph — `# pass 1 # fail 2` (AC1.1 and per-fact fail); with the paragraph removed — `# pass 0 # fail 3`. Edited file measured at 52,385 B.
- Moved-prose pin check: `git grep -n -F -e "applicable rules verbatim" -e "a project skill governs" -e "never a paraphrase" -- tests plugin docs` hits only line 101 itself — no existing pin to re-point.
