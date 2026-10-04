# Argument-Hint Mirror Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the set of places a skill's argument grammar is restated verbatim one canonical home, walk it mechanically for every skill, and retire the counted ("exactly two surfaces") wording.

**Architecture:** The enumeration is a markdown table in `docs/skill-authoring.md` (maintainer-side authoring doc — nothing in `plugin/` needs it at runtime). One test, `tests/argument-hint-mirrors.test.js`, parses that table and, for every skill, runs one extractor per row and compares each extracted grammar string to the canonical `argument-hint` byte-for-byte. The test's extractor registry is pinned set-equal to the table's rows, so the table cannot gain or lose a surface in prose alone. The existing `tests/reference-card-argument-hint.test.js` is consolidated into the walker (its Takes-table parser becomes one extractor); `tests/argument-hint-input.test.js` is kept unchanged in behavior because it checks that `## Input` *documents* each hint leaf, which is coverage, not a mirror.

**Tech Stack:** Node 18+, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-04T135923-record-2772/work/2772-spec.md`

## Global Constraints

- The enumeration lives in exactly one file (`docs/skill-authoring.md`); every other file cites it and none restates the list.
- The comparison is byte-identity with the `argument-hint` value after a surface's own wrapping is removed. Do not loosen it to make a skill pass; a skill that cannot be fixed gets a named, commented `EXCEPTIONS` entry with a reason.
- Commit messages: `{Verb} {what} — {detail}` (imperative, no conventional-commit prefix), ending with the line `Claude-Session: https://claude.ai/code/session_015ZX5aJf9QxottoX6taiskk`. Reference the record as `refs #2772` — never `closes`/`fixes`.
- Never run `git stash`. Run every command in the foreground. One plain command per Bash call (no `&&`, no loops, no heredocs) — the worktree guard refuses compound commands. Use the Edit/Write tools for file changes.
- Work only in `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-2772`; confirm `pwd` and `git rev-parse --show-toplevel` both print that path before each commit. Stage specific files by path, never `git add -A`.
- Use the glob form for a directory of tests (`node --test tests/dir/*.test.js`); a bare directory fails on node 22.

## Review Focus

- A restatement line reworded away from `` `$ARGUMENTS` is parsed as `…` `` must fail loudly, not drop out of the walk as "absent" — Task 1's `an unreadable surface…` test.
- A skill with two reference-card rows where only one is stale must still be reported — the walker compares every extracted value, exercised by Task 1's Takes-only probe (the probe skill, `release`, has two rows).
- A hint containing `|` is stored `\|`-escaped in the card; the live-corpus test covers it (most skills).
- A single-quoted hint (`capture`) must extract the same as a double-quoted one — live corpus, via the shared `extractArgumentHint`.
- A table row whose `Where` cell gains an unescaped `|` must throw at parse time rather than shift columns — `parseEnumeration`'s 6-cell assertion.

## File Structure

| File | Responsibility |
|---|---|
| `docs/skill-authoring.md` | Holds the one enumeration table (new `### Argument-hint mirror surfaces` section) |
| `tests/argument-hint-mirrors.test.js` | Parses the table, walks every skill, pins registry ↔ table, discrimination probes, retirement sweep |
| `plugin/bin/lib/skill-audit/argument-hint.js` | Gains `inputSectionBody` (moved from the Input test so both suites share it) |
| `tests/argument-hint-input.test.js` | Imports `inputSectionBody` instead of defining it |
| `tests/reference-card-argument-hint.test.js` | Deleted — consolidated into the walker |
| five `plugin/skills/*/SKILL.md` | Their stale/abbreviated restatement lines become the full hint |
| `plugin/skills/build/plan-authoring-checks.md`, `.claude/skills/skill-prose-conformance-tests/advanced-proof-patterns.md` | Cite the table instead of restating the list / naming the deleted suite |

---

### Task 1: Enumeration table, shared helper, and the walker

**Files:**
- Modify: `docs/skill-authoring.md` (insert a section after the paragraph that begins `**Adding a mode or argument to an existing argument-dispatched skill:**`, line 17)
- Modify: `plugin/bin/lib/skill-audit/argument-hint.js`
- Modify: `tests/argument-hint-input.test.js`
- Create: `tests/argument-hint-mirrors.test.js`
- Delete: `tests/reference-card-argument-hint.test.js`
- Modify: `tests/specify-batch-input.test.js:9-10` (comment only)
- Modify: `tests/bin-lib/smoke-test/verify-cleanup.test.js:53` (comment only)

