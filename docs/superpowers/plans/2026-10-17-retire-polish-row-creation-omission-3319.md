# Retire the PR-early creation-time polish-row omission (#3319) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the skill prose describe what the PR-body composer actually does — every PR starts with all five phase rows, `polish` included — and replace #1712's creation-clause wording pins with one behavioral composer test and one negative prose assertion.

**Architecture:** Prose-and-test retirement, no code change. `plugin/bin/lib/flow/pr-body.js`'s `composePrEarlyBody` already emits five rows and takes no `surface:` input; the would-be-exit removal (single-record) and the pre-merge refresh (multi-spec) already remove a never-run `polish` row. Four skill paragraphs are reworded to say so; two wording-only tests are retired; three tests are added.

**Tech Stack:** Markdown skill files, `node --test` (built-in runner).

**Spec:** `.claude-tweaks/pipelines/2026-10-17T080010-spec-3319/work/3319-spec.md`

## Global Constraints

- `plugin/bin/lib/flow/pr-body.js` and `plugin/bin/compose-pr-body.js` are unchanged (AC5).
- `tests/bin-lib/flow/pr-body.test.js`'s `CANONICAL_ROWS` (#2877) stays byte-identical; new tests assert against it, never a parallel list.
- Keep the two retained `#1712` deferral tests unchanged: `'#1712: the skip rule names the multi-spec deferral to the pre-merge refresh'` and `'#1712: pr-checklist-refresh.md carries the deferred multi-spec polish-row removal at pre-merge'`. Also keep `'#1712: multispec-pr-checklist.md carries the run-level polish-row paragraph'` — it pins only the paragraph's bold lead-in, which stays.
- Keep `pr-early-run-lifecycle.md`'s existing multi-spec deferral text (the paragraph ending "…for the full rationale).", lines 279–296) unchanged.
- Hand-written commit style: `{Verb} {what} — {detail}`, body ends `refs #3319` (never a closing keyword) and the `Claude-Session:` trailer.

## Corrected premise (ASSUMPTION reversed at plan time)

The record says polish "never runs for `infra` or `terminal`". `terminal` is false: `plugin/skills/flow/polish-execution.md:9` and `plugin/skills/design-wrapper/terminal-routing.md` give the terminal surface its own polish track (`frontend-detection.md:100` → "track terminal"). The new prose therefore names only `backend`/`infra` as examples of a non-frontend surface that skips polish, and never claims `terminal` skips it.

## Review Focus

- A reworded restatement of the retired rule (e.g. "dropped at creation", "left out when every record is backend") in a file the negative scan does not cover — the scan covers the three named files; `flow/multi-spec.md:175` is pinned separately by its own `doesNotMatch`.
- The negative scan matching a legitimate paragraph and forcing awkward wording — run the scan after the edits and confirm zero hits come from intended text.
- `steps-and-gates.md`'s single-record/multi-spec split losing the "no phase-exit push — nothing landed" clause the existing behavior relies on.
- `multispec-pr-checklist.md`'s first-spec-backend/later-spec-frontend example still being true after the reword (it is — the row is present from creation either way).
- A sibling conformance test pinning a phrase inside an edited paragraph. Grepped at plan time (`git grep -n -E "nothing to flip|gets the row unchecked|skipped-phase rule|checklist composition rule|skip-rule scoping|deferred removal|first reaches a real polish exit|ends up checked|pre-empt|can run\\s|present if any record|run-level, not first-spec" -- tests`): the only hits are `tests/pr-early-run-lifecycle.test.js:186-190` and `:207-209` (retired here) and `:204` (kept — its lead-in survives).

---

### Task 1: Behavioral composer test for an all-backend run

**Files:**
- Test: `tests/bin-lib/flow/pr-body.test.js` (insert after the `'#2877: repairPrBody restores the canonical five rows even when handed a narrower list'` test, before `'composePrEarlyBody requires runId/target/nextStep'`)

**Interfaces:**
- Consumes: `composePrEarlyBody({ runId, specSummary, target, nextStep, fixesLines })` from `plugin/bin/lib/flow/pr-body.js` (already imported at the top of the file); the file's own `phaseRows(body)` helper and `CANONICAL_ROWS` constant.
- Produces: nothing later tasks consume.

This test is a characterization of existing behavior — it is expected to PASS on first run (the composer already emits five rows). It pins AC1 so a future `surface:`-driven narrowing goes red.

- [ ] **Step 1: Add the test**

