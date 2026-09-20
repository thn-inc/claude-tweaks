# Staged: Absorb — #1832 → #1826

**Finding:** `[gh-issue] #1832: Two independent dispatch firings built the same record-976 file-overlap group; one bypassed claim-targets` — surfaced by the sweep's specify drain. Its remaining deliverable (a `build,test` Task call that executed without `/flow`'s Manifesto/materialize/claim machinery) is the same defect #1826 consolidates (run dirs left uninitialized because the first call bypassed `/flow`); #1826's Current State, Deliverables, and Acceptance Criteria now carry the record-976 occurrence and the claim-step fail-loud requirement first-class. Its other two deliverables are moot at 2026-09-09: `worktree-record-976` exists neither locally nor on origin, #1100/#1484/#976 are CLOSED, PR #1730 is CLOSED, and every group claim is a tombstone.

**Proposed:** Absorb #1832 into #1826 — comment `Absorbed into #1826.` and close with `--reason "not planned"`.

**Why staged:** Absorb of a `github-issues` record closes an issue — Stage at every tier.

**Commands:**
gh issue comment 1832 --body "Absorbed into #1826 (consolidated two-call-handoff record; carries this run's claim-bypass occurrence). Worktree/branch worktree-record-976 are gone, #1100/#1484 closed, PR #1730 closed — the disposition items here are moot."
gh issue close 1832 --reason "not planned"
