# Preflight claim-log-only classification (#2861) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A run directory whose `decisions.md` holds only `/flow` Step 2.8 claim-log lines classifies as adoption case 2 (fresh mint), while any other `decisions.md` content classifies exactly as it does today.

**Architecture:** `formatEntry` (the only code that writes a `decisions.md` entry line) gains an inverse, `parseEntry`, beside it in `plugin/bin/lib/log-decision/append.js`. A new `plugin/bin/lib/log-decision/claim-log.js` owns the claim-log line shape once (step label, section, action text) and exposes a classifier over a whole `decisions.md` text. `plugin/bin/lib/flow/preflight.js` and `plugin/bin/lib/hooks/pre-tool-use.js` (the pre-existing second reader of the same line) both consume that module, so the shape lives in one place. Anything the classifier cannot parse counts as real content (case 3, today's behaviour) — never as "only claim lines".

**Tech Stack:** Node 18+, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-04T163945-record-2861/work/2861-spec.md` (materialized from GitHub issue #2861)

## Global Constraints

- Commit messages: `{Verb} {what} — {detail}`, reference the record as `refs #2861` — never `closes`/`fixes`.
- Never run `git stash` / `git stash pop`. Never hand-bump `plugin/.claude-plugin/plugin.json`.
- Run every command in the foreground; never `run_in_background`.
- `node --test` takes file paths or globs (`tests/bin-lib/flow/*.test.js`), never a bare directory.
- Read `docs/skill-authoring.md` (at minimum "Instruction-prose diet") before editing `plugin/skills/**/*.md`.
- Touch only the files listed in Task 1.

## Facts established before planning (do not re-derive, do re-check if something disagrees)

- The defect reproduces on this branch: a scratch run dir whose `decisions.md` was written by `log-decision.js` with the argv `flow/claim-targets.md` documents classified as `case: 3, hasOtherContent: true`. Cause: `plugin/bin/lib/flow/preflight.js` `computeAdoption`, the line `const hasOtherContent = nonEmpty(deps, path.join(real, 'decisions.md')) || ...`.
- `bin/claim-targets.js` writes nothing to `decisions.md`. The claim line is written by the agent calling `bin/log-decision.js` per `plugin/skills/flow/claim-targets.md` "Log the claim (mandatory, #2492)": `--status AUTO --section "/flow" --step "Step 2.8" --reversibility high --text "claimed #{n} (bin/claim-targets.js, transport: {git|contents-api|mcp})"`.
- Real file content after that call (captured from run `2026-10-04T163945-record-2861`):

  ```
  ## /flow
  - AUTO 18:42:06 — Step 2.8: claimed #2861 (bin/claim-targets.js, transport: git). Reversibility: high.
  ```

- A real multi-record run logs one hand-composed batch line instead (documented at `plugin/bin/lib/hooks/pre-tool-use.js` `hasLoggedClaim`, #2636): `- AUTO 02:30:28 — Step 2.8: Claimed all 2 targets under run {run-id} (claim-targets.js exit 0). Reversibility: high.`
- `hasLoggedClaim` currently carries its own two regexes: `Step 2\.8: claimed #${n}\b` and `Step 2\.8: Claimed all \d+ targets under run\b`, both unanchored over the whole file. Its behaviour must not change (covered by `tests/hooks-bookkeeping-stamps-gate.test.js`, whose fixtures include claim lines with no `Reversibility:` suffix).
- `plugin/skills/flow/steps-and-gates.md` is 34,190 bytes against the 46,080-byte ceiling.

## Review Focus

1. A `decisions.md` with claim lines **plus one real decision** must stay case 3 — pinned in Task 1 Step 1 (preflight test "claim lines mixed with one real decision").
2. A line that only *resembles* a claim line (no `- AUTO HH:MM:SS —` entry prefix, or sitting under a non-`/flow` heading) must count as content — pinned in Task 1 Step 1 (claim-log test "unparseable or foreign lines").
3. A header-only file (the Manifesto's `# Auto-Decision Log` snapshot, or a bare `## /flow` heading with no entry) must stay case 3 — pinned in Task 1 Step 1.
4. Claim-log-only `decisions.md` next to a non-empty `events.jsonl` must stay case 3 — pinned in Task 1 Step 1.
5. The prose-dictated writer argv drifting away from the parser's constants — pinned in Task 1 Step 1 (claim-log test "claim-targets.md's documented argv").

---

### Task 1: Recognise claim-log-only decisions.md as case 2

**Files:**
- Modify: `plugin/bin/lib/log-decision/append.js` (add `parseEntry`, export it)
- Create: `plugin/bin/lib/log-decision/claim-log.js`
- Modify: `plugin/bin/lib/flow/preflight.js` (`computeAdoption`'s `hasOtherContent` line + one require)
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (`hasLoggedClaim` body + one require)
- Modify: `plugin/skills/flow/steps-and-gates.md` (cases 2 and 3 of "Adopting an inherited run directory")
- Test: `tests/bin-lib/log-decision/claim-log.test.js` (create)
- Test: `tests/bin-lib/flow/preflight.test.js` (append)

**Interfaces:**
- Produces, from `append.js`: `parseEntry(line: string) -> { status, time, location, action } | null`.
- Produces, from `claim-log.js`: `CLAIM_LOG_SECTION` (`'/flow'`), `CLAIM_LOG_STEP` (`'Step 2.8'`), `claimLogText(n, transport) -> string`, `isClaimLogEntry(line) -> boolean`, `hasClaimLogFor(body, n) -> boolean`, `classifyDecisions(text: string | null) -> 'absent' | 'empty' | 'claim-log-only' | 'content'`.

- [ ] **Step 1: Write the failing tests**

Create `tests/bin-lib/log-decision/claim-log.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(ROOT, 'plugin', 'bin', 'lib', 'log-decision');
const { formatEntry, parseEntry } = require(path.join(LIB, 'append'));
const {
  CLAIM_LOG_SECTION, CLAIM_LOG_STEP, claimLogText, isClaimLogEntry, hasClaimLogFor, classifyDecisions,
} = require(path.join(LIB, 'claim-log'));

const NOW = Date.parse('2026-10-04T12:00:00Z');
// Verbatim from run 2026-10-04T163945-record-2861's decisions.md after Step 2.8.
const REAL_SINGLE = '## /flow\n- AUTO 18:42:06 — Step 2.8: claimed #2861 (bin/claim-targets.js, transport: git). Reversibility: high.\n';
// Verbatim shape from pre-tool-use.js's #2636 note (a real multi-record run).
const REAL_BATCH = '## /flow\n- AUTO 02:30:28 — Step 2.8: Claimed all 2 targets under run 2026-09-20T002426-record-1235 (claim-targets.js exit 0). Reversibility: high.\n';

test('parseEntry inverts formatEntry: status, time, location and action survive, with and without --spec/--lever (#2861)', () => {
  const plain = formatEntry({ status: 'AUTO', now: NOW, step: 'Step 2.8', text: 'claimed #7 (x)', reversibility: 'high' });
  const p = parseEntry(plain);
  assert.strictEqual(p.status, 'AUTO');
  assert.match(p.time, /^\d{2}:\d{2}:\d{2}$/);
  assert.strictEqual(p.location, 'Step 2.8');
  assert.strictEqual(p.action, 'claimed #7 (x). Reversibility: high.');
  const spec = parseEntry(formatEntry({ status: 'STAGED', now: NOW, step: 'Step 3', spec: '42', text: 'y', lever: 'a=b (policy)' }));
  assert.deepStrictEqual({ status: spec.status, location: spec.location }, { status: 'STAGED', location: 'spec #42 — Step 3' });
  assert.strictEqual(parseEntry(formatEntry({ status: 'SKIP', now: NOW, text: 'z' })).location, 'log-decision');
  for (const junk of ['', '## /flow', 'Step 2.8: claimed #7', '- auto 10:00:00 — Step 2.8: claimed #7', '- AUTO 10:00 — Step 2.8: claimed #7', '- AUTO 10:00:00 - Step 2.8: claimed #7']) {
    assert.strictEqual(parseEntry(junk), null, JSON.stringify(junk));
  }
});

test("claim-targets.md's documented argv produces a line isClaimLogEntry accepts, for every transport it names (#2861 writer/parser pin)", () => {
  const prose = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'flow', 'claim-targets.md'), 'utf8');
  const start = prose.indexOf('**Log the claim (mandatory, #2492).**');
  assert.notStrictEqual(start, -1, 'claim-targets.md no longer has its "Log the claim" paragraph — this pin has lost its anchor');
  const block = prose.slice(start, prose.indexOf('```', prose.indexOf('```bash', start) + 7));
  assert.ok(block.includes(`--section "${CLAIM_LOG_SECTION}"`), 'documented --section equals CLAIM_LOG_SECTION');
  assert.ok(block.includes(`--step "${CLAIM_LOG_STEP}"`), 'documented --step equals CLAIM_LOG_STEP');
  assert.ok(block.includes('--status AUTO'), 'documented status is AUTO');
  assert.ok(block.includes(`--text "${claimLogText('{n}', '{git|contents-api|mcp}')}"`), 'documented --text equals claimLogText over the prose placeholders');
  for (const transport of ['git', 'contents-api', 'mcp']) {
    const line = formatEntry({ status: 'AUTO', now: NOW, step: CLAIM_LOG_STEP, text: claimLogText(2861, transport), reversibility: 'high' });
    assert.strictEqual(isClaimLogEntry(line), true, line);
  }
});

test('isClaimLogEntry: single and batch forms, with or without a spec prefix or Reversibility suffix; unparseable or foreign lines are not claim lines (#2861)', () => {
  for (const yes of [
    '- AUTO 18:42:06 — Step 2.8: claimed #2861 (bin/claim-targets.js, transport: git). Reversibility: high.',
    '- AUTO 00:00:00 — Step 2.8: claimed #991 (bin/claim-targets.js, transport: git).',
    '- AUTO 00:00:00 — spec #991 — Step 2.8: claimed #991 (bin/claim-targets.js, transport: mcp). Reversibility: high.',
    '- AUTO 02:30:28 — Step 2.8: Claimed all 2 targets under run 2026-09-20T002426-record-1235 (claim-targets.js exit 0). Reversibility: high.',
  ]) assert.strictEqual(isClaimLogEntry(yes), true, yes);
  for (const no of [
    'Step 2.8: claimed #2861 (bin/claim-targets.js, transport: git).',
    '- STAGED 18:42:06 — Step 2.8: claimed #2861 (bin/claim-targets.js, transport: git).',
    '- AUTO 18:42:06 — Step 2.5: claimed #2861 (bin/claim-targets.js, transport: git).',
    '- AUTO 18:42:06 — Step 2.8: claim contested for #2861, stopping.',
    '- AUTO 18:42:06 — Step 2.8: claimed #abc.',
    '- AUTO 18:42:06 — Step 3: noted that Step 2.8: claimed #2861 earlier.',
    '## /flow',
    '',
  ]) assert.strictEqual(isClaimLogEntry(no), false, JSON.stringify(no));
});

test('classifyDecisions: absent, empty, claim-log-only, content — and nothing unparseable ever reads as claim-log-only (#2861)', () => {
  assert.strictEqual(classifyDecisions(null), 'absent');
  assert.strictEqual(classifyDecisions(''), 'empty');
  assert.strictEqual(classifyDecisions(' \n\n\t\n'), 'empty');
  assert.strictEqual(classifyDecisions(REAL_SINGLE), 'claim-log-only');
  assert.strictEqual(classifyDecisions(REAL_BATCH), 'claim-log-only');
  assert.strictEqual(classifyDecisions(REAL_SINGLE.replace(/\n/g, '\r\n')), 'claim-log-only');
  assert.strictEqual(classifyDecisions('- AUTO 00:00:00 — Step 2.8: claimed #7 (x).\n- AUTO 00:00:01 — Step 2.8: claimed #8 (x).\n'), 'claim-log-only', 'no heading, two targets');
  // Header-only shapes: no claim entry at all.
  assert.strictEqual(classifyDecisions('## /flow\n'), 'content');
  assert.strictEqual(classifyDecisions('# Auto-Decision Log — pipeline 2026-05-15T143207-spec-42\n\nPipeline config snapshot:\n- mode: auto\n'), 'content');
  // Claim lines mixed with one real decision.
  assert.strictEqual(classifyDecisions(`${REAL_SINGLE}- AUTO 18:42:16 — Manifesto: design-critique resolved to auto (source: default). Reversibility: n/a.\n`), 'content');
  assert.strictEqual(classifyDecisions(`${REAL_SINGLE}## /build\n- AUTO 18:50:00 — Common Step 1: worktree created. Reversibility: high.\n`), 'content');
  // Unparseable or foreign lines beside a claim line.
  assert.strictEqual(classifyDecisions(`${REAL_SINGLE}Step 2.8: claimed #2861\n`), 'content', 'a claim-looking line with no entry prefix');
  assert.strictEqual(classifyDecisions(`${REAL_SINGLE}stray text\n`), 'content');
  assert.strictEqual(classifyDecisions(REAL_SINGLE.replace('## /flow', '## /build')), 'content', 'a claim line under a foreign heading');
  assert.strictEqual(classifyDecisions(`# Auto-Decision Log\n\n${REAL_SINGLE}`), 'content', 'a file header means a Manifesto already initialised this file');
});

test('hasClaimLogFor keeps hasLoggedClaim\'s semantics: exact number with a word boundary, or the batch form covering every number (#2861)', () => {
  assert.strictEqual(hasClaimLogFor(REAL_SINGLE, 2861), true);
  assert.strictEqual(hasClaimLogFor(REAL_SINGLE, 286), false);
  assert.strictEqual(hasClaimLogFor(REAL_SINGLE, 28610), false);
  assert.strictEqual(hasClaimLogFor('- AUTO 00:00:00 — Step 2.8: claimed #700 (x).\n', 7), false);
  assert.strictEqual(hasClaimLogFor(REAL_BATCH, 1235), true);
  assert.strictEqual(hasClaimLogFor(REAL_BATCH, 9), true);
  assert.strictEqual(hasClaimLogFor('', 9), false);
});
```

Append to `tests/bin-lib/flow/preflight.test.js` (uses that file's existing `mainRoot`, `deps`, `computeAdoption`, `ADOPTION_NOTES`):

```js
// #2861: /flow Step 2.8 logs its claim to decisions.md BEFORE Step 3 runs this
// classifier, so a freshly minted dir is never byte-empty by the time it is read.
const NO_SPEC = { git: (args) => (args[0] === 'ls-tree' ? '' : 'feat-branch\n') };
const CLAIM_ONLY = '## /flow\n- AUTO 18:42:06 — Step 2.8: claimed #7 (bin/claim-targets.js, transport: git). Reversibility: high.\n';

function adoptionFor(decisions, extra = {}) {
  const fx = mainRoot();
  if (decisions !== null) fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), decisions);
  for (const [name, text] of Object.entries(extra)) fs.writeFileSync(path.join(fx.runDir, name), text);
  return { fx, a: computeAdoption({ runDir: fx.runDir, mainRoot: fx.root, cwd: fx.root, deps: deps(fx, NO_SPEC) }) };
}

