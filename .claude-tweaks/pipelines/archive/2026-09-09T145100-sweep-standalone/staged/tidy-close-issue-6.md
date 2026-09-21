# Staged: Close (GitHub) — bookkeeping-stamps inherited-upstream false negative already fixed

**Finding:** `[gh-issue]` #1755 (filed by `reflect` from #1684's run) reports that `hasNoUpstreamYet` in `plugin/bin/lib/hooks/pre-tool-use.js` treats a worktree branch whose tracking config was inherited from `origin/main` at `git worktree add` time as already pushed, denying the initial pr-early push. This is the identical trigger #1860 described; PR #1874 (merged 2026-09-05) changed the check to compare the resolved `@{u}` ref name against `origin/{branch}`, so an inherited `origin/main` tracking ref now classifies as never-pushed, with coverage in `tests/hooks-bookkeeping-stamps-gate.test.js`.

**Proposed:** Close #1755 as completed — implemented by #1860 / PR #1874.

**Why staged:** closing a `github-issues` record is an outward-facing write, Stage at every tier.

**Rows:**
- #1755 — duplicate trigger of #1860 (CLOSED 2026-09-05), PR #1874 MERGED 2026-09-05

**Commands:**
gh issue comment 1755 --body "Closing as implemented: #1860 / PR #1874 (2026-09-05) made hasNoUpstreamYet compare the resolved upstream against origin/{branch}, so an inherited origin/main tracking ref is classified as never-pushed. Filed by /claude-tweaks:sweep (run 2026-09-09T145100)."
gh issue close 1755 --reason completed
