# Staged: Propose digest cluster — wrap-up (7 entries)

**Container:** #1426 (digest)
**Proposed record title:** Settle 7 below-floor digest findings in wrap-up

## Current State

7 un-promoted digest entries in #1426 share the area `wrap-up`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- repoSlug with a hard-coded github.com host is unexplained (the line-1033 regex fixes the host) — plugin/bin/lib/wrap-up/engine-verify.js:1037 — Defer-reason: pre-existing-outside-diff — 2026-11-01T182455-release-standalone
- readRepoPolicyRaw catches every read error, so an unreadable policy.yml (EACCES/EISDIR) falls back to the body-text work-links default instead of the check returning unknown — plugin/bin/lib/wrap-up/engine-verify.js:802 — Defer-reason: pre-existing-outside-diff — /claude-tweaks:release v6.160.1 release-gate review (run 2026-11-01T204406-release-standalone)
- acceptance-labeling reads only .value of the work-links policy key, so a typo (e.g. Native) silently resolves to body-text while parent-gate.js refuses the same value; a natively linked sub-issue then gets a false missing demo:pending fail — plugin/bin/lib/wrap-up/engine-verify.js:817 — Defer-reason: pre-existing-outside-diff — /claude-tweaks:release v6.160.1 release-gate review (run 2026-11-01T204406-release-standalone)
- enumerateBodyTextSubIssues spawns one gh issue view per sub-issue serially (N+1 forge calls) — plugin/bin/lib/wrap-up/engine-verify.js:778 — Defer-reason: pre-existing-outside-diff — /claude-tweaks:release v6.160.1 release-gate review (run 2026-11-01T204406-release-standalone)
- "since terminal statuses are final" is now loosely worded given the ledger deferred-to-open exception; no reader action is wrong — plugin/skills/wrap-up/review-console-appendix.md:101 — Defer-reason: tiebreak-cant-tell — /claude-tweaks:release v6.160.1 release-gate review (run 2026-11-01T204406-release-standalone)
- Uppercase `Reversibility: N/A` writers disagree with the now-lowercase `n/a` vocabulary row in auto-decision-log.md; decisions-classifier.js REVERSIBILITY_RE is case-sensitive and already misses them — migrate the writers and their pins (or make the readers case-insensitive) as one change (refs #4810) — plugin/bin/lib/wrap-up/engine-record.js, plugin/skills/wrap-up/curation-engine.md, plugin/skills/_shared/causal-depth.md, tests/wrap-up-console-fast-path-scanned-exclusion.test.js, plugin/bin/lib/calibration/decisions-classifier.js — Defer-reason: pre-existing-outside-diff — 2026-11-01T210352-record-4810
- console-resolve.js writes its unattended auto-resolve decisions header with `reversibility: 'per item'`, outside the closed high|med|low|n/a vocabulary (refs #4810) — plugin/bin/console-resolve.js — Defer-reason: pre-existing-outside-diff — 2026-11-01T210352-record-4810

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #1426 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-ebacc0aa (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6562568531)
- materiality-7cc6cd44 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6564394898)
- materiality-db6d7181 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6564394898)
- materiality-41770e4c (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6564394898)
- materiality-c42802cb (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6564394898)
- materiality-98c6f552 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6564515217)
- materiality-f7f585b9 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6564515217)
