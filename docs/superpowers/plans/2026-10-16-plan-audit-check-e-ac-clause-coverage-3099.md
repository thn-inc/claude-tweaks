# plan-audit Check E — acceptance-criterion clause coverage (#3099) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a warn-only Check E to `plugin/bin/plan-audit.js` that splits the spec's `## Acceptance Criteria` into `AC{item}.{clause}` clauses and reports every clause no task's test step covers, wire `--spec` into `/build`'s Common Step 1.5, and tell plan authors to cite clause ids.

**Architecture:** Two pure parsers in `plugin/bin/lib/plan-audit/parser.js` — `extractAcceptanceClauses(specText)` (spec side) and `extractCoverageSources(planText)` (plan side) — feed a pure `checkE(specText, planText)` in `checks.js` that follows the existing `{ok, ...}` envelope convention with `ok` always `true`. `--spec <spec-file>` is threaded through `args.js` and `plan-audit.js` the way `--repo-root` is; without it the envelope carries `checkE: {ok: true, skipped: 'no-spec'}`. Skill prose (`build/plan-audit.md`, `build/SKILL.md`, `build/plan-authoring-checks.md`) documents and wires it.

**Tech Stack:** Node 18+ built-ins only (`node:fs`, `node:path`, `node:child_process`), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T171437-spec-3099/work/3099-spec.md` (materialized from GitHub issue #3099; the worktree's copy — the main-checkout run dir holds no `work/`)

Scope keywords: checkE(, extractAcceptanceClauses, extractCoverageSources

> **Check B note for Common Step 1.5:** an authoring-time run (scratch copy of this plan's code, `--spec` the spec above) reported exactly one Check B entry — this plan file itself (`docs/superpowers/plans/2026-10-16-plan-audit-check-e-ac-clause-coverage-3099.md`), which necessarily contains its own keywords. That is a pre-existing Check B self-match, not scope creep: do not add the plan file to itself as a task. Every other check was clean (`checkA`/`checkC`/`checkD`/`headroom`/`premiseRefs` ok; `checkC.appendShaped` lists Tasks 1-4; `checkE` covered all 10 clause ids via `test-step`). A bare `checkE` keyword is avoided deliberately — Check B matches case-insensitively, so it hit 283 files containing "checked".

## Global Constraints

- Check E is warn-only: `checkE.ok` is always `true`; `plan-audit.js`'s exit code and pass expression never read `checkE`.
- Return shape: `{ ok: true, uncovered: [{id, clause}], waived: [{id, reason}], unparsed: [{item, raw}] }`, plus `covered: [{id, via}]` (see Decisions).
- Without `--spec`: `checkE: { ok: true, skipped: 'no-spec' }`; every other envelope key, the summary line, and the exit code are unchanged.
- Clause ids: `AC{item}.{clause}`, both 1-based; item = the criterion's position in the section.
- Waiver line, exact form: `Waived AC{item}.{clause}: {reason}`.
- A spec with no `## Acceptance Criteria` section, or an item the splitter cannot break, lands in `unparsed` — never reported as covered.
- `plugin/skills/build/SKILL.md` grows by at most ~280 bytes (45,468 today; warn tier 46,080 = `CEILING_BYTES` 51,200 × `WARN_RATIO` 0.9 in `plugin/bin/lib/skill-audit/context-cost.js`).
- Per-suite command: `node --test tests/bin-lib/plan-audit/*.test.js` (glob form, never a bare directory).
- Commit subjects: `{Verb} {what} — {detail}`; reference the record as `refs #3099`, never a closing keyword.

## Decisions (spec deviations and rulings, each recorded here once)

