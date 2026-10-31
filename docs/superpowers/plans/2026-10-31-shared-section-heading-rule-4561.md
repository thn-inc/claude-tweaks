# Shared Section-Heading Rule (#4561) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One rule decides what counts as a record section-heading line and which lines are fenced; every record-body heading reader goes through it.

**Architecture:** `plugin/bin/lib/issues/record-payload.js` already owns the fence rule (`scanFences` / `fencedLineRanges` / `fencedLineMask`, CommonMark 0-3-space openers) and `findSection`. Add a shared heading-line reader (`headingLine`) and a first-unfenced-heading finder (`findHeadingLine`) beside them, rebuild `findSection` on top of both, export `scanFences`, then move `near-duplicate.js`, `materialize-format.js` (`ORIGINAL_REQUEST_RE` → `authoredRegion`), `compose-record/compose.js`, `ambiguity-resolve.js` and `release-note-repair/apply.js` onto them.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T123138-record-4561/work/4561-spec.md`

Scope keywords: ORIGINAL_REQUEST_RE, FENCE_OPEN, CURRENT_STATE_HEADING_RE, fenceInfo

## Global Constraints

- Fence-opener decision (Deliverable 2), settled once: **the shared CommonMark rule in `scanFences`** — an opener is an optional U+FEFF, 0-3 leading spaces, then 3+ backticks (no backtick later on the line) or 3+ tildes; 4+ leading spaces or a tab is an indented code block, not a fence. `apply.js`'s any-whitespace `FENCE_OPEN` is retired. A 2-space list-indented fence (`AC_INDENTED_FENCE`) stays a fence under this rule.
- Heading-line rule (one definition, `headingLine`): 1-6 `#` at column 0, then a space or tab; the heading text is the rest of the line with leading and trailing spaces/tabs removed (only `[ \t]`, never `\r` — callers normalize CRLF first, as `findSection` already does).
- An unclosed fence uses `fencedLineMask`'s default (it swallows to end of body), matching `findSection`; never `unclosedAsText`.
- `## Original request` boundary (spec Decisions, Reading B): the first **unfenced** level-2 heading whose text is exactly `Original request`. Intended behavior change, to be stated in the PR: a fenced `## Original request` no longer ends the authored region for the shape gate's placeholder check.
- No new dependencies. Library code only (`plugin/bin/lib/**`); no `fs` calls added.
- Commit style: `{Verb} {what} — {detail}` ending with `refs #4561` (never `closes`/`fixes`).
- Every test that reads a source file as text uses `readText` from `tests/helpers/read-skill.js` (the `raw-markdown-read` scan flags a raw `fs.readFileSync`).

## Review Focus

1. CRLF bodies: every migrated caller must still find headings on a `\r\n` body (old `ORIGINAL_REQUEST_RE` had `/m`, so `$` matched before `\r`). Pinned in Task 3 (`authoredRegion` CRLF test) and by `apply.test.js`'s existing CRLF case (Task 5).
2. A fence opened after `## Original request` and never closed must not make `applyReleaseNote` refuse (old code only scanned the authored region). Pinned in Task 5.
3. `findSection` behavior must be byte-identical after the rebuild: every existing `findSection`/`extractSection`/`sectionText` test stays green unchanged (Task 1 Step 4 runs them).
4. A heading line with trailing `\r` read without CRLF normalization (e.g. `dropEmptyOpenQuestions`, which splits on `\n`) must still match. Pinned in Task 3.
5. Duplicate headings: `splitSections` concatenates content of a repeated heading while `findSection` takes the first — the agreement test (Task 4) uses bodies without duplicates, and the existing merge behavior is kept.

## Scope sweep verdicts

Check B (scope keywords) hits outside the task Files blocks, each no-change: `plugin/bin/lib/init/claude-md-conformance.js` and its test (its own `splitSections` reads CLAUDE.md, not a record body); `tests/design-wrapper-finish-reviewer-normalize.test.js`, `tests/release-skill-reference-form.test.js`, `tests/working-approach-scope-discipline.test.js` (local or claude-md `splitSections` helpers, unrelated); `docs/plugin-structure.md` (its compose-record row stays accurate); `docs/superpowers/plans/2026-10-28-fenced-heading-skip-4369.md` (history).

