# Add the skill-size Read-limit rail — budgets.js plus rail checks (#3306) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `plugin/bin/lib/skill-audit/budgets.js` as the single source of truth for skill-size numbers. Add with it the blocking Read-limit rail: every shipped skill `.md` and every composed bundle must fit one Read call, and every description must fit the CLI listing max. All of this is added alongside today's gates.

**Architecture:** `budgets.js` holds constants plus two pure helpers (`listingBudgetChars`, `overRail`) and requires nothing. A test-side helper module, `tests/bin-lib/skill-audit/rail-entries.js`, maps a corpus root to rail violations using `context-cost.js`'s existing enumeration. The live-corpus rail tests in `context-cost.test.js` run it on `plugin/`. Their go-red fixtures in `budgets.test.js` run the same code on temp-dir corpora, so a red fixture proves the live assertion can go red.

**Tech Stack:** Node 18+, `node:test`, `node:assert`. No dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T062549-spec-3307-3308-3306-3309-3310-3311/spec-3306/work/3306-spec.md` (materialized from GitHub issue #3306) _(Spec file deleted at the series close-out in PR #3433; the GitHub record, with its As-built notes, is the durable spec.)_

## Build-time rulings that supersede the spec text

Task 0 ran in the build session, before this plan was written. Its outcome changes three spec literals. Each change is logged as a `premise reversed:` line in the spec's run-dir `decisions.md`:

1. **Read no longer errors over the cap** (CLI 2.1.302). It returns a paged partial view carrying the total token count, and that total is the N used below. The `budgets.js` header records the message verbatim.
2. **Calibration:**
   - (a) 121,252 B → 45,241 tokens (2.680 B/token)
   - (b) 135,953 B → 51,251 tokens (2.653 B/token)
   - (c) 138,746 B → 65,782 tokens (2.109 B/token)

   `BYTES_PER_TOKEN = 2.1`. At the spec's `RAIL_RATIO 0.8` that puts `RAIL_BYTES` at 42,000. 17 shipped files and 6 compose call-site maxima are already over that, so the live rail tests would fail at HEAD.
3. **User decision at the plan-validation HARD-GATE: `RAIL_RATIO = 1.0`.** That makes `RAIL_TOKENS 25000`, `RAIL_LINES 2000` and `RAIL_BYTES 52500`. The margin is the lowest-measured ratio (the densest real file), not a percentage. AC1's `RAIL_RATIO === 0.8` / `20000` / `1600` literals become `1.0` / `25000` / `2000`. AC2's formula assertion is unchanged.

At HEAD, every one of the 478 shipped skill files and every compose call site passes the 52,500 B / 2,000-line rail. The largest bundle is `worktree-setup` at 46,817 B, about 11% headroom. The largest file is `dispatch/settle-and-merge.md` at 46,294 B. The longest file is about 670 lines.

## Global Constraints

- `plugin/bin/lib/skill-audit/budgets.js` contains no `require` call (AC9).
- `plugin/bin/lib/skill-audit/context-cost.js` is read-only for this plan.
- `tests/bin-lib/skill-audit/context-cost.test.js`: additions only. `git diff` must show no removed or changed line (AC8).
- Do not touch `CEILING_BYTES`, `DESCRIPTION_CEILING_CHARS`, `DESCRIPTION_TOTAL_CEILING_CHARS`, `COMPOSED_STEP_EXCEPTIONS`, or any existing assertion. #3310 and #3311 own them.
- Bytes come from `measuredBytes` (CRLF-normalized, marker-stripped), never `fs.statSync().size`.
- `measureDescriptions` takes the plugin root (`plugin/`), never the repo root.
- Every new test in `context-cost.test.js` has the word `rail` in its name.
- Commit style: `{Verb} {what} — {detail} (refs #3306)`. The message ends with the line `Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717`. Never write "closes" or "fixes #".

## Review Focus

1. **A CRLF checkout must count the same lines as LF.** `lineCount` normalizes `\r\n`; pinned in Task 2's `lineCount` test.
2. **A trailing newline must not count as an extra line.** That is how Read counts lines. Pinned in Task 2's `lineCount` test (`'a\nb\n'` and `'a\nb'` are both 2).
3. **Description length counts characters, not UTF-8 bytes.** 1,536 × `é` passes; pinned in Task 2.
4. **An unmeasured compose row must fail the rail, never pass silently.** An error row has no `max`, and `undefined > RAIL_BYTES` is `false`. Pinned in Task 2's missing-source fixture.
5. **Sub-files are covered, not only `SKILL.md`.** Pinned in Task 2's sub-file fixture.

## Plan-authoring checks applied

- **Inline self-consistency:** every inlined test was run against the inlined implementation in a scratch mirror of this worktree: 71/71 pass across `budgets.test.js` and `context-cost.test.js`, exit 0.
- **Discrimination:**
  - With `RAIL_RATIO = 0.8`, the two live rail tests (skill files, composed) go red.
  - With `overRail` using `>=` instead of `>`, five `budgets.test.js` tests go red: both `overRail` tests, plus the SKILL.md-bytes, SKILL.md-lines and compose at-limit fixtures.
- **Real-input probe:** the live tests run on the real `plugin/` corpus. The diagnostic printed `description total 8616 chars vs listing budget 8000 chars (200k context) / 40000 chars (1M context)`.
- **Byte-pin check:** no `plugin/skills/**/*.md` file grows in this plan. `docs/plugin-structure.md` grows by one sentence. `npm test` runs the suites that read it (Task 3 Step 5).

---

### Task 1: budgets.js — constants, derivations, listing budget, overRail

**Files:**
- Create: `plugin/bin/lib/skill-audit/budgets.js`
- Create: `tests/bin-lib/skill-audit/budgets.test.js` (derivation and `overRail` tests; Task 2 appends the fixtures)
- Modify: `docs/plugin-structure.md` (append one sentence to the `plugin/bin/lib/skill-audit/` row, line 23)

**Interfaces:**
- Consumes: nothing.
- Produces: `require('plugin/bin/lib/skill-audit/budgets.js')` exports:
  - `READ_TOKEN_CAP` (25000), `READ_LINE_CAP` (2000), `BASH_OUTPUT_CAP_CHARS` (30000)
  - `RAIL_RATIO` (1.0), `RAIL_TOKENS` (25000), `RAIL_LINES` (2000)
  - `BYTES_PER_TOKEN` (2.1), `RAIL_BYTES` (52500)
  - `DESCRIPTION_MAX_CHARS` (1536), `LISTING_BUDGET_FRACTION` (0.01), `LISTING_CHARS_PER_TOKEN` (4)
  - `listingBudgetChars(contextTokens: number) → number`
  - `overRail(entries: Array<{file|name, bytes:number, lines?:number}>) → same-shape subset`

- [ ] **Step 1: Write the failing test.** Create `tests/bin-lib/skill-audit/budgets.test.js` with exactly this content. Task 2 appends to it.

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const budgets = require('../../../plugin/bin/lib/skill-audit/budgets.js');

const {
  READ_TOKEN_CAP, READ_LINE_CAP, BASH_OUTPUT_CAP_CHARS, RAIL_RATIO, RAIL_TOKENS, RAIL_LINES,
  BYTES_PER_TOKEN, RAIL_BYTES, DESCRIPTION_MAX_CHARS, LISTING_BUDGET_FRACTION,
  LISTING_CHARS_PER_TOKEN, listingBudgetChars, overRail,
} = budgets;

const BUDGETS_SRC = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'skill-audit', 'budgets.js');

