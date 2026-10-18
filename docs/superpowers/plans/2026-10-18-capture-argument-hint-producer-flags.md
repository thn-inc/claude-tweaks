# Capture argument-hint / Input reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the rule that a flag documented in a skill's `## Input` table may be left out of `argument-hint` only when its row marks it `(producer-only)` or `(deprecated alias)`. Apply that rule to `capture` (and to `routine`, the one other skill it trips), and enforce it mechanically.

**Architecture:** `argument-hint` is the human-facing placeholder grammar. Flags that only another skill passes stay out of it. They are documented in `## Input` with a marker in the row's first cell, the same way `dispatch` already marks its deprecated aliases. `tests/argument-hint-input.test.js` gains the missing Input-table→hint direction, with those two markers as the only exemptions. A twin pin keeps `docs/skill-authoring.md` naming the same marker literals the test reads.

**Tech Stack:** Markdown skill files, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T215839-record-2964/work/2964-spec.md` (record #2964)

Scope keywords: producer-only

## Decision (Deliverable 1)

Producer-only flags stay **out** of `argument-hint`. Corpus evidence, measured at f49277005 with a scratch scan over every skill's `## Input` table first cells:

- `capture`: `--defer-reason`, `--risk`, `--size`, `--origin` missing from the hint. `--source` is not in its `## Input` table at all; it is documented only in the Component-Skill Contract.
- `dispatch`: `--batch-size`, `--concurrent` missing — both rows already carry `(deprecated alias)` outside the code span.
- `routine`: `--source` missing — the same producer-only shape as capture's (`/claude-tweaks:init` passes it).
- No other skill has a gap.

The corpus already follows "humans' grammar in the hint, producer/legacy flags only in `## Input`" in two other skills. The hint is cosmetic placeholder text shown to a person typing the command (`docs/skill-authoring.md` line 128), so flags no person types are noise there. Adding the five flags would make capture's hint the longest in the corpus, and it would also force every reference-card mirror to grow. So the hint is unchanged, and no row of the Argument-hint mirror surfaces table moves. Mirror-surface enumeration check: hint string unchanged, so `tests/argument-hint-mirrors.test.js` has nothing new to compare.

## Global Constraints

- Marker literals, exact: `(producer-only)` and `(deprecated alias)` — written in the row's **first** cell, after the code span (dispatch's existing shape: `` | `--batch-size <n>` (deprecated alias) | ``).
- `capture`'s and `routine`'s `argument-hint` values stay byte-identical (no mirror-surface edits).
- Commit messages: `{Verb} {what} — {detail}`, body `refs #2964` (never `closes`/`fixes`), ending with `Claude-Session: https://claude.ai/code/session_01LorZjWFhoYsaWumVTd96Gp`.
- Rail: `plugin/skills/capture/SKILL.md` is 40,663 B and `plugin/skills/routine/SKILL.md` is 19,654 B, against `RAIL_BYTES` 52,500. No per-file pin binds either (grep of `tests/` for byteLength/wc -c next to either path: none).

## Review Focus

