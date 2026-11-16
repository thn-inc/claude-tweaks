# Acceptance verdicts become a revocation-only trust input (expand step): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record #4626's decision, option 2: acceptance verdicts become only a negative (revert-detection) input to the trust table. Ship it as the expand step. Each trust row gains a `revocationOnly` grading beside today's `verdict`, and today's `verdict` stays live until a parked measurement record verifies the migration.

**Architecture:** `trustRows` in `plugin/bin/lib/issues/trust.js` keeps every existing row field and value byte-for-byte. Today's `verdict` keeps grading approvals as positive evidence, so `autonomy.js`, `grant-gate.js` and every other consumer are unchanged. Inside the existing loop it also resolves each approved record's operational outcome (operational, then failure marker, then undispositioned, the same chain an unverdicted record takes). From that it computes a nested `revocationOnly` object holding the option-2 grading. A decision record (ADR 0035) states the choice and the live evidence. `trust-table.md` renders the new verdict beside the old one. The contract step (switch `verdict` to the `revocationOnly` rule, then remove the old path, `batchOnly` and `'batch-only'`) is a parked record that the orchestrator files.

**Tech Stack:** Node 18+, `node --test`, Markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T094409-record-4626/work/4626-spec.md`

Scope keywords: revocationOnly

Waived plugin/bin/lib/issues/merge-lane-breaker.js: unchanged by design (Non-Goals); Task 1 Step 5 runs its suite to prove AC3.1.

## Global Constraints

- Every existing row field keeps its current value for every input. The existing `trust.test.js` cases, and every other suite that reads rows (`backlog-grant-gate.test.js`, `backlog-grant-gate-cli.test.js`, `grant-sampling.test.js`, `accept-label-reader-conformance.test.js`), pass unmodified. This is the expand half the spec requires: "following expand-contract (the old behavior stays until the migration is verified)".
- The revert-detection half of `trust.js` (`parseGitLog`, `discoverClosingCommits`, `isClosingCommitReverted`, `resolveOperationalOutcome`) is unchanged. So is `merge-lane-breaker.js`, which must still trip on `accept:changes-requested`, on `demo:changes-requested` and on a detected revert.
- Under `revocationOnly`, `pending` (either spelling) stays undispositioned and is never promoted to operational known-good. `changes-requested` (either spelling) still counts and still pins `mixed`.
- `revocationOnly` uses the same floors (`MIN_SAMPLES`, `MIN_VERDICTS`), the same `UNGRADABLE_KIND` pin, the same evaluation window and follow-up rate as `verdict`. Its mixed reasons are drawn from `['changes-requested', 'follow-up-rate', 'negative-evidence']` in that order. There is no batch-only reason: with approvals no longer positive, a clean cell always has `operationalGood >= MIN_VERDICTS`.
- `npm test` passes (AC4).

## Review Focus

1. Under `revocationOnly`, an approved record whose closing commit was reverted counts as negative evidence, although today's `verdict` shields it. Pinned in Task 1.
2. Under `revocationOnly`, an approved record carrying a correctness failure marker and no operational evidence counts as negative evidence. Pinned in Task 1.
3. Nothing is double-counted: `revocationOnly.dispositioned === changesRequested + revocationOnly.operationalGood + revocationOnly.negativeEvidence`, and those plus `revocationOnly.undispositioned` sum to `total`. Pinned by the invariant test in Task 1.
4. A cell made only of approvals with no operational evidence reads `revocationOnly.verdict === 'insufficient-evidence'`, while its `verdict` keeps today's value. This is the AC2 test in Task 1.
5. A row that loses `clean` under `revocationOnly` is the migration's live consequence (`human:human|elevated` leans on 25 approvals of 58 dispositions). Task 2 Step 1 names every such row and whether it is machine-grantable. ADR 0035 and the PR body carry that list.

---

### Task 1: compute the `revocationOnly` grading beside today's verdict

**Role:** integration
**Review risk:** high (decision logic: the trust verdict gates grant eligibility)

**Files:**
- Modify: `plugin/bin/lib/issues/trust.js` (`trustRows`: the cell initializer about line 364, the disposition branch about lines 398-433, the row map about lines 452-519; module header comment)
- Test: `tests/bin-lib/issues/trust.test.js`

**Interfaces:**
- Produces: every row carries `revocationOnly: { operationalGood, negativeEvidence, undispositioned, dispositioned, coverage, verdict, mixedReasons }`. The fields are all numbers except `verdict` (`'clean' | 'mixed' | 'insufficient-evidence'`) and `mixedReasons` (string[]). Here `operationalGood`, `negativeEvidence` and `undispositioned` are the existing cell counts plus each approved record's outcome; `dispositioned = changesRequested + operationalGood + negativeEvidence`; `coverage = dispositioned / total` (0 when total is 0). No existing row field changes. `trustRows`'s signature is unchanged.

- [ ] **Step 1: Write the failing tests (AC2.1).** Add a `// --- #4626: revocationOnly grading (expand step) ---` block. It reuses `operationalFixture`, `commitFor`, `sha40`, `NOW`, `RECENT`, `MIN_SAMPLES` and `attemptFailedCommentBody`.
  - `#4626 AC2: a record with only an accept:approved verdict counts for nothing under revocationOnly` — one `{ number: 1, labels: ['by:capture','risk:low','accept:approved'], body:'', state:'CLOSED', closedAt: RECENT }` → `approved 1`, `dispositioned 1` (unchanged) and `revocationOnly` deepEqual `{ operationalGood: 0, negativeEvidence: 0, undispositioned: 1, dispositioned: 0, coverage: 0, verdict: 'insufficient-evidence', mixedReasons: [] }`.
  - `#4626 AC2: MIN_SAMPLES approvals with no operational evidence grade clean today and insufficient-evidence under revocationOnly` — `MIN_SAMPLES` such records, once with `accept:approved` and once with `demo:approved` → `verdict 'clean'` and `revocationOnly.verdict 'insufficient-evidence'` for both.
  - `#4626: under revocationOnly an approved record is graded on its operational outcome` — `{ ...operationalFixture(1, 20), labels: [...,'accept:approved'] }` with `[commitFor(1)]` → `operationalGood 0` (unchanged) and `revocationOnly.operationalGood 1`.
  - `#4626: under revocationOnly an approved record with a reverted closing commit is negative evidence` — that fixture plus `{ sha: sha40(999), message: \`This reverts commit ${sha40(1)}.\` }` → `negativeEvidence 0`, `revocationOnly.negativeEvidence 1`.
  - `#4626: under revocationOnly an approved record with a correctness failure marker is negative evidence` — a fresh-close approved record with an `attemptFailedCommentBody({ attemptNumber: 1, reason: 'x', classification: 'correctness' })` comment → `revocationOnly.negativeEvidence 1`.
  - `#4626: under revocationOnly a batch-only cell grades on its operational outcomes, not on batch-only` — `MIN_SAMPLES` `operationalFixture` records, each also labelled `accept:approved` + `accept:approved-batch`, with their closing commits → `verdict 'mixed'` with `mixedReasons ['batch-only']` (unchanged), and `revocationOnly.verdict 'clean'`, `revocationOnly.mixedReasons []`.
  - `#4626: a changes-requested verdict pins revocationOnly mixed too` — 7 `operationalFixture` records (commits in the log) plus one `accept:changes-requested` record → `revocationOnly.verdict 'mixed'`, `revocationOnly.mixedReasons ['changes-requested']`.
  - `#4626: under revocationOnly every record lands in exactly one outcome column` — a mixed fixture (approved, approved+batch, changes-requested, pending, none, an operational record, a reverted one) → `changesRequested + r.operationalGood + r.negativeEvidence + r.undispositioned === total` and `r.dispositioned === changesRequested + r.operationalGood + r.negativeEvidence`, where `r = row.revocationOnly`.
  - `#4626: an unstructured cell stays insufficient-evidence under revocationOnly` — reuse the existing unstructured fixture shape → `revocationOnly.verdict 'insufficient-evidence'`.

