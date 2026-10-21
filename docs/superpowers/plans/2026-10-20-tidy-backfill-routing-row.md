# Tidy release Backfill + pipeline-run Archive routing rows (#3291) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every `— {Action}` verb `/claude-tweaks:tidy`'s scan emits a stated routing tier in `step-6-auto.md` (release **Backfill**, both remedies; pipeline-run **Archive**, both remedies), point `scan-procedures.md` at those rows, and pin the coverage with a conformance test.

**Architecture:** Prose-only change to two tidy skill sub-files plus one new `node --test` prose-conformance suite. The test extracts literal action verbs from `scan-procedures.md`'s backticked collect templates and requires a `| **{Verb}**` row in `step-6-auto.md`'s routing table for each.

**Tech Stack:** Markdown skill prose; Node 18+ `node:test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T194221-record-3291/work/3291-spec.md` (materialized from GitHub issue #3291)

## Global Constraints

- The `remedy: record` (heading-with-no-tag) Backfill flavor is never Auto-apply at any tier — creating or pushing a tag is an outward-facing write.
- Size bound: `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). The spec's `tests/release-lifecycle-byte-budget.test.js` no longer exists (deleted by #3311); no per-file byte pin may be added (decision 0024). Measured after the edits below in a scratch copy: `step-6-auto.md` 45,506 → 46,981 B (89.5% of rail, 5,519 B headroom; soft `nearCeiling` starts at 47,250); `scan-procedures.md` 42,453 → 42,475 B.
- Prose reads go through `tests/helpers/read-skill.js`'s `readText` (CRLF-safe).
- Commit messages: `{Verb} {what} — {detail}`, `refs #3291` (never `closes`/`fixes`).

## Corrected premises (logged to decisions.md)

- `premise reversed`: byte budget test named in the spec was deleted by #3311 → bound is the rail above.
- Scope-creep (`add-to-plan`): `scan-procedures.md:93` also emits an unrouted `— Archive` verb, so the AC3 test cannot pass without an Archive row. `plugin/bin/lib/residue/probes/pipeline-runs.js:117` emits `remedy: record` when the run's worktree is still locked (#1328), so line 93's "`remedy` is always `auto`" is false and the Archive routing must split by remedy the same way Backfill does — a single Auto-apply row would archive a run dir out from under a live session ("An Auto-apply row must be safe for every finding its class can produce", `step-6-auto.md`).

## Review Focus

- A future collect template whose action carries a qualifier (`— Delete (judgment)`) must still match its base row label — the extractor strips a trailing `(…)`.
- The format-description span on `scan-procedures.md:3` (`[type] item — detail — recommendation`) must not be read as a verb — excluded because it carries no `{placeholder}`.
- A Backfill/Archive `remedy: record` finding lands in **Yours** via the `Auto (no-op, always surfaced)` bucket mapping; it has no runnable command, so it keys under Yours' `review` group (Yours grouping rule, unchanged).
- Extractor going vacuous (zero verbs) must fail loud — the floor test pins `Delete`, `Archive`, `Backfill`.
- Removed prose pins: `git grep -n -F -e "add it by hand" -e "tagging released history" -e "re-run to confirm" -e "always \`auto\` for this kind" -- tests plugin docs` → only hits are `scan-procedures.md` itself and `docs/plugin-structure.md:25` (describes the probe, not the scan line — leave it). No test pins the removed text.

---

### Task 1: Routing rows, scan-procedures pointers, and the coverage test

**Files:**
- Test: `tests/tidy-scan-action-routing.test.js` (Create)
- Modify: `plugin/skills/tidy/step-6-auto.md` (insert three rows after the `**Delete** (legacy-root \`artifact\` finding …)` row, currently line 46)
- Modify: `plugin/skills/tidy/scan-procedures.md:93` and `:95`

**Interfaces:** none consumed or produced outside this task.

- [ ] **Step 1: Write the failing test** — create `tests/tidy-scan-action-routing.test.js` with exactly:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

// #3291: every `— {Action}` verb tidy's scan-procedures.md collects must have
// a matching **{Action}** row in step-6-auto.md's routing table, or the
// finding stages forever with no stated tier ("a finding class that keeps
// staging needs a routing row"). Release Backfill and pipeline-run Archive
// were the two verbs that had none.

const ROOT = path.join(__dirname, '..');
const SCAN = readText(path.join(ROOT, 'plugin/skills/tidy/scan-procedures.md'));
const AUTO = readText(path.join(ROOT, 'plugin/skills/tidy/step-6-auto.md'));

// A collect template is a backticked span opening with a `[tag]` and carrying
// a `{placeholder}` before its last ` — ` segment (the format-description
// span `[type] item — detail — recommendation` has none), or a continuation
// span opening with `— ` (`— Delete (judgment)`). The action is the last
// segment when it is a literal; a trailing `(qualifier)` names a variant
// routed by the same row label.
function scanActionVerbs(text) {
  const verbs = new Set();
  for (const m of text.matchAll(/`((?:\[[a-z-]+\]|—)[^`\n]*)`/g)) {
    const span = m[1];
    const parts = span.split(/(?:^| )— /);
    if (parts.length < 2) continue;
    const last = parts[parts.length - 1].trim();
    if (!last || last.includes('{')) continue;
    if (!span.startsWith('—') && !parts.slice(0, -1).join(' — ').includes('{')) continue;
    verbs.add(last.replace(/\s*\([^)]*\)\s*$/, ''));
  }
  return [...verbs].sort();
}

// Routing rows: `| **{Label}** {scope} | {conservative} | {moderate} | {aggressive} |`.
function routingRows(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\| \*\*([^*]+)\*\*/);
    if (!m) continue;
    rows.push({ label: m[1].trim(), cells: line.split('|').slice(1, -1).map((c) => c.trim()) });
  }
  return rows;
}

function assertEveryVerbRouted(scanText, autoText) {
  const labels = new Set(routingRows(autoText).map((r) => r.label));
  const missing = scanActionVerbs(scanText).filter((v) => !labels.has(v));
  assert.deepStrictEqual(missing, [], `scan-procedures.md action verb(s) with no step-6-auto.md routing row: ${missing.join(', ')}`);
}

function remedyRow(autoText, label, remedy) {
  const rows = routingRows(autoText).filter((r) => r.label === label && r.cells[0].includes(`\`remedy: ${remedy}\``));
  assert.strictEqual(rows.length, 1, `expected exactly one ${label} routing row for remedy: ${remedy}, found ${rows.length}`);
  return rows[0];
}
const backfillRow = (autoText, remedy) => remedyRow(autoText, 'Backfill', remedy);

