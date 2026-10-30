# Build Category A Operational Fixes Before Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/build`'s Category A operational fixes land before Common Step 5's final verification, so they no longer move HEAD past `VERIFICATION_SHA` and force `/claude-tweaks:test` into a full re-run.

**Architecture:** Option (a) of record #3489. Common Step 5 gains one leading paragraph that applies `operational-checklist.md`'s Category A fixes before its verification run. Common Step 5.5 keeps its heading, position and skip sentence, and now runs only the Category B tasks plus every ledger row, including a `fixed` row per Category A fix. Ledger rows (`docs/plans/*-ledger.md`) are classified `suites: []` by `.claude-tweaks/verify-scope.json`, so writing them after verification never forces a re-run; Category B stays after verification because it auto-executes deploys and migrations, which must not run before a passing tree. Option (b), a scoped re-verify after a Category A edit, was rejected: it keeps a second runner invocation on every schema/env build, and that cost is what this record removes.

**Tech Stack:** Markdown skill prose; `node --test` conformance suite.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T145307-record-3489/work/3489-spec.md`

Scope keywords: Operational Checklist, operational-checklist, Common Step 5.5

## Global Constraints

- Keep the external "Common Step 5.5" citations intact: `plugin/skills/build/handoff-template.md` line 62 (`Common Step 5.5 (Operational Checklist) — condition: no schema/env/IaC/CI/platform-config files in diff`) and `tests/build-skip-degrade-trace-adoption.test.js` (the Step 5.5 SKIP-site regex, and the `split('### Common Step 5.5')` slice in AC2.1).
- Common Step 5.5's skip sentence stays byte-identical: `Otherwise skip this step entirely. **On skip**, write a `SKIP` entry per the degrade-trace rule (condition: no schema/env/IaC/CI/platform-config files in diff); standalone: list in the handoff.`
- The new Common Step 5 paragraph must not contain the literal `**On skip**` — `build-skip-degrade-trace-adoption.test.js` asserts exactly 7 such sites in `SKILL.md` and that Step 5's section has none.
- Heading order stays 4.5 < 6 < 6.5 < 5 < 5.5 < 7 (`build-verify-after-doc-steps.test.js` AC1.1 of #3060).
- `plugin/skills/build/SKILL.md` is 50160 bytes against `RAIL_BYTES` 52500 (95.5%). Net growth must stay under 1000 bytes; the two edits below add about 550. No section move is needed.

## Review Focus

1. A build whose only Category A finding is a schema change with no documented push command: nothing is edited before Step 5, and Step 5.5 must still write its `open` ledger row — checked by Task 1's checklist assertion naming the `open` case.
2. A diff matching no Category A or B trigger: Step 5's new paragraph does nothing and Step 5.5's existing SKIP trace is the only record — the skip sentence is pinned unchanged by `build-skip-degrade-trace-adoption.test.js`.
3. A Category A fix that breaks the suite fails Step 5 itself, and Step 5's existing "If anything fails, fix it and commit the fix" paragraph handles it; a suite fix that introduces a new Category A trigger (a new `process.env.*` read) is caught by the new paragraph's re-check clause — pinned by Task 1's `re-check those triggers` assertion.
4. A reader of Step 5.5 alone (it is still where the checklist is "loaded"): it must say the Category A fixes already happened, or they get re-applied after verification — Task 1's `Category A fixes already landed before Common Step 5` assertion.
5. The #3060 journey still describing a post-verification Category A fix as the exception — Task 2 corrects it.

---

### Task 1: Move Category A fixes ahead of Common Step 5 in SKILL.md and the checklist

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/build/SKILL.md` (Common Step 5 section, after the "After Common Steps 6 and 6.5" paragraph; Common Step 5.5's first paragraph)
- Modify: `plugin/skills/build/operational-checklist.md` (line 3 header line; Category A intro, schema row action, closing ledger sentence)
- Test: `tests/build-verify-after-doc-steps.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: the exact phrases Task 2's journey edit cites — `**Operational fixes first (#3489).**` (Step 5) and `Category A fixes already landed before Common Step 5` (Step 5.5).

- [ ] **Step 1: Write the failing tests**

In `tests/build-verify-after-doc-steps.test.js`: refactor `section(heading)` into `sectionOf(text, heading)` (same body, reading `text` instead of `BUILD_SKILL`) and keep `section(heading)` as `sectionOf(BUILD_SKILL, heading)` so the three existing tests are unchanged. Add `const CHECKLIST = readText(path.join(ROOT, 'plugin', 'skills', 'build', 'operational-checklist.md'));`. Then add:

```js
function assertCategoryABeforeVerify(text) {
  const step5 = sectionOf(text, '### Common Step 5:');
  assert.match(step5, /\*\*Operational fixes first \(#3489\)\.\*\*/);
  assert.match(step5, /`operational-checklist\.md`'s Category A triggers, apply that file's Category A fixes and commit them, so the verified tree includes them/);
  assert.match(step5, /re-check those triggers against any fix commit below before re-running verification/);
  assert.doesNotMatch(step5, /\*\*On skip\*\*/);
  const step55 = sectionOf(text, '### Common Step 5.5:');
  assert.match(step55, /Category A fixes already landed before Common Step 5/);
  // a shared-constant or exports-only Category A fix must still reach Step 5.5's ledger row
  assert.match(step55, /schema\/env\/IaC\/CI\/platform-config files, or Common Step 5 applied a Category A fix, read/);
  assert.doesNotMatch(step55, /Operational fixes first/);
}

test('#3489 AC1.1: Common Step 5 applies Category A operational fixes before its verification; Step 5.5 does not', () => {
  assertCategoryABeforeVerify(BUILD_SKILL);
});

test('#3489 AC1.1 go-red: the assertion fails when the Step 5 paragraph is removed', () => {
  const doctored = BUILD_SKILL.replace(/\*\*Operational fixes first \(#3489\)\.\*\*[^\n]*\n\n/, '');
  assert.notEqual(doctored, BUILD_SKILL, 'doctoring must actually remove the paragraph');
  assert.throws(() => assertCategoryABeforeVerify(doctored), assert.AssertionError);
});

test('#3489 AC1.1: operational-checklist.md applies Category A in Step 5 and writes its ledger rows in Step 5.5', () => {
  const catA = CHECKLIST.split('## Category A')[1].split('## Category B')[0];
  assert.match(catA, /Common Step 5 applies them before its verification run/);
  assert.match(catA, /Common Step 5\.5 appends each Category A finding to the open items ledger/);
  assert.match(catA, /`open` for a schema change with no documented push command/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/build-verify-after-doc-steps.test.js`
Expected: FAIL — the two `#3489 AC1.1:` tests fail on the missing `Operational fixes first` / `Common Step 5 applies them` phrases (the go-red test passes already, since the assertion throws on the unchanged file).

- [ ] **Step 3: Edit `plugin/skills/build/SKILL.md`**

Insert this paragraph as its own paragraph directly after Common Step 5's first paragraph (the one beginning "After Common Steps 6 and 6.5"):

```
**Operational fixes first (#3489).** Before that run, when the build's diff matches `operational-checklist.md`'s Category A triggers, apply that file's Category A fixes and commit them, so the verified tree includes them and no fix moves HEAD past `VERIFICATION_SHA`; re-check those triggers against any fix commit below before re-running verification. Category B tasks and every ledger row stay in Common Step 5.5, after verification.
```

Replace Common Step 5.5's first paragraph with:

```
After verification passes, check for operational tasks that are easy to forget — deployment and environment concerns that slip through code review (schema/migration files, env access patterns, IaC, CI/CD, container configs). Category A fixes already landed before Common Step 5; this step runs the Category B tasks and writes every ledger row, a `fixed` row per Category A fix included.
```

In Step 5.5's second paragraph, widen only its entry clause: `If your build's diff matches schema/env/IaC/CI/platform-config files, read` becomes `If your build's diff matches schema/env/IaC/CI/platform-config files, or Common Step 5 applied a Category A fix, read` — so a build whose only Category A finding is a shared-constant or `exports` change still reaches Step 5.5 and writes its `fixed` row. Everything from `Otherwise skip this step entirely.` onward stays byte-identical.

- [ ] **Step 4: Edit `plugin/skills/build/operational-checklist.md`**

Line 3 becomes:

```
Loaded by `/claude-tweaks:build` when the diff touches files matching Category A or B triggers: Common Step 5 reads the Category A section before its verification run, and Common Step 5.5 reads the rest after it (#3489).
```

The Category A intro sentence ("These findings have an in-codebase fix. Detect, fix, append to the ledger with status `fixed` after each.") becomes:

```
These findings have an in-codebase fix. Common Step 5 applies them before its verification run, committing each fix, so the verified tree includes them.
```

In the Schema changes row, replace `If no command is documented, append to ledger as `open`.` with `If no command is documented, Common Step 5.5 records it in the ledger as `open`.`

The closing sentence ("Append each Category A finding to the open items ledger … Resolve immediately — update status to `fixed` after each.") becomes:

```
Common Step 5.5 appends each Category A finding to the open items ledger (see `/claude-tweaks:ledger`) with the appropriate phase and status `fixed` — `open` for a schema change with no documented push command.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/build-verify-after-doc-steps.test.js tests/build-skip-degrade-trace-adoption.test.js`
Expected: PASS, 0 failures (spec AC2.1's targeted command).

- [ ] **Step 6: Prove the new assertion fails against the pre-change SKILL.md (AC1.1)**

Copy the merge-base `SKILL.md` over a scratch copy of the test's input and re-run only the `#3489` tests: `git show {merge-base}:plugin/skills/build/SKILL.md` into a scratch file, point a scratch copy of the test at it, and run it. Expected: the `#3489 AC1.1: Common Step 5 applies…` test FAILS. Discard the scratch copies.

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/build/SKILL.md plugin/skills/build/operational-checklist.md tests/build-verify-after-doc-steps.test.js
git commit -m "Move build Category A operational fixes ahead of final verification — refs #3489"
```

### Task 2: Correct the #3060 journey and the plugin-structure row

**Role:** transcription

**Files:**
- Modify: `docs/journeys/get-one-full-suite-run-on-a-docs-touching-build-3060.md` (frontmatter `files:`, step 2 Action, step 3 Should understand, Origin)
- Modify: `docs/plugin-structure.md` (build row: `Common Step 5.5 operational tables + ledger format`)

**Interfaces:**
- Consumes: Task 1's phrases `**Operational fixes first (#3489).**` and `Category A fixes already landed before Common Step 5`.
- Produces: nothing.

- [ ] **Step 1: Edit the journey**

Add `  - plugin/skills/build/operational-checklist.md` to the `files:` frontmatter list, after `plugin/skills/build/SKILL.md`.

Step 2's Action becomes:

```
- **Action:** Common Step 5 first applies any Category A operational fix the diff calls for (schema push, `.env.example` entry, test-literal rewrite, exports build) and commits it (#3489), then runs the full verification once, after Steps 6 and 6.5, and forwards `VERIFICATION_PASSED=true` with `VERIFICATION_SHA` from `report.json`.
```

In step 3's Should understand, replace the sentence `The exception is a Step 5.5 Category A operational fix (schema push, env-example entry), which edits tracked files and moves HEAD past `VERIFICATION_SHA`.` with:

```
Category A operational fixes no longer run there: they land before Common Step 5 (#3489), so Step 5.5 writes the Category B ledger rows and one row per earlier Category A finding (`fixed`, or `open` for a schema change with no documented push command).
```

Append to step 3's Red flags: `; a Category A fix commit (schema, env-example, test-literal, exports) appearing after the commit `report.json`'s `sha` names.` (replacing the line's final period).

Append an Origin bullet after the #4024 bullet:

```
- Steps 2 and 3 updated during `/claude-tweaks:build` of record #3489 (2026-10-28): Category A operational fixes moved ahead of Common Step 5, closing the last tracked-file write after verification.
```

- [ ] **Step 2: Edit `docs/plugin-structure.md`**

In the build row, replace `Common Step 5.5 operational tables + ledger format` with `operational tables + ledger format (Category A read by Common Step 5 before verification, the rest by Common Step 5.5 after it)`.

- [ ] **Step 3: Verify the docs suites**

Run: `node --test tests/argument-hint-mirrors.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/impeccable-retired-scripts-sweep.test.js tests/plan-citations-resolve.test.js tests/tidy-release-note-repair-conformance.test.js tests/tidy-report-rules.test.js tests/timing-prose-conformance.test.js`
Expected: PASS (the `journeys` suite `.claude-tweaks/verify-scope.json` maps `docs/journeys/**` to).

- [ ] **Step 4: Commit**

```bash
git add docs/journeys/get-one-full-suite-run-on-a-docs-touching-build-3060.md docs/plugin-structure.md
git commit -m "Correct #3060 journey and plugin-structure row for pre-verify Category A fixes — refs #3489"
```

### Task 3: Sweep the remaining Common Step 5.5 citations (Check B scope-creep, add-to-plan)

**Role:** transcription

**Files:**
- Modify: `plugin/skills/build/handoff-template.md` (line 5 only — `operational fixes from Step 5.5.`)
- Test: `tests/build-skip-degrade-trace-adoption.test.js` (no change — its Step 5.5 SKIP-site regex and `split('### Common Step 5.5')` slice must stay green)
- Modify: `docs/journeys/see-the-plan-steps-build-could-not-run-3767.md` (no change — line 21 names `Common Step 5.5` only as a `SKIP`-line example, still accurate)

**Interfaces:**
- Consumes: Task 1's Step 5 paragraph.
- Produces: nothing.

- [ ] **Step 1: Edit `plugin/skills/build/handoff-template.md` line 5**

Replace `operational fixes from Step 5.5.` with `operational fixes from Steps 5 (Category A, before verification) and 5.5.` Leave line 62 (`Common Step 5.5 (Operational Checklist) — condition: …`) byte-identical.

- [ ] **Step 2: Verify the citations stay green**

Run: `node --test tests/build-skip-degrade-trace-adoption.test.js tests/build-verify-after-doc-steps.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/build/handoff-template.md
git commit -m "Point build handoff template at both operational-fix steps — refs #3489"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable: decide (a)/(b) and implement | Architecture (a); Task 1 |
| Deliverable: update `SKILL.md` and `operational-checklist.md` | Task 1 Steps 3-4 |
| Deliverable: keep external "Common Step 5.5" citations | Global Constraints; Task 1 Step 5 runs `build-skip-degrade-trace-adoption.test.js` |
| Deliverable: extend `tests/build-verify-after-doc-steps.test.js` | Task 1 Step 1 |
| Deliverable: correct journey step 3 | Task 2 Step 1 |
| AC1.1 | Task 1 Steps 1, 5, 6 |
| AC2.1 | Task 1 Step 5 (targeted command); full `npm test` at Common Step 5 |
