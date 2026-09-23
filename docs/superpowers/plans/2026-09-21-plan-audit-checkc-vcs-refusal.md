# plan-audit Check C VCS-Mutation Refusal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `bin/plan-audit.js`'s Check C must never execute a VCS-mutating command (`git stash`, `git commit`, etc., or a writing `gh` subcommand) that its `Run:`-line extraction pulled out of a task's Step 2 window, even when that line's surrounding prose only *mentions* the command rather than declaring it as the verification step.

**Architecture:** Check C's own execution path (`checkC` in `plugin/bin/lib/plan-audit/checks.js`) gains a pre-execution refusal: before calling `run(command, repoRoot)`, split the extracted command on top-level `&&`/`;`/`|` segment separators (quote-aware, so a separator character inside a quoted argument is never treated as a real segment boundary) and check each segment's leading `git <verb>` or `gh <subcommand>` pair against a refusal list. A match is never executed — it is pushed to `checkC`'s existing `warnings` array (never `findings`) with a `reason: 'vcs-mutation-refusal'` field, distinct from the array's existing `{task, title, raw}` unparseable-Step-2 shape. `checkC`'s return also gains an `executed` array (`{task, command}` per command actually run) so the audit output can show what it ran. `extractStep2Verification`'s own backtick extraction is intentionally left unchanged — real plans under `docs/superpowers/plans/` routinely follow a genuine `` Run: `command` `` with a trailing parenthetical note (e.g. `` Run: `npm test` (confirms ...) ``), so tightening the extraction to require the backtick be the *entire* line remainder would break those working plans; the refusal is the actual fix, applied after extraction the same way for every shape.

**Tech Stack:** Node.js (`node --test`), no external dependencies.

**Spec:** `/home/user/claude-tweaks/.claude/worktrees/dispatch-record-2593/.claude-tweaks/pipelines/2026-09-21T182513-record-2593/work/2593-spec.md`

## Global Constraints

- No new dependencies — pure Node.js, matching every other file in `plugin/bin/lib/plan-audit/`.
- `checkC`'s existing exported shape (`ok`, `findings`, `warnings`, `appendShaped`) must keep behaving exactly as today for every currently-passing scenario (AC3, AC6) — only add fields/branches, never change existing ones.
- Follow the neighboring test files' conventions exactly: `node:test` + `node:assert`, `deps.run` fake-injection for `checkC`, `makeTmpRepo`/`writePlan` helpers already defined in `tests/bin-lib/plan-audit/cli.test.js`.

---

### Task 1: VCS-mutation refusal + executed tracking in `checkC`

**Files:**
- Modify: `plugin/bin/lib/plan-audit/checks.js`
- Test: `tests/bin-lib/plan-audit/checks.test.js`

**Interfaces:**
- Consumes: nothing new — same `checkC(verificationChecks, repoRoot, deps, unparseableStep2s)` signature.
- Produces: `checkC(...)` return object gains one new key, `executed: [{task, command}]` (one entry per command Check C actually ran via `deps.run`/the default `run`), and `warnings` may now also contain `{task, title, command, reason: 'vcs-mutation-refusal', verb}` entries alongside the existing `{task, title, raw}` shape. `title` is the task's title (already available on each `verificationChecks` entry passed to `checkC`). `verb` is the matched `"git {subverb}"`/`"gh {subverb}"` string (e.g. `"git stash"`), for a human-readable message.

- [ ] **Step 1: Write the failing tests**

Add to `tests/bin-lib/plan-audit/checks.test.js` (append near the existing Check C tests, after the "checkC: the existing AC6 non-discriminating fixture still fails" test around line 345-360 — read that test first to match its exact style):

