# Ratify-a-deferral-files-a-record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ratifying a deferral `sdd-ruling-*` item at any Review Console surface files the deferred work as a backlog record (ledger row `deferred`, `ratified → #{n}`), while ratifying a `Defers: no` ruling keeps today's `accepted` write-back.

**Architecture:** One pure code twin, `sddRulingRatifyAction(text)` in `plugin/bin/lib/console/sdd-ruling.js`, classifies a ruling's staged header as `file-record` (a safe deferral) or `accept` (a settled `Defers: no`), or `null` (not ratifiable — a gap). `console/resolve.js` names the `file-record` case in its `apply` reason; `reconcile/console-execute.js` forwards the action on each ready ruling item and lets `--filing-failed` name a ruling row whose ratify filing failed. The console prose (appendix, single-run, interactive, multi-spec, on-PR, console-execution) states the rule once in the appendix and cites it everywhere else.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-26T203040-record-3942/work/3942-spec.md` (record #3942); amended 2026-11-03 against `.claude-tweaks/pipelines/2026-11-03T101351-record-3942/work/3942-spec.md`, which adds the maintainer's Reading B decision (a human ratify of a gate-withheld deferral ruling files the record) — Tasks 4-5 below. Tasks 1-3 shipped in 6bf300fe9, 09463a9dc, 2db42dccf. Re-amended 2026-11-03 against `.claude-tweaks/pipelines/2026-11-03T114019-record-3942/work/3942-spec.md`, which adds the maintainer's second-round decision on the three `sdd-ruling-unclassified` header shapes (AC6) and the closing decision on plan review (AC7) — see "Amendment (2026-11-03, round 2)" below.

Scope keywords: sdd-ruling, ratif

## Global Constraints

- Ratify of a deferral ruling (`Defers: yes`, or any `Defer-reason:` header line, with a valid reason) composes a record proposal via `specShapedBody`, the same way `reverse` does; Current State = the ruling and the finding it deferred; Deliverables = the deferred work; the record carries the staged file's own `Defer-reason:` value.
- The proposal routes through the console's record-creation step in the same pass. Once the record exists the ledger row is written `deferred` with Resolution `ratified → #{n}`; if creation fails or is refused, the row stays `open`.
- Ratifying a `Defers: no` ruling keeps today's `accepted` write-back unchanged.
- Never `accepted` or `deferred` without a record number for a deferral ratify.
- Governing skill `prose-code-twin-pin` (verbatim rule from its anti-pattern row): "Pinning a code vocabulary into prose by naming each member (`SDD_RULING_REASONS.NO_DEFER_REASON`, then `.UNCLASSIFIED`) | One assertion per named field stays green when a third member is added to the frozen object and never reaches the prose." — the conformance test iterates `Object.values(SDD_RULING_RATIFY_ACTIONS)` with a non-empty floor.
- `plugin/skills/flow/multispec-review-console.md` is 51,235 B against `RAIL_BYTES` 52,500 B — net growth there must stay under ~1,000 B (cite the appendix bullet, never restate it). Other prose files have >15 KB headroom.
- Commit messages: `{Verb} {what} — {detail}` style, `refs #3942` — never `closes`/`fixes`.

## Check B triage (scope-creep: add-to-plan)

