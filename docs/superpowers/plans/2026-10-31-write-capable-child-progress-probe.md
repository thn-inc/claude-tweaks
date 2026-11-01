# Progress Check at the Wait Bound for Write-Capable Children Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dispatched agent whose 60 x `sleep 20` wait bound expires with a write-capable child still outstanding probes that child's worktree read-only and keeps waiting while it progresses (up to 3 windows / 60 minutes), instead of stopping `BLOCKED` on elapsed time alone.

**Architecture:** Prose-only change to the shared contract (`_shared/subagent-dispatch-core.md`'s Foreground Execution Discipline) and its six restated copies (task-prompt item 7 + two templates, express-prompt two templates, the flow context-handoff template), each gaining one identical progress-check passage placed right after the existing write-capable-child stop sentence. Conformance tests extend `tests/foreground-execution-instruction.test.js`'s copy map to all seven copies and pin the passage's facts per copy with per-pattern go-red proofs.

**Tech Stack:** Markdown skill prose; `node --test` conformance suites.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T115520-record-4557/work/4557-spec.md` (record #4557; carries the AC8-AC10 Decisions)

**Amended 2026-10-31 (resumed run 2026-10-31T160521):** the record gained a plan-review **Decision** (Reading B) — the stall rule applies per wave: keep granting windows while any write-capable child in the wave shows a change, up to the 3-window ceiling; the BLOCKED report names every child that showed no change; children sharing one worktree count as progressing together. The passage, `PROGRESS_CHECK` and `HANDOFF_PROGRESS` below carry it (AC7.1). The passage was also shortened for the size headroom the catch-up merge left (Global Constraints, Size).

**Amended 2026-11-01 (resumed run 2026-11-01T115520):** the record gained three more plan-review Decisions. AC8 — a wait call that fails during an extension window counts as that window's bound expiring, and the probe runs as at any bound (no third stop condition). AC9 — the probe also compares a hash of `git diff HEAD` (`git -C {child-worktree} --no-optional-locks diff HEAD | git hash-object --stdin`, a pipe confirmed to pass the worktree Bash guard from a worktree-isolated session, 2026-11-01), so re-edits to already-modified files count as progress. AC10 — the closing rule (a process rule for plan review, waived below). The passage, `PROGRESS_CHECK` and `HANDOFF_PROGRESS` carry AC8/AC9. The catch-up merge (26 commits, `efa40953d` → `4bee871c0`) grew `task-prompt.md` to 50,447 B, so this amendment names byte cuts up front (Global Constraints, Size).

**Plan review 2026-11-01 (run 2026-11-01T115520), behaviour chosen under AC10's implementer-judgment rule:** each bound compares with the *previous* probe, the first taken right after launching the wave (so a child that edits once and then stalls stops on `no progress for one window`, not at the ceiling); an agent with no launch probe (e.g. a handoff child continuing mid-wave) lets the first bound's probe set the baseline and grants one window; a child whose prompt names no worktree counts as unchanged (the spec's Technical Approach: "When a child's worktree is unknown, there is nothing to probe and the existing stop applies"). **Accepted blind spot:** `git diff HEAD` omits untracked files and porcelain keeps the same `??` line while one is re-edited, so a child that only rewrites an already-created untracked file for a whole window shows no change and stops as today — the same class the spec's Gotchas already accept ("A child that writes only outside its worktree shows no progress and falls back to today's stop — acceptable"); a newly created file still shows as a new `??` line.

## Global Constraints

- No `bin/` code changes — prose and tests only.
- The base primitive (`` `sleep 20` Bash calls, at most 60 (20 minutes) ``) stays stated exactly once per copy; the new passage must never restate it (the `PRIMITIVE` regex in `tests/foreground-execution-instruction.test.js` counts it).
- The never-redone-in-session rule and the never-read-`output_file` rule stay byte-unchanged in every copy.
- The new passage must not repeat any phrase another fact list in `tests/foreground-execution-instruction.test.js` matches (`SHARED_RULE`, `KEEP_ALIVE`, `ITEM7`, `TEMPLATE_KEEP_ALIVE`, `CORE_*`): each existing pattern must still match exactly once per copy, or its `assertEachPatternGoesRed` proof goes red. In particular never write `never redone`, `is abandoned`, `log the downgrade`, `unconfirmed`, `turn alive`, `still pending`, `INTERIM_STATUS`, `is not a wait`.
- Placeholder is `{child-worktree}`, not the spec's `{worktree}`: `flow/context-handoff.md`'s template already substitutes `{worktree}` with the handing-off agent's own checkout (its step 1), and item 7 is copied verbatim into that template, so `{worktree}` there would be filled with the wrong path. Same probe shape as the spec (`git -C … rev-parse HEAD`, `git -C … --no-optional-locks status --porcelain`).
- Verbatim-copy pins that tie the copies together (must stay green): `tests/dispatch-express-routing-prose.test.js` "both templates restate the first call's Foreground execution paragraph verbatim" (express x2 == task-prompt first-call paragraph, whitespace-collapsed); `tests/flow-context-handoff-conformance.test.js` "the handoff template inlines task-prompt.md's async-wait item 7 in the same words" (handoff template contains item 7's body, whitespace-collapsed).
- Size: after the 2026-11-01 catch-up merge `plugin/skills/dispatch/task-prompt.md` is 50,447 B against `RAIL_BYTES` 52,500 B (headroom 2,053 B); three copies of the ~1,000 B passage (+ item 7 indentation) add ~3,080 B — over the rail. Remedy chosen up front: the passage stays at the minimum fact set (no restated output_file/never-writes clause — the standing rules already say both), and `task-prompt.md` takes these eight byte cuts (~1,300 B, measured by applying them to a scratch copy 2026-11-01) in dispatcher-facing prose outside the fenced templates, none of whose removed words any test pins (grepped 2026-11-01 across `tests/`; the kept phrases `resolved seven of these facts`, `Add it when this firing came from a scheduled Routine` and `DISPATCH_HEADLESS` stay):
  - **C1** (line 3): delete `Unlike \`sequential-execution.md\` and \`deprecated-aliases.md\` (background detail, read for understanding), ` and capitalize the following `**each` → `**Each`.
  - **C2** (Context pack intro, lines 9-16): replace the paragraph with `A dispatched Task agent inherits no shell environment (\`_shared/subagent-output-contract.md\`'s Input Discipline), so an env-var reference such as \`${CLAUDE_PLUGIN_ROOT}\` embedded in a template resolves to nothing in its shell. The dispatching session already resolved seven of these facts earlier in the same firing (Steps 1-4); it resolves them **once more here, as literals**, before composing either call — plus one standing instruction (item 7) that needs no resolution, only inclusion:` (re-wrapped to the file's ~100-column width).
  - **C3** (First call, the `DISPATCH_HEADLESS=1` paragraph): replace its last two sentences, from `When set, it tells` to `before substitution.`, with `When set, it tells this call's Settle procedure (\`settle-and-merge.md\`) that nobody is present to read a Step 2.8 claim-contest stop, so a contest there self-reports via \`_shared/headless-self-report.md\`. It stays outside the fenced block below because only the dispatching session knows the firing form.`
  - **C4** (Second call, the `Substitute \`{minted-run-dir}\`` paragraph): replace its last sentence, from `` `/flow` creates a fresh run directory`` to `not start a new one.`, with `Omit it and \`/flow\` starts a fresh run directory instead of resuming the one the first call adopted.`
  - **C5** (Second call, the `This call's prompt names ONLY` paragraph): delete ` — the instruction below states this explicitly because that distinction is easy to lose` (the sentence then ends `...even though conversation history is not.`).
  - **C6** (after the first-call fence, the `model-ceiling` clamp paragraph): replace the paragraph with `**The \`model-ceiling\` clamp (#3212).** \`[Use: Capable]\` above does not guarantee Opus: a project \`model-ceiling: standard\` policy value clamps \`capable\` back to \`sonnet\` (\`plugin/bin/lib/model-profiles/profiles.js\`'s \`resolve()\`, reporting \`source: 'ceiling'\` in \`resolve-profile.js\`'s JSON), an expected outcome the Context pack's per-group log line records. The later diff-size cap never applies: this invocation passes no \`--diff-facts\`.` (keeps the four tokens `tests/dispatch-model-profile-conformance.test.js` pins: `model-ceiling: standard`, `` `sonnet` ``, `plugin/bin/lib/model-profiles/profiles.js`, `source: 'ceiling'`).
  - **C7** (First call, the `A dispatched call is headless` paragraph): delete ` (\`_shared/auto-mode-contract.md\`'s precedence: CLI arg > pipeline config > project policy > skill default)` (the three phrases `tests/dispatch-flow-explicit-auto-mode.test.js` pins stay).
  - **C8** (after the first-call fence, the `backed by a mechanical check` paragraph): delete ` — never trust to this clause's own wording without also keeping that check current` (the sentence then ends `...evidence of backgrounded/yielded execution.`; the pinned `backed by a mechanical check, not prose alone (#2429)` stays).
  Target after Step 3: at most 52,250 B (≥ 250 B margin); any later growth of this file needs a further byte cut first. `subagent-dispatch-core.md` 36,322 B, `express-prompt.md` 14,408 B, `context-handoff.md` 14,987 B — ample headroom.
- Governing project skill `.claude/skills/skill-prose-conformance-tests/SKILL.md`, quoted: "Write the assertion as a predicate that returns the facts whose pattern no longer matches (`missingFactsOf(patterns)`), and assert it returns `[]` on the live region. Then, per pattern, strip only that pattern's match from the live text and assert the same predicate returns exactly `[fact]`." and "Keep the patterns non-global: a `/g` regex makes `replace` strip every occurrence, which hides the twice-matched phrase, and its `.test()` carries `lastIndex` from one call to the next."
- Shape note: the single task touches six files (above flow's 5-file shape signal). Deliberate: the verbatim-copy pins above make the six files one atomic unit — any split leaves an intermediate commit with a red verbatim test.

Waived AC7.5: a provenance note naming the plan-review question the Decision answered — no behavior to assert.

Waived AC8.3: a provenance note naming the plan-review question the Decision answered — no behavior to assert.

Waived AC9.2: a provenance note naming the plan-review question the Decision answered — no behavior to assert.

Waived AC10.1: a process rule settling this record's spec for plan review — no shipped behavior to assert.

Waived AC10.2: a process rule routing further plan-review edge cases to implementer judgment — no shipped behavior to assert.

Waived AC10.3: a process rule bounding when plan review may stop the build — no shipped behavior to assert.

Waived _shared/dispatch-waiting.md: read only — the spec's Gotchas ASSUMPTION was verified at build (the stopping controller was a subagent; a top-level session has no fixed poll budget there), so the file needs no change.

## Review Focus

1. `{worktree}` reaching the handoff template would be substituted with the parent's checkout — pinned by Step 1b's no-`{worktree}` assertion.
2. A passage phrase colliding with an existing fact-list pattern makes an existing go-red proof fail — caught by running the whole `tests/foreground-execution-instruction.test.js` file (Step 4).
3. The passage restating the base primitive — caught by `statesPrimitiveOnce` now run over all seven copies (Step 1a).
4. An express copy drifting from the first-call template — `tests/dispatch-express-routing-prose.test.js` (Step 4).
5. `task-prompt.md` crossing `RAIL_BYTES` — `wc -c` in Step 4 plus the suite's rail tests.
6. A C1-C8 byte cut removing a phrase some other suite pins — the every-reader run in Step 4.
7. The passage's branching (previous-probe comparison, missing baseline, no named worktree, per-wave grant vs. stop, failed wait vs. failed probe) read as one consistent rule by an agent following it literally.

---

### Task 1: Progress-check passage in the core contract and all six copies, with conformance pins

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (Foreground Execution Discipline, "Nested `Agent` children" paragraph, after "stop, and end with `STATUS: BLOCKED` naming that child and its unit.")
- Modify: `plugin/skills/dispatch/task-prompt.md` (item 7, after the same sentence; first-call and second-call template "Foreground execution (required):" paragraphs, after the same sentence; byte cuts C1-C8 from Global Constraints, Size)
- Modify: `plugin/skills/dispatch/express-prompt.md` (both templates' "Foreground execution (required):" paragraphs, after the same sentence)
- Modify: `plugin/skills/flow/context-handoff.md` (template's "Async-wait discipline (required):" paragraph, after the same sentence)
- Test: `tests/foreground-execution-instruction.test.js`
- Test: `tests/flow-context-handoff-conformance.test.js`

**Interfaces:**
- Consumes: existing helpers in `tests/foreground-execution-instruction.test.js` — `fencedBlocks`, `templateBlocks`, `foregroundParagraph`, `coreForegroundSection`, `item7Block`, `missingFactsOf`, `assertEachPatternGoesRed`, `primitiveCopies`, `statesPrimitiveOnce`.
- Produces: `primitiveCopies()` returning seven named copies; constants `PROGRESS_CHECK`, `STANDING_RULES`.

- [ ] **Step 1: Write the failing tests (AC1.1, AC1.2, AC1.3, AC2.1, AC3.1, AC4.1, AC5.1, AC7.1, AC7.2, AC7.3, AC7.4, AC8.1, AC8.2, AC9.1)**

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
  [/probe\s+the\s+worktree\s+its\s+prompt\s+names,\s+read-only/, 'the probe reads the worktree the child prompt names, read-only'],
  [/`git\s+-C\s+\{child-worktree\}\s+rev-parse\s+HEAD`/, 'the probe reads the child worktree HEAD'],
  [/`git\s+-C\s+\{child-worktree\}\s+--no-optional-locks\s+status\s+--porcelain`/, 'the probe reads its --no-optional-locks porcelain status'],
  [/`git\s+-C\s+\{child-worktree\}\s+--no-optional-locks\s+diff\s+HEAD\s+\|\s+git\s+hash-object\s+--stdin`/, 'the probe hashes the diff against HEAD, so re-edits count as progress (AC9.1)'],
  [/against\s+the\s+previous\s+probe\s+\(taken\s+right\s+after\s+launching\s+the\s+wave,\s+then\s+at\s+each\s+bound/, 'each bound compares with the previous probe, the first taken right after the wave launches (AC1.1)'],
  [/lacking\s+one,\s+the\s+first\s+bound's\s+probe\s+sets\s+it\s+and\s+grants\s+a\s+window/, 'with no launch probe, the first bound sets the baseline and grants one window'],
  [/Per\s+wave,\s+while\s+any\s+child\s+shows\s+a\s+change,\s+log\s+one\s+line\s+and\s+grant\s+one\s+more\s+window/, 'per wave, a change in any child grants one more window (Decision: Reading B)'],
  [/stop\s+when\s+a\s+whole\s+window\s+passes\s+with\s+no\s+change/, 'BLOCKED only after a whole window with no change'],
  [/ceiling\s+of\s+3\s+windows\s+\(60\s+minutes\)\s+per\s+wave/, 'the 3-window (60-minute) ceiling'],
  [/\(`no\s+progress\s+for\s+one\s+window`\s+or\s+`ceiling\s+reached\s+while\s+progressing`\)/, 'the BLOCKED report names which of exactly two conditions fired — no third (AC8.2)'],
  [/and\s+every\s+unchanged\s+child/, 'the BLOCKED report names every child that showed no change (Decision: Reading B)'],
  [/Children\s+sharing\s+a\s+worktree\s+progress\s+together/, 'children sharing one worktree count as progressing together (Decision: Reading B)'],
  [/a\s+child\s+whose\s+prompt\s+names\s+no\s+worktree\s+counts\s+as\s+unchanged/, 'a child with no named worktree counts as unchanged (spec Technical Approach)'],
  [/A\s+failed\s+wait\s+call\s+ends\s+its\s+window,\s+and\s+the\s+probe\s+runs\s+as\s+at\s+any\s+bound/, 'a failed wait call in an extension window expires that bound and the probe runs (AC8.1)'],
  [/failed\s+probe\s+counts\s+as\s+no\s+change,\s+never\s+retried\s+in\s+another\s+form/, 'a failed probe counts as no change and is never retried in another form'],
  [/Read-only\s+units\s+keep\s+the\s+first-bound\s+self-judge/, 'a read-only unit is still self-judged at the first bound'],
];
const STANDING_RULES = [
  [/never\s+reading\s+or\s+tailing\s+a\s+running\s+child's\s+`output_file`/, 'the never-read output_file rule stands'],
  [/write-capable\s+child\s+\(one\s+that\s+edits\s+files\)\s+still\s+silent\s+at\s+the\s+bound\s+is\s+never\s+redone\s+in-session/, 'the never-redone-in-session rule stands'],
];
const missingProgress = missingFactsOf(PROGRESS_CHECK);
const missingStanding = missingFactsOf(STANDING_RULES);
```

Tests:
- `'AC1.1 AC1.2 AC1.3 AC2.1 AC4.1 AC7.1 AC7.2 AC7.3 AC7.4 AC8.1 AC8.2 AC9.1: every copy states the at-bound progress check for write-capable children (#4557)'` — for each `[name, text]` of `primitiveCopies()`: `assert.deepEqual(missingProgress(text), [], name)`.
- `'AC5.1: each progress-check assertion goes red when removed from any single copy (discrimination proof)'` — for each copy: `assertEachPatternGoesRed(text, PROGRESS_CHECK, missingProgress)`.
- `'AC3.1: the never-redone and never-read-output_file rules stand in every copy (#4557)'` — for each copy `assert.deepEqual(missingStanding(text), [], name)`; and its go-red twin with `assertEachPatternGoesRed(text, STANDING_RULES, missingStanding)` per copy.
- `'AC1.3: the progress check follows the write-capable stop sentence in every copy'` — per copy, `text.indexOf('naming that child and its unit.') < text.search(PROGRESS_CHECK[0][0])`, both indices `!== -1`; go-red by permutation: move the passage's first sentence before the stop sentence in one copy (string splice in memory) and assert the same predicate function reports that copy's name. Factor the check into `misorderedCopies(copies)` returning offending names; live result `[]`, doctored result `[name]`.

**1b — `tests/flow-context-handoff-conformance.test.js`.** Add after the verbatim-copy go-red test:

```js
const HANDOFF_PROGRESS = [
  [/`git -C \{child-worktree\} rev-parse HEAD`/, 'the template probes the child worktree HEAD'],
  [/`git -C \{child-worktree\} --no-optional-locks status --porcelain`/, 'the template probes porcelain status'],
  [/`git -C \{child-worktree\} --no-optional-locks diff HEAD \| git hash-object --stdin`/, 'the template hashes the diff against HEAD'],
  [/A failed wait call ends its window, and the probe runs as at any bound/, 'the template states a failed wait call expires the window'],
  [/against the previous probe \(taken right after launching the wave, then at each bound/, 'the template compares with the previous probe'],
  [/a child whose prompt names no worktree counts as unchanged/, 'the template states the no-named-worktree rule'],
  [/Per wave, while any child shows a change, log one line and grant one more window/, 'the template states the per-wave grant'],
  [/stop when a whole window passes with no change/, 'the template states the one-window stall condition'],
  [/ceiling of 3 windows \(60 minutes\) per wave/, 'the template states the 3-window ceiling'],
  [/Children sharing a worktree progress together/, 'the template states the shared-worktree rule'],
];
const handoffProgressMissing = (tpl) => HANDOFF_PROGRESS.filter(([re]) => !re.test(squash(tpl))).map(([, f]) => f);
```

Tests (each test reads its own template the way the file's existing tests do — `const [tpl] = fencedBlocks(read(HANDOFF));` inside the test body; there is no top-level `tpl`):
- `'AC4.1: the handoff template carries the progress-check extension, with a child-worktree placeholder the handoff never substitutes (#4557)'` — `assert.deepEqual(handoffProgressMissing(tpl), [])` and `assert.doesNotMatch(squash(tpl), /git -C \{worktree\}/)`.
- `'AC5.1: each handoff progress-check assertion can go red (discrimination proof)'` — per pattern, `const doctored = squash(tpl).replace(re, '')`, `assert.notEqual(doctored, squash(tpl))`, `assert.deepEqual(handoffProgressMissing(doctored), [fact])`; and the placeholder control: `squash(tpl).replace('git -C {child-worktree} rev-parse HEAD', 'git -C {worktree} rev-parse HEAD')` must match `/git -C \{worktree\}/`.

- [ ] **Step 2: Run the two suites to verify they fail**

Run: `node --test tests/foreground-execution-instruction.test.js tests/flow-context-handoff-conformance.test.js`
Expected: FAIL after Step 1 — the new progress-check tests report every `PROGRESS_CHECK` / `HANDOFF_PROGRESS` fact missing; pre-existing tests stay green.

- [ ] **Step 3: Insert the passage into all seven copies**

Insert immediately after the sentence ending "naming that child and its unit." in each copy, on the same paragraph (no blank line), re-wrapped to the surrounding line width. Exact text, the same words in all seven copies (it contains no dash, so the templates' ` -- ` vs. item 7's ` — ` split does not apply):

```
Before that stop, probe the worktree its prompt names, read-only: `git -C {child-worktree} rev-parse
HEAD`, `git -C {child-worktree} --no-optional-locks status --porcelain` and `git -C {child-worktree}
--no-optional-locks diff HEAD | git hash-object --stdin`, against the previous probe (taken right
after launching the wave, then at each bound; lacking one, the first bound's probe sets it and grants
a window). Per wave, while any child shows a change, log one line and grant one more window; stop
when a whole window passes with no change, or at a ceiling of 3 windows (60 minutes) per wave,
naming which fired (`no progress for one window` or `ceiling reached while progressing`) and every
unchanged child. Children sharing a worktree progress together; a child whose prompt names no
worktree counts as unchanged. A failed wait call ends its window, and the probe runs as at any
bound; a failed probe counts as no change, never retried in another form. Read-only units keep the
first-bound self-judge.
```

A line wrap inside a code span is fine: `PROGRESS_CHECK` matches with `\s+`, and `HANDOFF_PROGRESS` runs over `squash(tpl)` (whitespace-collapsed).

Before inserting the passage, apply byte cuts C1-C8 to `plugin/skills/dispatch/task-prompt.md` (Global Constraints, Size).

For `task-prompt.md` item 7: indented to item 7's three-space continuation; the `context-handoff.md` template copy is unindented and word-identical to item 7. The two `express-prompt.md` copies stay word-identical to the `task-prompt.md` first-call template.

For `subagent-dispatch-core.md`: the same text with `(#4557)` after "Before that stop" → "Before that stop (#4557), probe …".

- [ ] **Step 4: Run tests to verify they pass (AC6.1 targeted; the full `npm test` run is /build Common Step 5)**

Run: `node --test tests/foreground-execution-instruction.test.js tests/flow-context-handoff-conformance.test.js tests/dispatch-express-routing-prose.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, 0 failures.

Run: `wc -c plugin/skills/dispatch/task-prompt.md`
Expected: at most 52250 (below `RAIL_BYTES` 52500 with ≥ 250 B margin).

Run: every suite that reads `task-prompt.md` (`grep -rl "task-prompt.md" tests`), each file as its own `node --test` argument, to confirm the C1-C8 cuts removed no pinned phrase.
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/subagent-dispatch-core.md plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/express-prompt.md plugin/skills/flow/context-handoff.md tests/foreground-execution-instruction.test.js tests/flow-context-handoff-conformance.test.js
git commit -m "Add an at-bound progress check for write-capable children — keep waiting while HEAD or status moves, up to 3 windows (refs #4557)"
```
