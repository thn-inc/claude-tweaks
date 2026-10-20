# Review Medium-Tier Cross-Lens Corroboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At `review-effort: medium`, a finding left `unconfirmed` by its own lens's reproduction pair but reported independently by two or more *different* lenses is emitted `confirmed`, with a decisions.md line that names those lenses.

**Architecture:** A pure, deterministic pass `corroborateCrossLens` in `plugin/bin/lib/coordination.js` clusters unconfirmed findings across lenses (same path, lines within ±5, known substance similarity ≥ `SUBSTANCE_SIMILARITY_MIN`). It uses connected components, not greedy pairing, so no finding can be stranded. A new `corroborate-cross-lens` subcommand of `plugin/bin/review-coordination.js` exposes it. The review prose procedure lives in a new lazy file, `plugin/skills/review/step3-cross-lens-corroboration.md`, read only at `medium`. `step3-lens-dispatch.md` is at 48,155 B of the 52,500 B rail (91.7%), so the procedure cannot go there. `code-mode-steps.md` gates the pass, and `step3-lens-dispatch.md` defers its per-finding "not reproduced" STAGED writes at `medium` until after the pass. Without that deferral, a promoted finding would still appear in the Wrap-Up Console's Low-confidence section, because `plugin/bin/lib/console/resolve.js`'s `coordinationItems` turns every `STAGED … unconfirmed/low-confidence` decisions.md line into a Low-confidence row.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T210201-record-3604/work/3604-spec.md`

## Global Constraints

- Corroboration runs at `medium` only. `high`+ (Step 3.5 debate) is unchanged, and so is the `low` single-read rule.
- It runs over `unconfirmed` findings only; a `confirmed` finding is never an input.
- Match rule: different lenses, exact path, |line delta| ≤ 5, both texts known, and `substanceSimilarity` ≥ `SUBSTANCE_SIMILARITY_MIN` (0.2). Missing text never corroborates.
- Log line (exact): `AUTO {HH:MM:SS} — Cross-lens corroboration (medium tier): finding {path}:{line} reported independently by lenses {lens list}. Confirmed. Reversibility: high.` When `severityContested` is set (exact): `AUTO {HH:MM:SS} — Cross-lens corroboration (medium tier): finding {path}:{line} reported independently by lenses {lens list}, severity contested (took the highest). Confirmed. Reversibility: high.`
- No file under `plugin/skills/**` may exceed `RAIL_BYTES` (52,500).
- Scope keywords: corroborate, cross-lens, detect-overlap

## Review Focus

1. Two findings from the *same* lens (the two agents of one pair that didn't reproduce) must not corroborate each other. Pinned in Task 1 (`same lens never self-corroborates`).
2. A lens 3f vacuity finding downgraded for missing execution evidence must not be re-confirmed through agreement with another lens: the same shared-misread risk applies. The prose excludes it from the input (Task 2, pinned in the conformance test).
3. Three lenses on one defect must yield **one** confirmed row, not three. Pinned in Task 1 (`three lenses collapse to one row`).
4. Lenses that disagree on severity: the confirmed row takes the highest member severity (its representative is the most severe member) and sets `severityContested: true`, mirroring `step3-routing.md`'s cross-lens de-dup rule (keep the higher severity) — the lowest would let a corroborating `low` finding demote a `critical` one into AUTO-apply (final-review ruling R1, superseding the original #733-precedent choice). A chain cluster is carved into rows of members that directly match each row's representative, so no distinct finding is absorbed (ruling R3). Pinned in Task 1.
5. Findings 6+ lines apart, or with different substance, stay unconfirmed. Pinned in Task 1.

---

### Task 1: `corroborateCrossLens` primitive + CLI subcommand

**Files:**
- Modify: `plugin/bin/lib/coordination.js` (new constant, new function, exports)
- Modify: `plugin/bin/review-coordination.js` (new subcommand, USAGE, header comment)
- Test: `tests/multi-agent-coordination.test.js` (append)
- Test: `tests/bin-lib/review-coordination/cli.test.js` (append)

**Interfaces:**
- Produces: `LINE_TOLERANCE_CORROBORATION = 5` (exported), and `corroborateCrossLens(unconfirmedByLens: {[lens: string]: Finding[]}) -> { corroborated: CorroboratedFinding[], unconfirmed: {[lens: string]: Finding[]} }`. A `CorroboratedFinding` is the representative finding, normalized via `normalizeFinding`, plus: `severity` (the lowest member severity by `severityRank`, normalized to a string), `severityContested: true` only when member `severityBucket`s differ, `lenses: string[]` (distinct lens names in input key order), and `members: Array<{lens, path, line, severity, text}>`. The representative is the member that comes first in input key order and then index order. `unconfirmed` keeps every input lens key, holding the normalized findings that are in no qualifying cluster (an empty array when none).
- CLI: `review-coordination.js corroborate-cross-lens <unconfirmed-by-lens.json>` prints `JSON.stringify(corroborateCrossLens(input))`. It exits 2 on wrong arity, unreadable or invalid JSON, a non-object input, or any lens value that is not an array.

- [ ] **Step 1: Write the failing tests** (in `tests/multi-agent-coordination.test.js`, after the existing `detectCrossLensOverlap` tests)
  - `AC1.1: two different lenses reporting the same path/line and substance corroborate to confirmed`. Input: `{ '3b': [{path:'x.js', line:10, severity:'low', text:'superseded failed run marks real PR failure inherited'}], '3c': [{path:'x.js', line:12, severity:'low', text:'superseded failed run at base marks PR failure as inherited'}] }`. Expect `corroborated.length === 1`, `lenses` deepEqual `['3b','3c']`, `unconfirmed['3b']` and `unconfirmed['3c']` both empty.
  - `AC1.2: a finding reported by one lens only stays unconfirmed`. Input: one lens with one finding, plus a second lens with an unrelated finding on another path. Expect `corroborated` empty and both findings still in `unconfirmed`.
  - `same lens never self-corroborates`. Input: `{ '3a': [f1, f1-twin-at-line+1] }`. Expect `corroborated` empty and both entries left in `unconfirmed['3a']`.
  - `three lenses collapse to one row with the lowest severity, contested`. Input: 3a `high`, 3b `low`, 3c `low`, all on the same defect (the spec's example). Expect one row, `severity === 'low'`, `severityContested === true`, and `lenses` deepEqual `['3a','3b','3c']`.
  - `matching-bucket members carry no severityContested`. Input: two lenses, both `low`. Expect `severityContested === undefined`.
  - `±5 boundary`: delta 5 corroborates, delta 6 does not.
  - `different substance stays unconfirmed`. Same path/line, texts with Jaccard < 0.2 (e.g. `'sql injection in query builder'` vs `'missing await on file close'`). Expect nothing corroborated.
  - `missing text never corroborates`. Same path/line, one side without any text key. Expect nothing corroborated.
  - `combined Path:Line transcription is normalized`. Use `{ 'Path:Line': 'x.js:10', Severity: 'low', Finding: '…' }` shaped inputs and expect corroboration to work.
- [ ] **Step 2: Run** `node --test tests/multi-agent-coordination.test.js`. Expected: FAIL (`c.corroborateCrossLens is not a function`).
- [ ] **Step 3: Implement `corroborateCrossLens`** in `coordination.js`. Normalize every finding, then add an edge for each cross-lens pair where `sameLocation(fa, fb, LINE_TOLERANCE_CORROBORATION)` holds and `substanceSimilarity(fa, fb)` is non-null and ≥ `SUBSTANCE_SIMILARITY_MIN`. Union-find over `(lens, index)` nodes gives the clusters, and a cluster qualifies when it spans ≥ 2 distinct lenses. Add a header comment naming #3604 and saying why it uses components rather than greedy pairing: nothing can strand, per the Greedy-assignment stranding precedent (#2907).
- [ ] **Step 4: Write the failing CLI tests** (in `cli.test.js`)
  - `corroborate-cross-lens matches the library result exactly`
  - Extend the malformed-invocation test: wrong arity, an array input, and `{ '3b': 'not-an-array' }` each exit 2.
- [ ] **Step 5: Implement the subcommand** in `review-coordination.js`, following `detect-overlap`'s branch shape plus the per-value array check. Add the USAGE line and the header-comment line.
- [ ] **Step 6: Run** `node --test tests/multi-agent-coordination.test.js tests/bin-lib/review-coordination/cli.test.js`. Expected: PASS.
- [ ] **Step 7: Commit** both lib files and both test files: `Add corroborateCrossLens primitive and CLI — refs #3604`.

### Task 2: Review prose — medium-tier pass, gate, STAGED deferral, docs

**Files:**
- Create: `plugin/skills/review/step3-cross-lens-corroboration.md`
- Modify: `plugin/skills/review/code-mode-steps.md` (new `### Cross-Lens Corroboration (\`medium\` only)` subsection immediately before `### Step 3.5 & 3.6`; the skip paragraph's "proceed directly to Step 3 Routing" for `medium` now says "after Cross-Lens Corroboration")
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (the `Findings present in only one agent's output` bullet gains one sentence deferring its STAGED write at `medium`; the Post-fan-out sweep's `low`/`medium` sentence says that at `medium` the sweep runs after corroboration)
- Modify: `plugin/skills/_shared/multi-agent-coordination.md` (Mode 1: a short `### Cross-lens corroboration (/review medium tier)` subsection after `### Auto-resolution`, stating the match rule and that no agents are dispatched)
- Modify: `plugin/skills/_shared/fast-lane-digest.md` (add the new file to the Steps 3/3.5/3.6 row's file list)
- Modify: `docs/plugin-structure.md` (review row: list the new file and a lazy-load note: "medium tier only")
- Test: Create `tests/review-cross-lens-corroboration-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's CLI `corroborate-cross-lens` and its output fields `corroborated[].lenses`, `.path`, `.line`, `.severity`, `.severityContested`, and `unconfirmed`.

New file content, which each requirement below must state:
1. Runs only when the resolved tier is `medium`. At `low` the single-read rule applies unchanged, and at `high`+ Step 3.5's Cross-Lens Debate applies unchanged; neither tier runs this pass.
2. Input: every lens's `unconfirmed` findings after each pair's `categorise-reproduction` and the lens 3f bullet have run, **excluding** lens 3f vacuity findings downgraded for missing execution evidence (only an executed run re-confirms those). The input is written as a `{lens: [findings]}` object to the session-tmp path `review-{ctx-id}-unconfirmed-by-lens.json`, resolved via `session-tmp-resolve.js`, the same pattern as `findings-by-lens.json`.
3. Command: `node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" corroborate-cross-lens {path-U}`.
4. Each `corroborated` entry is emitted `confirmed`, enters Step 3 Routing as an ordinary confirmed row (Category = the representative's lens), carries `severityContested` into the routing entry when set, and writes the Global Constraints log line with `{lens list}` = the comma-joined `lenses`.
5. Each finding left in `unconfirmed` then gets the deferred `not reproduced` (or share-a-location) STAGED line from `step3-lens-dispatch.md`.
6. Order: corroboration → deferred STAGED lines → post-fan-out sweep → Step 3 Routing.
7. Exit non-zero or unparseable output: no finding is promoted. Write the deferred STAGED lines as usual, and log `SKIP {HH:MM:SS} — Cross-lens corroboration (skipped): review-coordination.js exited {code} → findings stay unconfirmed. Reversibility: n/a.`

- [ ] **Step 1: Write the failing conformance test.** One assertion function per file, so each go-red control calls the same function on mutated text (Go-red control check).
  - `AC1.1: the medium-tier pass promotes cross-lens findings to confirmed and logs the lenses`. On the new file, assert the `corroborate-cross-lens` command, the exact log-line literal from Global Constraints, the word `confirmed`, and `Step 3 Routing`.
  - `AC1.2: a finding left unconfirmed keeps its deferred STAGED line`. Assert that the new file names `not reproduced` as the remaining findings' STAGED line, and that the `step3-lens-dispatch.md` "only one agent's output" bullet contains `At \`medium\`` together with `step3-cross-lens-corroboration.md`.
  - `AC1.3: the low single-read rule and the high+ debate are unchanged`. Assert the new file states the pass never runs at `low` or `high`. Also assert that `step3-lens-dispatch.md` still contains `Every finding a single-read agent returns enters as \`unconfirmed\`, and the only path to \`confirmed\` is the Direct-verification override`.
  - `gate: code-mode-steps.md reads the file at medium, before Step 3.5`. Assert that the `### Cross-Lens Corroboration` heading index is less than the `### Step 3.5 & 3.6` index, and that the section between them cites `step3-cross-lens-corroboration.md` and `medium`.
  - `lens 3f vacuity downgrades are excluded from the input`. Assert the new file matches `/vacuity/` and `/excluded|exclude/`.
  - Go-red controls: (a) replace `corroborate-cross-lens` in the new file's text, then call the AC1.1 assertion function and expect a throw; (b) strip the `At \`medium\`` sentence from the bullet, call the AC1.2 function, and expect a throw.
- [ ] **Step 2: Run** `node --test tests/review-cross-lens-corroboration-conformance.test.js`. Expected: FAIL (ENOENT on the new file).
- [ ] **Step 3: Write the new file and the edits** listed in Files. Edit in place and keep the existing sentences intact: `tests/multi-agent-coordination.test.js`'s `decisionLogPattern` needs exactly one REVIEW_SKILL line containing `Findings present in only one`, and `tests/review-vacuity-evidence-conformance.test.js` anchors `^> - Findings present in only one agent's output`, so the bullet must keep its prefix and stay one line.
- [ ] **Step 4: Run** `node --test tests/review-cross-lens-corroboration-conformance.test.js tests/multi-agent-coordination.test.js tests/review-vacuity-evidence-conformance.test.js tests/bin-lib/review-context/prose.test.js tests/review-defect-anchor-conformance.test.js tests/review-coverage-anchor-conformance.test.js tests/review-no-executable-content-skip.test.js tests/review-lens-no-suites-conformance.test.js tests/review-dispatch-composition.test.js tests/dispatch-prompt-bundle-citations.test.js`, then `wc -c plugin/skills/review/*.md` (each < 52,500). Expected: PASS.
- [ ] **Step 5: Commit** the new file, the five modified prose/doc files, and the test: `Add review medium-tier cross-lens corroboration prose — refs #3604`.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable: medium-tier cross-lens match over unconfirmed only (path ±5 + substance) | Task 1 (primitive) + Task 2 (procedure) |
| Deliverable: emit `confirmed` with a log line naming the lenses | Task 2 req. 4 |
| Deliverable: keep `high`+ unchanged | Task 2 req. 1, AC1.3 test |
| Deliverable: pin in review prose conformance tests | Task 2 test file |
| AC1.1 / AC1.2 / AC1.3 | Task 1 and Task 2 tests named by id |
