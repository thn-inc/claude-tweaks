## Tidy Report — 2026-09-15

**Applied automatically**
```text
deleted      #—    8 orphaned execution plans (docs/superpowers/plans/)         commit e23ba36ac / PR #2509
```

**Approve (2)**
```text
1  [claim]   #1982 Stale build claim (99h, TTL 72h, issue still open)
   Release the stale claim so a fresh dispatch can pick it back up
   node bin/release-claim.js 1982 --run {run-dir} --sweep --reason "swept: stale claim"
2  [git]     #—    Merged remote branch not yet pruned
   Delete the merged, un-pruned remote branch
   git push origin --delete worktree-record-1936-2008-2265-subagentstop
```

**Yours (14)**
```text
backlog refine (4)
   #1890  Live-verify create_webhook_trigger request/response shape           hit retry ceiling, needs re-auth
   #2405  CLAUDE.md structure documentation gap                               by:harness-health, still valid
   #2506  Doc staleness: plans/2026-09-12-record-2050-ledger                  by:docs-health, still valid
   #2491  docs/plugin-structure.md reconcile inventory stale                  by:docs-health, still valid
   /claude-tweaks:backlog refine
review (10)
   #794   GitHub App installation identity for the fleet                     parked 4wk, judgment: re-evaluate or delete
   #159   work-backend/work-types/staleness-weeks -> policy.yml?              parked 5wk, judgment: re-evaluate or delete
   #127   Scope harness-health's run log + churn-report                       parked 4wk, judgment: re-evaluate or delete
   .claude/worktrees/fix-surface-lines-hunk-parser                            locked, abandoned lock -- manual review
   .claude/worktrees/agent-a97b6fa2589f7ca3f                                  dirty -- manual review
   .claude/worktrees/dispatch-record-1337                                    dirty -- manual review
   .claude/worktrees/dispatch-record-1725                                    dirty -- manual review
   .claude/worktrees/dispatch-record-457                                     dirty -- manual review
   .claude/worktrees/record-1471                                             dirty -- manual review
   .claude/worktrees/record-1686-1733-1734-1737-1738-2225                    dirty -- manual review
   --     11 clean pipeline-run dirs across two categories                    Archive -- run /claude-tweaks:wrap-up cleanup
   --     Error Handling + Test Quality categories recur across recent PRs    3+ occurrences -- CLAUDE.md rule candidate
   --     Calibration read-out: no telemetry yet                              wrap-up-outcomes.tsv absent
```

**Clean:**
```text
design docs          0 checked
doc registry         12 checked
ledgers               14 checked
open PRs              27 checked
decomposition parents  3 checked
Impeccable doctor      1 checked
```

Full decision log: .claude-tweaks/pipelines/archive/2026-09-15T192354-sweep-standalone/decisions.md