**Interfaces:**
- Produces: `inputSectionBody(content: string): string | null` exported from `plugin/bin/lib/skill-audit/argument-hint.js` (text between `## Input` and the next `## ` heading, `null` when there is no `## Input`).
- Produces: in the new test, `const EXCEPTIONS = { … }` (Task 2 empties it) and the `walk`, `readRepoFile`, `ROOT`, `ENUMERATION`, `TABLE_HEADER` bindings (Task 3's appended test uses them).

- [ ] **Step 1: Write the failing test**

Create `tests/argument-hint-mirrors.test.js` with exactly this content:

```js
'use strict';

// Argument-hint mirror-surface walker (#2772).
//
// A skill's argument grammar is restated verbatim in several places. Which
// places is not this file's knowledge: the one enumeration is the
// "Argument-hint mirror surfaces" table in docs/skill-authoring.md, and this
// suite reads that table and walks every row for every skill. EXTRACTORS
// below is only the mechanics of pulling the grammar string out of each
// surface -- the first test pins its keys to the table's rows in both
// directions, so a row added to the table with no extractor fails, and so
// does an extractor whose row was deleted. The count of mirrors was carried
// in a plan author's head twice and was short both times (#679, #2759).
//
// Consolidates tests/reference-card-argument-hint.test.js (#564), whose
// Takes-table parser lives on as the `reference-card-takes` extractor.
// tests/argument-hint-input.test.js stays: it checks that `## Input`
// *documents* every leaf of the hint, which is coverage, not a mirror.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { extractArgumentHint, inputSectionBody } = require('../plugin/bin/lib/skill-audit/argument-hint');
const { listSkillDirs } = require('../plugin/bin/lib/skill-audit/skill-catalog');

const ROOT = path.join(__dirname, '..');
const ENUMERATION = 'docs/skill-authoring.md';
const SECTION_HEADING = '### Argument-hint mirror surfaces';
const TABLE_HEADER = '| Surface | File | Where | Presence |';
const CANONICAL = 'frontmatter';
const PRESENCE = ['required', 'when-present'];
const SKILLS = listSkillDirs(path.join(ROOT, 'plugin'));

const readRepoFile = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Split a markdown table row on unescaped `|` only -- a `\|` inside a cell
// is the markdown escape for a literal pipe (every alternation in a Takes
// cell), never a column delimiter.
function splitRow(line) {
  return line.split(/(?<!\\)\|/).map((c) => c.trim());
}

// The enumeration table, as [{ id, file, presence }]. Shape is asserted, not
// best-effort: a missing heading, a missing table, a row with the wrong cell
// count, or an id/file cell that is not a single code span throws rather
// than yielding a shorter list that would silently narrow the walk.
function parseEnumeration(md) {
  const lines = md.split('\n');
  const heading = lines.indexOf(SECTION_HEADING);
  if (heading === -1) throw new Error(`${ENUMERATION}: no "${SECTION_HEADING}" heading`);
  const header = lines.indexOf(TABLE_HEADER, heading);
  if (header === -1) throw new Error(`${ENUMERATION}: no "${TABLE_HEADER}" table under "${SECTION_HEADING}"`);
  const span = (cell, line) => {
    const m = cell.match(/^`([^`]+)`$/);
    if (!m) throw new Error(`${ENUMERATION}: expected a single code span, got "${cell}" in row: ${line}`);
    return m[1];
  };
  const rows = [];
  for (let i = header + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const cells = splitRow(lines[i]);
    if (cells.length !== 6) throw new Error(`${ENUMERATION}: malformed mirror-surface row (expected 4 cells): ${lines[i]}`);
    rows.push({ id: span(cells[1], lines[i]), file: span(cells[2], lines[i]), presence: cells[4] });
  }
  if (rows.length === 0) throw new Error(`${ENUMERATION}: the mirror-surface table has no rows`);
  return rows;
}

// Only the three `| Command | What it does | Takes |` tables -- the card's
// Artifact Lifecycle table has different columns. A row that does not split
// into exactly 5 cells throws instead of vanishing from the parse (#564).
function parseTakesRows(card) {
  const rows = [];
  let inTable = false;
  let tables = 0;
  for (const line of card.split('\n')) {
    if (line.startsWith('| Command | What it does | Takes |')) {
      inTable = true;
      tables += 1;
      continue;
    }
    if (!inTable) continue;
    if (line.startsWith('|---')) continue;
    if (!line.startsWith('|')) {
      inTable = false;
      continue;
    }
    const cells = splitRow(line);
    if (cells.length !== 5 || cells[0] !== '' || cells[4] !== '') {
      throw new Error(`Malformed Takes-table row (expected 5 cells, got ${cells.length}): ${line}`);
    }
    rows.push({ command: cells[1], takes: cells[3] });
  }
  if (tables !== 3) throw new Error(`Expected exactly 3 "| Command | What it does | Takes |" tables, found ${tables}`);
  return rows;
}

// One extractor per enumerated surface: (file content, skill name) -> every
// grammar string that surface carries for that skill, unwrapped. An empty
// array means "this surface is absent for this skill"; a surface that is
// there but cannot be read throws -- never the same signal as absent.
const EXTRACTORS = {
  frontmatter(content) {
    const hint = extractArgumentHint(content);
    return hint === null ? [] : [hint];
  },
  'input-parse-line'(content) {
    const body = inputSectionBody(content);
    if (body === null) return [];
    const found = [];
    for (const line of body.split('\n')) {
      // Loose detection, strict extraction: a reworded restatement line
      // must fail loudly rather than drop out of the walk as "absent".
      if (!line.includes('$ARGUMENTS') || !/parsed as/i.test(line)) continue;
      const m = line.match(/`\$ARGUMENTS` is parsed as `([^`]+)`/);
      if (!m) throw new Error(`restatement line is not "\`$ARGUMENTS\` is parsed as \`<grammar>\`": ${line}`);
      found.push(m[1]);
    }
    return found;
  },
  'reference-card-takes'(content, skill) {
    const found = [];
    for (const { command, takes } of parseTakesRows(content)) {
      const m = command.match(/`\/claude-tweaks:([a-z0-9-]+)/);
      if (!m || m[1] !== skill) continue;
      const unescaped = takes.replace(/\\\|/g, '|');
      found.push(unescaped.startsWith('`') && unescaped.endsWith('`') ? unescaped.slice(1, -1) : unescaped);
    }
    return found;
  },
};

// `{skill}:{surface}` -> reason, for a surface that legitimately diverges
// from its skill's argument-hint. Holds the five restatement lines that
// were stale when this suite landed, until the next commit fixes them.
// An entry whose surface passes is itself reported, so the list cannot rot.
const EXCEPTIONS = {
  'capture:input-parse-line': 'abbreviates the --route/--type values as <value>',
  'design-wrapper:input-parse-line': 'abbreviates the whole grammar as <mode> <target> [flags]',
  'feedback:input-parse-line': 'abbreviates the --kind values as <value>',
  'tidy:input-parse-line': 'stale: missing --approve and --source',
  'visualize:input-parse-line': 'abbreviates the whole grammar as <type> <topic>',
};

// Walk every enumerated surface for every skill. `read` is injectable so the
// discrimination tests below can hand the walker a mutated copy of one file.
function collectProblems({ rows, skills, read, exceptions }) {
  const problems = [];
  const used = new Set();
  for (const skill of skills) {
    const values = {};
    for (const row of rows) {
      const extract = EXTRACTORS[row.id];
      if (!extract) throw new Error(`mirror surface "${row.id}" is enumerated in ${ENUMERATION} but has no extractor`);
      values[row.id] = extract(read(row.file.replace('{skill}', skill)), skill);
    }
    const [canonical] = values[CANONICAL];
    if (canonical === undefined) {
      problems.push(`${skill}:${CANONICAL}: SKILL.md declares no argument-hint`);
      continue;
    }
    for (const row of rows) {
      if (row.id === CANONICAL) continue;
      const key = `${skill}:${row.id}`;
      const bad = [];
      if (values[row.id].length === 0 && row.presence === 'required') bad.push(`${key}: required surface is absent`);
      for (const value of values[row.id]) {
        if (value !== canonical) bad.push(`${key}: has ${JSON.stringify(value)}, argument-hint is ${JSON.stringify(canonical)}`);
      }
      if (bad.length > 0 && Object.hasOwn(exceptions, key)) used.add(key);
      else problems.push(...bad);
    }
  }
  for (const key of Object.keys(exceptions)) {
    if (!used.has(key)) problems.push(`${key}: listed in EXCEPTIONS but agrees with its argument-hint -- remove the entry`);
  }
  return problems;
}

const ROWS = parseEnumeration(readRepoFile(ENUMERATION));
const walk = (overrides = {}) => collectProblems({ rows: ROWS, skills: SKILLS, read: readRepoFile, exceptions: EXCEPTIONS, ...overrides });

// Hand the walker one mutated file; every other read stays live.
const readWith = (rel, mutate) => (p) => {
  const original = readRepoFile(p);
  if (p !== rel) return original;
  const mutated = mutate(original);
  assert.notStrictEqual(mutated, original, `mutation of ${rel} was a no-op -- the probe would prove nothing`);
  return mutated;
};

// The skill the discrimination probes mutate: it carries all three surfaces
// and its hint has no `|`, so the card cell holds the hint unescaped.
const PROBE = 'release';
const PROBE_SKILL_MD = `plugin/skills/${PROBE}/SKILL.md`;
const PROBE_HINT = extractArgumentHint(readRepoFile(PROBE_SKILL_MD));
const CARD = 'plugin/skills/help/reference-card.md';

test('the enumeration table and the extractor registry name the same surfaces', () => {
  assert.deepStrictEqual(
    ROWS.map((r) => r.id).sort(),
    Object.keys(EXTRACTORS).sort(),
    `${ENUMERATION}'s mirror-surface table and this file's EXTRACTORS must list the same ids`,
  );
  assert.strictEqual(new Set(ROWS.map((r) => r.id)).size, ROWS.length, 'a surface id is enumerated twice');
  for (const row of ROWS) {
    assert.ok(PRESENCE.includes(row.presence), `${row.id}: Presence must be one of ${PRESENCE.join(' / ')}, got "${row.presence}"`);
    assert.ok(fs.existsSync(path.join(ROOT, row.file.replace('{skill}', PROBE))), `${row.id}: File "${row.file}" does not resolve`);
  }
  assert.strictEqual(ROWS.find((r) => r.id === CANONICAL).presence, 'required', 'the canonical surface must be required');
});

test('every skill carries the same grammar on every enumerated mirror surface', () => {
  assert.ok(SKILLS.length > 10, 'sanity check: expected a substantial skill set');
  const problems = walk();
  assert.deepStrictEqual(problems, [], `argument-hint mirror drift (${ENUMERATION}, "${SECTION_HEADING}"):\n${problems.join('\n')}`);
});

test('a flag added to argument-hint alone is reported on every other surface', () => {
  const problems = walk({
    read: readWith(PROBE_SKILL_MD, (md) => md.replace(/^(argument-hint: ")(.*)(")$/m, '$1$2 [--zz-probe]$3')),
  });
  assert.deepStrictEqual(
    [...new Set(problems.map((p) => p.split(': ')[0]))].sort(),
    ROWS.filter((r) => r.id !== CANONICAL).map((r) => `${PROBE}:${r.id}`).sort(),
    `expected one stale mirror per non-canonical surface of ${PROBE}, got:\n${problems.join('\n')}`,
  );
});

test('a flag present only in the reference card Takes cell is reported', () => {
  const problems = walk({
    read: readWith(CARD, (card) => card.split(`\`${PROBE_HINT}\``).join(`\`${PROBE_HINT} [--zz-probe]\``)),
  });
  assert.ok(problems.length > 0, 'a Takes-only flag went unreported');
  for (const p of problems) assert.ok(p.startsWith(`${PROBE}:reference-card-takes: `), `unexpected problem: ${p}`);
});

