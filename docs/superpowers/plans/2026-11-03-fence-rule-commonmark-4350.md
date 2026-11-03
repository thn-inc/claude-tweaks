# Unclosed-fence report and one fence rule for release-note repair — Implementation Plan

> **For agentic workers:** `/claude-tweaks:build` controls execution; ignore any boilerplate execution choice.

**Goal:** When an unclosed code fence hides a required section, every surface that tells an author a section is missing (the shape gate and its callers, and both `compose-subject.js` refusals) names the fence instead. `release-note-repair/apply.js` reads fences through the one shared rule, and that rule's comment lists every caller, found by grep.

**Architecture:** `plugin/bin/lib/markdown-blocks.js` holds the fence rule. It gains `unclosedFenceLine(lines)` and `hiddenByUnclosedFence(body, heading, options)`, the one hidden-section test, and `findSection` passes a new `unclosedAsText` option through to `fencedLineMask`. `shapeGate` and `compose-subject.js` call the helper. `validateShaped` prints the new `missing` entry as a gap. `apply.js` drops its own fence regexes for `fencedLineMask` + `unclosedFenceLine`.

**Tech Stack:** Node, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T135011-record-4350/work/4350-spec.md`. Its `## Plan-review answers (2026-11-03)` section is binding.

**Premise reversed (spec Current State vs this checkout):** `fencedLineRanges` no longer lives in `issues/record-payload.js` with a column-0 rule. #4368/#4369 shipped the 0-3-space and backtick-info-string rules, and #4645 moved the rule into `markdown-blocks.js` (`scanFences`, lines 50-71). Plan-review answer 3 drops Deliverable 1. AC1 and AC2 become pin tests at the `sectionText` level, and they already pass.

## Global Constraints

- The parse problem reads exactly `unclosed-fence at line N`. N is the 1-based line where `scanFences` opened the trailing unclosed fence, counted on the split `findSection` uses (`body.replace(/\r\n/g, '\n').split('\n')`), so a CRLF body and its LF twin give the same N (answer 1).
- A section is hidden only when `findSection` returns `null` under the normal rule and non-null with `unclosedAsText: true`. A section that is present but empty is never "hidden", even with an unclosed fence elsewhere in the body.
- A rejected opener (a backtick run with a backtick later on the same line) is prose. It gets no report and no warning (answer 1).
- `shapeGate`'s pass/fail verdict does not change for any body. Only the contents of `missing` change.
- In scope: `shapeGate` and everything that goes through it, plus `compose-subject.js`'s `## Release Note` and `## Breaking Change` refusals (answer 2). Out of scope: silent readers (`grouping.js` Key Files, `decomposition-crossref.js`, `compose-subject.js`'s summary fallback). A backlog record for them is filed at wrap-up (ledger row; `Defer-reason: genuinely-larger`).
- `markdown-blocks.js` stays a leaf: it requires nothing (`tests/bin-lib/markdown-blocks.test.js:9`). Its export-key pin gains the two new names.
- Quoted from `.claude/skills/parse-signal-discipline/SKILL.md`: "**Give "couldn't parse" its own return shape**, distinguishable at the type level from "doesn't apply"" and "**Surface the unparseable case as a warning**, not a silent skip". Here, the distinct shape is its own `missing` entry or refusal line, because that is what every caller prints.
- Quoted from `.claude/skills/lib-module-split/SKILL.md` (markdown-blocks.js): "**Migrate every importer, found by symbol.** Grep each moved symbol name, not the old path, across `plugin` and `tests`." It applies to Deliverable 3's caller list (answer 4: build the list by grep, not by hand).
- `.claude/skills/gh-api-module-pattern` (compose-subject.js): no new exit code. A hidden-section refusal stays exit 1, like the refusal it replaces ("a domain outcome no caller can act on differently stays on the base code"). No new `gh`/`git` call is added.
- Commit only tests sized like their neighbours. Commit messages use `{Verb} {what} — {detail}`, `refs #4350`, never `closes`/`fixes`.
- Prose headroom: `plugin/skills/flow/materialize.md` is 40,338 B against `RAIL_BYTES` 52,500, so a one-sentence addition fits.

