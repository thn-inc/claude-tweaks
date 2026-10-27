# Staged: Release claim (sweep) — 4 stale claims

**Finding:** Each claim blob classifies `stale` (72h TTL expired on 2026-10-25) while its issue is still OPEN and still carries `bot:in-progress`. No live run owns it.

**Proposed:** release each stale claim (tombstone the blob, comment, remove `bot:in-progress`).

## Rows

- #3315 — Fix latent Windows path producers found by the #2767 class map — claimedAt 2026-10-22T00:17:15Z
- #3974 — Resolve a run's spec header at its live or archived path in every reader — claimedAt 2026-10-22T18:55:32Z
- #3975 — Report stranded spec-shell dirs, ship a command that archives them via one PR, and stop archiveRunDir committing the whole index — claimedAt 2026-10-22T18:56:11Z
- #3976 — Archive the spec header on the run branch before merge (#3855 option a) — claimedAt 2026-10-22T18:55:51Z

## Commands

node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.145.0/bin/release-claim.js" 3315 --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-26T092305-sweep-standalone" --sweep --reason "swept: stale claim"
node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.145.0/bin/release-claim.js" 3974 --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-26T092305-sweep-standalone" --sweep --reason "swept: stale claim"
node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.145.0/bin/release-claim.js" 3975 --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-26T092305-sweep-standalone" --sweep --reason "swept: stale claim"
node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.145.0/bin/release-claim.js" 3976 --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-26T092305-sweep-standalone" --sweep --reason "swept: stale claim"
