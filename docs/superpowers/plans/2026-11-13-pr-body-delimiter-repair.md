# PR-Body Delimiter Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `repairPrBody` puts back the HTML-comment form of every PR-body marker whose plain-text companion alone survived a gh-absent MCP read, so a read-repair-write keeps both forms.

**Architecture:** One new pass at the end of `repairPrBody` (`plugin/bin/lib/flow/pr-body.js`), after the existing whole-piece restores. For each of the five HTML tokens (run marker, phases start/end, fixes start/end) absent from the body while its plain companion sits on its own line, it writes the HTML token next to that line. It reuses the blank line an MCP read leaves where the comment was, so repeated read-repair-write cycles never grow the body. `bin/pr-checklist.js`'s "carried none/some" log wording stops counting `restored` entries, because that list can now hold HTML-form entries too.

**Tech Stack:** Node 18+, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T125802-spec-5358/work/5358-spec.md`

Scope keywords: repairPrBody, repaired.restored

## Global Constraints

- Every byte of the body's existing content is kept. The pass only writes HTML tokens, and it touches existing lines only to fill a line that is already blank.
- `restored` entry names for the new pass are exactly `run marker HTML form`, `phases HTML markers`, `fixes HTML markers`, in that order, each pushed at most once per call, after any of the existing `run marker` / `phases block` / `fixes block` entries.
- The HTML run marker takes the run id from the plain companion line it pairs with, never from the `runId` argument. A body naming another run must still read as another run's body, so `pr-checklist.js`'s run-marker mismatch refusal keeps firing.
- Commit subject style: `{Verb} {what} — {detail}` (imperative, no conventional-commit prefix), ending with the line `Claude-Session: https://claude.ai/code/session_016yg3zrGQB1yk3fGi1qfrJ2`.
- Governing skill `.claude/skills/prose-code-twin-pin/SKILL.md`, quoted verbatim: "*A code detector whose input line is produced by a code composer.* `staleClaimInFlightPr` matches a run marker that `plugin/bin/lib/flow/pr-body.js` writes. It shipped pinned only against hand-typed markers, which agree with the detector by construction. Pin the detector to the composer instead: run `composePrEarlyBody`/`composeExpressBody` output through it, each marker form alone, including the body with every HTML comment stripped (what a gh-absent MCP read returns)". The tests below therefore build their MCP-read input from composer output, never from hand-typed marker lines.
- `.claude/skills/gh-api-module-pattern/SKILL.md`'s PR-body rules cover gh seams and closing keywords. This change adds neither, so none apply.
- Prose edits: `plugin/skills/_shared/pr-checklist-refresh.md` is 14,928 B and `plugin/skills/_shared/pr-early-run-lifecycle.md` is 35,198 B, against `RAIL_BYTES` 52,500 B. Each edit adds under 200 B, so headroom stays above 17 KB.

## Review Focus

1. **Repeated MCP read-repair-write cycles.** Each MCP read turns a comment line into an empty line. A repair that inserts a new line each time would add one blank line per phase exit. Expected: three strip-and-repair cycles leave the body byte-identical to the composed one (Task 1, test `#5358: repeated MCP read-repair-write cycles leave the body unchanged`).
2. **A plain marker with no blank line beside it.** The comment line is gone entirely, for example after a hand edit. Expected: the HTML token is inserted on its own new line, directly above the plain start token or run marker, or directly below the plain end token (Task 1, test `#5358: a plain marker with no blank neighbour gets the HTML form on a new line`).
3. **A plain run marker naming another run.** Expected: the restored HTML marker names that other run's id, not the caller's `runId` (Task 1, test `#5358: the restored HTML run marker keeps the run id its plain companion names`).
4. **Half of one HTML pair present.** For example, `<!-- phases-start -->` survived and `<!-- phases-end -->` did not. Expected: only the missing token is written, and `restored` is `['phases HTML markers']` (Task 1, test `#5358: only the missing HTML token of a half-present pair is restored`).
5. **A CRLF body.** Expected: every HTML token comes back once, and every plain marker line keeps its bytes (Task 1, test `#5358: a CRLF body gets its HTML markers back with its plain lines untouched`).

