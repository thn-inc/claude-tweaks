# Staged: Propose digest cluster — hooks (10 entries)

**Source:** digest container #1426, 10 un-promoted entries sharing `{area}` = `hooks`.

**Proposed:** file one backlog record absorbing them; on approval append `→ #{new}` to each promoted entry line in #1426.

## Proposed record: Settle 10 below-floor digest findings in hooks

### Current State

Digest #1426 holds 10 below-materiality-floor findings in `hooks`, accumulated by review/reflect/wrap-up runs and never promoted.

### Deliverables

- [hooks] No claim recoverable (claim-empty): lens "3b" findings plugin/bin/lib/hooks/session-start.js:309 / plugin/bin/lib/reconcile/ledger-residue.js:61 not reproduced (newline in a committed ledger filename  — plugin/bin/lib/hooks/session-start.js:309 — Defer-reason: console-backfill-no-claim — 2026-10-21T233004-record-3812
- [hooks] No claim recoverable (claim-empty): lens "3f" finding plugin/bin/lib/hooks/pre-tool-use.js:611 not reproduced. — plugin/bin/lib/hooks/pre-tool-use.js:611 — Defer-reason: console-backfill-no-claim — 2026-10-20T215208-record-3769
- [hooks] plugin/bin/lib/hooks/pre-tool-use.js:2222 (the working-directory commit gate) and :2080 (checkDispatchConfigGate) call classifyOwnership without the `{ fsImpl }` third argument that the teardown gate  — plugin/bin/lib/hooks/pre-tool-use.js:2222 — Defer-reason: console-backfill-confirmed-low — 2026-10-22T064007-record-3836
- [hooks] `context.js` re-exports `isPidAlive`, which it does not own (owner: plugin/bin/lib/hooks/worktree-reap.js:122). The only consumer of the re-export is the `isPidAlive` test in tests/hooks-run-attributi — plugin/bin/lib/hooks/context.js:919 — Defer-reason: tiebreak-cant-tell — 2026-10-22T033950-record-3845
- [hooks] The load-bearing premise that Claude Code sets CLAUDE_PID to its own pid in every process it spawns is pinned to "Claude Code 2.1.302" in the comment with no re-verify trigger, unlike docs/hooks.md's  — plugin/bin/lib/hooks/context.js:756 — Defer-reason: tiebreak-cant-tell — 2026-10-22T033950-record-3845
- [hooks] the #3845 owner-process comment block sits above ownerPidPatch, detached from isNestedSession whose liveness rule it describes — plugin/bin/lib/hooks/context.js:775 — Defer-reason: pre-existing-outside-diff — 2026-10-24T152958-release-standalone (release v6.153.0 gate, staged/review-6.md)
- [hooks] heartbeat writer does not re-check owner.heartbeatAt freshness inside the run-state lock, so parallel tool calls after a stale interval each rewrite run-state.json — plugin/bin/lib/hooks/context.js:899, plugin/bin/lib/hooks/context.js:907 — Defer-reason: pre-existing-outside-diff — 2026-10-24T152958-release-standalone (release v6.153.0 gate, staged/review-7.md)
- [hooks] lastCommitMs / lockInUse errors drop git stderr and exit code though runGit returns them (evidence reads "git git-error") — plugin/bin/lib/hooks/resume-freshness.js:154, plugin/bin/lib/run-liveness/probes.js:24 — Defer-reason: pre-existing-outside-diff — 2026-10-24T152958-release-standalone (release v6.153.0 gate, staged/review-10.md)
- [hooks] No claim recoverable (claim-empty): lens 3b finding plugin/bin/lib/run-liveness/index.js:70 not reproduced (a future-dated heartbeatAt reads fresh; fails safe toward live, makes a run unreapable until — plugin/bin/lib/hooks/post-tool-use.js:330 — Defer-reason: console-backfill-no-claim — 2026-10-24T061105-record-3973
- [hooks] (lastCommitMs duplicates the inline read; the old one is frozen until #3979) and — plugin/bin/lib/hooks/resume-freshness.js:150 — Defer-reason: console-backfill-confirmed-low — 2026-10-24T061105-record-3973

### Acceptance Criteria

- Each Deliverables entry is fixed, or explicitly dropped with a one-line reason in this record.
- Each promoted entry line in #1426 carries `→ #{this record}`.
