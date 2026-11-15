## Tidy Report — 2026-10-31

**Applied automatically**
```text
archived     —       2026-10-25T143627-spec-4303                         moved to archive/
archived     —       2026-10-27T184830-spec-4481                         moved to archive/
archived     —       2026-10-28T172234-spec-4468-4465-4423               moved to archive/
archived     —       2026-10-30T061610-spec-4563                         moved to archive/
archived     —       2026-10-30T160103-backlog-standalone                moved to archive/
archived     —       2026-10-30T210220-dispatch-standalone               moved to archive/
archived     —       2026-10-31T060815-dispatch-standalone               moved to archive/
archived     —       2026-10-31T061842-backlog-standalone                moved to archive/
archived     —       2026-10-31T093522-dispatch-standalone               moved to archive/
archived     —       2026-10-31T093802-backlog-standalone                moved to archive/
archived     —       2026-10-31T132940-dispatch-standalone               moved to archive/
archived     —       2026-10-31T142235-backlog-standalone                moved to archive/
archived     —       2026-10-31T143245-dispatch-standalone               moved to archive/
archived     —       2026-10-31T144426-dispatch-standalone               moved to archive/
archived     —       2026-10-31T145027-spec-4704                         moved to archive/
archived     —       2026-10-31T153215-dispatch-standalone               moved to archive/
deleted      —       thn-inc-owner-refs                                  git branch -d
deleted      —       sweep-decisions-commit                              git branch -d
deleted      —       cleanup-2821-leftovers                              git branch -d
deleted      —       fix-red-main-check-staged-stack                     git branch -d
deleted      —       fix-porcelain-baseline-exempt                       git branch -d
deleted      —       fix-4228-win-path-stub-skip                         git branch -d
filled-note  #4760   friction-events.js main-checkout detection spawns…  snapshot saved
   Speed up the friction report's main-checkout check by removing a git subprocess; no other user…
reconcile-converged: 0 archived. Skipped: 14 aged-branch candidates, too-young or closed-unmerged.
```

**Approve (17)**
```text
1  [digest]  #—  Settle 4 digest findings in hooks
   Propose digest cluster: file one record absorbing 4 entries
   file staged/digest-promotion-1.md, then mark each entry line in #1426
2  [digest]  #—  Settle 3 digest findings in reflect
   Propose digest cluster: file one record absorbing 3 entries
   file staged/digest-promotion-10.md, then mark each entry line in #1426
3  [digest]  #—  Settle 7 digest findings in review
   Propose digest cluster: file one record absorbing 7 entries
   file staged/digest-promotion-2.md, then mark each entry line in #1426
4  [digest]  #—  Settle 3 digest findings in _shared
   Propose digest cluster: file one record absorbing 3 entries
   file staged/digest-promotion-3.md, then mark each entry line in #1426
5  [digest]  #—  Settle 7 digest findings in docs
   Propose digest cluster: file one record absorbing 7 entries
   file staged/digest-promotion-4.md, then mark each entry line in #1426
6  [digest]  #—  Settle 3 digest findings in flow
   Propose digest cluster: file one record absorbing 3 entries
   file staged/digest-promotion-5.md, then mark each entry line in #1426
7  [digest]  #—  Settle 15 digest findings in tests
   Propose digest cluster: file one record absorbing 15 entries
   file staged/digest-promotion-6.md, then mark each entry line in #1426
8  [digest]  #—  Settle 5 digest findings in wrap-up
   Propose digest cluster: file one record absorbing 5 entries
   file staged/digest-promotion-7.md, then mark each entry line in #1426
9  [digest]  #—  Settle 12 digest findings in dispatch
   Propose digest cluster: file one record absorbing 12 entries
   file staged/digest-promotion-8.md, then mark each entry line in #1426
10  [digest]  #—  Settle 3 digest findings in policy
   Propose digest cluster: file one record absorbing 3 entries
   file staged/digest-promotion-9.md, then mark each entry line in #1426
11  [gh-issue]  #—  pr-scan item 10 drops claims on API errors
   Capture: file a backlog record for this scan defect
   /claude-tweaks:capture from staged/tidy-capture-1.md
12  [gh-issue]  #—  pr-scan item 4 wrongly calls PR states exclusive
   Capture: file a backlog record for this scan defect
   /claude-tweaks:capture from staged/tidy-capture-2.md
13  [gh-issue]  #—  pr-scan fixed limits truncate results here
   Capture: file a backlog record for this scan defect
   /claude-tweaks:capture from staged/tidy-capture-3.md
14  [gh-issue]  #—  residue.js marks open-PR worktrees remedy auto
   Capture: file a backlog record for this scan defect
   /claude-tweaks:capture from staged/tidy-capture-4.md
15  [claim]  #3942  Ratifying a deferral SDD ruling files no backlog…
   Release stale claim and its bot:in-progress (open PR #4444)
   release-claim.js 3942 --run {run-dir} --sweep --reason "swept: stale claim"
16  [claim]  #3977  Close dead runs in report-only mode, and more…
   Release stale claim and its bot:in-progress (open PR #4445)
   release-claim.js 3977 --run {run-dir} --sweep --reason "swept: stale claim"
17  [claim]  #4347  Take full-suite verification from the PR CI run…
   Release stale claim and its bot:in-progress (open PR #4476)
   release-claim.js 4347 --run {run-dir} --sweep --reason "swept: stale claim"
```

