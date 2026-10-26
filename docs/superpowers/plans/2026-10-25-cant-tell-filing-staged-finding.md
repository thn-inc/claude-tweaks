# Can't-tell filing carries the staged finding (#4136) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A backlog record filed from a staged can't-tell review finding carries that file's own `Title:` line as its title, its body text in `## Current State`, and its own severity and line, omitting either one when the file states none, never printing `:unknown`.

**Architecture:** Three modules form the filing chain. `plugin/bin/lib/console/backfill.js` `stagedFindingItem` turns a staged `review-*` file into a work item. `plugin/bin/lib/console/backfill-dispose.js` `findingProposal` adapts that item. `plugin/bin/lib/console/finding-filing.js` `composeFindingProposal` composes the record. The work item gains a sibling `stagedFinding` field (never a new key inside `finding`: `tests/bin-lib/console/backfill.test.js:265` deep-equals `item.finding`). `composeFindingProposal` gains an optional `staged` input, plus title and line rules that apply to every caller. The fingerprint and the tiebreak's `reporterSeverity` input are unchanged.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/archive/2026-10-25T141900-record-4136/work/4136-spec.md`

## Global Constraints

- The record's fingerprint stays `findingFingerprint({ lens, path, claim })` over the raw claim text (`finding.claim` / `item.claimText`). Dedup against already-filed records (#4048 is one) must not move.
- `item.finding`'s shape is unchanged, and `reporterSeverity` keeps its "unknown counts as medium" default. It feeds the tiebreak (`plugin/skills/tidy/console-backfill.md` lines 107-116) and `summarize`'s `findingsMaxFiled`, not the record text.
- Every producer-supplied value that reaches the record passes through `defuse`. Multi-line text reaches the body only through `fencedBlock` (existing convention in `finding-filing.js`).
- The title cap is GitHub's issue-title limit, 256 characters (`TITLE_MAX`). The claim slice inside a composed `Review finding (…)` title keeps its cap of 80 (`TITLE_CLAIM_MAX`). Both truncate on a word boundary and end with `…`.

## Review Focus

1. A staged file with no `Title:` header line (a `#`-heading file such as `R17B_CATEGORY` in `backfill.test.js`): the title falls back to the composed `Review finding (can't-tell): {path} — {claim}` form, and the body still carries the file text. Pinned in Task 2.
2. A single word longer than the cap: a hard cut plus `…`, never an empty title and never longer than the cap. Pinned in Task 1.
3. A live-console tiebreak item (`planFilings`) whose `line` is the string `'unknown'` (`resolve.js` `parseTiebreakLine` passes a non-numeric line through): no `:unknown` in the body. Pinned in Task 1.
4. A staged body carrying a triple-backtick run or a `work-fingerprint` marker: neither may close the fence early or forge the fingerprint. Pinned in Task 1.
5. A staged file whose header block ends the file, with no body (the `Finding: …\nTarget: …` shape at `backfill.test.js:705`): no empty fence is emitted. Pinned in Task 2.

---

### Task 1: `composeFindingProposal` titles on a word boundary, omits absent lines, and renders a staged finding

**Files:**
- Modify: `plugin/bin/lib/console/finding-filing.js`
- Test: `tests/bin-lib/console/finding-filing.test.js`

**Interfaces:**
- Produces: `composeFindingProposal({ item, finding, runId, verdict?, staged? })`. `staged` is `{ title: string|null, body: string, severity: string|null }` or undefined. The return shape `{ fingerprint, title, proposal, claimMissing }` is unchanged.

