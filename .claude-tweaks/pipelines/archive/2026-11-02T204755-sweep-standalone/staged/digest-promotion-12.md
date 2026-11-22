# Staged: Propose digest cluster — plan-retention (4 entries)

**Container:** #1426 (digest)
**Proposed record title:** Settle 4 below-floor digest findings in plan-retention

## Current State

4 un-promoted digest entries in #1426 share the area `plan-retention`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- archiveDeclineFingerprint re-derives declined-learning.js computeFingerprint (reflect-apply.js holds a third copy) — plugin/bin/lib/plan-retention/probe.js:17 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- RETENTION_VALUES hardcodes the superpowers-plans-retention enum with no test asserting it equals policy-schema.js — plugin/bin/lib/plan-retention/route.js:15 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- run from a repo subdirectory the git probe returns empty, every plan reads UNCOMMITTED with no stderr line, contradicting the line 121-122 comment — plugin/bin/plan-retention.js:127 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- firstAddedDate runs one git log per plan serially with no timeout; one history walk would give every first-add date — plugin/bin/lib/plan-retention/probe.js:31 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #1426 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-bada8ddf (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-1164b61f (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-799f7b24 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-1df9c911 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
