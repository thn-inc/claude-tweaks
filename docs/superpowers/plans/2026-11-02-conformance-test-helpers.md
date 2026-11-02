# Conformance Test Helpers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `missingFactsOf`, `assertEachPatternGoesRed`, `lineStartingWith` and `sectionOf` into one `tests/helpers/conformance-asserts.js` and have the nine test files that carry copies `require` it.

**Architecture:** One helper module, a small test suite beside it (the `tests/helpers-*.test.js` convention), then one commit per migrated file. Pure test refactor: no `plugin/` file changes, and no migrated test's fact list changes.

**Tech Stack:** Node 18+, `node --test`, `node:assert/strict`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T091845-record-4827/work/4827-spec.md`

## Global Constraints

- Scope is the nine files the spec lists. Same-named functions in other files are different functions and stay: `tests/review-effort-label-diff-conformance.test.js`'s `lineStartingWith` returns `undefined` when absent, `tests/build-verify-after-doc-steps.test.js`'s `sectionOf` stops at `### `, `tests/review-vacuity-evidence-conformance.test.js`'s is heading-level aware, `tests/dispatch-mcp-timestamp-alias.test.js`'s takes one argument, `tests/bin-lib/review-context/build.test.js`'s reads a bundle.
- Never run `git stash` in any form; compare against a baseline with `git show <rev>:<path>`.
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #4827`, never `closes`/`fixes`.
- Stage each commit by explicit path, one migrated test file per commit.
- Governing skill `.claude/skills/skill-prose-conformance-tests/SKILL.md`, quoted verbatim: "Keep the patterns non-global: a `/g` regex makes `replace` strip every occurrence, which hides the twice-matched phrase, and its `.test()` carries `lastIndex` from one call to the next."
- Same skill, quoted verbatim: "A phrase that occurs twice in the region survives the one non-global `replace`, so the predicate reports `[]` and the proof goes red. That forces each pattern to match exactly once in its slice."
- Other project skills: none apply. No file under `plugin/bin/` changes, and `tests/raw-markdown-read-conformance.test.js` walks only `tests/**/*.test.js`, none of which gains a read.

## Probed Decisions

The copies have drifted, so one shared behavior had to be chosen. Each ruling below was probed on this checkout.

- **`assertEachPatternGoesRed` strips the first match only.** That is the copy in `no-dispatch-host-preflight`, `review-dispatched-reviewer-degrade`, `foreground-execution-instruction` and `release-run-dir-lifecycle`, and the governing skill's rule above.
- **`review-tiebreak-step` really needs the global strip.** Its copy strips every match. A scratch copy with the strip made first-match failed 5 of its 103 tests (exit 1): `AC1.1 the tier and mode assertion can go red`, `AC2.1 the dispatch template assertions can go red`, `AC5.1 the refutation-template assertions can go red`, `AC5.2 the refutation-rule assertions can go red`, `AC9.1 the coordination-doc assertions can go red`. So that behavior gets its own export, `assertEveryMatchGoesRed`, and this refactor changes no test's strictness.
- **`standalone-run-dir-closeout` uses the global strip too.** Its copy passes either way (scratch run, exit 0). It keeps the global strip, so this refactor stays behavior-neutral.
- **`sectionOf` takes the full heading line and matches it as a whole line**, from the `review-tiebreak-step` copy (line-anchored and exact). The `no-dispatch-host-preflight` copy matched a bare substring, which a `### ` heading or a longer heading would also satisfy. Its one caller's heading, `## No-dispatch host (#4555)`, is a whole line at `plugin/skills/build/execution-mode-policy.md:58`.
- **AC1's absence grep can match its target:** run on this checkout it lists all nine files. `const { missingFactsOf } =` does not match it, so the destructured imports stay clear of it.

## Review Focus

- A fact phrase stated twice in a region: `assertEachPatternGoesRed` must fail, `assertEveryMatchGoesRed` must pass (Task 1).
- A strip that also breaks a neighbouring pattern: both must fail, reporting two facts (Task 1).
- A pattern whose anchor is absent: fails with the "proof cannot discriminate" message, not a misleading deepEqual (Task 1).
- A heading that is only a prefix of a real heading (`## Foo` vs `## Foo Bar`, or `### Foo`): `sectionOf` throws rather than returning the wrong region (Task 1).
- The object-keyed fact lists in `wrap-up-merge-mode`: report order and fact names unchanged through the adapter (Task 5).

