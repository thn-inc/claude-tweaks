# Staged: Propose digest cluster — review (6 entries)

**Container:** #5046 (digest)
**Proposed record title:** Settle 6 below-floor digest findings in review

## Current State

6 un-promoted digest entries in #5046 share the area `review`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- The planted-emission tests call offendersIn on literal strings and never run the directory-walking offender-collection loop, so a loop that never pushes an offender passes both the clean-tree test and the planted tests — tests/recording-no-embed-conformance.test.js — Defer-reason: tiebreak-cant-tell — 2026-11-02T223727-record-4612
- zero-test Gate row cites log-decision.js --section "/review" only (no --run/--status/--text/--reversibility); spell the full call as line 309 does and update the two pins in tests/review-step1-5-verifiedhead-gate.test.js (review low, contested→confirmed) — plugin/skills/review/code-mode-steps.md:111 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- code-mode-steps.md is 52,499 B against RAIL_BYTES 52,500 (one byte of headroom), so the next edit adding 2+ bytes fails tests/review-qa-rerun-after-fix-wave-conformance.test.js:107; split it ahead of time (review low, confirmed) — plugin/skills/review/code-mode-steps.md:112 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- The AC3.1 two-process append test has no barrier forcing the two writes to overlap; lock discrimination rests on the in-process readLedger-seam interleave test (tiebreak could not confirm without a mutation run) — tests/hooks-ledger-row.test.js — Defer-reason: tiebreak-cant-tell — 2026-11-03T204945-record-4439
- merge-mode.md names CLAIM_MAX_IDLE_MS without its 5-minute value while the adjacent CLAIM_STALE_MS carries 10 minutes (tiebreak: evidence could not be verified; judged deliberate, the plan names the constant only) — plugin/skills/wrap-up/merge-mode.md — Defer-reason: tiebreak-cant-tell — 2026-11-04T064811-record-4797
- PRIOR_OUTPUT_SHA256 has no in-source reason for covering pre-plugin/ generator history and no per-digest provenance (tiebreak could not verify its evidence) — plugin/bin/lib/issue-branch-tracking.js:228 — Defer-reason: tiebreak-cant-tell — 2026-11-10T224532-spec-5152

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #5046 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fingerprint: materiality-16be0bf4 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6599044663
- materiality-fingerprint: materiality-f84c59e6 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6616236618
- materiality-fingerprint: materiality-605aefbb — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6616236618
- materiality-fingerprint: materiality-5a942e08 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6618073224
- materiality-fingerprint: materiality-ae4b0620 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6627127339
- materiality-fingerprint: materiality-1e57e8a6 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6782935371
