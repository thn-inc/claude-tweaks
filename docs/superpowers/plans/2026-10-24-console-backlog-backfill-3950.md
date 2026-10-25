# Console Backlog Backfill and Override Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle every `pending`/`keep-staged` item left in closed or archived Review Consoles exactly once, through a deterministic CLI (enumerate, split, dispose, apply) driven by a `/claude-tweaks:tidy --console-backfill` procedure that runs the review tiebreak per finding. Then retire the Direct-verification override.

**Architecture:** `plugin/bin/lib/console/backfill.js` walks closed and archived runs (acknowledged consoles included), splits legacy decision lines into one work item per finding, and gives each item a content-derived id. `backfill-dispose.js` holds the spec's disposition table as code and composes filing proposals and digest entries. `backfill-apply.js` is the only `console.json` writer. `plugin/bin/console-backfill.js` exposes `list`/`dispose`/`apply`. `plugin/skills/tidy/console-backfill.md` is the judging procedure: it dispatches the tiebreak, files, digests and calls `apply`, but never writes `console.json` itself.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-23T213805-spec-3946-3949-3816-3950/spec-3950/work/3950-spec.md` (worktree copy).

Scope keywords: Direct-verification, composeFindingProposal, fingerprintMap

Premise-refs: plugin/bin/lib/hooks/session-residue.js
Premise-refs: plugin/bin/lib/console/residue.js
Premise-refs: plugin/bin/lib/console/resolve.js
Premise-refs: plugin/bin/lib/tiebreak.js
Premise-refs: plugin/skills/review/step3-tiebreak.md
Premise-refs: plugin/skills/_shared/materiality-floor.md

Waived plugin/bin/lib/hooks/session-residue.js: read only. Task 1's AC2.2 test imports `scanUnresolvedConsoles` to prove that the skip it keeps leaves the console out, while the backfill walk includes it.
Waived plugin/bin/lib/console/residue.js: read only. Task 2 imports `UNRESOLVED_RESOLUTIONS` and `unresolvedItems`, and Task 2's AC5.1 test runs `readRunResidue` over the applied output.
Waived plugin/bin/console-residue.js: read only. The new CLI sits beside it (spec: "extend or sit beside"), and `--ack`/`--ack-all` keep their meaning.
Waived plugin/skills/_shared/pipeline-run-dir.md: read by Task 4. The CLI anchors the pipelines root on `mainCheckoutRoot(cwd)`, never on a worktree-relative path ([IL-127]).
Waived plugin/skills/review/step3-lens-dispatch.md: modified by Task 7, not by Tasks 1–6. The spec's Technical Approach names it for the override decommission.

## Global Constraints

- The CLI never calls a model, `gh` or `git`: it reads files, writes `console.json` (apply only) and writes proposal files (dispose only). `mainSha` comes in as `--main-sha` (AC6.1).
- The procedure never writes `console.json`. The CLI's `apply` is the only writer (AC6.1).
- Work-list contract (spec, additive under expand-contract): `{ mainSha, runs: [{ runDir, items: [{ itemId, itemHash, kind, finding?, claimText?, section }] }] }`. Items may carry extra fields (`consoleDir`, `context`, `noClaimReason`, `staged`). The top level adds `live` and `unreadable`.
- Apply contract: entries `{ runDir, itemId, itemHash, outcome, source, ref? }`. The audit field is `settled: { outcome, source, ref, at }`. `source` ∈ `tiebreak`, `staged-kind`, `digest`.
- Backfill outcomes are `filed`, `dropped`, `digested`, `dismissed`. That is a subset of the spec's allowed set (the console's non-unresolved values plus the additive `digested`): the backfill never writes `applied`/`apply`/`approve`, because it applies nothing. A test asserts no outcome is in `UNRESOLVED_RESOLUTIONS`.
- Closed run means a top-level run whose `run-state.json` `status` is `clean` and whose archive twin is neither `clean` nor a fresh `archiving`, or any run under `archive/`. These are the twin rules `scanUnresolvedConsoles` uses. Any other top-level run is live: skipped and reported, never written.
- Disposition table (spec Deliverable 2, verbatim outcomes):
  - tiebreak `confirmed` at medium or higher → filed;
  - `confirmed` at low → digest;
  - `refuted` → dropped, with the quoted evidence in the audit record;
  - can't-tell at medium or higher, with unknown severity counted as medium, or cannot locate → filed (never an automatic drop);
  - can't-tell at low → digest with a `Defer-reason:` stating the tiebreak could not tell;
  - no recoverable claim, no path or no claim text → digest with a `Defer-reason:` stating no claim was recorded;
  - reflect, unmapped-prefix and `shadow-dup-*` items → the staged-kinds outcome, else a digest naming the unmapped prefix.
- Digest `Defer-reason:` values are Entry-format-only (`_shared/materiality-floor.md`, the `tiebreak-cant-tell` precedent):
  - `tiebreak-cant-tell` (existing);
  - `console-backfill-no-claim`;
  - `console-backfill-unmapped-kind`;
  - `console-backfill-confirmed-low`.
  - `DEFER_REASONS` in `plugin/bin/lib/issues/record.js` is unchanged.
- Digest entries carry the settled run's id (`runIdOf(consoleDir)`) as provenance. They are written to the current main checkout's digest container, never into the closed run's directory.
- Never add or remove an `auto:*` or `bot:*` label on any record. Filed records carry only `needs:definition`, the console's filing path.
- Governing skill `parse-signal-discipline` (quoted): "When the check hits an input it cannot confidently parse, that outcome must be distinguishable from 'this input legitimately does not need this check' — collapsing both into one `null`/skip return turns an unparseable input into a silent false negative." Applied here:
  - a no-claim item always names its `noClaimReason` (`no-path`, `claim-empty`, `source-line-not-found`, `staged-file-absent`);
  - a `console.json` or `decisions.md` that exists but cannot be read or parsed goes to `unreadable`, and its console emits no items. It is never treated as "no claim" and never as settled.
- Governing skill `driver-skill-outcome-taxonomy` (quoted): "Every mutating step needs a `failed`-vs-`PARTIAL` split … Each word names its own recovery, and a re-run is almost never one." The procedure's report names, per batch:
  - records filed;
  - entries applied;
  - items whose filing landed but whose apply did not. Recovery: re-run `list`, and `dispose` dedups to the filed number.