test('a decisions.md holding only Step 2.8 claim-log lines classifies as case 2, single-target and batch forms (#2861 AC1)', () => {
  const batch = '## /flow\n- AUTO 02:30:28 — Step 2.8: Claimed all 2 targets under run 2026-09-06T000000-record-7 (claim-targets.js exit 0). Reversibility: high.\n';
  for (const text of [CLAIM_ONLY, batch]) {
    const { fx, a } = adoptionFor(text);
    assert.strictEqual(a.case, 2, text);
    assert.strictEqual(a.hasOtherContent, false);
    assert.deepStrictEqual(a.backfills, []);
    assert.strictEqual(a.note, ADOPTION_NOTES[2].replace('{path}', fs.realpathSync(fx.runDir)));
  }
});

test('the claim line the real log-decision CLI writes from claim-targets.md\'s argv classifies as case 2 (#2861 AC1, writer-generated)', () => {
  const fx = mainRoot();
  fs.mkdirSync(path.join(fx.root, '.git'));
  const logDecision = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'log-decision.js'));
  const code = logDecision.run(
    ['--run', fx.runDir, '--status', 'AUTO', '--section', '/flow', '--step', 'Step 2.8', '--reversibility', 'high', '--text', 'claimed #7 (bin/claim-targets.js, transport: git)'],
    { now: () => Date.parse('2026-09-06T12:00:00Z'), cwd: () => fx.root, mainRoot: fx.root, stdout: () => {}, stderr: () => {} },
  );
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(fs.readdirSync(fx.runDir), ['decisions.md'], 'the writer leaves nothing but decisions.md behind (no lock residue)');
  const a = computeAdoption({ runDir: fx.runDir, mainRoot: fx.root, cwd: fx.root, deps: deps(fx, NO_SPEC) });
  assert.strictEqual(a.case, 2);
});

