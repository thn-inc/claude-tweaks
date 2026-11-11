# Staged: Propose digest cluster — dispatch (6 entries)

**Container:** #5046 (digest)
**Proposed record title:** Settle 6 below-floor digest findings in dispatch

## Current State

6 un-promoted digest entries in #5046 share the area `dispatch`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- queue-pull blocker-landing pass re-probes every closed blocker with a sequential synchronous gh api compare on every pull, cache hits included, and caches no landed verdict between pulls (review low, confirmed by both reproduction agents) — plugin/bin/lib/preflight-records/blocker-landing.js:259 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- malformed-blocker reason also carries number/body/labels shape faults rendered as a malformed blocker declaration (review info, confirmed; tiebreak: drop — deliberate, documented, unreachable from gh JSON) — plugin/bin/lib/dispatch/unlanded-blockers.js:60 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- #4815 made resume-eligibility.js the export home for isObject/nonEmptyString instead of lib/shared-primitives.js; identical isObject copies remain in stuck-open-pr.js:15, qa-report/compose.js:51, wrap-up/packet-gather.js:75, acceptance-packet.js:111 (packet-validate.js:34 is a different predicate, no array guard); move both to shared-primitives.js and repoint; the plan's promised ops-ledger row for the leftovers was not found (review low, contested→confirmed) — plugin/bin/lib/dispatch/resume-eligibility.js:57,plugin/bin/lib/dispatch/resume-eligibility.js:449 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- comment says each preflight-records gh call is bounded at 30 s, but GH_BATCH_TIMEOUT_MS = max(30000, gh-timeout-ms) allows up to 60 s; it is the stated rationale for the 300000 ms bound (review low, confirmed) — plugin/bin/dispatch-unlanded-blockers.js:73 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- No-I/O verdict module resume-eligibility.js requires hooks/worktree-reap (git-exec, policy, ports/registry) only for HARNESS_WORKTREE_DIR (review low, confirmed; tiebreak: drop — load-only cost, the CLI already loads it) — plugin/bin/lib/dispatch/resume-eligibility.js:19 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- artifact-verdict.js deriveFromStamp re-implements pass-stamp validation that stamp.js readStamp owns; parse through a shared path-taking reader — plugin/bin/lib/dispatch/artifact-verdict.js:27,plugin/bin/lib/verify/stamp.js — Defer-reason: pre-existing-outside-diff — 2026-11-09T140553-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #5046 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fingerprint: materiality-756595de — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6616236618
- materiality-fingerprint: materiality-171b8076 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6616236618
- materiality-fingerprint: materiality-69a3b0ed — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6616604419
- materiality-fingerprint: materiality-16d2b1b9 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6616604419
- materiality-fingerprint: materiality-767d541b — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6616604419
- materiality-fingerprint: materiality-b390fc65 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6747006950
