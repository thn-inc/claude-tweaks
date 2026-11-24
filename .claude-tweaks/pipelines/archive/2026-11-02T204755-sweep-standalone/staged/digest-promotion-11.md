# Staged: Propose digest cluster — _shared (4 entries)

**Container:** #1426 (digest)
**Proposed record title:** Settle 4 below-floor digest findings in _shared

## Current State

4 un-promoted digest entries in #1426 share the area `_shared`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- low Convention — maxRiskTier is reimplemented inline in the skill snippet (and again at plugin/skills/tidy/step-1-records.md:279) instead of using the export at plugin/bin/lib/issues/oversight-floor.js:60, which the same snippets already require for exceedsOversightFloor — a third copy of the parent-aggregation rule beside the export (drift risk; behaviourally equivalent today). — plugin/skills/_shared/github-pr-scan-acceptance.md:701, plugin/skills/tidy/step-1-records.md:279 — Defer-reason: pre-existing-outside-diff — 2026-10-31T212421-release-standalone
- low Ownability — One dense line does four jobs (dedup across four fetches, the 30-day closed-parent window, comments stripping, belowFloorClose); the diff deleted its "Number-keyed dedup … identical rows, either fetch may win" comment, which is now also false (open and closed rows differ, so fetch order decides the winner), and the block gives no local pointer to the 31-vs-30-day margin or the closedAt-always-present assumption. — plugin/skills/_shared/github-pr-scan-acceptance.md:488 — Defer-reason: pre-existing-outside-diff — 2026-10-31T212421-release-standalone
- low Performance — Item 10's new Resume route re-reads claims/issue-{n}.json via the contents API and runs a separate gh pr view --json body per reported unsettled candidate, although step 1 (line 244) already parsed the claim blob but drops runId from its output (line 250) and progressOf (line 302) already calls gh pr view per candidate — two extra gh round-trips per reported row. — plugin/skills/_shared/github-pr-scan.md:329 — Defer-reason: pre-existing-outside-diff — 2026-10-31T212421-release-standalone
- low Ownability — The fallback paths say to report "the reconstructed command described below", but nothing below describes one — the paragraph's own last sentence says "above", and the only reconstruction is the no-PR reconcile line at 319; the diff also removed the in-line PIPELINE_RUN_DIR=… /claude-tweaks:flow text that signposted it, so a resolve/failure reader is told to report an unnamed command. — plugin/skills/_shared/github-pr-scan.md:329 — Defer-reason: pre-existing-outside-diff — 2026-10-31T212421-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #1426 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-11040bc6 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6549793384)
- materiality-eaab68c2 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6549793384)
- materiality-40c32e4c (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6549793384)
- materiality-e5e13b56 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6549793384)
