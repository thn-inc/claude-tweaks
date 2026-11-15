## Tidy Report — 2026-11-15

**Applied automatically**
```text
archived     —      2026-11-12T191351-backlog-standalone                archive/ (local move)
archived     —      2026-11-13T004054-spec-5266-5294                    commit ccdb18f03
archived     —      2026-11-13T011101-release-standalone                archive/ (local move)
archived     —      2026-11-13T032427-dispatch-standalone               archive/ (local move)
archived     —      2026-11-14T153732-spec-5414-5415                    commit 20fe2d0bb
archived     —      2026-11-15T123054-backlog-standalone                archive/ (local move)
archived     —      2026-11-15T123446-dispatch-standalone               archive/ (local move)
marked       #5189  Declare concurrency.reruns: 4 in this repo and re…  needs:decision added
   decision comment posted first, then the label; staged as Approve item 8
skipped      —      reconcile: 30 worktrees not reaped                  reconcile-converged
   18 pr-open, 5 in-use, 3 pr-closed-unmerged, 3 removal-failed, 1 no-pr
skipped      —      reconcile: 34 local branches not archived           reconcile-converged
   33 merged-pr-without-cherry-equivalence, 1 pr-open
skipped      —      reconcile: 186 remote branches not pruned           reconcile-converged
   113 not-proven-merged, 68 no-merged-pr, 5 pr-open
skipped      —      reconcile: 41 ledgers kept                          reconcile-converged
   35 have open rows, 4 have a live run, 2 network-failure
skipped      —      reconcile: 12 claims not released                   reconcile-converged
   8 pr-open, 4 no-run-state
failed       —      archive 2026-11-13T005701-spec-5290                 refused
   archival refused — console-residue (sdd-ruling-14.md pending); see Yours review
failed       —      archive 2026-11-13T034409-spec-5291                 refused
   archival refused — console-residue (wrap-up-reference-1.md pending); see Yours review
failed       —      archive 2026-11-13T060844-spec-5340                 refused
   archival refused — console-residue (sdd-ruling-1.md pending); see Yours review
failed       —      archive 2026-11-13T035137-spec-5267                 refused
   archival refused — tiebreak-coverage-missing (12 findings lack a verdict line)
failed       —      reconcile mirror fast-forward of main               declined
   checkout dirty (this run's untracked run dir); main is 3 ahead, 2 behind origin
failed       —      reconcile escalate comment on #2724                 residue error
   gh issue comment 2724 failed for stuck run 2026-11-02T205944-record-3721
```

**Approve (9)**
```text
1  [digest]  #—  Settle 22 below-floor digest findings in tests
   Propose digest cluster: file 1 record absorbing 22 entries
   file record "tests" cluster, mark 22 lines → #{n}
2  [digest]  #—  Settle 12 below-floor digest findings in review
   Propose digest cluster: file 1 record absorbing 12 entries
   file record "review" cluster, mark 12 lines → #{n}
3  [digest]  #—  Settle 8 below-floor digest findings in verify
   Propose digest cluster: file 1 record absorbing 8 entries
   file record "verify" cluster, mark 8 lines → #{n}
4  [digest]  #—  Settle 6 below-floor digest findings in driver
   Propose digest cluster: file 1 record absorbing 6 entries
   file record "driver" cluster, mark 6 lines → #{n}
5  [digest]  #—  Settle 5 below-floor digest findings in docs
   Propose digest cluster: file 1 record absorbing 5 entries
   file record "docs" cluster, mark 5 lines → #{n}
6  [digest]  #—  Settle 3 below-floor digest findings in ci-health
   Propose digest cluster: file 1 record absorbing 3 entries
   file record "ci-health" cluster, mark 3 lines → #{n}
7  [digest]  #—  Settle 3 below-floor digest findings in timing
   Propose digest cluster: file 1 record absorbing 3 entries
   file record "timing" cluster, mark 3 lines → #{n}
8  [parked]  #5189  Declare concurrency.reruns: 4, restore 90-min lim…
   Promote: parked trigger met; re-run /claude-tweaks:specify
   /claude-tweaks:specify #5189
9  [plan]  #—  Prune 56 completed execution plans
   Prune plan (archive): git rm 56 plans, one commit
   git rm the plans listed in staged/tidy-prune-plan-1.md
```

