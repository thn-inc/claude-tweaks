# Staged: Propose digest cluster — wrap-up (3 entries)

**Container:** #5046 (digest)
**Proposed record title:** Settle 3 below-floor digest findings in wrap-up

## Current State

3 un-promoted digest entries in #5046 share the area `wrap-up`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- rulingAcceptError accepted backstop fails open on the suffix-less header-fallback path when readdirSync(staged/) or a ruling read faults; narrow the catch to ENOENT and refuse otherwise (review low, contested→confirmed; also: logic lives in the CLI and lazily requires reconcile/console-execute) — plugin/bin/wrap-up-engine.js:655,plugin/bin/wrap-up-engine.js:659 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- packet-gather requires console/resolve (and through it wrap-up/pack) for SECTIONS and decisionLineHash, breaking the leaf-module discipline sdd-ruling.js keeps (#4060); move readPacket/decisionLineHash to a leaf (review low, confirmed) — plugin/bin/lib/wrap-up/packet-gather.js:17 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- parseStoryFile is a hand-written YAML state machine with no rationale comment or pointer to the neg-/negative convention (review info, confirmed; tiebreak: drop — zero-runtime-deps norm, convention named at lines 41-42) — plugin/bin/lib/wrap-up/packet-gather.js:282 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #5046 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fingerprint: materiality-8168b55b — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6615676450
- materiality-fingerprint: materiality-7f12349a — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6615676450
- materiality-fingerprint: materiality-457db850 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6615676450
