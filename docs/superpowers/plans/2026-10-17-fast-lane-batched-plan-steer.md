# Fast-lane Batched-Plan Steer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Steer plan authors to write a `ceremony: fast-lane` + `size: low` all-transcription plan as one batch, so it pays one implementer and one batch review plus the whole-branch review.

**Architecture:** Prose-only behavior change in `plugin/skills/build/plan-authoring-checks.md`'s Batched-plan marker paragraph, pinned by a prose conformance test (with a doctored-text go-red proof) in `tests/ceremony-profile-roster.test.js`, plus two characterization tests in `tests/bin-lib/plan-audit/parser.test.js` that pin the two-line header layout `countTasks` must read as batched. No code changes: `countTasks` already reads the marker correctly.

**Tech Stack:** Markdown skill prose; Node `node --test` (built-in `node:test` + `node:assert`).

**Spec:** `.claude-tweaks/pipelines/2026-10-17T194004-record-3123/work/3123-spec.md`

## Global Constraints

- Do not touch `plugin/skills/build/dispatch.md` (its skip condition) or anything pinned against SDD's per-task loop — `tools/upstream-drift/manifest.yml` pins SDD's `## Final Review` against `dispatch.md`.
- Do not modify `plugin/bin/lib/plan-audit/parser.js` — `countTasks` already reads the marker as the exact line `^\*\*Execution:\*\*\s*batched\s*$` in the header.
- The batch-instruction literal used in prose and tests is exactly: `**Batch:** send every task to one implementer as a single brief; review the combined diff once.`
- The new prose stays on the **same line** as the existing Batched-plan marker paragraph (which carries ``roster tag `sdd-whole-branch-review` ``): `tests/ceremony-profile-roster.test.js`'s AC5 test fails any skill line pairing `fast-lane` with `skip` that carries no roster tag.
- Commit messages use `{Verb} {what} — {detail}` and write `refs #3123`, never `closes`/`fixes`.
- Never run `git stash` / `git stash pop`.

## Review Focus

1. Instruction appended to the marker line (`**Execution:** batched — send every task…`) — must read `batched: false`; pinned by Task 1's negative case (AC2.1).
2. Instruction line placed directly after the marker line with no blank line — must still read `batched: true`; Task 1's positive fixture uses exactly that adjacency (AC1.1).
3. The new prose wording drifting so it no longer names the inlines-full-code condition (the only thing distinguishing a transcription plan from an ordinary small plan) — pinned by Task 2's prose assertion and its go-red proof (AC3.1, AC4.1).
4. A future edit splitting the paragraph onto a second line that mentions `fast-lane` and a skip without the roster tag — caught by the existing AC5 roster test, which Task 2 runs.
5. The existing `dispatch.md` batched-keeps-review assertion regressing — Task 2 runs the whole roster test file, which contains it (AC5.1).

---

### Task 1: Pin the two-line batched header layout in `countTasks`

Characterization tests only: `countTasks` already behaves this way; these pin it so the layout the new prose prescribes cannot silently break.

**Files:**
- Test: `tests/bin-lib/plan-audit/parser.test.js` (append after the existing `countTasks ignores an **Execution:** batched line inside a fenced code block` test, before the `// ── #3099 Check E` comment)

**Interfaces:**
- Consumes: `countTasks(text: string) -> { tasks: number, batched: boolean }` from `plugin/bin/lib/plan-audit/parser.js` (already imported at the top of the test file).
- Produces: nothing consumed by Task 2.

- [ ] **Step 1: Append the two tests**

```js
test('AC1.1: countTasks reads the marker plus a separate batch-instruction line as batched (#3123)', () => {
  const text = [
    '# Plan', '',
    '**Execution:** batched',
    '**Batch:** send every task to one implementer as a single brief; review the combined diff once.',
    '',
    '### Task 1: A', '', '### Task 2: B', '', '### Task 3: C', '', '### Task 4: D', '',
  ].join('\n');
  assert.deepStrictEqual(countTasks(text), { tasks: 4, batched: true });
});

test('AC2.1: an instruction appended to the marker line reads batched: false — the two lines must stay separate (#3123)', () => {
  // The marker regex anchors at end of line; trailing text silently drops the marker.
  const text = [
    '# Plan', '',
    '**Execution:** batched — send every task to one implementer as a single brief; review the combined diff once.',
    '',
    '### Task 1: A', '', '### Task 2: B', '', '### Task 3: C', '', '### Task 4: D', '',
  ].join('\n');
  assert.deepStrictEqual(countTasks(text), { tasks: 4, batched: false });
});
```

- [ ] **Step 2: Run the parser suite**

Run: `node --test tests/bin-lib/plan-audit/parser.test.js`
Expected: PASS (characterization — `countTasks` already handles both layouts)

- [ ] **Step 3: Prove the negative case can go red**

With the Edit tool, temporarily change `/^\*\*Execution:\*\*\s*batched\s*$/m` in `plugin/bin/lib/plan-audit/parser.js` to `/^\*\*Execution:\*\*\s*batched/m` (drop the end anchor).
Run: `node --test tests/bin-lib/plan-audit/parser.test.js`
Expected: FAIL, naming the `AC2.1:` test only.
Then revert the edit with the Edit tool and run `git diff --stat plugin/bin/lib/plan-audit/parser.js` — Expected: empty output. Quote both test outputs in the task report.

- [ ] **Step 4: Commit**

```bash
git add tests/bin-lib/plan-audit/parser.test.js
git commit -m "Pin two-line batched plan header in countTasks tests — refs #3123"
```

