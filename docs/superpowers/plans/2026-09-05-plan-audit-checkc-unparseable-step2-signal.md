# plan-audit Check C: "Step 2 present but unparseable" diagnostic signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `plan-audit.js`'s Check C a distinct, non-blocking warning signal for a task whose plan declares a Step 2 verification sub-step that the parser cannot extract a `Run:`/`Expected:` pair from — instead of silently collapsing that case into "no Step 2 at all" (today's behavior).

**Architecture:** `parser.js` gains a broader, wording-agnostic detector for a Step 2 checkbox line (`STEP2_CHECKBOX_RE`) plus `extractUnparseableStep2s(text)`, which classifies each task's Step 2 as `absent` / `parsed` / `unparseable` and returns the `unparseable` ones with a short raw excerpt. `checks.js`'s `checkC` gains an optional 4th parameter carrying that list and echoes it back as a new `warnings` array in its return value — `ok`/`findings` (and therefore the CLI's exit code) are unaffected. `plan-audit.js` wires the new extractor into its existing `checkC` call. `plan-audit.md` (the skill doc) documents the new field.

**Tech Stack:** Plain Node.js (`node:test`, no external deps), matching the rest of `plugin/bin/lib/plan-audit/`.

**Spec:** GitHub issue #1594 ("plan-audit: Check C needs a \"Step 2 present but unparseable\" diagnostic signal") — materialized at `.claude-tweaks/pipelines/archive/2026-09-05T155335-record-1594/work/1594-spec.md` (archived) in this worktree.

## Global Constraints

- Pure functions only in `parser.js` — no `fs`/`process` access (existing file header convention).
- `checkC`'s existing positional arguments (`verificationChecks, repoRoot, deps`) must not change position or default — only append a new 4th parameter — so every existing call site and test keeps working unchanged.
- The new signal must never change `checkC.ok` or the CLI's exit code (AC2 in the spec) — it is a warning, not a finding.
- Regression coverage must reproduce the real drift shape named in the spec: a `- [ ] **Step 2: Run it to confirm FAIL**` heading followed by a fenced ```` ```bash ```` code block (the command, with no `Run:` label) and then a bare `Expected: FAIL …` line — the shape `docs/superpowers/plans/2026-08-26-sweep-residue-needs-decision-marker.md` had before it was deleted (recovered from git history at commit `3abba9020`).

---

### Task 1: Parser — detect a present-but-unparseable Step 2

**Files:**
- Modify: `plugin/bin/lib/plan-audit/parser.js`
- Test: `tests/bin-lib/plan-audit/parser.test.js`

**Interfaces:**
- Consumes: `extractTaskBlocks(text)` (existing, returns `[{taskNumber, title, body}]`), `extractStep2Verification(taskBody)` (existing, returns `{command, expected}` or `null`) — both already defined in this file, called directly, no new imports.
- Produces: `extractUnparseableStep2s(text)` → `[{taskNumber, title, raw}, ...]`, one entry per task whose Step 2 is present but the strict extractor above returns `null` for it. `raw` is a short (≤5 non-blank lines) trimmed excerpt of that task's Step 2 section, or `null` if no excerpt could be located. Exported alongside the existing exports. Later tasks (Task 3) call this function by this exact name and shape.

- [ ] **Step 1: Write the failing test**

Add these tests to `tests/bin-lib/plan-audit/parser.test.js`, just after the existing `extractVerificationChecks` test (end of file):

```javascript
test('extractUnparseableStep2s: absent when a task has no Step 2 checkbox line at all', () => {
  const text = [
    '### Task 1: Doc-only task',
    '- [ ] **Step 1: Update the doc**',
    '',
    'No Step 2 here at all.',
  ].join('\n');
  assert.deepStrictEqual(extractUnparseableStep2s(text), []);
});

test('extractUnparseableStep2s: absent when Step 2 parses cleanly', () => {
  const text = [
    '### Task 1: Clean task',
    '- [ ] **Step 2: Run the new tests to verify they fail**',
    '',
    'Run: `node --test tests/foo.test.js`',
    'Expected: FAIL — assertion not yet true',
  ].join('\n');
  assert.deepStrictEqual(extractUnparseableStep2s(text), []);
});

test('extractUnparseableStep2s: flags a Step 2 whose command sits in a fenced code block with no Run: label (real drift shape, #1594)', () => {
  const text = [
    '### Task 1: Add the needs:decision label',
    '**Files:**',
    '- Modify: `work-record.md`',
    '',
    '- [ ] **Step 2: Run it to confirm FAIL**',
    '',
    '```bash',
    'node --test tests/work-record-needs-decision-conformance.test.js',
    '```',
    '',
    'Expected: FAIL on the first four tests (the go-red control test passes immediately).',
    '',
    '- [ ] **Step 3: Add the row**',
  ].join('\n');
  const result = extractUnparseableStep2s(text);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].taskNumber, '1');
  assert.strictEqual(result[0].title, 'Add the needs:decision label');
  assert.ok(result[0].raw.includes('Step 2: Run it to confirm FAIL'), `raw excerpt should include the Step 2 heading, got: ${result[0].raw}`);
});

