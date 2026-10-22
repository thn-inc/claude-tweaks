## Tidy Report — 2026-10-21

**Applied automatically**
```text
archived     —       69 clean run dirs (hooks.js archive-run)             high (4 commits)
deleted      —       156 orphaned plans, related record closed            PR #3895 merged
reaped       —       worktree closeout-session (merged, clean)            med
reaped       —       worktree dispatch-record-2734 (merged, clean)        med
reaped       —       worktree dispatch-record-3276 (PR #3833 merged)      med
reaped       —       worktree dispatch-record-3642 (PR #3891 merged)      med
reaped       —       worktree dispatch-record-3661 (PR #3888 merged)      med
reaped       —       worktree dispatch-record-3766 (PR #3808 merged)      med
deleted      —       branches closeout-session, 2734, tmp-sync-main       med (git branch -d)
skipped      —       reconcile archive-branches / reap / remote-prune     reconcile-converged
   budget-exceeded, network-failure, pr-screen-failed — squash-merged branches stay
```

**Approve (8)**
```text
1  [digest]  #1426  Promote [hooks] cluster (3 entries)
   File one backlog record absorbing 3 [hooks] digest entries
   gh issue create --title "hooks: resolve 3 below-floor digest findings"
2  [digest]  #1426  Promote [dispatch] cluster (3 entries)
   File one backlog record absorbing 3 [dispatch] digest entries
   gh issue create --title "dispatch: resolve 3 below-floor digest findings"
3  [digest]  #1426  Promote [docs] cluster (4 entries)
   File one backlog record absorbing 4 [docs] digest entries
   gh issue create --title "docs: resolve 4 below-floor digest findings"
4  [digest]  #1426  Promote [code-health] cluster (9 entries)
   File one backlog record absorbing 9 [code-health] digest entries
   gh issue create --title "code-health: resolve 9 below-floor digest findings"
5  [digest]  #1426  Promote [tidy] cluster (3 entries)
   File one backlog record absorbing 3 [tidy] digest entries
   gh issue create --title "tidy: resolve 3 below-floor digest findings"
6  [pr]  #—  github-pr-scan item 4 closed/merged premise wrong
   Capture a backlog record to fix the item 4 note
   /claude-tweaks:capture github-pr-scan repo-wide item 4: --state closed includes merged PRs
7  [claim]  #2987  Stale claim (run 2026-10-16T222103)
   Release stale claim (swept, past 72h TTL)
   release-claim.js 2987 --run <sweep run dir> --sweep --reason "swept: stale claim"
8  [claim]  #3002  Stale claim (run 2026-10-16T222103)
   Release stale claim (swept, past 72h TTL)
   release-claim.js 3002 --run <sweep run dir> --sweep --reason "swept: stale claim"
```

