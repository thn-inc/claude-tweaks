# Staged: Propose digest cluster — reconcile (15 entries)

**Source:** digest container #1426, 15 un-promoted entries sharing `{area}` = `reconcile`.

**Proposed:** file one backlog record absorbing them; on approval append `→ #{new}` to each promoted entry line in #1426.

## Proposed record: Settle 15 below-floor digest findings in reconcile

### Current State

Digest #1426 holds 15 below-materiality-floor findings in `reconcile`, accumulated by review/reflect/wrap-up runs and never promoted.

### Deliverables

- [reconcile] Un-archived, terminal (status: clean) pipeline run dir `.claude-tweaks/pipelines/2026-08-24T183144-record-1094` found by this run's residue sweep (`bin/residue.js --scope blast-radius`) — remedy:auto attempted via `hooks.js archive-run --run {path}` but failed `git-mv-failed` (this session is worktree-isolated and cannot perform a main-checkout git mv). — Defer-reason: blocked-external — 2026-08-25T150921-record-1420
- [reconcile] No claim recoverable (claim-empty): spec #3412 — Step 3 reproduction: Reproduction: lens "3a" finding plugin/bin/lib/reconcile/pr-state.js:158 not reproduced. — plugin/bin/lib/reconcile/pr-state.js:158 — Defer-reason: console-backfill-no-claim — 2026-10-17T192303-spec-3412
- [reconcile] No claim recoverable (claim-empty): spec #3412 — Step 3 reproduction: Reproduction: lens "3a" finding plugin/bin/lib/reconcile/release-merged.js:584 not reproduced. — plugin/bin/lib/reconcile/release-merged.js:584 — Defer-reason: console-backfill-no-claim — 2026-10-17T192303-spec-3412
- [reconcile] No claim recoverable (claim-empty): spec #3412 — Step 3 reproduction: Reproduction: lens "3f" finding plugin/bin/lib/reconcile/release-merged.js:493 not reproduced. — plugin/bin/lib/reconcile/release-merged.js:493 — Defer-reason: console-backfill-no-claim — 2026-10-17T192303-spec-3412
- [reconcile] No claim recoverable (claim-empty): spec #3412 — Step 3 reproduction: Reproduction: lens "3f" finding plugin/bin/lib/reconcile/release-merged.js:520 not reproduced. — plugin/bin/lib/reconcile/release-merged.js:520 — Defer-reason: console-backfill-no-claim — 2026-10-17T192303-spec-3412
- [reconcile] (newline in a committed ledger filename reaches the SessionStart banner and PR body; needs write access to the integration branch). — plugin/bin/lib/reconcile/ledger-residue.js:61 — Defer-reason: console-backfill-confirmed-low — 2026-10-21T233004-record-3812
- [reconcile] (shared runGit lacks an env option; hand-rolled runner) as one finding. — plugin/bin/lib/reconcile/ledger-residue.js:178 — Defer-reason: console-backfill-confirmed-low — 2026-10-21T233004-record-3812
- [reconcile] fetch-failed names a mirror the caller never requested (3c-A); (4) — plugin/bin/lib/reconcile/index.js:349 — Defer-reason: console-backfill-confirmed-low — 2026-10-21T230143-record-3630
- [reconcile] docs do not mention fastChecksShape routing for expanded subsets (3a-B); (5) — plugin/bin/lib/reconcile/index.js:233 — Defer-reason: console-backfill-confirmed-low — 2026-10-21T230143-record-3630
- [reconcile] classifyLedgerCandidate lazily requires ../wrap-up/pack inside the function with no reason comment (review-12) — plugin/bin/lib/reconcile/ledger-residue.js:124 — Defer-reason: pre-existing-outside-diff — 2026-10-21T194624-release-standalone
- [reconcile] defaultListRemovalPrs/defaultCreatePr ignore gh stderr, collapsing permission/validation failures to quiet gh-absent/network-failure skips that repeat every pass with no cause shown (review-13) — plugin/bin/lib/reconcile/ledger-residue.js:203, plugin/bin/lib/reconcile/ledger-residue.js:234 — Defer-reason: pre-existing-outside-diff — 2026-10-21T194624-release-standalone
- [reconcile] (B, same substance: a failed commit fetch collapses into pr-merged-not-closing) at the same line. — plugin/bin/lib/reconcile/release-merged.js:523 — Defer-reason: console-backfill-confirmed-low — 2026-10-17T192303-spec-3412
- [reconcile] (older gh builds reject an unknown --json field, no version fallback) . not elevated: the reviewing pass did not verify which gh version introduced closingIssuesReferences. — plugin/bin/lib/reconcile/pr-state.js:39 — Defer-reason: console-backfill-confirmed-low — 2026-10-17T192303-spec-3412
- [reconcile] a console.json item carrying a pre-existing note keeps it when its new outcome (executed) carries none; no producer writes a note at render time today — plugin/bin/lib/reconcile/console-execute.js — Defer-reason: blocked-dependency — 2026-10-25T134357-record-4172
- [reconcile] consoleResidueHint re-reads console files on the skip path; revisit if archive sweeps over many residue runs show measurable cost — plugin/bin/lib/reconcile/archive-merged.js — Defer-reason: blocked-external — 2026-10-25T134357-record-4172

### Acceptance Criteria

- Each Deliverables entry is fixed, or explicitly dropped with a one-line reason in this record.
- Each promoted entry line in #1426 carries `→ #{this record}`.