---

### Task 1: Restore stripped HTML-comment markers in `repairPrBody`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/flow/pr-body.js:198-229` (`repairPrBody` plus one new private helper beside `stripOrphanedHalf`)
- Test: `tests/bin-lib/flow/pr-body.test.js` (append after the `hasRunMarker/hasPhasesPair/hasFixesPair` test)
- Modify: `docs/plugin-structure.md` (the `pr-body.js — … repairPrBody (restores whichever of the run marker / phases pair / fixes pair are missing from an existing body, preserving its freeform content, #2997)` clause)
- Modify: `plugin/skills/_shared/pr-checklist-refresh.md` (the `<!-- when: transport=mcp -->` paragraph "`gh`-absent: `mcp__github__update_pull_request` with the same composed body — unsanitized … so both delimiter pairs survive regardless of which located the span.")
- Modify: `plugin/skills/_shared/pr-early-run-lifecycle.md` (the sentence "Neither form is ever removed once written, so a run that starts `gh`-absent and later gains `gh` (or vice versa) never loses recognition.")
- Test: `tests/pr-early-run-lifecycle.test.js` is run unchanged in Step 4. It composes and repairs through `pr-body.js`.
- No change, consumer classified: `plugin/bin/lib/flow/pr-early-open.js`'s `namesOtherRun` reads only `firstLineRunId(repairPrBody(...).body)`. It is a pick-one consumer. On an MCP-stripped body, line 0 used to be blank, so it read "another run" and rebound the PR. It now reads the restored HTML marker's id, which matches `pr-checklist.js` no longer refusing that body. That is the rule `namesOtherRun` states.
- No change: `docs/plans/2026-11-13-pr-body-deliverable-check-ledger.md` is #5340's ledger. Its row 2 is the terminal observation this record was filed from.
- No change: `plugin/skills/dispatch/settle-parked.md` and `plugin/skills/_shared/health-issue-index.md` describe which form a reader keys on, not what a repair restores.

**Interfaces:**
- Consumes: the existing `runMarkerHtml(runId)`, `PHASES_START_TOKENS` / `PHASES_END_TOKENS` / `FIXES_START_TOKENS` / `FIXES_END_TOKENS` (index 0 is the HTML form, index 1 the plain form).
- Produces: `repairPrBody({ body, runId, fixesLines }) -> { body, restored }`, unchanged in signature. `restored` may now also carry `'run marker HTML form'`, `'phases HTML markers'`, `'fixes HTML markers'`. Task 2 relies on these three names.

- [ ] **Step 1: Write the failing tests**

Add a local helper `const mcpRead = (b) => b.replace(/<!--[\s\S]*?-->/g, '');` (the bluemonday strip: removes the comment span, keeps its newline). Then add these tests:

```js
test('AC1.1 (#5358): repairPrBody restores every HTML-comment marker an MCP read stripped, byte-for-byte', () => {
  const early = composePrEarlyBody({ runId: 'r1', specSummary: 's', target: '#1', nextStep: 'test', fixesLines: ['Fixes #1'] });
  const express = composeExpressBody({ runId: 'r1', specSummary: 's', fixesLines: ['Fixes #1'] });
  const a = repairPrBody({ body: mcpRead(early), runId: 'r1', fixesLines: ['Fixes #1'] });
  assert.equal(a.body, early);
  assert.deepEqual(a.restored, ['run marker HTML form', 'phases HTML markers', 'fixes HTML markers']);
  const b = repairPrBody({ body: mcpRead(express), runId: 'r1', fixesLines: ['Fixes #1'] });
  assert.equal(b.body, express);
  assert.deepEqual(b.restored, ['run marker HTML form', 'fixes HTML markers']);
});

test('#5358: repeated MCP read-repair-write cycles leave the body unchanged', () => {
  const early = composePrEarlyBody({ runId: 'r1', specSummary: 's', target: '#1', nextStep: 'test', fixesLines: ['Fixes #1'] });
  let body = early;
  for (let i = 0; i < 3; i++) body = repairPrBody({ body: mcpRead(body), runId: 'r1', fixesLines: ['Fixes #1'] }).body;
  assert.equal(body, early);
});
```