### Heading-literal grep (shared-contract-extraction skill)

`grep -rnF -e '^## ' -e '^#{' -e '\n## ' plugin/bin` hits outside this plan's files read non-record markdown — `changelog.js`, `residue/probes/release.js`, `release-tip/check.js` (CHANGELOG), `init/claude-md-conformance.js` (CLAUDE.md), `skill-audit/*` (skills), `plan-audit/parser.js` (plans), `log-decision/append.js` and `console/resolve.js` (run-dir files), `closing-tally.js`, `flow/pr-body.js` (PR bodies), `flow/artifact-overwrite-check.js` — not record section headings, so out of scope (no change).

---

### Task 1: Shared heading reader in record-payload.js

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/record-payload.js` (dead `ANY_HEADING_RE` at :310, `findSection` :332-348, the `scanFences` comment's consumer list :96-110, `module.exports`)
- Test: `tests/bin-lib/issues/record.test.js`

**Interfaces:**
- Produces:
  - `headingLine(line: string) -> { level: number, text: string } | null`
  - `findHeadingLine(lines: string[], heading: string, { levelPattern = '2,4', fenced }: { levelPattern?: string, fenced?: boolean[] } = {}) -> number` — index of the first line with `!fenced[i]`, `headingLine(lines[i])` non-null, level matching `^#{levelPattern}$` (same quantifier-body string `findSection` takes) and `text === heading`; `-1` when none. `fenced` defaults to `fencedLineMask(lines)`.
  - `scanFences` added to `module.exports` (unchanged; returns `{ ranges, unclosed }`).
  - `findSection` keeps its exact signature and results; its start line comes from `findHeadingLine`, its stop test is `headingLine(line)` with level matching `stopPattern`.

- [ ] **Step 1: Write the failing tests** (require from `../../../plugin/bin/lib/issues/record-payload`)