1. Escaped `\|` inside a first cell (capture's `` `--risk=<low\|medium\|high>` / `--size=<low\|medium\|high>` `` row): a naive `split('|')` cuts the cell and drops `--size`. Pinned by Task 2's go-red control, which expects `--size` in its exact list.
2. A marker written in the description cell, not the first cell, must not exempt the row. Pinned by Task 2's `marker outside the first cell does not exempt` test.
3. Prefix collisions: `--batch` in a hint must not count as covering `--batch-size`. Match the flag with a trailing boundary `(?![a-z0-9-])`. Pinned by Task 2's `prefix flag in hint does not cover a longer flag` test.
4. Table rows outside `## Input` (e.g. a Workflow table naming `--route`) are out of scope — scoped by `inputSectionBody`. No new test is needed: the existing helper already bounds it.
5. Header and separator rows (`| Argument | Behavior |`, `|---|---|`) carry no `--` token, so they yield nothing. No test is needed.

---

### Task 1: Record the rule in `docs/skill-authoring.md`, twin-pinned to the test's markers

**Files:**
- Modify: `docs/skill-authoring.md` (line 31's last sentence; line 128's `argument-hint` bullet)
- Test: `tests/argument-hint-input.test.js`

**Interfaces:**
- Produces: `const EXEMPT_MARKERS = ['(producer-only)', '(deprecated alias)'];` at module scope in `tests/argument-hint-input.test.js` (Task 2 reads it).

- [ ] **Step 1: Write the failing test** — append to `tests/argument-hint-input.test.js`, declaring `EXEMPT_MARKERS` above it:

```js
test('AC2.1: docs/skill-authoring.md argument-hint bullet names every exemption marker', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'skill-authoring.md'), 'utf8');
  const bullet = doc.split('\n').find((l) => l.startsWith('- **`argument-hint`**'));
  assert.ok(bullet, 'argument-hint bullet not found');
  for (const marker of EXEMPT_MARKERS) {
    assert.ok(bullet.includes('`' + marker + '`'), `bullet does not name ${marker}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/argument-hint-input.test.js`
Expected: FAIL with "bullet does not name (producer-only)"

- [ ] **Step 3: Edit `docs/skill-authoring.md`**

In the `argument-hint` bullet (line 128), right after "Derive the hint directly from the skill's own `## Input` section — same bracket/pipe convention as `.claude/commands/*.md`: `[optional]`, `<required>`, `a|b` for alternatives.", insert:

> The hint is the grammar a person types, so it carries every flag `## Input` documents except two kinds. A flag only another skill passes (a producer's Capture route, a parent skill naming itself) is marked `(producer-only)`. A retired spelling is marked `(deprecated alias)`. Either marker goes in the first cell of that flag's `## Input` table row, after the code span, and such a flag stays out of the hint and its mirrors. `tests/argument-hint-input.test.js` checks this direction too, reading every `--flag` from each table row's first cell.

In line 31, replace "`tests/argument-hint-input.test.js` separately checks that the section documents every bracketed leaf of the hint." with "`tests/argument-hint-input.test.js` separately checks both directions between the hint and that section: every bracketed leaf of the hint is documented there, and every `--flag` its table documents is in the hint unless the row is marked (the `argument-hint` bullet under Frontmatter conventions)."

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/argument-hint-input.test.js`
Expected: PASS (all tests, `ℹ fail 0`)

- [ ] **Step 5: Commit**

```bash
git add docs/skill-authoring.md tests/argument-hint-input.test.js
git commit -m "Record the producer-only argument-hint exemption — markers pinned to the test"
```

### Task 2: Input-table→hint check; mark capture's and routine's producer-only rows

**Files:**
- Modify: `tests/argument-hint-input.test.js` (header comment's direction description; new function and tests)
- Modify: `plugin/skills/capture/SKILL.md` (`## Input` table rows for `--defer-reason=`, `--risk=`/`--size=`, `--origin=`; new `--source` row)
- Modify: `plugin/skills/routine/SKILL.md:48` (`--source` row)

**Interfaces:**
- Consumes: `EXEMPT_MARKERS` (Task 1); `extractArgumentHint`, `inputSectionBody` (existing imports).
- Produces: `function undocumentedHintFlags(content): string[]` — each `--flag` token (`/--[a-z][a-z0-9-]*/g`) found in the first cell of an `## Input` table row, whose first cell contains no `EXEMPT_MARKERS` entry, and which does not appear in the hint followed by a non-`[a-z0-9-]` character or end of string. Cells are split on unescaped pipes only (`/(?<!\\)\|/`), and the result is deduplicated in first-seen order. It returns `[]` when the skill has no hint or no `## Input`.

- [ ] **Step 1: Write the failing tests** — append to `tests/argument-hint-input.test.js`, after defining `undocumentedHintFlags`:

```js
test('AC1.1: every --flag an ## Input table row documents is in argument-hint unless marked', () => {
  for (const name of SKILLS) {
    assert.deepStrictEqual(undocumentedHintFlags(read(name)), [], `skills/${name}/SKILL.md: ## Input documents flags missing from argument-hint — add them to the hint or mark the row ${EXEMPT_MARKERS.join(' / ')}`);
  }
});

test('go-red control: capture with its markers stripped reports exactly its five producer flags', () => {
  const stripped = read('capture').split(' (producer-only)').join('');
  assert.deepStrictEqual(undocumentedHintFlags(stripped), ['--defer-reason', '--risk', '--size', '--origin', '--source']);
});