## Review Focus

1. A CRLF body with an unclosed fence reports the same line as its LF twin (Task 2 test).
2. An unclosed fence after every required section stays `{ ok: true }`: the existing test at `materialize-format.test.js:168` must stay green unchanged.
3. A section that is truly absent next to one the fence hides: the absent one stays in `missing` by name, and the hidden one is replaced by the single fence entry (Task 2 test).
4. A record whose unclosed fence hides only `## Release Note` must not read as `release-note-only`, which would send `/tidy` to repair a body `applyReleaseNote` refuses. Its gap list carries the fence entry, so the verdict is `other-gaps` (Task 3 detect test).
5. A 4-space or tab-indented "opener" in a repair body is not a fence, which matches the gate. Before this change the two disagreed and the post-check refused (Task 5 test).

---

### Task 1: The hidden-section helper in markdown-blocks.js

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/markdown-blocks.js` (`findSection` at line 127, exports at line 151, header comment lines 1-10)
- Test: `tests/bin-lib/markdown-blocks.test.js` (export-key pin at line 16, plus new tests appended)

**Interfaces:**
- Produces: `unclosedFenceLine(lines: string[]) -> number`. Returns the 0-based index of the trailing unclosed fence's opener, or `-1` when every fence closes. Read it from `scanFences(lines)`: `unclosed ? ranges[ranges.length - 1][0] : -1`.
- Produces: `findSection(body, heading, { levelPattern, stopPattern, trim, unclosedAsText = false })`, where `unclosedAsText` is passed straight to `fencedLineMask(lines, { unclosedAsText })`.
- Produces: `hiddenByUnclosedFence(body: string, heading: string, options?: object) -> number | null`. Returns the 1-based opener line N when `findSection(body, heading, options)` is `null` and `findSection(body, heading, { ...options, unclosedAsText: true })` is not. Returns `null` otherwise, including for a non-string body. N is `unclosedFenceLine` + 1, computed over the CRLF-normalized `\n` split.

- [ ] **Step 1: Append the failing tests** to `tests/bin-lib/markdown-blocks.test.js`, and change line 16's expected key list to include `'hiddenByUnclosedFence'` and `'unclosedFenceLine'`, in sorted order.

```js
const { hiddenByUnclosedFence, unclosedFenceLine, findSection } = require(FILE);
const H2 = { levelPattern: '2', stopPattern: '2', trim: true };
const HIDING = '## Current State\nx\n\n```\nnever closed\n\n## Deliverables\n- [ ] d';

test('unclosedFenceLine: 0-based index of a trailing unclosed opener, -1 when every fence closes (#4350)', () => {
  assert.strictEqual(unclosedFenceLine(HIDING.split('\n')), 3);
  assert.strictEqual(unclosedFenceLine(['```', 'a', '```', 'b']), -1);
  assert.strictEqual(unclosedFenceLine(['```', 'a', '```', '~~~', 'b']), 3);
});

test('findSection: unclosedAsText reads a trailing unclosed fence as prose (#4350)', () => {
  assert.strictEqual(findSection(HIDING, 'Deliverables', H2), null);
  assert.strictEqual(findSection(HIDING, 'Deliverables', { ...H2, unclosedAsText: true }), '- [ ] d');
});

test('hiddenByUnclosedFence: 1-based opener line for a hidden heading; the CRLF twin gives the same line (#4350)', () => {
  assert.strictEqual(hiddenByUnclosedFence(HIDING, 'Deliverables', H2), 4);
  assert.strictEqual(hiddenByUnclosedFence(HIDING.replace(/\n/g, '\r\n'), 'Deliverables', H2), 4);
});

