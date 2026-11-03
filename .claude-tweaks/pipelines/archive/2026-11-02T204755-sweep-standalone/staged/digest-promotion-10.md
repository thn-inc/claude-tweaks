# Staged: Propose digest cluster — hooks (5 entries)

**Container:** #1426 (digest)
**Proposed record title:** Settle 5 below-floor digest findings in hooks

## Current State

5 un-promoted digest entries in #1426 share the area `hooks`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- no test compares hooks.js call-site flags under plugin/skills/** against KNOWN_FLAGS, so a flag rename can strand a stdout-capturing caller — plugin/bin/hooks.js:189 — Defer-reason: pre-existing-outside-diff — 2026-11-01T182455-release-standalone
- a value flag at the end of argv (trailing --spec-slug/--mode) is silently treated as absent instead of refused; no test covers it — plugin/bin/hooks.js:236 — Defer-reason: pre-existing-outside-diff — 2026-11-01T182455-release-standalone
- a degraded forge detection is never negatively cached, so an unpinned run re-probes on every covered PreToolUse call while gh times out — plugin/bin/lib/hooks/pre-tool-use.js:2114 — Defer-reason: pre-existing-outside-diff — 2026-11-01T182455-release-standalone
- The #4830 degrade memo lives inside the shared exported resolveRunPinnedIntegrationModel behind hook-only opt-in flags; onDegrade gains an unread second payload shape — plugin/bin/lib/hooks/pre-tool-use.js:1701 — Defer-reason: pre-existing-outside-diff — /claude-tweaks:release v6.160.1 release-gate review (run 2026-11-01T204406-release-standalone)
- the shared run-dir listing (iterRunDirsWithState/listRunDirsWithState) still reads any readdir failure as no runs for its other callers (resolveRunDir, session-start, archive-merged, the pre-tool-use other-worktrees scan); whether each should fail open or closed is undecided and recorded nowhere — plugin/bin/lib/hooks/context.js:254 — Defer-reason: pre-existing-outside-diff — 2026-11-02T024954-record-4809

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #1426 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-076d7ee4 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6562568531)
- materiality-76262e45 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6562568531)
- materiality-c971bd4d (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6562568531)
- materiality-303cff7c (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6564394898)
- materiality-f59055f9 (https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6568865115)
