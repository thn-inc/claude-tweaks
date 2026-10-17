## Tidy Report — 2026-10-17

**Applied automatically**
```text
deleted      —      [plan] 3 orphaned ~/.claude/plans smoke-test plans  untracked file rm
```

**Approve (2)**
```text
1  [sizing]  #2939  CHANGELOG missing entry for v6.134.1
   Absorb into #3175 (same CHANGELOG backfill; close not planned)
   gh issue edit 3175 … && gh issue comment 2939 … && gh issue close 2939 --reason "not planned"
2  [sizing]  #3402  console-resolve.js labels engine-row findings as …
   Absorb into #3389 (duplicate scope; close not planned)
   gh issue edit 3389 … && gh issue comment 3402 … && gh issue close 3402 --reason "not planned"
```

**Yours (25)**
```text
specify (3)
   #3377  Add a Capable plan review before Task 1 of a Spec   judgment: split, 14 deliverables
   #3378  Forward per-task implementer and review tiers       judgment: split, 10 deliverables
   #3191  /claude-tweaks:capture should search open PRs for…  needs scoring: risk/size null
   /claude-tweaks:specify #3377,#3378,#3191
demo (8)
   #3407  Windows regression: 1 test file newly failing       closed, no acceptance disposition
   #3360  flow/multi-spec.md exceeds 20,480-byte read budget  closed, no acceptance disposition
   #3229  build/SDD dispatch: multi-task build cost           closed, no acceptance disposition
   #3125  Skill drift: node-test-output-evidence              closed, no acceptance disposition
   #2914  Two-call /flow handoff: config.yml missing on res…  closed, no acceptance disposition
   #2859  Ledger-acked test failures block verify pass stamp  closed, no acceptance disposition
   #2259  This repo’s migration to the new release process    closed, no acceptance disposition
   #2257  Release lifecycle wiring                            closed, no acceptance disposition
   /claude-tweaks:demo #3407,#3360,#3229,#3125,#2914,#2859,#2259,#2257
git (10)
   —      [git] .claude/worktrees/dispatch-record-1337        manual review: PR #1551 merged; untrac
   —      [git] .claude/worktrees/dispatch-record-1725        manual review: merged; untracked run d
   —      [git] .claude/worktrees/dispatch-record-457         manual review: merged; untracked ledge
   —      [git] .claude/worktrees/record-1471                 manual review: merged; 9 untracked wor
   —      [git] .claude/worktrees/agent-a97b6fa2589f7ca3f     manual review: merged; modified docs/h
   —      [git] .claude/worktrees/dispatch-record-2785        manual review: net-empty but dirty; un
   —      [git] .claude/worktrees/record-1686-1733-1734-173…  manual review: unmerged, 2 ahead; untr
   —      [git] .claude/worktrees/record-3001                 manual review: unmerged, 18 ahead; unt
   —      [git] .claude/worktrees/dispatch-record-2806        manual review: unmerged, 6 ahead; PR #
   —      [git] main checkout dirty — reconcile converged n…  blocks reap of ~40 merged worktrees
   git -C .claude/worktrees/dispatch-record-1337 status --porcelain
   git -C .claude/worktrees/dispatch-record-1725 status --porcelain
   git -C .claude/worktrees/dispatch-record-457 status --porcelain
   git -C .claude/worktrees/record-1471 status --porcelain
   git -C .claude/worktrees/agent-a97b6fa2589f7ca3f status --porcelain
   git -C .claude/worktrees/dispatch-record-2785 status --porcelain
   git -C .claude/worktrees/record-1686-1733-1734-1737-1738-2225 status --porcelain
   git -C .claude/worktrees/record-3001 status --porcelain
   git -C .claude/worktrees/dispatch-record-2806 status --porcelain
   git status --short .claude-tweaks/pipelines
backlog refine (1)
   #3200  Skill best-practice: prose-code-twin-pin — Anti-P…  still valid harness-health issue
   /claude-tweaks:backlog refine
gh (3)
   #3375  claim tombstoned "merged", issue still open    manual review; sibling run in flight
   #3380  claim tombstoned "merged", issue still open    manual review; sibling run in flight
   —      [claim] 15 open issues abandoned on dispatch-reco…  manual review: unreviewed work
   gh issue view 3375 --json state,labels
   gh issue view 3380 --json state,labels
   gh pr list --head worktree-dispatch-record-2734 --state all
review (3)
   —      [calibration] decision-records + upstream rows: 0…  consider narrowing those gates
   —      [plan] 14 closed-record plans kept per ADR-0007     prune needs explicit direction
   —      [health] 534 PRs merged in 8 weeks; no cross-spec…  5-artifact cap all one spec (#3375)
```

**Clean:**
```text
records            157 checked
release notes      126 checked
sizing             120 checked
claims             1498 checked
registry           24 checked
ledgers            1 checked
design docs        0 checked
digest             1 checked
```

Note: closed fetch hit backlog-fetch-limit (1000); acceptance-gap may be incomplete.

Full decision log: .claude-tweaks/pipelines/2026-10-17T171933-sweep-standalone/decisions.md
