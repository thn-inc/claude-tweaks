# Staged: Propose digest cluster — tests (36 entries)

**Container:** #1426 (digest)
**Proposed record title:** Settle 36 below-floor digest findings in tests

## Current State

36 un-promoted digest entries in #1426 share the area `tests`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- low Test quality — The #4421 over-budget test hard-codes the 1-based budget-call index (withBudgetExceededFrom(7, …)), coupling it to the count of checks ahead of archive — #4599 already had to bump it 6→7, and any future check ahead of archive breaks it with no behaviour change. — tests/reconcile.test.js:3655 — Defer-reason: pre-existing-outside-diff — 2026-10-31T212421-release-standalone
- low Test quality — The test titled "go-red: the suite fails when the State-Classification section is removed" only asserts closedRuleSection throws on a doctored string, with no error matcher — any throw satisfies it, and the suite-level claim in its title is never exercised. — tests/specify-closed-rule.test.js:48 — Defer-reason: pre-existing-outside-diff — 2026-10-31T212421-release-standalone
- low Test quality — The cp a b -S / cp a b --suffix rows pin the known over-read destination b as expected output (the comment above says GNU never writes b), so a correct fix to the gate fails this test — the test enshrines a defect instead of marking a known gap. — tests/hooks-gate-coverage.test.js:593 — Defer-reason: pre-existing-outside-diff — 2026-10-31T212421-release-standalone
- post-merge Step 4.0b no-default-branch negative assertion matches a spelling closing-links never runs, so it cannot fail — tests/bin-lib/reconcile/post-merge.test.js:967 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- test name promises the rerun closes without a second comment but the body runs one pass — tests/bin-lib/issues/below-floor-parent-close.test.js:316 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- budget-trip test hard-codes withBudgetExceededFrom(7, ...), the count of budget checks before archive — tests/reconcile.test.js:3655 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- post-merge e2e fake returns closedAt: null for CLOSED issues, so --close-window-ms classification never runs end to end — tests/bin-lib/reconcile/post-merge.test.js:882 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- --literal-pathspecs guard is pinned only by an exact argv deepEqual, never by git behavior on a glob-named plan — plugin/bin/lib/plan-retention/probe.js:31 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- ITEM10 slice ends at Findings and recommendations, so it spans item 11 and item-10 pins could be satisfied by later text — tests/sweep-backstop.test.js:245 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- pr-resume-line CLI test pins JSON key order and raw stdout string — tests/pr-resume-line-cli.test.js:61 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- no test pins the adoption path candidate run-id source (claude-tweaks-run: marker, not the Resume line) — plugin/skills/flow/steps-and-gates.md:92 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- no-complement routing guard pins one exact phrase (Otherwise: follow) — tests/issue-claims-stale-open-pr-conformance.test.js:116 — Defer-reason: pre-existing-outside-diff — 2026-10-31T203907-release-standalone
- a flag-strict test pins hooks.js indentation (reconcile: [) redundantly with the key-set check — tests/hooks-js-flag-strict.test.js:128 — Defer-reason: pre-existing-outside-diff — 2026-11-01T182455-release-standalone
- GATE_CALL_SHAPE pins the PreToolUse gate call's local identifiers and option order — tests/hooks-pre-tool-use.test.js:1303 — Defer-reason: pre-existing-outside-diff — 2026-11-01T182455-release-standalone
- FORWARD_RE couples to local identifier names and exact { onDegrade } text — tests/bin-lib/pr-bookkeeping/precondition.test.js:397 — Defer-reason: pre-existing-outside-diff — 2026-11-01T182455-release-standalone
- the 15 s hook budget is a test-local 15000 literal rather than a named constant shared with the code comments — tests/hooks-pre-tool-use.test.js:1308 — Defer-reason: pre-existing-outside-diff — 2026-11-01T182455-release-standalone
- flag-strict tests pin comment wording and the retired HELP_FLAGS name rather than behaviour — tests/hooks-js-flag-strict.test.js:340 — Defer-reason: pre-existing-outside-diff — 2026-11-01T182455-release-standalone
- Eight resolve.test.js names carry a "Review Focus N:" review-process prefix — tests/bin-lib/console/resolve.test.js:1158 — Defer-reason: pre-existing-outside-diff — /claude-tweaks:release v6.160.1 release-gate review (run 2026-11-01T204406-release-standalone)
- engine-verify carrier-commit tests (lines 1267, 1295, 1308, 1320) call runVerify without repoRoot, so acceptance-labeling reads the host checkout policy.yml via process.cwd() — tests/bin-lib/wrap-up/engine-verify.test.js:1295 — Defer-reason: pre-existing-outside-diff — /claude-tweaks:release v6.160.1 release-gate review (run 2026-11-01T204406-release-standalone)
- The parent-sorted-first test pins exactly two body reads, coupling it to the read structure — tests/bin-lib/wrap-up/engine-verify.test.js:2288 — Defer-reason: pre-existing-outside-diff — /claude-tweaks:release v6.160.1 release-gate review (run 2026-11-01T204406-release-standalone)
- The "#4770 AC4.1" test passes on the pre-change parent-gate.js (executed probe), so it pins existing behavior rather than discriminating #4770 — tests/bin-lib/issues/parent-gate.test.js:699 — Defer-reason: pre-existing-outside-diff — /claude-tweaks:release v6.160.1 release-gate review (run 2026-11-01T204406-release-standalone)
- FACTS_4770's tidy row pins only 'when the identity read fails', not the operative "a trusted author's comment alone", so a reversed rule still passes — plugin/skills/tidy/SKILL.md:205, tests/below-floor-parent-close-conformance.test.js:1243 — Defer-reason: pre-existing-outside-diff — /claude-tweaks:release v6.160.1 release-gate review (run 2026-11-01T204406-release-standalone)
- Go-red self-tests use bare assert.throws with no message matcher (lines 345, 379, 380, 386), unlike sibling go-reds at 354/369/399/407-409 — tests/deferral-gate-conformance.test.js:345 — Defer-reason: tiebreak-cant-tell — /claude-tweaks:release v6.160.1 release-gate review (run 2026-11-01T204406-release-standalone)
- tests/helpers/git-fixtures.js gitRepo() and linkedWorktreeOf() create their mkdtemp dir before a git call that can throw, so a caller that registers the returned path (engine-verify.test.js trackTmp) never registers it and leaks the dir on a failing fixture setup — tests/helpers/git-fixtures.js:64, tests/bin-lib/wrap-up/engine-verify.test.js:1107 — Defer-reason: pre-existing-outside-diff — 2026-11-02T042606-record-4813
- the #4799 no-sub-issues case stays green with the fix reverted, so it is not a regression test for #4799 — tests/bin-lib/issues/below-floor-parent-close.test.js — Defer-reason: tiebreak-cant-tell — 2026-11-02T063520-release-standalone
- the direct-filing-sweep assertion's second || operand is a prefix of the first, so it reduces to includes('Deliberately **not** added') and a rewording that drops the record.js DEFER_REASONS reference still passes — tests/materiality-floor-conformance.test.js — Defer-reason: pre-existing-outside-diff — 2026-11-02T060818-release-standalone
- the REFUSAL_REASONS length pin (26) fails on every legitimate reason change while the table-completeness check above it already catches an addition — tests/bin-lib/dispatch/resume-eligibility.test.js — Defer-reason: pre-existing-outside-diff — 2026-11-02T060818-release-standalone
- every new symlink-leaf test in the shadow-dup-proposal suite skips on win32 (blanket SYMLINK_SKIP), so the Windows CI leg runs none of the refusal assertions; the write-side twin has no skip — tests/bin-lib/console/shadow-dup-proposal.test.js — Defer-reason: blocked-external — 2026-11-02T082823-record-4355
- tiebreak on the no-O_NOFOLLOW symlinked-anchor CLI test (duplicate of the kernel-path test?) returned a refutation whose cited evidence line fell outside the verifiable window, so it stayed unverified; the reviewer read the test and found it does take the injected-constants fallback branch — tests/bin-lib/console/shadow-dup-proposal.test.js — Defer-reason: tiebreak-cant-tell — 2026-11-02T082823-record-4355
- new artifact-overwrite manifest fixtures mkdtemp under os.tmpdir() and are never removed (both suites) — tests/bin-lib/flow/artifact-overwrite-check.test.js:82, tests/bin-lib/flow/check-artifact-overwrite-cli.test.js:129 — Defer-reason: pre-existing-outside-diff — 2026-11-02T110901-release-standalone
- declare-claude-tweaks-opt-out suite names tests by deleted-spec labels (AC1.2, F5, Task 3) with no #4847 pointer — tests/declare-claude-tweaks-opt-out.test.js:27 — Defer-reason: pre-existing-outside-diff — 2026-11-02T110901-release-standalone
- bare // AC4.2 comment and the AC4.1 #4549 test name carry #4897 criteria without naming #4897 — tests/bin-lib/reconcile/post-merge.test.js:716, tests/bin-lib/reconcile/post-merge.test.js:1040 — Defer-reason: pre-existing-outside-diff — 2026-11-02T110901-release-standalone
- new SessionStart test blocks headed only by bare AC tags with no #4897 pointer — tests/hooks-session-start.test.js:755 — Defer-reason: pre-existing-outside-diff — 2026-11-02T110901-release-standalone
- gitRepo makes its initial commit under the host git config with no GIT_CONFIG_GLOBAL pin, so a host commit.gpgsign or init setting can change fixture history — tests/helpers/git-fixtures.js — Defer-reason: pre-existing-outside-diff — 2026-11-02T111211-record-4639
- the defect-frozen assertions in the merge-provenance test run only the retired commands, so they characterize the old defect rather than guard the fix (tiebreak could not tell whether that is worth acting on) — tests/review-merge-provenance-check.test.js — Defer-reason: tiebreak-cant-tell — 2026-11-02T111211-record-4639
- AC-tagged test names cite deleted-spec labels with no record number; add a conformance check rather than fixing suites one by one — tests/declare-claude-tweaks-opt-out.test.js:27, tests/bin-lib/reconcile/post-merge.test.js:716, tests/hooks-session-start.test.js:755 — Defer-reason: pre-existing-outside-diff — 2026-11-02T110901-release-standalone

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #1426 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fb810edf (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6549793384)
- materiality-2418e1e3 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6549793384)
- materiality-0eebc5a3 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6549793384)
- materiality-b3bd289c (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-e24337bf (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-02e6bfc5 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-a2bf9e65 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-0ad97581 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-85dd7856 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-98c38da4 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-260098ed (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-91d79310 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6555015259)
- materiality-08cd649c (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6562568531)
- materiality-9e3881b7 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6562568531)
- materiality-e31e78ed (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6562568531)
- materiality-340a3aae (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6562568531)
- materiality-8929265d (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6562568531)
- materiality-cfeec051 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6564394898)
- materiality-3bb2c7de (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6564394898)
- materiality-6315af7c (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6564394898)
- materiality-770a423a (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6564394898)
- materiality-cd6c2bd3 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6564394898)
- materiality-0123c04a (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6564394898)
- materiality-4d3a96ea (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6570249045)
- materiality-502f7a0b (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571133505)
- materiality-f5e61c76 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571470400)
- materiality-f354722f (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6571470400)
- materiality-b34ec0c2 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6573186647)
- materiality-f52e4dd7 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6573186647)
- materiality-90492800 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6576257391)
- materiality-bfbe24e9 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6576257391)
- materiality-b86540fc (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6576257391)
- materiality-04f7a410 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6576257391)
- materiality-7694b09d (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6577529331)
- materiality-00fd9a16 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6577529331)
- materiality-1229d57e (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6587419946)
