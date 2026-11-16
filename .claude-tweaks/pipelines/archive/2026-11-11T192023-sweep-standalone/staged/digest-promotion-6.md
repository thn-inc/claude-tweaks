# Staged: Propose digest cluster — flow (4 entries)

**Container:** #5046 (digest)
**Proposed record title:** Settle 4 below-floor digest findings in flow

## Current State

4 un-promoted digest entries in #5046 share the area `flow`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- context-handoff continuation template restates the refused shell-shape list instead of citing _shared/scratch-worktree.md section 7 (third copy) — plugin/skills/flow/context-handoff.md:71 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- pr-resume-line.js checks --run-id presence only; RUN_ID_SHAPE validation lives in claim-targets.md prose (see #4693) — plugin/bin/pr-resume-line.js:62 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- record-steps imports FLOW_STEPS from the claim-targets CLI lib, loading claim-store/log-decision for a constant (review info, confirmed; tiebreak: drop — sibling consumers already load claim-targets) — plugin/bin/lib/flow/record-steps.js:13 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- preflight accepts any safe positive blocker number while the dispatch screen bounds at GRAPHQL_INT_MAX; reuse the exported bound so both predicates agree (review low, confirmed) — plugin/bin/preflight-records.js:374,plugin/bin/lib/dispatch/unlanded-blockers.js:64 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #5046 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fingerprint: materiality-d3c420c1 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6599044663
- materiality-fingerprint: materiality-13a83395 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6599044663
- materiality-fingerprint: materiality-9eee0b99 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6615676450
- materiality-fingerprint: materiality-1c325c89 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6616236618