---

### Task 1: The helper module and its suite

**Files:**
- Create: `tests/helpers/conformance-asserts.js`
- Test: `tests/helpers-conformance-asserts.test.js`

**Interfaces:**
- Produces, from `tests/helpers/conformance-asserts.js`:
  - `missingFactsOf(patterns) -> (text) -> string[]`, `patterns` being `[RegExp, fact][]`
  - `assertEachPatternGoesRed(text, patterns, missingOf) -> void`
  - `assertEveryMatchGoesRed(text, patterns, missingOf) -> void`
  - `globalOf(pattern) -> RegExp`
  - `lineStartingWith(text, prefix) -> string`, `''` when absent
  - `sectionOf(text, fullHeadingLine) -> string`, throws when absent

- [ ] **Step 1: Write the failing test**

Create `tests/helpers-conformance-asserts.test.js`:

```js
// tests/helpers-conformance-asserts.test.js — #4827: pins tests/helpers/conformance-asserts.js, the
// fact-list predicate and go-red proofs the prose-conformance suites share.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { missingFactsOf, assertEachPatternGoesRed, assertEveryMatchGoesRed, globalOf, lineStartingWith, sectionOf } = require('./helpers/conformance-asserts');

const FACTS = [[/alpha/, 'has alpha'], [/beta/, 'has beta']];
const missing = missingFactsOf(FACTS);

test('missingFactsOf reports the facts whose pattern no longer matches, in list order', () => {
  assert.deepEqual(missing('alpha beta'), []);
  assert.deepEqual(missing('alpha'), ['has beta']);
  assert.deepEqual(missing(''), ['has alpha', 'has beta']);
});

test('assertEachPatternGoesRed passes when each pattern matches once', () => {
  assertEachPatternGoesRed('alpha beta', FACTS, missing);
});

test('assertEachPatternGoesRed fails on a phrase stated twice: the first-match strip leaves a copy', () => {
  assert.throws(() => assertEachPatternGoesRed('alpha alpha beta', FACTS, missing), /removing only "has alpha"/);
});

test('assertEveryMatchGoesRed passes on a phrase stated twice: it strips every match', () => {
  assertEveryMatchGoesRed('alpha alpha beta', FACTS, missing);
});

test('both proofs fail when an anchor is absent, naming the fact', () => {
  const absentFirst = [[/beta/, 'has beta'], [/alpha/, 'has alpha']];
  const missingAbsentFirst = missingFactsOf(absentFirst);
  assert.throws(() => assertEachPatternGoesRed('alpha', absentFirst, missingAbsentFirst), /anchor text for "has beta" not found/);
  assert.throws(() => assertEveryMatchGoesRed('alpha', absentFirst, missingAbsentFirst), /anchor text for "has beta" not found/);
});

test('both proofs fail when one strip also breaks a neighbouring pattern', () => {
  const overlapping = [[/alpha beta/, 'the pair'], [/beta/, 'has beta']];
  const missingOverlap = missingFactsOf(overlapping);
  assert.throws(() => assertEachPatternGoesRed('alpha beta', overlapping, missingOverlap), /removing only "the pair"/);
  assert.throws(() => assertEveryMatchGoesRed('alpha beta', overlapping, missingOverlap), /removing only "the pair"/);
});

test('globalOf adds the g flag once and keeps the other flags', () => {
  assert.equal(globalOf(/a/i).flags, 'gi');
  assert.equal(globalOf(/a/g).flags, 'g');
});

test('lineStartingWith returns the whole first matching line, or the empty string', () => {
  assert.equal(lineStartingWith('one\ntwo words\ntwo more', 'two'), 'two words');
  assert.equal(lineStartingWith('one', 'two'), '');
});

const DOC = 'intro\n## First\nbody one\n### Sub\nsub body\n## First Extended\nbody two\n## Last\nbody three\n';

test('sectionOf returns the heading through the text before the next ## heading', () => {
  assert.equal(sectionOf(DOC, '## First'), '## First\nbody one\n### Sub\nsub body');
});

test('sectionOf runs to the end of the text for the last section', () => {
  assert.equal(sectionOf(DOC, '## Last'), '## Last\nbody three\n');
});

test('sectionOf matches the whole heading line, never a prefix or a deeper heading', () => {
  assert.throws(() => sectionOf(DOC, '## Sub'), /heading not found: ## Sub/);
  assert.throws(() => sectionOf(DOC, '## Fir'), /heading not found: ## Fir/);
  assert.throws(() => sectionOf(DOC, '## Absent'), /heading not found: ## Absent/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/helpers-conformance-asserts.test.js`
