# Acceptance verdicts stop earning trust: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record #4626's decision, which is option 2: acceptance verdicts are only a negative (revert-detection) input to the trust table. An `approved` verdict stops being positive evidence, `changes-requested` stays a disqualifier, and the revert detector and `merge-lane-breaker.js` stay as they are.

**Architecture:** `trustRows` in `plugin/bin/lib/issues/trust.js` stops treating `dispositionState === 'approved'` as a disposition. Instead an approved record goes down the same path as a record with no verdict: operational outcome, then failure marker, then undispositioned. The `approved` and `approvedBatch` tallies stay on the row as display counts. `batchOnly` and the `'batch-only'` mixed reason can no longer change a verdict, so they are removed. The prose that says approvals grade a class is corrected, and a decision record (ADR 0035) states the choice and the live evidence behind it.

**Tech Stack:** Node 18+, `node --test`, Markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T094409-record-4626/work/4626-spec.md`

Scope keywords: approvedBatch, batchOnly, batch-only, Approved (Batch), approvalProvenance

## Global Constraints

- The revert-detection half of `trust.js` (`parseGitLog`, `discoverClosingCommits`, `isClosingCommitReverted`, `resolveOperationalOutcome`) is unchanged. So is `merge-lane-breaker.js`, which must still trip on `accept:changes-requested`, on `demo:changes-requested` and on a detected revert.
- `pending` (either spelling) stays undispositioned and is never promoted to operational known-good.
- `changes-requested` (either spelling) still counts in `changesRequested`, still sums into `dispositioned`, and still pins `mixed`.
- `approved` and `approvedBatch` stay on every row, counted exactly as today: display tallies, overlapping the outcome columns.
- Expand-contract: no row field that a consumer outside `trust.js` reads is removed. `batchOnly` is read only by `trust.js`, `trust-table.md` and `trust.test.js` (repo-wide grep), so removing it breaks no reader. A run on the previous release loads its own `trust.js`.
- `npm test` passes (AC4).

## Review Focus

1. An approved record whose closing commit was reverted must count as `negativeEvidence`. Today it is shielded by its approval. Pinned in Task 1.
2. An approved record carrying a correctness failure marker and no operational evidence counts as `negativeEvidence` and is not undispositioned. Pinned in Task 1.
3. A record carrying both an approved label and a pending label resolves through `dispositionState`'s existing precedence. Whatever that precedence returns decides the path, and nothing is double-counted: `total === changesRequested + operationalGood + negativeEvidence + undispositioned`. Pinned by the row-invariant test in Task 1.
4. A cell made only of approvals with no operational evidence must read `insufficient-evidence`, not `clean`. This is the AC2 test in Task 1.
5. `describeMixedReasons` and grant-gate's `mixedReasons` filter must still render a row whose reasons no longer include `'batch-only'`. The existing `mixedReasons lists every failing input in the fixed order` and `describeMixedReasons renders every reason in order` tests are updated in Task 1.

---

### Task 1: approvals stop grading in `trustRows`

**Files:**
- Modify: `plugin/bin/lib/issues/trust.js` (`trustRows` disposition branch, about lines 398-433; `batchOnly` and `MIXED_REASON_ORDER`/`MIXED_REASON_TEXT` `'batch-only'` entries, about lines 310, 467-473, 506-511, 556; the cell comment about `approvedBatch`, about line 371)
- Test: `tests/bin-lib/issues/trust.test.js`

**Interfaces:**
- Produces: the `trustRows(records, gitLog, now, policy)` signature is unchanged. Row fields are unchanged except that `batchOnly` is removed. `mixedReasons` is drawn from `['changes-requested', 'follow-up-rate', 'negative-evidence']`. `dispositioned === changesRequested + operationalGood + negativeEvidence`. `approved` and `approvedBatch` are display tallies, and each approved record is also counted in exactly one of `operationalGood`, `negativeEvidence` or `undispositioned`.

- [ ] **Step 1: Write the failing tests.** Add a `// --- #4626: approvals are display-only, never positive evidence ---` block with these cases. They reuse the existing `operationalFixture`, `commitFor`, `sha40`, `NOW`, `RECENT` and `attemptFailedCommentBody` helpers.
  - `#4626 AC2: a record with only an accept:approved verdict contributes nothing to grading` — `trustRows([{ number: 1, labels: ['by:capture','risk:low','accept:approved'], body:'', state:'CLOSED', closedAt: RECENT }])` → `approved 1`, `undispositioned 1`, `dispositioned 0`, `coverage 0`.
  - `#4626 AC2: MIN_SAMPLES accept:approved records with no operational evidence stay insufficient-evidence` — `MIN_SAMPLES` such records → `approved === MIN_SAMPLES`, `dispositioned 0`, `verdict 'insufficient-evidence'`. Run the same fixture with `demo:approved` and assert the same verdict.
  - `#4626: an approved record is graded on its operational outcome` — `{ ...operationalFixture(1, 20), labels: [...,'accept:approved'] }` with `[commitFor(1)]` → `approved 1`, `operationalGood 1`, `undispositioned 0`.
  - `#4626: an approved record whose closing commit was reverted counts as negative evidence` — that fixture plus the revert entry `{ sha: sha40(999), message: \`This reverts commit ${sha40(1)}.\` }` → `negativeEvidence 1`, `operationalGood 0`, `approved 1`.
  - `#4626: an approved record with a correctness failure marker counts as negative evidence` — a fresh-close approved record carrying an `attemptFailedCommentBody({ attemptNumber: 1, reason: 'x', classification: 'correctness' })` comment → `negativeEvidence 1`, `approved 1`.
  - `#4626: a changes-requested verdict still pins a cell mixed` — 7 `operationalFixture` records (closing commits in the log) plus one `accept:changes-requested` record → `changesRequested 1`, `verdict 'mixed'`, `mixedReasons` deepEqual `['changes-requested']`.
  - `#4626: every record lands in exactly one outcome column` — a mixed fixture (approved, approved+batch, changes-requested, pending, none, an operational record, a reverted one) → `total === changesRequested + operationalGood + negativeEvidence + undispositioned` and `dispositioned === changesRequested + operationalGood + negativeEvidence`.
  - `#4626: rows carry no batchOnly field` — `assert.equal('batchOnly' in row, false)`.

