# Staged: Propose digest cluster — tidy (9 entries)

**Container:** #1426 (digest)
**Proposed record title:** Settle 9 below-floor digest findings in tidy

## Current State

9 un-promoted digest entries in #1426 share the area `tidy`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- The deliberate no-row-cap rule leaves acceptance-gap rows unbounded in dispatcher context; last observed at 13 rows, so this is a watch item. — plugin/skills/tidy/scan-execution.md:38 — Defer-reason: pre-existing-outside-diff — 2026-10-30T134829-release-standalone
- plugin/skills/_shared/github-pr-scan-acceptance.md ends at 52,236 B against its 52,500 B rail (264 B headroom), so any further closed-parent or parent-gate edit trips the rail; a split must keep the exit-4 fallback with the scan section because the dispatcher inlines scope sections whole — plugin/skills/_shared/github-pr-scan-acceptance.md — Defer-reason: genuinely-larger — 2026-10-31T190944-record-4600
- the closed-parent scan drops a close-marker comment from an untrusted author other than the current gh login without printing the skipped-marker line that docs/journeys/ignore-a-planted-marker-comment-3358.md says every reader prints (fails safe: the parent reads as unmarked and is reported as a gap) — plugin/skills/_shared/github-pr-scan-acceptance.md — Defer-reason: genuinely-larger — 2026-10-31T190944-record-4600
- parent-gate snippets keep a local maxRiskTier beside closedParentGap lib one (also tidy/step-1-records.md:279) — plugin/skills/_shared/github-pr-scan-acceptance.md:714 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- one uncommented node line merges/dedups/windows/attaches belowFloorClose and drops a closed parent with no closedAt (step-1-records.md:260 keeps it) — plugin/skills/_shared/github-pr-scan-acceptance.md:488 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- item 10 resume report re-reads the claim blob and the PR body per candidate (step 1 drops runId; progressOf already views the PR) — plugin/skills/_shared/github-pr-scan.md:329 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- digest expiry dating is an inline node -e fence in skill prose instead of a digest-rollover.js verb — plugin/skills/tidy/digest-sweep.md — Defer-reason: pre-existing-outside-diff — 2026-11-02T063520-release-standalone
- a finished digest rollover is re-verified on every sweep with no memo of an earlier clean result — plugin/skills/tidy/digest-sweep.md — Defer-reason: tiebreak-cant-tell — 2026-11-02T063520-release-standalone
- the resume-an-unfinished-rollover step lists every open issue with its body before the sweep's no-op check, even in a repo that never had a digest, though the session record snapshot already carries body — plugin/skills/tidy/digest-sweep.md — Defer-reason: pre-existing-outside-diff — 2026-11-02T060818-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #1426 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-3ca4689f (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6525082273)
- materiality-872e6882 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6549117690)
- materiality-936a3766 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6549117690)
- materiality-d57ff1f1 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-13b3f469 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-961b9c93 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-ed69c4f7 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571133505)
- materiality-0ecd45cc (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571133505)
- materiality-9932d595 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571470400)