// ── Derivations (AC1-AC3, AC9)

test('budgets: the platform caps and listing constants carry their exact values', () => {
  assert.strictEqual(READ_TOKEN_CAP, 25000);
  assert.strictEqual(READ_LINE_CAP, 2000);
  assert.strictEqual(BASH_OUTPUT_CAP_CHARS, 30000);
  assert.strictEqual(RAIL_RATIO, 1.0);
  assert.strictEqual(DESCRIPTION_MAX_CHARS, 1536);
  assert.strictEqual(LISTING_BUDGET_FRACTION, 0.01);
  assert.strictEqual(LISTING_CHARS_PER_TOKEN, 4);
});

test('budgets: the rails derive from the caps by formula', () => {
  assert.strictEqual(RAIL_TOKENS, Math.floor(READ_TOKEN_CAP * RAIL_RATIO));
  assert.strictEqual(RAIL_LINES, Math.floor(READ_LINE_CAP * RAIL_RATIO));
  assert.strictEqual(RAIL_BYTES, Math.floor(RAIL_TOKENS * BYTES_PER_TOKEN));
});

test('budgets: BYTES_PER_TOKEN is a calibrated ratio rounded down to one decimal', () => {
  assert.ok(BYTES_PER_TOKEN > 0);
  assert.strictEqual(Math.round(BYTES_PER_TOKEN * 10) / 10, BYTES_PER_TOKEN);
});

test('budgets: listingBudgetChars at 200k and 1M context', () => {
  assert.strictEqual(listingBudgetChars(200000), 8000);
  assert.strictEqual(listingBudgetChars(1000000), 40000);
});

test('budgets: the header records the calibration — CLI version, date, and all three token counts', () => {
  const src = fs.readFileSync(BUDGETS_SRC, 'utf8');
  for (const needle of ['2.1.302', '2026-10-17', '45,241', '51,251', '65,782']) {
    assert.ok(src.includes(needle), `budgets.js header is missing ${needle}`);
  }
});

