---
files:
  - plugin/bin/lib/reconcile/ledger-residue.js
  - plugin/bin/lib/reconcile/index.js
  - plugin/bin/hooks.js
  - plugin/bin/lib/hooks/session-start.js
  - plugin/skills/tidy/step-6-auto.md
---

# Residue Ledger Removal PR: Clearing Run Ledgers That Reached Main

**Persona:** A maintainer on a `pr-first` claude-tweaks project whose integration branch has picked up `docs/plans/*-ledger.md` files. This happens when a run's PR is merged before the run reaches its own teardown, whether by a human, the fleet, or a run that stopped after `/test`.
**Goal:** Get resolved residue ledgers off the integration branch without deleting any that still hold unresolved items, and without being nagged again about ones they chose to keep.
**Entry point:** A session start after the background reconcile pass found residue. It reports either a removal PR opened, or ledgers it kept and why.
**Success state:** One reviewable removal PR lists exactly the resolved residue ledgers. Merging it clears them from main. Closing it unmerged keeps them, and they are never proposed again. Ledgers with open rows, a live run, or an open work record referencing them are reported, never removed.

## Steps

### 1. The background pass finds residue on the integration branch
- **Action:** The detached `reconcile-background` pass runs the `ledger-residue` check. The check reads `docs/plans/*-ledger.md` from the freshly fetched `origin/{integration}` tree and keeps any file that:
  - lacks the ledger signature, or
  - still has an `open` or unrecognized-status row, or
  - belongs to a live run directory, or
  - is referenced by an open work record. That means the record's body names the ledger's filename or `{feature}` slug, or its `namedTarget` path is the ledger. The open-record list is read once, and only if some ledger passed every earlier check. If that read fails, the ledger is kept.
  It then lists every `build/ledger-residue-*` head and its PR state. For the remaining files, it builds a removal commit on a scratch index, pushes it as a new `build/ledger-residue-{hash}` branch and opens one PR. No force push, no write to the integration branch, no touch to the checkout.
- **Should feel:** Invisible and safe. Nothing in the maintainer's own checkout or branch changes.
- **Should understand:** Nothing yet. The outcome surfaces at the next session start.
- **Red flags:** The integration branch itself is modified. The main checkout's working tree or index changes. A ledger with an `open` row lands in a removal PR. A ledger an open record still names lands in a removal PR, leaving that record pointing at a missing file. The background pass closes a work record. A second removal PR opens while one is still open.

### 2. The next session start says what happened
- **Action:** The next `SessionStart` renders the prior background pass's summary. It shows the removal PR it opened, and any ledger it kept for a reason that needs attention, for example:
  - `ledger-has-open-rows`
  - `ledger-status-unrecognized`
  - `referenced-by-open-record` (the SessionStart line shows the ledger and reason only; the referencing record numbers are on the check's own `records` field)
  - `record-scan-failed`
  - `removal-pr-open`
  - `removal-merged-but-present`
  - `committer-identity-unset`
  - `push-failed`

  Expected states stay quiet there: a ledger kept for a live run (`run-live`), a path a closed removal PR declined (`removal-pr-declined`), and transport failures the next pass retries. A `/claude-tweaks:tidy` run reports the same outcome under its reconcile-converged "Applied automatically" rows (`tidy/step-6-auto.md`), with every kept ledger, quiet ones included, shown as a non-actionable skip sub-line.
- **Should feel:** Accountable. The maintainer learns a PR exists on their repo without going to look for it.
- **Should understand:** The kept ledgers are kept on purpose: they hold unresolved items, belong to a live run, are still named by an open work record, or are covered by an earlier removal PR. A ledger an open record names is left for `/claude-tweaks:tidy`, which proposes deleting it and closing those records together in one approved action. The background pass never closes a record itself. Each reason says what would let them go. A live-run or declined ledger is not repeated at every session start; `/claude-tweaks:tidy` lists it.
- **Red flags:** A removal PR that nobody is told about. A kept ledger that needs attention shown with no stated reason. A live-run or declined ledger repeated at every session start. A generic `commit-failed` when the real cause is a missing git identity.

### 3. The maintainer reviews and merges, or declines, the removal PR
- **Action:** The maintainer opens the PR titled `Remove N residue ledger(s) from docs/plans`. Its body carries the `<!-- ledger-residue-pr -->` marker, lists each path, and says that closing it unmerged declines those paths. The maintainer merges it, or closes it to keep the files.
- **Should feel:** Like a small, obvious housekeeping decision. One PR, one list, one choice.
- **Should understand:** Merging removes exactly the listed files. Closing is a durable "no": the declined branch stays on origin, so those paths are never proposed again, and a later residue set only proposes the new paths. After merge, `remote-prune` deletes the branch once its merged-proof bar is met.
- **Red flags:** A declined path proposed again in a later PR. A pile of stale removal PRs. A removal PR that bundles a declined path with a new one, so one cannot be removed without the other. A fork PR that reuses a `build/ledger-residue-*` branch name counted as a removal PR, holding back or declining paths: only this repository's own removal PRs count.

## Origin
- Created during build of #3812 (keep a run's ledger off main when its PR is merged outside the run's own teardown)
- All steps built in this session (commits 4f2ec761a..0e357a92f)
- Updated during review of #3812: Step 2 separates the kept reasons SessionStart shows from the quiet ones only tidy lists; Step 3 adds the fork-PR red flag (fork PRs that reuse a removal branch name are ignored)
- Updated during build of #4061: Steps 1-2 add the referencing-record keep rule (`referenced-by-open-record`, `record-scan-failed`), matching tidy's orphan-ledger rule
- Related specs: #3595 (in-run ledger delete ordering), #3420 (multi-spec Shared teardown ledger delete), #2887/#3566 (wrap-up ledger ownership, so inherited residue is never counted), decision 0026