test('extractUnparseableStep2s: flags a non-bold Step 2 checkbox line the strict extractor cannot see at all', () => {
  const text = [
    '### Task 1: Unusual formatting',
    '- [ ] Step 2: verify the fix fails without it',
    '',
    'some prose with no Run:/Expected: pair',
  ].join('\n');
  const result = extractUnparseableStep2s(text);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].taskNumber, '1');
});

test('extractUnparseableStep2s: scans every task in a multi-task plan independently', () => {
  const text = [
    '### Task 1: Clean',
    '- [ ] **Step 2: Run test to verify it fails**',
    '',
    'Run: `node --test a.test.js`',
    'Expected: FAIL',
    '',
    '### Task 2: Unparseable',
    '- [ ] **Step 2: Confirm it fails**',
    '',
    '```bash',
    'node --test b.test.js',
    '```',
    '',
    'Expected: FAIL',
  ].join('\n');
  const result = extractUnparseableStep2s(text);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].taskNumber, '2');
});
```

Also add `extractUnparseableStep2s` to the destructured import at the top of the file:

```javascript
const {
  extractFileEntries, extractScopeKeywords, extractTaskBlocks,
  extractStep2Verification, extractVerificationChecks, extractUnparseableStep2s,
} = require('../../../plugin/bin/lib/plan-audit/parser');
```

- [ ] **Step 2: Run it to confirm FAIL**

Run: `node --test tests/bin-lib/plan-audit/parser.test.js`
Expected: FAIL with "extractUnparseableStep2s is not a function" (or `undefined is not a function`) on the five new tests; the pre-existing tests in this file still pass.

- [ ] **Step 3: Implement `extractUnparseableStep2s`**

In `plugin/bin/lib/plan-audit/parser.js`, add after `extractStep2Verification` (before `extractVerificationChecks`):

```javascript
// Broader than the strict heading matched by extractStep2Verification above
// (which requires bold "**Step 2:...**" text) — detects any checkbox-style
// Step 2 line regardless of wording or bold formatting, so a task can be
// classified as "Step 2 present" even when the strict extractor below can't
// parse it. Used to distinguish "no Step 2 at all" (nothing to report; a
// non-code task, per plan-audit.md's Check C) from "Step 2 present but
// unparseable" (#1594's signal).
const STEP2_CHECKBOX_RE = /^[-*]\s*\[[ xX]?\]\s*.*\bStep\s+2\b.*$/m;

