# Staged: Propose digest cluster — reconcile (6 entries)

**Container:** #5046 (digest)
**Proposed record title:** Settle 6 below-floor digest findings in reconcile

## Current State

6 un-promoted digest entries in #5046 share the area `reconcile`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- lib/reconcile/post-merge requires the bin/closing-links.js entrypoint, a lib-to-bin edge (review info, confirmed; tiebreak: drop — no stated convention forbids it, same pattern in phase-exit/parent-gate/detect) — plugin/bin/lib/reconcile/post-merge.js:84 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- no test covers an exit-0 closing-links envelope with neither closingSet nor action after the K4 test was removed (review info, confirmed; tiebreak: drop — unreachable, closingLinks sets action on every exit-0 path) — plugin/bin/lib/reconcile/post-merge.js:551 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- takeClaim builds the claim aside name and heartbeatClaim parses it separately with no shared builder or test pinning the two together — plugin/bin/lib/reconcile/post-merge.js, tests/bin-lib/reconcile/post-merge.test.js — Defer-reason: pre-existing-outside-diff — 2026-11-05T071125-release-standalone
- GH_TIMEOUT_CEILING_MS computed at module load from POLICY_KEYS.find(...).max throws on require if the gh-timeout-ms row is renamed (loud, house pattern) — plugin/bin/lib/reconcile/post-merge.js — Defer-reason: pre-existing-outside-diff — 2026-11-05T071125-release-standalone
- ECLAIMLOST error code thrown on a lost claim has no reader; callers treat it as an ordinary gh failure — plugin/bin/lib/reconcile/post-merge.js — Defer-reason: pre-existing-outside-diff — 2026-11-05T071125-release-standalone
- post-merge.js file-header concurrency summary omits the owner token, idle/pid-liveness, heartbeat and superseded-holder semantics — plugin/bin/lib/reconcile/post-merge.js — Defer-reason: pre-existing-outside-diff — 2026-11-05T071125-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #5046 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fingerprint: materiality-bfcd1f88 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6615676450
- materiality-fingerprint: materiality-850eb071 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6615676450
- materiality-fingerprint: materiality-4519ed0b — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6652461692
- materiality-fingerprint: materiality-22fb1a2f — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6652461692
- materiality-fingerprint: materiality-9252e671 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6652461692
- materiality-fingerprint: materiality-00d64602 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6652461692
