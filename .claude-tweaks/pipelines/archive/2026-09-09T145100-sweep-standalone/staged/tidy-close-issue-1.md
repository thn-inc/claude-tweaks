# Staged: Close (GitHub) — #1878 (flagged doc demonstrably gone)

**Finding:** `[gh-issue] #1878: Doc staleness: plans/2026-08-28-record-1058-ledger — Freshness` (`by:docs-health`, `ready`, `bot:blocked`) — the flagged doc `docs/plans/2026-08-28-record-1058-ledger.md` was deleted by commit a40fbdc24 ("Tidy: remove 3 completed execution plans and 3 orphaned ledgers (#1969)"). The record's only deliverable (fix a stale row in that ledger) has no remaining target — the same shape #1804 already documented for its own deleted ledger.

**Proposed:** Close #1878 as not planned — flagged doc deleted in #1969, nothing left to fix.

**Why staged:** Delete/Close of a `github-issues` record is Stage at every tier (visible to collaborators; reversibility floor). This supersedes the `[blocked]` re-triage row for the same record.

**Commands:**
gh issue comment 1878 --body "Closing: the flagged doc docs/plans/2026-08-28-record-1058-ledger.md was deleted by a40fbdc24 (#1969 tidy sweep), so this staleness fix has no remaining target. Filed by /claude-tweaks:tidy (sweep run 2026-09-09T145100)."
gh issue close 1878 --reason "not planned"