- [ ] **Step 2: Run them and see them fail.**
  Run: `node --test tests/bin-lib/issues/trust.test.js`
  Expected: FAIL. Every new case fails reading `revocationOnly` of undefined, and every pre-existing case passes.

- [ ] **Step 3: Implement.** In the cell initializer, add three counters for approved records' outcomes, for example `approvedOperationalGood`, `approvedNegativeEvidence` and `approvedUndispositioned`. They are internal: strip them in the row map's destructure the way `followUpTargets` is stripped. Move the `'none'` branch's operational, failure-marker and undispositioned chain into one local helper that returns `'good' | 'bad' | 'unknown'`. The `'none'` branch calls it exactly as today. The `'approved'` branch keeps its tallies unchanged, then calls the helper and bumps the matching `approved*` counter. In the row map, compute `revocationOnly` from those counters with the same floor and `UNGRADABLE_KIND` conditions as `verdict` and the three-reason failing set (the existing `MIXED_REASON_ORDER` minus `'batch-only'`). Add a comment block above it that cites #4626 and ADR 0035 and states that `revocationOnly` is the expand half: the contract step makes it `verdict`. Leave every existing computation untouched.

- [ ] **Step 4: Confirm the expand half is invisible to existing readers.** Run: `node --test tests/bin-lib/issues/trust.test.js tests/bin-lib/backlog-grant-gate/backlog-grant-gate.test.js tests/backlog-grant-gate-cli.test.js tests/bin-lib/issues/grant-sampling.test.js tests/accept-label-reader-conformance.test.js tests/trust-policy-keys-conformance.test.js`
  Expected: PASS, 0 failures, with no pre-existing test edited.