**Yours (48)**
```text
specify (3)
   #3679   Harden and cover the staged-patch stacked check      too large — decompose; judgment call, no
   #2771   release-triple probe can never run                   too large — decompose; judgment call, no
   #2767   Windows full-suite baseline: classify and drive d…   too large — decompose; judgment call, no
   /claude-tweaks:specify #3679,#2771,#2767
demo (13)
   #3786   reconcile: removal-failed stuck on spec-3078 work…   closed, no acceptance disposition
   #3644   Windows regression: 1 test file newly failing        closed, no acceptance disposition
   #3632   verify.js scoped run cannot baseline-adjudicate      closed, no acceptance disposition
   #3538   Dispatch headless self-report: check3                closed, no acceptance disposition
   #3407   Windows regression: 1 test file newly failing        closed, no acceptance disposition
   #3362   Document subagent-stop trailing STATUS line scope    closed, no acceptance disposition
   #3360   flow/multi-spec.md exceeds its read budget again     closed, no acceptance disposition
   #3229   build/SDD dispatch: multi-task builds spend late     closed, no acceptance disposition
   #3178   verify.js baseline isolation mis-extracts paths      closed, no acceptance disposition
   #3171   verify.js --baseline adjudication fails on fixtur…   closed, no acceptance disposition
   #3125   Skill drift: node-test-output-evidence               closed, no acceptance disposition
   #2914   Two-call /flow dispatch: config.yml missing on re…   closed, no acceptance disposition
   #2859   Ledger-acknowledged failures block verify.js stamp   closed, no acceptance disposition
   /claude-tweaks:demo #3786,#3644,#3632,#3538,#3407,#3362,#3360,#3229,#3178,#3171,#3125,#2914,#2859
git (18)
   —       worktree agent-a47f799d857db07fd                     dirty, 6 ahead, no PR
   —       worktree agent-a97b6fa2589f7ca3f                     dirty (docs/hooks.md), merged
   —       worktree dispatch-record-1337                        dirty, PR #1551 merged
   —       worktree dispatch-record-1725                        dirty, PR #1746 merged
   —       worktree dispatch-record-2785                        dirty, net-empty, no PR
   —       worktree dispatch-record-457                         dirty, PR #1582 merged
   —       worktree record-1471                                 dirty (9 files), PR #1680 merged
   —       worktree record-1686-1733-1734-1737-1738-2225        dirty, PR #2453 merged
   —       worktree record-3001                                 dirty, PR #3235 merged
   —       worktree agent-a62d1a86888ecd871                     unmerged, 4 ahead, no PR
   —       worktree agent-ab4cdd9c1659dc6d3                     unmerged, 13 ahead, no PR
   —       worktree agent-ad8a86f9bdee05233                     unmerged, 10 ahead, no PR
   —       worktree backlog-refine                              unmerged, 9 ahead, no PR
   —       worktree backlog-refine-2718-2730                    unmerged, no PR
   —       worktree dispatch-record-2806                        PR #2836 closed unmerged
   —       worktree dispatch-record-3175                        PR #3454 closed unmerged
   —       worktree record-2840                                 PR #2965 closed unmerged
   —       plan 2026-10-17-windows-regression-guard-3316.md     cited by dispatch-cost-baseline.md
   git -C .claude/worktrees/agent-a47f799d857db07fd status --short
   git -C .claude/worktrees/agent-a97b6fa2589f7ca3f status --short
   git -C .claude/worktrees/dispatch-record-1337 status --short
   git -C .claude/worktrees/dispatch-record-1725 status --short
   git -C .claude/worktrees/dispatch-record-2785 status --short
   git -C .claude/worktrees/dispatch-record-457 status --short
   git -C .claude/worktrees/record-1471 status --short
   git -C .claude/worktrees/record-1686-1733-1734-1737-1738-2225 status --short
   git -C .claude/worktrees/record-3001 status --short
   git -C .claude/worktrees/agent-a62d1a86888ecd871 status --short
   git -C .claude/worktrees/agent-ab4cdd9c1659dc6d3 status --short
   git -C .claude/worktrees/agent-ad8a86f9bdee05233 status --short
   git -C .claude/worktrees/backlog-refine status --short
   git -C .claude/worktrees/backlog-refine-2718-2730 status --short
   git -C .claude/worktrees/dispatch-record-2806 status --short
   git -C .claude/worktrees/dispatch-record-3175 status --short
   git -C .claude/worktrees/record-2840 status --short
   git grep -nF -- '2026-10-17-windows-regression-guard-3316.md'
backlog refine (2)
   #3630   reconcile does not expand an explicit checks subs…   bot:blocked — retry ceiling hit
   #3859   Skill drift: init — claude-md-template.md overrid…   by:harness-health, still valid
   /claude-tweaks:backlog refine
gh (1)
   #3882   chore(main): release 6.151.0                         release PR awaiting review, CI pass
   gh pr view 3882 --web
review (11)
   #3876   Tell review lens agents to write scratch probes      too small — absorb into lens-dispatch record
   #3859   [sizing] not sized this run                          agent Bash refused; re-check
   #3190   [sizing] not sized this run                          agent Bash refused; re-check
   #3188   [sizing] not sized this run                          agent Bash refused; re-check
   #3764   [sizing] not sized this run                          agent Bash refused; re-check
   —       [fetch-limit] backlog-fetch-limit=1000 was hit       raise in policy.yml
   —       [ledger] skill-description-trim-audit kept           cited by open #3831
   —       [pattern] SDD minors carried into ledgers (9)        consider a CLAUDE.md note
   —       [pattern] review findings fixed by pin tests (4)     watch for recurrence
   —       [health] no review-summary artifacts found           category scan blind
   —       [calibration] decision-records, upstream: 0 hits     consider narrowing gates
```

**Clean:**
```text
design docs        0 checked
doc registry       22 checked
ledgers            3 checked
claims             1728 checked
parked triggers    7 checked
ready records      77 checked
```

Full decision log: .claude-tweaks/pipelines/2026-10-21T193636-sweep-standalone/decisions.md
