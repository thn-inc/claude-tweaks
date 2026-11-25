# Follow-up Re-check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At wrap-up, judge open records whose `### Key Files` intersect the run's diff, stage a close or narrowing proposal per record (always a human call), and execute an approved one only after the run's merge has landed — otherwise it stays console residue with a paste-ready execute command.

**Architecture:** A pure library `plugin/bin/lib/console/recheck.js` (candidate selection, hunk splitting, quote check, outcome truth table, proposal compose/parse, execution guard). A CLI `plugin/bin/recheck-followups.js` with four verbs — `candidates`, `stage`, `approve`, `execute` — on the `run(argv, deps)` seam. A new `followup-recheck-` staged prefix in `resolve.js` pinned `pending`. A read-time residue kind in `residue.js`. Skill prose: a new cited sub-file `plugin/skills/wrap-up/followup-recheck.md` (judge dispatch), wired into the single-spec console, the PR-posted console's execution, the post-merge steps (pr-first Step 4.0c, local-merge auto-finish step 7) and a one-line multi-spec pointer.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T142058-record-6284/work/6284-spec.md` (record #6284)

Scope keywords: followup-recheck, recheck-followups

## Global Constraints

- Closing a record and posting a comment are on `_shared/auto-mode-contract.md`'s Never-reversible list: nothing executes without a human approval recorded in `console.json`; no exception is added to that list; `followup-recheck-*` resolves `pending` at every autonomy tier and `carried` under control mode, never `apply`.
- An approved proposal executes only after the run's merge landed (`pr-first`: `gh pr view` state `MERGED`; `local-merge`: the caller passes `--local-merged` right after its successful push). PR `CLOSED` unmerged → drop the approval with one logged line, no close, no comment. Anything else → hold as residue.
- Residue is terminal: no later pass or background executor picks up an approval; `console-residue.js --run` prints the paste-ready `execute` command.
- Constants in `recheck.js`, not policy keys: `RECHECK_CAP = 5`, `HUNK_BYTE_CAP = 24000`.
- Excluded from candidates: labels `parent-issue`, `bot:in-progress`, `digest`; records in the run's own set (`--own`); records with zero parseable Deliverables and Acceptance Criteria (named in the `SCANNED` line); candidates whose only intersecting paths are hubs (`backlogHubPaths` from `plugin/bin/lib/issues/grouping.js`).
- Changed paths: `git diff --name-status -M {base}...HEAD` — both sides of a rename, and deleted paths.
- `plugin/skills/flow/multispec-review-console.md` must stay below 52,500 B (`wc -c`); it is 52,432 B now (68 B headroom) — trim at least as many bytes as the pointer adds.
- A fresh-but-empty records snapshot (`[]`) is unreadable (exit 4), never "no candidates".
- Governing skill `review-console-section-addition` (verbatim): "**A new prefix in an existing section is a smaller change.** The section, its stance and its templates already exist, so only sites 2 and 3 move, plus the known-prefix case in `resolve.test.js`." and "**A new `pending` reason on an existing row needs the same sibling grep.** … Grep a sibling reason's literal (`git grep -l -F 'sdd-ruling-unclassified' -- plugin docs tests`), not the module's identifiers". This plan deliberately adds **no new resolution value**: an approval is stored as `resolution: 'pending'` plus an `approval` field; execution rewrites it to the existing `applied`, a closed-unmerged PR to the existing `dropped`.
- Governing skill `gh-api-module-pattern` applies to `recheck-followups.js` (it shells out to `gh` and `git`): injectable runner in `deps`, `--` / end-of-options separators on argv carrying values, `run(argv, deps)` seam, run-dir anchoring via `resolveTarget` from `plugin/bin/lib/stage-item/write.js`. Read that skill's `cli-wrapper-contract.md` before Task 4.
- Governing skill `fact-validated-narration`: the judge's `satisfied` quote is a citation; it is validated against the gathered hunks (Task 3), never trusted.
- Governing skill `skill-prose-conformance-tests` applies to Task 7's conformance test.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Maturity `established`: for any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it.
- Run tests per file: `node --test {file}`; absolute paths, one plain command per Bash call, `git -C "{worktree}"`.

