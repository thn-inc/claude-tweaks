# Staged: Propose digest cluster — console (4 entries)

**Container:** #5046 (digest)
**Proposed record title:** Settle 4 below-floor digest findings in console

## Current State

4 un-promoted digest entries in #5046 share the area `console`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- reference-repair.js diffGitSides is a forked copy of the private diffHeaderPath in review-context/build.js; the two parse one diff --git header rule and have drifted (only the copy guards a too-short side, build.js accepts a/ b/ and returns an empty path), so extract one shared leaf — plugin/bin/lib/console/reference-repair.js, plugin/bin/lib/review-context/build.js — Defer-reason: pre-existing-outside-diff — 2026-11-03T082956-record-4636
- case-folded isSensitivePath double match duplicated in initiative-budget.js:75; both guard unattended approval, share one folded predicate in blast-radius.js (review low, confirmed) — plugin/bin/lib/console/reference-repair.js:180,plugin/bin/lib/issues/initiative-budget.js:75 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- decisionLineHash sits between the coordinationItems id-scheme/old-id join comment and coordinationItems, so the comment documents the wrong function; move the helper above it (review low, confirmed) — plugin/bin/lib/console/resolve.js:832 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- diffGitSides is a comment-labelled copy of review-context/build.js diffHeaderPath with no pin between them (review low, confirmed; tiebreak: drop — already diverged deliberately and stagedDiffPaths cross-checks headers, fails closed) — plugin/bin/lib/console/reference-repair.js:44 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #5046 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fingerprint: materiality-cf1398e2 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6602816085
- materiality-fingerprint: materiality-4266286d — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6615676450
- materiality-fingerprint: materiality-f0793487 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6615676450
- materiality-fingerprint: materiality-6c2c791f — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6615676450