- [ ] **Step 2: Run them and see them fail.**
  Run: `node --test tests/bin-lib/issues/trust.test.js`
  Expected: FAIL. The AC2 cases show `dispositioned 1`/`undispositioned 0`, the reverted-approval case shows `negativeEvidence 0`, and the batchOnly case shows the field present.

- [ ] **Step 3: Implement.** In `trustRows`, an `'approved'` disposition increments `approved` (and `approvedBatch` when `approvalProvenance(...) === 'batch'`), then falls through to the same operational, failure-marker and undispositioned chain the `'none'` branch runs. Factor that chain into one local helper so the two branches share it and do not copy it. `'changes-requested'` and the pending/else branch are unchanged. Remove `batchOnly` from the row and its computation, `'batch-only'` from `MIXED_REASON_ORDER`, its `failing` entry and its `MIXED_REASON_TEXT` entry. Rewrite the comments the change falsifies: the `'none'`-branch comment (approval no longer shields a record from its operational outcome), the `approvedBatch` cell comment (display only) and the `batchOnly` comment block (deleted), each with a one-line `#4626` reason.

- [ ] **Step 4: Migrate the existing tests the change falsifies.** Run `node --test tests/bin-lib/issues/trust.test.js`. Sort each failure into one of two groups:
  - **Its subject is something else** (floors, follow-ups, coverage, windows, unstructured pinning, NOT_PLANNED, mixedReasons order, scope-fork) and it used `demo:approved` as filler positive evidence. Swap the filler for operational evidence (`operationalFixture`-shaped closed records aged past the revert window, with `commitFor` entries in the `gitLog` passed to `trustRows`, and `NOW` as the clock). Keep every assertion about its subject unchanged. Do not weaken an assertion to make it pass.
  - **Its subject is approval-as-positive-evidence**: `demo-descent still wins over operational evidence when both are present`, `a demo:approved record carrying an earlier failed-attempt marker keeps its approved disposition`, `AC3.2: accept:approved-batch counts as approvedBatch and batchOnly`, `AC3.2: accept:* verdicts land in the same buckets as their demo:* twins`, and the three `#431:` tests. Rewrite each to pin the new rule under the same spelling coverage. Keep the `approvedBatch` tally assertions. Turn the "both are present" and "keeps approved disposition" cases into their #4626 inverses, or delete them where a Step 1 test already pins that inverse. The `demo:*`/`accept:*` twin equality in the AC3.2 bucket test stays.
  - Update `mixedReasons lists every failing input in the fixed order` and `describeMixedReasons renders every reason in order` to the three-reason order.

- [ ] **Step 5: Run and see it pass.**
  Run: `node --test tests/bin-lib/issues/trust.test.js tests/bin-lib/issues/merge-lane-breaker.test.js tests/bin-lib/issues/grant-sampling.test.js tests/bin-lib/backlog-grant-gate/backlog-grant-gate.test.js tests/backlog-grant-gate-cli.test.js tests/accept-label-reader-conformance.test.js tests/trust-policy-keys-conformance.test.js`
  Expected: PASS, 0 failures. In `merge-lane-breaker.test.js`, `AC2.1: accept:changes-requested trips the breaker exactly as demo:changes-requested does` and the revert-trip cases pass unchanged, which is AC3.

