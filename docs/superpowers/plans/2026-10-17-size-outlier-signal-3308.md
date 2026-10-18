# Add a corpus-relative size-outlier signal to the bloat scan (#3308) Implementation Plan

**Goal:** Add a two-tier corpus-relative `sizeOutlier` signal to `bloat.js` beside the existing `overCeiling`/`headroom` fields, report it, let callers suppress it, and teach both harness-health judging procedures to weigh it as dimension-9 evidence.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T062549-spec-3307-3308-3306-3309-3310-3311/spec-3308/work/3308-spec.md` (materialized from GitHub issue #3308) _(Spec file deleted at the series close-out in PR #3433; the GitHub record, with its As-built notes, is the durable spec.)_

---

### Task 1: Add the size-outlier signal, its report lines, suppression, and the twin prose

**Files:**
- Modify: `plugin/bin/lib/skill-audit/bloat.js`
- Modify: `plugin/skills/_shared/harness-health-analysis.md`
- Modify: `plugin/skills/harness-health/judge-procedure.md`
- Test: `tests/bin-lib/skill-audit/bloat.test.js`

- [ ] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe: p95 tier (AC1), median tier (AC2), the under-5 floor with its `size baseline: NO BASELINE` line (AC3), the at-threshold/one-above boundary (AC4), dedup of a duplicated target path (AC5), `{ sizeOutlier: false }` suppression (AC6), and the prose-twin conformance assertion that both prose files' signal lists name the same five signals and both carry the new guard bullet (AC8). Every pre-existing `bloat.test.js` assertion stays unchanged (AC7).
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above: the four `SIZE_*` constants and `sizeBaseline` in `auditCorpus` (computed after the existing dedup and non-file filter, reusing `median()`), `auditText`'s `sizeThreshold` input and `sizeOutlier` output, `formatBloatReport`'s baseline and per-outlier lines and `hasFindings` counting `sizeOutlier`, the `{ sizeOutlier: false }` option on `bloatReport`/`auditCorpus` (default `true`), and the signal-list entry plus dimension-9 guard bullet in both prose files, changed in the same commit. Leave `overCeiling`, `headroom`, the `ceiling` option, and the existing "files over the 50 KB soft ceiling" wording untouched (#3310/#3311 own those).
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS (`node --test tests/bin-lib/skill-audit/bloat.test.js`).
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3308`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is covered by Task 1's Files/Steps above (AC9, `npm test`, runs at Common Step 5).
- **Placeholders:** none.
