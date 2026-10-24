# Console Final Outcomes Implementation Plan (#3949)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Review Console finding item reaches a final outcome: tiebreak verdicts supersede their earlier STAGED lines, can't-tell findings resolve to their recommendation (`filed` / `dropped`), at `unattended` every can't-tell finding is filed as a fingerprint-deduplicated backlog record, high/critical refuted drops render in a read-only block, and an unacknowledged unresolved item blocks archival.

**Architecture:** `plugin/bin/lib/console/resolve.js` gains a tiebreak-verdict reader: it parses the resolver's (`plugin/bin/lib/tiebreak.js`) four log-line shapes from `decisions.md`, keys them with the existing #3772 `findingKey` (lens + path:line), supersedes the earlier STAGED lines (and the staged `review-unconfirmed-*`/`review-contested-*`/`review-debate-*` files those lines name), and emits one console item per can't-tell (`console`) verdict. A new pure module `plugin/bin/lib/console/finding-filing.js` composes the fingerprinted Queue-writes proposal for a filed item; a new CLI `plugin/bin/console-filings.js` dedups those proposals against an existing-record list (`--state all`) and writes the new ones for the skill's existing queue-write step to create. `plugin/bin/lib/reconcile/archive-merged.js`'s `readConsoleState` gains a `residue` state that refuses archival.

**Tech Stack:** Node 18+, `node --test`, markdown skill files.

**Spec:** `.claude-tweaks/pipelines/2026-10-23T213805-spec-3946-3949-3816-3950/spec-3949/work/3949-spec.md` (worktree copy). Issue #3949 comment scope additions: (1) a contested finding the tiebreak confirms no longer appears in the Contested section, including its `staged/review-contested-{N}.md`; (2) refuted drops' severity feeds the "Dropped by tiebreak" block.

## Global Constraints

