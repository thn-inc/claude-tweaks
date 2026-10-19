## Tidy Report — 2026-10-18

**Applied automatically**
```text
deleted      —      65 orphaned execution plans                        PR #3525 (unarmed)
removed      —      [git] worktree backlog-refine-20261018             branch -d, tip on main
archived     —      [run] 2026-10-16T202641-record-3017                reconcile-converged
```

**Approve (8)**
```text
1  [parked]  #2448  Dispatch/tidy: a swept stale claim with a still-o…
   Close as not planned — parked 34d, stale, trigger not met
   gh issue close 2448 --reason "not planned" --comment "tidy: parked 34d, trigger unmet"
2  [parked]  #1597  Consider a state-machine plan-markdown parser if …
   Close as not planned — parked 49d, stale, trigger not met
   gh issue close 1597 --reason "not planned" --comment "tidy: parked 49d, trigger unmet"
3  [parked]  #986  Live-verify 488's chunked Instructions-fill proc…
   Close as not planned — parked 59d, stale, trigger not met
   gh issue close 986 --reason "not planned" --comment "tidy: parked 59d, trigger unmet"
4  [parked]  #794  GitHub App installation identity for the fleet
   Close as not planned — parked 62d, stale, trigger not met
   gh issue close 794 --reason "not planned" --comment "tidy: parked 62d, trigger unmet"
5  [parked]  #279  Event-driven dispatch via GitHub webhook trigger
   Close as not planned — parked 56d, stale, trigger not met
   gh issue close 279 --reason "not planned" --comment "tidy: parked 56d, trigger unmet"
6  [parked]  #159  Decide whether work-backend / work-types / record…
   Close as not planned — parked 70d, stale, trigger not met
   gh issue close 159 --reason "not planned" --comment "tidy: parked 70d, trigger unmet"
7  [parked]  #127  Scope harness-health's run log + churn-report to …
   Close as not planned — parked 65d, stale, trigger not met
   gh issue close 127 --reason "not planned" --comment "tidy: parked 65d, trigger unmet"
8  [parked]  #126  Reconsider a grouping-by-blocker affordance in le…
   Close as not planned — parked 56d, stale, trigger not met
   gh issue close 126 --reason "not planned" --comment "tidy: parked 56d, trigger unmet"
```

**Yours (37)**
```text
/claude-tweaks:specify (3)
   #3377  Add a Capable plan review before Task 1 of a Spec… too large: 14 deliverables
   #3378  Forward per-task implementer and review tiers for… too large: 10 deliverables
   #2622  Add a pre-scale hardening skill for AI-coded apps  too large: 12 deliverables
   /claude-tweaks:specify #3377,#3378,#2622
/claude-tweaks:demo (9)
   #3407  Windows regression: 1 test file(s) newly failing … closed, no disposition
   #3362  Document that the subagent-stop trailing STATUS l… closed, no disposition
   #3360  flow/multi-spec.md exceeds its 20,480-byte read b… closed, no disposition
   #3229  build / subagent-driven-development dispatch cost… closed, no disposition
   #3178  verify.js baseline isolation mis-extracts test-fi… closed, no disposition
   #3171  verify.js --baseline adjudication fails on its ow… closed, no disposition
   #3125  Skill drift: node-test-output-evidence — Key Patt… closed, no disposition
   #2914  Two-call /flow dispatch handoff: config.yml missi… closed, no disposition
   #2859  Ledger-acknowledged pre-existing test failures bl… closed, no disposition
   /claude-tweaks:demo #3407,#3362,#3360,#3229,#3178,#3171,#3125,#2914,#2859
git (14)
   —      [git] backlog-refine                               unmerged: 8 patches, no PR
   —      [git] backlog-refine-2718-2730                     10 archive renames, not net-empty
   —      [git] agent-a97b6fa2589f7ca3f                      dirty docs/hooks.md, branch merged
   —      [git] dispatch-record-2785                         dirty, 1 patch, no PR
   —      [git] record-3001                                  dirty .superpowers/, PR #3235 merged
   —      [git] dispatch-record-1337                         dirty, PR #1551 merged
   —      [git] dispatch-record-1725                         dirty, PR #1746 merged
   —      [git] dispatch-record-457                          dirty, PR #1582 merged
   —      [git] record-1471                                  dirty, PR #1680 merged
   —      [git] record-1686-1733-1734-1737-1738-2225         dirty, PR #2453 merged
   —      [git] dispatch-record-2806                         PR #2836 closed unmerged, 5 patches
   —      [git] record-2840                                  PR #2965 closed, tombstoned
   —      [git] dispatch-record-3175                         PR #3454 closed unmerged, 1 patch
   —      [plan] 2026-10-17-windows-regression-guard-3316.md cited by dispatch-cost-baseline.md
   git -C .claude/worktrees/backlog-refine status
   git -C .claude/worktrees/backlog-refine-2718-2730 status
   git -C .claude/worktrees/agent-a97b6fa2589f7ca3f status
   git -C .claude/worktrees/dispatch-record-2785 status
   git -C .claude/worktrees/record-3001 status
   git -C .claude/worktrees/dispatch-record-1337 status
   git -C .claude/worktrees/dispatch-record-1725 status
   git -C .claude/worktrees/dispatch-record-457 status
   git -C .claude/worktrees/record-1471 status
   git -C .claude/worktrees/record-1686-1733-1734-1737-1738-2225 status
   git -C .claude/worktrees/dispatch-record-2806 status
   git -C .claude/worktrees/record-2840 status
   git -C .claude/worktrees/dispatch-record-3175 status
   git grep -nF -- '2026-10-17-windows-regression-guard-3316.md'
/claude-tweaks:backlog refine (1)
   #3500  policy.yml has 1 unrecognized key(s) / invalid va… by:harness-health, still valid
   /claude-tweaks:backlog refine
gh (1)
   #3525  Delete 65 orphaned execution plans                 unarmed: test check still pending
   gh pr merge 3525 --repo thn-inc/claude-tweaks --squash
review (9)
   #3463  /specify red-team: flag an AC whose mandated fixt… too small: absorb into a related record
   —      [acceptance-gap] closed-record fetch hit its 1000… raise backlog-fetch-limit, policy.yml
   —      [parent-gate] issue-state map hit its 1000 cap     raise backlog-fetch-limit, policy.yml
   —      [digest] 4 [docs] entries in #1426 cite deleted l… mark each → expired
   —      [archival] ~60 aged + 33 clean run dirs not compa… main is 31 behind origin, 4 unpushed
   —      [reconcile] reap/archive-branches/prune skipped    budget-exceeded; 256 merged-PR branches
   —      [pattern] ledger deletion has two owners (7 specs) pick one owner in wrap-up close step
   —      [calibration] decision-records, upstream: 0 findi… consider narrowing those gates
   —      [health] review summaries are not committed to git no recurrence signal in 5 artifacts
```

**Clean:**
```text
claims             3 checked
registry           18 checked
ledgers            1 checked
design docs        0 checked
release notes      0 checked
```

Full decision log: .claude-tweaks/pipelines/2026-10-18T182125-sweep-standalone/decisions.md