test('a flag present only in the Input parse line is reported', () => {
  const problems = walk({
    read: readWith(PROBE_SKILL_MD, (md) => md.replace(`is parsed as \`${PROBE_HINT}\``, `is parsed as \`${PROBE_HINT} [--zz-probe]\``)),
  });
  assert.strictEqual(problems.length, 1, problems.join('\n'));
  assert.ok(problems[0].startsWith(`${PROBE}:input-parse-line: `), problems[0]);
});

test('a required surface that is missing for a skill is reported, not skipped', () => {
  const problems = walk({
    read: readWith(CARD, (card) => card.split('\n').filter((l) => !l.startsWith(`| \`/claude-tweaks:${PROBE}\``)).join('\n')),
  });
  assert.deepStrictEqual(problems, [`${PROBE}:reference-card-takes: required surface is absent`]);
});

test('a surface added to the enumeration is walked without touching the walker', () => {
  const extra = { id: 'zz-fourth-surface', file: CARD, presence: 'required' };
  assert.throws(() => walk({ rows: [...ROWS, extra] }), /"zz-fourth-surface" is enumerated in .* but has no extractor/);
  EXTRACTORS[extra.id] = () => ['not the hint'];
  try {
    const problems = walk({ rows: [...ROWS, extra] });
    assert.strictEqual(problems.length, SKILLS.length, 'the added surface must be compared for every skill');
    for (const p of problems) assert.match(p, /^[a-z0-9-]+:zz-fourth-surface: has "not the hint"/);
  } finally {
    delete EXTRACTORS[extra.id];
  }
});

