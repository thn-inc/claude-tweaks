# Staged: Absorb (GitHub) — #1810 into #1826 (two-call handoff leaves config.yml missing)

**Finding:** `[gh-issue]` #1810 (feedback, plugin 6.114.1) reports a `/claude-tweaks:dispatch` two-call handoff whose second `/flow` call found the anchored run dir without `config.yml` although the first call completed and logged the Manifesto write; case 3's prose misfit and the Manifesto write logs no path. #1826 (shaped by this sweep, `ready`) already consolidates this class — it absorbs #1832 and #1858, names the worktree-shadow write hypothesis, and extends `preflight.js` case 2/3. #1826's body was amended on 2026-09-09 with #1810's run as a fourth instance and its three concrete shapes (log the absolute path; prefer the `decisions.md` snapshot header in case 3; widen case 3's description). #1810 also cites #1580 as open; it closed before this sweep.

**Proposed:** Close #1810 as absorbed into #1826.

**Why staged:** closing and commenting on `github-issues` records are outward-facing writes, Stage at every tier.

**Rows:**
- #1810 — → #1826 (OPEN, ready); three shapes folded into #1826's Deliverables and AC 7

**Commands:**
gh issue comment 1810 --body "Absorbed into #1826 (the consolidated two-call handoff record): your three suggestions — absolute-path logging on the Manifesto write, the decisions.md snapshot header as case 3's preferred lever source, and the widened case-3 description — are now Deliverables and AC 7 there, and this run is its fourth named instance. Filed by /claude-tweaks:sweep (run 2026-09-09T145100)."
gh issue close 1810 --reason "not planned"
