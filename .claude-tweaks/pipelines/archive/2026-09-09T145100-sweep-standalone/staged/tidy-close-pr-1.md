# Staged: Close (GitHub) — PR #1885 (superseded)

**Finding:** `[pr] PR #1885: Distinct bot:parked label for merge-verification parks (#605) — superseded` — draft, `mergeStateStatus: DIRTY/CONFLICTING`, CI FAILURE, opened 2026-09-05 from branch `worktree-record-605`, no `<!-- run-comment: failure -->` tombstone. Record #605 is `bot:in-progress` under a newer live run (`2026-09-09T101742-record-605`, claim present) whose own draft PR #2213 (branch `worktree-dispatch-record-605`) now carries the same work.

**Proposed:** Close PR #1885 as superseded by PR #2213, with an explanatory comment (never a silent close).

**Why staged:** Close (GitHub) is an outward-facing GitHub mutation — Stage at every tier per `_shared/auto-mode-contract.md`'s reversibility floor.

**Re-verify before writing:** confirm #2213 is still open and #1885 still has no tombstone comment and no newer commits; if #2213 closed or #1885 advanced, skip.

**Commands:**
gh pr comment 1885 --body "Closing as superseded: record #605 is being rebuilt under run 2026-09-09T101742-record-605 (PR #2213); this earlier draft is conflicting (DIRTY) with failing CI. Filed by /claude-tweaks:tidy (sweep run 2026-09-09T145100)."
gh pr close 1885