## Review Focus

1. **Several stored items sharing one old-shape `decision:` id in one console** (archived spec-3412: 7 items, 4 ids). The group must be rewritten as a whole, no stored item may be lost, and no work item may be emitted twice. Test in Task 1 (`work items: a duplicated old-shape id group becomes one bundle`) and Task 2 (`apply: rewriting one bundle member writes every sibling once`).
2. **One decision line naming the same `path:line` twice** (real line: `tests/bin-lib/compose-subject.test.js:454 / tests/bin-lib/compose-subject.test.js:454 share a location`). The two items need distinct ids. Test in Task 1 (`AC3.2b: a repeated location in one line yields distinct ids`).
3. **A `console.json` that is not valid JSON or not an object.** It is reported `unreadable`, emits no item, and `apply` never writes it. Tests in Task 1 and Task 2.
4. **An apply entry that names an unresolved or unknown outcome** (`pending`, `keep-staged`, `approve`), a bad source, a duplicate `itemId`, or a `runDir` outside the pipelines root. Each is refused with a named reason and nothing written. Test in Task 2.
5. **A partially applied bundle** (some split items settled, the rest not). Re-listing emits only the unsettled split items, under the same ids. Test in Task 2 (`AC1.1b: resume after a partial apply`).

---

### Task 1: Work-list module — walk closed runs, split legacy lines, derive ids

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/console/backfill.js`
- Test: `tests/bin-lib/console/backfill.test.js`

**Interfaces:**
- Consumes: `classifyStagedItem`, `SHADOW_DUP_RE`, `SECTIONS`, `runIdOf`, `parseTiebreakLine` from `./resolve`; `UNRESOLVED_RESOLUTIONS` from `./residue`; `readRunState`, `isStaleClaim`, `RUN_ID_RE` from `../hooks/context`.
- Produces:
  - `enumerateRuns(pipelinesRoot, deps?) -> { closed: string[], live: [{ runDir, status }] }`. Newest first by basename; a basename present at top level and in `archive/` is kept once (scanUnresolvedConsoles' twin rules).
  - `splitDecisionLine(line) -> { findings: [{ lens, path, line, claim, severity }], noClaim: null | 'no-path' | 'claim-empty' }`.
  - `backfillItemId({ runId, sourceKey, findingKey }) -> string`, shape `bf:` + 16 hex of sha256(`${runId}\n${sourceKey}\n${findingKey}`).
  - `itemHashOf(storedItems) -> string`: 64-hex sha256 of `JSON.stringify(storedItems)`.
  - `consoleWorkItems({ consoleDir, consoleJson, decisions, readStaged, runId }) -> WorkItem[]`. A `WorkItem` is:
    - `{ itemId, itemHash, kind, section, consoleDir, storedIndices: number[] }`, where `kind` is `'finding' | 'no-claim' | 'staged-kind'`;
    - plus, for `finding`: `finding: { lens, path, line, reporterSeverity, kind: 'unconfirmed'|'contested' }`, `claimText`, `context`;
    - for `no-claim`: `noClaimReason`, `context`;
    - for `staged-kind`: `staged: { name, outcome?, section, reason? }`;
    - for a split decision item: `bundleLine`.
  - `buildWorkList({ pipelinesRoot, mainSha, deps? }) -> { mainSha, runs: [{ runDir, items }], live, unreadable: string[] }`.
  - `summarize(workList) -> { runs, consoles, items, byKind: { finding, 'no-claim', 'staged-kind' }, staged: { dismiss, file, digest }, findingsMaxFiled }`. Here `findingsMaxFiled` counts the findings whose `reporterSeverity` is medium or higher: an upper bound on records the tiebreak could file.
  - `STAGED_FINDING_RE = /^review-(unconfirmed|contested|debate)-/`.
  - `deps`: `{ readFile, readdir, exists, isDir }`, with fs defaults.

Classification rules (the decisions the tests pin):
- A stored item is a work item only when its `resolution` is in `UNRESOLVED_RESOLUTIONS`. Settled and `missing`-annotated stored items stay as they are; `missing` is a residue-reader annotation, never stored.
- **`decision:` items, grouped by stored id within one console.** The source lines are the `- STAGED ` lines of the console dir's `decisions.md` that match the id:
  - old shape: `line.slice(2, 60)` equals the id body;
  - new shape: `decision:${line.slice(2,60)}#${sha256(line).hex.slice(0,8)}` equals the id with any `-{n}` suffix dropped.
  - Byte-identical lines are de-duplicated.
  - Every finding of every matched line becomes one item, `sourceKey` = the line, `findingKey` = `${lens}|${path}:${line}#${k}`, where `k` is the finding's 0-based index within its line.
  - A line with `noClaim` becomes one `no-claim` item, `findingKey` = `''`.
  - No matched line gives one `no-claim` item per group with `noClaimReason: 'source-line-not-found'`, `sourceKey` = the stored id.
  - Every item of a group carries the group's `storedIndices` and an `itemHash` over the group's stored items.
- **`bf:` items persisted by an earlier apply** (`backfillSource` field). Re-split `backfillSource` and keep the one finding whose recomputed id equals the stored id. Its `storedIndices` is its own index, and its `itemHash` covers only itself.
- **Staged-file items** (no `:` in the id):
  - The staged file is absent → `no-claim` with `staged-file-absent`.
  - `STAGED_FINDING_RE` → parse the file: severity from `Severity:\s*(\w+)`, lens from `Lens:\s*([\w-]+)` or `lens\s+"?([\w-]+)`, the first `path:line` token, else the first path-shaped token with `line: null`. The claim is the `Finding:` line's text, else the whole file squashed to one line minus its `#` heading. No path → `no-claim` with `no-path`.
  - Otherwise → `staged-kind`, carrying `classifyStagedItem(name, text, anchorText)`'s result. `anchorText` is the anchor file's text when `SHADOW_DUP_RE` matches.
  - `sourceKey` = `staged/${name}`.