**Yours (70)**
```text
/claude-tweaks:specify (23)
   #5360  Guard that docs/plugin-structure.md lists every r…  scoring: missing size
   #5341  Write the strip-comments caller rosters one stem…   scoring: missing risk, size
   #5168  Give verify.js a bounded suite-slot wait that a d…  scoring: missing risk, size
   #4747  review: Step 3.5 debates every nearby severity mi…  scoring: missing size
   #4746  specify: one session-wide shaped-body temp file l…  scoring: missing size
   #5292  Plan review's needs-human question is the largest…  sizing: 13 deliverables
   #5198  Settle 16 below-floor digest findings in tests      sizing: 16 deliverables
   #5034  Settle 11 below-floor digest findings in issues     sizing: 11 deliverables
   #5033  Settle 36 below-floor digest findings in tests      sizing: 36 deliverables
   #4606  walkthrough: a story declaring secrets: puts its…   sizing: 11 deliverables
   #4575  Narrow git-command.js to the recognised shape set   sizing: 11 deliverables
   #4572  Write gate: classify unreadable command parts and…  sizing: 14 deliverables
   #4405  Settle 14 below-floor digest findings in hooks      sizing: 14 deliverables
   #4404  Settle 15 below-floor digest findings in bin        sizing: 15 deliverables
   #4403  Settle 18 below-floor digest findings in reconcile  sizing: 18 deliverables
   #4402  Settle 16 below-floor digest findings in release    sizing: 16 deliverables
   #4401  Settle 21 below-floor digest findings in _shared    sizing: 21 deliverables
   #4400  Settle 64 below-floor digest findings in tests      sizing: 64 deliverables
   #4399  Settle 149 below-floor digest findings in console   sizing: 149 deliverables
   #4398  Settle 176 below-floor digest findings in reflect   sizing: 176 deliverables
   #4365  Express lane: post-merge sampling never runs afte…  sizing: 13 deliverables
   #3976  Archive the spec header on the run branch before…   sizing: 11 deliverables
   #3381  Decide /flow's double whole-branch review from me…  sizing: 11 deliverables
   /claude-tweaks:specify #5360,#5341,#5168,#4747,#4746,#5292,#5198,#5034,#5033,#4606,#4575,#4572
   /claude-tweaks:specify #4405,#4404,#4403,#4402,#4401,#4400,#4399,#4398,#4365,#3976,#3381
/claude-tweaks:demo (6)
   #4716  shell-scanner-bash-differential: bounded bash dri…  acceptance-gap: closed, no disposition
   #4475  Decide the write gate's shell-analysis direction…   acceptance-gap: closed, no disposition
   #5488  Review finding (can't-tell): plugin/bin/lib/drive…  acceptance-gap: closed, no disposition
   #5365  Run plugin/bin CLIs in-process in tests instead o…  acceptance-gap: closed, no disposition
   #5154  harness-health: nothing records remote CI duratio…  acceptance-gap: closed, no disposition
   #5127  Windows regression: 1 test file(s) newly failing…   acceptance-gap: closed, no disposition
   /claude-tweaks:demo #4716,#4475,#5488,#5365,#5154,#5127
git (9)
   —      [git] worktree dispatch-record-4455                 PR #4712 closed, no failure marker
   —      [git] worktree dispatch-record-4487                 PR #4683 closed, no failure marker
   —      [git] worktree dispatch-record-4495                 PR #4675 closed, no failure marker
   —      [git] worktree dispatch-redispatch-firing           unmerged, no PR
   —      [git] worktree drive-record-3931                    PR #5274 merged; lock pid 63129 dead
   —      [git] worktree drive-record-4198                    PR #5272 merged; lock pid 63129 dead
   —      [git] worktree drive-record-4351                    PR #5276 merged; lock pid 63129 dead
   —      [plan] 2026-10-31-dispatch-capability-preflight.md  cited by 1 test file
   —      [plan] 2026-11-01-parent-gate-repo-flag.md          cited by 1 test, 1 skill file
   git -C .claude/worktrees/dispatch-record-4455 log --oneline origin/main..HEAD
   git -C .claude/worktrees/dispatch-record-4487 log --oneline origin/main..HEAD
   git -C .claude/worktrees/dispatch-record-4495 log --oneline origin/main..HEAD
   git -C .claude/worktrees/dispatch-redispatch-firing log --oneline origin/main..HEAD
   git worktree unlock .claude/worktrees/drive-record-3931
   git worktree unlock .claude/worktrees/drive-record-4198
   git worktree unlock .claude/worktrees/drive-record-4351
   git grep -nF -- '2026-10-31-dispatch-capability-preflight.md'
   git grep -nF -- '2026-11-01-parent-gate-repo-flag.md'
/claude-tweaks:backlog refine (6)
   #5339  Skill drift: blocker-surface-parity — The surface…  health issue still valid, ungranted
   #5170  Skill drift: suite-slot-test-env — Tests that exe…  health issue still valid, ungranted
   #5236  Doc staleness: docs/decisions/0030-unknown-origin…  health issue still valid, ungranted
   #5116  Doc findability: docs/decisions/0027-heredoc-stri…  health issue still valid, ungranted
   #4717  [pr-unarmed] /specify near-duplicate check PR       green but ungranted
   —      [queue] 316 ready records pending authorization     maintenance signal
   /claude-tweaks:backlog refine
/claude-tweaks:dispatch resume (4)
   #3813  [claim] stale claim, open PR 4641                   resume, or release the claim
   #4058  [claim] stale claim, open PR 5009                   resume, or release the claim
   #4467  [claim] stale claim, open PR 4586                   resume, or release the claim
   #4477  [claim] stale claim, open PR 4605                   resume, or release the claim
   /claude-tweaks:dispatch resume #3813
   /claude-tweaks:dispatch resume #4058
   /claude-tweaks:dispatch resume #4467
   /claude-tweaks:dispatch resume #4477
gh (7)
   #4717  [pr-stale] one PR carrying two stale-claim records  DIRTY; review and merge by hand
   #5472  [pr] chore(main): release 6.170.0                   awaiting review, CI passing
   #4570  [pr] Decide the write gate's shell-analysis direc…  awaiting review, 16 days
   #5146  [pr] fix(verify): document Windows cmd.exe parsing  no CI result on head
   #4567  [pr] Match truncation warnings to exact fetch cut…  no CI result on head
   #3245  [parked] Re-measure dispatch first-call /flow dev…  stale, trigger not met
   #2903  [parked] Verify the SDD status-line fix in a live…  stale, trigger not met
   gh pr view 4717 --web
   gh pr view 5472 --web
   gh pr view 4570 --web
   gh pr view 5146 --web
   gh pr view 4567 --web
   gh issue view 3245 --web
   gh issue view 2903 --web
review (15)
   #5379  [claim] live claim on a closed issue, PR 5467 open  live session (pid 8806) holds it
   —      [run] 2026-11-13T005701-spec-5290                   read staged/sdd-ruling-14.md, then ack
   —      [run] 2026-11-13T034409-spec-5291                   read wrap-up-reference-1.md, then ack
   —      [run] 2026-11-13T060844-spec-5340                   read staged/sdd-ruling-1.md, then ack
   —      [run] 2026-11-13T035137-spec-5267                   12 findings lack a tiebreak verdict
   —      [claim] 2026-11-13T032427-dispatch-standalone       clean run, empty decision log
   #1426  [digest] old container, rollover verified           5 marked lines not carried
   —      [health] backlog-fetch-limit 1000 hit by 3 fetches  raise it in .claude-tweaks/policy.yml
   —      [health] no review-summary artifact in 4 weeks      pattern scan had no review input
   —      [health] 806 PRs merged to main in 8 weeks          velocity context only
   —      [pattern] wrap-up ledger close-outs in 3 specs      routine, re-check next sweep
   —      [calibration] claude-md row: 0 findings in 14 runs  consider narrowing the gate
   —      [calibration] references row: 0 findings in 14 ru…  consider narrowing the gate
   —      [calibration] upstream row: 0 findings in 14 runs   consider narrowing the gate
   —      [git] main has 3 unpushed archive commits           3 ahead, 2 behind origin/main
```

**Clean:**
```text
design docs           1 checked
doc registry          1 checked
ledgers               41 checked
parent gates          19 checked
release-note repair   642 checked
legacy labels         642 checked
build branches        0 checked
```

Full decision log: .claude-tweaks/pipelines/2026-11-15T124936-sweep-standalone/decisions.md