- `#5358: a plain marker with no blank neighbour gets the HTML form on a new line`. Input: `early` with every line matching `/^<!--.*-->$/` removed (split on `\n`, filter, join). Assert:
  - line 0 is `<!-- claude-tweaks-run: r1 -->` and line 1 is `claude-tweaks-run: r1`;
  - the line before `[claude-tweaks-phases-start]` is `<!-- phases-start -->`, and the line after `[claude-tweaks-phases-end]` is `<!-- phases-end -->`;
  - the same holds for the fixes pair;
  - each of the five HTML tokens occurs exactly once (count with `split(token).length - 1`).
- `#5358: the restored HTML run marker keeps the run id its plain companion names`. Input: `mcpRead` of a composed body with `runId: 'other-run'`, repaired with `runId: 'r1'`. Assert the body's first line is `<!-- claude-tweaks-run: other-run -->` and the body contains no `r1` marker.
- `#5358: only the missing HTML token of a half-present pair is restored`. Input: `early` with only the `<!-- phases-end -->` line replaced by an empty line. Assert `restored` deep-equals `['phases HTML markers']` and the body equals `early`.
- `#5358: a CRLF body gets its HTML markers back with its plain lines untouched`. Input: `mcpRead(early.replace(/\n/g, '\r\n'))`. Assert:
  - each of the five HTML tokens occurs exactly once;
  - every line of the input that contains `claude-tweaks-` and no `<!--` is still present, unchanged, in the output split on `\n`.

- [ ] **Step 2: Run the tests to verify they fail (AC2.1)**

Run: `node --test tests/bin-lib/flow/pr-body.test.js`
Expected: FAIL after Step 1. `AC1.1` fails on `assert.equal(a.body, early)`, because today's `repairPrBody` returns the stripped body unchanged and `restored` is `[]`. The cycle, no-blank-neighbour, run-id, half-pair and CRLF tests fail too. Every pre-existing test passes.

- [ ] **Step 3: Implement the HTML-form pass in `repairPrBody` (`plugin/bin/lib/flow/pr-body.js`)**

Add a private helper `restoreHtmlForm(lines, htmlToken, plainToken, side)`. Here `lines` is the body split on `\n`, `side` is `'above'` or `'below'`, and it returns `true` when it wrote. The algorithm:
1. Do nothing when any line contains `htmlToken`.
2. Otherwise find the first line whose `.trim()` equals `plainToken`. Do nothing if there is none.
3. Take the neighbour on `side`. If that neighbour exists and its `.trim()` is `''`, overwrite it with `htmlToken`.
4. Otherwise splice a new `htmlToken` line in on that side.

For the run marker, the plain line is the first one matching `/^claude-tweaks-run:\s*(\S+)$/` after `.trim()`. The HTML token is `runMarkerHtml(match[1])`, written only when the body has no line matching `/<!--\s*claude-tweaks-run:\s*\S+\s*-->/`. The run marker and start tokens use `'above'`; end tokens use `'below'`.

Run the pass after the existing fixes-block step, on one `split('\n')` / `join('\n')` of `result`. Push `run marker HTML form`, then `phases HTML markers` (if either phases token was written), then `fixes HTML markers`. Extend the function's header comment by one sentence naming the MCP-read case and #5358.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/flow/pr-body.test.js tests/pr-early-run-lifecycle.test.js tests/bin-lib/flow/pr-checklist-cli.test.js`
Expected: PASS, every test in all three files.

- [ ] **Step 5: Update the three prose lines**

