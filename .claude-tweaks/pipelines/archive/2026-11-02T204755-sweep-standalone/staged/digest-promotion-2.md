# Staged: Propose digest cluster — issues (11 entries)

**Container:** #1426 (digest)
**Proposed record title:** Settle 11 below-floor digest findings in issues

## Current State

11 un-promoted digest entries in #1426 share the area `issues`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- renderVerdictMarker is exported from shipped payload with only test callers, contradicting the module header and _shared/pr-run-comments.md (the plugin never authors a verdict marker) — plugin/bin/lib/issues/accept-verdict.js:110 — Defer-reason: pre-existing-outside-diff — 2026-10-31T142701-release-standalone
- ACCEPTANCE_PRECEDENCE comment states only the reader rule; no writer-side duty and no pointer to ADR 0029 — plugin/bin/lib/issues/record-vocabulary.js:124 — Defer-reason: pre-existing-outside-diff — 2026-10-31T142701-release-standalone
- low Performance — N+1 ordering: one gh issue view per sub-issue runs before the single parent-label read (line 164) that can skip the parent as not-parent-issue-labeled or needs-label, so a skipped parent still pays N sequential gh calls; gh api user (line 200) is re-run per parent instead of once per call. — plugin/bin/lib/issues/below-floor-parent-close.js:146 — Defer-reason: pre-existing-outside-diff — 2026-10-31T212421-release-standalone
- low Ownability — closedParentGap calls needsBackstop with a constant parentExceedsFloor: true (line 116) before the floor is evaluated (lines 125-127), as an admit-past-the-parent-exclusion placeholder; needsBackstop (line 90) and its comment read the flag as "the caller shows this parent above the floor", a guarantee its only setter never provides, so a future direct caller trusting the name would raise false acceptance-gap rows. (Reported independently by lenses 3g and 3e.) — plugin/bin/lib/issues/acceptance.js:115 — Defer-reason: pre-existing-outside-diff — 2026-10-31T212421-release-standalone
- gh api user runs once per parent inside closeBelowFloorParents though the login is constant for the call — plugin/bin/lib/issues/below-floor-parent-close.js:193 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- below-floor-parent-close re-implements engine-verify.js sub_issues enumeration with a different empty-result contract — plugin/bin/lib/issues/below-floor-parent-close.js:107 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- closedParentGap header does not list its verdict words (no-sub-issues, unread-sub-issue) — plugin/bin/lib/issues/acceptance.js:120 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- native sub-issue enumeration re-probes the schema once per parent (one extra GraphQL call per distinct parent) — plugin/bin/lib/issues/parent-gate.js:154 — Defer-reason: pre-existing-outside-diff — 2026-11-01T182455-release-standalone
- the parent-gate lib calls bin/fetch-sub-issues.js run() in-process and parses its stdout/exit code; the probe/chunk/retry ladder belongs in a lib function — plugin/bin/lib/issues/parent-gate.js:45 — Defer-reason: pre-existing-outside-diff — 2026-11-01T182455-release-standalone
- gatherGateFacts makes one gh issue view per sub-issue though a batched aliased query now exists — plugin/bin/lib/issues/parent-gate.js:193 — Defer-reason: pre-existing-outside-diff — 2026-11-01T182455-release-standalone
- closeBelowFloorParents sequences its own labels, enumerate and per-sibling gate reads instead of parent-gate.js's gatherGateFacts, and neither names the other, so a gate read added to gatherGateFacts misses the below-floor path — plugin/bin/lib/issues/below-floor-parent-close.js, plugin/bin/lib/issues/parent-gate.js — Defer-reason: pre-existing-outside-diff — 2026-11-02T060818-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #1426 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-1d05437f (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6545562270)
- materiality-894a16f0 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6545562270)
- materiality-c92312a1 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6549793384)
- materiality-6eb4bb2d (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6549793384)
- materiality-35aa9bc9 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-babb63e8 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-8a400720 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-326dac9b (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6562568531)
- materiality-1eb1f62e (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6562568531)
- materiality-f2622f48 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6562568531)
- materiality-032eab51 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571470400)
