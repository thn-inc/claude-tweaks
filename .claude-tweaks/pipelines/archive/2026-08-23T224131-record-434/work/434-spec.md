---
record: 434
origin: capture
risk: low
size: medium
ceremony: standard
grants: [build]
surface: infra
---
# 434: dispatch: second-call templates conflate worktree-removal deferral with claim/archival deferral

Surface: infra

## Current State

`skills/dispatch/task-prompt.md` and `skills/dispatch/settle-and-merge.md` currently bundle three
independent cleanup actions — worktree removal, issue-claim release, and run-dir archival — under a
single "don't touch these" instruction in more than one place, without distinguishing which of the
three is *structurally* blocked (the second-call Task agent inherits a worktree it didn't create or
`EnterWorktree` itself, so it cannot `ExitWorktree`/`git worktree remove` it) from which are *plain
writes with no worktree dependency* (claim release via `release-claim.js`, run-dir archival) that
the agent can and, on some outcomes, must still perform:

- `settle-and-merge.md` lines 164-166 (the `local-merge` Auto-merge-gate success path): *"Do not
  run `git merge`, do not run `ExitWorktree`/`git worktree remove`, and do not run wrap-up's own
  Item 4 (worktree removal), Item 7 (issue claim release), or Item 8 (run-dir archival) — all three
  depend on a merge that has not happened yet."* — the stated rationale ("all three depend on a
  merge that has not happened yet") is true for worktree removal but not for claim release or
  archival, which don't require merge access at all.
- `settle-and-merge.md` line 243 (the local-merge conflict-abort branch): *"Leave the worktree and
  run dir parked exactly as an ordinary un-pushed `pending-review` outcome does today ... — no Item
  4/7/8 cleanup on this branch."* Bundles all three again under one instruction.
