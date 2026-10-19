# Build Review Minors Need a Defer-reason — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/build` fixes Minor+ review findings or carries them to the ledger only with a valid inline `Defer-reason:`, and wrap-up's ledger parse flags `build`-phase rows that skip it.

**Architecture:** Prose: two citations of `_shared/deferral-gate.md` (SDD invocation in `build/dispatch.md`, ledger-write step in `build/SKILL.md` Common Step 4). Code: `parseLedger` in `plugin/bin/lib/wrap-up/pack.js` gains two additive fields (`missingDeferReason`, `missingDeferReasonItems`), aggregated by `ledgerProbe`, surfaced as a non-blocking warning in `wrap-up/SKILL.md` next to the unrecognized-status warning.

**Tech Stack:** Node 18+ CommonJS, `node --test`, Markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T160543-record-3004/work/3004-spec.md`

Scope keywords: parseLedger

## Global Constraints

- Validity vocabulary is `DEFER_REASONS` — import it from `plugin/bin/lib/issues/record.js` (the source of truth; `autonomy.js` itself imports it from there and does not re-export it).
- Add fields to `parseLedger`'s return; never change or remove an existing field (Resolve Gate and the #2080 warning consume it).
- The wrap-up warning never blocks and never changes the gate's `total > 0` / `open` conditions.
- Do not edit the superpowers skill — the rule travels in `/build`'s SDD invocation text.
- Commit messages: `{Verb} {what} — {detail}`, reference the record as `refs #3004`, never `closes`/`fixes`.

## Design decision (Gotcha 1 — state in the PR)

Backstop scope: rows whose Phase is exactly `build` (case-insensitive), status `deferred` or `open`. `build/skill`, `build/docs`, `build/ops` rows are other producers (skill observations, doc deferrals, ops items with `reason-not-auto`) and are out of scope. Blocked-work rows (Common Step 4) **must** name `Defer-reason: blocked-dependency` or `blocked-external` — the backstop does not special-case them. A row whose Item or Resolution names a `staged/` path, or a record reference (same `namesRecordReference` rule `deferredUnstaged` uses, run-own records excluded), is exempt: its reason lives in the staged proposal's / filed record's own `Defer-reason:` (that is how SDD `Ruling:` rows, `open` with `(staged/sdd-ruling-N.md)`, stay unflagged).

A Resolution is valid iff it contains exactly one `Defer-reason:` token and its value is in `DEFER_REASONS`. Match: `/Defer-reason:\s*`?([A-Za-z-]+)`?/g` over the Resolution text (`cells.slice(4).join('|')`).

**As built (Common Step 4.5, Beneficial):** the final whole-branch review added two refinements — rows whose Item starts with the SDD carry-forward template `SDD ruling —` are exempt too (the no-run-dir and degraded-staging paths write a ruling row without a staged path; a ruling is a decision, not a deferral), and the `Defer-reason:` regex gained an end boundary `(?![\w-])`. Common Step 4's blocked-row instruction now names phase `build` (was `build/*`), so the producer text names exactly the phase the backstop checks. `DEFER_REASONS` is imported from `issues/record.js` (its only code home) rather than the spec's `autonomy.js` pointer.

## Review Focus

1. A blocked-work `open` row naming `Defer-reason: blocked-dependency` — must NOT be flagged (Task 1 test).
2. `Defer-reason: minor` (out-of-vocabulary value) — flagged (Task 1 test).
3. Two `Defer-reason:` tokens in one Resolution — flagged ("exactly one") (Task 1 test).
4. An SDD `Ruling:` row (`open`, Item names `staged/sdd-ruling-1.md`) and `build/skill`/`build/docs`/`review` rows with no reason — NOT flagged (Task 1 test).
5. Status cell casing (`Deferred`) and the `{run-dir}/ledger.md` probe branch — item ids prefixed `ledger.md#` (Task 1 test).

---

### Task 1: `parseLedger` missing-Defer-reason backstop + wrap-up warning

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js` (`parseLedger` ~381, `ledgerProbe` ~433-508 incl. the empty return at ~451 and the totals literal at ~483)
- Modify: `plugin/skills/wrap-up/SKILL.md` (new paragraph directly after the "Unrecognized-status warning (#2080)" paragraph, ~line 210)
- Modify: `plugin/skills/_shared/ledger-format.md` (line 59 enumerates what `parseLedger` counts — append one sentence: "`parseLedger` also counts a `build`-phase `deferred`/`open` row whose Resolution carries no single valid `Defer-reason:` (and names no `staged/…` path or record reference) as `missingDeferReason` (#3004); `wrap-up/SKILL.md` surfaces it as a non-blocking warning.")
- Test: `tests/bin-lib/wrap-up/pack.test.js` (new tests; the two full-shape `deepStrictEqual` literals at ~666 and ~981 each gain `missingDeferReason: 0, missingDeferReasonItems: []` — return-shape widening check hits; no other test or prose pins the shape: `grep -rn "deferredUnstagedItems: \[\]" tests plugin` lists only those two plus pack.js itself)
- Test: `tests/wrap-up-ledger-missing-defer-reason-warning.test.js` (create)

**Interfaces:**
- Produces: `parseLedger(text, { excludeRecords })` return gains `missingDeferReason: number`, `missingDeferReasonItems: string[]` (item-number cells). `ledgerProbe` value gains the same two keys, items as `docs/plans/{file}#{n}` or `ledger.md#{n}` (same mapping as `deferredUnstagedItems`).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/wrap-up/pack.test.js`:

```js
test('AC2.1 AC2.2: parseLedger reports exactly the build rows lacking a valid Defer-reason (#3004)', () => {
  const text = [
    '| # | Phase | Item | Status | Resolution |', '|---|---|---|---|---|',
    '| 1 | build | a | deferred | Defer-reason: tangential — origin SDD Task 2 review; files: x.js; revisit when x.js next changes |',
    '| 2 | build | b | deferred | SDD minor (deferred), triaged fine-to-defer by the whole-branch review. |',
    '| 3 | build | c | open | — |',
  ].join('\n');
  const r = parseLedger(text);
  assert.strictEqual(r.missingDeferReason, 2);
  assert.deepStrictEqual(r.missingDeferReasonItems, ['2', '3']);
});
```

plus one test `'#3004 review focus: blocked reason ok, bad/duplicate reason flagged, other phases and staged rulings exempt'` over rows:
`| 1 | build | blocked on API | open | Defer-reason: blocked-dependency — unblocks when #12 ships |` (ok),
`| 2 | build | d | deferred | Defer-reason: minor |` (flagged),
`| 3 | build | e | Deferred | Defer-reason: tangential; Defer-reason: genuinely-larger |` (flagged),
`| 4 | build | SDD ruling — x: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |` (exempt),
`| 5 | build/skill | f | open | — |`, `| 6 | build/docs | g | open | — |`, `| 7 | review | h | open | — |` (exempt),
`| 8 | build | i | fixed | abc1234 |` (exempt) — assert `missingDeferReasonItems` deepEqual `['2', '3']`.

plus one `probeLedgers` test asserting the gathered `pack.ledger.value.missingDeferReasonItems` equals `['docs/plans/2026-09-05-spec-1535-ledger.md#2']` for rows `| 1 | build | a | deferred | Defer-reason: tangential |` and `| 2 | build | b | open | — |`, and that `pack.ledger.value.open === 1` (flagging never changes `open`).

In `tests/wrap-up-ledger-missing-defer-reason-warning.test.js` (style of `tests/build-sdd-ledger-residue-carryforward.test.js`, `readText` helper): `test('AC3.1: wrap-up SKILL.md renders a non-blocking missing-Defer-reason warning naming the rows', …)` asserting the SKILL.md text matches `/pack\.ledger\.missingDeferReason > 0/`, `/missingDeferReasonItems/`, `/_shared\/deferral-gate\.md/` within that paragraph, and `/never blocks completion/` within that paragraph (slice the paragraph starting at `**Missing Defer-reason warning (#3004).**` up to the next blank line).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/wrap-up-ledger-missing-defer-reason-warning.test.js`
Expected: FAIL (`missingDeferReason` undefined; warning paragraph absent)

- [ ] **Step 3: Implement** in `pack.js`: a `LEDGER_DEFER_REASON_RE` constant and a `hasValidDeferReason(resolution): boolean` helper (exactly one match, value in `DEFER_REASONS`), with a comment block in the style of the #3327 one stating the scope decision above. In `parseLedger`, for rows where `phase.toLowerCase() === 'build'` and status is `deferred` or `open`: skip when `LEDGER_DEFERRED_STAGED_RE` matches Item or Resolution or `namesRecordReference(resolution, excludeRecords)`; otherwise push `cells[0]` when `!hasValidDeferReason(resolution)`. Return the two new keys. In `ledgerProbe`: map items in the run-dir branch (`ledger.md#`), add both keys to the empty return and the totals literal, aggregate per file like `deferredUnstaged`. Update the two full-shape literals in `pack.test.js`.

In `wrap-up/SKILL.md`, after the #2080 paragraph, add:

`**Missing Defer-reason warning (#3004).** When \`pack.ledger.missingDeferReason > 0\`, render one additive, non-blocking warning line naming the rows: \`⚠ {n} build-phase ledger row(s) are deferred or open without a valid Defer-reason: {missingDeferReasonItems.join(', ')} — see _shared/deferral-gate.md.\` Like the unrecognized-status warning, it never blocks completion and never changes the gate's open condition; the Resolve Gate's Phase 1 fix-now check still runs on those rows. Omit the line when the count is \`0\` or absent.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/wrap-up-ledger-missing-defer-reason-warning.test.js tests/wrap-up-pack-conformance.test.js`
Expected: PASS (AC3.2: the existing #2080/#3327 ledger tests pass unchanged — only the two full-shape literals grew keys)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/wrap-up/pack.js plugin/skills/wrap-up/SKILL.md plugin/skills/_shared/ledger-format.md tests/bin-lib/wrap-up/pack.test.js tests/wrap-up-ledger-missing-defer-reason-warning.test.js
git commit -m "Flag build ledger rows lacking a Defer-reason — parseLedger backstop and wrap-up warning (refs #3004)"
```

### Task 2: Cite the deferral gate at the SDD invocation and Common Step 4

**Files:**
- Modify: `plugin/skills/build/dispatch.md` (line 14's SDD invocation paragraph — add the rule as a new sentence immediately before **Carry forward surviving SDD ledger residue before Finish**; and, right after the existing sentence ending "…`open` for a `Ruling:` line — a line matching more than one marker is copied once, under its first match in that order — using the line's own one-liner (the text following the marker) as the ledger Item description.", add one sentence; do NOT reword that existing sentence — `tests/build-sdd-ledger-residue-carryforward.test.js` pins it)
- Modify: `plugin/skills/build/SKILL.md` (Common Step 4, item 3 — ~line 253)
- Test: `tests/build-review-finding-deferral-gate.test.js` (create)

Byte pins: `build/SKILL.md` is 47,156 bytes against the 51,200 shared ceiling (≈4 KB headroom; this task adds <600 bytes). `dispatch.md` 23,888. `tests/bin-lib/skill-audit/bloat.test.js` requires `build/SKILL.md` carry no provenance narration — write instructions, not history.

**Interfaces:**
- Consumes: Task 1 nothing (prose only).

- [ ] **Step 1: Write the failing test** `tests/build-review-finding-deferral-gate.test.js` (readText helper). One shared `assertRule(text)` function asserting the text matches `/_shared\/deferral-gate\.md`'s fix-now check with exactly one `Defer-reason:`/ and `/Severity alone \("minor", "fine to defer"\) is never a reason\./`. Tests:
  - `'AC1.1: dispatch.md SDD invocation cites the deferral gate for review findings'` — `assertRule` on the dispatch.md paragraph containing `/superpowers:subagent-driven-development`; plus match `/every Minor \(or higher\) finding from a per-task reviewer or the whole-branch review is either fixed in this build, or carried to the ledger only after passing/`; plus match `/a `minor \(deferred\):` line carries its `Defer-reason:`/.
  - `'AC1.1: build/SKILL.md Common Step 4 cites the deferral gate at the ledger-write step'` — `assertRule` on the slice from `### Common Step 4: Handle Blocked Work` to `### Common Step 4.5`; plus match `/`Defer-reason: blocked-dependency` or `blocked-external`/.
  - `'AC1.2: go-red control — the shared assertion fails on text without the rule'` — `assert.throws(() => assertRule(slice.replace(/Severity alone[^.]*\./, '')))`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/build-review-finding-deferral-gate.test.js`
Expected: FAIL

- [ ] **Step 3: Implement the prose.**

dispatch.md new sentence (dispatcher voice, before the Carry-forward directive): `**Review findings go through the deferral gate (#3004).** In the same invocation instruction, also direct \`/superpowers:subagent-driven-development\` that every Minor (or higher) finding from a per-task reviewer or the whole-branch review is either fixed in this build, or carried to the ledger only after passing \`_shared/deferral-gate.md\`'s fix-now check with exactly one \`Defer-reason:\` from that file's vocabulary, written inline in the row's Resolution text. Severity alone ("minor", "fine to defer") is never a reason.`

dispatch.md sentence after the mapping sentence: `A \`minor (deferred):\` line carries its \`Defer-reason: {value}\` (the review-finding rule above), and the carried row's Resolution text repeats it; a minor with no valid reason is not deferred — fix it before Finish.`

SKILL.md Common Step 4 item 3 becomes: `3. Append blocked items to the open items ledger (see \`/claude-tweaks:ledger\`) with phase \`build/*\` and status \`open\`, naming \`Defer-reason: blocked-dependency\` or \`blocked-external\` in the Resolution text. A review finding carried to the ledger (any execution strategy) takes the same row only after \`_shared/deferral-gate.md\`'s fix-now check with exactly one \`Defer-reason:\` from that file's vocabulary, inline in the Resolution text — otherwise fix it in this build. Severity alone ("minor", "fine to defer") is never a reason.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/build-review-finding-deferral-gate.test.js tests/build-sdd-ledger-residue-carryforward.test.js tests/bin-lib/skill-audit/bloat.test.js tests/deferral-gate-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/dispatch.md plugin/skills/build/SKILL.md tests/build-review-finding-deferral-gate.test.js
git commit -m "Route build review findings through the deferral gate — cite it at SDD invocation and Common Step 4 (refs #3004)"
```

Waived AC4.1: `npm test` in full is run centrally by `/build` Common Step 5 (the runner-written pass stamp), not by a task.
