# Red-Team Cross-AC Literal Check (#3463) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/specify`'s red-team pass flags an acceptance criterion whose mandated literal strings would trip a sibling criterion's negative grep / sweep pattern, as an `## Open Questions` row.

**Architecture:** One new deterministic section in `plugin/skills/specify/red-team.md`, placed directly after the existing "Path/URI/hostname/identity-guard detection" section and before "Parallel dispatch" — same shape (a pre-dispatch scan whose hit flows into the findings table and the write-back procedure). One conformance test pins the section's presence and wording, and proves its own fixture spec really carries the conflict the check describes.

**Tech Stack:** Markdown skill prose; `node --test` (built-in), CommonJS.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T065835-record-2933/spec-3463/work/3463-spec.md`

## Global Constraints

- The check's name, used verbatim in the heading and the test: `Cross-AC literal check`.
- Scope: for every AC that carries a negative grep or sweep pattern, test that pattern against every literal string the other ACs require to exist (fixtures, quoted code); a match is flagged as an `## Open Questions` row (spec Deliverable 1, verbatim intent).
- Placement: in `red-team.md`, as a sibling of the existing deterministic "Path/URI/hostname/identity-guard detection" section — runs before persona dispatch; never inside the Template A block (agents don't run it).
- `red-team.md` is 15,276 bytes — no ceiling pressure; keep the section to one heading plus ≤ ~1.2 KB of prose.
- Release note (spec): "No user-visible change; `/specify`'s red-team pass flags an acceptance criterion whose mandated fixtures would trip a sibling criterion's sweep."

## Review Focus

- A sibling AC whose pattern is a literal grep string (`grep -F`-style), not a regex — the check must say it tests both forms (literal substring and regex).
- An AC whose own literal trips its own sweep — out of scope (cross-AC only); the prose should say "other ACs".
- A record with no negative grep/sweep AC — the check is a no-op; the prose must say so, so it never invents a row.
- A fixture string inside a fenced code block in the AC — still counts as a required literal (the #3311 incident's literals were quoted code).
- The routing: a hit becomes an `## Open Questions` row (not a severity-ranked persona finding that could be dropped by the severity floor).

---

### Task 1: Add the Cross-AC literal check to red-team.md, pinned by a conformance test

**Files:**
- Modify: `plugin/skills/specify/red-team.md` (new `## Cross-AC literal check (deterministic, runs before persona dispatch)` section, inserted between the existing `## Path/URI/hostname/identity-guard detection …` section and `## Parallel dispatch`)
- Test: `tests/specify-red-team-cross-ac-literal-check.test.js` (new)

**Interfaces:**
- Produces: the heading text `## Cross-AC literal check (deterministic, runs before persona dispatch)` and the phrases the test pins (Step 1).

- [ ] **Step 1: Write the failing test** — `tests/specify-red-team-cross-ac-literal-check.test.js`, reading `plugin/skills/specify/red-team.md` from the repo (same style as the neighbouring `tests/specify-*-prose.test.js` files):
  - `AC1.1: red-team.md names the Cross-AC literal check` — the file contains the heading `## Cross-AC literal check (deterministic, runs before persona dispatch)`, and that section (heading to next `## `) contains `negative grep`, `sweep`, `every literal string`, `other ACs`, and `## Open Questions`.
  - Placement: the new heading's index is greater than the index of `## Path/URI/hostname/identity-guard detection` and less than the index of `## Parallel dispatch`.
  - `AC2.1: fixture spec trips its own sibling sweep` — an inline fixture spec string modeled on #3311: AC1 `No file under plugin/ matches \`grep -rn "CEILING_BYTES"\`.`, AC2 `The guard's self-test fixture contains \`const FOO_CEILING_BYTES = 30 * 1024\`.`. The test extracts AC1's grep pattern (`CEILING_BYTES`) and AC2's backtick-quoted literal, and asserts the pattern matches the literal (`new RegExp(pattern).test(literal)` is true) — proving the fixture exhibits exactly the conflict the section describes; and asserts a control fixture whose AC2 literal is `const FOO_LIMIT = 30 * 1024` does NOT match.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/specify-red-team-cross-ac-literal-check.test.js`
Expected: FAIL — heading not found (the fixture subtests may pass; the AC1.1 and placement subtests must fail).

- [ ] **Step 3: Add the section to `plugin/skills/specify/red-team.md`** — prose covering: when it runs (before persona dispatch, beside the path/URI guard scan); the scan (collect every AC carrying a negative grep or sweep pattern; collect every literal string the *other* ACs require to exist — quoted code, fixture text, fenced blocks included; test each pattern against each literal, as a literal substring and, when it is a regex, as a regex); no pattern-bearing AC → no-op, no row; a hit → one `## Open Questions` row naming both ACs, the pattern and the literal, flowing through the write-back procedure like a persona finding (decision-worthy → stage-or-ask per write-back step 5); one sentence of why (#3311: AC3's mandated fixtures `FOO_CEILING_BYTES = 30 * 1024` tripped AC1's `CEILING_BYTES` sweep and AC2's `N * 1024` grep, surfacing only at implementation and costing a ruling, a review finding and sweep amendments).
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/specify-red-team-cross-ac-literal-check.test.js tests/multi-agent-coordination.test.js tests/specify-staged-for-caller.test.js tests/subagent-contract-clauses.test.js`
Expected: PASS (the last three already read `red-team.md`).

- [ ] **Step 5: Prove the AC1.1 test goes red** — temporarily rename the new heading, re-run Step 2's command, confirm failure, restore. Never commit the reverted state.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/specify/red-team.md tests/specify-red-team-cross-ac-literal-check.test.js
git commit -m "Add the cross-AC literal check to specify's red-team pass — refs #3463"
```
