# Open Items — policy-schema detectIntegrationModel: ignores gh-timeout-ms and silently falls back to local-merge

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow/ops | Step 2.5 pre-flight branch-divergence-check: origin/main was 15 commits ahead of the adopted dispatch branch | fixed | Post-creation catch-up merged origin/main into the branch at 9fb9f0ad5 |
| 2 | flow/ops | Step 2.5 pre-flight branch-divergence-check (run 2026-10-31T153223): origin/main was 2 commits ahead (release 6.158.0) | fixed | Post-creation catch-up merged origin/main into the branch at 2171238a9 |
| 3 | flow/ops | Step 2.5 pre-flight branch-divergence-check (run 2026-10-31T175200): origin/main was 5 commits ahead | fixed | Post-creation catch-up merged origin/main into the branch at ada292d9c |
| 4 | build | SDD Task 1 minor: tests/helpers/fake-gh.js header comment claimed an orphaned sleep blocks execFileSync for the full sleep (false on macOS — execFileSync returns at its timeout) | fixed | Comment reworded in the final-review fix wave — `35bd88f80` |
| 5 | build | SDD Task 2 minor: no committed test pinned express/policy.js and flow/preflight.js passing runConfigRaw | fixed | Run-pin tests added in tests/bin-lib/flow/preflight.test.js and tests/bin-lib/express/policy.test.js — `35bd88f80` |
| 6 | build | SDD Task 3 minor: no-op .replace(/'/g, '') in the tests/hooks-pre-tool-use.test.js go-red self-test | fixed | Removed — `35bd88f80` |
| 7 | build | SDD Task 3 minor: tests/helpers/strip-comments.js blank-mode caller list omitted run-liveness-callers-conformance and hooks-pre-tool-use (and, after the fix wave, phase-exit) | fixed | Names added — `35bd88f80`, residual phase-exit name and comma — `93062628c` |
| 8 | build | SDD Task 5 minor: precondition.js comment line (107 chars) not reflowed | fixed | Reflowed — `35bd88f80` |
| 9 | build | SDD Task 5 minor: precondition.test.js did not pin the resolveRunPinnedIntegrationModel call-site count to 1 | fixed | Count assertion and two-call go-red case added — `35bd88f80` |
| 10 | build | SDD Task 6 minor: DEGRADED_REASONS alias of FORGE_DEGRADE_REASONS and a doc comment spelling out the codes in lib/flow/manifesto-write.js | fixed | Alias removed, doc comment points at FORGE_DEGRADE_REASONS — `35bd88f80`; resolve-policy.js header kept (it documents the CLI's JSON output) |
| 11 | build | SDD Task 8 minor: phase-exit.test.js wiring scan checked guard-before-ladder anywhere in the file, not inside policyReadTimeoutMs | fixed | Scan scoped to the function body, with a different-function go-red case — `35bd88f80` |
| 12 | build | SDD ruling — express/policy.js and flow/preflight.js in-process callers pass runConfigRaw: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 13 | build | SDD ruling — session-start test is behavioural (stubbed reconcile) instead of a source scan: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 14 | build | SDD ruling — precondition.js no-timeout pin narrowed to the call argument: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 15 | build | SDD ruling — degrade reason codes exported from policy-schema.js (FORGE_DEGRADE_REASONS): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 16 | build | SDD ruling — manifesto.md Write-mechanism paragraph left unsplit (readability minor): ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 17 | build | SDD ruling — phase-exit realDeps.resolvePolicy missing-entry guard has no test: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 18 | build | SDD ruling — Q5 x Q10: an unpinned degraded run re-detects the forge on every covered PreToolUse call: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