1. **Coverage sources (build-time probe reversed the spec's Gotcha).** The installed `/superpowers:writing-plans` template (superpowers 6.4.1, `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/writing-plans/SKILL.md:157`) has no "Spec coverage map" table — only the self-review line `**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps.` So the primary source is an `AC{item}.{clause}` id cited in a task's test step; a markdown table row naming the id is a secondary source accepted only when an author writes one; quoted clause text is the fallback.
2. **`--spec` path is the worktree's copy, not `{run-dir}/work/{n}-spec.md` as the spec's Deliverable 4 literally reads.** `flow/materialize.md:155,170` keeps `work/` inside the worktree; `$PIPELINE_RUN_DIR` resolves to the main checkout. Probe on this very run: `ls "$RUN_ROOT/.claude-tweaks/pipelines/2026-10-16T171437-spec-3099/"` prints `config.yml decisions.md events.jsonl preflight.json run-state.json staged` — no `work/`. Passing `$PIPELINE_RUN_DIR/work/…` in worktree mode would name a file that does not exist; Task 4 makes that an exit-2 error instead of a silent skip.
3. **Skip gate (spec Gotcha): Check E shares the A/B/C/headroom skip gate.** It is warn-only, so skipping it on a trivial plan loses a warning, never a stop — unlike Check D, whose raw NUL is fatal at any size. The skip path's `--bytes` call stays Check D alone; `--spec` beside `--bytes` or `--count-tasks` is a usage error. Recorded in `plan-audit.md` (Task 5).
4. **Unreadable `--spec` exits 2** (the plan file's error path), never `skipped: 'no-spec'` — `parse-signal-discipline` fix-shape 4 ("an optional declaration file that was never read").
5. **`covered: [{id, via}]` is added beside the four spec fields** so `covered + waived + uncovered` accounts for every parsed clause and the weaker `quoted-text` match stays visible.
6. **Prose-only Acceptance Criteria sections** (no list lines — 121 of 1,267 real specs) make each paragraph one item; with list items present, stray prose beside them is `unparsed` (item `null`) except a one-line italic footer (`_Filed by \`review\` via specShapedBody._`).
7. **`plan-audit.js` keeps its `main()` shape.** `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` wants `run(argv, deps)`, but this CLI has none today and every suite spawns the binary; converting it is outside this record (Surgical changes). Its exit vocabulary (0 pass / 1 finding / 2 usage or unreadable file) is unchanged.
8. **Envelope enumerations gain `premiseRefs` alongside `checkE`.** `plan-audit.md:13` and `docs/plugin-structure.md:202` already omit `premiseRefs`; both lines are being rewritten to add `checkE`, and a rewritten line must not stay knowingly wrong.

## Review Focus

1. A Windows checkout (`core.autocrlf`) hands the parser CRLF spec and plan text — the result must equal the LF result (Task 1 and Task 2 CRLF tests).
2. A plan whose test step carries a fenced fixture containing `## …`, `| … |`, or `Waived …` lines — those must stay step content, never end the task, add a map row, or waive a clause (Task 2 fence test).
3. A clause id cited only in an implementation step or task prose is not coverage — the incident's own shape (Task 3 "outside a test step" test).
4. `AC2.10` must never satisfy `AC2.1`, and a bare `AC2` covers no clause (Task 3 boundary test).
5. A `--spec` path that does not exist (the main-checkout `$PIPELINE_RUN_DIR/work/…` mistake from Decision 2) exits 2 with a message, never a silent `skipped` envelope (Task 4 unreadable-spec test).

---

### Task 1: Spec-side clause splitter in parser.js

**Files:**
- Modify: `plugin/bin/lib/plan-audit/parser.js` (append before `module.exports`, add two exports)
- Test: `tests/bin-lib/plan-audit/parser.test.js` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `extractAcceptanceClauses(specText: string) → { clauses: Array<{id: string, item: number, text: string}>, unparsed: Array<{item: number|null, raw: string}> }`; `splitClauses(text: string) → string[] | null`; module-level constant `AC_FENCE_RE` (`/^[ \t]*(```|~~~)/`) that Task 2 reuses.

- [ ] **Step 1: Write the failing test**

Append to `tests/bin-lib/plan-audit/parser.test.js` (the file's existing `test`/`assert` imports cover it):

```js

// ── #3099 Check E — acceptance-criterion clause splitter ────────────────────
const { extractAcceptanceClauses, splitClauses } = require('../../../plugin/bin/lib/plan-audit/parser');

const INCIDENT_SPEC = [
  '# 1: Example',
  '',
  '## Acceptance Criteria',
  '',
  '1. The report renders.',
  '2. Each recipient gets one row. A recipient with several instances counts once; the total equals the recipient count.',
  '3. `npm test` passes.',
  '',
  '## Release Note',
  '',
  '1. Not a criterion.',
].join('\n');

test('AC1.1 (#3099): a three-clause item splits on the sentence end and the semicolon into AC2.1-AC2.3', () => {
  const { clauses, unparsed } = extractAcceptanceClauses(INCIDENT_SPEC);
  assert.deepStrictEqual(unparsed, []);
  assert.deepStrictEqual(clauses.map((c) => c.id), ['AC1.1', 'AC2.1', 'AC2.2', 'AC2.3', 'AC3.1']);
  assert.deepStrictEqual(clauses.filter((c) => c.item === 2).map((c) => c.text), [
    'Each recipient gets one row.',
    'A recipient with several instances counts once',
    'the total equals the recipient count.',
  ]);
});

test('#3099: the section ends at the next ## heading — a later section\'s list is never read', () => {
  const { clauses } = extractAcceptanceClauses(INCIDENT_SPEC);
  assert.ok(!clauses.some((c) => /Not a criterion/.test(c.text)));
});

test('#3099: splitClauses never cuts inside a code span, after e.g., before a lowercase word, or inside parentheses', () => {
  assert.deepStrictEqual(splitClauses('Run `a; b. C` first.'), ['Run `a; b. C` first.']);
  assert.deepStrictEqual(splitClauses('Use a flag, e.g. `--spec`, to opt in.'), ['Use a flag, e.g. `--spec`, to opt in.']);
  assert.deepStrictEqual(splitClauses('Version 6.4.1 ships it. then more.'), ['Version 6.4.1 ships it. then more.']);
  assert.deepStrictEqual(splitClauses('Both shapes (one; two) pass.'), ['Both shapes (one; two) pass.']);
  assert.deepStrictEqual(splitClauses('One holds. Two holds!'), ['One holds.', 'Two holds!']);
});

test('#3099: an odd backtick count makes splitClauses refuse (null), never guess', () => {
  assert.strictEqual(splitClauses('A `broken span; still here.'), null);
});

test('#3099: ids follow item position, and a leading [ ] checkbox is stripped from a - bullet', () => {
  const spec = '## Acceptance Criteria\n\n- [ ] First holds.\n- [x] Second holds; third holds.\n';
  assert.deepStrictEqual(extractAcceptanceClauses(spec).clauses, [
    { id: 'AC1.1', item: 1, text: 'First holds.' },
    { id: 'AC2.1', item: 2, text: 'Second holds' },
    { id: 'AC2.2', item: 2, text: 'third holds.' },
  ]);
});

test('#3099: an indented continuation line joins its item', () => {
  const spec = '## Acceptance Criteria\n\n- First part\n  continues here. Second sentence.\n';
  assert.deepStrictEqual(extractAcceptanceClauses(spec).clauses.map((c) => c.text), [
    'First part continues here.',
    'Second sentence.',
  ]);
});

test('AC3.1 (#3099): a spec with no ## Acceptance Criteria section is unparsed, never an empty clause list', () => {
  const result = extractAcceptanceClauses('# 1: X\n\n## Deliverables\n\n- Do it.\n');
  assert.deepStrictEqual(result.clauses, []);
  assert.strictEqual(result.unparsed.length, 1);
  assert.strictEqual(result.unparsed[0].item, null);
  assert.match(result.unparsed[0].raw, /no "## Acceptance Criteria" section/);
});

test('#3099: a heading inside a fenced block is not the section', () => {
  const result = extractAcceptanceClauses('```\n## Acceptance Criteria\n- Quoted.\n```\n');
  assert.deepStrictEqual(result.clauses, []);
  assert.match(result.unparsed[0].raw, /no "## Acceptance Criteria" section/);
});

test('#3099: an empty section is unparsed', () => {
  const result = extractAcceptanceClauses('## Acceptance Criteria\n\n## Gotchas\n');
  assert.deepStrictEqual(result.clauses, []);
  assert.deepStrictEqual(result.unparsed, [{ item: null, raw: 'empty "## Acceptance Criteria" section' }]);
});

test('#3099: an item the splitter refuses lands in unparsed with its item number; its neighbours still split', () => {
  const spec = '## Acceptance Criteria\n\n- Fine one.\n- A `broken span here.\n- Fine three.\n';
  const { clauses, unparsed } = extractAcceptanceClauses(spec);
  assert.deepStrictEqual(clauses.map((c) => c.id), ['AC1.1', 'AC3.1']);
  assert.deepStrictEqual(unparsed, [{ item: 2, raw: 'A `broken span here.' }]);
});

test('#3099: a fenced block inside an item makes that item unparsed', () => {
  const spec = '## Acceptance Criteria\n\n- Runs this:\n```\nnpm test\n```\n- Fine two.\n';
  const { clauses, unparsed } = extractAcceptanceClauses(spec);
  assert.deepStrictEqual(clauses.map((c) => c.id), ['AC2.1']);
  assert.strictEqual(unparsed.length, 1);
  assert.strictEqual(unparsed[0].item, 1);
});

test('#3099: a prose-only section makes each paragraph one item', () => {
  const spec = '## Acceptance Criteria\n\nThe row matches the repo. It names the producer.\n\nThe docs agree.\n';
  assert.deepStrictEqual(extractAcceptanceClauses(spec).clauses.map((c) => [c.id, c.text]), [
    ['AC1.1', 'The row matches the repo.'],
    ['AC1.2', 'It names the producer.'],
    ['AC2.1', 'The docs agree.'],
  ]);
});

test('#3099: stray prose beside list items is unparsed (item null); a one-line italic footer is ignored', () => {
  const spec = [
    '## Acceptance Criteria',
    '',
    'All of these hold:',
    '',
    '- [ ] One holds.',
    '',
    '_Filed by `review` via specShapedBody._',
  ].join('\n');
  const { clauses, unparsed } = extractAcceptanceClauses(spec);
  assert.deepStrictEqual(clauses.map((c) => c.id), ['AC1.1']);
  assert.deepStrictEqual(unparsed, [{ item: null, raw: 'All of these hold:' }]);
});

test('#3099: a CRLF spec yields exactly the LF result', () => {
  assert.deepStrictEqual(
    extractAcceptanceClauses(INCIDENT_SPEC.replace(/\n/g, '\r\n')),
    extractAcceptanceClauses(INCIDENT_SPEC),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/plan-audit/parser.test.js`
Expected: FAIL after Step 1 — the 14 new tests fail with `TypeError: extractAcceptanceClauses is not a function` (and `splitClauses is not a function`); the file's existing tests still pass, so this command passes today (append-shaped).

- [ ] **Step 3: Write minimal implementation**

In `plugin/bin/lib/plan-audit/parser.js`, insert this block immediately above `module.exports = {`:

```js
// ── Check E inputs: the spec's acceptance-criterion clauses (#3099) ────────
// The spec's `## Acceptance Criteria` section, split into items (one per
// top-level `-`/`*`/`+`/`1.` list line, a leading `[ ]` checkbox stripped)
// and each item into clauses on sentence ends and `;`. Ids are
// `AC{item}.{clause}`, both 1-based, item = position in the section (never
// the literal list number). A prose-only section (no list lines — about a
// tenth of real specs) makes each paragraph one item. Code spans and a few
// abbreviations are masked before splitting so `a; b` inside backticks and
// "e.g." never cut a clause. Anything the splitter cannot read confidently
// lands in `unparsed`, never in `clauses` (parse-signal-discipline): a
// missing or empty section, an item with an odd backtick count or a fence,
// and — when the section does have list items — any stray prose paragraph
// beside them, except a one-line italic footer such as
// `_Filed by review via specShapedBody._`.
const AC_HEADING_RE = /^##[ \t]+Acceptance Criteria[ \t]*$/i;
const AC_SECTION_END_RE = /^#{1,2}[ \t]/;
const AC_FENCE_RE = /^[ \t]*(```|~~~)/;
const AC_ITEM_RE = /^ {0,3}(?:[-*+]|\d{1,3}[.)])[ \t]+(.*)$/;
const AC_CHECKBOX_RE = /^\[[ xX]\][ \t]+/;
const AC_FOOTER_RE = /^(?:_[^_].*_|\*[^*].*\*)$/;
const AC_ABBREVIATION_RE = /\b(?:e\.g|i\.e|etc|vs|cf)\./gi;

function acceptanceSectionLines(specText) {
  const lines = specText.replace(/\r\n?/g, '\n').split('\n');
  let inFence = false;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (AC_FENCE_RE.test(lines[i])) { inFence = !inFence; continue; }
    if (!inFence && AC_HEADING_RE.test(lines[i])) { start = i + 1; break; }
  }
  if (start === -1) return null;
  const section = [];
  inFence = false;
  for (let i = start; i < lines.length; i++) {
    if (AC_FENCE_RE.test(lines[i])) inFence = !inFence;
    if (!inFence && AC_SECTION_END_RE.test(lines[i])) break;
    section.push(lines[i]);
  }
  return section;
}

// Returns the item's clauses (trimmed, a trailing `;` dropped), or null when
// the item cannot be split confidently (odd backtick count — a code span the
// mask cannot bound). A cut is made after `;`, or after `.`/`!`/`?` followed
// by whitespace and a character that is not a lowercase letter, and never
// inside parentheses or brackets.
function splitClauses(text) {
  if ((text.match(/`/g) || []).length % 2 !== 0) return null;
  const masked = text
    .replace(/`[^`]*`/g, (m) => `\`${'x'.repeat(m.length - 2)}\``)
    .replace(AC_ABBREVIATION_RE, (m) => m.replace(/\./g, 'x'));
  const cuts = [];
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '(' || ch === '[') depth += 1;
    else if ((ch === ')' || ch === ']') && depth > 0) depth -= 1;
    else if (depth === 0 && ch === ';') cuts.push(i + 1);
    else if (depth === 0 && (ch === '.' || ch === '!' || ch === '?')) {
      const after = masked.slice(i + 1).match(/^\s+(\S)/);
      if (after && !/[a-z]/.test(after[1])) cuts.push(i + 1);
    }
  }
  const clauses = [];
  let from = 0;
  for (const cut of [...cuts, text.length]) {
    const clause = text.slice(from, cut).trim().replace(/;$/, '').trim();
    if (/[A-Za-z0-9]/.test(clause)) clauses.push(clause);
    from = cut;
  }
  return clauses.length ? clauses : null;
}

