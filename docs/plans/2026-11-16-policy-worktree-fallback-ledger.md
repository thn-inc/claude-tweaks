# Open Items — policy resolution in worktrees: gitignored policy.yml is invisible, so pr-early-open targets the default branch

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — T1 Step 4 go-red probe wording: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — Fake readFile still takes existence from disk (plan-mandated): ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — findPolicyFile pre-filter premise corrected; F1/F3 fixed: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — mainCheckoutRoot submodule-in-worktree misanchoring deferred: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — Paste-ready printf append duplicates a key line (last wins): ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | SDD ruling — Stale line number in path-guard allowlist reason text: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 7 | build | SDD ruling — policySource undefined not pinned negative: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 8 | build | SDD ruling — findPolicyFile pre-filter no-change (superseded: fixed as F3): ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 9 | review/hindsight | Reader coverage: plugin/bin/lib/code-health/candidates-agent-trust-scope.js read policy.yml directly, so /review Step 6.65 from a worktree reported not-applicable (3 lens agents across 3e/3a flagged it; evidence: plugin/bin/lib/code-health/candidates-agent-trust-scope.js:126). Routed through locatePolicyFile with a real-worktree regression test, commit 87de255b0 | fixed | Fixed in 87de255b0; test goes red without the change |
| 10 | review/hindsight | Release-local policy read (plugin/bin/release-local.js:204) stays root-relative, not routed through the locator | accepted | release-local reads against an explicit --root that guardReleasableTree requires to be a clean tip checkout, not a linked worktree run; no worktree-side read exists to fix |
| 11 | review/code | Residual low-severity worktree-vs-main policy asymmetries: hooks.sh policy_verdict mirror, calibration-report.js:143 paste command, policy-file.js admin back-link check, 8 readers without a fallback test | deferred | Staged as a backlog proposal: staged/reflect-1.md |