function assertTierAtEveryLevel(row) {
  assert.strictEqual(row.cells.length, 4, `routing row needs scope + three tier cells: ${row.cells[0]}`);
  for (const tier of row.cells.slice(1)) assert.match(tier, /^(Auto-apply|Stage|Auto \(no-op, always surfaced\))/);
}

function assertNeverAutoApply(row) {
  for (const tier of row.cells.slice(1)) assert.doesNotMatch(tier, /Auto-apply/);
}

test('scan verb extraction floor: Delete, Archive, and Backfill are all found', () => {
  const verbs = scanActionVerbs(SCAN);
  for (const v of ['Delete', 'Archive', 'Backfill']) assert.ok(verbs.includes(v), `extractor missed ${v}: ${verbs.join(', ')}`);
});

test('AC3.1: every action verb scan-procedures.md emits has a matching step-6-auto.md routing row', () => {
  assertEveryVerbRouted(SCAN, AUTO);
});

test('AC3.1 go-red: deleting the Backfill rows makes the coverage check fail', () => {
  const withoutBackfill = AUTO.split('\n').filter((l) => !l.startsWith('| **Backfill**')).join('\n');
  assert.throws(() => assertEveryVerbRouted(SCAN, withoutBackfill), /Backfill/);
});

test('AC1.1: both release Backfill flavors state a tier at all three aggressiveness levels', () => {
  assertTierAtEveryLevel(backfillRow(AUTO, 'auto'));
  assertTierAtEveryLevel(backfillRow(AUTO, 'record'));
});

test('AC2.1: the heading-with-no-tag (remedy: record) Backfill flavor is never Auto-apply at any tier', () => {
  assertNeverAutoApply(backfillRow(AUTO, 'record'));
});

test('AC2.1 go-red: an Auto-apply tier on the remedy: record row fails the check', () => {
  const row = backfillRow(AUTO, 'record');
  assert.throws(() => assertNeverAutoApply({ ...row, cells: [row.cells[0], row.cells[1], 'Auto-apply', row.cells[3]] }));
});

