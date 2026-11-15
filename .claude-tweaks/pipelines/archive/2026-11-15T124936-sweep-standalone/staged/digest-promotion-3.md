# Staged: Propose digest cluster — verify (8 entries)

**Container:** #5046 (digest)
**Proposed record title:** Settle 8 below-floor digest findings in verify

## Current State

8 un-promoted digest entries in #5046 share the area `verify`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- verify.js stageOf re-implements run.js private stage order (STAGE1 not exported); export one order for runChecks and the CI result merge — plugin/bin/verify.js:809,plugin/bin/lib/verify/run.js:13 — Defer-reason: pre-existing-outside-diff — 2026-11-09T140553-release-standalone
- Docs: The comment says an unheld run never tracks, keeping today's spawn options exactly, but runOne now always opens the log fd and spawns with stdio ['pipe', fd, fd] whether tracked or not, so the comment contradicts the code. — plugin/bin/verify.js:794 — Defer-reason: pre-existing-outside-diff — 2026-11-11T191623-release-standalone
- Docs: The comment's rationale that a reader built before the release carrying #5150 rejects concurrency.reruns/timeoutPatterns as unknown does not hold for any released build: v6.164.0 has no concurrency handling and ignores unknown top-level keys, and suiteSlots, reruns and timeoutPatterns ship in the same release. Related: open #5189 tracks declaring reruns in this repo once the release is installed. — plugin/bin/lib/verify/declaration.js:193 — Defer-reason: pre-existing-outside-diff — 2026-11-11T191623-release-standalone
- Docs: The leftover branch of the per-slot scratch path force-removes whatever sits at the path with no inline comment on the accepted failure mode (a once-only reclaim race can delete a live holder's checkout); the rationale lives only in ADR 0031, and nothing in plugin/ points to it or to headOf as the compensating check. — plugin/bin/lib/verify/baseline.js:212 — Defer-reason: pre-existing-outside-diff — 2026-11-11T191623-release-standalone
- Performance: supersedingPaths is uncapped and copied whole into every verify event and timing.json verify row (5 lens findings merged; tiebreak 3 file / 2 drop) — plugin/bin/lib/verify/scope.js:70, plugin/bin/lib/verify/scope.js:100, plugin/bin/verify.js:1264 — Defer-reason: pre-existing-outside-diff — 2026-11-11T191623-release-standalone
- The no-verdict branch calls fs.rmSync(jsonPath, { force: true }) unguarded, so an unremovable --json target exits 1 instead of 3 and writes no noVerdict event; the verdict path's writeReportAtomic fails the same way on that target — plugin/bin/verify.js:999 — Defer-reason: pre-existing-outside-diff — 2026-11-14T210347-release-standalone
- The CI log file write sits inside the function-wide try, so a local write failure is labelled gh-error and reads as CI could not answer; fail-safe, but the cause is mislabelled — plugin/bin/lib/verify/ci-source.js:207 — Defer-reason: pre-existing-outside-diff — 2026-11-14T210347-release-standalone
- The stale-warning flush on the no-verdict path writes to stderr unguarded, so an EPIPE or EAGAIN there exits 1 instead of 3; the exit-listener half of the claim does not hold — plugin/bin/verify.js:528 — Defer-reason: tiebreak-cant-tell — 2026-11-14T210347-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #5046 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fingerprint: materiality-0c7e51a7 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6747006950
- materiality-fingerprint: materiality-2ef443ae — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6807300212
- materiality-fingerprint: materiality-cc882766 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6807300212
- materiality-fingerprint: materiality-0a2058f8 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6807300212
- materiality-fingerprint: materiality-9870d22f — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6807300212
- materiality-fingerprint: materiality-76f04f1b — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6885215314
- materiality-fingerprint: materiality-39ee3f4b — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6885215314
- materiality-fingerprint: materiality-8be1a770 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6885215314