Expected: FAIL with "Cannot find module './helpers/conformance-asserts'"

- [ ] **Step 3: Implement `tests/helpers/conformance-asserts.js`**

```js
'use strict';
// tests/helpers/conformance-asserts.js — #4827: the fact-list predicate and go-red proofs the
// prose-conformance suites share, plus the two region readers they slice with. The rules for using
// them live in .claude/skills/skill-prose-conformance-tests/SKILL.md. tests/helpers-conformance-asserts.test.js
// pins this file.
const assert = require('node:assert/strict');

// A fact-list predicate: the facts whose pattern the text no longer matches.
const missingFactsOf = (patterns) => (text) => patterns.filter(([pattern]) => !pattern.test(text)).map(([, fact]) => fact);

// The pattern as a global regex, so a strip removes every match.
const globalOf = (pattern) => new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);

function proveEachGoesRed(text, patterns, missingOf, stripWith) {
  for (const [pattern, fact] of patterns) {
    const doctored = text.replace(stripWith(pattern), '');
    assert.notEqual(doctored, text, `anchor text for "${fact}" not found — proof cannot discriminate`);
    assert.deepEqual(missingOf(doctored), [fact], `removing only "${fact}" must turn exactly that assertion red`);
  }
}

// Per-assertion go-red proof: strip one pattern's first match from the live text, and the shared
// predicate must report exactly that one fact missing. A phrase stated twice survives the strip, so
// this also forces each pattern to match exactly once.
function assertEachPatternGoesRed(text, patterns, missingOf) {
  proveEachGoesRed(text, patterns, missingOf, (pattern) => pattern);
}

// The same proof for a region that deliberately states a fact more than once: strip every match.
// Prefer assertEachPatternGoesRed; this one cannot catch a phrase that went twice by accident.
function assertEveryMatchGoesRed(text, patterns, missingOf) {
  proveEachGoesRed(text, patterns, missingOf, globalOf);
}

const lineStartingWith = (text, prefix) => text.split('\n').find((line) => line.startsWith(prefix)) || '';

// The text from a whole heading line (`## Foo`) to the next `## ` heading, or to the end of the text.
// Asserts the heading exists.
function sectionOf(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  assert.notEqual(start, -1, `heading not found: ${heading}`);
  const next = text.indexOf('\n## ', start + 1);
  return next === -1 ? text.slice(start + 1) : text.slice(start + 1, next);
}

module.exports = { missingFactsOf, assertEachPatternGoesRed, assertEveryMatchGoesRed, globalOf, lineStartingWith, sectionOf };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/helpers-conformance-asserts.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/conformance-asserts.js tests/helpers-conformance-asserts.test.js
git commit -m "Add shared conformance-test helpers — one home for the fact predicate and go-red proofs, refs #4827"
```

### Task 2: Migrate the four first-match copies

**Files:**
- Modify: `tests/foreground-execution-instruction.test.js`
- Modify: `tests/release-run-dir-lifecycle-conformance.test.js`
- Modify: `tests/review-dispatched-reviewer-degrade-conformance.test.js`
- Modify: `tests/no-dispatch-host-preflight-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `missingFactsOf`, `assertEachPatternGoesRed`, `lineStartingWith`, `sectionOf`.

In each file, add a destructured `require('./helpers/conformance-asserts')` directly after the `require('./helpers/read-skill')` line, naming only what that file uses, and delete the local definitions with their lead comments:

