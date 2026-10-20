## Tidy Report — 2026-10-19

**Applied automatically**
```text
filled-note  #3589  SubagentStop's immediate-after-async-signal exem…  snapshot saved
   Subagent replies sent right after a queued-command completion notice are no longer graded as…
filled-note  #3577  first-call-artifact-check.js does not verify the …  snapshot saved
   The dispatch first-call check now fails when a member's canonical claim line is missing from…
deleted      —      [plan] 26 orphaned execution plans                  commit 6c75f3bb4
   squash-merged via PR #3591 (merged on --auto: main has no required checks)
deleted      —      [git] worktree dispatch-record-2734 + its branch    reversible (was 294eac138)
```

**Approve (1)**
```text
1  [digest]  #1426  wrap-up cluster: 3 un-promoted digest entries
   Propose digest cluster — file one record, mark 3 entry lines → #{n}
   gh issue create (proposal body), then edit 3 #1426 entry lines
```

**Yours (31)**
```text
specify (8)
   #3381  Decide /flow's double whole-branch review from me…  parked trigger partly met, judgment
   #3377  Add a Capable plan review before Task 1 of a Spec   too large: 14 deliverables, split
   #3378  Forward per-task implementer and review tiers for   too large: 10 deliverables + 10 AC
   #2622  Add a pre-scale hardening skill for AI-coded apps   too large: 12 deliverables, split
   #2767  Windows full-suite baseline: classify and drive …   too large: three phases, split
   #3266  Dispatch async-wait guidance should say any reply   too small: absorb into rec 3078
   #3551  Dispose two stale non-canonical top-level pipeli…   too small: absorb into rec 3396
   #3257  Normalize StatusContext entries in the pr-first     too small: absorb into rec 3468
   /claude-tweaks:specify #3381,#3377,#3378,#2622,#2767,#3266,#3551,#3257
demo (9)
   #3407  Windows regression: 1 test file(s) newly failing…   closed, no acceptance disposition
   #3362  Document that the subagent-stop trailing STATUS …   closed, no acceptance disposition
   #3360  flow/multi-spec.md exceeds its 20,480-byte read …   closed, no acceptance disposition
   #3229  build / subagent-driven-development dispatch cos…   closed, no acceptance disposition
   #3178  verify.js baseline isolation mis-extracts test-f…   closed, no acceptance disposition
   #3171  verify.js --baseline adjudication fails on its o…   closed, no acceptance disposition
   #3125  Skill drift: node-test-output-evidence — Key Pat…   closed, no acceptance disposition
   #2914  Two-call /flow dispatch handoff: config.yml miss…   closed, no acceptance disposition
   #2859  Ledger-acknowledged pre-existing test failures p…   closed, no acceptance disposition
   /claude-tweaks:demo #3407,#3362,#3360,#3229,#3178,#3171,#3125,#2914,#2859
git (9)
   —      [git] record-3001 — unmerged, dirty, no PR          dirty worktree, judgment call
   —      [git] record-1686-…-2225 — unmerged, dirty, no PR   dirty worktree, judgment call
   —      [git] dispatch-record-1337 — merged, dirty          dirty worktree, judgment call
   —      [git] record-1471 — merged, 9 dirty files           dirty worktree, judgment call
   —      [git] dispatch-record-2785 — net-empty, dirty       dirty worktree, judgment call
   —      [git] dispatch-record-1725 — merged, dirty          dirty worktree, judgment call
   —      [git] dispatch-record-457 — merged, dirty           dirty worktree, judgment call
   —      [git] agent-a97b6fa2589f7ca3f — merged, dirty       dirty worktree, judgment call
   —      [plan] windows-regression-guard-3316 — cited        cited by dispatch-cost-baseline.md
   git -C .claude/worktrees/record-3001 status
   git -C .claude/worktrees/record-1686-1733-1734-1737-1738-2225 status
   git -C .claude/worktrees/dispatch-record-1337 status
   git -C .claude/worktrees/record-1471 status
   git -C .claude/worktrees/dispatch-record-2785 status
   git -C .claude/worktrees/dispatch-record-1725 status
   git -C .claude/worktrees/dispatch-record-457 status
   git -C .claude/worktrees/agent-a97b6fa2589f7ca3f status
   git grep -nF -- '2026-10-17-windows-regression-guard-3316.md'
backlog refine (1)
   #3500  policy.yml has 1 unrecognized key(s) / invalid …   judgment call, no mechanical fix
   /claude-tweaks:backlog refine
release (1)
   #3548  chore(main): release 6.146.0                        release PR awaiting review, CI green
   /claude-tweaks:release
review (3)
   —      [digest] docs cluster: 4 entries, ledgers gone      entries resolved; mark → expired
   —      [digest] dispatch entry fixed by #3024              entry resolved; mark → expired
   —      [health] no review-summary files in 4-week window   check where /review writes summary
```

**Clean:**
```text
records            157 checked
design docs        0 checked
ledgers            2 checked
registry           22 checked
claims             1586 checked
calibration        20 checked
```

Reconcile-owned, not acted on here: squash-merged branches dispatch-record-3440/-3523, worktrees
flow-spec-3571/-3573 (runs now archived), 38 un-archived clean run dirs — reconcile skipped
archive-branches/remote-prune/reap this pass (budget-exceeded); its next pass converges them.

Full decision log: .claude-tweaks/pipelines/2026-10-19T110912-sweep-standalone/decisions.md
