# Open Items — #3337 verify-scope.json: map docs/journeys/** to the journey suites instead of fail-closed full

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 3 commits ahead of local main at run start (release 6.143.0, changelog, #3036) — continued under auto; merged into the worktree by post-creation catch-up (reason-not-auto: divergence-noted) | open | — |
| 2 | ops | Reconcile reported CI red on main tip e6e77ed (test job) at run start — verification must adjudicate any failures against that baseline rather than attribute them to this build (reason-not-auto: external-ci-state) | open | — |
| 3 | build | Identified the red main-tip failure: `tests/timing-prose-conformance.test.js` "#1928: multi-spec.md … stays under its read budget" (`multi-spec.md is 20903 B`, introduced by #3036's merge). Already in flight: #3311 (decommission every per-file size pin) in sibling run PR #3348 — no new record. It also appears inside the new `journeys` suite's run until #3311 lands | observation | Tracked by #3311 / PR #3348; baseline-adjudicable via `retry.journeys` |