## Review Focus

1. A judge quote spanning two hunks, or containing the diff marker of a removed line (`-`) — must match only within one hunk after marker strip + whitespace collapse (Task 3 test).
2. A record whose Key Files include both a hub path and a non-hub intersecting path — still a candidate, `intersecting` lists only the non-hub path (Task 2 test).
3. An `approve` on a run whose `console.json` is PR-shaped (`prNumber` set) or absent — the approval must land without clobbering existing items, and an absent file must not later be overwritten by `console-resolve.js` (Task 5 test: created file has `resolved: true`).
4. Executing the same approval twice (a re-run after a partial failure) — the second run must not comment or close again (Task 5 test: item already `applied` → no gh calls).
5. A record body with CRLF line endings or a `## Deliverables` section whose items are plain bullets, not checkboxes — still parsed (Task 2 test).


---

### Task 1: `followup-recheck-` console prefix

**Role:** transcription

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` (`SECTION_MAP` next to the `premise-satisfied-` row ~line 105; `CANONICAL_PREFIXES` ~line 143)
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` (only if the sibling grep below finds it lists `premise-satisfied-close-proposal`)
- Test: `tests/bin-lib/console/resolve.test.js`, `tests/bin-lib/console/control-mode-cli.test.js`
- Waived tests/bin-lib/console/staged-id-producers.test.js: Step 5 runs it unchanged; the new prefix must pass its producer scan
- Waived _shared/auto-mode-contract.md: read-only — the Never-reversible list this row's reason cites; no exception is added

**Interfaces:**
- Produces: `classifyStagedItem('followup-recheck-12.md') -> { section: 'Queue writes', reason: 'followup-recheck-human-call' }`.

- [ ] **Step 1: Failing tests.** In `resolve.test.js`'s "classifyStagedItem maps every known prefix" table add `['followup-recheck-12.md', SECTIONS.QUEUE]` and a test `AC6.1: followup-recheck- resolves pending with reason followup-recheck-human-call under console-auto at unattended` (build items via the same helper the `premise-satisfied-` case uses). In `control-mode-cli.test.js` add `AC6.2: under control mode a staged followup-recheck-3.md resolves carried and its staged file is untouched` following that file's existing fixture style.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/resolve.test.js` and `node --test tests/bin-lib/console/control-mode-cli.test.js` — Expected: FAIL (unmapped prefix).
- [ ] **Step 3: Implement.** Row `[/^followup-recheck-/, SECTIONS.QUEUE, 'followup-recheck-human-call']` placed before the generic Queue-writes row, with a two-line comment naming #6284 and the Never-reversible reason; add `'followup-recheck-'` to `CANONICAL_PREFIXES`.
- [ ] **Step 4: Sibling grep** `git -C "{worktree}" grep -l -F 'premise-satisfied-close-proposal' -- plugin docs tests`; add the new reason beside each prose hit that lists it.
- [ ] **Step 5: Run** both files plus `node --test tests/bin-lib/console/staged-id-producers.test.js` — Expected: PASS, every pre-existing test included.
- [ ] **Step 6: Commit** — `Add followup-recheck console prefix pinned pending — refs #6284`.
  Proof(public-contract): the new `followup-recheck-` prefix and the `approval` item field are additive — Task 1 runs the whole `tests/bin-lib/console/resolve.test.js` and `control-mode-cli.test.js` unchanged-green, and Task 6 runs the whole `residue.test.js` / `residue-cli.test.js` unchanged-green, proving every existing prefix, resolution and residue line is byte-identical.