test('marker outside the first cell does not exempt the row', () => {
  const c = "---\nargument-hint: '[--a]'\n---\n## Input\n\n| Argument | Behavior |\n|---|---|\n| `--b` | (producer-only) |\n";
  assert.deepStrictEqual(undocumentedHintFlags(c), ['--b']);
});

test('prefix flag in hint does not cover a longer flag', () => {
  const c = "---\nargument-hint: '[--batch]'\n---\n## Input\n\n| Argument | Behavior |\n|---|---|\n| `--batch-size <n>` | x |\n";
  assert.deepStrictEqual(undocumentedHintFlags(c), ['--batch-size']);
});
```

The go-red control runs the same function as the positive test against mutated input. That is the Go-red control check's required shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/argument-hint-input.test.js`
Expected: FAIL — AC1.1 reports `capture` (`--defer-reason`, `--risk`, `--size`, `--origin`), and the go-red control fails because `--source` has no `## Input` row yet

- [ ] **Step 3: Mark the rows**

In `plugin/skills/capture/SKILL.md`'s `## Input` table, append ` (producer-only)` to the first cell of the `--defer-reason=<value>`, `--risk=…` / `--size=…`, and `--origin="<text>"` rows. Then add, after the `--origin=` row:

`` | `--source <parent-skill>` (producer-only) | A parent skill naming itself as the caller (e.g. `--source build`, `--source intake`) — see the Component-Skill Contract below. Any value other than `intake` makes the filing a deferral (see `--defer-reason=`). | ``

In `plugin/skills/routine/SKILL.md:48`, append ` (producer-only)` to the `` `--source <parent-skill>` `` cell. Update the test file's header comment to say the check now runs in both directions, naming the two markers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/argument-hint-input.test.js tests/argument-hint-mirrors.test.js tests/deferral-gate-conformance.test.js`
Expected: PASS, `ℹ fail 0`

- [ ] **Step 5: Prove discrimination** — temporarily delete ` (producer-only)` from routine's row, rerun `node --test tests/argument-hint-input.test.js`, and confirm AC1.1 fails naming `routine` and `--source`. Then restore the marker and confirm green.

- [ ] **Step 6: Commit**

```bash
git add tests/argument-hint-input.test.js plugin/skills/capture/SKILL.md plugin/skills/routine/SKILL.md
git commit -m "Check Input-table flags against argument-hint — mark capture and routine producer-only rows"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 — decide and record the rule | Decision section and Task 1 |
| Deliverable 2 — apply to capture (mark rows) | Task 2 Step 3 |
| Deliverable 3 — conditional test extension | Not required by the chosen rule, but done anyway: Task 2 adds the Input→hint check, with the markers as named exceptions |
| AC1.1 — capture hint and Input agree, npm test passes | Task 2 test `AC1.1` and the full suite at Common Step 5 |
| AC2.1 — skill-authoring states the condition | Task 1 test `AC2.1` |

## As built — deviations from this plan (Common Step 4.5, all Beneficial)

1. **Rule wording is permissive.** The Decision section and Task 1 above say producer-only flags "stay out" of the hint. As built (876490a03), `docs/skill-authoring.md` says a marked flag *may* be left out: marking is the condition for absence, not a mandate. Reason: five skills (visual-review, design-wrapper, visualize, tidy, specify) deliberately keep caller-only flags in their hints, so a "must" rule would have contradicted the corpus. The spec's AC2 asks only "whether… may be absent, and under what condition". Corpus convergence is routed to open-items ledger row 1.
2. **The check also reads bullet-form `## Input`.** The plan scoped `undocumentedHintFlags` to table first cells. As built, it also reads a bullet's leading code span, with the marker right after it. This surfaced backlog's human-typed `--trust`, which was missing from its hint; `[--trust]` was added to backlog's hint and both of its mirrors.
3. **Mirror-surface carve-out clauses** were added to `docs/skill-authoring.md`'s "Adding a mode or argument" paragraph and to `plugin/skills/build/plan-authoring-checks.md`'s Mirror-surface enumeration check.
4. **Prefix-boundary test direction swapped** (ce15d4358): the hint is `[--batch-size]` and the row is `--batch`, the only direction the lookahead discriminates.
