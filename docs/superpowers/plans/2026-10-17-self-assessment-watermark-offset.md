# Self-Assessment Watermark Offset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Readers of a `mode: "self-assessment"` transcript-judge watermark keep its dedup lists but ignore its byte offset, so the next run re-judges the transcript from the start.

**Architecture:** The fix lives in the two pure helpers in `plugin/bin/lib/transcript-judge/watermark.js` (`isTranscriptUnchanged`, `formatOffsetClause`) so every prose caller inherits it; the shared contract `_shared/transcript-judge.md` documents the exception once and `feedback/session-evaluation.md` cites it. The watermark write is unchanged.

**Tech Stack:** Node 18+ CommonJS, `node --test`, Markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T193944-record-2916/work/2916-spec.md`

Scope keywords: formatOffsetClause, isTranscriptUnchanged

## Global Constraints

- An absent `mode` (pre-#2730 watermarks, dispatched-judge writes) behaves exactly as today.
- `formatOffsetClause`'s literal wording is otherwise unchanged — the exact-literal test at `tests/bin-lib/transcript-judge/watermark.test.js:176` must pass unmodified.
- Do not edit around the hard-wrapped #2730 pins in `tests/transcript-judge-prose.test.js:98-128` (e.g. `mode: "self-assessment"` on the`\npayload`, `treats its absence as the pre-existing dispatched-judge case, never as a new failure\nmode`) — insert new text after them, never re-wrap those lines.
- `reflect` opts out of the self-assessment write, so `plugin/skills/reflect/SKILL.md` is not edited (it cites the shared contract).

## Exact shared text (both tasks must use these literals)

- Prose anchor name: **`Self-assessment watermark exception`**
- Degradation-paragraph sentence (Task 2): `**Readers ignore a self-assessment watermark's byte offset.**` followed by text stating the written `bytesAtDispatch` is `kept for audit only`.
- Rendered offset segment for self-assessment (Task 1): `Evaluate from byte offset 0 (line 1);`

## Review Focus

- A self-assessment watermark whose transcript *shrank* or stayed equal must still dispatch (never skip) — Task 1 test with `currentBytes` 480 and 500.
- A watermark with an unknown `mode` value (e.g. `"something-else"`) keeps today's behavior — Task 1 test.
- A self-assessment watermark with empty/absent `filedRecords`/`dismissedSubjects` still renders `none` segments after the offset-0 prefix — Task 1 test.
- A self-assessment watermark with a non-numeric `bytesAtDispatch` still returns `false` from `isTranscriptUnchanged` (covered by the mode guard order — no extra test needed beyond existing malformed case).
- Prose readers (`session-evaluation.md`) must not restate the exception — Task 2 negative assertion.

---

### Task 1: Mode guard in `watermark.js`

**Files:**
- Modify: `plugin/bin/lib/transcript-judge/watermark.js:1-23` (header comment), `:94-121` (`formatOffsetClause`), `:123-135` (`isTranscriptUnchanged`)
- Test: `tests/bin-lib/transcript-judge/watermark.test.js`

**Interfaces:**
- Produces: `formatOffsetClause({ bytesAtDispatch, line, mode, filedRecords, dismissedSubjects }) -> string`; `isTranscriptUnchanged(watermark, currentBytes) -> boolean` (signature unchanged).

- [ ] **Step 1: Write the failing tests** — append to `tests/bin-lib/transcript-judge/watermark.test.js` (after the existing `formatOffsetClause` and `isTranscriptUnchanged` blocks respectively):

```js
test('AC1.1: isTranscriptUnchanged: a self-assessment watermark never reports unchanged', () => {
  assert.equal(watermark.isTranscriptUnchanged({ bytesAtDispatch: 500, mode: 'self-assessment' }, 500), false);
  assert.equal(watermark.isTranscriptUnchanged({ bytesAtDispatch: 500, mode: 'self-assessment' }, 480), false);
});

test('AC1.2: isTranscriptUnchanged: an unknown mode keeps the byte comparison', () => {
  assert.equal(watermark.isTranscriptUnchanged({ bytesAtDispatch: 500, mode: 'something-else' }, 500), true);
});

test('AC2.1: formatOffsetClause: a self-assessment watermark renders offset 0 (line 1) and keeps both dedup segments', () => {
  const s = watermark.formatOffsetClause({
    bytesAtDispatch: 900, line: 40, mode: 'self-assessment', filedRecords: ['#1'], dismissedSubjects: ['x'],
  });
  assert.ok(s.startsWith('Evaluate from byte offset 0 (line 1);'), s);
  assert.match(s, /these records already exist: #1;/);
  assert.match(s, /«x»/);
});

test('AC2.1: formatOffsetClause: a self-assessment watermark with no dedup lists still renders "none"', () => {
  const s = watermark.formatOffsetClause({ bytesAtDispatch: 900, line: 40, mode: 'self-assessment' });
  assert.ok(s.startsWith('Evaluate from byte offset 0 (line 1); these records already exist: none;'), s);
});
```