```js
test('headingLine: the one heading-line rule (#4561)', () => {
  assert.deepEqual(headingLine('## Release Note'), { level: 2, text: 'Release Note' });
  assert.deepEqual(headingLine('###\t Current State \t'), { level: 3, text: 'Current State' });
  assert.deepEqual(headingLine('## '), { level: 2, text: '' });
  assert.equal(headingLine('##Release Note'), null);
  assert.equal(headingLine(' ## Release Note'), null);
  assert.equal(headingLine('####### Seven'), null);
  assert.equal(headingLine('text ## not a heading'), null);
});

test('findHeadingLine: first unfenced match at the given level; fenced and wrong-level lines skipped (#4561)', () => {
  const lines = ['```', '## Original request', '```', '### Original request', '## Original request'];
  assert.equal(findHeadingLine(lines, 'Original request', { levelPattern: '2' }), 4);
  assert.equal(findHeadingLine(lines, 'Original request', { levelPattern: '2,4' }), 3);
  assert.equal(findHeadingLine(['## Other'], 'Original request'), -1);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern="headingLine|findHeadingLine" tests/bin-lib/issues/record.test.js`
Expected: FAIL after Step 1 (headingLine is not a function)

- [ ] **Step 3: Implement** `headingLine` (replace the dead `ANY_HEADING_RE` with the `/^(#{1,6})[ \t]/` it already is, text = remainder stripped of leading/trailing `[ \t]`), `findHeadingLine`, rebuild `findSection` on them (CRLF normalization, `fencedLineMask` default, `trim` option unchanged), export `headingLine`, `findHeadingLine`, `scanFences`. Update the `scanFences` comment's consumer list: `extractCurrentStateAnchors` now reaches the rule through `findSection`; add `apply.js` (release-note-repair) and `authoredRegion` (materialize-format.js) as consumers (#4561).

- [ ] **Step 4: Run the whole record suite and the materialize-format suite (characterization)**

Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/issues/materialize-format.test.js`
Expected: PASS, with no existing test edited.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/record-payload.js tests/bin-lib/issues/record.test.js
git commit -m "Add the shared heading-line reader — findSection rebuilt on headingLine/findHeadingLine, scanFences exported; refs #4561"
```

### Task 2: near-duplicate.js reads Current State through findSection

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/near-duplicate.js:88-139` (drop `CURRENT_STATE_HEADING_RE`, `ANY_HEADING_RE`; `extractCurrentStateAnchors` uses `findSection(String(body || ''), 'Current State')`, splits the section on `\n`, collects backtick spans per line exactly as now)
- Test: `tests/bin-lib/issues/near-duplicate.test.js`

**Interfaces:**
- Consumes: `findSection` (Task 1, defaults `levelPattern '2,4'`, `stopPattern '1,6'` — the same levels the retired regexes used).

- [ ] **Step 1: Write the failing test**

```js
test('AC2.1: a Current State heading only inside a fence is absent, matching findSection (#4561)', () => {
  const body = 'Intro\n\n```markdown\n## Current State\n\nSee `plugin/bin/lib/x.js`.\n```\n\n## Deliverables\n\n- y';
  assert.equal(findSection(body, 'Current State'), null);
  assert.equal(extractCurrentStateAnchors(body).size, 0);
});
```

This test passes on the current code (fence tracking landed in #4369), so it is a characterization pin, not a red-first test: the red-first proof for this task is the source-scan test in Task 5 Step 1 (`CURRENT_STATE_HEADING_RE` present → red).

- [ ] **Step 2: Run the suite**

Run: `node --test tests/bin-lib/issues/near-duplicate.test.js`
Expected: PASS before and after the change (characterization pin).

- [ ] **Step 3: Implement** the migration above; update the function's comment (it now reads the section through `findSection`; drop the CRLF sentence that names the retired regex).

- [ ] **Step 4: Run** `node --test tests/bin-lib/issues/near-duplicate.test.js` — Expected: PASS, no existing test edited.

- [ ] **Step 5: Commit** — `Route near-duplicate's Current State read through findSection — drops its own heading regexes; refs #4561`

### Task 3: authoredRegion replaces ORIGINAL_REQUEST_RE (materialize-format, compose.js validateShaped, ambiguity-resolve)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/materialize-format.js` (lines 24-30, 90-102 and 207: delete `ORIGINAL_REQUEST_RE`, add and export `authoredRegion`, `shapeGate` uses it, update the comment block at :24-29)
- Modify: `plugin/bin/lib/compose-record/compose.js` (lines 9-12 and 54-56: `validateShaped` uses `authoredRegion`; import list loses `ORIGINAL_REQUEST_RE`)
- Modify: `plugin/bin/lib/issues/ambiguity-resolve.js:7-60` (`authoredText` uses `authoredRegion`; `OPEN_QUESTIONS_HEADING_RE` retired — `hasOpenQuestionsSection` and `dropEmptyOpenQuestions` find the heading as an unfenced `headingLine` of level 2-4 whose text matches `/^open questions\b/i` (the loose, fail-closed name rule kept as a name test, not a heading-line regex); `dropEmptyOpenQuestions`'s section end uses `headingLine` level `<=` start level on unfenced lines; strip a trailing `\r` before `headingLine`)
- Test: `tests/bin-lib/issues/materialize-format.test.js`, `tests/bin-lib/compose-record/compose.test.js`, `tests/bin-lib/issues/ambiguity-resolve.test.js`

**Interfaces:**
- Consumes: `fencedLineMask`, `findHeadingLine`, `headingLine` (Task 1).
- Produces: `authoredRegion(text: string) -> string` — `text` up to (not including) the first unfenced level-2 `Original request` heading line, or all of `text` when none. Split with `text.split(/(\r\n|\r|\n)/)` keeping separators (as `unfencedText` does), find the line index with `findHeadingLine(lines, 'Original request', { levelPattern: '2' })`, return `parts.slice(0, idx * 2).join('')`.

- [ ] **Step 1: Write the failing tests**

materialize-format.test.js:
```js
test('AC3.2: shapeGate — a fenced ## Original request is not the placeholder boundary (intended change, #4561)', () => {
  const body = SHAPED_BODY + '\n\n```markdown\n## Original request\n```\n\nTODO: a real authored marker';
  assert.deepEqual(shapeGate(body), { ok: false, missing: ['unresolved-placeholder'] });
});
test('AC3.2: authoredRegion stops at the first unfenced ## Original request, CRLF included (#4561)', () => {
  const lf = 'a\n```\n## Original request\n```\nb\n## Original request\nc';
  assert.equal(authoredRegion(lf), 'a\n```\n## Original request\n```\nb\n');
  assert.equal(authoredRegion(lf.replace(/\n/g, '\r\n')), 'a\r\n```\r\n## Original request\r\n```\r\nb\r\n');
  assert.equal(authoredRegion('no boundary'), 'no boundary');
});
```
compose.test.js:
```js
test('AC3.2: validateShaped flags a marker after a fenced ## Original request, agreeing with shapeGate (#4561)', () => {
  const body = SHAPED + '\n\n```\n## Original request\n```\n\nTBD';
  assert.equal(validateShaped(body).ok, false);
  assert.ok(validateShaped(body).gaps.includes('unresolved placeholder marker: TBD'));
  assert.equal(shapeGate(body).ok, false);
});
```
ambiguity-resolve.test.js (use that file's existing `shaped(...)` helper and exports):
```js
test('AC3.2: a fenced ## Original request does not hide a later ambiguity marker (#4561)', () => {
  const body = `${shaped('x')}\n\n\`\`\`\n## Original request\n\`\`\`\n\n<!-- ambiguity: open -->`;
  assert.equal(countAmbiguityMarkers(body), 1);
});
test('dropEmptyOpenQuestions ignores an Open Questions heading inside a fence; a CRLF heading still matches (#4561)', () => {
  const fenced = 'A\n\n```\n## Open Questions\n\n| Q | A |\n|---|---|\n```\n';
  assert.deepEqual(dropEmptyOpenQuestions(fenced), { body: fenced, removed: false });
  const crlf = 'A\r\n\r\n## Open Questions\r\n\r\n| Q | A |\r\n|---|---|\r\n';
  assert.equal(dropEmptyOpenQuestions(crlf).removed, true);
});
```
(If `dropEmptyOpenQuestions` is not exported, add it to `module.exports`.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/issues/materialize-format.test.js tests/bin-lib/compose-record/compose.test.js tests/bin-lib/issues/ambiguity-resolve.test.js`
Expected: FAIL after Step 1 — `authoredRegion` is not a function; the fenced-boundary tests fail (old regex is fence-blind); the fenced Open Questions case returns `removed: true`.