| File | Imports | Delete |
|---|---|---|
| `foreground-execution-instruction` | `missingFactsOf, assertEachPatternGoesRed` | lines 54-65 |
| `release-run-dir-lifecycle` | `missingFactsOf, assertEachPatternGoesRed` | `const missingFactsOf` at line 297 and the function at lines 300-306 |
| `review-dispatched-reviewer-degrade` | `missingFactsOf, assertEachPatternGoesRed, lineStartingWith` | lines 18-29 and the `const lineStartingWith` at line 33 |
| `no-dispatch-host-preflight` | `missingFactsOf, assertEachPatternGoesRed, lineStartingWith, sectionOf` | lines 23-34, the `const lineStartingWith` at line 36, and the `sectionOf` function with its comment at lines 45-51 |

`no-dispatch-host-preflight`'s `POLICY_HEADING` and its `sectionOf(readText(POLICY), POLICY_HEADING)` call stay as they are: the heading is already the full line.

Run these steps once per file, in the table's order:

- [ ] **Step 1: Make the edit above for this one file**

- [ ] **Step 2: Run the file in isolation (AC2.1)**

Run: `node --test tests/{file}.test.js`
Expected: PASS, with the same test count as `git show HEAD:tests/{file}.test.js` declares (no test added or removed).

- [ ] **Step 3: Commit this one file**

```bash
git add tests/{file}.test.js
git commit -m "Use the shared conformance helpers in {file} — drop the local copies, refs #4827"
```

### Task 3: Migrate the express-prose and standalone copies

**Files:**
- Modify: `tests/dispatch-express-routing-prose.test.js`
- Modify: `tests/flow-express-entry-prose.test.js`
- Modify: `tests/standalone-run-dir-closeout-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `missingFactsOf`, `assertEachPatternGoesRed`, `assertEveryMatchGoesRed`, `globalOf`.

Same require placement as Task 2. These three keep their local proof names, now built on the shared code:

- `dispatch-express-routing-prose` and `flow-express-entry-prose`: import `missingFactsOf, assertEachPatternGoesRed`. Delete `const missingFactsOf`. Replace the body of `assertEachFactGoesRed` so the function reads `const assertEachFactGoesRed = (text, facts) => assertEachPatternGoesRed(text, facts, missingFactsOf(facts));`, keeping its lead comment. Their fact lists already use the `[pattern, name]` shape.
- `standalone-run-dir-closeout`: import `missingFactsOf, assertEveryMatchGoesRed, globalOf`. Delete `const missingFactsOf` and `const globally`. In `assertFactsAndGoRed`, replace the `for` loop with `assertEveryMatchGoesRed(text, patterns, missingOf);` and keep the `deepEqual` above it. At line 236, `globally(P_STATEMENT[0])` becomes `globalOf(P_STATEMENT[0])`.

Run these steps once per file:

- [ ] **Step 1: Make the edit above for this one file**

- [ ] **Step 2: Run the file in isolation (AC2.1)**

Run: `node --test tests/{file}.test.js`
Expected: PASS

- [ ] **Step 3: Commit this one file**

```bash
git add tests/{file}.test.js
git commit -m "Use the shared conformance helpers in {file} — drop the local copies, refs #4827"
```

### Task 4: Migrate review-tiebreak-step

**Files:**
- Modify: `tests/review-tiebreak-step-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `missingFactsOf`, `assertEveryMatchGoesRed`, `globalOf`, `lineStartingWith`, `sectionOf`.

This file keeps its strip-every-match proof, under the name that says so, because 5 of its go-red tests fail on a first-match strip (Probed Decisions).

- [ ] **Step 1: Swap the definitions for the import**

Add the require after the `./helpers/read-skill` line. Delete the local `missingFactsOf` (line 24), `globalOf` (line 30), `assertEachPatternGoesRed` (lines 32-40), `lineStartingWith` (line 74) and `sectionOf` (lines 76-81), each with its lead comment. Keep `leftoverFactsOf`, `sectionFactsMissing`, `assertEachSectionFactGoesRed`, `sliceSection`, `between` and `fencedTemplate`: none is one of the four helpers. `sliceSection` has five other callers (lines 921, 965, 1028, 1333, 1334).

- [ ] **Step 2: Rename every go-red call site**

Rename every `assertEachPatternGoesRed(` call to `assertEveryMatchGoesRed(`. Update the file's header comment (lines 2-4) to read `missingFactsOf + assertEveryMatchGoesRed, from tests/helpers/conformance-asserts.js`.

