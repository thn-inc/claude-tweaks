# Release Notes: Authoring Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `## Release Note` an unconditionally-required spec section, thread a required `releaseNote` parameter through `composeSubject` (the one merge-subject/body composer every merge site calls), and derive it from a record's `## Release Note` section in `compose-subject.js`.

**Architecture:** Four small, independent-but-sequential edits: (1) the spec template + spec-shaped-body definition gain the new required section; (2) `compose-record/compose.js`'s structural gate enforces it; (3) `subject.js`'s pure `composeSubject` gains the `releaseNote` param, validation, and a new `Release-Note:` paragraph inserted between the summary/tag paragraph and the `Fixes` footer; (4) `compose-subject.js` derives `releaseNote` from the subject record's body and enforces the unconditional per-record check across a whole bundle. Every existing test fixture that calls `composeSubject({...})` directly, or exercises `compose-subject.js`/`compose-record`'s shape gate against a body with no `## Release Note` section, needs updating in the same task that adds the new required check — otherwise that task leaves the suite red.

**Tech Stack:** Node.js (`node --test`), no runtime deps. Plain-object pure functions + a thin CLI wrapper (`gh-api-module-pattern`'s injectable-deps convention).

**Spec:** GitHub issue #2580, materialized at `.claude-tweaks/pipelines/2026-09-18T054643-spec-2580-2581/spec-2580/work/2580-spec.md`

## Global Constraints

- `Release-Note:` is a **single-line trailer by construction** — the write side (`composeSubject`) writes whatever string `releaseNote` contains **verbatim, with no truncation**; it is the read-side regex (a later, separate unit) that only ever captures the first line. Do not add any line-splitting/truncation logic to `composeSubject` itself.
- The `releaseNote` validation in `composeSubject` is **unconditional** — every call must supply a non-empty string, not just `breaking` calls (unlike `migrationNote`).
- `compose-subject.js` derives `releaseNote` from the **subject record only** (`records[0]`, the lowest-numbered record in a bundle) — never aggregated across a bundle, unlike `migrationNote`. Every record in a bundle must still carry a non-empty `## Release Note` section (validated), but only the subject's text is rendered.
- New paragraph order in `composeSubject`'s output body: summary → `[{tag}]` → **`Release-Note: {line}`** → `Fixes #n` → `BREAKING CHANGE: {note}` (last, only when `breaking`).
- Out of scope (spec #2580's own Non-Goals): backfilling notes for already-merged records, type-grouped headings in the rendered public list, auto-generating/rewording the note, and rendering every record's note in a multi-record bundle (only the subject's note is rendered — this plan's Task 4 covers the *validation* half of that rule; *rendering* the collected notes into a changelog is sibling issue #2581, not this plan).

---

### Task 1: `## Release Note` is a required spec-template section

**Files:**
- Modify: `plugin/skills/specify/spec-template.md:60-66` (insert a new `## Release Note` section immediately after `## Acceptance Criteria`, before `## Technical Approach`)
- Modify: `plugin/skills/_shared/work-record.md:276` (spec-shaped body definition — name the fourth required section)

**Interfaces:**
- Produces: no code interface — this is documentation/template prose that Task 2's `REQUIRED_SECTIONS` array and Task 4's `compose-subject.js` both independently rely on existing (as a human-facing contract, not a runtime dependency — neither task imports this file).

This task is doc-only; there is no test cycle in the TDD sense (nothing to assert against markdown prose beyond making the edit itself). Verify by reading the result back.

- [ ] **Step 1: Insert the `## Release Note` section into the spec template**

In `plugin/skills/specify/spec-template.md`, between the end of the `## Acceptance Criteria` block (the line reading `3. ...` and the following blank line) and the `## Technical Approach` heading, insert:

```markdown
## Release Note

{One plain-language, verb-first sentence describing what this record delivers, written for someone reading the release notes — never a raw conventional-commit subject, an internal module name, a record number, or a file path. Required on every record, including one with no end-user-visible effect: describe what changed from the release-notes reader's perspective, even when that's "no user-visible change" phrased plainly (e.g. "Improved internal test coverage for the release composer") — never omitted.}

Example: "Added a visible warning when memory usage is critical" — verb-first, plain language, no record numbers or file paths. The `Release-Note:` trailer this section composes into at merge time is single-line by construction (`plugin/bin/lib/release/subject.js`'s `Release-Note:` paragraph) — write this section as one line even if drafting notes elsewhere run longer, since only the first line survives at merge time.

```

- [ ] **Step 2: Extend the spec-shaped-body definition**

In `plugin/skills/_shared/work-record.md`, change the line:

```markdown
- The sections `Current State`, `Deliverables`, and `Acceptance Criteria` are present.
```

to:

```markdown
- The sections `Current State`, `Deliverables`, `Acceptance Criteria`, and `Release Note` are present.
```

- [ ] **Step 3: Verify by reading both files back**

```bash
grep -n "## Release Note" plugin/skills/specify/spec-template.md
grep -n "Release Note" plugin/skills/_shared/work-record.md
```

Expected: both greps print a match; the spec-template.md match sits between `## Acceptance Criteria` and `## Technical Approach`.

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/specify/spec-template.md plugin/skills/_shared/work-record.md
git commit -m "Add required Release Note section to spec template + spec-shaped-body definition"
```

---

### Task 2: `compose-record/compose.js`'s structural gate requires `## Release Note`

**Files:**
- Modify: `plugin/bin/lib/compose-record/compose.js:11`
- Modify: `tests/bin-lib/compose-record/compose.test.js` (the shared `SHAPED` fixture, plus one new test)
- Modify: `tests/bin-lib/compose-record/cli.test.js` (the shared `SHAPED_PAYLOAD` fixture)

**Interfaces:**
- Consumes: nothing new.
- Produces: `REQUIRED_SECTIONS` now includes `'Release Note'` — `validateShaped(body)` (unchanged signature, `{ ok, gaps }`) now reports `missing section: ## Release Note` / `empty section: ## Release Note` when applicable. `bin/compose-record.js --require-shaped` (the CLI wrapping this) inherits the new gap automatically — no CLI change needed.

- [ ] **Step 1: Write the failing test for the new required section**

In `tests/bin-lib/compose-record/compose.test.js`, first extend the shared `SHAPED` fixture (used by several existing tests as "a well-formed spec-shaped body") to include a `## Release Note` section, so it stays genuinely well-formed once the gate changes:

```js
const SHAPED = [
  '## Current State',
  '',
  'Some current state text.',
  '',
  '## Deliverables',
  '',
  '- [ ] Do the thing.',
  '',
  '## Acceptance Criteria',
  '',
  '1. The thing is done.',
  '',
  '## Release Note',
  '',
  'Did the thing.',
].join('\n');
```

Then add a new test asserting the missing-section gap:

```js
test('validateShaped: flags a missing ## Release Note section (the fourth required section)', () => {
  const body = SHAPED.replace('\n\n## Release Note\n\nDid the thing.', '');
  const result = validateShaped(body);
  assert.equal(result.ok, false);
  assert.ok(result.gaps.some((g) => /missing section: ## Release Note/.test(g)));
});
```

- [ ] **Step 2: Run the new test to verify it fails**

```bash
node --test tests/bin-lib/compose-record/compose.test.js
```

Expected: FAIL — `validateShaped` does not yet know about `Release Note`, so `result.ok` is `true` and the gap-list assertion fails (the removed-section body still validates as shaped under the current three-section gate).

- [ ] **Step 3: Add `'Release Note'` to `REQUIRED_SECTIONS`**

In `plugin/bin/lib/compose-record/compose.js`, change:

```js
const REQUIRED_SECTIONS = ['Current State', 'Deliverables', 'Acceptance Criteria'];
```

to:

```js
const REQUIRED_SECTIONS = ['Current State', 'Deliverables', 'Acceptance Criteria', 'Release Note'];
```

- [ ] **Step 4: Run the full compose-record test file to verify it passes**

```bash
node --test tests/bin-lib/compose-record/compose.test.js
```

Expected: PASS — including the pre-existing `'validateShaped: ok on a well-formed spec-shaped body'` test, which now passes because `SHAPED` (Step 1) carries a `## Release Note` section.

- [ ] **Step 5: Fix the sibling CLI fixture (`cli.test.js`)**

`tests/bin-lib/compose-record/cli.test.js`'s `SHAPED_PAYLOAD` constant is used by the `'--require-shaped: passes a well-shaped body'` test, which will now fail (exit 4 instead of 0) because its body has no `## Release Note` section. Update it:

```js
const SHAPED_PAYLOAD = {
  title: 'A title',
  body: '## Current State\n\ntext\n\n## Deliverables\n\n- [ ] thing\n\n## Acceptance Criteria\n\n1. done\n\n## Release Note\n\nDid the thing.',
  type: 'feature',
  fingerprint: 'design-x:unit-y',
};
```

(The `'--require-shaped: fails (exit 4) and lists gaps for an unshaped body'` test's fixture is deliberately still missing every section but `## Current State` — it needs no change: it already asserts only that specific substrings appear in the error output, and the new `missing section: ## Release Note` gap simply joins the list without breaking that `assert.match`.)

- [ ] **Step 6: Run the full compose-record suite (both files) to verify everything passes**

```bash
node --test tests/bin-lib/compose-record/compose.test.js tests/bin-lib/compose-record/cli.test.js
```

Expected: PASS, all tests in both files.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/compose-record/compose.js tests/bin-lib/compose-record/compose.test.js tests/bin-lib/compose-record/cli.test.js
git commit -m "compose-record: require a non-empty Release Note section"
```

---

### Task 3: `composeSubject` gains a required `releaseNote` parameter

**Files:**
- Modify: `plugin/bin/lib/release/subject.js`
- Modify: `tests/bin-lib/release/subject.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `composeSubject({ type, title, number, breaking?, summary?, migrationNote?, releaseNote, fixes?, tag?, breakingRecords? })` — `releaseNote` is now a **required** field (throws `ComposeSubjectError` when empty/missing/non-string, citing `#{number}`, unconditionally — not gated behind `breaking`). The returned `{ title, body }`'s `body` now contains a `Release-Note: {releaseNote}` paragraph positioned after the summary/`[{tag}]` paragraph and before the `Fixes #n` footer (and before `BREAKING CHANGE:` when present). `Task 4` (`compose-subject.js`) is the only other caller of `composeSubject` and is updated in its own task.

- [ ] **Step 1: Write the failing tests for the new required parameter**

In `tests/bin-lib/release/subject.test.js`, add a new test (mirroring the existing `'throws on breaking without a migration note...'` test's shape, per spec AC1):

```js
test('releaseNote: throws ComposeSubjectError naming the record number when empty, missing, or non-string', () => {
  assert.throws(() => composeSubject({ type: 'feature', title: 'T', number: 42, releaseNote: '' }), /releaseNote must be a non-empty string[^]*#42/);
  assert.throws(() => composeSubject({ type: 'feature', title: 'T', number: 42, releaseNote: '   ' }), /releaseNote must be a non-empty string[^]*#42/);
  assert.throws(() => composeSubject({ type: 'feature', title: 'T', number: 42 }), /releaseNote must be a non-empty string[^]*#42/);
  assert.throws(() => composeSubject({ type: 'feature', title: 'T', number: 42, releaseNote: 123 }), /releaseNote must be a non-empty string[^]*#42/);
  assert.throws(() => composeSubject({ type: 'feature', title: 'T', number: 42 }), (err) => err instanceof ComposeSubjectError);
});
```

And a new test for the paragraph-order contract (AC2 — a search/split-based order check, deliberately not a full literal-body equality pin; that byte-pin style is reserved for the pre-existing exact-equality tests Step 5 updates below and for `merge-subject-composer-conformance.test.js`, per the spec's own AC2 note):

```js
test('body: Release-Note paragraph sits after summary/tag and before Fixes (and before BREAKING CHANGE)', () => {
  const { body } = composeSubject({ type: 'feature', title: 'Add X', number: 42, summary: 'Adds X.', tag: 'auto-merge', releaseNote: 'Added X.', fixes: [42, 43] });
  const paras = body.split('\n\n');
  assert.deepEqual(paras, ['Adds X.', '[auto-merge]', 'Release-Note: Added X.', 'Fixes #42\nFixes #43']);

  const brk = composeSubject({ type: 'feature', title: 'Drop legacy flag', number: 5, breaking: true, summary: 'Removes it.', migrationNote: 'Pass --new instead of --legacy.', releaseNote: 'Removed legacy flag support.' });
  const idx = {
    summary: brk.body.indexOf('Removes it.'),
    releaseNote: brk.body.indexOf('Release-Note: Removed legacy flag support.'),
    fixes: brk.body.indexOf('Fixes #5'),
    breaking: brk.body.indexOf('BREAKING CHANGE:'),
  };
  assert.ok(idx.summary < idx.releaseNote, 'summary must precede Release-Note');
  assert.ok(idx.releaseNote < idx.fixes, 'Release-Note must precede Fixes');
  assert.ok(idx.fixes < idx.breaking, 'Fixes must precede BREAKING CHANGE');
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
node --test tests/bin-lib/release/subject.test.js
```

Expected: FAIL — `composeSubject` has no `releaseNote` validation yet (the throw tests fail because nothing throws) and no `Release-Note:` paragraph (the body-order test fails on the exact-equality assertion).

- [ ] **Step 3: Implement `releaseNote` in `composeSubject`**

In `plugin/bin/lib/release/subject.js`:

1. Add `releaseNote` to the destructured parameter list:

```js
function composeSubject({ type, title, number, breaking = false, summary, migrationNote, releaseNote, fixes, tag, breakingRecords } = {}) {
```

2. Immediately after the existing `breaking`/`migrationNote` check block (after the `if (breaking && !note) { throw ... }` block, before `const prefix = ...`), add the unconditional check:

```js
  const cleanReleaseNote = typeof releaseNote === 'string' ? releaseNote.trim() : '';
  if (!cleanReleaseNote) {
    throw usage(`releaseNote must be a non-empty string for #${number}`);
  }
```

3. In the paragraph-assembly block, insert the new paragraph between the `[{tag}]` push and the `Fixes` push:

```js
  const paragraphs = [];
  const cleanSummary = typeof summary === 'string' ? summary.trim() : '';
  if (cleanSummary) paragraphs.push(cleanSummary);
  if (typeof tag === 'string' && tag.trim()) paragraphs.push(`[${tag.trim()}]`);
  // Release-Note is a single-line trailer by construction, same as BREAKING CHANGE: below — the
  // read-side Release-Note: footer regex (bin/lib/release-notes.js, a sibling unit) only ever
  // captures the first line, regardless of how many lines cleanReleaseNote actually has. This
  // function performs no truncation itself: it writes cleanReleaseNote verbatim (multi-line
  // included), exactly like migrationNote/BREAKING CHANGE: already does.
  paragraphs.push(`Release-Note: ${cleanReleaseNote}`);
  paragraphs.push(fixList.map((n) => `Fixes #${n}`).join('\n'));
  if (breaking) paragraphs.push(`BREAKING CHANGE: ${note}`);
```

4. Update the file's header comment (the block above `class ComposeSubjectError`) to mention the new paragraph — change:

```
// optional summary paragraph, optional `[{tag}]` paragraph (kept because
// _shared/github-pr-scan.md's auto-merged-this-week metric matches the tag
// anywhere in the message), `Fixes #n` footer lines, and a trailing
// `BREAKING CHANGE: {note}` footer when `breaking` is set.
```

to:

```
// optional summary paragraph, optional `[{tag}]` paragraph (kept because
// _shared/github-pr-scan.md's auto-merged-this-week metric matches the tag
// anywhere in the message), a required `Release-Note: {line}` paragraph
// (single-line by construction — see the inline comment at its push site),
// `Fixes #n` footer lines, and a trailing `BREAKING CHANGE: {note}` footer
// when `breaking` is set.
```

- [ ] **Step 4: Run the two new tests to verify they pass**

```bash
node --test tests/bin-lib/release/subject.test.js
```

Expected: still FAIL at this point — every *pre-existing* test in this file calls `composeSubject` without a `releaseNote`, so they now throw. Step 5 fixes those fixtures.

- [ ] **Step 5: Add `releaseNote` to every pre-existing test call that expects success**

In the same file, add a `releaseNote: 'Note.'` (or a case-appropriate string) field to every existing `composeSubject({...})` call that is not itself testing an earlier-failing validation path (those already throw before reaching the new check, so they're unaffected — see the Global Constraints' ordering note below). Concretely:

- `'type mapping: feature→feat, bug→fix, task→chore'` — add `releaseNote: 'Note.'` to all three calls.
- `'body: summary, optional tag paragraph, then one Fixes line per record'` — add `releaseNote: 'Added X.'` to all three calls (`{...tag: 'auto-merge'...}`, `noTag`, `noSummary`), and update the expected body strings to include the new paragraph:
  ```js
  test('body: summary, optional tag paragraph, then one Fixes line per record', () => {
    const { body } = composeSubject({ type: 'feature', title: 'Add X', number: 42, summary: 'Adds X.', tag: 'auto-merge', releaseNote: 'Added X.', fixes: [42, 43] });
    assert.equal(body, 'Adds X.\n\n[auto-merge]\n\nRelease-Note: Added X.\n\nFixes #42\nFixes #43');
    const noTag = composeSubject({ type: 'feature', title: 'Add X', number: 42, summary: 'Adds X.', releaseNote: 'Added X.' });
    assert.equal(noTag.body, 'Adds X.\n\nRelease-Note: Added X.\n\nFixes #42');
    const noSummary = composeSubject({ type: 'task', title: 'T', number: 1, releaseNote: 'Tidied.' });
    assert.equal(noSummary.body, 'Release-Note: Tidied.\n\nFixes #1');
  });
  ```
- `'breaking: ! suffix on the prefix and a trailing BREAKING CHANGE footer'` — add `releaseNote: 'Removed legacy flag support.'` and update the body assertions:
  ```js
  test('breaking: ! suffix on the prefix and a trailing BREAKING CHANGE footer', () => {
    const out = composeSubject({ type: 'feature', title: 'Drop legacy flag', number: 5, breaking: true, summary: 'Removes it.', migrationNote: 'Pass --new instead of --legacy.', releaseNote: 'Removed legacy flag support.' });
    assert.equal(out.title, 'feat!: Drop legacy flag (#5)');
    assert.ok(out.body.endsWith('\n\nBREAKING CHANGE: Pass --new instead of --legacy.'), out.body);
    assert.equal(out.body, 'Removes it.\n\nRelease-Note: Removed legacy flag support.\n\nFixes #5\n\nBREAKING CHANGE: Pass --new instead of --legacy.');
  });
  ```
- `'truncation: word-boundary cut, … marker, (#N) suffix intact, total ≤ 72'` — add `releaseNote: 'Note.'`.
- `'truncation: a title that fits is never touched, and 72 exactly is allowed'` — add `releaseNote: 'Note.'` to all three calls.
- `'truncation: the ! suffix is counted inside the budget before the cut'` — add `releaseNote: 'Note.'` to both `plain` and `brk` calls.
- `'truncation: a single over-long word is hard-cut rather than reduced to the bare prefix'` — add `releaseNote: 'Note.'`.
- `'truncation: a hard cut through a surrogate pair never leaves a lone surrogate'` — add `releaseNote: 'Note.'`.
- `'truncation: trailing punctuation is trimmed when the word-boundary cut lands right after it'` — add `releaseNote: 'Note.'`.

Do **not** touch: `'throws on breaking without a migration note, and on an unresolvable type'`, `'usage errors are a named ComposeSubjectError subclass of Error'`, `'usage errors for an unresolvable type or empty title cite the record number'`, `'empty-migrationNote usage error cites breakingRecords when given, else the record number'` — every assertion in these four tests throws on an earlier check (`number`, `type`, `title`, or `migrationNote`-when-`breaking`) before the code ever reaches the new `releaseNote` check, so they need no change. (Verified by the validation order in Step 3: `number` → `type` → `title` → `migrationNote`-if-`breaking` → `releaseNote`.)

- [ ] **Step 6: Run the full file to verify everything passes**

```bash
node --test tests/bin-lib/release/subject.test.js
```

Expected: PASS, all tests.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/release/subject.js tests/bin-lib/release/subject.test.js
git commit -m "composeSubject: require releaseNote, insert Release-Note: paragraph"
```

---

### Task 4: `compose-subject.js` derives and enforces `releaseNote`

**Files:**
- Modify: `plugin/bin/lib/compose-subject.js`
- Modify: `tests/bin-lib/compose-subject.test.js`

**Interfaces:**
- Consumes: `composeSubject` from Task 3 (now requires `releaseNote`).
- Produces: `run(argv, deps)` (unchanged CLI surface — no new flags) now (a) fails loudly with exit 1 and the message `` compose-subject.js: record(s) #{numbers} carry no non-empty "## Release Note" section `` when **any** record in the batch (not just `breaking`-labeled ones) has no non-empty `## Release Note` section, and (b) on success, derives `releaseNote` via `extractSection(subjectRecord.body, 'Release Note')` — the **subject record only**, never aggregated across a bundle — and passes it to `composeSubject`.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/compose-subject.test.js`, first add two new fixture records to the `RECORDS` map (used by the fake `gh issue view` responder):

```js
  2290: { number: 2290, title: 'No release note', body: '## Overview\n\nSomething.\n', labels: [{ name: 'type:task' }], issueType: null },
```

(2251 already exists and will carry a `## Release Note` section after Step 5 below — reuse it as the "has a note" half of the new tests.)

Then add the new tests (AC3, AC4):

```js
test('bundle: releaseNote is derived from the subject record only — a companion record\'s own section is required but never rendered', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2251,2252'], deps), 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.match(parsed.body, /Release-Note: Made merge subjects Conventional Commits shaped\./);
  assert.ok(!parsed.body.includes('Made reconcile squash-aware.'), parsed.body);
});

test('exit 1: a record with no ## Release Note section fails loudly, regardless of breaking', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2290'], deps), 1);
  assert.match(out.stderr, /record\(s\) #2290 carry no non-empty "## Release Note" section/);
  assert.ok(out.stderr.startsWith('compose-subject.js:'), out.stderr);
});

test('exit 1: a companion record with no ## Release Note section fails loudly even though the subject record has one', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2251,2290'], deps), 1);
  assert.match(out.stderr, /#2290/);
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
node --test tests/bin-lib/compose-subject.test.js
```

Expected: FAIL on all three new tests — `composeSubject` (via Task 3) now throws `releaseNote must be a non-empty string` for every existing `RECORDS` fixture (none carry a `## Release Note` section yet), so even the exit-0 assertions above fail, and the exit-1 tests fail because the actual stderr names the wrong missing field. **The whole pre-existing test file is now red at this point** (every test that expects `run([...]) === 0` fails) — this is the expected, temporary state until Step 3 (fixture updates) lands; do not treat it as a regression in an unrelated file.

- [ ] **Step 3: Add `## Release Note` sections to every existing `RECORDS` fixture body**

Update the `RECORDS` map so every record used by an exit-0 (success-path) test carries a `## Release Note` section — this both unblocks those tests and gives the new bundle-derivation test (Step 1) two distinct notes to distinguish between:

```js
const RECORDS = {
  2251: { number: 2251, title: 'Merge-time conventional subject', body: 'Surface: infra\n\n## Overview\n\nMakes the merge subject conventional. Second sentence.\n\n## Deliverables\n\n- x\n\n## Release Note\n\nMade merge subjects Conventional Commits shaped.\n', labels: [{ name: 'type:feature' }, { name: 'ready' }], issueType: null },
  2252: { number: 2252, title: 'Reconcile under squash', body: '## Overview\n\nSquash-aware reconcile.\n\n## Release Note\n\nMade reconcile squash-aware.\n', labels: [{ name: 'type:task' }], issueType: null },
  2260: { number: 2260, title: 'Drop the legacy flag', body: '## Overview\n\nRemoves --legacy.\n\n## Breaking Change\n\nPass --new instead of --legacy.\n\n## Release Note\n\nDropped the legacy flag.\n\n## Gotchas\n\n- none\n', labels: [{ name: 'type:feature' }, { name: 'breaking' }], issueType: null },
  2261: { number: 2261, title: 'Native-typed', body: '## Overview\n\nNative.\n\n## Release Note\n\nAdded native type support.\n', labels: [{ name: 'type:task' }], issueType: { name: 'Bug' } },
  2262: { number: 2262, title: "It's quoted", body: '## Overview\n\nHas a quote.\n\n## Release Note\n\nAdded quote handling.\n', labels: [{ name: 'type:bug' }], issueType: null },
  2263: { number: 2263, title: 'No type', body: '## Overview\n\nNo type label.\n\n## Release Note\n\nNo type label present.\n', labels: [{ name: 'ready' }], issueType: null },
  2264: { number: 2264, title: 'Breaking, no section', body: '## Overview\n\nOops.\n\n## Release Note\n\nOops noted anyway.\n', labels: [{ name: 'type:feature' }, { name: 'breaking' }], issueType: null },
  2265: { number: 2265, title: 'Unrecognized native type', body: '## Overview\n\nEpic-typed but stale-labeled.\n\n## Release Note\n\nUnrecognized type test note.\n', labels: [{ name: 'type:feature' }], issueType: { name: 'Epic' } },
  2266: { number: 2266, title: 'Shaping-mode record', body: '## Current State\n\nToday X is Y. More.\n\n## Release Note\n\nUpdated shaping-mode current state.\n', labels: [{ name: 'type:task' }], issueType: null },
  2270: { number: 2270, title: 'Second task in an all-task bundle', body: '## Overview\n\nAnother task.\n\n## Release Note\n\nAdded another task path.\n', labels: [{ name: 'type:task' }], issueType: null },
  2250: { number: 2250, title: 'Lowest is a task', body: '## Overview\n\nTask overview.\n\n## Release Note\n\nAdded task overview support.\n', labels: [{ name: 'type:task' }], issueType: null },
  2290: { number: 2290, title: 'No release note', body: '## Overview\n\nSomething.\n', labels: [{ name: 'type:task' }], issueType: null },
};
```

Note: `2264`'s body now also carries a `## Release Note` section even though its own test exercises the (unrelated) missing-`## Breaking Change`-section path — this keeps every fixture realistic (a record can be simultaneously breaking-unshaped and release-note-shaped) without changing that test's outcome, since the breaking-section check still runs and fails first (see Step 4 in `compose-subject.js` below).

- [ ] **Step 4: Update the two pre-existing body-assertion tests for the new paragraph**

```js
test('single record: conventional subject from type label, summary from Overview first sentence, one Fixes line', () => {
  const { deps, out } = fakeDeps();
  const code = run(['2251'], deps);
  assert.equal(code, 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.title, 'feat: Merge-time conventional subject (#2251)');
  assert.equal(parsed.body, 'Makes the merge subject conventional.\n\nRelease-Note: Made merge subjects Conventional Commits shaped.\n\nFixes #2251');
  assert.deepEqual(out.calls[0].slice(0, 3), ['issue', 'view', '2251']);
  assert.ok(out.calls[0].includes('--repo') && out.calls[0].includes('acme/repo'));
  assert.ok(out.calls[0].includes('number,title,body,labels,issueType'));
});
```

```js
test('bundle: subject from the lowest number, one Fixes line per record ascending, tag paragraph', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2252,2251', '--tag', 'auto-merge'], deps), 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.title, 'feat: Merge-time conventional subject (#2251)');
  assert.equal(parsed.body, 'Makes the merge subject conventional.\n\n[auto-merge]\n\nRelease-Note: Made merge subjects Conventional Commits shaped.\n\nFixes #2251\nFixes #2252');
});
```

```js
test('summary falls back to ## Current State\'s first sentence when ## Overview is absent (shaping-mode records)', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2266'], deps), 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.body, 'Today X is Y.\n\nRelease-Note: Updated shaping-mode current state.\n\nFixes #2266');
});
```

And the `--shell` round-trip test's expected recovered body (record 2262):

```js
  assert.equal(recoveredBody, 'Has a quote.\n\nRelease-Note: Added quote handling.\n\nFixes #2262');
```

(`'breaking record: ! suffix and BREAKING CHANGE footer...'`'s existing `.endsWith(...)` assertion needs no change — the new paragraph is inserted earlier in the body, before the part it already anchors on.)

- [ ] **Step 5: Implement the derivation + unconditional check in `compose-subject.js`**

In `plugin/bin/lib/compose-subject.js`, in `run(argv, deps)`, immediately after the existing `breaking`-section `missing` check block, add:

```js
  const releaseNoteMissing = records.filter((r) => !extractSection(r.body, 'Release Note'));
  if (releaseNoteMissing.length) {
    deps.stderr(`compose-subject.js: record(s) #${releaseNoteMissing.map((r) => r.number).join(', #')} carry no non-empty "## Release Note" section\n`);
    return 1;
  }
```

Then, where `migrationNote` is derived, also derive `releaseNote` (subject record only):

```js
  const migrationNote = breakingRecords.map((r) => extractSection(r.body, 'Breaking Change')).filter(Boolean).join('\n\n');
  const releaseNote = extractSection(subjectRecord.body, 'Release Note');
```

And pass it into the `composeSubject({...})` call:

```js
    composed = composeSubject({
      type: aggregateType(records),
      title: subjectRecord.title,
      number: subjectRecord.number,
      breaking: breakingRecords.length > 0,
      summary: firstSentence(extractSection(subjectRecord.body, 'Overview') || extractSection(subjectRecord.body, 'Current State')),
      migrationNote,
      releaseNote,
      fixes: opts.numbers,
      tag: opts.tag,
      breakingRecords: breakingRecords.map((r) => r.number),
    });
```

Also update the file's header comment to mention the new derivation (in the sentence listing what's derived from each record — after `migrationNote = the ## Breaking Change section)`, add: `releaseNote = the subject record's own ## Release Note section, never aggregated across a bundle`).

- [ ] **Step 6: Run the full file to verify everything passes**

```bash
node --test tests/bin-lib/compose-subject.test.js
```

Expected: PASS, all tests (pre-existing and new).

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/compose-subject.js tests/bin-lib/compose-subject.test.js
git commit -m "compose-subject: derive releaseNote from the subject record, require it on every record in a bundle"
```

---

### Task 5: Full-suite verification and call-site/fixture audit

**Files:** none modified (verification + a documented audit) — **except** as noted in Step 3, which is a no-op edit (confirmed, not applied).

**Interfaces:** none — this task produces no new interface, only evidence that Tasks 1-4 didn't miss a caller.

- [ ] **Step 1: Enumerate every direct `composeSubject(` call site**

```bash
grep -rln "composeSubject(" plugin tests
```

Expected output: exactly four files —
- `plugin/bin/lib/release/subject.js` (defines it — Task 3)
- `plugin/bin/lib/compose-subject.js` (the only runtime caller — Task 4)
- `tests/bin-lib/release/subject.test.js` (direct unit tests — Task 3)
- `tests/bin-lib/compose-subject.test.js` (exercises the CLI wrapper, not a direct call — Task 4)

No other file constructs a `composeSubject({...})` call directly. In particular, the four skill files the spec's own Gotchas section names as merge sites (`plugin/skills/_shared/settle-and-merge.md` [actually `plugin/skills/dispatch/settle-and-merge.md`], `plugin/skills/wrap-up/auto-merge-short-circuit.md`, `plugin/skills/_shared/local-merge-auto-finish.md`, `plugin/skills/flow/worktree-merge.md`) only ever invoke the **CLI** (`node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" ... --shell`) — they never construct a `composeSubject({...})` object literal, and the CLI's argument shape is unchanged by this plan (no new flag). Confirm this directly:

```bash
grep -ln "compose-subject.js" plugin/skills/dispatch/settle-and-merge.md plugin/skills/wrap-up/auto-merge-short-circuit.md plugin/skills/_shared/local-merge-auto-finish.md plugin/skills/flow/worktree-merge.md
grep -c "composeSubject(" plugin/skills/dispatch/settle-and-merge.md plugin/skills/wrap-up/auto-merge-short-circuit.md plugin/skills/_shared/local-merge-auto-finish.md plugin/skills/flow/worktree-merge.md
```

Expected: the first command lists all four files (each invokes the CLI); the second command prints `0` for every file (none construct `composeSubject(` directly). No edit needed to any of the four — the required-parameter change is fully absorbed by Task 4's CLI-side derivation.

- [ ] **Step 2: Confirm `tests/merge-subject-composer-conformance.test.js` needs no edit**

Read the file (`tests/merge-subject-composer-conformance.test.js`). Despite spec #2580's Acceptance Criteria 5 describing it as pinning "`composeSubject`'s exact output shape (paragraph ordering, footer text)" via "a byte-level fixture," the file as it actually exists only pins two unrelated things: (a) regex-matched invocation *shape* in the four merge-site skill `.md` files (that `compose-subject.js --shell` is called and its `$SUBJECT_TITLE`/`$SUBJECT_BODY` output is used in the `git merge -m` / `gh pr merge` command — never composeSubject's own body text), and (b) `plugin/skills/_shared/pr-first-merge.md`'s byte-size ceiling (`PR_FIRST_BYTE_CEILING`, an unrelated net-small check). It contains no fixture of composeSubject's literal output string. Since Task 4 confirmed (Step 1 above) that none of the four site files construct `composeSubject(` directly or need any prose change, this file's own assertions are unaffected by the new `Release-Note:` paragraph — there is nothing here to update. (The actual byte-pinned exact-string assertions of `composeSubject`'s paragraph order live in `tests/bin-lib/release/subject.test.js`, already updated in Task 3.)

Run it standalone to confirm it is still green with no changes:

```bash
node --test tests/merge-subject-composer-conformance.test.js
```

Expected: PASS, unchanged.

- [ ] **Step 3: Run the full suite**

```bash
npm test 2>&1 | tail -40
```

Expected: PASS — 0 failures. (If the count differs from a previous full run on unrelated files, re-run only the affected file in isolation per CLAUDE.md's flake-tolerance note before concluding anything broke — but every file this plan touches has already been independently verified green in Tasks 1-4's own Step-N runs above.)

- [ ] **Step 4: No commit** (verification only — nothing changed in this task beyond confirming the audit).

---

### Task 6: File a follow-up for two prose restatements of the spec-shaped-body check

**Files:** none modified by this plan — this task only files a backlog record.

**Interfaces:** none.

`plugin/bin/lib/compose-record/compose.js`'s own header comment states that `plugin/skills/specify/shaping-mode.md`'s Read-back verification and `plugin/skills/capture/SKILL.md`'s Shaped-body branch **both independently restate the three-section-plus-placeholder-marker check in prose** (as a human-facing verification step, not a mechanical call into `validateShaped`). Task 1-2 change what "spec-shaped" mechanically means (now four sections), but this plan's own Acceptance Criteria don't touch those two files, and this plan can ship correctly without editing them (the two mechanical gates — `materialize.md`'s hard gate and `compose-record/compose.js`'s `validateShaped` — are unaffected by whatever a human-facing prose restatement says). Leaving those two prose restatements un-synced with the new fourth section is a real but non-blocking gap — the kind of pre-existing-adjacent issue CLAUDE.md's Working Approach says to report rather than fold in.

- [ ] **Step 1: File the follow-up**

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/compose-record.js" - --out /tmp/release-note-followup.json <<'EOF'
{"title": "shaping-mode.md and capture/SKILL.md's shaped-body prose still name only three required sections", "type": "task", "body": "## Current State\n\nplugin/skills/specify/shaping-mode.md's Read-back verification step and plugin/skills/capture/SKILL.md's Shaped-body branch both restate _shared/work-record.md's spec-shaped-body check in prose (per plugin/bin/lib/compose-record/compose.js's own header comment) as a three-section check (Current State, Deliverables, Acceptance Criteria). #2580 added a fourth required section, ## Release Note, to the mechanical definition (_shared/work-record.md, compose-record/compose.js's REQUIRED_SECTIONS) but did not touch these two files' own prose restatements, since neither is a blocking dependency for #2580's own Acceptance Criteria.\n\n## Deliverables\n\n- [ ] Update shaping-mode.md's Read-back verification prose to name all four required sections\n- [ ] Update capture/SKILL.md's Shaped-body branch prose to name all four required sections\n\n## Acceptance Criteria\n\n1. Neither file's prose restatement of the spec-shaped-body check omits ## Release Note\n\n## Release Note\n\nKept two authoring-time human checklists in sync with the four-section spec-shaped-body definition."}
EOF
```

(This is illustrative shell — actually file it via `/claude-tweaks:capture` at build time per CLAUDE.md's "No implicit deferrals" rule, using whatever mechanism that skill documents; the exact JSON payload above is the record's intended content, not a literal command this plan requires running byte-for-byte.)

- [ ] **Step 2: No commit** (a GitHub issue, not a code change).