### Task 2: Candidate selection and item parsing (`recheck.js`, part 1)

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/console/recheck.js`
- Test: `tests/bin-lib/console/recheck.test.js`
- Waived plugin/bin/lib/issues/grouping.js: read-only — Step 3 imports `extractKeyFiles` and `backlogHubPaths`

**Interfaces:**
- Consumes: `extractKeyFiles(issue)`, `backlogHubPaths(openRecords)` from `plugin/bin/lib/issues/grouping.js`; `parseAcceptanceCriteria(text)` from `plugin/bin/lib/wrap-up/packet-gather.js`.
- Produces:
  - `RECHECK_CAP = 5`, `HUNK_BYTE_CAP = 24000`, `EXCLUDED_LABELS = ['parent-issue','bot:in-progress','digest']`
  - `parseJudgedItems(body: string) -> string[]` — `## Deliverables` list items (`- [ ] x`, `- [x] x`, `- x`, `* x`; checkbox stripped, continuation lines joined), else the Acceptance Criteria texts; `[]` when neither parses. CRLF tolerated.
  - `parseChangedPaths(nameStatus: string) -> string[]` — from `git diff --name-status -M` output; `R100\told\tnew` yields both, `D\tx` yields `x`; deduped, order kept.
  - `selectCandidates({ openRecords, changedPaths, hubPaths: Set<string>, ownRecords: number[], cap = RECHECK_CAP }) -> { candidates: Array<{ number, title, intersecting: string[], items: string[], bodyHash, updatedAt }>, overCap: number[], excluded: Array<{ number, reason: 'label:<name>'|'own'|'hub-only'|'no-items' }> }` — records sorted by number ascending; `bodyHash` = sha256 hex of `body`; a record with no intersection is neither candidate nor excluded.

- [ ] **Step 1: Failing tests** (fixture records `{ number, title, labels, body, updatedAt }` with `### Key Files` bodies):
  - `AC1.1: a record whose Key File is in the changed paths is a candidate`; `AC1.2: one whose Key Files are all outside is not`.
  - `AC2.1: parent-issue, bot:in-progress, digest and own records are excluded even when they intersect` — `excluded` reasons `label:parent-issue`, `label:bot:in-progress`, `label:digest`, `own`.
  - `AC2.2: a candidate whose only intersecting path is a hub is not a candidate` (reason `hub-only`); Review Focus 2: hub + non-hub → candidate with `intersecting` = non-hub only.
  - `AC3.1: cap N with N+2 qualifying returns N candidates and the 2 highest numbers in overCap`.
  - `AC10.1: parseChangedPaths returns both sides of R100 and a deleted path`; a record whose Key File is the rename's old path is a candidate.
  - `AC12.1: a record with no parseable Deliverables or Acceptance Criteria is excluded with reason no-items`.
  - Review Focus 5: `parseJudgedItems` on CRLF body with plain bullets returns the item texts.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/recheck.test.js` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the signatures above; labels may be strings or `{name}` objects.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `Add follow-up re-check candidate selection — refs #6284`.

### Task 3: Hunks, quote check, outcome and proposal text (`recheck.js`, part 2)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/console/recheck.js`
- Test: `tests/bin-lib/console/recheck.test.js`

**Interfaces:**
- Produces:
  - `splitHunks(unifiedDiff: string) -> Map<string, string[]>` — per file path (the `+++ b/` path, or the `--- a/` path for a deletion) its `@@` hunks as text.
  - `quoteFound(quote: string, hunks: string[]) -> boolean` — normalize each hunk line by stripping one leading `+`/`-`/space marker, collapse whitespace runs to one space and trim; normalize the quote the same way (marker strip per line); true when one hunk's normalized text contains it. Empty quote → false.
  - `checkVerdicts({ items: string[], verdicts: Array<{ deliverable, verdict, quote? }>, hunks: string[] }) -> Array<{ item, verdict: 'satisfied'|'not-satisfied'|'cant-tell', quote: string|null }>` — one entry per `items` entry, matched by exact text then by 1-based index string; missing verdict → `cant-tell`; `satisfied` with a quote failing `quoteFound` → `cant-tell`; `hunks` empty → all `cant-tell`.
  - `outcomeFor(checked) -> 'close'|'narrow'|null` — ≥1 item and all `satisfied` → `close`; ≥1 `satisfied` and ≥1 other → `narrow`; else `null`.
  - `composeProposal({ number, title, outcome, checked, bodyHash, updatedAt, runId }) -> string` — header lines `Target: #{n}`, `Action: close|narrow`, `Body-hash: {hex}`, `Updated-at: {iso}`, `Run: {runId}`, blank line, then `## Comment` with, per item, the item's full text beside its verdict and the verbatim quote in a fenced block (`satisfied` only).
  - `parseProposal(text) -> { number, action, bodyHash, updatedAt, comment } | null` — `null` on any missing/malformed header (number not `^\d+$`, action not close/narrow, hash not 64 hex).
  - `judgeHunks(hunksByPath, intersecting, cap = HUNK_BYTE_CAP) -> { hunks: string[], overCap: boolean }`.

