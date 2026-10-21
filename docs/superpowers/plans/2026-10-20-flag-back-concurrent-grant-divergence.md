# Flag-back Concurrent-grant Divergence Logging (#3324) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `/claude-tweaks:backlog refine`'s Step 5 pre-write reverify drops a flag-back row because a concurrent actor granted `auto:build`, log whether that grant agreed with or diverged from this run's own `RECOMMEND_BUILD` verdict, instead of the generic skip line.

**Architecture:** This is a prose-only change in two skill files, mirroring #2719's grant-row comparison. `refine-mode.md` Step 5 gets one routing sentence, and `refine-closing-summary.md` gets two skip templates plus a "Flag-back concurrent-grant comparison" paragraph. A new conformance test pins all of it, with go-red probes against the pre-change text.

**Tech Stack:** Markdown skill prose and the `node --test` conformance suite.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T180040-record-3324/work/3324-spec.md` (materialized from GitHub issue #3324)

Scope keywords: concurrent grant DIVERGED, RECOMMEND_BUILD

## Global Constraints

- Commit message style: `{Verb} {what} — {detail}`, body `refs #3324` (never `closes`/`fixes`).
- Byte rail: `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). `refine-mode.md` is 42,671 B now, about +260 B after this change (~9.5 KB headroom). `refine-closing-summary.md` is 13,359 B now, about +1.9 KB after (~37 KB headroom). Neither is near the rail.
- The existing `tests/backlog-refine-grant-divergence.test.js` (#2719) must stay green unchanged. Keep these literals intact: the `refine-closing-summary.md`'s Concurrent-grant comparison` citation in `refine-mode.md`, the grant-row templates, `grep 'concurrent grant DIVERGED' "$PIPELINE_RUN_DIR/decisions.md"`, and the sentence `A grant row skipped for any other reason (lost `ready`, a live-state fetch failure) keeps the generic line`.
- The `closing-tally.js` skip classifier matches `/Backlog refine: skipped #/` (`plugin/bin/lib/closing-tally/closing-tally.js:41`). New templates must keep the `Backlog refine: skipped #{n} — premise changed since confirmation (` prefix so they count as `skipped`.

## Review Focus