test('budgets: requires nothing, so any unit can import it without a cycle', () => {
  const src = fs.readFileSync(BUDGETS_SRC, 'utf8');
  assert.doesNotMatch(src, /\brequire\s*\(/);
});

// ── overRail (AC5)

test('overRail: over the byte rail or the line rail, never at it', () => {
  const entries = [
    { file: 'a.md', bytes: RAIL_BYTES, lines: 10 },
    { file: 'b.md', bytes: RAIL_BYTES + 1, lines: 10 },
    { file: 'c.md', bytes: 100, lines: RAIL_LINES + 1 },
  ];
  assert.deepStrictEqual(overRail(entries).map((e) => e.file), ['b.md', 'c.md']);
});

test('overRail: an entry with no lines field is judged on bytes only', () => {
  assert.deepStrictEqual(overRail([{ file: 'bundle', bytes: RAIL_BYTES }]), []);
  assert.deepStrictEqual(overRail([{ file: 'bundle', bytes: RAIL_BYTES + 1 }]).map((e) => e.file), ['bundle']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/skill-audit/budgets.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/skill-audit/budgets.js'`

- [ ] **Step 3: Write the implementation.** Create `plugin/bin/lib/skill-audit/budgets.js` with exactly this content. The header numbers are the real Task 0 measurements; do not alter them.

```js
'use strict';

// The single source of truth for every skill-size number (#3306, parent
// #3305). Constants plus two pure helpers — no I/O, and no `require`, so every
// later unit can import it without a cycle.
//
// A size limit blocks CI only where it guards a real platform limit: the Read
// tool's 25,000-token and 2,000-line caps. The rails sit AT those caps
// (RAIL_RATIO 1.0). The margin is BYTES_PER_TOKEN itself: the lowest ratio
// measured, taken from the densest real file, where typical skill prose runs
// ~2.65 B/token. An 80% rail was specified first; at the measured ratio it
// landed at 42,000 B, under 17 shipped files, and was set to the cap at the
// build's plan-validation gate.
//
// Calibration (Task 0) — 2026-10-17, `claude --version`: 2.1.302 (Claude Code).
// Three scratchpad samples, each read with the Read tool and no offset/limit:
//   (a) `git ls-files 'plugin/skills/*.md' 'plugin/skills/**/*.md'`, LC_ALL=C
//       ascending, joined by \n, 8 files:  121,252 B, 1,194 lines → N = 45,241 tokens (2.680 B/token)
//   (b) the same, descending, 9 files:     135,953 B, 1,597 lines → N = 51,251 tokens (2.653 B/token)
//   (c) dispatch/queue-pull-script.md ×3: 138,746 B, 2,013 lines → N = 65,782 tokens (2.109 B/token)
// BYTES_PER_TOKEN = the lowest, 2.109, rounded down to one decimal: 2.1.
//
// Non-token failure messages: none — Read 2.1.302 no longer fails over the
// cap. It returns a paged partial view instead; N is that view's total. (a)'s,
// verbatim (scratchpad path elided):
//   [Truncated: PARTIAL view — …/calib/sample-a.md: showing lines 1-560 of 1194
//   total (45241 tokens, cap 25000). Call Read with offset=561 limit=560 for the
//   next page, or Grep to find a specific section. Do NOT answer from this page
//   alone if the answer may be further in the file.]
// A file over the cap still cannot be read in one call, so the rail still
// guards a real limit.
//
// A point-in-time snapshot: re-run the calibration when a Claude Code release
// changes the Read limits or the tokenizer (#3304 tracks those drift checks).

const READ_TOKEN_CAP = 25000; // Read tool default cap (Claude Code 2.1.302)
const READ_LINE_CAP = 2000; // Read returns up to 2,000 lines without offset/limit
// Bash inline output cap — informational, NOT a rail. Skill prose instructs
// the Read tool, never `cat`; #611's 34.3 KB "truncation" was this cap, not a
// single-read ceiling, and a 30,000-char rail would sit below files shipping today.
const BASH_OUTPUT_CAP_CHARS = 30000;
const RAIL_RATIO = 1.0;
const RAIL_TOKENS = Math.floor(READ_TOKEN_CAP * RAIL_RATIO);
const RAIL_LINES = Math.floor(READ_LINE_CAP * RAIL_RATIO);
const BYTES_PER_TOKEN = 2.1; // calibrated above, rounded down to one decimal
const RAIL_BYTES = Math.floor(RAIL_TOKENS * BYTES_PER_TOKEN);
// skillListingMaxDescChars default. The CLI counts description characters
// exactly — no estimate to absorb, so no margin.
const DESCRIPTION_MAX_CHARS = 1536;
const LISTING_BUDGET_FRACTION = 0.01; // skillListingBudgetFraction default
const LISTING_CHARS_PER_TOKEN = 4;

function listingBudgetChars(contextTokens) {
  return Math.floor(contextTokens * LISTING_CHARS_PER_TOKEN * LISTING_BUDGET_FRACTION);
}

// Entries over the byte rail, or over the line rail when they carry `lines`.
// An entry without a `lines` field (a composed bundle) is judged on bytes only.
function overRail(entries) {
  return entries.filter((e) => e.bytes > RAIL_BYTES || (typeof e.lines === 'number' && e.lines > RAIL_LINES));
}

module.exports = {
  READ_TOKEN_CAP,
  READ_LINE_CAP,
  BASH_OUTPUT_CAP_CHARS,
  RAIL_RATIO,
  RAIL_TOKENS,
  RAIL_LINES,
  BYTES_PER_TOKEN,
  RAIL_BYTES,
  DESCRIPTION_MAX_CHARS,
  LISTING_BUDGET_FRACTION,
  LISTING_CHARS_PER_TOKEN,
  listingBudgetChars,
  overRail,
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/bin-lib/skill-audit/budgets.test.js`
Expected: PASS, 8 tests, 0 fail.

- [ ] **Step 5: Document the module.** In `docs/plugin-structure.md` line 23 (the `plugin/bin/lib/skill-audit/` row), append this sentence after the final sentence, which ends `— read by \`load-delta.js\`.`. Keep a single space before it.

```
`budgets.js` (#3306) is the single source of truth for skill-size numbers and requires nothing: the Read-limit rail every shipped skill `.md` (52,500 B and 2,000 lines) and every composed bundle (52,500 B) must fit — the Read tool's 25,000-token cap times a calibrated 2.1 bytes/token, recalibrated per Claude Code release — plus the CLI's 1,536-char per-description listing max; the rail tests live in `context-cost.test.js`, their go-red fixtures in `budgets.test.js`.
```

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/skill-audit/budgets.js tests/bin-lib/skill-audit/budgets.test.js docs/plugin-structure.md
git commit -m "Add budgets.js — Read-limit rail constants calibrated at 2.1 B/token, listing budget, overRail (refs #3306)" -m "Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717"
```

---

### Task 2: rail-entries.js and the go-red fixtures

**Files:**
- Create: `tests/bin-lib/skill-audit/rail-entries.js`. This is a test helper with no `.test.js` suffix, so `tools/run-tests.js` does not run it as a suite. `tests/bin-lib/code-health/seed-durable-state.js` is the precedent.
- Test: `tests/bin-lib/skill-audit/budgets.test.js` (created in Task 1; add imports, append fixture tests)

**Interfaces:**
- Consumes:
  - From Task 1: `overRail`, `DESCRIPTION_MAX_CHARS`, `RAIL_BYTES`, `RAIL_LINES`.
  - From `context-cost.js`, unchanged: `corpusDir(root)`, `measureSkills(root) → [{name, bytes}]`, `measureSubFiles(root) → [{skill, file /*posix, relative to skills/ */, bytes}]`, `composedBytesReport(root) → [{step, file, line, combinations, max} | {step, file, line, error}]`, `measureDescriptions(pluginRoot) → [{name, chars, description}]`.
- Produces: `require('./rail-entries.js')` exports:
  - `lineCount(file) → number`
  - `skillFileRailViolations(root) → [{file, bytes, lines}]`
  - `composedRailViolations(root) → [{file, bytes} | {file, error}]`
  - `descriptionRailViolations(root) → [{name, chars, description}]`

  Task 3 uses the last three.

- [ ] **Step 1: Write the failing tests.** Replace `budgets.test.js`'s import block with the one below. The only change is two extra `require`s: `composedBytesReport` and `./rail-entries.js`. Then add the `tmpRoot` / `writeSkillFile` / `composeFixture` / `nLines` helpers after the `BUDGETS_SRC` line. Then append the `lineCount` and go-red fixture tests at the end of the file. The finished file must be exactly:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const budgets = require('../../../plugin/bin/lib/skill-audit/budgets.js');
const { composedBytesReport } = require('../../../plugin/bin/lib/skill-audit/context-cost.js');
const {
  lineCount,
  skillFileRailViolations,
  composedRailViolations,
  descriptionRailViolations,
} = require('./rail-entries.js');

const {
  READ_TOKEN_CAP, READ_LINE_CAP, BASH_OUTPUT_CAP_CHARS, RAIL_RATIO, RAIL_TOKENS, RAIL_LINES,
  BYTES_PER_TOKEN, RAIL_BYTES, DESCRIPTION_MAX_CHARS, LISTING_BUDGET_FRACTION,
  LISTING_CHARS_PER_TOKEN, listingBudgetChars, overRail,
} = budgets;

const BUDGETS_SRC = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'skill-audit', 'budgets.js');

function tmpRoot(slug) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `budgets-${slug}-`));
}

// {root}/skills/{skill}/{rel} with `content`; returns root.
function writeSkillFile(root, skill, rel, content) {
  const file = path.join(root, 'skills', skill, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return root;
}

// A corpus with one compose call site whose single source is `sourceBytes` of 'x'.
function composeFixture(slug, sourceBytes) {
  const root = tmpRoot(slug);
  writeSkillFile(root, '_shared', 'big.md', 'x'.repeat(sourceBytes));
  const callLine = 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step railstep "${CLAUDE_PLUGIN_ROOT}/skills/_shared/big.md"';
  writeSkillFile(root, 'demo', 'SKILL.md', `${callLine}\n`);
  return root;
}

function nLines(n) {
  return `${Array(n).fill('a').join('\n')}\n`;
}

// ── Derivations (AC1-AC3, AC9)

test('budgets: the platform caps and listing constants carry their exact values', () => {
  assert.strictEqual(READ_TOKEN_CAP, 25000);
  assert.strictEqual(READ_LINE_CAP, 2000);
  assert.strictEqual(BASH_OUTPUT_CAP_CHARS, 30000);
  assert.strictEqual(RAIL_RATIO, 1.0);
  assert.strictEqual(DESCRIPTION_MAX_CHARS, 1536);
  assert.strictEqual(LISTING_BUDGET_FRACTION, 0.01);
  assert.strictEqual(LISTING_CHARS_PER_TOKEN, 4);
});

test('budgets: the rails derive from the caps by formula', () => {
  assert.strictEqual(RAIL_TOKENS, Math.floor(READ_TOKEN_CAP * RAIL_RATIO));
  assert.strictEqual(RAIL_LINES, Math.floor(READ_LINE_CAP * RAIL_RATIO));
  assert.strictEqual(RAIL_BYTES, Math.floor(RAIL_TOKENS * BYTES_PER_TOKEN));
});

test('budgets: BYTES_PER_TOKEN is a calibrated ratio rounded down to one decimal', () => {
  assert.ok(BYTES_PER_TOKEN > 0);
  assert.strictEqual(Math.round(BYTES_PER_TOKEN * 10) / 10, BYTES_PER_TOKEN);
});

test('budgets: listingBudgetChars at 200k and 1M context', () => {
  assert.strictEqual(listingBudgetChars(200000), 8000);
  assert.strictEqual(listingBudgetChars(1000000), 40000);
});

test('budgets: the header records the calibration — CLI version, date, and all three token counts', () => {
  const src = fs.readFileSync(BUDGETS_SRC, 'utf8');
  for (const needle of ['2.1.302', '2026-10-17', '45,241', '51,251', '65,782']) {
    assert.ok(src.includes(needle), `budgets.js header is missing ${needle}`);
  }
});

test('budgets: requires nothing, so any unit can import it without a cycle', () => {
  const src = fs.readFileSync(BUDGETS_SRC, 'utf8');
  assert.doesNotMatch(src, /\brequire\s*\(/);
});

// ── overRail (AC5)

test('overRail: over the byte rail or the line rail, never at it', () => {
  const entries = [
    { file: 'a.md', bytes: RAIL_BYTES, lines: 10 },
    { file: 'b.md', bytes: RAIL_BYTES + 1, lines: 10 },
    { file: 'c.md', bytes: 100, lines: RAIL_LINES + 1 },
  ];
  assert.deepStrictEqual(overRail(entries).map((e) => e.file), ['b.md', 'c.md']);
});

test('overRail: an entry with no lines field is judged on bytes only', () => {
  assert.deepStrictEqual(overRail([{ file: 'bundle', bytes: RAIL_BYTES }]), []);
  assert.deepStrictEqual(overRail([{ file: 'bundle', bytes: RAIL_BYTES + 1 }]).map((e) => e.file), ['bundle']);
});

// ── lineCount

test('rail lineCount: a trailing newline ends the last line, and CRLF counts like LF', () => {
  const root = tmpRoot('linecount');
  const write = (name, text) => { const f = path.join(root, name); fs.writeFileSync(f, text); return f; };
  assert.strictEqual(lineCount(write('lf.md', 'a\nb\n')), 2);
  assert.strictEqual(lineCount(write('noeol.md', 'a\nb')), 2);
  assert.strictEqual(lineCount(write('crlf.md', 'a\r\nb\r\n')), 2);
  assert.strictEqual(lineCount(write('empty.md', '')), 0);
});

// ── Go-red fixtures (AC6): each live-corpus rail test's own code, at and over its limit

test('rail fixture: a SKILL.md at RAIL_BYTES passes, at RAIL_BYTES + 1 fails', () => {
  const at = writeSkillFile(tmpRoot('skill-bytes-at'), 'huge', 'SKILL.md', 'x'.repeat(RAIL_BYTES));
  assert.deepStrictEqual(skillFileRailViolations(at), []);
  const over = writeSkillFile(tmpRoot('skill-bytes-over'), 'huge', 'SKILL.md', 'x'.repeat(RAIL_BYTES + 1));
  assert.deepStrictEqual(skillFileRailViolations(over).map((e) => [e.file, e.bytes]), [['huge/SKILL.md', RAIL_BYTES + 1]]);
});

test('rail fixture: a SKILL.md at RAIL_LINES short lines passes, at RAIL_LINES + 1 fails', () => {
  const at = writeSkillFile(tmpRoot('skill-lines-at'), 'long', 'SKILL.md', nLines(RAIL_LINES));
  assert.deepStrictEqual(skillFileRailViolations(at), []);
  const over = writeSkillFile(tmpRoot('skill-lines-over'), 'long', 'SKILL.md', nLines(RAIL_LINES + 1));
  assert.deepStrictEqual(skillFileRailViolations(over).map((e) => [e.file, e.lines]), [['long/SKILL.md', RAIL_LINES + 1]]);
});

test('rail fixture: a sub-file over the byte rail fails too, not only SKILL.md', () => {
  const root = writeSkillFile(tmpRoot('subfile-over'), 'demo', 'SKILL.md', 'body\n');
  writeSkillFile(root, 'demo', 'big-step.md', 'x'.repeat(RAIL_BYTES + 1));
  assert.deepStrictEqual(skillFileRailViolations(root).map((e) => e.file), ['demo/big-step.md']);
});

test('rail fixture: a compose call site composing to RAIL_BYTES passes, to RAIL_BYTES + 1 fails', () => {
  // Compose adds a fixed overhead around its sources; measure it, then size
  // the source so the bundle lands exactly on the rail.
  const probeBytes = 1000;
  const overhead = composedBytesReport(composeFixture('compose-probe', probeBytes))[0].max - probeBytes;

  const at = composeFixture('compose-at', RAIL_BYTES - overhead);
  assert.strictEqual(composedBytesReport(at)[0].max, RAIL_BYTES);
  assert.deepStrictEqual(composedRailViolations(at), []);

  const over = composeFixture('compose-over', RAIL_BYTES - overhead + 1);
  assert.deepStrictEqual(
    composedRailViolations(over).map((e) => e.bytes),
    [RAIL_BYTES + 1],
  );
});

test('rail fixture: a compose call site with a missing source fails the rail, never passes unmeasured', () => {
  const root = tmpRoot('compose-missing');
  const callLine = 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step railstep "${CLAUDE_PLUGIN_ROOT}/skills/_shared/gone.md"';
  writeSkillFile(root, 'demo', 'SKILL.md', `${callLine}\n`);
  const violations = composedRailViolations(root);
  assert.strictEqual(violations.length, 1);
  assert.ok(violations[0].error, 'expected the unmeasured row to carry its error');
});

test('rail fixture: a description of 1,536 chars passes, 1,537 fails', () => {
  const skill = (chars) => `---\nname: d\ndescription: ${'a'.repeat(chars)}\n---\nbody\n`;
  const at = writeSkillFile(tmpRoot('desc-at'), 'd', 'SKILL.md', skill(DESCRIPTION_MAX_CHARS));
  assert.deepStrictEqual(descriptionRailViolations(at), []);
  const over = writeSkillFile(tmpRoot('desc-over'), 'd', 'SKILL.md', skill(DESCRIPTION_MAX_CHARS + 1));
  assert.deepStrictEqual(descriptionRailViolations(over).map((d) => d.chars), [DESCRIPTION_MAX_CHARS + 1]);
});

test('rail fixture: description length counts characters, not UTF-8 bytes', () => {
  const content = `---\nname: d\ndescription: ${'é'.repeat(DESCRIPTION_MAX_CHARS)}\n---\nbody\n`;
  const root = writeSkillFile(tmpRoot('desc-multibyte'), 'd', 'SKILL.md', content);
  assert.deepStrictEqual(descriptionRailViolations(root), []);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/skill-audit/budgets.test.js`
Expected: FAIL with `Cannot find module './rail-entries.js'`

- [ ] **Step 3: Write the helper.** Create `tests/bin-lib/skill-audit/rail-entries.js` with exactly this content:

```js
'use strict';

// Shared corpus → rail-violation mapping for the #3306 rail suites. The
// live-corpus rail tests (context-cost.test.js) and their go-red fixtures
// (budgets.test.js) run this same code against different roots, so a fixture
// that goes red proves the live assertion can.
const fs = require('node:fs');
const path = require('node:path');

const {
  corpusDir,
  measureSkills,
  measureSubFiles,
  composedBytesReport,
  measureDescriptions,
} = require('../../../plugin/bin/lib/skill-audit/context-cost.js');
const { overRail, DESCRIPTION_MAX_CHARS } = require('../../../plugin/bin/lib/skill-audit/budgets.js');

// Lines as Read counts them: CRLF-normalized, and a trailing newline ends the
// last line rather than starting another.
function lineCount(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (text === '') return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

// Every shipped skill .md (each SKILL.md plus every sub-file) over the byte or
// line rail. Bytes are measuredBytes's (CRLF-normalized, marker-stripped).
function skillFileRailViolations(root) {
  const dir = corpusDir(root);
  const skills = measureSkills(root).map((s) => {
    const file = `${s.name}/SKILL.md`;
    return { file, bytes: s.bytes, lines: lineCount(path.join(dir, file)) };
  });
  const subFiles = measureSubFiles(root).map((s) => ({
    file: s.file, bytes: s.bytes, lines: lineCount(path.join(dir, s.file)),
  }));
  return overRail([...skills, ...subFiles]);
}

// Every compose call site whose max composed bytes exceed the byte rail. A
// row with no measured max (an error or unparsed row) is a violation too —
// an unmeasured bundle never passes silently.
function composedRailViolations(root) {
  const out = [];
  const measured = [];
  for (const row of composedBytesReport(root)) {
    const file = `${row.step} @ ${row.file}:${row.line}`;
    if (row.error || typeof row.max !== 'number') out.push({ file, error: row.error || 'no measured max' });
    else measured.push({ file, bytes: row.max });
  }
  return [...out, ...overRail(measured)];
}

// Every skill description over the CLI's per-description listing max.
// `root` is the plugin root (`plugin/`), never the repo root.
function descriptionRailViolations(root) {
  return measureDescriptions(root).filter((d) => d.chars > DESCRIPTION_MAX_CHARS);
}

module.exports = {
  lineCount,
  skillFileRailViolations,
  composedRailViolations,
  descriptionRailViolations,
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/bin-lib/skill-audit/budgets.test.js`
Expected: PASS, 16 tests, 0 fail.

- [ ] **Step 5: Prove the at-limit fixtures discriminate.**
  1. Temporarily change both `>` comparisons in `overRail` (`budgets.js`) to `>=`.
  2. Re-run `node --test tests/bin-lib/skill-audit/budgets.test.js`. Expected: 5 failures:
     - `overRail: over the byte rail…`
     - `overRail: an entry with no lines field…`
     - `rail fixture: a SKILL.md at RAIL_BYTES…`
     - `rail fixture: a SKILL.md at RAIL_LINES…`
     - `rail fixture: a compose call site composing to RAIL_BYTES…`
  3. Restore `>` with `git checkout -- plugin/bin/lib/skill-audit/budgets.js` (Task 1 committed it).
  4. Confirm `git status --short plugin/bin/lib/skill-audit/budgets.js` prints nothing.

  Quote the failing-test lines in your report.

- [ ] **Step 6: Commit**

```bash
git add tests/bin-lib/skill-audit/rail-entries.js tests/bin-lib/skill-audit/budgets.test.js
git commit -m "Add the rail-violation helpers and their go-red fixtures — skill files, sub-files, compose bundles, descriptions, at and over each limit (refs #3306)" -m "Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717"
```

---

### Task 3: Live-corpus rail tests and the description-total diagnostic

**Files:**
- Modify: `tests/bin-lib/skill-audit/context-cost.test.js` (additions only):
  - two `require` lines after line 37, `const { compose, KEYS, VOCAB } = require(...compose.js');`
  - one appended block at the end of the file

**Interfaces:**
- Consumes:
  - From Task 1: `RAIL_BYTES`, `RAIL_LINES`, `DESCRIPTION_MAX_CHARS`, `listingBudgetChars`.
  - From Task 2: `skillFileRailViolations`, `composedRailViolations`, `descriptionRailViolations`.
  - Already imported in this file: `REPO` (= `plugin/`), `measureDescriptions`, `totalDescriptionChars`, `test`, `assert`.
- Produces: nothing consumed later.

- [ ] **Step 1: Add the imports.** Insert these two lines immediately after line 37 (`const { compose, KEYS, VOCAB } = require('../../../plugin/bin/lib/compose-context/compose.js');`):

```js
const { RAIL_BYTES, RAIL_LINES, DESCRIPTION_MAX_CHARS, listingBudgetChars } = require('../../../plugin/bin/lib/skill-audit/budgets.js');
const { skillFileRailViolations, composedRailViolations, descriptionRailViolations } = require('./rail-entries.js');
```

- [ ] **Step 2: Append the rail tests.** Add this block at the end of the file, after the last existing test (`reports composed bytes per call site and combination`):

```js
// ── Read-limit rail (#3306). The one size check that guards a real platform
// limit: every shipped skill .md and every composed bundle fits one Read call
// (budgets.js holds the numbers and their calibration). Each test's go-red
// fixture lives in budgets.test.js and runs the same rail-entries.js code.
// Every test name here carries "rail" so #3311 can tell these suites from the
// ones it deletes.

test('rail: every shipped skill .md fits one Read call (bytes and lines)', () => {
  assert.deepStrictEqual(
    skillFileRailViolations(REPO).map((e) => `${e.file} ${e.bytes} B, ${e.lines} lines`),
    [],
    `over the Read rail (${RAIL_BYTES} B / ${RAIL_LINES} lines, budgets.js) — a file this size cannot be read in one call; split it`,
  );
});

test('rail: every compose call site\'s max composed bytes fit one Read call', () => {
  assert.deepStrictEqual(
    composedRailViolations(REPO).map((e) => (e.error ? `${e.file}: ${e.error}` : `${e.file} ${e.bytes} B`)),
    [],
    `a composed bundle is consumed by a single Read — fence or restructure its sources to fit ${RAIL_BYTES} B (budgets.js)`,
  );
});

test('rail: every skill description fits the CLI listing max', () => {
  assert.deepStrictEqual(
    descriptionRailViolations(REPO).map((d) => `${d.name} (${d.chars} chars)`),
    [],
    `the CLI truncates a skill description past ${DESCRIPTION_MAX_CHARS} chars in the skill listing`,
  );
});

test('rail diagnostic: total description chars against the listing budget (reported, never failed)', () => {
  const total = totalDescriptionChars(measureDescriptions(REPO));
  console.log(`    rail diagnostic: description total ${total} chars vs listing budget `
    + `${listingBudgetChars(200000)} chars (200k context) / ${listingBudgetChars(1000000)} chars (1M context) — `
    + 'listing entries also carry whenToUse and the name, so the real listing cost is higher');
});
```

- [ ] **Step 3: Run it to verify it passes on the real corpus**

Run: `node --test tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, 0 fail, including 4 tests whose names start `rail`. The output includes one line beginning `rail diagnostic: description total` that names both budgets, `8000` and `40000`.

- [ ] **Step 4: Prove the live rail tests discriminate.**
  1. Temporarily set `const RAIL_RATIO = 0.8;` in `budgets.js`.
  2. Re-run `node --test tests/bin-lib/skill-audit/context-cost.test.js`. Expected: exactly 2 failures:
     - `rail: every shipped skill .md fits one Read call (bytes and lines)`
     - `rail: every compose call site's max composed bytes fit one Read call`
  3. Restore with `git checkout -- plugin/bin/lib/skill-audit/budgets.js`.
  4. Confirm `git status --short plugin/bin/lib/skill-audit/budgets.js` prints nothing.

  Quote the failing-test lines.

- [ ] **Step 5: Verify additions-only and the full suite**

Run: `git diff HEAD -- tests/bin-lib/skill-audit/context-cost.test.js | grep -E '^-[^-]' | wc -l`
Expected: `0`

Run `npm test` with its output redirected to a file in your session scratchpad, never `/tmp` (Bash writes there do not persist), and append `; echo exit=$?`. Then run `grep -E '^# (tests|pass|fail)'` on that file and quote the raw lines.
Expected: `exit=0` and `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add tests/bin-lib/skill-audit/context-cost.test.js
git commit -m "Add the live-corpus Read-limit rail tests — skill files, compose bundles, descriptions, plus the description-total listing diagnostic (refs #3306)" -m "Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717"
```

---

## Self-review

**Spec coverage:**

| Spec item | Task |
|---|---|
| Deliverable 1 (Task 0 calibration) | Done in session; recorded in the `budgets.js` header (Task 1) |
| Deliverable 2 (`budgets.js`) | Task 1 |
| Deliverable 3 (rail assertions) | Task 3 |
| Deliverable 4 (diagnostic) | Task 3 |
| Deliverable 5 (`budgets.test.js` with go-red fixtures) | Tasks 1 and 2 |
| AC1, AC2, AC3, AC4, AC9 | Task 1 tests (AC1 amended per the ruling above) |
| AC5 | Task 1 `overRail` tests |
| AC6 | Task 2 fixtures |
| AC7 | Task 3 diagnostic |
| AC8 | Task 3 Step 5 |

- **Placeholders:** none. Every code step is inlined verbatim from the scratch-verified files.
- **Type consistency:** the names in each Interfaces block match the inlined code.
- **Review Focus:** all five lines are pinned by tests in Task 2.
