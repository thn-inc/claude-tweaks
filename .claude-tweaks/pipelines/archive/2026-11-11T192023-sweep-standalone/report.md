## Tidy Report — 2026-11-11

**Applied automatically**
```text
reaped       —      .claude/worktrees/dispatch-record-4321              reconcile-converged
filled-note  #5136  Run verify.js's CI wiring tests on Windows          snapshot saved
   Extended the verification CLI's CI wiring tests to run on Windows checkouts
filled-note  #5135  Test the CI-source gating and fallback paths in v…  snapshot saved
   Added test coverage for the gating and fallback paths of CI-sourced verification
filled-note  #5134  Keep verify.js's CI wait inside the foreground to…  snapshot saved
   Kept CI-sourced verification waits inside the foreground command time limit
filled-note  #5133  Restore the push instruction in build's Common St…  snapshot saved
   Restored the push-before-verify instruction for CI-sourced verification during builds
filled-note  #5059  Share one fail-closed policy.yml reader across th…  snapshot saved
   Unified how parent-gate checks read project policy so a broken policy file fails closed
filled-note  #5031  Close the recording store edges once a store call…  snapshot saved
   Tightened the acceptance packet's recording-store link checks once a remote store caller exists
filled-note  #5030  Widen the link and redaction screens of the accep…  snapshot saved
   Widened the acceptance packet's link and secret-redaction screens to catch more token shapes
archived     —      2026-11-02T202321-dispatch-standalone               archive/ (local move)
archived     —      2026-11-02T203719-dispatch-standalone               archive/ (local move)
archived     —      2026-11-02T205244-dispatch-standalone               archive/ (local move)
archived     —      2026-11-03T083002-dispatch-standalone               archive/ (local move)
archived     —      2026-11-03T083016-dispatch-standalone               archive/ (local move)
archived     —      2026-11-03T085046-dispatch-standalone               archive/ (local move)
archived     —      2026-11-03T085908-backlog-standalone                archive/ (local move)
archived     —      2026-11-03T093430-dispatch-standalone               archive/ (local move)
archived     —      2026-11-03T093453-backlog-standalone                archive/ (local move)
archived     —      2026-11-03T093731-dispatch-standalone               archive/ (local move)
archived     —      2026-11-03T095826-dispatch-standalone               archive/ (local move)
archived     —      2026-11-03T100331-dispatch-standalone               archive/ (local move)
archived     —      2026-11-03T101351-dispatch-standalone               archive/ (local move)
archived     —      2026-11-03T114006-dispatch-standalone               archive/ (local move)
archived     —      2026-11-03T114019-dispatch-standalone               archive/ (local move)
archived     —      2026-11-03T163447-dispatch-standalone               archive/ (local move)
archived     —      2026-11-03T175949-dispatch-standalone               archive/ (local move)
archived     —      2026-11-03T201056-dispatch-standalone               archive/ (local move)
archived     —      2026-11-03T224014-dispatch-standalone               archive/ (local move)
archived     —      2026-11-03T225844-dispatch-standalone               archive/ (local move)
archived     —      2026-11-04T045628-dispatch-standalone               archive/ (local move)
archived     —      2026-11-04T052336-backlog-standalone                archive/ (local move)
archived     —      2026-11-04T055410-dispatch-standalone               archive/ (local move)
archived     —      2026-11-04T061219-dispatch-standalone               archive/ (local move)
archived     —      2026-11-04T064811-dispatch-standalone               archive/ (local move)
archived     —      2026-11-04T100347-dispatch-standalone               archive/ (local move)
archived     —      2026-11-11T175221-dispatch-standalone               archive/ (local move)
skipped      —      reconcile: 29 local branches not archived           reconcile-converged
   merged-pr-without-cherry-equivalence (Step 4.8 lists 52 such PR branches)
skipped      —      reconcile: 181 remote branches not pruned           reconcile-converged
   109 not-proven-merged, 68 no-merged-pr, 4 pr-open
skipped      —      reconcile: 36 ledgers kept                          reconcile-converged
   33 have open rows, 3 have a live run
failed       —      archive 2026-11-01T182344-spec-4830                 refused
   archival refused — console-residue (1 unreviewed item); see Yours review
failed       —      archive 2026-11-03T114116-record-4618               refused
   archival refused — console-residue (3 unreviewed items); see Yours review
failed       —      reconcile escalate comment on #2724                 residue error
   gh issue comment 2724 failed for stuck run 2026-11-02T205944-record-3721
```

