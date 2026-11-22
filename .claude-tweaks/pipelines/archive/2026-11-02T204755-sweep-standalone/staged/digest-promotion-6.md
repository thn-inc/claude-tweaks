# Staged: Propose digest cluster — health-core (7 entries)

**Container:** #1426 (digest)
**Proposed record title:** Settle 7 below-floor digest findings in health-core

## Current State

7 un-promoted digest entries in #1426 share the area `health-core`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- splitFrontmatterFence treats the --- fence delimiters as exact-string lines (lines[0] !== '---' / lines.indexOf('---', 1)), so a CRLF-encoded frontmatter file (each line carrying a trailing \r) never matches either delimiter and the whole block silently parses as absent (parseFrontmatterListField returns []) -- same root-cause class as #1787's parseJourneyFilesList bug, one shared module deeper: harness-health, journey-health, and docs-health all read files through this parser. — plugin/bin/lib/health-core/frontmatter-list.js — Defer-reason: pre-existing-outside-diff — 2026-09-05T202803-record-1787
- selectCarryOverEntries is exported and named in the header as what digest-rollover.js calls, but no production code calls it — plugin/bin/lib/health-core/materiality-digest.js — Defer-reason: pre-existing-outside-diff — 2026-11-02T063520-release-standalone
- the first-unmarked-line-per-key rule is implemented twice (liveEntriesOf and planCarryOver) with only a comment keeping them in step — plugin/bin/lib/health-core/materiality-digest.js — Defer-reason: pre-existing-outside-diff — 2026-11-02T063520-release-standalone
- DEFAULT_MAX_CHARS has no comment giving the origin of its 60000 figure — plugin/bin/lib/health-core/materiality-digest.js — Defer-reason: pre-existing-outside-diff — 2026-11-02T063520-release-standalone
- DEDUP_MARKER restates backfill-dispose.js's consolebackfill-item prefix as a literal with no shared constant, so a rename there silently stops rollover tombstones keeping that marker (fix drafted in the run's staged/review-1.patch; its DEFAULT_MAX_CHARS half is already entry materiality-f6505c35) — plugin/bin/lib/health-core/materiality-digest.js, plugin/bin/lib/console/backfill-dispose.js — Defer-reason: pre-existing-outside-diff — 2026-11-02T060818-release-standalone
- digest-rollover.js's EMPTY_PLAN and runCarry output literal restate planCarryOver's return fields, and the empty path is tested on only a few of them, so a new planner field can go missing from the empty output unnoticed — plugin/bin/digest-rollover.js, tests/digest-rollover-cli.test.js — Defer-reason: pre-existing-outside-diff — 2026-11-02T060818-release-standalone
- classifyRolloverResume never checks that the named old issue is or was a digest container, so a trusted marker line naming an ordinary open record classifies as a stalled move — plugin/bin/lib/health-core/materiality-digest.js — Defer-reason: pre-existing-outside-diff — 2026-11-02T060818-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #1426 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-925d5cc7 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-5554810695)
- materiality-659cf247 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571133505)
- materiality-5a9383de (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571133505)
- materiality-f6505c35 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571133505)
- materiality-73b30686 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571470400)
- materiality-92fc4228 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571470400)
- materiality-f9b2e333 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571470400)
