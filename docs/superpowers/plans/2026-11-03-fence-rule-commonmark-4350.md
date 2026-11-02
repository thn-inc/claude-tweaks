# Fence rule: share it with release-note repair and report an unclosed fence Implementation Plan

> **For agentic workers:** `/claude-tweaks:build` controls execution; ignore any boilerplate execution choice.

**Goal:** Make `release-note-repair/apply.js` use the one fence rule, name its callers, and have the shape gate report an unclosed fence as its own parse problem instead of as missing sections that are present.

**Architecture:** `plugin/bin/lib/markdown-blocks.js` holds the rule. It gains one read, `unclosedFenceLine(lines)`, and `findSection` gains a pass-through `unclosedAsText` option. `shapeGate` uses them to tell "hidden by an unclosed fence" from "absent". `validateShaped` formats the new entry. `apply.js` deletes its own regexes.

**Tech Stack:** Node, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T232702-record-4350/work/4350-spec.md`

**Premise reversed by a probe at this checkout (dc02e2700):** the spec's Current State says `fencedLineRanges` lives in `issues/record-payload.js` with a column-0 rule. #4368 and #4645 already moved it to `markdown-blocks.js` with `^﻿? {0,3}` openers, ` {0,3}` closers, and the `` (?=[^`]*$) `` backtick-opener rule (`scanFences`, lines 55 and 62). So Deliverable 1 needs no code: this plan only pins AC1 and AC2 at the `sectionText` level. Deliverable 3's comment is at `markdown-blocks.js:38`, not `record-payload.js`.

## Global Constraints

- The new parse problem reads exactly `unclosed-fence at line N`, N the 1-based line of the opener.
- `shapeGate`'s pass/fail verdict does not change for any body: only the contents of `missing` change. A body that passed still passes; one that failed still fails.
- Commit tests only where the repo already keeps them for this kind of change, sized like neighbouring files.
- Commit messages: `{Verb} {what} — {detail}`, `refs #4350`, never `closes`/`fixes`.
- Quoted from `.claude/skills/parse-signal-discipline/SKILL.md`: "**Give "couldn't parse" its own return shape**, distinguishable at the type level from "doesn't apply"" and "**Surface the unparseable case as a warning**, not a silent skip". Here the "shape" is a distinct `missing` entry, since `missing` is what every caller prints.
- `.claude/skills/bin-source-scan-conformance` and `path-guard`: no fs calls are added, so neither scan applies.

## Review Focus

1. A CRLF body with an unclosed fence reports the same line number as its LF twin.
2. An unclosed fence after every required section stays `{ ok: true }` (the existing test at `materialize-format.test.js:168`).
3. A section genuinely absent beside one a fence hides: the absent one stays in `missing`, the hidden one does not.
4. An unclosed fence that hides only `## Release Note` stops reading as `release-note-only`, because `/tidy` cannot repair it and `applyReleaseNote` would refuse it.
5. A 4-space or tab-indented "opener" in a repair body is not a fence, matching the gate. Before this change the two disagreed and the post-check refused.

---

### Task 1: Report an unclosed fence from the shape gate

**Files:**
- Modify: `plugin/bin/lib/markdown-blocks.js`
- Modify: `plugin/bin/lib/issues/materialize-format.js`
- Modify: `plugin/bin/lib/compose-record/compose.js`
- Modify: `plugin/skills/dispatch/not-spec-shaped-exclusion-report.md:18`
- Modify: `plugin/skills/flow/materialize.md` (the Materialization hard gate section)
- Test: `tests/bin-lib/issues/materialize-format.test.js`
- Test: `tests/bin-lib/compose-record/compose.test.js`
- Test: `tests/bin-lib/markdown-blocks.test.js:16` (export pin gains `unclosedFenceLine`)
- Test: `tests/bin-lib/release-note-repair/detect.test.js`

**Interfaces:**
- Produces: `unclosedFenceLine(lines: string[]) -> number` in `markdown-blocks.js`: 0-based index of the trailing unclosed fence's opener, `-1` when none. Implement from `scanFences`' `ranges`/`unclosed`.
- Produces: `findSection(body, heading, { ..., unclosedAsText = false })`, passed to `fencedLineMask`.
- Produces: `UNCLOSED_FENCE_PREFIX = 'unclosed-fence at line '`, exported by `materialize-format.js`, read by `compose.js`.

- [ ] **Step 1: Append the failing tests** to `tests/bin-lib/issues/materialize-format.test.js`, beside the #4169 block:

```js
const HIDDEN = '## Current State\nx\n\n```\nnever closed\n\n## Deliverables\n- [ ] d\n\n## Acceptance Criteria\n1. a\n\n## Release Note\nn';

test('AC1.1: a column-0 fence closed by a closer indented 1-3 spaces ends at that closer', () => {
  for (const pad of [' ', '  ', '   ']) {
    const body = `## Current State\nx\n\n\`\`\`\ncode\n${pad}\`\`\`\n\n## Deliverables\n- [ ] d`;
    assert.equal(sectionText(body, 'Deliverables'), '- [ ] d');
  }
});

test('AC2.1: a line starting with a triple-backtick inline span does not open a fence', () => {
  const body = '## Current State\n```foo``` is the command\n\n## Deliverables\n- [ ] d';
  assert.equal(sectionText(body, 'Deliverables'), '- [ ] d');
});