The existing `{ bytesAtDispatch: 500 }` cases (AC1.2) and the exact-literal test at `:176` (AC2.2) stay untouched.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/transcript-judge/watermark.test.js`
Expected: FAIL — the two `AC1.1`/`AC2.1` tests fail (`true !== false`; string starts with `Evaluate from byte offset 900 (line 40)`); `AC1.2` passes already (append-shaped control).

- [ ] **Step 3: Implement**
  - `isTranscriptUnchanged`: after the existing null/non-numeric guard, return `false` when `watermark.mode === 'self-assessment'`. Extend its comment: a self-assessment watermark's offset is audit-only (the evaluation saw possibly-compacted conversational context, not the transcript bytes), so the Skip check never skips on one (#2916).
  - `formatOffsetClause`: add a `mode` destructured param; when `mode === 'self-assessment'` render offset `0` and line `1`, otherwise `bytesAtDispatch`/`line` as today. Extend its comment block with one sentence naming this.
  - Header comment: one short paragraph stating readers ignore a `mode: "self-assessment"` watermark's byte offset but honour its dedup lists (#2916).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/transcript-judge/watermark.test.js`
Expected: PASS, all tests (including the unchanged exact-literal test).

- [ ] **Step 5: Prove go-red (AC5.1)** — temporarily delete the `mode === 'self-assessment'` line in `isTranscriptUnchanged`, re-run, confirm `AC1.1` fails; restore. Same for the offset/line substitution in `formatOffsetClause` (confirm both `AC2.1` tests fail); restore. Re-run to PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/transcript-judge/watermark.js tests/bin-lib/transcript-judge/watermark.test.js
git commit -m "Ignore a self-assessment watermark's byte offset in watermark.js — re-judge from start (refs #2916)"
```

### Task 2: Document the exception in the shared contract and cite it from feedback

**Files:**
- Modify: `plugin/skills/_shared/transcript-judge.md` — Skip check (`:86-120`), prompt item 5 (`:149-168`), Degradation "Watermark — narrower than a blanket exclusion" paragraph (`:195-211`)
- Modify: `plugin/skills/feedback/session-evaluation.md` — Skip check (`:41-63`), payload `mode` comment (`:76-79`)
- Test: `tests/transcript-judge-prose.test.js`, `tests/feedback-watermark-prose.test.js`

**Interfaces:**
- Consumes: Task 1's `formatOffsetClause({ ..., mode, ... })` and the mode-guarded `isTranscriptUnchanged`.

Byte budget: `transcript-judge.md` is 16,752 B and `session-evaluation.md` 8,778 B against the shared 51,200 B ceiling; no file-specific pin exists for either (grep of `tests/` for their basenames next to byte bounds found none). Plenty of headroom.

- [ ] **Step 1: Write the failing tests**

In `tests/transcript-judge-prose.test.js`, after the #2730 block (section 3b):

```js
// --- 3c. #2916: readers ignore a self-assessment watermark's byte offset ---

