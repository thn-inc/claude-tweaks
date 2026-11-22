# Staged: Propose digest cluster — timing (3 entries)

**Container:** #5046 (digest)
**Proposed record title:** Settle 3 below-floor digest findings in timing

## Current State

3 un-promoted digest entries in #5046 share the area `timing`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- (TIER_BY_ALIAS reimplements profileOfModel (premise check: profileOfModel is not exported by profiles.js)). — plugin/bin/lib/timing/derive.js:349 — Defer-reason: console-backfill-confirmed-low — 2026-10-17T144508-spec-3375-3380/spec-3375
- unionMs copies the unionMinutes merge loop — plugin/bin/lib/timing/derive.js:59 — Defer-reason: console-backfill-confirmed-low — 2026-10-17T144508-spec-3375-3380/spec-3375
- Convention: per-phase verify rows carry raw durationMs with no slotWaitedMs while totals.verifyMinutes subtracts the queue wait — plugin/bin/lib/timing/derive.js:236 — Defer-reason: pre-existing-outside-diff — 2026-11-11T191623-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #5046 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fingerprint: materiality-00354f7a — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6599044663
- materiality-fingerprint: materiality-709c663b — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6599044663
- materiality-fingerprint: materiality-b0a96adc — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6807300212