- [ ] **Step 1: Failing tests:**
  - `AC4.1: all satisfied stages close and the body quotes each hunk beside each item text`; `AC4.2: satisfied + not-satisfied → narrow`; `AC4.3: satisfied + cant-tell → narrow, not close`; `AC4.4: all cant-tell → null`; `AC4.5: all not-satisfied → null`.
  - `AC5.1: a satisfied quote absent from the hunks is cant-tell, turning a would-be close into narrow`.
  - `AC10.2: an item no hunk touches (hunks empty) is cant-tell, never not-satisfied`.
  - Review Focus 1: a quote spanning two hunks → false; a quote copied with its leading `-` markers from a removed line matches that hunk.
  - `judgeHunks over cap → overCap true` and `checkVerdicts` with `hunks: []` used for it yields all `cant-tell`.
  - `parseProposal round-trips composeProposal`; returns null for `Target: #abc`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/recheck.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `Add re-check quote check, outcome table and proposal text — refs #6284`.

### Task 4: CLI `candidates` and `stage` verbs

**Role:** integration

**Files:**
- Create: `plugin/bin/recheck-followups.js`
- Test: `tests/bin-lib/console/recheck-followups-cli.test.js`

**Interfaces:**
- Consumes: Task 2/3 exports; `resolveTarget`, `writeStagedItem` from `plugin/bin/lib/stage-item/write.js`; `formatEntry` / `appendEntries` from `plugin/bin/lib/log-decision/append.js` (as `plugin/bin/bundle-proposals.js` uses them); `queryRecords`, `DEFAULT_DIR` from `plugin/bin/lib/issues/local-store.js`.
- Produces: `run(argv, deps) -> exitCode`; exports `{ run, realDeps, USAGE }`. Exit codes: 0 ok; 2 usage; 3 run dir unanchored or write failed; 4 records unreadable or empty.
  - `candidates --run <dir> (--records-json <f> | --local) --base <ref> [--own 1,2]` — runs `git diff --name-status -M <base>...HEAD` and `git diff -M <base>...HEAD` via `deps.git(args)`; writes `{run-dir}/recheck/candidates.json` = `{ base, candidates: [{ number, title, items, intersecting, hunks, hunksOverCap, bodyHash, updatedAt }] }`; logs one `SCANNED` line (step `Follow-up re-check`) naming candidates, every `overCap` number, and every `excluded` number with its reason; stdout one JSON line `{ candidates: [numbers], overCap, excluded }`.
  - `stage --run <dir> --verdicts <file>` — `<file>` is `{ "<number>": { status: "DONE"|…, verdicts: [...] } }`; per candidate: status not `DONE`/`DONE_WITH_CONCERNS`, or missing/unparseable verdicts → stage nothing, log in the `SCANNED` line as `judge-failed`; otherwise `checkVerdicts` (with `hunks` empty when `hunksOverCap`) → `outcomeFor` → when non-null `writeStagedItem({ id: \`followup-recheck-${n}\`, … })` with `composeProposal` text; logs one `STAGED` line per staged file and one `SCANNED` summary (`staged close #a, narrow #b; nothing for #c (no satisfied)`); stdout `{ staged: [ids], nothing: [numbers], judgeFailed: [numbers] }`.

