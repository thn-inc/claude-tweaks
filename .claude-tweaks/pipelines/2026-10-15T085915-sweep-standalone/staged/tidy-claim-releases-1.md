## Staged: Release claims on closed issues (tidy Step 4.7)

Finding: 8 claim blobs classified `stale` on issues that are already CLOSED (their PRs merged). Reconcile release check did not converge them this run.

Proposed: release each claim (tombstone PUT, comment, bot:in-progress label removal) via release-claim.js --sweep.

Rows:
- #2983 Read the direction contract from Impeccable surf…
- #2984 Adapt the finish-reviewer dispatch to Impeccable…
- #2985 Re-pin Impeccable to the engine, re-record fixtu…
- #3101 Repoint the citations #3097 left dangling and m…
- #3102 State the unquoted NODE_EVAL_EOF heredoc conven…
- #3103 Name all five removing exclusions in the #3084 …
- #3104 Dispatch #N reports a record as absent when dis…
- #3105 writeStagedItem allocate:true race test intermi…

Commands:
```bash
node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.140.0/bin/release-claim.js" 2983 --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-15T085915-sweep-standalone" --sweep --reason "swept: issue closed"
node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.140.0/bin/release-claim.js" 2984 --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-15T085915-sweep-standalone" --sweep --reason "swept: issue closed"
node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.140.0/bin/release-claim.js" 2985 --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-15T085915-sweep-standalone" --sweep --reason "swept: issue closed"
node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.140.0/bin/release-claim.js" 3101 --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-15T085915-sweep-standalone" --sweep --reason "swept: issue closed"
node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.140.0/bin/release-claim.js" 3102 --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-15T085915-sweep-standalone" --sweep --reason "swept: issue closed"
node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.140.0/bin/release-claim.js" 3103 --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-15T085915-sweep-standalone" --sweep --reason "swept: issue closed"
node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.140.0/bin/release-claim.js" 3104 --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-15T085915-sweep-standalone" --sweep --reason "swept: issue closed"
node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.140.0/bin/release-claim.js" 3105 --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-15T085915-sweep-standalone" --sweep --reason "swept: issue closed"
```
