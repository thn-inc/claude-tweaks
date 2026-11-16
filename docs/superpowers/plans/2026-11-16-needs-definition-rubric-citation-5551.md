# Needs-Definition Rubric Citation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `_shared/needs-definition-judgment.md` the one statement of the needs-definition rubric and have `/capture` and `/feedback` cite it instead of restating it.

**Architecture:** Markdown-only. The shared file absorbs the two points only the copies state (the unsure default, the `solution:unjustified` comparison) plus a scope sentence and the canonical verdict words. Each producer replaces its restated rubric with one read instruction and its own verdict mapping. `docs/skill-graph.md` gains one edge per producer.

**Tech Stack:** Markdown skill files; `git grep` checks; `node --test` suite (`npm test`).

**Spec:** `.claude-tweaks/pipelines/2026-11-15T231106-spec-5550-5551/spec-5551/work/5551-spec.md`

Scope keywords: needs-definition-judgment, Judging Definition, genuine open choice, two or more viable directions

## Global Constraints

- Where the three texts differ only in wording, the shared file's wording wins; the copies' "no stated preference" phrase is not carried over — "no tradeoff decided" is the test (spec Non-Goals).
- Keep the heading `### Judging Definition` in `capture/SKILL.md` byte-exact; seven places cite it: `capture/SKILL.md:33`, `:64`, `:77`, `:341`, `capture/batch-mode.md:22`, `capture/routing.md:40`, `_shared/work-record-permission-matrix.md:25`. None of them is edited.
- Keep the word "Definition" in `feedback/SKILL.md`'s Step 1 sentence — `feedback/SKILL.md:364` says "Step 1's Definition judgment".
- Write the citation as the path `_shared/needs-definition-judgment.md` (a file citation, not a skill invocation — no `/claude-tweaks:` form).
- No inline fallback copy of the rubric in either producer.
- `plugin/skills/capture/SKILL.md` must end no larger than 44,800 bytes and `plugin/skills/feedback/SKILL.md` no larger than 32,496 bytes (baselines measured at this branch's HEAD with `wc -c`).
- Keep the sentence "Both producers cite this file" (in the shared file's opening paragraph, currently wrapped as "Both producers cite this file rather than each / inventing its own interpretation of the distinction.").
- Use `git grep -F` / `-w` / `-P` only; `git grep -E` with `\b` silently matches nothing on the maintainer's machine.
- Governing skill `.claude/skills/shared-contract-extraction/SKILL.md` (wiring a consumer to an existing contract), quoted rules that apply:
  - "**Update the edges, once.** Every skill relationship is stated once in `docs/skill-graph.md` (CLAUDE.md's Cross-references rule). A new `_shared` file means adding its consumer edges there and adding nothing to any `SKILL.md`'s relationship prose."
  - "**The contract owns recognition and policy; consumers own outcomes.** Never let the extracted contract dictate what a consumer *does* about a condition it recognizes — only how it recognizes and classifies it."
  - "**Cite, don't restate — including in the same author's own later prose.**"
  - "also grep the contract file's own self-description ("sole consumer", "only X reads this", "no consumer yet") and update it alongside its `docs/skill-graph.md` row" — here the self-description "Both producers cite this file" becomes true and stays.
  - Departure, decided by the spec: that skill's "A later consumer also still owes step 5's conformance pin" bullet is not followed. The spec's Technical Approach rules "No conformance test is added: criterion 1's grep is the check that both producers cite the file, and the shared file's own sentence "Both producers cite this file" is the invariant a later change must keep." This plan follows the spec.

## Review Focus

- A reader of `capture/SKILL.md` who never opens the shared file: the read instruction must sit in the sentence that starts the judgment, so it cannot be skipped by reading only the mapping (Task 2, Step 3 check).
- The unsure case: after the copies go, the shared file must be the place that says what to do when unsure (Task 1, Step 2 check for "When unsure").
- The override path in capture (`--needs-definition` / `--no-needs-definition`) must still skip the judgment and render without a rationale — the override sentence and the presentation text are untouched (Task 2, Step 3 diff check).
- Feedback's Step 5 still receives a verdict and a rationale — the "When `Needed`, form a one-line rationale … feed Step 5's draft" sentence stays (Task 2, Step 3 diff check).
- Load closure: the new citation adds the shared file to `/capture`'s and `/feedback`'s load closures; a roster or budget check elsewhere may count the edge (`npm test -- --full` at /build Common Step 5).

---

### Task 1: Make the shared file the full rubric

**Role:** transcription

**Files:**
- Modify: `plugin/skills/_shared/needs-definition-judgment.md:1-27`

**Interfaces:**
- Produces: canonical verdict words `needed` and `clear`, and the sentence that each producer maps them to its own variable or rendering — Task 2's mappings name these two words.

- [ ] **Step 1: Run the AC3.1 verification to see it fail**

Run: `git grep -n -F "When unsure" -- plugin/skills/_shared/needs-definition-judgment.md`
Expected: no output, exit 1 (AC3.1: no unsure default today).
Run: `git grep -n -F "solution:unjustified" -- plugin/skills/_shared/needs-definition-judgment.md`
Expected: no output, exit 1 (AC3.1: no comparison today).

- [ ] **Step 2: Edit the file**

Keep the title, the opening paragraph (including "Both producers cite this file"), the `## Worked examples` section and its three bullets, and the "Ask: does the idea, as stated, leave more than one viable direction with no tradeoff decided?" paragraph with its incidental sub-decisions clause, all unchanged in substance. Make these changes:

1. Replace the paragraph "This is a content judgment, not a structural heuristic — no line-count or keyword check. See …" so its first sentence reads: "This is a content call, not a structural heuristic — no line-count or keyword check, the same posture `solution:unjustified`'s judgment takes." Keep its two `See …` citations after it.
2. Add, before `## Worked examples`, a paragraph: "The rubric applies to a captured idea (`/claude-tweaks:capture`) or a feedback learning (`/claude-tweaks:feedback`). Its verdicts are `needed` and `clear`; each producer maps them to its own variable or rendering."
3. Append to the `## Applying the rubric` paragraph: "When unsure, `clear`: `needed` only when the idea genuinely names an undecided choice."

- [ ] **Step 3: Run the AC3.1 verification to see it pass**

Run: `git grep -n -F -e "When unsure" -e "solution:unjustified" -e "more than one viable direction" -e "incidental" -e "Both producers cite this file" -- plugin/skills/_shared/needs-definition-judgment.md`
Expected: one line for each of the five patterns (AC3.1; AC2.1's shared-file half).
Run: `grep -c "^- \*\*" plugin/skills/_shared/needs-definition-judgment.md`
Expected: `3` (AC3.1: the three worked examples kept).

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/_shared/needs-definition-judgment.md
git commit -F {message-file}
```
Subject: `Make the needs-definition rubric self-sufficient — add the unsure default, the content-call comparison and the verdict words`, body `refs #5551` then the session line.

### Task 2: Cite the rubric from capture and feedback

**Role:** transcription

**Files:**
- Modify: `plugin/skills/capture/SKILL.md:417-422`
- Modify: `plugin/skills/feedback/SKILL.md:71-76`

**Interfaces:**
- Consumes: Task 1's verdict words `needed` / `clear`.

- [ ] **Step 1: Run the AC1.2 and AC2.1 verification to see it fail**

Run: `git grep -n -F "needs-definition-judgment.md" -- plugin/skills/capture/SKILL.md plugin/skills/feedback/SKILL.md`
Expected: no output, exit 1 (AC1.2).
Run: `git grep -n -F "two or more viable directions" -- plugin/skills`
Expected: two lines, `plugin/skills/capture/SKILL.md:418` and `plugin/skills/feedback/SKILL.md:72` (absence-grep control for AC2.1: the search matches its target before the change).

- [ ] **Step 2: Edit `capture/SKILL.md`**

In `### Judging Definition`, replace the text from "Otherwise, judge from the idea's content in this same turn:" through "default `false` (clear) otherwise." with exactly:

"Otherwise, read `_shared/needs-definition-judgment.md` and judge the idea's content by it in this same turn: `needed` sets `$NEEDS_DEFINITION` to `true`, `clear` to `false`."

The override sentence before it ("When `--needs-definition` … (the human already decided).") and everything from "When `true`, form a one-line rationale" onward stay byte-identical. The heading line stays byte-identical. Re-wrap only the edited paragraph's lines.

- [ ] **Step 3: Edit `feedback/SKILL.md`**

Replace the text from "does this learning name a genuine open choice" through "`Clear` otherwise." with exactly:

"read `_shared/needs-definition-judgment.md` and judge the learning by it in this same turn: `needed` renders `Needed`, `clear` renders `Clear`."

"Also judge Definition:" stays as the lead-in; "When `Needed`, form a one-line rationale naming the open choice — this and the verdict feed Step 5's draft." stays.

- [ ] **Step 4: Run the AC1.1, AC2.1, AC4.1 and AC5.1 verification to see it pass**

Run: `git grep -n -F "needs-definition-judgment.md" -- plugin/skills/capture/SKILL.md plugin/skills/feedback/SKILL.md`
Expected: exactly one line in each file (AC1.1).
Run: `git grep -n -F "two or more viable directions" -- plugin/skills`
Expected: no output, exit 1 (AC2.1).
Run: `git grep -n -F "more than one viable direction" -- plugin/skills`
Expected: one line, in `plugin/skills/_shared/needs-definition-judgment.md` (AC2.1).
Run: `git grep -n -F "### Judging Definition" -- plugin/skills/capture/SKILL.md`
Expected: one line (AC4.1).
Run: `git diff --stat HEAD -- plugin/skills/capture/batch-mode.md plugin/skills/capture/routing.md plugin/skills/_shared/work-record-permission-matrix.md plugin/skills/_shared/work-record.md plugin/skills/specify/next-mode.md evals/scenarios/capture-shaped-body-needs-definition.yaml tests/work-record-needs-decision-conformance.test.js`
Expected: no output (AC4.1: citers unedited; the last four are Check B scope-keyword hits that describe the label or cite the heading, out of scope per the spec's Non-Goals, verified unedited here; the four citing lines inside `capture/SKILL.md` are outside the edited span — confirm with `git diff -U0 HEAD -- plugin/skills/capture/SKILL.md` showing hunks only inside `### Judging Definition`).
Run: `wc -c plugin/skills/capture/SKILL.md plugin/skills/feedback/SKILL.md`
Expected: capture ≤ 44800, feedback ≤ 32496 (AC5.1).
Run: `git grep -n -F "Step 1's Definition judgment" -- plugin/skills/feedback/SKILL.md` and `git grep -n -F "Also judge Definition:" -- plugin/skills/feedback/SKILL.md`
Expected: one line each.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/capture/SKILL.md plugin/skills/feedback/SKILL.md
git commit -F {message-file}
```
Subject: `Cite the shared needs-definition rubric from capture and feedback — drop their restated copies`, body `refs #5551` then the session line.

### Task 3: Add the two skill-graph edges

**Role:** transcription

**Files:**
- Modify: `docs/skill-graph.md` (`## capture` table, lines 135-153; `## feedback` table, lines 307-322)

- [ ] **Step 1: Run the AC6.1 verification to see it fail**

Run: `awk '/^## capture$/{s=1;next} /^## /{s=0} s' docs/skill-graph.md | grep -c -F "needs-definition-judgment.md"` and the same with `feedback`.
Expected: `0` for each (AC6.1).

- [ ] **Step 2: Add the rows**

Under `## capture`, directly after the `_shared/dependency-narration-check.md` row:
"| `_shared/needs-definition-judgment.md` | `### Judging Definition` reads this rubric for the `needs:definition` verdict and maps `needed`/`clear` to `$NEEDS_DEFINITION`; the override flags, rationale and presentation line stay capture's own. |"

Under `## feedback`, directly after the `_shared/learning-routing.md` row:
"| `_shared/needs-definition-judgment.md` | Step 1's Definition judgment reads this rubric and renders its `needed`/`clear` verdict as `Needed`/`Clear` for Step 5's draft. |"

Leave the `## specify` row (currently `:617`) unchanged.

- [ ] **Step 3: Run the AC6.1 verification to see it pass**

Same two commands as Step 1. Expected: `1` for each (AC6.1).

- [ ] **Step 4: Commit**

```bash
git add docs/skill-graph.md
git commit -F {message-file}
```
Subject: `Record capture and feedback's edges to the needs-definition rubric in the skill graph`, body `refs #5551` then the session line.

Waived docs/skill-authoring.md: the spec's Technical Approach cites it for the cite-don't-restate rule; the build only reads it.

Waived AC7.1: `npm test -- --full` is proven by /claude-tweaks:build Common Step 5's verification run and the PR's CI, not by a per-task step.
