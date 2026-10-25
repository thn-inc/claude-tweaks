# Review Skips Work Build Already Did — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/review` Step 5 stops re-running `/claude-tweaks:simplify`, and lens 3i stops re-flagging registry docs, when `/build` already did that work on a tree that has not changed since.

**Architecture:** Each skip is a producer/consumer pair over the run's `decisions.md`. `/build` writes one canonical `log-decision.js` line: Common Step 3 after simplify, and Common Step 6.5 for each doc it finds no stale text in. `/review` reads that line and skips only when the logged `{sha}` is an ancestor of `HEAD` and no relevant file changed since. Today neither build line exists in a fixed form; build writes free-form prose (run `2026-10-24T121146-spec-4048`, lines 41/43). So the producer half is part of this record, not optional. A conformance test produces each line with the real `log-decision.js` `run()` from the producer's own argv, then applies the consumer's own selector to it.

**Tech Stack:** Markdown skill prose; `node --test` conformance suite (`tests/helpers/read-skill`'s `readText`, `plugin/bin/log-decision.js`'s exported `run`).

**Spec:** `.claude-tweaks/pipelines/2026-10-25T201346-record-4137/work/4137-spec.md`

**Scope keywords:** Common Step 3, Common Step 6.5, Simplify Changed Code, Documentation Freshness

**Premise-refs:** plugin/bin/log-decision.js
**Premise-refs:** tests/bin-lib/log-decision/cli.test.js
**Premise-refs:** tests/review-build-not-run-conformance.test.js

## Global Constraints

- The skip conditions are additive: with no run dir, no matching line, a `{sha}` outside `HEAD`'s history, or a relevant change since, behavior is exactly today's.
- Byte rail: `RAIL_BYTES` = 52,500 (`plugin/bin/lib/skill-audit/budgets.js`). Measured at base 66f621a92: `plugin/skills/review/code-mode-steps.md` 49,559 B (2,941 headroom), `plugin/skills/build/SKILL.md` 49,759 B (2,741 headroom), `plugin/skills/build/docs-sync.md` 1,932 B, `plugin/skills/review/step3-doc-freshness-lens.md` 3,061 B. Each addition to the first two must stay ≤ 1,200 B, and both files stay under the rail. No `when:` fencing is needed: raw files, not composed bundles.
- Commit style: `{Verb} {what} — {detail}`, and `refs #4137` (never `closes`/`fixes`).
- Skill references inside actionable text use `/claude-tweaks:{skill}`.

## Review Focus

1. A run whose `/build` predates this change logs free-form Common Step 3/6.5 prose. The selector must not match it, so review runs as today. Real-input probe (Task 3, Step 4) on the archived `2026-10-24T121146-spec-4048/decisions.md`.
2. A Common Step 5 verification fix to a source file, committed after build's simplify, must make review re-simplify. The diff condition covers it: Task 1's prose names "no build fix and no review fix".
3. A rebased branch, where the logged `{sha}` is not in `HEAD`'s history, must fall back to running. Covered by the `merge-base --is-ancestor` fact pinned in Tasks 1 and 2.
4. A resumed build that logged Common Step 3 twice must use the last line. Covered by the "last line" fact pinned in Task 1.
5. A doc build assessed, whose Auto-detect-matched source a review fix later changed, must still be flagged. Covered by the Auto-detect diff fact pinned in Task 2.

---

### Task 1: Simplify pair — build Common Step 3 writes the line, review Step 5 skips on it

**Files:**
- Modify: `plugin/skills/build/SKILL.md` (Common Step 3, after the sentence `If the simplifier makes changes, commit them separately.`)
- Modify: `plugin/skills/review/code-mode-steps.md` (`## Step 5: Simplify Changed Code`, a new paragraph directly under the heading, before `Run \`/claude-tweaks:simplify\` on the same own-work file scope`)
- Create: `tests/review-skip-build-handled-work-conformance.test.js`