test('shapeGate: an unclosed fence before required sections reports the fence, not the sections it hides (#4350)', () => {
  assert.deepEqual(shapeGate(HIDDEN), { ok: false, missing: ['unclosed-fence at line 4'] });
});

test('shapeGate: a CRLF body reports the same line (#4350)', () => {
  assert.deepEqual(shapeGate(HIDDEN.replace(/\n/g, '\r\n')), { ok: false, missing: ['unclosed-fence at line 4'] });
});

test('shapeGate: a section absent beside a hidden one stays missing (#4350)', () => {
  const body = HIDDEN.replace('## Release Note\nn', '');
  assert.deepEqual(shapeGate(body), { ok: false, missing: ['Release Note', 'unclosed-fence at line 4'] });
});
```

In `compose.test.js`: `validateShaped(HIDDEN-shaped body).gaps` deep-equals `['unclosed-fence at line 4']`. In `detect.test.js`: a real `checkBody` on a body whose unclosed fence sits inside `## Acceptance Criteria` above a real `## Release Note` returns verdict `other-gaps`, gaps `['unclosed-fence at line N']`.

- [ ] **Step 2: Run to verify the three `shapeGate` tests fail**

Run: `node --test tests/bin-lib/issues/materialize-format.test.js`
Expected: FAIL naming `missing: ['Deliverables', 'Acceptance Criteria', 'Release Note']`. AC1.1 and AC2.1 already PASS, since #4368 shipped the rule; they pin it.

- [ ] **Step 3: Implement.** In `shapeGate`: normalize CRLF for the line count, then for each required section, when `sectionText` is null and `findSection(text, name, { levelPattern: '2', stopPattern: '2', trim: true, unclosedAsText: true })` is not null, note it as hidden instead of pushing the name. After the loop, if any is hidden, push `` `${UNCLOSED_FENCE_PREFIX}${unclosedFenceLine(lines) + 1}` ``, before the placeholder check. Update the `shapeGate` comment. In `validateShaped`, push every `missing` entry starting with the prefix between the section gaps and the marker gaps, and update its order comment. A rejected opener is not a fence, so it hides nothing and gets no report: AC2 covers it. Logged as a spec reading in `decisions.md`.

Prose: in `not-spec-shaped-exclusion-report.md:18` add `` `unclosed-fence at line N` `` to the list that gets `/claude-tweaks:specify`. In `materialize.md`'s hard gate, one sentence: a section an unclosed fence hides is reported as `unclosed-fence at line N`, not as missing.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/issues/materialize-format.test.js tests/bin-lib/compose-record/compose.test.js tests/bin-lib/markdown-blocks.test.js tests/bin-lib/release-note-repair/detect.test.js tests/dispatch-not-spec-shaped-exclusion-fixture.test.js`
Expected: PASS

- [ ] **Step 5: Prove the guard.** Delete the `unclosedAsText` branch so hidden sections fall through to `missing`: the three new `shapeGate` tests go red. Restore.

- [ ] **Step 6: Commit** by explicit path, `Report an unclosed fence from the shape gate — hidden sections are no longer called missing, refs #4350`.

### Task 2: Share the fence rule with release-note repair

**Files:**
- Modify: `plugin/bin/lib/release-note-repair/apply.js`
- Modify: `plugin/bin/lib/markdown-blocks.js` (the "one fence rule shared by" comment, lines 38-49)
- Modify: `docs/plugin-structure.md:79`
- Test: `tests/bin-lib/release-note-repair/apply.test.js`

**Interfaces:**
- Consumes: `fencedLineMask(lines)`, `unclosedFenceLine(lines)` from Task 1.

- [ ] **Step 1: Append the failing tests** to `tests/bin-lib/release-note-repair/apply.test.js`

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
    assert.equal(checkBody(out.body).verdict, 'conforming');
    assert.ok(out.body.indexOf('## Release Note') < out.body.indexOf('## Technical Approach'));
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/release-note-repair/apply.test.js`
Expected: FAIL, thrown `RepairError` "an unterminated fenced code block precedes the insert point".

- [ ] **Step 3: Implement.** Delete `FENCE_OPEN`, `FENCE_CLOSE` and their comment. `fenceInfo(authoredLines)` maps `bare` over the lines and returns `{ inFence: fencedLineMask(b), unterminated: unclosedFenceLine(b) !== -1 }`. Name `applyReleaseNote` (via `fenceInfo`) and `shapeGate`'s unclosed report in the shared-rule comment, and `findSection`, in `docs/plugin-structure.md:79`.

- [ ] **Step 4: Run to verify they pass, existing fixtures included**

Run: `node --test tests/bin-lib/release-note-repair/apply.test.js tests/bin-lib/release-note-repair/cli.test.js tests/bin-lib/release-note-repair/detect.test.js`
Expected: PASS (`AC_INDENTED_FENCE` has a 2-space opener and closer, inside the shared rule's 0-3).

- [ ] **Step 5: Commit** by explicit path, `Share the fence rule with release-note repair — one reader of fences, so gate and repair cannot disagree, refs #4350`.

Waived AC3.1: the full `npm test` runs at Common Step 5 through `verify.js`, not as a task test.
Waived plugin/bin/lib/issues/record-payload.js: the spec names it from before #4645 moved the rule; nothing there changes, and Task 2's comment edit lands in markdown-blocks.js instead.
