---
files:
  - plugin/skills/dispatch/close-out.md
  - plugin/skills/_shared/pr-first-merge.md
  - plugin/skills/_shared/acceptance-labeling-landed.md
  - plugin/skills/wrap-up/verification-brief.md
  - plugin/bin/console-residue.js
  - plugin/bin/lib/wrap-up/verify-results.js
  - plugin/skills/flow/summary-template.md
  - tests/verify-json-acceptance-guard-conformance.test.js
---

# Close Out a Parked PR Whose Acceptance Labeling Never Landed

**Persona:** a maintainer approving a `pending-review` PR days after the run that parked it, via `/claude-tweaks:dispatch close-out #{n}`. They are not sure the run's wrap-up finished its Phase 4 acceptance labeling — #3712's run skipped it and nothing noticed.

**Goal:** the record never merges without its `demo:pending` label or its Try it walkthrough, and the maintainer knows when the run's wrap-up never verified its own closure.

**Entry point:** the flow Pipeline Summary's `### Needs a human` block for the parked run, or a later `/claude-tweaks:dispatch close-out #{n}`.

**Success state:** either labeling is confirmed landed (from `verify.json`, or live on the forge) and the merge proceeds to the confirmation gate, or labeling runs first with the run's own directory and record set, or the candidate stops with a named reason — never a merge on an assumption.

## Steps

### 1. Read the Needs a human block
- **URL:** `flow/summary-template.md`'s `### Needs a human` section, rendered from `console-residue.js --run "$PIPELINE_RUN_DIR" --require-verify {base}`
- **Action:** read the block after an unattended run parks.
- **Should feel:** told, not left to find out at merge time.
- **Should understand:** when the run never wrote `verify.json`, the block carries `- {run-id}: verify.json missing — wrap-up's Verify execution never ran, or its write failed` and a paste-ready `run: node "…/bin/wrap-up-engine.js" verify --run-dir "…" --base {base}` line. A multi-spec parent is checked per `spec-*/`, never as a whole. A run that wrote a valid `verify.json` adds nothing.
- **Red flags:** the line on a run whose `verify.json` is valid (an unparseable file, a wrong version, or a row without a string `check`/`result` counts as missing and correctly gets the line); the line in a SessionStart residue scan (the flag is opt-in, archived runs predate the file); an empty `--require-verify` value accepted silently.

### 2. Start close-out on the PR
- **URL:** `/claude-tweaks:dispatch close-out #{n}` → `dispatch/close-out.md`'s per-candidate procedure, steps 1-2
- **Action:** close-out re-reads CI and mergeability live.
- **Should feel:** the same live re-verify as before.
- **Should understand:** nothing about labeling is decided yet; red CI still stops the candidate first, and a `DIRTY` PR is first offered close-out's re-verified update.
- **Red flags:** a stale prior green treated as current.

### 3. Let step 3 find out whether labeling landed
- **URL:** `dispatch/close-out.md` step 3
- **Action:** close-out resolves the run dir from the PR body's `claude-tweaks-run:` marker (validated as `flow/claim-targets.md` validates it), reads `verify.json` at `pipelines/{run-id}/` then `archive/{run-id}/` — every `spec-*/verify.json` for a multi-spec parent — and only when that does not show labeling landed (an unreadable `verify.json` is never rescued by the live check), checks live forge state before running anything.
- **Should feel:** like it checked rather than assumed, and didn't redo work already done.
- **Should understand:**
  - The predicate close-out applies is `_shared/acceptance-labeling-landed.md`; step 3 states only what it does on each outcome.
  - **Landed** means an `acceptance-labeling` row of `pass` or `skip` in every file read; `fail`, `unknown`, a missing row or a missing/unreadable file means not landed.
  - **Live check first.** If every `Fixes` record already carries `demo:pending`, or the PR already carries a trusted `brief`/`try-it` run comment, labeling is treated as landed — re-running would duplicate the issue pointer comment.
  - **A failed read is not landed.** A failed label or comment read, or an empty `Fixes` set, never counts as landed on its own: Step 1 runs unless the other live check (a trusted run comment, or `demo:pending` on every `Fixes` record) lands. An unreadable `verify.json` is not rescued by the live check at all.
  - **Otherwise** it runs `_shared/pr-first-merge.md` Step 1 with `PIPELINE_RUN_DIR` (the resolved dir, or each not-landed member's `spec-{N}/`) and `CLOSING_SUB_ISSUES` (the PR's `Fixes` records), before Mark ready and before the confirmation gate.
  - **No run dir** (no valid marker, or neither path exists): the candidate stops with `stopped: acceptance labeling unverifiable — no run dir`.
  - **Screenshots from a close-out labeling run** go to their own evidence-only PR (`Refs #{record}`), never onto the dispatcher's main checkout: close-out runs from the main checkout, so `verification-brief.md` Step 4's integration-branch guard takes the evidence-PR route even while the parked PR is still open (#4039 — see `land-demo-evidence-after-the-pr-merged-4039.md`).
- **Red flags:** a merge reaching the confirmation gate with no labeling and a `fail` row; labeling re-run when `demo:pending` is already on every record; a guess at a run dir; screenshot evidence committed or pushed on the main checkout.

### 4. Confirm and merge
- **URL:** `dispatch/close-out-confirmation.md`, then `pr-first-merge.md` Step 3
- **Action:** answer the confirmation gate.
- **Should feel:** the question describes a PR that is labeled and ready.
- **Should understand:** the merge still uses the `human-approved` tag; declining leaves the PR `pending-review`.
- **Red flags:** a confirmation question shown before labeling was settled.

## Origin
- Updated during build of #4039 (step 3 now names where a close-out labeling run's screenshot evidence lands).
- Created during build of #3783 (verify.json acceptance guard). Observed on #3712's run (PR #3749): wrap-up skipped acceptance labeling and Verify execution, the unattended console resolved `leave-open`, and close-out's step 3 assumed a `pending-review` PR implied labeling had run.
- Updated during build of #4273: step 2's `DIRTY` case now first gets close-out's re-verified update offer (`update-a-conflicting-parked-pr-at-close-out-4273.md`) instead of a stop.
- Updated during build of #4045: the landed rule now lives in _shared/acceptance-labeling-landed.md, cited by pr-first-merge Step 1, close-out step 3 and tidy.
