# Bookkeeping-only skip stamp and review Step 1.5 terminal outcome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ledger-only commit after build's verify never stalls `/review` Step 1.5: `/test` always routes a moved HEAD through the runner, and a stamp still unverified after the one re-trigger gets a named result.

**Architecture:** Prose-only change to two shipped skill files, pinned by two existing conformance suites. `test/verification.md`'s Mismatch branch already runs the scoped verify (#3284, `09ae64fa0`), but `test/SKILL.md`'s Pipeline behavior bullets still read as an unconditional skip on `VERIFICATION_PASSED=true`, so this plan brings `SKILL.md` in line rather than editing `verification.md`.

**Tech Stack:** Markdown skill files, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T015047-record-4395/work/4395-spec.md`

## Global Constraints

- `plugin/skills/review/code-mode-steps.md` is 51,796 B at base against `RAIL_BYTES` 52,500 B: 704 B of headroom. Task 1 adds at most about 500 B and records the final `wc -c`. `plugin/skills/test/SKILL.md` is 24,147 B and is not near the rail.
- Keep the literal `**Pipeline behavior:**` in `test/SKILL.md`: `tests/test-skill-affected-conformance.test.js` slices on it.
- Keep the literal row prefix `` `TEST_PASSED=true` (pipeline) + runner stamp `verifiedHead: false` | Report it `` and the sentence `` `verifiedHead: false` with `TEST_PASSED=true` is reported, never silently accepted ``: `tests/review-step1-5-verifiedhead-gate.test.js` pins both.
- `/review` Step 1.5 is already on `_shared/auto-mode-contract.md`'s HARD-GATE list, so the new STOP needs no contract edit.
- Governing skill `.claude/skills/skill-prose-conformance-tests`: "freeze the bytes the change *replaced* as a fixture constant inside the test, then assert every pattern twice"; "Select the branch's own paragraph by its bold label first"; "assert the same helper throws **with that assertion's own message**"; "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`".
- Commit messages: `{Verb} {what} — {detail}`, with "refs #4395", never "closes" or "fixes".

## Review Focus

