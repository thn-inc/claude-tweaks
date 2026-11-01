---
files:
  - plugin/skills/wrap-up/refused-proposals.md
  - plugin/skills/_shared/ledger-format.md
  - plugin/skills/ledger/SKILL.md
  - plugin/skills/review/step3-routing.md
  - tests/deferral-gate-conformance.test.js
---

# Settle a Refused Staged Proposal in the Ledger

**Persona:** the agent session running `/claude-tweaks:wrap-up`'s Review Console, and the maintainer who reads the ledger and console afterwards. The run staged a record proposal: `/review` Step 3 wrote `staged/review-followup-{n}.md`, or the ledger resolve gate's Defer/Keep wrote `staged/ledger-record-{slug}.md`. The proposal's `Defer-reason:` header is missing or invalid.
**Goal:** a refused proposal's finding must never vanish. The open-items ledger row that pointed at the staged file must not stay `deferred` against a file nothing will file.
**Entry point:** `wrap-up/review-console.md` "On approval" step 7 (or `flow/multispec-review-console.md` step 2, or `wrap-up/ledger-narrowing-auto-file.md`) runs `refused-proposals.md`'s check on a `Q#` queue write, and the check refuses it.
**Success state:** the `deferred` row whose Resolution names the refused staged path is back to `open` with note `proposal refused — no defer reason`. The staged file is gone. `decisions.md` holds the `REFUSED` line ending `; ledger row reopened, staged file removed.` The next ledger resolve drills the reopened row like any other `open` item.

## Steps

### 1. See the refusal in the console
- **URL:** the Review Console's **Refused — no defer reason** section (directly after Queue writes)
- **Action:** Read the refused row: the staged path and the offending `Defer-reason:` value, or "absent".
- **Should feel:** Unmissable. The row has no default, and neither Approve all nor `consoleAutoResolve` can wave it through.
- **Should understand:** A refusal is not a failed create. A transport error on a valid proposal renders in Queue writes instead and follows the failed-execution rewrite.
- **Red flags:** A refused proposal counted in Approve all, or filed as a record anyway.

### 2. Reopen the row that named the staged path
- **URL:** `plugin/skills/wrap-up/refused-proposals.md` → "## Ledger origin"
- **Action:** Resolve the run's active ledger (`_shared/ledger-format.md`'s Location section's resolution rule; in a multi-spec run, the one shared ledger). Find the `deferred` row whose Resolution names the exact refused path: `staged/review-followup-3.md` in a single-spec run, or `spec-2/staged/review-followup-3.md` in a multi-spec run. Set that row to `open` with note `proposal refused — no defer reason`. Delete the staged file and log the ledger-origin `REFUSED` line.
- **Should feel:** Mechanical and unambiguous. One exact path names one row, even when two specs each staged a `review-followup-1.md`.
- **Should understand:**
  - This is the one reopen `_shared/ledger-format.md`'s Resolution-text requirements allow, and the rule is stated there. The deferral never completed, so returning the row to `open` restores its true state, not a reversal of a decision.
  - Only a `deferred` row reopens. A row in another status, such as an `acknowledged` ops item whose staged proposal was refused, falls through to the no-origin branch.
  - Under `--dry-run`, the status flip and the staged-file deletion are previewed, not applied.
- **Red flags:**
  - A `deferred` row still naming a `staged/…` file that no longer exists after the run closes. That is the #4772 failure shape: `parseLedger` reads only the Resolution text, so it counted the row complete and the finding was lost.
  - A prefix or glob match reopening the wrong row.
  - A bare `staged/{name}` written to a multi-spec ledger by a Defer/Keep or `/review` Step 3 producer.

### 3. Leave a proposal no row names where it is
- **URL:** `plugin/skills/wrap-up/refused-proposals.md` → the no-ledger-origin sentence
- **Action:** For a refused leftover section or reflect tangential, which no `deferred` row names, leave the file staged. The summary's refused-count line is the signal.
- **Should feel:** Deliberate, not an oversight. A reasonless deferral should have been a fix, and a human can still rescue the file before `close-run`.
- **Should understand:** The file dies with the run dir at `close-run` unless someone rescues it. That is by design for proposals with no ledger row to carry the finding.
- **Red flags:** Deleting a no-origin proposal's staged file. Nothing would then hold its finding.

### 4. Drill the reopened row at the next resolve
- **URL:** `plugin/skills/_shared/ledger-format.md` → "Resolve Gate (Nothing-Left-Behind)"
- **Action:** The next ledger resolve that reads this ledger finds the `open` row and drills it in Phase 2 per item: fix, Defer/Keep with a valid reason, or Accept/Drop.
- **Should feel:** The finding gets a second, honest decision instead of disappearing.
- **Should understand:** The refusal runs after the current run's resolve gate. So within the run, `review-console.md` step 13 only keeps the ledger file in place, with a `SKIP` naming the `open` row. The reopened row does not block the current run.
- **Red flags:** The ledger file deleted at branch finish while an `open` row remains.

## Origin
- Created during the build of #4772 (settle refused review-followup- proposals in the open-items ledger), run `2026-11-01T182343-record-4772`.
- Steps 1, 3 and 4 describe existing behavior. Step 2 is what this build changed: the reopen used to cover only `staged/ledger-record-*.md` and keyed on the filename prefix. It now keys on the exact staged path named in a `deferred` row's Resolution, spec-qualified in multi-spec runs.
- Related: `docs/journeys/close-a-run-whose-ledger-holds-an-incomplete-deferral-3327.md` (the incomplete-deferral rule this sits beside) and `docs/journeys/recover-a-queue-write-the-unattended-console-could-not-file-4170.md` (the failed-create path a refusal is distinct from).