- [ ] **Step 6: Commit.**
  ```bash
  git add plugin/bin/lib/issues/trust.js tests/bin-lib/issues/trust.test.js
  git commit -m "Stop counting acceptance approvals as trust evidence — approved records grade on their operational outcome (refs #4626)"
  ```

### Task 2: prose, decision record and live recount

**Files:**
- Create: `docs/decisions/0035-acceptance-verdicts-do-not-earn-trust.md`
- Modify: `plugin/skills/_shared/trust-table.md` (the Operational, Negative Evidence, Approved (Batch) and Coverage paragraphs and the `Total =` invariant, about lines 366-404; the all-insufficient collapse line stays as is, since it still sums approvals as display)
- Modify: `plugin/skills/_shared/autonomy-ceiling.md` (the `clean` bullet's "an acceptance disposition, or a merged-and-unreverted operational close", about line 322)
- Modify: `plugin/skills/demo/SKILL.md` (the Provenance signal paragraph's "trust.js's coverage/verdict computation", about line 286)
- Modify: `plugin/skills/_shared/work-record.md` (the Acceptance provenance row's "Sole consumer: ... coverage/verdict computation", line 55)

**Interfaces:**
- Consumes: Task 1's row semantics (`dispositioned` = changes-requested + operational + negative; `approved`/`approvedBatch` display-only; no `batchOnly`).

- [ ] **Step 1: Re-run the live count on the new code.** Run `node plugin/bin/backlog-grant-gate.js --limit 5000 > {scratch}/grant-gate-after.json` in the foreground (a timeout of at least 600000). Diff each row's `verdict` against the pre-change capture in the run's `decisions.md` Spec Step 3 evidence line (12 graded rows; `human:human|elevated` clean on 58 dispositions, 25 of them approvals). Record which rows changed verdict and why. Expected: no machine-grantable (`producer`/`side-effect`) row gains `clean`.

- [ ] **Step 2: Write ADR 0035.** Use ADR 0034's shape (Status accepted, Date 2026-11-16, Context #4626, #4608). Context: the tension, plus the live pre- and post-change counts from Spec Step 3 and Step 1, verbatim numbers. Decision: option 2, stated as "verdicts route work; a rejection is a revocation input, never an approval-as-promotion input". This records the decision against #4608's design intent. Alternatives: keep unchanged (rejected: an approval climbs the autonomy ladder at `unattended`); stop reading verdicts entirely (rejected: drops the strongest negative signal from per-class grading). Consequences: the revert detector and breaker are unchanged; the batch-only rule and its row field are retired; an approved record is now exposed to revert and failure-marker evidence; a Defers line points at the parked measurement record from Step 4.

- [ ] **Step 3: Correct the prose.** In `trust-table.md`, the Operational paragraph says an approved record falls through to the operational path. The invariant becomes `Total = Changes Requested + Operational + Negative Evidence + Undispositioned`, with Approved and Approved (Batch) as overlays counted inside those columns. The Approved (Batch) paragraph drops the "cannot reach clean" rule and becomes a display tally (cite ADR 0035). Coverage counts outcome evidence, not approvals. In `autonomy-ceiling.md`, the dispositioned clause reads "a changes-requested disposition, a merged-and-unreverted operational close, or negative evidence — never an approval". In `demo/SKILL.md` and `work-record.md`, the batch marker feeds the trust table's Approved (Batch) display tally, not its verdict. Change nothing else in those files.

- [ ] **Step 4: Leave the measurement-record slot.** The implementer does not file records. Write ADR 0035's Defers line as `- **Defers:** parked measurement record (filed by the orchestrator; number added after filing)`. After this task, the `/build` orchestrator files the record through `/claude-tweaks:capture`, with a spec-shaped body and a `Defer-reason:`. The record says: after 30 days (`trust-evaluation-window-days`) on the release that ships this PR, re-run `backlog-grant-gate.js` and confirm that no `producer`/`side-effect` class reads `clean` with `operationalGood + changesRequested + negativeEvidence` under `MIN_VERDICTS`, and that the Spec Step 3 row diff still holds. The orchestrator then edits the number into that line.

- [ ] **Step 5: Verify.**
  Run: `npm test`
  Expected: PASS, 0 failures, including the prose-pinning conformance suites.

- [ ] **Step 6: Commit.**
  ```bash
  git add docs/decisions/0035-acceptance-verdicts-do-not-earn-trust.md plugin/skills/_shared/trust-table.md plugin/skills/_shared/autonomy-ceiling.md plugin/skills/demo/SKILL.md plugin/skills/_shared/work-record.md
  git commit -m "Record ADR 0035 — acceptance verdicts are a revocation input only (refs #4626)"
  ```