// Within one task body whose STEP2_CHECKBOX_RE already matched, returns a
// short raw excerpt (up to 5 non-blank lines, from the checkbox line to the
// next step heading or end of body) for diagnostic display when the strict
// Run:/Expected: extraction can't parse a verification pair from it. Returns
// null if no checkbox line is found (caller only invokes this after
// confirming one exists, but stays defensive rather than assuming).
function extractStep2RawExcerpt(taskBody) {
  const headingMatch = STEP2_CHECKBOX_RE.exec(taskBody);
  if (!headingMatch) return null;
  const afterHeading = taskBody.slice(headingMatch.index + headingMatch[0].length);
  const nextStep = afterHeading.match(/\n[-*]\s*\[[ xX]?\]\s*.*\bStep\s+\d+\b/);
  const window = nextStep
    ? taskBody.slice(headingMatch.index, headingMatch.index + headingMatch[0].length + nextStep.index)
    : taskBody.slice(headingMatch.index);
  return window.trim().split('\n').filter((l) => l.trim() !== '').slice(0, 5).join('\n');
}

// Per-task Step 2 diagnostic status: 'absent' (no Step 2 checkbox line at
// all), 'unparseable' (a Step 2 checkbox line exists but
// extractStep2Verification couldn't parse a verification pair from it), or
// 'parsed' (extractStep2Verification already succeeded — nothing to report).
function extractStep2Status(taskBody) {
  if (!STEP2_CHECKBOX_RE.test(taskBody)) return { status: 'absent' };
  if (extractStep2Verification(taskBody) !== null) return { status: 'parsed' };
  return { status: 'unparseable', raw: extractStep2RawExcerpt(taskBody) };
}

