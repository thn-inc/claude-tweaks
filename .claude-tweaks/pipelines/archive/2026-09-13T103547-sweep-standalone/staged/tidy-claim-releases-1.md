## Staged: Release stale issue claims

Finding: 5 issue-claim blobs classify as `stale` (crashed/abandoned runs) for still-open issues #1135, #1350, #1793, #1795, #1909 — reconcile's own claims check independently flagged all 5 this run but skipped auto-release for lack of a matching run-state.json ("no-run-state"), so this needs a human-approved sweep release rather than reconcile's own background convergence.

Proposed: release each stale claim.

Commands:
node "${CLAUDE_PLUGIN_ROOT}/bin/release-claim.js" 1135 --run "$RUN_DIR" --sweep --reason "swept: stale claim"
node "${CLAUDE_PLUGIN_ROOT}/bin/release-claim.js" 1350 --run "$RUN_DIR" --sweep --reason "swept: stale claim"
node "${CLAUDE_PLUGIN_ROOT}/bin/release-claim.js" 1793 --run "$RUN_DIR" --sweep --reason "swept: stale claim"
node "${CLAUDE_PLUGIN_ROOT}/bin/release-claim.js" 1795 --run "$RUN_DIR" --sweep --reason "swept: stale claim"
node "${CLAUDE_PLUGIN_ROOT}/bin/release-claim.js" 1909 --run "$RUN_DIR" --sweep --reason "swept: stale claim"
