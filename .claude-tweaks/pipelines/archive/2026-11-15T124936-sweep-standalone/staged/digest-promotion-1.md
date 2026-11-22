# Staged: Propose digest cluster — tests (22 entries)

**Container:** #5046 (digest)
**Proposed record title:** Settle 22 below-floor digest findings in tests

## Current State

22 un-promoted digest entries in #5046 share the area `tests`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- Test quality: The SIGTERM-mid-check test spawns verify.js with no timeout or killSignal and awaits its exit with no bound, so a regression that leaves verify.js alive after SIGTERM hangs the suite instead of failing. — tests/bin-lib/verify/cli.test.js:3981 — Defer-reason: pre-existing-outside-diff — 2026-11-11T191623-release-standalone
- Test quality: This test runs two real verify.js check runs with the bare inherited env and no timeout; #5119 swept slot-holding spawn sites but missed this one, so a direct node --test of the file queues both runs on the real machine-wide full lane behind any sibling session's suite with nothing to bound the wait. — tests/bin-lib/dispatch/first-call-artifact-check.test.js:894 — Defer-reason: pre-existing-outside-diff — 2026-11-11T191623-release-standalone
- Convention: The skill says withSandbox strips the same keys as slotEnv, but withSandbox (tests/run-tests-isolation.test.js:736-739) does not strip CT_TEST_WORKERS, which the skill's helper description and anti-pattern table treat as required. (Also covers lens 3a's tests/run-tests-isolation.test.js:736 finding, the same mismatch seen from the test side; the alternative fix is a one-line `delete env.CT_TEST_WORKERS` in withSandbox.) — .claude/skills/suite-slot-test-env/SKILL.md:18, tests/run-tests-isolation.test.js:736 — Defer-reason: pre-existing-outside-diff — 2026-11-11T191623-release-standalone
- Test quality: tmpSlotDir() makes verify-slot-test-* directories under the real os.tmpdir() and about ten holdSlot tests never remove them, so each npm test run leaves them behind. — tests/bin-lib/verify/slot.test.js:57 — Defer-reason: pre-existing-outside-diff — 2026-11-11T191623-release-standalone
- engine-cli.test.js appendix-exclusion assertions are negative matches on appendix sentinels that no test asserts are present in cleanup-procedures-execution-appendix.md, so rewording the appendix leaves them passing with nothing behind them (lines 693/700/707/714) — tests/bin-lib/wrap-up/engine-cli.test.js:707, plugin/skills/wrap-up/cleanup-procedures-execution-appendix.md:12 — Defer-reason: tiebreak-cant-tell — 2026-11-11T213038-spec-3847
- The budget fixture reports a zero usage block beside a non-zero modelUsage and cost; the tiebreak could not tell a captured error-path result from a hand edit (no test reads those values) — tests/bin-lib/driver/fixtures/worker-result-budget.json:10 — Defer-reason: tiebreak-cant-tell — 2026-11-12T060404-spec-5217
- the settle.test.js fake git runner asserts cwd inside settle's step() try/catch, so a wrong cwd surfaces only through res.failed checks, not as its own assertion failure — tests/bin-lib/driver/settle.test.js:170 — Defer-reason: tiebreak-cant-tell — 2026-11-13T000400-spec-5219
- tests/helpers-git-template.test.js adds a seventh file-local withEnv save/set/restore helper; no shared env-restore helper exists in tests/helpers/ and the copies take different signatures — tests/helpers-git-template.test.js:65 — Defer-reason: genuinely-larger — 2026-11-13T005056-spec-5297
- tiebreak can't-tell: the #5338 Windows path-spelling pin in hooks-teardown-run.test.js is not discriminated on POSIX (listedWt equals wt there); only Windows CI shows it bites — tests/hooks-teardown-run.test.js — Defer-reason: tiebreak-cant-tell — 2026-11-13T064934-release-standalone
- tiebreak DONE_WITH_CONCERNS: the fake-gh refresh half of risk-flags-refine-prose.test.js is skipped on win32 by name (SKIP_FAKE_GH), so Windows CI never exercises it — tests/risk-flags-refine-prose.test.js — Defer-reason: tiebreak-cant-tell — 2026-11-13T064934-release-standalone
- forge-probe-env's no-HOME control: its second assertion (empty GH_HOST) would also pass if homeDir were ignored and the real home lists no GHE host; only the first assertion pair discriminates — tests/forge-probe-env.test.js:98 — Defer-reason: tiebreak-cant-tell — 2026-11-13T170335-spec-5374
- run-cli helper snapshot() sets pending and installs its stream/homedir wrappers before an unguarded process.cwd() read outside prepare()'s try, so a throwing cwd read wedges every later runCli/runCliSync in the file (fix: read snapshot values first) — tests/helpers/run-cli.js — Defer-reason: needs-human-decision — 2026-11-14T100834-release-standalone
- the #5230 AC5 queue-pull cutover test gates on oracleSkip (bash >= 4) though it never runs bash — both sides go through node plugin/bin/queue-pull.js — so it skips needlessly on stock macOS; Linux CI still runs it (fix: a narrower skip gate) — tests/bin-lib/dispatch/queue-pull-oracle.js, tests/dispatch-queue-pull-cutover-prose.test.js — Defer-reason: needs-human-decision — 2026-11-14T100834-release-standalone
- release ordering check: the after-the-tree-check half passes vacuously when the tree-check string is absent (no presence assert, indexOf -1) — tests/pipelines-push-first-local-runs-conformance.test.js:293 — Defer-reason: tiebreak-cant-tell — 2026-11-13T132412-spec-5319-5369-5370
- AC8.1 asserts only that the moved-HEAD stop detail lacks the worker text; it never pins the detail to movedDetail(HEAD_SHA, OTHER_SHA) (tiebreak can't-tell: evidence-unverified) — tests/bin-lib/driver/run.test.js:1707 — Defer-reason: tiebreak-cant-tell — 2026-11-14T153732-spec-5414-5415
- Two #5414 tests share the AC4.1 title prefix, so the AC4.2 label appears only in one title (tiebreak can't-tell: evidence-unverified) — tests/bin-lib/driver/run.test.js:1624 — Defer-reason: tiebreak-cant-tell — 2026-11-14T153732-spec-5414-5415
- The real gh spawn check compares realDeps.gh.toString() with makeRealDeps().gh.toString(), which cannot show which spawnImpl the closure holds; the recorder assertions after it pin the spawn behaviour — tests/bin-lib/ci-gate-record/cli.test.js:347 — Defer-reason: tiebreak-cant-tell — 2026-11-14T210347-release-standalone
- The re-authorization (bot:blocked) path is unaffected test asserts only result.grant === true although its comment promises the gate's output shape does not vary by bot state; deep-compare against the same call without bot:blocked — tests/bin-lib/issues/grant-gate.test.js:406 — Defer-reason: tiebreak-cant-tell — 2026-11-14T210347-release-standalone
- No test combines gh-timeout-ms with a subdirectory cwd since the policyReadTimeoutMs tests were deleted; the child kill timeout they guarded is gone with the in-process switch, and the subdirectory root lookup is still tested through integration-branch — plugin/bin/lib/policy-schema.js:797, tests/bin-lib/phase-exit/phase-exit.test.js:916 — Defer-reason: pre-existing-outside-diff — 2026-11-14T210347-release-standalone
- The requiring-prints-nothing test compares stdout to a fixed string holding all 8 export names of resolve-policy.js, so adding or renaming an export breaks a test whose title promises only silence and an unset exitCode — tests/resolve-policy-entry.test.js:159 — Defer-reason: pre-existing-outside-diff — 2026-11-14T210347-release-standalone
- BASE_CALLS_PLAIN and BASE_CALLS_FIX pin the full ordered list of injected-dep call kinds, so any reordering of reads inside runImplementer or the review pass fails the test although behaviour is unchanged; a deliberate characterization pin (both lens readers reported it) — tests/bin-lib/driver/run.test.js:2020 — Defer-reason: pre-existing-outside-diff — 2026-11-14T210347-release-standalone
- timing cli test for the gh host probe strips GH_HOST from both process.env and the injected env, so reverting defaultGh's env thread-through passes unless the runner exports GH_HOST (decoy GH_HOST in process.env would pin it) — plugin/bin/lib/timing/budget.js:173, tests/bin-lib/timing/cli.test.js:571 — Defer-reason: tiebreak-cant-tell — 2026-11-15T070437-spec-5382

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #5046 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fingerprint: materiality-f2eeacb2 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6807300212
- materiality-fingerprint: materiality-b56cc40d — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6807300212
- materiality-fingerprint: materiality-d3a09ea2 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6807300212
- materiality-fingerprint: materiality-37f6405f — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6807300212
- materiality-fingerprint: materiality-07391b8e — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6808654515
- materiality-fingerprint: materiality-716b8b6b — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6818591823
- materiality-fingerprint: materiality-df23f62a — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6844459355
- materiality-fingerprint: materiality-ce11bbef — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6844493596
- materiality-fingerprint: materiality-a1aeaecd — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6847517072
- materiality-fingerprint: materiality-79e98a3e — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6847517072
- materiality-fingerprint: materiality-328e98e3 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6862820345
- materiality-fingerprint: materiality-cce613d8 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6875851165
- materiality-fingerprint: materiality-315556c9 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6875851165
- materiality-fingerprint: materiality-0596bb06 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6875884596
- materiality-fingerprint: materiality-6c0ae797 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6882023262
- materiality-fingerprint: materiality-2edc8fcd — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6882023262
- materiality-fingerprint: materiality-daf7cb18 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6885215314
- materiality-fingerprint: materiality-3eb75662 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6885215314
- materiality-fingerprint: materiality-01d5729c — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6885215314
- materiality-fingerprint: materiality-b7160050 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6885215314
- materiality-fingerprint: materiality-09252b92 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6885215314
- materiality-fingerprint: materiality-79fb4163 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6893055157
