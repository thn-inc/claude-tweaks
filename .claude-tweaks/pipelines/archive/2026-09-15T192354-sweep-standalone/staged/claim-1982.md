# Staged: Release stale claim — claims/issue-1982.json

**Finding:** Claim blob `claims/issue-1982.json` classifies `stale` — `claimedAt` 2026-09-11T17:02:50.336Z, age ~99h against a 72h TTL. Issue #1982 is still OPEN (not closed), so reconcile's own background release-on-close convergence does not apply here.

**Proposed:** Release the stale claim so a fresh dispatch can pick #1982 back up.

**Commands:**
```
node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.126.0/bin/release-claim.js" 1982 --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-09-15T192354-sweep-standalone" --sweep --reason "swept: stale claim"
```