```js
test('checkC refuses a `git stash` command extracted from prose that only mentions it (#2593) — never executes it, reported as a warning with a vcs-mutation-refusal reason', () => {
  const deps = { run: () => { throw new Error('must not be called — refused commands are never executed'); } };
  const result = checkC(
    [{
      taskNumber: '1',
      title: 'Remove the plan file',
      command: 'git stash push -u -m tag',
      expected: 'FAIL',
    }],
    '/repo', deps,
  );
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.findings, []);
  assert.deepStrictEqual(result.executed, []);
  assert.strictEqual(result.warnings.length, 1);
  assert.strictEqual(result.warnings[0].task, '1');
  assert.strictEqual(result.warnings[0].command, 'git stash push -u -m tag');
  assert.strictEqual(result.warnings[0].reason, 'vcs-mutation-refusal');
  assert.strictEqual(result.warnings[0].verb, 'git stash');
});

test('checkC refuses every git/gh mutation verb in the refusal list', () => {
  const verbs = [
    'git stash list', 'git commit -am wip', 'git push origin main', 'git reset --hard',
    'git checkout main', 'git switch main', 'git clean -fd', 'git rebase main', 'git merge main',
    'gh issue close 1', 'gh pr merge 1',
  ];
  for (const command of verbs) {
    const deps = { run: () => { throw new Error(`must not run: ${command}`); } };
    const result = checkC([{ taskNumber: '1', title: 'T', command, expected: 'FAIL' }], '/repo', deps);
    assert.strictEqual(result.warnings.length, 1, `expected a refusal warning for: ${command}`);
    assert.strictEqual(result.warnings[0].reason, 'vcs-mutation-refusal', `for: ${command}`);
  }
});

test('checkC refuses a compound command whose mutation verb follows && (#2593 AC4)', () => {
  const deps = { run: () => { throw new Error('must not be called'); } };
  const result = checkC(
    [{ taskNumber: '1', title: 'T', command: 'npm test && git commit -am wip', expected: 'FAIL' }],
    '/repo', deps,
  );
  assert.strictEqual(result.warnings.length, 1);
  assert.strictEqual(result.warnings[0].reason, 'vcs-mutation-refusal');
  assert.strictEqual(result.warnings[0].verb, 'git commit');
});

test('checkC refuses a compound command whose mutation verb follows ; or |', () => {
  for (const command of ['npm test; git push origin main', 'npm test | git commit -am wip']) {
    const deps = { run: () => { throw new Error(`must not run: ${command}`); } };
    const result = checkC([{ taskNumber: '1', title: 'T', command, expected: 'FAIL' }], '/repo', deps);
    assert.strictEqual(result.warnings.length, 1, `for: ${command}`);
    assert.strictEqual(result.warnings[0].reason, 'vcs-mutation-refusal', `for: ${command}`);
  }
});

test('checkC does not refuse a mutation verb appearing only inside a quoted argument', () => {
  const deps = { run: () => ({ exitCode: 1, output: 'Error: not defined\n' }) };
  const result = checkC(
    [{ taskNumber: '1', title: 'T', command: 'node -e "console.log(\'git commit\')"', expected: 'FAIL' }],
    '/repo', deps,
  );
  assert.strictEqual(result.warnings.length, 0);
  assert.strictEqual(result.executed.length, 1);
});

test('checkC still executes and records a genuinely non-mutating command exactly as before (regression, AC3/AC6)', () => {
  const deps = { run: () => ({ exitCode: 0, output: 'pass\n' }) };
  const result = checkC(
    [{ taskNumber: '1', title: 'T', command: 'node -e "process.exit(0)"', expected: 'FAIL with "guard not present"' }],
    '/repo', deps,
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.findings.length, 1);
  assert.deepStrictEqual(result.executed, [{ task: '1', command: 'node -e "process.exit(0)"' }]);
});

test('checkC a git subcommand not on the refusal list (e.g. git status) still executes normally', () => {
  const calls = [];
  const deps = { run: (command, cwd) => { calls.push({ command, cwd }); return { exitCode: 0, output: 'clean\n' }; } };
  const result = checkC(
    [{ taskNumber: '1', title: 'T', command: 'git status', expected: 'FAIL' }],
    '/repo', deps,
  );
  assert.strictEqual(result.warnings.length, 0);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(result.executed, [{ task: '1', command: 'git status' }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/plan-audit/checks.test.js`