**Approve (11)**
```text
1  [digest]  #—  Settle 16 below-floor digest findings in tests
   Propose digest cluster: file 1 record absorbing 16 entries
   file record "tests" cluster, mark 16 lines → #{n}
2  [digest]  #—  Settle 6 below-floor digest findings in dispatch
   Propose digest cluster: file 1 record absorbing 6 entries
   file record "dispatch" cluster, mark 6 lines → #{n}
3  [digest]  #—  Settle 6 below-floor digest findings in reconcile
   Propose digest cluster: file 1 record absorbing 6 entries
   file record "reconcile" cluster, mark 6 lines → #{n}
4  [digest]  #—  Settle 6 below-floor digest findings in review
   Propose digest cluster: file 1 record absorbing 6 entries
   file record "review" cluster, mark 6 lines → #{n}
5  [digest]  #—  Settle 4 below-floor digest findings in console
   Propose digest cluster: file 1 record absorbing 4 entries
   file record "console" cluster, mark 4 lines → #{n}
6  [digest]  #—  Settle 4 below-floor digest findings in flow
   Propose digest cluster: file 1 record absorbing 4 entries
   file record "flow" cluster, mark 4 lines → #{n}
7  [digest]  #—  Settle 4 below-floor digest findings in hooks
   Propose digest cluster: file 1 record absorbing 4 entries
   file record "hooks" cluster, mark 4 lines → #{n}
8  [digest]  #—  Settle 3 below-floor digest findings in issues
   Propose digest cluster: file 1 record absorbing 3 entries
   file record "issues" cluster, mark 3 lines → #{n}
9  [digest]  #—  Settle 3 below-floor digest findings in wrap-up
   Propose digest cluster: file 1 record absorbing 3 entries
   file record "wrap-up" cluster, mark 3 lines → #{n}
10  [parked]  #3847  Remove wrap-up Step 3.5 pre-anchoring guard
   Promote: parked trigger met; re-run /claude-tweaks:specify
   /claude-tweaks:specify #3847
11  [plan]  #—  Prune 111 completed execution plans
   Prune plan (archive): git rm 111 plans, one commit
   git rm the plans listed in staged/tidy-prune-plan-1.md
```

