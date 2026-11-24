### Strengths
- The fix follows the record's Gotchas. `batchMatched` is a separate `fingerprint -> number` map, so `batchFiled` stays `fingerprint -> itemId`, and an item matching an existing record reuses `{ number }` directly instead of a `sameAs` value with a second shape (`plugin/bin/lib/console/backfill-dispose.js:398-404, 460-465`).
- A twin's item marker goes into the filed record's text, and the CLI writes that text to disk (`plugin/bin/console-backfill.js:226-229` writes `plan.file[].text`). `everyMarkerMap` already reads every `work-fingerprint` marker in a body, so each twin's marker matches on its own, as the third Gotcha requires.
- `filingOf` and `lineOf` are always set in the same step as `batchFiled` and `batchDigested`, so `filingOf.get(twin)` and `lineOf.get(twin)` cannot be undefined inside the twin branches.
- The tests are strong. AC1 runs the second pass with B both verdicted and unverdicted, and checks first that B's claim fingerprint really moved. AC2 builds a record that only A's item marker matches. Every new test I traced fails on the base code:
  - the AC1 and digest tests, because B's marker is on neither the record nor the comment;
  - the AC2 and prefiled tests, because nothing records the match in the pass;
  - the held-digest test, because B's line has a new materiality fingerprint and new markers.
- The second commit also covers the unverdicted path: an unverdicted A that is already filed or already digested now records its match (`batchMatched`) or its hold (`batchHeld`) for later twins. That closes a gap the record did not list.

### Issues

#### Critical (Must Fix)
1. **The digest procedure loses the refs of every same-pass digest pair: A and B both end the pass unsettled.**
   - **Where:** `plugin/bin/lib/console/backfill-dispose.js:491` (`out.digest.lines[lineOf.get(twin)] += \` ${itemMarkerOf(item)}\``), together with `plugin/skills/tidy/console-backfill.md:81`.
   - **What's wrong:** The chunking script in Step 7 finds which item each line belongs to with `byLine = new Map(p.dispositions...map(d => [d.digest.line, d.itemId]))`, then calls `byLine.get(line)` for each line in `p.digest.lines`. The disposition keeps the original `d.digest.line`. The plan's line now has B's marker appended, so the lookup misses and the chunk's `itemIds` gets `undefined` (`null` in the JSON) for A. A gets no ref. B is a `digest.sameAs` of A, so the apply script's `r[u.sameAs]` is missing too. Both items are reported `unsettled` and join the failed set.
   - **Why it matters:** This happens on the normal path with no crash: every pass with two findings that share a claim now reports PARTIAL. The next pass finds both by marker and settles them, so nothing is lost. But the change turns a rare crash-plus-upgrade case into a failure on every pass. No unit test exercises `planBatch` together with the procedure's chunking script, so the suite does not catch it.
   - **How to fix:** Make plan line i and its disposition agree. Either update the twin's disposition `d.digest.line` in the same step (keep the disposition object by item id next to `lineOf`), or have `planBatch` emit the item id for each line (for example `digest.lineItems`) and change the procedure script to use it instead of matching text. Add a test that runs the procedure's chunk-to-item mapping on a same-pass pair.

#### Important (Should Fix)
1. **An unverdicted twin never checks the same-pass maps.**
   - **Where:** `plugin/bin/lib/console/backfill-dispose.js:410-445`.
   - **What's wrong:** In the no-verdict branch, B is checked only with `filedRecordOf` and `heldDigestComment`. It never reads `batchMatched`, `batchHeld` or `batchDigested`.
   - **Why it matters:** The likeliest real case is a record that crashed under the previous release, so B's marker was never written to it. A matches by its own marker in this pass, while an unverdicted B goes to `awaitingVerdict`. Once A has settled, B's verdict arrives in a later pass, where `batchMatched` is empty, so B is filed again. That is the twin #4162 set out to stop. Deliverable 2 only helps when B already has a verdict in the same pass as A.
   - **How to fix:** In the no-verdict branch, when `fp && batchMatched.has(fp)`, settle B as a prefiled `reuse` of that number. Do the same for `batchHeld` with the prefiled digest fingerprint. Add a test where A is unverdicted and matched, B is unverdicted, and the record carries only A's marker.

#### Minor (Nice to Have)
1. **Duplicated test fixtures in separate files.** `tests/bin-lib/console/backfill-dispose-4162-held-digest-twin.test.js` and `backfill-dispose-4162-prefiled-twin.test.js` copy `findingItem`, `workList` and related constants from `backfill-dispose.test.js`. The record's Key Files name that one file. Move both tests into it next to the other three #4162 tests.
2. **The contract docs no longer describe the output.**
   - The `planBatch` header comment (`backfill-dispose.js:375-388`) does not say that a filed record's text or a digest line may now carry its same-pass twins' item markers.
   - `plugin/skills/_shared/materiality-floor.md:86` still says a backfill line carries "one more marker"; it can now carry several.
3. **Malformed commit subjects.** `8983497dd6` reads "— refs — refs #4162" and `fb4fd6822c` contains an empty "()". This is harmless if the squash subject is composed from the PR, but worth fixing if the commits are kept.

### Recommendations
- Have the plan say which item each digest line belongs to, instead of the procedure matching line text. Then later edits to a line's markers cannot break the step that assigns refs.
- Declined to judge:
  - A twin planned in a later batch than A, because the `limit` boundary resets the per-call maps. That predates this change, and the record covers only same-pass pairs.
  - A digest twin settled against A's comment through `batchHeld`, whose own marker is never posted. If its claim moves again, it is matched only by that new claim. That needs two moves in a row, which the record does not cover.
  - A staged-kind filing whose fingerprint collides with a finding's claim fingerprint. Such a collision is not realistic.

### Assessment

**Ready to merge?** With fixes

**Reasoning:** The record-filing half meets all three acceptance criteria and its tests discriminate. But appending markers to digest lines breaks the procedure's line-to-item lookup, so every ordinary same-pass digest pair now ends unsettled. That must be fixed before merge, and the unverdicted-twin gap should be closed too.

DONE_WITH_CONCERNS