test('a missing, empty, or whitespace-only decisions.md still classifies as case 2 (#2861, unchanged)', () => {
  for (const text of [null, '', '  \n\n']) assert.strictEqual(adoptionFor(text).a.case, 2, JSON.stringify(text));
});

test('any non-claim decisions.md content still classifies as case 3 with the same backfills as before (#2861 AC2)', () => {
  const mixed = `${CLAIM_ONLY}- AUTO 18:42:16 — Manifesto: design-critique resolved to auto (source: default). Reversibility: n/a.\n`;
  const headerOnly = '# Auto-Decision Log — pipeline 2026-09-06T000000-record-7\n\nPipeline config snapshot:\n- mode: auto\n';
  const unparseable = `${CLAIM_ONLY}Step 2.8: claimed #7\n`;
  for (const text of [mixed, headerOnly, '## /flow\n', unparseable, '## /build\n- AUTO 10:00:00 — x. Reversibility: high.\n', 'x\n']) {
    const { a } = adoptionFor(text);
    assert.strictEqual(a.case, 3, JSON.stringify(text));
    assert.strictEqual(a.hasOtherContent, true);
    assert.deepStrictEqual(a.backfills, ['worktree registration', 'PR-early lifecycle', 'materialize commit']);
  }
});

test('claim-log-only decisions.md beside a non-empty events.jsonl is still case 3; with config.yml it is still case 1 (#2861)', () => {
  assert.strictEqual(adoptionFor(CLAIM_ONLY, { 'events.jsonl': '{"event":"x"}\n' }).a.case, 3);
  const withConfig = adoptionFor(CLAIM_ONLY, { 'config.yml': 'mode: auto\n' }).a;
  assert.strictEqual(withConfig.case, 1);
  assert.strictEqual(withConfig.hasOtherContent, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/log-decision/claim-log.test.js`
Expected: FAIL — `Cannot find module '.../plugin/bin/lib/log-decision/claim-log'`.

Run: `node --test tests/bin-lib/flow/preflight.test.js`
Expected: FAIL — the two "classifies as case 2" tests report `3 !== 2`; the pre-existing tests and the "still classifies as case 3" / "missing, empty" tests pass.

- [ ] **Step 3: Implement**

`plugin/bin/lib/log-decision/append.js` — directly below `formatEntry`, add:

```js
// The inverse of formatEntry's fixed prefix: `- {STATUS} {HH:MM:SS} — {location}: {action}`.
// Returns null for anything that is not an entry line (a heading, a blank, a
// hand-written note) — callers must treat null as "not an entry", never as a match.
const ENTRY_RE = new RegExp(`^- (${STATUSES.join('|')}) (\\d{2}:\\d{2}:\\d{2}) — (.+?): (.*)$`);

function parseEntry(line) {
  const m = ENTRY_RE.exec(String(line));
  return m ? { status: m[1], time: m[2], location: m[3], action: m[4] } : null;
}
```

and add `parseEntry` to `module.exports`.

Create `plugin/bin/lib/log-decision/claim-log.js`:

```js
// The /flow Step 2.8 claim-log line (`flow/claim-targets.md`'s "Log the
// claim", #2492) — its shape, stated once. Two readers consume it:
// bin/lib/flow/preflight.js (a decisions.md holding only these lines is still
// a fresh mint, #2861) and bin/lib/hooks/pre-tool-use.js's hasLoggedClaim
// (#2526). tests/bin-lib/log-decision/claim-log.test.js pins these constants
// to the argv claim-targets.md documents.
'use strict';

const { parseEntry } = require('./append');

const CLAIM_LOG_SECTION = '/flow';
const CLAIM_LOG_STEP = 'Step 2.8';
const STEP_SRC = CLAIM_LOG_STEP.replace(/\./g, '\\.');
// One line per target (the documented form), or the single batch summary a
// real multi-record run writes instead (#2636).
const SINGLE_ACTION_SRC = 'claimed #\\d+\\b';
const BATCH_ACTION_SRC = 'Claimed all \\d+ targets under run\\b';
const ACTION_RE = new RegExp(`^(?:${SINGLE_ACTION_SRC}|${BATCH_ACTION_SRC})`);
const SECTION_HEADING = `## ${CLAIM_LOG_SECTION}`;

// The --text value claim-targets.md dictates for one claimed target.
function claimLogText(n, transport) {
  return `claimed #${n} (bin/claim-targets.js, transport: ${transport})`;
}

function isClaimLogEntry(line) {
  const entry = parseEntry(line);
  if (!entry || entry.status !== 'AUTO') return false;
  if (entry.location.replace(/^spec #\d+ — /, '') !== CLAIM_LOG_STEP) return false;
  return ACTION_RE.test(entry.action);
}

// Whole-file search, unanchored — hasLoggedClaim's long-standing semantics:
// the exact number (word-bounded, so #7 never matches #700), or the batch
// form, which covers every record in an all-or-abort group claim.
function hasClaimLogFor(body, n) {
  const text = String(body || '');
  if (new RegExp(`${STEP_SRC}: claimed #${n}\\b`).test(text)) return true;
  return new RegExp(`${STEP_SRC}: ${BATCH_ACTION_SRC}`).test(text);
}

// decisions.md text (null = file absent) -> 'absent' | 'empty' |
// 'claim-log-only' | 'content'. 'claim-log-only' needs at least one claim
// entry and nothing else but blank lines and the section heading the writer
// itself adds. Every line this cannot positively recognise is 'content' — a
// parse failure never reads as "only claim lines".
function classifyDecisions(text) {
  if (text === null || text === undefined) return 'absent';
  if (!String(text).trim()) return 'empty';
  let claims = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line === SECTION_HEADING) continue;
    if (!isClaimLogEntry(line)) return 'content';
    claims += 1;
  }
  return claims > 0 ? 'claim-log-only' : 'content';
}

module.exports = {
  CLAIM_LOG_SECTION, CLAIM_LOG_STEP, claimLogText, isClaimLogEntry, hasClaimLogFor, classifyDecisions,
};
```

`plugin/bin/lib/flow/preflight.js` — add the require beside the others:

```js
const { classifyDecisions } = require('../log-decision/claim-log');
```

and in `computeAdoption` replace

```js
  const hasOtherContent = nonEmpty(deps, path.join(real, 'decisions.md')) || nonEmpty(deps, path.join(real, 'events.jsonl')) || specMaterialized === true;
```

with

```js
  // /flow Step 2.8 logs its claim before this runs, so claim-log-only is still
  // a fresh mint (#2861); anything classifyDecisions cannot place is content.
  const decisionsHasContent = classifyDecisions(readText(deps, path.join(real, 'decisions.md'))) === 'content';
  const hasOtherContent = decisionsHasContent || nonEmpty(deps, path.join(real, 'events.jsonl')) || specMaterialized === true;
```

`plugin/bin/lib/hooks/pre-tool-use.js` — add beside the other requires:

```js
const { hasClaimLogFor } = require('../log-decision/claim-log');
```

and replace `hasLoggedClaim`'s body (keep its comment block; the function stays best-effort, never throws):

```js
function hasLoggedClaim(runDir, n) {
  try {
    return hasClaimLogFor(fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'), n);
  } catch {
    return false;
  }
}
```

`plugin/skills/flow/steps-and-gates.md`, section "Adopting an inherited run directory" — two in-place edits, nothing else in the file:

Case 2, replace `(no `decisions.md`/`events.jsonl` content, no `work/{n}-spec.md` committed on the run's branch)` with:

```
(no `events.jsonl` content, no `work/{n}-spec.md` committed on the run's branch, and no `decisions.md` content beyond Step 2.8's own claim-log lines — `claim-targets.md` logs them before this step, and the pack recognises them via `bin/lib/log-decision/claim-log.js`, #2861)
```

Case 3, replace `(a non-empty `decisions.md` and/or `events.jsonl`, or a `work/{n}-spec.md` file already committed on the run's branch)` with:

```
(a `decisions.md` holding anything other than Step 2.8's claim-log lines, a non-empty `events.jsonl`, or a `work/{n}-spec.md` file already committed on the run's branch)
```

Code path behind the prose claim: `computeAdoption` -> `classifyDecisions` (above).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/log-decision/claim-log.test.js tests/bin-lib/log-decision/append.test.js tests/bin-lib/log-decision/cli.test.js tests/bin-lib/flow/preflight.test.js tests/bin-lib/flow/preflight-cli.test.js tests/flow-preflight-conformance.test.js tests/hooks-bookkeeping-stamps-gate.test.js tests/dispatch-flow-rundir-handoff.test.js tests/flow-claim-preflight.test.js`
Expected: PASS, 0 failures. Quote the raw `# tests` / `# pass` / `# fail` lines in your report.

Then run this real-input probe and quote its output (expected: `content` for the first, a non-`claim-log-only` value for the second — report whatever it prints):

Run: `node -e "const fs=require('fs');const {classifyDecisions}=require('./plugin/bin/lib/log-decision/claim-log');for (const f of process.argv.slice(1)) console.log(classifyDecisions(fs.readFileSync(f,'utf8')), f)" "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-04T163945-record-2861/decisions.md"`

- [ ] **Step 5: Commit**

Run `pwd` and `git rev-parse --show-toplevel` first; both must print `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-2861`. Then, as separate commands:

```bash
git add plugin/bin/lib/log-decision/append.js plugin/bin/lib/log-decision/claim-log.js plugin/bin/lib/flow/preflight.js plugin/bin/lib/hooks/pre-tool-use.js plugin/skills/flow/steps-and-gates.md tests/bin-lib/log-decision/claim-log.test.js tests/bin-lib/flow/preflight.test.js
git commit -m "Classify a claim-log-only decisions.md as a fresh mint — share the Step 2.8 line shape between preflight and the stamps gate, refs #2861"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (classification ignores claim-step entries, recognised by section + line shape) — `classifyDecisions` + the `computeAdoption` edit. Deliverable 2 (regression test, claim-log-only run dir) — the two "classifies as case 2" tests. AC1 — same tests. AC2 — "any non-claim decisions.md content still classifies as case 3" plus the unchanged pre-existing case-3 tests.
- **Placeholders:** none.
- **Type consistency:** `parseEntry`, `classifyDecisions`, `hasClaimLogFor`, `isClaimLogEntry`, `claimLogText`, `CLAIM_LOG_SECTION`, `CLAIM_LOG_STEP` are spelled identically in the Interfaces block, the implementation, and both test files.
- **Return-shape widening:** none — `computeAdoption`'s return shape is unchanged.
- **Byte pins:** `steps-and-gates.md` grows by roughly 250 bytes against 11,890 bytes of headroom.
