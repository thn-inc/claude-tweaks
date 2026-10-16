# skill-prose-conformance-tests Prose Fixes (#3016, #3133) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct two prose defects in the project-local `skill-prose-conformance-tests` skill — a drift-prone provenance clause (#3016) and a misquoted marker citation (#3133).

**Architecture:** Two independent in-place text edits to one Markdown file. No code, no behavior change. Verification is a scratch `grep -c -F` probe per edit (not committed — no test reads this file's content, and the repo keeps no tests for `.claude/skills/**` prose of this kind).

**Tech Stack:** Markdown; `grep`; `npm test` (full suite, run centrally after both tasks).

**Spec:** `.claude-tweaks/pipelines/2026-10-16T055343-record-3016/spec-3016/work/3016-spec.md`, `.claude-tweaks/pipelines/2026-10-16T055343-record-3016/spec-3133/work/3133-spec.md`

## Global Constraints

- Edit only `.claude/skills/skill-prose-conformance-tests/SKILL.md`.
- Edit in place; do not reformat or reword adjacent text.
- Commit messages use `{Verb} {what} — {detail}` and reference records with `refs #N`, never `closes`/`fixes`.

## Review Focus

- The Anti-Patterns table row must keep its two-cell pipe structure (leading `| `, cell separator ` | `, trailing ` |`) after the trailing sentence is removed — a dropped trailing pipe breaks the Markdown table.
- The #2540 paragraph's surrounding claims (the `git show {base}:{file} | grep -c -F '{marker}'` instruction, "all zero") must stay untouched — only the two quoted markers change.
- `**Policy gate.**` (the middle marker of the three) is already correct and must not change.
- No other occurrence of `exact-pin` in this file should be touched (there are none besides line 63; the probe confirms).

---

### Task 1: Drop the provenance clause from the "Reusing a fixture already frozen" Anti-Patterns row (#3016)

**Files:**
- Modify: `.claude/skills/skill-prose-conformance-tests/SKILL.md:221`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Probe the current text (scratch, not committed)**

Run: `grep -c -F 'still carries two such controls' .claude/skills/skill-prose-conformance-tests/SKILL.md`
Expected: `1`

- [ ] **Step 2: Confirm the probe fails the target state**

The target state requires that count to be `0`; Step 1's `1` is the expected-fail signal.

- [ ] **Step 3: Edit**

Replace the row's second cell ending:

```
vacuous either way. `tests/untrusted-record-content-conformance.test.js` still carries two such controls against `FROZEN_NEXT_MODE_BOUNDARY`; only #1276's was corrected, to `FROZEN_PRE_1276_SCOPE` — the pin's own pre-change text |
```

with:

```
vacuous either way. |
```

- [ ] **Step 4: Verify**

Run: `grep -c -F 'still carries two such controls' .claude/skills/skill-prose-conformance-tests/SKILL.md`
Expected: `0`

Run: `grep -c -F 'stays true after the pinned prose is deleted, vacuous either way. |' .claude/skills/skill-prose-conformance-tests/SKILL.md`
Expected: `1`

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/skill-prose-conformance-tests/SKILL.md
git commit -m "Trim provenance clause from frozen-fixture control anti-pattern — refs #3016"
```

---

### Task 2: Correct the #2540 worked example's quoted markers (#3133)

**Files:**
- Modify: `.claude/skills/skill-prose-conformance-tests/SKILL.md:63`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Probe the current text (scratch, not committed)**

Run: `grep -c -F 'exact-pin' .claude/skills/skill-prose-conformance-tests/SKILL.md`
Expected: `1` (line 63 only)

Run: `grep -c -F 'Exact-pin availability pre-check.' .claude/skills/skill-prose-conformance-tests/SKILL.md`
Expected: `1`

- [ ] **Step 2: Confirm the probe fails the target state**

The target state requires both counts to be `0`; Step 1's `1`s are the expected-fail signal.

- [ ] **Step 3: Edit**

Replace:

```
`## Availability (exact-pin, checked before any option is presented)` in `design-wrapper/modes/explore.md`, and `**Policy gate.**` / `**Exact-pin availability pre-check.**` in `specify/design-pre-steps.md`
```

with:

```
`## Availability (checked before any option is presented)` in `design-wrapper/modes/explore.md`, and `**Policy gate.**` / `**Availability pre-check.**` in `specify/design-pre-steps.md`
```

- [ ] **Step 4: Verify**

Run: `grep -c -F 'exact-pin' .claude/skills/skill-prose-conformance-tests/SKILL.md`
Expected: `0`

Run: `grep -c -F 'Exact-pin' .claude/skills/skill-prose-conformance-tests/SKILL.md`
Expected: `0`

Run: `grep -c -F '`## Availability (checked before any option is presented)` in `design-wrapper/modes/explore.md`, and `**Policy gate.**` / `**Availability pre-check.**` in `specify/design-pre-steps.md`' .claude/skills/skill-prose-conformance-tests/SKILL.md`
Expected: `1`

Cross-check against the test's own pins: `grep -c -F '## Availability (checked before any option is presented)' tests/design-variant-exploration-availability-order.test.js` → `1`; `grep -c -F '**Availability pre-check.**' tests/design-variant-exploration-availability-order.test.js` → `1`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/skill-prose-conformance-tests/SKILL.md
git commit -m "Correct misquoted markers in the #2540 ordering-claim example — refs #3133"
```

---

## Self-review

- **Spec coverage:** #3016 Deliverable/AC → Task 1. #3133 Deliverable/AC → Task 2.
- **Placeholders:** none.
- **Review Focus:** table-pipe integrity (Task 1 Step 4 second probe), untouched `**Policy gate.**` and surrounding sentence (Task 2 Step 4 full-span probe), no stray `exact-pin` (Task 2 Step 4).
