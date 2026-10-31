# Near-duplicate Related filter (#4702) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:specify` shaping appends to `**Related:**` only near-duplicate hits worth a reader's attention, while the candidate table keeps every hit.

**Architecture:** One pure predicate, `isRelatedCandidate(hit)`, in `near-duplicate.js`, composed from the existing `isStrongNearDuplicate` plus the `title-similarity` signal. `shaping-mode.md`'s Near-duplicate candidate check names it as the `**Related:**` filter. The finder's sort and `score` stay untouched (#4701 owns those).

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T124904-spec-4702-4703/spec-4702/work/4702-spec.md`

## Global Constraints

- Reuse `isStrongNearDuplicate` (2+ signals or 2+ shared anchors, `STRONG_NEAR_DUPLICATE_MIN`); never add a second threshold constant.
- Do not change `findNearDuplicates`' sort (`near-duplicate.js:199`), the `score` field, `shapingRefusal`, or `MIN_REFUSAL_SCORE` — #4701 (in flight) changes the sort and the report wording.
- `shaping-mode.md` is 20,301 B against the 52,500 B `RAIL_BYTES` rail; this plan adds under 600 B (headroom ~31.6 KB).
- Commit messages: `{Verb} {what} — {detail}`, `refs #4702`, ending with the `Claude-Session:` trailer.

## Review Focus

- A hit with no `sharedAnchors` field at all (a key-files-only or title-only hit) must not throw — `isStrongNearDuplicate` already tolerates it; the title-similarity branch must read `signals` defensively (pinned in Task 1's non-object/missing-field asserts).
- A title-similarity hit with zero anchors must still reach **Related:** (it is the one signal `shapingRefusal` keys on) — pinned in Task 1.
- The table must still list every hit — a filter applied to the table instead of the append would hide evidence (pinned in Task 2's prose assertions).
- The hits left off **Related:** must be named somewhere a human sees them — pinned in Task 2 (`Not added to Related` line).
- Other prose that restated the old "append every candidate" behavior (`shaping-mode.md:108`, `:183`, the #4702-touched journey changelog) must not keep contradicting the new rule — swept in Task 2.

---

### Task 1: `isRelatedCandidate` predicate

**Files:**
- Modify: `plugin/bin/lib/issues/near-duplicate.js` (add after `isStrongNearDuplicate`, ~line 216; export in `module.exports`, line 267)
- Test: `tests/bin-lib/issues/near-duplicate.test.js` (import at lines 5-18; new test after the `isStrongNearDuplicate` test at line 428)

**Interfaces:**
- Consumes: `isStrongNearDuplicate(hit) -> boolean` (same file).
- Produces: `isRelatedCandidate(hit) -> boolean`, exported. Task 2's prose names it.

- [ ] **Step 1: Write the failing test** — `test('AC2.1-AC2.5: isRelatedCandidate keeps strong or title-similar hits, drops one shallow signal', …)`:
  - `isRelatedCandidate({ score: 1, signals: ['body-anchor-overlap'], sharedAnchors: ['main'] })` → `false` (AC2.1, the #4606 `main` shape)
  - `isRelatedCandidate({ score: 1, signals: ['body-anchor-overlap'], sharedAnchors: ['a','b','c','d','e','f'] })` → `true` (AC2.2, the #3508 shape)
  - `isRelatedCandidate({ score: 1, signals: ['title-similarity'], sharedAnchors: [] })` → `true` (AC2.3)
  - `isRelatedCandidate({ score: 2, signals: ['key-files-overlap', 'body-anchor-overlap'], sharedAnchors: ['x'] })` → `true` (AC2.4)
  - `isRelatedCandidate(null)`, `isRelatedCandidate('x')`, `isRelatedCandidate({})`, `isRelatedCandidate({ score: 1 })` → `false` (AC2.5)
  - Add `isRelatedCandidate` to the import list.
- [ ] **Step 2: Run** `node --test tests/bin-lib/issues/near-duplicate.test.js` — Expected: FAIL (`isRelatedCandidate is not a function`).
- [ ] **Step 3: Implement** `function isRelatedCandidate(hit)` in `near-duplicate.js`: false for a non-object; true when `isStrongNearDuplicate(hit)` or `Array.isArray(hit.signals) && hit.signals.includes('title-similarity')`. A `// #4702:` comment above it naming why (Related feeds `/backlog refine`; one shallow anchor is noise; deep anchors and title similarity are not). Export it.
- [ ] **Step 4: Run** the same command — Expected: PASS. Then prove AC2.6 by mutation (scratch, not committed): temporarily make `isRelatedCandidate` return `true`, re-run, confirm the AC2.1 assert fails, restore.
- [ ] **Step 5: Commit** both files — `Add isRelatedCandidate near-duplicate predicate — strong or title-similar hits only (refs #4702)`.

### Task 2: Shaping prose names the filter

**Files:**
- Modify: `plugin/skills/specify/shaping-mode.md` (line 99-101 append sentence; line 107-108 "A score-1 candidate is surfaced in the table and the `**Related:**` line only"; line 183 "surfaced via the table and `**Related:**` append only")
- Modify: `docs/journeys/shape-several-records-in-one-specify-call.md` (append a `- Step 3 updated for #4702 (…)` line after the #1321 line at ~:86)
- Test: `tests/specify-near-duplicate-prose.test.js` (line 39 table test; line 130 verbatim pin of the score-1 sentence must be re-pointed)

**Interfaces:**
- Consumes: `isRelatedCandidate` (Task 1) — named in prose, and the prose test requires the module to export it.

- [ ] **Step 1: Write the failing test** — in `tests/specify-near-duplicate-prose.test.js`, a helper `assertRelatedFilterProse(section)` asserting on the Near-duplicate section (sliced as line 123-126 does):
  - `doesNotMatch(section, /append every candidate/)` (AC1.1)
  - `match(section, /isRelatedCandidate/)` and `match(section, /at least 2 signals or 2 shared(?: Current State)? anchors/)` and `match(section, /title-similarity/)` (AC1.2)
  - `match(section, /Not added to Related/)` (Review Focus)
  - `match(section, /\|\s*Record\s*\|\s*Score\s*\|\s*Signals\s*\|/)` and `match(section, /render every candidate|every candidate in the table|lists every (?:finder )?hit/)` (AC4.1)
  - `test('AC1.1/AC1.2/AC4.1: shaping-mode.md filters the Related append through isRelatedCandidate (#4702)', …)` calls the helper on the live section and asserts `typeof require('../plugin/bin/lib/issues/near-duplicate').isRelatedCandidate === 'function'`.
  - `test('AC3.1: the Related-filter pin fails against the old append-every-candidate sentence', …)` — rebuild the section with the new append sentence replaced by `append every candidate as \`#{n}\` to the composed body's \`**Related:**\` line` and `assert.throws(() => assertRelatedFilterProse(mutated))`.
  - Re-point line 130's verbatim score-1 pin to the new sentence (Step 3's wording).
- [ ] **Step 2: Run** `node --test tests/specify-near-duplicate-prose.test.js` — Expected: FAIL (the new test: `append every candidate` still present).
- [ ] **Step 3: Edit `shaping-mode.md`** in place (no reflow of neighbouring lines):
  - Line 99-101 becomes: render every candidate in the table; append to **Related:** only the hits `isRelatedCandidate` (`bin/lib/issues/near-duplicate.js`, #4702) accepts — at least 2 signals or 2 shared Current State anchors (`isStrongNearDuplicate`), or a `title-similarity` hit — and name the rest on one line under the table, `Not added to Related (one shallow signal): #a, #b`, so a human can still add one by hand. Keep "creating the line if the record doesn't already carry one".
  - Line 107-108: "A score-1 candidate is surfaced in the table (and on the `**Related:**` line when `isRelatedCandidate` accepts it) only;" — the rest of that sentence unchanged.
  - Line 183: "is surfaced via the table and, when `isRelatedCandidate` accepts it, the `**Related:**` append only," — rest unchanged.
  - Journey: `- Step 3 updated for #4702 (the **Related:** append keeps only hits isRelatedCandidate accepts — 2+ signals, 2+ shared anchors, or title similarity; the table still lists every hit)`.
- [ ] **Step 4: Run** `node --test tests/specify-near-duplicate-prose.test.js tests/bin-lib/issues/near-duplicate.test.js` — Expected: PASS. Then `git grep -n -F 'append every candidate' -- plugin tests` — Expected: matches only inside the test file's AC3.1 mutation literal.
- [ ] **Step 5: Commit** the three files — `Filter /specify's Related append through isRelatedCandidate — table keeps every hit (refs #4702)`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Task 1; Deliverable 2 → Task 2. AC1.1/AC1.2/AC4.1 → Task 2 Step 1; AC2.1-AC2.5 → Task 1 Step 1; AC2.6 → Task 1 Step 4 mutation proof (scratch by the spec's own wording, "fails against" a mutated predicate); AC3.1 → Task 2 Step 1's mutation test.
- Waived AC2.6: proved by Task 1 Step 4's scratch mutation (predicate forced to `true`, AC2.1 assert goes red, then restored) — a committed test cannot carry the mutated predicate.
- **Placeholders:** none.
- **Type consistency:** `isRelatedCandidate(hit) -> boolean` in both tasks.
- **Proportion:** two tasks, one module function and three prose sentences.
