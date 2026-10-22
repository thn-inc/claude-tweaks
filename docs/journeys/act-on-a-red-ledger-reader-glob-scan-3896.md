---
files:
  - tests/ledger-reader-ownership-conformance.test.js
  - plugin/skills/_shared/ledger-format.md
  - plugin/skills/ledger/SKILL.md
---

# Act on a Red Ledger-Reader Glob Scan

**Persona:** A claude-tweaks plugin maintainer editing a ledger reader (`_shared/ledger-format.md`, `ledger/SKILL.md`, `review/code-mode-steps.md` or `wrap-up/auto-merge-short-circuit.md`). They add or reword a step that finds "this run's ledger", and `npm test` goes red on `tests/ledger-reader-ownership-conformance.test.js`.
**Goal:** Route the new lookup through `_shared/ledger-format.md`'s resolution rule (the ownership-aware ledger probe) instead of a `docs/plans` glob, or, when the glob mention is the documented fallback or prose naming inherited ledgers, pin that exact passage deliberately.
**Entry point:** `npm test` (or `node --test tests/ledger-reader-ownership-conformance.test.js`) reports one of two messages:
- `{file}: a this-run ledger lookup uses the bare docs/plans glob: ["{occurrence}", …]`. Each quoted occurrence is a lookup spelling found outside every allow-listed passage.
- `{file}: an allow-listed passage is no longer in the file: {passage}`. The pinned text was reworded or removed.
**Success state:** Every glob occurrence in the four scanned files sits inside an exact allow-listed passage in the test's `ALLOWED` map, every allow-listed passage still exists verbatim, and `npm test` is green.

## Steps

### 1. Read which occurrence failed
- **URL:** the failing assertion's message in the test run.
- **Action:** Find the quoted occurrence in the named skill file. It is one of these spellings:
  - a `docs/plans` path with a wildcard and `ledger` in it (`docs/plans/*-ledger.md`, `docs/plans/*ledger*.md`, `docs/plans/YYYY-MM-DD-*-ledger.md`, `docs/plans/*-record-{n}-ledger.md`)
  - a wildcard ledger filename near a `docs/plans` mention (`find docs/plans -name "*-ledger.md"`)
  - an `ls`/`rg` listing of `docs/plans` piped, through any number of stages, into `grep`/`rg ledger` (`ls docs/plans | grep ledger`, `ls -t docs/plans | head -1 | grep ledger`, `rg --files docs/plans | rg ledger`)
- **Should feel:** Pinpointed. The message quotes the exact text the scan matched.
- **Should understand:** Words around the glob no longer exempt it. A sentence saying "fallback" or "inherited" fails the same as any other this-run lookup, and so does a lowercase continuation after a glob sentence. The scan checks exact passages, not sentence keywords. The non-wildcard Create location `docs/plans/YYYY-MM-DD-{feature}-ledger.md` is a location definition and never matches.
- **Red flags:** Rewording the step to dodge the matcher, for example by splitting the path across two backtick spans. The lookup still matches inherited ledgers; the scan just stops seeing it.

### 2. Repoint the lookup through the resolution rule
- **URL:** `plugin/skills/_shared/ledger-format.md`, Location section, "Resolution rule for a caller reading 'the active ledger for this run' (#3687)".
- **Action:** Replace the glob lookup with a citation of `` `_shared/ledger-format.md`'s resolution rule `` (the probe, then `value.files`), as the other repointed readers do.
- **Should feel:** Like deleting a special case. The reader now names the same single ledger every other reader names.
- **Should understand:** The glob cannot tell this run's ledger from one inherited from the integration branch. It is a reader-only fallback, used when the probe fails or no run dir resolves.
- **Red flags:** A writer (a step that flips or deletes rows) taking the glob fallback on a probe failure. Writers fail closed.

### 3. Or pin a documented passage, deliberately
- **URL:** the `ALLOWED` map in `tests/ledger-reader-ownership-conformance.test.js`.
- **Action:** When the mention is the documented fallback, or prose labelling inherited / other runs' ledgers, add the whole sentence's whitespace-flattened text under its file key. When the step reports a stale passage, update the entry to the file's current wording.
- **Should feel:** Visible and reviewable. Every allowed glob mention is an exact quote in the diff.
- **Should understand:** An occurrence is allowed only when it sits wholly inside a listed passage. Text added beside a pinned passage still fails, and a passage the file no longer carries fails as stale.
- **Red flags:** Pinning a this-run lookup to get green. Loosening `LEDGER_LOOKUP_RES` so it stops seeing a spelling.

### 4. Re-run and confirm
- **URL:** the scan.
- **Action:** Run `node --test tests/ledger-reader-ownership-conformance.test.js`, then `npm test`.
- **Should feel:** Mechanical. Both are green.
- **Should understand:** The go-red fixtures in the same file prove each spelling and each escape still fails. If one of them goes green, the matcher went blind.
- **Red flags:** A green scan after removing a go-red fixture.

## Origin
- Created during the build of #3896, which hardened #3687's scan: an exact-passage allow-list replaced the sentence-level `ALLOWED_RE` word exemption and the sentence splitter, and the glob matcher was widened to every `docs/plans` ledger lookup spelling. Run `2026-10-22T122807-record-3896`.
- Related: `find-this-runs-ledger-outside-wrap-up-3687.md` (the runtime behaviour this scan pins) and `act-on-a-red-wall-clock-budget-scan-3491.md` (a sibling conformance scan with a pinned allow-list).
