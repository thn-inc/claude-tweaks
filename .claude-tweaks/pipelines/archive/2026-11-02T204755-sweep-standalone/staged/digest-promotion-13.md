# Staged: Propose digest cluster — build (3 entries)

**Container:** #1426 (digest)
**Proposed record title:** Settle 3 below-floor digest findings in build

## Current State

3 un-promoted digest entries in #1426 share the area `build`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- records parse of empty string yields [0]; deferred — plugin/skills/build/adopted-branch-collision-check.md:44 — Defer-reason: console-backfill-confirmed-low — 2026-10-21T215830-record-3887
- (low — zero-finding final review has no defined findings content) not directly verified. Reviewer read: the file is written whenever the review was dispatched and a clean review's verbatim output carr — plugin/skills/build/dispatch.md:14 — Defer-reason: console-backfill-confirmed-low — 2026-10-17T111000-spec-3376-3386/spec-3386
- absence-grep run-dir exclusion rule in plan-authoring-checks.md is a diverged subset of specify/spec-template.md:68; copies pinned separately — plugin/skills/build/plan-authoring-checks.md:71 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #1426 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-ceba50ff (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6382860507)
- materiality-3da568f7 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6383162471)
- materiality-6eff0d17 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
