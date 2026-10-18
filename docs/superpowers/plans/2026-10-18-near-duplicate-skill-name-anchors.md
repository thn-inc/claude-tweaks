# Near-duplicate skill-name anchors (#3366) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop slash-command anchors such as `/flow` from scoring `body-anchor-overlap`, and require a near-duplicate candidate to fire at least 2 signals before `/specify` shaping automatically refuses a record.

**Architecture:** Widen `SKILL_ANCHOR_RE` in `near-duplicate.js` so a colon-less slash command counts as generic. Add a minimum-score floor of 2 to `shapingRefusal`, as a named exported constant. Then update every prose restatement of the refusal rule to name the floor, and pin it in the existing prose-conformance suite.

**Tech Stack:** Node 18+, `node --test`, markdown skill files.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T215713-record-3366/work/3366-spec.md` (materialized from GitHub issue #3366)

## Global Constraints

- The slash-command shape the spec names is `^/[a-z0-9:-]+$`. Every span it matches must be generic. The existing argument-carrying form (`/claude-tweaks:flow #3124 build`) must stay generic.
- Refusal floor: a candidate must score **at least 2 signals**. A score-1 candidate is surfaced only in the table and on the `**Related:**` line.
- Premise reversal (logged in `decisions.md`): #3141 (d78172d80) already requires `title-similarity` for a refusal and no longer reads `bot:in-progress`. Keep both rules. The floor is added on top of them, so a refusal now needs `title-similarity` plus at least one other signal, a `ready` candidate, and an in-flight build (live claim or open linked PR).
- Commit messages: `{Verb} {what} — {detail}`, body `refs #3366`, never `closes`/`fixes`.

## Review Focus

- A single-segment absolute path such as `/tmp` now matches the slash-command shape and becomes generic. This is acceptable because a one-segment absolute path names no repo file. A multi-segment path such as `/usr/bin/node` must stay an anchor. Task 1 pins both.
- A true duplicate whose title is near-identical but which shares no other signal is now surfaced only, not refused. This is the spec's intent, and Task 1's test names it.
- The shaping-mode.md fence pre-filters which candidates it reads claims for. It must apply the same floor, or it would spend `git fetch`/GraphQL reads on candidates that can never refuse. Task 2 adds `h.signals.length >= 2` to that filter, and the existing fence-execution test still runs offline.

---

### Task 1: Generic slash-command anchors and the refusal score floor

**Files:**
- Modify: `plugin/bin/lib/issues/near-duplicate.js` (`SKILL_ANCHOR_RE`, its comment block, `shapingRefusal` + its comment, the header comment, `module.exports`)
- Test: `tests/bin-lib/issues/near-duplicate.test.js`

**Interfaces:**
- Produces: `MIN_REFUSAL_SCORE` (number, `2`), exported from `near-duplicate.js`. `shapingRefusal(hits, stateByNumber)` keeps its signature. It now skips any hit whose `signals.length < MIN_REFUSAL_SCORE`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/issues/near-duplicate.test.js`. Import `MIN_REFUSAL_SCORE` too.
  - `'AC1.1: a pair sharing only /flow and /claude-tweaks:dispatch anchors fires no body-anchor-overlap'`: subject and record bodies whose `## Current State` mention only `` `/flow` `` and `` `/claude-tweaks:dispatch` ``, with unrelated titles and no Key Files. Assert `findNearDuplicates(subject, [record])` deep-equals `[]`.
  - `'AC2.1: a pair sharing a repo file-path anchor still fires body-anchor-overlap'`: same shape, plus a shared `` `plugin/skills/dispatch/task-prompt.md` ``. Assert the hits are `[[n, ['body-anchor-overlap']]]`.
  - Extend `'isGenericAnchor classifies each shape'`. Add `'/flow'`, `'/specify'`, `'/claude-tweaks:dispatch'` and `'/tmp'` to the generic list, and add `'/usr/bin/node'` and `'plugin/bin/lib/issues/near-duplicate.js'` to the kept list.
  - `'a score-1 title-similarity duplicate is surfaced, not refused (#3366)'`: `shapingRefusal([{ number: 9, signals: ['title-similarity'] }], { 9: LIVE })` is `null`, and `MIN_REFUSAL_SCORE === 2`.
  - Update the existing refusal tests whose positive hit is `signals: ['title-similarity']` (`'a true duplicate …'`, `'an open linked PR …'`, and hit `b` in `'shapingRefusal returns the first qualifying hit…'`) to `['title-similarity', 'key-files-overlap']`. That keeps them testing the in-flight and ready axes rather than the floor. Leave the negative tests as they are.

- [ ] **Step 2: Run the suite and confirm the new tests fail**

Run: `node --test tests/bin-lib/issues/near-duplicate.test.js`
Expected: FAIL. AC1.1 returns a `body-anchor-overlap` hit, `isGenericAnchor('/flow')` is false, and `MIN_REFUSAL_SCORE` is undefined.