- `task-prompt.md` lines 122-127 (the second call's `local-merge` `OUTCOME` definitions): the
  `ready-to-merge` value's own description says *"Stop right after labeling -- do not run worktree
  removal, claim release, or run-dir archival."*

During a live dispatch firing (#370, #421, #422, #424, 2026-08-14), two second-call subagents
correctly recognized they couldn't `ExitWorktree` a worktree they didn't create, then
over-generalized that structural constraint into also skipping claim release and run-dir archival
for outcomes where those two are plain, unblocked writes. One of the two also mislabeled a
completed `pr-opened`-shaped hand-off (`task-prompt.md` lines 129-133 — under `pr-first`,
`pending-review` now also covers what `pr-opened` used to name separately) as `pending-review`
without checking the run's actual PR/claim state first.

The one place that *does* separate the two correctly — `settle-and-merge.md`'s Settle procedure
(Step 6, step 2: `release-claim.js` runs unconditionally on a HARD-GATE failure, independent of any
worktree action) — is far enough from the bundled passages above, and never states the general
principle explicitly, that it's easy for an agent following one of the bundled passages to miss.

## Deliverables

- In `task-prompt.md`'s second-call template and `settle-and-merge.md`, state the `ExitWorktree`/
  worktree-removal constraint as **outcome-independent** — a structural fact ("this call inherited a
  worktree it did not create, so it can never tear it down, on any outcome") stated once, separately
  from any specific `OUTCOME` branch's cleanup instructions, rather than re-derived per branch.
- Separate "defer worktree removal" from "defer claim release/archival" everywhere the current text
  bundles them (the three passages quoted in Current State, and any other passage the sweep below
  turns up): each `OUTCOME` branch states its own claim-release and run-dir-archival disposition
  explicitly, rather than inheriting it from the worktree-removal instruction's rationale.
- Add explicit guidance, at the point an agent is about to choose/report an `OUTCOME` value, to
  check the record's actual claim-blob (`claims/issue-{n}.json`) and label state (`bot:in-progress`,
  `auto:merge`, any `run-state.json` `pr` object) rather than inferring it from what the agent itself
  did earlier in the same call — the mislabeled `pending-review` incident happened without that
  check.
- Sweep both files (and `dispatch/SKILL.md`'s Reporting section, and
  `skills/dispatch/two-call-gate.md`, if either restates the same bundling) for any other passage
  that conflates the three cleanup items under one instruction, and apply the same separation.

## Acceptance Criteria

- `settle-and-merge.md` lines 164-166 and line 243, and `task-prompt.md` lines 122-127, no longer
  attribute the "do not run" instruction for claim release or run-dir archival to the same rationale
  as the worktree-removal constraint — each item's disposition (deferred vs. run-now) is justified on
  its own terms for that `OUTCOME` branch.
- A reader following only `task-prompt.md`'s second-call template (without also finding
  `settle-and-merge.md` Step 6's Settle procedure by cross-reference) can correctly determine, for
  every `OUTCOME` value the template defines (`merged`/`armed`/`pending-review`/`ready-to-merge`/
  `failed`/`blocked`), whether claim release and run-dir archival run in this call or are deferred —
  without needing to infer it from the worktree-removal rule.
- The genuine "ordinary un-pushed `pending-review`" parking case (`dispatch/SKILL.md`'s Reporting
  section: a run a human may still resume) and the local-merge conflict-abort case
  (`settle-and-merge.md` line 243) still legitimately defer all three together — the edit must not
  force claim release or archival onto a run that's genuinely still open and awaiting a human, only
  remove the *implication* that this is true for every outcome by the same reasoning.
- The `OUTCOME`-selection guidance added per the third Deliverable is concrete and checkable — it
  names the specific claim-blob/label/`run-state.json` fields to read, not just "verify state first."
- `npm test` passes (prose-conformance suites over `skills/**/*.md` — no code changes expected, but
  any line-number or quoted-passage cross-reference elsewhere in the corpus that pins the edited text
  must be updated too).

## Technical Approach

Edit the three passages quoted in Current State directly:

1. `settle-and-merge.md` lines 164-166 — split into two sentences: one stating the worktree
   constraint as structural and outcome-independent (move it earlier in the file, near where the
   second call's inherited-worktree fact is first established, per Deliverable 1), one stating that
   Items 7/8 (claim release, run-dir archival) are unaffected on this specific branch because the
   merge never happened and the outcome is not yet terminal — name that as the actual reason, not
   "depends on a merge."
2. `settle-and-merge.md` line 243 — same split; state explicitly that this conflict-abort case parks
   claim + archival because the run is being left for a human to resume (matching
   `dispatch/SKILL.md`'s Reporting-section rationale for ordinary `pending-review`), not merely
   because it's grouped with worktree removal.
3. `task-prompt.md` lines 122-127 — same split for the `ready-to-merge` `OUTCOME` value's
   description.
4. Add the `OUTCOME`-selection state-check guidance (Deliverable 3) either as a short paragraph
   immediately before `task-prompt.md`'s `OUTPUT FORMAT` block, or as a addition to
   `settle-and-merge.md`'s Settle procedure's opening — wherever the second call's template already
   establishes the shared context for choosing among `OUTCOME` values.
5. Grep both files plus `dispatch/SKILL.md` and `two-call-gate.md` for `Item 4`, `Item 7`, `Item 8`,
   `ExitWorktree`, and `worktree removal` to confirm no other passage bundles the three items under
   one undifferentiated instruction; apply the same separation to any hit the initial read above
   didn't already cover.

## Gotchas

- Two passages (`settle-and-merge.md` line 243, and `dispatch/SKILL.md`'s ordinary
  `pending-review`-parking Reporting section) legitimately defer worktree removal, claim release,
  *and* archival together, because the run genuinely isn't finished and a human may resume it — the
  fix must preserve that bundled deferral for those specific cases while removing the *implicit
  generalization* that it holds for every outcome. Don't over-correct into always running claim
  release/archival regardless of outcome.
- The structural `ExitWorktree` constraint is real and must not be weakened: a Task-tool subagent
  genuinely cannot tear down a worktree it did not `EnterWorktree` itself (`dispatch/SKILL.md`
  Step 5's sequential-execution note). The fix separates this from claim/archival deferral; it does
  not relax it.
- `pending-review` under `integration-model: pr-first` now also covers what `pr-opened` used to name
  separately (`task-prompt.md` lines 129-133) — the state-check guidance added here must give an
  agent enough to distinguish a run that's actually still pending human review from one that already
  completed a hand-off, since that's the specific mislabeling the live incident produced.

## Original request

dispatch: second-call templates conflate worktree-removal deferral with claim/archival deferral

**Related:** none

Context: During a live dispatch firing (#370,#421,#422,#424, 2026-08-14), two second-call subagents correctly found they can't ExitWorktree a worktree they didn't create, then over-generalized that into also skipping issue-claim release and run-dir archival (plain writes with no worktree dependency) for non-ready-to-merge outcomes. One also mislabeled a completed pr-opened hand-off as pending-review.

Scope: task-prompt.md's second-call template and settle-and-merge.md should state the ExitWorktree constraint as outcome-independent, separate "defer worktree removal" from "defer claim release/archival", and require checking actual claim-blob/label state before choosing the OUTCOME value.

