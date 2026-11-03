# Bookkeeping-only skip stamp and review Step 1.5 terminal outcome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ledger-only commit after build's verify never stalls `/review` Step 1.5. `/test` always routes a moved HEAD through the runner. A zero-test project proceeds on its own logged Gate row. A stamp still unverified after the one re-trigger is a named-cause STOP.

**Architecture:** This is a prose-only change to two shipped skill files, pinned by two existing conformance suites. `test/verification.md`'s Mismatch branch already runs the scoped verify (#3284, `09ae64fa0`, PR #3650), so per the record's Plan-review answer 2 it is not edited. `test/SKILL.md` still reads as an unconditional skip on `VERIFICATION_PASSED=true`, so Task 2 aligns it. Task 1 applies Plan-review answers 1 and 3 to `review/code-mode-steps.md`'s Step 1.5 Gate table.

**Tech Stack:** Markdown skill files, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T180924-record-4395/work/4395-spec.md`

## Global Constraints

- `plugin/skills/review/code-mode-steps.md` is 51,796 B at base against `RAIL_BYTES` 52,500 B. Task 1's exact text below was measured in a scratch copy at +687 B, landing at 52,483 B (17 B headroom). Use the text verbatim. Any addition beyond it must be offset by cuts within Step 1.5. Never raise the rail (Plan-review answer 3).
- To fit answer 3's catch-all, Task 1 drops the round-1 plan's line-74 ` (Gate table below)` addition (19 B). Line 74 already reads `then re-trigger `/claude-tweaks:test` once and re-check.` at base, so the prose still says "once". The STOP row also drops the `or` before its last listed cause (3 B), since the catch-all now ends the list.
- `plugin/skills/test/SKILL.md` is 24,147 B and is not near the rail.
- Do not edit `plugin/skills/test/verification.md` (Plan-review answer 2).
- Keep the literal `**Pipeline behavior:**` in `test/SKILL.md`: `tests/test-skill-affected-conformance.test.js` slices on it.
- `tests/review-step1-5-verifiedhead-gate.test.js` already pins two literals. Keep both:
  - the row prefix `` | `TEST_PASSED=true` (pipeline) + runner stamp `verifiedHead: false` | Report it ``
  - the sentence `` `verifiedHead: false` with `TEST_PASSED=true` is reported, never silently accepted ``
- The zero-test log line is copied verbatim from the record: `AUTO {time} — review Step 1.5: no verification commands configured; zero-test pass accepted without a runner stamp. Reversibility: high.`
- Governing skill `.claude/skills/skill-prose-conformance-tests`, quoted verbatim:
  - "freeze the bytes the change *replaced* as a fixture constant inside the test, then assert every pattern twice — it matches the live file, and it does **not** match the frozen excerpt."
  - "Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** — `assert.throws(() => assertBlock(mutated), { message }, …)` — preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
  - "Select the branch's own paragraph by its bold label first"
  - "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
- Commit messages follow `{Verb} {what} — {detail}` with "refs #4395", never "closes" or "fixes".

## Plan-authoring check results

- **Behavior-change prose sweep:** ran `git grep -n -i -e "re-trigger.\{0,40\}re-check" -e "verification re-runs instead of skipping" -e "triggered and passes" -e "skip verification, report \"passed in build" -- plugin docs tests ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md'`. Hits:
  - `review/code-mode-steps.md:111,113` (Task 1); line 74 already says "once" and stays unedited
  - `test/SKILL.md:63,69` (Task 2; line 69's bullet is governed by the new paragraph above it)
  - `tests/review-step1-5-verifiedhead-gate.test.js:24`, a frozen pre-#1923 fixture: no change.
  - `docs/skill-graph.md` and `flow/multispec-parallel-waves.md` say a stamp mismatch re-triggers `/test`, which stays true: no change.
- **Trust-vs-existing-distrust:** the zero-test row lets review proceed with no stamp. `dispatch/task-prompt.md:255-257` tells the first call to re-run `/test` once and report `DONE_WITH_CONCERNS` when no stamp verifies HEAD. That is the producer's own report rule and does not contradict a review-side row keyed on no commands being configured: no change.
- **Byte-pin:** measured as above (52,483 B after Task 1, 17 B under the rail).
- **Inline self-consistency and go-red:** to be re-run by the implementer per each task's Steps 2 and 4: every new test fails against the unedited skill text and passes after the edit.
- **`fullSha` is a real stamp field:** `verify.js --stamp-status` prints `fullSha: present ? anchorOf(stamp) : null` (`plugin/bin/verify.js:322`), and line 74 already lists it in the printed field set.

## Review Focus

- **Zero-test project.** A project with no verification commands has no stamp. It must take the zero-test row at the first stamp read, before any re-trigger, and never the STOP. Task 1 pins that the row is separate and comes before the re-trigger row.
- **Dirty tree.** A tree dirty outside declared `generated` paths never verifies. The STOP must name `dirty: true` with the paths, and there must be no bookkeeping-only dirty exemption. Task 1 pins the cause list and that "Exception" is absent from the STOP row.
- **Unlisted cause.** A `verifiedHead: false` state outside the four named causes (a stamp at HEAD written while the tree was dirty, a scoped stamp whose anchor a history rewrite stranded) must still name a cause. Task 1 pins the catch-all `else the stamp as read (`sha`, `scope`, `fullSha`)` as the STOP row's last clause.
- **No loop.** A second `/test` re-trigger is the loop the record forbids. Task 1 pins "never a second re-trigger" and "once".
- **Standalone branch.** With no `TEST_PASSED` (a dispatched second call), the Standalone branch keeps its trigger-and-pass row. Task 1 pins the row's `(standalone)` qualifier so the pipeline STOP cannot be bypassed by it.
- **Stale `VERIFICATION_SHA`.** A reader of `test/SKILL.md` alone must not skip on a stale `VERIFICATION_SHA`. Task 2 pins it.

---

### Task 1: Give review Step 1.5 a zero-test row and a terminal STOP row

**Files:**
- Modify: `plugin/skills/review/code-mode-steps.md:111-113` (lines 111 and 113)
- Test: `tests/review-step1-5-verifiedhead-gate.test.js`

**Interfaces:**
- Consumes: `verify.js --stamp-status` fields `present`, `dirty`, `scopeError`, `sha`, `scope`, `head`, `verifiedHead` (unchanged).
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing tests** at the end of `tests/review-step1-5-verifiedhead-gate.test.js`:

```js
// Frozen pre-#4395 Gate rows (hand-built): the re-trigger row named no terminal outcome.
const PRE_4395_GATE_ROWS = `| \`TEST_PASSED=true\` (pipeline) + runner stamp \`verifiedHead: false\` | Report it (stamp sha/scope vs HEAD), re-trigger \`/claude-tweaks:test\`, re-check |
| Runner stamp \`verifiedHead: true\` (standalone) | Proceed to Step 2 |
| \`/claude-tweaks:test\` triggered and passes | Proceed to Step 2 |`;

const ZERO_TEST_PREFIX = '| `TEST_PASSED=true` (pipeline) + stamp `present: false` + no verification commands';
const RETRIGGER_PREFIX = '| `TEST_PASSED=true` (pipeline) + runner stamp `verifiedHead: false` |';
const STOP_PREFIX = '| That re-check still reads `verifiedHead: false` |';
const ZERO_TEST_LOG = 'AUTO {time} — review Step 1.5: no verification commands configured; zero-test pass accepted without a runner stamp. Reversibility: high.';

const rowOf = (text, prefix) => text.split('\n').find((l) => l.startsWith(prefix));

function assertZeroTestRow(text) {
  const row = rowOf(text, ZERO_TEST_PREFIX);
  assert.ok(row, 'zero-test row missing');
  assert.ok(row.includes(ZERO_TEST_LOG), 'zero-test row must log the record\'s AUTO line verbatim');
  assert.ok(row.includes('No re-trigger'), 'zero-test row must not re-trigger');
  assert.ok(row.includes('`pr-checks.js` read'), 'zero-test row must run the pr-checks read');
  assert.ok(row.includes('`verify-scope.json` `checks`'), 'zero-test row must key on verify-scope checks being absent');
  assert.ok(text.indexOf(row) < text.indexOf(RETRIGGER_PREFIX), 'zero-test row must precede the re-trigger row');
}

function assertStopRow(text) {
  const row = rowOf(text, STOP_PREFIX);
  assert.ok(row, 'terminal row missing');
  assert.match(row, /\*\*STOP\*\*/, 'terminal row must stop');
  assert.ok(row.includes('never a second re-trigger'), 'terminal row must forbid a second re-trigger');
  assert.ok(row.includes('`dirty: true` with the dirty paths'), 'terminal row must name a dirty tree with its paths');
  assert.ok(row.includes('a `scopeError`'), 'terminal row must name scopeError');
  assert.ok(row.includes('`{sha} ({scope}) ≠ {head}`'), 'terminal row must name a stamp/HEAD mismatch');
  assert.ok(row.includes('`present: false` with commands configured'), 'terminal row must name a missing stamp with commands configured');
  assert.ok(row.endsWith(', else the stamp as read (`sha`, `scope`, `fullSha`) |'), 'terminal row must end with the stamp-as-read catch-all');
  assert.ok(!/Exception|zero-test/.test(row), 'terminal row must carry no exception clause');
}

test('AC2.1: Step 1.5 has its own zero-test Gate row, ahead of any re-trigger (#4395)', () => {
  assertZeroTestRow(CODE_MODE_STEPS);
  assert.throws(() => assertZeroTestRow(PRE_4395_GATE_ROWS), /zero-test row missing/);
});

test('AC2.1: each zero-test-row clause goes red on its own (#4395)', () => {
  const cases = [
    [ZERO_TEST_LOG, /AUTO line verbatim/],
    ['No re-trigger', /must not re-trigger/],
    ['`pr-checks.js` read', /pr-checks read/],
    ['`verify-scope.json` `checks`', /verify-scope checks/],
  ];
  for (const [clause, message] of cases) {
    const mutated = CODE_MODE_STEPS.split('\n').map((l) => (l.startsWith(ZERO_TEST_PREFIX) ? l.replace(clause, 'xxx') : l)).join('\n');
    assert.notEqual(mutated, CODE_MODE_STEPS, clause);
    assert.throws(() => assertZeroTestRow(mutated), message);
  }
});

test('AC2.1: a re-check still reading verifiedHead: false is a named-cause STOP that never loops (#4395)', () => {
  assertStopRow(CODE_MODE_STEPS);
  assert.throws(() => assertStopRow(PRE_4395_GATE_ROWS), /terminal row missing/);
});

test('AC2.1: each STOP-row clause goes red on its own (#4395)', () => {
  const cases = [
    ['**STOP**', /terminal row must stop/],
    ['never a second re-trigger', /forbid a second re-trigger/],
    ['`dirty: true` with the dirty paths', /dirty tree with its paths/],
    ['a `scopeError`', /name scopeError/],
    ['`{sha} ({scope}) ≠ {head}`', /stamp\/HEAD mismatch/],
    ['`present: false` with commands configured', /missing stamp with commands configured/],
    ['the stamp as read', /stamp-as-read catch-all/],
    ['`fullSha`', /stamp-as-read catch-all/],
  ];
  for (const [clause, message] of cases) {
    const mutated = CODE_MODE_STEPS.split('\n').map((l) => (l.startsWith(STOP_PREFIX) ? l.replace(clause, 'xxx') : l)).join('\n');
    assert.notEqual(mutated, CODE_MODE_STEPS, clause);
    assert.throws(() => assertStopRow(mutated), message);
  }
});

test('AC2.1: the re-trigger row fires once and the trigger-and-pass row is scoped to standalone (#4395)', () => {
  assert.ok(rowOf(CODE_MODE_STEPS, RETRIGGER_PREFIX).includes('re-trigger `/claude-tweaks:test` once, re-check'));
  assert.ok(!rowOf(PRE_4395_GATE_ROWS, RETRIGGER_PREFIX).includes('once'));
  assert.ok(CODE_MODE_STEPS.includes('| `/claude-tweaks:test` triggered (standalone) and passes | Proceed to Step 2 |'));
  assert.ok(!CODE_MODE_STEPS.includes('| `/claude-tweaks:test` triggered and passes |'));
  assert.ok(PRE_4395_GATE_ROWS.includes('| `/claude-tweaks:test` triggered and passes |'));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/review-step1-5-verifiedhead-gate.test.js`
Expected: FAIL. All five new tests fail: "zero-test row missing", "terminal row missing", and the per-clause and once/standalone assertions. The existing tests pass.

- [ ] **Step 3: Edit `plugin/skills/review/code-mode-steps.md`** with two exact replacements. Do not edit line 74.

Replace the line-111 row with these three rows:

```
| `TEST_PASSED=true` (pipeline) + stamp `present: false` + no verification commands (none in CLAUDE.md, stack manifests or `verify-scope.json` `checks`) | No re-trigger: log `AUTO {time} — review Step 1.5: no verification commands configured; zero-test pass accepted without a runner stamp. Reversibility: high.`, run the `pr-checks.js` read, proceed as for `verifiedHead: true` |
| `TEST_PASSED=true` (pipeline) + runner stamp `verifiedHead: false` | Report it (stamp sha/scope vs HEAD), re-trigger `/claude-tweaks:test` once, re-check |
| That re-check still reads `verifiedHead: false` | **STOP**, never a second re-trigger — name the cause: `dirty: true` with the dirty paths, a `scopeError`, `{sha} ({scope}) ≠ {head}`, `present: false` with commands configured, else the stamp as read (`sha`, `scope`, `fullSha`) |
```

Replace the line-113 row `| `/claude-tweaks:test` triggered and passes | Proceed to Step 2 |` with:

```
| `/claude-tweaks:test` triggered (standalone) and passes | Proceed to Step 2 |
```

- [ ] **Step 4: Run to verify they pass, and measure**

Run: `node --test tests/review-step1-5-verifiedhead-gate.test.js tests/review-test-source-sweep-conformance.test.js tests/pr-check-gate-conformance.test.js tests/skill-size-single-source.test.js tests/bin-lib/skill-audit/budgets.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS.

Run: `wc -c plugin/skills/review/code-mode-steps.md`
Expected: `52483`. Report the number. It must not exceed `52500`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/code-mode-steps.md tests/review-step1-5-verifiedhead-gate.test.js
git commit -m "Give review Step 1.5 a zero-test row and a terminal STOP — refs #4395"
```

### Task 2: Make test/SKILL.md's skip conditional on VERIFICATION_SHA matching HEAD

**Files:**
- Modify: `plugin/skills/test/SKILL.md:63-67` (lines 63 and 67)
- Test: `tests/test-skill-affected-conformance.test.js`
- Waived `plugin/skills/test/verification.md`: read only, per Plan-review answer 2. Its Mismatch branch already carries the runner route. AC3, which requires a non-bookkeeping delta to still run suites, is already pinned by the existing `#3284` test ("verification.md Skip-if-recent Mismatch re-stamps HEAD…") in `tests/test-skill-affected-conformance.test.js`, which this task's Step 4 runs. No new AC3 test is needed.

**Interfaces:**
- Consumes: `test/verification.md`'s `**Mismatch**` bullet (unchanged).
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing test** at the end of `tests/test-skill-affected-conformance.test.js`:

```js
// Frozen pre-#4395 text (hand-built): the VERIFICATION_SHA row promised a re-run and the bullets skipped outright.
const PRE_4395_SKILL_EXCERPT = `| \`VERIFICATION_SHA\` | Set by \`/claude-tweaks:build\` Common Step 5, alongside \`VERIFICATION_PASSED\` | The commit build's verification ran against. Compared to current \`HEAD\` before honoring the skip (see \`verification.md\`'s "Skip-if-recent") — a mismatch means the tree changed since build passed, and verification re-runs instead of skipping. |

**Pipeline behavior:**`;

const MISMATCH_FIRST = /applies only when `VERIFICATION_SHA` equals `HEAD`\. On a mismatch, run `verification\.md`'s Mismatch branch first[^\n]*re-stamps `HEAD`/;

test('AC1.1: test/SKILL.md routes a moved HEAD through the runner before any VERIFICATION_PASSED skip (#4395)', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  assert.match(skill, MISMATCH_FIRST);
  assert.doesNotMatch(PRE_4395_SKILL_EXCERPT, MISMATCH_FIRST);
  const at = skill.indexOf('applies only when `VERIFICATION_SHA`');
  assert.ok(at !== -1 && at < skill.indexOf('**Pipeline behavior:**'), 'the condition precedes the Pipeline behavior bullets');
  assert.ok(!skill.includes('verification re-runs instead of skipping'));
  assert.ok(PRE_4395_SKILL_EXCERPT.includes('verification re-runs instead of skipping'));
  assert.ok(skill.includes('so the Mismatch branch runs the scoped verify instead of skipping'));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/test-skill-affected-conformance.test.js`
Expected: FAIL on the new `AC1.1` test only.

- [ ] **Step 3: Edit `plugin/skills/test/SKILL.md`**

In the `VERIFICATION_SHA` row (line 63), replace `a mismatch means the tree changed since build passed, and verification re-runs instead of skipping.` with:

```
a mismatch means the tree changed since build passed, so the Mismatch branch runs the scoped verify instead of skipping.
```

Directly above `**Pipeline behavior:**` (line 67), add this paragraph followed by a blank line:

```
A `VERIFICATION_PASSED=true` bullet below applies only when `VERIFICATION_SHA` equals `HEAD`. On a mismatch, run `verification.md`'s Mismatch branch first: a bookkeeping-only delta runs no suite, and the runner re-stamps `HEAD`.
```

- [ ] **Step 4: Run to verify it passes**

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
| Deliverable 1 (remainder, per Plan-review answer 2) | Task 2 |
| Deliverable 2 + Plan-review answers 1 and 3 | Task 1 |
| AC1.1 | Task 2's `AC1.1` test (prose route) plus the live run evidence below (runner behavior) |
| AC2.1 | Task 1's `AC2.1` tests (terminal rows); the live evidence below shows the stamp `/review` will read |
| AC3.1 | Existing `#3284` test in `tests/test-skill-affected-conformance.test.js` (unchanged Mismatch bullet) |

**AC evidence (live, scratch).** After Common Step 5's full pass, this run commits a ledger-only row. `/claude-tweaks:test` then takes the Mismatch branch. Its `verify.js --stamp-status` output (`verifiedHead: true`, `scope: none`) goes to `$PIPELINE_RUN_DIR/evidence/ac1-none-stamp.txt`, with one `AC evidence` entry in `decisions.md`.
