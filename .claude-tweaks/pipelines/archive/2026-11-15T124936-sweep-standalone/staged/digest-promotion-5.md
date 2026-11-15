# Staged: Propose digest cluster — docs (5 entries)

**Container:** #5046 (digest)
**Proposed record title:** Settle 5 below-floor digest findings in docs

## Current State

5 un-promoted digest entries in #5046 share the area `docs`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- closed-parent window literals (31 * 864e5 search, 30 * 864e5 filter, legacy 30*24*60*60*1000) have no shared constant or pad rationale at the fetch block — plugin/skills/_shared/github-pr-scan-acceptance.md:472 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- parse-signal-discipline skill cites branch-only commit d78eb3940 instead of the #4659 squash 339a67da5 — .claude/skills/parse-signal-discipline/SKILL.md:216 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- Docs: decision-record number 0023 is used by two different decision files — docs/decisions/0023-dispatch-groups-are-per-record-overlap-resolved-at-merge.md — Defer-reason: pre-existing-outside-diff — 2026-11-11T191623-release-standalone
- The documented one-command revert of the #5230 cutover (SKILL.md, mcp-transport.md, firing-exclusion.md) would leave the cut-over prose-pin tests red and the docs describing the CLI path (review tiebreak could not confirm or refute) — docs/plugin-structure.md:129 — Defer-reason: tiebreak-cant-tell — 2026-11-13T021643-spec-5230
- The bin/dispatch-unlanded-blockers.js row may still say mcp-transport.md runs the pass as written on a gh-absent firing, where the cut-over mcp-transport.md says queue-pull.js runs it (review tiebreak could not confirm or refute) — docs/skill-graph.md:279 — Defer-reason: tiebreak-cant-tell — 2026-11-13T021643-spec-5230

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #5046 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fingerprint: materiality-9187c3fe — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6599044663
- materiality-fingerprint: materiality-84f21cde — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6599044663
- materiality-fingerprint: materiality-386d8948 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6807300212
- materiality-fingerprint: materiality-dcd6e9f6 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6849428017
- materiality-fingerprint: materiality-c7701dfd — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6849428017