- **`tiebreak:` items:** `finding` from the verdict line (`parseTiebreakLine`) plus the claim from `review-findings.json`'s entry with that id, else `no-claim` with `claim-empty`.
- **Any other stored id** (engine row `{row}:{label}`) → `staged-kind`, with `staged: { name: id, section, reason: 'engine-row' }`.
- **`reporterSeverity`:** the parsed severity, else `'medium'` (spec: "unknown severity counts as medium").
- **`splitDecisionLine`:**
  - Location tokens are `/([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)/g`. With none, a path-shaped token `/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/` gives one finding with `line: null`. Neither gives `noClaim: 'no-path'`.
  - Lens: `lens\s+"?([A-Za-z0-9_-]+)` (the first one), else `'unknown'`.
  - Claim for token k: the text between the end of token k and the start of token k+1 (or the end of the line). Then:
    - keep only the first parenthetical when it opens the segment;
    - drop parentheticals matching `/\b(agent|agents|reproduc\w*|single[- ]read|no findings)\b/i`;
    - strip the boilerplate phrases `not reproduced`, `Staged to Review Console as low-confidence.`, `Reversibility: \S+\.`, `Artifact: [^.]*\.`;
    - squash whitespace.
    - Fewer than 4 words left → that finding's claim is `''`.
  - If every finding's claim is `''`, return `noClaim: 'claim-empty'` and no findings.
  - Severity per segment: the first `\b(critical|high|medium|low|info)\b`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/console/backfill.test.js`. Fixtures are built in `fs.mkdtempSync` dirs. A closed run's `run-state.json` is written by the real writer, `closeRunState(runDir)` from `plugin/bin/lib/hooks/close-run-state.js` (Real-writer fixture check). Tests:
  - `AC2.1: an acknowledged console holding keep-staged items is walked`. A clean top-level run whose `console.json` has `residueAcknowledgedAt` and one `keep-staged` `decision:` item. `buildWorkList(...).runs[0].items.length === 1`.
  - `AC2.2: scanUnresolvedConsoles skips that same console`. Call `scanUnresolvedConsoles(cwd, { limit: Infinity, window: Infinity })` with `mainCheckoutRoot` resolving to the fixture (use a git-initialised fixture root as `tests/bin-lib/hooks/session-residue.test.js` does). Assert `runs.length === 0`, while the backfill list holds the item.
  - `AC3.1: a bundled line yields one work item per finding`. Real line from `archive/2026-10-16T162759-record-3013`: `- STAGED 19:29:13 — Step 3 reproduction: lens 3f findings not reproduced (single agent): classify.test.js:81 tests normalizeEntry directly (internal coupling); pr-check-gate-conformance.test.js:77 prose-regex extraction called brittle (note: deepEqual against FAILING_CONCLUSIONS fails loudly on an empty extraction). Staged to Review Console as low-confidence. Reversibility: high.` Assert 2 `finding` items with paths `classify.test.js` and `pr-check-gate-conformance.test.js`, lines 81 and 77, lens `3f`, two distinct `itemId`s.
  - `AC3.2: two lines sharing their first 58 characters yield distinct ids`. Two stored items with the same old-shape id over two lines that differ only after character 60. Distinct ids, 2 items.
  - `AC3.2b: a repeated location in one line yields distinct ids`. The compose-subject `:454 / :454` line gives 2 items, ids differ.
  - `AC4.1: a finding with no recoverable claim is a no-claim item`. The line `- STAGED 14:54:55 — log-decision: Reproduction: lens "3c" finding plugin/bin/lib/console/resolve.js:134 not reproduced (present in only one of two reproduction agents). Staged to Review Console as low-confidence. Reversibility: high.` gives `kind: 'no-claim'`, `noClaimReason: 'claim-empty'`.
  - `no-claim reasons are distinguishable`: `no-path` (a line with no path token), `source-line-not-found` (stored id with no `decisions.md` line), `staged-file-absent` (`review-unconfirmed-9.md` not on disk).
  - `work items: a duplicated old-shape id group becomes one bundle`. 3 stored items with one id and 2 matching lines (1 finding each) give 2 items, each with `storedIndices` `[0,1,2]` and the same `itemHash`.
  - `ids are deterministic`. `buildWorkList` twice gives deep-equal output.
  - `staged finding file parses lens, path, line and claim`. The 3351 fixture text (`Finding: no test pins … Severity: low … Target: tests/bin-lib/preflight-records/preflight-records.test.js`) gives `kind: 'finding'`, severity `low`, path `tests/bin-lib/preflight-records/preflight-records.test.js`, `line: null`.
  - `staged-kind items carry classifyStagedItem's result`:
    - `reflect-1.md` with `**Category:** observation` → `staged.reason === 'non-tangential-category:observation'`;
    - `zz-1.md` → `'unmapped-prefix'`;
    - `x-1.md.shadow-dup` byte-identical to `x-1.md` → `staged.outcome === 'shadow-dup-duplicate'`.
  - `live runs are reported and skipped`. A top-level run with `status: 'active'` → `live[0].runDir` set, no items.
  - `an archive twin stands in for a non-clean top-level copy`. Top-level `active`, archive copy present → the archive dir is listed under `runs`.
  - `unreadable console.json emits no items` (`{not json`, and `null`) → `unreadable` holds its path.
  - `summarize counts kinds`. Exact counts over a 1-finding, 1-no-claim, 2-staged fixture.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/console/backfill.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/console/backfill'`.

- [ ] **Step 3: Implement `plugin/bin/lib/console/backfill.js`** with the interfaces above. Header comment in the house style of `residue.js`.

- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS. Also run `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/hooks/session-residue.test.js`. Expected: PASS (unchanged).

- [ ] **Step 5: Revert-to-red.**
  - Make the walk filter acknowledged consoles: AC2.1 must go red.
  - Replace the `#${k}` index in `findingKey` with `''`: AC3.2b must go red.
  - Restore both.

- [ ] **Step 6: Commit.** `git add` the two files. `git commit -m "Add the console backfill work list — walk closed runs including acknowledged consoles, split legacy decision lines, content-derived ids" -m "refs #3950"`