```js
test('#3319: an all-backend run still starts all five phase rows, polish included', () => {
  // composePrEarlyBody takes no surface: input, so an all-backend run (#3028 and #2877 were
  // both surface: backend) composes exactly like any other run — the creation-time polish-row
  // omission #1712 once documented has no way to happen here. A non-polishing run removes the
  // row later, at polish's would-be exit or the multi-spec pre-merge refresh.
  const body = composePrEarlyBody({
    runId: '2026-10-17T080010-spec-3319', specSummary: 's', target: '#2877,#3028', nextStep: 'build',
    fixesLines: ['Fixes #2877', 'Fixes #3028'],
  });
  assert.deepEqual(phaseRows(body), CANONICAL_ROWS);
  assert.ok(phaseRows(body).includes('- [ ] polish'));
});
```

- [ ] **Step 2: Run it**

Run: `node --test tests/bin-lib/flow/pr-body.test.js`
Expected: PASS (all tests in the file, including the new `#3319` one)

- [ ] **Step 3: Commit**

```bash
git add tests/bin-lib/flow/pr-body.test.js
git commit -m "Add all-backend composer test — pin five PR phase rows for #3319" -m "refs #3319"
```

### Task 2: Retire the creation-clause prose and its wording pins

**Files:**
- Modify: `plugin/skills/_shared/pr-early-run-lifecycle.md:298-308` (the "Omit a `polish` row only when **every** record…" paragraph)
- Modify: `plugin/skills/flow/steps-and-gates.md:197` (polish phase-exit paragraph)
- Modify: `plugin/skills/flow/multispec-pr-checklist.md:9` (run-level `polish` row paragraph)
- Modify: `plugin/skills/flow/multi-spec.md:175` (added scope — restates the creation rule as "present if any record in the run can run polish")
- Test: `tests/pr-early-run-lifecycle.test.js:186-190` and `:207-209` (retire), plus three new tests

**Interfaces:**
- Consumes: `tests/pr-early-run-lifecycle.test.js`'s existing `read(...)`, `LIFECYCLE`, and `STEPS_AND_GATES` constants.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing tests**

In `tests/pr-early-run-lifecycle.test.js`, delete these two tests entirely:

```js
test('#1712: the polish-row creation rule names the every-record condition and manifest.yml specs[]', () => {
  assert.match(LIFECYCLE, /omit the `polish` row only when \*\*every\*\* record|Omit a `polish` row only when \*\*every\*\* record/);
  assert.match(LIFECYCLE, /parent `manifest\.yml`'s `specs\[\]` list/);
  assert.match(LIFECYCLE, /An\s+absent `surface:` facet counts as "can run\s+polish"/);
});
```

```js
test('#1712: steps-and-gates.md phase-exit paragraph uses the every-record wording for the polish-row omission', () => {
  assert.match(STEPS_AND_GATES, /omitted at PR creation only when every record in the run has a backend `surface:`/);
});
```

and insert, in their place (directly after the kept `'#1712: multispec-pr-checklist.md carries the run-level polish-row paragraph'` test):

```js
// #3319 retired #1712's creation-time polish-row omission: the composer never implemented it,
// and tests/bin-lib/flow/pr-body.test.js now pins all five rows for an all-backend run. Scan
// paragraph by paragraph — "omit" near "polish" and "creation", case-insensitive — so a reworded
// restatement of the rule goes red, not only the exact old sentence.
test('#3319: no file states a creation-time polish-row omission rule', () => {
  const files = {
    'pr-early-run-lifecycle.md': LIFECYCLE,
    'flow/steps-and-gates.md': STEPS_AND_GATES,
    'flow/multispec-pr-checklist.md': read('plugin', 'skills', 'flow', 'multispec-pr-checklist.md'),
  };
  for (const [name, text] of Object.entries(files)) {
    const offending = text
      .split(/\n\s*\n/)
      .filter((p) => /\bomit(s|ted|ting)?\b/i.test(p) && /\bpolish\b/i.test(p) && /\bcreation\b/i.test(p));
    assert.deepEqual(offending, [], `${name} still states a creation-time polish-row omission`);
  }
});

test('#3319: flow/multi-spec.md no longer makes the polish row conditional at creation', () => {
  const MULTI_SPEC = read('plugin', 'skills', 'flow', 'multi-spec.md');
  assert.doesNotMatch(MULTI_SPEC, /present if any record in the run can run polish/);
  assert.match(MULTI_SPEC, /present from PR creation/);
});

test('#3319: steps-and-gates.md phase-exit paragraph routes a non-frontend polish skip through the would-be exit', () => {
  assert.match(
    STEPS_AND_GATES,
    /a non-frontend `surface:`[^\n]*a single-record run removes the row at polish's would-be exit[^\n]*In a multi-spec run that would-be-exit removal is deferred instead/,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/pr-early-run-lifecycle.test.js`
