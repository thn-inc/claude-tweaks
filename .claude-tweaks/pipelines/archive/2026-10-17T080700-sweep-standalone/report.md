## Tidy Report — 2026-10-17

**Applied automatically**
```text
filled-note  #3269  pr-first-merge Step 3 misses the Protected branch…  snapshot saved
   Auto-merge arming now recognizes the "Protected branch rules not configured" failure and rou…
filled-note  #3261  Flaky allowlist: palette.test.js + statusline.tes…  snapshot saved
   No user-visible change: two known-flaky test files are added to the verify flaky allowlist s…
deleted      —      [plan] 47 orphaned plans, related records closed    commit 55a58ee
reaped       —      [git] worktree probe-guard-hooks (merged, net-emp…  reversible
archived     —      [git] 58 clean pipeline run dirs                    reconcile-converged
   reap, archive-branches, remote-prune skipped twice: reconcile budget exceeded
```

**Approve (4)**
```text
1  [sizing]  #2990  CHANGELOG.md is missing the v6.136.0 entry
   Absorb into #3175 (v6.136.0 is inside its backfill range)
   gh issue comment 2990 … && gh issue close 2990 --reason "not planned"
2  [sizing]  #3287  Allowlist palette.test.js as flaky
   Absorb into #3261 (duplicate scope; close not planned)
   gh issue comment 3287 … && gh issue close 3287 --reason "not planned"
3  [sizing]  #3288  Allowlist statusline.test.js as flaky
   Absorb into #3261 (duplicate scope; close not planned)
   gh issue comment 3288 … && gh issue close 3288 --reason "not planned"
4  [gh-issue]  #3303  Remove leftover probe-guard-hooks worktree/branch
   Close as completed (worktree and branch already removed by tidy)
   gh issue comment 3303 … && gh issue close 3303 --reason completed
```