- [ ] **Step 1: Failing tests** (anchored run dir created the way `tests/bin-lib/console/bundle-proposals-cli.test.js` does; fake `deps.git` returning canned diff text):
  - `AC3.2: with RECHECK_CAP qualifying + 2, the SCANNED line in decisions.md names the 2 over-cap numbers`.
  - `AC12.2: a no-items record is named in the SCANNED line and absent from candidates.json`.
  - `AC10.3: real git fixture — git mv of a Key File makes the record a candidate` (temp repo via `tests/helpers/tmp-dir`, real `git`, hermetic env per the `git-ground-truth-test-env` skill).
  - `fresh-but-empty records-json [] exits 4 and writes nothing`; unreadable file exits 4; unanchored `--run` exits 3.
  - `stage: judge status BLOCKED stages nothing and is logged judge-failed`; `stage: all-satisfied verdict writes staged/followup-recheck-{n}.md whose parseProposal action is close`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/recheck-followups-cli.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement**; every value passed to `git` after a `--` separator where applicable (`gh-api-module-pattern`).
- [ ] **Step 4: Run** the file plus `node --test tests/bin-lib/console/staged-id-producers.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `Add recheck-followups candidates and stage verbs — refs #6284`.

### Task 5: Execution guard, `approve` and `execute` verbs

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/console/recheck.js` (guard)
- Modify: `plugin/bin/recheck-followups.js`
- Test: `tests/bin-lib/console/recheck.test.js`, `tests/bin-lib/console/recheck-followups-cli.test.js`

**Interfaces:**
- Produces:
  - `executionGuard({ proposal, approval, merge, record }) -> { action: 'execute'|'hold'|'drop', reason }` — `proposal` null → hold `malformed-proposal`; `approval.pr` not `^\d+$` and not `'local'` → hold `malformed-pr`; `merge` `{ ok:false }` → hold `merge-read-failed`; merge state `CLOSED` → drop `pr-closed-unmerged`; state not `MERGED` → hold `not-merged`; `record` `{ ok:false }` → hold `record-read-failed`; record closed → hold `record-closed`; label `bot:in-progress` → hold `record-claimed`; sha256(body) ≠ `proposal.bodyHash` → hold `body-changed`; else execute.
  - `approve --run <dir> --id followup-recheck-<n>.md --pr <number|local>` — upserts into `{run-dir}/console.json` `items` the entry `{ id, section: 'Queue writes', resolution: 'pending', reason: 'followup-recheck-approved', approval: { at, pr } }` (replacing an entry with the same `id`, keeping every other key and item); an absent `console.json` is created as `{ resolved: true, mode: 'recheck-approval', at, items: [entry] }`; logs one `AUTO` line; refuses (exit 5) under control mode (`console-resolve.js --ceiling`'s logic via the same helper it uses) or when the item's current resolution is `carried`.
  - `execute --run <dir> [--id <id>] [--local] [--local-merged]` — for every `console.json` item with an `approval` and `resolution: 'pending'`: read the staged proposal, merge state (`gh pr view <pr> --json state` → `{ok, state}`; `pr: 'local'` → `MERGED` only with `--local-merged`, else `not-merged`), record (`gh issue view <n> --json state,labels,body` or `local-store` under `--local`), apply `executionGuard`. `execute` → `gh issue comment <n> --body-file -` then for `close` `gh issue close <n> --reason completed` (local: append the comment to the body via `writeRecord`, `closeRecord` for close), rewrite the item to `resolution: 'applied'`, log one `AUTO` line naming the record and action (`--reversibility "high (gh issue reopen)"` for close). `drop` → item `resolution: 'dropped'`, one `AUTO` line, no gh write. `hold` → item unchanged, one `SKIP` line naming the reason. Exit 0 whatever the outcomes.

- [ ] **Step 1: Failing tests** (fake `deps.gh` recording argv; fake returns per test):
  - `AC7.1: an approved close with the PR OPEN is not executed (no issue close/comment argv) and stays pending with approval`.
  - `AC8.1: an approved close after MERGED comments then closes and logs one AUTO line naming #n`.
  - `AC11.1: a proposal staged at a multi-spec parent run dir executes from that dir after merge` (same as AC8 with the parent dir layout: `manifest.yml` + `spec-1/`).
  - `AC13.1: merge read failing holds, one SKIP line`; `AC13.2: record read failing holds, one SKIP line`.
  - `AC14.1: approval pr "abc" holds as malformed-pr`; `AC14.2: a staged file with no Target header holds as malformed-proposal`.
  - `AC15.1: record closed → hold`; `AC15.2: record labelled bot:in-progress → hold`; `AC15.3: body hash changed → hold` — each one SKIP line, no gh write.
  - `AC16.2: PR CLOSED unmerged drops the approval with one logged line and no close or comment`.
  - `local-files: --local --local-merged closes via local-store and appends the comment to the body`.
  - Review Focus 3: `approve` into a PR-shaped console.json keeps `prNumber` and existing items; into no console.json creates one with `resolved: true`.
  - Review Focus 4: `execute` twice — second run makes no gh calls.