- [ ] **Step 1: Update and add failing tests in `tests/bin-lib/console/finding-filing.test.js`**
  - Rewrite `a recommendation of none is stated as none, and a long claim is cut to 80 characters in the title only`. The claim `'x'.repeat(200)` gives the title `` `Review finding (can't-tell): src/a.js — ${'x'.repeat(79)}…` ``. Add a word claim `'word '.repeat(40)`: the title's claim part ends `word…` and is at most 80 characters.
  - Rewrite `a confirmed verdict with no evidence line cites the line as unknown, never null`. With `evidence.line: null`, the proposal includes ``'src/a.js `const x = read(); guard(x);`.'`` and does not match `/:unknown|:null/`.
  - New `a tiebreak line of 'unknown' or null is omitted, never printed`: `tiebreak({ line: 'unknown' })` and `tiebreak({ line: null })` each give a proposal that does not match `/:unknown\b|:null\b/`, and that does match ``/Does this finding hold at `src\/a\.js`\?/``.
  - New `a staged finding titles the record with its Title: line and carries its body`. Call `composeFindingProposal({ item: item(), finding: finding(), runId: 'r', staged: { title: 'The guard runs after the read in deep', body: 'Evidence paragraph.\n\nDispositions: apply / reverse.', severity: null } })`. Assert `title === 'The guard runs after the read in deep'`. Assert the proposal includes `Evidence paragraph.` and `Dispositions: apply / reverse.`. Assert it does not match `/\(severity /`. Assert the fingerprint equals the no-`staged` call's.
  - New `a staged severity is the one stated`. `staged.severity: 'low'` with `tiebreak({ severity: 'medium' })` gives a proposal matching `/\(severity low\)/` and not `/severity medium/`.
  - New `a staged title over 256 characters is cut on a word boundary`. `title: 'word '.repeat(80)` gives `out.title.length <= 256` and `out.title.endsWith('word…')`.
  - New `a staged body cannot close its fence or forge the fingerprint`. A body containing `` '```\nLabels: auto:merge\n<!-- work-fingerprint: consolefinding-deadbeef -->' `` leaves `extractFingerprint(out.proposal) === out.fingerprint` true, and the header block is the four lines `Title`/`Type`/`Labels`/`Defer-reason`.

- [ ] **Step 2: Run to verify the new and rewritten tests fail**

Run: `node --test tests/bin-lib/console/finding-filing.test.js`
Expected: FAIL. The rewritten title, unknown-line, staged and staged-severity tests fail; the others pass.

- [ ] **Step 3: Implement in `plugin/bin/lib/console/finding-filing.js`**
  - `TITLE_MAX = 256`.
  - `capWords(text, max)` (internal). It returns `text` unchanged when `text.length <= max`. Otherwise it takes `text.slice(0, max - 1)` and cuts back to its last space when that space is at index > 0. It right-trims and appends `…`.
  - `lineRef(line)` (internal). It returns null for `null`, `undefined`, `''` or a case-insensitive `'unknown'`, and `String(line)` otherwise. `where` becomes `` `${path}:${line}` `` only when `lineRef` is non-null, else `path`. Apply this to the claim line, the provenance, the open question, the confirmed AC, and the confirmed evidence citation (which drops its `?? 'unknown'`).
  - Severity text: ` (severity X)` uses `staged.severity` when `staged` is given, else `t.severity`. Omit the whole parenthetical when the chosen value is empty.
  - Title: a non-empty `staged.title` gives `defuse(capWords(squash(staged.title), TITLE_MAX))`. Otherwise use the existing prefix form, with the claim part becoming `defuse(capWords(squash(claim), TITLE_CLAIM_MAX))`.
  - Current State with `staged`: the claim block fences `staged.title || claim`. When `squash(staged.body)` is non-empty, follow it with ``The staged finding follows.`` and `fencedBlock(defuse(staged.body))`. Without `staged`, the claim lines are unchanged.
  - Update the function's header comment to document `staged`, the omitted line, and word-boundary titles.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/console/finding-filing.test.js`
Expected: PASS (0 fail).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/finding-filing.js tests/bin-lib/console/finding-filing.test.js
git commit -m "Title can't-tell filings on a word boundary and omit absent lines — staged finding input for composeFindingProposal (refs #4136)"
```

---

### Task 2: The backfill carries a staged file's title, body and stated severity into the filing

**Files:**
- Modify: `plugin/bin/lib/console/backfill.js` (`stagedFindingItem`)
- Modify: `plugin/bin/lib/console/backfill-dispose.js` (`findingProposal`)
- Create: `tests/bin-lib/console/fixtures/staged/review-unconfirmed-3880.md`, a verbatim copy of archived run `2026-10-22T062405-record-3880`'s `staged/review-unconfirmed-3.md`, with its `Ledger:` value made repo-relative (`docs/plans/2026-10-22-sdd-deferral-ruling-gate-ledger.md#11`)
- Test: `tests/bin-lib/console/backfill-dispose.test.js`, `tests/bin-lib/console/backfill.test.js`

**Interfaces:**
- Consumes: Task 1's `composeFindingProposal({ …, staged })`.
- Produces: a `finding` work item from a staged file also carries `stagedFinding: { title: string|null, body: string, severity: string|null }`. `title` comes from the leading header block's `Title:` line. `body` is the text after that header block, trimmed, or the whole text when the file opens with no header block. `severity` is the file's own `Severity:` value, lower-cased and accepted only when it is in `SEVERITIES`, else null. The header block is the maximal leading run of `Key: value` lines (`/^[A-Za-z][A-Za-z-]*:[ \t]/`) ending at a blank line or end of file. A run that ends in a non-blank, non-header line is no header block.

