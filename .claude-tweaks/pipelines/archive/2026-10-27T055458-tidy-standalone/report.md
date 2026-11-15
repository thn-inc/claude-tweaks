## Tidy Report — 2026-10-27

**Applied automatically**
```text
deleted      #3315   plan windows-path-producers-3315                    commit 81d97c6
deleted      #4290   plan chmod-denial-skip-4290                         commit 137afb5
deleted      #4285   plan path-stub-helper-4285                          commit 943a653
deleted      #4421   plan reconcile-abandoned-interrupted…-4421          commit fe638de
deleted      #4396   plan residue-artifact-display-ids-4396              commit dfe6418
deleted      #4430   plan residue-pipeline-runs-subject-4430             commit 76e0640
deleted      #4420   plan resume-freshness-through-run-liveness-4420     commit cd6064f
deleted      #4422   plan run-liveness-callers-conformance-4422          commit fd3ec7b
deleted      #4336   plan slot-knob-sandbox-4336                         commit 3c68193
deleted      #4419   plan unresumable-state-adoption-4419                commit ff7760a
deleted      #4291   plan windows-test-env-one-offs-4291                 commit 7a74fcd
deleted      #4427   branch flow/spec-4290-4285-4396                     ref pull/4427/head
deleted      #4394   branch worktree-dispatch-record-4391                ref pull/4394/head
deleted      #4393   branch worktree-dispatch-record-4125                ref pull/4393/head
deleted      #4389   branch worktree-dispatch-record-4131                ref pull/4389/head
deleted      #4386   branch worktree-dispatch-record-4132                ref pull/4386/head
deleted      #4348   branch worktree-dispatch-record-4331                ref pull/4348/head
deleted      #4341   branch worktree-dispatch-record-4326                ref pull/4341/head
deleted      #4335   branch worktree-dispatch-record-4133                ref pull/4335/head
deleted      #4324   branch worktree-dispatch-record-4027                ref pull/4324/head
deleted      #4323   branch worktree-dispatch-record-4314                ref pull/4323/head
deleted      #4322   branch worktree-dispatch-record-4317                ref pull/4322/head
deleted      #4316   branch worktree-dispatch-record-4134                ref pull/4316/head
deleted      #4315   branch worktree-dispatch-record-4153                ref pull/4315/head
deleted      #4311   branch worktree-dispatch-record-4154                ref pull/4311/head
deleted      #4305   branch worktree-dispatch-record-4136                ref pull/4305/head
deleted      #4297   branch fix-4296-roster-posix                        ref pull/4297/head
deleted      #4295   branch worktree-dispatch-record-4273                ref pull/4295/head
deleted      #4280   branch worktree-dispatch-record-4172                ref pull/4280/head
deleted      #4278   branch worktree-dispatch-record-4141                ref pull/4278/head
deleted      #4277   branch worktree-dispatch-record-4026                ref pull/4277/head
archived     —       run 2026-10-21T153953-dispatch-standalone           mv back from archive/
archived     —       run 2026-10-21T194624-release-standalone            mv back from archive/
archived     —       run 2026-10-21T202104-backlog-standalone            mv back from archive/
archived     —       run 2026-10-21T204028-dispatch-standalone           mv back from archive/
archived     —       run 2026-10-21T215948-dispatch-standalone           mv back from archive/
archived     —       run 2026-10-23T215404-dispatch-standalone           mv back from archive/
archived     —       run 2026-10-23T215703-backlog-standalone            mv back from archive/
archived     —       run 2026-10-24T052353-backlog-standalone            mv back from archive/
archived     —       run 2026-10-24T053817-backlog-standalone            mv back from archive/
archived     —       run 2026-10-24T060817-dispatch-standalone           mv back from archive/
archived     —       run 2026-10-24T081607-backlog-standalone            mv back from archive/
archived     —       run 2026-10-24T081724-dispatch-standalone           mv back from archive/
archived     —       run 2026-10-24T104015-backlog-standalone            mv back from archive/
archived     —       run 2026-10-24T154159-dispatch-standalone           mv back from archive/
archived     —       run 2026-10-25T064131-backlog-standalone            mv back from archive/
archived     —       run 2026-10-25T080412-dispatch-standalone           mv back from archive/
archived     —       run 2026-10-25T080446-dispatch-standalone           mv back from archive/
archived     —       run 2026-10-25T080505-backlog-standalone            mv back from archive/
archived     —       run 2026-10-25T080649-record-4212                   mv back from archive/
archived     —       run 2026-10-25T132343-dispatch-standalone           mv back from archive/
archived     —       run 2026-10-25T132351-dispatch-standalone           mv back from archive/
archived     —       run 2026-10-25T144342-backlog-standalone            mv back from archive/
archived     —       run 2026-10-25T145635-dispatch-standalone           mv back from archive/
archived     —       run 2026-10-25T160217-backlog-standalone            mv back from archive/
archived     —       run 2026-10-25T160758-dispatch-standalone           mv back from archive/
archived     —       run 2026-10-25T194002-dispatch-standalone           mv back from archive/
archived     —       run 2026-10-25T210551-backlog-standalone            mv back from archive/
archived     —       run 2026-10-25T214748-dispatch-standalone           mv back from archive/
archived     —       run 2026-10-26T093157-backlog-standalone            mv back from archive/
archived     —       run 2026-10-26T094145-dispatch-standalone           mv back from archive/
archived     —       run 2026-10-26T143009-backlog-standalone            mv back from archive/
archived     —       run 2026-10-26T193745-dispatch-standalone           mv back from archive/
```