- [ ] **Step 3: Implement**
  - Change `SKILL_ANCHOR_RE` to `/^\/[\w-]+(?::[\w-]+)*(?:\s.*)?$/`. It accepts one leading slash, one word segment, zero or more `:segment` parts and optional arguments. It never accepts a second `/`, so `/usr/bin/node` stays an anchor. Update the comment above it to say a skill invocation may be colon-less (`/flow`), citing #3366.
  - Add `const MIN_REFUSAL_SCORE = 2;` next to `shapingRefusal`. In `shapingRefusal`, `continue` when `hit.signals.length < MIN_REFUSAL_SCORE`, alongside the existing `title-similarity` check. Update its comment and the file-header comment to say the refusal needs a score of at least `MIN_REFUSAL_SCORE` (#3366). Export `MIN_REFUSAL_SCORE`.

- [ ] **Step 4: Run the suite and confirm it passes**

Run: `node --test tests/bin-lib/issues/near-duplicate.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/near-duplicate.js tests/bin-lib/issues/near-duplicate.test.js
git commit -m "Treat slash-command anchors as generic and floor shaping refusal at score 2 — near-duplicate finder (refs #3366)"
```

### Task 2: Name the score floor in every prose restatement and pin it

**Files:**
- Modify: `plugin/skills/specify/shaping-mode.md` (lines ~83-108 for the screen and refusal paragraphs, the fence's `numbers` filter at ~124, the "Only a title-similar…" paragraph at ~149, and the closing "one automatic refusal" sentence at ~176-179)
- Modify: `plugin/skills/specify/next-mode-shape.md:211-212`
- Modify: `plugin/skills/specify/shaping-mode-readback.md:98` (the `refused — …` outcome description)
- Modify: `docs/plugin-structure.md:28` (the `shapingRefusal` clause)
- Modify: `docs/journeys/shape-several-records-in-one-specify-call.md:39` (the `refused — …` clause)
- Test: `tests/specify-near-duplicate-prose.test.js`

**Interfaces:**
- Consumes: `MIN_REFUSAL_SCORE` (2) and the floored `shapingRefusal` from Task 1.

- [ ] **Step 1: Write the failing test** in `tests/specify-near-duplicate-prose.test.js`:
  - `'AC3.1/AC3.2: shaping-mode.md refusal paragraph names the minimum score of 2 (#3366)'`. Slice the section the way the existing #3141 test does. Assert it matches `/at least 2 signals/`, and that the old contradiction phrases `/never blocks shaping on its own signal alone/` and `/the one automatic\s+refusal the finder's signal authorizes on its own/` are gone. Then require the module and assert `MIN_REFUSAL_SCORE === 2`, so the prose and the constant cannot drift apart.
  - Extend `'next-mode-shape.md describes the same refusal condition (#3141)'` so its section also matches `/at least 2 signals/`.
  - In the existing fence-execution test, also check the new filter: assert the extracted fence code contains `h.signals.length >= 2`.

- [ ] **Step 2: Run the suite and confirm it fails**

Run: `node --test tests/specify-near-duplicate-prose.test.js`
Expected: FAIL on the three new assertions.

- [ ] **Step 3: Edit the prose**
  - `shaping-mode.md`: replace "the finder never blocks shaping on its own signal alone" with wording that it never blocks shaping on a single signal. In the `shapingRefusal` paragraph, state that it refuses only on a hit scoring **at least 2 signals** (`MIN_REFUSAL_SCORE`, #3366), `title-similarity` among them, whose candidate is `ready` and in flight, and that a score-1 candidate is surfaced in the table and the `**Related:**` line only. In the fence's `numbers` filter, add `h.signals.length >= 2 &&`. In the "Only a title-similar `ready` candidate can refuse" paragraph, add the 2-signal floor. Rewrite the closing "This is the one automatic refusal the finder's signal authorizes on its own" sentence so it no longer claims a single signal authorizes anything: "This is the one automatic refusal the finder's signals authorize — and only in combination, never a single signal."
  - In `next-mode-shape.md`, `shaping-mode-readback.md`, `docs/plugin-structure.md` and the journey doc, change "a title-similar, `ready` candidate" (or "a title-similar `ready` candidate") to "a title-similar, `ready` candidate scoring at least 2 signals". Edit in place and touch nothing else in those lines.

- [ ] **Step 4: Run the suites and confirm they pass**

Run: `node --test tests/specify-near-duplicate-prose.test.js tests/bin-lib/issues/near-duplicate.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/shaping-mode.md plugin/skills/specify/next-mode-shape.md plugin/skills/specify/shaping-mode-readback.md docs/plugin-structure.md docs/journeys/shape-several-records-in-one-specify-call.md tests/specify-near-duplicate-prose.test.js
git commit -m "Name the 2-signal refusal floor in shaping prose — reconcile the single-signal contradiction (refs #3366)"
```

AC4.1 (`npm test` passes) is covered by the build's Common Step 5 full-suite verification, not by a per-task step.

---

## Self-review

- **Spec coverage:** Deliverable 1 is covered by Task 1 (regex + AC1.1). Deliverable 2 is covered by Task 1 (the code floor) and Task 2 (the prose floor and the reconciled sentence). Deliverable 3 is covered by Task 1's AC1.1 and AC2.1 tests. AC3 is covered by Task 2, and AC4 by Common Step 5.
- **Placeholders:** none.
- **Byte headroom:** `shaping-mode.md` is 19,091 bytes and `next-mode-shape.md` is 22,383, both far below the 51,200 shared ceiling. No per-file or per-skill `specify` byte pin exists in `tests/`.