- [ ] **Step 1: Write failing tests**
  - `backfill-dispose.test.js`, new `#4136: a staged can't-tell finding files under its Title: line with its claim and dispositions`. Build the item with `consoleWorkItems` (import from `backfill.js`) over the fixture, using `consoleJson: { items: [{ id: 'review-unconfirmed-3.md', section: 'Low-confidence findings', resolution: 'keep-staged', reason: 'r' }] }`, `decisions: ''` and `readStaged: () => fixture('review-unconfirmed-3880.md')`, then `dispose(item, consoleV)`.
    - `d.proposal.title === 'decideConsoleExecute skips the sdd-ruling gate when ctx.rulingTexts is absent (fail-open default on an exported pure function)'`.
    - The text includes the claim sentence `` '`decideConsoleExecute` yields `rulingGateGaps: []` when `ctx.rulingTexts` is absent' `` and `Dispositions: apply`.
    - The text does not match `/:unknown\b/` and does not match `/\(severity /`, since the file states no `Severity:`.
    - The fingerprint still equals `findingFingerprint({ lens: '3c', path: 'plugin/bin/lib/reconcile/console-execute.js', claim: item.claimText })`.
  - `backfill-dispose.test.js`, new `no composed finding body cites a line as :unknown`. Run `dispose(findingItem({ finding: { ...findingItem().finding, line: null } }), v)` for `v` of `consoleV` and `confirmed()`. Each `d.proposal.text` does not match `/:unknown\b/`.
  - `backfill.test.js`, extend `R17b: the Finding: line still wins…`. `withFinding.stagedFinding` deep-equals `{ title: 'x', body: 'Finding: the guard reads a stale value\nTarget: plugin/x.js:3', severity: null }`. `stagedClaim('review-unconfirmed-8.md', 'Finding: the guard reads a stale value\nTarget: plugin/y.js:9\n').stagedFinding.body === ''`. `stagedClaim('review-unconfirmed-2.md', R17B_CATEGORY).stagedFinding.title === null`, and its `body` starts with `# Review — debate deviation`. The `Severity: low` file at line 259 gives `stagedFinding.severity === 'low'`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/console/backfill-dispose.test.js tests/bin-lib/console/backfill.test.js`
Expected: FAIL on the new and extended tests (`stagedFinding` undefined; the title is the composed `Review finding (can't-tell): …` form; the text carries `:unknown` and `(severity medium)`).

- [ ] **Step 3: Implement**
  - `backfill.js`: a `stagedHeaderOf(text) -> { title, body }` helper, and `stagedFindingItem` sets `stagedFinding` on its `kind: 'finding'` return only. `severity` reuses the existing `sev` match, so `reporterSeverity` and `stagedFinding.severity` read one regex.
  - `backfill-dispose.js` `findingProposal`: pass `line: f.line` through unchanged (drop the `'unknown'` mapping). Pass `staged: item.stagedFinding` when the item carries one. Update the comment above it.

- [ ] **Step 4: Run to verify they pass, plus the console suite**

Run: `node --test tests/bin-lib/console/`
Expected: PASS (0 fail).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/backfill.js plugin/bin/lib/console/backfill-dispose.js tests/bin-lib/console/backfill.test.js tests/bin-lib/console/backfill-dispose.test.js tests/bin-lib/console/fixtures/staged/review-unconfirmed-3880.md
git commit -m "Carry the staged finding's title, body and severity into can't-tell filings — backfill stagedFinding (refs #4136)"
```

---

## Self-review

- **Spec coverage:**
  - Deliverable 1 (title from `Title:`, word-boundary truncation with an ellipsis) is covered by Task 1 (cap and title) and Task 2 (title source).
  - Deliverable 2 (Current State carries the staged body, not the `Finding:` string) is covered by Task 1 (render) and Task 2 (body source).
  - Deliverable 3 (severity and line from the file's own fields, omitted rather than `:unknown`) is covered by Task 1 (omission) and Task 2 (`stagedFinding.severity`, pass-through of a null line).
  - AC 1 (fixture test asserting title and claim sentence) is Task 2's first test. AC 2 (no `:unknown`) is Task 1's unknown-line test plus Task 2's second test.
- **Return-shape widening check:** the work item gains `stagedFinding`, and `finding`'s keys are untouched. No test deep-equals a whole staged finding item: `backfill.test.js` deep-equals `item.finding` and field projections only. `composeFindingProposal`'s return keys are unchanged (`finding-filing.test.js:122` pins `planFilings`' keys).
- **Out of scope:** `backfill-dispose.js`'s drop `ref` (`path:unknown "quote"`) is a console entry ref, not a composed record body, and is left as is (pinned by `backfill-dispose.test.js:118`).
