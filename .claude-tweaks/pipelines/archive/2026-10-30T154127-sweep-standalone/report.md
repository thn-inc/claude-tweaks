## Tidy Report — 2026-10-30

**Applied automatically**
```text
archived     —     2026-10-28T070053-dispatch-standalone               archived, reversible
archived     —     2026-10-28T172247-dispatch-standalone               archived, reversible
archived     —     2026-10-30T042121-backlog-standalone                archived, reversible
archived     —     2026-10-30T043043-backlog-standalone                archived, reversible
archived     —     2026-10-30T084853-backlog-standalone-standalone     archived, reversible
archived     —     2026-10-30T090255-dispatch-standalone               archived, reversible
archived     —     2026-10-30T123626-backlog-standalone                archived, reversible
archived     —     2026-10-30T123731-dispatch-standalone               archived, reversible
archived     —     2026-10-30T134558-backlog-standalone                archived, reversible
archived     —     2026-10-30T154102-backlog-standalone                archived, reversible
```

**Approve (7)**
```text
1  [digest]  #—  Settle 5 below-floor digest findings in issues
   File backlog record absorbing 5 [issues] digest entries
   /claude-tweaks:capture (staged body) then mark 5 lines in #1426 → #{new}
2  [digest]  #—  Settle 4 below-floor digest findings in wrap-up
   File backlog record absorbing 4 [wrap-up] digest entries
   /claude-tweaks:capture (staged body) then mark 4 lines in #1426 → #{new}
3  [digest]  #—  Settle 4 below-floor digest findings in tests
   File backlog record absorbing 4 [tests] digest entries
   /claude-tweaks:capture (staged body) then mark 4 lines in #1426 → #{new}
4  [digest]  #—  Settle 3 below-floor digest findings in worktree
   File backlog record absorbing 3 [worktree] digest entries
   /claude-tweaks:capture (staged body) then mark 3 lines in #1426 → #{new}
5  [digest]  #—  Settle 3 below-floor digest findings in review
   File backlog record absorbing 3 [review] digest entries
   /claude-tweaks:capture (staged body) then mark 3 lines in #1426 → #{new}
6  [parked]  #4437  Revisit the 24-hour floor before reconcile asks
   Wake parked record #4437 and re-shape it with /specify
   /claude-tweaks:specify #4437
7  [parked]  #4127  Measure the median verify minutes per pipeline
   Wake parked record #4127 and re-shape it with /specify
   /claude-tweaks:specify #4127
```

**Yours (32)**
```text
specify (11)
   #4575 Narrow git-command.js to the recognised shape set   too large: 11 deliverables
   #4572 Write gate: classify unreadable command parts       too large: 11 deliverables
   #4405 Settle 14 below-floor digest findings in hooks      too large: 14 deliverables
   #4404 Settle 15 below-floor digest findings in bin        too large: 15 deliverables
   #4403 Settle 18 below-floor digest findings in reconcile  too large: 18 deliverables
   #4402 Settle 16 below-floor digest findings in release    too large: 16 deliverables
   #4401 Settle 21 below-floor digest findings in _shared    too large: 21 deliverables
   #4400 Settle 64 below-floor digest findings in tests      too large: 64 deliverables
   #4399 Settle 149 below-floor digest findings in console   too large: 149 deliverables
   #4398 Settle 176 below-floor digest findings in reflect   too large: 176 deliverables
   #3976 Archive the spec header on the run branch before m… too large: 11 deliverables
   /claude-tweaks:specify #4575,#4572,#4405,#4404,#4403,#4402,#4401,#4400,#4399,#4398,#3976
demo (1)
   #4475 Decide the write gate's shell-analysis direction    closed, no acceptance verdict
   /claude-tweaks:demo #4475
git (1)
   —     [git] worktree-dispatch-record-3736 (PR #4497)      ahead 2 of main, not proven merged
   git log --oneline origin/main..worktree-dispatch-record-3736
backlog refine (2)
   #4343 Catch the run branch up with the integration        bot:blocked, retry ceiling hit
   #4568 Doc staleness: docs/decisions/0026-ledger-residu…   docs-health issue, still valid
   /claude-tweaks:backlog refine
gh (6)
   #3942 Ratifying a deferral SDD ruling at the Review       claim >72h, PR 4444 open
   #3977 Close dead runs in report-only mode, show only      claim >72h, PR 4445 open
   #4347 Take the full-suite verification from the PR's CI   claim >72h, PR 4476 open
   #4567 Match truncation warnings to exact fetch cutoff     CI pending on non-draft PR
   #4570 Decide the write gate's shell-analysis direction    awaiting review, CI green
   #4642 chore(main): release 6.157.1                        awaiting review, CI green
   gh pr view 4444
   gh pr view 4445
   gh pr view 4476
   gh pr checks 4567
   gh pr view 4570
   gh pr view 4642
tidy --console-backfill (4)
   —     [run] 2026-10-25T143627-spec-4303                   48 unreviewed items
   —     [run] 2026-10-27T184830-spec-4481                   1 unreviewed item
   —     [run] 2026-10-28T172234-spec-4468-4465-4423         2 unreviewed items
   —     [run] 2026-10-30T061610-spec-4563                   1 unreviewed item
   /claude-tweaks:tidy --console-backfill
review (7)
   —     [pattern] console/resolve.js: 4 fix commits today   refactor candidate, see /deepen
   —     [health] 412 wrap-up commits in 8 weeks             informational
   —     [health] Step 5.5 found no review summaries         pattern scan had no input
   —     [gh-issue] acceptance-gap fetch hit 1000 cap        raise backlog-fetch-limit
   —     [gh-issue] parent-gate state map hit 1000 cap       raise backlog-fetch-limit
   —     [git] detached worktree basewt (other session)      owner unknown; remove if dead
   —     [calibration] decision-records/upstream: 0 hits     consider narrowing those gates
```

**Clean:**
```text
records (Step 1)   322 checked
design docs        0 checked
plans              35 checked
ledgers            32 checked
doc registry       24 checked
issue claims       2038 checked
ready sizing       220 checked
```

Full decision log: .claude-tweaks/pipelines/2026-10-30T154127-sweep-standalone/decisions.md
