# Staged: Release stale claims — #2987, #3002

Finding: [claim] claims/issue-2987.json and claims/issue-3002.json are both classified `stale`. claimedAt is 2026-10-16T22:33:22Z, past the 72h TTL. The runId is 2026-10-16T222103-record-2987, which has no run-state. Both issues are OPEN.
Proposed: release both claims with --sweep. That writes a tombstone PUT, a comment, and removes the bot:in-progress label.

## Commands
node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.145.0/bin/release-claim.js" 2987 --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-21T193636-sweep-standalone" --sweep --reason "swept: stale claim"
node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.145.0/bin/release-claim.js" 3002 --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-21T193636-sweep-standalone" --sweep --reason "swept: stale claim"
