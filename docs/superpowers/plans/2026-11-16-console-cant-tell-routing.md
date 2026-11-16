# Console can't-tell routing (#4679) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With no human present, a medium+ can't-tell Review Console finding whose tiebreak recommended `drop` goes to the materiality digest (deduplicated by its `consolefinding` fingerprint), and one recommended `file` (or with no recommendation) is filed as an agent-buildable verification task, not a `needs:definition` question.

**Architecture:** The routing rule lives in code. `finding-filing.js` composes both shapes (the verification-task proposal and a digest line carrying a `consolefinding` marker). `resolve.js` `resolveAll` and the `console-filings.js` default selection route by recommendation. `residue.js` and `finding-outcomes.js` accept a logged `digested` line as settled evidence, the way they accept `filed as #N` today. The reconciler's `resolve-console` gains a `digested` outcome, and the backfill routes `drop` the same way. The skill prose then describes this behaviour instead of restating the old rule.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T000602-record-4679/work/4679-spec.md`

Scope keywords: licensed to drop, recommendation notwithstanding, whatever the tiebreak recommended, whatever its recommendation

## Global Constraints

- New closed-vocabulary value, exactly `needs-verification`. It is appended to the end of `DEFER_REASONS`, so no existing value moves or changes meaning, and it clears the floor (`STRUCTURED_FLOOR['needs-verification'] = true`).
- The digest `Defer-reason` for a can't-tell `drop` stays `tiebreak-cant-tell` (it is an entry-format value, not a `DEFER_REASONS` member).
- Human-present Approve-all behaviour is unchanged (AC5, read literally): `findingItems`, `approveAllDefault`, and `console-filings.js --only` plan every named item as `filed`, and the proposal they compose is today's `needs:definition` / Open Question shape, byte for byte. The verification-task shape is opt-in through `composeFindingProposal({ ..., unattended: true })`. Only the unattended callers pass it: `resolveAll`, `console-filings.js`'s default (no `--only`) selection, and the backfill.
- A confirmed-finding filing (`verdict.kind === 'confirmed'`) and a staged-finding filing keep their current shape, byte for byte. Only the unattended can't-tell shape changes.
- The unattended verification task files with no `Labels:` header line (Decision-rule choice: it stays inside the Key Files, and `/backlog refine` triages it like any new record). The PR body states this choice.
- `resolveAll` and `console-filings.js` never call `gh`. The skill posts the digest lines.
- Commits use the `{Verb} {what} — {detail}` style and end with `refs #4679`. Never write `closes`/`fixes` in a commit.
- CI runs Node 20. A test that asserts a path must not hard-code `/`-joined absolute paths.

## Review Focus

1. A `drop` item whose claim text is missing (no review-findings.json entry): the digest line must still carry the `consolefinding` marker (computed from the `tiebreak:{id}` claim, the same one `composeFindingProposal` uses), and it must never throw. → Task 2 test `composeFindingDigest: claim-missing item still marks its fingerprint`.
2. A digest comment that carries the marker but whose author is not trusted (not OWNER/MEMBER/COLLABORATOR) must not dedup. → Task 2 test `heldConsoleFindings ignores an untrusted comment`.
3. A `digested` line written as `STAGED`/`SKIP`, or quoted in prose, is not evidence. → Task 3 test `DIGESTED_LINE_RE anchors on - AUTO`.
4. An archived auto-merge run whose only can't-tell item was digested must archive, not `cant-tell-unfiled`. → Task 3 test `unfiledCantTell: a digested drop item is not unfiled`.
5. A previous-release console.json (with no `digests` key) must still read with no residue added. → Task 3 test `pendingDigests: console.json without digests yields none`.

---

### Task 1: `needs-verification` defer reason

