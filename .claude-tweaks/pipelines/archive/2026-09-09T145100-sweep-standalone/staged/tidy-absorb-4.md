# Staged: Absorb — #1867 → #1785

**Finding:** `[gh-issue] #1867: worktree-isolation Bash guard: refuses read-only sed/cat when the file path comes from a shell variable` (`bug`, `priority:high`) — the same class as #1785 (the Claude Code harness's worktree-session guard refusing commands with runtime-computed arguments; not `pre-tool-use.js`, per the plugin-wide grep recorded on #1785). #1785's Deliverables and Acceptance Criteria now name #1867's two read-only shapes alongside its own six, for the §7 addendum, the dispatch-prompt constraint text, and the upstream report.

**Proposed:** Absorb #1867 into #1785 — comment `Absorbed into #1785.` and close with `--reason "not planned"`.

**Why staged:** Absorb of a `github-issues` record closes an issue — Stage at every tier.

**Commands:**
gh issue comment 1867 --body "Absorbed into #1785 (harness worktree-guard false positives; your two read-only shapes are now in its Deliverables/AC). The guard is the Claude Code harness's, not bin/lib/hooks/pre-tool-use.js."
gh issue close 1867 --reason "not planned"
