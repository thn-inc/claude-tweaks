# Staged: Propose digest cluster — tiebreak (4 entries)

**Source:** digest container #1426, 4 un-promoted entries sharing `{area}` = `tiebreak`.

**Proposed:** file one backlog record absorbing them; on approval append `→ #{new}` to each promoted entry line in #1426.

## Proposed record: Settle 4 below-floor digest findings in tiebreak

### Current State

Digest #1426 holds 4 below-materiality-floor findings in `tiebreak`, accumulated by review/reflect/wrap-up runs and never promoted.

### Deliverables

- [tiebreak] SEVERITIES duplicates coordination.js SEVERITY_RANK (unexported); a severity added there never reaches the tiebreak reply parser (review-7) — plugin/bin/lib/tiebreak.js:53 — Defer-reason: pre-existing-outside-diff — 2026-10-21T194624-release-standalone
- [tiebreak] checkTiebreakCoverage maps every decisions.md read error (EACCES/EISDIR/EIO) to "no lines", so archival refuses as tiebreak-coverage-missing and tells the user to re-run a tiebreak that cannot fix an unreadable file; split ENOENT like readFindingsArtifact (review-8) — plugin/bin/lib/tiebreak.js:399 — Defer-reason: pre-existing-outside-diff — 2026-10-21T194624-release-standalone
- [tiebreak] checkTiebreakCoverage builds verdictLineRe per finding per decisions.md line and runs eagerly for every run dir each reconcile pass; hoist the regex, evaluate lazily (review-9) — plugin/bin/lib/tiebreak.js:402 — Defer-reason: pre-existing-outside-diff — 2026-10-21T194624-release-standalone
- [tiebreak] confirmed verdict takes lower(reporterSev, tiebreakSev) while drop and cannot-tell take the higher; rationale only in #3945, needs a why-comment (review-10) — plugin/bin/lib/tiebreak.js:303 — Defer-reason: pre-existing-outside-diff — 2026-10-21T194624-release-standalone

### Acceptance Criteria

- Each Deliverables entry is fixed, or explicitly dropped with a one-line reason in this record.
- Each promoted entry line in #1426 carries `→ #{this record}`.