**Yours (39)**
```text
/claude-tweaks:specify (9)
   #4747   review: Step 3.5 debates every nearby severity mi…  ready but missing size, judgment call
   #4746   specify: one session-wide shaped-body temp file l…  ready but missing size, judgment call
   #4606   walkthrough: a story declaring secrets: puts its …  10+ Deliverables bullets, consider sp
   #4575   Narrow git-command.js to the recognised shape set   10+ Deliverables bullets, consider sp
   #4572   Write gate: classify unreadable command parts and…  10+ Deliverables bullets, consider sp
   #4559   build dispatch: size:low → Fast puts a cheapest-t…  10+ Deliverables bullets, consider sp
   #4553   flow: a closed blocker is treated as satisfied ev…  10+ Deliverables bullets, consider sp
   #4365   Express lane: post-merge sampling never runs afte…  10+ Deliverables bullets, consider sp
   #3976   Archive the spec header on the run branch before …  10+ Deliverables bullets, consider sp
   /claude-tweaks:specify #4747,#4746,#4606,#4575,#4572,#4559,#4553,#4365,#3976
/claude-tweaks:demo (2)
   #4716   record 4716                                         closed, no disposition, judgment call
   #4475   record 4475                                         closed, no disposition, judgment call
   /claude-tweaks:demo #4716,#4475
git (3)
   —       [git] dispatch-record-4455 worktree                 PR #4712 closed, no failure marker
   —       [git] dispatch-record-4487 worktree                 PR #4683 closed, no failure marker
   —       [git] dispatch-record-4495 worktree                 PR #4675 closed, no failure marker
   git worktree remove .claude/worktrees/dispatch-record-4455
   git worktree remove .claude/worktrees/dispatch-record-4487
   git worktree remove .claude/worktrees/dispatch-record-4495
gh (4)
   —       [pr] PR 4567: Match truncation warnings to exact …  CI pending since 10-30, investigate
   —       [pr] PR 4771: chore(main): release 6.159.0          awaiting review, CI passing
   —       [pr] PR 4717: /specify near-duplicate check appen…  awaiting review, CI passing
   —       [pr] PR 4570: Decide the write gate's shell-analy…  awaiting review, CI passing
   gh pr checks 4567
   gh pr view 4771 --web
   gh pr view 4717 --web
   gh pr view 4570 --web
review (21)
   —       [git] fix/apply-refine-labels-empty-run-1173        merged PR, -d refused, needs proof
   —       [git] overview-step4-batch-emitter-1101             merged PR, -d refused, needs proof
   —       [git] record-2356-2357-2358-2359-v2                 merged PR, -d refused, needs proof
   —       [git] record-1837-1839-1840-1851-1873-2026-2029-2…  merged PR, -d refused, needs proof
   —       [git] wrapup-2322-followup-v2                       merged PR, -d refused, needs proof
   —       [git] flow/spec-2589-2592                           merged PR, -d refused, needs proof
   —       [git] chore-dedupe-posture-test-2876                merged PR, -d refused, needs proof
   —       [git] fix-3407-workflow-test-crlf                   merged PR, -d refused, needs proof
   —       [git] tidy-sweep-trail-2026-10-18T182125            merged PR, -d refused, needs proof
   —       [git] feat/session-hub-phase-2                      merged PR, -d refused, needs proof
   —       [git] record-3969-test-suite-load                   merged PR, -d refused, needs proof
   —       [git] flow/spec-3946-3949-3816-3950                 merged PR, -d refused, needs proof
   —       [git] worktree-dispatch-record-4598                 merged PR, -d refused, needs proof
   —       [git] worktree-dispatch-record-4602                 merged PR, -d refused, needs proof
   —       [git] worktree-dispatch-record-4631                 merged PR, -d refused, needs proof
   —       [git] worktree-dispatch-record-4727                 merged PR, -d refused, needs proof
   —       [git] 2026-10-31T120302-record-4634 run             not archived: PR #4700 open, worktree
   —       [git] scratchpad rv worktree                        detached, in a sibling session's scra
   —       [git] reconcile: 2 stuck, oldest 4d                 run a verbose reconcile to name them
   —       [calibration] decision-records, upstream rows       0 findings in 21 runs, consider narro
   —       [health] #4600 review: 15 findings to tiebreak      track across the next few reviews
```

**Clean:**
```text
design docs        0 checked
plans              72 checked
ledgers            32 checked
doc registry       25 checked
claim blobs        2103 checked
open records       307 checked
open PRs           43 checked
parent gates       5 checked
worktrees          39 checked
```

Full decision log: .claude-tweaks/pipelines/2026-10-31T204035-sweep-standalone/decisions.md