// Convenience: every task in the plan whose Step 2 is present but
// unparseable — plan-audit.js's Check C reports these as warnings (never a
// hard finding) so a human can judge whether the plan needs updating to the
// canonical template or the parser needs to learn a legitimately new shape
// (#1594).
function extractUnparseableStep2s(text) {
  return extractTaskBlocks(text)
    .map((task) => ({ task, diagnostic: extractStep2Status(task.body) }))
    .filter(({ diagnostic }) => diagnostic.status === 'unparseable')
    .map(({ task, diagnostic }) => ({
      taskNumber: task.taskNumber,
      title: task.title,
      raw: diagnostic.raw,
    }));
}
```

Add `extractUnparseableStep2s` to `module.exports` at the bottom of the file (keep every existing export):

```javascript
module.exports = {
  extractFileEntries,
  extractScopeKeywords,
  extractTaskBlocks,
  extractStep2Verification,
  extractVerificationChecks,
  extractUnparseableStep2s,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/plan-audit/parser.test.js`
Expected: PASS, all tests (pre-existing plus the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/plan-audit/parser.js tests/bin-lib/plan-audit/parser.test.js
git commit -m "plan-audit parser: detect a present-but-unparseable Step 2 (#1594)"
```

---

### Task 2: checks.js — surface the signal as a non-blocking Check C warning

**Files:**
- Modify: `plugin/bin/lib/plan-audit/checks.js`
- Test: `tests/bin-lib/plan-audit/checks.test.js`

**Interfaces:**
- Consumes: `extractUnparseableStep2s`'s output shape from Task 1 — `[{taskNumber, title, raw}, ...]` — passed in as `checkC`'s new 4th parameter, not imported (this module stays a pure `{ok, findings}`-style checker; the caller in Task 3 does the extraction).
- Produces: `checkC(verificationChecks, repoRoot, deps = {}, unparseableStep2s = [])` → `{ok, findings, warnings}`. `warnings` is `[{task, title, raw}, ...]` (one entry per `unparseableStep2s` input item, field renamed `taskNumber` → `task` to match `findings`' own `task` field naming). `ok` is computed from `findings` only, exactly as before — `warnings` never affects it.

- [ ] **Step 1: Write the failing test**

Add these tests to `tests/bin-lib/plan-audit/checks.test.js`, immediately after the existing `'checkC with no verification checks passes trivially'` test:

```javascript
test('checkC returns an empty warnings array when no unparseable Step 2s are passed', () => {
  const result = checkC([], '/repo', { run: () => { throw new Error('must not be called'); } });
  assert.deepStrictEqual(result.warnings, []);
});

test('checkC surfaces unparseable Step 2s as warnings without affecting ok or findings', () => {
  const unparseableStep2s = [
    { taskNumber: '3', title: 'Add the row', raw: '- [ ] **Step 2: Run it to confirm FAIL**\n\n```bash\nnode --test x.test.js\n```' },
  ];
  const result = checkC([], '/repo', {}, unparseableStep2s);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.findings, []);
  assert.strictEqual(result.warnings.length, 1);
  assert.strictEqual(result.warnings[0].task, '3');
  assert.strictEqual(result.warnings[0].title, 'Add the row');
  assert.match(result.warnings[0].raw, /Step 2: Run it to confirm FAIL/);
});

test('checkC: a real finding and an unparseable warning coexist independently', () => {
  const deps = { run: () => ({ exitCode: 0, output: 'PASS\n' }) };
  const result = checkC(
    [{ taskNumber: '1', title: 'A', command: 'node -e "process.exit(0)"', expected: 'FAIL' }],
    '/repo', deps,
    [{ taskNumber: '2', title: 'B', raw: 'raw text' }],
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.warnings.length, 1);
  assert.strictEqual(result.warnings[0].task, '2');
});
```

- [ ] **Step 2: Run it to confirm FAIL**

Run: `node --test tests/bin-lib/plan-audit/checks.test.js`
Expected: FAIL on the three new tests — `result.warnings` is `undefined` (`checkC` doesn't return a `warnings` field yet), so the `assert.deepStrictEqual`/`assert.strictEqual` calls against it throw. Pre-existing tests in this file still pass.

- [ ] **Step 3: Implement the `warnings` field**

In `plugin/bin/lib/plan-audit/checks.js`, change `checkC`'s signature and return value:

```javascript
function checkC(verificationChecks, repoRoot, deps = {}, unparseableStep2s = []) {
  const run = deps.run || ((command, cwd) => {
    try {
      const output = execFileSync(command, { cwd, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { exitCode: 0, output };
    } catch (err) {
      const output = `${err.stdout || ''}${err.stderr || ''}`;
      return { exitCode: typeof err.status === 'number' ? err.status : 1, output };
    }
  });
  const findings = [];
  for (const { taskNumber, title, command, expected } of verificationChecks) {
    const { exitCode, output } = run(command, repoRoot);
    if (looksPassing(exitCode, output)) {
      findings.push({
        task: taskNumber, title, command, expected,
        actualExitCode: exitCode,
        actualSummary: output.trim().split('\n').slice(0, 5).join('\n'),
      });
    }
  }
  const warnings = unparseableStep2s.map(({ taskNumber, title, raw }) => ({ task: taskNumber, title, raw }));
  return { ok: findings.length === 0, findings, warnings };
}
```

(Only the function signature's added 4th parameter, the new `warnings` line, and the return statement change — the `run`/`findings`-building loop is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/plan-audit/checks.test.js`
Expected: PASS, all tests (pre-existing plus the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/plan-audit/checks.js tests/bin-lib/plan-audit/checks.test.js
git commit -m "plan-audit checkC: surface unparseable Step 2s as non-blocking warnings (#1594)"
```

---

### Task 3: Wire the CLI, update the skill doc, and pin the real-plan regression shape

**Files:**
- Modify: `plugin/bin/plan-audit.js`
- Modify: `plugin/skills/build/plan-audit.md`
- Test: `tests/bin-lib/plan-audit/cli.test.js`

**Interfaces:**
- Consumes: `extractUnparseableStep2s(text)` (Task 1) and `checkC(verificationChecks, repoRoot, deps, unparseableStep2s)` (Task 2) — both already implemented; this task only wires them together in `plan-audit.js`'s existing `main()`.
- Produces: nothing new for further tasks — this is the last task.

- [ ] **Step 1: Write the failing test**

Add this test to `tests/bin-lib/plan-audit/cli.test.js`, immediately after the existing `AC6` test (`'AC6: a fixture plan whose Step 2 command already passes...'`):

```javascript
// AC1/AC2/AC3 from #1594's own spec — the real drift shape recovered from
// docs/superpowers/plans/2026-08-26-sweep-residue-needs-decision-marker.md
// (deleted at commit a9d11d408; recovered from commit 3abba9020) before its
// own regex-matching fix: a Step 2 heading worded "confirm FAIL" whose
// command sits in a fenced ```bash code block with no `Run:` label.
test('#1594: a fixture plan reproducing the real fenced-code-block Step 2 drift produces a checkC warning, not a silent no-op, and still exits 0', () => {
  const repo = makeTmpRepo();
  try {
    const plan = writePlan(repo, [
      '### Task 1: Add the needs:decision label',
      '**Files:**',
      '- Modify: `plan.md`',
      '',
      '- [ ] **Step 2: Run it to confirm FAIL**',
      '',
      '```bash',
      'node --test tests/work-record-needs-decision-conformance.test.js',
      '```',
      '',
      'Expected: FAIL on the first four tests (the go-red control test passes immediately).',
      '',
      '- [ ] **Step 3: Add the row**',
    ].join('\n'));
    const { exitCode, stdout } = runCli(plan, repo);
    assert.strictEqual(exitCode, 0);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.checkC.ok, true);
    assert.deepStrictEqual(report.checkC.findings, []);
    assert.strictEqual(report.checkC.warnings.length, 1);
    assert.strictEqual(report.checkC.warnings[0].task, '1');
    assert.match(report.checkC.warnings[0].raw, /Step 2: Run it to confirm FAIL/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run it to confirm FAIL**

Run: `node --test tests/bin-lib/plan-audit/cli.test.js`
Expected: FAIL — `report.checkC.warnings` is `undefined` (`plan-audit.js` doesn't compute or pass `unparseableStep2s` yet, so `checkC`'s default empty array means `warnings` would in fact already be `[]` once Task 2 lands — but since Task 1/2 land as separate commits before this one, at the point this step runs both are already committed, so the *real* failure here is `report.checkC.warnings.length` being `0`, not `1`, because `plan-audit.js` itself never calls `extractUnparseableStep2s`). Confirm the assertion on `warnings.length` (or `warnings[0]`) is what fails; every pre-existing test in this file still passes.

- [ ] **Step 3: Wire the extractor into `plan-audit.js`, and document the new field**

In `plugin/bin/plan-audit.js`, add `extractUnparseableStep2s` to the destructured import:

```javascript
const {
  extractFileEntries, extractScopeKeywords, extractVerificationChecks, extractUnparseableStep2s,
} = require('./lib/plan-audit/parser');
```

Compute it alongside the other extractions and pass it into `checkC`:

```javascript
  const entries = extractFileEntries(text);
  const scopeKeywords = extractScopeKeywords(text);
  const verificationChecks = extractVerificationChecks(text);
  const unparseableStep2s = extractUnparseableStep2s(text);

  const report = {
    checkA: checkA(entries, repoRoot),
    checkB: checkB(scopeKeywords, entries.map((e) => e.path), repoRoot),
    checkC: checkC(verificationChecks, repoRoot, {}, unparseableStep2s),
    headroom: headroomCheck(entries, repoRoot),
  };
```

(`checkC`'s 3rd argument moves from omitted-default to an explicit `{}` so the 4th argument can be passed positionally — behaviorally identical to the omitted default.)

Also update `summaryLine` to surface a non-zero warning count (still never affecting `pass`/exit code — it's appended to the same `parts` array as the existing informational `nearCeiling` line):

```javascript
function summaryLine(report) {
  const parts = [];
  if (!report.checkA.ok) parts.push(`Check A: ${report.checkA.missing.length} missing path(s)`);
  if (!report.checkB.ok) parts.push(`Check B: ${report.checkB.unplanned.length} unplanned file(s)`);
  if (!report.checkC.ok) parts.push(`Check C: ${report.checkC.findings.length} non-discriminating command(s)`);
  if (report.checkC.warnings.length) parts.push(`Check C: ${report.checkC.warnings.length} unparseable Step 2(s)`);
  if (!report.headroom.ok) parts.push(`Headroom: ${report.headroom.breaches.length} breach(es)`);
  if (report.headroom.nearCeiling.length) parts.push(`Headroom: ${report.headroom.nearCeiling.length} near-ceiling`);
  if (parts.length === 0) return 'plan-audit: clean — no findings.';
  return `plan-audit: ${parts.join('; ')}.`;
}
```

In `plugin/skills/build/plan-audit.md`, update line 13's envelope-shape mention and the Check C result-interpretation bullet (line 18) and "What each check covers" bullet (line 60):

Change line 13 from:
```
Stdout is two lines: a compact JSON envelope (`{checkA, checkB, checkC, headroom}`, each `{ok, ...}`), then a one-line human summary.
```
to:
```
Stdout is two lines: a compact JSON envelope (`{checkA, checkB, checkC, headroom}`, each `{ok, ...}`), then a one-line human summary. `checkC` additionally always carries `warnings: [{task, title, raw}, ...]` — tasks whose Step 2 is present but unparseable (see below) — independent of `ok`.
```

Add a new bullet immediately after the existing `checkC.ok === false` bullet (after line 18):
```
- **`checkC.warnings`** (non-empty, `ok` still `true`) — informational only, never a stop: one entry per task whose Step 2 checkbox line is present but the parser could not extract a `Run:`/`Expected:` pair from it (a wording or formatting drift — e.g. the command sitting in a fenced code block instead of a `Run:` line). Surface it inline (task, title, and the raw excerpt) so a human can judge whether the plan needs updating to the canonical template or the parser needs to learn a legitimately new shape.
```

Change the Check C bullet under "What each check covers" (line 60) from:
```
- **Check C** — for each task's own `- [ ] **Step 2: …**` sub-step declaring `Run: {command}` / `Expected: FAIL …`, runs `{command}` once, read-only, against current repo state. The only finding: the command already exhibits a passing/success signature (exit code 0, or a success marker with no failure marker) despite the `Expected: FAIL` declaration. A command erroring or cleanly failing pre-dispatch is never a finding — a hard error on a later task in a plan whose tasks build on each other sequentially is common and expected.
```
to:
```
- **Check C** — for each task's own `- [ ] **Step 2: …**` sub-step declaring `Run: {command}` / `Expected: FAIL …`, runs `{command}` once, read-only, against current repo state. The only finding: the command already exhibits a passing/success signature (exit code 0, or a success marker with no failure marker) despite the `Expected: FAIL` declaration. A command erroring or cleanly failing pre-dispatch is never a finding — a hard error on a later task in a plan whose tasks build on each other sequentially is common and expected. Separately, a task whose Step 2 checkbox line is present but whose `Run:`/`Expected:` pair the parser can't extract (a wording/formatting drift, not "no Step 2 at all") is reported as a `warnings` entry — never a finding, never blocking.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/plan-audit/cli.test.js tests/bin-lib/plan-audit/checks.test.js tests/bin-lib/plan-audit/parser.test.js`
Expected: PASS, every test in all three files.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/plan-audit.js plugin/skills/build/plan-audit.md tests/bin-lib/plan-audit/cli.test.js
git commit -m "plan-audit: wire unparseable-Step-2 warnings into the CLI and doc (#1594)"
```
