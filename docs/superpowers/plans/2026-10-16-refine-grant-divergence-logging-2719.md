# Refine concurrent-grant divergence logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `/claude-tweaks:backlog refine`'s Step 5 pre-write reverify drops a grant row because a concurrent write already granted the record, log whether that concurrent grant agreed or diverged from this run's own `RECOMMEND_MERGE` verdict, so `decisions.md` shows every disagreement.

**Architecture:** Prose-only change to two backlog skill files plus a conformance test. `refine-mode.md` Step 5 gets `auto:merge` in its grant-row projection and an explicit "gained a grant" invalidation clause pointing at a new **Concurrent-grant comparison** rule in `refine-closing-summary.md`. That file owns the two new `AUTO … skipped …` template variants (agreed / DIVERGED), keeping them inside the existing `skipped` tally bucket and template family. A characterization test in `closing-tally.test.js` proves both new lines keep counting as `skipped` (the mechanical tally #3267 is about to rework).

**Tech Stack:** Markdown skill prose; `node --test` conformance tests (no external deps).

**Spec:** `.claude-tweaks/pipelines/2026-10-16T191540-record-2719/spec-2719/work/2719-spec.md` (record #2719)

## Global Constraints

- Reuse the existing `AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation ({what changed}); dropped without writing.` template and its `skipped` tally bucket — only `{what changed}` gets richer content (spec Technical Approach).
- Leave the fetch-failure path, priority/related rows, flag-back rows, and the body reverify untouched (spec Technical Approach).
- No change to what gets granted or merged — logging only (spec Gotchas).
- `refine-mode.md` is 41,810 bytes; the binding pin is `CEILING_BYTES` = 51,200 (`plugin/bin/lib/skill-audit/context-cost.js:34`, asserted for this file by `tests/backlog-refine-resolve-lane.test.js:137-139`). Budget for this plan's additions there: under 700 bytes (headroom stays above 8.6 KB). `refine-closing-summary.md` is 10,156 bytes, no file-specific pin (grep of `tests/` for its basename next to `byteLength`/`wc -c` found none). Neither file is a `compose-context.js` source (`grep -rn compose-context plugin/skills/backlog/` → no hits), so no composed-bytes gate applies.
- Second deliverable (trust-table feed) — decided **not** to implement, documented here and in the PR: `_shared/trust-table.md` is a read-only renderer over GitHub-label outcome evidence per class (`demo:approved`/`demo:changes-requested`, via `bin/lib/issues/trust.js`); a grant-judgment divergence lives only in one run's gitignored `decisions.md`, has no GitHub-side carrier `trust.js` could read, and is a judgment-consistency signal rather than an outcome. Feeding it would need a new cross-run producer — out of proportion for a logging record whose Gotchas mark this deliverable exploratory. The new `concurrent grant DIVERGED` phrase is greppable across archived run dirs if a pattern ever needs measuring.
- Commit message style: `{Verb} {what} — {detail}`, referencing `refs #2719` (never a closing keyword).

## Review Focus

1. A concurrent grant that added only `auto:merge` to a record this run planned to grant `auto:build` — the old projection had no `auto:merge` entry, so the reverify never saw it; the new projection must name `auto:merge` ↔ `facets.grants.merge` (pinned in Task 1's test).
2. A run that chose the session-wide "Grant auto:build only, hold merge" override — agreement must be judged against the computed `RECOMMEND_MERGE` verdict, not the overridden write (pinned in Task 1's test: the rule names the verdict, not the override).
3. A grant row skipped for a non-grant reason (lost `ready`, fetch failure) must keep the generic `{what changed}` text, not be labeled agreed/diverged (pinned in Task 1's test).
4. The new DIVERGED/agreed lines must still count as `skipped` and never surface as `unclassified` in `closing-tally.js` (Task 2's test, with orthogonal categories present).
5. A human must be able to find every divergence of one sweep in one command — the rule names the exact grep (pinned in Task 1's test).

---

### Task 1: Concurrent-grant comparison rule in refine prose

**Files:**
- Modify: `plugin/skills/backlog/refine-mode.md:336` (Step 5 "Pre-write reverify" paragraph — projection list and grant-row invalidation sentence)
- Modify: `plugin/skills/backlog/refine-closing-summary.md:17-27` (template block + counting paragraph) and `:96-101` (item 3 per-skip example)
- Create: `tests/backlog-refine-grant-divergence.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the literal phrases `concurrent grant agreed` and `concurrent grant DIVERGED` inside `Backlog refine: skipped #` lines — Task 2's fixture uses these exact lines.

- [ ] **Step 1: Write the failing test**

Create `tests/backlog-refine-grant-divergence.test.js`:

```js
'use strict';

// #2719: Step 5's pre-write reverify must tell a concurrent grant that agreed with this
// run's own grant-check verdict apart from one that diverged. Each assertion is paired with
// a go-red probe against the pre-change text it replaces [IL-105].
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'plugin', 'skills', 'backlog');
const refineMode = fs.readFileSync(path.join(DIR, 'refine-mode.md'), 'utf8');
const closing = fs.readFileSync(path.join(DIR, 'refine-closing-summary.md'), 'utf8');

// Pre-change sentences this record rewrites — used only as go-red probes.
const PRE_PROJECTION = "projected as: `ready` ↔ `facets.stage === 'ready'`, `auto:build` ↔ `facets.grants.build`, `bot:in-progress` ↔ `facets.bot.inProgress`.";
const PRE_GRANT_ROW = 'A grant row whose live labels lost `ready`, or a flag-back row whose live labels gained';
const PRE_TEMPLATES = 'AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation ({what changed}); dropped without writing.\nFAILED {time}';

function pinned(text, pattern, pre, message) {
  assert.match(text, pattern, message);
  assert.doesNotMatch(pre, pattern, 'pattern must not match the pre-change text (proves it can go red)');
}

test('reverify projection includes auto:merge', () => {
  pinned(refineMode, /`auto:merge` ↔ `facets\.grants\.merge`/, PRE_PROJECTION,
    'refine-mode.md Step 5 projection must include auto:merge ↔ facets.grants.merge');
});

test('a grant row that gained a concurrent grant is invalidated and routed to the comparison rule', () => {
  pinned(refineMode, /grant row whose live labels lost `ready` or gained `auto:build`\/`auto:merge`/, PRE_GRANT_ROW,
    'refine-mode.md must invalidate a grant row whose live labels gained auto:build/auto:merge');
  pinned(refineMode, /refine-closing-summary\.md`'s Concurrent-grant comparison/, PRE_GRANT_ROW,
    'refine-mode.md must point at refine-closing-summary.md\'s Concurrent-grant comparison');
});

test('closing summary carries distinguishable agreed and DIVERGED skip templates', () => {
  pinned(closing, /Backlog refine: skipped #\{n\} — premise changed since confirmation \(concurrent grant agreed: /, PRE_TEMPLATES,
    'agreed-form skip template missing');
  pinned(closing, /Backlog refine: skipped #\{n\} — premise changed since confirmation \(concurrent grant DIVERGED: live \{live grant\}, this run discarded RECOMMEND_MERGE=\{true\|false\} — \{grant-check RATIONALE\}\)/, PRE_TEMPLATES,
    'DIVERGED-form skip template must name the discarded RECOMMEND_MERGE value and its rationale');
});

test('comparison rule judges against the computed verdict, not the hold-merge override', () => {
  pinned(closing, /\*\*Concurrent-grant comparison \(#2719\)\.\*\*[\s\S]{0,900}this run's own `RECOMMEND_MERGE` verdict[\s\S]{0,300}not the session-wide "Grant auto:build only, hold merge" override/, PRE_TEMPLATES,
    'comparison rule must judge agreement against RECOMMEND_MERGE, not the hold-merge override');
});

test('non-grant skips keep the generic line', () => {
  pinned(closing, /\*\*Concurrent-grant comparison \(#2719\)\.\*\*[\s\S]{0,1600}any other reason[\s\S]{0,200}keeps the generic line/, PRE_TEMPLATES,
    'comparison rule must keep the generic skip line for non-grant reasons');
});

test('every divergence of one sweep is findable with one grep', () => {
  pinned(closing, /grep 'concurrent grant DIVERGED' \{run-dir\}\/decisions\.md/, PRE_TEMPLATES,
    'comparison rule must name the grep that finds every divergence');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/backlog-refine-grant-divergence.test.js`
Expected: FAIL (all six tests — the phrases do not exist yet)

- [ ] **Step 3: Edit `refine-mode.md` Step 5**

In the "**Pre-write reverify (every write below).**" paragraph, replace:

```
projected as: `ready` ↔ `facets.stage === 'ready'`, `auto:build` ↔ `facets.grants.build`, `bot:in-progress` ↔ `facets.bot.inProgress`.
```

with:

```
projected as: `ready` ↔ `facets.stage === 'ready'`, `auto:build` ↔ `facets.grants.build`, `auto:merge` ↔ `facets.grants.merge`, `bot:in-progress` ↔ `facets.bot.inProgress`.
```

and replace:

```
A grant row whose live labels lost `ready`, or a flag-back row whose live labels gained `risk:*`/`size:*`/`auto:build`/`bot:in-progress` since Step 1, has had its premise invalidated by a concurrent write: drop it from this write, log an `AUTO … skipped …` line (per the template below), and skip the `gh edit`/`writeRecord` calls below for that row.
```

with:

```
A grant row whose live labels lost `ready` or gained `auto:build`/`auto:merge`, or a flag-back row whose live labels gained `risk:*`/`size:*`/`auto:build`/`bot:in-progress` since Step 1, has had its premise invalidated by a concurrent write: drop it from this write, log an `AUTO … skipped …` line (per the template below), and skip the `gh edit`/`writeRecord` calls below for that row. A grant row dropped for a gained grant logs whether that concurrent grant agreed with this run's own verdict — `refine-closing-summary.md`'s Concurrent-grant comparison (#2719).
```

- [ ] **Step 4: Edit `refine-closing-summary.md`**

In the template code block, directly after the line

```
AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation ({what changed}); dropped without writing.
```

insert these two lines:

```
AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation (concurrent grant agreed: live {live grant}, this run RECOMMEND_MERGE={true|false}); dropped without writing.
AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation (concurrent grant DIVERGED: live {live grant}, this run discarded RECOMMEND_MERGE={true|false} — {grant-check RATIONALE}); dropped without writing.
```

After the paragraph that begins "The closing summary below counts these lines by type" (ends "counts toward neither."), add a new paragraph:

```
**Concurrent-grant comparison (#2719).** When Step 5's pre-write reverify drops a grant row because the record's live labels gained `auto:build` and/or `auto:merge` since Step 1, compare that live grant (`{live grant}`: `auto:build`, `auto:build + auto:merge`, or `auto:merge` alone) against this run's own `RECOMMEND_MERGE` verdict for the row before logging — the grant-check verdict itself, not the session-wide "Grant auto:build only, hold merge" override, which changes only what this run would have written. It **agreed** when live carries `auto:build` and live `auto:merge` presence equals `RECOMMEND_MERGE`; anything else **diverged**. Log the matching line above: the DIVERGED form carries this run's discarded `RECOMMEND_MERGE` value and its grant-check RATIONALE verbatim, so a reader of `decisions.md` sees two independent judgments disagreed instead of assuming they repeated each other. A grant row skipped for any other reason (lost `ready`, a live-state fetch failure) keeps the generic line, as does every non-grant row. Both forms count as `skipped`. Every divergence of one sweep is listed by `grep 'concurrent grant DIVERGED' {run-dir}/decisions.md`, and the closing summary's per-skip lines (item 3) carry the same text.
```

In item 3 ("One line per skipped write"), extend its example code block from

```
#123 — skipped: premise changed since confirmation (lost ready label)
```

to

```
#123 — skipped: premise changed since confirmation (lost ready label)
#124 — skipped: premise changed since confirmation (concurrent grant DIVERGED: live auto:build + auto:merge, this run discarded RECOMMEND_MERGE=false — {grant-check RATIONALE})
```

- [ ] **Step 5: Run the new test and the existing refine prose suites**

Run: `node --test tests/backlog-refine-grant-divergence.test.js tests/backlog-refine-reverify-before-write.test.js tests/backlog-refine-closing-render.test.js tests/backlog-refine-resolve-lane.test.js tests/backlog-refine-body-reverify.test.js tests/reverify-before-write-conformance.test.js`
Expected: PASS (all)

Run: `wc -c plugin/skills/backlog/refine-mode.md`
Expected: under 42,510 bytes (≤ 700 bytes added)

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/backlog/refine-mode.md plugin/skills/backlog/refine-closing-summary.md tests/backlog-refine-grant-divergence.test.js
git commit -m "Log concurrent-grant agreement vs divergence in refine reverify — refs #2719"
```

### Task 2: Pin that divergence skip lines stay in the skipped tally

**Files:**
- Modify: `tests/bin-lib/closing-tally/closing-tally.test.js` (append one test)

**Interfaces:**
- Consumes: Task 1's exact line shapes (`concurrent grant agreed` / `concurrent grant DIVERGED` inside `Backlog refine: skipped #` lines).
- Produces: nothing.

- [ ] **Step 1: Append the characterization test**

Append to `tests/bin-lib/closing-tally/closing-tally.test.js` (it already requires `computeClosingTally` from the module; reuse that binding — read the file's top imports first and use the same names):

```js
test('#2719 concurrent-grant agreed/DIVERGED skip lines count as skipped, never unclassified', () => {
  const text = [
    '## /backlog',
    '- AUTO 10:00:01 — Backlog refine: set priority:high on #20.',
    '- AUTO 10:00:02 — Backlog refine: granted auto:build to #21 (risk:low, size:low). Rationale: narrow fix.',
    '- AUTO 10:00:03 — Backlog refine: skipped #22 — premise changed since confirmation (concurrent grant agreed: live auto:build, this run RECOMMEND_MERGE=false); dropped without writing.',
    '- AUTO 10:00:04 — Backlog refine: skipped #23 — premise changed since confirmation (concurrent grant DIVERGED: live auto:build + auto:merge, this run discarded RECOMMEND_MERGE=false — touches a shared contract); dropped without writing.',
    '- AUTO 10:00:05 — Backlog refine: skipped #24 — premise changed since confirmation (lost ready label); dropped without writing.',
  ].join('\n');
  const { counts, unclassified } = computeClosingTally(text);
  assert.strictEqual(counts.skipped, 3);
  assert.strictEqual(counts.priority, 1);
  assert.strictEqual(counts.granted, 1);
  assert.deepStrictEqual(unclassified, []);
});
```

- [ ] **Step 2: Run it**

Run: `node --test tests/bin-lib/closing-tally/closing-tally.test.js`
Expected: PASS (characterization of existing classifier behavior — the new lines match the existing `Backlog refine: skipped #` pattern; this pins it ahead of #3267's rework of the same module)

- [ ] **Step 3: Commit**

```bash
git add tests/bin-lib/closing-tally/closing-tally.test.js
git commit -m "Pin concurrent-grant skip lines into the skipped tally — refs #2719"
```