Expected: FAIL — `result.executed` is `undefined` (`checkC` doesn't return that key yet) and the refusal tests throw the fake `run`'s "must not be called" errors, since nothing refuses the command yet.

- [ ] **Step 3: Implement the refusal + executed tracking**

In `plugin/bin/lib/plan-audit/checks.js`, add the following above `checkC` (after the `isAppendShaped` function, before the `// ── Check C —` comment's `checkC` definition — actually place it directly above `function checkC`):

```js
// ── Check C safety net — VCS-mutation refusal (#2593) ───────────────────────
// Check C is documented read-only (plan-audit.md): it pre-runs each task's
// declared Step 2 verification command against the live repo. Production
// incident (2026-09-18, plugin 6.126.0): a task's Step 2 prose merely
// MENTIONED a forbidden command ("Run: never run `git stash push -u -m tag`
// here; use a WIP commit instead") and extractStep2Verification's
// first-backtick-span extraction still pulled it out as "the" command,
// which checkC then executed — sweeping an untracked file off the
// repository-wide shared stash stack. Tightening extraction itself is not
// the fix: real plans routinely follow a genuine `Run: \`command\`` with a
// trailing parenthetical note (grep docs/superpowers/plans/*.md for
// `^Run: \`` — every real instance has one or more), so a stricter
// "backtick must be the entire line" rule breaks those. The actual fix is
// this refusal, applied identically regardless of how the command text was
// extracted: before ever calling run(), reject any command whose first
// token (or any token immediately after a top-level `&&`/`;`/`|` segment
// separator) is a VCS-mutation verb.
const GIT_MUTATION_VERBS = new Set([
  'stash', 'commit', 'push', 'reset', 'checkout', 'switch', 'clean', 'rebase', 'merge',
]);
// gh subcommands that write (create/edit/close/etc.) — read-only
// subcommands (view, list, status, ...) are deliberately absent; anything
// not in this set is treated as non-mutating for `gh`.
const GH_WRITE_SUBCOMMANDS = new Set([
  'create', 'edit', 'close', 'reopen', 'merge', 'delete', 'comment',
  'lock', 'unlock', 'ready', 'review', 'pin', 'unpin', 'transfer', 'label',
]);

// Quote-aware split on top-level &&/;/| — a separator character inside a
// single- or double-quoted argument is never treated as a segment boundary.
// This is a pre-execution safety refusal, not a full shell parser: it is
// deliberately conservative (a false "looks safe" for a sufficiently
// obfuscated command is possible) rather than exhaustive.
function commandSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '&' && command[i + 1] === '&') { segments.push(current); current = ''; i += 1; continue; }
    if (ch === ';' || ch === '|') { segments.push(current); current = ''; continue; }
    current += ch;
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter(Boolean);
}

// Returns the matched "git {verb}"/"gh {subcommand}" string when `segment`
// starts with a refused verb, or null when it's clear to run.
function mutationVerb(segment) {
  const tokens = segment.split(/\s+/);
  if (tokens[0] === 'git' && GIT_MUTATION_VERBS.has(tokens[1])) return `git ${tokens[1]}`;
  if (tokens[0] === 'gh' && GH_WRITE_SUBCOMMANDS.has(tokens[1])) return `gh ${tokens[1]}`;
  return null;
}