**Files:**
- Modify: `plugin/bin/lib/issues/record-payload.js` (`DEFER_REASONS`)
- Modify: `plugin/bin/lib/issues/autonomy.js` (`STRUCTURED_FLOOR` and its comment)
- Modify: `plugin/skills/_shared/deferral-gate.md` (vocabulary block, "same six values" → "same seven values", floor-mapping table)
- Modify: `plugin/skills/_shared/autonomy-ceiling.md` (the "Floor rule (ledger narrowing)" text and table around line 231, and the `ledgerRouteRemainder` row's "four-category floor"; now five categories, `needs-verification` included)
- Modify: `plugin/skills/_shared/ledger-format.md` (line 182, "outside the four categories")
- Test: `tests/bin-lib/issues/record.test.js`, `tests/bin-lib/issues/autonomy.test.js`, `tests/deferral-gate-conformance.test.js` (must stay green with no edit to its logic)

**Interfaces:**
- Produces: `DEFER_REASONS` is `['tangential','needs-human-decision','pre-existing-outside-diff','genuinely-larger','blocked-external','blocked-dependency','needs-verification']`, and `clearsFloor('needs-verification') === true`.

- [ ] **Step 1: Write the failing tests.** In `record.test.js`, update the test `DEFER_REASONS is the frozen six-value closed vocabulary, in contract order` to the seven-value array above (rename the test to `seven-value`). In `autonomy.test.js`, add `test('clearsFloor: needs-verification clears the floor (#4679)', () => assert.strictEqual(clearsFloor('needs-verification'), true))`.
- [ ] **Step 2: Run and see them fail.** Run `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/issues/autonomy.test.js`. Expected: FAIL on both new assertions.
- [ ] **Step 3: Implement.** Append `'needs-verification'` to `DEFER_REASONS`, and add `'needs-verification': true` to `STRUCTURED_FLOOR`, with a comment line saying it maps to "a bounded verification task a builder can run". In `deferral-gate.md`, add the vocabulary line `needs-verification — the finding is unverified; the filed task is the bounded check that settles it (a builder verifies at the integration-branch tip, then fixes or closes)`, change "six" to "seven", and add the `| \`needs-verification\` | yes |` row. The derivation paragraph never produces it (only the Review Console's can't-tell filing does); say so in one sentence.
- [ ] **Step 4: Run.** Run `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/issues/autonomy.test.js tests/deferral-gate-conformance.test.js`, then `git grep -n -i "six values\|six-value" -- plugin tests docs` and fix any other count the vocabulary change made stale. Expected: PASS, with no stale count left.
- [ ] **Step 5: Commit.** `Add needs-verification defer reason — clears the floor for a bounded verification task, refs #4679`

### Task 2: finding-filing.js composes the verification task and the digest line

**Files:**
- Modify: `plugin/bin/lib/console/finding-filing.js`
- Modify: `plugin/bin/lib/console/backfill-dispose.js` (import `areaOfPath` from finding-filing instead of defining it)
- Modify: `plugin/bin/lib/health-core/materiality-digest.js` (`DEDUP_MARKER` also matches `console-finding`, so a digest rollover carries and tombstones the marker like the other two)
- Test: `tests/bin-lib/console/finding-filing.test.js`, `tests/bin-lib/health-core/materiality-digest.test.js`

**Interfaces:**
- Consumes: Task 1's `needs-verification`.
- Produces (all exported from `finding-filing.js`):
  - `CANT_TELL_DEFER_REASON = 'needs-verification'` and `DIGEST_DEFER_REASON = 'tiebreak-cant-tell'`.
  - `areaOfPath(p: string) -> string`, moved verbatim from backfill-dispose.js.
  - `consoleFindingMarker(fp: string) -> string`, which returns `<!-- console-finding: ${fp} -->`.
  - `composeFindingDigest({ item, finding, runId }) -> { fingerprint, line, entry, claimMissing }`. `fingerprint` is the same `findingFingerprint` that `composeFindingProposal` computes for the item. `entry` is `{ area: areaOfPath(t.path), finding: <oneLine claim, max 200 chars>, fileRefs: citation(t.path, t.line), deferReason: 'tiebreak-cant-tell', provenance: runId }`. `line` is `${materialityEntryLine(entry)} ${consoleFindingMarker(fingerprint)}`.
  - `composeFindingProposal({ item, finding, runId, verdict?, staged?, unattended? })` and `planFilings({ items, findings, runId, unattended? })`. `unattended: true` selects the verification-task shape for a can't-tell item (neither `verdict` nor `staged`). When it is absent or false, the output is byte-identical to today's.
  - `planDigests({ items, findings, runId }) -> [{ item, fingerprint, line, claimMissing }]` returns one entry per item with `resolution === 'digested'` that carries `tiebreak`, deduplicated by fingerprint (first wins), in the same way as `planFilings`.
  - `heldConsoleFindings(digestComments) -> Set<string>` returns the `consolefinding-*` fingerprints whose marker appears in a trusted comment (`isTrustedComment`), or in the whole string when `digestComments` is a string (a local-files body). Anything else returns an empty Set.

- [ ] **Step 1: Write the failing tests.** In `finding-filing.test.js`, using the file's existing item and finding builders:
  - `can't-tell proposal is a verification task (#4679 AC2)`. A can't-tell item with recommendation `file` must produce a proposal with no `Labels:` header line, no `needs:definition` anywhere, and no `## Open Question`. It must contain `Defer-reason: needs-verification` and an `## Acceptance Criteria` section that holds the literal phrases `integration-branch tip` and the cited `` `path:line` ``. Also assert `/quot/i` (the criterion requires quoted evidence) and `close this record`.
  - `without unattended the can't-tell proposal is unchanged (AC5)`. The same item with no `unattended` keeps `Labels: needs:definition`, `## Open Question`, and `Defer-reason: needs-human-decision`.
  - `materiality-digest: a rollover carries and tombstones the console-finding marker` (in `materiality-digest.test.js`). Model it on that file's existing `consolebackfill-item` rollover test.
  - `confirmed proposal is unchanged`. Pin the existing confirmed-shape snapshot (`Labels: needs:definition` and `Defer-reason: needs-human-decision` are still present on the confirmed shape).
  - `composeFindingDigest: line carries the materiality entry and the consolefinding marker`. Assert `line.includes('Defer-reason: tiebreak-cant-tell')`, assert `line.endsWith(consoleFindingMarker(fingerprint))`, and assert that `fingerprint === composeFindingProposal({...same item}).fingerprint`.
  - `composeFindingDigest: claim-missing item still marks its fingerprint` (finding `null`). Expect `claimMissing: true`, a fingerprint matching `/^consolefinding-[0-9a-f]{8}$/`, and no throw.
  - `planDigests plans only digested tiebreak items, deduped by fingerprint`.
  - `heldConsoleFindings ignores an untrusted comment`. A comment `{ body: line, authorAssociation: 'NONE' }` gives an empty set, `'MEMBER'` gives a set containing the fingerprint, and a plain string body is trusted.
- [ ] **Step 2: Run and see them fail.** Run `node --test tests/bin-lib/console/finding-filing.test.js`. Expected: FAIL (the exports are undefined, and the proposal still carries Open Question).
- [ ] **Step 3a: Check the header consumer.** Before you drop the `Labels:` line, read `plugin/skills/wrap-up/review-console.md` step 7's check-then-create and `plugin/skills/_shared/github-write-transport.md`'s header parsing. Confirm that a proposal header with no `Labels:` line creates a record with no labels. If a consumer requires the line, keep it as `Labels:` with no value only when that consumer accepts it; otherwise omit the line and note the consumer in your report.
- [ ] **Step 3: Implement.** In `composeFindingProposal`, give the can't-tell branch with `unattended: true` only (`!confirmed && !staged && unattended`):
  - Deliverables `- [ ] at the integration-branch tip, quote the code at \`${where}\` and state whether the finding holds; fix it if it does, or close this record with that quoted evidence if it does not`.
  - `acceptanceCriteria` with two lines: `- [ ] the record quotes the code at \`${where}\` as it reads at the integration-branch tip`, then `- [ ] the finding is fixed there, or this record is closed with that quoted evidence showing it does not hold`.
  - `deferReason: CANT_TELL_DEFER_REASON` in both `recordPayload` and the provenance.
  - A header with no `Labels:` line.

  The confirmed and staged branches, and every call without `unattended`, keep `needs-human-decision` and `Labels: needs:definition`. Add `console-finding` to `DEDUP_MARKER` (`/<!-- (?:materiality-fingerprint|consolebackfill-item|console-finding): \S+? -->/g`). `heldConsoleFindings` reads the markers with a regex built from the same prefix, never a second hand-written pattern. Update the module header comment, which currently says "not licensed to drop", to describe the new routing. Move `areaOfPath` from backfill-dispose.js into this file and require it back there.
- [ ] **Step 4: Run.** Run `node --test tests/bin-lib/console/finding-filing.test.js tests/bin-lib/console/backfill-dispose.test.js tests/bin-lib/console/shadow-dup-proposal.test.js`. Expected: PASS.
- [ ] **Step 5: Revert-proof.** Revert only the `finding-filing.js` change (`git stash` is forbidden, so copy the file aside with `cp -p` and restore it with `git show HEAD:plugin/bin/lib/console/finding-filing.js`), re-run, and confirm the two #4679 tests go red. Then restore the file.
- [ ] **Step 6: Commit.** `Compose can't-tell filings as verification tasks and add digest lines — refs #4679`

### Task 3: resolveAll routes by recommendation; residue and archive accept digested evidence

**Review risk:** high (decision logic: routing by tiebreak recommendation, residue and archive evidence)

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` (`resolveAll`, `UNATTENDED_FILED_REASON`, new `UNATTENDED_DIGESTED_REASON`, the comments at `approveAllDefault` and above `resolveAll`)
- Modify: `plugin/bin/console-resolve.js` (persist a `digests` summary; add `'digested'` to `nothingToRevert`)
- Modify: `plugin/bin/lib/console/residue.js` (`DIGESTED_LINE_RE`, `digestedFindings`, `pendingDigests`, `DIGEST_PENDING_RESOLUTION`, `consoleResidueItems`, `splitMissing`, `readRunResidue` reads decisions.md when `digests` is non-empty too, re-run line for digest-pending)
- Modify: `plugin/bin/lib/console/finding-outcomes.js` (`cantTellOutcomes` adds `digested: boolean`; `unfiledCantTell` skips digested rows; the FYI "Filed as" cell renders `digest` for a digested row)
- Test: `tests/bin-lib/console/resolve.test.js`, `tests/bin-lib/console/residue.test.js`, `tests/bin-lib/console/finding-outcomes.test.js`, `tests/console-resolve-conformance.test.js` (adjust only if it pins the console.json key list)

**Interfaces:**
- Consumes: Task 2's `planDigests`.
- Produces:
  - `resolveAll(...)` result gains `digests: [{ item, fingerprint, line, claimMissing }]`. A tiebreak item with `tiebreak.recommendation === 'drop'` resolves `digested` with reason `UNATTENDED_DIGESTED_REASON` (`"unattended: can't-tell finding the tiebreak recommended dropping — logged to the materiality digest (tiebreak-cant-tell), nothing filed"`). Every other tiebreak item resolves `filed` with `UNATTENDED_FILED_REASON` (`"unattended: can't-tell finding filed as a verification task (needs-verification)"`).
  - `console.json` gains `digests: [{ item, fingerprint }]`.
  - `residue.js`: `DIGESTED_LINE_RE = /^- AUTO .*?(?:already )?digested \(work-fingerprint (consolefinding-[0-9a-f]{8})\)/` and `digestedFindings(decisions) -> Set<fp>`. `pendingDigests(consoleJson, decisions)` mirrors `pendingFilings` with resolution `DIGEST_PENDING_RESOLUTION = 'digest-pending'` and reason `"planned can't-tell digest entry has no digested line in decisions.md"`. `splitMissing` never classifies digest-pending as missing. The `itemLines` re-run for digest-pending is `filingRerunCommand` without `--only`, plus `--digest-comments <comments.json>` (export a `digestRerunCommand({ consoleDir, pluginRoot })`).
  - The evidence line the skill logs is `{item} digested (work-fingerprint {fp})`, and the dedup line is `{item} already digested (work-fingerprint {fp})`.

- [ ] **Step 1: Write the failing tests.**
  - `resolve.test.js`: rewrite the test that asserts `['filed','filed','filed','filed']` (around line 1335). With recommendations `file, drop, null, drop`, expect resolutions `['filed','digested','filed','digested']`, `result.filings.length === 2`, `result.digests.length === 2`, no filing proposal containing `needs:definition`, and every digest `line` containing `tiebreak-cant-tell`.
  - Add `AC1 (#4679): one medium can't-tell drop and one medium can't-tell file item → a digest entry and a filing`.
  - Add `Approve-all (findingItems) is unchanged (#4679 AC5)`: the same fixture through `findingItems` gives `dropped` for drop and `filed` for file.
  - `residue.test.js`: `DIGESTED_LINE_RE anchors on - AUTO` (a STAGED line does not match). Also `pendingDigests: console.json without digests yields none`, `pendingDigests: a digests entry with no digested line is digest-pending`, and `a digested or already-digested AUTO line clears it`.
  - `finding-outcomes.test.js`: `unfiledCantTell: a digested drop item is not unfiled`. Build a run whose decisions.md holds the drop verdict plus `- AUTO 10:00:00 — Queue write: {id} digested (work-fingerprint {fp}). Reversibility: n/a.`, and expect `[]`. Without that line the item is still listed.
- [ ] **Step 2: Run and see them fail.** Run `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/console/residue.test.js tests/bin-lib/console/finding-outcomes.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the Interfaces above. In `resolveAll`, map tiebreak items by `it.tiebreak.recommendation === 'drop'`, then compute `filings = planFilings({ ..., unattended: true })` and `digests = planDigests(...)`. `finding-outcomes.js`'s fingerprint call needs no `unattended`, because the fingerprint does not depend on the shape. In console-resolve.js, strip `line` from `digests` the way it strips `proposal` from filings, and write `digests` into console.json and the `--json` output. `findingItems` and `approveAllDefault` stay untouched (update only the comment text that says "not licensed to drop").
- [ ] **Step 4: Run.** Run `node --test tests/bin-lib/console/ tests/console-resolve-conformance.test.js tests/reconcile-archive-residue.test.js tests/bin-lib/hooks/session-residue.test.js`. Expected: PASS.
- [ ] **Step 5: Revert-proof.** Restore resolve.js and residue.js from `HEAD` into a copy, then confirm AC1 and the `unfiledCantTell` test go red. Restore the files.
- [ ] **Step 6: Commit.** `Route unattended can't-tell drops to the digest and accept digested evidence — refs #4679`

### Task 4: console-filings.js plans digests in its default selection

**Review risk:** high (decision logic: default versus `--only` routing, trusted-comment dedup)

**Files:**
- Modify: `plugin/bin/console-filings.js`
- Test: `tests/bin-lib/console/console-filings-cli.test.js`

**Interfaces:**
- Consumes: Task 2's `planDigests`, `heldConsoleFindings`, and `composeFindingDigest`; Task 3's evidence-line wording.
- Produces:
  - A new optional flag `--digest-comments <file>`. It takes a JSON array of comment objects (`{ body, authorAssociation | author_association, url? }`) or a JSON string (a local-files `specs/digest.md` body). It is refused, with exit 2, alongside `--list`/`--fyi`, and when unreadable or neither an array nor a string.
  - The default selection (no `--only`) routes each can't-tell item with `tiebreak.recommendation === 'drop'` to the digest, and files every other item with `planFilings({ ..., unattended: true })`. `--only` keeps today's behaviour exactly: every named item plans `filed` in today's shape (no `unattended`).
  - The output JSON gains `digest: [{ item, fingerprint }]`, `digestDeduped: [{ item, fingerprint }]`, and `digestFile: <path> | null`. `digestFile` is `<out-dir>/console-digest.md`, which holds every non-deduped digest line, one per line, and is written only when `digest` is non-empty.
  - For each `digestDeduped` entry, the CLI appends `AUTO … Queue write: {item} already digested (work-fingerprint {fp}). Reversibility: n/a.` (the same `appendDecision` path and `logFailures` handling as deduped filings).

- [ ] **Step 1: Write the failing tests.**
  - `default selection digests a drop item and files a file item (#4679)`: `file` has one entry and `digest` has one, the digest file holds a line with `tiebreak-cant-tell`, and the file proposal holds no `needs:definition`.
  - `--digest-comments dedups a drop item already held by a trusted comment (#4679 AC3)`: `digestDeduped` has one entry, `digestFile` is null, and decisions.md gains the `already digested` line. No proposal is written for it.
  - `--only keeps every named item filed in today's shape (AC5)`: a named drop item lands in `file`, and its proposal still carries `Labels: needs:definition`.
  - `--digest-comments with --list is a usage error (exit 2)`.
- [ ] **Step 2: Run and see them fail.** Run `node --test tests/bin-lib/console/console-filings-cli.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Update the header comment's "whatever the tiebreak recommended" sentence and the USAGE text.
- [ ] **Step 4: Run.** Run `node --test tests/bin-lib/console/console-filings-cli.test.js tests/bin-lib/console/`. Expected: PASS.
- [ ] **Step 5: Commit.** `Plan digest entries for can't-tell drops in console-filings.js — refs #4679`

### Task 5: backfill routes a can't-tell drop to the digest

**Review risk:** high (decision logic: `disposeFinding` branches on the verdict's recommendation)

**Files:**
- Modify: `plugin/bin/lib/console/backfill-dispose.js` (`disposeFinding` case `'console'`; `findingDigest` appends `consoleFindingMarker` when the item has a claim; `heldDigestComment` also matches that marker)
- Test: `tests/bin-lib/console/backfill-dispose.test.js`

**Interfaces:**
- Consumes: Task 2's `consoleFindingMarker` and `findingFingerprint`.
- Produces: `disposeFinding` with `verdict.outcome === 'console' && verdict.recommendation === 'drop'` returns a digest result with `DIGEST_REASONS.CANT_TELL`. A `console` verdict with any other recommendation still files, now through the verification-task shape: `findingProposal` passes `unattended: true` to `composeFindingProposal` on the can't-tell path only. Confirmed and staged keep their shapes.

- [ ] **Step 1: Write the failing tests.** Add `a console verdict recommending drop digests as tiebreak-cant-tell, never files (#4679)`, and `planBatch: a drop item whose consolefinding marker a trusted comment holds settles as a digest duplicate`.
- [ ] **Step 2: Run and see them fail.** Run `node --test tests/bin-lib/console/backfill-dispose.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** as in the Interfaces above. Keep the item marker. The line order is: the materiality marker, then the console-finding marker, then the item marker.
- [ ] **Step 4: Run.** Run `node --test tests/bin-lib/console/backfill-dispose.test.js tests/bin-lib/console/`. Expected: PASS.
- [ ] **Step 5: Commit.** `Digest backfilled can't-tell drops instead of filing them — refs #4679`

### Task 6: reconciler resolve-console records a `digested` finding row

**Review risk:** high (decision logic: outcome precedence and the cleared predicate)

**Files:**
- Modify: `plugin/bin/lib/reconcile/console-execute.js` (`resolveConsoleExecution` accepts `digested: string[]`; new `DIGESTED_NOTE = 'digested — logged to the materiality digest, nothing filed'`; outcome `digested` counts as cleared; ids must be finding rows, else `{ status: 'error', reason: 'not-finding-items' }`; an id named in both `--digested` and `--filing-failed` is `conflicting-failure-ids`)
- Modify: `plugin/bin/hooks.js` (the `resolve-console` usage line, `--digested` in its flag list and in `VALUE_FLAGS`, threaded through `runResolveConsole`)
- Test: `tests/console-execute.test.js`

**Interfaces:**
- Produces: `hooks.js resolve-console --run <dir> --digested <id,...>` records `outcome: 'digested', note: DIGESTED_NOTE, findingItem` on the item. The reply comment lists it as digested.

- [ ] **Step 1: Write the failing tests.** Add `resolve-console --digested records a finding row digested and clears it (#4679)` (`resolved: true` when it is the only item), `--digested naming a non-finding row is not-finding-items`, and `an id in both --digested and --filing-failed is rejected`.
- [ ] **Step 2: Run and see them fail.** Run `node --test tests/console-execute.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Follow the existing `--filing-failed` path, and place the digested branch before the executed/ticked check.
- [ ] **Step 4: Run.** Run `node --test tests/console-execute.test.js tests/console-failed-execution-residue-conformance.test.js`. Expected: PASS.
- [ ] **Step 5: Commit.** `Record a digested finding row in resolve-console — refs #4679`

### Task 7: skill prose and docs describe the new routing

**Files:**
- Modify: `plugin/skills/_shared/autonomy-ceiling.md` (`consoleAutoResolve` row)
- Modify: `plugin/skills/_shared/console-execution.md` (the "Except a finding row" paragraph and the "A finding row is floor-clearing …" paragraph)
- Modify: `plugin/skills/_shared/materiality-floor.md` ("Tiebreak can't-tell value" now also covers medium+ `drop` at unattended; record the #3949 reversal and the 2026-10-31 measurement)
- Modify: `plugin/skills/wrap-up/review-console.md` ("Can't-tell filings": pass `--digest-comments`, post `digestFile` as one comment on the open `digest` issue per `_shared/materiality-floor.md`'s Container, and log `{item} digested (work-fingerprint {fp})` for each `digest` entry)
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md` (its "whatever the tiebreak recommended" clause)
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` `CANT_TELL_UNFILED_HINT` and `plugin/bin/lib/reconcile/escalate-residue.js`'s cant-tell-unfiled text (name the digested line as the other settling log)
- Modify: `docs/journeys/keep-cant-tell-findings-through-a-console-less-auto-merge-4171.md` (its Action line)
- Modify: `docs/journeys/settle-every-review-finding-at-the-console-3949.md` (the unattended Action line and the "either a `needs:definition` backlog record … or dropped" outcome line)
- Test: the existing prose-conformance suites (`tests/console-resolve-conformance.test.js`, `tests/materiality-floor-conformance.test.js`, `tests/review-tiebreak-step-conformance.test.js`, and any suite that pins the edited text, found with `git grep -l "licensed to drop\|recommendation notwithstanding\|whatever the tiebreak recommended" -- tests`)

**Interfaces:**
- Consumes: Task 3's log-line wording, Task 4's `--digest-comments`/`digestFile`, and Task 6's `--digested`.

- [ ] **Step 1: Find every restatement.** Run `git grep -n -i -e "licensed to drop" -e "recommendation notwithstanding" -e "whatever the tiebreak recommended" -e "whatever it recommended" -- plugin docs tests`. Every hit outside `.claude-tweaks/pipelines/archive/` (historical run artifacts, left as they are) is in scope.
- [ ] **Step 2: Rewrite each hit** to state the new rule: at unattended, a `drop`-recommended can't-tell item is digested (`tiebreak-cant-tell`, deduplicated by its `consolefinding` marker), and every other item files as a `needs-verification` task. In console-execution.md, the unattended wiring runs `console-filings.js` with no `--only` for the run's finding rows. It ticks the rows that come back under `file`/`deduped` and passes the rows under `digest`/`digestDeduped` to `resolve-console --digested`, once their digested lines are logged. A CLI entry's `item` is a console item id: the row passed is the one whose `findingItem` equals it, named by that row's own `id`. In materiality-floor.md, also rewrite the two rationale sentences that the new vocabulary value makes stale. They are the "Deliberately **not** in `DEFER_REASONS` — an unverified finding never failed fix-now" sentence, and the "every other value in that vocabulary answers why fix-now failed" framing. Say that `needs-verification` is the filed verification task's reason, and that the digest entry keeps `tiebreak-cant-tell`, an entry-format value outside the vocabulary. In materiality-floor.md, add one sentence recording that #4679 reverses #3949's "not licensed to drop" ruling, with the evidence: 50 of 53 `needs:definition` records were these filings, 41 carried `Recommendation: drop`, and the other 9 settled in under a minute each by an agent with quoted evidence.
- [ ] **Step 3: Run the prose suites.** Run `node --test tests/console-resolve-conformance.test.js tests/materiality-floor-conformance.test.js tests/review-tiebreak-step-conformance.test.js tests/deferral-gate-conformance.test.js tests/console-execute.test.js tests/reconcile-archive-residue.test.js tests/bin-lib/reconcile/escalate-residue.test.js`. Fix any pinned text to the new wording. Expected: PASS.
- [ ] **Step 4: Run AC4's grep.** Run `git grep -n -i -e "licensed to drop" -e "its recommendation notwithstanding" -- . ":!.claude-tweaks/pipelines/archive"`. Expected: no output.
- [ ] **Step 5: Commit.** `Describe the unattended can't-tell routing in the console contracts — refs #4679`

Proof(cross-release): an older installed build that reads a new run sees `needs-verification` as a non-member (`clearsFloor` denies, which is the safe side) and ignores console.json's `digests` key. An older reconciler would read a digested-only auto-merge run as `cant-tell-unfiled` and refuse to archive it until it upgrades. That fails closed and loses nothing, and the PR body states it.