// Returns { clauses: [{id, item, text}], unparsed: [{item, raw}] }. `item` is
// null on an unparsed entry that belongs to no single item (no section, an
// empty section, a stray paragraph).
function extractAcceptanceClauses(specText) {
  const section = acceptanceSectionLines(specText);
  if (section === null) {
    return { clauses: [], unparsed: [{ item: null, raw: 'no "## Acceptance Criteria" section in the spec' }] };
  }
  const items = [];
  const paragraphs = [];
  let current = null;
  let prevBlank = true;
  let inFence = false;
  for (const line of section) {
    if (AC_FENCE_RE.test(line)) {
      inFence = !inFence;
      if (!current) {
        current = { lines: [], fenced: true };
        paragraphs.push(current);
      }
      current.fenced = true;
      current.lines.push(line.trim());
      prevBlank = false;
      continue;
    }
    if (inFence) { current.lines.push(line.trim()); continue; }
    if (line.trim() === '') {
      prevBlank = true;
      if (current && !items.includes(current)) current = null;
      continue;
    }
    const itemMatch = line.match(AC_ITEM_RE);
    if (itemMatch) {
      current = { lines: [itemMatch[1].replace(AC_CHECKBOX_RE, '')], fenced: false };
      items.push(current);
    } else if (current && (/^\s/.test(line) || !prevBlank)) {
      current.lines.push(line.trim());
    } else {
      current = { lines: [line.trim()], fenced: false };
      paragraphs.push(current);
    }
    prevBlank = false;
  }
  const prose = paragraphs.filter((p) => p.fenced || !(p.lines.length === 1 && AC_FOOTER_RE.test(p.lines[0])));
  const unparsed = [];
  let units = items;
  if (items.length === 0) {
    if (prose.length === 0) {
      return { clauses: [], unparsed: [{ item: null, raw: 'empty "## Acceptance Criteria" section' }] };
    }
    units = prose;
  } else {
    for (const p of prose) unparsed.push({ item: null, raw: p.lines.join(' ') });
  }
  const clauses = [];
  units.forEach((unit, idx) => {
    const item = idx + 1;
    const raw = unit.lines.join(' ').trim();
    const split = unit.fenced ? null : splitClauses(raw);
    if (split === null) {
      unparsed.push({ item, raw });
      return;
    }
    split.forEach((text, c) => clauses.push({ id: `AC${item}.${c + 1}`, item, text }));
  });
  return { clauses, unparsed };
}
```

Then add the two names to the export list, so it starts:

```js
module.exports = {
  extractAcceptanceClauses,
  splitClauses,
  extractFileEntries,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/plan-audit/*.test.js`
Expected: PASS — every existing plan-audit test plus the 14 new ones.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/plan-audit/parser.js tests/bin-lib/plan-audit/parser.test.js
git commit -m "Add the AC clause splitter to plan-audit's parser — Check E spec side, refs #3099"
```

---

### Task 2: Plan-side coverage sources in parser.js

**Files:**
- Modify: `plugin/bin/lib/plan-audit/parser.js` (append before `module.exports`, add one export)
- Test: `tests/bin-lib/plan-audit/parser.test.js` (append)

**Interfaces:**
- Consumes: `AC_FENCE_RE` from Task 1 (same module).
- Produces: `extractCoverageSources(planText: string) → { waivers: Array<{id: string, reason: string}>, testSteps: string[], mapRows: string[] }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/bin-lib/plan-audit/parser.test.js`:

```js

// ── #3099 Check E — plan coverage sources ───────────────────────────────────
const { extractCoverageSources } = require('../../../plugin/bin/lib/plan-audit/parser');

const COVERAGE_PLAN = [
  '# Plan',
  '',
  '| Clause | Task |',
  '|---|---|',
  '| AC1.1 | Task 1 |',
  '',
  'Waived AC3.1: verified by hand at review',
  '',
  '### Task 1: Thing',
  '',
  '- [ ] **Step 1: Write the failing test**',
  '',
  'Cites AC2.1 in the test step.',
  '',
  '```js',
  '## not a heading inside a fence',
  '| not a row inside a fence |',
  'Waived AC9.9: not a waiver inside a fence',
  '```',
  '',
  'Still Step 1 after the fence: AC2.2.',
  '',
  '- [ ] **Step 3: Write minimal implementation**',
  '',
  'Mentions AC2.3 outside any test step.',
  '',
  '- [ ] **Step 4: Run tests to verify they pass**',
  '',
  '## Self-Review',
  '',
  '- [ ] **Step 9: Run the test**',
  '',
  'AC5.1 outside any task block.',
].join('\n');

test('#3099: extractCoverageSources reads waiver lines and consumes them', () => {
  const { waivers, testSteps } = extractCoverageSources(COVERAGE_PLAN);
  assert.deepStrictEqual(waivers, [{ id: 'AC3.1', reason: 'verified by hand at review' }]);
  assert.ok(!testSteps.join('\n').includes('Waived AC3.1'));
});

test('#3099: test steps are the Step sub-steps whose title names a test or verification, inside a Task block', () => {
  const { testSteps } = extractCoverageSources(COVERAGE_PLAN);
  assert.strictEqual(testSteps.length, 2);
  assert.match(testSteps[0], /Cites AC2\.1 in the test step/);
  assert.match(testSteps[0], /Still Step 1 after the fence: AC2\.2/);
  assert.ok(!testSteps.join('\n').includes('AC2.3'), 'an implementation step is not a test step');
  assert.ok(!testSteps.join('\n').includes('AC5.1'), 'a step after the task block ends is not read');
});

test('#3099: a fenced line is step content, never a heading, table row, or waiver', () => {
  const { testSteps, mapRows, waivers } = extractCoverageSources(COVERAGE_PLAN);
  assert.match(testSteps[0], /## not a heading inside a fence/);
  assert.ok(!waivers.some((w) => w.id === 'AC9.9'));
  assert.ok(!mapRows.some((r) => r.includes('not a row inside a fence')));
});

test('#3099: every table row outside a fence is a coverage-map source', () => {
  assert.deepStrictEqual(extractCoverageSources(COVERAGE_PLAN).mapRows, [
    '| Clause | Task |',
    '|---|---|',
    '| AC1.1 | Task 1 |',
  ]);
});

test('#3099: a CRLF plan yields exactly the LF result', () => {
  assert.deepStrictEqual(
    extractCoverageSources(COVERAGE_PLAN.replace(/\n/g, '\r\n')),
    extractCoverageSources(COVERAGE_PLAN),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/plan-audit/parser.test.js`
Expected: FAIL after Step 1 — the 5 new tests fail with `TypeError: extractCoverageSources is not a function`; the file's other tests still pass (append-shaped).

- [ ] **Step 3: Write minimal implementation**

In `plugin/bin/lib/plan-audit/parser.js`, insert this block immediately above `module.exports = {` (below Task 1's block):

```js
// ── Check E inputs: where a plan may claim coverage (#3099) ────────────────
// Three sources, read in one pass; a line inside a ``` or ~~~ fence is
// content of the step it sits in, never a heading, waiver, or table row:
// - waivers: a line `Waived AC{item}.{clause}: {reason}` (an optional `- `
//   bullet before it). A waiver line is consumed, so its own id never also
//   counts as a citation.
// - testSteps: the text of every `**Step N: {title}**` sub-step inside a
//   `### Task N:` block whose title names a test or a verification
//   (/\btests?\b|\bverif/i), from its heading to the next step heading.
// - mapRows: every markdown table row (a line starting with `|`) — a
//   spec-coverage map, when an author writes one. The installed upstream
//   writing-plans template carries no such table (superpowers 6.4.1), so it
//   is an accepted source, never an expected one.
const STEP_HEADING_RE = /^[-*]?[ \t]*(?:\[[ xX]?\][ \t]*)?\*\*Step[ \t]+\d+:([^*\n]*)\*\*/;
const TEST_STEP_TITLE_RE = /\btests?\b|\bverif/i;
const WAIVER_RE = /^[ \t]*(?:[-*][ \t]+)?Waived[ \t]+(AC\d+\.\d+)[ \t]*:[ \t]*(\S.*?)[ \t]*$/;

function extractCoverageSources(planText) {
  const waivers = [];
  const testSteps = [];
  const mapRows = [];
  let inTask = false;
  let inFence = false;
  let current = null;
  for (const line of planText.replace(/\r\n?/g, '\n').split('\n')) {
    const fence = AC_FENCE_RE.test(line);
    if (fence) inFence = !inFence;
    if (fence || inFence) {
      if (current) current.push(line);
      continue;
    }
    const waiver = line.match(WAIVER_RE);
    if (waiver) {
      waivers.push({ id: waiver[1], reason: waiver[2] });
      continue;
    }
    if (/^[ \t]*\|/.test(line)) mapRows.push(line);
    if (/^###[ \t]+Task[ \t]+\d+:/.test(line)) { inTask = true; current = null; continue; }
    if (/^#{1,3}[ \t]/.test(line)) { inTask = false; current = null; continue; }
    if (!inTask) continue;
    const step = line.match(STEP_HEADING_RE);
    if (step) {
      current = TEST_STEP_TITLE_RE.test(step[1]) ? [line] : null;
      if (current) testSteps.push(current);
      continue;
    }
    if (current) current.push(line);
  }
  return { waivers, testSteps: testSteps.map((s) => s.join('\n')), mapRows };
}
```

Then add `extractCoverageSources,` to the export list directly after `extractAcceptanceClauses,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/plan-audit/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/plan-audit/parser.js tests/bin-lib/plan-audit/parser.test.js
git commit -m "Add plan-side coverage sources to plan-audit's parser — Check E test steps, map rows, waivers, refs #3099"
```

---

### Task 3: checkE in checks.js

**Files:**
- Modify: `plugin/bin/lib/plan-audit/checks.js` (one `require` after the `context-cost` require; a block before `module.exports`; `checkE` added to the exports)
- Test: `tests/bin-lib/plan-audit/checks.test.js` (append)

**Interfaces:**
- Consumes: `extractAcceptanceClauses` (Task 1), `extractCoverageSources` (Task 2).
- Produces: `checkE(specText: string, planText: string) → { ok: true, uncovered: Array<{id, clause}>, waived: Array<{id, reason}>, unparsed: Array<{item, raw}>, covered: Array<{id, via: 'test-step'|'coverage-map'|'quoted-text'}> }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/bin-lib/plan-audit/checks.test.js`:

```js

// ── Check E (#3099) ──────────────────────────────────────────────────────────
const { checkE } = require('../../../plugin/bin/lib/plan-audit/checks');

const E_SPEC = [
  '## Acceptance Criteria',
  '',
  '1. The report renders.',
  '2. Each recipient gets one row. A recipient with several instances counts once; the total equals the recipient count.',
  '',
].join('\n');

function ePlan(testStepLines, extraLines = []) {
  return [
    ...extraLines,
    '### Task 1: Build it',
    '',
    '- [ ] **Step 1: Write the failing test**',
    '',
    ...testStepLines,
    '',
    '- [ ] **Step 3: Write minimal implementation**',
    '',
    'Implementation notes.',
  ].join('\n');
}

test('AC1.1 (#3099): a plan citing AC2.1 and AC2.2 only reports AC2.3 uncovered, with its clause text', () => {
  const result = checkE(E_SPEC, ePlan(["test('AC1.1 AC2.1 AC2.2: rows render', () => {});"]));
  assert.deepStrictEqual(result.uncovered, [{ id: 'AC2.3', clause: 'the total equals the recipient count.' }]);
  assert.deepStrictEqual(result.covered.map((c) => c.id), ['AC1.1', 'AC2.1', 'AC2.2']);
  assert.deepStrictEqual(result.waived, []);
  assert.deepStrictEqual(result.unparsed, []);
});

test('AC2.1 (#3099): the same plan with a Waived AC2.3 line reports AC2.3 under waived, not uncovered', () => {
  const plan = ePlan(["test('AC1.1 AC2.1 AC2.2: rows render', () => {});"], ['Waived AC2.3: counted by the existing totals test', '']);
  const result = checkE(E_SPEC, plan);
  assert.deepStrictEqual(result.waived, [{ id: 'AC2.3', reason: 'counted by the existing totals test' }]);
  assert.deepStrictEqual(result.uncovered, []);
});

test('#3099: a waiver wins even when its line sits inside a test step', () => {
  const result = checkE(E_SPEC, ePlan(['AC1.1 AC2.1 AC2.2', 'Waived AC2.3: out of scope here']));
  assert.deepStrictEqual(result.waived, [{ id: 'AC2.3', reason: 'out of scope here' }]);
  assert.deepStrictEqual(result.uncovered, []);
});

test('AC3.1 (#3099): a spec with no ## Acceptance Criteria section yields a non-empty unparsed, not just an empty uncovered', () => {
  const result = checkE('# 1: X\n\n## Deliverables\n\n- Do it.\n', ePlan(['AC1.1']));
  assert.strictEqual(result.unparsed.length, 1);
  assert.match(result.unparsed[0].raw, /no "## Acceptance Criteria" section/);
  assert.deepStrictEqual(result.uncovered, []);
  assert.deepStrictEqual(result.covered, []);
});

test('AC5.1 (#3099): Check E never sets ok: false — uncovered and unparsed entries both leave ok true', () => {
  assert.strictEqual(checkE(E_SPEC, ePlan(['nothing cited'])).ok, true);
  assert.strictEqual(checkE('no section', ePlan(['nothing cited'])).ok, true);
});

test('#3099: an id cited only outside a test step does not cover the clause', () => {
  const plan = ePlan(['AC1.1 AC2.1 AC2.2']).replace('Implementation notes.', 'Implementation covers AC2.3.');
  assert.deepStrictEqual(checkE(E_SPEC, plan).uncovered.map((u) => u.id), ['AC2.3']);
});

test('#3099: a bare item number (AC2) covers no clause, and AC2.10 does not cover AC2.1', () => {
  const result = checkE(E_SPEC, ePlan(['AC1.1 covers AC2 and AC2.10 only']));
  assert.deepStrictEqual(result.uncovered.map((u) => u.id), ['AC2.1', 'AC2.2', 'AC2.3']);
});

test('#3099: a coverage-map table row naming the id covers the clause', () => {
  const plan = ePlan(['AC1.1 AC2.1 AC2.2'], ['| Clause | Task |', '|---|---|', '| AC2.3 | Task 1 |', '']);
  const result = checkE(E_SPEC, plan);
  assert.deepStrictEqual(result.uncovered, []);
  assert.deepStrictEqual(result.covered.find((c) => c.id === 'AC2.3'), { id: 'AC2.3', via: 'coverage-map' });
});

test('#3099: the clause text quoted in a test step covers it (backticks, case, spacing, end punctuation ignored)', () => {
  const plan = ePlan(['AC1.1 AC2.1 AC2.2', '// THE TOTAL   equals the recipient count']);
  const result = checkE(E_SPEC, plan);
  assert.deepStrictEqual(result.uncovered, []);
  assert.deepStrictEqual(result.covered.find((c) => c.id === 'AC2.3'), { id: 'AC2.3', via: 'quoted-text' });
});

test('#3099: an item the parser refuses is reported unparsed and never as covered or uncovered', () => {
  const spec = '## Acceptance Criteria\n\n- Fine one.\n- A `broken span here.\n';
  const result = checkE(spec, ePlan(['AC1.1 AC2.1']));
  assert.deepStrictEqual(result.unparsed, [{ item: 2, raw: 'A `broken span here.' }]);
  assert.deepStrictEqual(result.covered.map((c) => c.id), ['AC1.1']);
  assert.deepStrictEqual(result.uncovered, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/plan-audit/checks.test.js`
Expected: FAIL after Step 1 — the 10 new tests fail with `TypeError: checkE is not a function`; the file's existing tests still pass (append-shaped).

- [ ] **Step 3: Write minimal implementation**

In `plugin/bin/lib/plan-audit/checks.js`, directly below the `} = require('../skill-audit/context-cost');` line, add:

```js
const { extractAcceptanceClauses, extractCoverageSources } = require('./parser');
```

Insert this block immediately above `module.exports = {`:

```js
// ── Check E — Acceptance-criterion clause coverage (#3099) ─────────────────
// Warn-only: `ok` is always true, so Check E never changes the exit code —
// clause splitting is a prose heuristic, and a hard gate on a heuristic would
// block builds on its false positives. Per clause, in order: a waiver line
// wins (`waived`); else the clause id cited in a test step (`via:
// 'test-step'`) or a table row (`via: 'coverage-map'`); else the clause's
// text quoted there, compared backtick-stripped, whitespace-collapsed,
// case-folded, trailing punctuation dropped (`via: 'quoted-text'`); else
// `uncovered`. An id matches only whole — `AC2.1` never matches inside
// `AC2.10` — and a bare item number (`AC2`) covers nothing. `unparsed` passes
// through from the spec parser untouched: a clause it could not read is
// never reported as covered.
function normalizeQuote(text) {
  return text.replace(/`/g, '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.;:,]+$/, '');
}

function checkE(specText, planText) {
  const { clauses, unparsed } = extractAcceptanceClauses(specText);
  const { waivers, testSteps, mapRows } = extractCoverageSources(planText);
  const reasons = new Map();
  for (const { id, reason } of waivers) if (!reasons.has(id)) reasons.set(id, reason);
  const stepText = testSteps.join('\n');
  const rowText = mapRows.join('\n');
  const stepQuote = normalizeQuote(stepText);
  const rowQuote = normalizeQuote(rowText);
  const covered = [];
  const uncovered = [];
  const waived = [];
  for (const { id, text } of clauses) {
    if (reasons.has(id)) {
      waived.push({ id, reason: reasons.get(id) });
      continue;
    }
    const idRe = new RegExp(`\\b${id.replace('.', '\\.')}(?!\\d)`);
    const quote = normalizeQuote(text);
    if (idRe.test(stepText)) covered.push({ id, via: 'test-step' });
    else if (idRe.test(rowText)) covered.push({ id, via: 'coverage-map' });
    else if (stepQuote.includes(quote) || rowQuote.includes(quote)) covered.push({ id, via: 'quoted-text' });
    else uncovered.push({ id, clause: text });
  }
  return {
    ok: true, uncovered, waived, unparsed, covered,
  };
}
```

Change the export list's first line from `checkA, checkB, checkC, checkD, headroomCheck, looksPassing, isGovernedMdPath,` to `checkA, checkB, checkC, checkD, checkE, headroomCheck, looksPassing, isGovernedMdPath,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/plan-audit/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/plan-audit/checks.js tests/bin-lib/plan-audit/checks.test.js
git commit -m "Add Check E to plan-audit's checks — warn-only AC clause coverage, refs #3099"
```

---

### Task 4: `--spec` flag and the `checkE` envelope key

**Files:**
- Modify: `plugin/bin/lib/plan-audit/args.js` (`USAGE`, `parseArgs`)
- Modify: `plugin/bin/plan-audit.js` (header comment, `checkE` import, summary line, spec read, envelope)
- Modify: `docs/plugin-structure.md:202` (the `plan-audit.js` CLI line — a restated USAGE mirror)
- Test: `tests/bin-lib/plan-audit/cli.test.js` (append)

**Interfaces:**
- Consumes: `checkE(specText, planText)` (Task 3).
- Produces: `parseArgs` returns `{planFile, repoRoot, spec, countTasks, bytes}` (`spec`: `string | null`); `USAGE === 'usage: plan-audit.js <plan-file> [--repo-root <dir>] [--spec <spec-file>] [--count-tasks] [--bytes]'`; envelope key `checkE` (last key); summary fragments `Check E: {N} uncovered AC clause(s)` and `Check E: {N} unparsed AC item(s)`. Task 5's flag-mirror test reads `USAGE` and `docs/plugin-structure.md`.

- [ ] **Step 1: Write the failing test**

Append to `tests/bin-lib/plan-audit/cli.test.js` (reuses the file's `CLI`, `makeTmpRepo`, `writePlan`, `fs`, `path`, `execFileSync`):

```js

// ── #3099 — --spec and Check E in the envelope ──────────────────────────────
const CLI_E_SPEC = [
  '## Acceptance Criteria',
  '',
  '1. The report renders.',
  '2. Each recipient gets one row. A recipient with several instances counts once; the total equals the recipient count.',
  '',
].join('\n');

function cliEPlan(extraLines = []) {
  return [
    ...extraLines,
    '### Task 1: Do a thing',
    '**Files:**',
    '- Modify: `plugin/bin/existing.js`',
    '',
    '- [ ] **Step 1: Write the failing test**',
    '',
    "test('AC1.1 AC2.1 AC2.2: rows render', () => {});",
  ].join('\n');
}

function makeERepo() {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'plugin', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plugin', 'bin', 'existing.js'), '// existing\n');
  return repo;
}

function runCliArgs(args) {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    return { exitCode: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

test('AC1.1 + AC5.2 (#3099): --spec reports the dropped clause AC2.3 with its text, and the audit still exits 0', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan());
    const spec = path.join(repo, 'spec.md');
    fs.writeFileSync(spec, CLI_E_SPEC);
    const { exitCode, stdout } = runCliArgs([plan, '--repo-root', repo, '--spec', spec]);
    assert.strictEqual(exitCode, 0);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.checkE.ok, true);
    assert.deepStrictEqual(report.checkE.uncovered, [{ id: 'AC2.3', clause: 'the total equals the recipient count.' }]);
    assert.strictEqual(stdout.split('\n')[1], 'plan-audit: Check E: 1 uncovered AC clause(s).');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC2.1 (#3099): with a Waived AC2.3 line the CLI reports AC2.3 under waived, not uncovered', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan(['Waived AC2.3: counted by the existing totals test', '']));
    const spec = path.join(repo, 'spec.md');
    fs.writeFileSync(spec, CLI_E_SPEC);
    const report = JSON.parse(runCliArgs([plan, '--repo-root', repo, '--spec', spec]).stdout.split('\n')[0]);
    assert.deepStrictEqual(report.checkE.waived, [{ id: 'AC2.3', reason: 'counted by the existing totals test' }]);
    assert.deepStrictEqual(report.checkE.uncovered, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC3.1 (#3099): a spec with no ## Acceptance Criteria section yields a non-empty checkE.unparsed and names it in the summary', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan());
    const spec = path.join(repo, 'spec.md');
    fs.writeFileSync(spec, '# 1: X\n\n## Deliverables\n\n- Do it.\n');
    const { exitCode, stdout } = runCliArgs([plan, '--repo-root', repo, '--spec', spec]);
    assert.strictEqual(exitCode, 0);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.checkE.unparsed.length, 1);
    assert.deepStrictEqual(report.checkE.uncovered, []);
    assert.match(stdout.split('\n')[1], /Check E: 1 unparsed AC item\(s\)/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC4.1 (#3099): without --spec the envelope carries checkE {ok: true, skipped: no-spec}; every other key, the summary, and the exit code match a --spec run', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan());
    const spec = path.join(repo, 'spec.md');
    fs.writeFileSync(spec, '## Acceptance Criteria\n\n1. The report renders.\n');
    const without = runCliArgs([plan, '--repo-root', repo]);
    const withSpec = runCliArgs([plan, '--repo-root', repo, '--spec', spec]);
    const a = JSON.parse(without.stdout.split('\n')[0]);
    const b = JSON.parse(withSpec.stdout.split('\n')[0]);
    assert.deepStrictEqual(a.checkE, { ok: true, skipped: 'no-spec' });
    assert.deepStrictEqual(b.checkE.uncovered, []);
    const { checkE: dropA, ...restA } = a;
    const { checkE: dropB, ...restB } = b;
    assert.deepStrictEqual(restA, restB);
    assert.deepStrictEqual(Object.keys(restA), ['checkA', 'checkB', 'checkC', 'checkD', 'headroom', 'premiseRefs']);
    assert.strictEqual(without.exitCode, 0);
    assert.strictEqual(withSpec.exitCode, 0);
    assert.strictEqual(without.stdout.split('\n')[1], 'plan-audit: clean — no findings.');
    assert.strictEqual(withSpec.stdout.split('\n')[1], 'plan-audit: clean — no findings.');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC5.1 (#3099): uncovered clauses never fail the audit — a failing Check A still decides the exit code alone', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan().replace('plugin/bin/existing.js', 'does/not/exist.js'));
    const spec = path.join(repo, 'spec.md');
    fs.writeFileSync(spec, CLI_E_SPEC);
    const { exitCode, stdout } = runCliArgs([plan, '--repo-root', repo, '--spec', spec]);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.checkE.ok, true);
    assert.strictEqual(report.checkA.ok, false);
    assert.strictEqual(exitCode, 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('#3099: an unreadable --spec exits 2 naming the file, never a silent skipped envelope', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan());
    const r = runCliArgs([plan, '--repo-root', repo, '--spec', path.join(repo, 'nope.md')]);
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /cannot read spec file/);
    assert.strictEqual(r.stdout, '');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('#3099: --spec with no value, or beside --bytes or --count-tasks, is a usage error (exit 2)', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan());
    const spec = path.join(repo, 'spec.md');
    fs.writeFileSync(spec, CLI_E_SPEC);
    for (const args of [[plan, '--spec'], [plan, '--spec', spec, '--bytes'], [plan, '--count-tasks', '--spec', spec]]) {
      const r = runCliArgs(args);
      assert.strictEqual(r.exitCode, 2, `expected exit 2 for ${args.slice(1).join(' ')}`);
      assert.match(r.stderr, /usage: plan-audit\.js .*--spec <spec-file>/);
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/plan-audit/cli.test.js`
Expected: FAIL after Step 1 — the 7 new tests fail (`--spec` is an `unknown flag`, exit 2, so `report.checkE` is undefined / the JSON parse throws); the file's existing tests still pass (append-shaped).

- [ ] **Step 3: Write minimal implementation**

`plugin/bin/lib/plan-audit/args.js` — replace the whole file body below the header comment with:

```js
'use strict';

class UsageError extends Error {}

const USAGE = 'usage: plan-audit.js <plan-file> [--repo-root <dir>] [--spec <spec-file>] [--count-tasks] [--bytes]';

// argv = process.argv.slice(2). Throws UsageError on any malformed input —
// the CLI prints message + USAGE to stderr and exits non-zero.
function parseArgs(argv) {
  let planFile = null;
  let repoRoot = null;
  let spec = null;
  let countTasks = false;
  let bytes = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--repo-root') {
      const value = argv[i + 1];
      i++;
      if (value === undefined) throw new UsageError('--repo-root requires a value');
      repoRoot = value;
      continue;
    }
    if (flag === '--spec') {
      const value = argv[i + 1];
      i++;
      if (value === undefined) throw new UsageError('--spec requires a value');
      spec = value;
      continue;
    }
    if (flag === '--count-tasks') { countTasks = true; continue; }
    if (flag === '--bytes') { bytes = true; continue; }
    if (flag.startsWith('--')) throw new UsageError(`unknown flag: ${flag}`);
    if (planFile !== null) throw new UsageError(`unexpected extra positional argument: ${flag}`);
    planFile = flag;
  }
  if (planFile === null) throw new UsageError('plan-file is required');
  // #3099: --spec feeds Check E, which only the full audit runs — beside a
  // single-purpose verb it would be silently ignored, so refuse the pairing.
  if (spec !== null && (countTasks || bytes)) {
    throw new UsageError('--spec cannot be combined with --count-tasks or --bytes');
  }
  return {
    planFile, repoRoot, spec, countTasks, bytes,
  };
}

module.exports = { parseArgs, UsageError, USAGE };
```

`plugin/bin/plan-audit.js` — five edits:

1. Header comment: replace
```
// live entirely in plugin/skills/build/plan-audit.md. Exit 0 iff every check
// is ok (a `nearCeiling` headroom flag alone does not fail). `--count-tasks`
```
with
```
// live entirely in plugin/skills/build/plan-audit.md, and the warn-only Check E
// (#3099, AC clause coverage — runs only with `--spec`). Exit 0 iff every
// gating check is ok (a `nearCeiling` headroom flag, or any Check E entry,
// alone does not fail). `--count-tasks`
```
2. Import: `checkA, checkB, checkC, checkD, headroomCheck, checkPremiseRefs,` → `checkA, checkB, checkC, checkD, checkE, headroomCheck, checkPremiseRefs,`.
3. In `summaryLine`, directly after the `Premise-refs:` line, add:
```js
  // #3099: warn-only — named in the summary, never part of the pass verdict.
  if (!report.checkE.skipped) {
    if (report.checkE.uncovered.length) parts.push(`Check E: ${report.checkE.uncovered.length} uncovered AC clause(s)`);
    if (report.checkE.unparsed.length) parts.push(`Check E: ${report.checkE.unparsed.length} unparsed AC item(s)`);
  }
```
4. In `main()`, directly above `const repoRoot = resolveRepoRoot(parsed.repoRoot, process.cwd());`, add:
```js
  // #3099: an unreadable --spec is the same exit-2 file-read error as an
  // unreadable plan — never a silent fall back to `skipped: 'no-spec'`.
  let specText = null;
  if (parsed.spec !== null) {
    try {
      specText = fs.readFileSync(parsed.spec, 'utf8');
    } catch (err) {
      process.stderr.write(`plan-audit.js: cannot read spec file ${parsed.spec}: ${err.message}\n`);
      process.exitCode = 2;
      return;
    }
  }

```
5. In the `report` object, after `premiseRefs: checkPremiseRefs(premiseRefs, repoRoot),` add:
```js
    checkE: specText === null ? { ok: true, skipped: 'no-spec' } : checkE(specText, text),
```
Leave the `pass` expression untouched — it must not read `checkE`.

`docs/plugin-structure.md:202` — two in-line replacements on that one line:
- `node plugin/bin/plan-audit.js <plan-file> [--repo-root <dir>] [--count-tasks] [--bytes]   # Plan-audit CLI — the mechanized half of \`plugin/skills/build/plan-audit.md\`'s Checks A/B/C/D plus the size-headroom check (#903, #1999, #2000), replacing` → `node plugin/bin/plan-audit.js <plan-file> [--repo-root <dir>] [--spec <spec-file>] [--count-tasks] [--bytes]   # Plan-audit CLI — the mechanized half of \`plugin/skills/build/plan-audit.md\`'s Checks A/B/C/D plus the size-headroom check (#903, #1999, #2000) and the warn-only Check E (#3099 — acceptance-criterion clause coverage, run only with \`--spec\`; \`checkE\` is \`{ok: true, skipped: 'no-spec'}\` without it and never affects the exit code), replacing`
- `prints one compact JSON line \`{checkA, checkB, checkC, checkD, headroom}\`` → `prints one compact JSON line \`{checkA, checkB, checkC, checkD, headroom, premiseRefs, checkE}\``
- `2 malformed invocation or an unreadable plan file (` → `2 malformed invocation or an unreadable plan or \`--spec\` file (`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/plan-audit/*.test.js`
Expected: PASS — all plan-audit suites (Task 1-3's additions plus these 7).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/plan-audit/args.js plugin/bin/plan-audit.js docs/plugin-structure.md tests/bin-lib/plan-audit/cli.test.js
git commit -m "Thread --spec through plan-audit.js — checkE envelope key, skipped no-spec default, exit code unchanged, refs #3099"
```

---

### Task 5: Build wiring — plan-audit.md and SKILL.md Common Step 1.5

**Files:**
- Modify: `plugin/skills/build/plan-audit.md` (lines 3, 10, 13, the Result-interpretation list, "What each check covers", the skip-gate paragraph)
- Modify: `plugin/skills/build/SKILL.md:182` (Common Step 1.5 invocation sentence only)
- Create: `tests/plan-audit-check-e-prose.test.js`

**Interfaces:**
- Consumes: `USAGE` from `plugin/bin/lib/plan-audit/args.js` and the updated `docs/plugin-structure.md:202` line (Task 4) — the flag-mirror test fails until Task 4 has landed.
- Produces: nothing code-level.

- [ ] **Step 1: Write the failing test**

Create `tests/plan-audit-check-e-prose.test.js`:

```js
// tests/plan-audit-check-e-prose.test.js — pins #3099's build wiring for
// plan-audit.js Check E: plugin/skills/build/plan-audit.md documents the
// coverage rule, the waiver line, the Result-interpretation handling, and the
// skip-gate ruling; build/SKILL.md Common Step 1.5 passes --spec. Reads the
// live skill files — this pins prose we just wrote, not a third-party fact
// (skill-prose-conformance-tests' live-vs-fixture distinction), mirroring
// tests/plan-audit-skip-sentence-bytes-prose.test.js. The flag-mirror test
// reads args.js's USAGE as the code twin the three invocation lines restate.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PLAN_AUDIT = read('plugin/skills/build/plan-audit.md');
const SKILL = read('plugin/skills/build/SKILL.md');
const { USAGE } = require('../plugin/bin/lib/plan-audit/args');

function step15() {
  const start = SKILL.indexOf('### Common Step 1.5: Plan Audit');
  const end = SKILL.indexOf('### Common Step 1.7');
  assert.ok(start !== -1 && end > start, 'Common Step 1.5 section not found');
  return SKILL.slice(start, end);
}

function bullet(text, label) {
  const line = text.split('\n').find((l) => l.startsWith(`- **${label}**`));
  assert.ok(line, `bullet "- **${label}**" not found`);
  return line;
}

function flags(s) {
  return [...new Set(s.match(/--[a-z][a-z-]*/g))].sort();
}

test('AC6.1 (#3099): plan-audit.md "What each check covers" states Check E\'s coverage rule and waiver line', () => {
  const line = bullet(PLAN_AUDIT, 'Check E');
  assert.match(line, /`AC\{item\}\.\{clause\}`/);
  assert.match(line, /test step/);
  assert.match(line, /`Waived AC\{item\}\.\{clause\}: \{reason\}`/);
  assert.match(line, /warn-only/);
  assert.match(line, /`unparsed`, never in `covered`/);
});

test('AC6.1 (#3099): plan-audit.md Result interpretation handles checkE.uncovered and checkE.unparsed', () => {
  const uncovered = bullet(PLAN_AUDIT, '`checkE.uncovered`');
  assert.match(uncovered, /amends the plan before dispatch/);
  assert.match(uncovered, /`Waived \{id\}: \{reason\}`/);
  assert.match(uncovered, /log-decision\.js" --run "\$PIPELINE_RUN_DIR" --status AUTO/);
  const unparsed = bullet(PLAN_AUDIT, '`checkE.unparsed`');
  assert.match(unparsed, /Never treat it as covered/);
  assert.match(unparsed, /--status SCANNED/);
});

test('#3099: plan-audit.md records the skip-gate ruling — Check E shares the A/B/C/headroom gate', () => {
  assert.match(PLAN_AUDIT, /\*\*Check E shares that gate too\*\* \(#3099's ruling\)/);
});

test('AC6.2 (#3099): build/SKILL.md Common Step 1.5 passes --spec when a materialized spec exists', () => {
  const section = step15();
  assert.match(section, /\[--spec \{spec-file\}\]/);
  assert.match(section, /When a materialized spec exists \(record mode\), pass it as `--spec \{spec-file\}`/);
  assert.match(section, /Check E/);
});

test('#3099: every restated plan-audit.js invocation names exactly the flags USAGE names', () => {
  const usageFlags = flags(USAGE);
  assert.ok(usageFlags.includes('--spec'), 'USAGE lost --spec');
  const fence = PLAN_AUDIT.match(/## Invocation\s+```bash\n([^\n]+)\n```/);
  assert.ok(fence, 'plan-audit.md Invocation fence not found');
  assert.deepStrictEqual(flags(fence[1]), usageFlags);
  const skillLine = step15().split('\n').find((l) => l.startsWith('Audit the plan against the actual repo'));
  assert.ok(skillLine, 'Common Step 1.5 invocation line not found');
  assert.deepStrictEqual(flags(skillLine.match(/`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/plan-audit\.js"[^`]*`/)[0]), usageFlags);
  const structure = read('docs/plugin-structure.md').split('\n').find((l) => l.startsWith('node plugin/bin/plan-audit.js'));
  assert.ok(structure, 'docs/plugin-structure.md plan-audit.js line not found');
  assert.deepStrictEqual(flags(structure.split('#')[0]), usageFlags);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plan-audit-check-e-prose.test.js`
Expected: FAIL — the four AC6/skip-gate tests fail on missing bullets and phrases; the flag-mirror test fails on the plan-audit.md fence (no `--spec`) once Task 4 has landed (before Task 4, on `USAGE lost --spec`).

- [ ] **Step 3: Write minimal implementation**

`plugin/skills/build/plan-audit.md` — six edits:

1. Line 3: replace `Check D (control-byte scan), and the headroom check — are mechanized in \`plugin/bin/plan-audit.js\` (#903);` with `Check D (control-byte scan), and the headroom check — plus the warn-only Check E (acceptance-criterion clause coverage, #3099) are mechanized in \`plugin/bin/plan-audit.js\` (#903);`
2. Invocation fence (line 10): `{plan-file} [--repo-root {dir}] [--count-tasks] [--bytes]` → `{plan-file} [--repo-root {dir}] [--spec {spec-file}] [--count-tasks] [--bytes]`
3. Line 13: `a compact JSON envelope (\`{checkA, checkB, checkC, checkD, headroom}\`, each` → `a compact JSON envelope (\`{checkA, checkB, checkC, checkD, headroom, premiseRefs, checkE}\`, each`; then append a new paragraph directly after line 13 (blank line before it):

```
`--spec {spec-file}` adds Check E. Pass the materialized `work/{n}-spec.md` this build read at Spec Step 1 — in `worktree` mode, the worktree's own copy at that relative path (`flow/materialize.md`: `work/` is the tracked exception that stays in the worktree), not `"$PIPELINE_RUN_DIR"/work/…`, which resolves to the main checkout and holds no `work/` until merge; in `current-branch` mode the two are the same file. Design-doc mode has no materialized spec and omits the flag. Without `--spec`, `checkE` is `{ok: true, skipped: 'no-spec'}`. An unreadable `--spec` file exits `2` (the plan file's error path, never a silent `skipped`), and `--spec` beside `--count-tasks` or `--bytes` is a usage error (exit `2`).
```

4. Result interpretation: insert these three bullets immediately above the `- **\`checkB.ok === false\`**` bullet:

```
- **`checkE.uncovered`** (`[{id, clause}, ...]`, `ok` always `true`) — never a stop, and never routed through the `scope-creep` policy: the plan author amends the plan before dispatch. For each entry, either cite `{id}` in the test step that covers that clause, or add a line `Waived {id}: {reason}` when the plan deliberately leaves it untested; then re-run the audit once. In auto mode the amendment needs no prompt — log it to whatever run dir resolves (`_shared/run-dir-resolution.md`): `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --section "/build" --step "Common Step 1.5 (Check E)" --text "amended plan for {N} uncovered AC clause(s) — cited {ids}; waived {ids}" --reversibility high`. In interactive mode, surface the amendment inline — no `AskUserQuestion`.
- **`checkE.unparsed`** (`[{item, raw}, ...]`, `item` null for a section-level entry) — informational-but-visible, never a stop: spec text Check E could not split (no `## Acceptance Criteria` section or an empty one, an item with an unbalanced code span or a fenced block, stray prose beside the list). Never treat it as covered (`parse-signal-discipline`): surface each entry inline, check those criteria against the plan by reading, and log the scan — same command with `--status SCANNED --text "Check E: {N} unparsed AC item(s) — checked by reading" --reversibility n/a`.
- **`checkE.waived`** / **`checkE.covered`** (`[{id, reason}, ...]` / `[{id, via}, ...]`, `via` one of `test-step`, `coverage-map`, `quoted-text`) — informational: with `uncovered` they account for every clause the spec parser produced. A `quoted-text` match is the weakest of the three; prefer converting it to an id citation when amending anyway.
```

5. "What each check covers": append this bullet as the list's last bullet — directly after the `- **Headroom**` bullet:

```
- **Check E** (`--spec` only; warn-only — `ok` is always `true`, so it never changes the exit code: clause splitting is a prose heuristic, and a hard gate would block builds on its false positives) — reads the spec's `## Acceptance Criteria` section: one item per top-level list line (a `[ ]` checkbox stripped), or one per paragraph when the section has no list at all; each item split into clauses on sentence ends and `;`, never inside a code span, after an abbreviation such as `e.g.`, or inside parentheses. Ids are `AC{item}.{clause}`, both 1-based, item being the criterion's position in the section. A clause is **waived** by a plan line `Waived AC{item}.{clause}: {reason}`; otherwise **covered** when its id appears in a task's test step (a `**Step N: …**` sub-step whose title names a test or a verification) or in a markdown table row — a spec-coverage map, accepted when an author writes one, though the installed `/superpowers:writing-plans` template carries none — or when its text is quoted there; otherwise **uncovered**. A bare criterion number (`AC2`) covers no clause: #3099's incident was a criterion counted covered once any task cited its number, while one of its three clauses had no test. Anything the splitter cannot read lands in `unparsed`, never in `covered`.
```

(Placement: the list order today is Check A, B, C, D, Headroom; put Check E as the last bullet, directly after `- **Headroom**`, immediately before the blank line that precedes the `Check A/B/C and the headroom check all share…` paragraph.)

6. Skip-gate paragraph: replace `— none of them introduces a new skip condition of its own. **Check D is the one exception**:` with `— none of them introduces a new skip condition of its own. **Check E shares that gate too** (#3099's ruling): like Check D it reads only text already in memory, but it is warn-only, so skipping it on a trivial plan loses a warning, never a stop — unlike a raw NUL, which is fatal at any size. The skip path's \`--bytes\` call therefore stays Check D alone (\`--spec\` beside \`--bytes\` is a usage error). **Check D is the one exception**:`

`plugin/skills/build/SKILL.md:182` — replace `{plan-file} [--repo-root {dir}] [--count-tasks] [--bytes]\` — a mechanized CLI (#903), not hand-run greps. Five checks:` with `{plan-file} [--repo-root {dir}] [--spec {spec-file}] [--count-tasks] [--bytes]\` — a mechanized CLI (#903), not hand-run greps. When a materialized spec exists (record mode), pass it as \`--spec {spec-file}\` — in worktree mode the worktree's copy of \`work/{n}-spec.md\`, since \`$PIPELINE_RUN_DIR\` holds no \`work/\` — to add the warn-only Check E, AC-clause coverage (\`plan-audit.md\`). Five checks:` — nothing else in SKILL.md changes (the five-bullet list stays the five gating checks; the skip sentence at line 191 is untouched, so `tests/plan-audit-skip-sentence-bytes-prose.test.js` stays green).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/plan-audit-check-e-prose.test.js tests/plan-audit-skip-sentence-bytes-prose.test.js tests/bin-lib/skill-audit/*.test.js`
Expected: PASS. Then the byte and count checks, each with its expected output:
- `wc -c plugin/skills/build/SKILL.md plugin/skills/build/plan-audit.md` → SKILL.md 45,747 (≤ 46,079, below the warn tier), plan-audit.md 21,250 (± a few bytes).
- Renumbering, three forms: `grep -n "Five checks\|five deterministic checks" plugin/skills/build/SKILL.md plugin/skills/build/plan-audit.md` → exactly the two existing hits (SKILL.md:182, plan-audit.md:3), both still true because Check E is described as an addition, not a sixth gating check; `grep -rn "six checks\|Six checks\|six deterministic" plugin/skills/build/` → no output; `grep -c "Check E" plugin/skills/build/plan-audit.md` → at least 6.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/plan-audit.md plugin/skills/build/SKILL.md tests/plan-audit-check-e-prose.test.js
git commit -m "Wire Check E into /build Common Step 1.5 — --spec invocation, result handling, skip-gate ruling, refs #3099"
```

---

### Task 6: Plan-authoring rule — cite AC clause ids

**Files:**
- Modify: `plugin/skills/build/plan-authoring-checks.md` (append one paragraph at the end of the file)
- Create: `tests/plan-authoring-ac-clause-ids-prose.test.js`

**Interfaces:**
- Consumes: nothing (the paragraph names `plan-audit.js --spec`, shipped by Task 4, but the test reads only this file).
- Produces: nothing code-level.

- [ ] **Step 1: Write the failing test**

Create `tests/plan-authoring-ac-clause-ids-prose.test.js`:

```js
// tests/plan-authoring-ac-clause-ids-prose.test.js — pins #3099's
// plan-authoring rule: plugin/skills/build/plan-authoring-checks.md tells
// plan authors to cite AC{item}.{clause} ids so plan-audit.js Check E matches
// coverage by id. Reads the live skill file (prose we just wrote — the
// skill-prose-conformance-tests live-vs-fixture distinction). The paragraph
// is located by its bold label, then every assertion runs on that paragraph
// alone, so a token elsewhere in the file can never satisfy it.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TEXT = fs.readFileSync(
  path.join(__dirname, '..', 'plugin', 'skills', 'build', 'plan-authoring-checks.md'),
  'utf8',
);

function paragraph() {
  const hits = TEXT.split(/\r?\n\r?\n/).filter((p) => p.startsWith('**Acceptance-criterion clause-id check:**'));
  assert.strictEqual(hits.length, 1, 'expected exactly one Acceptance-criterion clause-id check paragraph');
  return hits[0];
}

test('AC7.1 (#3099): plan-authoring-checks.md tells plan authors to cite AC{item}.{clause} ids in the test step', () => {
  const p = paragraph();
  assert.match(p, /cite every clause of the spec's `## Acceptance Criteria` by its id, `AC\{item\}\.\{clause\}`, in the test step/);
  assert.match(p, /`plan-audit\.js \{plan\} --spec \{spec\}`/);
  assert.match(p, /`Waived AC\{item\}\.\{clause\}: \{reason\}`/);
  assert.match(p, /\(`AC2`\) covers none of its clauses/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plan-authoring-ac-clause-ids-prose.test.js`
Expected: FAIL — `expected exactly one Acceptance-criterion clause-id check paragraph` (0 found).

- [ ] **Step 3: Write minimal implementation**

Append this paragraph to the end of `plugin/skills/build/plan-authoring-checks.md`, after the `**Dependency-caller enumeration check …**` paragraph, separated by one blank line (the file ends with a single trailing newline today — keep exactly one):

```
**Acceptance-criterion clause-id check:** cite every clause of the spec's `## Acceptance Criteria` by its id, `AC{item}.{clause}`, in the test step that covers it — the test's own name is the natural place (`test('AC2.3: counts each recipient once', …)`). The item is the criterion's 1-based position in the section; the clause is its 1-based position once the item is split on sentence ends and `;`. Run `plan-audit.js {plan} --spec {spec}` while authoring: `checkE.uncovered` lists every clause no test step cites, with its id and text. Citing a criterion by its number alone (`AC2`) covers none of its clauses, and that is the gap this check closes: the incident behind #3099 was a criterion carrying three clauses, a plan that tested two, and a dropped clause that was the only test of a counting invariant a correctness proof rested on — `plan-audit.js` passed, and only the whole-branch review caught it, at the cost of a fix dispatch and a scoped re-review. A clause the plan deliberately leaves untested gets its own line, `Waived AC{item}.{clause}: {reason}`. A spec-coverage map table row naming the id also counts, and quoting the clause text is a fallback, but an id survives rewording, so prefer it.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/plan-authoring-ac-clause-ids-prose.test.js tests/bin-lib/skill-audit/*.test.js`
Expected: PASS. `wc -c plugin/skills/build/plan-authoring-checks.md` → about 27,135 (well under 46,080).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/plan-authoring-checks.md tests/plan-authoring-ac-clause-ids-prose.test.js
git commit -m "Add the AC clause-id plan-authoring check — cite AC{item}.{clause} in test steps, refs #3099"
```

---

### Task 7: Check B excludes the audited plan file itself (fix-now, pre-existing in-diff defect)

Routed through `_shared/deferral-gate.md`'s fix-now test by the controller: `plugin/bin/plan-audit.js` is in this build's diff (Task 4), the fix is one call site plus one test, and "pre-existing" alone is not a defer reason for an in-diff file. Today Check B's fs-walk reaches `docs/superpowers/plans/`, so every plan carrying a `Scope keywords:` line reports itself as unplanned and the audit exits 1 for that reason alone (this plan's own authoring-time run hit it).

**Files:**
- Modify: `plugin/bin/plan-audit.js` (the `checkB(...)` call: add the audited plan file to the planned set)
- Test: `tests/bin-lib/plan-audit/cli.test.js`

- [ ] **Step 1: Failing test** — add a CLI test: a temp repo whose plan file carries `Scope keywords: zebrakeyword` and whose text contains `zebrakeyword`, with one planned file that also contains it and no other file containing it. Run `plan-audit.js {plan} --repo-root {tmp}` and assert `checkB.unplanned` is `[]` and exit code is `0`. Also assert a second, unplanned file containing the keyword still appears in `checkB.unplanned` (the fix must not hide real unplanned files).
- [ ] **Step 2: Run** `node --test tests/bin-lib/plan-audit/cli.test.js` — Expected: FAIL (the plan file itself is reported unplanned).
- [ ] **Step 3: Implement** — in `plugin/bin/plan-audit.js`, pass the plan file into Check B's planned set: `checkB(scopeKeywords, [...entries.map((e) => e.path), path.relative(repoRoot, path.resolve(parsed.planFile))], repoRoot)` (resolve the plan path the same way the file already resolves `--repo-root`; `checkB` resolves planned paths against `repoRoot`, so an absolute plan path must be made repo-relative or absolute consistently). `checks.js`'s `checkB` signature is unchanged.
- [ ] **Step 4: Run** `node --test tests/bin-lib/plan-audit/*.test.js` — PASS. Then re-run `node plugin/bin/plan-audit.js docs/superpowers/plans/2026-10-16-plan-audit-check-e-ac-clause-coverage-3099.md` — Expected: `checkB.unplanned` `[]`, exit 0.
- [ ] **Step 5: Commit** — `refs #3099`.

---

### Task 8: Real-input probe and full suite

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything above.
- Produces: the recorded probe numbers below, pasted into the task report.

- [ ] **Step 1: Run the verification probes**

Dogfood — this plan against this spec (from the worktree root):

Run: `node plugin/bin/plan-audit.js docs/superpowers/plans/2026-10-16-plan-audit-check-e-ac-clause-coverage-3099.md --spec .claude-tweaks/pipelines/2026-10-16T171437-spec-3099/work/3099-spec.md`
Expected: `checkE.uncovered` `[]`, `checkE.unparsed` `[]`, `checkE.covered` lists all 10 ids `AC1.1 AC2.1 AC3.1 AC4.1 AC5.1 AC5.2 AC6.1 AC6.2 AC7.1 AC8.1`, each `via: 'test-step'`; exit 0. (Authoring-time run of the same code from a scratch copy printed exactly this.)

Corpus probe — the splitter over every materialized spec in the worktree (an fs walk, no `git` call, so a worktree-isolation guard has nothing to refuse; Node 20+'s recursive `readdirSync`; run from the worktree root):

```bash
node -e "const fs=require('fs');const {extractAcceptanceClauses}=require('./plugin/bin/lib/plan-audit/parser');const root='.claude-tweaks/pipelines';const files=fs.readdirSync(root,{recursive:true}).filter(f=>/work\/[^/]*-spec\.md$/.test(f));let c=0,u=0,s=0;for(const f of files){const r=extractAcceptanceClauses(fs.readFileSync(root+'/'+f,'utf8'));c+=r.clauses.length;u+=r.unparsed.length;if(r.unparsed.length)s++;}console.log(JSON.stringify({files:files.length,clauses:c,unparsedEntries:u,specsWithUnparsed:s}))"
```

Expected (authoring-time, 1,267 files at `a9acbef20`): `{"files":1267,"clauses":6345,"unparsedEntries":40,"specsWithUnparsed":36}` — 4 no-section (all in the 2026-08-15 multi-spec archive), 32 stray-prose entries (tables, `Refs #…`, `**Related:**` lines, build-time verification notes), 4 refused items (odd backtick counts from escaped backticks / `` $` ``). A later commit may add files; the ratios, not the exact counts, are the check. Independent count, reconciled at authoring time: 4,913 list-item lines + 217 prose-only paragraphs = 5,130 = 5,126 items split + 4 refused, 0 per-spec mismatches.

- [ ] **Step 2: Run the full suite (AC8.1: `npm test` passes)**

Run: `npm test > "$TMPDIR/npm-test-3099.txt" 2>&1; echo "exit=$?"; grep -E "^ℹ (tests|pass|fail)" "$TMPDIR/npm-test-3099.txt"` (one Bash call — a file written in one call may not survive into the next)
Expected: `exit=0`, `ℹ fail 0`. Quote the raw `ℹ` lines in the report — never a paraphrase. A failure count that changes run-to-run on unchanged code is machine load (CLAUDE.md): re-run only the failing files in isolation before concluding anything.

- [ ] **Step 3: No commit** — nothing changed in this task.

---

## Plan-Authoring Checks

**Plan-authoring check (return-shape widening):** the envelope widens with `checkE` and `parser.js`/`checks.js` gain exports. `grep -rn "Object.keys(report)\|deepStrictEqual(JSON.parse" tests/bin-lib/plan-audit/` finds only `--bytes`'s `{checkD}` comparison (`cli.test.js:378`), a code path Task 4 does not touch (`--spec` beside `--bytes` is refused before it). Literal counts derived from the envelope: SKILL.md:182 "Five checks:" and plan-audit.md:3 "The five deterministic checks" — both kept true by describing Check E as an addition (Task 5 renumbering greps). New Task 4 test pins `Object.keys` of the non-`checkE` envelope so a future widening is noticed.

**Blocking-verification-downgrade check:** the spec's one live-contract verification — whether `/superpowers:writing-plans` emits a "Spec coverage map" — was run against the installed upstream file, not downgraded: `grep -n -i coverage ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/writing-plans/SKILL.md` → only line 157, the self-review "Spec coverage" step. Decision 1 records the reversed assumption.

**Deictic-reference re-resolution check:** no text is reordered; Task 5 inserts bullets and one paragraph and rewrites spans in place. Inserted prose uses no "above"/"below". N/A.

**Verbatim-command run-once check:** commands this plan dictates verbatim and their read-only runs: `node plugin/bin/log-decision.js --help` printed `usage: log-decision.js --run <run-dir> --status AUTO|STAGED|KEPT-PROMPT|SCANNED|REFUSED|SKIP --text "..." [--spec <n>] [--step <text>] [--reversibility high|med|low|n/a] [--lever "<k>=<v> (<source>)"] [--section "/<skill>"] [--help]` — every flag Task 5's two log-decision commands use (`--run --status AUTO|SCANNED --section --step --text --reversibility high|n/a`) exists; the write itself has no read-only form and is marked as such. `plan-audit.js … --spec …` and the corpus `node -e` probe were run against a scratch copy carrying this plan's exact code (results in Task 7). `node --test tests/bin-lib/plan-audit/*.test.js` ran there: 135/135 pass.

**Degrade-clause convention check:** new unavailability clauses — "design-doc mode has no materialized spec and omits the flag", "standalone with no run dir" — cite the established convention: logging goes "to whatever run dir resolves (`_shared/run-dir-resolution.md`)", the same citation plan-audit.md's Check B auto-mode branch already uses. The unreadable-spec exit 2 reuses the plan file's documented error path.

**Copied-config re-derivation check:** nothing is copied from an existing file as a starting point. N/A.

**Renumbering-completeness check:** no numbered structure gains a row, but two prose counts restate the check set. Task 5 Step 4 carries all three forms: the number/word (`Five checks`, `five deterministic checks`), the category list (`grep -c "Check E"`), and a cardinal-word sweep for a stray `six`.

**Batched-plan marker.** Not batched — seven independently reviewed tasks; no `**Execution:** batched` marker, no `[batch]` titles.

**Behavioral-claim check:** claims with their mechanism: "`$PIPELINE_RUN_DIR` holds no `work/`" — `flow/materialize.md:155,170` plus the `ls` probe in Decision 2; "the installed writing-plans template carries none" — the grep above; "Check E never changes the exit code" — `plan-audit.js`'s `pass` expression (left untouched by Task 4, pinned by the AC5.1 CLI test); "an unreadable `--spec` exits 2" — Task 4's new `catch` branch, pinned by its test; "the skip path's `--bytes` call stays Check D alone" — `args.js`'s new pairing refusal, pinned by the usage-error test.

**Byte-pin check:** `grep -rn "byteLength\|wc -c" tests/ | grep -i "build/\|plan-audit\|plan-authoring"` finds no basename pin; `grep -rn "skill === 'build'\|BUILD_.*BYTES" tests/` finds no per-skill ceiling (the `BUILD_SKILL` hits are content reads). Binding ceilings: shared `CEILING_BYTES` 51,200 and the warn tier 46,080. Post-edit sizes measured on a scratch copy of this plan's exact text: `SKILL.md` 45,468 → 45,747 (333 bytes below the warn tier, 5,453 below the ceiling — the minimal edit; no split needed, but the next addition to SKILL.md should plan a split), `plan-audit.md` 17,021 → 21,250, `plan-authoring-checks.md` 25,915 → 27,135. No compose call site sources any of the three (`git grep -n "compose-context.js" -- plugin/skills | grep -i "plan-audit\|plan-authoring\|build/SKILL"` → only `worktree-setup`'s call site, whose sources are the two `worktree-setup.md` files).

**Consumer-timing check:** one pre-gathered value — the `--spec` path. Where it lives at audit time: the worktree's `work/{n}-spec.md` (not the main-checkout run dir — Decision 2, the exact trap the check's own #1930 example names). Freshness: Spec Step 1 writes and commits it before Spec Step 3 writes the plan, and Common Step 1.5 runs after Spec Step 3, so the consumer always runs after the producer. No freshness step applies — the spec does not change during the build.

**Gate-over-producers check:** Check E gates the spec's Acceptance Criteria section. Producers of that section: `/claude-tweaks:specify` (`specify/spec-template.md`'s numbered/bullet list), review/wrap-up-filed records (`specShapedBody` — `- [ ]` checkbox bullets plus an italic `_Filed by … via specShapedBody._` footer), and hand-written records (prose-only paragraphs). Every shape was traced against the real corpus rather than a template: 523 numbered, 616 bullet, 2 mixed, 121 prose-only sections, 0 nested bullets, 0 fences, 3 odd-backtick sections — each has a Task 1 test.

**Sole-site and producer-side check:** `git grep -n "bin/plan-audit.js" -- plugin/skills` → `build/SKILL.md:182` and `:191` (`--bytes`), `build/dispatch.md:19` (`--count-tasks`), `build/plan-audit.md:3,10`. The full-audit invocation therefore lives only at SKILL.md:182 and plan-audit.md:10 — both gain `--spec` in Task 5; `--bytes` and `--count-tasks` callers must not, and Task 4 refuses that pairing. Producer side: the spec Check E reads is produced by Spec Step 1's materialize, which already runs before this step — no upstream step needs extending.

**Real-input probe check:** the finished splitter (scratch copy of Task 1's exact code) was run over all 1,267 tracked `work/*-spec.md` files: 6,345 clauses from 5,126 items, 936 multi-clause items (18%), 40 unparsed entries in 36 specs (2.8%) — numbers pinned in Task 7 Step 1, which re-runs the probe on the built code. The plan was also run against its own spec (Task 7 dogfood).

**Independent-count check:** the extractor's item count was reconciled against a count it did not compute — a per-spec regex count of list-marker lines (or blank-line paragraphs, footers excluded, for list-less sections): 4,913 + 217 = 5,130 = 5,126 split items + 4 refused, with 0 per-spec mismatches. The invariant the parser relies on — one item per top-level list line — is the thing counted.

**Moved-prose pin check:** no prose moves; in-place rewrites touch SKILL.md:182 and plan-audit.md:3, 10, 13 and the skip-gate paragraph. `grep -rln "not hand-run greps\|mechanized CLI (#903)\|compact JSON envelope\|all share Check A/B's existing skip gate\|five deterministic checks\|Check D is the one exception" tests/` → no hits. The only live pin near these lines is `tests/plan-audit-skip-sentence-bytes-prose.test.js` (the SKILL.md:191 skip sentence, untouched); fixed-offset readers `tests/build-micro-plan-conformance.test.js` (Spec Step 3 + 1,200 chars) and `tests/cherry-pick-provenance-prose-conformance.test.js` (from Common Step 2) slice regions that do not include line 182.

**Derived-value probe check:** the one runtime-resolved value is the spec path. The probe used the value the pipeline actually resolves — this run's own `$RUN_ROOT/.claude-tweaks/pipelines/2026-10-16T171437-spec-3099/` — and found no `work/` there, which is what produced Decision 2.

**New-skill suite-set check:** no new skill. N/A.

**Reachability check:** Check E's branch sits behind `--spec`; every CLI test passes `--spec` and asserts on post-gate output (`report.checkE.uncovered` contents, the summary line). Inside `checkE`, each precedence arm is reached by its own test: waiver (incl. the waiver-inside-a-test-step case), `test-step`, `coverage-map`, `quoted-text`, `uncovered`. The no-spec arm is reached by the AC4.1 test.

**Mirror-surface enumeration check:** `plan-audit.js` is a `bin/` CLI, not a skill, so `docs/skill-authoring.md`'s Argument-hint mirror table does not apply; the derivation is the grep `git grep -n -- "--count-tasks" -- ':!docs/superpowers/plans' ':!.claude-tweaks' ':!CHANGELOG.md'`, whose full-flag-list hits are `args.js:7` (USAGE), `plan-audit.md:10`, `SKILL.md:182`, `docs/plugin-structure.md:202`. All four change (Tasks 4-5) and Task 5's flag-mirror test pins them equal to `USAGE`. `docs/journeys/add-a-fast-lane-skip-to-the-roster-1926.md:28` restates only a `--count-tasks` call, not the flag list — unchanged.

**Inline self-consistency check:** every Step 1 test and Step 3 implementation in this plan was run together in a scratch copy of `plugin/bin` + `tests/bin-lib/plan-audit` + the three skill files: `node --test tests/bin-lib/plan-audit/*.test.js` → 135 pass / 0 fail (36 new); the two new prose suites → 6 pass against the edited docs and 6/6 fail against the pre-change docs.

**Producer-freshness check:** the consumer (`/build`'s prose passing `--spec`) and the producer (`plan-audit.js` accepting it) both ship in the same `plugin/` payload and resolve through the same `${CLAUDE_PLUGIN_ROOT}`, so neither can reach a session without the other. N/A.

**Upstream-schema premise check:** the one premise about something this project does not own — the writing-plans template's contents — is proven by the quoted line 157 of the installed 6.4.1 file (Decision 1). No `Premise-refs:` line: the proof is a path outside the repo on this machine only, and a sandbox without it would turn `premiseRefs` into an exit-1 finding for a fact already quoted here.

**Consumer-enumeration check:** no task changes which rows an existing reader returns; `extractAcceptanceClauses`/`extractCoverageSources` are new readers with one consumer each (`checkE`). N/A.

**Dependency-caller enumeration check (extends the Consumer-enumeration check):** Task 3 adds a module dependency (`checks.js` now requires `./parser`) and Task 4 adds a filesystem read to `plan-audit.js`'s `main()`. `grep -rln "plan-audit/checks\|plan-audit.js" tests/` → `tests/bin-lib/plan-audit/checks.test.js`, `tests/bin-lib/plan-audit/cli.test.js` (both in this plan's Files); the `require('./parser')` is pure, and the new read fires only when `--spec` is passed, which no existing caller does. No other test module reaches either function.

---

## Self-Review

- **Spec coverage:** Deliverable 1 → Tasks 1-3; Deliverable 2 → Task 1 (unparsed shapes) + Task 3 (pass-through); Deliverable 3 → Task 4; Deliverable 4 → Task 5; Deliverable 5 → Task 6; Deliverable 6 → Tasks 1-4 tests. Every clause id (AC1.1, AC2.1, AC3.1, AC4.1, AC5.1, AC5.2, AC6.1, AC6.2, AC7.1, AC8.1) is cited in a test step; Task 7's dogfood run confirms it mechanically.
- **Placeholders:** none — every code step carries its code, every doc step its replacement text.
- **Type consistency:** `extractAcceptanceClauses` / `extractCoverageSources` / `checkE` / `parseArgs().spec` names and shapes match across Tasks 1-5.
- **Review Focus:** all five lines have a test in the owning task (CRLF — Tasks 1, 2; fenced fixture lines — Task 2; implementation-step citation — Task 3; `AC2.10`/bare `AC2` — Task 3; unreadable `--spec` — Task 4).
- **Gotchas honoured:** code spans and `e.g.` masked before splitting (Task 1); the coverage-map assumption verified and reversed (Decision 1); the micro-plan path skips `plan-audit.js` entirely, so Check E never applies there — by construction, like Check D; the skip-gate ruling recorded in `plan-audit.md` (Decision 3, Task 5).
