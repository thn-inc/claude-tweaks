## Tidy Report — 2026-10-26

**Applied automatically**
```text
reaped       #4125  worktree dispatch-record-4125 (PR merged)           high
reaped       #4131  worktree dispatch-record-4131 (PR merged)           high
reaped       #4132  worktree dispatch-record-4132 (PR merged)           high
reaped       #4391  worktree dispatch-record-4391 (PR merged)           high
deleted      #4027  plan phase-procedure-bundles-4027                   commit c7fa741
deleted      #4314  plan shipped-candidate-followup-exclusion           commit c7fa741
deleted      #4133  plan test-impact-tracer-hardening-4133              commit c7fa741
deleted      #4134  plan test-impact-windows-4134                       commit c7fa741
deleted      #4391  plan bound-shell-scanner-differential-recipe-4391   commit c7fa741
deleted      #4125  plan evidence-route-cli                             commit c7fa741
deleted      #4132  plan impact-map-drift-selection                     commit c7fa741
deleted      #4131  plan test-impact-dirty-provenance-4131              commit c7fa741
deleted      #4288  plan windows-posix-display-ids-4288                 commit c7fa741
acked        #4132  console item sdd-ruling-1 (ratified before merge)   high
   skipped: reconcile archive-branches, remote-prune, reap — budget-exceeded
   skipped: worktree dispatch-record-4134 — a live process cwd is inside it
```

