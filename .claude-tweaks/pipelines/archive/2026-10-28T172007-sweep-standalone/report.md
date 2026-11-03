## Tidy Report — 2026-10-28

**Applied automatically**
```text
deleted      —       branch dispatch-record-1725 (merged into main)      sha 8d0d15fad
deleted      —       branch worktree-dispatch-record-3062 (net-empty)    sha d55f287a8
archived     —       run 2026-10-24T153132-spec-3997-2724                archive/ move
archived     —       run 2026-10-26T114954-tidy-standalone               archive/ move
archived     —       run 2026-10-28T070331-backlog-standalone            archive/ move
reconciled   —       reconcile pass: 0 applied, all candidates skipped   reconcile-converged
   skip: 12 agent/dispatch branches too young for archive-branches
   skip: mirror ff declined, untracked sweep run dir (#4462)
   skip: 13 worktrees pr-open, 1 in-use; 104 run dirs; 164 remote branches
```

**Approve (7)**
```text
1  [digest]  #4405  Settle 10 below-floor digest findings in hooks
   Absorb 4 new hooks-area digest entries; mark each digest line promoted
   gh issue edit 4405 --repo thn-inc/claude-tweaks --body-file {composed body}
2  [digest]  #4403  Settle 15 below-floor digest findings in reconcile
   Absorb 3 new reconcile-area digest entries; mark each digest line promoted
   gh issue edit 4403 --repo thn-inc/claude-tweaks --body-file {composed body}
3  [digest]  #4400  Settle 61 below-floor digest findings in tests
   Absorb 3 new tests-area digest entries; mark each digest line promoted
   gh issue edit 4400 --repo thn-inc/claude-tweaks --body-file {composed body}
4  [digest]  #—  Settle 3 below-floor digest findings in run-liven…
   File new settle record for 3 run-liveness-area digest entries; mark each promoted
   gh issue create -R thn-inc/claude-tweaks -t {title} -l {labels} -F {composed body}
5  [git]  #—  orphan ref local-check/main
   Delete merged ref of an unconfigured remote (from a worktree)
   git update-ref -d refs/remotes/local-check/main 34b6b03238a9
6  [git]  #—  orphan ref local-check/main2
   Delete merged ref of an unconfigured remote (from a worktree)
   git update-ref -d refs/remotes/local-check/main2 b0695c0a83bb
7  [git]  #—  orphan ref local/main-check
   Delete merged ref of an unconfigured remote (from a worktree)
   git update-ref -d refs/remotes/local/main-check 37e8e58badf9
```

