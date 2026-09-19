# Staged: issue-claim releases (5)

Finding: `[claim]` Step 4.7 scan — outward-facing GitHub writes (tombstone PUT + comment +
`bot:in-progress` label removal), staged rather than auto-applied per the reversibility floor.

| Claim | Status | Recommendation |
|---|---|---|
| claims/issue-2428.json | issue closed | Release |
| claims/issue-2458.json | issue closed | Release |
| claims/issue-2486.json | issue closed | Release |
| claims/issue-2506.json | issue closed | Release |
| claims/issue-2492.json | `bot:in-progress` present, no active claim | likely missed bot:in-progress removal |

Commands (run each, `--sweep` lets this tidy run release a claim it does not own):
```
node plugin/bin/release-claim.js 2428 --run 2026-09-19T185831-sweep-standalone --sweep --reason "swept: issue closed"
node plugin/bin/release-claim.js 2458 --run 2026-09-19T185831-sweep-standalone --sweep --reason "swept: issue closed"
node plugin/bin/release-claim.js 2486 --run 2026-09-19T185831-sweep-standalone --sweep --reason "swept: issue closed"
node plugin/bin/release-claim.js 2506 --run 2026-09-19T185831-sweep-standalone --sweep --reason "swept: issue closed"
gh issue edit 2492 --remove-label bot:in-progress
```
