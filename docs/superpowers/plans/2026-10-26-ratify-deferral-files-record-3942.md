# Ratify-a-deferral-files-a-record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ratifying a deferral `sdd-ruling-*` item at any Review Console surface files the deferred work as a backlog record (ledger row `deferred`, `ratified → #{n}`), while ratifying a `Defers: no` ruling keeps today's `accepted` write-back.

**Architecture:** One pure code twin, `sddRulingRatifyAction(text)` in `plugin/bin/lib/console/sdd-ruling.js`, classifies a ruling's staged header as `file-record` (a safe deferral) or `accept` (a settled `Defers: no`), or `null` (not ratifiable — a gap). `console/resolve.js` names the `file-record` case in its `apply` reason; `reconcile/console-execute.js` forwards the action on each ready ruling item and lets `--filing-failed` name a ruling row whose ratify filing failed. The console prose (appendix, single-run, interactive, multi-spec, on-PR, console-execution) states the rule once in the appendix and cites it everywhere else.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-26T203040-record-3942/work/3942-spec.md` (record #3942)

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
5. A ruling item whose staged text shows a gap — `decideConsoleExecute` must not attach a `ratifyAction` to it (it is withheld, not ratified). Pinned in Task 2.

---

### Task 1: `sddRulingRatifyAction` code twin + resolve.js reason

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/console/sdd-ruling.js`
- Modify: `plugin/bin/lib/console/resolve.js` (re-export; reason on a `file-record` ruling's `apply`)
- Test: `tests/bin-lib/console/sdd-ruling-ratify.test.js` (create)
- Test: `tests/bin-lib/console/resolve.test.js` (add one test near line 1226's `defers-yes-valid-reason-resolves-apply`)

**Interfaces:**
- Produces: `SDD_RULING_RATIFY_ACTIONS = Object.freeze({ FILE_RECORD: 'file-record', ACCEPT: 'accept' })` and `sddRulingRatifyAction(text: string|null|undefined) -> 'file-record' | 'accept' | null`, both exported from `sdd-ruling.js` and re-exported from `resolve.js`. Returns `null` whenever `sddRulingDeferralReason(text)` is non-null; otherwise `file-record` when the header has `Defers: yes` or any `Defer-reason:` line, else `accept`.
- Produces: `resolveAll`'s item for a `file-record` ruling keeps `resolution: 'apply'` and carries `reason: RATIFY_FILES_RECORD_REASON` = `'ratify files a deferral record (Defer-reason carried) — ledger row deferred once it exists'` (exported const from `resolve.js`).

- [ ] **Step 1: Write the failing tests** — `tests/bin-lib/console/sdd-ruling-ratify.test.js`:
  - `AC1.1: Defers: yes + one valid Defer-reason ratifies as file-record` → `sddRulingRatifyAction('Ruling: x — why\nDefers: yes\nDefer-reason: genuinely-larger\n\nbody')` === `'file-record'`
  - `AC1.1: a Defer-reason line alone (no Defers:) ratifies as file-record` → header `Defer-reason: tangential` → `'file-record'`
  - `Defers: no plus a valid Defer-reason is a deferral` → `'file-record'` (Review Focus 1)
  - `AC2.1: Defers: no with no Defer-reason ratifies as accept` → `'accept'`
  - `not ratifiable: no-reason deferral, unclassified, null text all return null` → `Defers: yes\n` → null; `Ruling: x\n` → null; `null` → null; `Defers: yes\nDefer-reason: minor\n` → null (Review Focus 2)
  - `SDD_RULING_RATIFY_ACTIONS is frozen with exactly file-record and accept` → `deepStrictEqual(Object.values(...).sort(), ['accept','file-record'])`, `Object.isFrozen`.
  - In `resolve.test.js`: `defers-yes-valid-reason-names-file-record: a deferral ruling resolves apply with the file-record reason (#3942)` → `resolveStaged('sdd-ruling-1.md', RULING('Defers: yes\nDefer-reason: needs-human-decision\n'))` has `resolution: 'apply'`, `reason: RATIFY_FILES_RECORD_REASON`; and the `Defers: no\n` ruling's reason is NOT `RATIFY_FILES_RECORD_REASON`.
- [ ] **Step 2: Run to verify they fail** — Run: `node --test tests/bin-lib/console/sdd-ruling-ratify.test.js tests/bin-lib/console/resolve.test.js` Expected: FAIL (`sddRulingRatifyAction is not a function`).
- [ ] **Step 3: Implement** both exports in `sdd-ruling.js` (reuse the header parse — factor the header-line split into a local helper both functions call; do not duplicate the regexes), update its header comment's prose-twin line to name the appendix's ratify sentence too. In `resolve.js` line ~582, after the gap check, set the `file-record` reason on the returned `apply` item (the `settledFileResolution` and patch branches are unaffected — a ruling is never a `.patch`).
- [ ] **Step 4: Run to verify they pass** — same command, Expected: PASS.
- [ ] **Step 5: Commit** — `git add` the four files; `git commit -m "Add sddRulingRatifyAction code twin — ratify of a deferral ruling files a record, refs #3942"`.

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

- [ ] **Step 1: Write the failing tests**
  - `console-execute.test.js`: `#3942: decideConsoleExecute attaches ratifyAction to each ungapped ruling item, none to a gapped one` — ruling items `r-yes` (text `Defers: yes\nDefer-reason: genuinely-larger\n`), `r-no` (`Defers: no\n`), `r-gap` (`Defers: yes\n`) via `ctx.rulingTexts`; assert `items` find by id: `r-yes.ratifyAction === 'file-record'`, `r-no.ratifyAction === 'accept'`, `!('ratifyAction' in r-gap)` (Review Focus 5); `rulingGateGaps` unchanged (`[{ id: 'r-gap', reason: 'sdd-ruling-deferral-no-defer-reason' }]`).
  - `resolve-console.test.js` (use existing `runRuling`/`RULING_ITEMS` helpers): `AC3.1: a ticked ruling named in filingFailed reads filing-failed, uncleared, Resolve unticked (#3942)` — approve `['1','r1']`, filingFailed `['r1']` → `r1.outcome === 'filing-failed'`, `r1.note === FILING_FAILED_NOTE`, `result.resolved === false`, reply body includes `` `r1`: filing failed — see decisions.md `` (Review Focus 3); `an id in both reverseFailed and filingFailed is rejected as conflicting-failure-ids before any write` — no `gh` call recorded, `writeFile` not called (Review Focus 4); `console.json persists a ruling's filing-failed outcome` → written item `r1.outcome === 'filing-failed'`.
  - Existing `an id without findingItem in filingFailed is rejected as not-finding-items` must keep passing (its item is neither finding nor ruling) — re-read it and confirm its fixture item lacks `isRulingRow`.
  - `hooks-resolve-console.test.js`: update the `not-finding-items` message assertion to `/--filing-failed id\(s\) 1 are neither finding rows nor sdd-ruling rows/`.
- [ ] **Step 2: Run to verify they fail** — Run: `node --test tests/console-execute.test.js tests/resolve-console.test.js tests/hooks-resolve-console.test.js` Expected: FAIL on the new tests.
- [ ] **Step 3: Implement** — in `decideConsoleExecute`, compute the ruling gaps first, then build `resolvedItems` so an ungapped ruling item gets `ratifyAction: sddRulingRatifyAction(text)` (only when non-null). In `resolveConsoleExecution`, widen the `filingFailed` validation set to finding ∪ ruling ids, add the conflict check right after it, and add a ruling `filing-failed` branch next to the `reverse-failed` one (before the executed branch). Update the header comment and the outcome-comment block. In `hooks.js`, rename the `not-finding-items` message and add the `conflicting-failure-ids` message (`claude-tweaks: id(s) {ids} named in both --reverse-failed and --filing-failed, console not resolved`); update the `resolve-console` usage string only if a flag changes (it does not).
- [ ] **Step 4: Run to verify they pass** — same command, Expected: PASS; also `node --test tests/bin-lib/console/residue.test.js` PASS (a ruling `filing-failed` is already residue via `FAILED_OUTCOMES`).
- [ ] **Step 4b: finish-console backstop (AC3.1, the Approve-all writer)** — in `plugin/bin/wrap-up-engine.js`'s `validateFinishConsolePayload`, reject a ledger entry with `status: 'deferred'` whose resolution starts with `ratified` (case-insensitive, after trim) and carries no `#\d+` record reference: message `ledger[${i}]: a ratified deferral needs its record number (ratified → #{n}) — leave the row open when the record was not created`. Tests in `tests/bin-lib/wrap-up/finish-console-cli.test.js`: `AC3.1: finish-console rejects a deferred "ratified" ledger entry with no record number before any write (#3942)` (exit 1, ledger file unchanged, no `verify-expectations.json`) and `AC1.1: finish-console accepts deferred "ratified → #4501"` (row flipped). Run: `node --test tests/bin-lib/wrap-up/finish-console-cli.test.js` Expected: FAIL before, PASS after.
- [ ] **Step 5: Commit** — `git commit -m "Forward ratifyAction on ruling rows and let --filing-failed name a failed ratify filing, refs #3942"`.

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

- [ ] **Step 1: Write the failing conformance test** — `tests/sdd-ruling-ratify-files-record-conformance.test.js`:
  - one `assertRatifyRule(appendixText)` function: for each `action` of `Object.values(SDD_RULING_RATIFY_ACTIONS)` (assert `length >= 2` floor first) the appendix contains `` `${action}` ``; it contains `ratified → #{new record}`, `staged/ledger-record-sdd-ruling-{N}.md`, and `never \`accepted\`, never \`deferred\` without a record number`.
  - `AC1.1 AC2.1 AC3.1: the appendix states the ratify-files-a-record rule for every SDD_RULING_RATIFY_ACTIONS member` → `assertRatifyRule(APPENDIX)`.
  - go-red controls (same `assertRatifyRule`, mutated input, `assert.throws`): appendix with `` `file-record` `` removed; appendix with `ratified → #{new record}` removed.
  - behavior link: `sddRulingRatifyAction` on the appendix's own deferral example header returns `'file-record'` — use header `Defers: yes\nDefer-reason: genuinely-larger\n`.
  - citation pins: `review-console.md`, `review-console-interactive.md`, `flow/multispec-review-console.md`, `_shared/console-execution.md`, `_shared/console-on-pr.md` each contain `ratified → #` (every console surface states the deferral ratify outcome or cites it); `console-execution.md` contains `--filing-failed` in the ruling paragraph's failed-ratify sentence.
- [ ] **Step 2: Run to verify it fails** — Run: `node --test tests/sdd-ruling-ratify-files-record-conformance.test.js` Expected: FAIL.
- [ ] **Step 3: Edit the six prose files** per the Interfaces block. Then re-point every existing pin: run `git grep -n -F -e 'ratify → \`accepted\`' -e 'Ticked, it is ratify' -e 'Approve all ratifies it' -e 'writes the item' -- tests plugin` (moved-prose pin check — phrase grep over `tests` and `plugin`) and update each hit in `tests/build-sdd-ledger-residue-carryforward.test.js` to the new sentences; record the grep output in the commit body. Measure `wc -c plugin/skills/flow/multispec-review-console.md` — must be < 52,500.
- [ ] **Step 4: Run to verify** — Run: `node --test tests/sdd-ruling-ratify-files-record-conformance.test.js tests/build-sdd-ledger-residue-carryforward.test.js tests/build-sdd-ruling-deferral-gate.test.js` Expected: PASS. Then `npm test` (AC4.1) — full suite, output to a file, Expected: 0 failures.
- [ ] **Step 5: Commit** — `git commit -m "State ratify-of-a-deferral files a record at every console surface — pinned to sddRulingRatifyAction, refs #3942"`.
