# Progress Check at the Wait Bound for Write-Capable Children Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dispatched agent whose 60 x `sleep 20` wait bound expires with a write-capable child still outstanding probes that child's worktree read-only and keeps waiting while it progresses (up to 3 windows / 60 minutes), instead of stopping `BLOCKED` on elapsed time alone.

**Architecture:** Prose-only change to the shared contract (`_shared/subagent-dispatch-core.md`'s Foreground Execution Discipline) and its six restated copies (task-prompt item 7 + two templates, express-prompt two templates, the flow context-handoff template), each gaining one identical progress-check passage placed right after the existing write-capable-child stop sentence. Conformance tests extend `tests/foreground-execution-instruction.test.js`'s copy map to all seven copies and pin the passage's facts per copy with per-pattern go-red proofs.

**Tech Stack:** Markdown skill prose; `node --test` conformance suites.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T112000-record-4557/work/4557-spec.md` (record #4557)

## Global Constraints

- No `bin/` code changes — prose and tests only.
- The base primitive (`` `sleep 20` Bash calls, at most 60 (20 minutes) ``) stays stated exactly once per copy; the new passage must never restate it (the `PRIMITIVE` regex in `tests/foreground-execution-instruction.test.js` counts it).
- The never-redone-in-session rule and the never-read-`output_file` rule stay byte-unchanged in every copy.
- The new passage must not repeat any phrase another fact list in `tests/foreground-execution-instruction.test.js` matches (`SHARED_RULE`, `KEEP_ALIVE`, `ITEM7`, `TEMPLATE_KEEP_ALIVE`, `CORE_*`): each existing pattern must still match exactly once per copy, or its `assertEachPatternGoesRed` proof goes red. In particular never write `never redone`, `is abandoned`, `log the downgrade`, `unconfirmed`, `turn alive`, `still pending`, `INTERIM_STATUS`, `is not a wait`.
- Placeholder is `{child-worktree}`, not the spec's `{worktree}`: `flow/context-handoff.md`'s template already substitutes `{worktree}` with the handing-off agent's own checkout (its step 1), and item 7 is copied verbatim into that template, so `{worktree}` there would be filled with the wrong path. Same probe shape as the spec (`git -C … rev-parse HEAD`, `git -C … --no-optional-locks status --porcelain`).
- Verbatim-copy pins that tie the copies together (must stay green): `tests/dispatch-express-routing-prose.test.js` "both templates restate the first call's Foreground execution paragraph verbatim" (express x2 == task-prompt first-call paragraph, whitespace-collapsed); `tests/flow-context-handoff-conformance.test.js` "the handoff template inlines task-prompt.md's async-wait item 7 in the same words" (handoff template contains item 7's body, whitespace-collapsed).
- Size: `plugin/skills/dispatch/task-prompt.md` is 49,154 B against `RAIL_BYTES` 52,500 B (headroom 3,346 B); three copies of the passage (~650 B each) leave ~1.4 KB. `subagent-dispatch-core.md` 32,741 B, `express-prompt.md` 14,262 B, `context-handoff.md` 14,179 B — ample headroom.
- Governing project skill `.claude/skills/skill-prose-conformance-tests/SKILL.md`, quoted: "Write the assertion as a predicate that returns the facts whose pattern no longer matches (`missingFactsOf(patterns)`), and assert it returns `[]` on the live region. Then, per pattern, strip only that pattern's match from the live text and assert the same predicate returns exactly `[fact]`." and "Keep the patterns non-global: a `/g` regex makes `replace` strip every occurrence, which hides the twice-matched phrase, and its `.test()` carries `lastIndex` from one call to the next."
- Shape note: the single task touches six files (above flow's 5-file shape signal). Deliberate: the verbatim-copy pins above make the six files one atomic unit — any split leaves an intermediate commit with a red verbatim test.

Waived _shared/dispatch-waiting.md: read only — the spec's Gotchas ASSUMPTION was verified at build (the stopping controller was a subagent; a top-level session has no fixed poll budget there), so the file needs no change.

## Review Focus

1. `{worktree}` reaching the handoff template would be substituted with the parent's checkout — pinned by Step 1b's no-`{worktree}` assertion.
2. A passage phrase colliding with an existing fact-list pattern makes an existing go-red proof fail — caught by running the whole `tests/foreground-execution-instruction.test.js` file (Step 4).
3. The passage restating the base primitive — caught by `statesPrimitiveOnce` now run over all seven copies (Step 1a).
4. An express copy drifting from the first-call template — `tests/dispatch-express-routing-prose.test.js` (Step 4).
5. `task-prompt.md` crossing `RAIL_BYTES` — `wc -c` in Step 4 plus the suite's rail tests.

---

### Task 1: Progress-check passage in the core contract and all six copies, with conformance pins

**Role:** transcription

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (Foreground Execution Discipline, "Nested `Agent` children" paragraph, after "stop, and end with `STATUS: BLOCKED` naming that child and its unit.")
- Modify: `plugin/skills/dispatch/task-prompt.md` (item 7, after the same sentence; first-call and second-call template "Foreground execution (required):" paragraphs, after the same sentence)
- Modify: `plugin/skills/dispatch/express-prompt.md` (both templates' "Foreground execution (required):" paragraphs, after the same sentence)
- Modify: `plugin/skills/flow/context-handoff.md` (template's "Async-wait discipline (required):" paragraph, after the same sentence)
- Test: `tests/foreground-execution-instruction.test.js`
- Test: `tests/flow-context-handoff-conformance.test.js`

**Interfaces:**
- Consumes: existing helpers in `tests/foreground-execution-instruction.test.js` — `fencedBlocks`, `templateBlocks`, `foregroundParagraph`, `coreForegroundSection`, `item7Block`, `missingFactsOf`, `assertEachPatternGoesRed`, `primitiveCopies`, `statesPrimitiveOnce`.
- Produces: `primitiveCopies()` returning seven named copies; constants `PROGRESS_CHECK`, `STANDING_RULES`.

- [ ] **Step 1: Write the failing tests (AC1.1, AC1.2, AC1.3, AC2.1, AC3.1, AC4.1, AC5.1)**

**1a — `tests/foreground-execution-instruction.test.js`.** Add `const EXPRESS_PROMPT = path.join(PLUGIN, 'skills', 'dispatch', 'express-prompt.md');` and `const HANDOFF = path.join(PLUGIN, 'skills', 'flow', 'context-handoff.md');`. Add a helper `handoffWaitParagraph(text)` returning the one blank-line paragraph of `fencedBlocks(text)[0]` that starts `Async-wait discipline (required):` (assert exactly one fenced block and exactly one such paragraph).

Extend `primitiveCopies()` with three entries (update the comment above it from "four copies" to "seven copies", and the test title `'... agrees across all four copies (#3078)'` to `'... agrees across all seven copies (#3078, #4557)'`):

```js
'express-prompt.md express call': foregroundParagraph(expressExpress),
'express-prompt.md review call': foregroundParagraph(expressReview),
'context-handoff.md template': handoffWaitParagraph(readText(HANDOFF)),
```

where `[expressExpress, expressReview] = fencedBlocks(readText(EXPRESS_PROMPT))` (assert length 2).

Add the fact lists (non-global regexes) and tests, citing AC ids:

```js
const PROGRESS_CHECK = [
  [/`git\s+-C\s+\{child-worktree\}\s+rev-parse\s+HEAD`/, 'the probe reads the child worktree HEAD'],
  [/`git\s+-C\s+\{child-worktree\}\s+--no-optional-locks\s+status\s+--porcelain`/, 'the probe reads its --no-optional-locks porcelain status'],
  [/taken\s+right\s+after\s+the\s+wave\s+launched\s+and\s+at\s+each\s+later\s+bound/, 'the baseline is taken at wave launch and at each later bound'],
  [/change\s+in\s+either\s+value\s+means\s+the\s+child\s+is\s+progressing,\s+so\s+log\s+one\s+line\s+and\s+grant\s+one\s+more\s+window/, 'a change since the previous probe grants one more window'],
  [/stop\s+only\s+when\s+a\s+whole\s+window\s+passes\s+with\s+no\s+change\s+in\s+either\s+value/, 'BLOCKED only after a whole window with no change'],
  [/ceiling\s+of\s+3\s+windows\s+\(60\s+minutes\)\s+per\s+wave/, 'the 3-window (60-minute) ceiling'],
  [/`no\s+progress\s+for\s+one\s+window`\s+or\s+`ceiling\s+reached\s+while\s+progressing`/, 'the BLOCKED report names which condition fired'],
  [/probe\s+that\s+fails\s+counts\s+as\s+no\s+observed\s+change/, 'a failed probe counts as no observed change'],
  [/probe\s+never\s+writes\s+and\s+never\s+reads\s+the\s+child's\s+`output_file`/, 'the probe is read-only and never reads output_file'],
  [/read-only\s+unit\s+is\s+still\s+self-judged\s+at\s+the\s+first\s+bound/, 'a read-only unit is still self-judged at the first bound'],
];
const STANDING_RULES = [
  [/never\s+reading\s+or\s+tailing\s+a\s+running\s+child's\s+`output_file`/, 'the never-read output_file rule stands'],
  [/write-capable\s+child\s+\(one\s+that\s+edits\s+files\)\s+still\s+silent\s+at\s+the\s+bound\s+is\s+never\s+redone\s+in-session/, 'the never-redone-in-session rule stands'],
];
const missingProgress = missingFactsOf(PROGRESS_CHECK);
const missingStanding = missingFactsOf(STANDING_RULES);
```

Tests:
- `'AC1.1 AC1.2 AC1.3 AC2.1 AC4.1: every copy states the at-bound progress check for write-capable children (#4557)'` — for each `[name, text]` of `primitiveCopies()`: `assert.deepEqual(missingProgress(text), [], name)`.
- `'AC5.1: each progress-check assertion goes red when removed from any single copy (discrimination proof)'` — for each copy: `assertEachPatternGoesRed(text, PROGRESS_CHECK, missingProgress)`.
- `'AC3.1: the never-redone and never-read-output_file rules stand in every copy (#4557)'` — for each copy `assert.deepEqual(missingStanding(text), [], name)`; and its go-red twin with `assertEachPatternGoesRed(text, STANDING_RULES, missingStanding)` per copy.
- `'AC1.3: the progress check follows the write-capable stop sentence in every copy'` — per copy, `text.indexOf('naming that child and its unit.') < text.search(PROGRESS_CHECK[0][0])`, both indices `!== -1`; go-red by permutation: move the passage's first sentence before the stop sentence in one copy (string splice in memory) and assert the same predicate function reports that copy's name. Factor the check into `misorderedCopies(copies)` returning offending names; live result `[]`, doctored result `[name]`.

**1b — `tests/flow-context-handoff-conformance.test.js`.** Add after the verbatim-copy go-red test:

```js
const HANDOFF_PROGRESS = [
  [/`git -C \{child-worktree\} rev-parse HEAD`/, 'the template probes the child worktree HEAD'],
  [/`git -C \{child-worktree\} --no-optional-locks status --porcelain`/, 'the template probes porcelain status'],
  [/a whole window passes with no change in either value/, 'the template states the one-window stall condition'],
  [/ceiling of 3 windows \(60 minutes\) per wave/, 'the template states the 3-window ceiling'],
];
const handoffProgressMissing = (tpl) => HANDOFF_PROGRESS.filter(([re]) => !re.test(squash(tpl))).map(([, f]) => f);
```

Tests:
- `'AC4.1: the handoff template carries the progress-check extension, with a child-worktree placeholder the handoff never substitutes (#4557)'` — `assert.deepEqual(handoffProgressMissing(tpl), [])` and `assert.doesNotMatch(squash(tpl), /git -C \{worktree\}/)`.
- `'AC5.1: each handoff progress-check assertion can go red (discrimination proof)'` — per pattern, `const doctored = squash(tpl).replace(re, '')`, `assert.notEqual(doctored, squash(tpl))`, `assert.deepEqual(handoffProgressMissing(doctored), [fact])`; and the placeholder control: `squash(tpl).replace('git -C {child-worktree} rev-parse HEAD', 'git -C {worktree} rev-parse HEAD')` must match `/git -C \{worktree\}/`.

- [ ] **Step 2: Run the two suites to verify they fail**

Run: `node --test tests/foreground-execution-instruction.test.js tests/flow-context-handoff-conformance.test.js`
Expected: FAIL after Step 1 — the new progress-check tests report every `PROGRESS_CHECK` / `HANDOFF_PROGRESS` fact missing; pre-existing tests stay green.

- [ ] **Step 3: Insert the passage into all seven copies**

Insert immediately after the sentence ending "naming that child and its unit." in each copy, on the same paragraph (no blank line), re-wrapped to the surrounding line width. Exact copy for `plugin/skills/dispatch/task-prompt.md`'s two templates and `plugin/skills/dispatch/express-prompt.md`'s two templates (ASCII `--`):

```
Before that stop, probe a write-capable child's worktree read-only when its dispatch prompt names
one -- `git -C {child-worktree} rev-parse HEAD` and `git -C {child-worktree} --no-optional-locks
status --porcelain`, compared against the same probe taken right after the wave launched and at
each later bound: a change in either value means the child is progressing, so log one line and
grant one more window of the same wait; stop only when a whole window passes with no change in
either value, or at a ceiling of 3 windows (60 minutes) per wave, naming in the BLOCKED report
which fired (`no progress for one window` or `ceiling reached while progressing`). A probe that
fails counts as no observed change and is never retried in another form; the probe never writes
and never reads the child's `output_file`, and a read-only unit is still self-judged at the first
bound.
```

For `task-prompt.md` item 7 and the `context-handoff.md` template (which must stay word-identical to item 7): the same text with ` — ` in place of ` -- `, indented to item 7's three-space continuation in `task-prompt.md` and unindented in the template.

For `subagent-dispatch-core.md`: the same text with ` — `, and `(#4557)` after "Before that stop" → "Before that stop (#4557), probe …".

- [ ] **Step 4: Run tests to verify they pass (AC6.1 targeted; the full `npm test` run is /build Common Step 5)**

Run: `node --test tests/foreground-execution-instruction.test.js tests/flow-context-handoff-conformance.test.js tests/dispatch-express-routing-prose.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, 0 failures.

Run: `wc -c plugin/skills/dispatch/task-prompt.md`
Expected: below 52500.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/subagent-dispatch-core.md plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/express-prompt.md plugin/skills/flow/context-handoff.md tests/foreground-execution-instruction.test.js tests/flow-context-handoff-conformance.test.js
git commit -m "Add an at-bound progress check for write-capable children — keep waiting while HEAD or status moves, up to 3 windows (refs #4557)"
```