- [ ] **Step 2: Run** both test files — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both test files — Expected: PASS.
- [ ] **Step 5: Commit** — `Add re-check approve and post-merge execute verbs — refs #6284`.
  Proof(irreversible-side-effect): Task 5's fake-`gh` tests assert the recorded argv list contains no `issue close` / `issue comment` call for an unapproved item, an unmerged PR, a closed-unmerged PR, a failed merge read, a failed record read, a malformed PR ref, a closed/claimed record and a changed body hash — and exactly one of each for an approved, merged, unchanged record.

### Task 6: Approved-but-unexecuted residue kind

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/console/residue.js`
- Test: `tests/bin-lib/console/residue.test.js`, `tests/bin-lib/console/residue-cli.test.js`

**Interfaces:**
- Produces: `RECHECK_APPROVED_RESOLUTION = 'recheck-approved'` (read-time only, never stored); `consoleResidueItems` re-words a pending item carrying `approval` to `{ ...item, resolution: 'recheck-approved', reason: 'approved #{n} close|narrow waits on PR #{pr}' }`; `formatResidueLines` prints for it `    execute: node "{pluginRoot}/bin/recheck-followups.js" execute --run "{dir}" --id {id}` (add `--local-merged` hint text only for `pr: local`). An item `applied` or `dropped` is not residue. `splitMissing` never treats it as missing.

- [ ] **Step 1: Failing tests:** `AC7.2: console-residue.js --run lists an approved unexecuted followup-recheck item naming #n and PR #p`; `AC16.1: that line carries the paste-ready execute command`; `an applied or dropped followup-recheck item is not residue`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/residue.test.js` and `node --test tests/bin-lib/console/residue-cli.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** beside `pendingFilings`/`pendingDigests` (`pendingKindOf` mapping).
- [ ] **Step 4: Run** both — Expected: PASS, every pre-existing test included.
- [ ] **Step 5: Commit** — `List approved unexecuted re-check proposals as console residue — refs #6284`.

### Task 7: Skill prose wiring and conformance test

**Role:** judgment

**Files:**
- Create: `plugin/skills/wrap-up/followup-recheck.md`
- Modify: `plugin/skills/wrap-up/review-console.md` (new section after "Proposal bundling"; "On approval" step 7 branch)
- Modify: `plugin/skills/_shared/console-execution.md` (a ticked `followup-recheck-*` row runs `approve`, never `gh issue create`)
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md` (new `### Step 4.0c` between 4.0b and 4.1)
- Modify: `plugin/skills/_shared/local-merge-auto-finish.md` (step 7, after the Step 4.0b sentence)
- Modify: `plugin/skills/flow/multispec-review-console.md` (one-line pointer in "When to run" step 1; trim ≥ the added bytes elsewhere)
- Modify: `docs/plugin-structure.md` (list `recheck-followups.js` beside `bundle-proposals.js`)
- Modify (conditional): `plugin/bin/lib/reconcile/console-execute.js` — Step 6 reads it; changed only if the reconciler creates records for ticked Q# rows
- Waived _shared/integration-model.md: read-only — the build's assumption check confirmed the local-merge post-merge point this task wires
- Test: `tests/followup-recheck-conformance.test.js`

