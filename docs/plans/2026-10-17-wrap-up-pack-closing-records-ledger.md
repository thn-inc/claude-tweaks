# Open Items — wrap-up-pack carries the closing-record set and parked-at-shaping (#3399)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD minor: engine-verify.js RECORD_DEPS comment split the "readdir degrades…" clause | fixed | Final-review fix wave 88687b6 cut the comment to a pointer at pack.js closingRecords/headerEntries |
| 2 | build | SDD minor: pack.js redundant "or false" operand in the parkedAtShaping OR expression | fixed | 88687b6 — now a strict `=== true` check OR the file's flag |
| 3 | build | SDD minor: cleanup-only `wrap-up-pack.js --only ledger` wrote a pack without the `claim` key item 7 reads | fixed | 88687b6 — production is `--only claim`, generalized to any absent pack, pinned |
| 4 | build | Follow-up: flow/multispec-review-console.md:206 still reads `spec-{spec}/work/{issue}-spec.md` directly for parked-at-shaping (multi-spec shared teardown; under pr-first the header lives only in the worktree) — should read the pack's `inputs.parkedAtShaping` like Section E | open | — |
| 5 | build | Ruling: implementers ran targeted suites only; npm test runs centrally at Common Step 5 (cost if wrong: a late full-suite failure) | observation | SDD ruling, recorded for wrap-up |
| 6 | build | Ruling: cleanup-procedures.md line 7's carrier-commit `inputs.records` citation was in scope and repointed to `inputs.closingRecords` (027b7d4, pinned) | observation | SDD ruling, recorded for wrap-up |
| 7 | build | Ruling: final-review Minor 8 (multispec-review-console.md:206) is out of #3399's scope — routed to item 4 | observation | SDD ruling, recorded for wrap-up |
| 9 | build/skill | Extends `run-directory-fact-packs`: a subset pack (`--only`) produced as a stand-in for a skipped phase must name the probe(s) its later readers consume, since a present pack's missing key reads as that reader's failure path, not as "absent file" (#3399 final review finding 3) | observation | For wrap-up's Skills curation row |
| 8 | build | Parked: Section E step 7's SKIP log-decision call uses `--step "Section E"` without the Degrade-trace `(degraded)` tag | observation | Cosmetic; appender accepts it; no second SDD fix wave |
