# Harden the ledger-reader conformance scan against sentence-level and glob-spelling escapes (#3896) Implementation Plan

**Goal:** Close the three escapes in `tests/ledger-reader-ownership-conformance.test.js` (#3687): the sentence-level `ALLOWED_RE` word exemption, the literal-only `GLOB_RE`, and the sentence splitter that lets a glob sentence inherit an exempting word from its neighbour.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T122807-record-3896/work/3896-spec.md` (materialized from GitHub issue #3896)

---

### Task 1: Replace the word-level exemption with an explicit allow-list and widen the glob matcher

**Files:**
- Modify: `tests/ledger-reader-ownership-conformance.test.js`
- Test: `tests/ledger-reader-ownership-conformance.test.js`

**Design notes (from the spec's Current State and Deliverables):**
- Retire `ALLOWED_RE` and the `sentences()` splitter as the exemption mechanism. Instead, find every glob-mention *occurrence* in the flattened file text, and require each one to fall inside an explicitly listed allowed passage for that file (exact flattened text, e.g. the documented `**Fallback, for a reader only:**` sentence in `_shared/ledger-format.md`, and the inherited-ledger / no-run-dir-fallback sentences in `ledger/SKILL.md`). Any occurrence outside an allowed passage fails, whatever words surround it. Also assert every allowed passage is still present in the file it is listed for, so a stale allow-list entry fails rather than silently allowing nothing.
- Widen the matcher to every spelling of a `docs/plans` ledger lookup: a `docs/plans` path with a wildcard and `ledger` anywhere in it (`docs/plans/*-ledger.md`, `docs/plans/*ledger*.md`, `docs/plans/YYYY-MM-DD-*-ledger.md`, `docs/plans/*-record-{n}-ledger.md`), a wildcard ledger filename near a `docs/plans` mention (`find docs/plans -name "*-ledger.md"`), and `find`/`ls` listings of `docs/plans` filtered for ledgers (`ls docs/plans | grep ledger`). The non-wildcard Create location `docs/plans/YYYY-MM-DD-{feature}-ledger.md` is a location definition, not a lookup, and must not match.
- `assertNoBareGlob(text, label, allowed = [])` keeps its name and export; the existing pre-#3687 go-red fixtures keep failing with an empty allow-list.

- [ ] **Step 1: Failing test** — add go-red fixtures, one per escape, each with a message matcher on its `assert.throws`: (a) a this-run lookup sentence carrying "fallback" / "inherited" that is not an allowed passage; (b) the `*ledger*.md`, dated-template (`YYYY-MM-DD-*-ledger.md`) and `find docs/plans -name "*-ledger.md"` spellings (plus an `ls docs/plans | grep ledger` form); (c) a glob sentence followed by a lowercase-continuation sentence carrying an exempting word. Run them against the current matcher and confirm each fails (escapes) before the change.
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the file above, per the design notes.
- [ ] **Step 3: Run** `node --test tests/ledger-reader-ownership-conformance.test.js` — PASS, including the live-corpus tests over `_shared/ledger-format.md`, `ledger/SKILL.md`, `review/code-mode-steps.md` and `wrap-up/auto-merge-short-circuit.md`.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3896`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item (explicit allow-list, widened matcher, go-red fixtures with message matchers) and every `## Acceptance Criteria` item (AC1 fallback/inherited sentence fails, AC2 spellings fail, AC3 documented passages pass, AC4 `npm test` — run centrally at Common Step 5) is covered by Task 1's Files/Steps above.
- **Placeholders:** none.