`plan-audit.js` Check B listed 58 files matching `sdd-ruling`/`ratif`. Classified, no change: `CHANGELOG.md` and every `docs/plans/*-ledger.md` (append-only history); `docs/journeys/*` (Common Step 6's `/claude-tweaks:journeys` owns the journey update, chiefly `ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md`); `plugin/bin/lib/wrap-up/pack.js` (read: `parseLedger` already treats a `deferred` row whose Resolution names `#{n}` as complete via `namesRecordReference`, so `ratified → #{n}` needs no change); `plugin/skills/build/dispatch.md` and `build/handoff-template.md` (the SDD producer and the no-run-dir standalone handoff, where `Accept`/`Keep`/`Defer` route through the ledger resolve gate, not a console ratify); `plugin/skills/wrap-up/console-template.md`, `flow/multispec-console-template.md` (headings name `ratify`/`reverse` only — unchanged); `docs/skill-graph.md` (no edge changes); the remaining `tests/**` hits (no assertion on the ratify write-back outcome — `tests/build-sdd-ruling-deferral-gate.test.js` pins the gate, not the outcome, and is re-run in Task 3 Step 4).

## Review Focus

1. A ruling header carrying both `Defers: no` and a valid `Defer-reason:` line — is a deferral (any `Defer-reason:` line makes it one, per `sddRulingDeferralReason`): `sddRulingRatifyAction` must return `file-record`, not `accept`. Pinned in Task 1.
2. A ruling whose staged text is unreadable/unclassified — `sddRulingRatifyAction` must return `null`, never `accept` (fail closed). Pinned in Task 1.
3. A ruling row named in `--filing-failed` that is also ticked/approved — must read `filing-failed`, uncleared, Resolve unticked (outranks the tick, like `--reverse-failed`). Pinned in Task 2.
4. A ruling row named in both `--reverse-failed` and `--filing-failed` — ambiguous caller input; reject before any write (`conflicting-failure-ids`). Pinned in Task 2.
5. ~~A ruling item whose staged text shows a gap — `decideConsoleExecute` must not attach a `ratifyAction` to it.~~ Superseded by Reading B (Task 4): a gapped ruling item is *not auto-ratifiable* (still named in `rulingGateGaps`, so `consoleAutoResolve` never ticks it) but *is* ratifiable by a human, so it carries `ratifyAction: 'file-record'`; only an unreadable row (a recorded read error, or no text at all) is *not ratifiable* and carries none. Pinned in Task 4.
6. Reading B's two categories must never collapse: every gate-withheld deferral header (no reason, several reasons, an invalid reason, no `Defers:` line, `needs-human-decision`) returns `file-record` from `sddRulingRatifyAction` AND a non-null `sddRulingDeferralReason` — the human-ratify action widens, the unattended hold does not. Pinned in Task 4 (one table-driven test asserting both per header).
7. AC6's header shapes: several agreeing `Defers: no` lines with no `Defer-reason:` must return `accept` (never `file-record`) while `sddRulingDeferralReason` still returns `sdd-ruling-unclassified` — the decision governs a human ratify only, so the unattended hold on that shape is unchanged; conflicting `Defers:` lines (`yes` and `no`, in either order), an unknown `Defers:` value and a missing `Defers:` line must return `file-record`, never `accept`; an empty or whitespace-only ruling file must return `null`. Pinned in Task 4.

---

### Task 1: `sddRulingRatifyAction` code twin + resolve.js reason

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/console/sdd-ruling.js`
- Modify: `plugin/bin/lib/console/resolve.js` (re-export; reason on a `file-record` ruling's `apply`)
- Test: `tests/bin-lib/console/sdd-ruling-ratify.test.js` (create)
- Test: `tests/bin-lib/console/resolve.test.js` (add one test near line 1226's `defers-yes-valid-reason-resolves-apply`)

**Interfaces:**
- Produces: `SDD_RULING_RATIFY_ACTIONS = Object.freeze({ FILE_RECORD: 'file-record', ACCEPT: 'accept' })` and `sddRulingRatifyAction(text: string|null|undefined) -> 'file-record' | 'accept' | null`, both exported from `sdd-ruling.js` and re-exported from `resolve.js`. Returns `null` whenever `sddRulingDeferralReason(text)` is non-null; otherwise `file-record` when the header has `Defers: yes` or any `Defer-reason:` line, else `accept`.
- Produces: `resolveAll`'s item for a `file-record` ruling keeps `resolution: 'apply'` and carries `reason: RATIFY_FILES_RECORD_REASON` = `'ratify files a deferral record (Defer-reason carried) — ledger row deferred once it exists'` (exported const from `resolve.js`).

- [x] **Step 1: Write the failing tests** — `tests/bin-lib/console/sdd-ruling-ratify.test.js`:
  - `AC1.1: Defers: yes + one valid Defer-reason ratifies as file-record` → `sddRulingRatifyAction('Ruling: x — why\nDefers: yes\nDefer-reason: genuinely-larger\n\nbody')` === `'file-record'`
  - `AC1.1: a Defer-reason line alone (no Defers:) ratifies as file-record` → header `Defer-reason: tangential` → `'file-record'`
  - `Defers: no plus a valid Defer-reason is a deferral` → `'file-record'` (Review Focus 1)
  - `AC2.1: Defers: no with no Defer-reason ratifies as accept` → `'accept'`
  - `not ratifiable: no-reason deferral, unclassified, null text all return null` → `Defers: yes\n` → null; `Ruling: x\n` → null; `null` → null; `Defers: yes\nDefer-reason: minor\n` → null (Review Focus 2)
  - `SDD_RULING_RATIFY_ACTIONS is frozen with exactly file-record and accept` → `deepStrictEqual(Object.values(...).sort(), ['accept','file-record'])`, `Object.isFrozen`.
  - In `resolve.test.js`: `defers-yes-valid-reason-names-file-record: a deferral ruling resolves apply with the file-record reason (#3942)` → `resolveStaged('sdd-ruling-1.md', RULING('Defers: yes\nDefer-reason: needs-human-decision\n'))` has `resolution: 'apply'`, `reason: RATIFY_FILES_RECORD_REASON`; and the `Defers: no\n` ruling's reason is NOT `RATIFY_FILES_RECORD_REASON`.
- [x] **Step 2: Run to verify they fail** — Run: `node --test tests/bin-lib/console/sdd-ruling-ratify.test.js tests/bin-lib/console/resolve.test.js` Expected: FAIL (`sddRulingRatifyAction is not a function`).
- [x] **Step 3: Implement** both exports in `sdd-ruling.js` (reuse the header parse — factor the header-line split into a local helper both functions call; do not duplicate the regexes), update its header comment's prose-twin line to name the appendix's ratify sentence too. In `resolve.js` line ~582, after the gap check, set the `file-record` reason on the returned `apply` item (the `settledFileResolution` and patch branches are unaffected — a ruling is never a `.patch`).
- [x] **Step 4: Run to verify they pass** — same command, Expected: PASS.
- [x] **Step 5: Commit** — `git add` the four files; `git commit -m "Add sddRulingRatifyAction code twin — ratify of a deferral ruling files a record, refs #3942"`.

### Task 2: console-execute forwards `ratifyAction`; `--filing-failed` accepts a ruling row

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/console-execute.js` (`decideConsoleExecute` ~line 316-392; `resolveConsoleExecution` ~line 552-609; header comment)
- Modify: `plugin/bin/hooks.js` (~line 1442 `not-finding-items` message; add `conflicting-failure-ids` message)
- Modify: `plugin/bin/wrap-up-engine.js` (`validateFinishConsolePayload`, Step 4b)
- Test: `tests/bin-lib/wrap-up/finish-console-cli.test.js`
- Test: `tests/console-execute.test.js`, `tests/resolve-console.test.js`, `tests/hooks-resolve-console.test.js`

**Interfaces:**
- Consumes: `sddRulingRatifyAction` from Task 1 (import from `../console/sdd-ruling`, never `resolve.js`).
- Produces: each `isRulingRow` item in `decideConsoleExecute`'s ready `items` carries `ratifyAction: 'file-record' | 'accept'` when it is not in `rulingGateGaps`; a gapped ruling item carries no `ratifyAction` key. Non-ruling items are unchanged (the existing `deepStrictEqual` at `tests/console-execute.test.js:202` must stay green).
- Produces: `resolveConsoleExecution`'s `filingFailed` accepts an id whose item is a finding row OR `isRulingRow: true`; a ruling there reads outcome `filing-failed`, note `FILING_FAILED_NOTE`, `isRulingRow: true`, not cleared — outranking approve/decline/ticks. An id in both `reverseFailed` and `filingFailed` returns `{ status: 'error', reason: 'conflicting-failure-ids', ids }` before any write. `not-finding-items` keeps its reason string but now means "neither a finding row nor a ruling row".

- [x] **Step 1: Write the failing tests**
  - `console-execute.test.js`: `#3942: decideConsoleExecute attaches ratifyAction to each ungapped ruling item, none to a gapped one` — ruling items `r-yes` (text `Defers: yes\nDefer-reason: genuinely-larger\n`), `r-no` (`Defers: no\n`), `r-gap` (`Defers: yes\n`) via `ctx.rulingTexts`; assert `items` find by id: `r-yes.ratifyAction === 'file-record'`, `r-no.ratifyAction === 'accept'`, `!('ratifyAction' in r-gap)` (Review Focus 5); `rulingGateGaps` unchanged (`[{ id: 'r-gap', reason: 'sdd-ruling-deferral-no-defer-reason' }]`).
  - `resolve-console.test.js` (use existing `runRuling`/`RULING_ITEMS` helpers): `AC3.1: a ticked ruling named in filingFailed reads filing-failed, uncleared, Resolve unticked (#3942)` — approve `['1','r1']`, filingFailed `['r1']` → `r1.outcome === 'filing-failed'`, `r1.note === FILING_FAILED_NOTE`, `result.resolved === false`, reply body includes `` `r1`: filing failed — see decisions.md `` (Review Focus 3); `an id in both reverseFailed and filingFailed is rejected as conflicting-failure-ids before any write` — no `gh` call recorded, `writeFile` not called (Review Focus 4); `console.json persists a ruling's filing-failed outcome` → written item `r1.outcome === 'filing-failed'`.
  - Existing `an id without findingItem in filingFailed is rejected as not-finding-items` must keep passing (its item is neither finding nor ruling) — re-read it and confirm its fixture item lacks `isRulingRow`.
  - `hooks-resolve-console.test.js`: update the `not-finding-items` message assertion to `/--filing-failed id\(s\) 1 are neither finding rows nor sdd-ruling rows/`.
- [x] **Step 2: Run to verify they fail** — Run: `node --test tests/console-execute.test.js tests/resolve-console.test.js tests/hooks-resolve-console.test.js` Expected: FAIL on the new tests.
- [x] **Step 3: Implement** — in `decideConsoleExecute`, compute the ruling gaps first, then build `resolvedItems` so an ungapped ruling item gets `ratifyAction: sddRulingRatifyAction(text)` (only when non-null). In `resolveConsoleExecution`, widen the `filingFailed` validation set to finding ∪ ruling ids, add the conflict check right after it, and add a ruling `filing-failed` branch next to the `reverse-failed` one (before the executed branch). Update the header comment and the outcome-comment block. In `hooks.js`, rename the `not-finding-items` message and add the `conflicting-failure-ids` message (`claude-tweaks: id(s) {ids} named in both --reverse-failed and --filing-failed, console not resolved`); update the `resolve-console` usage string only if a flag changes (it does not).
- [x] **Step 4: Run to verify they pass** — same command, Expected: PASS; also `node --test tests/bin-lib/console/residue.test.js` PASS (a ruling `filing-failed` is already residue via `FAILED_OUTCOMES`).
- [x] **Step 4b: finish-console backstop (AC3.1, the Approve-all writer)** — in `plugin/bin/wrap-up-engine.js`'s `validateFinishConsolePayload`, reject a ledger entry with `status: 'deferred'` whose resolution starts with `ratified` (case-insensitive, after trim) and carries no `#\d+` record reference: message `ledger[${i}]: a ratified deferral needs its record number (ratified → #{n}) — leave the row open when the record was not created`. Tests in `tests/bin-lib/wrap-up/finish-console-cli.test.js`: `AC3.1: finish-console rejects a deferred "ratified" ledger entry with no record number before any write (#3942)` (exit 1, ledger file unchanged, no `verify-expectations.json`) and `AC1.1: finish-console accepts deferred "ratified → #4501"` (row flipped). Run: `node --test tests/bin-lib/wrap-up/finish-console-cli.test.js` Expected: FAIL before, PASS after.
- [x] **Step 5: Commit** — `git commit -m "Forward ratifyAction on ruling rows and let --filing-failed name a failed ratify filing, refs #3942"`.

### Task 3: Console prose — ratify of a deferral files a record, every surface

**Role:** judgment

**Files:**
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` (the `apply` on an `sdd-ruling-*` item bullet, lines 78-100, and the console-auto paragraph 101-111)
- Modify: `plugin/skills/wrap-up/review-console.md` (On approval step 1's ruling clause; step 7 — a ratify proposal `staged/ledger-record-sdd-ruling-{N}.md` is created there; step 11's `ledger` array note)
- Modify: `plugin/skills/wrap-up/review-console-interactive.md` (line 68 `ratify` vocabulary)
- Modify: `plugin/skills/flow/multispec-review-console.md` (On approval step 1; On override step 2) — ≤ 1,000 B net
- Modify: `plugin/skills/_shared/console-execution.md` (Execution routing ruling paragraph line 53-62; accelerator line 126-144: a failed ratify filing goes in `--filing-failed`; Write order's outcome list unchanged)
- Modify: `plugin/skills/_shared/console-on-pr.md` (the "SDD-ruling and finding-row bullets are the two exceptions" paragraph after the Legend — ratify write-back per the appendix; the verbatim Legend block itself stays unchanged)
- Test: `tests/build-sdd-ledger-residue-carryforward.test.js` (re-point pins at lines 121-133, 144, 179, 209)
- Test: `tests/sdd-ruling-ratify-files-record-conformance.test.js` (create)

**Interfaces:**
- Consumes: `SDD_RULING_RATIFY_ACTIONS`, `sddRulingRatifyAction` (Task 1); `--filing-failed` on a ruling (Task 2).
- Produces (appendix, the one statement every other file cites): the ratify sentence names both actions by their code literals:
  - `` `file-record` `` (a deferral: `Defers: yes`, or any `Defer-reason:` header line, with a valid reason) — compose a born-ready record proposal via `specShapedBody` exactly as `reverse` does (Current State = the ruling and the finding it deferred; Deliverables = the deferred work; `Origin: SDD ruling ratified at Review Console`; `Defer-reason:` = the staged file's own value), stage it as `staged/ledger-record-sdd-ruling-{N}.md`, route it through step 7 in the same pass, and once step 7 has created the record write the row `deferred`, Resolution `ratified → #{new record}`; when step 7 declines or fails, the row stays `open` with the cause logged — never `accepted`, never `deferred` without a record number.
  - `` `accept` `` (`Defers: no` with no `Defer-reason:` line) — today's write-back, unchanged: row `accepted`, `ratified at Review Console — {why clause…}`.
  - Under Approve all the deferral ratify's ledger flip goes through `finish-console`'s `ledger` array as `{status: "deferred", resolution: "ratified → #{n}"}` only once the record exists; outside Approve all it is written at step 7, never step 1.
  - Console-auto: a `file-record` ruling still resolves `apply` (reason `ratify files a deferral record …`), and its record is filed at step 7 like any `Q#`; a failed filing follows `refused-proposals.md`'s failed-execution rewrite.

- [x] **Step 1: Write the failing conformance test** — `tests/sdd-ruling-ratify-files-record-conformance.test.js`:
  - one `assertRatifyRule(appendixText)` function: for each `action` of `Object.values(SDD_RULING_RATIFY_ACTIONS)` (assert `length >= 2` floor first) the appendix contains `` `${action}` ``; it contains `ratified → #{new record}`, `staged/ledger-record-sdd-ruling-{N}.md`, and `never \`accepted\`, never \`deferred\` without a record number`.
  - `AC1.1 AC2.1 AC3.1: the appendix states the ratify-files-a-record rule for every SDD_RULING_RATIFY_ACTIONS member` → `assertRatifyRule(APPENDIX)`.
  - go-red controls (same `assertRatifyRule`, mutated input, `assert.throws`): appendix with `` `file-record` `` removed; appendix with `ratified → #{new record}` removed.
  - behavior link: `sddRulingRatifyAction` on the appendix's own deferral example header returns `'file-record'` — use header `Defers: yes\nDefer-reason: genuinely-larger\n`.
  - citation pins: `review-console.md`, `review-console-interactive.md`, `flow/multispec-review-console.md`, `_shared/console-execution.md`, `_shared/console-on-pr.md` each contain `ratified → #` (every console surface states the deferral ratify outcome or cites it); `console-execution.md` contains `--filing-failed` in the ruling paragraph's failed-ratify sentence.
- [x] **Step 2: Run to verify it fails** — Run: `node --test tests/sdd-ruling-ratify-files-record-conformance.test.js` Expected: FAIL.
- [x] **Step 3: Edit the six prose files** per the Interfaces block. Then re-point every existing pin: run `git grep -n -F -e 'ratify → \`accepted\`' -e 'Ticked, it is ratify' -e 'Approve all ratifies it' -e 'writes the item' -- tests plugin` (moved-prose pin check — phrase grep over `tests` and `plugin`) and update each hit in `tests/build-sdd-ledger-residue-carryforward.test.js` to the new sentences; record the grep output in the commit body. Measure `wc -c plugin/skills/flow/multispec-review-console.md` — must be < 52,500.
- [x] **Step 4: Run to verify** — Run: `node --test tests/sdd-ruling-ratify-files-record-conformance.test.js tests/build-sdd-ledger-residue-carryforward.test.js tests/build-sdd-ruling-deferral-gate.test.js` Expected: PASS. Then `npm test` (AC4.1) — full suite, output to a file, Expected: 0 failures.
- [x] **Step 5: Commit** — `git commit -m "State ratify-of-a-deferral files a record at every console surface — pinned to sddRulingRatifyAction, refs #3942"`.

---

## Amendment (2026-11-03, round 2): the three `sdd-ruling-unclassified` header shapes, and the plan-review amendments

The spec's AC6 (clause id **AC6.1**) settles the shapes the round-1 plan review asked about: several agreeing `Defers: no` lines with no `Defer-reason:` → `accept`; conflicting `Defers:` lines, a non-`yes`/`no` value, or a missing `Defers:` line → `file-record`; an empty staged ruling file → not ratifiable (`null`, row stays `open`). Task 4's `accept` rule and tests and Task 5's appendix `accept` sub-bullet are amended to match (amendment (e)). AC7 (plan review stops only for a gap contradicting an AC or a recorded decision) is a build-process rule satisfied by Common Step 1.6's routing in this run, not code. Round 1's three no-decision amendments are applied: (e) and (f) in Task 5's Interfaces, (g) `**Review risk:**` on Task 5. Moved-prose sweep for the `accept` sentence: `git grep -n -F -e 'with no `Defer-reason:` header line' -- tests plugin docs/journeys` hits the appendix's line 83 and the pin `tests/build-sdd-ruling-deferral-gate.test.js:46`, so amendment (e) adds to that sentence and never rewrites the pinned phrase; Task 5 Step 4 re-runs that test.

## Amendment (2026-11-03): Reading B — a human ratify of a gate-withheld deferral files the record

The spec's new Deliverables bullet and AC5 (clause ids below: **AC5.1** a human ratify — a tick, or Approve all at a human-present console — of each gate-withheld deferral case files one record and writes the row `deferred` with its number; **AC5.2** the same rows stay held, unfiled, under unattended console auto-resolution) split one category into two: *not auto-ratifiable* (`sddRulingDeferralReason` non-null → `rulingGateGaps` / `pending — sdd-ruling-*`, unchanged) and *not ratifiable* (`sddRulingRatifyAction` returns `null` — only a ruling with no readable text). Behavior-change prose sweep (`git grep -n -i -e 'not ratifiable' -e ungapped -e 'gapped ruling' -e ratifyAction -- plugin tests docs/journeys`): the hits are `sdd-ruling.js:66`, `console-execute.js:26,327`, `console-execution.md:59`, the two test files below, and `docs/journeys/ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md:41,69` (Common Step 6's `/claude-tweaks:journeys` owns that journey). `resolve.js:755-758` needs no change: its gap check returns `pending` before the `RATIFY_FILES_RECORD_REASON` line, so a widened `sddRulingRatifyAction` never reaches a gapped item there — Task 4 Step 4 re-runs `resolve.test.js` to prove AC5.2 holds.

### Task 4: `sddRulingRatifyAction` returns `file-record` for every readable deferral; gapped ruling rows carry it

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/console/sdd-ruling.js` (`sddRulingRatifyAction` + its comment, lines 66-74; the `SDD_RULING_RATIFY_ACTIONS` comment, lines 27-30)
- Modify: `plugin/bin/lib/reconcile/console-execute.js` (header comment lines 26-28; `decideConsoleExecute` ruling loop lines 322-345)
- Test: `tests/bin-lib/console/sdd-ruling-ratify.test.js`
- Test: `tests/console-execute.test.js` (the `#3942:` test at line 590)

**Interfaces:**
- Produces: `sddRulingRatifyAction(text) -> 'file-record' | 'accept' | null`. `null` only when the ruling is **not ratifiable**: `text` is `null`/`undefined`, or holds no non-whitespace character (nothing to compose a record from). `accept` only for a settled decision: the header (lines before the first blank line) has one or more `Defers:` lines, every one's value `no` (case-insensitive), and no `Defer-reason:` line — several agreeing `Defers: no` lines are the same settled decision as one (AC6, round-2 decision). Every other readable header returns `file-record` — the safe deferrals as before, and every gate-withheld case: `Defers: yes` with no reason, more than one reason, an invalid reason, no `Defers:` line, conflicting `Defers:` lines (`yes` and `no`), a `Defers:` value other than `yes`/`no`, and a single `Defer-reason: needs-human-decision`. It no longer consults `sddRulingDeferralReason`; it reuses `readHeader`. `SDD_RULING_RATIFY_ACTIONS` is unchanged (two members).
- Produces: `decideConsoleExecute`'s ready `items` — every `isRulingRow` item whose action is non-null carries `ratifyAction`, gapped or not. A row with a recorded read error (`ctx.rulingReadErrors`) carries none (that branch `continue`s first), nor does a row with no text in `ctx.rulingTexts`. `rulingGateGaps` is unchanged, entry for entry.

- [ ] **Step 1: Write the failing tests**
  - `sdd-ruling-ratify.test.js`: update the file comment (a withheld deferral is not auto-ratifiable, still ratifiable by a human; only unreadable text is not ratifiable). Replace the `not ratifiable: …` test with:
    - `AC5.1 AC5.2: every gate-withheld deferral header ratifies as file-record while the gate still holds it` — table-driven over `ruling('Defers: yes\n')`, `ruling('Defers: yes\nDefer-reason: tangential\nDefer-reason: genuinely-larger\n')`, `ruling('Defers: yes\nDefer-reason: minor\n')`, `ruling('')` (no `Defers:` line), `ruling('Defers: yes\nDefer-reason: needs-human-decision\n')`: for each, `sddRulingRatifyAction(t) === 'file-record'` AND `sddRulingDeferralReason(t) !== null` (import `sddRulingDeferralReason` from the same module) — Review Focus 6.
    - `AC6.1: several agreeing Defers: no lines with no Defer-reason ratify as accept, while the gate still holds them` — `ruling('Defers: no\nDefers: no\n')` and `ruling('Defers: no\ndefers: NO\n')` → `'accept'` AND `sddRulingDeferralReason(t) === 'sdd-ruling-unclassified'` (Review Focus 7).
    - `AC6.1: conflicting Defers: lines, an unknown Defers: value and a missing Defers: line ratify as file-record, never accept` — `ruling('Defers: yes\nDefers: no\n')`, `ruling('Defers: no\nDefers: yes\n')`, `ruling('Defers: maybe\n')`, `ruling('Defers: no\nDefers: maybe\n')`, `ruling('')` → `'file-record'` (discriminates `accept`'s "every `Defers:` value is `no`" guard in both orders and against a non-yes/no value).
    - `AC6.1: not ratifiable: null, undefined and an empty or blank ruling file return null` — `null`, `undefined`, `''`, `'  \n\t\n'` → `null`.
  - `console-execute.test.js`: rename the `#3942:` test to `AC5.1 AC5.2: decideConsoleExecute attaches ratifyAction to every readable ruling item, gapped ones included; rulingGateGaps unchanged (#3942)`. Items `r-yes`, `r-no`, `r-gap` (`RULING_TEXT_DEFERS_YES`), `r-nhd` (`RULING_TEXT_NEEDS_HUMAN`), `r-unread` (text `RULING_TEXT_DEFERS_YES_REASONED` in `rulingTexts` AND `rulingReadErrors: { 'r-unread': 'read-failed' }`), `r-absent` (no `rulingTexts` entry), `plain`. Assert `r-yes`/`r-gap`/`r-nhd` `ratifyAction === 'file-record'`, `r-no` `'accept'`, `!('ratifyAction' in …)` for `r-unread`, `r-absent`, `plain`; `rulingGateGaps` deepStrictEqual `[{ id: 'r-gap', reason: 'sdd-ruling-deferral-no-defer-reason' }, { id: 'r-nhd', reason: 'sdd-ruling-needs-human-decision' }, { id: 'r-unread', reason: 'sdd-ruling-unreadable', detail: 'read-failed' }, { id: 'r-absent', reason: 'sdd-ruling-unclassified' }]` (item order).
- [ ] **Step 2: Run to verify they fail** — Run: `node --test tests/bin-lib/console/sdd-ruling-ratify.test.js tests/console-execute.test.js` Expected: FAIL (the gate-withheld headers and the agreeing/conflicting `Defers:` headers return `null`; `r-gap`/`r-nhd` carry no `ratifyAction`).
- [ ] **Step 3: Implement** — `sddRulingRatifyAction`: return `null` for `null`/`undefined`/blank text; else `readHeader(text)`; `accept` when `defersMatches.length >= 1`, every match's value lowercases to `no`, and `reasons.length === 0`; else `file-record`. `sddRulingDeferralReason` is not changed (its `defersMatches.length > 1` → `UNCLASSIFIED` stays, so the unattended hold on agreeing `Defers: no` lines is untouched). Rewrite its comment and the `SDD_RULING_RATIFY_ACTIONS` comment to name the two categories (not auto-ratifiable = `sddRulingDeferralReason` non-null; not ratifiable = this function's `null`). `decideConsoleExecute`: compute `ratifyActions[item.id] = sddRulingRatifyAction(text)` for every ruling row that reaches the text branch, before/independent of the gap push (keep the gap push as is); keep the `ratifyAction ? { ratifyAction } : {}` spread. Update the two `#3942` comments in `console-execute.js` (header, loop) to say a gapped row carries its `ratifyAction` for a human tick and is still withheld from auto-ticking.
- [ ] **Step 4: Run to verify they pass** — same command, Expected: PASS. Then `node --test tests/bin-lib/console/resolve.test.js tests/resolve-console.test.js tests/hooks-resolve-console.test.js tests/build-sdd-ruling-deferral-gate.test.js tests/sdd-ruling-ratify-files-record-conformance.test.js` Expected: PASS (AC5.2: the console-auto `pending — sdd-ruling-*` tests are untouched and still green).
- [ ] **Step 5: Commit** — `git commit -m "Let a human ratify of a gate-withheld deferral ruling file its record — sddRulingRatifyAction separates not-auto-ratifiable from not-ratifiable, refs #3942"`.

### Task 5: Console prose — Reading B, AC6's header shapes, and the plan-review amendments

**Role:** judgment
**Review risk:** medium

**Files:**
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` (the `file-record` sub-bullet, lines 89-98; the console-auto paragraph, lines 121-138) — 18,607 B, far under `RAIL_BYTES` 52,500
- Modify: `plugin/skills/_shared/console-execution.md` (Execution routing ruling paragraph, lines 52-65; Write order outcome list, lines 97-99; Third narrower exception paragraph, lines 226-235) — 23,322 B
- Test: `tests/sdd-ruling-ratify-files-record-conformance.test.js`

**Interfaces:**
- Consumes: Task 4's `sddRulingRatifyAction` contract and `ratifyAction` on gapped rows.
- Appendix `file-record` sub-bullet: a deferral (`Defers: yes`, or any `Defer-reason:` header line) — and, when a human ratifies (a tick, or Approve all at a human-present console), every ruling the console-auto gate below withholds (no `Defer-reason:`, more than one, an invalid one, a missing or unclassifiable `Defers:` line, `needs-human-decision`): the sentence `a human ratify of a gate-withheld ruling files the record too`. Its `Defer-reason:` = the staged file's own `Defer-reason:` value when the header carries exactly one valid one (`` `needs-human-decision` included — the human's tick is the decision ``), else derived from `_shared/deferral-gate.md`'s Fix-now criteria exactly as `reverse` derives it below. Plus: a ruling whose staged file cannot be read (`sddRulingRatifyAction` returns `null`) is not ratifiable — nothing is filed or written, the row stays `open` with the cause logged.
- Appendix console-auto paragraph: keep `None is ever auto-ratified, and the reconciler's` `consoleAutoResolve` `path withholds the same rows (`_shared/console-execution.md`)` byte-for-byte (pinned by `tests/build-sdd-ruling-deferral-gate.test.js:50`), then add that not auto-ratifiable is not unratifiable (a human ratify of any of them but an unreadable one is a `file-record` ratify). Amendment (a): the failed-filing sentence becomes `a failed filing follows refused-proposals.md's failed-execution rewrite with {name} = the ruling item sdd-ruling-{N}.md` (backticked as code), `console.json`'s item, never the derived `ledger-record-sdd-ruling-{N}.md` proposal, so the row stays `open`.
- `console-execution.md` Execution routing ruling paragraph: a ruling row named in `rulingGateGaps` carries `ratifyAction: file-record` too (a human tick ratifies what the gate only withholds from auto-resolution); a ticked ruling with no `ratifyAction` (staged file unreadable — not ratifiable) is unexecutable — reported so, row stays `open`. Amendment (b): `A ticked deferral ruling whose record was refused or not created goes in resolve-console --filing-failed` (reply `filing failed — see decisions.md`, Resolve unticked, never `executed`), here and not only in the Live-session accelerator.
- Amendment (d): Write order list reads `plus dropped for a finding row and filing-failed for a finding or ruling row`.
- Third narrower exception: add `A withheld ruling row still carries its ratifyAction` (Execution routing above) — the exception stops only the auto-tick, never a human's. Keep every phrase `tests/build-sdd-ruling-deferral-gate.test.js:68-72` pins.
- Amendment (c), `**Review risk:** high` on Task 1, is applied in this plan's own text.
- Amendment (e), round 2 (appendix `accept` sub-bullet vs code): the `accept` sub-bullet (line 83) keeps `` `Defers: no` with no `Defer-reason:` header line `` byte-for-byte (pinned by `tests/build-sdd-ruling-deferral-gate.test.js:46`) and adds `` or several `Defers:` lines, every one `no`, with no `Defer-reason:` line `` — several agreeing `Defers: no` lines ratify as one does; the `file-record` sub-bullet's gate-withheld list names `conflicting `Defers:` lines (`yes` and `no`)` and `a `Defers:` value other than `yes`/`no``, matching Task 4's code.
- Amendment (f), round 2 (an unratifiable ticked ruling needs a channel): `console-execution.md`'s Execution routing ruling paragraph adds `A ticked ruling with no `ratifyAction` (its staged file empty or unreadable — not ratifiable) is unexecutable: name it in `resolve-console --filing-failed` with its cause logged as a `SKIP` line`, so its reply reads `filing failed — see decisions.md` and the row stays `open`. `resolveConsoleExecution` already accepts any `isRulingRow` id there (Task 2), so this is prose only; the appendix's not-ratifiable sentence cites it.
- Amendment (g), round 2: Task 5 carries `**Review risk:** medium` (applied above).

- [ ] **Step 1: Write the failing conformance tests** — in `tests/sdd-ruling-ratify-files-record-conformance.test.js`, import `sddRulingDeferralReason` too, and add:
  - `AC5.1: the appendix states a human ratify of a gate-withheld deferral files a record, carrying needs-human-decision` — `ws('a human ratify of a gate-withheld ruling files the record too')` and `` ws('`needs-human-decision` included — the human\'s tick is the decision') ``; and a go-red control: the same two-assertion function on the appendix with the first phrase removed `assert.throws`.
  - `AC5.1 AC5.2: the appendix's gate-withheld example header is file-record yet held` — `sddRulingRatifyAction('Ruling: x — why\nDefers: yes\n\nbody') === 'file-record'` and `sddRulingDeferralReason` of it `=== 'sdd-ruling-deferral-no-defer-reason'`.
  - `AC5.1: console-execution.md gives a gapped ruling row its ratifyAction` — `ws('A withheld ruling row still carries its `ratifyAction`')` in `console-execution.md`.
  - `AC3.1: console-execution.md's Execution routing sends a failed ratify filing to --filing-failed` — slice `console-execution.md` from `## Execution routing` to `## Write order after execution`; the slice matches `ws('A ticked deferral ruling whose record was refused or not created goes in `resolve-console --filing-failed`')`.
  - `AC3.1: the Write order outcome list names filing-failed for a ruling row` — `ws('filing-failed for a finding or ruling row')`.
  - `AC3.1: a console-auto failed ratify filing rewrites the ruling item, not the derived proposal` — appendix matches `ws("failed-execution rewrite with `{name}` = the ruling item `sdd-ruling-{N}.md`")`.
  - `AC6.1: the appendix accept sub-bullet names agreeing Defers: no lines, matching the code` — appendix matches `` ws('or several `Defers:` lines, every one `no`, with no `Defer-reason:` line') `` and `sddRulingRatifyAction('Ruling: x — why\nDefers: no\nDefers: no\n\nbody') === 'accept'`; go-red control: the same assertion function on the appendix with that phrase removed `assert.throws`.
  - `AC6.1: an unratifiable ticked ruling is routed to --filing-failed` — the Execution routing slice matches `` ws('A ticked ruling with no `ratifyAction`') `` and, within the same sentence, `` `resolve-console --filing-failed` ``.
- [ ] **Step 2: Run to verify it fails** — Run: `node --test tests/sdd-ruling-ratify-files-record-conformance.test.js` Expected: FAIL (the new phrases are absent).
- [ ] **Step 3: Edit the two prose files** per the Interfaces block. Moved-prose pin check: `git grep -n -F -e 'with a valid' -e 'a failed filing follows' -e 'dropped / filing-failed' -e 'None is ever auto-ratified' -e "the ready item's \`ratifyAction\`" -e 'withholds the same rows' -- tests plugin docs/journeys` — today the only test pin among the hits is `tests/build-sdd-ruling-deferral-gate.test.js:50` (kept byte-for-byte); re-run it after editing and update any new hit. Then `wc -c` both files — each must stay under 52,500.
- [ ] **Step 4: Run to verify** — Run: `node --test tests/sdd-ruling-ratify-files-record-conformance.test.js tests/build-sdd-ruling-deferral-gate.test.js tests/build-sdd-ledger-residue-carryforward.test.js` Expected: PASS. The full `npm test` (AC4.1) runs once at Common Step 5 through the verify runner, not here.
- [ ] **Step 5: Commit** — `git commit -m "State that a human ratify of a gate-withheld deferral files its record, and route a failed ratify filing — refs #3942"`.
