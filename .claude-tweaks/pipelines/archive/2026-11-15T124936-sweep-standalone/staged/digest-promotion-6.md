# Staged: Propose digest cluster — ci-health (3 entries)

**Container:** #5046 (digest)
**Proposed record title:** Settle 3 below-floor digest findings in ci-health

## Current State

3 un-promoted digest entries in #5046 share the area `ci-health`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- The --repo slug validator is copied with different character classes: ci-health.js and activity-gather.js share one REPO_RE, lib/express/cli.js allows a leading _ or . and has no dot-segment guard, and ci-gate-record.js only rejects a leading dash, so the same --repo value passes one CLI and fails another; no shared validator exists — plugin/bin/ci-health.js:75, plugin/bin/activity-gather.js:41, plugin/bin/lib/express/cli.js:93, plugin/bin/ci-gate-record.js:73 — Defer-reason: pre-existing-outside-diff — 2026-11-14T210347-release-standalone
- fetchRuns tolerates a null workflow_runs entry but still pushes it, and computeStats reads run.path on it unguarded, so one malformed entry throws past the partial-report and exit 0/2 contract; filter non-object entries in fetchRuns — plugin/bin/lib/ci-health/stats.js:203, plugin/bin/lib/ci-health/fetch.js:109 — Defer-reason: pre-existing-outside-diff — 2026-11-14T210347-release-standalone
- The ci-health heuristic thresholds (MIN_BUCKET_RUNS, TREND_RISING, PUSH_RATE_FLAG, PUSH_SAMPLE_FLOOR, P90_BREACH_MIN_RUNS, DEFAULT_MIN_HEADROOM_PCT) carry no rationale in code or in the #5161 plan, unlike the constants above them — plugin/bin/lib/ci-health/constants.js:43 — Defer-reason: pre-existing-outside-diff — 2026-11-14T210347-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #5046 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fingerprint: materiality-5fd645fc — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6885215314
- materiality-fingerprint: materiality-b29ad00a — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6885215314
- materiality-fingerprint: materiality-d3d142c6 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6885215314