### Task 2: Apply — the only console.json writer

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/console/backfill-apply.js`
- Test: `tests/bin-lib/console/backfill-apply.test.js`

**Interfaces:**
- Consumes: Task 1's `consoleWorkItems`, `BACKFILL_*`; `UNRESOLVED_RESOLUTIONS`, `readRunResidue` (test only).
- Produces:
  - `BACKFILL_OUTCOMES = ['filed','dropped','digested','dismissed']` and `BACKFILL_SOURCES = ['tiebreak','staged-kind','digest']`, exported from `backfill-apply.js`.
  - `entryProblem(entry) -> null | 'bad-outcome' | 'bad-source' | 'missing-ref' | 'malformed'`. `ref` is required, as a non-empty string, for every outcome; `filed` refs match `/^#\d+$/`.
  - `applyToConsole({ consoleDir, consoleJson, decisions, readStaged, runId, entries, at }) -> { json: object|null, applied: string[], refused: [{ itemId, reason }], acknowledged: boolean }`. `json` is `null` when nothing changed. Refusal reasons:
    - `unknown-item`;
    - `already-settled`: a stored item whose `id` or `backfillId` equals the `itemId` carries `settled`;
    - `stale-hash`;
    - `duplicate-entry`: the same `itemId` twice in `entries` refuses both;
    - plus the `entryProblem` reasons.

Write rules:
- A settled non-split item is rewritten in place. It keeps its `id` and `section` and gets:
  - `resolution: outcome`;
  - `reason: \`backfill: ${source} → ${outcome} (${ref})\``;
  - `settled: { outcome, source, ref, at }`;
  - `backfillId: itemId`.
- A split decision group: its stored items are replaced, at the first stored index and in work-item order, by one entry per work item of the group:
  - settled ones as above, with `id: itemId`;
  - unsettled ones `{ id: itemId, section, resolution: <the group's first stored resolution>, reason: <its reason>, backfillSource: bundleLine }`.
  - A no-claim item of a group with no source line carries no `backfillSource`, and its stored `id` stays the old id.
- Acknowledgement: once no stored item's resolution is in `UNRESOLVED_RESOLUTIONS` and `residueAcknowledgedAt` is absent, set it to `at`. An existing acknowledgement is never removed or changed.

- [ ] **Step 1: Write the failing tests:**
  - `AC5.1: a settled item is rewritten with its audit record`. Assert `resolution`, `settled` deep-equal `{ outcome: 'digested', source: 'digest', ref: 'https://x/c/1', at }`, and `reason` naming source and outcome. Then `readRunResidue(runDir).consoles.length === 0`.
  - `AC5.2: a console with all items settled is acknowledged`.
  - `AC5.3: a console with an unsettled item is not acknowledged`. 2 items, 1 entry → `residueAcknowledgedAt` absent.
  - `no backfill outcome is unresolved`: `BACKFILL_OUTCOMES.every((o) => !UNRESOLVED_RESOLUTIONS.has(o))`.
  - `AC1.1: re-applying settled entries changes nothing`. The second `applyToConsole` returns `json: null`, `refused: [{ reason: 'already-settled' }]`.
  - `AC1.1b: resume after a partial apply`. A bundle of 2 findings with 1 settled is written. Re-run `consoleWorkItems` over the written JSON: exactly 1 item, its `itemId` equal to the unsettled id from the first listing.
  - `apply: rewriting one bundle member writes every sibling once`. A 3-stored-item group with 2 findings gives exactly 2 stored entries, no duplicate ids.
  - `refusals are named and write nothing`:
    - outcome `pending`, `keep-staged` and `approve` → `bad-outcome`;
    - source `human` → `bad-source`;
    - `filed` with ref `12` → `missing-ref`;
    - a duplicated `itemId` → `duplicate-entry` ×2;
    - a wrong `itemHash` → `stale-hash`.
    - Each gives `json: null`.
  - `an existing acknowledgement is kept`. The value is unchanged after a full settle.
  - `the backfill result reads back through the residue reader`. Run `unresolvedItems(json)` over a settled fixture: `[]`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/console/backfill-apply.test.js`
Expected: FAIL (module missing)
- [ ] **Step 3: Implement `backfill-apply.js`.** Pure: no fs. The CLI (Task 4) reads and writes.
- [ ] **Step 4: Run.** Expected: PASS. Then `node --test "tests/bin-lib/console/*.test.js"`. Expected: PASS.
- [ ] **Step 5: Revert-to-red.**
  - Drop the `already-settled` check: AC1.1 must go red.
  - Make acknowledgement unconditional: AC5.3 must go red.
  - Restore both.
- [ ] **Step 6: Commit.** `git commit -m "Add the console backfill apply step — the only console.json writer, settled audit record, acknowledgement once every item is settled" -m "refs #3950"`

### Task 3: Dispose — the disposition table, proposals and digest entries

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/console/backfill-dispose.js`
- Modify: `plugin/bin/lib/console/finding-filing.js` (`composeFindingProposal` gains an optional `verdict`; `fingerprintMap` moves here)
- Modify: `plugin/bin/console-filings.js` (imports the moved `fingerprintMap`; behaviour unchanged)
- Test: `tests/bin-lib/console/backfill-dispose.test.js`
- Test: `tests/bin-lib/console/finding-filing.test.js`

**Interfaces:**
- Consumes: the Task 1 `WorkItem`; resolve-tiebreak's JSON (`plugin/bin/lib/tiebreak.js`'s `resolveTiebreak` result: `{ outcome: 'confirmed'|'drop'|'digest'|'console', severity, evidence, reason, recommendation }`); `composeFindingProposal`, `findingFingerprint` (`finding-filing.js`); `composeShadowDupProposal` (`shadow-dup-proposal.js`); `materialityEntryLine`, `materialityFingerprint`, `isMaterialityDuplicate` (`../health-core/materiality-digest`); `extractFingerprint` (`../issues/record`).
- Produces:
  - `DIGEST_REASONS = { NO_CLAIM: 'console-backfill-no-claim', UNMAPPED_KIND: 'console-backfill-unmapped-kind', CONFIRMED_LOW: 'console-backfill-confirmed-low', CANT_TELL: 'tiebreak-cant-tell' }`.
  - `areaFor(item) -> string`:
    - a path under `plugin/skills/{s}/` → `s`;
    - `plugin/bin/lib/{m}/` → `m`;
    - `plugin/bin/` → `bin`;
    - else the path's first segment (`tests`, `docs`);
    - no path: `reflect` for a `reflect-*` staged item, else `console`.
  - `disposeItem({ item, verdict, runId, mainSha }) -> { itemId, action: 'file'|'digest'|'drop'|'dismiss', outcome, source, ref?, proposal?: { fingerprint, title, text }, digest?: { entry, line, fingerprint } }`. Throws `TypeError('verdict required for a finding item')` when a `finding` has no verdict.
  - `planBatch({ workItems, verdicts, existingIssues, digestComments, mainSha }) -> { dispositions, file: [{ itemId, fingerprint, title, text }], reuse: [{ itemId, number }], digest: { lines: string[], duplicates: string[] }, entries: [{ runDir, itemId, itemHash, outcome, source, ref }] }`:
    - `existingIssues` is `gh issue list --state all --json number,body` rows; the fingerprint map is built as `console-filings.js`'s `fingerprintMap` does (move that helper into `finding-filing.js` and export it; `console-filings.js` imports it).
    - `ref` is pre-filled for `drop`/`dismiss` and for `reuse` (`#N`), and `null` for new filings and digest lines (the procedure fills it).
    - Two items in one batch with the same filing fingerprint → the second is listed under `reuse` with `number: null`, pointing at the first via `sameAs: itemId`.
  - `composeFindingProposal({ item, finding, runId, verdict? })`, with `verdict: { kind: 'confirmed', evidence, mainSha }` optional:
    - title prefix `Review finding (confirmed):`;
    - one Current State line: `The tiebreak confirmed it on ${mainSha}: ${path}:${line} \`${quote}\`.` (defused);
    - fingerprint unchanged;
    - default behaviour byte-identical.

