## Staged: Delete orphan ledger + Close (GitHub) — docs/plans/2026-10-02-record-2740-bundle-ledger.md

Finding: [ledger] 2026-10-02-record-2740-bundle-ledger.md — no open row; its run dir (2026-10-02T110307-record-2740-…) exists only under archive/ → Delete (orphan). One open by:docs-health record (#3037) targets this ledger's Item 5 for a staleness edit; deleting the ledger moots it. Note: #3037's body says Item 5's skill-pattern decision (a same-change citation rule for cli-wrapper-contract.md) is undiscoverable — reject this item instead if that decision should survive as its own record.
Proposed: delete the ledger and close #3037 as moot (target doc deleted as orphaned).

Rows:
- git rm docs/plans/2026-10-02-record-2740-bundle-ledger.md
- Close (GitHub) #3037 — Doc staleness: ledger Open Items table — Item 5

Commands:
git rm docs/plans/2026-10-02-record-2740-bundle-ledger.md
gh issue comment 3037 --body "Closing as moot: /tidy deleted docs/plans/2026-10-02-record-2740-bundle-ledger.md as an orphaned ledger (no open rows, run archived)."
gh issue close 3037 --reason "not planned"