test('AC3.1: transcript-judge.md says readers ignore a self-assessment watermark\'s byte offset', () => {
  assert.match(SHARED, /\*\*Readers ignore a self-assessment watermark's byte offset\.\*\*/);
  assert.match(SHARED, /kept for audit only/);
});

test('AC3.1: transcript-judge.md names the Self-assessment watermark exception in the Skip check and prompt item 5', () => {
  const skip = SHARED.slice(SHARED.indexOf('## Skip check'), SHARED.indexOf('## The judge dispatch'));
  assert.match(skip, /Self-assessment watermark exception/);
  const item5 = SHARED.slice(SHARED.indexOf('5. **Conditional — the watermark offset clause.**'), SHARED.indexOf('**Finding norms'));
  assert.match(item5, /Self-assessment watermark exception/);
  assert.match(item5, /`mode`/);
  assert.match(item5, /byte offset 0 \(line 1\)/);
});
```

In `tests/feedback-watermark-prose.test.js`, after the 2c block:

```js
test('AC4.1: session-evaluation.md cites the shared Self-assessment watermark exception rather than restating it', () => {
  assert.match(SESSION_EVAL, /_shared\/transcript-judge\.md`'s Self-assessment watermark exception/);
  assert.doesNotMatch(SESSION_EVAL, /\*\*Readers ignore a self-assessment watermark's byte offset\.\*\*/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/transcript-judge-prose.test.js tests/feedback-watermark-prose.test.js`
Expected: FAIL — the three new `AC3.1`/`AC4.1` tests fail (no match); every existing test passes.

- [ ] **Step 3: Edit `transcript-judge.md`**
  - Skip check: after numbered step 3, add a paragraph headed `**Self-assessment watermark exception (#2916).**` stating `isTranscriptUnchanged` returns `false` for any watermark carrying `mode: "self-assessment"`, so this check never skips on one — a self-assessment watermark scopes nothing; see the Degradation section's "Readers ignore…" note.
  - Prompt item 5: state callers pass the watermark's `mode` through to `formatOffsetClause` along with `bytesAtDispatch`/`line`/`filedRecords`; after the literal fenced block, one sentence: under the Self-assessment watermark exception the offset segment renders as `byte offset 0 (line 1)`, the records and declined-subjects segments unchanged.
  - Degradation paragraph: after the sentence ending `never as a new failure\nmode.` (do not re-wrap it), insert `**Readers ignore a self-assessment watermark's byte offset.**` plus: the written `bytesAtDispatch` is kept for audit only — self-assessment saw the session's conversational context, which a long session may already have compacted, so it cannot vouch for those bytes; readers re-judge from the start (Skip check never skips, offset clause renders offset 0) while `filedRecords` and the live `dismissedSubjects` still dedup.
  - Mechanism for every behavioral claim: `isTranscriptUnchanged`'s mode guard and `formatOffsetClause`'s `mode` param (Task 1).

- [ ] **Step 4: Edit `session-evaluation.md`**
  - Skip check (`:41-48`): one sentence — a `mode: "self-assessment"` watermark never skips, per `_shared/transcript-judge.md`'s Self-assessment watermark exception, not restated here.
  - Payload `mode` comment (`:76-79`): append a comment line citing the same exception (readers ignore its byte offset). Keep `mode,                    // "self-assessment" when this payload was written from the` byte-identical (pinned).

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/transcript-judge-prose.test.js tests/feedback-watermark-prose.test.js tests/reflect-transcript-judge-prose.test.js`
Expected: PASS, all — including the #2730 pins at `tests/transcript-judge-prose.test.js:98-128` (AC3.2).

- [ ] **Step 6: Prove go-red (AC5.1)** — via `git show HEAD:<path>` comparisons, never `git stash`: temporarily remove the inserted `**Readers ignore…**` sentence, re-run, confirm the first `AC3.1` test fails; restore. Remove the Skip-check exception paragraph, confirm the second `AC3.1` fails; restore. Remove the session-evaluation citation, confirm `AC4.1` fails; restore. Re-run to PASS.

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/_shared/transcript-judge.md plugin/skills/feedback/session-evaluation.md tests/transcript-judge-prose.test.js tests/feedback-watermark-prose.test.js
git commit -m "Document the self-assessment watermark exception in transcript-judge.md — feedback cites it (refs #2916)"
```

### Full-suite gate (AC6.1)

Run centrally after both tasks: `npm test > {scratch}/npm-test.log 2>&1; echo exit=$?` — expect `exit=0`.

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC5.1 | Task 1 Step 5 and Task 2 Step 6 go-red reverts |
| AC6.1 | Full-suite gate above |

## Scope sweep (Check B, `scope-creep: add-to-plan`)

Files matching the scope keywords outside the task lists, each read and dispositioned — none needs an edit:

- `docs/plugin-structure.md` — describes `isTranscriptUnchanged` generically ("skips the dispatch … when it reports no growth"); still true.
- `plugin/bin/lib/declined-learning/store.js` — comments cite `formatOffsetClause`'s delimiting only; unaffected.
- `plugin/skills/_shared/subagent-output-contract.md` — cites `formatOffsetClause` as an example of pre-specified text; unaffected.
- `plugin/skills/reflect/SKILL.md` — reflect opts out of the self-assessment write and cites the shared contract; unaffected (Global Constraints).
- `tests/feedback-watermark-prose.test.js` — already Task 2's Test file.
- `tests/reflect-transcript-judge-prose.test.js` — run in Task 2 Step 5 as a regression check; no edit.