**Interfaces:**
- Produces (for Task 2, same test file): helpers `between(text, start, end)`, `missing(region, facts)`, `producerLine(regionText, sha, doc)`. The last one parses `--section "…"`, `--step "…"` and `--text "…"` from the region's `log-decision.js` command. It substitutes `{sha}`/`{doc}` and calls `require('../plugin/bin/log-decision').run([...])` against a mkdtemp fixture laid out like `tests/bin-lib/log-decision/cli.test.js`'s `fixture()`/`deps()`: main checkout with a `.git` directory, run dir at `.claude-tweaks/pipelines/2026-08-16T090000-spec-12`, `now` fixed. It returns the `decisions.md` text that `run()` actually wrote.
- Also produces `selectSha(decisionsText, regionText, doc)`. It parses the region's first backticked reader selector containing `{sha}`, regex-escapes it, and maps `{sha}` → `([0-9a-f]{7,40})` and `{doc}` → the escaped doc path. It returns the captured sha of the **last** matching line under the `## /build` heading, or `null`.

- [ ] **Step 1: Write the failing test** `tests/review-skip-build-handled-work-conformance.test.js`, modeled on `tests/review-build-not-run-conformance.test.js`. Regions: `build3` = `between(build, '### Common Step 3: Code Simplification', '### Common Step 4: Handle Blocked Work')`; `review5` = `between(steps, '## Step 5: Simplify Changed Code', '## Step 6: Visual Review')`. Facts:
  - `build3` — `AC1.1 writer`: `/--section "\/build" --status AUTO --step "Common Step 3" --text "simplify: scope simplified at \{sha\}"/`. `AC1.1 writer gate`: `/`STATUS: DONE`/`. `AC1.1 reader pointer`: `/`\/review` Step 5 reads this line/`.
  - `review5` — `AC1.1 selector`: `/`Common Step 3: simplify: scope simplified at \{sha\}`/`. `AC1.1 last line`: `/read the last line under `decisions\.md`'s `## \/build` heading/`. `AC1.1 ancestry`: `/`git merge-base --is-ancestor \{sha\} HEAD` exits 0/`. `AC1.1 diff`: `/`git diff --name-only \{sha\} HEAD`/`. `AC1.1 no fix since`: `/no build fix and no review fix has touched an in-scope source file since/`. `AC1.1 skip log`: `/--section "\/review" --status SKIP --step "Step 5 simplify \(skipped\)"/`. `AC1.1 fallback`: `/runs this step as below/`.
  - Tests: `AC1.1: every simplify-pair fact matches exactly once in its region`; `AC1.1 go-red: stripping each fact reports exactly that fact` (the same `missing()` call as the positive test, against the mutated region); `AC3.1 twin: review Step 5's selector reads the sha build Common Step 3's command writes` (`selectSha(producerLine(build3, 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0'), review5)` equals that sha; the same line moved under `## /review` yields `null`; two writer lines, the second with sha `ffff…`, yield the second); `AC3.1 twin go-red: rewording the writer text or the reader selector breaks the match` (replace `scope simplified` with `scope cleaned` in each region separately, and assert `selectSha` returns `null`).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-skip-build-handled-work-conformance.test.js`
Expected: FAIL (`build3: missing facts` lists `AC1.1 writer`)

- [ ] **Step 3: Write the prose.** In `build/SKILL.md` Common Step 3, after `If the simplifier makes changes, commit them separately.`, add one paragraph:

  **Log the simplified tree (`$PIPELINE_RUN_DIR` set).** Once `/claude-tweaks:simplify` returns `STATUS: DONE` (its changes committed, or none made), write `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "Common Step 3" --text "simplify: scope simplified at {sha}" --reversibility n/a`, `{sha}` being `git rev-parse HEAD` after that commit. `/review` Step 5 reads this line to skip re-simplifying an unchanged tree (`review/code-mode-steps.md`); any other outcome writes no line.

  In `review/code-mode-steps.md`, directly under `## Step 5: Simplify Changed Code`, add:

  **Skip when `/build` already simplified this tree (#4137).** When `$PIPELINE_RUN_DIR` is set, read the last line under `decisions.md`'s `## /build` heading carrying `Common Step 3: simplify: scope simplified at {sha}`. Skip this step when that line exists, `git merge-base --is-ancestor {sha} HEAD` exits 0, and every file `git diff --name-only {sha} HEAD` lists from the scope below is one `/claude-tweaks:simplify` Step 1 filters out — no build fix and no review fix has touched an in-scope source file since. Log instead of invoking: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/review" --status SKIP --step "Step 5 simplify (skipped)" --text "condition: build Common Step 3 simplified this scope at {sha}, no in-scope source file changed since -> fallback: /claude-tweaks:simplify not re-run" --reversibility n/a`. No line, a `{sha}` outside `HEAD`'s history, or a changed in-scope source file runs this step as below.

- [ ] **Step 4: Run test to verify it passes**, then confirm the byte rail.

Run: `node --test tests/review-skip-build-handled-work-conformance.test.js`
Expected: PASS
Run: `wc -c plugin/skills/build/SKILL.md plugin/skills/review/code-mode-steps.md`
Expected: both < 52500

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/SKILL.md plugin/skills/review/code-mode-steps.md tests/review-skip-build-handled-work-conformance.test.js
git commit -m "Let review Step 5 skip simplify build already ran — canonical Common Step 3 log line plus its reader, refs #4137"
```

### Task 2: Docs pair — build Common Step 6.5 logs each clean doc, lens 3i consumes it

**Files:**
- Modify: `plugin/skills/build/docs-sync.md` (step 4, a new item `f.` after `e. **Defer to wrap-up**`)
- Modify: `plugin/skills/review/step3-doc-freshness-lens.md` (insert a new step 4 between current steps 3 and 4. Current step 4 becomes step 5 and reads `Flag the remaining unupdated docs as informational findings:`)
- Modify: `docs/skill-graph.md` (`## build` table, the `/review` row: append one sentence)
- Modify: `tests/review-skip-build-handled-work-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `between`, `missing`, `producerLine`, `selectSha` (with a `doc` argument).

- [ ] **Step 1: Write the failing test** — extend the test file. Regions: `sync` = the whole of `docs-sync.md`; `lens` = `between(lens, '1. Read `docs/REGISTRY.md`', '#### 3i-diagram')`. Facts:
  - `sync` — `AC2.1 writer`: `/--section "\/build" --status AUTO --step "Common Step 6\.5" --text "docs sync: \{doc\} assessed at \{sha\}, no stale text"/`. `AC2.1 one line per doc`: `/log one line per such doc/`.
  - `lens` — `AC2.1 selector`: `/`Common Step 6\.5: docs sync: \{doc\} assessed at \{sha\}, no stale text`/`. `AC2.1 ancestry`: `/`git merge-base --is-ancestor \{sha\} HEAD` exits 0/`. `AC2.1 auto-detect diff`: `/lists no file matching this entry's Auto-detect patterns/`. `AC2.1 no finding`: `/emit no finding for it/`. `AC2.1 renumbered flag step`: `/5\. Flag the remaining unupdated docs as informational findings:/`.
  - Tests: `AC2.1: every docs-pair fact matches exactly once`; `AC2.1 go-red` (same shape as Task 1's); `AC3.1 twin: lens 3i's selector reads the sha build Step 6.5's command writes for that doc` (`doc = 'docs/plugin-structure.md'`; a line written for `docs/hooks.md` yields `null` for `docs/plugin-structure.md`); `AC3.1 twin go-red` (replace `no stale text` with `nothing stale` in each region separately → `null`).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-skip-build-handled-work-conformance.test.js`
Expected: FAIL (`sync: missing facts` lists `AC2.1 writer`)

- [ ] **Step 3: Write the prose.** `docs-sync.md` step 4, after item `e.`:

     f. **No stale text** — when the read finds nothing the change makes stale and `$PIPELINE_RUN_DIR` is set, log one line per such doc: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "Common Step 6.5" --text "docs sync: {doc} assessed at {sha}, no stale text" --reversibility n/a`, `{doc}` being the doc path as `docs/REGISTRY.md` writes it and `{sha}` `git rev-parse HEAD` at the assessment. `/review`'s lens 3i reads it (`review/step3-doc-freshness-lens.md`) instead of re-flagging the doc.

  Lens, new step 4 (current step 4 → 5, reworded `Flag the remaining unupdated docs as informational findings:`):

  4. **Skip a doc `/build` already checked (#4137).** When `$PIPELINE_RUN_DIR` is set and its `decisions.md` carries, under `## /build`, a line with `Common Step 6.5: docs sync: {doc} assessed at {sha}, no stale text` for this entry's doc, `git merge-base --is-ancestor {sha} HEAD` exits 0, and `git diff --name-only {sha} HEAD` lists no file matching this entry's Auto-detect patterns, emit no finding for it — build read it against the same source. A doc whose matched sources changed since that `{sha}` is still flagged.

  `docs/skill-graph.md`, `## build` → `/review` row, append: `Since #4137, `/review` Step 5 skips re-simplifying when `/build` Common Step 3's `simplify: scope simplified at {sha}` line covers an unchanged in-scope source tree, and lens 3i drops a registry doc `/build` Common Step 6.5 logged `assessed at {sha}, no stale text` while its Auto-detect-matched sources are unchanged since.`

  Renumbering check (three forms): `git grep -n -e "step3-doc-freshness-lens" -- plugin docs tests`, `git grep -n -i -e "lens 3i.*step 4" -e "3i.*step 4" -- plugin docs tests`, `git grep -n -i -e "four steps" -- plugin/skills/review`. Every hit that names the lens's step 4 must name step 5 after the change. At authoring time the first grep shows the lens cited only by file, never by step number.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/review-skip-build-handled-work-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/docs-sync.md plugin/skills/review/step3-doc-freshness-lens.md docs/skill-graph.md tests/review-skip-build-handled-work-conformance.test.js
git commit -m "Let lens 3i consume build's Step 6.5 per-doc assessment — canonical no-stale-text line plus its reader, refs #4137"
```

### Task 3: Real-input probe and pins sweep (controller, no implementer)

- [ ] **Step 1:** `git grep -n -F -e "Common Step 3: simplify" -e "docs sync:" -- tests plugin`. Confirm no other suite pins the old free-form wording.
- [ ] **Step 2:** Run the suites that read the edited files: `node --test tests/review-build-not-run-conformance.test.js tests/fast-lane-digest.test.js tests/ceremony-profile-roster.test.js tests/review-skip-build-handled-work-conformance.test.js`. Expected: PASS.
- [ ] **Step 3:** The full suite runs at build Common Step 5 (`verify.js`), not here.
- [ ] **Step 4: Real-input probe.** Apply `selectSha` with Task 1's `review5` region to the archived `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-10-24T121146-spec-4048/decisions.md`, and with Task 2's `lens` region for doc `docs/plugin-structure.md`. Expected: `null` both times: legacy free-form lines (41, 43) never match, so a pre-change run falls back to running Step 5 and flagging. Independent count: `grep -c "scope simplified at" <file>` → 0. Record both outputs in `decisions.md`.

## Spec coverage

| Clause | Task / test |
|---|---|
| AC1.1 Step 5 states the skip condition and its log line | Task 1 `AC1.1` facts |
| AC2.1 lens 3i states how it consumes build Step 6.5 | Task 2 `AC2.1` facts |
| AC3.1 a conformance test pins both conditions | Task 1 and Task 2 `AC3.1 twin` tests |

## As built (Common Step 4.5 alignment)

- **Beneficial — producer side added beyond the record's Key Files.** The record named only the two review files. Its Deliverables require review to read build's logged assessment, and no canonical build line existed, so `build/SKILL.md` Common Step 3 and `build/docs-sync.md` item f. gained the writer lines (Tasks 1-2).
- **Beneficial — whole-branch review fix wave (d2838d0b1).** Three changes to the plan: the readers diff the working tree plus untracked files, not `{sha}..HEAD`; the Common Step 3 writer is gated on simplify's own `Verification: pass` / `No simplifications needed` outcome and a whole-branch scope, not `STATUS: DONE`; both writers log `SCANNED`, not `AUTO`. The fix wave also added lens 3i's SKIP trace (the Self-adoption obligation), the `→` arrow, the `$PIPELINE_RUN_DIR/decisions.md` anchor, and a skipped-Step-5 variant in `review/review-summary-template.md`.