- `docs/plugin-structure.md`: after "preserving its freeform content, #2997", add "; and puts back the HTML-comment form of any marker whose plain-text companion alone survived a gh-absent MCP read, #5358". This goes inside the same parenthesis.
- `pr-checklist-refresh.md` MCP paragraph: replace "unsanitized (`_shared/pr-early-run-lifecycle.md`'s Root cause section), so both delimiter pairs survive regardless of which located the span." with "unsanitized (`_shared/pr-early-run-lifecycle.md`'s Root cause section), and `repairPrBody` has already put back the HTML-comment forms the MCP read stripped, so both delimiter pairs survive regardless of which located the span."
- `pr-early-run-lifecycle.md`: after "never loses recognition.", add " A repair after an MCP read (`repairPrBody`) puts back the HTML-comment form the read stripped, so an MCP write-back keeps both forms (#5358)."

Run: `node --test tests/pr-early-run-lifecycle.test.js tests/build-pr-body-claim.test.js tests/review-pr-body-deliverables.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/flow/pr-body.js tests/bin-lib/flow/pr-body.test.js docs/plugin-structure.md plugin/skills/_shared/pr-checklist-refresh.md plugin/skills/_shared/pr-early-run-lifecycle.md
git commit -m "Restore stripped HTML-comment PR-body markers in repairPrBody — an MCP read-repair-write keeps both forms (#5358)" -m "Claude-Session: https://claude.ai/code/session_016yg3zrGQB1yk3fGi1qfrJ2"
```

### Task 2: Derive `pr-checklist.js`'s "carried none/some" from whole pieces, not a count

**Role:** integration

**Files:**
- Modify: `plugin/bin/pr-checklist.js:216-217` (`const carried = repaired.restored.length === 3 ? 'none' : 'some';`)
- Test: `tests/bin-lib/flow/pr-checklist-cli.test.js` (extend `missing markers are repaired and logged`, and add one test after it)

**Interfaces:**
- Consumes: Task 1's `restored` names.
- Produces: nothing new. The decisions.md line keeps its shape: `restored {list} on PR #{n} (body carried {none|some} of the expected markers)`.

- [ ] **Step 1: Write the failing test**

```js
test('#5358: a body carrying only plain markers gets its HTML forms back and logs "carried some"', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody().replace(/<!--[\s\S]*?-->/g, '') });
  assert.equal(run(['--run', runDir, '--phase', 'build', '--fixes', '1'], h.deps), 0);
  const written = h.edits[0].input;
  assert.ok(written.startsWith(`<!-- claude-tweaks-run: ${RUN_ID} -->\nclaude-tweaks-run: ${RUN_ID}\n`));
  assert.ok(written.includes('<!-- phases-start -->') && written.includes('<!-- fixes-end -->'));
  assert.deepEqual(h.json().restored, ['run marker HTML form', 'phases HTML markers', 'fixes HTML markers']);
  const log = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.ok(log.includes('restored run marker HTML form, phases HTML markers, fixes HTML markers on PR #7 (body carried some of the expected markers)'));
});
```

Also add to `missing markers are repaired and logged`: `assert.ok(log.includes('(body carried none of the expected markers)'));`

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bin-lib/flow/pr-checklist-cli.test.js`
Expected: FAIL after Step 1, on the new test's log assertion. With Task 1 landed, the three HTML entries make `restored.length === 3` read `none`. The extended `missing markers` test passes.

- [ ] **Step 3: Implement**

In `plugin/bin/pr-checklist.js`, compute `carried` as `'none'` only when `restored` includes all of `'run marker'`, `'phases block'` and `'fixes block'`; otherwise use `'some'`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/flow/pr-checklist-cli.test.js tests/bin-lib/flow/pr-body.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/pr-checklist.js tests/bin-lib/flow/pr-checklist-cli.test.js
git commit -m "Derive pr-checklist's carried none/some from restored pieces — HTML-form restores no longer read as an empty body (#5358)" -m "Claude-Session: https://claude.ai/code/session_016yg3zrGQB1yk3fGi1qfrJ2"
```
