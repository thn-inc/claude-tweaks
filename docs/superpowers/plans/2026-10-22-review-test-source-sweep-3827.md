# Review /test --source sweep (#3827) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace #3771's point pins with one file-wide sweep over `plugin/skills/review/*.md` that classifies every backticked `/claude-tweaks:test` span and requires `--source review` on every invocation review itself makes.

**Architecture:** One new `node --test` suite holding a line-based classifier (span extraction, invocation-verb test, two hand-off exemptions) plus a directory sweep that takes its root as a parameter, so the go-red control runs the identical walk over a temp copy of the live review directory with one bare invocation appended. The sweep's first catch, the Important Notes line in `code-mode-steps.md`, gets the flag.

**Tech Stack:** Node 18+, `node:test`, `node:assert`, `tests/helpers/read-skill.js`'s `readText`.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T194951-record-3827/work/3827-spec.md` (materialized from GitHub issue #3827)

## Global Constraints

- Read every governed markdown file through `readText()` from `tests/helpers/read-skill.js` (CRLF-safe, #2763).
- No allowlist of line numbers anywhere in the suite (AC2.1).
- Expected counts in assertions are literals, never derived from production constants.
- Reads the live corpus deliberately: the convention must hold for every future addition (skill-prose-conformance-tests Decision Framework row "A documented convention this project wants enforced against every future addition") — say so in the header comment.

## Review Focus

- A future invocation written with a gerund or capitalised verb ("Re-running", "Run") — the verb regex is case-insensitive and covers `-ing`/`-s` forms; tested by minimal pairs.
- A span inside a fenced block mispairing with an inline span — fences are skipped before span extraction; tested by a fence-carrying input whose inner span is not reported.
- `/claude-tweaks:test-something` (a different token prefix-matching) — span must be `/claude-tweaks:test` followed by end or a space; tested.
- An exemption that silently stops firing (heading reworded, `(pipeline)` dropped) — floors on live hand-off count make that red rather than vacuously green.
- A CRLF checkout — `readText` normalizes; the walker reads only through it.

---

### Task 1: File-wide `--source review` sweep + fix its first catch

**Files:**
- Create: `tests/review-test-source-sweep-conformance.test.js`
- Modify: `plugin/skills/review/code-mode-steps.md:402` (Important Notes: `Run \`/claude-tweaks:test\` to verify.` → `Run \`/claude-tweaks:test --source review\` to verify.` — the same command Step 1.5's standalone gate auto-triggers; no test pins this line, `git grep -F "broken code blocks the entire review" -- tests plugin docs` hits only the line itself)

**Interfaces:**
- Produces (test-local, not exported): 
  - `classifySpans(text: string) -> Array<{ line: number, span: string, kind: 'invocation' | 'handoff' | 'mention', reason: string }>`
  - `offendersIn(text: string) -> Array<{ line: number, span: string }>` — `kind === 'invocation'` spans lacking `--source review`
  - `sweepDir(root: string) -> Array<{ file: string, line: number, span: string }>` — every `*.md` directly in `root` (non-recursive; the review dir has no subdirectories), read via `readText`
  - `assertNoOffenders(root: string)` — `assert.deepStrictEqual(sweepDir(root), [], …)` with a message listing each `file:line span`

**Classification rule (write it verbatim-in-substance as the suite's header comment):**
1. Fenced blocks (lines opening/closing with optional indent + ```` ``` ```` or `~~~`) are skipped. Inline spans are extracted per line with `` /`([^`\n]+)`/g ``. A span is a `/test` span when its content matches `/^\/claude-tweaks:test(?:\s|$)/`.
2. **Invocation** — the line text before the span's opening backtick ends (case-insensitive) with an invocation verb then whitespace: `(?:auto-|re-?)?(?:run|runs|running|trigger|triggers|triggering|invoke|invokes|invoking)\s+$`, or `re-?verif(?:y|ies|ying)\s+with\s+$`. Anything else is a **mention** (a description, a table cell naming the skill, a Next Actions suggestion, a parenthetical citation).
3. **Hand-off** (an invocation review itself does not make — no flag required):
   - (a) STOP: `**STOP**` appears earlier on the same line — review has halted; whoever resumes runs `/test` standalone.
   - (b) Pipeline: the nearest preceding heading contains `` `/claude-tweaks:flow` pipeline ``, or the line is a table row (`|`-led) whose first cell contains `(pipeline)` — `$PIPELINE_RUN_DIR` is `/test`'s primary parent signal and `--source` only the standalone fallback (`plugin/skills/test/SKILL.md` Component-Skill Contract).
4. Every remaining invocation's span must contain `--source review`.

- [ ] **Step 1: Write the failing test** — `tests/review-test-source-sweep-conformance.test.js` with these tests (assertions as stated):
  - `AC1.1: sweeping plugin/skills/review/*.md finds no invocation without --source review` → `assertNoOffenders(REVIEW_DIR)`.
  - `AC1.1 (go-red): appending a bare invocation to a copy of code-mode-steps.md turns the sweep red` → `fs.mkdtempSync(path.join(os.tmpdir(), 'ct-3827-'))`, copy every `*.md` from `REVIEW_DIR`, append `\nThen re-run \`/claude-tweaks:test\` before proceeding.\n` to the copy of `code-mode-steps.md`, `assert.throws(() => assertNoOffenders(tmp), /code-mode-steps\.md/)` and `assert.strictEqual(sweepDir(tmp).length, 1)`; `fs.rmSync(tmp, { recursive: true, force: true })` in `finally`.
  - `AC2.1: Step 1.5's gate table names /test without the flag and stays green with no line allowlist` → slice `code-mode-steps.md` from `### Gate:` to `> **Why this gates review` (assert both anchors `!== -1`), `classifySpans(slice)` has ≥ 4 `/test` spans (literal `4`), `offendersIn(slice)` deep-equals `[]`, and its kinds include both `'handoff'` and `'mention'`.
  - `the live corpus exercises every branch` → over the concatenated review dir: invocations ≥ 10, hand-offs ≥ 5, mentions ≥ 10 (literals) — floors so a broken extractor or an exemption that stopped firing cannot pass vacuously.
  - Minimal-pair helper proofs (each one claim; the control differs from the positive case only in the pinned thing), all via `classifySpans`/`offendersIn`:
    - `"Then re-run \`/claude-tweaks:test\` before proceeding."` → 1 offender; same with `--source review` → 0 offenders, 1 invocation.
    - `"Re-running \`/claude-tweaks:test\` now."` and `"Run \`/claude-tweaks:test qa\` to check."` → 1 offender each (case/gerund).
    - `"re-verifies with \`/claude-tweaks:test\`"` → 1 offender.
    - `"| failed | **STOP** — fix, then re-run \`/claude-tweaks:test\` |"` → 0 offenders, kind `handoff`; same line without `**STOP**` → 1 offender.
    - `"| \`TEST_PASSED=true\` (pipeline) | re-trigger \`/claude-tweaks:test\` |"` → 0; same without `(pipeline)` → 1.
    - `"### In \`/claude-tweaks:flow\` pipeline:\n\nre-trigger \`/claude-tweaks:test\` once."` → 0; same under `"### Standalone:"` → 1.
    - `"Verify that \`/claude-tweaks:test\` has passed."` → 0 offenders, 1 mention.
    - `"re-run \`/claude-tweaks:test-foo\`"` → 0 `/test` spans.
    - ```` "```\nre-run `/claude-tweaks:test`\n```" ```` → 0 `/test` spans (fence skipped).
    - `"intro\r\nThen re-run \`/claude-tweaks:test\` now.\r\n"` → 1 offender, reported on line 2 (the classifier splits on `/\r?\n/`).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-test-source-sweep-conformance.test.js`
Expected: FAIL — `AC1.1: sweeping plugin/skills/review/*.md …` reports `code-mode-steps.md:402 /claude-tweaks:test` (the Important Notes line); every other test passes.

- [ ] **Step 3: Implement** — add ` --source review` inside the span on `plugin/skills/review/code-mode-steps.md:402`. Nothing else in `plugin/` changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/review-test-source-sweep-conformance.test.js tests/review-qa-rerun-after-fix-wave-conformance.test.js`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Commit**

```bash
git add tests/review-test-source-sweep-conformance.test.js plugin/skills/review/code-mode-steps.md
git commit -m "Sweep review step files for bare /test invocations — refs #3827"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (sweep + classification) → Task 1 Step 1 sweep tests; Deliverable 2 (rule written in the test, go-red proof per `skill-prose-conformance-tests`) → header comment + temp-dir walker control + minimal pairs; AC1.1 → go-red temp-copy test; AC2.1 → gate-table slice test.
- **Placeholders:** none.
- **Headroom:** `code-mode-steps.md` 48,291 B + 17 B against `RAIL_BYTES` (~52.5 KB) — ample.
