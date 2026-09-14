# Staged: Absorb (GitHub) — #1756 into #1868 (status-word-first contract violations)

**Finding:** `[gh-issue]` #1756 (filed by `reflect` from #1684, 2026-08-31) reports 5 of 8 `/claude-tweaks:review` lens agents narrating before the status word and asks to strengthen the dispatch instruction and/or add an orchestrator line-1 check. The instruction half landed 2026-09-01 (commit 314d736d9: second `WRONG:` example plus a self-check sentence in `plugin/skills/review/step3-lens-dispatch.md`, refs #1670). #1868 (2026-09-04, `needs:definition`) then recorded that the strengthened prompt still failed for 3 of 3 agents and frames the open choice as the enforcement point (dispatcher tolerance, hook-side normalization, or a trailing authoritative `STATUS:` field) — the same class, one level up.

**Proposed:** Absorb #1756 into #1868 — comment on #1756 pointing at #1868 and commit 314d736d9, close #1756 as not planned; append #1756's 62% (5/8) data point to #1868 so the definition carries both measurements.

**Why staged:** closing and commenting on `github-issues` records are outward-facing writes, Stage at every tier.

**Rows:**
- #1756 — → #1868 (OPEN, needs:definition); prompt-strengthening half landed in 314d736d9

**Commands:**
gh issue comment 1868 --body "Additional data point from #1756 (absorbed here): #1684's review saw 5 of 8 lens agents (62%) narrate before the status word with the byte-identical CALIBRATION + OUTPUT FORMAT block; commit 314d736d9 (2026-09-01) added the second WRONG example and self-check sentence afterwards, and this record's 3-of-3 observation post-dates that change. Filed by /claude-tweaks:sweep (run 2026-09-09T145100)."
gh issue comment 1756 --body "Absorbed into #1868: the prompt-strengthening deliverable landed in commit 314d736d9 (2026-09-01) and #1868 records it still failing, so the remaining work is #1868's enforcement-point decision. Filed by /claude-tweaks:sweep (run 2026-09-09T145100)."
gh issue close 1756 --reason "not planned"
