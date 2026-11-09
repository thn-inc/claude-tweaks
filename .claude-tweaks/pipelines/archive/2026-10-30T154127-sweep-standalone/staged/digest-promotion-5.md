# Staged: Propose digest cluster — review (3 entries)

**Proposed:** file one backlog record "Settle 3 below-floor digest findings in review" absorbing 3 un-promoted `[review]` entries from digest #1426, then append `→ #{new}` to each promoted entry line.

## Proposed record body

## Current State

3 below-floor findings in the `review` area sit un-promoted in the rolling digest (#1426). Each was deferred individually under the materiality floor; together they cross Step 5.6's 3-entry cluster threshold.

## Deliverables

- The rename-old-path test accepts either merged or conflict, so it does not pin the merge decision its name implies (tiebreak evidence unverified) — `tests/bin-lib/pre-review-catchup/cli.test.js:275`
- new acceptance-scan conformance suite is 508 lines, 2-6x its sibling conformance suites (tiebreak evidence fell outside the location window, unverified) — `tests/acceptance-scan-server-filter.test.js`
- a filed review-followup- proposal gets no open-items ledger write-back — `the console queue-write step has none, as for ledger-record-* (#4484 review, lens 3e)`

## Acceptance Criteria

- Each Deliverables bullet is either fixed (with a test where behaviour changes) or closed out with a one-line rationale in the PR body.
- Every promoted digest line in #1426 carries `→ #{this record}`.

## Source entries (digest #1426)

- materiality-a741e6c1 — https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6476790372
- materiality-55c09c3b — https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6516688044
- materiality-067f68fa — https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6518866799
