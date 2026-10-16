## Staged: Delete orphan ledger + Close (GitHub) — docs/plans/2026-10-02-flow-spec-2701-2705-ledger.md

Finding: [ledger] 2026-10-02-flow-spec-2701-2705-ledger.md — no open row; its run dir (2026-10-02T082147-record-2701) exists only under archive/ → Delete (orphan). Two open by:docs-health records target this ledger's rows for a staleness edit; deleting the ledger moots both.
Proposed: delete the ledger and close #3010 and #3011 as moot (target doc deleted as orphaned).

Rows:
- git rm docs/plans/2026-10-02-flow-spec-2701-2705-ledger.md
- Close (GitHub) #3010 — Doc staleness: ledger Open Items table — Item 1
- Close (GitHub) #3011 — Doc staleness: ledger Open Items table — Item 2

Commands:
git rm docs/plans/2026-10-02-flow-spec-2701-2705-ledger.md
gh issue comment 3010 --body "Closing as moot: /tidy deleted docs/plans/2026-10-02-flow-spec-2701-2705-ledger.md as an orphaned ledger (no open rows, run archived)."
gh issue close 3010 --reason "not planned"
gh issue comment 3011 --body "Closing as moot: /tidy deleted docs/plans/2026-10-02-flow-spec-2701-2705-ledger.md as an orphaned ledger (no open rows, run archived)."
gh issue close 3011 --reason "not planned"