- **No-verdict flag-back row** (Step 3's `no verdict rendered` outcome) that gained `auto:build`: it has no `RECOMMEND_BUILD` to compare against, so it must keep the generic line with a named `{what changed}`. It must never read "agreed" or "DIVERGED". Pinned in Task 1, test AC1.1 (no-verdict carve-out).
- **Flag-back row whose verdict was `RECOMMEND_BUILD: true`.** A Step 3.5 body-shape downgrade, a needs-scoring row, or a human override can each flag back a row whose verdict was `true`. Comparing against the flag-back *reason* instead of the verdict would mislabel it. Pinned in Task 1 (judges-verdict test).
- **Gained `risk:*`/`size:*`/`bot:in-progress` only (no `auto:build`)**, or a live-state fetch failure: keeps the generic line. Pinned in Task 1 (generic-line test).
- **Grep collision.** The grant-row sweep `grep 'concurrent grant DIVERGED'` also matches flag-back DIVERGED lines; that is intended, since one sweep then lists every divergence. The flag-back-only grep must match neither the grant-row DIVERGED line nor the flag-back agreed line. Pinned in Task 1, test AC2.1, against the instantiated templates.
- **Tally classification.** The new lines must count as `skipped`, never `unclassified`. Pinned in Task 1 through `computeClosingTally`.

---

### Task 1: Flag-back concurrent-grant comparison

**Files:**
- Modify: `plugin/skills/backlog/refine-mode.md` (Step 5 "Pre-write reverify" paragraph, line 343)
- Modify: `plugin/skills/backlog/refine-closing-summary.md` (template block lines 17-28; Concurrent-grant comparison paragraph line 32, plus a new paragraph after it)
- Test: `tests/backlog-refine-flagback-divergence.test.js` (create)

**Interfaces:**
- Consumes: `computeClosingTally(text) -> { counts, unclassified }` from `plugin/bin/lib/closing-tally/closing-tally.js` (existing export, used the same way in `tests/bin-lib/closing-tally/closing-tally.test.js`).
- Produces: two template literals that later readers grep for:
  - `(flag-back concurrent grant agreed: live {live grant}, this run RECOMMEND_BUILD=true)`
  - `(flag-back concurrent grant DIVERGED: live {live grant}, this run discarded RECOMMEND_BUILD=false — {grant-check RATIONALE})`

- [ ] **Step 1: Write the failing test** `tests/backlog-refine-flagback-divergence.test.js`

Follow `tests/backlog-refine-grant-divergence.test.js`'s shape: read both files, use a `pinned(text, pattern, pre, message)` helper (assert `match` on live text, `doesNotMatch` on the pre-change probe), and copy the pre-change probes verbatim from the current files:

```js
const PRE_REVERIFY = "A grant row dropped for a gained grant logs whether that concurrent grant agreed with this run's own verdict — `refine-closing-summary.md`'s Concurrent-grant comparison (#2719). Flag-back reverify checks labels only";
const PRE_TEMPLATES = /* the three current `AUTO {time} — Backlog refine: skipped #{n} …` lines plus "\nFAILED {time}", verbatim from refine-closing-summary.md lines 24-27 */;
```

Tests, named by AC clause id:

1. `AC1.1: refine-mode.md routes a flag-back row that gained auto:build to the flag-back comparison`:
   `pinned(refineMode, /A flag-back row dropped for a gained `auto:build` logs the same comparison against its own `RECOMMEND_BUILD` verdict — `refine-closing-summary\.md`'s Flag-back concurrent-grant comparison \(#3324\)/, PRE_REVERIFY, …)`
2. `AC1.1: closing summary carries distinguishable flag-back agreed and DIVERGED templates`:
   - `pinned(closing, /Backlog refine: skipped #\{n\} — premise changed since confirmation \(flag-back concurrent grant agreed: live \{live grant\}, this run RECOMMEND_BUILD=true\); dropped without writing\./, PRE_TEMPLATES, …)`
   - `pinned(closing, /Backlog refine: skipped #\{n\} — premise changed since confirmation \(flag-back concurrent grant DIVERGED: live \{live grant\}, this run discarded RECOMMEND_BUILD=false — \{grant-check RATIONALE\}\); dropped without writing\./, PRE_TEMPLATES, …)`
3. `AC1.1: flag-back comparison judges the RECOMMEND_BUILD verdict, not the flag-back reason`:
   `pinned(closing, /\*\*Flag-back concurrent-grant comparison \(#3324\)\.\*\*[\s\S]{0,700}this run's own `RECOMMEND_BUILD` verdict[\s\S]{0,300}not the reason the row was flagged back/, PRE_TEMPLATES, …)`
4. `AC1.1: a no-verdict flag-back row keeps the generic skip line, never agreed/DIVERGED`:
   `pinned(closing, /`concurrent grant: live \{live grant\}; flag-back row, no grant-check verdict to compare`/, PRE_TEMPLATES, …)`
5. `AC1.1: other flag-back skips keep the generic line`:
   `pinned(closing, /\*\*Flag-back concurrent-grant comparison \(#3324\)\.\*\*[\s\S]{0,2200}gained `risk:\*`\/`size:\*`\/`bot:in-progress` without `auto:build`[\s\S]{0,200}keeps? the generic line/, PRE_TEMPLATES, …)`
6. `AC2.1: one grep finds every flag-back divergence, and only those`:
   - `pinned(closing, /grep 'flag-back concurrent grant DIVERGED' "\$PIPELINE_RUN_DIR\/decisions\.md"/, PRE_TEMPLATES, …)`
   - Behavioral: extract every `concurrent grant` template line from `closing` (`closing.split('\n').filter(l => l.includes('concurrent grant') && l.startsWith('AUTO {time}'))`). Assert exactly 4 are found: 2 grant-row and 2 flag-back. Substitute `{time}` → `10:00:01`, `{n}` → `7`, `{live grant}` → `auto:build`, and `{grant-check RATIONALE}` → `narrow fix`. Then assert all of the following:
     - `line.includes('flag-back concurrent grant DIVERGED')` is true for the flag-back DIVERGED line only.
     - `line.includes('concurrent grant DIVERGED')` is true for both DIVERGED lines.
     - `computeClosingTally('## /backlog\n' + lines.map(l => '- ' + l).join('\n') + '\n')` yields `counts.skipped === 4` and `unclassified` deep-equal `[]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/backlog-refine-flagback-divergence.test.js`
Expected: FAIL (tests 1-6 fail on missing prose; the behavioral count assertion fails with 2 found instead of 4).

- [ ] **Step 3: Implement the prose**

**3a. `refine-mode.md` line 343.** Immediately after `A grant row dropped for a gained grant logs whether that concurrent grant agreed with this run's own verdict — `refine-closing-summary.md`'s Concurrent-grant comparison (#2719).`, insert this sentence:

`A flag-back row dropped for a gained `auto:build` logs the same comparison against its own `RECOMMEND_BUILD` verdict — `refine-closing-summary.md`'s Flag-back concurrent-grant comparison (#3324).`

**3b. `refine-closing-summary.md` template block.** Insert two lines after the grant-row `concurrent grant DIVERGED` template line and before the `FAILED` line:

```
AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation (flag-back concurrent grant agreed: live {live grant}, this run RECOMMEND_BUILD=true); dropped without writing.
AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation (flag-back concurrent grant DIVERGED: live {live grant}, this run discarded RECOMMEND_BUILD=false — {grant-check RATIONALE}); dropped without writing.
```

**3c. `refine-closing-summary.md` line 32.** Change `keeps the generic line, as does every non-grant row.` to `keeps the generic line, as does every non-grant row except the flag-back case below.`

**3d. New paragraph** directly after the Concurrent-grant comparison paragraph (its own paragraph, blank line on each side). Write it in substance as follows; exact wording is free where no test pins it:

> **Flag-back concurrent-grant comparison (#3324).** When Step 5's pre-write reverify drops a flag-back row because the record's live labels gained `auto:build` since Step 1 (with or without another of the reverify's flag-back labels), compare that live grant (`{live grant}`: `auto:build`, `auto:build + auto:merge`, or `auto:build + auto:merge-pending`) against this run's own `RECOMMEND_BUILD` verdict for the row before logging. That means the grant-check verdict itself, not the reason the row was flagged back: a Step 3.5 body-shape downgrade, a needs-scoring row, or a human override in Step 4 can flag back a row whose verdict was `RECOMMEND_BUILD: true`. A flag-back row with no verdict (Step 3's `no verdict rendered` outcome) keeps the generic skip line, with `{what changed}` = `concurrent grant: live {live grant}; flag-back row, no grant-check verdict to compare`. It never reads "agreed" or "DIVERGED". For every other flag-back row, the live grant always carries `auto:build`, so the verdict alone decides: **agreed** when `RECOMMEND_BUILD` is `true`, **diverged** when it is `false`. Log the matching flag-back line above. The DIVERGED form carries this run's grant-check RATIONALE verbatim, carrying the same write-versus-verdict caveat as the grant-row form. A flag-back row that gained `risk:*`/`size:*`/`bot:in-progress` without `auto:build`, or that hit a live-state fetch failure, keeps the generic line. Both forms count as `skipped`. Every flag-back divergence of one sweep is listed by `grep 'flag-back concurrent grant DIVERGED' "$PIPELINE_RUN_DIR/decisions.md"`. The grant-row grep above also matches these lines, so one `grep 'concurrent grant DIVERGED'` lists every divergence of either kind.

**Behavioral claims, named mechanism:** "counts as `skipped`" is produced by `closing-tally.js:41`'s `/Backlog refine: skipped #/` regex (verified at plan time, line 41). The `auto:build` trigger is the existing flag-back reverify label list at `refine-mode.md:343` (`risk:*`/`size:*`/`auto:build`/`bot:in-progress`). Nothing new is claimed about runtime writes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/backlog-refine-flagback-divergence.test.js tests/backlog-refine-grant-divergence.test.js tests/bin-lib/closing-tally/closing-tally.test.js`
Expected: PASS, all tests (the #2719 suite unchanged and green).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/backlog/refine-mode.md plugin/skills/backlog/refine-closing-summary.md tests/backlog-refine-flagback-divergence.test.js
git commit -m "Extend concurrent-grant divergence logging to flag-back rows — compare RECOMMEND_BUILD against a gained auto:build

refs #3324"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (refine-mode.md flag-back reverify compares `RECOMMEND_BUILD`) is 3a plus the 3d paragraph it points at. Deliverable 2 (templates mirroring agreed/DIVERGED) is 3b. AC1.1 is covered by tests 1-5. AC2.1 is covered by test 6.
- **Placeholders:** none.
- **Plan-authoring checks applied:** prose-held pin grep (`git grep` over `tests plugin` for the edited sentences) found no pins beyond `tests/backlog-refine-grant-divergence.test.js`, whose literals 3c preserves. Byte-pin check is recorded in Global Constraints. The behavioral-claim mechanism is named in Step 3. Go-red control: every `pinned` call asserts against the verbatim pre-change probe.