Expected: FAIL — the three `#3319` tests fail (one hit each in the three scanned files, verified at plan time; `multi-spec.md` still carries "present if any record…"; `steps-and-gates.md` lacks the new wording). The two kept `#1712` deferral tests still pass.

- [ ] **Step 3: Edit the four paragraphs**

`plugin/skills/_shared/pr-early-run-lifecycle.md` — replace the whole paragraph:

```
Omit a `polish` row only when **every** record in the run has `surface: backend` (polish never
runs for any of them) — the same frontend/backend split `flow/steps-and-gates.md`'s own polish
decision tree already makes; don't duplicate that logic, just skip the row when it will never
happen for any record. A single-record run checks that one record's `surface:`, unchanged from
before. A multi-spec run (dispatch bundle or `/flow` multi-spec — see "Multi-spec runs share one
PR" below) reads every record's `surface:` facet from the parent `manifest.yml`'s `specs[]` list
— the same list this step already walks to emit one `Fixes #{m}` line per record (see "One
`Fixes #{n}` line per record" below) — and omits the row only when every entry is `backend`. An
absent `surface:` facet counts as "can run polish" (only an explicit `backend` omits); the real
polish decision is made at runtime by `flow/steps-and-gates.md`'s decision tree and detection
layer 2, and creation must never pre-empt it toward omission.
```

with:

```
**The `polish` row is always present at creation (#3319).** Every run starts with all five rows,
`polish` included, whatever its records' `surface:` — `composePrEarlyBody` takes no `surface:`
input and never narrows the rows. A run that never polishes — `no-polish`, `ceremony-profile:
fast-lane`, or a non-frontend `surface:` (`backend`, `infra`) that `flow/steps-and-gates.md`'s
polish decision tree skips at runtime — removes the row through the skipped-phase rule above:
at polish's would-be exit in a single-record run, and at `_shared/pr-checklist-refresh.md`'s
Pre-merge title/description refresh in a multi-spec run, once no spec in the run ran polish.
#1712's earlier rule — leave the row out when every record is `surface: backend` — was never
implemented by the composer and is retired; the runtime decision tree, not creation, decides
whether polish runs.
```

`plugin/skills/flow/steps-and-gates.md:197` — in the polish phase-exit paragraph, replace this span (from "The row is omitted" through "nothing landed."):

```
The row is omitted at PR creation only when every record in the run has a backend `surface:` (that file's checklist composition rule — a multi-spec run checks every record, not just the first), so there is nothing to flip on that path; a `no-polish` or `ceremony-profile: fast-lane` run gets the row unchecked and removes it at polish's would-be exit in a single-record run (that file's skipped-phase rule), with no phase-exit push — nothing landed.
```

with:

```
Every PR starts with the `polish` row present, unchecked, whatever its records' `surface:` (`_shared/pr-early-run-lifecycle.md`'s checklist composition rule, #3319). When polish is skipped — `no-polish`, `ceremony-profile: fast-lane`, or a non-frontend `surface:` such as `backend` or `infra` — a single-record run removes the row at polish's would-be exit (that file's skipped-phase rule), with no phase-exit push — nothing landed.
```

Leave the paragraph's following sentence ("In a multi-spec run that would-be-exit removal is deferred instead — …") unchanged.

`plugin/skills/flow/multispec-pr-checklist.md:9` — replace this span:

```
the row is present at PR creation when *any* record in the run can run polish (`_shared/pr-early-run-lifecycle.md`'s creation rule — omitted only when every record is `surface: backend`), checked by
```

with:

```
the row is present at PR creation for every run, whatever its records' `surface:` (`_shared/pr-early-run-lifecycle.md`'s checklist composition rule, #3319), checked by
```

`plugin/skills/flow/multi-spec.md:175` — replace:

```
present if any record in the run can run polish, checked by whichever spec first runs it for real
```

with:

```
present from PR creation (#3319), checked by whichever spec first runs it for real
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/pr-early-run-lifecycle.test.js tests/bin-lib/flow/pr-body.test.js`
Expected: PASS (every test in both files)

Then confirm nothing else pinned the edited paragraphs:

Run: `git grep -n -E "omitted at PR creation|can run polish|present if any record|frontend/backend split" -- plugin tests`
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-early-run-lifecycle.md plugin/skills/flow/steps-and-gates.md plugin/skills/flow/multispec-pr-checklist.md plugin/skills/flow/multi-spec.md tests/pr-early-run-lifecycle.test.js
git commit -m "Retire the creation-time polish-row omission — every PR starts with five rows" -m "refs #3319"
```
