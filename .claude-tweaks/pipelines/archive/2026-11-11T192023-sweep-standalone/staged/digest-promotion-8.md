# Staged: Propose digest cluster — issues (3 entries)

**Container:** #5046 (digest)
**Proposed record title:** Settle 3 below-floor digest findings in issues

## Current State

3 un-promoted digest entries in #5046 share the area `issues`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- cross-repo-states.js retypes preflight-records.js's bounded oneLine instead of sharing it from shared-primitives.js, and dispatch-resume.js:331 prints a failed foreign-state lookup's unbounded execFileSync message (the whole aliased GraphQL query), burying gh's real diagnostic — plugin/bin/lib/issues/cross-repo-states.js:162, plugin/bin/preflight-records.js:342, plugin/bin/dispatch-resume.js:331 — Defer-reason: pre-existing-outside-diff — 2026-11-04T064731-release-standalone
- PROSE_DEP_RE (/blocked by\b[^\n#]*#\d+/i) is quadratic on a body repeating "blocked by" with no # (88 KB in 410 ms), and perf/cross-repo-dependency-linearity.test.js does not cover it — plugin/bin/lib/issues/ranking.js:102, perf/cross-repo-dependency-linearity.test.js — Defer-reason: pre-existing-outside-diff — 2026-11-04T064731-release-standalone
- defaultGhApi cwd test asserts GH_HOST unset for a no-cwd call, so it fails on a checkout whose origin resolves to a GHE host — tests/bin-lib/issues/claim-store.test.js — Defer-reason: pre-existing-outside-diff — 2026-11-05T071125-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #5046 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fingerprint: materiality-b4e321c9 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6637961522
- materiality-fingerprint: materiality-6ecfd2a0 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6637961522
- materiality-fingerprint: materiality-ec50174d — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6652461692
