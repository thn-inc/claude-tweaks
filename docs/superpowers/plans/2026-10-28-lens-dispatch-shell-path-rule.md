# Lens Dispatch Shell-Discipline Line (#3737) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review lens agents (and the Step 3.5/3.6 debate, refutation and gap-sweep agents) receive, verbatim in their prompt, the rule the harness worktree guard enforces: one plain Bash command per call, literal absolute paths, no shell-variable path, no `cd … &&`, no heredoc in a compound, Read/Grep for file reads.

**Architecture:** The rule gets one home: a verbatim `SHELL DISCIPLINE:` prompt line in `_shared/subagent-dispatch-core.md`'s existing **One plain command per Bash call** paragraph (part of the composed `review-dispatch` bundle). `review/step3-lens-dispatch.md`'s Working Directory Discipline note gains one sentence telling the orchestrator to inline that line verbatim into every such prompt, outside the byte-identical Calibration/Output block. The three literal prompt templates in `review/step3-debate-and-refutation.md` each gain one placeholder line for it. This mirrors the existing `READ-ONLY REVIEW:` line pattern exactly (#3001).

**Tech Stack:** Markdown skill prose; `node --test` conformance suite.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T070945-record-3737/work/3737-spec.md`

## Global Constraints

- The added sentence in `step3-lens-dispatch.md` goes in the dispatch rules, **outside** the byte-identical Calibration/Output block (`CALIBRATION (required):` … `Self-check before sending`, lines 118-149) — that block must not change.
- Dispatcher voice (plan-authoring Dispatcher-voice check): the `step3-lens-dispatch.md` sentence is addressed to the orchestrator and names where the line goes in the agent's prompt, matching its sibling `> **Read-only Reviewer Discipline:**` note — never addressed to the agent.
- Byte rail: `RAIL_BYTES` = 52,500. Measured at base `fbffbd0e3`: `step3-lens-dispatch.md` 49,905 B (95%, already `nearCeiling`), `step3-debate-and-refutation.md` 24,735 B, `subagent-dispatch-core.md` 32,177 B. The `step3-lens-dispatch.md` addition is one citing sentence (target ≤ 300 B, leaving ≥ 2,295 B headroom); the rule's wording lives only in `subagent-dispatch-core.md`. No byte cut or section move is needed.
- Commit messages: `{Verb} {what} — {detail}` style, `refs #3737`, never `closes`/`fixes`.

## Review Focus

1. A lens agent whose prompt the orchestrator built from the debate/refutation/gap-sweep templates literally — those templates must carry the placeholder, or the WDD note's "every such prompt" is unreachable for them (pinned: placeholder-count test, one per template).
2. The verbatim line drifting from the rule members the spec names — pinned member-by-member as literals, not "states the rule" (Dispatcher-voice check).
3. The line landing inside the byte-pinned Calibration block — pinned by a `doesNotMatch` over that slice.
4. A vacuous pin — the go-red control runs the same assertion function against a copy of the bundle with the line removed and expects it to throw.
5. Backticks inside the verbatim line breaking its inline-code span — the line is one single-backtick span with no inner backticks (asserted: the line matches `^\`SHELL DISCIPLINE: [^\`]+\`$`).

---

### Task 1: Add the SHELL DISCIPLINE line, its inline instruction, template placeholders, and the conformance test

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (after the **One plain command per Bash call.** paragraph, line 39)
- Modify: `plugin/skills/review/step3-lens-dispatch.md:56` (the `> **Working Directory Discipline:**` note)
- Modify: `plugin/skills/review/step3-debate-and-refutation.md` (one placeholder line after each `READ-ONLY REVIEW` placeholder, lines 37, 102 and 135)
- Test: `tests/review-lens-shell-discipline-conformance.test.js` (Create)

**Interfaces:**
- Consumes: `compose` from `plugin/bin/lib/compose-context/compose`, `readText` from `tests/helpers/read-skill` (same as `tests/review-lens-no-suites-conformance.test.js`).
- Produces: the literal prompt line prefix `SHELL DISCIPLINE:`; the placeholder text `[... SHELL DISCIPLINE line, verbatim from the review-dispatch bundle's Working Directory Discipline section ...]`.

- [ ] **Step 1: Write the failing test** `tests/review-lens-shell-discipline-conformance.test.js`, structured like `tests/review-lens-no-suites-conformance.test.js` (same `CONDITIONS`, `section()`, `reviewDispatchBundle()` helpers). Tests:
  - `AC1.1: the composed review-dispatch bundle carries the verbatim SHELL DISCIPLINE prompt line` — calls `assertShellLine(bundle)`, where `assertShellLine(text)` slices `## Working Directory Discipline`, finds the line containing `SHELL DISCIPLINE:`, and asserts each member as a literal: `/^`SHELL DISCIPLINE: [^`]+`$/` (whole line, one code span), `/one plain Bash command per call/`, `/literal absolute path/`, `/never a path held in a shell variable/`, `/never cd … &&/`, `/never a heredoc inside a compound command/`, `/Read and Grep tools/`.
  - `AC1.1 go-red: the line assertion fails on a bundle without the line` — `assert.throws(() => assertShellLine(bundle with every line containing "SHELL DISCIPLINE:" removed))`.
  - `AC1.1: step3-lens-dispatch.md instructs inlining the line, outside the byte-pinned Calibration block` — the `> **Working Directory Discipline:**` note line matches `/Inline the `SHELL DISCIPLINE:` line[^\n]*verbatim into every such prompt/` and `/outside the byte-identical Calibration\/Output block/`; the slice `CALIBRATION (required):` … `Self-check before sending` does not match `/SHELL DISCIPLINE/`.
  - `AC1.1: the debate, refutation, and gap-sweep templates each carry the SHELL DISCIPLINE placeholder` — same three anchor pairs as the READ-ONLY placeholder test in `review-lens-no-suites-conformance.test.js`, exactly one match each of the placeholder text above.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-lens-shell-discipline-conformance.test.js`
Expected: FAIL — no `SHELL DISCIPLINE:` line in the bundle (the go-red test passes; the other three fail).

- [ ] **Step 3: Implement**
  - `subagent-dispatch-core.md`, new paragraph directly after line 39 (blank line before and after):
    `Inline this line verbatim into every such dispatch prompt, outside any byte-pinned Calibration/Output block:`
    then, as its own paragraph, exactly:
    `` `SHELL DISCIPLINE: run one plain Bash command per call and spell every path as a literal absolute path — never a path held in a shell variable (W="…"; sed -n … "$W/…"), never cd … &&, never a heredoc inside a compound command — and read files with the Read and Grep tools, not cat or sed -n.` ``
  - `step3-lens-dispatch.md` line 56: append, after `See also `_shared/git-discipline.md`.`, the sentence:
    `Inline the `SHELL DISCIPLINE:` line from that bundle's (or, standalone, `_shared/subagent-dispatch-core.md`'s) **One plain command per Bash call** rule verbatim into every such prompt, alongside the scope and outside the byte-identical Calibration/Output block below.`
  - `step3-debate-and-refutation.md`: after each of the three `[... READ-ONLY REVIEW line, verbatim … ...]` lines, add `[... SHELL DISCIPLINE line, verbatim from the review-dispatch bundle's Working Directory Discipline section ...]` with the same line prefix as the READ-ONLY line it follows (`>    ` at 37 and 102 — 102 followed by a `>` blank line to match its neighbours; no prefix at 135, followed by a blank line).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/review-lens-shell-discipline-conformance.test.js tests/review-lens-no-suites-conformance.test.js tests/review-dispatch-composition.test.js tests/dispatch-prompt-bundle-citations.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, 0 failures. Then `wc -c plugin/skills/review/step3-lens-dispatch.md` ≤ 50,205.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/subagent-dispatch-core.md plugin/skills/review/step3-lens-dispatch.md plugin/skills/review/step3-debate-and-refutation.md tests/review-lens-shell-discipline-conformance.test.js
git commit -m "Add SHELL DISCIPLINE prompt line for review dispatches — refs #3737"
```

Waived AC2.1: "The skill-prose conformance suites pass (`npm test`)" is covered by Common Step 5's full verification run, not a per-task test.

---

## Self-review

- **Spec coverage:** Deliverable 1 (sentence in `step3-lens-dispatch.md`'s dispatch rules, outside Calibration/Output) → Step 3 bullet 2; Deliverable 2 (fold the rule into `subagent-dispatch-core.md`'s WDD once, cited from the review file) → Step 3 bullet 1; AC1.1 → four tests in Step 1; AC2.1 → waived to Common Step 5.
- **Placeholders:** none.
