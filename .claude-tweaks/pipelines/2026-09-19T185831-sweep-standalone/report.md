## Tidy Report — 2026-09-19

**Applied automatically**
```text
deleted       —     10 orphaned execution plans (all cited records closed)         PR #2616 merged
deleted       #2240 orphaned ledger, record closed, no live run dir                PR #2616 merged
archived      —     4 clean pipeline-run dirs into archive/index-2026-09.md        reversible: high
removed       —     stale worktree checkout record-1676 (branch preserved)         reversible: high
```

**Approve (5)**
```text
1  [claim]  #2428  issue closed
   Release the stale claim
   node plugin/bin/release-claim.js 2428 --run 2026-09-19T185831-sweep-standalone --sweep --reason "swept: issue closed"
2  [claim]  #2458  issue closed
   Release the stale claim
   node plugin/bin/release-claim.js 2458 --run 2026-09-19T185831-sweep-standalone --sweep --reason "swept: issue closed"
3  [claim]  #2486  issue closed
   Release the stale claim
   node plugin/bin/release-claim.js 2486 --run 2026-09-19T185831-sweep-standalone --sweep --reason "swept: issue closed"
4  [claim]  #2506  issue closed
   Release the stale claim
   node plugin/bin/release-claim.js 2506 --run 2026-09-19T185831-sweep-standalone --sweep --reason "swept: issue closed"
5  [claim]  #2492  missed bot:in-progress removal
   Remove the orphaned label
   gh issue edit 2492 --remove-label bot:in-progress
```

**Yours (5)**
```text
review (5)
   —      6 dirty worktrees need manual inspection                                 judgment call
   —      5 unmerged/non-net-empty worktrees need manual review                    judgment call
   #2533  ready record missing risk/size scoring                                   judgment call
   —      8 cross-spec pattern/health observations for CLAUDE.md                   judgment call
   —      90 acceptance-gap + 11 unarmed-PR records — see report-condensed.md      judgment call
```

**Clean:**
```text
Step 3 design docs        0 checked, none found
Step 4.6 doc registry      12 entries checked
Step 4.9 design doctor     skipped (no doctor.mjs at installed Impeccable version)
Step 4.95 calibration      no telemetry yet
Step 4 ledgers             14 of 15 checked, kept (open items or live run dir)
```

Full decision log: .claude-tweaks/pipelines/2026-09-19T185831-sweep-standalone/decisions.md
