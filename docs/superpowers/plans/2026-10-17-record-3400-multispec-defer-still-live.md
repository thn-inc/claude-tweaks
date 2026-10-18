# MULTISPEC_REVIEW_DEFER still-live clause (#3400) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MULTISPEC_REVIEW_DEFER paragraph in `plugin/skills/wrap-up/execution-and-verification.md` name acceptance labeling and Verify execution as still-live per spec, and pin that with a prose-conformance test.

**Architecture:** One prose edit (append three sentences to an existing paragraph) plus one new `node --test` suite that selects that paragraph by its bold label and pins each claim against a frozen pre-change excerpt.

**Tech Stack:** Markdown skill prose; `node --test` (built-in), `node:assert`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T183814-record-3400/work/3400-spec.md`

## Global Constraints

- Test runner: `node --test` via `npm test`; no external deps.
- Prose pins follow `.claude/skills/skill-prose-conformance-tests` (lookalike-safe needles, frozen pre-change control, CRLF-tolerant splits).
- Premise reversed at build (logged to decisions.md): the record says the `run-dir-archived`/`worktree-removed` rows "are expected to fail mid-run". They do not. `review-console-appendix.md`'s Multi-spec defer protocol step 4 writes `deferred: [..., "worktree", ..., "run-dir-archival"]` to `verify-expectations.json`, and `plugin/bin/lib/wrap-up/engine-verify.js` renders both rows as `{ result: 'skip', detail: 'deferred to parent console' }`. The prose states the skip.

## Review Focus

1. A lookalike needle elsewhere in the file (line 3's "`MULTISPEC_REVIEW_DEFER` skip list", line 5's "acceptance-labeling action") satisfies a whole-file match. The test scopes every assertion to the one paragraph whose first line starts `**MULTISPEC_REVIEW_DEFER branch:**`, and proves the scoping with a doctored-live control.
2. The paragraph label is reworded and the selector finds zero paragraphs, which leaves the pins vacuous. The selector asserts exactly one match.
3. A CRLF checkout breaks a bare `\n\n` split. The split uses `/\r?\n\r?\n/`, and the test includes a CRLF input.
4. The prose's quoted skip detail drifts from the engine. One assertion checks that `engine-verify.js` still emits `detail: 'deferred to parent console'`.

---

### Task 1: Name acceptance labeling and Verify execution as still-live, and pin it

**Files:**
- Modify: `plugin/skills/wrap-up/execution-and-verification.md:9` (the `**MULTISPEC_REVIEW_DEFER branch:**` paragraph)
- Test: `tests/wrap-up-multispec-defer-still-live.test.js`

**Interfaces:**
- Consumes: none
- Produces: none (leaf)

- [ ] **Step 1: Write the failing test** `tests/wrap-up-multispec-defer-still-live.test.js`:
  - `deferParagraph(text)`: `text.split(/\r?\n\r?\n/).filter((p) => p.startsWith('**MULTISPEC_REVIEW_DEFER branch:**'))`, `assert.strictEqual(matches.length, 1)`, returns `matches[0]`.
  - `PRE_CHANGE_PARAGRAPH`: string literal, the paragraph's current text, verbatim.
  - `CLAIMS`: an array of `{ id, pattern }`. Each test below runs `assertClaim(paragraph, claim)` (`assert.match(paragraph, claim.pattern)`), and the controls call the same function:
    - `AC1.1 acceptance labeling`: `/\*\*Acceptance labeling\*\* bullet below still runs for every spec/`
    - `AC1.1 #2970 citation`: `` /`_shared\/pr-run-comments\.md`'s "Multi-spec brief and timing comments \(#2970\)"/ ``
    - `AC1.1 verify execution`: `/\*\*Verify execution\*\* still runs/`
    - `AC1.1 deferred rows skip`: `` /`worktree-removed` and `run-dir-archived` rows read `skip \(deferred to parent console\)`/ ``
  - One positive test per claim, `AC1.1: …`: `assertClaim(deferParagraph(live), claim)`.
  - One go-red test per claim, `AC2.1: … goes red against the pre-change paragraph`: `assert.throws(() => assertClaim(PRE_CHANGE_PARAGRAPH, claim))`.
  - Scoping proof, `AC2.1: acceptance-labeling pin goes red when only its sentence is removed`. Drop the acceptance-labeling sentence from the live text in memory (`live.replace(SENTENCE, '')`, where `SENTENCE` is the first sentence of Step 3's text that begins `In particular`, asserted present in `live` first). Then `assert.throws(() => assertClaim(deferParagraph(doctored), CLAIMS[0]))`, while `doctored` still matches `/acceptance-labeling/`. A lookalike outside the paragraph therefore cannot carry the pin.
  - `Waived AC3.1: the full-suite pass is verified at /build Common Step 5 and /test, not by a test in this suite.`
  - CRLF: `deferParagraph(live.replace(/\n/g, '\r\n'))` still returns one paragraph.
  - Engine twin: `engine-verify.js` source contains `detail: 'deferred to parent console'` at least twice (`run-dir-archived` and `worktree-removed`).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/wrap-up-multispec-defer-still-live.test.js`
Expected: FAIL — the four claim tests and the scoping proof fail (the sentence is absent). The CRLF and engine-twin tests pass.

- [ ] **Step 3: Implement.** Append to the paragraph, after "…interact with parent-orchestrated cleanup.", exactly this text:

> The skip list covers those five cleanup items only — every other part of this step still runs per spec. In particular, the **Acceptance labeling** bullet below still runs for every spec (its Try it block, the oversight-floor gate, `--oversight-exempt`); `_shared/pr-run-comments.md`'s "Multi-spec brief and timing comments (#2970)" section keys each spec's brief to its own marker on the shared PR. **Verify execution** still runs too: its `worktree-removed` and `run-dir-archived` rows read `skip (deferred to parent console)`, because the defer protocol (`review-console-appendix.md`) recorded those items in `verify-expectations.json`'s `deferred` list.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/wrap-up-multispec-defer-still-live.test.js tests/wrap-up-verify-execution-pin.test.js tests/pr-run-comments.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/execution-and-verification.md tests/wrap-up-multispec-defer-still-live.test.js
git commit -m "Name acceptance labeling and verify as still-live under MULTISPEC_REVIEW_DEFER — refs #3400"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 is Step 3's paragraph, with the verify-row wording corrected per the premise reversal. Deliverable 2 is Step 1's suite. AC1 is pinned by the claim tests, AC2 is shown by Step 2's red run plus the scoping proof, and AC3 is the full `npm test` at Common Step 5.
- **Placeholders:** none.