test('an unreadable surface and a stale exception are each their own signal', () => {
  assert.throws(
    () => EXTRACTORS['input-parse-line']('## Input\n\n`$ARGUMENTS` is parsed as the flags below:\n'),
    /restatement line is not/,
  );
  assert.throws(
    () => EXTRACTORS['input-parse-line']('## Input\n\n$ARGUMENTS gets parsed as `[--x]`:\n'),
    /restatement line is not/,
  );
  assert.deepStrictEqual(EXTRACTORS['input-parse-line']('## Input\n\n| Argument | Behavior |\n'), []);
  assert.throws(() => parseEnumeration('# no such section\n'), /no "### Argument-hint mirror surfaces" heading/);
  const key = `${PROBE}:reference-card-takes`;
  assert.deepStrictEqual(walk({ exceptions: { ...EXCEPTIONS, [key]: 'probe' } }), [
    `${key}: listed in EXCEPTIONS but agrees with its argument-hint -- remove the entry`,
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/argument-hint-mirrors.test.js`
Expected: FAIL — the file cannot load, because `inputSectionBody` is not exported yet and `docs/skill-authoring.md` has no `### Argument-hint mirror surfaces` heading.

- [ ] **Step 3: Move `inputSectionBody` into the shared module**

In `tests/argument-hint-input.test.js`, cut the whole `inputSectionBody` function together with the three-line comment above it (`// Returns the text between the \`## Input\` heading …`) and paste both, unchanged, into `plugin/bin/lib/skill-audit/argument-hint.js` just above `module.exports`. Then:

- In `plugin/bin/lib/skill-audit/argument-hint.js`: change the export to `module.exports = { extractArgumentHint, inputSectionBody };`, and in the header comment change `tests/reference-card-argument-hint.test.js` to `tests/argument-hint-mirrors.test.js`.
- In `tests/argument-hint-input.test.js`: change the import to `const { extractArgumentHint, inputSectionBody } = require('../plugin/bin/lib/skill-audit/argument-hint');`. Change nothing else in that file.

- [ ] **Step 4: Add the enumeration section**

In `docs/skill-authoring.md`, insert the block below as its own section between the `**Adding a mode or argument …**` paragraph (line 17) and the paragraph that begins `Skills do **not** carry a Relationship to Other Skills table.` — one blank line before and after. Do not edit line 17 itself (Task 3 does).

```markdown
### Argument-hint mirror surfaces

The one enumeration of every place a skill's argument grammar is restated verbatim. The `argument-hint` frontmatter value is canonical; every other row must carry the same string byte-for-byte once that surface's own wrapping (a code span, the card's `\|` pipe escapes) is removed. `tests/argument-hint-mirrors.test.js` reads this table and walks each row for every skill, and it pins its own extractor registry to the rows in both directions — a row added here fails the suite until its extractor exists, and an extractor whose row is removed fails it too. Other files cite this section; none restates the list.

| Surface | File | Where | Presence |
|---|---|---|---|
| `frontmatter` | `plugin/skills/{skill}/SKILL.md` | The `argument-hint:` frontmatter value — the canonical form every other row is compared against | required |
| `input-parse-line` | `plugin/skills/{skill}/SKILL.md` | The code span that follows `is parsed as` on the `## Input` section's `$ARGUMENTS` restatement line | when-present |
| `reference-card-takes` | `plugin/skills/help/reference-card.md` | The `Takes` cell of every `/claude-tweaks:{skill}` row in the three command tables | required |

`required` means every skill carries the surface. `when-present` means a skill may omit it, but a skill that writes it writes the whole hint — an abbreviation (`[flags]`, `--kind=<value>`) is drift, because the next flag added to the hint has no obvious place to land in it. A skill whose `## Input` opens straight into its argument table has no restatement line and nothing to mirror there; `tests/argument-hint-input.test.js` separately checks that the section documents every bracketed leaf of the hint.

To add a surface, add its row and then its extractor in that test's `EXTRACTORS` (file content and skill name in, every grammar string found out). A place that *describes* a flag in prose — `plugin/skills/help/context-flow.md`'s row for a skill, a `description` naming a mode — is not a mirror and does not belong in the table; it is found by grepping for one of the skill's existing flags, which is why `plugin/skills/build/plan-authoring-checks.md`'s Mirror-surface enumeration check asks for both. The table exists because the count was carried in memory and was short twice: #679 named the first two rows, and #2759 found the reference card's `Takes` column only because a byte-pinning suite happened to cover it.
```

- [ ] **Step 5: Delete the consolidated suite and re-point its citations**

- Run: `git rm tests/reference-card-argument-hint.test.js`
- `tests/specify-batch-input.test.js` lines 9-10 and `tests/bin-lib/smoke-test/verify-cleanup.test.js` line 53 each name `tests/reference-card-argument-hint.test.js` in a comment. Read each comment and change the filename to `tests/argument-hint-mirrors.test.js`, keeping the sentence true (the Takes-row parser the second comment points at is still called `parseTakesRows`, and it now splits rows through a `splitRow` helper).

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/argument-hint-mirrors.test.js tests/argument-hint-input.test.js tests/specify-batch-input.test.js tests/bin-lib/smoke-test/verify-cleanup.test.js`
Expected: PASS, 0 failures. The five known drifts are held by `EXCEPTIONS` until Task 2.

Then prove the pin is live: temporarily delete the `reference-card-takes` row from the table in `docs/skill-authoring.md`, re-run `node --test tests/argument-hint-mirrors.test.js`, confirm the first test fails naming the id mismatch, and restore the row (re-run: PASS). Quote both outputs in your report.

- [ ] **Step 7: Commit**

```bash
git add docs/skill-authoring.md plugin/bin/lib/skill-audit/argument-hint.js tests/argument-hint-input.test.js tests/argument-hint-mirrors.test.js tests/specify-batch-input.test.js tests/bin-lib/smoke-test/verify-cleanup.test.js
git commit -m "Add the argument-hint mirror-surface table and its walker — one enumeration, checked for every skill (refs #2772)" -m "Claude-Session: https://claude.ai/code/session_015ZX5aJf9QxottoX6taiskk"
```

(`git rm` already staged the deletion.)

---

### Task 2: Fix the five drifted restatement lines

**Files:**
- Test: `tests/argument-hint-mirrors.test.js` (created by Task 1 — empty its `EXCEPTIONS`)
- Modify: `plugin/skills/tidy/SKILL.md:29`
- Modify: `plugin/skills/capture/SKILL.md:24`
- Modify: `plugin/skills/feedback/SKILL.md:33`
- Modify: `plugin/skills/design-wrapper/SKILL.md:43`
- Modify: `plugin/skills/visualize/SKILL.md:26`
- Modify: `tests/feedback-watermark-prose.test.js:142`

**Interfaces:**
- Consumes: `EXCEPTIONS` and the walker from Task 1.
- Produces: an empty `EXCEPTIONS` — every skill agrees on every surface.

Read `docs/skill-authoring.md` before editing any `plugin/skills/**/*.md`. Each edit below changes one code span on one line; change nothing else on the line or in the file.

- [ ] **Step 1: Make the test demand the fixes**

In `tests/argument-hint-mirrors.test.js`, replace the four-line comment above `const EXCEPTIONS` and the whole `const EXCEPTIONS = { … };` statement with exactly:

```js
// `{skill}:{surface}` -> reason, for a surface that legitimately diverges
// from its skill's argument-hint. Empty by design: every divergence found
// when this suite landed was staleness or an abbreviation, and was fixed.
// An entry whose surface passes is itself reported, so the list cannot rot.
const EXCEPTIONS = {};
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/argument-hint-mirrors.test.js`
Expected: FAIL — `every skill carries the same grammar…` lists exactly five problems, all `…:input-parse-line`, for `capture`, `design-wrapper`, `feedback`, `tidy`, `visualize`.

- [ ] **Step 3: Rewrite each restatement line's code span to the skill's own `argument-hint`**

The new span is the skill's frontmatter `argument-hint` value, character for character (line 4 of each file — copy it from there, minus the YAML quotes):

| File | Old span after `is parsed as` | New span |
|---|---|---|
| `plugin/skills/tidy/SKILL.md` | `` `[--scope=<name>[,<name>...]] [--dry-run]` `` | `` `[--scope=<name>[,<name>...]] [--dry-run] [--approve [run-dir]] [--source sweep]` `` |
| `plugin/skills/capture/SKILL.md` | `` `<idea text> [--route=<value>] [--title="..."] [--type=<value>] [--needs-definition|--no-needs-definition] [--batch <path>]` `` | `` `<idea text> [--route=brainstorm|keep|absorb:N] [--title="..."] [--type=bug|feature|task] [--needs-definition|--no-needs-definition] [--batch <path>]` `` |
| `plugin/skills/feedback/SKILL.md` | `` `[<learning text>] [--kind=<value>] [--upstream <owner/name>] [--dry-run] [--queue] [--full] [--pre-confirmed]` `` | `` `[<learning text>] [--kind=defect|gap] [--upstream <owner/name>] [--dry-run] [--queue] [--full] [--pre-confirmed]` `` |
| `plugin/skills/design-wrapper/SKILL.md` | `` `<mode> <target> [flags]` `` | `` `<shape|pre-build|test|review|polish|survey|doctor|reset-recommendations|live|explore> [target] [<surface-topic>] [--screenshots <paths>] [--source <parent-skill>] [--description <text>] [--dry-run] [--limit <n>] [--scope <identity|layout>]` `` |
| `plugin/skills/visualize/SKILL.md` | `` `<type> <topic>` `` | `` `<architecture|flowchart|sequence|state|er|timeline|swimlane|quadrant|nested|tree|org-chart|layers|venn|pyramid|record-graph> [topic] [--source <caller>] [--ephemeral]` `` |

(The pipes in this table are literal `|` in the files — these lines are prose, not table cells, so they are not escaped there.)

- [ ] **Step 4: Re-point the one test that byte-pins an old line**

`tests/feedback-watermark-prose.test.js` line 142 pins feedback's restatement line as a regex containing `\[--kind=<value>\]`. Change that fragment to `\[--kind=defect\|gap\]` and nothing else.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/argument-hint-mirrors.test.js tests/argument-hint-input.test.js tests/feedback-watermark-prose.test.js`
Expected: PASS, 0 failures.

Then grep `tests/` for each old span's distinctive text (`<mode> <target>`, `<type> <topic>`, `route=<value>`, `type=<value>`, `kind=<value>`) and confirm no remaining pin; report the grep output.

- [ ] **Step 6: Commit**

```bash
git add tests/argument-hint-mirrors.test.js tests/feedback-watermark-prose.test.js plugin/skills/tidy/SKILL.md plugin/skills/capture/SKILL.md plugin/skills/feedback/SKILL.md plugin/skills/design-wrapper/SKILL.md plugin/skills/visualize/SKILL.md
git commit -m "Restate the full argument-hint on five drifted Input parse lines — tidy was missing two flags, four abbreviated (refs #2772)" -m "Claude-Session: https://claude.ai/code/session_015ZX5aJf9QxottoX6taiskk"
```

---

### Task 3: Retire the counted wording and cite the table

**Files:**
- Test: `tests/argument-hint-mirrors.test.js` (created by Task 1 — append the sweep test)
- Modify: `docs/skill-authoring.md:17` and the `argument-hint` bullet under `## Frontmatter conventions` (line ~120 after Task 1's insertion)
- Modify: `plugin/skills/build/plan-authoring-checks.md:39` and `:43`
- Modify: `.claude/skills/skill-prose-conformance-tests/advanced-proof-patterns.md:47`

**Interfaces:**
- Consumes: `ROOT`, `ENUMERATION`, `TABLE_HEADER`, `readRepoFile` from Task 1's test file.

- [ ] **Step 1: Write the failing test**

Append to the end of `tests/argument-hint-mirrors.test.js`:

```js
// The enumeration has one home. Scans whitespace-collapsed text so a phrase
// that wraps across lines is still seen. docs/incident-log.md is history and
// docs/superpowers/ holds run artifacts that quote what they replace.
const SWEEP_ROOTS = ['plugin/skills', '.claude/skills', 'docs'];
const SWEEP_SKIP = ['docs/incident-log.md', 'docs/superpowers'];
const RETIRED = [
  /two syntactic-mirror surfaces/i,
  /treat these two as always in scope/i,
  /the two places a flag appears/i,
];

function markdownFiles(rel) {
  if (SWEEP_SKIP.includes(rel)) return [];
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isDirectory()) {
    return fs.readdirSync(abs).sort().flatMap((name) => markdownFiles(`${rel}/${name}`));
  }
  return rel.endsWith('.md') ? [rel] : [];
}

test('the mirror-surface table has one home and the counted wording stays retired', () => {
  const files = SWEEP_ROOTS.flatMap(markdownFiles);
  assert.ok(files.includes(ENUMERATION), 'sanity check: the sweep must reach the enumeration file itself');
  assert.deepStrictEqual(files.filter((f) => readRepoFile(f).includes(TABLE_HEADER)), [ENUMERATION]);
  const hits = [];
  for (const f of files) {
    const flat = readRepoFile(f).replace(/\s+/g, ' ');
    for (const re of RETIRED) if (re.test(flat)) hits.push(`${f}: ${re}`);
  }
  assert.deepStrictEqual(hits, [], `retired "exactly two surfaces" wording is back:\n${hits.join('\n')}`);
  // The collapse is what lets a wrapped phrase match -- prove it does.
  assert.match('has two syntactic-mirror\n  surfaces'.replace(/\s+/g, ' '), RETIRED[0]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/argument-hint-mirrors.test.js`
Expected: FAIL — `the mirror-surface table has one home…` reports retired wording in `docs/skill-authoring.md` and `plugin/skills/build/plan-authoring-checks.md`.

- [ ] **Step 3: Rewrite `docs/skill-authoring.md` line 17's two counted sentences**

Replace this exact text (it is the middle of the long `**Adding a mode or argument …**` paragraph):

```
A brand-new flag (no arity change) still has two syntactic-mirror surfaces of its own that a change scoped only to `## Input`'s table can silently miss: the `argument-hint` frontmatter and `## Input`'s own `` `$ARGUMENTS` is parsed as `` restatement line — both list every accepted flag inline and drift independently of the table (#679: a dispatched edit added a flag's table row but left both mirrors naming only the old set, caught by controller re-read rather than the dispatch's own verification). Treat these two as always in scope for a new-flag addition, not only an arity change.
```

with:

```
A brand-new flag (no arity change) still has syntactic-mirror surfaces of its own that a change scoped only to `## Input`'s table can silently miss — every row of the Argument-hint mirror surfaces table below restates the whole grammar inline and drifts independently of that table (#679: a dispatched edit added a flag's table row but left the mirrors naming only the old set, caught by controller re-read rather than the dispatch's own verification). Treat every row of that table as always in scope for a new-flag addition, not only an arity change.
```

- [ ] **Step 4: Rewrite the partial list in the `argument-hint` frontmatter bullet**

In the same file's `- **\`argument-hint\`**` bullet, replace:

```
the hint, `## Input`, the `description`, and `plugin/skills/help/reference-card.md` are only the start of the edit list
```

with:

```
the hint's mirror surfaces (the Argument-hint mirror surfaces table under `## SKILL.md structure`), the rest of `## Input`, and the `description` are only the start of the edit list
```

- [ ] **Step 5: Make `plan-authoring-checks.md` cite instead of restate**

In `plugin/skills/build/plan-authoring-checks.md`:

- Line 39: change the suite name `` `reference-card-argument-hint` `` to `` `argument-hint-mirrors` ``.
- Line 43: replace the entire `**Mirror-surface enumeration check:**` paragraph with:

```
**Mirror-surface enumeration check:** when a task adds or changes a flag on a skill, take the flag's syntactic mirrors from the Argument-hint mirror surfaces table in `docs/skill-authoring.md` — the one enumeration, walked for every skill by `tests/argument-hint-mirrors.test.js` — never from a remembered count, and then grep the repo for one of that skill's *existing* flags to find what no table lists: prose that describes what a flag does (`help/context-flow.md`'s row for the skill, a `description` naming a mode). In a project with no such table the grep is the whole derivation. A count carried in a plan author's head was short twice — #679, then #2759, whose missing surface was caught only because a byte-pinning suite happened to exist and the full-suite gate compared failing *files* rather than totals (346 failures against a 395 baseline reads as an improvement). Write the table citation and the grep into the plan, not a number.
```

- [ ] **Step 6: Re-point the project skill's citation**

In `.claude/skills/skill-prose-conformance-tests/advanced-proof-patterns.md` line 47, replace:

```
`tests/reference-card-argument-hint.test.js`'s `| Command | What it does | Takes |` column, which an `argument-hint` edit desyncs
```

with:

```
`tests/argument-hint-mirrors.test.js`'s walk of every mirror surface (the Argument-hint mirror surfaces table in `docs/skill-authoring.md`), which an `argument-hint` edit desyncs
```

- [ ] **Step 7: Run tests to verify they pass, and sweep by hand**

Run: `node --test tests/argument-hint-mirrors.test.js`
Expected: PASS, 0 failures.

Run: `grep -rn "reference-card-argument-hint" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=pipelines --exclude-dir=superpowers`
Expected: exactly one hit — the new test's own header comment (`Consolidates tests/reference-card-argument-hint.test.js`). Any other hit outside `docs/incident-log.md` is a citation to fix; report the output.

Run: `wc -c plugin/skills/build/plan-authoring-checks.md`
Expected: under 26000 bytes (it was 24722; the shared per-file ceiling is 46080).

- [ ] **Step 8: Commit**

```bash
git add tests/argument-hint-mirrors.test.js docs/skill-authoring.md plugin/skills/build/plan-authoring-checks.md .claude/skills/skill-prose-conformance-tests/advanced-proof-patterns.md
git commit -m "Retire the counted mirror-surface wording — cite the table instead of restating the list (refs #2772)" -m "Claude-Session: https://claude.ai/code/session_015ZX5aJf9QxottoX6taiskk"
```