**Yours (60)**
```text
specify (4)
   #3979  Route isDeadRunDir, abandoned-interrupted recency…  too large (12 deliverables), split
   #3976  Archive the spec header on the run branch before …  too large (11 deliverables), split
   #3903  code-health: resolve 9 accumulated below-floor di…  too large (12 deliverables), split
   #2724  reconcile: structurally-stuck run directories       tracker body, no Deliverables/AC
   /claude-tweaks:specify #3979,#3976,#3903,#2724
demo (13)
   #3644  Windows regression: 1 test file(s) newly failing    closed, no acceptance disposition
   #3632  verify.js scoped run cannot baseline-adjudicate a   closed, no acceptance disposition
   #3538  Dispatch headless self-report: check3 (gh present,  closed, no acceptance disposition
   #3407  Windows regression: 1 test file(s) newly failing    closed, no acceptance disposition
   #3362  Document that the subagent-stop trailing STATUS     closed, no acceptance disposition
   #3360  flow/multi-spec.md exceeds its 20,480-byte read     closed, no acceptance disposition
   #3318  Classify the Windows full-suite failing set and     closed, no acceptance disposition
   #3229  build / subagent-driven-development dispatch:       closed, no acceptance disposition
   #3178  verify.js baseline isolation mis-extracts test      closed, no acceptance disposition
   #3171  verify.js --baseline adjudication fails on its own  closed, no acceptance disposition
   #3125  Skill drift: node-test-output-evidence — Key        closed, no acceptance disposition
   #2914  Two-call /flow dispatch handoff: config.yml         closed, no acceptance disposition
   #2859  Ledger-acknowledged pre-existing test failures      closed, no acceptance disposition
   /claude-tweaks:demo #3644,#3632,#3538,#3407,#3362,#3360,#3318,#3229,#3178,#3171,#3125,#2914,#2859
git (8)
   #4371  worktree dispatch-record-4026 (PR merged)           dirty: tracked deletions only
   #4375  worktree dispatch-record-4141 (PR merged)           dirty: tracked deletions only
   #4377  worktree dispatch-record-4153 (PR merged)           dirty: tracked deletions only
   #4380  worktree dispatch-record-4273 (PR merged)           dirty: tracked deletions only
   #4381  worktree dispatch-record-4314 (PR merged)           dirty: tracked deletions only
   #4382  worktree dispatch-record-4317 (PR merged)           dirty: tracked deletions only
   #4383  worktree dispatch-record-4326 (PR merged)           dirty: tracked deletions only
   #4384  worktree dispatch-record-4331 (PR merged)           dirty: tracked deletions only
   git worktree remove --force .claude/worktrees/dispatch-record-4026
   git worktree remove --force .claude/worktrees/dispatch-record-4141
   git worktree remove --force .claude/worktrees/dispatch-record-4153
   git worktree remove --force .claude/worktrees/dispatch-record-4273
   git worktree remove --force .claude/worktrees/dispatch-record-4314
   git worktree remove --force .claude/worktrees/dispatch-record-4317
   git worktree remove --force .claude/worktrees/dispatch-record-4326
   git worktree remove --force .claude/worktrees/dispatch-record-4331
capture (1)
   #4135  shipped-candidate detector false positive           new record write, never auto
   /claude-tweaks:capture shipped-candidate detector marked an unshipped record as shipped
dispatch (1)
   #4135  Pin committed verify-scope.json readable by prior   wrongly excluded as shipped
   /claude-tweaks:dispatch #4135
gh (2)
   #4397  PR chore(main): release 6.156.1                     awaiting review, CI clean
   #4215  PR Remove 1 residue ledger from docs/plans          awaiting review 2d, CI clean
   gh pr view 4397 --web
   gh pr view 4215 --web
review (31)
   —      [pattern] review-lens dispatch rules patched one …  codify step3-lens-dispatch.md
   —      [pattern] Windows test-parity regressions recur (…  authoring-time conformance check
   —      [pattern] Review Console section/stance drift rec…  site checklist + pinned tests
   —      [pattern] orphaned plan sweeps recur (316 plans, …  delete plan at close-out
   —      [pattern] release disposition gaps recur (5)        route-coverage conformance test
   —      [pattern] archive/teardown fixes recur (5)          use merge-shape-landed-proof
   —      [pattern] ledger-reader defects recur (9)           finish resolve-ledger migration
   —      [health] archival lands in reconcile batches of 4…  archive at each wrap-up
   —      [calibration] narrow decision-records and upstrea…  calibration-report.js
   —      [plan] windows-regression-guard-3316 kept: cited    docs/reference/dispatch-cost-baseline.md
   —      [release-note] scan did not complete (no candidat…  re-run Step 1 for #2724
   —      [run-dir] 46 pre-09-26 late-write stubs; archive/…  .claude-tweaks/pipelines/2026-08-*
   —      [claim] 5 archived standalone runs not clean (4 a…  .claude-tweaks/pipelines/archive/
   —      [git] worktree dispatch-record-3175                 PR #3454 closed, unmerged
   —      [git] worktree record-2840                          PR #2965 closed, unmerged
   —      [git] worktree dispatch-record-2806                 PR #2836 closed, unmerged
   —      [git] worktree dispatch-record-4212                 PR #4223 closed, no tombstone
   —      [git] worktree agent-ab4cdd9c1659dc6d3              no PR, 19 files unmerged
   —      [git] worktree agent-a62d1a86888ecd871              no PR, 15 files unmerged
   —      [git] worktree agent-ab98a10b8f1bc2528              no PR, branch unknown
   —      [git] worktree agent-ad8a86f9bdee05233              no PR, unmerged
   —      [git] worktree backlog-refine                       no PR, 12 files 0-line diff
   —      [git] worktree agent-a47f799d857db07fd              untracked npm-test-3301.txt
   —      [git] worktree agent-a97b6fa2589f7ca3f              M docs/hooks.md, no PR
   —      [git] worktree dispatch-record-1337                 merged; untracked ledger
   —      [git] worktree dispatch-record-457                  merged; untracked ledger
   —      [git] worktree dispatch-record-1725                 merged; untracked run dir
   —      [git] worktree dispatch-record-2785                 no PR; untracked run dir
   —      [git] worktree record-1471                          merged; 9 untracked work/ files
   —      [git] worktree record-1686-1733-1734-1737-1738-22…  merged; untracked run dir
   —      [git] worktree record-3001                          merged; untracked .superpowers/
```

**Clean:**
```text
work records       151 checked
design docs        0 checked
ledgers            30 checked
registry           — checked
claims             1941 checked
digest             1 checked
```

Full decision log: .claude-tweaks/pipelines/2026-10-26T114954-tidy-standalone/decisions.md
