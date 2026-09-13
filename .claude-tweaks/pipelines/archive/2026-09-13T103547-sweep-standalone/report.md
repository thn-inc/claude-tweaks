## Tidy Report — 2026-09-13

**Applied automatically**
```text
removed        —    31 stale worktrees + local branches (25 merged-PR, 6 net-empty/no-PR)      high
archived       —    2 clean un-archived pipeline run dirs (1 via PR #2360, squash-merged)       high
deleted        —    orphaned ledger for closed #1687 (squash-merged via housekeeping PR)         high
```

**Approve (5)**
```text
1  [claim]  #1135  stale issue claim
   Release — reconcile flagged it but skipped for lack of a matching run-state.json
   staged/tidy-claim-releases-1.md
2  [claim]  #1350  stale issue claim
   Release — reconcile flagged it but skipped for lack of a matching run-state.json
   staged/tidy-claim-releases-1.md
3  [claim]  #1793  stale issue claim
   Release — reconcile flagged it but skipped for lack of a matching run-state.json
   staged/tidy-claim-releases-1.md
4  [claim]  #1795  stale issue claim
   Release — reconcile flagged it but skipped for lack of a matching run-state.json
   staged/tidy-claim-releases-1.md
5  [claim]  #1909  stale issue claim
   Release — reconcile flagged it but skipped for lack of a matching run-state.json
   staged/tidy-claim-releases-1.md
```

**Yours (7)**
```text
git (2)
   #2308  friction-events.js contract-violation over-report                    CI failing on open PR — outward GitHub write
   —      32 merged remote-tracking branches (reconcile remote-prune: budget-exceeded)  outward GitHub write, never auto
   node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile --json
backlog refine (2)
   #1996  Subagent skill-tree read gate: pre-tool-use denies...                judgment call, no mechanical fix
   #1890  Live-verify create_webhook_trigger request/response shape           judgment call, no mechanical fix
   /claude-tweaks:backlog refine
review (3)
   11 parked records with no milestone/watched-path trigger — live judgment needed each sweep     —
   6 worktrees needing manual review (2 dirty+merged, 4 dirty+no-PR: agent-a97b6fa2589f7ca3f, dispatch-record-1725, dispatch-record-457, record-1471, dispatch-record-1337, record-1936-2008-2265-subagentstop)   —
   1 by:harness-health issue still open, awaiting /claude-tweaks:backlog refine                    —
```

**Clean:**
```text
backlog                                       44 checked
code-health                                   0 checked
journey-health                                0 checked
docs-health                                   0 checked
design docs                                   0 checked
registry                                      1 checked
open PRs (awaiting review, CI clean)          3 checked
```

Note: Steps 4.9 (Impeccable doctor), 4.95 (calibration), 5 (ready-record sizing), 5.5 (cross-spec patterns), and full Step 4.8 acceptance-gap/parent-gate sub-scopes were not run to full depth this sweep — time-budgeted out. Plans directory (24 files, 14 with ledgers) got only a ledger-level check, not per-plan spec-status classification.

Full decision log: .claude-tweaks/pipelines/2026-09-13T103547-sweep-standalone/decisions.md