**Interfaces:**
- Consumes: the four CLI verbs (Tasks 4–5).

- [ ] **Step 1: Failing conformance test** pinning: `review-console.md` cites `followup-recheck.md` before rendering and its step 7 names `followup-recheck-` with `recheck-followups.js" approve`; `pr-first-merge-post-merge.md` has `### Step 4.0c` with `recheck-followups.js" execute`; `local-merge-auto-finish.md` step 7 names `execute` with `--local-merged`; `console-execution.md` names `followup-recheck-`; `multispec-review-console.md` cites `followup-recheck.md` and `AC9.1: its wc -c is below 52,500`; `followup-recheck.md` inlines the judge output template and a trailing `STATUS:` line requirement and says `[Use: Standard]`.
- [ ] **Step 2: Run** `node --test tests/followup-recheck-conformance.test.js` — Expected: FAIL.
- [ ] **Step 3: Write `followup-recheck.md`** (style of `proposal-bundling.md`): When — once per console after the last fix wave, before `proposal-bundling.md`'s pass, single-spec at the run dir, multi-spec once at the parent against the parent's integration branch (`_shared/integration-branch.md`); skipped under `--dry-run`. Records file — as `proposal-bundling.md`'s Records file paragraph. The `candidates` call; non-zero exit → retry once, then one `SKIP` Degrade-trace line and no re-check. Judge dispatch per `_shared/subagent-output-contract.md`: one agent per candidate, `[Use: Standard]`, input = `items` + `hunks` from `candidates.json` only, the output template below inlined verbatim, trailing `STATUS:`; collect replies into a verdicts file (Write tool, session temp path) and run `stage`. Never treat an unavailable/failed/empty/unparseable reply as `not-satisfied`. Approval — `approve` with `--pr` = the run's PR number (`run-state.json` `pr`) or `local`. Execution — only the post-merge steps run `execute`. Judge template (inline verbatim in the prompt):

  ```
  RECORD: #{n}
  ITEM {k}: satisfied | not-satisfied | cant-tell
  QUOTE {k}: {verbatim line(s) from one hunk — only for satisfied}
  ...
  STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
  ```
  (`stage` accepts the JSON the session builds from these replies; document that conversion in one sentence.)
- [ ] **Step 4: Wire the other files** as listed in Files; Step 4.0c: run `node "${CLAUDE_PLUGIN_ROOT}/bin/recheck-followups.js" execute --run "$PIPELINE_RUN_DIR"` (multi-spec: the parent dir), it logs its own lines; then continue to Step 4.1. Step 4.0c's position: `$PIPELINE_RUN_DIR` still exists here (Step 4.0 states it); cwd may be the main checkout — the CLI resolves the anchored run dir itself.
- [ ] **Step 5: Trim** `multispec-review-console.md` so `wc -c` stays below 52,500; record the final size in the commit message.
- [ ] **Step 6: Read** `plugin/bin/lib/reconcile/console-execute.js`; if it creates a record for a ticked Q# row, add the same `followup-recheck-` → approve branch with a test in its existing test file.
- [ ] **Step 7: Run** the conformance test, `node --test tests/bin-lib/console/staged-id-producers.test.js`, and every test that `git grep -l` finds citing an edited skill file name (`git -C "{worktree}" grep -l -F 'pr-first-merge-post-merge.md' -- tests`, same for `local-merge-auto-finish.md`, `review-console.md`, `multispec-review-console.md`, `console-execution.md`) — Expected: PASS.
- [ ] **Step 8: Commit** — `Wire follow-up re-check into the consoles and post-merge steps — refs #6284`.

## Spec coverage map

| Spec item | Task |
|---|---|
| Candidate selection, cap, SCANNED | 2, 4 |
| Judge dispatch | 7 |
| Quote check | 3 |
| Outcome staging, prefix | 1, 3, 4 |
| Console wiring (both consoles) | 7 |
| Execution after merge only, local-files | 5, 7 |
| Residue | 6 |
| Fail-closed guards | 4, 5 |
| Residue terminal / PR closed unmerged | 5, 6 |