- A project with no test commands (`flow/steps-and-gates.md`'s Zero-test edge case) has no stamp at all and must not hard-stop every run. Task 1 pins the exception.
- A tree dirty outside declared `generated` paths never verifies: the STOP must name `dirty: true` as its cause. Task 1 pins it.
- A second `/test` re-trigger is the loop the record forbids. Task 1 pins "no second re-trigger".
- The Standalone branch (no `TEST_PASSED`, a dispatched second call) keeps its existing row, so the new STOP must not reach it. Task 1 pins the row's qualifier.
- A reader of `test/SKILL.md` alone must not skip on a stale `VERIFICATION_SHA`. Task 2 pins it.

---

### Task 1: Give review Step 1.5's verifiedHead: false row a terminal outcome

**Files:**
- Modify: `plugin/skills/review/code-mode-steps.md:74-113`
- Test: `tests/review-step1-5-verifiedhead-gate.test.js`

**Interfaces:**
- Consumes: `verify.js --stamp-status` fields `dirty`, `scopeError`, `sha`, `scope`, `head`, `present`, `verifiedHead` (unchanged).
- Produces: nothing later tasks use.

Behavioral-claim note: the re-trigger reaches the runner through `test/verification.md`'s Mismatch branch, which writes the stamp; `tests/bin-lib/verify/cli.test.js`'s `#1801 shape` test proves the runner's `none` stamp. Sweep of the old wording (`git grep -n -E "re-trigger.{0,40}(test|re-check)|triggered and passes" -- plugin tests docs`): `docs/skill-graph.md:641` and `flow/multispec-parallel-waves.md:69` both say a stamp mismatch re-triggers `/test`, which stays true, so no change.

- [ ] **Step 1: Write the failing tests** in `tests/review-step1-5-verifiedhead-gate.test.js`, after the existing tests:

```js
// Frozen pre-#4395 Gate rows: the re-trigger row named no terminal outcome.
const PRE_4395_GATE_ROWS = `| \`TEST_PASSED=true\` (pipeline) + runner stamp \`verifiedHead: false\` | Report it (stamp sha/scope vs HEAD), re-trigger \`/claude-tweaks:test\`, re-check |
| \`/claude-tweaks:test\` triggered and passes | Proceed to Step 2 |`;

const STOP_ROW_PREFIX = '| That re-check still reads `verifiedHead: false` |';

function assertTerminalRow(text) {
  const row = text.split('\n').find((l) => l.startsWith(STOP_ROW_PREFIX));
  assert.ok(row, 'terminal row missing');
  assert.match(row, /\*\*STOP\*\*/, 'terminal row must stop');
  assert.match(row, /`dirty: true`/, 'terminal row must name a dirty tree as a cause');
  assert.match(row, /`scopeError`/, 'terminal row must name scopeError as a cause');
  assert.match(row, /no second re-trigger/, 'terminal row must forbid a second re-trigger');
  assert.match(row, /zero-test pass/, 'terminal row must carve out the zero-test pass');
}

test('AC2.1: a still-unverified stamp after the one re-trigger stops with a named cause and never loops', () => {
  assertTerminalRow(CODE_MODE_STEPS);
  assert.throws(() => assertTerminalRow(PRE_4395_GATE_ROWS), /terminal row missing/);
});

test('AC2.1: each terminal-row clause goes red on its own', () => {
  const cases = [
    ['**STOP**', /terminal row must stop/],
    ['`dirty: true`', /must name a dirty tree/],
    ['`scopeError`', /must name scopeError/],
    ['no second re-trigger', /must forbid a second re-trigger/],
    ['zero-test pass', /must carve out the zero-test pass/],
  ];
  for (const [clause, message] of cases) {
    const mutated = CODE_MODE_STEPS.split('\n').map((l) => (l.startsWith(STOP_ROW_PREFIX) ? l.replace(clause, 'xxx') : l)).join('\n');
    assert.notEqual(mutated, CODE_MODE_STEPS);
    assert.throws(() => assertTerminalRow(mutated), message);
  }
});

test('AC2.1: the pipeline paragraph sends the re-check to the Gate table and the Standalone trigger row is scoped', () => {
  assert.match(CODE_MODE_STEPS, /re-trigger `\/claude-tweaks:test` once and re-check `--stamp-status` \(Gate table below\)/);
  assert.match(CODE_MODE_STEPS, /\| `\/claude-tweaks:test` triggered from the Standalone branch and passes \| Proceed to Step 2 \|/);
  assert.doesNotMatch(PRE_4395_GATE_ROWS, /triggered from the Standalone branch/);
});

test('AC2.1: a re-check that verifies HEAD rejoins the proceed path', () => {
  assert.match(CODE_MODE_STEPS, /\| That re-check reads `verifiedHead: true` \| Same as the first row \(`pr-checks\.js` read, then Step 2\) \|/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/review-step1-5-verifiedhead-gate.test.js`
Expected: FAIL, the first new test with "terminal row missing".

- [ ] **Step 3: Edit `plugin/skills/review/code-mode-steps.md`**

In line 74, replace `then re-trigger `/claude-tweaks:test` once and re-check.` with:

```
then re-trigger `/claude-tweaks:test` once and re-check `--stamp-status` (Gate table below).
```

Replace the row at line 111 and add two rows directly after it:

```
| `TEST_PASSED=true` (pipeline) + runner stamp `verifiedHead: false` | Report it (stamp sha/scope vs HEAD), re-trigger `/claude-tweaks:test` once, re-check `--stamp-status` |
| That re-check reads `verifiedHead: true` | Same as the first row (`pr-checks.js` read, then Step 2) |
| That re-check still reads `verifiedHead: false` | **STOP** — name the cause from the stamp (`dirty: true`, a `scopeError`, `{sha} ({scope})` ≠ `{head}`, or no stamp); no second re-trigger, since `/test` on the same tree writes the same stamp. Exception: no stamp because `/test` ran no checks (its zero-test pass) → proceed, noting it |
```

Replace the row at line 113 with:

```
| `/claude-tweaks:test` triggered from the Standalone branch and passes | Proceed to Step 2 |
```

- [ ] **Step 4: Run to verify they pass, and measure**

Run: `node --test tests/review-step1-5-verifiedhead-gate.test.js tests/review-test-source-sweep-conformance.test.js`
Expected: PASS.

Run: `wc -c plugin/skills/review/code-mode-steps.md`
Expected: under 52,500. Report the number.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/code-mode-steps.md tests/review-step1-5-verifiedhead-gate.test.js
git commit -m "Give review Step 1.5's unverified stamp a terminal outcome — refs #4395"
```

### Task 2: Make test/SKILL.md's skip conditional on VERIFICATION_SHA matching HEAD

**Files:**
- Modify: `plugin/skills/test/SKILL.md:63-67`
- Test: `tests/test-skill-affected-conformance.test.js`
- Waived `plugin/skills/test/verification.md`: read only; its Mismatch branch already carries Deliverable 1 (#3284), and Task 2's test reads it to pin that branch.

**Interfaces:**
- Consumes: `test/verification.md`'s `**Mismatch**` bullet (unchanged).
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing tests** at the end of `tests/test-skill-affected-conformance.test.js`:

```js
// Frozen pre-#4395 text: the VERIFICATION_SHA row promised a re-run and the bullets skipped outright.
const PRE_4395_SKILL_EXCERPT = `| \`VERIFICATION_SHA\` | Set by \`/claude-tweaks:build\` Common Step 5, alongside \`VERIFICATION_PASSED\` | The commit build's verification ran against. Compared to current \`HEAD\` before honoring the skip (see \`verification.md\`'s "Skip-if-recent") — a mismatch means the tree changed since build passed, and verification re-runs instead of skipping. |

**Pipeline behavior:**`;

const MISMATCH_FIRST = /applies only when `VERIFICATION_SHA` equals `HEAD`\. On a mismatch, run `verification\.md`'s Mismatch branch first[^\n]*re-stamps `HEAD`/;

test('AC1.1: test/SKILL.md routes a moved HEAD through the runner before any VERIFICATION_PASSED skip (#4395)', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  assert.match(skill, MISMATCH_FIRST);
  assert.doesNotMatch(PRE_4395_SKILL_EXCERPT, MISMATCH_FIRST);
  assert.ok(skill.indexOf('applies only when `VERIFICATION_SHA`') !== -1);
  assert.ok(skill.indexOf('applies only when `VERIFICATION_SHA`') < skill.indexOf('**Pipeline behavior:**'));
  assert.ok(!skill.includes('verification re-runs instead of skipping'));
  assert.ok(PRE_4395_SKILL_EXCERPT.includes('verification re-runs instead of skipping'));
});

test('AC3.1: verification.md still runs the suites for any non-bookkeeping delta (#4395)', () => {
  const verification = read('plugin/skills/test/verification.md');
  const mismatch = verification.split('\n').find((l) => l.startsWith('- **Mismatch**'));
  assert.ok(mismatch, 'Mismatch bullet missing');
  assert.match(mismatch, /\*\*Any other delta\*\* runs the suites its paths map to/);
  assert.match(mismatch, /Do not classify the delta by hand and skip/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/test-skill-affected-conformance.test.js`
Expected: FAIL on the AC1.1 test. The AC3.1 test passes already, since it pins the unchanged branch.

- [ ] **Step 3: Edit `plugin/skills/test/SKILL.md`**

In the `VERIFICATION_SHA` row (line 63), replace `a mismatch means the tree changed since build passed, and verification re-runs instead of skipping.` with:

```
a mismatch means the tree changed since build passed, so the Mismatch branch runs the scoped verify instead of skipping.
```

Directly above `**Pipeline behavior:**` (line 67), with a blank line after it, add:

```
A `VERIFICATION_PASSED=true` bullet below applies only when `VERIFICATION_SHA` equals `HEAD`. On a mismatch, run `verification.md`'s Mismatch branch first: a bookkeeping-only delta runs no suite, and the runner re-stamps `HEAD`.
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/test-skill-affected-conformance.test.js tests/verification-skip-before-execute.test.js tests/stamp-status-discovery-prose-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/test/SKILL.md tests/test-skill-affected-conformance.test.js
git commit -m "Make /test's verification skip conditional on the SHA check — refs #4395"
```

## Spec coverage

| Clause | Covered by |
|---|---|
| AC1.1 | Task 2's AC1.1 test (prose route) plus the live run below (runner behavior) |
| AC2.1 | Task 1's AC2.1 tests |
| AC3.1 | Task 2's AC3.1 test |

**AC evidence (scratch, live):** after Common Step 5's full pass this run commits a ledger-only row, then `/claude-tweaks:test` takes the Mismatch branch. `verify.js --stamp-status` output (`verifiedHead: true`, `scope: none`) goes to `$PIPELINE_RUN_DIR/evidence/ac1-none-stamp.txt` and one `AC evidence` entry in `decisions.md`.