### Task 2: Steer fast-lane transcription plans to the batched marker

**Files:**
- Modify: `plugin/skills/build/plan-authoring-checks.md:19` (the `**Batched-plan marker.**` paragraph — one line)
- Test: `tests/ceremony-profile-roster.test.js` (append two tests at end of file)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `batchedFastLaneGuidanceProblems(paragraph: string) -> string[]` — a test-file-local helper returning the list of missing required phrases (empty array = conforms).

- [ ] **Step 1: Append the helper and two tests to `tests/ceremony-profile-roster.test.js`**

```js
// #3123: the Batched-plan marker paragraph steers fast-lane transcription plans to one batch.
const PLAN_CHECKS = path.join(SKILLS, 'build', 'plan-authoring-checks.md');
const INLINES_FULL_CODE = /every task inlines its complete code/;
function batchedMarkerParagraph(text) {
  const line = text.split('\n').find((l) => l.startsWith('**Batched-plan marker.**'));
  assert.ok(line, 'plan-authoring-checks.md lacks the **Batched-plan marker.** paragraph');
  return line;
}
function batchedFastLaneGuidanceProblems(paragraph) {
  const problems = [];
  if (!paragraph.includes('`ceremony: fast-lane`')) problems.push('`ceremony: fast-lane`');
  if (!paragraph.includes('`size: low`')) problems.push('`size: low`');
  if (!INLINES_FULL_CODE.test(paragraph)) problems.push('inlines-full-code condition');
  return problems;
}

test('AC3.1: the Batched-plan marker paragraph names ceremony: fast-lane, size: low, and the inlines-full-code condition (#3123)', () => {
  const paragraph = batchedMarkerParagraph(fs.readFileSync(PLAN_CHECKS, 'utf8'));
  assert.deepStrictEqual(batchedFastLaneGuidanceProblems(paragraph), []);
});

test('AC4.1: the guidance assertion goes red when the inlines-full-code condition is removed (doctored-text proof, #3123)', () => {
  const paragraph = batchedMarkerParagraph(fs.readFileSync(PLAN_CHECKS, 'utf8'));
  const doctored = paragraph.replace(INLINES_FULL_CODE, 'every task is small');
  assert.notStrictEqual(doctored, paragraph, 'doctoring found no condition text to remove — anchor text not found');
  assert.deepStrictEqual(batchedFastLaneGuidanceProblems(doctored), ['inlines-full-code condition']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/ceremony-profile-roster.test.js`
Expected: FAIL after Step 1 appends the new cases — `AC3.1:` fails (paragraph lacks all three phrases) and `AC4.1:` fails on the `notStrictEqual` anchor assertion.

- [ ] **Step 3: Extend the paragraph in `plugin/skills/build/plan-authoring-checks.md`**

Append this text to the end of the existing `**Batched-plan marker.**` line (same line — one space after its final period; do not change the existing sentences):

```
A `ceremony: fast-lane` + `size: low` plan in which every task inlines its complete code — pure transcription, no judgment left to the implementer — is written as one batch even when its tasks differ in shape (#3123): put `**Execution:** batched` on its own header line, and add a separate plain header line telling the executor to send every task to one implementer as a single brief and review the combined diff once, which is SDD's own batch rule — `**Batch:** send every task to one implementer as a single brief; review the combined diff once.` Never append that instruction to the marker line: the marker match is anchored at end of line, so any trailing text silently reads as `batched: false`. The marker alone does not make SDD batch — it only keeps the whole-branch review — so the instruction line is what saves the per-task dispatches; the result is one implementer, one batch review, and the whole-branch review kept as the gate. A plan where any task leaves code for the implementer to write, or where a task needs its own tests or review surface, stays per-task (SDD's "Reserve one-dispatch-per-task").
```

Note the phrase must read `every task inlines its complete code` verbatim (the test's anchor).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/ceremony-profile-roster.test.js`
Expected: PASS — all tests, including the pre-existing AC5 unrostered-skip-lines test and the `batched plans (\`batched: true\`, regardless of count) keep the whole-branch review` assertion (AC5.1).

- [ ] **Step 5: Confirm `dispatch.md` is untouched (AC5.2) and the file stays under the rail**

Run: `git diff --stat main...HEAD -- plugin/skills/build/dispatch.md`
Expected: empty output.
Run: `wc -c plugin/skills/build/plan-authoring-checks.md`
Expected: under 52500 (RAIL_BYTES; ~35,000 after this edit).

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/build/plan-authoring-checks.md tests/ceremony-profile-roster.test.js
git commit -m "Steer fast-lane transcription plans to the batched marker — refs #3123"
```

Waived AC5.2: an unchanged-file claim is verified by Task 2 Step 5's `git diff --stat`, not a committed test.
Waived AC6.1: `npm test` is run centrally by /build Common Step 5, not inside either task.

## Deviations recorded at /build Common Step 4.5

- Beneficial: Task 2 Step 3 prose said "which is SDD's own batch rule"; as built it reads "extending SDD's batch rule to transcription-only plans" — SDD's rule is scoped to same-shape work, so the original overclaimed (final whole-branch review Minor, fix commit 1275defa7).
- Beneficial: `batchedFastLaneGuidanceProblems` also pins the `**Batch:**` instruction literal and the `stays per-task` exclusion, beyond AC3.1's three phrases — guards the spec's Gotcha 2 (dropping the instruction line). Fix commit 1275defa7.
- Beneficial: test fixtures share a `FOUR_TASKS` list and read the skill file via the suite's EOL-normalizing `readText` (simplify commit 61ce12d67).