**Yours (45)**
```text
specify (5)
   #3191  /capture should search open PRs for overlap         ready, risk and size unscored
   #3035  flow multi-spec: no CLI creates manifest.yml        too large (8 deliverables); split
   #3021  review: fix re-verify rebuilds under live server    too large (8 deliverables); split
   #2857  Make harness-health Premise-check paths portable    too large (9 deliverables); split
   #2622  Add a pre-scale hardening skill for AI-coded apps   too large (8 deliverables); split
   /claude-tweaks:specify #3191,#3035,#3021,#2857,#2622
demo (3)
   #3125  closed, no acceptance disposition                   judgment call, no mechanical fix
   #2914  closed, no acceptance disposition                   judgment call, no mechanical fix
   #2859  closed, no acceptance disposition                   judgment call, no mechanical fix
   /claude-tweaks:demo #3125,#2914,#2859
git (20)
   —      [git] dispatch-record-2601                          clean; PR #3320 merged, no join
   —      [git] dispatch-record-2902                          clean; PR #3334 merged, no join
   —      [git] dispatch-record-2970                          clean; PR #3292 merged, no join
   —      [git] dispatch-record-3249                          clean; PR #3280 merged, no join
   —      [git] flow-record-2877                              clean; PR #3300 merged, no join
   —      [git] flow-record-2941                              clean; PR #3344 merged, no join
   —      [git] flow-spec-2927                                clean; PR #3342 merged, no join
   —      [git] record-2907                                   clean; PR #3299 merged, no join
   —      [git] record-3023                                   clean; PR #3238 merged, no join
   —      [git] backlog-refine                                unpushed: 9 ahead, no PR
   —      [git] backlog-refine-2718-2730                      unpushed: 1 ahead, no PR
   —      [git] dispatch-record-2806                          abandoned: PR #2836 closed
   —      [git] agent-a97b6fa2589f7ca3f                       dirty; branch merged, no PR
   —      [git] dispatch-record-457                           dirty; branch merged
   —      [git] dispatch-record-1725                          dirty; branch merged
   —      [git] dispatch-record-1337                          dirty; merged; stale active run
   —      [git] record-1471                                   dirty; branch merged
   —      [git] dispatch-record-2785                          dirty; net-empty, no PR
   —      [git] record-1686-1733-1734-1737-1738-2225          dirty; PR #2453 merged
   —      [git] record-3001                                   dirty; PR #3235 merged
   git worktree remove ".claude/worktrees/dispatch-record-2601"
   git worktree remove ".claude/worktrees/dispatch-record-2902"
   git worktree remove ".claude/worktrees/dispatch-record-2970"
   git worktree remove ".claude/worktrees/dispatch-record-3249"
   git worktree remove ".claude/worktrees/flow-record-2877"
   git worktree remove ".claude/worktrees/flow-record-2941"
   git worktree remove ".claude/worktrees/flow-spec-2927"
   git worktree remove ".claude/worktrees/record-2907"
   git worktree remove ".claude/worktrees/record-3023"
   git -C ".claude/worktrees/backlog-refine" status --short
   git -C ".claude/worktrees/backlog-refine-2718-2730" status --short
   git -C ".claude/worktrees/dispatch-record-2806" status --short
   git -C ".claude/worktrees/agent-a97b6fa2589f7ca3f" status --short
   git -C ".claude/worktrees/dispatch-record-457" status --short
   git -C ".claude/worktrees/dispatch-record-1725" status --short
   git -C ".claude/worktrees/dispatch-record-1337" status --short
   git -C ".claude/worktrees/record-1471" status --short
   git -C ".claude/worktrees/dispatch-record-2785" status --short
   git -C ".claude/worktrees/record-1686-1733-1734-1737-1738-2225" status --short
   git -C ".claude/worktrees/record-3001" status --short
backlog refine (1)
   #3200  by:harness-health finding still valid               judgment call, no mechanical fix
   /claude-tweaks:backlog refine
gh (12)
   #3355  Release PR chore(main): release 6.143.1             CI test failing; main tip red
   #3322  PR awaiting review (CI green, not armed)            outward GitHub write, never auto
   #2939  CHANGELOG missing entry for v6.134.1                absorbing widens a backfill range
   #3266  Dispatch async-wait: no-tool reply = stop           too small; absorb candidate
   #2448  Swept stale claim with open PR goes undetected      parked 33d; trigger may have fired
   #1597  Consider a state-machine plan-markdown parser       parked 48d; trigger not evidenced
   #986   Live-verify the chunked Instructions-fill procedu…  parked 58d; trigger not evidenced
   #794   GitHub App installation identity for the fleet      parked 61d; trigger not evidenced
   #279   Event-driven dispatch via GitHub webhook trigger    parked 55d; prerequisite unknown
   #159   Decide whether work-backend keys move to policy     parked 69d; trigger not evidenced
   #127   Scope harness-health's run log + churn-report       parked 64d; trigger not met
   #126   Grouping-by-blocker in ledger resolve-gate P2       parked 55d; trigger not evidenced
   gh pr checks 3355
   gh pr view 3322 --web
   gh issue view 2939
   gh issue view 3266
   gh issue view 2448
   gh issue view 1597
   gh issue view 986
   gh issue view 794
   gh issue view 279
   gh issue view 159
   gh issue view 127
   gh issue view 126
node (1)
   —      [calibration] decision-records, upstream: 0 hits    judgment call, no mechanical fix
   node "$CLAUDE_PLUGIN_ROOT/bin/calibration-report.js" --runs 50
review (3)
   —      [digest] 4 docs entries cite deleted ledgers        #1426; nothing left to promote
   —      [acceptance-gap] fetch capped at 1000 records       raise backlog-fetch-limit
   —      [parent-gate] issue-state map capped at 1000        raise backlog-fetch-limit
```

**Clean:**
```text
design docs        0 checked
plans              48 checked
ledgers            5 checked
registry           22 checked
claims             1480 checked
records            155 checked
patterns           5 checked
```

Full decision log: .claude-tweaks/pipelines/2026-10-17T080700-sweep-standalone/decisions.md