- [ ] **Step 5: Run the tests and see them pass (AC2.1, AC3.1).**
  Run: `node --test tests/bin-lib/issues/trust.test.js tests/bin-lib/issues/merge-lane-breaker.test.js`
  Expected: PASS, 0 failures. In `merge-lane-breaker.test.js`, `AC2.1: accept:changes-requested trips the breaker exactly as demo:changes-requested does` and the revert-trip cases pass unchanged, which is AC3.

- [ ] **Step 6: Commit.**
  ```bash
  git add plugin/bin/lib/issues/trust.js tests/bin-lib/issues/trust.test.js
  git commit -m "Compute a revocation-only trust grading beside today's verdict — expand step of ADR 0035 (refs #4626)"
  ```

### Task 2: decision record, live diff and table render

**Role:** judgment

**Files:**
- Create: `docs/decisions/0035-acceptance-verdicts-are-a-revocation-input-only.md`
- Modify: `plugin/skills/_shared/trust-table.md` (Render section: one new column, one paragraph)

**Interfaces:**
- Consumes: Task 1's `row.revocationOnly.{verdict, dispositioned, coverage, mixedReasons}`.

- [ ] **Step 1: Verify the live diff on the new code (AC1.1).** Run `node plugin/bin/backlog-grant-gate.js --limit 5000` in the foreground with a timeout of at least 600000, stdout redirected to a scratch file. For every row, compare `verdict` against `revocationOnly.verdict`. List each row whose two verdicts differ, with its `approved`/`approvedBatch`/`dispositioned` and `revocationOnly.dispositioned`, and mark it machine-grantable when its `kind` is `producer` or `side-effect`. Pre-change baseline, from this run's `decisions.md` Spec Step 3 evidence line: 140 rows; 811 in-window closed records; 43 approved verdict labels (31 batch); 0 changes-requested; 12 graded rows; 0 graded rows below MIN_VERDICTS without approvals. Expected: `verdict` matches the baseline row for row. Any difference there is a Task 1 bug, so stop.

- [ ] **Step 2: Write ADR 0035.** Use ADR 0034's shape (`- **Status:** accepted`, `- **Date:** 2026-11-16`, `- **Context:** #4626, #4608`). In Context, give the tension and the verbatim counts from Step 1 and the baseline. In Decision, write: option 2, "acceptance verdicts route work; a rejection is a revocation input, an approval never promotes a class". Name the three options from the spec and say which was chosen. Recording it against #4608's design intent means saying explicitly that this decision is how #4608's "verdicts route work; they do not feed an autonomy ladder" becomes true. Add an Expand-contract subsection: this release computes `revocationOnly` beside `verdict` and changes no consumer. The contract step switches `verdict` to the `revocationOnly` rule, then removes the approval-as-positive path, `batchOnly` and `'batch-only'`. Its removal condition is the parked measurement record's check passing. In Alternatives, list keep unchanged (rejected: an approval climbs the autonomy ladder at `autonomy: unattended`) and stop reading verdicts entirely (rejected: drops the strongest negative signal from per-class grading). In Consequences, list the Step 1 differing rows and their grant consequence, the revert detector and breaker left unchanged, and an approved record becoming exposed to revert and failure-marker evidence once contracted. End with the line `- **Defers:** parked measurement record (filed by the orchestrator; number added after filing)`.

- [ ] **Step 3: Render the new verdict.** In `trust-table.md`'s Render section, append one column `Verdict (revocation-only)` after `Verdict`, rendered from `row.revocationOnly.verdict`, in both the header row and the placeholder row. Add one paragraph after the Coverage paragraph. It says the column is ADR 0035's expand step: what Verdict becomes once approvals stop counting as positive evidence (an approved record graded on its operational outcome). Verdict stays the one consumers act on until the contract step. Change no other text.

- [ ] **Step 4: Leave the measurement-record slot.** The implementer files no records. The `/build` orchestrator files the parked record through `/claude-tweaks:capture` after this task and edits its number into ADR 0035's Defers line.

- [ ] **Step 5: Verify the full suite (AC4.1).**
  Run: `npm test`
  Expected: PASS, 0 failures.

- [ ] **Step 6: Commit.**
  ```bash
  git add docs/decisions/0035-acceptance-verdicts-are-a-revocation-input-only.md plugin/skills/_shared/trust-table.md
  git commit -m "Record ADR 0035 — acceptance verdicts are a revocation input only (refs #4626)"
  ```