Disposition rules, decided here:

| Item | Verdict | action / outcome / source | ref / Defer-reason |
|---|---|---|---|
| finding | `confirmed`, severity medium or higher | file / filed / tiebreak | confirmed proposal |
| finding | `confirmed`, low or info | digest / digested / tiebreak | `console-backfill-confirmed-low` |
| finding | `drop` | drop / dropped / tiebreak | ref = `${evidence.path}:${evidence.line} "${evidence.quote}"` |
| finding | `console` | file / filed / tiebreak | can't-tell proposal (`composeFindingProposal` default) |
| finding | `digest` | digest / digested / tiebreak | `tiebreak-cant-tell` |
| no-claim | — | digest / digested / digest | `console-backfill-no-claim`; the finding text names `noClaimReason` |
| staged-kind, `shadow-dup-duplicate` | — | dismiss / dismissed / staged-kind | ref = `duplicate of staged/{anchor}` |
| staged-kind, `shadow-dup-divergent`/`-collision` | — | file / filed / staged-kind | `composeShadowDupProposal` |
| staged-kind, section `Queue writes` with no `reason` and text starting `Title:` | — | file / filed / staged-kind | proposal = the staged text |
| any other staged-kind | — | digest / digested / digest | `console-backfill-unmapped-kind`; the finding text names `{name} ({reason or section})` |

For a digest entry:
- `finding` is one line: the claim, or the staged file's first non-heading, non-header line, cut to 200 chars;
- `fileRefs` is `path[:line]`, or a reflect file's `**Files:**` value, or `general`;
- `provenance` is the `runId`.

