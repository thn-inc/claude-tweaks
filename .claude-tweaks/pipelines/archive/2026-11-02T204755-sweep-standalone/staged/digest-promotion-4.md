# Staged: Propose digest cluster — reconcile (9 entries)

**Container:** #1426 (digest)
**Proposed record title:** Settle 9 below-floor digest findings in reconcile

## Current State

9 un-promoted digest entries in #1426 share the area `reconcile`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- retry() returns marker-write-failed when the attempt-line write fails, so the run is not deferred before archive — plugin/bin/lib/reconcile/post-merge.js:316 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- a gh-failed skip inside Step 4.0b folds into the permanent marker and is never retried, unlike Step 4.0 — plugin/bin/lib/reconcile/post-merge.js:397 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- the reconciler passes stderr: () => {} to closing-links, so a permanent Step 4.0 SKIP marker records only exit N with no cause — plugin/bin/lib/reconcile/post-merge.js:334 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- the background post-merge budget is checked only between runs, so a hung gh can overrun BACKGROUND_BUDGET_MS — plugin/bin/lib/reconcile/post-merge.js:251 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- post-merge is a forced prerequisite of every archive request, so a scoped reconcile --checks archive also writes to GitHub — plugin/bin/lib/reconcile/index.js:75 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- an unexpected throw in Steps 4.0/4.0b writes an error skip with no deferral, so archive can archive a run whose post-merge steps never ran — plugin/bin/lib/reconcile/post-merge.js:318 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- the fail-closed policy read is restated in post-merge.js and bin/parent-gate.js and already drifts on work-links (parent-gate fails closed, post-merge falls back) — plugin/bin/lib/reconcile/post-merge.js:161, plugin/bin/parent-gate.js:182 — Defer-reason: pre-existing-outside-diff — 2026-11-01T182455-release-standalone
- processCandidate carries single and includeRecords flags only ever set together, a mode switch inside a shared function — plugin/bin/lib/reconcile/post-merge.js — Defer-reason: pre-existing-outside-diff — 2026-11-02T063520-release-standalone
- format-summary.js lazy-requires the post-merge engine for pure classifiers; a leaf post-merge-verdict module would remove the workaround — plugin/bin/lib/reconcile/format-summary.js:46 — Defer-reason: pre-existing-outside-diff — 2026-11-02T110901-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #1426 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-586db236 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-eae54f94 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-5050b8cb (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-bce8677a (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-38ea5e29 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-ee0552af (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-39939d55 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6562568531)
- materiality-95fb603b (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571133505)
- materiality-716dcb85 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6576257391)