- [ ] **Step 3: Pass full heading lines to `sectionOf`**

Every `sectionOf` call site passed bare text and now passes the `## ` prefix: literal arguments become `'## Placement'`, `'## Dispatch'`, `'## Resolve and act'`, `'## Findings artifact'`, `'## Standalone review'`, `'## Dispatched reviewer'`. The one non-literal, `tiebreakSection` at line 1023, becomes `` sectionOf(texts.tiebreak, `## ${heading}`) `` and its callers stay bare.

- [ ] **Step 4: Run the file in isolation (AC2.1)**

Run: `node --test tests/review-tiebreak-step-conformance.test.js`
Expected: PASS, 103 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/review-tiebreak-step-conformance.test.js
git commit -m "Use the shared conformance helpers in review-tiebreak-step — keep its strip-every-match proof, refs #4827"
```

### Task 5: Migrate wrap-up-merge-mode through an adapter

**Files:**
- Modify: `tests/wrap-up-merge-mode-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `missingFactsOf`, `assertEachPatternGoesRed`.

Its copy takes `(text, facts)` with `facts` an object of `name: regex`, so it is a differently shaped predicate. The object-keyed fact lists stay, because they carry the file's readable fact names.

- [ ] **Step 1: Replace the local copy**

Add the require after the `./helpers/read-skill` line, importing `missingFactsOf, assertEachPatternGoesRed`. Replace lines 11-23 with:

```js
// This file keys its fact lists by name; the shared helpers take [pattern, fact] pairs.
const factPairs = (facts) => Object.entries(facts).map(([name, re]) => [re, name]);
const factsMissingFrom = (text, facts) => missingFactsOf(factPairs(facts))(text);
const assertEachFactGoesRed = (text, facts) => assertEachPatternGoesRed(text, factPairs(facts), missingFactsOf(factPairs(facts)));
```

Rename the remaining `missingFactsOf(` call sites (lines 128, 210, 274, 335, 343, 357, 417, 472) to `factsMissingFrom(`.

- [ ] **Step 2: Run the file in isolation (AC2.1)**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js`
Expected: PASS

- [ ] **Step 3: Confirm AC1.1**

Run: `grep -rlE "(function|const) missingFactsOf" tests`
Expected: exactly `tests/helpers/conformance-asserts.js`

- [ ] **Step 4: Commit**

```bash
git add tests/wrap-up-merge-mode-conformance.test.js
git commit -m "Use the shared conformance helpers in wrap-up-merge-mode — adapt its object-keyed facts, refs #4827"
```

### Task 6: Repoint the governing skill

**Files:**
- Modify: `.claude/skills/skill-prose-conformance-tests/SKILL.md:63`

- [ ] **Step 1: Repoint the citation**

Line 63 cites `` `assertEachPatternGoesRed` in `tests/foreground-execution-instruction.test.js` (#3078) ``, a copy Task 2 removed. Change it to name `` `tests/helpers/conformance-asserts.js` (`missingFactsOf`, `assertEachPatternGoesRed`) `` as the home, keeping the sentence's point that `tests/foreground-execution-instruction.test.js` applies it across the core rule, `task-prompt.md`'s item 7 and both fenced templates. After the sentence ending "and its `.test()` carries `lastIndex` from one call to the next.", add: "`assertEveryMatchGoesRed` is the helper's global-strip form, for a region that deliberately states a fact more than once; it cannot catch a phrase that went twice by accident, so reach for it only then."

- [ ] **Step 2: Confirm no stale citation remains**

Run: `git grep -n -E "assertEachPatternGoesRed. in .tests/foreground" -- .claude/skills`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/skill-prose-conformance-tests/SKILL.md
git commit -m "Point skill-prose-conformance-tests at the shared helpers — the copy it cited is gone, refs #4827"
```

## Spec coverage

| Spec item | Where |
|---|---|
| Deliverable 1: one helper module | Task 1 |
| Deliverable 2: one commit per file, run in isolation | Tasks 2-5 |
| AC1.1: the absence grep lists only the helper | Task 5 Step 3 |
| AC2.1: every migrated file passes in isolation, and `npm test` passes | Tasks 2-5 per file; `npm test` at `/build` Common Step 5 |