**Yours (37)**
```text
/claude-tweaks:specify (4)
   #4127   Measure median verify minutes across 20 runs        parked trigger met: 20+ runs since 4024 merged
   #4437   Revisit the 24-hour floor before reconcile asks     parked trigger met: 3973 shipped in v6.153.0
   #3930   Quote run-dir, worktree and scratch-file paths      parked with no Trigger line
   #3976   Archive the spec header on the run branch           too large: 11 deliverables, 8 ACs; split
   /claude-tweaks:specify #4127,#4437,#3930,#3976
git (27)
   #4272   branch fix-4228-win-path-stub-skip                  PR merged (squash); -D needs your check
   #3992   branch flow/spec-3946-3949-3816-3950                PR merged (squash); -D needs your check
   #3970   branch record-3969-test-suite-load                  PR merged (squash); -D needs your check
   #3862   branch feat/session-hub-phase-2                     PR merged (squash); -D needs your check
   #3752   branch fix-porcelain-baseline-exempt                PR merged (squash); -D needs your check
   #3692   branch fix-red-main-check-staged-stack              PR merged (squash); -D needs your check
   #3583   branch tidy-sweep-trail-2026-10-18T182125           PR merged (squash); -D needs your check
   #3408   branch fix-3407-workflow-test-crlf                  PR merged (squash); -D needs your check
   #3371   branch cleanup-2821-leftovers                       PR merged (squash); -D needs your check
   #3344   branch chore-dedupe-posture-test-2876               PR merged (squash); -D needs your check
   #4497   branch worktree-dispatch-record-3736                PR closed unmerged; review before delete
   #4223   branch worktree-dispatch-record-4212                PR closed unmerged; review before delete
   #3733   branch worktree-dispatch-record-3659                PR closed unmerged; review before delete
   #3669   branch worktree-record-3078                         PR closed unmerged; review before delete
   #3454   branch worktree-dispatch-record-3175                PR closed unmerged; review before delete
   —       branch health-state-local-harness-health            unmerged, no PR; manual review
   —       branch flow/spec-2589-2592                          unmerged, no PR; manual review
   —       branch pr-1942-check                                unmerged, no PR; manual review
   —       branch record-1837-1839-1840-1851-1873-2026-2029-…  unmerged, no PR; manual review
   —       branch overview-step4-batch-emitter-1101            unmerged, no PR; manual review
   —       branch pr-2534-check                                unmerged, no PR; manual review
   —       branch backup/2806-unpipelined-build                unmerged, no PR; manual review
   —       branch fix/apply-refine-labels-empty-run-1173       unmerged, no PR; manual review
   —       branch thn-inc-owner-refs                           unmerged, no PR; manual review
   —       branch wrapup-2322-followup-v2                      unmerged, no PR; manual review
   —       branch record-2356-2357-2358-2359-v2                unmerged, no PR; manual review
   —       branch sweep-decisions-commit                       unmerged, no PR; manual review
   git branch -D fix-4228-win-path-stub-skip
   git branch -D flow/spec-3946-3949-3816-3950
   git branch -D record-3969-test-suite-load
   git branch -D feat/session-hub-phase-2
   git branch -D fix-porcelain-baseline-exempt
   git branch -D fix-red-main-check-staged-stack
   git branch -D tidy-sweep-trail-2026-10-18T182125
   git branch -D fix-3407-workflow-test-crlf
   git branch -D cleanup-2821-leftovers
   git branch -D chore-dedupe-posture-test-2876
   git log --oneline main..worktree-dispatch-record-3736
   git log --oneline main..worktree-dispatch-record-4212
   git log --oneline main..worktree-dispatch-record-3659
   git log --oneline main..worktree-record-3078
   git log --oneline main..worktree-dispatch-record-3175
   git log --oneline main..health-state-local-harness-health
   git log --oneline main..flow/spec-2589-2592
   git log --oneline main..pr-1942-check
   git log --oneline main..record-1837-1839-1840-1851-1873-2026-2029-2265-2294-2333-2335-2341
   git log --oneline main..overview-step4-batch-emitter-1101
   git log --oneline main..pr-2534-check
   git log --oneline main..backup/2806-unpipelined-build
   git log --oneline main..fix/apply-refine-labels-empty-run-1173
   git log --oneline main..thn-inc-owner-refs
   git log --oneline main..wrapup-2322-followup-v2
   git log --oneline main..record-2356-2357-2358-2359-v2
   git log --oneline main..sweep-decisions-commit
node (1)
   —       [calibration] decision-records, upstream: 0 findi…  consider narrowing those gates
   node plugin/bin/calibration-report.js --runs 50
/claude-tweaks:release (1)
   #4490   chore(main): release 6.156.4                        release PR awaiting review, CI green
   /claude-tweaks:release
/claude-tweaks:tidy --console-backfill (2)
   —       run 2026-10-25T143627-spec-4303 (48 items)          archival refused: console residue
   —       run 2026-10-27T184830-spec-4481 (1 item)            archival refused: console residue
   /claude-tweaks:tidy --console-backfill
review (2)
   —       [health] velocity: 730 PRs merged in 8 weeks        272 open: 157 ready, 101 backlog, 14 parked
   —       [health] no recurring review category yet           too few review artifacts in window
```

**Clean:**
```text
work records       272 checked
design docs        0 checked
plans              5 checked
ledgers            32 checked
registry           23 checked
claims             1969 checked
worktrees          17 checked
open PRs           19 checked
acceptance-gap     0 checked
parent-gate        0 checked
digest             40 checked
sizing             143 checked
```

Full decision log: .claude-tweaks/pipelines/2026-10-28T172007-sweep-standalone/decisions.md
