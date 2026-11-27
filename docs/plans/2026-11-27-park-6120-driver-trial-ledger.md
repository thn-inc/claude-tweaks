# Open Items — Park the #6120 driver trial and set `express-driver-runner` back to `session`

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check (flow Step 2.5): origin/main was 5 commits ahead of local HEAD at run start | fixed | Post-creation catch-up merged origin/main into the worktree branch (0fdce3f -> 99f179f) before any build commit |
| 2 | wrap-up | Reflect (Friction): flow Step 2.8 has no CLI-path instruction for an exit-0 claim-targets.js result with non-empty labelFailures; this run's bot:in-progress add timed out and was re-added by hand | deferred | Digest entry https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-7223154402 — Defer-reason: tangential |
| 3 | wrap-up | Reflect (Friction): flow Step 2.8 file-overlap warning over 885 open records ran past the 300s Bash ceiling | deferred | Digest entry https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-7223154402 — Defer-reason: tangential |
