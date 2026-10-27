## Tidy Report — 2026-10-26

**Applied automatically**
```text
deleted      —      121 orphaned plans (records closed)                 commit per plan
deleted      —      3 orphaned ledgers (no open rows)                   commit per ledger
reaped       —      4 merged clean worktrees                            2 branches -d
   dispatch-record-4133, backlog-refine-2718-2730 branches kept for reconcile
```

**Approve (23)**
```text
1  [digest]  #—  Digest: reflect (173)
   Propose cluster: file record absorbing 173 reflect entries
   gh issue create --title "Digest: reflect (173)" --body-file staged/digest-promotion-1.md
2  [digest]  #—  Digest: dispatch (8)
   Propose cluster: file record absorbing 8 dispatch entries
   gh issue create --title "Digest: dispatch (8)" --body-file staged/digest-promotion-10.md
3  [digest]  #—  Digest: verify (7)
   Propose cluster: file record absorbing 7 verify entries
   gh issue create --title "Digest: verify (7)" --body-file staged/digest-promotion-11.md
4  [digest]  #—  Digest: wrap-up (6)
   Propose cluster: file record absorbing 6 wrap-up entries
   gh issue create --title "Digest: wrap-up (6)" --body-file staged/digest-promotion-12.md
5  [digest]  #—  Digest: review (6)
   Propose cluster: file record absorbing 6 review entries
   gh issue create --title "Digest: review (6)" --body-file staged/digest-promotion-13.md
6  [digest]  #—  Digest: tools (4)
   Propose cluster: file record absorbing 4 tools entries
   gh issue create --title "Digest: tools (4)" --body-file staged/digest-promotion-14.md
7  [digest]  #—  Digest: tiebreak (4)
   Propose cluster: file record absorbing 4 tiebreak entries
   gh issue create --title "Digest: tiebreak (4)" --body-file staged/digest-promotion-15.md
8  [digest]  #—  Digest: ledger (3)
   Propose cluster: file record absorbing 3 ledger entries
   gh issue create --title "Digest: ledger (3)" --body-file staged/digest-promotion-16.md
9  [digest]  #—  Digest: tidy (3)
   Propose cluster: file record absorbing 3 tidy entries
   gh issue create --title "Digest: tidy (3)" --body-file staged/digest-promotion-17.md
10  [digest]  #—  Digest: engine-verify.js (3)
   Propose cluster: file record absorbing 3 engine-verify.js entries
   gh issue create --title "Digest: engine-verify.js (3)" --body-file staged/digest-promotion-18.md
11  [digest]  #—  Digest: docs (3)
   Propose cluster: file record absorbing 3 docs entries
   gh issue create --title "Digest: docs (3)" --body-file staged/digest-promotion-19.md
12  [digest]  #—  Digest: console (149)
   Propose cluster: file record absorbing 149 console entries
   gh issue create --title "Digest: console (149)" --body-file staged/digest-promotion-2.md
13  [digest]  #—  Digest: tests (61)
   Propose cluster: file record absorbing 61 tests entries
   gh issue create --title "Digest: tests (61)" --body-file staged/digest-promotion-3.md
14  [digest]  #—  Digest: _shared (21)
   Propose cluster: file record absorbing 21 _shared entries
   gh issue create --title "Digest: _shared (21)" --body-file staged/digest-promotion-4.md
15  [digest]  #—  Digest: release (16)
   Propose cluster: file record absorbing 16 release entries
   gh issue create --title "Digest: release (16)" --body-file staged/digest-promotion-5.md
16  [digest]  #—  Digest: reconcile (15)
   Propose cluster: file record absorbing 15 reconcile entries
   gh issue create --title "Digest: reconcile (15)" --body-file staged/digest-promotion-6.md
17  [digest]  #—  Digest: bin (15)
   Propose cluster: file record absorbing 15 bin entries
   gh issue create --title "Digest: bin (15)" --body-file staged/digest-promotion-7.md
18  [digest]  #—  Digest: hooks (10)
   Propose cluster: file record absorbing 10 hooks entries
   gh issue create --title "Digest: hooks (10)" --body-file staged/digest-promotion-8.md
19  [digest]  #—  Digest: flow (9)
   Propose cluster: file record absorbing 9 flow entries
   gh issue create --title "Digest: flow (9)" --body-file staged/digest-promotion-9.md
20  [claim]  #3315  Fix latent Windows path producers found by the 2…
   Release stale claim (TTL expired 2026-10-25)
   release-claim.js 3315 --sweep  (full cmd: staged/tidy-claim-releases-1.md)
21  [claim]  #3974  Resolve a run's spec header at its live or archiv…
   Release stale claim (TTL expired 2026-10-25)
   release-claim.js 3974 --sweep  (full cmd: staged/tidy-claim-releases-1.md)
22  [claim]  #3975  Report stranded spec-shell dirs, ship a command t…
   Release stale claim (TTL expired 2026-10-25)
   release-claim.js 3975 --sweep  (full cmd: staged/tidy-claim-releases-1.md)
23  [claim]  #3976  Archive the spec header on the run branch before …
   Release stale claim (TTL expired 2026-10-25)
   release-claim.js 3976 --sweep  (full cmd: staged/tidy-claim-releases-1.md)
```