**Yours (78)**
```text
/claude-tweaks:specify (22)
   #5168  Give verify.js a bounded suite-slot wait that a d…  scoring: missing risk, size
   #4746  specify: one session-wide shaped-body temp file l…  scoring: missing size
   #4747  review: Step 3.5 debates every nearby severity mi…  scoring: missing size
   #5162  Review an existing CI workflow at init              sizing: 13 deliverables
   #5161  Report CI run duration, superseded runs and Actio…  sizing: 12 deliverables
   #5034  Settle 11 below-floor digest findings in issues     sizing: 11 deliverables
   #5033  Settle 36 below-floor digest findings in tests      sizing: 36 deliverables
   #4958  plan review: a record with no Closed rule can sto…  sizing: 17 deliverables
   #4606  walkthrough: a story declaring secrets: puts its …  sizing: 11 deliverables
   #4575  Narrow git-command.js to the recognised shape set   sizing: 11 deliverables
   #4572  Write gate: classify unreadable command parts       sizing: 14 deliverables
   #4405  Settle 14 below-floor digest findings in hooks      sizing: 14 deliverables
   #4404  Settle 15 below-floor digest findings in bin        sizing: 15 deliverables
   #4403  Settle 18 below-floor digest findings in reconcile  sizing: 18 deliverables
   #4402  Settle 16 below-floor digest findings in release    sizing: 16 deliverables
   #4401  Settle 21 below-floor digest findings in _shared    sizing: 21 deliverables
   #4400  Settle 64 below-floor digest findings in tests      sizing: 64 deliverables
   #4399  Settle 149 below-floor digest findings in console   sizing: 149 deliverables
   #4398  Settle 176 below-floor digest findings in reflect   sizing: 176 deliverables
   #4365  Express lane: post-merge sampling never runs afte…  sizing: 13 deliverables
   #3976  Archive the spec header on the run branch before …  sizing: 11 deliverables
   #3381  Decide /flow's double whole-branch review from me…  sizing: 11 deliverables
   /claude-tweaks:specify #5168,#4746,#4747,#5162,#5161,#5034,#5033,#4958,#4606,#4575,#4572,#4405
   /claude-tweaks:specify #4404,#4403,#4402,#4401,#4400,#4399,#4398,#4365,#3976,#3381
/claude-tweaks:demo (5)
   #5154  harness-health: nothing records remote CI duration  acceptance-gap: closed, no disposition
   #5127  Windows regression: 1 test file newly failing       acceptance-gap: closed, no disposition
   #4716  shell-scanner-bash-differential: orphaned process…  acceptance-gap: closed, no disposition
   #4475  Decide the write gate's shell-analysis direction    acceptance-gap: closed, no disposition
   #1426  Digest — rolling container for below-floor findin…  acceptance-gap: closed, no disposition
   /claude-tweaks:demo #5154,#5127,#4716,#4475,#1426
git (4)
   —      [git] worktree dispatch-record-4455                 PR #4712 closed, no failure marker
   —      [git] worktree dispatch-record-4487                 PR #4683 closed, no failure marker
   —      [git] worktree dispatch-record-4495                 PR #4675 closed, no failure marker
   —      [git] worktree dispatch-redispatch-firing           unmerged, no PR
   git -C .claude/worktrees/dispatch-record-4455 log --oneline origin/main..HEAD
   git -C .claude/worktrees/dispatch-record-4487 log --oneline origin/main..HEAD
   git -C .claude/worktrees/dispatch-record-4495 log --oneline origin/main..HEAD
   git -C .claude/worktrees/dispatch-redispatch-firing log --oneline origin/main..HEAD
/claude-tweaks:backlog refine (2)
   #5170  Skill drift: suite-slot-test-env                    awaiting authorization
   #5116  Doc findability: decisions/0027 heredoc stripping   awaiting authorization
   /claude-tweaks:backlog refine
/claude-tweaks:dispatch resume (14)
   #3813  [unsettled] stale claim, open PR 4641               resume, or release the claim
   #4058  [unsettled] stale claim, open PR 5009               resume, or release the claim
   #4467  [unsettled] stale claim, open PR 4586               resume, or release the claim
   #4477  [unsettled] stale claim, open PR 4605               resume, or release the claim
   #4589  [unsettled] stale claim, open PR 4858               resume, or release the claim
   #4612  [unsettled] stale claim, open PR 4999               resume, or release the claim
   #4702  [unsettled] stale claim, open PR 4717               resume, or release the claim
   #4703  [unsettled] stale claim, open PR 4717               resume, or release the claim
   #4785  [unsettled] stale claim, open PR 4888               resume, or release the claim
   #4787  [unsettled] stale claim, open PR 4866               resume, or release the claim
   #4811  [unsettled] stale claim, open PR 4948               resume, or release the claim
   #4816  [unsettled] stale claim, open PR 4973               resume, or release the claim
   #4826  [unsettled] stale claim, open PR 4980               resume, or release the claim
   #4845  [unsettled] stale claim, open PR 4963               resume, or release the claim
   /claude-tweaks:dispatch resume #3813
   /claude-tweaks:dispatch resume #4058
   /claude-tweaks:dispatch resume #4467
   /claude-tweaks:dispatch resume #4477
   /claude-tweaks:dispatch resume #4589
   /claude-tweaks:dispatch resume #4612
   /claude-tweaks:dispatch resume #4702
   /claude-tweaks:dispatch resume #4703
   /claude-tweaks:dispatch resume #4785
   /claude-tweaks:dispatch resume #4787
   /claude-tweaks:dispatch resume #4811
   /claude-tweaks:dispatch resume #4816
   /claude-tweaks:dispatch resume #4826
   /claude-tweaks:dispatch resume #4845
gh (6)
   #4567  Match truncation warnings to exact fetch cutoff     CI pending 13 days
   #4985  Scoped verify at the tip runs zero suites           CI pending
   #5146  document Windows cmd.exe shell parsing              CI pending
   #4717  near-duplicate check appends single-signal noise    DIRTY + ungranted, needs update
   #5163  chore(main): release 6.165.0                        awaiting review
   #4570  Decide the write gate's shell-analysis direction    awaiting review
   gh pr view 4567 --web
   gh pr view 4985 --web
   gh pr view 5146 --web
   gh pr view 4717 --web
   gh pr view 5163 --web
   gh pr view 4570 --web
review (25)
   —      [console] spec-4830: 1 unreviewed console item      console-residue.js --ack after reading
   —      [console] record-4618: 3 unreviewed sdd-ruling it…  console-residue.js --ack after reading
   —      [pattern] #4618 review fix-wave churn (11 commits)  tighten micro-plan; 1 spec only
   —      [pattern] ledger category labels recur (2 files)    below 3-spec threshold
   —      [health] velocity not derivable from git log alone  informational
   —      [calibration] 4 registry rows: 0 findings in 12 r…  consider narrowing those gates
   —      [plan] 64 unnumbered plans not classified           no record to match; kept
   —      [sizing] small/vague check not judged               prose deliverables defeat bullet count
   —      [claim] 2026-11-04T045628-dispatch-standalone emp…  possible skipped audit-log write
   —      [claim] 2026-11-03T114006-dispatch-standalone emp…  possible skipped audit-log write
   —      [claim] 2026-11-04T055410-dispatch-standalone emp…  possible skipped audit-log write
   —      [claim] 2026-11-03T201056-dispatch-standalone emp…  possible skipped audit-log write
   —      [claim] 2026-11-04T100347-dispatch-standalone emp…  possible skipped audit-log write
   —      [claim] 2026-11-03T163447-dispatch-standalone emp…  possible skipped audit-log write
   —      [claim] 2026-11-04T061219-dispatch-standalone emp…  possible skipped audit-log write
   —      [claim] 2026-11-04T064811-dispatch-standalone emp…  possible skipped audit-log write
   —      [claim] 2026-11-03T224014-dispatch-standalone emp…  possible skipped audit-log write
   —      [claim] 2026-11-03T083002-dispatch-standalone emp…  possible skipped audit-log write
   —      [claim] 2026-11-03T093430-dispatch-standalone emp…  possible skipped audit-log write
   —      [claim] 2026-11-11T175221-dispatch-standalone emp…  possible skipped audit-log write
   —      [claim] 2026-11-02T203719-dispatch-standalone emp…  possible skipped audit-log write
   —      [claim] 2026-11-03T085046-dispatch-standalone emp…  possible skipped audit-log write
   —      [claim] 2026-11-03T095826-dispatch-standalone emp…  possible skipped audit-log write
   —      [claim] 2026-11-03T100331-dispatch-standalone emp…  possible skipped audit-log write
   —      [claim] 2026-11-03T225844-dispatch-standalone emp…  possible skipped audit-log write
```

**Clean:**
```text
work records      485 checked
design docs       — checked
execution plans   178 checked
ledgers           36 checked
doc registry      37 checked
issue claims      15 checked
```

Full decision log: .claude-tweaks/pipelines/2026-11-11T192023-sweep-standalone/decisions.md
