# Staged: Propose digest cluster — tests (16 entries)

**Container:** #5046 (digest)
**Proposed record title:** Settle 16 below-floor digest findings in tests

## Current State

16 un-promoted digest entries in #5046 share the area `tests`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- The win32 expected-root expectations are built with the production toPosix helper, which is the identity on Linux, so they cannot catch a conversion regression; only the literal win32 pins discriminate (the independent tiebreak could not confirm the claim by reading code) — tests/bin-lib/hooks/guard-rewrite.test.js — Defer-reason: tiebreak-cant-tell — 2026-11-03T100346-record-4292
- The posix backslash-root test (toPosix converts only pathImpl.sep) stays green under an unconditionally converting toPosix mutant because the real fs lacks the native join and shippedUnder declines first, so the separator condition is not pinned; an injected lstatType returning file would pin it (tiebreak could not confirm the survival claim by reading code) — tests/bin-lib/hooks/guard-rewrite.test.js — Defer-reason: tiebreak-cant-tell — 2026-11-03T100346-record-4292
- archive-run-verb.test.js never removes its mkdtemp fixture repos, bare origins or worktree holders (~50+ dirs per npm test run); register an after cleanup (review low, confirmed) — tests/archive-run-verb.test.js:41 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- known write-gate fail-open misses pinned as expected results rather than skip/todo (review low, confirmed; tiebreak: drop — deliberate pin documented against open #4328, goes red as a forcing function) — tests/hooks-gate-coverage.test.js:1071 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- verifiedHead: true proceed pin uses a 260-char window that misses the pipeline paragraph (465 chars) and matches the standalone bullet at line 84 instead, leaving the pipeline clause unpinned; anchor on the pipeline paragraph (review low, confirmed) — tests/review-step1-5-verifiedhead-gate.test.js:36 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- refused-write tests never assert stderr lacks an AUTO dispatch line, so the AUTO-after-appendExclusion ordering is unpinned (review low, confirmed) — tests/bin-lib/dispatch/unlanded-blockers.test.js:546 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- requireOrder copied into three new suites (12 copies repo-wide, none in conformance-asserts.js) (review low, confirmed; tiebreak: drop — only a repo-wide hoist would help) — tests/dispatch-unlanded-blocker-consumers-conformance.test.js:28 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- AC4.3 test title claims the report cause is one the CLI writes but only checks placeholder fill and non-empty causes (review low, confirmed; tiebreak: drop — contract pinned in unlanded-blockers.test.js, at most a rename) — tests/dispatch-unlanded-blocker-consumers-conformance.test.js:78,tests/dispatch-unlanded-blocker-consumers-conformance.test.js:84 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- zsh variant of the pass-block suite skips when zsh is absent (review info, confirmed; tiebreak: drop — CI installs zsh, repo-standard pattern) — tests/dispatch-unlanded-blocker-exclusion-fixture.test.js:106 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- Settle claim-released/auto:merge-kept AC pinned only by prose fact-greps (review info, confirmed; tiebreak: drop — Settle is skill prose, repo-standard pinning) — tests/settle-blocker-landing-stop-conformance.test.js:62 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- GH_BATCH_TIMEOUT_MS is unpinned at three batched runners; a revert to GH_TIMEOUT_MS (5 s) or a retyped 30000 stays green; pin with tests/helpers/gh-timeout-probe.js captureGhTimeout (review low, confirmed) — plugin/bin/lib/issues/link.js:29,plugin/bin/fetch-sub-issues.js:81,plugin/bin/digest-rollover.js:118 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- closeRedispatchRemedy test labelled #4815 passes on the pre-change code too (behaviour-preserving refactor); only the label overstates (review info, confirmed; tiebreak: drop) — tests/bin-lib/dispatch/resume-eligibility.test.js:668 — Defer-reason: pre-existing-outside-diff — 2026-11-03T205448-release-standalone
- gh-host seam conformance recall floor is matched >= 5 while the NOT_ORIGIN site total its comment tracks is still 6 — tests/gh-host-seam-conformance.test.js — Defer-reason: pre-existing-outside-diff — 2026-11-05T071125-release-standalone
- pr-state tests leak mkdtempSync temp dirs (noOrigin, logDir, GH_CONFIG_DIR) never removed — tests/bin-lib/reconcile/pr-state.test.js — Defer-reason: pre-existing-outside-diff — 2026-11-05T071125-release-standalone
- Q2 takeover helper fires on the second now() call, coupled to call order (documented, ownedAtTakeover tripwire fails loudly) — tests/bin-lib/reconcile/post-merge.test.js — Defer-reason: pre-existing-outside-diff — 2026-11-05T071125-release-standalone
- pr-state bulk-screen argv expectation is built by calling production resolvePrStatesBulk (deliberate; tiebreak could not decide) — tests/gh-host-seam-behavior.test.js — Defer-reason: tiebreak-cant-tell — 2026-11-05T071125-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #5046 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fingerprint: materiality-75d15554 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6602827861
- materiality-fingerprint: materiality-4e1c7866 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6602827861
- materiality-fingerprint: materiality-395aa881 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6615676450
- materiality-fingerprint: materiality-5a12bea1 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6615676450
- materiality-fingerprint: materiality-d8ec7f09 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6616236618
- materiality-fingerprint: materiality-5afa03fa — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6616236618
- materiality-fingerprint: materiality-b60dca5b — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6616236618
- materiality-fingerprint: materiality-db5aaa7a — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6616236618
- materiality-fingerprint: materiality-95097683 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6616236618
- materiality-fingerprint: materiality-1c0bac53 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6616236618
- materiality-fingerprint: materiality-c6fb705f — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6616604419
- materiality-fingerprint: materiality-62cd53d3 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6616604419
- materiality-fingerprint: materiality-c04079a8 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6652461692
- materiality-fingerprint: materiality-99b71328 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6652461692
- materiality-fingerprint: materiality-57b06541 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6652461692
- materiality-fingerprint: materiality-01335911 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6652461692
