# Staged: Close (GitHub) — CLAUDE.md is back under the 150-line budget (147 lines on main)

**Finding:** `[gh-issue]` #1914 (filed 2026-09-05 by #1634's wrap-up curation row) reports CLAUDE.md at 151 lines against `harness-health-always-loaded-budget` = 150. On `main` today `wc -l CLAUDE.md` is 147 and `wc -c` is 22521 B (byte ceiling 24576 in `tests/claude-md-budget.test.js`). Two later commits did the editorial trim the record asked for: `690adad59` (refs #1920 — pointed the run-directory description at `pipeline-run-dir.md` and folded the `/help` diagram bullets, "back at the 150-line budget") and `ec589b3dc` (refs #1987 — "CLAUDE.md back under its 150-line budget"), plus `35f14e3c0` removed a duplicate Cross-references pointer. The record's own AC (`wc -l CLAUDE.md` ≤ 150, byte test green, no governance rule dropped without a pointer) is met by those commits; the record stayed open because neither cited it.

**Proposed:** Close #1914 as completed — resolved by commits `690adad59` and `ec589b3dc`.

**Why staged:** closing a `github-issues` record is an outward-facing write, Stage at every tier.

**Rows:**
- #1914 — CLAUDE.md 147 lines / 22521 B on `main`; trimmed by `690adad59` (#1920) and `ec589b3dc` (#1987)

**Commands:**
gh issue comment 1914 --body "Closing as resolved: CLAUDE.md is 147 lines (22521 B) on main — commits 690adad59 (refs #1920) and ec589b3dc (refs #1987) trimmed it back under the 150-line harness-health-always-loaded-budget with content moved to pipeline-run-dir.md and the /help diagram bullets folded, and tests/claude-md-budget.test.js stays green. Filed by /claude-tweaks:sweep (run 2026-09-09T145100)."
gh issue close 1914 --reason completed