- `UNRESOLVED_RESOLUTIONS` in `plugin/bin/lib/console/residue.js` stays `new Set(['pending', 'keep-staged'])` — unchanged.
- `console.json` is expand-contract: new fields (`droppedByTiebreak`, `filings`) and the new resolution value `dropped` are additive; never rewrite or reinterpret an existing `keep-staged` item.
- A STAGED line with no tiebreak verdict (the legacy shape) keeps today's `keep-staged` emission, unchanged.
- Filing labels come from the existing `needs:*` vocabulary: `needs:definition` (listed by `/claude-tweaks:backlog attention`, no comment required). Never add or remove any `auto:*` or `bot:*` label.
- `Defer-reason: needs-human-decision` (in `record.js`'s `DEFER_REASONS`).
- Fingerprint: `fingerprintFromBasis('consolefinding', [lens.trim().toLowerCase(), path.trim(), normalizeText(claim)])` from `plugin/bin/lib/health-core/fingerprint.js` — no line number.
- `console-resolve.js` and `console-filings.js` never call `gh` and never contain `AskUserQuestion`.
- Commits: `{Verb} {what} — {detail}` subject, body `refs #3949`, never "closes"; trailer `Claude-Session: https://claude.ai/code/session_01Xwnc1AGrBrRsCwDeFcbc4R`.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.

## Review Focus

- A tiebreak console line whose path contains `debate`/`unconfirmed`/`contested` (e.g. `plugin/skills/review/step3-debate-and-refutation.md`) must classify by its tiebreak shape, never by the keyword regex — Task 2 test `tiebreak lines are read by shape, not by keyword`.
- A drop line with no `Severity:` (or a malformed value) renders no Dropped-block row and never throws — Task 3 test `a malformed drop line renders no block`.
- A `findings {path}:{a} / {path}:{b}` nearLocation STAGED line is superseded only when both keys have a verdict — Task 2 test `a two-finding coincidence line needs both verdicts`.
- A `review-findings.json` that is absent or malformed still yields a fileable proposal (claim falls back to `tiebreak:{id}`) and never throws — Task 4 test `missing findings artifact falls back to the tiebreak id`.
- An acknowledged (`residueAcknowledgedAt`) console never blocks archival, and an unreadable spec console fails closed — Task 6 tests.

## AC coverage

| Clause | Task |
|---|---|
| AC1.1 | Task 2 (Approve-all) + Task 4 (unattended) |
| AC2.1 | Task 2 |
| AC2.2 | Task 2 (emission) + Task 6 (archive) |
| AC3.1 | Task 6 |
| AC4.1 | Task 3 |
| AC4.2 | Task 3 |
| AC4.3 | Task 3 |
| AC4.4 | Task 3 (resolver) + Task 7 (template) |
| AC5.1 | Task 4 |
| AC5.2 | Task 5 |
| AC5.3 | Task 5 |
| AC6.1 | Task 6 |
| AC6.2 | Task 6 |
| AC7.1 | Task 7 |
| AC8.1 | Task 1 |
| AC8.2 | Task 1 |
| AC9.1 | Task 8 |

`plugin/skills/flow/multispec-review-console.md` is within 10% of the rail (3249 bytes of headroom): its Task 7 edit is a one-line citation of `console-template.md`, nothing restated.

---

### Task 1: Auto-mode contract amendment

**Files:**
- Modify: `plugin/skills/_shared/auto-mode-contract.md` (section "Reversibility / confidence floors; severity ceiling", after the floors table and its "When any floor fails" sentence)
- Test: `tests/auto-mode-contract-tiebreak-drop-conformance.test.js` (create)

**Interfaces:** Produces the heading `### Tiebreak-refuted drop (one-decision amendment)` that Task 7 cites.

- [ ] **Step 1: Write the failing conformance test** — reads the contract, slices the `### Tiebreak-refuted drop (one-decision amendment)` subsection (heading to next `##`/`###`), asserts it: matches `/outcome `drop`/`, names each of `` `auto` ``, `` `confirm` ``, `` `hybrid` ``, `` `interactive` ``, matches `/Confidence `high`/i` and `/exempt from the (findings )?severity ceiling/i`, matches `/does not loosen the (severity )?ceiling for applying fixes/i`, and matches `/can't-tell/` together with `/never dropped/i`.
- [ ] **Step 2: Run** `node --test tests/auto-mode-contract-tiebreak-drop-conformance.test.js` — Expected: FAIL (subsection not found).
- [ ] **Step 3: Write the subsection** — one short paragraph: dropping a finding counts as Confidence `high` and is exempt from the findings severity ceiling at every severity, in every mode (`auto`, `confirm`, `hybrid`, `interactive`), only when `plugin/bin/lib/tiebreak.js`'s `resolveTiebreak` returned outcome `drop` (a refutation with evidence verified against the file) — the agent's claim alone never qualifies; a refutation the resolver turned into can't-tell is not exempt and is never dropped. It does not loosen the ceiling for applying fixes and does not cover dropping a can't-tell item. Low and medium drops stay auditable through their `AUTO … dropped` lines in `decisions.md`; high and critical ones also render in the Review Console's read-only "Dropped by tiebreak" block.
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `Amend the auto-mode contract for tiebreak-refuted drops — one decision, every mode, fixes ceiling unchanged`.

### Task 2: Tiebreak verdicts settle console findings in resolve.js

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` (`SECTION_STANCES` LOW/CONTESTED reasons, `readSnapshot`, `stagedItems`, `coordinationItems`, `findingKey`, exports)
- Test: `tests/bin-lib/console/resolve.test.js`

**Interfaces:**
- Produces `parseTiebreakLine(line) -> null | { kind: 'confirmed'|'dropped'|'digested'|'console', id: string|null, key: string|null, severity: string|null, recommendation: 'file'|'drop'|null, reason: string|null, evidence: string|null }` — `id` from `tiebreak:([0-9a-f]{12})`; `key` via `findingKey`; `severity` from `Severity: (critical|high|medium|low|info)\.`; `recommendation` from `Recommendation: (file|drop)\.` (`none` → null); `reason` is the text between `console: `/`digested: ` and `. Severity:`; `evidence` is the `Evidence: …` clause of a drop line. Shapes (from `tiebreak.js` `resolveTiebreak`): `- STAGED t — Tiebreak tiebreak:{id}: … console: {reason}. Severity: {s}. Recommendation: {r}.`, `- AUTO t — Tiebreak tiebreak:{id}: … digested: …`, `- AUTO t — Tiebreak tiebreak:{id}: … dropped: refuted by tiebreak. Evidence: … Severity: {s}.`, `- AUTO t — Reproduction: … confirmed by tiebreak:{id}. Confirmed.`
- Produces `approveAllDefault(recommendation) -> 'filed' | 'dropped'` — `'drop'` → `'dropped'`; `'file'` and null → `'filed'` (an agent that could not tell is not licensed to drop).
- Produces on each tiebreak console item: `{ id: 'tiebreak:{id}' | staged filename, section, resolution, reason, tiebreak: { id, key, lens, path, line, severity, recommendation, reason } }`.
- Produces `readSnapshot(...).findings` — the parsed `review-findings.json` array, or `[]` when absent/unparseable/not an array (read via `deps.readFile`, never `fs`).

Rules (`coordinationItems` + `stagedItems`):
1. Read every tiebreak line first (`parseTiebreakLine` before the `low-confidence|…|contested|debate` keyword regexes) — a tiebreak line is never itself classified by keyword. A key is **settled** by its latest tiebreak line.
2. An earlier STAGED line is superseded (no item) when every one of its keys is settled by a later tiebreak line. Its keys: `findingKey(line)`, plus the second location of a `findings {path}:{a} / {path}:{b}` coincidence line (same lens). The existing `Confirmed` supersession (#3772) is this rule's `confirmed` case — keep its tests green.
3. A staged `review-unconfirmed-*`/`review-contested-*`/`review-debate-*` file is linked to the keys of the STAGED line(s) that name it (`staged/{name}`). When all its keys are settled it resolves finally instead of `keep-staged`: confirmed → `dismissed` ("superseded — tiebreak confirmed it; routed through Step 3 Routing"); dropped → `dropped` ("refuted by tiebreak"); digested → `dismissed` ("can't-tell below medium — logged to the materiality digest"); console → `approveAllDefault(recommendation)` with the item's `tiebreak` field. Unlinked or unsettled files keep `keep-staged`.
4. A `console` verdict whose key no linked staged file carries becomes one item `tiebreak:{id}` in Contested findings when any superseded earlier line for that key classified Contested, else Low-confidence findings; resolution `approveAllDefault(recommendation)`.
5. Legacy shape unchanged: a Low/Contested STAGED line or staged file with no tiebreak verdict → `keep-staged`, reason `SECTION_STANCES[section].reason`. Reword those two reasons to say the item has no tiebreak recommendation (legacy shape) and is never auto-applied.

- [ ] **Step 1: Write failing tests** (build verdict lines through `resolveTiebreak` + `formatEntry`, as the existing `a tiebreak confirmed line supersedes…` test does):
  - `approve-all: a console verdict with Recommendation file resolves filed, drop resolves dropped (#3949 AC2)` — one Low item each, ids `tiebreak:{id}`, earlier STAGED lines absent from items.
  - `a console verdict with Recommendation none resolves filed, never dropped (#3949)`.
  - `a legacy STAGED line with no verdict stays keep-staged and is in unresolvedItems (#3949 AC2)`.
  - `a refuted drop supersedes the earlier STAGED line (#3949 AC1)` — replace the existing assertion `'a drop line never supersedes'` (in `a tiebreak confirmed line supersedes the real-emitter STAGED line`) with `lowItems(...).length === 0`: that assertion pinned pre-#3949 behavior the spec retires.
  - `a digested verdict supersedes the earlier STAGED line (#3949 AC1)`.
  - `a confirmed contested finding no longer appears in Contested — its staged review-contested file resolves dismissed (#3949 comment 1)` — STAGED `Debate: lens "3a" cross-lens disagreement on src/a.js:9 inconclusive (…). Both verdicts staged. Stage path: staged/review-contested-1.md.` + confirmed line → zero items with resolution `keep-staged`, the file item resolves `dismissed`.
  - `a console verdict on a contested finding takes the Contested section (#3949)`.
  - `tiebreak lines are read by shape, not by keyword` — finding path `plugin/skills/review/step3-debate-and-refutation.md`, console verdict → exactly one item, Low-confidence.
  - `a two-finding coincidence line needs both verdicts` — one verdict → line stays `keep-staged`; both → superseded.
  - `AC1: every tiebreak outcome together leaves zero keep-staged and zero pending (#3949)` — confirmed, refuted low, refuted high, digest, console file, console drop — assert no item resolution in `['pending', 'keep-staged']` (this test passes after Task 4's unattended override too; here assert at the Approve-all defaults).
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/resolve.test.js` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the rules above; export `parseTiebreakLine` and `approveAllDefault`. Read `review-findings.json` in `readSnapshot` (one read, like `engine-state.json`).
- [ ] **Step 4: Run** `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/console/residue.test.js tests/bin-lib/console/cli.test.js tests/bin-lib/tiebreak.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `Settle Review Console findings from their tiebreak verdicts — supersession, Approve-all default, contested files`.

### Task 3: Dropped-by-tiebreak block

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` (`resolveAll`, `renderRows`, `renderStoredTable`)
- Modify: `plugin/bin/console-resolve.js` (`console.json` write, `nothingToRevert`)
- Test: `tests/bin-lib/console/resolve.test.js`, `tests/bin-lib/console/cli.test.js`

**Interfaces:**
- Consumes `parseTiebreakLine` (Task 2).
- Produces `resolveAll(...).droppedByTiebreak: Array<{ id, lens, path, line, severity, evidence }>` — every `dropped` line whose severity is `high` or `critical`, in log order; a drop line whose severity is missing or not one of the five values is omitted.
- `renderRows` gains `dropped` (array, default `[]`): when non-empty, after the Merge line, `#### Dropped by tiebreak (read-only — no decision)` and a `| Path:Line | Lens | Severity | Evidence |` table (cells through `cell()`); no `#` column, no `AUTO-RESOLVED` stamp, no console item. Empty → nothing rendered.
- `console.json` gains `droppedByTiebreak` (always written, `[]` when none); `renderStoredTable` renders it when present.
- `console-resolve.js`'s `nothingToRevert` gains `'dropped'`.

- [ ] **Step 1: Write failing tests**: `AC4: a high and a critical refuted drop render in the read-only block with no decision row`; `AC4: low and medium refuted drops do not appear in the console at all`; `a malformed drop line renders no block`; in `cli.test.js`: `console.json records droppedByTiebreak and a re-render shows the block (#3949 AC4)`.
- [ ] **Step 2: Run** the two files — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Render refuted high and critical drops in a read-only console block — no item, no decision`.

### Task 4: Unattended filing plan

**Files:**
- Create: `plugin/bin/lib/console/finding-filing.js`
- Modify: `plugin/bin/lib/console/resolve.js` (`resolveAll`)
- Modify: `plugin/bin/console-resolve.js` (`console.json`, `--json` output)
- Test: `tests/bin-lib/console/finding-filing.test.js` (create), `tests/bin-lib/console/resolve.test.js`

**Interfaces:**
- Consumes the items' `tiebreak` field (Task 2) and `snapshot.findings`.
- Produces `findingFingerprint({ lens, path, claim }) -> string` (Global Constraints basis; prefix `consolefinding`).
- Produces `composeFindingProposal({ item, finding, runId }) -> { fingerprint, title, proposal }` — `finding` is the `review-findings.json` entry whose `id` equals `item.tiebreak.id`, or null; with no finding the claim is `tiebreak:{id}`. `title`: `Review finding (can't-tell): {path} — {claim, cut to 80 chars}`. `proposal`: the `Title:`/`Type: task`/`Labels: needs:definition`/`Defer-reason: needs-human-decision` header + `specShapedBody` body (open-question variant) built the way `plugin/bin/lib/console/shadow-dup-proposal.js` builds its own (via `recordPayload` with `fingerprint`, so the body ends with the `work-fingerprint` marker pair). Current State carries the claim, `{path}:{line}`, lens, severity, the tiebreak outcome `can't-tell ({reason})` and `Recommendation: {file|drop|none}`, and the run id; Deliverables: decide whether the finding holds and fix it or close the record; open question: "Does this finding hold at `{path}:{line}`?"; `filedBy: 'review-console'`.
- Produces `planFilings({ items, findings, runId }) -> Array<{ item: string, fingerprint, title, proposal }>` — one per item whose resolution is `filed` and that carries `tiebreak`, deduplicated by fingerprint within the batch.
- `resolveAll` (always `console-auto` = unattended): every item carrying `tiebreak` resolves `filed`, regardless of recommendation, with reason "unattended: can't-tell finding filed as a backlog record — an agent that could not tell is not licensed to drop"; result gains `filings: planFilings(...)`. `console.json` gains `filings` as `[{ item, fingerprint, title }]` (no proposal text); `--json` prints the same.

- [ ] **Step 1: Write failing tests**: in `finding-filing.test.js` — `the fingerprint ignores the line and whitespace/case in the claim`; `different lens or path gives a different fingerprint`; `a proposal carries the header, needs:definition, the tiebreak reason and recommendation, and the work-fingerprint marker` (assert via `extractFingerprint(proposal) === fingerprint`); `missing findings artifact falls back to the tiebreak id`; `planFilings deduplicates two items with one fingerprint`. In `resolve.test.js` — `AC5: at unattended N can't-tell items including a drop recommendation plan exactly N filings` and `AC1 at unattended: every outcome fixture resolves with zero pending and zero keep-staged`.
- [ ] **Step 2: Run** both files — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test tests/bin-lib/console/` — Expected: PASS.
- [ ] **Step 5: Commit** `Plan a fingerprinted backlog filing for every can't-tell finding at unattended`.

### Task 5: console-filings.js — dedup and write the proposals

**Files:**
- Create: `plugin/bin/console-filings.js`
- Modify: `docs/plugin-structure.md` (CLI list — one row, beside `shadow-dup-proposal.js`)
- Test: `tests/bin-lib/console/console-filings-cli.test.js` (create)

**Interfaces:**
- Consumes `readSnapshot`, `stagedItems`/`coordinationItems` results through an exported `findingItems({ runDir, deps })` you add to `resolve.js` (the Task 2 items carrying `tiebreak`, with resolutions untouched — no merge, grants, or patch reads), and `planFilings` (Task 4), and `extractFingerprint`/`checkFingerprint`/`recordFingerprint` from `plugin/bin/lib/issues/record.js`.
- Produces CLI: `node bin/console-filings.js --run <run-dir> --existing <issues.json> --out-dir <dir> [--only <item,...>] [--help]`. `--existing` is a JSON array of `{ number, body }` (the `gh issue list --state all --json number,body --limit N` output). Default selection: every item carrying `tiebreak` (the unattended rule); `--only` narrows to the named item ids (the interactive Approve-all/Override selection). Builds the fingerprint map from `--existing` (`extractFingerprint` per body), skips a planned filing whose fingerprint `checkFingerprint` finds, writes each remaining proposal to `{out-dir}/console-filing-{n}.md`, prints JSON `{ file: [{ item, fingerprint, title, proposal: <path> }], deduped: [{ item, fingerprint, number }] }`. Exit 0 ok; 2 malformed invocation or unparseable `--existing`; 3 run dir missing / not anchored (`resolveTarget`, as `shadow-dup-proposal.js`), or `--out-dir` unwritable. Never calls `gh`.

- [ ] **Step 1: Write failing tests**: `AC5: N can't-tell items with an empty record map write N proposals`; `AC5: a re-run with the created records in --existing writes zero`; `AC5: the same finding at a different line in a later run is deduplicated`; `AC5: a closed record still deduplicates` (the `--existing` entry carries `state: 'CLOSED'`); `--only narrows the selection`; `exit 2 on unparseable --existing`; `exit 3 on a worktree-local run dir`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/console-filings-cli.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement**, following `plugin/bin/shadow-dup-proposal.js`'s header-comment, `parseArgs`, deps-injection, and exit-code conventions.
- [ ] **Step 4: Run** the file — Expected: PASS. Also run any test that enumerates `plugin/bin/*.js` (grep `tests/` for `readdirSync(` over `plugin/bin`) and fix what it requires.
- [ ] **Step 5: Commit** `Add console-filings.js — dedup can't-tell filings against every record and write their proposals`.

### Task 6: Residue blocks archival

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`readConsoleState`, `decideArchiveCore`, the clean-sweep site near `skipped.push({ runDir: dir, reason: 'console-unresolved' })`)
- Modify: `plugin/bin/hooks.js` (`archive-run` verb, after its `console-unresolved` refusal)
- Test: `tests/archive-run-verb.test.js`, the `decideArchive` suite under `tests/bin-lib/reconcile/` (locate with grep), `tests/bin-lib/console/residue.test.js`

**Interfaces:**
- Consumes `readRunResidue` from `plugin/bin/lib/console/residue.js`.
- `readConsoleState(runDir)` returns `'residue'` when the top-level state would be `'resolved'` or `'none'` and `readRunResidue(runDir)` reports any console with `acknowledged === false`, or any `unreadable` entry (fail closed). `'unresolved'` keeps precedence.
- Every site that skips on `'unresolved'` also skips on `'residue'` with reason `console-residue`; the `archive-run` verb prints `claude-tweaks: archival refused — console-residue ({n} unresolved item(s) no human has reviewed; review them, then run console-residue.js --ack --run "{runDir}")`.

- [ ] **Step 1: Write failing tests**: `AC6: a resolved console holding a keep-staged item refuses archival (console-residue)` (archive-run verb and `decideArchiveCore`, unconditional); `AC2: a resolved console holding a pending item refuses archival`; `an acknowledged console archives`; `a spec-N console with residue refuses archival`; `an unreadable spec console refuses archival`; `AC6: console-resolve.js below unattended exits 4 and writes no console.json`; in `residue.test.js`: `AC3: a legacy console.json keep-staged item still counts in readRunResidue and scanUnresolvedConsoles`.
- [ ] **Step 2: Run** the touched files — Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Existing tests that pin a resolved-with-residue console archiving encode the behavior AC2/AC6 retire: update each to expect `console-residue`, and list them in the commit body.
- [ ] **Step 4: Run** `node --test tests/archive-run-verb.test.js tests/bin-lib/reconcile/ tests/bin-lib/console/ tests/bin-lib/hooks/` — Expected: PASS.
- [ ] **Step 5: Commit** `Refuse archival while a console holds unacknowledged unresolved items — console-residue`.

### Task 7: Skill prose and conformance

**Files:**
- Modify: `plugin/skills/wrap-up/review-console.md` (Auto-resolution short-circuit: after console-resolve.js, run `console-filings.js` and file each written proposal through "On approval" step 7, logging deduped ones as `AUTO … Queue write: {item} already filed as #{n} (work-fingerprint {fp}).`; step 7: a Low-confidence/Contested `filed` item's proposal comes from `console-filings.js --only`)
- Modify: `plugin/skills/wrap-up/console-template.md` (Low-confidence and Contested sections: Severity + Recommendation columns, the Approve-all default = recommendation wording, a legacy no-recommendation row stays undecided; new read-only `#### Dropped by tiebreak` block)
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` (Resolution-to-step mapping: `dropped` executes nothing; `filed` on a Low-confidence/Contested item → step 7 via `console-filings.js`; `dismissed` also covers a tiebreak-superseded finding file; `console.json` gains `droppedByTiebreak`, `filings`)
- Modify: `plugin/skills/wrap-up/review-console-interactive.md` (Approve-all default for the two sections)
- Modify: `plugin/skills/_shared/autonomy-ceiling.md` (`consoleAutoResolve` row: files every can't-tell item of medium+ through the queue-write path, deduplicated by `work-fingerprint`)
- Modify: `plugin/skills/_shared/materiality-floor.md` (one line: the console's finding fingerprint reuses `fingerprintFromBasis`, prefix `consolefinding`)
- Modify: `plugin/skills/review/step3-tiebreak.md` (step 4 `console` bullet and the paragraph after it: drop "until the console sub-issue lands"; state that verdicts supersede earlier lines and linked staged files)
- Modify: `plugin/skills/review/step3-debate-and-refutation.md` (the Mixed/partial debate STAGED template gains `lens "{lensA}"` and `Stage path: staged/review-contested-{N}.md`), `plugin/skills/_shared/multi-agent-coordination.md` (its two STAGED templates for `review-unconfirmed-{n}` and `review-debate-{n}` gain `lens "{lens}"`)
- Modify: `plugin/skills/flow/multispec-review-console.md`, `plugin/skills/flow/multispec-console-template.md` (the Dropped block and the defaults, citing the single-spec template)
- Test: `tests/review-console-unattended-no-ask-conformance.test.js` (create)

- [ ] **Step 0: Headroom** — run `node plugin/bin/plan-audit.js docs/superpowers/plans/2026-10-24-console-final-outcomes-3949.md --bytes` and keep every modified skill file under its rail; cut bytes in the same file if needed.
- [ ] **Step 1: Write the failing conformance test**: AC7 — slice `review-console.md`'s `## Auto-resolution short-circuit (`consoleAutoResolve`)` section; every line containing `AskUserQuestion` also matches `/zero|skip|never|no /i`; `plugin/bin/console-resolve.js` and `plugin/bin/console-filings.js` source contain no `AskUserQuestion`; the section names `console-filings.js`. AC7 render — run `console-resolve.js` (`run()` with injected deps, as `tests/bin-lib/console/cli.test.js` does) on the Task 2 every-outcome fixture at unattended: every decision-table row matches `/AUTO-RESOLVED: /`. AC4 template — `console-template.md` has a `Dropped by tiebreak` heading stating read-only/no decision, and the appendix mapping names `dropped`.
- [ ] **Step 2: Run** it — Expected: FAIL.
- [ ] **Step 3: Edit the prose** listed above. Each edit states the rule once and cites, per `docs/skill-authoring.md`.
- [ ] **Step 4: Run** the new test plus `node --test tests/console-resolve-conformance.test.js tests/console-shadow-dup-outcomes-conformance.test.js tests/review-console-header-conformance.test.js tests/multispec-review-console-render-not-skip.test.js` and any test that pins the edited STAGED templates (grep `tests/` for `Both verdicts staged` and `surfaced by one agent only`) — Expected: PASS.
- [ ] **Step 5: Commit** `Document the console's final outcomes — Approve-all recommendation default, unattended filing, Dropped by tiebreak`.

### Task 8: Final verification (folded)

- [ ] `npm test` via the build's Common Step 5 (`plugin/bin/verify.js`) — Expected: exit 0 (AC9).
