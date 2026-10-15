## /tidy
- SCANNED 11:20:52 — Step 4.5: reconcile --json: mirror dirty (local main 1 ahead / 93 behind origin, not ff'd); console.ready empty; reap/archive-branches/remote-prune skipped (budget-exceeded). Reversibility: n/a.
- AUTO 11:20:52 — Step 6: removed 60 clean worktrees whose PR is MERGED (re-verified unlocked + clean + PR merged per item); 7 branches deleted with -d, 53 kept (-d refused: squash-merged, left to reconcile archive-branches). Reversibility: med. [lever: tidy-aggressiveness=moderate (default)]
- SCANNED 11:20:52 — Step 4.5: 8 [git] release findings (CHANGELOG v6.136.0..v6.140.1) are a stale-local-main artifact: origin/main CHANGELOG carries all 8 headings - not actioned. Reversibility: n/a.
- SCANNED 11:20:52 — Step 4.9: design-wrapper doctor skipped: design integration not configured (silent degrade). Reversibility: n/a.
- STAGED 11:21:05 — Step 6: release proposal for 8 stale claims on closed issues (#2983,#2984,#2985,#3101-#3105). Stage path: staged/tidy-claim-releases-1.md. Reversibility: med.
- AUTO 11:22:02 — Step 7: deleted 13 orphaned plans on origin/main whose related record is closed and no repo file cites them (2688, 2694, 3084, 3087, 3091-3094, 3101-3105); re-verified fresh before git rm. Reversibility: med. [lever: tidy-aggressiveness=moderate (default)]