- [ ] **Step 1: Write the failing tests.** One test per table row, named `disposition: {row}`. Plus:
  - `AC4.1b: a no-claim item routes to the digest with the no-claim reason` (`Defer-reason: console-backfill-no-claim` in `digest.line`);
  - `AC4.2: a no-claim item is neither dropped nor left pending` (outcome `digested`);
  - `unknown reporter severity files a can't-tell` (reporterSeverity defaulted `medium`, verdict `console` → `file`);
  - `planBatch dedups against an existing record` (a body carrying `<!-- work-fingerprint: consolefinding-… -->` → `reuse` with `#N` ref and nothing under `file`);
  - `planBatch dedups a digest entry already posted by a trusted author` (comment `{ body: line, authorAssociation: 'OWNER' }` → `duplicates`; the same comment from `NONE` → not a duplicate);
  - `areaFor maps paths`, with four paths;
  - `composeFindingProposal default output is unchanged`: the existing `finding-filing.test.js` assertions stay green, plus one confirmed-variant test.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/console/backfill-dispose.test.js`
Expected: FAIL (module missing)
- [ ] **Step 3: Implement.** Moving `fingerprintMap` is a pure move: `console-filings.js` behaviour unchanged.
- [ ] **Step 4: Run** the two suites plus `tests/bin-lib/console/console-filings-cli.test.js`. Expected: PASS.
- [ ] **Step 5: Revert-to-red.**
  - Map `console` to `digest`: the can't-tell-files test must go red.
  - Drop the trusted-author filter: the `NONE` dedup test must go red.
  - Restore both.
- [ ] **Step 6: Commit.** `git commit -m "Add the console backfill disposition table — tiebreak verdicts, no-claim and staged kinds to filed, dropped, digested or dismissed" -m "refs #3950"`

### Task 4: The `console-backfill.js` CLI, its docs line, and the real-input probe

**Role:** integration

**Files:**
- Create: `plugin/bin/console-backfill.js`
- Modify: `docs/plugin-structure.md`: the `plugin/bin/lib/console/` line and a command-reference line beside `console-filings.js`
- Test: `tests/bin-lib/console/backfill-cli.test.js`

**Interfaces:**
- Consumes: Tasks 1–3; `mainCheckoutRoot` (`lib/hooks/worktree-detect`); `writeFileAtomic` (`lib/atomic-write`).
- Produces: `run(argv, deps) -> exitCode`, exported, with a `require.main` guard. `--help`/`-h` anywhere prints the usage and exits 0 with nothing read or written. Usage:

```
console-backfill.js list --main-sha <sha> [--out <path>]
console-backfill.js list --dry-run
console-backfill.js dispose --work-list <file> --verdicts <file> [--existing <issues.json>] [--digest-comments <comments.json>] --out-dir <dir>
console-backfill.js apply --entries <file> [--dry-run]
```

- `list` prints the work list JSON to stdout, or writes it to `--out`. `list --dry-run` prints the human summary from `summarize`. It must include these lines verbatim in shape:
  - `runs: {n} (live skipped: {k})`;
  - `items: {n} — findings {a}, no-claim {b}, staged-kind {c}`;
  - `deterministic: digest {x}, dismiss {y}, file {z}`;
  - `tiebreak dispatches: {a}; records filed at most: {findingsMaxFiled + z}`.
  - It writes nothing.
- `dispose` writes each new proposal to `{out-dir}/backfill-filing-{n}.md` and prints `planBatch`'s result with `file[].text` replaced by the written path. `--verdicts` is a JSON object keyed by `itemId`.
- `apply` groups entries by `runDir` and refuses, per entry, a `runDir` not under `{pipelines}` or `{pipelines}/archive` (`run-not-anchored`) or live now (`run-live`). It re-reads each `console.json` fresh, calls `applyToConsole`, and writes with `writeFileAtomic` only when `json` is non-null and `--dry-run` is absent. It prints `{ applied, refused, acknowledged, written }` and one stderr line per refusal.
- Exit codes: 0 done (refusals are per-entry results in the JSON); 2 malformed invocation or an unparseable input file; 3 the pipelines root is missing, or a `console.json` or `--out-dir` cannot be written. This is the Sanctioned-writer vocabulary (`.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`).
- The pipelines root is `path.join(deps.mainRoot || mainCheckoutRoot(cwd) || cwd, '.claude-tweaks', 'pipelines')`.

- [ ] **Step 1: Write the failing tests.** Fixtures go under a temp main root passed as `deps.mainRoot`. Tests:
  - `AC1.1c: list after a full apply is empty and the console is byte-identical on a second apply` (read bytes before and after);
  - `AC6.1: the CLI never spawns a process`: scan `plugin/bin/console-backfill.js` and the three `lib/console/backfill*.js` files, comments stripped with `tests/helpers/strip-comments.js`'s `stripComments` (and `stripperVerdict` must return `ok` for each file) as `bin-source-scan-conformance` requires, for `child_process`, `execFile`, `spawn`, `fetch(`. Zero hits. Go-red: a fixture string containing `require('child_process')` run through the same check matches;
  - `list --dry-run writes nothing and prints the four summary lines`;
  - `apply refuses a runDir outside the pipelines root`;
  - `apply --dry-run writes nothing`;
  - `exit 2 on an unknown subcommand, on list without --main-sha or --dry-run, on unparseable --entries`;
  - `exit 3 when the pipelines root is missing`.
- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/console/backfill-cli.test.js`
Expected: FAIL (module missing)
- [ ] **Step 3: Implement the CLI.** Add the docs lines. Command reference: `node plugin/bin/console-backfill.js (list --main-sha <sha> [--out <path>] | list --dry-run | dispose … | apply --entries <file> [--dry-run])   # Console backlog backfill (#3950) — …`. Append `backfill.js`, `backfill-apply.js` and `backfill-dispose.js` to the `plugin/bin/lib/console/` line.
- [ ] **Step 4: Run** the suite. Expected: PASS. Then `node --test "tests/bin-lib/console/*.test.js" tests/skill-catalog-completeness.test.js`. Expected: PASS.
- [ ] **Step 5: Real-input probe and independent count** (Real-input probe check, Independent-count check):
  - Run `node plugin/bin/console-backfill.js list --dry-run` from the worktree. The CLI anchors on the main checkout.
  - In the same minute, run the scratch probe `node {scratchpad}/run2/probe-3950-backlog.js "{main}/.claude-tweaks/pipelines"`.
  - Reconcile: every stored unresolved item the probe counts (480 stored items, 170 runs, 195 consoles, 156 acknowledged on 2026-10-24) is covered by exactly one group or item. A scratch check sums `storedIndices` per console and compares it with the probe's per-console counts.
  - Live runs reported: `2026-10-16T222103-record-2987`.
  - Write both outputs to `$PIPELINE_RUN_DIR/evidence/backfill-probe.txt` (`mkdir -p` first). Log an `AC evidence` entry (AC2.1, real data) via `log-decision.js --section "/build" --status AUTO --step "AC evidence"` with the counts.
- [ ] **Step 6: Commit.** `git commit -m "Add console-backfill.js — list, dispose and apply over closed and archived consoles, never calling a model or gh" -m "refs #3950"`

### Task 5: The `/claude-tweaks:tidy --console-backfill` procedure

**Role:** integration

**Files:**
- Create: `plugin/skills/tidy/console-backfill.md`
- Modify:
  - `plugin/skills/tidy/SKILL.md`: `argument-hint`, the `## Input` parse line, and one routing sentence after the `--approve` sentence;
  - `plugin/skills/help/reference-card.md`: tidy's `Takes` cell;
  - `plugin/skills/_shared/materiality-floor.md`: a new `### Console backfill values` subsection after `### Tiebreak can't-tell value`;
  - `docs/skill-graph.md`: a `/review` row under `/tidy`'s section (tidy's console-backfill mode dispatches `review/step3-tiebreak.md`'s template and resolves through `review-coordination.js resolve-tiebreak`);
  - `tests/materiality-floor-conformance.test.js`, if it enumerates the Entry-format-only values.
- Test: `tests/tidy-console-backfill-conformance.test.js`

**Interfaces:**
- Consumes: Task 4's CLI and exit codes; `review-coordination.js resolve-tiebreak F R --root {checkout}`; `_shared/scratch-worktree.md` (`## 2. Creating it`, `## 6. Tearing down`); `_shared/integration-branch.md`'s Resolution ladder; `_shared/materiality-floor.md`'s Container, Dedup and Digest URL and count surfacing; `_shared/github-write-transport.md`.
- Produces: the mode token `--console-backfill`. The new hint is `"[--scope=<name>[,<name>...]] [--dry-run] [--approve [run-dir]] [--console-backfill]"`, byte-identical in all three mirrors (`docs/skill-authoring.md`'s Argument-hint mirror surfaces table: frontmatter, input-parse-line, reference-card-takes).

Byte headroom: `tidy/SKILL.md` 36,588 B (rail 52,500; the new sentence adds under 400 B). `materiality-floor.md` must stay under the rail; measure with `wc -c` before and after.

The procedure file must state, in this order (each is a decision the conformance test pins):

1. **Flags.** Rule: "a routing token that replaces a skill's phases owns every flag":
   - `--scope` and `--approve` with `--console-backfill`: rejected in combination (report both tokens, run neither);
   - `--dry-run`: re-implemented (run `list --dry-run` and stop).
2. **Main session only.** Tiebreak agents are dispatched from it. If the procedure finds itself inside a Task agent (no `Agent` tool), it stops and reports (spec Gotcha: never a nested path).
3. **Resolve the integration branch** (ladder) and fetch it. Create a detached scratch worktree at its tip (`_shared/scratch-worktree.md`). `{mainSha}` = that tip. Tear the worktree down at the end, on every exit path.
4. **Summary first:** `console-backfill.js list --dry-run`, printed verbatim. With `--dry-run`, stop here. Otherwise one `AskUserQuestion`:
   - `question`: `"The backfill will dispatch {a} tiebreak agents and may file up to {N} records. Proceed?"`;
   - options `Proceed (Recommended)` and `Stop`.
5. **`list --main-sha {mainSha} --out {session-tmp}`**, through `session-tmp-resolve.js` for every scratch path.
6. **Fetch once per batch:**
   - `gh issue list --state all --json number,body --limit 2000` → `--existing`;
   - the open `digest` issue's comments (`gh issue view {n} --json comments`) → `--digest-comments`;
   - create the digest container per materiality-floor's Container when none is open.
7. **Batches of at most 24 items; tiebreak waves of 8** (`step3-tiebreak.md`'s Dispatch). For each `finding` item:
   - Inline `step3-tiebreak.md`'s template verbatim, with these field values:
     - `Finding:` = `claimText`, and a second line `Source (context only — judge just the finding at Location): {context}`;
     - `Severity:` = `reporterSeverity`;
     - `Location:` = `{path}:{line}`, or `{path}` when `line` is null;
     - `Diff scope:` replaced by `Current code: {scratch worktree} at {mainSha} — decide whether this finding still holds today`.
   - A `BLOCKED`/`NEEDS_CONTEXT`/empty reply is re-dispatched once as a fresh agent, then passed as an empty reply. The resolver turns it into can't-tell (fail toward scrutiny).
   - Resolve each verdict with `resolve-tiebreak F R --root {scratch worktree}`, the finding written as `{lens, path, line, claim: claimText, reporterSeverity, kind}`.
   - Collect `{ [itemId]: <its JSON> }` into the verdicts file. Never log verdict lines into the closed run's `decisions.md`.
8. **`dispose`** for the batch. Then, in this fixed order per item: dedup → file or digest → record ref → apply.
   - Each `file[]` proposal is created with `gh issue create`. The title is single-quoted with `'\''` escaping, the body goes through `--body-file`, the label is `needs:definition` only (review-console.md "On approval" step 7's quoting rule, cited). Each entry's `ref` = `#N`.
   - All `digest.lines` of the batch go in one comment (`gh issue comment {n} --body-file`). Each digested entry's `ref` = that comment's URL.
   - A failed `gh` call leaves that item's entry out. It stays unsettled and is reported, and the next run resumes it.
9. **`apply --entries {file}`.** Print the `applied`/`refused` counts. A refusal is reported with its reason, never retried blindly.
10. **Loop** until `list` emits no item, or every remaining item failed this run. Final report: every filed record (`#N`), every drop (evidence), every digest comment URL and count, every unsettled item with its reason, live runs skipped. Plus the outcome word per `driver-skill-outcome-taxonomy`: `HELD` before any write, `failed` when nothing landed, `PARTIAL` when something landed and items remain, `done` when the work list is empty.

- [ ] **Step 1: Write the failing conformance test** `tests/tidy-console-backfill-conformance.test.js`. It reads the live `plugin/skills/tidy/console-backfill.md`. One assertion function, `assertProcedure(text)`, called by the positive test and by a go-red control that deletes the step-8 order sentence (it must throw). Pins:
  - `list --dry-run` appears before `list --main-sha`;
  - the literals `apply --entries`, `resolve-tiebreak`, `step3-tiebreak.md`, `waves of 8`, `never writes \`console.json\``, `needs:definition`, `auto:*`, `bot:*`, `re-dispatched once`;
  - the step-8 order sentence `dedup → file or digest → record ref → apply`;
  - `--scope` and `--approve` rejected with `--console-backfill`.
  - `AC6.1b: the procedure never writes console.json directly`: no `Write`/`Edit`/`>` target ending `console.json` in the file.
- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/tidy-console-backfill-conformance.test.js`
Expected: FAIL (file absent)
- [ ] **Step 3: Write `console-backfill.md` and the five modifications.** Mirror-surface grep: run `git grep -n -F -- '--approve [run-dir]' -- plugin docs README.md` and update every hit that restates the whole hint. Prose hits (context-flow.md's `/tidy` row: "All artifacts / Cleanup actions") are classified no-change in the commit message.
- [ ] **Step 4: Run** `node --test tests/tidy-console-backfill-conformance.test.js tests/argument-hint-mirrors.test.js tests/argument-hint-input.test.js tests/materiality-floor-conformance.test.js "tests/bin-lib/skill-audit/*.test.js" tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add tidy's console-backfill mode — summary first, tiebreak per finding against the integration tip, dedup before filing, apply last" -m "refs #3950"`

### Task 6: Acceptance run on this repo (controller-executed, not dispatched)

**Role:** judgment

This task dispatches tiebreak agents, so the controller runs it in the main session (spec Gotcha; a Task implementer has no nested dispatch). It writes no repo files. Its evidence goes to the run dir and the PR.

**Files:**
- Waived: no source change. Evidence goes to `$PIPELINE_RUN_DIR/evidence/console-backfill-{dry-run,batch-N,final}.txt`.

- [ ] **Step 1: Verify the ASSUMPTION marker:** this session has the `Agent` tool and is the main session. Log `confirmed` via `log-decision.js`.
- [ ] **Step 2: Dry run.** Run `console-backfill.js list --dry-run` and save the output to evidence. Show it to the user and take the procedure's one `AskUserQuestion` (step 4). Stop if they choose Stop.
- [ ] **Step 3: Run the procedure** (Task 5's steps 5–10) to completion, resuming until the remainder is zero or every remaining item has a named failure.
- [ ] **Step 4: AC7.1 check.**
  - `node plugin/bin/console-residue.js --ack-all` must NOT be used.
  - Instead run `node plugin/bin/hooks.js check-session-residue` (the banner's own detection) and the probe script. Expected:
    - the banner's console section is empty;
    - the probe reports `items: 0` across closed and archived runs;
    - live runs are listed.
  - Save to evidence and log an `AC evidence` entry for AC7.1 and AC7.2 with the counts: filed, dropped, digested, dismissed, unsettled.
- [ ] **Step 5: Record the counts in the PR body** (Spec summary section): filed record numbers, drops, digest comment URLs, unsettled. No tracker file.

### Task 7: Retire the Direct-verification override

**Role:** integration

Decision criterion (spec): retire unless the acceptance run or a documented interactive path shows a human-present reviewer legitimately settling a finding without a dispatch. Default expectation: retire. Every unconfirmed finding already reaches Step 3.7's tiebreak at every tier and mode. The override's reviewer has read the reporting lens's account, so it is not independent, and its auto-mode clause ("when an auto-mode agent's own pass happens to read that source directly") is a loophole for unattended runs. The controller confirms the criterion against Task 6's run before dispatching this task, and records decision, criterion and removal condition in the PR body:
- expand-contract: old transcripts' ` Mode: inline.` verdict lines still parse, because the resolver keeps that suffix for the dispatched-reviewer inline fallback;
- removal condition: none (retired now).

**Files** (from the sweep grep below; re-run it at dispatch and add any new hit):
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (lines 78, 96, 101, 102, 105 on 2026-10-24)
- Modify: `plugin/skills/review/step3-tiebreak.md`
- Modify: `plugin/skills/review/step3-routing.md`
- Modify: `plugin/skills/review/step3-cross-lens-corroboration.md`
- Modify: `plugin/skills/review/review-summary-template.md`
- Modify: `docs/journeys/trust-a-defect-several-review-lenses-flagged-3604.md`
- Modify: `docs/journeys/get-a-verdict-on-every-unverified-review-finding-3947.md`
- Modify: `docs/journeys/confirm-coverage-findings-across-reproduction-pairs-3049.md`
- Modify: `docs/journeys/confirm-findings-split-across-a-multi-line-statement-2955.md`
- Modify: `docs/journeys/confirm-paraphrased-findings-across-reproduction-pairs-3418.md`
- Modify: `docs/journeys/drop-a-refuted-code-is-missing-claim-3329.md`
- Test: `tests/review-cross-lens-corroboration-conformance.test.js`
- Test: `tests/foreground-execution-instruction.test.js`
- Test: `tests/review-vacuity-evidence-conformance.test.js`
- Test: `tests/review-tiebreak-step-conformance.test.js`
- Test: `tests/bin-lib/console/resolve.test.js`

Not changed:
- `docs/incident-log.md`: append-only history that records what was true.
- `tests/hooks-help-guard.test.js:109`'s comment `review 3c (medium, direct-verification-confirmed)`: a record of how a past review confirmed a finding, not an instruction.
- Older plans under `docs/superpowers/plans/` (e.g. `2026-10-24-console-final-outcomes-3949.md`): run artifacts, deleted at this run's close-out.
- The sweep below excludes these three by pathspec.

Rewrites:
- Delete line 105's `> **Direct-verification override.**` paragraph.
- Line 78: "recoverable only through the Direct-verification override" → "recoverable only through Step 3.7's tiebreak".
- Line 96: "unless elevated via the Direct-verification override below" → "until Step 3.7's tiebreak settles them".
- Line 101: "elevating stays the Direct-verification override's job" → "elevating is Step 3.7's tiebreak's job".
- Line 102: "The Direct-verification override does not lift this downgrade by reading source alone: the only way back" → "Reading source alone never lifts this downgrade: the only way back".
- `step3-tiebreak.md`: "Any reviewer-read verdict — a Direct-verification override, or an inline fallback below —" → "An inline fallback verdict (`## Dispatched reviewer`)". Drop the sentence "An override's can't-tell outcome is not logged: …".
- Other files: replace each mention with the tiebreak equivalent. Tests that pinned the override's presence pin its absence instead, plus the replacement sentence.

- [ ] **Step 1: Sweep grep** (Retirement-sweep check, every phrasing):
  `git grep -n -i -e 'direct-verification' -e 'direct verification' -e 'verification override' -e 'override paragraph' -- plugin tests docs README.md ':!docs/incident-log.md' ':!docs/superpowers/plans' ':!tests/hooks-help-guard.test.js'`
  The file list comes from this output. Moved-prose pins: `git grep -n -F -e 'recoverable only through' -e 'elevating stays' -e 'does not lift this downgrade' -- tests plugin`.
- [ ] **Step 1b: Write the failing test change.** In `tests/review-tiebreak-step-conformance.test.js`, add `AC8.1: the Direct-verification override is retired`: `step3-lens-dispatch.md` has no case-insensitive `direct-verification`, and contains `recoverable only through Step 3.7's tiebreak`. Add `AC8.2: step3-lens-dispatch.md stays under the rail`: `Buffer.byteLength(text) < 52500`.
- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/review-tiebreak-step-conformance.test.js`
Expected: FAIL (the override is still present)
- [ ] **Step 4: Apply the rewrites** across the sweep's file list.
- [ ] **Step 5: Re-run the Step 1 grep.** Expected: no output. Then `node --test` over every test file in the Files list. Expected: PASS. Then `wc -c plugin/skills/review/step3-lens-dispatch.md`. Expected: below 52,500 (was 50,756).
- [ ] **Step 6: Commit.** `git commit -m "Retire the Direct-verification override — every unconfirmed finding goes to Step 3.7's tiebreak, references swept" -m "refs #3950"`

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 2 `AC1.1`, `AC1.1b`; Task 4 `AC1.1c` |
| AC2.1 | Task 1 `AC2.1`; Task 4 Step 5 real-data probe |
| AC2.2 | Task 1 `AC2.2` |
| AC3.1 | Task 1 `AC3.1` |
| AC3.2 | Task 1 `AC3.2`, `AC3.2b` |
| AC4.1 | Task 1 `AC4.1`; Task 3 `AC4.1b` |
| AC4.2 | Task 3 `AC4.2` |
| AC5.1 | Task 2 `AC5.1` |
| AC5.2 | Task 2 `AC5.2` |
| AC5.3 | Task 2 `AC5.3` |
| AC6.1 | Task 4 `AC6.1`; Task 5 `AC6.1b` |
| AC7.1 | Task 6 Step 4 (AC evidence entry) |
| AC7.2 | Task 6 Steps 3–5 (AC evidence entry, PR body) |
| AC8.1 | Task 7 `AC8.1`; PR body decision record |
| AC8.2 | Task 7 `AC8.2` |
| AC9.1 | Common Step 5 (`verify.js` full suite, incl. the skill-audit rail test) |
