# Staged: Propose digest cluster — console (6 entries)

**Container:** #1426 (digest)
**Proposed record title:** Settle 6 below-floor digest findings in console

## Current State

6 un-promoted digest entries in #1426 share the area `console`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- The #4563 comment for debateConvergedKeys is stranded above FINDING_PATH, and the function at line 514 has no comment. — plugin/bin/lib/console/resolve.js:503 — Defer-reason: pre-existing-outside-diff — 2026-10-30T134829-release-standalone
- backfill.js FIRST_LOCATION_RE duplicates resolve.js unexported FINDING_LOC_RE — plugin/bin/lib/console/backfill.js:33 — Defer-reason: pre-existing-outside-diff — 2026-10-31T142701-release-standalone
- tiebreakModel.settledAfter defaults its shorts argument to keys; a caller omitting it would silently ignore prose settlers (both callers pass it today) — plugin/bin/lib/console/resolve.js:843 — Defer-reason: pre-existing-outside-diff — /claude-tweaks:release v6.160.1 release-gate review (run 2026-11-01T204406-release-standalone)
- The refused-row comment documents only the "kept staged." log ending, not #4772's ledger-origin "; ledger row reopened, staged file removed." ending (the regex is ending-agnostic) — plugin/bin/lib/console/resolve.js:360 — Defer-reason: pre-existing-outside-diff — /claude-tweaks:release v6.160.1 release-gate review (run 2026-11-01T204406-release-standalone)
- shadow-dup-proposal readNoFollow repeats writeInsideRoot's lstat/open/fstat dev-ino identity check; lib/path-guard exports no shared helper for it — plugin/bin/shadow-dup-proposal.js,plugin/bin/release-local.js — Defer-reason: needs-human-decision — 2026-11-02T082823-record-4355
- FINDING_LENS (unclosed lens quote) and COINCIDENCE_RE (repeated openers) backtrack quadratically; the linearity perf test covers neither shape — plugin/bin/lib/console/finding-path.js:18, plugin/bin/lib/console/finding-path.js:33 — Defer-reason: pre-existing-outside-diff — 2026-11-02T110901-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #1426 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-ba969ebe (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6525082273)
- materiality-5c89f81c (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6545562270)
- materiality-ac28d954 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6564394898)
- materiality-50c43482 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6564394898)
- materiality-82ca9ce2 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6573186647)
- materiality-9294dabd (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6587419946)