**Approve (2)**
```text
1  [digest]  #4398  Settle 173 below-floor digest findings in reflect
   Absorb 3 new reflect-area digest entries; mark each digest line promoted
   gh issue edit 4398 --repo thn-inc/claude-tweaks --body-file {composed body}
2  [parent-gate]  #3979  Route isDeadRunDir, abandoned-interrupted recen…
   Close below-floor parent: all 4 sub-issues closed, no demo gate
   gh issue close 3979 --repo thn-inc/claude-tweaks --reason completed
```

**Yours (38)**
```text
/claude-tweaks:demo (13)
   #3318   Classify the Windows full-suite failing set and q…  judgment call, no mechanical fix
   #3644   Windows regression: 1 test file(s) newly failing …  judgment call, no mechanical fix
   #3632   verify.js scoped run cannot baseline-adjudicate a…  judgment call, no mechanical fix
   #3538   Dispatch headless self-report: check3               judgment call, no mechanical fix
   #3362   Document that the subagent-stop trailing STATUS l…  judgment call, no mechanical fix
   #3178   verify.js baseline isolation mis-extracts test-fi…  judgment call, no mechanical fix
   #3171   verify.js --baseline adjudication fails on its ow…  judgment call, no mechanical fix
   #3407   Windows regression: 1 test file(s) newly failing …  judgment call, no mechanical fix
   #3360   flow/multi-spec.md exceeds its 20,480-byte read b…  judgment call, no mechanical fix
   #3229   build / subagent-driven-development dispatch: mul…  judgment call, no mechanical fix
   #3125   Skill drift: node-test-output-evidence — Key Patt…  judgment call, no mechanical fix
   #2914   Two-call /flow dispatch handoff: config.yml missi…  judgment call, no mechanical fix
   #2859   Ledger-acknowledged pre-existing test failures pe…  judgment call, no mechanical fix
   /claude-tweaks:demo #3318,#3644,#3632,#3538,#3362,#3178,#3171,#3407,#3360,#3229,#3125,#2914,#2859
git (20)
   —       dispatch-record-1337: PR 1551 merged, untracked l…  merged; residue only (issue 3214)
   —       dispatch-record-457: PR 1582 merged, untracked le…  merged; residue only (issue 3216)
   —       dispatch-record-1725: PR 1746 merged, untracked r…  merged; residue only (issue 3215)
   —       record-1471: PR 1680 merged, 9 untracked work/ fi…  merged; residue only (issue 3217)
   —       record-1686-…-2225: PR 2453 merged, untracked run…  merged; residue only (issue 3295)
   —       record-3001: PR 3235 merged, untracked .superpowe…  merged; residue only (issue 3516)
   —       agent-a97b6fa2589f7ca3f: merged, M docs/hooks.md    tracked edit may be real work
   —       agent-a62d1a86888ecd871: 4 commits, no PR           unmerged commits, no PR
   —       agent-ab4cdd9c1659dc6d3: 13 commits, no PR          unmerged commits, no PR
   —       agent-ad8a86f9bdee05233: 10 commits, no PR          unmerged commits, no PR
   —       agent-a47f799d857db07fd: unmerged, untracked test…  unmerged commits, no PR
   —       agent-ab98a10b8f1bc2528: detached HEAD, 5 commits   unmerged commits, no branch
   —       backlog-refine: 9 commits, no PR                    unmerged commits, no PR
   —       dispatch-record-2785: 2 commits, untracked run dir  unmerged commits, no PR
   —       dispatch-record-2806: PR 2836 closed unmerged       abandoned PR, no failure mark
   —       dispatch-record-4212: PR 4223 closed unmerged       abandoned PR, no failure mark
   —       dispatch-record-3175: PR 3454 closed unmerged       abandoned PR, no failure mark
   —       record-2840: PR 2965 tombstoned, issue 2840 closed  record closed; retry moot
   —       dispatch-record-3078: PR 3474 tombstoned, issue 3…  record closed; retry moot
   —       stray untracked f ('x') in the main checkout        blocks reconcile mirror ff
   git worktree remove --force .claude/worktrees/dispatch-record-1337
   git worktree remove --force .claude/worktrees/dispatch-record-457
   git worktree remove --force .claude/worktrees/dispatch-record-1725
   git worktree remove --force .claude/worktrees/record-1471
   git worktree remove --force .claude/worktrees/record-1686-1733-1734-1737-1738-2225
   git worktree remove --force .claude/worktrees/record-3001
   git -C .claude/worktrees/agent-a97b6fa2589f7ca3f diff
   git -C .claude/worktrees/agent-a62d1a86888ecd871 log --oneline origin/main..HEAD
   git -C .claude/worktrees/agent-ab4cdd9c1659dc6d3 log --oneline origin/main..HEAD
   git -C .claude/worktrees/agent-ad8a86f9bdee05233 log --oneline origin/main..HEAD
   git -C .claude/worktrees/agent-a47f799d857db07fd log --oneline origin/main..HEAD
   git -C .claude/worktrees/agent-ab98a10b8f1bc2528 log --oneline origin/main..HEAD
   git -C .claude/worktrees/backlog-refine log --oneline origin/main..HEAD
   git -C .claude/worktrees/dispatch-record-2785 log --oneline origin/main..HEAD
   git -C .claude/worktrees/dispatch-record-2806 log --oneline origin/main..HEAD
   git -C .claude/worktrees/dispatch-record-4212 log --oneline origin/main..HEAD
   git -C .claude/worktrees/dispatch-record-3175 log --oneline origin/main..HEAD
   git -C .claude/worktrees/record-2840 log --oneline origin/main..HEAD
   git -C .claude/worktrees/dispatch-record-3078 log --oneline origin/main..HEAD
   git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks" clean -f -- f
gh (1)
   #4428   release-please chore(main) 6.156.2, awaiting revi…  outward GitHub write, never auto
   gh pr view 4428 --web
review (4)
   —       46 pre-cutoff runs already have an archive/ twin    late-write stubs; inspect each
   —       run 2026-10-24T153132-spec-3997-2724: 2 tracked h…  git move on main; issue 3975
   —       [acceptance-gap] fetch hit backlog-fetch-limit 10…  raise it in policy.yml
   —       [calibration] decision-records, upstream: 0 in 21…  -10-27T055458-tidy-standalone/
```

**Clean:**
```text
design docs        — checked
registry           18 checked
ledgers            31 checked
claims             1955 checked
parked records     14 checked
backlog records    24 checked
sizing             142 checked
release notes      0 checked
digest entries     3 checked
```

Full decision log: .claude-tweaks/pipelines/2026-10-27T055458-tidy-standalone/decisions.md