**Yours (41)**
```text
specify (3)
   #2724  reconcile: structurally-stuck run directories       too vague — judgment call
   #3979  Route isDeadRunDir, abandoned-interrupted recency   too large — judgment call
   #4336  run-tests-isolation slot-wait test fails            too small — judgment call
   /claude-tweaks:specify #2724,#3979,#4336
demo (26)
   #4379  reconcile: removal-failed stuck                     no acceptance disposition
   #4378  reconcile: removal-failed stuck                     no acceptance disposition
   #4376  reconcile: removal-failed stuck                     no acceptance disposition
   #4374  reconcile: removal-failed stuck                     no acceptance disposition
   #4373  reconcile: removal-failed stuck                     no acceptance disposition
   #4372  reconcile: removal-failed stuck                     no acceptance disposition
   #4370  reconcile: removal-failed stuck                     no acceptance disposition
   #4296  Windows regression: 1 test file(s) newly failing    no acceptance disposition
   #4228  Windows regression: 2 test file(s) newly failing    no acceptance disposition
   #4055  Windows regression: 1 test file(s) newly failing    no acceptance disposition
   #4020  Windows regression: 1 test file(s) newly failing    no acceptance disposition
   #4016  Windows regression: 3 test file(s) newly failing    no acceptance disposition
   #3786  reconcile: removal-failed stuck                     no acceptance disposition
   #3644  Windows regression: 1 test file(s) newly failing    no acceptance disposition
   #3632  verify.js scoped run cannot baseline-adjudicate a…  no acceptance disposition
   #3538  Dispatch headless self-report: check3               no acceptance disposition
   #3407  Windows regression: 1 test file(s) newly failing    no acceptance disposition
   #3362  Document the subagent-stop trailing STATUS line     no acceptance disposition
   #3360  flow/multi-spec.md exceeds its 20,480-byte read b…  no acceptance disposition
   #3318  Classify the Windows full-suite failing set         no acceptance disposition
   #3229  build / SDD dispatch: multi-task builds spend       no acceptance disposition
   #3178  verify.js baseline isolation mis-extracts test-fi…  no acceptance disposition
   #3171  verify.js --baseline adjudication fails on its ow…  no acceptance disposition
   #3125  Skill drift: node-test-output-evidence — Key Patt…  no acceptance disposition
   #2914  Two-call /flow dispatch handoff: config.yml missi…  no acceptance disposition
   #2859  Ledger-acknowledged pre-existing test failures bl…  no acceptance disposition
   /claude-tweaks:demo #4379,#4378,#4376,#4374,#4373,#4372,#4370,#4296,#4228,#4055,#4020,#4016,#3786,#3644,#3632,#3538,#3407,#3362,#3360,#3318,#3229,#3178,#3171,#3125,#2914,#2859
git (8)
   —      [plan] windows-regression-guard-3316.md             cited by dispatch-cost-baseline
   —      [git] dispatch-record-4212                          PR #4223 closed unmerged, 14 commits off main
   —      [git] dispatch-record-3175                          PR #3454 closed unmerged, 1 commit off main
   —      [git] dispatch-record-2806                          PR #2836 closed unmerged, 5 commits off main
   —      [git] agent-ab4cdd9c1659dc6d3                       no PR, 13 commits off main
   —      [git] agent-ad8a86f9bdee05233                       no PR, 10 commits off main
   —      [git] backlog-refine                                no PR, 8 commits off main
   —      [git] agent-a62d1a86888ecd871                       no PR, 3 commits off main
   git grep -nF -- '2026-10-17-windows-regression-guard-3316.md'
   git log --oneline origin/main..worktree-dispatch-record-4212
   git log --oneline origin/main..worktree-dispatch-record-3175
   git log --oneline origin/main..worktree-dispatch-record-2806
   git log --oneline origin/main..worktree-agent-ab4cdd9c1659dc6d3
   git log --oneline origin/main..worktree-agent-ad8a86f9bdee05233
   git log --oneline origin/main..worktree-backlog-refine
   git log --oneline origin/main..worktree-agent-a62d1a86888ecd871
gh (2)
   PR     #4361 chore(main): release 6.156.0                  awaiting review, CI clean
   PR     #4215 Remove 1 residue ledger from docs/plans       awaiting review, CI clean
   gh pr view 4361 --web
   gh pr view 4215 --web
node (1)
   —      [calibration] decision-records/upstream 0 findings  judgment call, no mechanical fix
   node plugin/bin/calibration-report.js --runs 50
review (5)
   —      [pattern] whole-branch review fixes recur (22 spe…  strengthen per-task review
   —      [pattern] archive-merged.js: 42 fix commits / 4 w…  possible responsibility magnet
   —      [pattern] hooks.js: 51 fix commits / 4 wks          check verb logic leakage
   —      [health] 17 dirty worktrees, never auto-removed     .claude/worktrees/
   —      [health] main CI red at 3ad3659; main checkout di…  reconcile mirror-ff skipped
```

**Clean:**
```text
ready records      128 checked
design docs        — checked
registry           23 checked
claim tombstones   1903 checked
digest expiry      544 checked
```

Full decision log: .claude-tweaks/pipelines/2026-10-26T092305-sweep-standalone/decisions.md
