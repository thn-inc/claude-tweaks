# Staged: Close (GitHub) — #1501's repro-resistant first-push denial was root-caused and fixed by #1860 (PR #1874)

**Finding:** `[gh-issue]` #1501 (open) reports the #989 no-upstream-yet push exemption not firing for a real first push. Its own investigation comment identifies the cause: the fresh worktree's branch inherited `@{u}` = `origin/main` from its branch-off point, so `hasNoUpstreamYet` correctly saw an upstream and did not exempt. #1860 (closed 2026-09-05, PR #1874 merged 2026-09-05) fixed exactly that: `hasNoUpstreamYet` now distinguishes an inherited tracking ref from the branch's own `origin/{branch}`, with regression tests for the inherited-upstream case. The `CT_HOOKS_DEBUG_CAPTURE` instrumentation #1501 added to chase this (`captureDebugPayload` in `pre-tool-use.js`) is the subject of #1739.

**Proposed:** Close #1501 as completed — fixed by #1860.

**Why staged:** closing a `github-issues` record is an outward-facing write, Stage at every tier.

**Rows:**
- #1501 — root cause (inherited `@{u}`) confirmed in its own comment; fixed by #1860 / PR #1874 (merged 2026-09-05)

**Commands:**
gh issue comment 1501 --body "Closing as fixed: the inherited-upstream root cause recorded in this issue's own investigation was fixed by #1860 (PR #1874, merged 2026-09-05) — hasNoUpstreamYet now treats a tracking ref that points at the branch-off point as never-pushed, with regression coverage. The CT_HOOKS_DEBUG_CAPTURE instrumentation added here is decided under #1739. Filed by /claude-tweaks:sweep (run 2026-09-09T145100)."
gh issue close 1501 --reason completed