// Returns the matched verb string for the first refused segment found in
// `command`, or null when every segment is clear to run.
function refusedVcsMutation(command) {
  for (const segment of commandSegments(command)) {
    const verb = mutationVerb(segment);
    if (verb) return verb;
  }
  return null;
}
```

Then replace the existing `checkC` function body with:

```js
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
  const appendShaped = [];
  const executed = [];
  const refused = [];
  for (const check of verificationChecks) {
    const {
      taskNumber, title, command, expected,
    } = check;
    const verb = refusedVcsMutation(command);
    if (verb) {
      refused.push({
        task: taskNumber, title, command, reason: 'vcs-mutation-refusal', verb,
      });
      continue;
    }
    executed.push({ task: taskNumber, command });
    const { exitCode, output } = run(command, repoRoot);
    if (looksPassing(exitCode, output)) {
      const { shaped, path: shapedPath } = isAppendShaped(check, repoRoot);
      if (shaped) {
        appendShaped.push({
          task: taskNumber, title, command, path: shapedPath,
        });
        continue;
      }
      findings.push({
        task: taskNumber, title, command, expected,
        actualExitCode: exitCode,
        actualSummary: output.trim().split('\n').slice(0, 5).join('\n'),
      });
    }
  }
  // #1594: tasks whose Step 2 is present but unparseable (a wording/
  // formatting drift the parser couldn't extract a Run:/Expected: pair
  // from) — informational only, never a finding, never affects `ok`.
  const warnings = unparseableStep2s.map(({ taskNumber, title, raw }) => ({ task: taskNumber, title, raw }))
    .concat(refused);
  return {
    ok: findings.length === 0, findings, warnings, appendShaped, executed,
  };
}
```

Finally, add the four new helpers to the `module.exports` at the bottom of the file (append, don't reorder the existing keys):

```js
module.exports = {
  checkA, checkB, checkC, checkD, headroomCheck, looksPassing, isGovernedMdPath,
  refusedVcsMutation, commandSegments,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/plan-audit/checks.test.js`
Expected: PASS — all tests, including the 7 added above and every pre-existing Check C test.

- [ ] **Step 5: Run the full checks.test.js suite once more to confirm no regression**

Run: `node --test tests/bin-lib/plan-audit/`
Expected: PASS — every file in the directory (`checks.test.js`, `parser.test.js`, `cli.test.js`) still passes; `cli.test.js`'s AC6 and #1594 fixtures (which exercise `checkC` end-to-end through the CLI) are the ones most likely to catch a regression here.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/plan-audit/checks.js tests/bin-lib/plan-audit/checks.test.js
git commit -m "Refuse VCS-mutation commands in plan-audit Check C — refs #2593

Check C pre-runs a task's declared Step 2 verification command read-only.
A production incident showed it would execute a git stash/commit/push/etc.
command even when the Run: line's surrounding prose only mentioned it in
passing, sweeping an untracked file off the shared stash stack. checkC now
refuses (never executes) any extracted command whose first token, or any
token after a top-level &&/;/| segment, is a VCS-mutation verb, reporting
the refusal under warnings (reason: vcs-mutation-refusal) rather than
findings. checkC also now returns an executed array listing every command
it actually ran."
```

---

### Task 2: CLI summary line + documentation for the new refusal/executed fields

**Files:**
- Modify: `plugin/bin/plan-audit.js`
- Modify: `plugin/skills/build/plan-audit.md`
- Test: `tests/bin-lib/plan-audit/cli.test.js`

**Interfaces:**
- Consumes: `checkC`'s new `warnings` refusal entries (`reason: 'vcs-mutation-refusal'`) and `executed` array from Task 1.
- Produces: nothing new consumed elsewhere — this task only makes the CLI's human-readable summary line and the skill doc reflect Task 1's behavior. No other file depends on this task's output shape.

- [ ] **Step 1: Write the failing test**

Add to `tests/bin-lib/plan-audit/cli.test.js` (near the AC6/#1594 fixture tests — read `writePlan`/`makeTmpRepo`/`runCli` helpers already defined near the top of that file and reuse them exactly):

```js
// AC1/AC2/AC4 — the production incident reproduced end-to-end through the CLI (#2593).
// `makeTmpRepo()` is a bare temp directory, not a git repository (confirmed:
// no existing test in this directory runs `git init`) — proving "never
// executed" via a real `git stash list` before/after comparison would need
// its own git-repo setup this fixture doesn't otherwise need. The unit-level
// guarantee (a `run` fake that throws if called) is already pinned by Task
// 1's checks.test.js additions; this CLI-level test instead confirms the
// same refusal end-to-end through the real (non-faked) `run` default and
// the human-readable summary line.
test('#2593: a fixture plan whose Step 2 prose only mentions a forbidden git stash command is refused, never executed, and the CLI still exits 0', () => {
  const repo = makeTmpRepo();
  try {
    const plan = writePlan(repo, [
      '### Task 1: Remove the plan file',
      '**Files:**',
      '- Modify: `plan.md`',
      '',
      '- [ ] **Step 2: Run it to confirm FAIL**',
      '',
      'Run: never run `git stash push -u -m tag` here; use a WIP commit instead',
      'Expected: FAIL',
    ].join('\n'));
    const { exitCode, stdout } = runCli(plan, repo);
    assert.strictEqual(exitCode, 0);
    const [jsonLine, summaryLine] = stdout.split('\n');
    const report = JSON.parse(jsonLine);
    assert.strictEqual(report.checkC.ok, true);
    assert.deepStrictEqual(report.checkC.findings, []);
    assert.deepStrictEqual(report.checkC.executed, []);
    assert.strictEqual(report.checkC.warnings.length, 1);
    assert.strictEqual(report.checkC.warnings[0].reason, 'vcs-mutation-refusal');
    assert.strictEqual(report.checkC.warnings[0].verb, 'git stash');
    assert.match(summaryLine, /VCS-mutation refusal/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bin-lib/plan-audit/cli.test.js`
Expected: FAIL — `assert.match(summaryLine, /VCS-mutation refusal/)` fails because `summaryLine` (from `plan-audit.js`'s `summaryLine` function) has no fragment for it yet. (Every other assertion in this test already passes after Task 1 alone, since `checkC` already refuses the command by then — only the human summary-line fragment is missing.)

- [ ] **Step 3: Add the summary-line fragment**

In `plugin/bin/plan-audit.js`'s `summaryLine` function, add one line alongside the existing `Check C:` fragments (after the `appendShaped` line, before the `checkD` line):

```js
  const refusedCount = report.checkC.warnings.filter((w) => w.reason === 'vcs-mutation-refusal').length;
  if (refusedCount) parts.push(`Check C: ${refusedCount} VCS-mutation refusal(s)`);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/bin-lib/plan-audit/cli.test.js`
Expected: PASS

- [ ] **Step 5: Update the skill doc's Check C contract**

In `plugin/skills/build/plan-audit.md`, find the bullet describing `checkC.warnings` (the one starting "**`checkC.warnings`** (non-empty, `ok` still `true`)"). Add one sentence to it, after the existing "wording or formatting drift" sentence, describing the new refusal case:

```
 A warning entry from a genuine VCS-mutation refusal instead carries `{task, title, command, reason: 'vcs-mutation-refusal', verb}` — Check C is documented read-only and never executes a command whose first token (or any token after a top-level `&&`/`;`/`|` segment) is a VCS-mutation verb (`git stash/commit/push/reset/checkout/switch/clean/rebase/merge`, or a writing `gh` subcommand), even when the extractor's first-backtick-span match pulled it out of prose that only mentioned it (#2593).
```

Also find the main Check C bullet (the one starting "**Check C** — for each task's own"). Add one sentence at the end noting the executed list:

```
 `checkC`'s return also carries `executed` — one `{task, command}` entry per command it actually ran — so the audit output shows exactly what was executed, distinct from what was refused or found unparseable.
```

- [ ] **Step 6: Run the full plan-audit test suite once more**

Run: `node --test tests/bin-lib/plan-audit/`
Expected: PASS — every test in the directory.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/plan-audit.js plugin/skills/build/plan-audit.md tests/bin-lib/plan-audit/cli.test.js
git commit -m "Document plan-audit Check C's VCS-mutation refusal and executed list — refs #2593

Adds the CLI summary line's VCS-mutation-refusal fragment and updates
plan-audit.md's Check C contract to describe the new warnings shape and
the executed command list, both added to checkC in the prior commit."
```
