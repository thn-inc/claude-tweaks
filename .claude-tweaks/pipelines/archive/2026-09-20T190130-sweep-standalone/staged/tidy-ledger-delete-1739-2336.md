# Staged: Delete ledger docs/plans/2026-09-18-record-1739-2336-ledger.md

**Finding:** `[ledger] docs/plans/2026-09-18-record-1739-2336-ledger.md — Delete (orphan)` — zero `open` rows, no live (non-archive) pipeline directory matches record #1739 or #2336 (only archived copies exist: `.claude-tweaks/pipelines/archive/2026-09-14T133353-record-1739-1778-2336`, `.claude-tweaks/pipelines/archive/2026-09-18T082615-record-1739-2336`).

**Referencing records found (2):** deleting this ledger cannot proceed as a bare file delete — two open records reference it in their body text:
- **#2597** — "npm test: 30 pre-existing failures on main HEAD (bff1359), several distinct root causes — found during #1739/#2336 build group review" (OPEN)
- **#2598** — "dispatch/task-prompt.md's second-call template contradicts itself on run-dir archival for OUTCOME: merged" (OPEN, body mentions the #1739/#2336 build group)

**Proposed action (one combined mutation, per `tidy/scan-procedures.md` Step 4's referencing-record rule):**
1. `git rm docs/plans/2026-09-18-record-1739-2336-ledger.md`
2. `gh issue comment 2597 --body "Closing — the #1739/#2336 ledger this finding referenced has been deleted as orphaned by /claude-tweaks:tidy; the underlying npm-test-failures finding stands on its own and should be re-filed as its own record if still relevant, rather than left pointing at a deleted ledger."` then `gh issue close 2597 --reason "not planned"`
3. `gh issue comment 2598 --body "Closing — the #1739/#2336 ledger this record's body referenced has been deleted as orphaned by /claude-tweaks:tidy."` then `gh issue close 2598 --reason "not planned"`

**Why staged, not auto-applied:** closing a GitHub issue is an outward-facing write forbidden at every `tidy-aggressiveness` tier by the auto-mode contract's reversibility floor. Approve via `/claude-tweaks:tidy --approve` after confirming #2597 and #2598 are genuinely resolved by the ledger's removal (or judge separately whether #2597's npm-test-failures finding deserves its own record first).