test('hiddenByUnclosedFence: null for a found, absent, or present-but-empty heading, and a non-string body (#4350)', () => {
  assert.strictEqual(hiddenByUnclosedFence(HIDING, 'Current State', H2), null);
  assert.strictEqual(hiddenByUnclosedFence(HIDING, 'Release Note', H2), null);
  assert.strictEqual(hiddenByUnclosedFence('## Release Note\n\n## Deliverables\n```\nx', 'Release Note', H2), null);
  assert.strictEqual(hiddenByUnclosedFence(undefined, 'Release Note', H2), null);
});

test('hiddenByUnclosedFence: a rejected backtick opener is prose, so it hides nothing (#4350)', () => {
  assert.strictEqual(hiddenByUnclosedFence('## Current State\n```foo``` is the command\n\n## Deliverables\n- [ ] d', 'Deliverables', H2), null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/markdown-blocks.test.js`
Expected: FAIL. The key-list pin fails, and `unclosedFenceLine is not a function`.

- [ ] **Step 3: Implement** the three Interfaces items in `markdown-blocks.js`. Add one sentence each to the `findSection` doc comment (`unclosedAsText`) and the header comment (the new exports). Keep the module free of `require`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/markdown-blocks.test.js tests/bin-lib/issues/materialize-format.test.js`
Expected: PASS

- [ ] **Step 5: Commit** both files by explicit path: `Add the hidden-by-unclosed-fence test to markdown-blocks — one reading shared by gate and composer, refs #4350`.

### Task 2: The shape gate reports an unclosed fence, not the sections it hides

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/materialize-format.js` (`shapeGate`, lines 84-102)
- Modify: `plugin/skills/flow/materialize.md` (the `## Materialization hard gate` section, line 53)
- Test: `tests/bin-lib/issues/materialize-format.test.js`
- No change, checked: `materialize.js:426` prints `gate.missing` joined, so it shows the new entry as is. `express/eligibility.js:120` and `ambiguity-resolve.js:49` read only `.ok`, which does not change. `validateShaped` and its consumers are Task 3.

**Interfaces:**
- Consumes: `hiddenByUnclosedFence(body, heading, options)` (Task 1).
- Produces: `UNCLOSED_FENCE_PREFIX = 'unclosed-fence at line '`, exported by `materialize-format.js`. A `shapeGate` `missing` entry `` `${UNCLOSED_FENCE_PREFIX}${N}` `` appears at most once, after the section names and before `'unresolved-placeholder'`.

- [ ] **Step 1: Append the failing tests.** Add these to `materialize-format.test.js`, after the `#4368` test at the end of the file. AC1.1 and AC2.1 pin rules that already shipped and pass at once.

```js
const HIDDEN = '## Current State\nx\n\n```\nnever closed\n\n## Deliverables\n- [ ] d\n\n## Acceptance Criteria\n1. a\n\n## Release Note\nn';

test('AC1.1: a column-0 fence closed by a closer indented 1-3 spaces ends at that closer (#4350)', () => {
  for (const pad of [' ', '  ', '   ']) {
    const body = `## Current State\nx\n\n\`\`\`\ncode\n${pad}\`\`\`\n\n## Deliverables\n- [ ] d`;
    assert.equal(sectionText(body, 'Deliverables'), '- [ ] d', `pad ${pad.length}`);
  }
});

test('AC2.1: a line starting with a triple-backtick inline span does not open a fence (#4350)', () => {
  assert.equal(sectionText('## Current State\n```foo``` is the command\n\n## Deliverables\n- [ ] d', 'Deliverables'), '- [ ] d');
});

test('shapeGate: an unclosed fence before required sections reports the fence, not the sections it hides (#4350)', () => {
  assert.deepEqual(shapeGate(HIDDEN), { ok: false, missing: ['unclosed-fence at line 4'] });
});

test('shapeGate: a CRLF body reports the same line (#4350)', () => {
  assert.deepEqual(shapeGate(HIDDEN.replace(/\n/g, '\r\n')), { ok: false, missing: ['unclosed-fence at line 4'] });
});

test('shapeGate: a section absent beside a hidden one stays missing by name (#4350)', () => {
  assert.deepEqual(shapeGate(HIDDEN.replace('\n\n## Release Note\nn', '')), { ok: false, missing: ['Release Note', 'unclosed-fence at line 4'] });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/issues/materialize-format.test.js`
Expected: FAIL after Step 1. The `shapeGate` tests show `missing: ['Deliverables', 'Acceptance Criteria', 'Release Note']`. The AC1.1/AC2.1 pins pass.

- [ ] **Step 3: Implement.** In `shapeGate`, a section that `sectionText` returns `null` for goes through `hiddenByUnclosedFence(text, name, { levelPattern: '2', stopPattern: '2', trim: true })`. When that gives a line, record it and do not push the name. After the loop, push the prefixed entry once if a line was recorded. An empty section is pushed by name exactly as today. Update `shapeGate`'s doc comment to name the new entry. In `materialize.md`'s hard gate, add one sentence after the first paragraph: a required section an unclosed fence hides is reported as `unclosed-fence at line N` (close the fence), not as missing.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/issues/materialize-format.test.js tests/bin-lib/express tests/bin-lib/issues/ambiguity-resolve.test.js`
Expected: PASS

- [ ] **Step 5: Prove the guard.** Temporarily make the hidden branch push the name, as before. The three new `shapeGate` tests go red. Restore the branch.

- [ ] **Step 6: Commit** the three files by explicit path: `Report an unclosed fence from the shape gate — hidden sections are no longer called missing, refs #4350`.

### Task 3: validateShaped prints the fence gap; tidy's Release-Note-only verdict does not claim it

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/compose-record/compose.js` (`validateShaped`, lines 40-63)
- Modify: `plugin/skills/dispatch/not-spec-shaped-exclusion-report.md` (the Remedy selection paragraph)
- Test: `tests/bin-lib/compose-record/compose.test.js`, `tests/bin-lib/release-note-repair/detect.test.js`
- No change, checked: `detect.js`'s `classifyCheckResult` reads `validateShaped`'s gap lines through `compose-record.js --check`. A gap list holding the fence entry is not one of `RELEASE_NOTE_GAPS`, so it classifies as `other-gaps` with no code change.

**Interfaces:**
- Consumes: `UNCLOSED_FENCE_PREFIX` and `shapeGate`'s new `missing` entry (Task 2).

- [ ] **Step 1: Append the failing tests.** In `tests/bin-lib/compose-record/compose.test.js`, add one test: `validateShaped` on Task 2's `HIDDEN` body (copy the literal) returns `{ ok: false, gaps: ['unclosed-fence at line 4'] }`. In `tests/bin-lib/release-note-repair/detect.test.js`, add one test that runs the real `checkBody` (the default in-process CLI) on `F.join(F.CS, F.DEL, '## Acceptance Criteria\n\n- [ ] a\n\n```\nnever closed\n', F.RN)`. That fence opens on line 13 of the joined body (measured: `fixtures.join` adds a blank line between parts), so assert the verdict is `'other-gaps'` and the gaps are exactly `['unclosed-fence at line 13']`. This test pins Review Focus 4.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/compose-record/compose.test.js tests/bin-lib/release-note-repair/detect.test.js`
Expected: FAIL after Step 1. `validateShaped` returns `gaps: []` with `ok: false`, because the entry is not yet formatted.

- [ ] **Step 3: Implement.** In `validateShaped`, push every `missing` entry that starts with `UNCLOSED_FENCE_PREFIX` verbatim, after the section gaps and before the marker gaps, and update its order comment. In `not-spec-shaped-exclusion-report.md`'s Remedy selection, add `` `unclosed-fence at line N` `` to the list of `missing` sets that get `/claude-tweaks:specify`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/compose-record/compose.test.js tests/bin-lib/compose-record/cli.test.js tests/bin-lib/release-note-repair/detect.test.js tests/dispatch-not-spec-shaped-exclusion-fixture.test.js`
Expected: PASS

- [ ] **Step 5: Commit** the four files by explicit path: `Print the unclosed-fence gap from validateShaped — tidy no longer reads a hidden Release Note as repairable, refs #4350`.

### Task 4: compose-subject names the unclosed fence in both refusals

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/compose-subject.js` (the refusals at lines 336-346; requires at lines 64-73)
- Modify: `docs/plugin-structure.md:65` (the compose-subject.js row) and `:232` (its CLI line, exit 1 clause)
- Test: `tests/bin-lib/compose-subject.test.js`

**Interfaces:**
- Consumes: `hiddenByUnclosedFence(body, heading, options)` (Task 1), required straight from `./markdown-blocks`, with options `{ levelPattern: '2', stopPattern: '2', trim: true }` (this file's own `extractSection` shape).
- Produces: two stderr lines, each still exit 1, emitted only for records whose section is hidden. Records whose section is absent or empty for any other reason keep today's message byte for byte, and both lines print when both kinds occur:
  - `compose-subject.js: record(s) #A (unclosed-fence at line N)[, #B (unclosed-fence at line M)] hide their "## Release Note" section behind an unclosed code fence — close the fence\n`
  - `compose-subject.js: breaking is set on #A (unclosed-fence at line N)[, …] but an unclosed code fence hides the "## Breaking Change" section — close the fence\n`

- [ ] **Step 1: Append the failing tests.** Add three records to `RECORDS`:
  - `2280`: a `type:task` record with body `'## Overview\n\nFenced.\n\n```\nnever closed\n\n## Release Note\n\nHidden note.\n'`.
  - `2281`: a `type:feature` record with the `breaking` label and body `'## Overview\n\nB.\n\n```\nopen\n\n## Breaking Change\n\nUse --new.\n\n## Release Note\n\nNote.\n'`.
  - `2282`: like `2280`, but with `## Release Note` absent from the body entirely.

```js
test('exit 1: a Release Note hidden by an unclosed fence is named as the fence, not as missing (#4350)', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2280'], deps), 1);
  assert.equal(out.stderr, 'compose-subject.js: record(s) #2280 (unclosed-fence at line 5) hide their "## Release Note" section behind an unclosed code fence — close the fence\n');
  assert.equal(out.stdout, '');
});

test('exit 1: a Breaking Change hidden by an unclosed fence is named as the fence (#4350)', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2281'], deps), 1);
  assert.match(out.stderr, /^compose-subject\.js: breaking is set on #2281 \(unclosed-fence at line 5\) but an unclosed code fence hides the "## Breaking Change" section — close the fence\n/);
});

test('exit 1: an unclosed fence with no Release Note heading behind it keeps the missing-section message (#4350)', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2282'], deps), 1);
  assert.match(out.stderr, /record\(s\) #2282 carry no non-empty "## Release Note" section/);
  assert.doesNotMatch(out.stderr, /unclosed-fence/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/compose-subject.test.js`
Expected: FAIL after Step 1. The first two tests get the `carry no non-empty` / `carries no non-empty` messages instead.

- [ ] **Step 3: Implement.** For each refusal, split its failing records into hidden (the helper returns a line) and the rest. Print today's message for the rest, only when non-empty. Print the hidden line, only when non-empty. Return 1 when either group is non-empty. The Release Note group stays the records where `releaseNoteOf` is empty. Note the gap in the header comment's exit-1 list. In `docs/plugin-structure.md`, append the unclosed-fence naming to the `missing/empty refuses with exit 1, #2580` clause on line 65 and to the exit 1 clause on line 232.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/compose-subject.test.js tests/merge-subject-composer-conformance.test.js`
Expected: PASS. The existing AC3.1 and `2290`/`2271` message tests stay green unchanged.

- [ ] **Step 5: Commit** by explicit path: `Name the unclosed fence in compose-subject's refusals — a hidden Release Note or Breaking Change is not called missing, refs #4350`.

### Task 5: Release-note repair reads fences through the shared rule; the rule names its callers

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/release-note-repair/apply.js` (lines 17-57: `FENCE_OPEN`, `FENCE_CLOSE`, `fenceInfo`)
- Modify: `plugin/bin/lib/markdown-blocks.js` (the "one fence rule shared by" comment, lines 38-49)
- Modify: `docs/plugin-structure.md:79` (the markdown-blocks.js row) and `:50` (apply.js reads fences through markdown-blocks.js)
- Test: `tests/bin-lib/release-note-repair/apply.test.js`

**Interfaces:**
- Consumes: `fencedLineMask(lines)` and `unclosedFenceLine(lines)` (Task 1), required by `apply.js` from `../markdown-blocks`.

- [ ] **Step 1: Append the failing tests** to `apply.test.js`:

```js
test('applyReleaseNote reads a backtick opener with a backtick in its info string as prose, as the gate does (#4350)', () => {
  const body = F.join(F.CS, F.DEL, F.AC, '```foo``` is the command\n', F.TA);
  const out = applyReleaseNote(body, F.LINE);
  assert.equal(checkBody(out.body).verdict, 'conforming');
  assert.ok(out.body.indexOf('## Release Note') < out.body.indexOf('## Technical Approach'));
});

test('applyReleaseNote reads a 4-space or tab "opener" as no fence, as the gate does (#4350)', () => {
  for (const pad of ['    ', '\t']) {
    const body = F.join(F.CS, F.DEL, F.AC, `${pad}\`\`\`\n`, F.TA);
    const out = applyReleaseNote(body, F.LINE);
    assert.equal(checkBody(out.body).verdict, 'conforming', JSON.stringify(pad));
    assert.ok(out.body.indexOf('## Release Note') < out.body.indexOf('## Technical Approach'));
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/release-note-repair/apply.test.js`
Expected: FAIL after Step 1, with a thrown `RepairError`, "an unterminated fenced code block precedes the insert point".

- [ ] **Step 3: Implement.** Delete `FENCE_OPEN`, `FENCE_CLOSE` and their comment. `fenceInfo(authoredLines)` maps `bare` over the lines and returns `{ inFence: fencedLineMask(b), unterminated: unclosedFenceLine(b) !== -1 }`. Rewrite its doc comment to say it delegates to the shared rule.

Caller list (Deliverable 3, answer 4). Build it by running `git grep -n -E "fencedLineRanges|fencedLineMask|unfencedText|unclosedFenceLine|hiddenByUnclosedFence|findSection|extractSection|sectionText" -- plugin/bin`, then follow each hit to the named function that reads fences. Rewrite the comment at `markdown-blocks.js:38` to name every one. It must include:
  - `recordPayload`'s Defer-reason read (`record-payload.js:116`, via `unfencedText`)
  - `applyReleaseNote` (via `fenceInfo`)
  - `hiddenByUnclosedFence` and its callers `shapeGate` and `compose-subject.js`'s refusals
  - every `findSection`/`extractSection`/`sectionText` consumer the grep shows
  - every caller the current comment already names

Record the grep output in the commit body. Update `docs/plugin-structure.md:79` to the same list and name the two new exports.

- [ ] **Step 4: Run to verify they pass, existing fixtures included**

Run: `node --test tests/bin-lib/release-note-repair/apply.test.js tests/bin-lib/release-note-repair/cli.test.js tests/bin-lib/release-note-repair/detect.test.js tests/bin-lib/markdown-blocks.test.js`
Expected: PASS. `AC_INDENTED_FENCE` has a 2-space opener and closer, inside the shared rule's 0-3, and `UNTERMINATED_FENCE_BODY` still throws.

- [ ] **Step 5: Commit** by explicit path: `Share the fence rule with release-note repair — gate and repair read fences one way, refs #4350`.

Waived AC3.1: the full `npm test` runs at Common Step 5 through `verify.js`, not as a task test.
Waived plugin/bin/lib/issues/record-payload.js: the spec names it from before #4645 moved the rule. Nothing there changes, and answer 4 moves Deliverable 3's comment to `markdown-blocks.js`.