test('Archive: a pipeline-run held by a live session (remedy: record, #1328) is never Auto-apply; remedy: auto states all three tiers', () => {
  assertTierAtEveryLevel(remedyRow(AUTO, 'Archive', 'auto'));
  const held = remedyRow(AUTO, 'Archive', 'record');
  assertTierAtEveryLevel(held);
  assertNeverAutoApply(held);
  const para = SCAN.split('\n').find((l) => l.startsWith('Each `kind: pipeline-run` finding'));
  assert.ok(para, 'kind: pipeline-run paragraph not found');
  assert.match(para, /`step-6-auto\.md`'s two \*\*Archive\*\* rows/);
  assert.doesNotMatch(para, /always `auto`/);
});

test('scan-procedures.md release paragraph points at the Backfill rows instead of carrying the disposition inline', () => {
  const para = SCAN.split('\n').find((l) => l.startsWith('Each `kind: release` finding'));
  assert.ok(para, 'kind: release paragraph not found');
  assert.match(para, /`step-6-auto\.md`'s two \*\*Backfill\*\* rows/);
  assert.doesNotMatch(para, /add it by hand/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tidy-scan-action-routing.test.js`
Expected: FAIL — 6 of 8 fail (AC3.1 names `Archive, Backfill` as unrouted); only the extraction-floor test and the AC3.1 go-red control pass on the unmodified tree.

- [ ] **Step 3: Implement — `step-6-auto.md` routing rows.** Insert these four lines verbatim directly after the row starting `| **Delete** (legacy-root \`artifact\` finding`:

```markdown
| **Archive** (`kind: pipeline-run` residue, `remedy: auto` — a clean, un-archived run directory; the move under `.claude-tweaks/pipelines/archive/`, `wrap-up/cleanup-procedures.md` Section B) | Auto-apply | Auto-apply | Auto-apply — a gitignored local move that deletes nothing, the same reversibility as Archival compaction below |
| **Archive** (`kind: pipeline-run` residue, `remedy: record` — the run's recorded worktree is still locked by a live session, #1328) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) — never archived at any tier: moving the run dir would pull it out from under the session that still holds it |
| **Backfill** (`kind: release` residue, `remedy: auto` — a `v*` tag with no CHANGELOG heading; add the heading in a grammar `bin/lib/residue/probes/release.js` reads, then re-run it to confirm) | Stage | Stage | Auto-apply — a tracked-file edit, but CHANGELOG.md is the published release record and a stray `v*` tag would get a heading for a release that never shipped, so only `aggressive` writes it unreviewed |
| **Backfill** (`kind: release` residue, `remedy: record` — a CHANGELOG heading with no local or remote tag, #2882) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) — never auto-applied at any tier: creating or pushing a tag is an outward-facing write, and choosing the commit that shipped that version is a human call |
```

- [ ] **Step 4: Implement — `scan-procedures.md` pointers.** Two in-place replacements (rest of each paragraph unchanged):
  - Line 93: replace `` (`remedy` is always `auto` for this kind — the archival move documented in `wrap-up/cleanup-procedures.md` Section B). `` with `` , routed by `remedy` per `step-6-auto.md`'s two **Archive** rows (`auto`: the archival move in `wrap-up/cleanup-procedures.md` Section B; `record`: a live session still holds the run's worktree, #1328). ``
  - Line 95: replace `` (`remedy: auto`, a tag missing its heading: add it by hand in the format `evidence` names, re-run to confirm; `remedy: record`, a heading with no local or remote tag, #2882: tagging released history is a human call). `` with `` , routed by `remedy` per `step-6-auto.md`'s two **Backfill** rows (`auto`: a tag missing its heading; `record`: a heading with no local or remote tag, #2882). ``

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/tidy-scan-action-routing.test.js`
Expected: PASS, 8/8. Then go-red by hand (AC3.1's "checked by temporarily deleting the Backfill row"): delete both `| **Backfill**` lines from `step-6-auto.md`, re-run — AC3.1 FAILS naming `Backfill`; re-insert the two lines with Edit (never `git checkout --`), then re-run → 8/8. Also run `wc -c plugin/skills/tidy/step-6-auto.md plugin/skills/tidy/scan-procedures.md` → 46981 / 42475 (± a few bytes).

- [ ] **Step 6: Run the neighbouring tidy suites** — `node --test tests/tidy-*.test.js tests/bin-lib/tidy-report-lint/*.test.js tests/reverify-before-write-conformance.test.js` → all pass.

- [ ] **Step 7: Commit**

```bash
git add tests/tidy-scan-action-routing.test.js plugin/skills/tidy/step-6-auto.md plugin/skills/tidy/scan-procedures.md
git commit -m "Route tidy's release Backfill and pipeline-run Archive findings in step-6-auto — one row per remedy, coverage test pins every scan verb

refs #3291"
```

---

## Spec coverage map

| Spec item | Covered by |
|---|---|
| Deliverable 1 — Backfill row(s), record never auto, auto gets a tier | Step 3; tests AC1.1, AC2.1 |
| Deliverable 2 — scan-procedures release paragraph points at the row | Step 4; test "release paragraph points at the Backfill rows" |
| Deliverable 3 — conformance test: every scan verb has a routing row | Step 1; test AC3.1 |
| AC1.1 — tier for both flavors at all three levels | test `AC1.1: …` |
| AC2.1 — heading-with-no-tag never Auto-apply | tests `AC2.1: …` + `AC2.1 go-red` |
| AC3.1 — test fails when a verb has no row (delete Backfill row) | tests `AC3.1: …` + `AC3.1 go-red`; manual delete in Step 5 |

## Self-review

- **Spec coverage:** every Deliverable and Acceptance Criterion maps to a step and a named test (table above).
- **Placeholders:** none. Inline test run against inlined edits in a scratch mirror: 8/8 pass; against the unmodified files: 6 fail (go-red confirmed).