- [ ] **Step 3: Implement** as described in Files/Interfaces. `grep -rn ORIGINAL_REQUEST_RE plugin tests` must then print only `tests/bin-lib/compose-record/compose.test.js`'s absence pin.

- [ ] **Step 4: Run** the three suites plus `tests/bin-lib/release-note-repair/detect.test.js tests/dispatch-not-spec-shaped-exclusion-fixture.test.js` — Expected: PASS, no existing test edited.

- [ ] **Step 5: Commit** — `Retire ORIGINAL_REQUEST_RE for authoredRegion — the Original request boundary is the first unfenced heading; refs #4561`

### Task 4: compose.js splitSections on the shared reader

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/compose-record/compose.js:19-38` (CRLF-normalize, `fencedLineMask(lines)`, a line is a section heading when unfenced and `headingLine(line)` is level 2; keys are `headingLine(...).text`; content accumulation and final trim unchanged)
- Modify: `.claude/skills/shared-contract-extraction/SKILL.md:84` — the sentence "`splitSections` is still separate." becomes "#4561 then routed `splitSections` through the shared reader (`headingLine`)." (behavior-change prose sweep; no other prose names it — `git grep -n splitSections -- plugin docs .claude` lists only this line plus the unrelated `init/claude-md-conformance.js` twin)
- Test: `tests/bin-lib/compose-record/compose.test.js`

**Interfaces:**
- Consumes: `headingLine`, `fencedLineMask` (Task 1), `sectionText` (materialize-format).

- [ ] **Step 1: Write the failing test**

```js
test('AC2.1: splitSections ignores a heading inside a fence and agrees with sectionText (#4561)', () => {
  const body = '## Current State\n\nx\n\n```markdown\n## Release Note\nquoted\n```\n\n## Deliverables\n\ny';
  const sections = splitSections(body);
  assert.deepEqual(Object.keys(sections), ['Current State', 'Deliverables']);
  for (const [name, content] of Object.entries(sections)) assert.equal(content, sectionText(body, name));
  assert.equal(sectionText(body, 'Release Note'), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/compose-record/compose.test.js`
Expected: FAIL after Step 1 (`Release Note` key present).

- [ ] **Step 3: Implement** as in Files; update the function's comment (fenced headings are quoted content; one rule with `findSection`).

- [ ] **Step 4: Run** `node --test tests/bin-lib/compose-record/compose.test.js tests/bin-lib/compose-record/cli.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** — `Route compose-record's splitSections through the shared heading reader — fenced headings are quoted content; refs #4561`

### Task 5: release-note-repair apply.js on the shared rule, plus the no-own-regex pin

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/release-note-repair/apply.js` (lines 1-95 and 99-113) — delete `AC_HEADING`, `RN_HEADING`, `ORIGINAL_REQUEST`, `H2`, `FENCE_OPEN`, `FENCE_CLOSE`, `fenceInfo` and their comment; header comment updated (fence rule now the shared CommonMark one, #4561).
- Create: `tests/bin-lib/issues/shared-heading-rule.test.js`
- Test: `tests/bin-lib/release-note-repair/apply.test.js`, `tests/bin-lib/release-note-repair/fixtures.js` (comment on `AC_INDENTED_FENCE` only: it now passes under the shared 0-3-space rule)

**Interfaces:**
- Consumes: `headingLine`, `findHeadingLine`, `scanFences`, `fencedLineMask` (Task 1).
- `applyReleaseNote` algorithm (bodies are `splitKeepingEol` lines; `bareLines = lines.map(bare)`):
  1. `fenced = fencedLineMask(bareLines)`; `originalAt = findHeadingLine(bareLines, 'Original request', { levelPattern: '2', fenced })`; `authoredEnd = originalAt === -1 ? lines.length : originalAt`.
  2. `{ ranges, unclosed } = scanFences(bareLines)`; throw `RepairError('an unterminated fenced code block precedes the insert point')` when `unclosed && ranges[ranges.length - 1][0] < authoredEnd` (a fence that opens after the boundary never refuses).
  3. `isH2(k) = !fenced[k] && headingLine(bareLines[k])?.level === 2`; `nextH2` uses it. RN and AC lookups: `findHeadingLine(bareLines.slice(0, authoredEnd), 'Release Note' | 'Acceptance Criteria', { levelPattern: '2', fenced: fenced.slice(0, authoredEnd) })`.
  4. `onlyReleaseNoteAdded`: the two `RN_HEADING.test(x)` checks become `isReleaseNoteHeading(x)` = `headingLine(x)` level 2 with text `Release Note`.

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/issues/shared-heading-rule.test.js`:
```js
// AC1.1/AC1.2: no record-body reader keeps its own heading or fence regex; each requires the shared rule.
const OWN_RULE_RE = /\/\^\(?\\?#|`\{3|~\{3/; // a regex literal anchored on '#', or a fence-run quantifier
const ownRuleOffenders = (src) => src.split('\n').filter((l) => OWN_RULE_RE.test(l));
test('the matcher flags a planted heading regex and a planted fence regex (go-red control)', () => {
  assert.equal(ownRuleOffenders('const H = /^## Foo/;').length, 1);
  assert.equal(ownRuleOffenders('const F = /^[ \\t]*(`{3,}|~{3,})/;').length, 1);
});
for (const rel of ['release-note-repair/apply.js', 'issues/near-duplicate.js', 'compose-record/compose.js', 'issues/materialize-format.js', 'issues/ambiguity-resolve.js']) {
  test(`AC1.1 AC1.2: ${rel} keeps no heading/fence regex and requires record-payload's shared rule (#4561)`, () => {
    const src = readText(path.join(__dirname, '../../../plugin/bin/lib', rel));
    assert.deepEqual(ownRuleOffenders(src), []);
    assert.match(src, /headingLine|findHeadingLine|findSection|authoredRegion|sectionText/);
  });
}
```
(`materialize-format.js` may reference `/^## /` in `REQUIRED_SECTIONS` handling? It does not — `heading.replace('## ', '')` is a string, not a regex; compose.js's `h.replace(/^## /, '')` at :16 IS matched — rewrite it as `h.slice(3)` in this task, since every `REQUIRED_SECTIONS` entry starts with `## `.)

apply.test.js:
```js
test('AC3.1: a fenced ## Original request is not the boundary — the closed fence no longer reads as unterminated (#4561)', () => {
  const body = `${F.join(F.CS, F.DEL, F.AC)}\n\`\`\`markdown\n## Original request\n\`\`\`\n`;
  const out = applyReleaseNote(body, F.LINE);
  assert.equal(out.mode, 'inserted');
  assert.equal(checkBody(out.body).verdict, 'conforming');
});
test('AC2.1: a Release Note heading only inside a fence is absent — inserted, never filled (#4561)', () => {
  const body = F.join(F.CS, F.DEL, F.AC, '```markdown\n## Release Note\n```\n', F.TA);
  assert.equal(applyReleaseNote(body, F.LINE).mode, 'inserted');
});
test('Deliverable 2: a 4-space-indented ``` is not a fence for the repair writer, as for findSection (#4561)', () => {
  const body = F.join(F.CS, F.DEL, '## Acceptance Criteria\n\n- [ ] x\n\n    ```\n## Example\n    ```\n');
  const out = applyReleaseNote(body, F.LINE);
  assert.ok(out.body.indexOf('## Release Note') < out.body.indexOf('## Example'));
  assert.notEqual(findSection(body, 'Example', { levelPattern: '2' }), null);
});
test('a fence opened after ## Original request and never closed does not refuse the repair (#4561)', () => {
  const body = `${F.join(F.CS, F.DEL, F.AC)}\n## Original request\n\n\`\`\`\nnever closed\n`;
  assert.equal(applyReleaseNote(body, F.LINE).mode, 'inserted');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/issues/shared-heading-rule.test.js tests/bin-lib/release-note-repair/apply.test.js`
Expected: FAIL after Step 1 — `apply.js` (and any task not yet landed) has offenders; the fenced-Original-request case throws `RepairError`; the 4-space case places Release Note after `## Example`.

- [ ] **Step 3: Implement** the algorithm in Interfaces.

- [ ] **Step 4: Run** `node --test tests/bin-lib/issues/shared-heading-rule.test.js tests/bin-lib/release-note-repair/apply.test.js tests/bin-lib/release-note-repair/detect.test.js tests/bin-lib/release-note-repair/cli.test.js tests/tidy-release-note-repair-conformance.test.js` — Expected: PASS; AC4.1: no existing release-note-repair, near-duplicate or compose-record test edited (fixtures.js comment only).

- [ ] **Step 5: Commit** — `Route release-note-repair's apply.js through the shared heading and fence rule — CommonMark 0-3-space fences, fenced Original request is not the boundary; refs #4561`

## AC coverage map

| Clause | Test |
|---|---|
| AC1.1, AC1.2 | Task 5 `shared-heading-rule.test.js` per-module tests |
| AC2.1 | Task 2 (Current State), Task 4 (splitSections), Task 5 (apply.js Release Note) |
| AC3.1 | Task 5 fenced Original request test |
| AC3.2 | Task 3 shapeGate / authoredRegion / validateShaped / ambiguity-resolve tests |
| AC4.1 | Task 1-5 Step 4 runs with no existing test edited |
