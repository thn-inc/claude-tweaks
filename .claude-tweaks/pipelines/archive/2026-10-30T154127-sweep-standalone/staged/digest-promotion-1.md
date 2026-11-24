# Staged: Propose digest cluster — issues (5 entries)

**Proposed:** file one backlog record "Settle 5 below-floor digest findings in issues" absorbing 5 un-promoted `[issues]` entries from digest #1426, then append `→ #{new}` to each promoted entry line.

## Proposed record body

## Current State

5 below-floor findings in the `issues` area sit un-promoted in the rolling digest (#1426). Each was deferred individually under the materiality floor; together they cross Step 5.6's 3-entry cluster threshold.

## Deliverables

- record.js now has 4 near-identical aliased-GraphQL-query builders (buildNativeDependencyQuery, buildLinkedPRQuery, buildNativeSubIssuesQuery, buildNativeParentQuery) sharing the exact same wrapper shape, differing only in the inner connection-field expression — `a shared `buildAliasedIssueQuery(numbers, fieldExpr)` helper would collapse all four`
- No test covers a duplicate in-flight id (liveIds dedupe); controller read: gh issue list never returns one record twice, so the input is hypothetical. — `plugin/bin/lib/issues/grouping.js:281`
- The MCP stale-claim path pages until exhausted with no cap, while the gh path stops at OPEN_PR_LIST_LIMIT. — `plugin/skills/_shared/issue-claims.md:183`
- Markdown fence and section primitives live in the record-payload builder and are imported across domains by merge-gate.js. — `plugin/bin/lib/issues/record-payload.js:97`
- The comment above scanFences describes [start,end] ranges; it returns { ranges, unclosed } and unclosed is undocumented. — `plugin/bin/lib/issues/record-payload.js:96`

## Acceptance Criteria

- Each Deliverables bullet is either fixed (with a test where behaviour changes) or closed out with a one-line rationale in the PR body.
- Every promoted digest line in #1426 carries `→ #{this record}`.

## Source entries (digest #1426)

-  — https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-5443626563
- materiality-60c398ca — https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6383162471
- materiality-5267d483 — https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6525082273
- materiality-5741dadb — https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6525082273
- materiality-801923a8 — https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6525082273
